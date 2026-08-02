import type { Pool, PoolClient } from "pg";

import type {
  AuditCursor,
  ContentDraft,
  ContentDraftSummary,
  ContentLifecycleStore,
  ContentLifecycleTransaction,
  ContentState,
  ContentVersionListReadView,
  ContentVersionReadView,
  DraftModules,
  IdempotencyOperation,
  LifecycleProjection,
  PreflightCheck,
  StoredAuditEvent,
  StoredContentVersion,
  StoredDraft,
  StoredLifecycleIdempotency,
  StoredMasterReviewEvidence,
} from "./content-lifecycle.store";

interface DraftRow {
  created_at: Date | string;
  draft_id: string;
  draft_revision: number | string;
  fortune_date: string;
  modules: unknown;
  submitted_content_version: string | null;
  updated_at: Date | string;
}

interface ProjectionRow {
  active_content_version: string | null;
  fortune_date: string;
  lifecycle_revision: number | string;
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
  state: Exclude<ContentState, "draft">;
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

interface IdempotencyRow {
  idempotency_key: string;
  operation: IdempotencyOperation;
  request_hash: string;
  resource_id: string;
  response_json: unknown;
}

interface AuditRow {
  action: string;
  actor_id: string;
  audit_event_id: string;
  content_version: string;
  fortune_date: string;
  from_state: ContentState | null;
  idempotency_key: string;
  occurred_at: Date | string;
  reason: string;
  request_id: string;
  to_state: ContentState;
}

const DRAFT_COLUMNS = `
  draft_id,
  fortune_date::text,
  draft_revision,
  modules,
  submitted_content_version,
  created_at,
  updated_at
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

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : asIso(value);
}

function mapDraft(row: DraftRow): StoredDraft {
  return {
    draft: {
      createdAt: asIso(row.created_at),
      draftId: row.draft_id,
      draftRevision: Number(row.draft_revision),
      fortuneDate: row.fortune_date,
      modules: structuredClone(row.modules as DraftModules),
      state: "draft",
      updatedAt: asIso(row.updated_at),
    },
    submittedContentVersion: row.submitted_content_version,
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
    preflightChecks: structuredClone(row.preflight_checks as PreflightCheck[]),
    snapshot: structuredClone(row.snapshot as DraftModules),
    state: row.state,
  };
}

function mapProjection(row: ProjectionRow): LifecycleProjection {
  return {
    activeContentVersion: row.active_content_version,
    fortuneDate: row.fortune_date,
    revision: Number(row.lifecycle_revision),
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

function mapAudit(row: AuditRow): StoredAuditEvent {
  return {
    action: row.action,
    actorId: row.actor_id,
    auditEventId: row.audit_event_id,
    contentVersion: row.content_version,
    fortuneDate: row.fortune_date,
    fromState: row.from_state,
    idempotencyKey: row.idempotency_key,
    occurredAt: asIso(row.occurred_at),
    reason: row.reason,
    requestId: row.request_id,
    toState: row.to_state,
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

class PostgresContentLifecycleTransaction implements ContentLifecycleTransaction {
  constructor(private readonly client: PoolClient) {}

  async findDraftForUpdate(draftId: string): Promise<StoredDraft | null> {
    const result = await this.client.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM content_drafts WHERE draft_id = $1 FOR UPDATE`,
      [draftId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapDraft(row);
  }

