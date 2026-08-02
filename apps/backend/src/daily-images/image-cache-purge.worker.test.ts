import { describe, expect, it, vi } from "vitest";

import { InMemoryContentLifecycleStore } from "../content-lifecycle/in-memory-content-lifecycle.store";
import { ImageCachePurgeWorker } from "./image-cache-purge.worker";

async function seedIntent(store: InMemoryContentLifecycleStore): Promise<void> {
  await store.transaction((transaction) =>
    transaction.insertCachePurgeIntent({
      assetId: "asset-image-worker",
      contentVersion: "content-image-worker",
      createdAt: "2026-08-02T05:00:00.000Z",
      fortuneDate: "2026-08-03",
      purgeIntentId: "purge-image-worker-0001",
      requestId: "request-image-worker-0001",
    }),
  );
}

describe("ImageCachePurgeWorker", () => {
  it("marks an image purge intent complete only after the shared purge adapter succeeds", async () => {
    const store = new InMemoryContentLifecycleStore();
    await seedIntent(store);
    const purge = vi.fn().mockResolvedValue(undefined);
    const worker = new ImageCachePurgeWorker(
      store,
      { purge },
      { now: () => new Date("2026-08-02T05:00:01.000Z") },
      { nextAttemptToken: () => "attempt-image-worker-1", workerId: "image-worker-test" },
    );

    await expect(worker.runOne()).resolves.toBe("completed");
    expect(purge).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-image-worker",
        contentVersion: "content-image-worker",
        purgeIntentId: "purge-image-worker-0001",
      }),
    );
    expect(store.readCachePurgeIntentsForTest()).toMatchObject([
      { attempts: 1, processedAt: "2026-08-02T05:00:01.000Z", status: "completed" },
    ]);
  });

  it("releases the attempt fence and schedules a retry when the purge adapter fails", async () => {
    const store = new InMemoryContentLifecycleStore();
    await seedIntent(store);
    const worker = new ImageCachePurgeWorker(
      store,
      { purge: async () => Promise.reject(new Error("image purge endpoint unavailable")) },
      { now: () => new Date("2026-08-02T05:00:01.000Z") },
      { nextAttemptToken: () => "attempt-image-worker-2", workerId: "image-worker-test" },
    );

    await expect(worker.runOne()).resolves.toBe("retrying");
    expect(store.readCachePurgeIntentsForTest()).toMatchObject([
      {
        attempts: 1,
        attemptToken: null,
        availableAt: "2026-08-02T05:00:31.000Z",
        lastError: "image purge endpoint unavailable",
        status: "pending",
        workerId: null,
      },
    ]);
  });
});
