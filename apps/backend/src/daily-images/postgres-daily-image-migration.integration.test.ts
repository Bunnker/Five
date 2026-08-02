import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("daily image migration rollback", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
  });

  afterAll(async () => pool.end());

  it("removes image idempotency rows before restoring the previous operation constraint", async () => {
    const { runner } = await import("node-pg-migrate");
    await pool.query(
      `INSERT INTO content_lifecycle_idempotency (
         operation, resource_id, idempotency_key, request_hash, response_json, created_at
       ) VALUES (
         'image_upload', 'draft-migration-rollback', 'migration-rollback-image-0001',
         $1, '{}'::jsonb, clock_timestamp()
       )`,
      ["a".repeat(64)],
    );

    const migrationOptions = {
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
    } as const;
    const appliedAfterLifecycle = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pgmigrations WHERE name >= '000006_'",
    );
    const rollbackCount = Number(appliedAfterLifecycle.rows[0]?.count ?? "0");
    expect(rollbackCount).toBeGreaterThanOrEqual(1);
    // Roll back the image migration and every currently installed successor so
    // this remains valid as new migrations are appended to the production chain.
    await runner({ ...migrationOptions, count: rollbackCount, direction: "down" });

    const remaining = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM content_lifecycle_idempotency
        WHERE operation LIKE 'image_%'`,
    );
    expect(remaining.rows[0]?.count).toBe("0");
    await expect(
      pool.query(
        `INSERT INTO content_lifecycle_idempotency (
           operation, resource_id, idempotency_key, request_hash, response_json, created_at
         ) VALUES (
           'image_upload', 'draft-migration-rollback', 'migration-rollback-image-0002',
           $1, '{}'::jsonb, clock_timestamp()
         )`,
        ["b".repeat(64)],
      ),
    ).rejects.toThrow(/content_lifecycle_idempotency_operation_check/u);

    await runner({ ...migrationOptions, count: rollbackCount, direction: "up" });
  });
});
