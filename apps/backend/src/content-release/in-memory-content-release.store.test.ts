import { describe, expect, it } from "vitest";

import type {
  StoredAuditEvent,
  StoredContentVersion,
} from "../content-lifecycle/content-lifecycle.store";
import type {
  StoredContentReleaseEvent,
  StoredContentScheduleTask,
  StoredPublicCachePurgeIntent,
} from "./content-release.store";
import { InMemoryContentReleaseStore } from "./in-memory-content-release.store";

const approvedVersion: StoredContentVersion = {
  contentVersion: "content-release-v1",
  createdAt: "2026-08-01T02:00:00.000Z",
  draftId: "draft-release-v1",
  effectiveFrom: "2026-08-01T15:00:00.000Z",
  effectiveTo: "2026-08-02T15:00:00.000Z",
  fortuneDate: "2026-08-02",
  preflightChecks: [],
  snapshot: {
    calendar_algorithm: null,
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  },
  state: "approved",
};

const pendingTask: StoredContentScheduleTask = {
  attemptToken: null,
  attempts: 0,
  availableAt: "2026-08-01T14:59:00.000Z",
  claimedAt: null,
  completedAt: null,
  contentVersion: approvedVersion.contentVersion,
  createdAt: "2026-08-01T12:00:00.000Z",
  effectiveFrom: "2026-08-01T15:00:00.000Z",
  fortuneDate: approvedVersion.fortuneDate,
  lastError: null,
  leaseExpiresAt: null,
  scheduleSlotRevision: 1,
  status: "pending",
  taskId: "schedule-task-v1",
  terminatedAt: null,
  terminationReason: null,
  updatedAt: "2026-08-01T12:00:00.000Z",
  workerId: null,
};

const releaseEvent: StoredContentReleaseEvent = {
  action: "publish",
  actorId: "operator-release",
  afterActiveContentVersion: approvedVersion.contentVersion,
  afterScheduleSlotRevision: 1,
  beforeActiveContentVersion: "content-release-old",
  beforeScheduleSlotRevision: 1,
  contentVersion: approvedVersion.contentVersion,
  fortuneDate: approvedVersion.fortuneDate,
  idempotencyKey: "release-idempotency-0001",
  occurredAt: "2026-08-01T15:00:00.000Z",
  reason: "立即发布已批准版本。",
  releaseEventId: "release-event-v1",
  requestId: "request-release-v1",
  scheduleTaskId: null,
  transitions: [
    {
      contentVersion: approvedVersion.contentVersion,
      fromState: "approved",
      toState: "published",
    },
  ],
};

const purgeIntent = {
  action: "publish",
  afterActiveContentVersion: approvedVersion.contentVersion,
  attemptToken: null,
  attempts: 0,
  availableAt: releaseEvent.occurredAt,
  beforeActiveContentVersion: "content-release-old",
  claimedAt: null,
  createdAt: releaseEvent.occurredAt,
  fortuneDate: approvedVersion.fortuneDate,
  lastError: null,
  leaseExpiresAt: null,
  processedAt: null,
  purgeIntentId: "public-purge-v1",
  requestId: releaseEvent.requestId,
  status: "pending",
  workerId: null,
} satisfies StoredPublicCachePurgeIntent;

const auditEvent: StoredAuditEvent = {
  action: "content_published",
  actorId: releaseEvent.actorId,
  auditEventId: "audit-release-v1",
  contentVersion: approvedVersion.contentVersion,
  fortuneDate: approvedVersion.fortuneDate,
  fromState: "approved",
  idempotencyKey: releaseEvent.idempotencyKey!,
  occurredAt: releaseEvent.occurredAt,
  reason: releaseEvent.reason,
  requestId: releaseEvent.requestId,
  toState: "published",
};

