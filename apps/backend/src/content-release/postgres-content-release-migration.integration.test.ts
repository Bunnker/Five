import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.FIVE_CONTENT_RELEASE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("content release migration", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  afterAll(async () => pool.end());

  it("round-trips release constraints and freezes the backfilled effective window", async () => {
    const { runner } = await import("node-pg-migrate");
    const migrationOptions = {
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
    } as const;
    await pool.query("TRUNCATE TABLE poster_jobs, content_drafts, content_lifecycle_days CASCADE");
    await pool.query(
      "DELETE FROM content_lifecycle_idempotency WHERE operation IN ('schedule', 'cancel_schedule', 'publish', 'withdraw', 'rollback')",
    );
    await pool.query(
      `INSERT INTO content_lifecycle_idempotency (
         operation, resource_id, idempotency_key, request_hash, response_json, created_at
       ) VALUES (
         'publish', 'migration-release-version', 'migration-release-idempotency-0001',
         $1, '{}'::jsonb, clock_timestamp()
       )`,
      ["a".repeat(64)],
    );

    const appliedFromRelease = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pgmigrations WHERE name >= '000007_'",
    );
    const rollbackCount = Number(appliedFromRelease.rows[0]?.count ?? "0");
    expect(rollbackCount).toBeGreaterThanOrEqual(1);
    // Roll back 000007 and all installed successors so this keeps exercising
    // the release migration itself when later migrations are appended.
    await runner({ ...migrationOptions, count: rollbackCount, direction: "down" });
    await expect(
      pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM content_lifecycle_idempotency
          WHERE operation = 'publish'`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: "0" }] });

    const fortuneDate = "2030-01-04";
    const draftId = "migration-release-draft";
    const contentVersion = "migration-release-version";
    await pool.query(
      `INSERT INTO content_lifecycle_days (fortune_date, lifecycle_revision, active_content_version)
       VALUES ($1::date, 1, NULL)`,
      [fortuneDate],
    );
    await pool.query(
      `INSERT INTO content_drafts (
         draft_id, fortune_date, draft_revision, modules, submitted_content_version,
         created_at, updated_at, submitted_at
       ) VALUES ($1, $2::date, 1, '{}'::jsonb, NULL, $3::timestamptz, $3::timestamptz, NULL)`,
      [draftId, fortuneDate, "2030-01-01T00:00:00.000Z"],
    );
    await pool.query(
      `INSERT INTO content_versions (
         content_version, draft_id, fortune_date, state, snapshot, preflight_checks,
         created_at, effective_from, effective_to
       ) VALUES (
         $1, $2, $3::date, 'approved', '{}'::jsonb, '[]'::jsonb,
         $4::timestamptz, NULL, NULL
       )`,
      [contentVersion, draftId, fortuneDate, "2030-01-01T00:00:00.000Z"],
    );

    await runner({ ...migrationOptions, count: 1, direction: "up" });
    const window = await pool.query<{
      effective_from: Date;
      effective_to: Date;
    }>(
      `SELECT effective_from, effective_to
         FROM content_versions
        WHERE content_version = $1`,
      [contentVersion],
    );
    expect(window.rows[0]?.effective_from.toISOString()).toBe("2030-01-03T15:00:00.000Z");
    expect(window.rows[0]?.effective_to.toISOString()).toBe("2030-01-04T15:00:00.000Z");
    await expect(
      pool.query<{ column_name: string; is_nullable: string }>(
        `SELECT column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'content_versions'
            AND column_name IN ('effective_from', 'effective_to')
          ORDER BY column_name`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { column_name: "effective_from", is_nullable: "NO" },
        { column_name: "effective_to", is_nullable: "NO" },
      ],
    });

    await expect(
      pool.query(
        `UPDATE content_versions
            SET effective_to = $1::timestamptz
          WHERE content_version = $2`,
        ["2030-01-04T16:00:00.000Z", contentVersion],
      ),
    ).rejects.toThrow(/content version snapshot is immutable/u);
    await expect(
      pool.query(
        `UPDATE content_versions
            SET state = 'scheduled'
          WHERE content_version = $1`,
        [contentVersion],
      ),
    ).resolves.toMatchObject({ rowCount: 1 });

    await runner({ ...migrationOptions, count: 1, direction: "down" });
    const restored = await pool.query<{
      effective_from: Date | null;
      effective_to: Date | null;
    }>(
      `SELECT effective_from, effective_to
         FROM content_versions
        WHERE content_version = $1`,
      [contentVersion],
    );
    expect(restored.rows[0]).toMatchObject({ effective_from: null, effective_to: null });
    await runner({ ...migrationOptions, count: 1, direction: "up" });

    // Early development environments briefly applied 000007 before the reversible
    // bookkeeping table existed. Keep down usable there so they can migrate forward.
    await pool.query("DROP TABLE content_release_effective_window_backfill");
    await runner({ ...migrationOptions, count: 1, direction: "down" });
    await runner({ ...migrationOptions, count: 1, direction: "up" });
    if (rollbackCount > 1) {
      await runner({ ...migrationOptions, count: rollbackCount - 1, direction: "up" });
    }
  });
});
