import type { Pool, PoolClient } from "pg";

import type {
  ClaimPosterAssetGarbageInput,
  CompletePosterJobInput,
  ClaimPosterJobInput,
  CreateOrReusePosterJobResult,
  CreatePosterJobRecordInput,
  FindIdempotentPosterJobResult,
  MarkPosterVersionChangedInput,
  PosterJobRecord,
  PosterJobRepository,
  RecordPosterFailureInput,
  ReservePosterAssetInput,
} from "./poster-job.repository";

interface PosterJobRow {
  asset_key: string | null;
  asset_url: string | null;
  attempt_token: string | null;
  attempts: number;
  channel_id: string;
  current_active_content_version: string | null;
  fortune_date: string;
  job_id: string;
  landing_url: string;
  locked_by: string | null;
  poster_instance_id: string | null;
  poster_template_version: string;
  source_content_version: string;
  status: PosterJobRecord["status"];
}

const CALLER_SCOPE = "anonymous-web";
const ENDPOINT = "/api/v1/poster-jobs";
const QUEUE_CAPACITY_LOCK = "poster-jobs:queue-capacity";
const RETURNING_JOB = `
  job_id,
  fortune_date::text,
  source_content_version,
  current_active_content_version,
  poster_template_version,
  channel_id,
  status,
  poster_instance_id,
  asset_key,
  asset_url,
  attempt_token,
  landing_url,
  attempts,
  locked_by
`;

