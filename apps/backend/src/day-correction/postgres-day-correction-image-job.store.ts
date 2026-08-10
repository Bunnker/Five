import type { Pool, PoolClient } from "pg";

import type {
  ClaimedDayCorrectionImageJob,
  DayCorrectionImageJobFailureResult,
  DayCorrectionImageJobStore,
  DayCorrectionImageJobView,
  DayCorrectionImageSlot,
  RequestDayCorrectionImageGenerationStoreResult,
  StoredDayCorrectionImageJob,
} from "./day-correction-image-job.store";

interface JobRow {
  actor_id: string;
  attempts: number | string;
  attempt_limit: number | string;
  available_at: Date | string;
  completed_asset_id: string | null;
  correction_id: string;
  draft_id: string;
  fortune_date: Date | string;
  generation_revision: number | string;
  image_slot: DayCorrectionImageSlot;
  job_id: string;
  last_error: string | null;
  prompt_version: string;
  reason: string;
  request_id: string;
  requested_at: Date | string;
  status: StoredDayCorrectionImageJob["status"];
}

interface WorkingCopyRow {
  correction_revision: number | string;
  correction_status: string;
  draft_id: string;
  draft_revision: number | string;
  fortune_date: Date | string;
  modules: unknown;
  submitted_content_version: string | null;
}

interface CurrentViewRow extends WorkingCopyRow {
  actor_id: string | null;
  attempts: number | string | null;
  attempt_limit: number | string | null;
  available_at: Date | string | null;
  completed_asset_id: string | null;
  generation_revision: number | string | null;
  image_slot: DayCorrectionImageSlot | null;
  job_id: string | null;
  last_error: string | null;
  prompt_version: string | null;
  reason: string | null;
  request_id: string | null;
  requested_at: Date | string | null;
  status: StoredDayCorrectionImageJob["status"] | null;
}

interface ClaimedRow extends JobRow {
  draft_revision: number | string;
  modules: unknown;
}

interface MutableClaimRow {
  attempts: number | string;
  attempt_limit: number | string;
  attempt_token: string | null;
  correction_id: string;
  image_slot: DayCorrectionImageSlot;
  status: StoredDayCorrectionImageJob["status"];
  worker_id: string | null;
}

