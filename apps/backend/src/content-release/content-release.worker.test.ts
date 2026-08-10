import { describe, expect, it } from "vitest";

import type { StoredContentScheduleTask } from "./content-release.store";
import { ContentReleaseService } from "./content-release.service";
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

  it("terminates an expired current schedule without retrying it", async () => {
    const store = new InMemoryContentReleaseStore();
    const effectiveFrom = "2026-08-01T18:00:00+08:00";
    store.seedProjection({
      activeContentVersion: null,
      fortuneDate: "2026-08-02",
      lifecycleRevision: 4,
      scheduleSlotRevision: 1,
      scheduledContentVersion: "content-scheduled",
      scheduledEffectiveFrom: effectiveFrom,
    });
    store.seedVersion({
      contentVersion: "content-scheduled",
      createdAt: "2026-08-01T02:00:00.000Z",
      draftId: "draft-content-scheduled",
      effectiveFrom,
      effectiveTo: "2026-08-02T18:00:00+08:00",
      fortuneDate: "2026-08-02",
      preflightChecks: [],
      snapshot: {
        calendar_algorithm: null,
        copy_and_formula: null,
        poster_consistency: null,
        visual_and_rights: null,
      },
      state: "scheduled",
    });
    await store.transaction((transaction) =>
      transaction.insertScheduleTask({
        ...task(),
        availableAt: effectiveFrom,
        effectiveFrom,
      }),
    );
    const clock = { now: () => new Date("2026-08-02T10:00:00.000Z") };
    const publisher = new ContentReleaseService(store, clock, {
      nextAuditEventId: () => "audit-expired-task",
      nextPurgeIntentId: () => "purge-expired-task",
      nextReleaseEventId: () => "release-expired-task",
      nextScheduleTaskId: () => "unused-schedule-task",
    });
    const worker = new ContentReleaseWorker(store, publisher, clock, {
      nextAttemptToken: () => "attempt-expired",
      workerId: "release-worker-expired",
    });

    await expect(worker.runOne()).resolves.toBe("terminated");
    await expect(store.readScheduleTask("schedule-task-worker")).resolves.toMatchObject({
      attempts: 1,
      status: "terminated",
    });
    await expect(store.readVersion("content-scheduled")).resolves.toMatchObject({
      state: "approved",
    });
    expect(
      (await store.listReleaseEvents("2026-08-02")).filter(
        (event) => event.action === "scheduled_publish_failed",
      ),
    ).toHaveLength(0);
  });
});
