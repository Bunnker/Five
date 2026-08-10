import { randomUUID } from "node:crypto";

import type { GeneratedImageUploader } from "../content-production/content-image-production.worker";
import { buildDailyOutfitImagePrompt } from "../content-production/daily-outfit-image-prompt";
import type { GeneratedImage, ImageGenerator } from "../content-production/openai-image.generator";
import type { DayCorrectionImageJobStore } from "./day-correction-image-job.store";

interface DayCorrectionImageWorkerClock {
  now(): Date;
}

const SYSTEM_CLOCK: DayCorrectionImageWorkerClock = { now: () => new Date() };
const WORKER_ID = `day-correction-image-${process.pid}`;

export type DayCorrectionImageWorkerRunResult =
  "failed" | "generated" | "generated_stale" | "idle" | "not_configured" | "retrying" | "stale";

export class DayCorrectionImageWorker {
  constructor(
    private readonly store: DayCorrectionImageJobStore,
    private readonly generator: ImageGenerator | null,
    private readonly uploader: GeneratedImageUploader,
    private readonly clock: DayCorrectionImageWorkerClock = SYSTEM_CLOCK,
  ) {}

  async runOne(): Promise<DayCorrectionImageWorkerRunResult> {
    if (this.generator === null) return "not_configured";
    const claimedAt = this.clock.now();
    const attemptToken = randomUUID();
    const job = await this.store.claimNext({
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
        origin: "day_correction",
        prompt,
        promptVersion: job.promptVersion,
        reproductionReference: image.reproductionReference,
      });
      const completed = await this.store.complete({
        assetId: uploaded.assetId,
        attemptToken,
        completedAt: this.clock.now().toISOString(),
        jobId: job.jobId,
        workerId: WORKER_ID,
      });
      return completed === "completed" ? "generated" : "generated_stale";
    } catch (error) {
      const failedAt = this.clock.now();
      const message = error instanceof Error ? error.message : "未知图片生成错误";
      const failure = await this.store.recordFailure({
        attemptToken,
        error: message.slice(0, 2_000),
        failedAt: failedAt.toISOString(),
        jobId: job.jobId,
        retryAt: new Date(failedAt.getTime() + 60_000).toISOString(),
        workerId: WORKER_ID,
      });
      return failure === "exhausted"
        ? "failed"
        : failure === "retry_scheduled"
          ? "retrying"
          : "stale";
    }
  }
}