const JOB_COLUMNS = `
  job.job_id,
  job.correction_id,
  job.draft_id,
  job.fortune_date::text,
  job.image_slot,
  job.generation_revision,
  job.prompt_version,
  job.actor_id,
  job.reason,
  job.request_id,
  job.requested_at,
  job.status,
  job.attempts,
  job.attempt_limit,
  job.available_at,
  job.last_error,
  job.completed_asset_id
`;

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asFortuneDate(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function mapJob(row: JobRow): StoredDayCorrectionImageJob {
  return {
    actorId: row.actor_id,
    attempts: Number(row.attempts),
    attemptLimit: Number(row.attempt_limit),
    availableAt: asIso(row.available_at),
    completedAssetId: row.completed_asset_id,
    correctionId: row.correction_id,
    draftId: row.draft_id,
    fortuneDate: asFortuneDate(row.fortune_date),
    generationRevision: Number(row.generation_revision),
    imageSlot: row.image_slot,
    jobId: row.job_id,
    lastError: row.last_error,
    promptVersion: row.prompt_version,
    reason: row.reason,
    requestId: row.request_id,
    requestedAt: asIso(row.requested_at),
    status: row.status,
  };
}

function parseStoredView(value: unknown): DayCorrectionImageJobView | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<DayCorrectionImageJobView>;
  if (
    typeof candidate.revision !== "object" ||
    candidate.revision === null ||
    !Number.isSafeInteger(candidate.revision.correctionRevision) ||
    !Number.isSafeInteger(candidate.revision.draftRevision)
  ) {
    return null;
  }
  if (candidate.job === null) return structuredClone(candidate as DayCorrectionImageJobView);
  if (
    typeof candidate.job !== "object" ||
    candidate.job === null ||
    typeof candidate.job.jobId !== "string" ||
    typeof candidate.job.correctionId !== "string" ||
    typeof candidate.job.draftId !== "string"
  ) {
    return null;
  }
  return structuredClone(candidate as DayCorrectionImageJobView);
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

export class PostgresDayCorrectionImageJobStore implements DayCorrectionImageJobStore {
  constructor(private readonly pool: Pool) {}

  async claimNext(
    input: Parameters<DayCorrectionImageJobStore["claimNext"]>[0],
  ): Promise<ClaimedDayCorrectionImageJob | null> {
    return this.transaction(async (client) => {
      await client.query(
        `UPDATE day_correction_image_jobs AS job
            SET status = 'failed',
                available_at = $1::timestamptz,
                last_error = coalesce(
                  job.last_error,
                  '图片生成租约已过期，且本轮尝试次数已用尽。'
                ),
                claimed_at = NULL,
                lease_expires_at = NULL,
                worker_id = NULL,
                attempt_token = NULL
           FROM day_correction_image_slot_currents AS current
          WHERE current.current_job_id = job.job_id
            AND current.correction_id = job.correction_id
            AND current.draft_id = job.draft_id
            AND current.fortune_date = job.fortune_date
            AND current.image_slot = job.image_slot
            AND current.generation_revision = job.generation_revision
            AND job.status = 'claimed'
            AND job.lease_expires_at <= $1::timestamptz
            AND job.attempts >= job.attempt_limit`,
        [input.claimedAt],
      );
      const result = await client.query<ClaimedRow>(
        `WITH candidate AS (
           SELECT job.job_id
             FROM day_correction_image_jobs AS job
             JOIN day_correction_image_slot_currents AS current
               ON current.current_job_id = job.job_id
              AND current.correction_id = job.correction_id
              AND current.draft_id = job.draft_id
              AND current.fortune_date = job.fortune_date
              AND current.image_slot = job.image_slot
              AND current.generation_revision = job.generation_revision
             JOIN day_corrections AS correction
               ON correction.correction_id = job.correction_id
              AND correction.draft_id = job.draft_id
              AND correction.fortune_date = job.fortune_date
             JOIN content_drafts AS draft
               ON draft.draft_id = job.draft_id
            WHERE correction.status = 'open'
              AND draft.submitted_content_version IS NULL
              AND job.attempts < job.attempt_limit
              AND (
                (job.status IN ('queued', 'retryable') AND job.available_at <= $1::timestamptz)
                OR
                (job.status = 'claimed' AND job.lease_expires_at <= $1::timestamptz)
              )
            ORDER BY job.available_at, job.job_id
            FOR UPDATE OF job SKIP LOCKED
            LIMIT 1
         ), claimed AS (
           UPDATE day_correction_image_jobs AS job
              SET status = 'claimed',
                  attempts = job.attempts + 1,
                  claimed_at = $1::timestamptz,
                  lease_expires_at = $2::timestamptz,
                  worker_id = $3,
                  attempt_token = $4
             FROM candidate
            WHERE job.job_id = candidate.job_id
          RETURNING job.*
         )
         SELECT
           ${JOB_COLUMNS.replaceAll("job.", "claimed.")},
           draft.draft_revision,
           draft.modules
           FROM claimed
           JOIN content_drafts AS draft ON draft.draft_id = claimed.draft_id`,
        [input.claimedAt, input.leaseExpiresAt, input.workerId, input.attemptToken],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : {
            ...mapJob(row),
            draftRevision: Number(row.draft_revision),
            modules: structuredClone(row.modules as ClaimedDayCorrectionImageJob["modules"]),
          };
    });
  }

  async complete(
    input: Parameters<DayCorrectionImageJobStore["complete"]>[0],
  ): Promise<"completed" | "stale"> {
    return this.transaction(async (client) => {
      const current = await client.query<MutableClaimRow>(
        `SELECT attempts, attempt_limit, attempt_token, correction_id, image_slot, status, worker_id
           FROM day_correction_image_jobs
          WHERE job_id = $1
          FOR UPDATE`,
        [input.jobId],
      );
      const row = current.rows[0];
      if (
        row === undefined ||
        row.status !== "claimed" ||
        row.attempt_token !== input.attemptToken ||
        row.worker_id !== input.workerId
      ) {
        return "stale";
      }
      await client.query(
        `UPDATE day_correction_image_jobs
            SET status = 'completed',
                completed_asset_id = $2,
                completed_at = $3::timestamptz,
                claimed_at = NULL,
                lease_expires_at = NULL,
                worker_id = NULL,
                attempt_token = NULL,
                last_error = NULL
          WHERE job_id = $1`,
        [input.jobId, input.assetId, input.completedAt],
      );
      const active = await client.query<{ is_current: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM day_correction_image_slot_currents
            WHERE correction_id = $1
              AND image_slot = $2
              AND current_job_id = $3
         ) AS is_current`,
        [row.correction_id, row.image_slot, input.jobId],
      );
      return active.rows[0]?.is_current === true ? "completed" : "stale";
    });
  }

  async getCurrent(
    correctionId: string,
    imageSlot: DayCorrectionImageSlot,
  ): Promise<DayCorrectionImageJobView | null> {
    const result = await this.pool.query<CurrentViewRow>(
      `SELECT
         correction.correction_revision,
         correction.status AS correction_status,
         correction.draft_id,
         correction.fortune_date::text,
         draft.draft_revision,
         draft.modules,
         draft.submitted_content_version,
         job.job_id,
         job.image_slot,
         job.generation_revision,
	         job.prompt_version,
	         job.actor_id,
	         job.reason,
	         job.request_id,
	         job.requested_at,
         job.status,
         job.attempts,
         job.attempt_limit,
         job.available_at,
         job.last_error,
         job.completed_asset_id
         FROM day_corrections AS correction
         JOIN content_drafts AS draft ON draft.draft_id = correction.draft_id
         LEFT JOIN day_correction_image_slot_currents AS current
           ON current.correction_id = correction.correction_id
          AND current.image_slot = $2
         LEFT JOIN day_correction_image_jobs AS job
           ON job.job_id = current.current_job_id
	          AND job.correction_id = current.correction_id
	          AND job.draft_id = current.draft_id
	          AND job.fortune_date = current.fortune_date
          AND job.image_slot = current.image_slot
          AND job.generation_revision = current.generation_revision
        WHERE correction.correction_id = $1`,
      [correctionId, imageSlot],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    const job =
      row.job_id === null ||
      row.image_slot === null ||
      row.generation_revision === null ||
      row.prompt_version === null ||
      row.actor_id === null ||
      row.reason === null ||
      row.request_id === null ||
      row.requested_at === null ||
      row.status === null ||
      row.attempts === null ||
      row.attempt_limit === null ||
      row.available_at === null
        ? null
        : mapJob({
            attempts: row.attempts,
            actor_id: row.actor_id,
            attempt_limit: row.attempt_limit,
            available_at: row.available_at,
            completed_asset_id: row.completed_asset_id,
            correction_id: correctionId,
            draft_id: row.draft_id,
            fortune_date: row.fortune_date,
            generation_revision: row.generation_revision,
            image_slot: row.image_slot,
            job_id: row.job_id,
            last_error: row.last_error,
            prompt_version: row.prompt_version,
            reason: row.reason,
            request_id: row.request_id,
            requested_at: row.requested_at,
            status: row.status,
          });
    return {
      job,
      revision: {
        correctionRevision: Number(row.correction_revision),
        draftRevision: Number(row.draft_revision),
      },
    };
  }

  async recordFailure(
    input: Parameters<DayCorrectionImageJobStore["recordFailure"]>[0],
  ): Promise<DayCorrectionImageJobFailureResult> {
    return this.transaction(async (client) => {
      const current = await client.query<MutableClaimRow>(
        `SELECT attempts, attempt_limit, attempt_token, correction_id, image_slot, status, worker_id
           FROM day_correction_image_jobs
          WHERE job_id = $1
          FOR UPDATE`,
        [input.jobId],
      );
      const row = current.rows[0];
      if (
        row === undefined ||
        row.status !== "claimed" ||
        row.attempt_token !== input.attemptToken ||
        row.worker_id !== input.workerId
      ) {
        return "stale";
      }
      const active = await client.query<{ is_current: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM day_correction_image_slot_currents
            WHERE correction_id = $1
              AND image_slot = $2
              AND current_job_id = $3
         ) AS is_current`,
        [row.correction_id, row.image_slot, input.jobId],
      );
      const isCurrent = active.rows[0]?.is_current === true;
      const exhausted = Number(row.attempts) >= Number(row.attempt_limit);
      const status = isCurrent && !exhausted ? "retryable" : "failed";
      await client.query(
        `UPDATE day_correction_image_jobs
            SET status = $2,
                available_at = $3::timestamptz,
                last_error = $4,
                claimed_at = NULL,
                lease_expires_at = NULL,
                worker_id = NULL,
                attempt_token = NULL
          WHERE job_id = $1`,
        [input.jobId, status, status === "retryable" ? input.retryAt : input.failedAt, input.error],
      );
      return !isCurrent ? "stale" : exhausted ? "exhausted" : "retry_scheduled";
    });
  }

  async requestGeneration(
    input: Parameters<DayCorrectionImageJobStore["requestGeneration"]>[0],
  ): Promise<RequestDayCorrectionImageGenerationStoreResult> {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `five:day-correction-image-idempotency:${input.correctionId}:${input.idempotencyKey}`,
      ]);
      const prior = await client.query<{ request_hash: string; response_json: unknown }>(
        `SELECT request_hash, response_json
           FROM day_correction_image_idempotency
          WHERE operation = 'regenerate'
            AND correction_id = $1
            AND idempotency_key = $2`,
        [input.correctionId, input.idempotencyKey],
      );
      const priorRow = prior.rows[0];
      if (priorRow !== undefined) {
        const response = parseStoredView(priorRow.response_json);
        return priorRow.request_hash === input.requestHash && response !== null
          ? { kind: "existing", view: response }
          : { kind: "idempotency_conflict" };
      }

      const working = await client.query<WorkingCopyRow>(
        `SELECT
           correction.correction_revision,
           correction.status AS correction_status,
           correction.draft_id,
           correction.fortune_date::text,
           draft.draft_revision,
           draft.modules,
           draft.submitted_content_version
           FROM day_corrections AS correction
           JOIN content_drafts AS draft ON draft.draft_id = correction.draft_id
          WHERE correction.correction_id = $1
          FOR UPDATE OF correction, draft`,
        [input.correctionId],
      );
      const workingRow = working.rows[0];
      if (workingRow === undefined) return { kind: "not_found" };
      if (
        workingRow.correction_status !== "open" ||
        workingRow.submitted_content_version !== null
      ) {
        return { kind: "invalid_state" };
      }
      const currentRevision = {
        correctionRevision: Number(workingRow.correction_revision),
        draftRevision: Number(workingRow.draft_revision),
      };
      if (
        currentRevision.correctionRevision !== input.expectedRevision.correctionRevision ||
        currentRevision.draftRevision !== input.expectedRevision.draftRevision
      ) {
        return { currentRevision, kind: "revision_mismatch" };
      }

      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `five:day-correction-image-current:${input.correctionId}:${input.imageSlot}`,
      ]);
      const current = await client.query<{ generation_revision: number | string }>(
        `SELECT generation_revision
           FROM day_correction_image_slot_currents
          WHERE correction_id = $1 AND image_slot = $2
          FOR UPDATE`,
        [input.correctionId, input.imageSlot],
      );
      const generationRevision = Number(current.rows[0]?.generation_revision ?? 0) + 1;
      const inserted = await client.query<JobRow>(
        `INSERT INTO day_correction_image_jobs (
           job_id, correction_id, draft_id, fortune_date, image_slot,
           generation_revision, prompt_version, status, attempts, attempt_limit,
           available_at, actor_id, reason, request_id, requested_at, created_at
         ) VALUES (
           $1, $2, $3, $4::date, $5, $6, $7, 'queued', 0, 3,
           $8::timestamptz, $9, $10, $11, $8::timestamptz, $8::timestamptz
         )
         RETURNING ${JOB_COLUMNS.replaceAll("job.", "")}`,
        [
          input.jobId,
          input.correctionId,
          workingRow.draft_id,
          workingRow.fortune_date,
          input.imageSlot,
          generationRevision,
          input.promptVersion,
          input.requestedAt,
          input.actorId,
          input.reason,
          input.requestId,
        ],
      );
      const insertedRow = inserted.rows[0];
      if (insertedRow === undefined) throw new Error("Correction image job insert returned no row");
      await client.query(
        `INSERT INTO day_correction_image_slot_currents (
           correction_id, draft_id, fortune_date, image_slot, current_job_id,
           generation_revision, updated_at
         ) VALUES ($1, $2, $3::date, $4, $5, $6, $7::timestamptz)
         ON CONFLICT (correction_id, image_slot) DO UPDATE
           SET draft_id = EXCLUDED.draft_id,
               fortune_date = EXCLUDED.fortune_date,
               current_job_id = EXCLUDED.current_job_id,
               generation_revision = EXCLUDED.generation_revision,
               updated_at = EXCLUDED.updated_at`,
        [
          input.correctionId,
          workingRow.draft_id,
          workingRow.fortune_date,
          input.imageSlot,
          input.jobId,
          generationRevision,
          input.requestedAt,
        ],
      );
      await client.query(
        `INSERT INTO day_correction_image_request_events (
           request_event_id, job_id, correction_id, draft_id, fortune_date,
           image_slot, actor_id, reason, request_id, requested_at
         ) VALUES ($1, $1, $2, $3, $4::date, $5, $6, $7, $8, $9::timestamptz)`,
        [
          input.jobId,
          input.correctionId,
          workingRow.draft_id,
          workingRow.fortune_date,
          input.imageSlot,
          input.actorId,
          input.reason,
          input.requestId,
          input.requestedAt,
        ],
      );
      const view: DayCorrectionImageJobView = {
        job: mapJob(insertedRow),
        revision: currentRevision,
      };
      await client.query(
        `INSERT INTO day_correction_image_idempotency (
           operation, correction_id, idempotency_key, request_hash, response_json, created_at
         ) VALUES ('regenerate', $1, $2, $3, $4::jsonb, $5::timestamptz)`,
        [
          input.correctionId,
          input.idempotencyKey,
          input.requestHash,
          JSON.stringify(view),
          input.requestedAt,
        ],
      );
      return { kind: "requested", view };
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
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
