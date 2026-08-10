import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresPosterJobRepository } from "./postgres-poster-job.repository";

const databaseUrl = process.env.FIVE_POSTER_LANDING_MIGRATION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("legacy poster landing contract migration", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
  });
  afterAll(async () => pool.end());

  it("invalidates old processing/ready QR jobs while preserving idempotency and garbage cleanup fences", async () => {
    const { runner } = await import("node-pg-migrate");
    const migrationOptions = {
      databaseUrl: databaseUrl!,
      dir: resolve(process.cwd(), "migrations"),
      log: () => undefined,
      migrationsTable: "pgmigrations",
    } as const;
    const cleanupFixtures = async () => {
      await pool.query(
        "DELETE FROM poster_asset_reservations WHERE job_id IN ('migration-legacy-processing', 'migration-legacy-ready', 'migration-current-ready', 'migration-replacement')",
      );
      await pool.query(
        "DELETE FROM poster_job_idempotency WHERE job_id IN ('migration-legacy-processing', 'migration-legacy-ready', 'migration-current-ready', 'migration-replacement')",
      );
      await pool.query(
        "DELETE FROM poster_jobs WHERE job_id IN ('migration-legacy-processing', 'migration-legacy-ready', 'migration-current-ready', 'migration-replacement')",
      );
    };
    await cleanupFixtures();
    await runner({ ...migrationOptions, count: 1, direction: "down" });
    try {
      await pool.query(`
        INSERT INTO poster_jobs (
          job_id, fortune_date, source_content_version, current_active_content_version,
          poster_template_version, channel_id, status, landing_url,
          locked_at, locked_by, attempt_token, created_at, updated_at
        ) VALUES (
          'migration-legacy-processing', '2026-08-09', 'content-v1', 'content-v1',
          'poster-template-v3', 'processing', 'processing',
          'https://five.example.com/daily/2026-08-09?channelId=processing&expectedContentVersion=content-v1',
          '2026-08-09T10:00:00Z', 'legacy-worker', 'legacy-attempt',
          '2026-08-09T09:00:00Z', '2026-08-09T10:00:00Z'
        );
        INSERT INTO poster_asset_reservations (
          asset_key, job_id, locked_by, attempt_token, created_at
        ) VALUES (
          'poster-legacy-processing.png', 'migration-legacy-processing',
          'legacy-worker', 'legacy-attempt', '2026-08-09T10:01:00Z'
        );

        INSERT INTO poster_jobs (
          job_id, fortune_date, source_content_version, current_active_content_version,
          poster_template_version, channel_id, status, poster_instance_id,
          asset_key, asset_url, landing_url, created_at, updated_at
        ) VALUES
        (
          'migration-legacy-ready', '2026-08-09', 'content-v1', 'content-v1',
          'poster-template-v3', 'organic', 'ready', 'poster-legacy-ready-instance',
          'poster-legacy-ready.png', 'https://assets.example.com/poster-legacy-ready.png',
          'https://five.example.com/daily/2026-08-09?channelId=organic&expectedContentVersion=content-v1',
          '2026-08-09T09:00:00Z', '2026-08-09T10:00:00Z'
        ),
        (
          'migration-current-ready', '2026-08-10', 'content-v2', 'content-v2',
          'poster-template-v3', 'organic', 'ready', 'poster-current-ready-instance',
          'poster-current-ready.png', 'https://assets.example.com/poster-current-ready.png',
          'https://five.example.com/daily/2026-08-10?channelId=organic&expectedContentVersion=content-v2&referralId=migration-current-ready&referralKind=poster',
          '2026-08-09T09:00:00Z', '2026-08-09T10:00:00Z'
        );

        INSERT INTO poster_job_idempotency (
          caller_scope, endpoint, idempotency_key, request_hash, job_id
        ) VALUES (
          'anonymous-web', '/api/v1/poster-jobs', 'migration-legacy-ready-key',
          '${"a".repeat(64)}', 'migration-legacy-ready'
        );
      `);

      await runner({ ...migrationOptions, count: 1, direction: "up" });

      await expect(
        pool.query(
          `SELECT job_id, status, poster_instance_id, asset_key, asset_url,
                  locked_at, locked_by, attempt_token
             FROM poster_jobs
            WHERE job_id LIKE 'migration-%'
            ORDER BY job_id`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            asset_key: "poster-current-ready.png",
            asset_url: "https://assets.example.com/poster-current-ready.png",
            attempt_token: null,
            job_id: "migration-current-ready",
            locked_at: null,
            locked_by: null,
            poster_instance_id: "poster-current-ready-instance",
            status: "ready",
          },
          {
            asset_key: null,
            asset_url: null,
            attempt_token: null,
            job_id: "migration-legacy-processing",
            locked_at: null,
            locked_by: null,
            poster_instance_id: null,
            status: "version_changed",
          },
          {
            asset_key: null,
            asset_url: null,
            attempt_token: null,
            job_id: "migration-legacy-ready",
            locked_at: null,
            locked_by: null,
            poster_instance_id: null,
            status: "version_changed",
          },
        ],
      });
      await expect(
        pool.query(
          `SELECT job_id, previous_status, previous_asset_key
             FROM poster_landing_contract_v2_migrations
            ORDER BY job_id`,
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            job_id: "migration-legacy-processing",
            previous_asset_key: null,
            previous_status: "processing",
          },
          {
            job_id: "migration-legacy-ready",
            previous_asset_key: "poster-legacy-ready.png",
            previous_status: "ready",
          },
        ],
      });

      const repository = new PostgresPosterJobRepository(pool);
      await expect(
        repository.findRetainedAssetKeys([
          "poster-legacy-processing.png",
          "poster-legacy-ready.png",
          "poster-current-ready.png",
        ]),
      ).resolves.toEqual(
        expect.arrayContaining(["poster-legacy-processing.png", "poster-current-ready.png"]),
      );
      await expect(repository.claimGarbageAssetKeys({ limit: 10 })).resolves.toEqual([
        "poster-legacy-processing.png",
      ]);
      await expect(
        repository.acknowledgeGarbageAsset("poster-legacy-processing.png"),
      ).resolves.toBe(true);
      await expect(
        repository.findRetainedAssetKeys([
          "poster-legacy-processing.png",
          "poster-legacy-ready.png",
          "poster-current-ready.png",
        ]),
      ).resolves.toEqual(["poster-current-ready.png"]);

      await expect(
        repository.findByIdempotency("migration-legacy-ready-key", "a".repeat(64)),
      ).resolves.toEqual({ kind: "missing" });
      await expect(
        repository.findByIdempotency("migration-legacy-ready-key", "b".repeat(64)),
      ).resolves.toEqual({ kind: "idempotency_conflict" });
      await expect(
        repository.createOrReuse({
          channelId: "organic",
          currentActiveContentVersion: "content-v1",
          expectedContentVersion: "content-v1",
          fortuneDate: "2026-08-09",
          idempotencyKey: "migration-legacy-ready-key",
          jobId: "migration-replacement",
          landingUrl:
            "https://five.example.com/daily/2026-08-09?channelId=organic&expectedContentVersion=content-v1&referralId=migration-replacement&referralKind=poster",
          posterTemplateVersion: "poster-template-v3",
          requestHash: "a".repeat(64),
        }),
      ).resolves.toMatchObject({
        kind: "created",
        record: { jobId: "migration-replacement", status: "processing" },
      });
    } finally {
      await runner({ ...migrationOptions, direction: "up" }).catch(() => undefined);
      await cleanupFixtures();
    }
  });
});