  async findIdempotency(
    operation: IdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<StoredLifecycleIdempotency | null> {
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

  async findVersion(contentVersion: string): Promise<StoredContentVersion | null> {
    const result = await this.client.query<VersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM content_versions WHERE content_version = $1`,
      [contentVersion],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapVersion(row);
  }

  async getOrCreateProjectionForUpdate(fortuneDate: string): Promise<LifecycleProjection> {
    await this.client.query(
      `INSERT INTO content_lifecycle_days (fortune_date, lifecycle_revision)
       VALUES ($1::date, 0)
       ON CONFLICT (fortune_date) DO NOTHING`,
      [fortuneDate],
    );
    const result = await this.client.query<ProjectionRow>(
      `SELECT fortune_date::text, lifecycle_revision, active_content_version
         FROM content_lifecycle_days
        WHERE fortune_date = $1::date
        FOR UPDATE`,
      [fortuneDate],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Lifecycle projection disappeared after creation");
    return mapProjection(row);
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

  async insertDraft(stored: StoredDraft): Promise<void> {
    const { draft } = stored;
    await this.client.query(
      `INSERT INTO content_drafts (
         draft_id, fortune_date, draft_revision, modules, submitted_content_version,
         created_at, updated_at, submitted_at
       ) VALUES ($1, $2::date, $3, $4::jsonb, $5, $6::timestamptz, $7::timestamptz, NULL)`,
      [
        draft.draftId,
        draft.fortuneDate,
        draft.draftRevision,
        JSON.stringify(draft.modules),
        stored.submittedContentVersion,
        draft.createdAt,
        draft.updatedAt,
      ],
    );
  }

  async insertEvidence(evidence: StoredMasterReviewEvidence): Promise<void> {
    await this.client.query(
      `INSERT INTO master_review_evidence (
         evidence_id, content_version, reviewer_display_name, reviewed_at,
         conclusion, notes, references_json, recorded_at, recorded_revision
       ) VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7::jsonb, $8::timestamptz, $9)`,
      [
        evidence.evidenceId,
        evidence.contentVersion,
        evidence.reviewerDisplayName,
        evidence.reviewedAt,
        evidence.conclusion,
        evidence.notes,
        JSON.stringify(evidence.references),
        evidence.recordedAt,
        evidence.recordedRevision,
      ],
    );
  }

  async insertIdempotency(record: StoredLifecycleIdempotency): Promise<void> {
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

  async insertVersion(version: StoredContentVersion): Promise<void> {
    await this.client.query(
      `INSERT INTO content_versions (
         content_version, draft_id, fortune_date, state, snapshot,
         preflight_checks, created_at, effective_from, effective_to
       ) VALUES (
         $1, $2, $3::date, $4, $5::jsonb,
         $6::jsonb, $7::timestamptz, $8::timestamptz, $9::timestamptz
       )`,
      [
        version.contentVersion,
        version.draftId,
        version.fortuneDate,
        version.state,
        JSON.stringify(version.snapshot),
        JSON.stringify(version.preflightChecks),
        version.createdAt,
        version.effectiveFrom,
        version.effectiveTo,
      ],
    );
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

  async lockIdempotency(
    operation: IdempotencyOperation,
    resourceId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `content-lifecycle:${operation}:${resourceId}:${idempotencyKey}`,
    ]);
  }

  async markDraftSubmitted(
    draftId: string,
    contentVersion: string,
    submittedAt: string,
  ): Promise<void> {
    const result = await this.client.query(
      `UPDATE content_drafts
          SET submitted_content_version = $1,
              submitted_at = $2::timestamptz
        WHERE draft_id = $3
          AND submitted_content_version IS NULL`,
      [contentVersion, submittedAt, draftId],
    );
    if (result.rowCount !== 1) throw new Error("Draft submission lost its transaction lock");
  }

  async updateDraft(stored: StoredDraft): Promise<void> {
    const { draft } = stored;
    const result = await this.client.query(
      `UPDATE content_drafts
          SET draft_revision = $1,
              modules = $2::jsonb,
              updated_at = $3::timestamptz
        WHERE draft_id = $4
          AND submitted_content_version IS NULL`,
      [draft.draftRevision, JSON.stringify(draft.modules), draft.updatedAt, draft.draftId],
    );
    if (result.rowCount !== 1) throw new Error("Draft update lost its transaction lock");
  }

  async updateProjection(projection: LifecycleProjection): Promise<void> {
    const result = await this.client.query(
      `UPDATE content_lifecycle_days
          SET lifecycle_revision = $1,
              active_content_version = $2
        WHERE fortune_date = $3::date
          AND lifecycle_revision = $1::bigint - 1`,
      [projection.revision, projection.activeContentVersion, projection.fortuneDate],
    );
    if (result.rowCount !== 1)
      throw new Error("Lifecycle revision changed inside locked transaction");
  }

  async updateVersionState(
    contentVersion: string,
    state: Exclude<ContentState, "draft">,
  ): Promise<void> {
    const result = await this.client.query(
      "UPDATE content_versions SET state = $1 WHERE content_version = $2",
      [state, contentVersion],
    );
    if (result.rowCount !== 1) throw new Error("Content version disappeared during transition");
  }
}

export class PostgresContentLifecycleStore implements ContentLifecycleStore {
  constructor(private readonly pool: Pool) {}

  private async repeatableRead<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
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

  async findDraft(draftId: string): Promise<ContentDraft | null> {
    const result = await this.pool.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS}
         FROM content_drafts
        WHERE draft_id = $1 AND submitted_content_version IS NULL`,
      [draftId],
    );
    const row = result.rows[0];
    return row === undefined ? null : mapDraft(row).draft;
  }

