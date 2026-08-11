import { isDeepStrictEqual } from "node:util";

import type { components } from "@five/api-contract";
import type { Pool, PoolClient } from "pg";

import {
  canonicalModulePair,
  CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
  contentProductionRebaseRequestHash,
  hashCanonicalValue,
  type ContentProductionRebaseConflictCode,
  type ContentProductionRebaseEvent,
  type ContentProductionRebaseModulePair,
  type ContentProductionRebaseResult,
} from "./content-production-rebase";
import type {
  ContentProductionRebaseInspection,
  ContentProductionRebaseStore,
  ContentProductionRebaseStoreInput,
} from "./content-production-rebase.store";

interface RebaseEventRow {
  readonly actor_id: string;
  readonly after_calendar_algorithm: unknown;
  readonly after_calendar_sha256: string;
  readonly after_copy_and_formula: unknown;
  readonly after_copy_sha256: string;
  readonly batch_manifest_sha256: string;
  readonly before_calendar_algorithm: unknown;
  readonly before_calendar_sha256: string;
  readonly before_copy_and_formula: unknown;
  readonly before_copy_sha256: string;
  readonly canonicalization_version: string;
  readonly draft_id: string;
  readonly fortune_date: string;
  readonly from_draft_revision: number | string;
  readonly idempotency_key: string;
  readonly occurred_at: Date | string;
  readonly plan_id: string;
  readonly plan_sha256: string;
  readonly reason: string;
  readonly rebase_event_id: string;
  readonly request_hash: string;
  readonly request_id: string;
  readonly retain_until: Date | string;
  readonly source_build_id: string;
  readonly source_created_at: Date | string;
  readonly source_canonical_sha256: string;
  readonly source_generator_fingerprint: string;
  readonly source_module_manifest_sha256: string;
  readonly target_build_id: string;
  readonly target_canonical_sha256: string;
  readonly target_generator_id: string;
  readonly to_draft_revision: number | string;
}

interface ProductionDraftRow {
  readonly actor_id: string;
  readonly completed_image_slots: number | string;
  readonly created_at: Date | string;
  readonly draft_revision: number | string;
  readonly draft_id: string;
  readonly last_error: string | null;
  readonly modules: unknown;
  readonly pending_image_slots: number | string;
  readonly production_updated_at: Date | string;
  readonly request_id: string;
  readonly status: string;
  readonly submitted_content_version: string | null;
  readonly submitted_at: Date | null;
  readonly updated_at: Date | string;
}

interface ImageJobRow {
  readonly attempt_limit: number | string;
  readonly attempt_token: string | null;
  readonly attempts: number | string;
  readonly available_at: Date | string;
  readonly claimed_at: Date | null;
  readonly completed_asset_id: string | null;
  readonly generation_revision: number | string;
  readonly image_slot: string;
  readonly job_id: string;
  readonly last_error: string | null;
  readonly lease_expires_at: Date | null;
  readonly prompt_version: string;
  readonly status: string;
  readonly worker_id: string | null;
}

interface ImageCurrentRow {
  readonly current_job_id: string | null;
  readonly generation_revision: number | string;
  readonly image_slot: string;
  readonly updated_at: Date | string;
}

const EVENT_COLUMNS = `
  rebase_event_id,
  fortune_date::text AS fortune_date,
  draft_id,
  actor_id,
  reason,
  request_id,
  idempotency_key,
  request_hash,
  plan_id,
  plan_sha256,
  batch_manifest_sha256,
  canonicalization_version,
  source_build_id,
  source_created_at,
  source_generator_fingerprint,
  source_module_manifest_sha256,
  target_build_id,
  target_generator_id,
  before_calendar_algorithm,
  before_copy_and_formula,
  after_calendar_algorithm,
  after_copy_and_formula,
  before_calendar_sha256,
  before_copy_sha256,
  source_canonical_sha256,
  after_calendar_sha256,
  after_copy_sha256,
  target_canonical_sha256,
  from_draft_revision,
  to_draft_revision,
  occurred_at,
  retain_until
`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function eventModulePair(row: RebaseEventRow, side: "source" | "target") {
  const calendarAlgorithm =
    side === "source" ? row.before_calendar_algorithm : row.after_calendar_algorithm;
  const copyAndFormula =
    side === "source" ? row.before_copy_and_formula : row.after_copy_and_formula;
  return canonicalModulePair({
    calendar_algorithm: calendarAlgorithm as ContentProductionRebaseModulePair["calendarAlgorithm"],
    copy_and_formula: copyAndFormula as ContentProductionRebaseModulePair["copyAndFormula"],
    poster_consistency: null,
    visual_and_rights: null,
  });
}

