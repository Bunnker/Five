import type { Pool, PoolClient } from "pg";

import type {
  ClaimedImageProductionJob,
  ContentProductionStore,
  EnsureGeneratedDayInput,
  EnsureGeneratedDayStoreResult,
  ImageJobFailureResult,
  RequestImageSlotGenerationStoreResult,
} from "./content-production.store";
import type { DailyContentProduction } from "./content-production.service";
import {
  AUTOMATIC_IMAGE_ATTEMPTS_PER_CYCLE,
  DAILY_IMAGE_SLOTS,
  type DailyImageSlot,
  type DailyImageSlotProduction,
  type DailyImageSlotProductionStatus,
  REQUIRED_IMAGE_SLOTS,
} from "./content-production.status";

interface ProductionRow {
  completed_image_slots: number | string;
  draft_id: string;
  draft_revision: number | string;
  fortune_date: Date | string;
  image_slots: unknown;
  last_error: string | null;
  pending_image_slots: number | string;
  status: DailyContentProduction["status"];
  updated_at: Date | string;
}

interface ImageJobRow {
  attempts: number | string;
  draft_id: string;
  draft_revision: number | string;
  fortune_date: Date | string;
  image_slot: ClaimedImageProductionJob["imageSlot"];
  job_id: string;
  modules: unknown;
  prompt_version: string;
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asNullableIso(value: unknown): string | null {
  return value instanceof Date || typeof value === "string" ? asIso(value) : null;
}

const FORTUNE_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

function asFortuneDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  return FORTUNE_DATE_FORMATTER.format(value);
}

const IMAGE_SLOT_STATUS_SET = new Set<DailyImageSlotProductionStatus>([
  "failed",
  "not_requested",
  "pending",
  "ready",
]);

function parseImageSlot(value: unknown, expectedSlot: DailyImageSlot): DailyImageSlotProduction {
  if (typeof value !== "object" || value === null) {
    throw new Error("Content production image slot projection is invalid");
  }
  const item = value as Record<string, unknown>;
  if (
    item.imageSlot !== expectedSlot ||
    typeof item.status !== "string" ||
    !IMAGE_SLOT_STATUS_SET.has(item.status as DailyImageSlotProductionStatus) ||
    (expectedSlot !== "optional" && item.status === "not_requested") ||
    !Number.isSafeInteger(item.attempts) ||
    Number(item.attempts) < 0 ||
    !Number.isSafeInteger(item.attemptLimit) ||
    Number(item.attemptLimit) < 0 ||
    (item.lastError !== null && typeof item.lastError !== "string") ||
    (item.nextAttemptAt !== null && asNullableIso(item.nextAttemptAt) === null) ||
    typeof item.canRetry !== "boolean" ||
    typeof item.deliveryReady !== "boolean"
  ) {
    throw new Error("Content production image slot projection is invalid");
  }
  return {
    attemptLimit: Number(item.attemptLimit),
    attempts: Number(item.attempts),
    canRetry: item.canRetry,
    deliveryReady: item.deliveryReady,
    imageSlot: expectedSlot,
    lastError: item.lastError as string | null,
    nextAttemptAt: asNullableIso(item.nextAttemptAt),
    status: item.status,
  } as DailyImageSlotProduction;
}

function mapImageSlots(value: unknown): DailyContentProduction["imageSlots"] {
  if (!Array.isArray(value) || value.length !== DAILY_IMAGE_SLOTS.length) {
    throw new Error("Content production image slot projection is incomplete");
  }
  const primary = parseImageSlot(value[0], "required_primary");
  const alternative = parseImageSlot(value[1], "required_alternative");
  const optional = parseImageSlot(value[2], "optional");
  if (
    primary.imageSlot !== "required_primary" ||
    alternative.imageSlot !== "required_alternative" ||
    optional.imageSlot !== "optional"
  ) {
    throw new Error("Content production image slot projection is incomplete");
  }
  return [primary, alternative, optional];
}

