import { randomUUID } from "node:crypto";

import type { ContentReleaseClock } from "./content-release.service";
import type { ContentReleaseStore, StoredPublicCachePurgeIntent } from "./content-release.store";
import type { StoredImageCachePurgeIntent } from "../daily-images/daily-image-asset.store";

export const PUBLIC_CACHE_PURGER = Symbol("PUBLIC_CACHE_PURGER");

export interface PublicCachePurger {
  purge(intent: StoredImageCachePurgeIntent | StoredPublicCachePurgeIntent): Promise<void>;
}

export interface PublicCachePurgeWorkerIdentity {
  readonly workerId: string;
  nextAttemptToken(): string;
}

const SYSTEM_CLOCK: ContentReleaseClock = { now: () => new Date() };
const SYSTEM_IDENTITY: PublicCachePurgeWorkerIdentity = {
  nextAttemptToken: () => randomUUID(),
  workerId: `public-cache-purge-${process.pid}`,
};
const CLAIM_LEASE_MILLISECONDS = 5 * 60 * 1_000;
const MAX_RETRY_DELAY_SECONDS = 15 * 60;

export type PublicCachePurgeWorkerRunResult = "completed" | "idle" | "retrying" | "stale";

export class PublicCachePurgeWorker {
  constructor(
    private readonly store: ContentReleaseStore,
    private readonly purger: PublicCachePurger,
    private readonly clock: ContentReleaseClock = SYSTEM_CLOCK,
    private readonly identity: PublicCachePurgeWorkerIdentity = SYSTEM_IDENTITY,
  ) {}

  async runOne(): Promise<PublicCachePurgeWorkerRunResult> {
    const claimedAt = this.clock.now();
    const attemptToken = this.identity.nextAttemptToken();
    const intent = await this.store.claimNextPublicCachePurgeIntent({
      attemptToken,
      claimedAt: claimedAt.toISOString(),
      leaseExpiresAt: new Date(claimedAt.getTime() + CLAIM_LEASE_MILLISECONDS).toISOString(),
      workerId: this.identity.workerId,
    });
    if (intent === null) return "idle";

    try {
      await this.purger.purge(intent);
      const completedAt = this.clock.now().toISOString();
      const completed = await this.store.completePublicCachePurgeIntent({
        attemptToken,
        completedAt,
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
      const message = error instanceof Error ? error.message : "未知公共缓存清理错误";
      const retrying = await this.store.recordPublicCachePurgeFailure({
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
