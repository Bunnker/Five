import { describe, expect, it } from "vitest";

import type { StoredContentVersion } from "../content-lifecycle/content-lifecycle.store";
import type { StoredContentScheduleTask } from "./content-release.store";
import {
  ContentReleaseService,
  type ContentReleaseClock,
  type ContentReleaseIdentifiers,
  type ContentReleasePreflightEvaluator,
} from "./content-release.service";
import { InMemoryContentReleaseStore } from "./in-memory-content-release.store";

const fortuneDate = "2026-08-02";
const effectiveFrom = "2026-08-01T23:00:00+08:00";

function version(
  contentVersion: string,
  state: StoredContentVersion["state"],
): StoredContentVersion {
  return {
    contentVersion,
    createdAt: "2026-08-01T02:00:00.000Z",
    draftId: `draft-${contentVersion}`,
    effectiveFrom,
    effectiveTo: "2026-08-02T23:00:00+08:00",
    fortuneDate,
    preflightChecks: [],
    snapshot: {
      calendar_algorithm: null,
      copy_and_formula: null,
      poster_consistency: null,
      visual_and_rights: null,
    },
    state,
  };
}

function projection(input?: {
  active?: string | null;
  lifecycleRevision?: number;
  scheduled?: string | null;
  scheduleSlotRevision?: number;
}) {
  return {
    activeContentVersion: input?.active ?? null,
    fortuneDate,
    lifecycleRevision: input?.lifecycleRevision ?? 3,
    scheduleSlotRevision: input?.scheduleSlotRevision ?? 0,
    scheduledContentVersion: input?.scheduled ?? null,
    scheduledEffectiveFrom: input?.scheduled === undefined ? null : effectiveFrom,
  };
}

function pendingTask(
  taskId: string,
  contentVersion: string,
  scheduleSlotRevision: number,
): StoredContentScheduleTask {
  return {
    attemptToken: null,
    attempts: 0,
    availableAt: effectiveFrom,
    claimedAt: null,
    completedAt: null,
    contentVersion,
    createdAt: "2026-08-01T12:00:00.000Z",
    effectiveFrom,
    fortuneDate,
    lastError: null,
    leaseExpiresAt: null,
    scheduleSlotRevision,
    status: "pending",
    taskId,
    terminatedAt: null,
    terminationReason: null,
    updatedAt: "2026-08-01T12:00:00.000Z",
    workerId: null,
  };
}

function harness(now = "2026-08-01T12:00:00.000Z", preflight?: ContentReleasePreflightEvaluator) {
  const store = new InMemoryContentReleaseStore();
  let currentNow = now;
  let audit = 0;
  let purge = 0;
  let release = 0;
  let task = 0;
  const clock: ContentReleaseClock = { now: () => new Date(currentNow) };
  const identifiers: ContentReleaseIdentifiers = {
    nextAuditEventId: () => `audit-release-${++audit}`,
    nextPurgeIntentId: () => `purge-release-${++purge}`,
    nextReleaseEventId: () => `release-event-${++release}`,
    nextScheduleTaskId: () => `schedule-task-${++task}`,
  };
  const passed: ContentReleasePreflightEvaluator = () => [
    { code: "calendar_algorithm", message: "当前发布检查通过。", status: "passed" },
  ];
  return {
    service: new ContentReleaseService(store, clock, identifiers, preflight ?? passed),
    setNow: (value: string) => {
      currentNow = value;
    },
    store,
  };
}

const common = {
  actorId: "admin-1",
  expectedActiveContentVersion: null,
  expectedLifecycleRevision: 3,
  reason: "生命周期操作已由维护者确认。",
  requestId: "release-request-1",
};

