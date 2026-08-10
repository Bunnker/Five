import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type {
  StoredAuditEvent,
  StoredContentVersion,
  StoredMasterReviewEvidence,
} from "../content-lifecycle/content-lifecycle.store";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";
import { projectDailyImageSet } from "../daily-images/image-delivery-projection";
import type {
  ContentReleaseIdempotencyOperation,
  ContentReleaseProjection,
  ContentReleaseStore,
  ContentReleaseTransaction,
  RecordScheduleTaskFailureInput,
  NewPublicCachePurgeIntent,
  StoredContentReleaseEvent,
  StoredContentReleaseIdempotency,
  StoredContentScheduleTask,
  StoredContentScheduleTaskEvent,
  StoredPublicCachePurgeIntent,
  UpdateReleaseVersionInput,
} from "./content-release.store";

interface ProjectionRow {
  active_content_version: string | null;
  fortune_date: string;
  lifecycle_revision: number | string;
  schedule_slot_revision: number | string;
  scheduled_content_version: string | null;
  scheduled_effective_from: Date | string | null;
}

interface VersionRow {
  content_version: string;
  created_at: Date | string;
  draft_id: string;
  effective_from: Date | string | null;
  effective_to: Date | string | null;
  fortune_date: string;
  preflight_checks: unknown;
  snapshot: unknown;
  state: StoredContentVersion["state"];
}

interface EvidenceRow {
  conclusion: StoredMasterReviewEvidence["conclusion"];
  content_version: string;
  evidence_id: string;
  notes: string;
  recorded_at: Date | string;
  recorded_revision: number | string;
  references_json: unknown;
  reviewed_at: Date | string;
  reviewer_display_name: string;
}

interface DailyImageSetRow {
  assets_json: unknown;
  content_version: string;
  fortune_date: string;
  lifecycle_revision: number | string;
  slots_json: unknown;
}

interface ImageWithdrawalRow {
  asset_id: string;
  audit_event_id: string;
  reason: string;
  withdrawal_event_id: string;
  withdrawn_at: Date | string;
}

interface IdempotencyRow {
  idempotency_key: string;
  operation: ContentReleaseIdempotencyOperation;
  request_hash: string;
  resource_id: string;
  response_json: unknown;
}

interface ScheduleTaskRow {
  attempt_token: string | null;
  attempts: number | string;
  available_at: Date | string;
  claimed_at: Date | string | null;
  completed_at: Date | string | null;
  content_version: string;
  created_at: Date | string;
  effective_from: Date | string;
  fortune_date: string;
  last_error: string | null;
  lease_expires_at: Date | string | null;
  schedule_slot_revision: number | string;
  status: StoredContentScheduleTask["status"];
  task_id: string;
  terminated_at: Date | string | null;
  termination_reason: string | null;
  updated_at: Date | string;
  worker_id: string | null;
}

interface ScheduleTaskEventRow {
  action: StoredContentScheduleTaskEvent["action"];
  event_id: string;
  occurred_at: Date | string;
  reason: string;
  status: StoredContentScheduleTaskEvent["status"];
  task_id: string;
}

interface ReleaseEventRow {
  action: StoredContentReleaseEvent["action"];
  actor_id: string;
  after_active_content_version: string | null;
  after_schedule_slot_revision: number | string;
  before_active_content_version: string | null;
  before_schedule_slot_revision: number | string;
  content_version: string;
  fortune_date: string;
  idempotency_key: string | null;
  occurred_at: Date | string;
  reason: string;
  release_event_id: string;
  request_id: string;
  schedule_task_id: string | null;
  transitions_json: unknown;
}

interface PurgeIntentRow {
  action: StoredPublicCachePurgeIntent["action"];
  after_active_content_version: string | null;
  attempt_token: string | null;
  attempts: number | string;
  available_at: Date | string;
  before_active_content_version: string | null;
  claimed_at: Date | string | null;
  created_at: Date | string;
  fortune_date: string;
  last_error: string | null;
  lease_expires_at: Date | string | null;
  processed_at: Date | string | null;
  purge_intent_id: string;
  request_id: string;
  status: StoredPublicCachePurgeIntent["status"];
  worker_id: string | null;
}

const PROJECTION_COLUMNS = `
  fortune_date::text,
  lifecycle_revision,
  active_content_version,
  schedule_slot_revision,
  scheduled_content_version,
  scheduled_effective_from
`;

