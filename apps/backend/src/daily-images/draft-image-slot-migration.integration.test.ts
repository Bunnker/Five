import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AutomaticContentProductionService } from "../content-production/content-production.service";
import { PostgresContentProductionStore } from "../content-production/postgres-content-production.store";

const databaseUrl = process.env.FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

const migrationOptions = {
  databaseUrl: databaseUrl!,
  dir: resolve(process.cwd(), "migrations"),
  log: () => undefined,
  migrationsTable: "pgmigrations",
} as const;

async function insertAsset(
  pool: Pool,
  assetId: string,
  digit: string,
  sourceMaterialReferences: readonly string[] = [],
): Promise<void> {
  const sha = digit.repeat(64);
  await pool.query(
    `INSERT INTO daily_image_assets (
       asset_id, storage_key, sha256, asset_json, uploaded_at
     ) VALUES (
       $1::varchar, $2::varchar, $3::char(64),
       jsonb_build_object(
         'assetId', $1::varchar,
         'sha256', $3::char(64),
         'sourceMaterialReferences', to_jsonb($4::text[])
       ),
       clock_timestamp()
     )`,
    [assetId, `${digit.repeat(2)}/${sha}.png`, sha, sourceMaterialReferences],
  );
}

describeDatabase("draft image candidate slot migration", () => {
  let pool: Pool;

  beforeAll(async () => {
    const { runner } = await import("node-pg-migrate");
    await runner({ ...migrationOptions, count: 9, direction: "up" });
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  afterAll(async () => pool.end());

  it("backfills only uniquely proven history, keeps ambiguous and ordinary history null, and restores append-only protection", async () => {
    await pool.query(
      `INSERT INTO content_drafts (
         draft_id, fortune_date, draft_revision, modules,
         submitted_content_version, created_at, updated_at, submitted_at
       ) VALUES
         ('draft-slot-proven', '2026-08-03', 1, '{}'::jsonb, NULL, clock_timestamp(), clock_timestamp(), NULL),
         ('draft-slot-ambiguous', '2026-08-04', 1, '{}'::jsonb, NULL, clock_timestamp(), clock_timestamp(), NULL),
         ('draft-slot-ordinary', '2026-08-05', 1, '{}'::jsonb, NULL, clock_timestamp(), clock_timestamp(), NULL),
         ('draft-slot-crash-window', '2026-08-07', 1, '{}'::jsonb, NULL, clock_timestamp(), clock_timestamp(), NULL),
         ('draft-slot-source-ambiguous', '2026-08-08', 1, '{}'::jsonb, NULL, clock_timestamp(), clock_timestamp(), NULL)`,
    );
    for (const [assetId, digit] of [
      ["asset-slot-proven", "1"],
      ["asset-slot-ambiguous", "2"],
      ["asset-slot-ordinary", "3"],
    ] as const) {
      await insertAsset(pool, assetId, digit);
    }
    await insertAsset(pool, "asset-slot-crash-window", "8", [
      "production-job-job-slot-crash-window",
    ]);
    await insertAsset(pool, "asset-slot-source-ambiguous", "9", [
      "production-job-job-slot-source-primary",
      "production-job-job-slot-source-alternative",
    ]);
    await pool.query(
      `INSERT INTO draft_image_candidates (
         draft_id, asset_id, fortune_date, review_locked, uploaded_at
       ) VALUES
         ('draft-slot-proven', 'asset-slot-proven', '2026-08-03', false, clock_timestamp()),
         ('draft-slot-ambiguous', 'asset-slot-ambiguous', '2026-08-04', false, clock_timestamp()),
         ('draft-slot-ordinary', 'asset-slot-ordinary', '2026-08-05', false, clock_timestamp()),
         ('draft-slot-crash-window', 'asset-slot-crash-window', '2026-08-07', false, clock_timestamp()),
         ('draft-slot-source-ambiguous', 'asset-slot-source-ambiguous', '2026-08-08', false, clock_timestamp())`,
    );
    await pool.query(
      `INSERT INTO daily_content_productions (
         fortune_date, draft_id, status, completed_image_slots, pending_image_slots,
         last_error, actor_id, request_id, updated_at
       ) VALUES
         ('2026-08-03', 'draft-slot-proven', 'generating', 1, 2, NULL, 'migration-test', 'request-slot-proven', clock_timestamp()),
         ('2026-08-04', 'draft-slot-ambiguous', 'generating', 2, 1, NULL, 'migration-test', 'request-slot-ambiguous', clock_timestamp()),
         ('2026-08-07', 'draft-slot-crash-window', 'generating', 0, 2, NULL, 'migration-test', 'request-slot-crash-window', clock_timestamp()),
         ('2026-08-08', 'draft-slot-source-ambiguous', 'generating', 0, 2, NULL, 'migration-test', 'request-slot-source-ambiguous', clock_timestamp())`,
    );
    await pool.query(
      `INSERT INTO daily_content_image_jobs (
         job_id, fortune_date, image_slot, prompt_version, status, attempts,
         available_at, completed_asset_id
       ) VALUES
         ('job-slot-proven', '2026-08-03', 'required_primary', 'five-look-v1', 'completed', 1, clock_timestamp(), 'asset-slot-proven'),
         ('job-slot-ambiguous-primary', '2026-08-04', 'required_primary', 'five-look-v1', 'completed', 1, clock_timestamp(), 'asset-slot-ambiguous'),
         ('job-slot-ambiguous-alternative', '2026-08-04', 'required_alternative', 'five-look-v1', 'completed', 1, clock_timestamp(), 'asset-slot-ambiguous'),
         ('job-slot-crash-window', '2026-08-07', 'required_alternative', 'five-look-v1', 'queued', 0, clock_timestamp(), NULL),
         ('job-slot-source-primary', '2026-08-08', 'required_primary', 'five-look-v1', 'queued', 0, clock_timestamp(), NULL),
         ('job-slot-source-alternative', '2026-08-08', 'required_alternative', 'five-look-v1', 'queued', 0, clock_timestamp(), NULL)`,
    );

    const { runner } = await import("node-pg-migrate");
    await runner({ ...migrationOptions, count: 1, direction: "up" });

    const column = await pool.query<{ is_nullable: string }>(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'draft_image_candidates'
          AND column_name = 'image_slot'`,
    );
    expect(column.rows).toEqual([{ is_nullable: "YES" }]);
    const historical = await pool.query<{
      asset_id: string;
      image_slot: string | null;
    }>(
      `SELECT asset_id, image_slot
         FROM draft_image_candidates
        ORDER BY asset_id`,
    );
    expect(historical.rows).toEqual([
      { asset_id: "asset-slot-ambiguous", image_slot: null },
      { asset_id: "asset-slot-crash-window", image_slot: "required_alternative" },
      { asset_id: "asset-slot-ordinary", image_slot: null },
      { asset_id: "asset-slot-proven", image_slot: "required_primary" },
      { asset_id: "asset-slot-source-ambiguous", image_slot: null },
    ]);

    await insertAsset(pool, "asset-slot-primary-a", "4");
    await insertAsset(pool, "asset-slot-primary-b", "5");
    await pool.query(
      `INSERT INTO draft_image_candidates (
         draft_id, asset_id, fortune_date, image_slot, review_locked, uploaded_at
       ) VALUES
         ('draft-slot-ordinary', 'asset-slot-primary-a', '2026-08-05', 'required_primary', false, clock_timestamp()),
         ('draft-slot-ordinary', 'asset-slot-primary-b', '2026-08-05', 'required_primary', false, clock_timestamp())`,
    );

    const candidates = await pool.query<{ asset_id: string; image_slot: string | null }>(
      `SELECT asset_id, image_slot
         FROM draft_image_candidates
        WHERE draft_id = 'draft-slot-ordinary'
        ORDER BY asset_id`,
    );
    expect(
      candidates.rows.map(({ asset_id: assetId, image_slot: imageSlot }) => ({
        assetId,
        imageSlot,
      })),
    ).toEqual(
      expect.arrayContaining([
        { assetId: "asset-slot-ordinary", imageSlot: null },
        { assetId: "asset-slot-primary-a", imageSlot: "required_primary" },
        { assetId: "asset-slot-primary-b", imageSlot: "required_primary" },
      ]),
    );

    await expect(
      pool.query(
        `UPDATE draft_image_candidates
            SET image_slot = 'required_alternative'
          WHERE draft_id = 'draft-slot-ordinary'
            AND asset_id = 'asset-slot-primary-a'`,
      ),
    ).rejects.toThrow(/draft_image_candidates is append-only/u);
  });

  it("projects two required jobs and a nonblocking optional slot from PostgreSQL", async () => {
    await pool.query(
      `INSERT INTO daily_content_image_jobs (
         job_id, fortune_date, image_slot, prompt_version, status, attempts,
         available_at, completed_asset_id
       ) VALUES (
         'job-slot-proven-second-generation', '2026-08-03', 'required_primary',
         'five-look-v2', 'queued', 0, clock_timestamp(), NULL
       )`,
    );
    const { runner } = await import("node-pg-migrate");
    await runner({ ...migrationOptions, count: 1, direction: "up" });
    const historicalCurrents = await pool.query<{
      current_job_id: string | null;
      fortune_date: string;
      image_slot: string;
    }>(
      `SELECT fortune_date::text, image_slot, current_job_id
         FROM daily_content_image_slot_currents
        WHERE fortune_date IN ('2026-08-03', '2026-08-04')
        ORDER BY fortune_date, image_slot`,
    );
    expect(historicalCurrents.rows).toEqual([
      { current_job_id: null, fortune_date: "2026-08-03", image_slot: "optional" },
      { current_job_id: null, fortune_date: "2026-08-03", image_slot: "required_alternative" },
      { current_job_id: null, fortune_date: "2026-08-03", image_slot: "required_primary" },
      { current_job_id: null, fortune_date: "2026-08-04", image_slot: "optional" },
      {
        current_job_id: "job-slot-ambiguous-alternative",
        fortune_date: "2026-08-04",
        image_slot: "required_alternative",
      },
      {
        current_job_id: "job-slot-ambiguous-primary",
        fortune_date: "2026-08-04",
        image_slot: "required_primary",
      },
    ]);

    const ambiguousRecoveryService = new AutomaticContentProductionService(
      new PostgresContentProductionStore(pool),
      { now: () => new Date("2026-08-09T09:59:00.000Z") },
      {
        nextDraftId: () => "unused-ambiguous-recovery-draft",
        nextImageJobId: () => "job-slot-proven-recovery-v3",
      },
    );
    await expect(
      ambiguousRecoveryService.requestImageSlotGeneration({
        actorId: "migration-test",
        draftId: "draft-slot-proven",
        expectedDraftRevision: 1,
        fortuneDate: "2026-08-03",
        idempotencyKey: "recover-ambiguous-current-generation-0001",
        imageSlot: "required_primary",
        reason: "迁移无法判定 current，人工开始新的 generation。",
        requestId: "request-recover-ambiguous-current",
      }),
    ).resolves.toMatchObject({ kind: "accepted" });
    const recoveredGeneration = await pool.query<{
      current_job_id: string | null;
      generation_revision: number | string;
      max_generation_revision: number | string;
    }>(
      `SELECT current.current_job_id, current.generation_revision,
              max(job.generation_revision) AS max_generation_revision
         FROM daily_content_image_slot_currents AS current
         JOIN daily_content_image_jobs AS job
           ON job.fortune_date = current.fortune_date
          AND job.image_slot = current.image_slot
        WHERE current.fortune_date = '2026-08-03'
          AND current.image_slot = 'required_primary'
        GROUP BY current.current_job_id, current.generation_revision`,
    );
    expect(recoveredGeneration.rows).toEqual([
      {
        current_job_id: "job-slot-proven-recovery-v3",
        generation_revision: 3,
        max_generation_revision: 3,
      },
    ]);

    const store = new PostgresContentProductionStore(pool);
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-02T10:00:00.000Z") },
      {
        nextDraftId: () => "draft-slot-production",
        nextImageJobId: (imageSlot) => `job-slot-production-${imageSlot}`,
      },
    );
    const ensured = await service.ensureDay({
      actorId: "migration-test",
      fortuneDate: "2026-08-06",
      idempotencyKey: "ensure-slot-production-0001",
      requestId: "request-slot-production",
    });
    expect(ensured).toMatchObject({
      kind: "accepted",
      production: {
        completedImageSlots: 0,
        imageSlots: [
          { imageSlot: "required_primary", status: "pending" },
          { imageSlot: "required_alternative", status: "pending" },
          { imageSlot: "optional", status: "not_requested" },
        ],
        optionalImageStatus: "not_requested",
        pendingImageSlots: 2,
        requiredGenerationComplete: false,
      },
    });
    await expect(store.listProductions()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fortuneDate: "2026-08-06",
          optionalImageStatus: "not_requested",
          pendingImageSlots: 2,
        }),
      ]),
    );

    for (const [digit, attemptToken] of [
      ["6", "attempt-slot-production-1"],
      ["7", "attempt-slot-production-2"],
    ] as const) {
      const claimed = await store.claimNextImageJob({
        attemptToken,
        claimedAt: "2026-08-02T10:01:00.000Z",
        leaseExpiresAt: "2026-08-02T10:11:00.000Z",
        workerId: "worker-slot-production",
      });
      expect(claimed).not.toBeNull();
      if (claimed === null) return;
      const assetId = `asset-slot-production-${digit}`;
      await insertAsset(pool, assetId, digit);
      const uploadedRevision = claimed.draftRevision + 1;
      await pool.query(
        `INSERT INTO draft_image_candidates (
           draft_id, asset_id, fortune_date, image_slot, review_locked, uploaded_at
         ) VALUES ($1, $2, $3, $4, false, $5)`,
        [
          claimed.draftId,
          assetId,
          claimed.fortuneDate,
          claimed.imageSlot,
          `2026-08-02T10:0${Number(digit) - 5}:30.000Z`,
        ],
      );
      await pool.query(
        `UPDATE content_drafts
            SET draft_revision = $2, updated_at = $3
          WHERE draft_id = $1`,
        [claimed.draftId, uploadedRevision, `2026-08-02T10:0${Number(digit) - 5}:30.000Z`],
      );
      await store.completeImageJob({
        assetId,
        attemptToken,
        completedAt: `2026-08-02T10:0${Number(digit) - 4}:00.000Z`,
        draftRevision: uploadedRevision,
        jobId: claimed.jobId,
        sha256: digit.repeat(64),
        workerId: "worker-slot-production",
      });
    }

    await expect(
      store.claimNextImageJob({
        attemptToken: "attempt-slot-production-none",
        claimedAt: "2026-08-02T10:04:00.000Z",
        leaseExpiresAt: "2026-08-02T10:14:00.000Z",
        workerId: "worker-slot-production",
      }),
    ).resolves.toBeNull();
    await expect(store.listProductions()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          completedImageSlots: 2,
          fortuneDate: "2026-08-06",
          imageSlots: expect.arrayContaining([
            expect.objectContaining({ imageSlot: "required_primary", status: "ready" }),
            expect.objectContaining({ imageSlot: "required_alternative", status: "ready" }),
            expect.objectContaining({ imageSlot: "optional", status: "not_requested" }),
          ]),
          optionalImageStatus: "not_requested",
          pendingImageSlots: 0,
          requiredGenerationComplete: true,
          status: "awaiting_review",
        }),
      ]),
    );
    const jobCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM daily_content_image_jobs
        WHERE fortune_date = '2026-08-06'`,
    );
    expect(jobCount.rows[0]?.count).toBe("2");
    await pool.query(
      `UPDATE daily_content_image_slot_currents
          SET current_job_id = NULL, generation_revision = 0
        WHERE fortune_date = '2026-08-03' AND image_slot = 'required_primary';
       DELETE FROM daily_content_image_jobs
        WHERE job_id = 'job-slot-proven-recovery-v3'`,
    );
  });

  it("rolls the current-generation migration down and up without disturbing the slot migration", async () => {
    const { runner } = await import("node-pg-migrate");
    await pool.query(
      `INSERT INTO daily_content_image_jobs (
         job_id, fortune_date, image_slot, prompt_version, status, attempts,
         attempt_limit, generation_revision, available_at
       ) VALUES (
         'job-slot-down-blocker', '2026-08-03', 'required_primary',
         'five-look-v1', 'failed', 3, 3, 4, clock_timestamp()
       )`,
    );
    await expect(runner({ ...migrationOptions, count: 1, direction: "down" })).rejects.toThrow(
      /Cannot roll back current image generation while repeated generations exist/u,
    );
    await pool.query(`DELETE FROM daily_content_image_jobs WHERE job_id = 'job-slot-down-blocker'`);
    await runner({ ...migrationOptions, count: 1, direction: "down" });
    const rolledBack = await pool.query<{
      current_table: string | null;
      slot_column: string | null;
    }>(
      `SELECT
         to_regclass('daily_content_image_slot_currents')::text AS current_table,
         (
           SELECT column_name
             FROM information_schema.columns
            WHERE table_name = 'draft_image_candidates' AND column_name = 'image_slot'
         ) AS slot_column`,
    );
    expect(rolledBack.rows).toEqual([{ current_table: null, slot_column: "image_slot" }]);
    await runner({ ...migrationOptions, count: 1, direction: "up" });
    const restored = await pool.query<{ current_table: string | null }>(
      `SELECT to_regclass('daily_content_image_slot_currents')::text AS current_table`,
    );
    expect(restored.rows).toEqual([{ current_table: "daily_content_image_slot_currents" }]);
  });
});
