import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PostgresContentReleaseStore } from "./postgres-content-release.store";

const databaseUrl = process.env.FIVE_CONTENT_RELEASE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

function opaque(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function waitForLock(pool: Pool, applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT wait_event_type = 'Lock' AS waiting
         FROM pg_stat_activity
        WHERE application_name = $1`,
      [applicationName],
    );
    if (result.rows[0]?.waiting === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for PostgreSQL lock: ${applicationName}`);
}

async function seedVersion(
  pool: Pool,
  input: {
    readonly fortuneDate: string;
    readonly state: "approved" | "scheduled";
  },
): Promise<{ readonly contentVersion: string; readonly draftId: string }> {
  const draftId = opaque("release-draft");
  const contentVersion = opaque("release-content");
  const effectiveFrom = `${input.fortuneDate}T00:00:00.000Z`;
  const effectiveTo = `${input.fortuneDate}T01:00:00.000Z`;
  await pool.query(
    `INSERT INTO content_lifecycle_days (
       fortune_date, lifecycle_revision, active_content_version,
       schedule_slot_revision, scheduled_content_version, scheduled_effective_from
     ) VALUES ($1::date, 3, NULL, 0, NULL, NULL)`,
    [input.fortuneDate],
  );
  await pool.query(
    `INSERT INTO content_drafts (
       draft_id, fortune_date, draft_revision, modules, submitted_content_version,
       created_at, updated_at, submitted_at
     ) VALUES ($1, $2::date, 1, $3::jsonb, NULL, $4::timestamptz, $4::timestamptz, NULL)`,
    [draftId, input.fortuneDate, JSON.stringify({}), "2030-01-01T01:00:00.000Z"],
  );
  await pool.query(
    `INSERT INTO content_versions (
       content_version, draft_id, fortune_date, state, snapshot, preflight_checks,
       created_at, effective_from, effective_to
     ) VALUES (
       $1, $2, $3::date, $4, $5::jsonb, '[]'::jsonb,
       $6::timestamptz, $7::timestamptz, $8::timestamptz
     )`,
    [
      contentVersion,
      draftId,
      input.fortuneDate,
      input.state,
      JSON.stringify({}),
      "2030-01-01T01:00:00.000Z",
      effectiveFrom,
      effectiveTo,
    ],
  );
  return { contentVersion, draftId };
}

