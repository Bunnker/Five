import { randomUUID } from "node:crypto";

import type { ContentProductionStore, ImageProductionSlot } from "./content-production.store";
import { buildDailyOutfitImagePrompt } from "./daily-outfit-image-prompt";
import type { GeneratedImage, ImageGenerator } from "./openai-image.generator";

export interface GeneratedImageUploader {
  upload(input: {
    readonly bytes: Buffer;
    readonly declaredMediaType: "image/png";
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly fortuneDate: string;
    readonly imageSlot: ImageProductionSlot;
    readonly jobId: string;
    readonly model: string;
    readonly origin?: "automatic_production" | "day_correction";
    readonly prompt: string;
    readonly promptVersion: string;
    readonly reproductionReference: string;
  }): Promise<{
    readonly assetId: string;
    readonly draftRevision: number;
    readonly sha256: string;
  }>;
}

interface ImageProductionClock {
  now(): Date;
}

const SYSTEM_CLOCK: ImageProductionClock = { now: () => new Date() };
const WORKER_ID = `content-image-production-${process.pid}`;

export type ContentImageProductionRunResult =
  "failed" | "generated" | "idle" | "not_configured" | "retrying";

export class ContentImageProductionWorker {
  constructor(
    private readonly store: ContentProductionStore,
    private readonly generator: ImageGenerator | null,
    private readonly uploader: GeneratedImageUploader,
    private readonly clock: ImageProductionClock = SYSTEM_CLOCK,
  ) {}

  async runOne(): Promise<ContentImageProductionRunResult> {
    if (this.generator === null) return "not_configured";
    const claimedAt = this.clock.now();
    const attemptToken = randomUUID();
    const job = await this.store.claimNextImageJob({
      attemptToken,
      claimedAt: claimedAt.toISOString(),
      leaseExpiresAt: new Date(claimedAt.getTime() + 10 * 60_000).toISOString(),
      workerId: WORKER_ID,
    });
    if (job === null) return "idle";
    try {
      const prompt = buildDailyOutfitImagePrompt(job);
      const image: GeneratedImage = await this.generator.generate({ prompt });
      const uploaded = await this.uploader.upload({
        bytes: image.bytes,
        declaredMediaType: image.declaredMediaType,
        draftId: job.draftId,
        expectedDraftRevision: job.draftRevision,
        fortuneDate: job.fortuneDate,
        imageSlot: job.imageSlot,
        jobId: job.jobId,
        model: image.model,
        origin: "automatic_production",
        prompt,
        promptVersion: job.promptVersion,
        reproductionReference: image.reproductionReference,
      });
      await this.store.completeImageJob({
        assetId: uploaded.assetId,
        attemptToken,
        completedAt: this.clock.now().toISOString(),
        draftRevision: uploaded.draftRevision,
        jobId: job.jobId,
        sha256: uploaded.sha256,
        workerId: WORKER_ID,
      });
      return "generated";
    } catch (error) {
      const failedAt = this.clock.now();
      const message = error instanceof Error ? error.message : "未知图片生成错误";
      const failure = await this.store.recordImageJobFailure({
        attemptToken,
        error: message.slice(0, 2_000),
        failedAt: failedAt.toISOString(),
        jobId: job.jobId,
        retryAt: new Date(failedAt.getTime() + 60_000).toISOString(),
        workerId: WORKER_ID,
      });
      return failure === "exhausted" ? "failed" : "retrying";
    }
  }
}