function mapEvent(row: RebaseEventRow): ContentProductionRebaseEvent {
  if (row.canonicalization_version !== CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION) {
    throw new Error("Stored content production rebase event uses an unknown canonicalization");
  }
  const source = eventModulePair(row, "source");
  const target = eventModulePair(row, "target");
  if (
    source.calendarSha256 !== row.before_calendar_sha256 ||
    source.copySha256 !== row.before_copy_sha256 ||
    source.canonicalSha256 !== row.source_canonical_sha256 ||
    target.calendarSha256 !== row.after_calendar_sha256 ||
    target.copySha256 !== row.after_copy_sha256 ||
    target.canonicalSha256 !== row.target_canonical_sha256
  ) {
    throw new Error("Stored content production rebase event hashes do not match its evidence");
  }
  const event: ContentProductionRebaseEvent = {
    actorId: row.actor_id,
    batchManifestSha256: row.batch_manifest_sha256,
    canonicalizationVersion: CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
    draftId: row.draft_id,
    eventId: row.rebase_event_id,
    fortuneDate: row.fortune_date,
    fromDraftRevision: Number(row.from_draft_revision),
    generatorId: row.target_generator_id,
    idempotencyKey: row.idempotency_key,
    occurredAt: iso(row.occurred_at),
    planId: row.plan_id,
    planSha256: row.plan_sha256,
    reason: row.reason,
    requestHash: row.request_hash,
    requestId: row.request_id,
    retainUntil: iso(row.retain_until),
    sourceBuildId: row.source_build_id,
    sourceCreatedAt: iso(row.source_created_at),
    sourceGeneratorFingerprint: row.source_generator_fingerprint,
    sourceModuleManifestSha256: row.source_module_manifest_sha256,
    source,
    targetBuildId: row.target_build_id,
    target,
    toDraftRevision: Number(row.to_draft_revision),
  };
  const expectedRequestHash = contentProductionRebaseRequestHash({
    actorId: event.actorId,
    batchManifestSha256: event.batchManifestSha256,
    canonicalizationVersion: event.canonicalizationVersion,
    draftId: event.draftId,
    expectedDraftRevision: event.fromDraftRevision,
    fortuneDate: event.fortuneDate,
    generatorId: event.generatorId,
    idempotencyKey: event.idempotencyKey,
    occurredAt: event.occurredAt,
    planId: event.planId,
    planSha256: event.planSha256,
    reason: event.reason,
    requestId: event.requestId,
    sourceBuildId: event.sourceBuildId,
    sourceCreatedAt: event.sourceCreatedAt,
    sourceGeneratorFingerprint: event.sourceGeneratorFingerprint,
    sourceModuleManifestSha256: event.sourceModuleManifestSha256,
    source: event.source,
    targetBuildId: event.targetBuildId,
    target: event.target,
  });
  if (expectedRequestHash !== event.requestHash) {
    throw new Error(
      "Stored content production rebase event request hash does not match its evidence",
    );
  }
  return event;
}

function exactDraftModules(value: unknown): value is components["schemas"]["DraftModules"] {
  try {
    canonicalModulePair(value as components["schemas"]["DraftModules"]);
    return true;
  } catch {
    return false;
  }
}

function modulePairMatches(modules: unknown, expected: ContentProductionRebaseModulePair): boolean {
  return exactDraftModules(modules) && isDeepStrictEqual(canonicalModulePair(modules), expected);
}