describe("ContentReleaseService", () => {
  it("atomically replaces the day schedule and fences the terminated task", async () => {
    const { service, store } = harness();
    store.seedProjection(projection({ scheduled: "content-old", scheduleSlotRevision: 1 }));
    store.seedVersion(version("content-old", "scheduled"));
    store.seedVersion(version("content-new", "approved"));
    await store.transaction((transaction) =>
      transaction.insertScheduleTask(pendingTask("schedule-task-old", "content-old", 1)),
    );

    const result = await service.schedule({
      ...common,
      contentVersion: "content-new",
      effectiveFrom,
      idempotencyKey: "schedule-replace-0001",
    });

    expect(result).toMatchObject({
      action: {
        lifecycleRevision: 4,
        state: "scheduled",
        transitions: [
          { contentVersion: "content-old", fromState: "scheduled", toState: "approved" },
          { contentVersion: "content-new", fromState: "approved", toState: "scheduled" },
        ],
      },
      kind: "applied",
    });
    await expect(store.readProjection(fortuneDate)).resolves.toMatchObject({
      scheduleSlotRevision: 2,
      scheduledContentVersion: "content-new",
    });
    await expect(store.readScheduleTask("schedule-task-old")).resolves.toMatchObject({
      status: "terminated",
    });
    await expect(store.readVersion("content-old")).resolves.toMatchObject({ state: "approved" });
    await expect(store.readVersion("content-new")).resolves.toMatchObject({ state: "scheduled" });
  });

  it("cancels the current schedule, advances both revisions and terminates its task", async () => {
    const { service, store } = harness();
    store.seedProjection(projection({ scheduled: "content-scheduled", scheduleSlotRevision: 1 }));
    store.seedVersion(version("content-scheduled", "scheduled"));
    await store.transaction((transaction) =>
      transaction.insertScheduleTask(pendingTask("schedule-task-cancel", "content-scheduled", 1)),
    );

    const result = await service.cancelSchedule({
      ...common,
      contentVersion: "content-scheduled",
      idempotencyKey: "schedule-cancel-0001",
    });

    expect(result).toMatchObject({
      action: {
        lifecycleRevision: 4,
        state: "approved",
        transitions: [
          { contentVersion: "content-scheduled", fromState: "scheduled", toState: "approved" },
        ],
      },
      kind: "applied",
    });
    await expect(store.readProjection(fortuneDate)).resolves.toMatchObject({
      lifecycleRevision: 4,
      scheduleSlotRevision: 2,
      scheduledContentVersion: null,
      scheduledEffectiveFrom: null,
    });
    await expect(store.readScheduleTask("schedule-task-cancel")).resolves.toMatchObject({
      status: "terminated",
    });
  });

  it("rejects stale lifecycle and active-version preconditions without partial release writes", async () => {
    const { service, store } = harness();
    store.seedProjection(projection({ active: "content-current", lifecycleRevision: 4 }));
    store.seedVersion(version("content-current", "published"));
    store.seedVersion(version("content-new", "approved"));

    await expect(
      service.publish({
        ...common,
        contentVersion: "content-new",
        idempotencyKey: "publish-stale-revision-0001",
      }),
    ).resolves.toEqual({ currentRevision: 4, kind: "revision_mismatch" });
    await expect(
      service.publish({
        ...common,
        contentVersion: "content-new",
        expectedLifecycleRevision: 4,
        idempotencyKey: "publish-stale-active-0001",
      }),
    ).resolves.toEqual({
      currentActiveContentVersion: "content-current",
      kind: "active_version_changed",
    });
    await expect(store.readVersion("content-new")).resolves.toMatchObject({ state: "approved" });
    await expect(store.listReleaseEvents(fortuneDate)).resolves.toHaveLength(0);
    await expect(store.listPublicCachePurgeIntents(fortuneDate)).resolves.toHaveLength(0);
  });

  it("publishes once, supersedes the old active version, purges aliases, and invalidates old poster work", async () => {
    const { service, store } = harness("2026-08-01T16:00:00.000Z");
    store.seedProjection(projection({ active: "content-current" }));
    store.seedVersion(version("content-current", "published"));
    store.seedVersion(version("content-new", "approved"));
    store.seedPosterJob({
      currentActiveContentVersion: "content-current",
      fortuneDate,
      jobId: "poster-old-processing",
      sourceContentVersion: "content-current",
      status: "processing",
    });
    const input = {
      ...common,
      contentVersion: "content-new",
      expectedActiveContentVersion: "content-current",
      idempotencyKey: "publish-content-0001",
    };

    const first = await service.publish(input);
    const replay = await service.publish({ ...input, requestId: "release-request-retry" });

    expect(first).toMatchObject({
      action: {
        activeContentVersion: "content-new",
        lifecycleRevision: 4,
        transitions: [
          { contentVersion: "content-current", fromState: "published", toState: "superseded" },
          { contentVersion: "content-new", fromState: "approved", toState: "published" },
        ],
      },
      kind: "applied",
    });
    expect(replay).toMatchObject({
      kind: "existing",
      action: (first as { action: unknown }).action,
    });
    await expect(store.readVersion("content-current")).resolves.toMatchObject({
      state: "superseded",
    });
    await expect(store.readVersion("content-new")).resolves.toMatchObject({ state: "published" });
    await expect(store.listPublicCachePurgeIntents(fortuneDate)).resolves.toHaveLength(1);
    await expect(store.readPosterVersionChangedCount()).resolves.toBe(1);
  });

  it("publishes an approved correction after the historical day window has ended", async () => {
    const { service, store } = harness("2026-08-03T16:00:00.000Z");
    store.seedProjection(projection({ active: "content-current" }));
    store.seedVersion(version("content-current", "published"));
    store.seedVersion(version("content-correction", "approved"));

    await expect(
      service.publish({
        ...common,
        contentVersion: "content-correction",
        expectedActiveContentVersion: "content-current",
        idempotencyKey: "publish-historical-correction-0001",
      }),
    ).resolves.toMatchObject({
      action: { activeContentVersion: "content-correction", state: "published" },
      kind: "applied",
    });
    await expect(store.readVersion("content-current")).resolves.toMatchObject({
      state: "superseded",
    });
    await expect(store.readVersion("content-correction")).resolves.toMatchObject({
      state: "published",
    });
  });

  it("keeps an unsafe version approved when the current release preflight fails", async () => {
    const failed: ContentReleasePreflightEvaluator = () => [
      { code: "required_images", message: "必备图片当前不可交付。", status: "failed" },
    ];
    const { service, store } = harness("2026-08-01T16:00:00.000Z", failed);
    store.seedProjection(projection());
    store.seedVersion(version("content-unsafe", "approved"));

    await expect(
      service.publish({
        ...common,
        contentVersion: "content-unsafe",
        idempotencyKey: "publish-unsafe-0001",
      }),
    ).resolves.toMatchObject({
      kind: "preflight_failed",
      preflightChecks: [{ code: "required_images", status: "failed" }],
    });
    await expect(store.readVersion("content-unsafe")).resolves.toMatchObject({ state: "approved" });
    await expect(store.listReleaseEvents(fortuneDate)).resolves.toHaveLength(0);
  });

  it("publishes a valid schedule task exactly once without drifting the active version", async () => {
    const { service, setNow, store } = harness();
    store.seedProjection(projection());
    store.seedVersion(version("content-scheduled", "approved"));
    const scheduled = await service.schedule({
      ...common,
      contentVersion: "content-scheduled",
      effectiveFrom,
      idempotencyKey: "schedule-worker-0001",
    });
    expect(scheduled.kind).toBe("applied");

    setNow("2026-08-01T15:00:00.000Z");
    const task = await store.claimNextScheduleTask({
      attemptToken: "attempt-worker-1",
      claimedAt: "2026-08-01T15:00:00.000Z",
      leaseExpiresAt: "2026-08-01T15:05:00.000Z",
      workerId: "worker-1",
    });
    expect(task).not.toBeNull();
    const first = await service.publishScheduledTask({
      attemptToken: "attempt-worker-1",
      taskId: task!.taskId,
      workerId: "worker-1",
    });
    const replay = await service.publishScheduledTask({
      attemptToken: "attempt-worker-1",
      taskId: task!.taskId,
      workerId: "worker-1",
    });

    expect(first).toMatchObject({ kind: "published", action: { lifecycleRevision: 5 } });
    expect(replay).toEqual({ kind: "lost" });
    await expect(store.readProjection(fortuneDate)).resolves.toMatchObject({
      activeContentVersion: "content-scheduled",
      lifecycleRevision: 5,
      scheduledContentVersion: null,
    });
    await expect(store.readScheduleTask(task!.taskId)).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("publishes an overdue schedule task once after the historical day window has ended", async () => {
    const { service, setNow, store } = harness();
    store.seedProjection(projection());
    store.seedVersion(version("content-overdue", "approved"));
    await service.schedule({
      ...common,
      contentVersion: "content-overdue",
      effectiveFrom,
      idempotencyKey: "schedule-overdue-0001",
    });

    setNow("2026-08-03T16:00:00.000Z");
    const task = await store.claimNextScheduleTask({
      attemptToken: "attempt-overdue-1",
      claimedAt: "2026-08-03T16:00:00.000Z",
      leaseExpiresAt: "2026-08-03T16:05:00.000Z",
      workerId: "worker-overdue",
    });
    expect(task).not.toBeNull();

    const first = await service.publishScheduledTask({
      attemptToken: "attempt-overdue-1",
      taskId: task!.taskId,
      workerId: "worker-overdue",
    });
    const replay = await service.publishScheduledTask({
      attemptToken: "attempt-overdue-1",
      taskId: task!.taskId,
      workerId: "worker-overdue",
    });

    expect(first).toMatchObject({ kind: "published" });
    expect(replay).toEqual({ kind: "lost" });
    await expect(store.readProjection(fortuneDate)).resolves.toMatchObject({
      activeContentVersion: "content-overdue",
      scheduledContentVersion: null,
    });
    await expect(store.readScheduleTask(task!.taskId)).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("withdraws and rolls back a safe superseded version after the historical window", async () => {
    const { service, store } = harness("2026-08-03T16:00:00.000Z");
    store.seedProjection(projection({ active: "content-current" }));
    store.seedVersion(version("content-current", "published"));
    store.seedVersion(version("content-safe", "superseded"));

    const withdrawn = await service.withdraw({
      ...common,
      contentVersion: "content-current",
      expectedActiveContentVersion: "content-current",
      idempotencyKey: "withdraw-current-0001",
      replacementContentVersion: null,
    });
    expect(withdrawn).toMatchObject({
      action: { activeContentVersion: null, state: "withdrawn" },
      kind: "applied",
    });

    const rolledBack = await service.rollback({
      ...common,
      expectedActiveContentVersion: null,
      expectedLifecycleRevision: 4,
      fortuneDate,
      idempotencyKey: "rollback-content-0001",
      targetContentVersion: "content-safe",
    });
    expect(rolledBack).toMatchObject({
      action: {
        activeContentVersion: "content-safe",
        state: "published",
        transitions: [
          { contentVersion: "content-safe", fromState: "superseded", toState: "published" },
        ],
      },
      kind: "applied",
    });
    await expect(store.readVersion("content-current")).resolves.toMatchObject({
      state: "withdrawn",
    });
    await expect(store.readVersion("content-safe")).resolves.toMatchObject({ state: "published" });
    await expect(store.listPublicCachePurgeIntents(fortuneDate)).resolves.toHaveLength(2);
  });

  it("withdraws into a safe historical replacement atomically and never reactivates a withdrawn target", async () => {
    const { service, store } = harness("2026-08-03T16:00:00.000Z");
    store.seedProjection(projection({ active: "content-current" }));
    store.seedVersion(version("content-current", "published"));
    store.seedVersion(version("content-safe", "superseded"));

    const result = await service.withdraw({
      ...common,
      contentVersion: "content-current",
      expectedActiveContentVersion: "content-current",
      idempotencyKey: "withdraw-replace-0001",
      replacementContentVersion: "content-safe",
    });

    expect(result).toMatchObject({
      action: {
        activeContentVersion: "content-safe",
        state: "withdrawn",
        transitions: [
          { contentVersion: "content-current", fromState: "published", toState: "withdrawn" },
          { contentVersion: "content-safe", fromState: "superseded", toState: "published" },
        ],
      },
      kind: "applied",
    });
    await expect(store.readVersion("content-current")).resolves.toMatchObject({
      state: "withdrawn",
    });
    await expect(store.readVersion("content-safe")).resolves.toMatchObject({ state: "published" });
    await expect(
      service.rollback({
        ...common,
        expectedActiveContentVersion: "content-safe",
        expectedLifecycleRevision: 4,
        fortuneDate,
        idempotencyKey: "rollback-withdrawn-0001",
        targetContentVersion: "content-current",
      }),
    ).resolves.toEqual({ kind: "version_withdrawn" });
  });

  it("does not withdraw the active version when its proposed replacement lacks the immutable day window", async () => {
    const { service, store } = harness("2026-08-01T16:00:00.000Z");
    store.seedProjection(projection({ active: "content-current" }));
    store.seedVersion(version("content-current", "published"));
    store.seedVersion({
      ...version("content-legacy", "superseded"),
      effectiveFrom: null,
      effectiveTo: null,
    });

    await expect(
      service.withdraw({
        ...common,
        contentVersion: "content-current",
        expectedActiveContentVersion: "content-current",
        idempotencyKey: "withdraw-invalid-window-0001",
        replacementContentVersion: "content-legacy",
      }),
    ).resolves.toEqual({ kind: "schedule_time_invalid" });
    await expect(store.readVersion("content-current")).resolves.toMatchObject({
      state: "published",
    });
    await expect(store.readVersion("content-legacy")).resolves.toMatchObject({
      state: "superseded",
    });
  });
});
