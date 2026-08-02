import type { StoredImageCachePurgeIntent } from "./daily-image-asset.store";

export const IMAGE_CACHE_PURGE_STORE = Symbol("IMAGE_CACHE_PURGE_STORE");

export interface ImageCachePurgeStore {
  claimNextImageCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<StoredImageCachePurgeIntent | null>;
  completeImageCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly purgeIntentId: string;
    readonly workerId: string;
  }): Promise<StoredImageCachePurgeIntent | null>;
  recordImageCachePurgeFailure(input: {
    readonly attemptToken: string;
    readonly error: string;
    readonly failedAt: string;
    readonly purgeIntentId: string;
    readonly retryAt: string;
    readonly workerId: string;
  }): Promise<StoredImageCachePurgeIntent | null>;
}
