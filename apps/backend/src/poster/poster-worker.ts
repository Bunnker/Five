import { randomUUID } from "node:crypto";

import type { PublishedContentReader } from "../today/today-content.service";
import type { PosterAssetStore } from "./poster-asset.store";
import type { PosterJobRecord, PosterJobRepository } from "./poster-job.repository";
import type { PosterRenderer } from "./poster-renderer";

export type PosterWorkerResult =
  "failed" | "idle" | "lost" | "ready" | "retrying" | "version_changed";

const MAX_RENDER_ATTEMPTS = 3;
const ASSET_GARBAGE_BATCH_SIZE = 16;

function activeVersion(record: PosterJobRecord, contentVersion: string | null): boolean {
  return contentVersion === record.sourceContentVersion;
}

function posterAssetUrl(origin: string, assetKey: string): string {
  return new URL(
    encodeURIComponent(assetKey),
    origin.endsWith("/") ? origin : `${origin}/`,
  ).toString();
}

export class PosterWorker {
  constructor(
    private readonly repository: PosterJobRepository,
    private readonly publishedContentReader: PublishedContentReader,
    private readonly renderer: PosterRenderer,
    private readonly assetStore: PosterAssetStore,
    private readonly assetOrigin: string,
    private readonly workerId: string,
    private readonly createAttemptToken: () => string = randomUUID,
  ) {}

  async runOne(): Promise<PosterWorkerResult> {
    const attemptToken = this.createAttemptToken();
    const job = await this.repository.claimNext({ attemptToken, workerId: this.workerId });
    await this.collectGarbageAssets();
    if (job === null) {
      return "idle";
    }

    const assetKey = `poster-${attemptToken}.svg`;
    let assetWritten = false;
    let completionAttempted = false;
    try {
      const before = await this.publishedContentReader.findActiveByFortuneDate(job.fortuneDate);
      const beforeVersion = before?.versions.contentVersion ?? null;
      if (
        before === null ||
        !activeVersion(job, beforeVersion) ||
        before.versions.posterTemplateVersion !== job.posterTemplateVersion
      ) {
        await this.repository.markVersionChanged({
          attemptToken,
          currentActiveContentVersion: beforeVersion,
          jobId: job.jobId,
          workerId: this.workerId,
        });
        return "version_changed";
      }

      const rendered = await this.renderer.render({
        content: before,
        landingUrl: job.landingUrl,
        posterTemplateVersion: job.posterTemplateVersion,
        sourceContentVersion: job.sourceContentVersion,
      });
      const reserved = await this.repository.reserveAsset({
        assetKey,
        attemptToken,
        jobId: job.jobId,
        workerId: this.workerId,
      });
      if (!reserved) {
        return "lost";
      }
      await this.assetStore.put(assetKey, rendered.body);
      assetWritten = true;

      // Publication may change while the renderer is working. Never expose an artifact until
      // the same active content version has been observed again after the asset write.
      const after = await this.publishedContentReader.findActiveByFortuneDate(job.fortuneDate);
      const afterVersion = after?.versions.contentVersion ?? null;
      if (
        after === null ||
        !activeVersion(job, afterVersion) ||
        after.versions.posterTemplateVersion !== job.posterTemplateVersion
      ) {
        await this.assetStore.delete(assetKey);
        assetWritten = false;
        await this.repository.markVersionChanged({
          attemptToken,
          currentActiveContentVersion: afterVersion,
          jobId: job.jobId,
          workerId: this.workerId,
        });
        return "version_changed";
      }

      completionAttempted = true;
      const completed = await this.repository.completeReady({
        assetKey,
        assetUrl: posterAssetUrl(this.assetOrigin, assetKey),
        attemptToken,
        currentActiveContentVersion: job.sourceContentVersion,
        jobId: job.jobId,
        posterInstanceId: `poster-${attemptToken}`,
        workerId: this.workerId,
      });
      if (!completed) {
        await this.assetStore.delete(assetKey);
        return "lost";
      }
      return "ready";
    } catch (error) {
      if (completionAttempted) {
        try {
          const resolved = await this.repository.findById(job.jobId);
          if (
            resolved?.status === "ready" &&
            resolved.assetKey === assetKey &&
            resolved.posterInstanceId === `poster-${attemptToken}` &&
            resolved.sourceContentVersion === job.sourceContentVersion &&
            resolved.posterTemplateVersion === job.posterTemplateVersion
          ) {
            return "ready";
          }
        } catch {
          // The durable reservation keeps ambiguous assets eligible for later reconciliation.
        }
      }
      if (assetWritten && !completionAttempted) {
        await this.assetStore.delete(assetKey).catch(() => undefined);
      }
      return this.repository.recordFailure({
        attemptToken,
        errorMessage: error instanceof Error ? error.message : "Unknown poster render failure",
        jobId: job.jobId,
        maxAttempts: MAX_RENDER_ATTEMPTS,
        workerId: this.workerId,
      });
    }
  }

  private async collectGarbageAssets(): Promise<void> {
    const assetKeys = await this.repository.claimGarbageAssetKeys({
      limit: ASSET_GARBAGE_BATCH_SIZE,
    });
    await Promise.all(
      assetKeys.map(async (assetKey) => {
        try {
          await this.assetStore.delete(assetKey);
          await this.repository.acknowledgeGarbageAsset(assetKey);
        } catch {
          // The reservation remains claimable after the cleanup backoff.
        }
      }),
    );

    // Reservation cleanup cannot rule out a stale process resuming after its tombstone was
    // acknowledged. Reconcile the dedicated store as a second safety net for those late writes.
    const storedAssetKeys = await this.assetStore.listKeys();
    const retainedAssetKeys = new Set(await this.repository.findRetainedAssetKeys(storedAssetKeys));
    await Promise.all(
      storedAssetKeys
        .filter((assetKey) => !retainedAssetKeys.has(assetKey))
        .slice(0, ASSET_GARBAGE_BATCH_SIZE)
        .map((assetKey) => this.assetStore.delete(assetKey).catch(() => undefined)),
    );
  }
}
