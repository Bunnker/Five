import { describe, expect, it, vi } from "vitest";

import { AnalyticsRetentionWorker } from "./analytics-retention.worker";

describe("AnalyticsRetentionWorker", () => {
  it("physically deletes expired anonymous events through the analytics boundary", async () => {
    const purgeExpired = vi.fn().mockResolvedValue(7);
    const worker = new AnalyticsRetentionWorker({ purgeExpired });

    await expect(worker.runOne()).resolves.toEqual({ deletedCount: 7, kind: "purged" });
    expect(purgeExpired).toHaveBeenCalledOnce();
  });

  it("isolates retention storage failure from the rest of the worker cycle", async () => {
    const worker = new AnalyticsRetentionWorker({
      purgeExpired: vi.fn().mockRejectedValue(new Error("temporary database failure")),
    });

    await expect(worker.runOne()).resolves.toEqual({ kind: "failed" });
  });
});
