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
const effectiveFrom = "2026-08-01T18:00:00+08:00";

function version(
  contentVersion: string,
  state: StoredContentVersion["state"],
): StoredContentVersion {
  return {
    contentVersion,
    createdAt: "2026-08-01T02:00:00.000Z",
    draftId: `draft-${contentVersion}`,
    effectiveFrom,
    effectiveTo: "2026-08-02T18:00:00+08:00",
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

function harness(now = "2026-08-01T09:00:00.000Z", preflight?: ContentReleasePreflightEvaluator) {
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

  it("publishes at effectiveTo minus one millisecond, supersedes the old active version, purges aliases, and invalidates old poster work", async () => {
    const { service, store } = harness("2026-08-02T09:59:59.999Z");
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

  it("rejects a direct publish exactly at effectiveTo without changing either version", async () => {
    const { service, store } = harness("2026-08-02T10:00:00.000Z");
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
    ).resolves.toEqual({ kind: "schedule_time_invalid" });
    await expect(store.readVersion("content-current")).resolves.toMatchObject({
      state: "published",
    });
    await expect(store.readVersion("content-correction")).resolves.toMatchObject({
      state: "approved",
    });
    await expect(store.listReleaseEvents(fortuneDate)).resolves.toHaveLength(0);
  });

  it("publishes first while retaining failed preflight information for post-publication review", async () => {
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
    ).resolves.toMatchObject({ action: { state: "published" }, kind: "applied" });
    await expect(store.readVersion("content-unsafe")).resolves.toMatchObject({
      state: "published",
    });
    await expect(store.listReleaseEvents(fortuneDate)).resolves.toHaveLength(1);
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

    setNow("2026-08-02T09:59:59.999Z");
    const task = await store.claimNextScheduleTask({
      attemptToken: "attempt-worker-1",
      claimedAt: "2026-08-02T09:59:59.999Z",
      leaseExpiresAt: "2026-08-02T10:04:59.999Z",
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

  it("atomically cancels a scheduled publish exactly at effectiveTo", async () => {
    const { service, setNow, store } = harness();
    store.seedProjection(projection());
    store.seedVersion(version("content-overdue", "approved"));
    await service.schedule({
      ...common,
      contentVersion: "content-overdue",
      effectiveFrom,
      idempotencyKey: "schedule-overdue-0001",
    });

    setNow("2026-08-02T10:00:00.000Z");
    const task = await store.claimNextScheduleTask({
      attemptToken: "attempt-overdue-1",
      claimedAt: "2026-08-02T10:00:00.000Z",
      leaseExpiresAt: "2026-08-02T10:05:00.000Z",
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

    expect(first).toMatchObject({
      action: {
        lifecycleRevision: 5,
        state: "approved",
        transitions: [
          { contentVersion: "content-overdue", fromState: "scheduled", toState: "approved" },
        ],
      },
      kind: "terminated",
    });
    expect(replay).toEqual({ kind: "lost" });
    await expect(store.readProjection(fortuneDate)).resolves.toMatchObject({
      activeContentVersion: null,
      lifecycleRevision: 5,
      scheduleSlotRevision: 2,
      scheduledContentVersion: null,
      scheduledEffectiveFrom: null,
    });
    await expect(store.readScheduleTask(task!.taskId)).resolves.toMatchObject({
      status: "terminated",
      terminationReason: "排期任务已到达或越过内容有效期，排期已自动取消。",
    });
    await expect(store.readVersion("content-overdue")).resolves.toMatchObject({
      state: "approved",
    });
    expect((await store.listReleaseEvents(fortuneDate)).at(-1)).toMatchObject({
      action: "cancel_schedule",
      actorId: "system:scheduled-release-worker",
      scheduleTaskId: task!.taskId,
      transitions: [
        { contentVersion: "content-overdue", fromState: "scheduled", toState: "approved" },
      ],
    });
  });

  it("atomically cancels a current task whose release time disagrees with the fixed day window", async () => {
    const { service, store } = harness("2026-08-01T10:00:00.000Z");
    store.seedProjection(projection({ scheduled: "content-mismatched", scheduleSlotRevision: 1 }));
    store.seedVersion(version("content-mismatched", "scheduled"));
    await store.transaction((transaction) =>
      transaction.insertScheduleTask({
        ...pendingTask("schedule-task-mismatched", "content-mismatched", 1),
        effectiveFrom: "2026-08-01T19:00:00+08:00",
      }),
    );
    const task = await store.claimNextScheduleTask({
      attemptToken: "attempt-mismatched",
      claimedAt: "2026-08-01T10:00:00.000Z",
      leaseExpiresAt: "2026-08-01T10:05:00.000Z",
      workerId: "worker-mismatched",
    });
    expect(task).not.toBeNull();

    await expect(
      service.publishScheduledTask({
        attemptToken: "attempt-mismatched",
        taskId: task!.taskId,
        workerId: "worker-mismatched",
      }),
    ).resolves.toMatchObject({
      action: {
        state: "approved",
        transitions: [
          { contentVersion: "content-mismatched", fromState: "scheduled", toState: "approved" },
        ],
      },
      kind: "terminated",
    });
    await expect(store.readProjection(fortuneDate)).resolves.toMatchObject({
      scheduleSlotRevision: 2,
      scheduledContentVersion: null,
      scheduledEffectiveFrom: null,
    });
    await expect(store.readScheduleTask(task!.taskId)).resolves.toMatchObject({
      status: "terminated",
      terminationReason: "排期任务与内容固定有效窗口不一致，排期已自动取消。",
    });
    await expect(store.readVersion("content-mismatched")).resolves.toMatchObject({
      state: "approved",
    });
  });

  it("atomically cancels a current schedule whose task fence disagrees with its slot", async () => {
    const { service, store } = harness("2026-08-01T10:00:00.000Z");
    store.seedProjection(projection({ scheduled: "content-fence", scheduleSlotRevision: 2 }));
    store.seedVersion(version("content-fence", "scheduled"));
    await store.transaction((transaction) =>
      transaction.insertScheduleTask(pendingTask("schedule-task-fence", "content-fence", 1)),
    );
    const task = await store.claimNextScheduleTask({
      attemptToken: "attempt-fence",
      claimedAt: "2026-08-01T10:00:00.000Z",
      leaseExpiresAt: "2026-08-01T10:05:00.000Z",
      workerId: "worker-fence",
    });
    expect(task).not.toBeNull();

    await expect(
      service.publishScheduledTask({
        attemptToken: "attempt-fence",
        taskId: task!.taskId,
        workerId: "worker-fence",
      }),
    ).resolves.toMatchObject({
      action: {
        state: "approved",
        transitions: [
          { contentVersion: "content-fence", fromState: "scheduled", toState: "approved" },
        ],
      },
      kind: "terminated",
    });
    await expect(store.readProjection(fortuneDate)).resolves.toMatchObject({
      lifecycleRevision: 4,
      scheduleSlotRevision: 3,
      scheduledContentVersion: null,
    });
    await expect(store.readScheduleTask(task!.taskId)).resolves.toMatchObject({
      status: "terminated",
      terminationReason: "排期任务与当前排期槽修订不一致，排期已自动取消。",
    });
    await expect(store.readVersion("content-fence")).resolves.toMatchObject({ state: "approved" });
  });

  it("terminates a stale task for a replaced slot and restores only its orphaned version", async () => {
    const { service, store } = harness("2026-08-01T10:00:00.000Z");
    store.seedProjection(
      projection({ scheduled: "content-current-slot", scheduleSlotRevision: 2 }),
    );
    store.seedVersion(version("content-current-slot", "scheduled"));
    store.seedVersion(version("content-orphaned-slot", "scheduled"));
    await store.transaction((transaction) =>
      transaction.insertScheduleTask(
        pendingTask("schedule-task-orphaned", "content-orphaned-slot", 1),
      ),
    );
    const task = await store.claimNextScheduleTask({
      attemptToken: "attempt-orphaned",
      claimedAt: "2026-08-01T10:00:00.000Z",
      leaseExpiresAt: "2026-08-01T10:05:00.000Z",
      workerId: "worker-orphaned",
    });
    expect(task).not.toBeNull();

    await expect(
      service.publishScheduledTask({
        attemptToken: "attempt-orphaned",
        taskId: task!.taskId,
        workerId: "worker-orphaned",
      }),
    ).resolves.toMatchObject({
      action: {
        state: "approved",
        transitions: [
          {
            contentVersion: "content-orphaned-slot",
            fromState: "scheduled",
            toState: "approved",
          },
        ],
      },
      kind: "terminated",
    });
    await expect(store.readProjection(fortuneDate)).resolves.toMatchObject({
      lifecycleRevision: 4,
      scheduleSlotRevision: 2,
      scheduledContentVersion: "content-current-slot",
      scheduledEffectiveFrom: effectiveFrom,
    });
    await expect(store.readScheduleTask(task!.taskId)).resolves.toMatchObject({
      status: "terminated",
      terminationReason: "排期任务已被当前排期槽替换，孤立任务已终止。",
    });
    await expect(store.readVersion("content-orphaned-slot")).resolves.toMatchObject({
      state: "approved",
    });
    await expect(store.readVersion("content-current-slot")).resolves.toMatchObject({
      state: "scheduled",
    });
  });

  it("terminates a claimed task when its day projection is missing", async () => {
    const { service, store } = harness("2026-08-01T10:00:00.000Z");
    await store.transaction((transaction) =>
      transaction.insertScheduleTask(
        pendingTask("schedule-task-missing-projection", "content-without-day", 1),
      ),
    );
    const task = await store.claimNextScheduleTask({
      attemptToken: "attempt-missing-projection",
      claimedAt: "2026-08-01T10:00:00.000Z",
      leaseExpiresAt: "2026-08-01T10:05:00.000Z",
      workerId: "worker-missing-projection",
    });
    expect(task).not.toBeNull();

    await expect(
      service.publishScheduledTask({
        attemptToken: "attempt-missing-projection",
        taskId: task!.taskId,
        workerId: "worker-missing-projection",
      }),
    ).resolves.toEqual({ kind: "stale" });
    await expect(store.readScheduleTask(task!.taskId)).resolves.toMatchObject({
      status: "terminated",
      terminationReason: "排期任务对应日期投影不存在，任务已终止。",
    });
    await expect(
      store.claimNextScheduleTask({
        attemptToken: "attempt-after-lease",
        claimedAt: "2026-08-01T10:05:00.001Z",
        leaseExpiresAt: "2026-08-01T10:10:00.001Z",
        workerId: "worker-after-lease",
      }),
    ).resolves.toBeNull();
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
