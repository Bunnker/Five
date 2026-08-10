import type { Pool, PoolClient } from "pg";

import type {
  DayCorrectionStore,
  StoredDayCorrection,
  StoredDayCorrectionOpenIntent,
} from "./day-correction.store";

interface DayCorrectionRow {
  applied_action: unknown;
  apply_draft_revision: number | string | null;
  apply_idempotency_key_hash: string | null;
  apply_request_hash: string | null;
  apply_mode: StoredDayCorrection["applyMode"];
  apply_started_revision: number | string | null;
  baseline_active_content_version: string | null;
  baseline_lifecycle_revision: number | string;
  correction_id: string;
  correction_revision: number | string;
  created_at: Date | string;
  draft_id: string;
  fortune_date: string;
  scheduled_effective_from: Date | string | null;
  source_content_version: string | null;
  source_draft_id: string | null;
  status: StoredDayCorrection["status"];
  submitted_content_version: string | null;
  submitted_lifecycle_revision: number | string | null;
  terminal_failure: unknown;
  updated_at: Date | string;
}

interface OpenIntentRow {
  baseline_active_content_version: string | null;
  baseline_lifecycle_revision: number | string;
  correction_id: string;
  created_at: Date | string;
  draft_id: string;
  expires_at: Date | string;
  fortune_date: string;
  source_content_version: string | null;
  source_draft_id: string | null;
}

const COLUMNS = `
  correction_id,
  fortune_date::text,
  draft_id,
  source_content_version,
  source_draft_id,
  baseline_active_content_version,
  baseline_lifecycle_revision,
  correction_revision,
  status,
  apply_started_revision,
  apply_draft_revision,
  apply_idempotency_key_hash,
  apply_request_hash,
  apply_mode,
  scheduled_effective_from,
  submitted_content_version,
  submitted_lifecycle_revision,
  applied_action,
  terminal_failure,
  created_at,
  updated_at
`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function mapRow(row: DayCorrectionRow): StoredDayCorrection {
  return {
    appliedAction:
      row.applied_action === null
        ? null
        : structuredClone(row.applied_action as NonNullable<StoredDayCorrection["appliedAction"]>),
    applyDraftRevision: nullableNumber(row.apply_draft_revision),
    applyIdempotencyKeyHash: row.apply_idempotency_key_hash,
    applyRequestHash: row.apply_request_hash,
    applyMode: row.apply_mode,
    applyStartedRevision: nullableNumber(row.apply_started_revision),
    baselineActiveContentVersion: row.baseline_active_content_version,
    baselineLifecycleRevision: Number(row.baseline_lifecycle_revision),
    correctionId: row.correction_id,
    correctionRevision: Number(row.correction_revision),
    createdAt: iso(row.created_at),
    draftId: row.draft_id,
    fortuneDate: row.fortune_date,
    scheduledEffectiveFrom: nullableIso(row.scheduled_effective_from),
    sourceContentVersion: row.source_content_version,
    sourceDraftId: row.source_draft_id,
    status: row.status,
    submittedContentVersion: row.submitted_content_version,
    submittedLifecycleRevision: nullableNumber(row.submitted_lifecycle_revision),
    terminalFailure:
      row.terminal_failure === null ? null : structuredClone(row.terminal_failure as object),
    updatedAt: iso(row.updated_at),
  };
}