function eventFromInput(input: ContentProductionRebaseStoreInput): ContentProductionRebaseEvent {
  return {
    actorId: input.actorId,
    batchManifestSha256: input.batchManifestSha256,
    canonicalizationVersion: input.canonicalizationVersion,
    draftId: input.draftId,
    eventId: input.eventId,
    fortuneDate: input.fortuneDate,
    fromDraftRevision: input.expectedDraftRevision,
    generatorId: input.generatorId,
    idempotencyKey: input.idempotencyKey,
    occurredAt: input.occurredAt,
    planId: input.planId,
    planSha256: input.planSha256,
    reason: input.reason,
    requestHash: input.requestHash,
    requestId: input.requestId,
    retainUntil: input.retainUntil,
    sourceBuildId: input.sourceBuildId,
    sourceCreatedAt: input.sourceCreatedAt,
    sourceGeneratorFingerprint: input.sourceGeneratorFingerprint,
    sourceModuleManifestSha256: input.sourceModuleManifestSha256,
    source: structuredClone(input.source),
    targetBuildId: input.targetBuildId,
    target: structuredClone(input.target),
    toDraftRevision: input.expectedDraftRevision + 1,
  };
}

function conflict(
  code: ContentProductionRebaseConflictCode,
): Extract<ContentProductionRebaseResult, { readonly kind: "state_conflict" }> {
  return { code, kind: "state_conflict" };
}