  async listAuditEvents(input: {
    readonly contentVersion: string | null;
    readonly cursor: AuditCursor | null;
    readonly fortuneDate: string | null;
    readonly limit: number;
  }): Promise<{ readonly items: StoredAuditEvent[]; readonly hasMore: boolean }> {
    const result = await this.pool.query<AuditRow>(
      `SELECT
         audit_event_id, action, occurred_at, request_id, fortune_date::text,
         content_version, actor_id, reason, from_state, to_state, idempotency_key
       FROM content_lifecycle_audit_events
       WHERE ($1::date IS NULL OR fortune_date = $1::date)
         AND ($2::text IS NULL OR content_version = $2)
         AND (
           $3::timestamptz IS NULL
           OR (occurred_at, audit_event_id) < ($3::timestamptz, $4::text)
         )
       ORDER BY occurred_at DESC, audit_event_id DESC
       LIMIT $5`,
      [
        input.fortuneDate,
        input.contentVersion,
        input.cursor?.occurredAt ?? null,
        input.cursor?.auditEventId ?? null,
        input.limit + 1,
      ],
    );
    return {
      hasMore: result.rows.length > input.limit,
      items: result.rows.slice(0, input.limit).map(mapAudit),
    };
  }

  async listDrafts(fortuneDate: string | null): Promise<ContentDraftSummary[]> {
    const result = await this.pool.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS}
         FROM content_drafts
        WHERE submitted_content_version IS NULL
          AND ($1::date IS NULL OR fortune_date = $1::date)
        ORDER BY updated_at DESC, draft_id DESC`,
      [fortuneDate],
    );
    return result.rows.map((row) => {
      const {
        createdAt,
        draftId,
        draftRevision,
        fortuneDate: date,
        state,
        updatedAt,
      } = mapDraft(row).draft;
      return { createdAt, draftId, draftRevision, fortuneDate: date, state, updatedAt };
    });
  }

  readVersionListView(fortuneDate: string): Promise<ContentVersionListReadView> {
    return this.repeatableRead(async (client) => {
      const versionsResult = await client.query<VersionRow>(
        `SELECT ${VERSION_COLUMNS}
           FROM content_versions
          WHERE fortune_date = $1::date
          ORDER BY created_at DESC, content_version DESC`,
        [fortuneDate],
      );
      const projectionResult = await client.query<ProjectionRow>(
        `SELECT fortune_date::text, lifecycle_revision, active_content_version
           FROM content_lifecycle_days
          WHERE fortune_date = $1::date`,
        [fortuneDate],
      );
      const projection = projectionResult.rows[0];
      return {
        projection: projection === undefined ? null : mapProjection(projection),
        versions: versionsResult.rows.map(mapVersion),
      };
    });
  }

  readVersionView(contentVersion: string): Promise<ContentVersionReadView | null> {
    return this.repeatableRead(async (client) => {
      const versionResult = await client.query<VersionRow>(
        `SELECT ${VERSION_COLUMNS} FROM content_versions WHERE content_version = $1`,
        [contentVersion],
      );
      const versionRow = versionResult.rows[0];
      if (versionRow === undefined) return null;

      const projectionResult = await client.query<ProjectionRow>(
        `SELECT fortune_date::text, lifecycle_revision, active_content_version
           FROM content_lifecycle_days
          WHERE fortune_date = $1::date`,
        [versionRow.fortune_date],
      );
      const projectionRow = projectionResult.rows[0];
      if (projectionRow === undefined) {
        throw new Error(`Lifecycle projection missing for ${contentVersion}`);
      }
      const evidenceResult = await client.query<EvidenceRow>(
        `SELECT ${EVIDENCE_COLUMNS}
           FROM master_review_evidence
          WHERE content_version = $1
          ORDER BY recorded_revision`,
        [contentVersion],
      );
      return {
        evidence: evidenceResult.rows.map(mapEvidence),
        projection: mapProjection(projectionRow),
        version: mapVersion(versionRow),
      };
    });
  }

  async transaction<T>(work: (transaction: ContentLifecycleTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(new PostgresContentLifecycleTransaction(client));
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