function mapOpenIntent(row: OpenIntentRow): StoredDayCorrectionOpenIntent {
  return {
    baselineActiveContentVersion: row.baseline_active_content_version,
    baselineLifecycleRevision: Number(row.baseline_lifecycle_revision),
    correctionId: row.correction_id,
    createdAt: iso(row.created_at),
    draftId: row.draft_id,
    expiresAt: iso(row.expires_at),
    fortuneDate: row.fortune_date,
    sourceContentVersion: row.source_content_version,
    sourceDraftId: row.source_draft_id,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

export class PostgresDayCorrectionStore implements DayCorrectionStore {
  private readonly openFortuneDateLockTails = new Map<string, Promise<void>>();

  constructor(private readonly pool: Pool) {}

  async abandonApply(
    input: Parameters<DayCorrectionStore["abandonApply"]>[0],
  ): ReturnType<DayCorrectionStore["abandonApply"]> {
    const result = await this.pool.query<DayCorrectionRow>(
      `UPDATE day_corrections
          SET status = 'open',
              correction_revision = correction_revision + 1,
              apply_started_revision = NULL,
              apply_draft_revision = NULL,
              apply_idempotency_key_hash = NULL,
              apply_request_hash = NULL,
              apply_mode = NULL,
              scheduled_effective_from = NULL,
              updated_at = $3::timestamptz
        WHERE correction_id = $1
          AND correction_revision = $2
          AND status = 'applying'
          AND submitted_content_version IS NULL
      RETURNING ${COLUMNS}`,
      [input.correctionId, input.expectedCorrectionRevision, input.updatedAt],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapRow(row);
  }

  async discardOpenIntent(
    input: Parameters<DayCorrectionStore["discardOpenIntent"]>[0],
  ): ReturnType<DayCorrectionStore["discardOpenIntent"]> {
    await this.pool.query(
      `DELETE FROM day_correction_open_intents
        WHERE fortune_date = $1::date
          AND correction_id = $2
          AND draft_id = $3`,
      [input.fortuneDate, input.correctionId, input.draftId],
    );
  }

  async beginApply(
    input: Parameters<DayCorrectionStore["beginApply"]>[0],
  ): ReturnType<DayCorrectionStore["beginApply"]> {
    return this.transaction(async (client) => {
      const current = await this.findForUpdate(client, input.correctionId);
      if (current === null) return { kind: "not_found" } as const;
      if (current.status === "applying" || current.status === "submitted") {
        if (
          current.applyIdempotencyKeyHash !== input.applyIdempotencyKeyHash ||
          current.applyRequestHash !== input.applyRequestHash ||
          current.applyMode !== input.applyMode ||
          current.applyDraftRevision !== input.applyDraftRevision ||
          current.scheduledEffectiveFrom !== input.scheduledEffectiveFrom
        ) {
          return { kind: "idempotency_conflict" } as const;
        }
        return { correction: current, kind: "existing" } as const;
      }
      if (current.status !== "open") return { kind: "invalid_state" } as const;
      if (current.correctionRevision !== input.expectedCorrectionRevision) {
        return {
          currentRevision: current.correctionRevision,
          kind: "revision_mismatch",
        } as const;
      }
      const result = await client.query<DayCorrectionRow>(
        `UPDATE day_corrections
            SET status = 'applying',
                correction_revision = correction_revision + 1,
                apply_started_revision = correction_revision,
                apply_draft_revision = $2,
                apply_idempotency_key_hash = $3,
                apply_request_hash = $4,
                apply_mode = $5,
                scheduled_effective_from = $6::timestamptz,
                updated_at = $7::timestamptz
          WHERE correction_id = $1
        RETURNING ${COLUMNS}`,
        [
          input.correctionId,
          input.applyDraftRevision,
          input.applyIdempotencyKeyHash,
          input.applyRequestHash,
          input.applyMode,
          input.scheduledEffectiveFrom,
          input.updatedAt,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) return { kind: "not_found" } as const;
      return { correction: mapRow(row), kind: "started" } as const;
    });
  }

  async findById(correctionId: string): Promise<StoredDayCorrection | null> {
    const result = await this.pool.query<DayCorrectionRow>(
      `SELECT ${COLUMNS} FROM day_corrections WHERE correction_id = $1`,
      [correctionId],
    );
    return result.rows[0] === undefined ? null : mapRow(result.rows[0]);
  }

  async findOpenByFortuneDate(fortuneDate: string): Promise<StoredDayCorrection | null> {
    const result = await this.pool.query<DayCorrectionRow>(
      `SELECT ${COLUMNS}
         FROM day_corrections
        WHERE fortune_date = $1::date
          AND status IN ('open', 'applying', 'submitted')`,
      [fortuneDate],
    );
    return result.rows[0] === undefined ? null : mapRow(result.rows[0]);
  }

  async hasOpenOwnership(fortuneDate: string, now: Date): Promise<boolean> {
    const result = await this.pool.query<{ owned: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM day_corrections
          WHERE fortune_date = $1::date
            AND status IN ('open', 'applying', 'submitted')
            AND updated_at > $2::timestamptz - interval '15 minutes'
         UNION ALL
         SELECT 1 FROM day_correction_open_intents
          WHERE fortune_date = $1::date
            AND expires_at > $2::timestamptz
       ) AS owned`,
      [fortuneDate, now.toISOString()],
    );
    return result.rows[0]?.owned ?? false;
  }

  async finalizeOpenIntent(correction: StoredDayCorrection): Promise<StoredDayCorrection> {
    return this.transaction(async (client) => {
      const reserved = await client.query<OpenIntentRow>(
        `SELECT correction_id, draft_id, fortune_date::text, source_content_version, source_draft_id,
                baseline_active_content_version, baseline_lifecycle_revision, created_at, expires_at
           FROM day_correction_open_intents
          WHERE fortune_date = $1::date
          FOR UPDATE`,
        [correction.fortuneDate],
      );
      const intent = reserved.rows[0];
      if (
        intent === undefined ||
        intent.correction_id !== correction.correctionId ||
        intent.draft_id !== correction.draftId
      ) {
        const recovered = await client.query<DayCorrectionRow>(
          `SELECT ${COLUMNS}
             FROM day_corrections
            WHERE correction_id = $1
              AND draft_id = $2
              AND fortune_date = $3::date`,
          [correction.correctionId, correction.draftId, correction.fortuneDate],
        );
        const recoveredRow = recovered.rows[0];
        if (recoveredRow !== undefined) return mapRow(recoveredRow);
        throw new Error("Day correction open intent is missing or does not own the draft");
      }
      const inserted = await client.query<DayCorrectionRow>(
        `INSERT INTO day_corrections (
           correction_id, fortune_date, draft_id, source_content_version,
           baseline_active_content_version, baseline_lifecycle_revision,
           correction_revision, status, apply_started_revision, apply_draft_revision,
           apply_idempotency_key_hash, apply_request_hash, apply_mode, scheduled_effective_from,
           submitted_content_version, submitted_lifecycle_revision, applied_action,
           terminal_failure, created_at, updated_at, source_draft_id
         ) VALUES (
           $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14::timestamptz, $15, $16, $17::jsonb, $18::jsonb,
           $19::timestamptz, $20::timestamptz, $21
         )
         ON CONFLICT (fortune_date)
           WHERE status IN ('open', 'applying', 'submitted')
           DO NOTHING
         RETURNING ${COLUMNS}`,
        [
          correction.correctionId,
          correction.fortuneDate,
          correction.draftId,
          correction.sourceContentVersion,
          correction.baselineActiveContentVersion,
          correction.baselineLifecycleRevision,
          correction.correctionRevision,
          correction.status,
          correction.applyStartedRevision,
          correction.applyDraftRevision,
          correction.applyIdempotencyKeyHash,
          correction.applyRequestHash,
          correction.applyMode,
          correction.scheduledEffectiveFrom,
          correction.submittedContentVersion,
          correction.submittedLifecycleRevision,
          correction.appliedAction === null ? null : JSON.stringify(correction.appliedAction),
          correction.terminalFailure === null || correction.terminalFailure === undefined
            ? null
            : JSON.stringify(correction.terminalFailure),
          correction.createdAt,
          correction.updatedAt,
          correction.sourceDraftId ?? null,
        ],
      );
      const row = inserted.rows[0];
      if (row !== undefined) {
        await client.query(
          `DELETE FROM day_correction_open_intents
            WHERE fortune_date = $1::date
              AND correction_id = $2
              AND draft_id = $3`,
          [correction.fortuneDate, correction.correctionId, correction.draftId],
        );
        return mapRow(row);
      }
      const existing = await client.query<DayCorrectionRow>(
        `SELECT ${COLUMNS}
           FROM day_corrections
          WHERE fortune_date = $1::date
            AND status IN ('open', 'applying', 'submitted')
          FOR UPDATE`,
        [correction.fortuneDate],
      );
      const existingRow = existing.rows[0];
      if (existingRow === undefined) {
        throw new Error("Day correction uniqueness conflict resolved without an open row");
      }
      await client.query(
        `DELETE FROM day_correction_open_intents
          WHERE fortune_date = $1::date
            AND correction_id = $2
            AND draft_id = $3`,
        [correction.fortuneDate, correction.correctionId, correction.draftId],
      );
      return mapRow(existingRow);
    });
  }

  async reserveOrGetOpenIntent(
    intent: StoredDayCorrectionOpenIntent,
  ): ReturnType<DayCorrectionStore["reserveOrGetOpenIntent"]> {
    return this.transaction(async (client) => {
      await client.query(
        `DELETE FROM day_correction_open_intents
          WHERE fortune_date = $1::date
            AND expires_at <= $2::timestamptz`,
        [intent.fortuneDate, intent.createdAt],
      );
      const reserved = await client.query<OpenIntentRow>(
        `INSERT INTO day_correction_open_intents (
           fortune_date, correction_id, draft_id, source_content_version,
           baseline_active_content_version, baseline_lifecycle_revision, created_at
           , source_draft_id, expires_at
         ) VALUES ($1::date, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::timestamptz)
         ON CONFLICT (fortune_date) DO NOTHING
         RETURNING correction_id, draft_id, fortune_date::text, source_content_version, source_draft_id,
                   baseline_active_content_version, baseline_lifecycle_revision, created_at, expires_at`,
        [
          intent.fortuneDate,
          intent.correctionId,
          intent.draftId,
          intent.sourceContentVersion,
          intent.baselineActiveContentVersion,
          intent.baselineLifecycleRevision,
          intent.createdAt,
          intent.sourceDraftId ?? null,
          intent.expiresAt ??
            new Date(Date.parse(intent.createdAt) + 15 * 60 * 1_000).toISOString(),
        ],
      );
      const row = reserved.rows[0];
      if (row !== undefined) return mapOpenIntent(row);
      const existing = await client.query<OpenIntentRow>(
        `SELECT correction_id, draft_id, fortune_date::text, source_content_version, source_draft_id,
                baseline_active_content_version, baseline_lifecycle_revision, created_at, expires_at
           FROM day_correction_open_intents
          WHERE fortune_date = $1::date
          FOR UPDATE`,
        [intent.fortuneDate],
      );
      const existingRow = existing.rows[0];
      if (existingRow === undefined) {
        throw new Error("Day correction open intent conflict resolved without a row");
      }
      return mapOpenIntent(existingRow);
    });
  }

  async renewOpenOwnership(correctionId: string, updatedAt: string): Promise<void> {
    await this.pool.query(
      `UPDATE day_corrections
          SET updated_at = $2::timestamptz
        WHERE correction_id = $1
          AND status = 'open'`,
      [correctionId, updatedAt],
    );
  }

  async withOpenFortuneDateLock<T>(fortuneDate: string, work: () => Promise<T>): Promise<T> {
    return this.withLocalOpenLock(fortuneDate, async () => {
      const client = await this.pool.connect();
      const lockName = `five:day-correction:open:${fortuneDate}`;
      let locked = false;
      try {
        await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockName]);
        locked = true;
        return await work();
      } finally {
        if (locked) {
          await client
            .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockName])
            .catch(() => undefined);
        }
        client.release();
      }
    });
  }

  async recordApplied(
    input: Parameters<DayCorrectionStore["recordApplied"]>[0],
  ): ReturnType<DayCorrectionStore["recordApplied"]> {
    const result = await this.pool.query<DayCorrectionRow>(
      `UPDATE day_corrections
          SET status = 'applied',
              correction_revision = correction_revision + 1,
              applied_action = $3::jsonb,
              updated_at = $4::timestamptz
        WHERE correction_id = $1
          AND correction_revision = $2
          AND status = 'submitted'
      RETURNING ${COLUMNS}`,
      [
        input.correctionId,
        input.expectedCorrectionRevision,
        JSON.stringify(input.action),
        input.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (row !== undefined) return mapRow(row);
    const current = await this.findById(input.correctionId);
    return current?.status === "applied" ? current : null;
  }

  async recordAbandoned(
    input: Parameters<DayCorrectionStore["recordAbandoned"]>[0],
  ): ReturnType<DayCorrectionStore["recordAbandoned"]> {
    const result = await this.pool.query<DayCorrectionRow>(
      `UPDATE day_corrections
          SET status = 'abandoned',
              correction_revision = correction_revision + 1,
              terminal_failure = $3::jsonb,
              updated_at = $4::timestamptz
        WHERE correction_id = $1
          AND correction_revision = $2
          AND status = 'submitted'
      RETURNING ${COLUMNS}`,
      [
        input.correctionId,
        input.expectedCorrectionRevision,
        JSON.stringify(input.failure),
        input.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (row !== undefined) return mapRow(row);
    const current = await this.findById(input.correctionId);
    return current?.status === "abandoned" ? current : null;
  }

  async recordSubmitted(
    input: Parameters<DayCorrectionStore["recordSubmitted"]>[0],
  ): ReturnType<DayCorrectionStore["recordSubmitted"]> {
    const result = await this.pool.query<DayCorrectionRow>(
      `UPDATE day_corrections
          SET status = 'submitted',
              correction_revision = correction_revision + 1,
              submitted_content_version = $3,
              submitted_lifecycle_revision = $4,
              updated_at = $5::timestamptz
        WHERE correction_id = $1
          AND correction_revision = $2
          AND status = 'applying'
      RETURNING ${COLUMNS}`,
      [
        input.correctionId,
        input.expectedCorrectionRevision,
        input.contentVersion,
        input.lifecycleRevision,
        input.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (row !== undefined) return mapRow(row);
    const current = await this.findById(input.correctionId);
    return current?.status === "submitted" &&
      current.submittedContentVersion === input.contentVersion &&
      current.submittedLifecycleRevision === input.lifecycleRevision
      ? current
      : null;
  }

  async refreshApplyMode(
    input: Parameters<DayCorrectionStore["refreshApplyMode"]>[0],
  ): ReturnType<DayCorrectionStore["refreshApplyMode"]> {
    const result = await this.pool.query<DayCorrectionRow>(
      `UPDATE day_corrections
          SET correction_revision = correction_revision + 1,
              apply_mode = $3,
              apply_request_hash = $4,
              scheduled_effective_from = $5::timestamptz,
              updated_at = $6::timestamptz
        WHERE correction_id = $1
          AND correction_revision = $2
          AND status IN ('applying', 'submitted')
      RETURNING ${COLUMNS}`,
      [
        input.correctionId,
        input.expectedCorrectionRevision,
        input.applyMode,
        input.applyRequestHash,
        input.scheduledEffectiveFrom,
        input.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (row !== undefined) return mapRow(row);
    const current = await this.findById(input.correctionId);
    return current !== null &&
      (current.status === "applying" || current.status === "submitted") &&
      current.correctionRevision === input.expectedCorrectionRevision &&
      current.applyMode === input.applyMode &&
      current.applyRequestHash === input.applyRequestHash &&
      current.scheduledEffectiveFrom === input.scheduledEffectiveFrom
      ? current
      : null;
  }

  private async findForUpdate(
    client: Pick<PoolClient, "query">,
    correctionId: string,
  ): Promise<StoredDayCorrection | null> {
    const result = await client.query<DayCorrectionRow>(
      `SELECT ${COLUMNS} FROM day_corrections WHERE correction_id = $1 FOR UPDATE`,
      [correctionId],
    );
    return result.rows[0] === undefined ? null : mapRow(result.rows[0]);
  }

  private async withLocalOpenLock<T>(fortuneDate: string, work: () => Promise<T>): Promise<T> {
    const previous = this.openFortuneDateLockTails.get(fortuneDate) ?? Promise.resolve();
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    this.openFortuneDateLockTails.set(fortuneDate, tail);
    await previous;
    try {
      return await work();
    } finally {
      releaseCurrent?.();
      if (this.openFortuneDateLockTails.get(fortuneDate) === tail) {
        this.openFortuneDateLockTails.delete(fortuneDate);
      }
    }
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