describe("InMemoryContentReleaseStore", () => {
  it("commits a version and its day projection as one observable transaction", async () => {
    const store = new InMemoryContentReleaseStore();
    store.seedProjection({
      activeContentVersion: null,
      fortuneDate: "2026-08-02",
      lifecycleRevision: 3,
      scheduleSlotRevision: 0,
      scheduledContentVersion: null,
      scheduledEffectiveFrom: null,
    });
    store.seedVersion(approvedVersion);

    await store.transaction(async (transaction) => {
      const projection = await transaction.getProjectionForUpdate("2026-08-02");
      expect(projection?.lifecycleRevision).toBe(3);
      await transaction.updateVersion({
        contentVersion: approvedVersion.contentVersion,
        expectedState: "approved",
        state: "published",
      });
      await transaction.updateProjection({
        expectedLifecycleRevision: 3,
        expectedScheduleSlotRevision: 0,
        projection: {
          ...projection!,
          activeContentVersion: approvedVersion.contentVersion,
          lifecycleRevision: 4,
        },
      });
    });

    await expect(store.readProjection("2026-08-02")).resolves.toEqual({
      activeContentVersion: approvedVersion.contentVersion,
      fortuneDate: "2026-08-02",
      lifecycleRevision: 4,
      scheduleSlotRevision: 0,
      scheduledContentVersion: null,
      scheduledEffectiveFrom: null,
    });
    await expect(store.readVersion(approvedVersion.contentVersion)).resolves.toMatchObject({
      effectiveFrom: "2026-08-01T15:00:00.000Z",
      effectiveTo: "2026-08-02T15:00:00.000Z",
      state: "published",
    });
  });

  it("fences a claimed schedule task across retry and completion", async () => {
    const store = new InMemoryContentReleaseStore();
    store.seedProjection({
      activeContentVersion: null,
      fortuneDate: pendingTask.fortuneDate,
      lifecycleRevision: 3,
      scheduleSlotRevision: 1,
      scheduledContentVersion: pendingTask.contentVersion,
      scheduledEffectiveFrom: pendingTask.effectiveFrom,
    });
    await store.transaction((transaction) => transaction.insertScheduleTask(pendingTask));

    const firstClaim = await store.claimNextScheduleTask({
      attemptToken: "attempt-first",
      claimedAt: "2026-08-01T14:59:30.000Z",
      leaseExpiresAt: "2026-08-01T15:00:00.000Z",
      workerId: "worker-a",
    });
    expect(firstClaim).toMatchObject({ attempts: 1, status: "processing" });

    await expect(
      store.recordScheduleTaskFailure({
        attemptToken: "attempt-first",
        auditEventId: "audit-schedule-failure-v1",
        auditIdempotencyKey: "scheduled-failure:attempt-first",
        error: "temporary database failover",
        failedAt: "2026-08-01T14:59:40.000Z",
        releaseEventId: "release-schedule-failure-v1",
        retryAt: "2026-08-01T15:00:10.000Z",
        taskId: pendingTask.taskId,
        workerId: "worker-a",
      }),
    ).resolves.toMatchObject({ status: "retrying" });
    await expect(
      store.claimNextScheduleTask({
        attemptToken: "attempt-too-early",
        claimedAt: "2026-08-01T15:00:09.000Z",
        leaseExpiresAt: "2026-08-01T15:01:00.000Z",
        workerId: "worker-b",
      }),
    ).resolves.toBeNull();

    const secondClaim = await store.claimNextScheduleTask({
      attemptToken: "attempt-second",
      claimedAt: "2026-08-01T15:00:10.000Z",
      leaseExpiresAt: "2026-08-01T15:01:10.000Z",
      workerId: "worker-b",
    });
    expect(secondClaim).toMatchObject({ attempts: 2, status: "processing" });
    await store.transaction(async (transaction) => {
      await expect(
        transaction.completeScheduleTask({
          attemptToken: "stale-attempt",
          completedAt: "2026-08-01T15:00:11.000Z",
          taskId: pendingTask.taskId,
          workerId: "worker-a",
        }),
      ).resolves.toBeNull();
      await expect(
        transaction.completeScheduleTask({
          attemptToken: "attempt-second",
          completedAt: "2026-08-01T15:00:11.000Z",
          taskId: pendingTask.taskId,
          workerId: "worker-b",
        }),
      ).resolves.toMatchObject({ status: "completed" });
    });

    await expect(store.listScheduleTaskEvents(pendingTask.taskId)).resolves.toMatchObject([
      { action: "created", status: "pending" },
      { action: "claimed", status: "processing" },
      { action: "retry_scheduled", status: "retrying" },
      { action: "claimed", status: "processing" },
      { action: "completed", status: "completed" },
    ]);
    await expect(store.listReleaseEvents(pendingTask.fortuneDate)).resolves.toMatchObject([
      { action: "scheduled_publish_failed", releaseEventId: "release-schedule-failure-v1" },
    ]);
  });

  it("fences public cache purge claims across retry and completion", async () => {
    const store = new InMemoryContentReleaseStore();
    await store.transaction((transaction) => transaction.insertPublicCachePurgeIntent(purgeIntent));

    await expect(
      store.claimNextPublicCachePurgeIntent({
        attemptToken: "purge-attempt-first",
        claimedAt: "2026-08-01T15:00:00.000Z",
        leaseExpiresAt: "2026-08-01T15:00:30.000Z",
        workerId: "purge-worker-a",
      }),
    ).resolves.toMatchObject({ attempts: 1, status: "processing" });
    await expect(
      store.completePublicCachePurgeIntent({
        attemptToken: "stale-attempt",
        completedAt: "2026-08-01T15:00:01.000Z",
        purgeIntentId: purgeIntent.purgeIntentId,
        workerId: "purge-worker-a",
      }),
    ).resolves.toBeNull();
    await expect(
      store.recordPublicCachePurgeFailure({
        attemptToken: "purge-attempt-first",
        error: "cache provider unavailable",
        failedAt: "2026-08-01T15:00:02.000Z",
        purgeIntentId: purgeIntent.purgeIntentId,
        retryAt: "2026-08-01T15:00:10.000Z",
        workerId: "purge-worker-a",
      }),
    ).resolves.toMatchObject({
      availableAt: "2026-08-01T15:00:10.000Z",
      lastError: "cache provider unavailable",
      status: "pending",
    });
    await expect(
      store.claimNextPublicCachePurgeIntent({
        attemptToken: "purge-attempt-too-early",
        claimedAt: "2026-08-01T15:00:09.000Z",
        leaseExpiresAt: "2026-08-01T15:00:30.000Z",
        workerId: "purge-worker-b",
      }),
    ).resolves.toBeNull();

    await expect(
      store.claimNextPublicCachePurgeIntent({
        attemptToken: "purge-attempt-second",
        claimedAt: "2026-08-01T15:00:10.000Z",
        leaseExpiresAt: "2026-08-01T15:01:10.000Z",
        workerId: "purge-worker-b",
      }),
    ).resolves.toMatchObject({ attempts: 2, status: "processing" });
    await expect(
      store.completePublicCachePurgeIntent({
        attemptToken: "purge-attempt-first",
        completedAt: "2026-08-01T15:00:11.000Z",
        purgeIntentId: purgeIntent.purgeIntentId,
        workerId: "purge-worker-a",
      }),
    ).resolves.toBeNull();
    await expect(
      store.completePublicCachePurgeIntent({
        attemptToken: "purge-attempt-second",
        completedAt: "2026-08-01T15:00:11.000Z",
        purgeIntentId: purgeIntent.purgeIntentId,
        workerId: "purge-worker-b",
      }),
    ).resolves.toMatchObject({
      attemptToken: null,
      processedAt: "2026-08-01T15:00:11.000Z",
      status: "completed",
      workerId: null,
    });
  });

  it("commits release history, idempotency, purge, task termination, poster invalidation, and audit together", async () => {
    const store = new InMemoryContentReleaseStore();
    store.seedPosterJob({
      currentActiveContentVersion: "content-release-old",
      fortuneDate: approvedVersion.fortuneDate,
      jobId: "poster-old-processing",
      sourceContentVersion: "content-release-old",
      status: "processing",
    });
    store.seedPosterJob({
      currentActiveContentVersion: "content-release-old",
      fortuneDate: approvedVersion.fortuneDate,
      jobId: "poster-new-processing",
      sourceContentVersion: approvedVersion.contentVersion,
      status: "processing",
    });
    store.seedPosterJob({
      currentActiveContentVersion: "content-release-old",
      fortuneDate: approvedVersion.fortuneDate,
      jobId: "poster-old-ready",
      sourceContentVersion: "content-release-old",
      status: "ready",
    });
    await store.transaction((transaction) => transaction.insertScheduleTask(pendingTask));

    await store.transaction(async (transaction) => {
      await transaction.lockIdempotency(
        "publish",
        approvedVersion.contentVersion,
        releaseEvent.idempotencyKey!,
      );
      expect(
        await transaction.findIdempotency(
          "publish",
          approvedVersion.contentVersion,
          releaseEvent.idempotencyKey!,
        ),
      ).toBeNull();
      await transaction.insertIdempotency({
        idempotencyKey: releaseEvent.idempotencyKey!,
        operation: "publish",
        requestHash: "a".repeat(64),
        resourceId: approvedVersion.contentVersion,
        response: { lifecycleRevision: 4 },
      });
      await transaction.insertReleaseEvent(releaseEvent);
      await transaction.insertPublicCachePurgeIntent(purgeIntent);
      await transaction.insertAuditEvent(auditEvent);
      await transaction.terminateOpenScheduleTasks({
        exceptTaskId: null,
        fortuneDate: approvedVersion.fortuneDate,
        reason: "立即发布使旧排期失效。",
        terminatedAt: releaseEvent.occurredAt,
      });
      expect(
        await transaction.markProcessingPosterJobsVersionChanged({
          changedAt: releaseEvent.occurredAt,
          currentActiveContentVersion: approvedVersion.contentVersion,
          fortuneDate: approvedVersion.fortuneDate,
        }),
      ).toBe(1);
    });

    await expect(store.listReleaseEvents(approvedVersion.fortuneDate)).resolves.toEqual([
      releaseEvent,
    ]);
    await expect(store.listPublicCachePurgeIntents(approvedVersion.fortuneDate)).resolves.toEqual([
      purgeIntent,
    ]);
    await expect(store.readScheduleTask(pendingTask.taskId)).resolves.toMatchObject({
      status: "terminated",
      terminationReason: "立即发布使旧排期失效。",
    });
    await expect(store.readPosterVersionChangedCount()).resolves.toBe(1);
    await expect(store.readAuditEventsForTest()).resolves.toEqual([auditEvent]);
    await expect(
      store.transaction((transaction) =>
        transaction.findIdempotency(
          "publish",
          approvedVersion.contentVersion,
          releaseEvent.idempotencyKey!,
        ),
      ),
    ).resolves.toMatchObject({ response: { lifecycleRevision: 4 } });
  });
});