function mapRow(row: PosterJobRow): PosterJobRecord {
  return {
    assetKey: row.asset_key,
    assetUrl: row.asset_url,
    attemptToken: row.attempt_token,
    attempts: row.attempts,
    channelId: row.channel_id,
    currentActiveContentVersion: row.current_active_content_version,
    entry:
      row.status === "ready"
        ? {
            landingUrl: row.landing_url,
            type: "web_qr",
          }
        : null,
    fortuneDate: row.fortune_date,
    jobId: row.job_id,
    landingUrl: row.landing_url,
    lockedBy: row.locked_by,
    posterInstanceId: row.poster_instance_id,
    posterTemplateVersion: row.poster_template_version,
    sourceContentVersion: row.source_content_version,
    status: row.status,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

export class PostgresPosterJobRepository implements PosterJobRepository {
  constructor(
    private readonly pool: Pick<Pool, "connect" | "query">,
    private readonly queueCapacity = 100,
  ) {}

  async createOrReuse(input: CreatePosterJobRecordInput): Promise<CreateOrReusePosterJobResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${CALLER_SCOPE}:${ENDPOINT}:${input.idempotencyKey}`,
      ]);

      const idempotent = await client.query<PosterJobRow & { request_hash: string }>(
        `SELECT i.request_hash, j.*
           FROM poster_job_idempotency i
           JOIN poster_jobs j ON j.job_id = i.job_id
          WHERE i.caller_scope = $1 AND i.endpoint = $2 AND i.idempotency_key = $3`,
        [CALLER_SCOPE, ENDPOINT, input.idempotencyKey],
      );
      const prior = idempotent.rows[0];
      if (prior !== undefined) {
        await client.query("COMMIT");
        return prior.request_hash === input.requestHash
          ? { kind: "existing", record: mapRow(prior) }
          : { kind: "idempotency_conflict" };
      }

      // All creators take one transaction-scoped lock before reading capacity and inserting.
      // Replays were handled above, so a full queue cannot block an existing idempotent result.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        QUEUE_CAPACITY_LOCK,
      ]);

      const reusable = await client.query<PosterJobRow>(
        `SELECT ${RETURNING_JOB}
           FROM poster_jobs
          WHERE source_content_version = $1
            AND poster_template_version = $2
            AND channel_id = $3
            AND status IN ('processing', 'ready')
          ORDER BY created_at
          LIMIT 1`,
        [input.expectedContentVersion, input.posterTemplateVersion, input.channelId],
      );
      let record = reusable.rows[0];
      if (record !== undefined) {
        await client.query(
          `INSERT INTO poster_job_idempotency (
             caller_scope, endpoint, idempotency_key, request_hash, job_id
           ) VALUES ($1, $2, $3, $4, $5)`,
          [CALLER_SCOPE, ENDPOINT, input.idempotencyKey, input.requestHash, record.job_id],
        );
        await client.query("COMMIT");
        return { kind: "existing", record: mapRow(record) };
      }

      const queued = await client.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM poster_jobs WHERE status = 'processing'",
      );
      if ((queued.rows[0]?.count ?? 0) >= this.queueCapacity) {
        await client.query("COMMIT");
        return { kind: "rate_limited", queueCapacity: this.queueCapacity };
      }

      const inserted = await client.query<PosterJobRow>(
        `INSERT INTO poster_jobs (
           job_id, fortune_date, source_content_version, current_active_content_version,
           poster_template_version, channel_id, landing_url
         ) VALUES ($1, $2::date, $3, $4, $5, $6, $7)
         RETURNING ${RETURNING_JOB}`,
        [
          input.jobId,
          input.fortuneDate,
          input.expectedContentVersion,
          input.currentActiveContentVersion,
          input.posterTemplateVersion,
          input.channelId,
          input.landingUrl,
        ],
      );
      record = inserted.rows[0];
      if (record === undefined) {
        throw new Error("Poster job insert did not return the created row");
      }

      await client.query(
        `INSERT INTO poster_job_idempotency (
           caller_scope, endpoint, idempotency_key, request_hash, job_id
         ) VALUES ($1, $2, $3, $4, $5)`,
        [CALLER_SCOPE, ENDPOINT, input.idempotencyKey, input.requestHash, record.job_id],
      );
      await client.query("COMMIT");
      return { kind: "created", record: mapRow(record) };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(jobId: string): Promise<PosterJobRecord | null> {
    const result = await this.pool.query<PosterJobRow>(
      `SELECT ${RETURNING_JOB} FROM poster_jobs WHERE job_id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRow(row);
  }

  async findByIdempotency(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<FindIdempotentPosterJobResult> {
    const result = await this.pool.query<PosterJobRow & { request_hash: string }>(
      `SELECT i.request_hash, j.*
         FROM poster_job_idempotency i
         JOIN poster_jobs j ON j.job_id = i.job_id
        WHERE i.caller_scope = $1 AND i.endpoint = $2 AND i.idempotency_key = $3`,
      [CALLER_SCOPE, ENDPOINT, idempotencyKey],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { kind: "missing" };
    }
    return row.request_hash === requestHash
      ? { kind: "existing", record: mapRow(row) }
      : { kind: "idempotency_conflict" };
  }

  async claimNext(input: ClaimPosterJobInput): Promise<PosterJobRecord | null> {
    const result = await this.pool.query<PosterJobRow>(
      `WITH candidate AS (
         SELECT job_id
           FROM poster_jobs
          WHERE status = 'processing'
            AND (
              (locked_at IS NULL AND available_at <= now())
              OR locked_at < now() - interval '5 minutes'
            )
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE poster_jobs j
          SET attempts = attempts + 1,
              locked_at = now(),
              locked_by = $1,
              attempt_token = $2,
              updated_at = now()
         FROM candidate
        WHERE j.job_id = candidate.job_id
       RETURNING
         j.job_id,
         j.fortune_date::text,
         j.source_content_version,
         j.current_active_content_version,
         j.poster_template_version,
         j.channel_id,
         j.status,
         j.poster_instance_id,
         j.asset_key,
         j.asset_url,
         j.attempt_token,
         j.landing_url,
         j.attempts,
         j.locked_by`,
      [input.workerId, input.attemptToken],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRow(row);
  }

  async claimGarbageAssetKeys(input: ClaimPosterAssetGarbageInput): Promise<string[]> {
    const result = await this.pool.query<{ asset_key: string }>(
      `WITH candidates AS (
         SELECT reservation.asset_key
           FROM poster_asset_reservations reservation
           JOIN poster_jobs job ON job.job_id = reservation.job_id
          WHERE NOT (
                  job.status = 'processing'
              AND job.locked_by = reservation.locked_by
              AND job.attempt_token = reservation.attempt_token
          )
            AND (
              reservation.last_cleanup_at IS NULL
              OR reservation.last_cleanup_at < now() - interval '5 minutes'
            )
          ORDER BY reservation.last_cleanup_at NULLS FIRST, reservation.created_at
          FOR UPDATE OF reservation SKIP LOCKED
          LIMIT $1
       )
       UPDATE poster_asset_reservations reservation
          SET last_cleanup_at = now()
         FROM candidates
        WHERE reservation.asset_key = candidates.asset_key
       RETURNING reservation.asset_key`,
      [input.limit],
    );
    return result.rows.map((row) => row.asset_key);
  }

  async acknowledgeGarbageAsset(assetKey: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM poster_asset_reservations reservation
        USING poster_jobs job
        WHERE reservation.asset_key = $1
          AND reservation.job_id = job.job_id
          AND reservation.last_cleanup_at IS NOT NULL
          AND NOT (
                job.status = 'processing'
            AND job.locked_by = reservation.locked_by
            AND job.attempt_token = reservation.attempt_token
          )`,
      [assetKey],
    );
    return result.rowCount === 1;
  }

  async findRetainedAssetKeys(assetKeys: readonly string[]): Promise<string[]> {
    if (assetKeys.length === 0) {
      return [];
    }
    const result = await this.pool.query<{ asset_key: string }>(
      `SELECT asset_key
         FROM poster_asset_reservations
        WHERE asset_key = ANY($1::text[])
       UNION
       SELECT asset_key
         FROM poster_jobs
        WHERE status = 'ready'
          AND asset_key = ANY($1::text[])`,
      [assetKeys],
    );
    return result.rows.map((row) => row.asset_key);
  }

  async reserveAsset(input: ReservePosterAssetInput): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO poster_asset_reservations (
         asset_key, job_id, locked_by, attempt_token
       )
       SELECT $1::varchar(200), job_id, $2::varchar(128), $3::varchar(128)
         FROM poster_jobs
        WHERE job_id = $4::varchar(128)
          AND status = 'processing'
          AND locked_by = $2::varchar(128)
          AND attempt_token = $3::varchar(128)
       ON CONFLICT (asset_key) DO UPDATE
         SET asset_key = EXCLUDED.asset_key
       WHERE poster_asset_reservations.job_id = EXCLUDED.job_id
         AND poster_asset_reservations.locked_by = EXCLUDED.locked_by
         AND poster_asset_reservations.attempt_token = EXCLUDED.attempt_token
       RETURNING asset_key`,
      [input.assetKey, input.workerId, input.attemptToken, input.jobId],
    );
    return result.rowCount === 1;
  }

  async completeReady(input: CompletePosterJobInput): Promise<boolean> {
    const result = await this.pool.query<{ completed: boolean }>(
      `WITH reservation AS (
         SELECT asset_key
           FROM poster_asset_reservations
          WHERE asset_key = $1
            AND job_id = $5
            AND locked_by = $6
            AND attempt_token = $7
          FOR UPDATE
       ), completed AS (
         UPDATE poster_jobs
            SET asset_key = $1,
                asset_url = $2,
                current_active_content_version = $3,
                poster_instance_id = $4,
                status = 'ready',
                locked_at = NULL,
                locked_by = NULL,
                attempt_token = NULL,
                last_error = NULL,
                updated_at = now()
          WHERE job_id = $5
            AND status = 'processing'
            AND locked_by = $6
            AND attempt_token = $7
            AND EXISTS (SELECT 1 FROM reservation)
         RETURNING job_id
       ), released AS (
         DELETE FROM poster_asset_reservations reservation
          USING completed
          WHERE reservation.asset_key = $1
            AND reservation.job_id = completed.job_id
            AND reservation.locked_by = $6
            AND reservation.attempt_token = $7
         RETURNING reservation.asset_key
       )
       SELECT EXISTS (SELECT 1 FROM released) AS completed`,
      [
        input.assetKey,
        input.assetUrl,
        input.currentActiveContentVersion,
        input.posterInstanceId,
        input.jobId,
        input.workerId,
        input.attemptToken,
      ],
    );
    return result.rows[0]?.completed === true;
  }

  async markVersionChanged(input: MarkPosterVersionChangedInput): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE poster_jobs
          SET current_active_content_version = $1,
              status = 'version_changed',
              locked_at = NULL,
              locked_by = NULL,
              attempt_token = NULL,
              last_error = NULL,
              updated_at = now()
        WHERE job_id = $2
          AND status = 'processing'
          AND locked_by = $3
          AND attempt_token = $4`,
      [input.currentActiveContentVersion, input.jobId, input.workerId, input.attemptToken],
    );
    return result.rowCount === 1;
  }

  async recordFailure(input: RecordPosterFailureInput): Promise<"failed" | "lost" | "retrying"> {
    const result = await this.pool.query<{ status: PosterJobRecord["status"] }>(
      `UPDATE poster_jobs
          SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'processing' END,
              available_at = CASE
                WHEN attempts >= $1 THEN available_at
                ELSE now() + make_interval(secs => LEAST(attempts, 6) * 5)
              END,
              locked_at = NULL,
              locked_by = NULL,
              attempt_token = NULL,
              last_error = $2,
              updated_at = now()
        WHERE job_id = $3
          AND status = 'processing'
          AND locked_by = $4
          AND attempt_token = $5
       RETURNING status`,
      [
        input.maxAttempts,
        input.errorMessage.slice(0, 2_000),
        input.jobId,
        input.workerId,
        input.attemptToken,
      ],
    );
    const status = result.rows[0]?.status;
    return status === undefined ? "lost" : status === "failed" ? "failed" : "retrying";
  }
}
