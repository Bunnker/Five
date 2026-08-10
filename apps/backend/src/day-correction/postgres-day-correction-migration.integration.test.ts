import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("day correction migrations 000012 and 000013", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  afterAll(async () => pool.end());

  it("rolls both migrations down cleanly and recreates their ownership constraints", async () => {
    const { runner } = await import("node-pg-migrate");
    const migrationOptions = {
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
    } as const;
    const installed = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pgmigrations
        WHERE name IN (
          '000012_create_day_corrections',
          '000013_create_day_correction_image_jobs'
        )`,
    );
    expect(installed.rows[0]?.count).toBe("2");
    const fixtureId = randomUUID();
    const draftId = `draft-rollback-${fixtureId}`;
    const assetId = `asset-rollback-${fixtureId}`;
    const sha256 = "a".repeat(64);
    await pool.query(
      `INSERT INTO content_drafts (
         draft_id, fortune_date, draft_revision, modules, submitted_content_version,
         created_at, updated_at, submitted_at
       ) VALUES (
         $1, '2026-12-30', 2,
         jsonb_build_object(
           'visual_and_rights',
           jsonb_build_object('looks', jsonb_build_array(jsonb_build_object(
             'imageSlot', 'required_primary',
             'coverAssetId', $2::text
           )))
         ),
         NULL, now(), now(), NULL
       )`,
      [draftId, assetId],
    );
    await pool.query(
      `INSERT INTO daily_image_assets (
         asset_id, storage_key, sha256, asset_json, uploaded_at
       ) VALUES (
         $1::text, $2::text, $3::text,
         jsonb_build_object('assetId', $1::text, 'sha256', $3::text),
         now()
       )`,
      [assetId, `aa/${sha256}.png`, sha256],
    );
    await pool.query(
      `INSERT INTO draft_image_candidates (
         draft_id, asset_id, fortune_date, review_locked, uploaded_at, image_slot
       ) VALUES ($1, $2, '2026-12-30', true, now(), 'required_primary')`,
      [draftId, assetId],
    );
    await pool.query(
      `INSERT INTO draft_image_slot_selections (
         draft_id, image_slot, asset_id, selection_revision, selection_source,
         source_job_id, actor_id, reason, request_id, selected_at
       ) VALUES (
         $1, 'required_primary', $2, 1, 'correction_library',
         NULL, 'operator-migration-test', '保留订正搭配库选择。',
         'migration-rollback-selection', now()
       )`,
      [draftId, assetId],
    );

    let rolledBack = false;
    try {
      // 000014 and 000015 follow the correction migrations, so the rollback boundary
      // must cross all four latest migrations to actually exercise 000013/000012.
      await runner({ ...migrationOptions, count: 4, direction: "down" });
      rolledBack = true;
      const removed = await pool.query<{ removed: boolean }>(
        `SELECT
           to_regclass('public.day_corrections') IS NULL
           AND to_regclass('public.day_correction_image_jobs') IS NULL AS removed`,
      );
      expect(removed.rows[0]?.removed).toBe(true);
      const preserved = await pool.query<{
        asset_id: string;
        cover_asset_id: string;
        selection_source: string;
        source_job_id: string | null;
      }>(
        `SELECT
           selection.asset_id,
           draft.modules #>> '{visual_and_rights,looks,0,coverAssetId}' AS cover_asset_id,
           selection.selection_source,
           selection.source_job_id
         FROM draft_image_slot_selections AS selection
         JOIN content_drafts AS draft ON draft.draft_id = selection.draft_id
        WHERE selection.draft_id = $1
          AND selection.image_slot = 'required_primary'`,
        [draftId],
      );
      expect(preserved.rows).toEqual([
        {
          asset_id: assetId,
          cover_asset_id: assetId,
          selection_source: "manual_selection",
          source_job_id: null,
        },
      ]);
    } finally {
      if (rolledBack) {
        await runner({ ...migrationOptions, count: 4, direction: "up" });
      }
    }

    const constraints = await pool.query<{ conname: string }>(
      `SELECT conname
         FROM pg_constraint
        WHERE conname IN (
          'day_corrections_owner_unique',
          'day_correction_image_jobs_owner_fk',
          'day_correction_image_slot_currents_owner_fk'
        )
        ORDER BY conname`,
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      "day_correction_image_jobs_owner_fk",
      "day_correction_image_slot_currents_owner_fk",
      "day_corrections_owner_unique",
    ]);
    const auditColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'day_correction_image_jobs'
          AND column_name IN ('actor_id', 'reason', 'request_id', 'requested_at')
        ORDER BY column_name`,
    );
    expect(auditColumns.rows.map((row) => row.column_name)).toEqual([
      "actor_id",
      "reason",
      "request_id",
      "requested_at",
    ]);
    const restored = await pool.query<{ asset_id: string; selection_source: string }>(
      `SELECT asset_id, selection_source
         FROM draft_image_slot_selections
        WHERE draft_id = $1
          AND image_slot = 'required_primary'`,
      [draftId],
    );
    expect(restored.rows).toEqual([{ asset_id: assetId, selection_source: "manual_selection" }]);
  });

  it("backfills production-draft provenance and derives intent expiry from legacy creation time", async () => {
    const { runner } = await import("node-pg-migrate");
    const migrationOptions = {
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
    } as const;
    await runner({ ...migrationOptions, count: 1, direction: "down" });
    let restored = false;
    try {
      const fixtureId = randomUUID();
      const sourceCorrectionDraft = `draft-source-correction-${fixtureId}`;
      const sourceIntentDraft = `draft-source-intent-${fixtureId}`;
      const correctionDraft = `draft-legacy-correction-${fixtureId}`;
      for (const [draftId, fortuneDate] of [
        [sourceCorrectionDraft, "2026-12-27"],
        [correctionDraft, "2026-12-27"],
        [sourceIntentDraft, "2026-12-28"],
      ] as const) {
        await pool.query(
          `INSERT INTO content_drafts (
             draft_id, fortune_date, draft_revision, modules, submitted_content_version,
             created_at, updated_at, submitted_at
           ) VALUES ($1, $2::date, 1, '{}'::jsonb, NULL,
                     '2026-12-20T08:00:00.000Z', '2026-12-20T08:00:00.000Z', NULL)`,
          [draftId, fortuneDate],
        );
      }
      await pool.query(
        `INSERT INTO daily_content_productions (
           fortune_date, draft_id, status, completed_image_slots, pending_image_slots,
           actor_id, request_id, updated_at
         ) VALUES
           ('2026-12-27', $1, 'awaiting_review', 2, 0,
            'system-migration-test', 'request-migration-correction', '2026-12-20T08:00:00.000Z'),
           ('2026-12-28', $2, 'awaiting_review', 2, 0,
            'system-migration-test', 'request-migration-open-intent', '2026-12-20T08:00:00.000Z')`,
        [sourceCorrectionDraft, sourceIntentDraft],
      );
      await pool.query(
        `INSERT INTO day_corrections (
           correction_id, fortune_date, draft_id, source_content_version,
           baseline_active_content_version, baseline_lifecycle_revision,
           correction_revision, status, created_at, updated_at
         ) VALUES (
           $1, '2026-12-27', $2, NULL, NULL, 0, 1, 'open',
           '2026-12-20T08:00:00.000Z', '2026-12-20T08:00:00.000Z'
         )`,
        [`correction-legacy-${fixtureId}`, correctionDraft],
      );
      await pool.query(
        `INSERT INTO day_correction_open_intents (
           fortune_date, correction_id, draft_id, source_content_version,
           baseline_active_content_version, baseline_lifecycle_revision, created_at
         ) VALUES (
           '2026-12-28', $1, $2, NULL, NULL, 0, '2026-12-20T09:00:00.000Z'
         )`,
        [`correction-intent-legacy-${fixtureId}`, `draft-intent-legacy-${fixtureId}`],
      );

      await runner({ ...migrationOptions, count: 1, direction: "up" });
      restored = true;
      const correction = await pool.query<{ source_draft_id: string }>(
        `SELECT source_draft_id
           FROM day_corrections
          WHERE correction_id = $1`,
        [`correction-legacy-${fixtureId}`],
      );
      expect(correction.rows).toEqual([{ source_draft_id: sourceCorrectionDraft }]);
      const intent = await pool.query<{ expires_at: Date; source_draft_id: string }>(
        `SELECT expires_at, source_draft_id
           FROM day_correction_open_intents
          WHERE correction_id = $1`,
        [`correction-intent-legacy-${fixtureId}`],
      );
      expect(intent.rows[0]).toMatchObject({ source_draft_id: sourceIntentDraft });
      expect(intent.rows[0]?.expires_at.toISOString()).toBe("2026-12-20T09:15:00.000Z");
    } finally {
      if (!restored) {
        await runner({ ...migrationOptions, count: 1, direction: "up" });
      }
    }
  });
});
