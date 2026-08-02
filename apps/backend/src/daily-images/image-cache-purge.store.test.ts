import { describe, expect, it } from "vitest";

import { InMemoryContentLifecycleStore } from "../content-lifecycle/in-memory-content-lifecycle.store";
import type { StoredCachePurgeIntent } from "./daily-image-asset.store";

const INTENT: StoredCachePurgeIntent = {
  assetId: "asset-image-purge",
  contentVersion: "content-image-purge",
  createdAt: "2026-08-02T05:00:00.000Z",
  fortuneDate: "2026-08-03",
  purgeIntentId: "purge-image-0001",
  requestId: "request-image-purge-0001",
};

describe("InMemoryContentLifecycleStore image cache purge intents", () => {
  it("retries a failed claim and fences stale attempts", async () => {
    const store = new InMemoryContentLifecycleStore();
    await store.transaction((transaction) => transaction.insertCachePurgeIntent(INTENT));

    await expect(
      store.claimNextImageCachePurgeIntent({
        attemptToken: "attempt-image-first",
        claimedAt: "2026-08-02T05:00:00.000Z",
        leaseExpiresAt: "2026-08-02T05:05:00.000Z",
        workerId: "image-worker-a",
      }),
    ).resolves.toMatchObject({ attempts: 1, status: "processing" });
    await expect(
      store.completeImageCachePurgeIntent({
        attemptToken: "stale-attempt",
        completedAt: "2026-08-02T05:00:01.000Z",
        purgeIntentId: INTENT.purgeIntentId,
        workerId: "image-worker-a",
      }),
    ).resolves.toBeNull();

    await expect(
      store.recordImageCachePurgeFailure({
        attemptToken: "attempt-image-first",
        error: "cache provider unavailable",
        failedAt: "2026-08-02T05:00:02.000Z",
        purgeIntentId: INTENT.purgeIntentId,
        retryAt: "2026-08-02T05:00:32.000Z",
        workerId: "image-worker-a",
      }),
    ).resolves.toMatchObject({
      availableAt: "2026-08-02T05:00:32.000Z",
      lastError: "cache provider unavailable",
      status: "pending",
    });
    await expect(
      store.claimNextImageCachePurgeIntent({
        attemptToken: "attempt-image-too-early",
        claimedAt: "2026-08-02T05:00:31.000Z",
        leaseExpiresAt: "2026-08-02T05:05:31.000Z",
        workerId: "image-worker-b",
      }),
    ).resolves.toBeNull();

    await expect(
      store.claimNextImageCachePurgeIntent({
        attemptToken: "attempt-image-second",
        claimedAt: "2026-08-02T05:00:32.000Z",
        leaseExpiresAt: "2026-08-02T05:05:32.000Z",
        workerId: "image-worker-b",
      }),
    ).resolves.toMatchObject({ attempts: 2, status: "processing" });
    await expect(
      store.completeImageCachePurgeIntent({
        attemptToken: "attempt-image-first",
        completedAt: "2026-08-02T05:00:33.000Z",
        purgeIntentId: INTENT.purgeIntentId,
        workerId: "image-worker-a",
      }),
    ).resolves.toBeNull();
    await expect(
      store.completeImageCachePurgeIntent({
        attemptToken: "attempt-image-second",
        completedAt: "2026-08-02T05:00:33.000Z",
        purgeIntentId: INTENT.purgeIntentId,
        workerId: "image-worker-b",
      }),
    ).resolves.toMatchObject({ processedAt: "2026-08-02T05:00:33.000Z", status: "completed" });
    await expect(
      store.claimNextImageCachePurgeIntent({
        attemptToken: "attempt-image-after-complete",
        claimedAt: "2026-08-02T05:10:00.000Z",
        leaseExpiresAt: "2026-08-02T05:15:00.000Z",
        workerId: "image-worker-c",
      }),
    ).resolves.toBeNull();
  });

  it("allows exactly one worker to reclaim an expired lease", async () => {
    const store = new InMemoryContentLifecycleStore();
    await store.transaction((transaction) => transaction.insertCachePurgeIntent(INTENT));
    const first = await store.claimNextImageCachePurgeIntent({
      attemptToken: "attempt-image-lease-first",
      claimedAt: "2026-08-02T05:00:00.000Z",
      leaseExpiresAt: "2026-08-02T05:05:00.000Z",
      workerId: "image-worker-lease-a",
    });
    expect(first).toMatchObject({ attempts: 1, status: "processing" });

    await expect(
      store.claimNextImageCachePurgeIntent({
        attemptToken: "attempt-image-lease-early",
        claimedAt: "2026-08-02T05:04:59.999Z",
        leaseExpiresAt: "2026-08-02T05:09:59.999Z",
        workerId: "image-worker-lease-b",
      }),
    ).resolves.toBeNull();
    await expect(
      store.claimNextImageCachePurgeIntent({
        attemptToken: "attempt-image-lease-second",
        claimedAt: "2026-08-02T05:05:00.000Z",
        leaseExpiresAt: "2026-08-02T05:10:00.000Z",
        workerId: "image-worker-lease-b",
      }),
    ).resolves.toMatchObject({ attempts: 2, status: "processing" });
    await expect(
      store.completeImageCachePurgeIntent({
        attemptToken: "attempt-image-lease-first",
        completedAt: "2026-08-02T05:05:01.000Z",
        purgeIntentId: INTENT.purgeIntentId,
        workerId: "image-worker-lease-a",
      }),
    ).resolves.toBeNull();
  });
});
