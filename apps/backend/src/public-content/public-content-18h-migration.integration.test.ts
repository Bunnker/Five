import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PostgresContentReleaseStore } from "../content-release/postgres-content-release.store";
import { PostgresDayCorrectionStore } from "../day-correction/postgres-day-correction.store";

const databaseUrl = process.env.FIVE_PUBLIC_WINDOW_MIGRATION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("18:00 public-window data migration", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
  });

  afterEach(async () => {
    await pool.query(`
      DO $$
      BEGIN
        IF to_regclass('public.public_content_18h_version_migrations') IS NOT NULL THEN
          EXECUTE 'TRUNCATE TABLE public_content_18h_version_migrations CASCADE';
        END IF;
      END;
      $$;
    `);
    await pool.query("TRUNCATE TABLE poster_jobs, content_drafts, content_lifecycle_days CASCADE");
    await pool.query("DELETE FROM daily_image_assets WHERE asset_id = 'legacy-shared-image'");
    const { runner } = await import("node-pg-migrate");
    await runner({
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
      direction: "up",
    });
  });

  afterAll(async () => pool.end());

  it("clones immutable active and scheduled 23:00 versions, moves their owners, and terminates old tasks", async () => {
    const { runner } = await import("node-pg-migrate");
    const migrationOptions = {
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
    } as const;

    const appliedPublicWindowAndSuccessors = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pgmigrations WHERE name >= '000016_'",
    );
    const rollbackCount = Number(appliedPublicWindowAndSuccessors.rows[0]?.count ?? "0");
    expect(rollbackCount).toBeGreaterThanOrEqual(1);
    await runner({ ...migrationOptions, count: rollbackCount, direction: "down" });
    const fixtureDates = await pool.query<{ active_date: string; scheduled_date: string }>(`
      WITH current_delivery AS (
        SELECT (
          (transaction_timestamp() AT TIME ZONE 'Asia/Shanghai' - interval '18 hours')::date + 1
        ) AS fortune_date
      )
      SELECT fortune_date::text AS active_date,
             (fortune_date + 2)::text AS scheduled_date
        FROM current_delivery
    `);
    const activeDate = fixtureDates.rows[0]!.active_date;
    const scheduledDate = fixtureDates.rows[0]!.scheduled_date;
    await pool.query(`
      INSERT INTO content_lifecycle_days (
        fortune_date, lifecycle_revision, active_content_version,
        schedule_slot_revision, scheduled_content_version, scheduled_effective_from
      ) VALUES
        ('${activeDate}', 4, NULL, 0, NULL, NULL),
        ('${scheduledDate}', 7, NULL, 1, NULL, NULL);

      INSERT INTO content_drafts (
        draft_id, fortune_date, draft_revision, modules,
        submitted_content_version, created_at, updated_at, submitted_at
      ) VALUES
        ('legacy-active-draft', '${activeDate}', 1, '{}'::jsonb, NULL,
          '2026-08-06T08:00:00Z', '2026-08-06T08:00:00Z', NULL),
        ('legacy-scheduled-draft', '${scheduledDate}', 1, '{}'::jsonb, NULL,
          '2026-08-06T08:00:00Z', '2026-08-06T08:00:00Z', NULL),
        ('open-correction-draft', '${activeDate}', 1, '{}'::jsonb, NULL,
          '2026-08-06T08:00:00Z', '2026-08-06T08:00:00Z', NULL);

      INSERT INTO daily_image_assets (
        asset_id, storage_key, sha256, asset_json, uploaded_at
      ) VALUES (
        'legacy-shared-image',
        'aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '{"assetId":"legacy-shared-image","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb,
        '2026-08-06T08:01:00Z'
      );
      INSERT INTO draft_image_candidates (
        draft_id, asset_id, fortune_date, review_locked, uploaded_at, image_slot
      ) VALUES
        ('legacy-active-draft', 'legacy-shared-image', '${activeDate}', true,
          '2026-08-06T08:02:00Z', 'required_primary'),
        ('legacy-scheduled-draft', 'legacy-shared-image', '${scheduledDate}', false,
          '2026-08-06T08:02:00Z', 'required_primary');
      INSERT INTO draft_image_slot_selections (
        draft_id, image_slot, asset_id, selection_revision, selection_source,
        source_job_id, actor_id, reason, request_id, selected_at
      ) VALUES
        ('legacy-active-draft', 'required_primary', 'legacy-shared-image', 1,
          'manual_selection', NULL, 'operator:test', '旧窗口已选主图。',
          'legacy-active-selection', '2026-08-06T08:03:00Z'),
        ('legacy-scheduled-draft', 'required_primary', 'legacy-shared-image', 1,
          'manual_selection', NULL, 'operator:test', '旧窗口已选主图。',
          'legacy-scheduled-selection', '2026-08-06T08:03:00Z');

      INSERT INTO content_versions (
        content_version, draft_id, fortune_date, state, snapshot,
        preflight_checks, created_at, effective_from, effective_to
      ) VALUES
        ('legacy-active-v1', 'legacy-active-draft', '${activeDate}', 'published',
          '{}'::jsonb, '[]'::jsonb, '2026-08-06T08:00:00Z',
          (('${activeDate}'::date - 1) + time '23:00') AT TIME ZONE 'Asia/Shanghai',
          ('${activeDate}'::date + time '23:00') AT TIME ZONE 'Asia/Shanghai'),
        ('legacy-scheduled-v1', 'legacy-scheduled-draft', '${scheduledDate}', 'scheduled',
          '{}'::jsonb, '[]'::jsonb, '2026-08-06T08:00:00Z',
          (('${scheduledDate}'::date - 1) + time '23:00') AT TIME ZONE 'Asia/Shanghai',
          ('${scheduledDate}'::date + time '23:00') AT TIME ZONE 'Asia/Shanghai');

      UPDATE content_drafts
         SET submitted_content_version = CASE draft_id
               WHEN 'legacy-active-draft' THEN 'legacy-active-v1'
               ELSE 'legacy-scheduled-v1'
             END,
             submitted_at = '2026-08-06T08:05:00Z'
       WHERE draft_id IN ('legacy-active-draft', 'legacy-scheduled-draft');
      UPDATE content_lifecycle_days
         SET active_content_version = 'legacy-active-v1'
       WHERE fortune_date = '${activeDate}';
      UPDATE content_lifecycle_days
         SET scheduled_content_version = 'legacy-scheduled-v1',
             scheduled_effective_from =
               (('${scheduledDate}'::date - 1) + time '23:00') AT TIME ZONE 'Asia/Shanghai'
       WHERE fortune_date = '${scheduledDate}';

      INSERT INTO daily_image_sets (
        content_version, fortune_date, lifecycle_revision,
        assets_json, slots_json, created_at
      ) VALUES
        ('legacy-active-v1', '${activeDate}', 1, '[]'::jsonb, '[]'::jsonb,
          '2026-08-06T08:10:00Z'),
        ('legacy-scheduled-v1', '${scheduledDate}', 1, '[]'::jsonb, '[]'::jsonb,
          '2026-08-06T08:10:00Z');

      INSERT INTO master_review_evidence (
        evidence_id, content_version, reviewer_display_name, reviewed_at,
        conclusion, notes, references_json, recorded_at, recorded_revision
      ) VALUES (
        'legacy-active-evidence', 'legacy-active-v1', '本地验收',
        '2026-08-06T08:20:00Z', 'confirmed', '旧窗口迁移夹具。',
        '[{"kind":"note","reference":"legacy-window"}]'::jsonb,
        '2026-08-06T08:20:00Z', 1
      );

      INSERT INTO daily_content_productions (
        fortune_date, draft_id, status, completed_image_slots,
        pending_image_slots, last_error, actor_id, request_id, updated_at
      ) VALUES
        ('${activeDate}', 'legacy-active-draft', 'awaiting_review', 0, 0, NULL,
          'system:test', 'legacy-active-production', '2026-08-06T08:30:00Z'),
        ('${scheduledDate}', 'legacy-scheduled-draft', 'awaiting_review', 0, 0, NULL,
          'system:test', 'legacy-scheduled-production', '2026-08-06T08:30:00Z');

      INSERT INTO content_schedule_tasks (
        task_id, fortune_date, content_version, schedule_slot_revision,
        effective_from, status, attempts, available_at, claimed_at,
        lease_expires_at, worker_id, attempt_token, last_error,
        created_at, updated_at, completed_at, terminated_at, termination_reason
      ) VALUES (
        'legacy-schedule-task', '${scheduledDate}', 'legacy-scheduled-v1', 1,
        (('${scheduledDate}'::date - 1) + time '23:00') AT TIME ZONE 'Asia/Shanghai',
        'pending', 0,
        (('${scheduledDate}'::date - 1) + time '23:00') AT TIME ZONE 'Asia/Shanghai',
        NULL, NULL, NULL, NULL, NULL,
        '2026-08-06T08:40:00Z', '2026-08-06T08:40:00Z', NULL, NULL, NULL
      );
      INSERT INTO content_schedule_task_events (
        event_id, task_id, action, status, occurred_at, reason
      ) VALUES (
        'legacy-schedule-created', 'legacy-schedule-task', 'created', 'pending',
        '2026-08-06T08:40:00Z', '旧 23:00 排期。'
      );

      INSERT INTO poster_jobs (
        job_id, fortune_date, source_content_version,
        current_active_content_version, poster_template_version, channel_id,
        status, landing_url, attempts, available_at,
        locked_at, locked_by, attempt_token, created_at, updated_at
      ) VALUES (
        'legacy-processing-poster', '${activeDate}', 'legacy-active-v1',
        'legacy-active-v1', 'poster-template-v1', 'public-web',
        'processing', 'https://example.test/today', 1, '2026-08-06T08:45:00Z',
        '2026-08-06T08:46:00Z', 'worker:test', 'poster-attempt-token',
        '2026-08-06T08:45:00Z', '2026-08-06T08:46:00Z'
      );

      INSERT INTO day_corrections (
        correction_id, fortune_date, draft_id,
        source_content_version, source_draft_id,
        baseline_active_content_version, baseline_lifecycle_revision,
        correction_revision, status,
        apply_started_revision, apply_draft_revision,
        apply_idempotency_key_hash, apply_request_hash, apply_mode,
        scheduled_effective_from, submitted_content_version,
        submitted_lifecycle_revision, applied_action, terminal_failure,
        created_at, updated_at
      ) VALUES (
        'open-correction-before-window-migration', '${activeDate}',
        'open-correction-draft', 'legacy-active-v1', NULL,
        'legacy-active-v1', 4, 1, 'open',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        '2026-08-06T08:50:00Z', '2026-08-06T08:50:00Z'
      );
    `);

    await runner({ ...migrationOptions, count: 1, direction: "up" });

    const mappings = await pool.query<{
      new_content_version: string;
      new_draft_id: string;
      old_content_version: string;
      was_active: boolean;
      was_scheduled: boolean;
    }>(
      `SELECT old_content_version, new_content_version, new_draft_id,
              was_active, was_scheduled
         FROM public_content_18h_version_migrations
        ORDER BY old_content_version`,
    );
    expect(mappings.rows).toHaveLength(2);
    const active = mappings.rows.find((row) => row.old_content_version === "legacy-active-v1")!;
    const scheduled = mappings.rows.find(
      (row) => row.old_content_version === "legacy-scheduled-v1",
    )!;
    expect(active.was_active).toBe(true);
    expect(scheduled.was_scheduled).toBe(true);

    const versions = await pool.query<{
      content_version: string;
      from_time: string;
      state: string;
      to_time: string;
    }>(
      `SELECT content_version, state,
              to_char(effective_from AT TIME ZONE 'Asia/Shanghai', 'HH24:MI') AS from_time,
              to_char(effective_to AT TIME ZONE 'Asia/Shanghai', 'HH24:MI') AS to_time
         FROM content_versions
        WHERE content_version IN (
          'legacy-active-v1', 'legacy-scheduled-v1', $1, $2
        )
        ORDER BY content_version`,
      [active.new_content_version, scheduled.new_content_version],
    );
    expect(versions.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content_version: "legacy-active-v1", state: "superseded" }),
        expect.objectContaining({ content_version: "legacy-scheduled-v1", state: "approved" }),
        {
          content_version: active.new_content_version,
          from_time: "18:00",
          state: "published",
          to_time: "18:00",
        },
        {
          content_version: scheduled.new_content_version,
          from_time: "18:00",
          state: "scheduled",
          to_time: "18:00",
        },
      ]),
    );

    const owners = await pool.query<{
      active_content_version: string | null;
      draft_id: string;
      fortune_date: string;
      scheduled_content_version: string | null;
      scheduled_time: string | null;
    }>(
      `SELECT day.fortune_date::text, day.active_content_version,
              day.scheduled_content_version,
              to_char(day.scheduled_effective_from AT TIME ZONE 'Asia/Shanghai', 'HH24:MI')
                AS scheduled_time,
              production.draft_id
         FROM content_lifecycle_days AS day
         JOIN daily_content_productions AS production USING (fortune_date)
        WHERE day.fortune_date IN ('${activeDate}', '${scheduledDate}')
        ORDER BY day.fortune_date`,
    );
    expect(owners.rows).toEqual([
      expect.objectContaining({
        active_content_version: active.new_content_version,
        draft_id: active.new_draft_id,
        fortune_date: activeDate,
      }),
      expect.objectContaining({
        draft_id: scheduled.new_draft_id,
        fortune_date: scheduledDate,
        scheduled_content_version: scheduled.new_content_version,
        scheduled_time: "18:00",
      }),
    ]);

    const tasks = await pool.query<{ content_version: string; status: string }>(
      `SELECT content_version, status
         FROM content_schedule_tasks
        WHERE content_version IN ('legacy-scheduled-v1', $1)
        ORDER BY content_version`,
      [scheduled.new_content_version],
    );
    expect(tasks.rows).toEqual([
      { content_version: "legacy-scheduled-v1", status: "terminated" },
      { content_version: scheduled.new_content_version, status: "pending" },
    ]);

    await expect(
      pool.query("SELECT 1 FROM daily_image_sets WHERE content_version IN ($1, $2)", [
        active.new_content_version,
        scheduled.new_content_version,
      ]),
    ).resolves.toMatchObject({ rowCount: 2 });
    await expect(
      pool.query("SELECT 1 FROM master_review_evidence WHERE content_version = $1", [
        active.new_content_version,
      ]),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      pool.query(
        `SELECT candidate.draft_id, selection.asset_id
           FROM draft_image_candidates AS candidate
           JOIN draft_image_slot_selections AS selection
             ON selection.draft_id = candidate.draft_id
            AND selection.asset_id = candidate.asset_id
            AND selection.image_slot = candidate.image_slot
          WHERE candidate.draft_id IN ($1, $2)
          ORDER BY candidate.draft_id`,
        [active.new_draft_id, scheduled.new_draft_id],
      ),
    ).resolves.toMatchObject({
      rowCount: 2,
      rows: [
        { asset_id: "legacy-shared-image", draft_id: active.new_draft_id },
        { asset_id: "legacy-shared-image", draft_id: scheduled.new_draft_id },
      ].sort((left, right) => left.draft_id.localeCompare(right.draft_id)),
    });
    await expect(
      pool.query(
        "SELECT 1 FROM public_cache_purge_intents WHERE after_active_content_version = $1",
        [active.new_content_version],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
    await expect(
      pool.query("SELECT 1 FROM content_lifecycle_audit_events WHERE action = $1", [
        "public_window_cloned_to_18h",
      ]),
    ).resolves.toMatchObject({ rowCount: 2 });
    await expect(
      pool.query(
        `SELECT action, content_version,
                before_active_content_version, after_active_content_version
           FROM content_release_events
          WHERE request_id = 'migration-000016-public-18h'
          ORDER BY action`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          action: "publish",
          after_active_content_version: active.new_content_version,
          before_active_content_version: "legacy-active-v1",
          content_version: active.new_content_version,
        },
        {
          action: "schedule",
          after_active_content_version: null,
          before_active_content_version: null,
          content_version: scheduled.new_content_version,
        },
      ],
    });
    await expect(
      pool.query(
        `SELECT transitions_json
           FROM content_release_events
          WHERE request_id = 'migration-000016-public-18h'
            AND content_version = $1`,
        [active.new_content_version],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          transitions_json: [
            {
              contentVersion: "legacy-active-v1",
              fromState: "published",
              toState: "superseded",
            },
            {
              contentVersion: active.new_content_version,
              fromState: "approved",
              toState: "published",
            },
          ],
        },
      ],
    });
    await expect(
      pool.query(
        `SELECT status, current_active_content_version,
                locked_at, locked_by, attempt_token
           FROM poster_jobs
          WHERE job_id = 'legacy-processing-poster'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          attempt_token: null,
          current_active_content_version: active.new_content_version,
          locked_at: null,
          locked_by: null,
          status: "version_changed",
        },
      ],
    });
    await expect(
      pool.query(
        `SELECT source_content_version, baseline_active_content_version,
                baseline_lifecycle_revision::integer AS baseline_lifecycle_revision,
                status
           FROM day_corrections
          WHERE correction_id = 'open-correction-before-window-migration'`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          baseline_active_content_version: active.new_content_version,
          baseline_lifecycle_revision: 5,
          source_content_version: active.new_content_version,
          status: "open",
        },
      ],
    });

    await runner({ ...migrationOptions, direction: "up" });
    await expect(
      pool.query("SELECT count(*)::integer AS count FROM public_content_18h_version_migrations"),
    ).resolves.toMatchObject({ rows: [{ count: 2 }] });
  });

  it("takes its ownership snapshot after an in-flight publication commits", async () => {
    const { runner } = await import("node-pg-migrate");
    const migrationOptions = {
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
    } as const;

    const appliedPublicWindowAndSuccessors = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pgmigrations WHERE name >= '000016_'",
    );
    const rollbackCount = Number(appliedPublicWindowAndSuccessors.rows[0]?.count ?? "0");
    expect(rollbackCount).toBeGreaterThanOrEqual(1);
    await runner({ ...migrationOptions, count: rollbackCount, direction: "down" });
    await pool.query(`
      INSERT INTO content_lifecycle_days (
        fortune_date, lifecycle_revision, active_content_version,
        schedule_slot_revision, scheduled_content_version, scheduled_effective_from
      ) VALUES ('2099-09-01', 3, NULL, 1, NULL, NULL);

      INSERT INTO content_drafts (
        draft_id, fortune_date, draft_revision, modules,
        submitted_content_version, created_at, updated_at, submitted_at
      ) VALUES
        ('concurrent-active-draft', '2099-09-01', 1, '{}'::jsonb, NULL,
          '2026-08-06T08:00:00Z', '2026-08-06T08:00:00Z', NULL),
        ('concurrent-scheduled-draft', '2099-09-01', 1, '{}'::jsonb, NULL,
          '2026-08-06T08:00:00Z', '2026-08-06T08:00:00Z', NULL);

      INSERT INTO content_versions (
        content_version, draft_id, fortune_date, state, snapshot,
        preflight_checks, created_at, effective_from, effective_to
      ) VALUES
        ('concurrent-active-v1', 'concurrent-active-draft', '2099-09-01', 'published',
          '{}'::jsonb, '[]'::jsonb, '2026-08-06T08:00:00Z',
          '2099-08-31T15:00:00Z', '2099-09-01T15:00:00Z'),
        ('concurrent-scheduled-v1', 'concurrent-scheduled-draft', '2099-09-01', 'scheduled',
          '{}'::jsonb, '[]'::jsonb, '2026-08-06T08:00:00Z',
          '2099-08-31T15:00:00Z', '2099-09-01T15:00:00Z');

      UPDATE content_drafts
         SET submitted_content_version = CASE draft_id
               WHEN 'concurrent-active-draft' THEN 'concurrent-active-v1'
               ELSE 'concurrent-scheduled-v1'
             END,
             submitted_at = '2026-08-06T08:05:00Z';
      UPDATE content_lifecycle_days
         SET active_content_version = 'concurrent-active-v1',
             scheduled_content_version = 'concurrent-scheduled-v1',
             scheduled_effective_from = '2099-08-31T15:00:00Z'
       WHERE fortune_date = '2099-09-01';
    `);

    const publisher = await pool.connect();
    let publicationOpen = false;
    let migrationRun: ReturnType<typeof runner> | undefined;
    try {
      await publisher.query("BEGIN");
      publicationOpen = true;
      await publisher.query(`
        UPDATE content_lifecycle_days
           SET active_content_version = 'concurrent-scheduled-v1',
               scheduled_content_version = NULL,
               scheduled_effective_from = NULL,
               lifecycle_revision = lifecycle_revision + 1,
               schedule_slot_revision = schedule_slot_revision + 1
         WHERE fortune_date = '2099-09-01';
      `);
      const publisherPid = await publisher.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");

      migrationRun = runner({ ...migrationOptions, count: 1, direction: "up" });

      let migrationWaitsOnPublication = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await pool.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM pg_stat_activity
              WHERE datname = current_database()
                AND $1::integer = ANY(pg_blocking_pids(pid))
           ) AS waiting`,
          [publisherPid.rows[0]!.pid],
        );
        if (waiting.rows[0]?.waiting === true) {
          migrationWaitsOnPublication = true;
          break;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      expect(migrationWaitsOnPublication).toBe(true);

      await publisher.query(`
        UPDATE content_versions
           SET state = 'superseded'
         WHERE content_version = 'concurrent-active-v1';
        UPDATE content_versions
           SET state = 'published'
         WHERE content_version = 'concurrent-scheduled-v1';
      `);
      await publisher.query("COMMIT");
      publicationOpen = false;
      await migrationRun;

      const mappings = await pool.query<{
        new_content_version: string;
        old_content_version: string;
      }>(
        `SELECT old_content_version, new_content_version
           FROM public_content_18h_version_migrations
          ORDER BY old_content_version`,
      );
      expect(mappings.rows).toHaveLength(1);
      expect(mappings.rows[0]?.old_content_version).toBe("concurrent-scheduled-v1");

      const day = await pool.query<{
        active_content_version: string | null;
        scheduled_content_version: string | null;
      }>(
        `SELECT active_content_version, scheduled_content_version
           FROM content_lifecycle_days
          WHERE fortune_date = '2099-09-01'`,
      );
      expect(day.rows).toEqual([
        {
          active_content_version: mappings.rows[0]?.new_content_version,
          scheduled_content_version: null,
        },
      ]);
    } finally {
      if (publicationOpen) {
        await publisher.query("ROLLBACK");
      }
      publisher.release();
      if (migrationRun !== undefined) {
        await migrationRun.catch(() => undefined);
      }
    }
  });

  it("makes a correction baseline read wait until the cloned active pointer commits", async () => {
    const { runner } = await import("node-pg-migrate");
    const migrationOptions = {
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
    } as const;
    const fortuneDate = "2099-10-01";

    const appliedPublicWindowAndSuccessors = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pgmigrations WHERE name >= '000016_'",
    );
    const rollbackCount = Number(appliedPublicWindowAndSuccessors.rows[0]?.count ?? "0");
    expect(rollbackCount).toBeGreaterThanOrEqual(1);
    await runner({ ...migrationOptions, count: rollbackCount, direction: "down" });
    await pool.query(`
      INSERT INTO content_lifecycle_days (
        fortune_date, lifecycle_revision, active_content_version,
        schedule_slot_revision, scheduled_content_version, scheduled_effective_from
      ) VALUES ('${fortuneDate}', 3, NULL, 0, NULL, NULL);

      INSERT INTO content_drafts (
        draft_id, fortune_date, draft_revision, modules,
        submitted_content_version, created_at, updated_at, submitted_at
      ) VALUES (
        'baseline-race-draft', '${fortuneDate}', 1, '{}'::jsonb, NULL,
        '2026-08-06T08:00:00Z', '2026-08-06T08:00:00Z', NULL
      );

      INSERT INTO content_versions (
        content_version, draft_id, fortune_date, state, snapshot,
        preflight_checks, created_at, effective_from, effective_to
      ) VALUES (
        'baseline-race-v1', 'baseline-race-draft', '${fortuneDate}', 'published',
        '{}'::jsonb, '[]'::jsonb, '2026-08-06T08:00:00Z',
        '2099-09-30T15:00:00Z', '2099-10-01T15:00:00Z'
      );

      UPDATE content_drafts
         SET submitted_content_version = 'baseline-race-v1',
             submitted_at = '2026-08-06T08:05:00Z'
       WHERE draft_id = 'baseline-race-draft';
      UPDATE content_lifecycle_days
         SET active_content_version = 'baseline-race-v1'
       WHERE fortune_date = '${fortuneDate}';
    `);

    const lifecycleBlocker = await pool.connect();
    const correctionLockPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const baselinePool = new Pool({ connectionString: databaseUrl, max: 1 });
    const correctionStore = new PostgresDayCorrectionStore(correctionLockPool);
    const releaseStore = new PostgresContentReleaseStore(baselinePool);
    const correctionLockPid = await correctionLockPool.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    let blockerOpen = false;
    let migrationRun: ReturnType<typeof runner> | undefined;
    let baselineRead: Promise<Awaited<ReturnType<typeof releaseStore.readProjection>>> | undefined;
    try {
      await lifecycleBlocker.query("BEGIN");
      blockerOpen = true;
      await lifecycleBlocker.query("LOCK TABLE content_lifecycle_days IN ROW SHARE MODE");
      const blockerPid = await lifecycleBlocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );

      migrationRun = runner({ ...migrationOptions, count: 1, direction: "up" });
      void migrationRun.catch(() => undefined);

      let migrationWaitsOnLifecycle = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await pool.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM pg_stat_activity
              WHERE datname = current_database()
                AND $1::integer = ANY(pg_blocking_pids(pid))
           ) AS waiting`,
          [blockerPid.rows[0]!.pid],
        );
        if (waiting.rows[0]?.waiting === true) {
          migrationWaitsOnLifecycle = true;
          break;
        }
        await new Promise<void>((resolveWait) => setImmediate(resolveWait));
      }
      expect(migrationWaitsOnLifecycle).toBe(true);

      baselineRead = correctionStore.withOpenFortuneDateLock(fortuneDate, () =>
        releaseStore.readProjection(fortuneDate),
      );
      void baselineRead.catch(() => undefined);

      let correctionWaitsOnMigration = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const waiting = await pool.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1
               FROM pg_locks
              WHERE pid = $1
                AND locktype = 'advisory'
                AND mode = 'ExclusiveLock'
                AND NOT granted
           ) AS waiting`,
          [correctionLockPid.rows[0]!.pid],
        );
        if (waiting.rows[0]?.waiting === true) {
          correctionWaitsOnMigration = true;
          break;
        }
        await new Promise<void>((resolveWait) => setImmediate(resolveWait));
      }
      expect(correctionWaitsOnMigration).toBe(true);

      await lifecycleBlocker.query("COMMIT");
      blockerOpen = false;
      await migrationRun;
      const baseline = await baselineRead;
      const mapping = await pool.query<{ new_content_version: string }>(
        `SELECT new_content_version
           FROM public_content_18h_version_migrations
          WHERE old_content_version = 'baseline-race-v1'`,
      );
      expect(baseline).toMatchObject({
        activeContentVersion: mapping.rows[0]!.new_content_version,
        lifecycleRevision: 4,
      });
    } finally {
      if (blockerOpen) await lifecycleBlocker.query("ROLLBACK");
      lifecycleBlocker.release();
      if (migrationRun !== undefined) await migrationRun.catch(() => undefined);
      if (baselineRead !== undefined) await baselineRead.catch(() => undefined);
      await Promise.all([correctionLockPool.end(), baselinePool.end()]);
    }
  });

  it("publishes a legacy schedule immediately when its new 18:00 window is already open", async () => {
    const { runner } = await import("node-pg-migrate");
    const migrationOptions = {
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
    } as const;

    const appliedPublicWindowAndSuccessors = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pgmigrations WHERE name >= '000016_'",
    );
    const rollbackCount = Number(appliedPublicWindowAndSuccessors.rows[0]?.count ?? "0");
    expect(rollbackCount).toBeGreaterThanOrEqual(1);
    await runner({ ...migrationOptions, count: rollbackCount, direction: "down" });
    const deliveryDate = await pool.query<{ fortune_date: string }>(`
      SELECT (
        (transaction_timestamp() AT TIME ZONE 'Asia/Shanghai' - interval '18 hours')::date + 1
      )::text AS fortune_date
    `);
    const fortuneDate = deliveryDate.rows[0]!.fortune_date;
    await pool.query(
      `INSERT INTO content_lifecycle_days (
         fortune_date, lifecycle_revision, active_content_version,
         schedule_slot_revision, scheduled_content_version, scheduled_effective_from
       ) VALUES ($1::date, 2, NULL, 1, NULL, NULL)`,
      [fortuneDate],
    );
    await pool.query(
      `INSERT INTO content_drafts (
         draft_id, fortune_date, draft_revision, modules,
         submitted_content_version, created_at, updated_at, submitted_at
       ) VALUES (
         'due-scheduled-draft', $1::date, 1, '{}'::jsonb, NULL,
         transaction_timestamp(), transaction_timestamp(), NULL
       )`,
      [fortuneDate],
    );
    await pool.query(
      `INSERT INTO content_versions (
         content_version, draft_id, fortune_date, state, snapshot,
         preflight_checks, created_at, effective_from, effective_to
       ) VALUES (
         'due-scheduled-v1', 'due-scheduled-draft', $1::date, 'scheduled',
         '{}'::jsonb, '[]'::jsonb, transaction_timestamp(),
         (($1::date - 1) + time '23:00') AT TIME ZONE 'Asia/Shanghai',
         ($1::date + time '23:00') AT TIME ZONE 'Asia/Shanghai'
       )`,
      [fortuneDate],
    );
    await pool.query(
      `UPDATE content_drafts
          SET submitted_content_version = 'due-scheduled-v1',
              submitted_at = transaction_timestamp()
        WHERE draft_id = 'due-scheduled-draft'`,
    );
    await pool.query(
      `UPDATE content_lifecycle_days
          SET scheduled_content_version = 'due-scheduled-v1',
              scheduled_effective_from =
                (($1::date - 1) + time '23:00') AT TIME ZONE 'Asia/Shanghai'
        WHERE fortune_date = $1::date`,
      [fortuneDate],
    );

    await runner({ ...migrationOptions, count: 1, direction: "up" });

    const mapping = await pool.query<{ new_content_version: string }>(
      `SELECT new_content_version
         FROM public_content_18h_version_migrations
        WHERE old_content_version = 'due-scheduled-v1'`,
    );
    const newContentVersion = mapping.rows[0]!.new_content_version;
    await expect(
      pool.query(
        `SELECT content_version, state
           FROM content_versions
          WHERE content_version IN ('due-scheduled-v1', $1)
          ORDER BY content_version`,
        [newContentVersion],
      ),
    ).resolves.toMatchObject({
      rows: [
        { content_version: "due-scheduled-v1", state: "approved" },
        { content_version: newContentVersion, state: "published" },
      ].sort((left, right) => left.content_version.localeCompare(right.content_version)),
    });
    await expect(
      pool.query(
        `SELECT active_content_version, scheduled_content_version,
                scheduled_effective_from
           FROM content_lifecycle_days
          WHERE fortune_date = $1::date`,
        [fortuneDate],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          active_content_version: newContentVersion,
          scheduled_content_version: null,
          scheduled_effective_from: null,
        },
      ],
    });
    await expect(
      pool.query(
        "SELECT 1 FROM content_schedule_tasks WHERE content_version = $1 AND status = 'pending'",
        [newContentVersion],
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
    await expect(
      pool.query(
        `SELECT action, content_version, transitions_json
           FROM content_release_events
          WHERE request_id = 'migration-000016-public-18h'
            AND content_version = $1`,
        [newContentVersion],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          action: "scheduled_publish",
          content_version: newContentVersion,
          transitions_json: [
            {
              contentVersion: "due-scheduled-v1",
              fromState: "scheduled",
              toState: "approved",
            },
            {
              contentVersion: newContentVersion,
              fromState: "approved",
              toState: "published",
            },
          ],
        },
      ],
    });
    await expect(
      pool.query(
        "SELECT 1 FROM public_cache_purge_intents WHERE after_active_content_version = $1",
        [newContentVersion],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });
  });
});
