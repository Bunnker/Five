import { describe, expect, it } from "vitest";

import type { StoredContentScheduleTask } from "./content-release.store";
import { ContentReleaseWorker } from "./content-release.worker";
import { InMemoryContentReleaseStore } from "./in-memory-content-release.store";

function task(): StoredContentScheduleTask {
  return {
    attemptToken: null,
    attempts: 0,
    availableAt: "2026-08-01T15:00:00.000Z",
    claimedAt: null,
    completedAt: null,
    contentVersion: "content-scheduled",
    createdAt: "2026-08-01T12:00:00.000Z",
    effectiveFrom: "2026-08-01T15:00:00.000Z",
    fortuneDate: "2026-08-02",
    lastError: null,
    leaseExpiresAt: null,
    scheduleSlotRevision: 1,
    status: "pending",
    taskId: "schedule-task-worker",
    terminatedAt: null,
    terminationReason: null,
    updatedAt: "2026-08-01T12:00:00.000Z",
    workerId: null,
  };
}

function seedScheduledProjection(store: InMemoryContentReleaseStore): void {
  store.seedProjection({
    activeContentVersion: null,
    fortuneDate: "2026-08-02",
    lifecycleRevision: 4,
    scheduleSlotRevision: 1,
    scheduledContentVersion: "content-scheduled",
    scheduledEffectiveFrom: "2026-08-01T15:00:00.000Z",
  });
}

describe("ContentReleaseWorker", () => {
  it("is idle when no release task is due", async () => {
    const store = new InMemoryContentReleaseStore();
    const worker = new ContentReleaseWorker(
      store,
      { publishScheduledTask: async () => ({ kind: "lost" }) },
      { now: () => new Date("2026-08-01T15:00:00.000Z") },
      { nextAttemptToken: () => "attempt-idle", workerId: "release-worker-test" },
    );

    await expect(worker.runOne()).resolves.toBe("idle");
  });

  it("keeps the version scheduled and retries a failed current preflight", async () => {
    const store = new InMemoryContentReleaseStore();
    seedScheduledProjection(store);
    await store.transaction((transaction) => transaction.insertScheduleTask(task()));
    const worker = new ContentReleaseWorker(
      store,
      {
        publishScheduledTask: async () => ({
          kind: "preflight_failed",
          preflightChecks: [
            { code: "required_images", message: "必备图当前不可交付。", status: "failed" },
          ],
        }),
      },
      { now: () => new Date("2026-08-01T15:00:00.000Z") },
      { nextAttemptToken: () => "attempt-retry", workerId: "release-worker-test" },
    );

    await expect(worker.runOne()).resolves.toBe("retrying");
    await expect(store.readScheduleTask("schedule-task-worker")).resolves.toMatchObject({
      attemptToken: null,
      attempts: 1,
      lastError: "发布预检未通过：required_images",
      status: "retrying",
      workerId: null,
    });
    await expect(store.listReleaseEvents("2026-08-02")).resolves.toMatchObject([
      {
        action: "scheduled_publish_failed",
        contentVersion: "content-scheduled",
        reason: "发布预检未通过：required_images",
        transitions: [
          {
            contentVersion: "content-scheduled",
            fromState: "scheduled",
            toState: "scheduled",
          },
        ],
      },
    ]);
    await expect(store.readAuditEventsForTest()).resolves.toMatchObject([
      {
        action: "content_scheduled_publish_failed",
        contentVersion: "content-scheduled",
        fromState: "scheduled",
        toState: "scheduled",
      },
    ]);
  });

  it("records an observable failed release event before retrying an execution error", async () => {
    const store = new InMemoryContentReleaseStore();
    seedScheduledProjection(store);
    await store.transaction((transaction) => transaction.insertScheduleTask(task()));
    const worker = new ContentReleaseWorker(
      store,
      {
        publishScheduledTask: async () => {
          throw new Error("temporary database failover");
        },
      },
      { now: () => new Date("2026-08-01T15:00:00.000Z") },
      { nextAttemptToken: () => "attempt-error", workerId: "release-worker-test" },
    );

    await expect(worker.runOne()).resolves.toBe("retrying");
    await expect(store.listReleaseEvents("2026-08-02")).resolves.toMatchObject([
      {
        action: "scheduled_publish_failed",
        reason: "temporary database failover",
      },
    ]);
    await expect(store.readAuditEventsForTest()).resolves.toHaveLength(1);
  });
});
