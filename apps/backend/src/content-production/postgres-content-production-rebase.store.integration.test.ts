import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AutomaticContentProductionService } from "./content-production.service";
import {
  canonicalModulePair,
  CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
  hashCanonicalValue,
  type ContentProductionRebaseApplyInput,
} from "./content-production-rebase";
import { ContentProductionRebaseService } from "./content-production-rebase.service";
import { DeterministicDraftGenerator } from "./deterministic-draft.generator";
import { PostgresContentProductionRebaseStore } from "./postgres-content-production-rebase.store";
import { PostgresContentProductionStore } from "./postgres-content-production.store";

const databaseUrl = process.env.FIVE_CONTENT_REBASE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const OCCURRED_AT = "2026-08-11T10:00:00.000Z";

function legacyModules(fortuneDate: string) {
  const modules = new DeterministicDraftGenerator().generate(fortuneDate);
  if (modules.calendar_algorithm === null || modules.copy_and_formula === null) {
    throw new Error("deterministic fixture modules are incomplete");
  }
  return {
    ...modules,
    calendar_algorithm: {
      ...modules.calendar_algorithm,
      algorithmVersion: "legacy-calendar-algorithm-v0",
    },
    copy_and_formula: {
      ...modules.copy_and_formula,
      copyVersion: "legacy-copy-template-v0",
    },
  };
}

function applyInput(fortuneDate: string, suffix: string): ContentProductionRebaseApplyInput {
  const source = legacyModules(fortuneDate);
  const target = new DeterministicDraftGenerator().generate(fortuneDate);
  if (
    source.calendar_algorithm === null ||
    source.copy_and_formula === null ||
    target.calendar_algorithm === null ||
    target.copy_and_formula === null
  ) {
    throw new Error("fixture modules are incomplete");
  }
  return {
    actorId: "operator-content-rebase",
    batchManifestSha256: "a".repeat(64),
    canonicalizationVersion: "canonical-json-v1",
    draftId: `draft-content-rebase-${suffix}`,
    expectedDraftRevision: 1,
    fortuneDate,
    generatorId: CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
    idempotencyKey: `content-rebase-${fortuneDate}-${suffix}`,
    occurredAt: OCCURRED_AT,
    planId: "five-legacy-production-rebase-2026-08-v1",
    planSha256: "b".repeat(64),
    reason: "将旧自动生成器草稿原子重算为当前确定性生成结果。",
    requestId: `request-content-rebase-${fortuneDate}-${suffix}`,
    sourceBuildId: "fabc5018212d92b10449c669104c2d58682af91d",
    sourceCreatedAt: OCCURRED_AT,
    sourceGeneratorFingerprint: "3".repeat(64),
    sourceModuleManifestSha256: "5".repeat(64),
    source: canonicalModulePair(source),
    targetBuildId: "c4adbe35885d2ff3cd56e00e6e80caf83f498560",
    target: canonicalModulePair(target),
  };
}

function runtime(input: ContentProductionRebaseApplyInput) {
  return {
    approvedLegacySources: new Map([
      [
        input.fortuneDate,
        {
          sourceBuildId: input.sourceBuildId,
          sourceGeneratorFingerprint: input.sourceGeneratorFingerprint,
          sourceModuleManifestSha256: input.sourceModuleManifestSha256,
          source: input.source,
        },
      ],
    ]),
    generatorId: CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
    targetBuildId: input.targetBuildId,
  } as const;
}

async function createFixture(pool: Pool, input: ContentProductionRebaseApplyInput): Promise<void> {
  const production = new AutomaticContentProductionService(
    new PostgresContentProductionStore(pool),
    { now: () => new Date(OCCURRED_AT) },
    {
      nextDraftId: () => input.draftId,
      nextImageJobId: (slot) => `job-${input.draftId}-${slot}`,
    },
  );
  const ensured = await production.ensureDay({
    actorId: "system-content-production-worker",
    fortuneDate: input.fortuneDate,
    idempotencyKey: `automatic-production:${input.fortuneDate}:v1`,
    requestId: `worker-production-${input.fortuneDate}`,
  });
  expect(ensured.kind).toBe("accepted");
  await pool.query(
    `UPDATE content_drafts
        SET modules = $2::jsonb
      WHERE draft_id = $1`,
    [input.draftId, JSON.stringify(legacyModules(input.fortuneDate))],
  );
}