function mapProduction(row: ProductionRow): DailyContentProduction {
  const imageSlots = mapImageSlots(row.image_slots);
  return {
    completedImageSlots: Number(row.completed_image_slots),
    draftId: row.draft_id,
    draftRevision: Number(row.draft_revision),
    fortuneDate: asFortuneDate(row.fortune_date),
    imageSlots,
    lastError: row.last_error,
    optionalImageStatus: imageSlots[2].status,
    pendingImageSlots: Number(row.pending_image_slots),
    requiredGenerationComplete: imageSlots.slice(0, 2).every((slot) => slot.status === "ready"),
    requiredImagesReady: imageSlots.slice(0, 2).every((slot) => slot.deliveryReady),
    status: row.status,
    updatedAt: asIso(row.updated_at),
  };
}

const PRODUCTION_SLOT_PROJECTION = `
  CROSS JOIN LATERAL (
    SELECT
      jsonb_agg(
        jsonb_build_object(
          'imageSlot', state.image_slot,
          'status', state.slot_status,
          'deliveryReady', state.delivery_ready,
          'attempts', state.attempts,
          'attemptLimit', state.attempt_limit,
          'lastError', state.slot_error,
          'nextAttemptAt', state.next_attempt_at,
          'canRetry', state.slot_status = 'failed'
        )
        ORDER BY state.sort_order
      ) AS image_slots,
      count(*) FILTER (
        WHERE state.image_slot IN ('required_primary', 'required_alternative')
          AND state.slot_status = 'ready'
      )::integer AS completed_image_slots,
      count(*) FILTER (
        WHERE state.image_slot IN ('required_primary', 'required_alternative')
          AND state.slot_status = 'pending'
      )::integer AS pending_image_slots,
      CASE
        WHEN count(*) FILTER (
          WHERE state.image_slot IN ('required_primary', 'required_alternative')
            AND state.delivery_ready
        ) = 2 THEN 'awaiting_review'
        WHEN count(*) FILTER (
          WHERE state.image_slot IN ('required_primary', 'required_alternative')
            AND NOT state.delivery_ready
            AND state.slot_error IS NOT NULL
        ) > 0 THEN 'failed'
        WHEN count(*) FILTER (
          WHERE state.image_slot IN ('required_primary', 'required_alternative')
            AND state.slot_status = 'failed'
        ) > 0 THEN 'failed'
        ELSE 'generating'
      END AS production_status,
      min(state.slot_error) FILTER (
        WHERE state.image_slot IN ('required_primary', 'required_alternative')
          AND NOT state.delivery_ready
          AND state.slot_error IS NOT NULL
      ) AS production_error
    FROM (
      SELECT
        slot.image_slot,
        slot.sort_order,
        coalesce(job.attempts, 0) AS attempts,
        coalesce(job.attempt_limit, 0) AS attempt_limit,
        CASE
          WHEN selection.asset_id IS NULL
            OR selected_withdrawal.asset_id IS NOT NULL THEN false
          WHEN slot.image_slot = 'required_alternative'
            AND primary_selection.asset_id IS NOT NULL
            AND (
              selection.asset_id = primary_selection.asset_id
              OR selected_asset.sha256 = primary_asset.sha256
            ) THEN false
          ELSE true
        END AS delivery_ready,
        CASE
          WHEN job.status = 'completed' THEN 'ready'
          WHEN job.status = 'failed' THEN 'failed'
          WHEN job.status IS NULL AND slot.image_slot = 'optional' THEN 'not_requested'
          WHEN job.status IS NULL THEN 'failed'
          ELSE 'pending'
        END AS slot_status,
        CASE
          WHEN selected_withdrawal.asset_id IS NOT NULL
            THEN '所选图片已下线，请重新生成或选择。'
          WHEN slot.image_slot = 'required_alternative'
            AND selection.asset_id IS NOT NULL
            AND primary_selection.asset_id IS NOT NULL
            AND (
              selection.asset_id = primary_selection.asset_id
              OR selected_asset.sha256 = primary_asset.sha256
            )
            THEN '两张必备图片内容重复，请替换备选图。'
          WHEN job.status IS NULL AND slot.image_slot <> 'optional'
            THEN '当前图片生成批次不可确定，请重新生成。'
          ELSE job.last_error
        END AS slot_error,
        CASE
          WHEN job.status IN ('queued', 'retryable') THEN job.available_at
          WHEN job.status = 'claimed' THEN job.lease_expires_at
          ELSE NULL
        END AS next_attempt_at
      FROM (VALUES
        ('required_primary', 1),
        ('required_alternative', 2),
        ('optional', 3)
      ) AS slot(image_slot, sort_order)
      LEFT JOIN daily_content_image_slot_currents AS current
        ON current.fortune_date = production.fortune_date
       AND current.image_slot = slot.image_slot
      LEFT JOIN daily_content_image_jobs AS job
        ON job.job_id = current.current_job_id
       AND job.fortune_date = current.fortune_date
       AND job.image_slot = current.image_slot
       AND job.generation_revision = current.generation_revision
      LEFT JOIN draft_image_slot_selections AS selection
        ON selection.draft_id = production.draft_id
       AND selection.image_slot = slot.image_slot
      LEFT JOIN daily_image_assets AS selected_asset
        ON selected_asset.asset_id = selection.asset_id
      LEFT JOIN LATERAL (
        SELECT withdrawal.asset_id
        FROM image_asset_withdrawal_events AS withdrawal
        WHERE withdrawal.asset_id = selection.asset_id
        LIMIT 1
      ) AS selected_withdrawal ON true
      LEFT JOIN draft_image_slot_selections AS primary_selection
        ON primary_selection.draft_id = production.draft_id
       AND primary_selection.image_slot = 'required_primary'
      LEFT JOIN daily_image_assets AS primary_asset
        ON primary_asset.asset_id = primary_selection.asset_id
    ) AS state
  ) AS image_projection
`;