describeDatabase("PostgresContentReleaseStore", () => {
  let pool: Pool;
  let store: PostgresContentReleaseStore;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
    store = new PostgresContentReleaseStore(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE poster_jobs, content_drafts, content_lifecycle_days CASCADE");
  });

  it("commits a fenced version and day projection update through one transaction", async () => {
    const fortuneDate = "2030-01-02";
    const { contentVersion } = await seedVersion(pool, { fortuneDate, state: "approved" });

    await store.transaction(async (transaction) => {
      const projection = await transaction.getProjectionForUpdate(fortuneDate);
      expect(projection).toMatchObject({ lifecycleRevision: 3, scheduleSlotRevision: 0 });
      expect(
        await transaction.updateVersion({
          contentVersion,
          expectedState: "approved",
          state: "published",
        }),
      ).toBe(true);
      expect(
        await transaction.updateProjection({
          expectedLifecycleRevision: 3,
          expectedScheduleSlotRevision: 0,
          projection: {
            ...projection!,
            activeContentVersion: contentVersion,
            lifecycleRevision: 4,
          },
        }),
      ).toBe(true);
    });

    await expect(store.readProjection(fortuneDate)).resolves.toMatchObject({
      activeContentVersion: contentVersion,
      lifecycleRevision: 4,
      scheduleSlotRevision: 0,
    });
  });

  it("fences public cache purge claims across failure backoff and completion", async () => {
    const fortuneDate = "2030-01-03";
    const { contentVersion } = await seedVersion(pool, { fortuneDate, state: "approved" });
    const purgeIntentId = opaque("public-purge");
    await store.transaction((transaction) =>
      transaction.insertPublicCachePurgeIntent({
        action: "publish",
        afterActiveContentVersion: contentVersion,
        beforeActiveContentVersion: null,
        createdAt: "2030-01-02T15:00:00.000Z",
        fortuneDate,
        processedAt: null,
        purgeIntentId,
        requestId: opaque("request"),
      }),
    );

    await expect(
      store.claimNextPublicCachePurgeIntent({
        attemptToken: "purge-attempt-first",
        claimedAt: "2030-01-02T15:00:00.000Z",
        leaseExpiresAt: "2030-01-02T15:00:30.000Z",
        workerId: "purge-worker-a",
      }),
    ).resolves.toMatchObject({ attempts: 1, purgeIntentId, status: "processing" });
    await expect(
      store.completePublicCachePurgeIntent({
        attemptToken: "stale-attempt",
        completedAt: "2030-01-02T15:00:01.000Z",
        purgeIntentId,
        workerId: "purge-worker-a",
      }),
    ).resolves.toBeNull();
    await expect(
      store.recordPublicCachePurgeFailure({
        attemptToken: "purge-attempt-first",
        error: "cache provider unavailable",
        failedAt: "2030-01-02T15:00:02.000Z",
        purgeIntentId,
        retryAt: "2030-01-02T15:00:10.000Z",
        workerId: "purge-worker-a",
      }),
    ).resolves.toMatchObject({
      availableAt: "2030-01-02T15:00:10.000Z",
      lastError: "cache provider unavailable",
      status: "pending",
    });
    await expect(
      store.claimNextPublicCachePurgeIntent({
        attemptToken: "purge-too-early",
        claimedAt: "2030-01-02T15:00:09.000Z",
        leaseExpiresAt: "2030-01-02T15:00:30.000Z",
        workerId: "purge-worker-b",
      }),
    ).resolves.toBeNull();
    await expect(
      store.claimNextPublicCachePurgeIntent({
        attemptToken: "purge-attempt-second",
        claimedAt: "2030-01-02T15:00:10.000Z",
        leaseExpiresAt: "2030-01-02T15:01:10.000Z",
        workerId: "purge-worker-b",
      }),
    ).resolves.toMatchObject({ attempts: 2, status: "processing" });
    await expect(
      store.completePublicCachePurgeIntent({
        attemptToken: "purge-attempt-second",
        completedAt: "2030-01-02T15:00:11.000Z",
        purgeIntentId,
        workerId: "purge-worker-b",
      }),
    ).resolves.toMatchObject({
      processedAt: "2030-01-02T15:00:11.000Z",
      status: "completed",
    });
  });

  it("fences schedule task claims across failure backoff and completion", async () => {
    const fortuneDate = "2030-01-05";
    const { contentVersion } = await seedVersion(pool, { fortuneDate, state: "scheduled" });
    const taskId = opaque("schedule-task");
    await store.transaction((transaction) =>
      transaction.insertScheduleTask({
        attemptToken: null,
        attempts: 0,
        availableAt: "2030-01-04T14:59:00.000Z",
        claimedAt: null,
        completedAt: null,
        contentVersion,
        createdAt: "2030-01-04T12:00:00.000Z",
        effectiveFrom: "2030-01-04T15:00:00.000Z",
        fortuneDate,
        lastError: null,
        leaseExpiresAt: null,
        scheduleSlotRevision: 1,
        status: "pending",
        taskId,
        terminatedAt: null,
        terminationReason: null,
        updatedAt: "2030-01-04T12:00:00.000Z",
        workerId: null,
      }),
    );

    await expect(
      store.claimNextScheduleTask({
        attemptToken: "schedule-attempt-first",
        claimedAt: "2030-01-04T14:59:30.000Z",
        leaseExpiresAt: "2030-01-04T15:00:00.000Z",
        workerId: "schedule-worker-a",
      }),
    ).resolves.toMatchObject({ attempts: 1, status: "processing", taskId });
    await expect(
      store.recordScheduleTaskFailure({
        attemptToken: "stale-attempt",
        auditEventId: opaque("audit-stale-failure"),
        auditIdempotencyKey: opaque("stale-failure-idempotency"),
        error: "stale worker",
        failedAt: "2030-01-04T14:59:35.000Z",
        releaseEventId: opaque("release-stale-failure"),
        retryAt: "2030-01-04T15:00:10.000Z",
        taskId,
        workerId: "schedule-worker-a",
      }),
    ).resolves.toBeNull();
    await expect(
      store.recordScheduleTaskFailure({
        attemptToken: "schedule-attempt-first",
        auditEventId: "audit-schedule-failure-pg",
        auditIdempotencyKey: "scheduled-failure:pg-attempt-first",
        error: "temporary database failover",
        failedAt: "2030-01-04T14:59:40.000Z",
        releaseEventId: "release-schedule-failure-pg",
        retryAt: "2030-01-04T15:00:10.000Z",
        taskId,
        workerId: "schedule-worker-a",
      }),
    ).resolves.toMatchObject({ status: "retrying" });
    await expect(
      store.claimNextScheduleTask({
        attemptToken: "schedule-too-early",
        claimedAt: "2030-01-04T15:00:09.000Z",
        leaseExpiresAt: "2030-01-04T15:01:00.000Z",
        workerId: "schedule-worker-b",
      }),
    ).resolves.toBeNull();
    await expect(
      store.claimNextScheduleTask({
        attemptToken: "schedule-attempt-second",
        claimedAt: "2030-01-04T15:00:10.000Z",
        leaseExpiresAt: "2030-01-04T15:01:10.000Z",
        workerId: "schedule-worker-b",
      }),
    ).resolves.toMatchObject({ attempts: 2, status: "processing" });
    await store.transaction(async (transaction) => {
      await expect(
        transaction.completeScheduleTask({
          attemptToken: "schedule-attempt-first",
          completedAt: "2030-01-04T15:00:11.000Z",
          taskId,
          workerId: "schedule-worker-a",
        }),
      ).resolves.toBeNull();
      await expect(
        transaction.completeScheduleTask({
          attemptToken: "schedule-attempt-second",
          completedAt: "2030-01-04T15:00:11.000Z",
          taskId,
          workerId: "schedule-worker-b",
        }),
      ).resolves.toMatchObject({ status: "completed" });
    });
    await expect(store.listScheduleTaskEvents(taskId)).resolves.toMatchObject([
      { action: "created", status: "pending" },
      { action: "claimed", status: "processing" },
      { action: "retry_scheduled", status: "retrying" },
      { action: "claimed", status: "processing" },
      { action: "completed", status: "completed" },
    ]);
    await expect(store.listReleaseEvents(fortuneDate)).resolves.toMatchObject([
      {
        action: "scheduled_publish_failed",
        releaseEventId: "release-schedule-failure-pg",
        transitions: [
          {
            contentVersion,
            fromState: "scheduled",
            toState: "scheduled",
          },
        ],
      },
    ]);
    await expect(
      pool.query<{ action: string }>(
        "SELECT action FROM content_lifecycle_audit_events WHERE audit_event_id = $1",
        ["audit-schedule-failure-pg"],
      ),
    ).resolves.toMatchObject({ rows: [{ action: "content_scheduled_publish_failed" }] });
  });

  it("locks the day projection before a failed task when an admin action races it", async () => {
    const fortuneDate = "2030-01-07";
    const { contentVersion } = await seedVersion(pool, { fortuneDate, state: "scheduled" });
    const taskId = opaque("schedule-lock-order");
    await pool.query(
      `UPDATE content_lifecycle_days
          SET schedule_slot_revision = 1,
              scheduled_content_version = $1,
              scheduled_effective_from = '2030-01-06T15:00:00.000Z'::timestamptz
        WHERE fortune_date = $2::date`,
      [contentVersion, fortuneDate],
    );
    await store.transaction((transaction) =>
      transaction.insertScheduleTask({
        attemptToken: null,
        attempts: 0,
        availableAt: "2030-01-06T15:00:00.000Z",
        claimedAt: null,
        completedAt: null,
        contentVersion,
        createdAt: "2030-01-06T12:00:00.000Z",
        effectiveFrom: "2030-01-06T15:00:00.000Z",
        fortuneDate,
        lastError: null,
        leaseExpiresAt: null,
        scheduleSlotRevision: 1,
        status: "pending",
        taskId,
        terminatedAt: null,
        terminationReason: null,
        updatedAt: "2030-01-06T12:00:00.000Z",
        workerId: null,
      }),
    );
    await store.claimNextScheduleTask({
      attemptToken: "attempt-lock-order",
      claimedAt: "2030-01-06T15:00:00.000Z",
      leaseExpiresAt: "2030-01-06T15:05:00.000Z",
      workerId: "worker-lock-order",
    });

    const applicationName = "five-release-failure-lock-order";
    const failurePool = new Pool({
      application_name: applicationName,
      connectionString: databaseUrl,
      max: 1,
    });
    const failureStore = new PostgresContentReleaseStore(failurePool);
    const admin = await pool.connect();
    const probe = await pool.connect();
    let adminTransactionOpen = false;
    let failurePromise: Promise<unknown> | null = null;
    try {
      await admin.query("BEGIN");
      adminTransactionOpen = true;
      await admin.query(
        "SELECT fortune_date FROM content_lifecycle_days WHERE fortune_date = $1::date FOR UPDATE",
        [fortuneDate],
      );
      failurePromise = failureStore.recordScheduleTaskFailure({
        attemptToken: "attempt-lock-order",
        auditEventId: "audit-lock-order-failure",
        auditIdempotencyKey: "scheduled-failure:lock-order",
        error: "concurrent preflight failure",
        failedAt: "2030-01-06T15:00:01.000Z",
        releaseEventId: "release-lock-order-failure",
        retryAt: "2030-01-06T15:00:31.000Z",
        taskId,
        workerId: "worker-lock-order",
      });
      await waitForLock(pool, applicationName);

      await probe.query("BEGIN");
      await expect(
        probe.query(
          "SELECT task_id FROM content_schedule_tasks WHERE task_id = $1 FOR UPDATE NOWAIT",
          [taskId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
      await probe.query("ROLLBACK");

      await admin.query(
        `UPDATE content_schedule_tasks
            SET status = 'terminated',
                claimed_at = NULL,
                lease_expires_at = NULL,
                worker_id = NULL,
                attempt_token = NULL,
                updated_at = '2030-01-06T15:00:02.000Z'::timestamptz,
                terminated_at = '2030-01-06T15:00:02.000Z'::timestamptz,
                termination_reason = '管理员并发取消排期'
          WHERE task_id = $1`,
        [taskId],
      );
      await admin.query("COMMIT");
      adminTransactionOpen = false;
      await expect(failurePromise).resolves.toBeNull();
    } finally {
      await probe.query("ROLLBACK").catch(() => undefined);
      if (adminTransactionOpen) await admin.query("ROLLBACK").catch(() => undefined);
      await failurePromise?.catch(() => undefined);
      probe.release();
      admin.release();
      await failurePool.end();
    }
  });

  it("commits release history, cache purge, audit, task termination, and poster invalidation together", async () => {
    const fortuneDate = "2030-01-06";
    const { contentVersion } = await seedVersion(pool, { fortuneDate, state: "approved" });
    const taskId = opaque("schedule-task");
    const oldPosterJobId = opaque("poster-old");
    const currentPosterJobId = opaque("poster-current");
    const releaseEventId = opaque("release-event");
    const purgeIntentId = opaque("public-purge");
    const auditEventId = opaque("audit-release");
    const idempotencyKey = opaque("release-idempotency");
    const requestId = opaque("request-release");
    const occurredAt = "2030-01-05T15:00:00.000Z";
    await pool.query(
      `INSERT INTO poster_jobs (
         job_id, fortune_date, source_content_version, current_active_content_version,
         poster_template_version, channel_id, status, landing_url, created_at, updated_at
       ) VALUES
         ($1, $3::date, 'content-release-old', NULL, 'template-v1', 'channel-v1',
          'processing', 'https://example.test/old', $4::timestamptz, $4::timestamptz),
         ($2, $3::date, $5, NULL, 'template-v1', 'channel-v2',
          'processing', 'https://example.test/current', $4::timestamptz, $4::timestamptz)`,
      [oldPosterJobId, currentPosterJobId, fortuneDate, occurredAt, contentVersion],
    );
    await pool.query(
      `INSERT INTO poster_asset_reservations (
         asset_key, job_id, locked_by, attempt_token, created_at
       ) VALUES ($1, $2, 'poster-worker', 'poster-attempt', $3::timestamptz)`,
      ["poster/reserved-old.webp", oldPosterJobId, occurredAt],
    );
    await store.transaction((transaction) =>
      transaction.insertScheduleTask({
        attemptToken: null,
        attempts: 0,
        availableAt: occurredAt,
        claimedAt: null,
        completedAt: null,
        contentVersion,
        createdAt: occurredAt,
        effectiveFrom: "2030-01-05T16:00:00.000Z",
        fortuneDate,
        lastError: null,
        leaseExpiresAt: null,
        scheduleSlotRevision: 1,
        status: "pending",
        taskId,
        terminatedAt: null,
        terminationReason: null,
        updatedAt: occurredAt,
        workerId: null,
      }),
    );

    await store.transaction(async (transaction) => {
      await transaction.lockIdempotency("publish", contentVersion, idempotencyKey);
      await transaction.insertIdempotency({
        idempotencyKey,
        operation: "publish",
        requestHash: "a".repeat(64),
        resourceId: contentVersion,
        response: { lifecycleRevision: 4 },
      });
      await transaction.insertReleaseEvent({
        action: "publish",
        actorId: "operator-release",
        afterActiveContentVersion: contentVersion,
        afterScheduleSlotRevision: 0,
        beforeActiveContentVersion: null,
        beforeScheduleSlotRevision: 0,
        contentVersion,
        fortuneDate,
        idempotencyKey,
        occurredAt,
        reason: "立即发布已批准版本。",
        releaseEventId,
        requestId,
        scheduleTaskId: null,
        transitions: [{ contentVersion, fromState: "approved", toState: "published" }],
      });
      await transaction.insertPublicCachePurgeIntent({
        action: "publish",
        afterActiveContentVersion: contentVersion,
        beforeActiveContentVersion: null,
        createdAt: occurredAt,
        fortuneDate,
        processedAt: null,
        purgeIntentId,
        requestId,
      });
      await transaction.insertAuditEvent({
        action: "content_published",
        actorId: "operator-release",
        auditEventId,
        contentVersion,
        fortuneDate,
        fromState: "approved",
        idempotencyKey,
        occurredAt,
        reason: "立即发布已批准版本。",
        requestId,
        toState: "published",
      });
      await transaction.terminateOpenScheduleTasks({
        exceptTaskId: null,
        fortuneDate,
        reason: "立即发布使旧排期失效。",
        terminatedAt: occurredAt,
      });
      await expect(
        transaction.markProcessingPosterJobsVersionChanged({
          changedAt: occurredAt,
          currentActiveContentVersion: contentVersion,
          fortuneDate,
        }),
      ).resolves.toBe(1);
    });

    await expect(store.listReleaseEvents(fortuneDate)).resolves.toMatchObject([
      { action: "publish", releaseEventId },
    ]);
    await expect(store.listPublicCachePurgeIntents(fortuneDate)).resolves.toMatchObject([
      { attempts: 0, purgeIntentId, status: "pending" },
    ]);
    await expect(store.readScheduleTask(taskId)).resolves.toMatchObject({ status: "terminated" });
    await expect(
      pool.query(
        `SELECT job_id, current_active_content_version, status
           FROM poster_jobs
          ORDER BY job_id`,
      ),
    ).resolves.toMatchObject({
      rows: expect.arrayContaining([
        {
          current_active_content_version: contentVersion,
          job_id: oldPosterJobId,
          status: "version_changed",
        },
        {
          current_active_content_version: null,
          job_id: currentPosterJobId,
          status: "processing",
        },
      ]),
    });
    await expect(
      pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM poster_asset_reservations WHERE job_id = $1",
        [oldPosterJobId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: "0" }] });
    await expect(
      pool.query(
        "UPDATE content_release_events SET reason = 'tampered' WHERE release_event_id = $1",
        [releaseEventId],
      ),
    ).rejects.toThrow(/append-only/u);
    await expect(
      pool.query("UPDATE content_schedule_task_events SET reason = 'tampered' WHERE task_id = $1", [
        taskId,
      ]),
    ).rejects.toThrow(/append-only/u);
    await expect(
      pool.query(
        "UPDATE content_schedule_tasks SET effective_from = effective_from + interval '1 second' WHERE task_id = $1",
        [taskId],
      ),
    ).rejects.toThrow(/identity is immutable/u);
  });

  it("serializes poster completion behind release invalidation", async () => {
    const fortuneDate = "2030-01-07";
    const { contentVersion } = await seedVersion(pool, { fortuneDate, state: "approved" });
    const jobId = opaque("poster-race");
    const workerId = "poster-worker-race";
    const attemptToken = "poster-attempt-race";
    const workerApplication = opaque("poster-completion-worker");
    const workerPool = new Pool({
      application_name: workerApplication,
      connectionString: databaseUrl,
      max: 1,
    });
    await pool.query(
      `INSERT INTO poster_jobs (
         job_id, fortune_date, source_content_version, current_active_content_version,
         poster_template_version, channel_id, status, landing_url, locked_at,
         locked_by, attempt_token, created_at, updated_at
       ) VALUES (
         $1, $2::date, 'content-release-old', NULL,
         'template-race', 'channel-race', 'processing', 'https://example.test/race',
         $3::timestamptz, $4, $5, $3::timestamptz, $3::timestamptz
       )`,
      [jobId, fortuneDate, "2030-01-06T15:00:00.000Z", workerId, attemptToken],
    );
    await pool.query(
      `INSERT INTO poster_asset_reservations (
         asset_key, job_id, locked_by, attempt_token, created_at
       ) VALUES ('poster/race.webp', $1, $2, $3, $4::timestamptz)`,
      [jobId, workerId, attemptToken, "2030-01-06T15:00:00.000Z"],
    );

    let invalidated: (() => void) | undefined;
    const invalidationReached = new Promise<void>((resolve) => {
      invalidated = resolve;
    });
    let allowCommit: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => {
      allowCommit = resolve;
    });
    const invalidation = store.transaction(async (transaction) => {
      const count = await transaction.markProcessingPosterJobsVersionChanged({
        changedAt: "2030-01-06T15:00:01.000Z",
        currentActiveContentVersion: contentVersion,
        fortuneDate,
      });
      invalidated?.();
      await commitGate;
      return count;
    });
    await invalidationReached;
    const completion = workerPool.query(
      `UPDATE poster_jobs
          SET status = 'ready',
              poster_instance_id = 'poster-instance-race',
              asset_key = 'poster/race.webp',
              asset_url = 'https://example.test/race.webp',
              locked_at = NULL,
              locked_by = NULL,
              attempt_token = NULL
        WHERE job_id = $1
          AND status = 'processing'
          AND locked_by = $2
          AND attempt_token = $3
      RETURNING job_id`,
      [jobId, workerId, attemptToken],
    );
    try {
      await waitForLock(pool, workerApplication);
    } finally {
      allowCommit?.();
    }

    await expect(invalidation).resolves.toBe(1);
    await expect(completion).resolves.toMatchObject({ rowCount: 0, rows: [] });
    await expect(
      pool.query("SELECT status FROM poster_jobs WHERE job_id = $1", [jobId]),
    ).resolves.toMatchObject({ rows: [{ status: "version_changed" }] });
    await workerPool.end();
  });
});