async function submitFixtureVersion(
  pool: Pool,
  input: ContentProductionRebaseApplyInput,
  contentVersion: string,
  state: "in_review" | "published",
  makeActive: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO content_lifecycle_days (
       fortune_date, lifecycle_revision, active_content_version
     ) VALUES ($1::date, 1, NULL)`,
    [input.fortuneDate],
  );
  await pool.query(
    `INSERT INTO content_versions (
       content_version, draft_id, fortune_date, state, snapshot, preflight_checks,
       created_at, effective_from, effective_to
     ) VALUES (
       $1, $2, $3::date, $4::varchar, $5::jsonb, '[]'::jsonb,
       $6::timestamptz, $7::timestamptz, $8::timestamptz
     )`,
    [
      contentVersion,
      input.draftId,
      input.fortuneDate,
      state,
      JSON.stringify(new DeterministicDraftGenerator().generate(input.fortuneDate)),
      OCCURRED_AT,
      OCCURRED_AT,
      "2026-08-12T10:00:00.000Z",
    ],
  );
  await pool.query(
    `UPDATE content_drafts
        SET submitted_content_version = $1, submitted_at = $2::timestamptz
      WHERE draft_id = $3`,
    [contentVersion, OCCURRED_AT, input.draftId],
  );
  if (makeActive) {
    await pool.query(
      `UPDATE content_lifecycle_days SET active_content_version = $1
        WHERE fortune_date = $2::date`,
      [contentVersion, input.fortuneDate],
    );
  }
}

describeDatabase("PostgresContentProductionRebaseStore", () => {
  let pool: Pool;

  beforeAll(async () => {
    const { runner } = await import("node-pg-migrate");
    await runner({
      databaseUrl: databaseUrl!,
      dir: "migrations",
      direction: "up",
      migrationsTable: "pgmigrations",
    });
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  afterAll(async () => pool?.end());

  it("atomically rebases both deterministic modules and appends one replayable event", async () => {
    const input = applyInput("2026-08-20", "atomic");
    await createFixture(pool, input);
    const service = new ContentProductionRebaseService(
      new PostgresContentProductionRebaseStore(pool),
      runtime(input),
      new DeterministicDraftGenerator(),
    );

    await expect(service.apply(input)).resolves.toMatchObject({
      event: {
        draftId: input.draftId,
        fromDraftRevision: 1,
        source: { canonicalSha256: input.source.canonicalSha256 },
        target: { canonicalSha256: input.target.canonicalSha256 },
        toDraftRevision: 2,
      },
      kind: "rebased",
    });

    const draft = await pool.query<{
      draft_revision: string;
      modules: unknown;
    }>("SELECT draft_revision, modules FROM content_drafts WHERE draft_id = $1", [input.draftId]);
    expect(Number(draft.rows[0]?.draft_revision)).toBe(2);
    expect(hashCanonicalValue(draft.rows[0]?.modules)).toBe(
      hashCanonicalValue({
        calendar_algorithm: input.target.calendarAlgorithm,
        copy_and_formula: input.target.copyAndFormula,
        poster_consistency: null,
        visual_and_rights: null,
      }),
    );
    const events = await pool.query<{
      after_calendar_algorithm: unknown;
      after_copy_and_formula: unknown;
      before_calendar_algorithm: unknown;
      before_copy_and_formula: unknown;
    }>("SELECT * FROM content_draft_rebase_events WHERE idempotency_key = $1", [
      input.idempotencyKey,
    ]);
    expect(events.rowCount).toBe(1);
    expect(events.rows[0]).toMatchObject({
      after_calendar_algorithm: input.target.calendarAlgorithm,
      after_copy_and_formula: input.target.copyAndFormula,
      before_calendar_algorithm: input.source.calendarAlgorithm,
      before_copy_and_formula: input.source.copyAndFormula,
    });
  });

  it("rolls back both module changes when the append-only event cannot be recorded", async () => {
    const store = new PostgresContentProductionRebaseStore(pool, {
      beforeEventInsert: () => {
        throw new Error("injected event failure");
      },
    });
    const input = {
      ...applyInput("2026-08-21", "rollback"),
      idempotencyKey: `content-rebase-${randomUUID()}`,
    };
    await createFixture(pool, input);
    const service = new ContentProductionRebaseService(
      store,
      runtime(input),
      new DeterministicDraftGenerator(),
    );

    await expect(service.apply(input)).rejects.toThrow("injected event failure");

    const draft = await pool.query<{
      draft_revision: string;
      modules: unknown;
    }>("SELECT draft_revision, modules FROM content_drafts WHERE draft_id = $1", [input.draftId]);
    expect(Number(draft.rows[0]?.draft_revision)).toBe(1);
    expect(hashCanonicalValue(draft.rows[0]?.modules)).toBe(
      hashCanonicalValue(legacyModules(input.fortuneDate)),
    );
    const events = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM content_draft_rebase_events WHERE idempotency_key = $1",
      [input.idempotencyKey],
    );
    expect(events.rows[0]?.count).toBe("0");
  });

  it("replays the append-only event after later draft materialization without another write", async () => {
    const input = applyInput("2026-08-22", "replay");
    await createFixture(pool, input);
    const service = new ContentProductionRebaseService(
      new PostgresContentProductionRebaseStore(pool),
      runtime(input),
      new DeterministicDraftGenerator(),
      () => "draft-rebase-event-replay-first",
    );
    const first = await service.apply(input);
    expect(first.kind).toBe("rebased");
    await pool.query(
      `UPDATE content_drafts
          SET modules = jsonb_set(modules, '{visual_and_rights}', '{"looks":[]}'::jsonb)
        WHERE draft_id = $1`,
      [input.draftId],
    );

    await expect(
      service.apply({
        ...input,
        occurredAt: "2026-08-11T10:05:00.000Z",
        requestId: "request-content-rebase-retry-after-response-loss",
      }),
    ).resolves.toMatchObject({
      event: { eventId: "draft-rebase-event-replay-first", requestId: input.requestId },
      kind: "existing",
    });
    const state = await pool.query<{ count: string; draft_revision: string }>(
      `SELECT count(event.*)::text AS count, max(draft.draft_revision)::text AS draft_revision
         FROM content_draft_rebase_events AS event
         JOIN content_drafts AS draft ON draft.draft_id = event.draft_id
        WHERE event.idempotency_key = $1`,
      [input.idempotencyKey],
    );
    expect(state.rows[0]).toEqual({ count: "1", draft_revision: "2" });
  });

  it("rejects a changed business request under the same idempotency key", async () => {
    const input = applyInput("2026-08-23", "idempotency-conflict");
    await createFixture(pool, input);
    const service = new ContentProductionRebaseService(
      new PostgresContentProductionRebaseStore(pool),
      runtime(input),
      new DeterministicDraftGenerator(),
    );
    await expect(service.apply(input)).resolves.toMatchObject({ kind: "rebased" });
    await expect(
      service.apply({ ...input, reason: "不同的重算原因必须产生幂等冲突。" }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
  });

  it("accepts an explicitly empty lifecycle day but rejects a non-pristine source timestamp", async () => {
    const input = applyInput("2026-08-24", "lifecycle-null");
    await createFixture(pool, input);
    await pool.query(
      `INSERT INTO content_lifecycle_days (fortune_date, lifecycle_revision, active_content_version)
       VALUES ($1::date, 0, NULL)`,
      [input.fortuneDate],
    );
    const service = new ContentProductionRebaseService(
      new PostgresContentProductionRebaseStore(pool),
      runtime(input),
      new DeterministicDraftGenerator(),
    );
    await expect(service.apply(input)).resolves.toMatchObject({ kind: "rebased" });

    const modified = applyInput("2026-08-25", "timestamp-conflict");
    await createFixture(pool, modified);
    await pool.query(
      "UPDATE content_drafts SET updated_at = updated_at + interval '1 second' WHERE draft_id = $1",
      [modified.draftId],
    );
    const modifiedService = new ContentProductionRebaseService(
      new PostgresContentProductionRebaseStore(pool),
      runtime(modified),
      new DeterministicDraftGenerator(),
    );
    await expect(modifiedService.apply(modified)).resolves.toEqual({
      code: "source_mismatch",
      kind: "state_conflict",
    });
  });

  it("binds apply to the source creation timestamp frozen by inspection", async () => {
    const input = {
      ...applyInput("2026-09-02", "source-created-at"),
      sourceCreatedAt: "2026-08-11T10:00:01.000Z",
    };
    await createFixture(pool, input);
    const service = new ContentProductionRebaseService(
      new PostgresContentProductionRebaseStore(pool),
      runtime(input),
      new DeterministicDraftGenerator(),
    );

    await expect(service.apply(input)).resolves.toEqual({
      code: "source_mismatch",
      kind: "state_conflict",
    });
    await expect(
      pool.query("SELECT draft_revision FROM content_drafts WHERE draft_id = $1", [input.draftId]),
    ).resolves.toMatchObject({ rows: [{ draft_revision: "1" }] });
    await expect(
      pool.query(
        "SELECT count(*)::text AS count FROM content_draft_rebase_events WHERE draft_id = $1",
        [input.draftId],
      ),
    ).resolves.toMatchObject({ rows: [{ count: "0" }] });
  });

  it("classifies only a unique active published owner version as protected", async () => {
    const input = applyInput("2026-09-03", "protected-published");
    await createFixture(pool, input);
    const contentVersion = "content-protected-published";
    await submitFixtureVersion(pool, input, contentVersion, "published", true);

    await expect(
      new PostgresContentProductionRebaseStore(pool).inspect(input.fortuneDate),
    ).resolves.toEqual({
      code: "published_active_version",
      fortuneDate: input.fortuneDate,
      kind: "protected",
    });
  });

  it("keeps a submitted non-published version as a blocking anomaly", async () => {
    const input = applyInput("2026-09-04", "submitted-anomaly");
    await createFixture(pool, input);
    const contentVersion = "content-submitted-anomaly";
    await submitFixtureVersion(pool, input, contentVersion, "in_review", false);

    await expect(
      new PostgresContentProductionRebaseStore(pool).inspect(input.fortuneDate),
    ).resolves.toEqual({
      code: "submitted",
      kind: "state_conflict",
    });
  });

  it("classifies missing only when every related day state is absent", async () => {
    const store = new PostgresContentProductionRebaseStore(pool);
    await expect(store.inspect("2026-09-05")).resolves.toEqual({
      code: "not_found",
      fortuneDate: "2026-09-05",
      kind: "missing",
    });

    await pool.query(
      `INSERT INTO content_lifecycle_days (
         fortune_date, lifecycle_revision, active_content_version
       ) VALUES ('2026-09-06', 0, NULL)`,
    );
    await pool.query(
      `INSERT INTO content_drafts (
         draft_id, fortune_date, draft_revision, modules, submitted_content_version,
         created_at, updated_at, submitted_at
       ) VALUES (
         'draft-without-production', '2026-09-06', 1,
         '{"calendar_algorithm":null,"copy_and_formula":null,"poster_consistency":null,"visual_and_rights":null}'::jsonb,
         NULL, $1::timestamptz, $1::timestamptz, NULL
       )`,
      [OCCURRED_AT],
    );
    await expect(store.inspect("2026-09-06")).resolves.toMatchObject({
      kind: "state_conflict",
    });

    await pool.query(
      `INSERT INTO content_lifecycle_days (
         fortune_date, lifecycle_revision, active_content_version
       ) VALUES ('2026-09-07', 1, NULL)`,
    );
    await pool.query(
      `INSERT INTO content_drafts (
         draft_id, fortune_date, draft_revision, modules, submitted_content_version,
         created_at, updated_at, submitted_at
       ) VALUES (
         'version-without-production-draft', '2026-09-07', 1,
         '{"calendar_algorithm":null,"copy_and_formula":null,"poster_consistency":null,"visual_and_rights":null}'::jsonb,
         NULL, $1::timestamptz, $1::timestamptz, NULL
       )`,
      [OCCURRED_AT],
    );
    await pool.query(
      `INSERT INTO content_versions (
         content_version, draft_id, fortune_date, state, snapshot, preflight_checks,
         created_at, effective_from, effective_to
       ) VALUES (
         'version-without-production', 'version-without-production-draft', '2026-09-07',
         'in_review', '{}'::jsonb, '[]'::jsonb, $1::timestamptz,
         $1::timestamptz, ($1::timestamptz + interval '1 day')
       )`,
      [OCCURRED_AT],
    );
    await expect(store.inspect("2026-09-07")).resolves.toMatchObject({
      kind: "state_conflict",
    });
  });

  it("waits for the same day-correction advisory lock before inspecting or writing", async () => {
    const input = applyInput("2026-08-26", "correction-lock");
    await createFixture(pool, input);
    const blocker = await pool.connect();
    const lockName = `five:day-correction:open:${input.fortuneDate}`;
    await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockName]);
    const service = new ContentProductionRebaseService(
      new PostgresContentProductionRebaseStore(pool),
      runtime(input),
      new DeterministicDraftGenerator(),
    );
    let settled = false;
    const applying = service.apply(input).finally(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    await blocker.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockName]);
    blocker.release();
    await expect(applying).resolves.toMatchObject({ kind: "rebased" });
  });

  it("locks pristine jobs so a concurrent image worker cannot claim during the atomic rebase", async () => {
    const input = applyInput("2026-08-27", "job-lock");
    await createFixture(pool, input);
    await pool.query(
      `UPDATE daily_content_image_jobs
          SET available_at = '2100-01-01T00:00:00.000Z'::timestamptz
        WHERE fortune_date <> $1::date`,
      [input.fortuneDate],
    );
    let continueInsert: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      continueInsert = resolve;
    });
    let releaseHook: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseHook = resolve;
    });
    const store = new PostgresContentProductionRebaseStore(pool, {
      beforeEventInsert: async () => {
        continueInsert?.();
        await blocked;
      },
    });
    const service = new ContentProductionRebaseService(
      store,
      runtime(input),
      new DeterministicDraftGenerator(),
    );
    const applying = service.apply(input);
    await entered;
    try {
      const claimed = await new PostgresContentProductionStore(pool).claimNextImageJob({
        attemptToken: "attempt-during-content-rebase",
        claimedAt: "2026-08-11T10:00:01.000Z",
        leaseExpiresAt: "2026-08-11T10:10:01.000Z",
        workerId: "concurrent-image-worker",
      });
      expect(claimed).toBeNull();
    } finally {
      releaseHook?.();
    }
    await expect(applying).resolves.toMatchObject({ kind: "rebased" });
  });

  it("keeps rebase evidence append-only and refuses a non-empty migration rollback", async () => {
    await expect(
      pool.query("UPDATE content_draft_rebase_events SET reason = reason"),
    ).rejects.toThrow("content_draft_rebase_events is append-only");
    await expect(pool.query("DELETE FROM content_draft_rebase_events")).rejects.toThrow(
      "content_draft_rebase_events is append-only",
    );
    await expect(pool.query("TRUNCATE TABLE content_draft_rebase_events")).rejects.toThrow(
      "content_draft_rebase_events is append-only",
    );
    const { runner } = await import("node-pg-migrate");
    await expect(
      runner({
        count: 1,
        databaseUrl: databaseUrl!,
        dir: "migrations",
        direction: "down",
        migrationsTable: "pgmigrations",
      }),
    ).rejects.toThrow("Cannot roll back content draft rebase audit while evidence exists");
    await expect(
      pool.query("SELECT count(*)::integer AS count FROM content_draft_rebase_events"),
    ).resolves.toMatchObject({ rows: [{ count: expect.any(Number) }] });
  });

  it("fails closed when a stored request hash does not match the append-only evidence", async () => {
    const source = await pool.query<{ readonly idempotency_key: string }>(
      "SELECT idempotency_key FROM content_draft_rebase_events ORDER BY occurred_at LIMIT 1",
    );
    const badKey = "content-rebase-corrupt-request-evidence";
    await pool.query(
      `INSERT INTO content_draft_rebase_events
       SELECT rebase_event_id || '-bad-hash', fortune_date, draft_id, actor_id, reason,
              request_id, $1, $2, plan_id, $3, batch_manifest_sha256,
              canonicalization_version, source_build_id, source_created_at,
              source_generator_fingerprint, source_module_manifest_sha256,
              target_build_id, target_generator_id, before_calendar_algorithm,
              before_copy_and_formula, after_calendar_algorithm, after_copy_and_formula,
              before_calendar_sha256, before_copy_sha256, source_canonical_sha256,
              after_calendar_sha256, after_copy_sha256, target_canonical_sha256,
              from_draft_revision, to_draft_revision, occurred_at, retain_until
         FROM content_draft_rebase_events
        WHERE idempotency_key = $4`,
      [badKey, "f".repeat(64), "e".repeat(64), source.rows[0]?.idempotency_key],
    );

    await expect(
      new PostgresContentProductionRebaseStore(pool).inspectEvent(badKey),
    ).rejects.toThrow("request hash does not match its evidence");
  });

  it.each([
    {
      code: "image_jobs_not_pristine",
      date: "2026-08-28",
      mutate: (testPool: Pool, value: ContentProductionRebaseApplyInput) =>
        testPool.query(
          "UPDATE daily_content_image_jobs SET available_at = available_at + interval '1 second' WHERE fortune_date = $1::date",
          [value.fortuneDate],
        ),
      name: "changed image-job availability",
    },
    {
      code: "image_jobs_not_pristine",
      date: "2026-08-29",
      mutate: (testPool: Pool, value: ContentProductionRebaseApplyInput) =>
        testPool.query(
          "UPDATE daily_content_image_slot_currents SET updated_at = updated_at + interval '1 second' WHERE fortune_date = $1::date",
          [value.fortuneDate],
        ),
      name: "changed image-current timestamp",
    },
    {
      code: "source_mismatch",
      date: "2026-08-30",
      mutate: (testPool: Pool, value: ContentProductionRebaseApplyInput) =>
        testPool.query(
          "UPDATE daily_content_production_idempotency SET created_at = created_at + interval '1 second' WHERE fortune_date = $1::date",
          [value.fortuneDate],
        ),
      name: "changed creation idempotency timestamp",
    },
    {
      code: "source_mismatch",
      date: "2026-08-31",
      mutate: (testPool: Pool, value: ContentProductionRebaseApplyInput) =>
        testPool.query(
          `INSERT INTO daily_content_production_idempotency (
             idempotency_key, fortune_date, request_hash, created_at
           ) SELECT $2, fortune_date, request_hash, created_at
               FROM daily_content_production_idempotency
              WHERE fortune_date = $1::date
              LIMIT 1`,
          [value.fortuneDate, `automatic-production:${value.fortuneDate}:extra`],
        ),
      name: "extra production idempotency binding",
    },
    {
      code: "lifecycle_version_present",
      date: "2026-09-01",
      mutate: (testPool: Pool, value: ContentProductionRebaseApplyInput) =>
        testPool.query(
          `INSERT INTO content_lifecycle_days (
             fortune_date, lifecycle_revision, active_content_version
           ) VALUES ($1::date, 1, NULL)`,
          [value.fortuneDate],
        ),
      name: "advanced lifecycle revision",
    },
  ])("fails closed for $name", async ({ code, date, mutate }) => {
    const input = applyInput(date, `provenance-${date.replaceAll("-", "")}`);
    await createFixture(pool, input);
    await mutate(pool, input);
    const service = new ContentProductionRebaseService(
      new PostgresContentProductionRebaseStore(pool),
      runtime(input),
      new DeterministicDraftGenerator(),
    );
    await expect(service.apply(input)).resolves.toEqual({ code, kind: "state_conflict" });
  });
});