const PRODUCTION_COLUMNS = `
  production.fortune_date,
  production.draft_id,
  draft.draft_revision,
  image_projection.production_status AS status,
  image_projection.completed_image_slots,
  image_projection.pending_image_slots,
  image_projection.production_error AS last_error,
  production.updated_at,
  image_projection.image_slots
`;

const REFRESH_PRODUCTION_SQL = `
  WITH required_states AS (
    SELECT
      current.image_slot,
      CASE
        WHEN job.status = 'completed' THEN 'ready'
        WHEN job.status = 'failed' OR job.status IS NULL THEN 'failed'
        ELSE 'pending'
      END AS slot_status,
      CASE
        WHEN selection.asset_id IS NULL
          OR selected_withdrawal.asset_id IS NOT NULL THEN false
        WHEN current.image_slot = 'required_alternative'
          AND primary_selection.asset_id IS NOT NULL
          AND (
            selection.asset_id = primary_selection.asset_id
            OR selected_asset.sha256 = primary_asset.sha256
          ) THEN false
        ELSE true
      END AS delivery_ready,
      CASE
        WHEN selected_withdrawal.asset_id IS NOT NULL
          THEN '所选图片已下线，请重新生成或选择。'
        WHEN current.image_slot = 'required_alternative'
          AND selection.asset_id IS NOT NULL
          AND primary_selection.asset_id IS NOT NULL
          AND (
            selection.asset_id = primary_selection.asset_id
            OR selected_asset.sha256 = primary_asset.sha256
          )
          THEN '两张必备图片内容重复，请替换备选图。'
        WHEN job.status IS NULL THEN '当前图片生成批次不可确定，请重新生成。'
        ELSE job.last_error
      END AS slot_error
    FROM daily_content_image_slot_currents AS current
    JOIN daily_content_productions AS owner
      ON owner.fortune_date = current.fortune_date
    LEFT JOIN daily_content_image_jobs AS job
      ON job.job_id = current.current_job_id
     AND job.fortune_date = current.fortune_date
     AND job.image_slot = current.image_slot
     AND job.generation_revision = current.generation_revision
    LEFT JOIN draft_image_slot_selections AS selection
      ON selection.draft_id = owner.draft_id
     AND selection.image_slot = current.image_slot
    LEFT JOIN daily_image_assets AS selected_asset
      ON selected_asset.asset_id = selection.asset_id
    LEFT JOIN LATERAL (
      SELECT withdrawal.asset_id
      FROM image_asset_withdrawal_events AS withdrawal
      WHERE withdrawal.asset_id = selection.asset_id
      LIMIT 1
    ) AS selected_withdrawal ON true
    LEFT JOIN draft_image_slot_selections AS primary_selection
      ON primary_selection.draft_id = owner.draft_id
     AND primary_selection.image_slot = 'required_primary'
    LEFT JOIN daily_image_assets AS primary_asset
      ON primary_asset.asset_id = primary_selection.asset_id
    WHERE current.fortune_date = $1
      AND current.image_slot IN ('required_primary', 'required_alternative')
  ), summary AS (
    SELECT
      count(*) FILTER (WHERE slot_status = 'ready')::integer AS completed,
      count(*) FILTER (WHERE slot_status = 'pending')::integer AS pending,
      count(*) FILTER (WHERE slot_status = 'failed')::integer AS failed,
      count(*) FILTER (WHERE delivery_ready)::integer AS delivery_ready,
      min(slot_error) FILTER (
        WHERE NOT delivery_ready AND slot_error IS NOT NULL
      ) AS last_error
    FROM required_states
  )
  UPDATE daily_content_productions AS production
     SET completed_image_slots = summary.completed,
         pending_image_slots = summary.pending,
         status = CASE
           WHEN summary.delivery_ready = 2 THEN 'awaiting_review'
           WHEN summary.last_error IS NOT NULL THEN 'failed'
           WHEN summary.failed > 0 THEN 'failed'
           ELSE 'generating'
         END,
         last_error = summary.last_error,
         updated_at = $2
    FROM summary
   WHERE production.fortune_date = $1
`;

