import { randomUUID } from "node:crypto";

import type { PublicCachePurger } from "../content-release/public-cache-purge.worker";
import type { ImageCachePurgeStore } from "./image-cache-purge.store";

export interface ImageCachePurgeClock {
  now(): Date;
}

export interface ImageCachePurgeWorkerIdentity {
  readonly workerId: string;
  nextAttemptToken(): string;
}

const SYSTEM_CLOCK: ImageCachePurgeClock = { now: () => new Date() };
const SYSTEM_IDENTITY: ImageCachePurgeWorkerIdentity = {
  nextAttemptToken: () => randomUUID(),
  workerId: `image-cache-purge-${process.pid}`,
};
const CLAIM_LEASE_MILLISECONDS = 5 * 60 * 1_000;
const MAX_RETRY_DELAY_SECONDS = 15 * 60;

export type ImageCachePurgeWorkerRunResult = "completed" | "idle" | "retrying" | "stale";

export class ImageCachePurgeWorker {
  constructor(
    private readonly store: ImageCachePurgeStore,
    private readonly purger: PublicCachePurger,
    private readonly clock: ImageCachePurgeClock = SYSTEM_CLOCK,
    private readonly identity: ImageCachePurgeWorkerIdentity = SYSTEM_IDENTITY,
  ) {}

  async runOne(): Promise<ImageCachePurgeWorkerRunResult> {
    const claimedAt = this.clock.now();
    const attemptToken = this.identity.nextAttemptToken();
    const intent = await this.store.claimNextImageCachePurgeIntent({
      attemptToken,
      claimedAt: claimedAt.toISOString(),
      leaseExpiresAt: new Date(claimedAt.getTime() + CLAIM_LEASE_MILLISECONDS).toISOString(),
      workerId: this.identity.workerId,
    });
    if (intent === null) return "idle";

    try {
      await this.purger.purge(intent);
      const completed = await this.store.completeImageCachePurgeIntent({
        attemptToken,
        completedAt: this.clock.now().toISOString(),
        purgeIntentId: intent.purgeIntentId,
        workerId: this.identity.workerId,
      });
      return completed === null ? "stale" : "completed";
    } catch (error) {
      const failedAt = this.clock.now();
      const delaySeconds = Math.min(
        MAX_RETRY_DELAY_SECONDS,
        30 * 2 ** Math.min(intent.attempts - 1, 5),
      );
      const message = error instanceof Error ? error.message : "未知图片缓存清理错误";
      const retrying = await this.store.recordImageCachePurgeFailure({
        attemptToken,
        error: message.slice(0, 2_000),
        failedAt: failedAt.toISOString(),
        purgeIntentId: intent.purgeIntentId,
        retryAt: new Date(failedAt.getTime() + delaySeconds * 1_000).toISOString(),
        workerId: this.identity.workerId,
      });
      return retrying === null ? "stale" : "retrying";
    }
  }
}
