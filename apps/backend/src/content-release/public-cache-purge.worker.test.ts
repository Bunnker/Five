import { describe, expect, it, vi } from "vitest";

import { InMemoryContentReleaseStore } from "./in-memory-content-release.store";
import { PublicCachePurgeWorker } from "./public-cache-purge.worker";

async function seedIntent(store: InMemoryContentReleaseStore): Promise<void> {
  await store.transaction((transaction) =>
    transaction.insertPublicCachePurgeIntent({
      action: "publish",
      afterActiveContentVersion: "content-new",
      beforeActiveContentVersion: "content-old",
      createdAt: "2026-08-01T16:00:00.000Z",
      fortuneDate: "2026-08-02",
      processedAt: null,
      purgeIntentId: "purge-intent-1",
      requestId: "release-request-1",
    }),
  );
}

describe("PublicCachePurgeWorker", () => {
  it("marks an intent complete only after the purge adapter succeeds", async () => {
    const store = new InMemoryContentReleaseStore();
    await seedIntent(store);
    const purge = vi.fn().mockResolvedValue(undefined);
    const worker = new PublicCachePurgeWorker(
      store,
      { purge },
      { now: () => new Date("2026-08-01T16:00:01.000Z") },
      { nextAttemptToken: () => "purge-attempt-1", workerId: "purge-worker-test" },
    );

    await expect(worker.runOne()).resolves.toBe("completed");
    expect(purge).toHaveBeenCalledWith(
      expect.objectContaining({ fortuneDate: "2026-08-02", purgeIntentId: "purge-intent-1" }),
    );
    await expect(store.listPublicCachePurgeIntents("2026-08-02")).resolves.toMatchObject([
      { attempts: 1, processedAt: "2026-08-01T16:00:01.000Z", status: "completed" },
    ]);
  });

  it("releases the fence and retries when the purge adapter fails", async () => {
    const store = new InMemoryContentReleaseStore();
    await seedIntent(store);
    const worker = new PublicCachePurgeWorker(
      store,
      { purge: async () => Promise.reject(new Error("purge endpoint unavailable")) },
      { now: () => new Date("2026-08-01T16:00:01.000Z") },
      { nextAttemptToken: () => "purge-attempt-2", workerId: "purge-worker-test" },
    );

    await expect(worker.runOne()).resolves.toBe("retrying");
    await expect(store.listPublicCachePurgeIntents("2026-08-02")).resolves.toMatchObject([
      {
        attempts: 1,
        attemptToken: null,
        lastError: "purge endpoint unavailable",
        status: "pending",
        workerId: null,
      },
    ]);
  });
});