async function refreshProduction(
  client: PoolClient,
  fortuneDate: string,
  updatedAt: string,
): Promise<void> {
  await client.query(REFRESH_PRODUCTION_SQL, [fortuneDate, updatedAt]);
}

async function readProduction(
  client: PoolClient,
  fortuneDate: string,
): Promise<DailyContentProduction | null> {
  const result = await client.query<ProductionRow>(
    `SELECT ${PRODUCTION_COLUMNS}
       FROM daily_content_productions AS production
       JOIN content_drafts AS draft ON draft.draft_id = production.draft_id
       ${PRODUCTION_SLOT_PROJECTION}
      WHERE production.fortune_date = $1`,
    [fortuneDate],
  );
  return result.rows[0] === undefined ? null : mapProduction(result.rows[0]);
}

export class PostgresContentProductionStore implements ContentProductionStore {
  constructor(private readonly pool: Pool) {}

  async claimNextImageJob(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<ClaimedImageProductionJob | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const exhausted = await client.query<{ fortune_date: string }>(
        `UPDATE daily_content_image_jobs AS job
            SET status = 'failed',
                available_at = $1,
                last_error = coalesce(
                  job.last_error,
                  '图片生成租约已过期，且本轮尝试次数已用尽。'
                ),
                claimed_at = NULL,
                lease_expires_at = NULL,
                worker_id = NULL,
                attempt_token = NULL
           FROM daily_content_image_slot_currents AS current
          WHERE current.current_job_id = job.job_id
            AND current.fortune_date = job.fortune_date
            AND current.image_slot = job.image_slot
            AND current.generation_revision = job.generation_revision
            AND job.attempts >= job.attempt_limit
            AND (
              (job.status = 'claimed' AND job.lease_expires_at <= $1)
              OR job.status IN ('queued', 'retryable')
            )
        RETURNING job.fortune_date::text`,
        [input.claimedAt],
      );
      for (const fortuneDate of new Set(exhausted.rows.map((row) => row.fortune_date))) {
        await refreshProduction(client, fortuneDate, input.claimedAt);
      }
      const claimed = await client.query<ImageJobRow>(
        `WITH candidate AS (
           SELECT job.job_id
             FROM daily_content_image_jobs AS job
             JOIN daily_content_image_slot_currents AS current
               ON current.current_job_id = job.job_id
              AND current.fortune_date = job.fortune_date
              AND current.image_slot = job.image_slot
              AND current.generation_revision = job.generation_revision
             JOIN daily_content_productions AS production
               ON production.fortune_date = job.fortune_date
             JOIN content_drafts AS candidate_draft
               ON candidate_draft.draft_id = production.draft_id
              AND candidate_draft.submitted_content_version IS NULL
            WHERE job.attempts < job.attempt_limit
              AND (
                (job.status IN ('queued', 'retryable') AND job.available_at <= $1)
                OR (job.status = 'claimed' AND job.lease_expires_at <= $1)
              )
            ORDER BY job.available_at, job.fortune_date,
                     CASE job.image_slot
                       WHEN 'required_primary' THEN 1
                       WHEN 'required_alternative' THEN 2
                       ELSE 3
                     END
            FOR UPDATE OF job SKIP LOCKED
            LIMIT 1
         )
         UPDATE daily_content_image_jobs AS job
            SET status = 'claimed',
                attempts = job.attempts + 1,
                claimed_at = $1,
                lease_expires_at = $2,
                worker_id = $3,
                attempt_token = $4
           FROM candidate,
                daily_content_productions AS production,
                content_drafts AS draft
          WHERE job.job_id = candidate.job_id
            AND production.fortune_date = job.fortune_date
            AND draft.draft_id = production.draft_id
        RETURNING job.job_id, job.fortune_date, job.image_slot, job.prompt_version,
                  job.attempts, draft.draft_id, draft.draft_revision, draft.modules`,
        [input.claimedAt, input.leaseExpiresAt, input.workerId, input.attemptToken],
      );
      await client.query("COMMIT");
      const row = claimed.rows[0];
      return row === undefined
        ? null
        : {
            attempts: Number(row.attempts),
            draftId: row.draft_id,
            draftRevision: Number(row.draft_revision),
            fortuneDate: asFortuneDate(row.fortune_date),
            imageSlot: row.image_slot,
            jobId: row.job_id,
            modules: structuredClone(row.modules as ClaimedImageProductionJob["modules"]),
            promptVersion: row.prompt_version,
          };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeImageJob(input: {
    readonly assetId: string;
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly draftRevision: number;
    readonly jobId: string;
    readonly sha256: string;
    readonly workerId: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const completion = await client.query<{
        draft_id: string;
        draft_revision: number | string;
        fortune_date: string;
        image_slot: DailyImageSlot;
        job_id: string;
        selected_asset_id: string | null;
        selection_source: string | null;
        source_job_id: string | null;
        submitted_content_version: string | null;
      }>(
        `SELECT production.draft_id, draft.draft_revision,
                draft.submitted_content_version, job.fortune_date::text,
                job.image_slot, job.job_id, selection.asset_id AS selected_asset_id,
                selection.selection_source, selection.source_job_id
           FROM daily_content_image_jobs AS job
           JOIN daily_content_image_slot_currents AS current
             ON current.current_job_id = job.job_id
            AND job.worker_id = $3 AND job.attempt_token = $4
            AND current.fortune_date = job.fortune_date
            AND current.image_slot = job.image_slot
            AND current.generation_revision = job.generation_revision
           JOIN daily_content_productions AS production
             ON production.fortune_date = job.fortune_date
           JOIN content_drafts AS draft ON draft.draft_id = production.draft_id
           JOIN draft_image_candidates AS candidate
             ON candidate.draft_id = production.draft_id
            AND candidate.asset_id = $1
            AND candidate.image_slot = job.image_slot
           LEFT JOIN draft_image_slot_selections AS selection
             ON selection.draft_id = production.draft_id
            AND selection.image_slot = job.image_slot
          WHERE job.job_id = $2 AND job.status = 'claimed'
          FOR UPDATE OF job, current, production, draft, candidate`,
        [input.assetId, input.jobId, input.workerId, input.attemptToken],
      );
      const completedJob = completion.rows[0];
      if (completedJob !== undefined) {
        const mayReplaceSelection =
          completedJob.submitted_content_version === null &&
          (completedJob.selection_source === null ||
            completedJob.selection_source === "automatic_generation");
        const selectionChanges =
          mayReplaceSelection &&
          (completedJob.selected_asset_id !== input.assetId ||
            completedJob.source_job_id !== completedJob.job_id);
        if (selectionChanges) {
          const revised = await client.query(
            `UPDATE content_drafts
                SET draft_revision = draft_revision + 1, updated_at = $3
              WHERE draft_id = $1 AND draft_revision = $2
                AND submitted_content_version IS NULL
          RETURNING draft_revision`,
            [completedJob.draft_id, completedJob.draft_revision, input.completedAt],
          );
          if (revised.rows[0] === undefined) {
            throw new Error("Image completion lost its locked editable draft");
          }
        }
        if (selectionChanges) {
          await client.query(
            `INSERT INTO draft_image_slot_selections (
             draft_id, image_slot, asset_id, selection_revision, selection_source,
             source_job_id, actor_id, reason, request_id, selected_at
           )
           SELECT
             production.draft_id, $2, $3, 1, 'automatic_generation',
             $4, 'system-content-production-worker',
             '当前图片 generation 已完成并选入自动发布素材。',
             $5, $6
           FROM daily_content_productions AS production
           WHERE production.fortune_date = $1
           ON CONFLICT (draft_id, image_slot) DO UPDATE
             SET asset_id = EXCLUDED.asset_id,
                 selection_revision = draft_image_slot_selections.selection_revision + 1,
                 selection_source = EXCLUDED.selection_source,
                 source_job_id = EXCLUDED.source_job_id,
                 actor_id = EXCLUDED.actor_id,
                 reason = EXCLUDED.reason,
                 request_id = EXCLUDED.request_id,
                 selected_at = EXCLUDED.selected_at
             WHERE draft_image_slot_selections.selection_source = 'automatic_generation'`,
            [
              completedJob.fortune_date,
              completedJob.image_slot,
              input.assetId,
              completedJob.job_id,
              `worker-image-complete-${completedJob.job_id}`,
              input.completedAt,
            ],
          );
        }
        await client.query(
          `UPDATE daily_content_image_jobs
              SET status = 'completed', completed_asset_id = $1,
                  claimed_at = NULL, lease_expires_at = NULL,
                  worker_id = NULL, attempt_token = NULL, last_error = NULL
            WHERE job_id = $2 AND status = 'claimed'
              AND worker_id = $3 AND attempt_token = $4`,
          [input.assetId, input.jobId, input.workerId, input.attemptToken],
        );
        await refreshProduction(client, completedJob.fortune_date, input.completedAt);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureGeneratedDay(input: EnsureGeneratedDayInput): Promise<EnsureGeneratedDayStoreResult> {
    const requiredJobs = new Map(input.imageJobs.map((job) => [job.imageSlot, job]));
    if (
      requiredJobs.size !== REQUIRED_IMAGE_SLOTS.length ||
      !REQUIRED_IMAGE_SLOTS.every((slot) => requiredJobs.has(slot)) ||
      requiredJobs.has("optional")
    ) {
      throw new Error("Automatic production must create exactly the two required image jobs");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `content-production:${input.idempotencyKey}`,
      ]);
      const priorKey = await client.query<{ request_hash: string }>(
        `SELECT request_hash
           FROM daily_content_production_idempotency
          WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (priorKey.rows[0] !== undefined && priorKey.rows[0].request_hash !== input.requestHash) {
        await client.query("COMMIT");
        return { kind: "idempotency_conflict" };
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `content-production-day:${input.production.fortuneDate}`,
      ]);
      const existing = await readProduction(client, input.production.fortuneDate);
      if (existing !== null) {
        await client.query(
          `INSERT INTO daily_content_production_idempotency (
             idempotency_key, fortune_date, request_hash, created_at
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [
            input.idempotencyKey,
            input.production.fortuneDate,
            input.requestHash,
            input.production.updatedAt,
          ],
        );
        await client.query("COMMIT");
        return { kind: "existing", production: existing };
      }
      await client.query(
        `INSERT INTO content_drafts (
           draft_id, fortune_date, draft_revision, modules,
           submitted_content_version, created_at, updated_at, submitted_at
         ) VALUES ($1, $2, $3, $4::jsonb, NULL, $5, $5, NULL)`,
        [
          input.draft.draftId,
          input.draft.fortuneDate,
          input.draft.draftRevision,
          JSON.stringify(input.draft.modules),
          input.draft.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO daily_content_productions (
           fortune_date, draft_id, status, completed_image_slots, pending_image_slots,
           last_error, actor_id, request_id, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.production.fortuneDate,
          input.production.draftId,
          input.production.status,
          input.production.completedImageSlots,
          input.production.pendingImageSlots,
          input.production.lastError,
          input.actorId,
          input.requestId,
          input.production.updatedAt,
        ],
      );
      for (const job of input.imageJobs) {
        await client.query(
          `INSERT INTO daily_content_image_jobs (
             job_id, fortune_date, image_slot, prompt_version, status, attempts,
             attempt_limit, generation_revision, available_at
           ) VALUES ($1, $2, $3, $4, 'queued', 0, $5, 1, $6)`,
          [
            job.jobId,
            job.fortuneDate,
            job.imageSlot,
            job.promptVersion,
            AUTOMATIC_IMAGE_ATTEMPTS_PER_CYCLE,
            input.production.updatedAt,
          ],
        );
      }
      for (const imageSlot of DAILY_IMAGE_SLOTS) {
        const job = requiredJobs.get(imageSlot);
        await client.query(
          `INSERT INTO daily_content_image_slot_currents (
             fortune_date, image_slot, current_job_id, generation_revision, updated_at
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            input.production.fortuneDate,
            imageSlot,
            job?.jobId ?? null,
            job === undefined ? 0 : 1,
            input.production.updatedAt,
          ],
        );
      }
      await client.query(
        `INSERT INTO daily_content_production_idempotency (
           idempotency_key, fortune_date, request_hash, created_at
         ) VALUES ($1, $2, $3, $4)`,
        [
          input.idempotencyKey,
          input.production.fortuneDate,
          input.requestHash,
          input.production.updatedAt,
        ],
      );
      await client.query("COMMIT");
      return { kind: "created" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listProductions(fortuneDates?: readonly string[]): Promise<DailyContentProduction[]> {
    if (fortuneDates !== undefined && fortuneDates.length === 0) return [];
    const dateFilter =
      fortuneDates === undefined ? "" : "WHERE production.fortune_date = ANY($1::date[])";
    const result = await this.pool.query<ProductionRow>(
      `SELECT ${PRODUCTION_COLUMNS}
         FROM daily_content_productions AS production
         JOIN content_drafts AS draft ON draft.draft_id = production.draft_id
         ${PRODUCTION_SLOT_PROJECTION}
         ${dateFilter}
        ORDER BY production.fortune_date`,
      fortuneDates === undefined ? [] : [[...fortuneDates]],
    );
    return result.rows.map(mapProduction);
  }

  async recordImageJobFailure(input: {
    readonly attemptToken: string;
    readonly error: string;
    readonly failedAt: string;
    readonly jobId: string;
    readonly retryAt: string;
    readonly workerId: string;
  }): Promise<ImageJobFailureResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const failed = await client.query<{ fortune_date: string; status: string }>(
        `UPDATE daily_content_image_jobs AS job
            SET status = CASE
                  WHEN job.attempts >= job.attempt_limit THEN 'failed'
                  ELSE 'retryable'
                END,
                available_at = CASE
                  WHEN job.attempts >= job.attempt_limit THEN $1::timestamptz
                  ELSE $2::timestamptz
                END,
                last_error = $3,
                claimed_at = NULL,
                lease_expires_at = NULL,
                worker_id = NULL,
                attempt_token = NULL
           FROM daily_content_image_slot_currents AS current
          WHERE job.job_id = $4 AND job.status = 'claimed'
            AND job.worker_id = $5 AND job.attempt_token = $6
            AND current.current_job_id = job.job_id
            AND current.fortune_date = job.fortune_date
            AND current.image_slot = job.image_slot
            AND current.generation_revision = job.generation_revision
        RETURNING job.fortune_date::text, job.status`,
        [
          input.failedAt,
          input.retryAt,
          input.error,
          input.jobId,
          input.workerId,
          input.attemptToken,
        ],
      );
      const row = failed.rows[0];
      if (row === undefined) {
        await client.query("COMMIT");
        return "stale";
      }
      await refreshProduction(client, row.fortune_date, input.failedAt);
      await client.query("COMMIT");
      return row.status === "failed" ? "exhausted" : "retry_scheduled";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async requestImageSlotGeneration(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly fortuneDate: string;
    readonly idempotencyKey: string;
    readonly imageJob: {
      readonly fortuneDate: string;
      readonly imageSlot: DailyImageSlot;
      readonly jobId: string;
      readonly promptVersion: string;
    };
    readonly reason: string;
    readonly requestHash: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<RequestImageSlotGenerationStoreResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `content-production:${input.idempotencyKey}`,
      ]);
      const prior = await client.query<{ request_hash: string }>(
        `SELECT request_hash FROM daily_content_production_idempotency WHERE idempotency_key = $1`,
        [input.idempotencyKey],
      );
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].request_hash !== input.requestHash) {
          await client.query("COMMIT");
          return { kind: "idempotency_conflict" };
        }
        const production = await readProduction(client, input.fortuneDate);
        await client.query("COMMIT");
        return production === null ? { kind: "not_found" } : { kind: "existing", production };
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `content-production-day:${input.fortuneDate}`,
      ]);
      const draft = await client.query<{
        draft_revision: number | string;
        submitted_content_version: string | null;
      }>(
        `SELECT draft.draft_revision, draft.submitted_content_version
           FROM daily_content_productions AS production
           JOIN content_drafts AS draft ON draft.draft_id = production.draft_id
          WHERE production.fortune_date = $1 AND production.draft_id = $2
          FOR UPDATE OF production, draft`,
        [input.fortuneDate, input.draftId],
      );
      const currentRevision = draft.rows[0]?.draft_revision;
      if (currentRevision === undefined) {
        await client.query("COMMIT");
        return { kind: "not_found" };
      }
      if (draft.rows[0]?.submitted_content_version !== null) {
        await client.query("COMMIT");
        return { kind: "invalid_state" };
      }
      if (Number(currentRevision) !== input.expectedDraftRevision) {
        await client.query("COMMIT");
        return { currentRevision: Number(currentRevision), kind: "revision_mismatch" };
      }
      const current = await client.query<{
        current_job_id: string | null;
        generation_revision: number | string;
        status: string | null;
      }>(
        `SELECT current.current_job_id, current.generation_revision, job.status
           FROM daily_content_image_slot_currents AS current
           LEFT JOIN daily_content_image_jobs AS job ON job.job_id = current.current_job_id
          WHERE current.fortune_date = $1 AND current.image_slot = $2
          FOR UPDATE OF current`,
        [input.fortuneDate, input.imageJob.imageSlot],
      );
      const currentRow = current.rows[0];
      if (currentRow === undefined) {
        await client.query("COMMIT");
        return { kind: "not_found" };
      }
      if (
        currentRow.status === "queued" ||
        currentRow.status === "retryable" ||
        currentRow.status === "claimed"
      ) {
        await client.query("COMMIT");
        return { kind: "invalid_state" };
      }
      const historicalGeneration = await client.query<{ generation_revision: number | string }>(
        `SELECT COALESCE(MAX(generation_revision), 0) AS generation_revision
           FROM daily_content_image_jobs
          WHERE fortune_date = $1 AND image_slot = $2`,
        [input.fortuneDate, input.imageJob.imageSlot],
      );
      const generationRevision = Number(historicalGeneration.rows[0]?.generation_revision ?? 0) + 1;
      await client.query(
        `INSERT INTO daily_content_image_jobs (
           job_id, fortune_date, image_slot, prompt_version, status, attempts,
           attempt_limit, generation_revision, available_at, last_error
         ) VALUES ($1, $2, $3, $4, 'queued', 0, $5, $6, $7, NULL)`,
        [
          input.imageJob.jobId,
          input.fortuneDate,
          input.imageJob.imageSlot,
          input.imageJob.promptVersion,
          AUTOMATIC_IMAGE_ATTEMPTS_PER_CYCLE,
          generationRevision,
          input.requestedAt,
        ],
      );
      await client.query(
        `UPDATE daily_content_image_slot_currents
            SET current_job_id = $3, generation_revision = $4, updated_at = $5
          WHERE fortune_date = $1 AND image_slot = $2`,
        [
          input.fortuneDate,
          input.imageJob.imageSlot,
          input.imageJob.jobId,
          generationRevision,
          input.requestedAt,
        ],
      );
      await client.query(
        `UPDATE daily_content_productions
            SET actor_id = $2, request_id = $3
          WHERE fortune_date = $1`,
        [input.fortuneDate, input.actorId, input.requestId],
      );
      await refreshProduction(client, input.fortuneDate, input.requestedAt);
      await client.query(
        `INSERT INTO daily_content_production_idempotency (
           idempotency_key, fortune_date, request_hash, created_at
         ) VALUES ($1, $2, $3, $4)`,
        [input.idempotencyKey, input.fortuneDate, input.requestHash, input.requestedAt],
      );
      const production = await readProduction(client, input.fortuneDate);
      if (production === null) throw new Error("Generated content production disappeared");
      await client.query("COMMIT");
      return { kind: "requested", production };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