const VERSION_COLUMNS = `
  content_version,
  draft_id,
  fortune_date::text,
  state,
  snapshot,
  preflight_checks,
  created_at,
  effective_from,
  effective_to
`;

const EVIDENCE_COLUMNS = `
  evidence_id,
  content_version,
  reviewer_display_name,
  reviewed_at,
  conclusion,
  notes,
  references_json,
  recorded_at,
  recorded_revision
`;

const DAILY_IMAGE_SET_COLUMNS = `
  content_version,
  fortune_date::text,
  lifecycle_revision,
  assets_json,
  slots_json
`;

const SCHEDULE_TASK_COLUMNS = `
  task_id,
  fortune_date::text,
  content_version,
  schedule_slot_revision,
  effective_from,
  status,
  attempts,
  available_at,
  claimed_at,
  lease_expires_at,
  worker_id,
  attempt_token,
  last_error,
  created_at,
  updated_at,
  completed_at,
  terminated_at,
  termination_reason
`;

const RELEASE_EVENT_COLUMNS = `
  release_event_id,
  action,
  occurred_at,
  request_id,
  fortune_date::text,
  content_version,
  actor_id,
  reason,
  idempotency_key,
  before_active_content_version,
  after_active_content_version,
  before_schedule_slot_revision,
  after_schedule_slot_revision,
  transitions_json,
  schedule_task_id
`;

const PURGE_INTENT_COLUMNS = `
  purge_intent_id,
  action,
  fortune_date::text,
  before_active_content_version,
  after_active_content_version,
  request_id,
  created_at,
  status,
  attempts,
  available_at,
  claimed_at,
  lease_expires_at,
  worker_id,
  attempt_token,
  last_error,
  processed_at
`;

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function mapProjection(row: ProjectionRow): ContentReleaseProjection {
  return {
    activeContentVersion: row.active_content_version,
    fortuneDate: row.fortune_date,
    lifecycleRevision: Number(row.lifecycle_revision),
    scheduleSlotRevision: Number(row.schedule_slot_revision),
    scheduledContentVersion: row.scheduled_content_version,
    scheduledEffectiveFrom: nullableIso(row.scheduled_effective_from),
  };
}

function mapVersion(row: VersionRow): StoredContentVersion {
  return {
    contentVersion: row.content_version,
    createdAt: asIso(row.created_at),
    draftId: row.draft_id,
    effectiveFrom: nullableIso(row.effective_from),
    effectiveTo: nullableIso(row.effective_to),
    fortuneDate: row.fortune_date,
    preflightChecks: structuredClone(
      row.preflight_checks as StoredContentVersion["preflightChecks"],
    ),
    snapshot: structuredClone(row.snapshot as StoredContentVersion["snapshot"]),
    state: row.state,
  };
}

function mapEvidence(row: EvidenceRow): StoredMasterReviewEvidence {
  return {
    conclusion: row.conclusion,
    contentVersion: row.content_version,
    evidenceId: row.evidence_id,
    notes: row.notes,
    recordedAt: asIso(row.recorded_at),
    recordedRevision: Number(row.recorded_revision),
    references: structuredClone(row.references_json as StoredMasterReviewEvidence["references"]),
    reviewedAt: asIso(row.reviewed_at),
    reviewerDisplayName: row.reviewer_display_name,
  };
}

function mapScheduleTask(row: ScheduleTaskRow): StoredContentScheduleTask {
  return {
    attemptToken: row.attempt_token,
    attempts: Number(row.attempts),
    availableAt: asIso(row.available_at),
    claimedAt: nullableIso(row.claimed_at),
    completedAt: nullableIso(row.completed_at),
    contentVersion: row.content_version,
    createdAt: asIso(row.created_at),
    effectiveFrom: asIso(row.effective_from),
    fortuneDate: row.fortune_date,
    lastError: row.last_error,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    scheduleSlotRevision: Number(row.schedule_slot_revision),
    status: row.status,
    taskId: row.task_id,
    terminatedAt: nullableIso(row.terminated_at),
    terminationReason: row.termination_reason,
    updatedAt: asIso(row.updated_at),
    workerId: row.worker_id,
  };
}

function mapScheduleTaskEvent(row: ScheduleTaskEventRow): StoredContentScheduleTaskEvent {
  return {
    action: row.action,
    eventId: row.event_id,
    occurredAt: asIso(row.occurred_at),
    reason: row.reason,
    status: row.status,
    taskId: row.task_id,
  };
}