async function readEvent(
  client: Pick<PoolClient, "query">,
  idempotencyKey: string,
): Promise<RebaseEventRow | null> {
  const result = await client.query<RebaseEventRow>(
    `SELECT ${EVENT_COLUMNS}
       FROM content_draft_rebase_events
      WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return result.rows[0] ?? null;
}

export class PostgresContentProductionRebaseStore implements ContentProductionRebaseStore {
  constructor(
    private readonly pool: Pool,
    private readonly hooks: { readonly beforeEventInsert?: () => void | Promise<void> } = {},
  ) {}

  async inspect(fortuneDate: string): Promise<ContentProductionRebaseInspection> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const owner = await client.query<ProductionDraftRow>(
        `SELECT production.status,
                production.completed_image_slots,
                production.pending_image_slots,
                production.last_error,
                production.actor_id,
                production.request_id,
                production.updated_at AS production_updated_at,
                draft.draft_id,
                draft.draft_revision,
                draft.modules,
                draft.submitted_content_version,
                draft.submitted_at,
                draft.created_at,
                draft.updated_at
           FROM daily_content_productions AS production
           JOIN content_drafts AS draft ON draft.draft_id = production.draft_id
          WHERE production.fortune_date = $1::date`,
        [fortuneDate],
      );
      const draft = owner.rows[0];
      if (draft === undefined) {
        const absence = await client.query<{
          readonly corrections: string;
          readonly currents: string;
          readonly drafts: string;
          readonly intents: string;
          readonly jobs: string;
          readonly lifecycle: string;
          readonly productions: string;
          readonly versions: string;
        }>(
          `SELECT
             (SELECT count(*) FROM daily_content_productions WHERE fortune_date = $1::date)::text AS productions,
             (SELECT count(*) FROM content_drafts WHERE fortune_date = $1::date)::text AS drafts,
             (SELECT count(*) FROM content_lifecycle_days WHERE fortune_date = $1::date)::text AS lifecycle,
             (SELECT count(*) FROM content_versions WHERE fortune_date = $1::date)::text AS versions,
             (SELECT count(*) FROM day_corrections WHERE fortune_date = $1::date)::text AS corrections,
             (SELECT count(*) FROM day_correction_open_intents WHERE fortune_date = $1::date)::text AS intents,
             (SELECT count(*) FROM daily_content_image_jobs WHERE fortune_date = $1::date)::text AS jobs,
             (SELECT count(*) FROM daily_content_image_slot_currents WHERE fortune_date = $1::date)::text AS currents`,
          [fortuneDate],
        );
        const state = absence.rows[0];
        if (
          state?.productions === "0" &&
          state.drafts === "0" &&
          state.lifecycle === "0" &&
          state.versions === "0" &&
          state.corrections === "0" &&
          state.intents === "0" &&
          state.jobs === "0" &&
          state.currents === "0"
        ) {
          await client.query("COMMIT");
          return { code: "not_found", fortuneDate, kind: "missing" };
        }
        if (state?.corrections !== "0" || state.intents !== "0") {
          return await this.finishInspection(client, conflict("correction_present"));
        }
        if (state?.lifecycle !== "0" || state.versions !== "0") {
          return await this.finishInspection(client, conflict("lifecycle_version_present"));
        }
        if (state?.drafts !== "0") {
          return await this.finishInspection(client, conflict("extra_draft_present"));
        }
        if (state?.jobs !== "0" || state.currents !== "0") {
          return await this.finishInspection(client, conflict("image_jobs_not_pristine"));
        }
        return await this.finishInspection(client, conflict("source_mismatch"));
      }
      if (draft.submitted_content_version !== null || draft.submitted_at !== null) {
        const protectedVersion = await client.query<{
          readonly active_content_version: string | null;
          readonly content_version: string;
          readonly draft_id: string;
          readonly fortune_date: string;
          readonly state: string;
        }>(
          `SELECT lifecycle.active_content_version,
                  version.content_version,
                  version.draft_id,
                  version.fortune_date::text AS fortune_date,
                  version.state
             FROM content_versions AS version
             JOIN content_lifecycle_days AS lifecycle
               ON lifecycle.fortune_date = version.fortune_date
            WHERE version.fortune_date = $1::date
            ORDER BY version.content_version`,
          [fortuneDate],
        );
        const protectedDrafts = await client.query<{ readonly draft_id: string }>(
          "SELECT draft_id FROM content_drafts WHERE fortune_date = $1::date ORDER BY draft_id",
          [fortuneDate],
        );
        const version = protectedVersion.rows[0];
        if (
          protectedVersion.rowCount === 1 &&
          protectedDrafts.rowCount === 1 &&
          protectedDrafts.rows[0]?.draft_id === draft.draft_id &&
          draft.submitted_content_version !== null &&
          draft.submitted_at !== null &&
          version?.content_version === draft.submitted_content_version &&
          version.active_content_version === version.content_version &&
          version.draft_id === draft.draft_id &&
          version.fortune_date === fortuneDate &&
          version.state === "published"
        ) {
          await client.query("COMMIT");
          return { code: "published_active_version", fortuneDate, kind: "protected" };
        }
        return await this.finishInspection(client, conflict("submitted"));
      }
      if (Number(draft.draft_revision) !== 1) {
        return await this.finishInspection(client, conflict("draft_revision_mismatch"));
      }
      if (
        iso(draft.created_at) !== iso(draft.updated_at) ||
        iso(draft.production_updated_at) !== iso(draft.updated_at) ||
        draft.actor_id !== "system-content-production-worker" ||
        draft.request_id !== `worker-production-${fortuneDate}`
      ) {
        return await this.finishInspection(client, conflict("source_mismatch"));
      }
      if (!exactDraftModules(draft.modules)) {
        return await this.finishInspection(client, conflict("visual_modules_present"));
      }
      if (
        draft.status !== "generating" ||
        Number(draft.completed_image_slots) !== 0 ||
        Number(draft.pending_image_slots) !== 2 ||
        draft.last_error !== null
      ) {
        return await this.finishInspection(client, conflict("image_jobs_not_pristine"));
      }
      const sourceCreation = await client.query<{
        readonly created_at: Date | string;
        readonly idempotency_key: string;
        readonly request_hash: string;
      }>(
        `SELECT idempotency_key, request_hash, created_at
           FROM daily_content_production_idempotency
          WHERE fortune_date = $1::date
          ORDER BY idempotency_key`,
        [fortuneDate],
      );
      const sourceCreationRow = sourceCreation.rows[0];
      if (
        sourceCreation.rowCount !== 1 ||
        sourceCreationRow?.idempotency_key !== `automatic-production:${fortuneDate}:v1` ||
        sourceCreationRow.request_hash !== this.productionRequestHash(fortuneDate) ||
        iso(sourceCreationRow.created_at) !== iso(draft.created_at)
      ) {
        return await this.finishInspection(client, conflict("source_mismatch"));
      }
      const day = await client.query<{
        readonly active_content_version: string | null;
        readonly lifecycle_revision: number | string;
      }>(
        `SELECT active_content_version, lifecycle_revision
           FROM content_lifecycle_days
          WHERE fortune_date = $1::date`,
        [fortuneDate],
      );
      const versions = await client.query<{ readonly content_version: string }>(
        `SELECT content_version
           FROM content_versions
          WHERE fortune_date = $1::date OR draft_id = $2`,
        [fortuneDate, draft.draft_id],
      );
      if (
        (day.rows[0]?.active_content_version ?? null) !== null ||
        (day.rows[0] !== undefined && Number(day.rows[0].lifecycle_revision) !== 0) ||
        versions.rowCount !== 0
      ) {
        return await this.finishInspection(client, conflict("lifecycle_version_present"));
      }
      const drafts = await client.query<{ readonly draft_id: string }>(
        "SELECT draft_id FROM content_drafts WHERE fortune_date = $1::date ORDER BY draft_id",
        [fortuneDate],
      );
      if (drafts.rowCount !== 1 || drafts.rows[0]?.draft_id !== draft.draft_id) {
        return await this.finishInspection(client, conflict("extra_draft_present"));
      }
      const corrections = await client.query<{ readonly count: string }>(
        `SELECT (
           (SELECT count(*) FROM day_corrections WHERE fortune_date = $1::date)
           +
           (SELECT count(*) FROM day_correction_open_intents WHERE fortune_date = $1::date)
         )::text AS count`,
        [fortuneDate],
      );
      if (corrections.rows[0]?.count !== "0") {
        return await this.finishInspection(client, conflict("correction_present"));
      }
      const jobs = await client.query<ImageJobRow>(
        `SELECT job_id, image_slot, prompt_version, status, attempts, attempt_limit,
                generation_revision, claimed_at, lease_expires_at, worker_id,
                attempt_token, last_error, completed_asset_id, available_at
           FROM daily_content_image_jobs
          WHERE fortune_date = $1::date
          ORDER BY image_slot, generation_revision, job_id`,
        [fortuneDate],
      );
      const currents = await client.query<ImageCurrentRow>(
        `SELECT image_slot, current_job_id, generation_revision, updated_at
           FROM daily_content_image_slot_currents
          WHERE fortune_date = $1::date
          ORDER BY image_slot`,
        [fortuneDate],
      );
      const images = await client.query<{
        readonly candidates: string;
        readonly selections: string;
      }>(
        `SELECT
           (SELECT count(*) FROM draft_image_candidates WHERE draft_id = $1)::text AS candidates,
           (SELECT count(*) FROM draft_image_slot_selections WHERE draft_id = $1)::text AS selections`,
        [draft.draft_id],
      );
      if (images.rows[0]?.candidates !== "0") {
        return await this.finishInspection(client, conflict("candidates_present"));
      }
      if (images.rows[0]?.selections !== "0") {
        return await this.finishInspection(client, conflict("image_selections_present"));
      }
      if (!this.pristineImages(jobs.rows, currents.rows, iso(draft.created_at))) {
        return await this.finishInspection(client, conflict("image_jobs_not_pristine"));
      }
      const source = canonicalModulePair(draft.modules);
      await client.query("COMMIT");
      return {
        createdAt: iso(draft.created_at),
        draftId: draft.draft_id,
        draftRevision: 1,
        fortuneDate,
        kind: "eligible",
        source,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async inspectEvent(idempotencyKey: string): Promise<ContentProductionRebaseEvent | null> {
    const row = await readEvent(this.pool, idempotencyKey);
    return row === null ? null : mapEvent(row);
  }

  async rebase(input: ContentProductionRebaseStoreInput): Promise<ContentProductionRebaseResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `content-production-rebase:${input.idempotencyKey}`,
      ]);
      const prior = await readEvent(client, input.idempotencyKey);
      if (prior !== null) {
        if (prior.request_hash !== input.requestHash) {
          await client.query("COMMIT");
          return { kind: "idempotency_conflict" };
        }
        const event = mapEvent(prior);
        await client.query("COMMIT");
        return { event, kind: "existing" };
      }

      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `content-production-rebase-plan:${input.planSha256}:${input.fortuneDate}`,
      ]);
      const samePlan = await client.query<{ readonly idempotency_key: string }>(
        `SELECT idempotency_key
           FROM content_draft_rebase_events
          WHERE plan_sha256 = $1 AND fortune_date = $2::date`,
        [input.planSha256, input.fortuneDate],
      );
      if (samePlan.rows[0] !== undefined) {
        await client.query("COMMIT");
        return conflict("plan_already_applied");
      }

      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `content-production-day:${input.fortuneDate}`,
      ]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `five:day-correction:open:${input.fortuneDate}`,
      ]);
      const owner = await client.query<ProductionDraftRow>(
        `SELECT production.status,
                production.completed_image_slots,
                production.pending_image_slots,
                production.last_error,
                production.actor_id,
                production.request_id,
                production.updated_at AS production_updated_at,
                draft.draft_revision,
                draft.modules,
                draft.submitted_content_version,
                draft.submitted_at,
                draft.created_at,
                draft.updated_at
           FROM daily_content_productions AS production
           JOIN content_drafts AS draft ON draft.draft_id = production.draft_id
          WHERE production.fortune_date = $1::date
            AND production.draft_id = $2
          FOR UPDATE OF production, draft`,
        [input.fortuneDate, input.draftId],
      );
      const draft = owner.rows[0];
      if (draft === undefined) {
        await client.query("COMMIT");
        return conflict("not_found");
      }
      if (draft.submitted_content_version !== null || draft.submitted_at !== null) {
        await client.query("COMMIT");
        return conflict("submitted");
      }
      if (Number(draft.draft_revision) !== input.expectedDraftRevision) {
        await client.query("COMMIT");
        return conflict("draft_revision_mismatch");
      }
      if (
        iso(draft.created_at) !== iso(draft.updated_at) ||
        iso(draft.created_at) !== input.sourceCreatedAt ||
        iso(draft.production_updated_at) !== iso(draft.updated_at) ||
        draft.actor_id !== "system-content-production-worker" ||
        draft.request_id !== `worker-production-${input.fortuneDate}`
      ) {
        await client.query("COMMIT");
        return conflict("source_mismatch");
      }
      const sourceCreation = await client.query<{
        readonly created_at: Date | string;
        readonly idempotency_key: string;
        readonly request_hash: string;
      }>(
        `SELECT idempotency_key, request_hash, created_at
           FROM daily_content_production_idempotency
          WHERE fortune_date = $1::date
          ORDER BY idempotency_key
          FOR UPDATE`,
        [input.fortuneDate],
      );
      const sourceCreationRow = sourceCreation.rows[0];
      if (
        sourceCreation.rowCount !== 1 ||
        sourceCreationRow?.idempotency_key !== `automatic-production:${input.fortuneDate}:v1` ||
        sourceCreationRow.request_hash !== this.productionRequestHash(input.fortuneDate) ||
        iso(sourceCreationRow.created_at) !== iso(draft.created_at)
      ) {
        await client.query("COMMIT");
        return conflict("source_mismatch");
      }
      if (!exactDraftModules(draft.modules)) {
        await client.query("COMMIT");
        return conflict("visual_modules_present");
      }
      if (!modulePairMatches(draft.modules, input.source)) {
        await client.query("COMMIT");
        return conflict("source_mismatch");
      }
      if (
        draft.status !== "generating" ||
        Number(draft.completed_image_slots) !== 0 ||
        Number(draft.pending_image_slots) !== 2 ||
        draft.last_error !== null
      ) {
        await client.query("COMMIT");
        return conflict("image_jobs_not_pristine");
      }

      const day = await client.query<{
        readonly active_content_version: string | null;
        readonly lifecycle_revision: number | string;
      }>(
        `SELECT active_content_version, lifecycle_revision
           FROM content_lifecycle_days
          WHERE fortune_date = $1::date
          FOR UPDATE`,
        [input.fortuneDate],
      );
      const versions = await client.query<{ readonly content_version: string }>(
        `SELECT content_version
           FROM content_versions
          WHERE fortune_date = $1::date OR draft_id = $2
          ORDER BY content_version
          FOR UPDATE`,
        [input.fortuneDate, input.draftId],
      );
      if (
        (day.rows[0]?.active_content_version ?? null) !== null ||
        (day.rows[0] !== undefined && Number(day.rows[0].lifecycle_revision) !== 0) ||
        versions.rowCount !== 0
      ) {
        await client.query("COMMIT");
        return conflict("lifecycle_version_present");
      }

      const drafts = await client.query<{ readonly draft_id: string }>(
        `SELECT draft_id
           FROM content_drafts
          WHERE fortune_date = $1::date
          ORDER BY draft_id
          FOR UPDATE`,
        [input.fortuneDate],
      );
      if (drafts.rowCount !== 1 || drafts.rows[0]?.draft_id !== input.draftId) {
        await client.query("COMMIT");
        return conflict("extra_draft_present");
      }

      const corrections = await client.query<{ readonly marker: string }>(
        `SELECT correction_id AS marker
           FROM day_corrections
          WHERE fortune_date = $1::date
          FOR UPDATE`,
        [input.fortuneDate],
      );
      const correctionIntents = await client.query<{ readonly marker: string }>(
        `SELECT correction_id AS marker
           FROM day_correction_open_intents
          WHERE fortune_date = $1::date
          FOR UPDATE`,
        [input.fortuneDate],
      );
      if (corrections.rowCount !== 0 || correctionIntents.rowCount !== 0) {
        await client.query("COMMIT");
        return conflict("correction_present");
      }

      const jobs = await client.query<ImageJobRow>(
        `SELECT job_id, image_slot, prompt_version, status, attempts, attempt_limit,
                generation_revision, claimed_at, lease_expires_at, worker_id,
                attempt_token, last_error, completed_asset_id, available_at
           FROM daily_content_image_jobs
          WHERE fortune_date = $1::date
          ORDER BY image_slot, generation_revision, job_id
          FOR UPDATE`,
        [input.fortuneDate],
      );
      const currents = await client.query<ImageCurrentRow>(
        `SELECT image_slot, current_job_id, generation_revision, updated_at
           FROM daily_content_image_slot_currents
          WHERE fortune_date = $1::date
          ORDER BY image_slot
          FOR UPDATE`,
        [input.fortuneDate],
      );
      const candidates = await client.query<{ readonly asset_id: string }>(
        `SELECT asset_id
           FROM draft_image_candidates
          WHERE draft_id = $1
          ORDER BY asset_id
          FOR UPDATE`,
        [input.draftId],
      );
      const selections = await client.query<{ readonly asset_id: string }>(
        `SELECT asset_id
           FROM draft_image_slot_selections
          WHERE draft_id = $1
          ORDER BY image_slot
          FOR UPDATE`,
        [input.draftId],
      );
      if (candidates.rowCount !== 0) {
        await client.query("COMMIT");
        return conflict("candidates_present");
      }
      if (selections.rowCount !== 0) {
        await client.query("COMMIT");
        return conflict("image_selections_present");
      }
      if (!this.pristineImages(jobs.rows, currents.rows, iso(draft.created_at))) {
        await client.query("COMMIT");
        return conflict("image_jobs_not_pristine");
      }

      const nextModules = {
        calendar_algorithm: input.target.calendarAlgorithm,
        copy_and_formula: input.target.copyAndFormula,
        poster_consistency: null,
        visual_and_rights: null,
      };
      const updated = await client.query(
        `UPDATE content_drafts
            SET modules = $1::jsonb,
                draft_revision = draft_revision + 1,
                updated_at = $2::timestamptz
          WHERE draft_id = $3
            AND draft_revision = $4
            AND submitted_content_version IS NULL
            AND modules = $5::jsonb`,
        [
          JSON.stringify(nextModules),
          input.occurredAt,
          input.draftId,
          input.expectedDraftRevision,
          JSON.stringify({
            calendar_algorithm: input.source.calendarAlgorithm,
            copy_and_formula: input.source.copyAndFormula,
            poster_consistency: null,
            visual_and_rights: null,
          }),
        ],
      );
      if (updated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return conflict("draft_revision_mismatch");
      }

      await this.hooks.beforeEventInsert?.();
      await client.query(
        `INSERT INTO content_draft_rebase_events (
           rebase_event_id, fortune_date, draft_id, actor_id, reason, request_id,
           idempotency_key, request_hash, plan_id, plan_sha256, batch_manifest_sha256,
           canonicalization_version, source_build_id, source_created_at, source_generator_fingerprint,
           source_module_manifest_sha256, target_build_id, target_generator_id,
           before_calendar_algorithm, before_copy_and_formula,
           after_calendar_algorithm, after_copy_and_formula,
           before_calendar_sha256, before_copy_sha256, source_canonical_sha256,
           after_calendar_sha256, after_copy_sha256, target_canonical_sha256,
           from_draft_revision, to_draft_revision, occurred_at, retain_until
         ) VALUES (
           $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14::timestamptz, $15, $16, $17, $18,
           $19::jsonb, $20::jsonb, $21::jsonb, $22::jsonb,
           $23, $24, $25, $26, $27, $28, $29, $30, $31::timestamptz, $32::timestamptz
         )`,
        [
          input.eventId,
          input.fortuneDate,
          input.draftId,
          input.actorId,
          input.reason,
          input.requestId,
          input.idempotencyKey,
          input.requestHash,
          input.planId,
          input.planSha256,
          input.batchManifestSha256,
          input.canonicalizationVersion,
          input.sourceBuildId,
          input.sourceCreatedAt,
          input.sourceGeneratorFingerprint,
          input.sourceModuleManifestSha256,
          input.targetBuildId,
          input.generatorId,
          JSON.stringify(input.source.calendarAlgorithm),
          JSON.stringify(input.source.copyAndFormula),
          JSON.stringify(input.target.calendarAlgorithm),
          JSON.stringify(input.target.copyAndFormula),
          input.source.calendarSha256,
          input.source.copySha256,
          input.source.canonicalSha256,
          input.target.calendarSha256,
          input.target.copySha256,
          input.target.canonicalSha256,
          input.expectedDraftRevision,
          input.expectedDraftRevision + 1,
          input.occurredAt,
          input.retainUntil,
        ],
      );
      await client.query("COMMIT");
      return { event: eventFromInput(input), kind: "rebased" };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private pristineImages(
    jobs: readonly ImageJobRow[],
    currents: readonly ImageCurrentRow[],
    createdAt: string,
  ): boolean {
    if (jobs.length !== 2 || currents.length !== 3) return false;
    const jobsBySlot = new Map(jobs.map((job) => [job.image_slot, job]));
    if (
      jobsBySlot.size !== 2 ||
      !jobsBySlot.has("required_primary") ||
      !jobsBySlot.has("required_alternative") ||
      jobsBySlot.has("optional")
    ) {
      return false;
    }
    for (const job of jobs) {
      if (
        job.prompt_version !== "five-look-v1" ||
        job.status !== "queued" ||
        Number(job.attempts) !== 0 ||
        Number(job.attempt_limit) !== 3 ||
        Number(job.generation_revision) !== 1 ||
        iso(job.available_at) !== createdAt ||
        job.claimed_at !== null ||
        job.lease_expires_at !== null ||
        job.worker_id !== null ||
        job.attempt_token !== null ||
        job.last_error !== null ||
        job.completed_asset_id !== null
      ) {
        return false;
      }
    }
    const currentsBySlot = new Map(currents.map((current) => [current.image_slot, current]));
    if (
      currentsBySlot.size !== 3 ||
      currents.some((current) => iso(current.updated_at) !== createdAt)
    ) {
      return false;
    }
    for (const slot of ["required_primary", "required_alternative"] as const) {
      const job = jobsBySlot.get(slot);
      const current = currentsBySlot.get(slot);
      if (
        job === undefined ||
        current === undefined ||
        current.current_job_id !== job.job_id ||
        Number(current.generation_revision) !== 1
      ) {
        return false;
      }
    }
    const optional = currentsBySlot.get("optional");
    return (
      optional !== undefined &&
      optional.current_job_id === null &&
      Number(optional.generation_revision) === 0
    );
  }

  private productionRequestHash(fortuneDate: string): string {
    return hashCanonicalValue({ fortuneDate });
  }

  private async finishInspection(
    client: PoolClient,
    result: Extract<ContentProductionRebaseInspection, { readonly kind: "state_conflict" }>,
  ): Promise<typeof result> {
    await client.query("COMMIT");
    return result;
  }
}
