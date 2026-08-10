import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE poster_landing_contract_v2_migrations (
      job_id varchar(128) PRIMARY KEY REFERENCES poster_jobs(job_id) ON DELETE CASCADE,
      previous_status varchar(32) NOT NULL,
      previous_asset_key varchar(200),
      migrated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT poster_landing_contract_v2_previous_status_check
        CHECK (previous_status IN ('processing', 'ready'))
    );

    INSERT INTO poster_landing_contract_v2_migrations (
      job_id,
      previous_status,
      previous_asset_key
    )
    SELECT job_id, status, asset_key
      FROM poster_jobs
     WHERE status IN ('processing', 'ready')
       AND strpos(
             landing_url,
             '&referralId=' || job_id || '&referralKind=poster'
           ) = 0;

    -- Clear every ready-only and claim-fence field in the same statement so the existing
    -- poster_jobs_ready_fields_check and poster_jobs_claim_fence_check remain true. Reservations
    -- deliberately stay behind: a stale/in-flight write is then collected by the normal durable
    -- garbage-asset path, while a completed ready asset becomes unretained and is reconciled from
    -- the dedicated poster store.
    UPDATE poster_jobs AS job
       SET status = 'version_changed',
           poster_instance_id = NULL,
           asset_key = NULL,
           asset_url = NULL,
           locked_at = NULL,
           locked_by = NULL,
           attempt_token = NULL,
           last_error = 'poster landing contract upgraded',
           updated_at = migration.migrated_at
      FROM poster_landing_contract_v2_migrations AS migration
     WHERE job.job_id = migration.job_id;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM poster_landing_contract_v2_migrations) THEN
        RAISE EXCEPTION
          'Cannot restore legacy poster jobs after their QR assets became eligible for garbage collection';
      END IF;
    END;
    $$;
    DROP TABLE poster_landing_contract_v2_migrations;
  `);
}