function mapReleaseEvent(row: ReleaseEventRow): StoredContentReleaseEvent {
  return {
    action: row.action,
    actorId: row.actor_id,
    afterActiveContentVersion: row.after_active_content_version,
    afterScheduleSlotRevision: Number(row.after_schedule_slot_revision),
    beforeActiveContentVersion: row.before_active_content_version,
    beforeScheduleSlotRevision: Number(row.before_schedule_slot_revision),
    contentVersion: row.content_version,
    fortuneDate: row.fortune_date,
    idempotencyKey: row.idempotency_key,
    occurredAt: asIso(row.occurred_at),
    reason: row.reason,
    releaseEventId: row.release_event_id,
    requestId: row.request_id,
    scheduleTaskId: row.schedule_task_id,
    transitions: structuredClone(row.transitions_json as StoredContentReleaseEvent["transitions"]),
  };
}

function mapPurgeIntent(row: PurgeIntentRow): StoredPublicCachePurgeIntent {
  return {
    action: row.action,
    afterActiveContentVersion: row.after_active_content_version,
    attemptToken: row.attempt_token,
    attempts: Number(row.attempts),
    availableAt: asIso(row.available_at),
    beforeActiveContentVersion: row.before_active_content_version,
    claimedAt: nullableIso(row.claimed_at),
    createdAt: asIso(row.created_at),
    fortuneDate: row.fortune_date,
    lastError: row.last_error,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    processedAt: nullableIso(row.processed_at),
    purgeIntentId: row.purge_intent_id,
    requestId: row.request_id,
    status: row.status,
    workerId: row.worker_id,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

async function insertScheduleTaskEvent(
  client: Pick<PoolClient, "query">,
  task: StoredContentScheduleTask,
  action: StoredContentScheduleTaskEvent["action"],
  occurredAt: string,
  reason: string,
): Promise<void> {
  await client.query(
    `INSERT INTO content_schedule_task_events (
       event_id, task_id, action, status, occurred_at, reason
     ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6)`,
    [`schedule-event-${randomUUID()}`, task.taskId, action, task.status, occurredAt, reason],
  );
}

async function readImageWithdrawals(
  client: Pick<PoolClient, "query">,
  assets: StoredDailyImageSet["assets"],
): Promise<ImageWithdrawalRow[]> {
  const assetIds = assets.map((asset) => asset.assetId);
  if (assetIds.length === 0) return [];
  const result = await client.query<ImageWithdrawalRow>(
    `SELECT withdrawal_event_id, asset_id, reason, withdrawn_at, audit_event_id
       FROM image_asset_withdrawal_events
      WHERE asset_id = ANY($1::varchar[])
      ORDER BY withdrawn_at, withdrawal_event_id`,
    [assetIds],
  );
  return result.rows;
}

function mapDailyImageSet(
  row: DailyImageSetRow,
  withdrawals: readonly ImageWithdrawalRow[],
): StoredDailyImageSet {
  return projectDailyImageSet(
    {
      assets: structuredClone(row.assets_json as StoredDailyImageSet["assets"]),
      contentVersion: row.content_version,
      fortuneDate: row.fortune_date,
      lifecycleRevision: Number(row.lifecycle_revision),
      slots: structuredClone(row.slots_json as StoredDailyImageSet["slots"]),
      withdrawalEvents: [],
    },
    withdrawals.map((row) => ({
      assetId: row.asset_id,
      auditEventId: row.audit_event_id,
      reason: row.reason,
      withdrawalEventId: row.withdrawal_event_id,
      withdrawnAt: asIso(row.withdrawn_at),
    })),
  );
}

class PostgresContentReleaseTransaction implements ContentReleaseTransaction {
  constructor(private readonly client: PoolClient) {}

  async completeScheduleTask(input: {
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly taskId: string;
    readonly workerId: string;
  }): Promise<StoredContentScheduleTask | null> {
    const result = await this.client.query<ScheduleTaskRow>(
      `UPDATE content_schedule_tasks
          SET status = 'completed',
              claimed_at = NULL,
              lease_expires_at = NULL,
              worker_id = NULL,
              attempt_token = NULL,
              completed_at = $1::timestamptz,
              updated_at = $1::timestamptz
        WHERE task_id = $2
          AND status = 'processing'
          AND worker_id = $3
          AND attempt_token = $4
      RETURNING ${SCHEDULE_TASK_COLUMNS}`,
      [input.completedAt, input.taskId, input.workerId, input.attemptToken],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const task = mapScheduleTask(row);
    await insertScheduleTaskEvent(
      this.client,
      task,
      "completed",
      input.completedAt,
      "排期任务已完成。",
    );
    return task;
  }

  async findDailyImageSetForUpdate(contentVersion: string): Promise<StoredDailyImageSet | null> {
    const result = await this.client.query<DailyImageSetRow>(
      `SELECT ${DAILY_IMAGE_SET_COLUMNS}
         FROM daily_image_sets
        WHERE content_version = $1
        FOR UPDATE`,
      [contentVersion],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const assets = row.assets_json as StoredDailyImageSet["assets"];
    return mapDailyImageSet(row, await readImageWithdrawals(this.client, assets));
  }

  async findIdempotency(
    operation: ContentReleaseIdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<StoredContentReleaseIdempotency | null> {
    const result = await this.client.query<IdempotencyRow>(
      `SELECT operation, resource_id, idempotency_key, request_hash, response_json
         FROM content_lifecycle_idempotency
        WHERE operation = $1 AND resource_id = $2 AND idempotency_key = $3`,
      [operation, resourceId, idempotencyKey],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          idempotencyKey: row.idempotency_key,
          operation: row.operation,
          requestHash: row.request_hash,
          resourceId: row.resource_id,
          response: structuredClone(row.response_json),
        };
  }

  async findScheduleTask(taskId: string): Promise<StoredContentScheduleTask | null> {
    const result = await this.client.query<ScheduleTaskRow>(
      `SELECT ${SCHEDULE_TASK_COLUMNS}
         FROM content_schedule_tasks
        WHERE task_id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapScheduleTask(row);
  }

  async findScheduleTaskForUpdate(taskId: string): Promise<StoredContentScheduleTask | null> {
    const result = await this.client.query<ScheduleTaskRow>(
      `SELECT ${SCHEDULE_TASK_COLUMNS}
         FROM content_schedule_tasks
        WHERE task_id = $1
        FOR UPDATE`,
      [taskId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapScheduleTask(row);
  }

  async findVersion(contentVersion: string): Promise<StoredContentVersion | null> {
    const result = await this.client.query<VersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM content_versions WHERE content_version = $1`,
      [contentVersion],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapVersion(row);
  }

  async getProjectionForUpdate(fortuneDate: string): Promise<ContentReleaseProjection | null> {
    const result = await this.client.query<ProjectionRow>(
      `SELECT ${PROJECTION_COLUMNS}
         FROM content_lifecycle_days
        WHERE fortune_date = $1::date
        FOR UPDATE`,
      [fortuneDate],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProjection(row);
  }

  async insertAuditEvent(event: StoredAuditEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO content_lifecycle_audit_events (
         audit_event_id, action, occurred_at, request_id, fortune_date,
         content_version, actor_id, reason, from_state, to_state,
         idempotency_key, retain_until
       ) VALUES (
         $1, $2, $3::timestamptz, $4, $5::date,
         $6, $7, $8, $9, $10,
         $11, $3::timestamptz + interval '365 days'
       )`,
      [
        event.auditEventId,
        event.action,
        event.occurredAt,
        event.requestId,
        event.fortuneDate,
        event.contentVersion,
        event.actorId,
        event.reason,
        event.fromState,
        event.toState,
        event.idempotencyKey,
      ],
    );
  }

  async insertIdempotency(record: StoredContentReleaseIdempotency): Promise<void> {
    await this.client.query(
      `INSERT INTO content_lifecycle_idempotency (
         operation, resource_id, idempotency_key, request_hash, response_json, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, clock_timestamp())`,
      [
        record.operation,
        record.resourceId,
        record.idempotencyKey,
        record.requestHash,
        JSON.stringify(record.response),
      ],
    );
  }

  async insertPublicCachePurgeIntent(intent: NewPublicCachePurgeIntent): Promise<void> {
    await this.client.query(
      `INSERT INTO public_cache_purge_intents (
         purge_intent_id, action, fortune_date, before_active_content_version,
         after_active_content_version, request_id, created_at, status, attempts,
         available_at, claimed_at, lease_expires_at, worker_id, attempt_token,
         last_error, processed_at
       ) VALUES (
         $1, $2, $3::date, $4, $5, $6, $7::timestamptz, 'pending', 0,
         $7::timestamptz, NULL, NULL, NULL, NULL, NULL, NULL
       )`,
      [
        intent.purgeIntentId,
        intent.action,
        intent.fortuneDate,
        intent.beforeActiveContentVersion,
        intent.afterActiveContentVersion,
        intent.requestId,
        intent.createdAt,
      ],
    );
  }

  async insertReleaseEvent(event: StoredContentReleaseEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO content_release_events (
         release_event_id, action, occurred_at, request_id, fortune_date,
         content_version, actor_id, reason, idempotency_key,
         before_active_content_version, after_active_content_version,
         before_schedule_slot_revision, after_schedule_slot_revision,
         transitions_json, schedule_task_id
       ) VALUES (
         $1, $2, $3::timestamptz, $4, $5::date,
         $6, $7, $8, $9,
         $10, $11, $12, $13, $14::jsonb, $15
       )`,
      [
        event.releaseEventId,
        event.action,
        event.occurredAt,
        event.requestId,
        event.fortuneDate,
        event.contentVersion,
        event.actorId,
        event.reason,
        event.idempotencyKey,
        event.beforeActiveContentVersion,
        event.afterActiveContentVersion,
        event.beforeScheduleSlotRevision,
        event.afterScheduleSlotRevision,
        JSON.stringify(event.transitions),
        event.scheduleTaskId,
      ],
    );
  }

  async insertScheduleTask(task: StoredContentScheduleTask): Promise<void> {
    await this.client.query(
      `INSERT INTO content_schedule_tasks (
         task_id, fortune_date, content_version, schedule_slot_revision,
         effective_from, status, attempts, available_at, claimed_at,
         lease_expires_at, worker_id, attempt_token, last_error,
         created_at, updated_at, completed_at, terminated_at, termination_reason
       ) VALUES (
         $1, $2::date, $3, $4,
         $5::timestamptz, $6, $7, $8::timestamptz, $9::timestamptz,
         $10::timestamptz, $11, $12, $13,
         $14::timestamptz, $15::timestamptz, $16::timestamptz,
         $17::timestamptz, $18
       )`,
      [
        task.taskId,
        task.fortuneDate,
        task.contentVersion,
        task.scheduleSlotRevision,
        task.effectiveFrom,
        task.status,
        task.attempts,
        task.availableAt,
        task.claimedAt,
        task.leaseExpiresAt,
        task.workerId,
        task.attemptToken,
        task.lastError,
        task.createdAt,
        task.updatedAt,
        task.completedAt,
        task.terminatedAt,
        task.terminationReason,
      ],
    );
    await insertScheduleTaskEvent(this.client, task, "created", task.createdAt, "排期任务已创建。");
  }

  async listEvidence(contentVersion: string): Promise<StoredMasterReviewEvidence[]> {
    const result = await this.client.query<EvidenceRow>(
      `SELECT ${EVIDENCE_COLUMNS}
         FROM master_review_evidence
        WHERE content_version = $1
        ORDER BY recorded_revision`,
      [contentVersion],
    );
    return result.rows.map(mapEvidence);
  }

  async listGloballyWithdrawnAssetIds(assetIds: readonly string[]): Promise<string[]> {
    if (assetIds.length === 0) return [];
    const result = await this.client.query<{ asset_id: string }>(
      `SELECT DISTINCT asset_id
         FROM image_asset_withdrawal_events
        WHERE asset_id = ANY($1::varchar[])
        ORDER BY asset_id`,
      [assetIds],
    );
    return result.rows.map((row) => row.asset_id);
  }

  async lockIdempotency(
    operation: ContentReleaseIdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `content-release:${operation}:${resourceId}:${idempotencyKey}`,
    ]);
  }

  async markProcessingPosterJobsVersionChanged(input: {
    readonly changedAt: string;
    readonly currentActiveContentVersion: string | null;
    readonly fortuneDate: string;
  }): Promise<number> {
    const result = await this.client.query<{ job_id: string }>(
      `UPDATE poster_jobs
          SET current_active_content_version = $1,
              status = 'version_changed',
              poster_instance_id = NULL,
              asset_key = NULL,
              asset_url = NULL,
              locked_at = NULL,
              locked_by = NULL,
              attempt_token = NULL,
              last_error = 'active content version changed by release workflow',
              updated_at = $2::timestamptz
        WHERE fortune_date = $3::date
          AND status = 'processing'
          AND source_content_version IS DISTINCT FROM $1
      RETURNING job_id`,
      [input.currentActiveContentVersion, input.changedAt, input.fortuneDate],
    );
    const invalidatedJobIds = result.rows.map((row) => row.job_id);
    if (invalidatedJobIds.length !== 0) {
      await this.client.query(
        `DELETE FROM poster_asset_reservations
          WHERE job_id = ANY($1::varchar[])`,
        [invalidatedJobIds],
      );
    }
    return invalidatedJobIds.length;
  }

  async terminateClaimedScheduleTask(input: {
    readonly attemptToken: string;
    readonly reason: string;
    readonly taskId: string;
    readonly terminatedAt: string;
    readonly workerId: string;
  }): Promise<StoredContentScheduleTask | null> {
    const result = await this.client.query<ScheduleTaskRow>(
      `UPDATE content_schedule_tasks
          SET status = 'terminated',
              claimed_at = NULL,
              lease_expires_at = NULL,
              worker_id = NULL,
              attempt_token = NULL,
              terminated_at = $1::timestamptz,
              termination_reason = $2,
              updated_at = $1::timestamptz
        WHERE task_id = $3
          AND status = 'processing'
          AND worker_id = $4
          AND attempt_token = $5
      RETURNING ${SCHEDULE_TASK_COLUMNS}`,
      [input.terminatedAt, input.reason, input.taskId, input.workerId, input.attemptToken],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const task = mapScheduleTask(row);
    await insertScheduleTaskEvent(
      this.client,
      task,
      "terminated",
      input.terminatedAt,
      input.reason,
    );
    return task;
  }

  async terminateOpenScheduleTasks(input: {
    readonly exceptTaskId: string | null;
    readonly fortuneDate: string;
    readonly reason: string;
    readonly terminatedAt: string;
  }): Promise<StoredContentScheduleTask[]> {
    const result = await this.client.query<ScheduleTaskRow>(
      `UPDATE content_schedule_tasks
          SET status = 'terminated',
              claimed_at = NULL,
              lease_expires_at = NULL,
              worker_id = NULL,
              attempt_token = NULL,
              terminated_at = $1::timestamptz,
              termination_reason = $2,
              updated_at = $1::timestamptz
        WHERE fortune_date = $3::date
          AND status IN ('pending', 'processing', 'retrying')
          AND ($4::text IS NULL OR task_id <> $4)
      RETURNING ${SCHEDULE_TASK_COLUMNS}`,
      [input.terminatedAt, input.reason, input.fortuneDate, input.exceptTaskId],
    );
    const tasks = result.rows.map(mapScheduleTask);
    for (const task of tasks) {
      await insertScheduleTaskEvent(
        this.client,
        task,
        "terminated",
        input.terminatedAt,
        input.reason,
      );
    }
    return tasks;
  }

  async updateProjection(input: {
    readonly expectedLifecycleRevision: number;
    readonly expectedScheduleSlotRevision: number;
    readonly projection: ContentReleaseProjection;
  }): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE content_lifecycle_days
          SET lifecycle_revision = $1,
              active_content_version = $2,
              schedule_slot_revision = $3,
              scheduled_content_version = $4,
              scheduled_effective_from = $5::timestamptz
        WHERE fortune_date = $6::date
          AND lifecycle_revision = $7
          AND schedule_slot_revision = $8`,
      [
        input.projection.lifecycleRevision,
        input.projection.activeContentVersion,
        input.projection.scheduleSlotRevision,
        input.projection.scheduledContentVersion,
        input.projection.scheduledEffectiveFrom,
        input.projection.fortuneDate,
        input.expectedLifecycleRevision,
        input.expectedScheduleSlotRevision,
      ],
    );
    return result.rowCount === 1;
  }

  async updateVersion(input: UpdateReleaseVersionInput): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE content_versions
          SET state = $1
        WHERE content_version = $2
          AND state = $3`,
      [input.state, input.contentVersion, input.expectedState],
    );
    return result.rowCount === 1;
  }
}

export class PostgresContentReleaseStore implements ContentReleaseStore {
  constructor(private readonly pool: Pool) {}

  async claimNextPublicCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<StoredPublicCachePurgeIntent | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<PurgeIntentRow>(
        `WITH candidate AS (
           SELECT purge_intent_id AS candidate_purge_intent_id
             FROM public_cache_purge_intents
            WHERE (
              status = 'pending' AND available_at <= $1::timestamptz
            ) OR (
              status = 'processing' AND lease_expires_at <= $1::timestamptz
            )
            ORDER BY
              CASE WHEN status = 'processing' THEN lease_expires_at ELSE available_at END,
              created_at,
              purge_intent_id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE public_cache_purge_intents AS intent
            SET status = 'processing',
                attempts = intent.attempts + 1,
                claimed_at = $1::timestamptz,
                lease_expires_at = $2::timestamptz,
                worker_id = $3,
                attempt_token = $4
           FROM candidate
          WHERE intent.purge_intent_id = candidate.candidate_purge_intent_id
        RETURNING ${PURGE_INTENT_COLUMNS}`,
        [input.claimedAt, input.leaseExpiresAt, input.workerId, input.attemptToken],
      );
      await client.query("COMMIT");
      const row = result.rows[0];
      return row === undefined ? null : mapPurgeIntent(row);
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimNextScheduleTask(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<StoredContentScheduleTask | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<ScheduleTaskRow>(
        `WITH candidate AS (
           SELECT task_id AS candidate_task_id
             FROM content_schedule_tasks
            WHERE (
              status IN ('pending', 'retrying') AND available_at <= $1::timestamptz
            ) OR (
              status = 'processing' AND lease_expires_at <= $1::timestamptz
            )
            ORDER BY
              CASE WHEN status = 'processing' THEN lease_expires_at ELSE available_at END,
              created_at,
              task_id
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         UPDATE content_schedule_tasks AS task
            SET status = 'processing',
                attempts = task.attempts + 1,
                claimed_at = $1::timestamptz,
                lease_expires_at = $2::timestamptz,
                worker_id = $3,
                attempt_token = $4,
                updated_at = $1::timestamptz
           FROM candidate
          WHERE task.task_id = candidate.candidate_task_id
        RETURNING ${SCHEDULE_TASK_COLUMNS}`,
        [input.claimedAt, input.leaseExpiresAt, input.workerId, input.attemptToken],
      );
      const row = result.rows[0];
      if (row === undefined) {
        await client.query("COMMIT");
        return null;
      }
      const task = mapScheduleTask(row);
      await insertScheduleTaskEvent(client, task, "claimed", input.claimedAt, "排期任务已领取。");
      await client.query("COMMIT");
      return task;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async completePublicCachePurgeIntent(input: {
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly purgeIntentId: string;
    readonly workerId: string;
  }): Promise<StoredPublicCachePurgeIntent | null> {
    const result = await this.pool.query<PurgeIntentRow>(
      `UPDATE public_cache_purge_intents
          SET status = 'completed',
              claimed_at = NULL,
              lease_expires_at = NULL,
              worker_id = NULL,
              attempt_token = NULL,
              processed_at = $1::timestamptz
        WHERE purge_intent_id = $2
          AND status = 'processing'
          AND worker_id = $3
          AND attempt_token = $4
      RETURNING ${PURGE_INTENT_COLUMNS}`,
      [input.completedAt, input.purgeIntentId, input.workerId, input.attemptToken],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPurgeIntent(row);
  }

  async listPublicCachePurgeIntents(fortuneDate: string): Promise<StoredPublicCachePurgeIntent[]> {
    const result = await this.pool.query<PurgeIntentRow>(
      `SELECT ${PURGE_INTENT_COLUMNS}
       FROM public_cache_purge_intents
       WHERE fortune_date = $1::date
       ORDER BY created_at, purge_intent_id`,
      [fortuneDate],
    );
    return result.rows.map(mapPurgeIntent);
  }

  async listReleaseEvents(fortuneDate: string): Promise<StoredContentReleaseEvent[]> {
    const result = await this.pool.query<ReleaseEventRow>(
      `SELECT ${RELEASE_EVENT_COLUMNS}
         FROM content_release_events
        WHERE fortune_date = $1::date
        ORDER BY occurred_at, release_event_id`,
      [fortuneDate],
    );
    return result.rows.map(mapReleaseEvent);
  }

  async listScheduleTaskEvents(taskId: string): Promise<StoredContentScheduleTaskEvent[]> {
    const result = await this.pool.query<ScheduleTaskEventRow>(
      `SELECT event_id, task_id, action, status, occurred_at, reason
         FROM content_schedule_task_events
        WHERE task_id = $1
        ORDER BY occurred_at, event_id`,
      [taskId],
    );
    return result.rows.map(mapScheduleTaskEvent);
  }

  async readProjection(fortuneDate: string): Promise<ContentReleaseProjection | null> {
    const result = await this.pool.query<ProjectionRow>(
      `SELECT ${PROJECTION_COLUMNS}
         FROM content_lifecycle_days
        WHERE fortune_date = $1::date`,
      [fortuneDate],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapProjection(row);
  }

  async readScheduleTask(taskId: string): Promise<StoredContentScheduleTask | null> {
    const result = await this.pool.query<ScheduleTaskRow>(
      `SELECT ${SCHEDULE_TASK_COLUMNS}
         FROM content_schedule_tasks
        WHERE task_id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapScheduleTask(row);
  }

  async readVersion(contentVersion: string): Promise<StoredContentVersion | null> {
    const result = await this.pool.query<VersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM content_versions WHERE content_version = $1`,
      [contentVersion],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapVersion(row);
  }

  async recordPublicCachePurgeFailure(input: {
    readonly attemptToken: string;
    readonly error: string;
    readonly failedAt: string;
    readonly purgeIntentId: string;
    readonly retryAt: string;
    readonly workerId: string;
  }): Promise<StoredPublicCachePurgeIntent | null> {
    const result = await this.pool.query<PurgeIntentRow>(
      `UPDATE public_cache_purge_intents
          SET status = 'pending',
              available_at = $1::timestamptz,
              claimed_at = NULL,
              lease_expires_at = NULL,
              worker_id = NULL,
              attempt_token = NULL,
              last_error = $2
        WHERE purge_intent_id = $3
          AND status = 'processing'
          AND worker_id = $4
          AND attempt_token = $5
      RETURNING ${PURGE_INTENT_COLUMNS}`,
      [input.retryAt, input.error, input.purgeIntentId, input.workerId, input.attemptToken],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapPurgeIntent(row);
  }

  async recordScheduleTaskFailure(
    input: RecordScheduleTaskFailureInput,
  ): Promise<StoredContentScheduleTask | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const transaction = new PostgresContentReleaseTransaction(client);
      const candidate = await transaction.findScheduleTask(input.taskId);
      if (candidate === null) {
        await client.query("COMMIT");
        return null;
      }
      const projection = await transaction.getProjectionForUpdate(candidate.fortuneDate);
      if (projection === null) {
        throw new Error("Scheduled release failure requires its locked day projection");
      }
      const result = await client.query<ScheduleTaskRow>(
        `UPDATE content_schedule_tasks
            SET status = 'retrying',
                available_at = $1::timestamptz,
                claimed_at = NULL,
                lease_expires_at = NULL,
                worker_id = NULL,
                attempt_token = NULL,
                last_error = $2,
                updated_at = $3::timestamptz
          WHERE task_id = $4
            AND status = 'processing'
            AND worker_id = $5
            AND attempt_token = $6
        RETURNING ${SCHEDULE_TASK_COLUMNS}`,
        [
          input.retryAt,
          input.error,
          input.failedAt,
          input.taskId,
          input.workerId,
          input.attemptToken,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        await client.query("COMMIT");
        return null;
      }
      const task = mapScheduleTask(row);
      await insertScheduleTaskEvent(
        client,
        task,
        "retry_scheduled",
        input.failedAt,
        input.error.slice(0, 2_000),
      );
      const transition = {
        contentVersion: task.contentVersion,
        fromState: "scheduled" as const,
        toState: "scheduled" as const,
      };
      await transaction.insertReleaseEvent({
        action: "scheduled_publish_failed",
        actorId: "system:scheduled-release-worker",
        afterActiveContentVersion: projection.activeContentVersion,
        afterScheduleSlotRevision: projection.scheduleSlotRevision,
        beforeActiveContentVersion: projection.activeContentVersion,
        beforeScheduleSlotRevision: projection.scheduleSlotRevision,
        contentVersion: task.contentVersion,
        fortuneDate: task.fortuneDate,
        idempotencyKey: null,
        occurredAt: input.failedAt,
        reason: input.error,
        releaseEventId: input.releaseEventId,
        requestId: `scheduled-${task.taskId}`,
        scheduleTaskId: task.taskId,
        transitions: [transition],
      });
      await transaction.insertAuditEvent({
        action: "content_scheduled_publish_failed",
        actorId: "system:scheduled-release-worker",
        auditEventId: input.auditEventId,
        contentVersion: task.contentVersion,
        fortuneDate: task.fortuneDate,
        fromState: "scheduled",
        idempotencyKey: input.auditIdempotencyKey,
        occurredAt: input.failedAt,
        reason: input.error,
        requestId: `scheduled-${task.taskId}`,
        toState: "scheduled",
      });
      await client.query("COMMIT");
      return task;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async transaction<T>(work: (transaction: ContentReleaseTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresContentReleaseTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
