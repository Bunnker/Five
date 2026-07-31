import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE poster_jobs (
      job_id varchar(128) PRIMARY KEY,
      fortune_date date NOT NULL,
      source_content_version varchar(128) NOT NULL,
      current_active_content_version varchar(128),
      poster_template_version varchar(128) NOT NULL,
      channel_id varchar(64) NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'processing',
      poster_instance_id varchar(128),
      asset_key varchar(200),
      asset_url text,
      landing_url text NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL DEFAULT now(),
      locked_at timestamptz,
      locked_by varchar(128),
      attempt_token varchar(128),
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT poster_jobs_status_check
        CHECK (status IN ('processing', 'ready', 'failed', 'version_changed')),
      CONSTRAINT poster_jobs_attempts_check CHECK (attempts >= 0),
      CONSTRAINT poster_jobs_ready_fields_check CHECK (
        (status = 'ready' AND poster_instance_id IS NOT NULL AND asset_key IS NOT NULL AND asset_url IS NOT NULL)
        OR
        (status <> 'ready' AND poster_instance_id IS NULL AND asset_key IS NULL AND asset_url IS NULL)
      ),
      CONSTRAINT poster_jobs_claim_fence_check CHECK (
        (locked_at IS NULL AND locked_by IS NULL AND attempt_token IS NULL)
        OR
        (status = 'processing' AND locked_at IS NOT NULL AND locked_by IS NOT NULL AND attempt_token IS NOT NULL)
      )
    );

    CREATE UNIQUE INDEX poster_jobs_poster_instance_id_uq
      ON poster_jobs (poster_instance_id)
      WHERE poster_instance_id IS NOT NULL;

    CREATE UNIQUE INDEX poster_jobs_reusable_intent_uq
      ON poster_jobs (source_content_version, poster_template_version, channel_id)
      WHERE status IN ('processing', 'ready');

    CREATE INDEX poster_jobs_claim_idx
      ON poster_jobs (available_at, created_at)
      WHERE status = 'processing';

    CREATE TABLE poster_asset_reservations (
      asset_key varchar(200) PRIMARY KEY,
      job_id varchar(128) NOT NULL REFERENCES poster_jobs(job_id) ON DELETE RESTRICT,
      locked_by varchar(128) NOT NULL,
      attempt_token varchar(128) NOT NULL,
      last_cleanup_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (job_id, attempt_token)
    );

    CREATE INDEX poster_asset_reservations_cleanup_idx
      ON poster_asset_reservations (last_cleanup_at, created_at);

    CREATE TABLE poster_job_idempotency (
      caller_scope varchar(64) NOT NULL,
      endpoint varchar(128) NOT NULL,
      idempotency_key varchar(128) NOT NULL,
      request_hash char(64) NOT NULL,
      job_id varchar(128) NOT NULL REFERENCES poster_jobs(job_id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (caller_scope, endpoint, idempotency_key),
      CONSTRAINT poster_job_idempotency_hash_check
        CHECK (request_hash ~ '^[0-9a-f]{64}$')
    );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS poster_job_idempotency;
    DROP TABLE IF EXISTS poster_asset_reservations;
    DROP TABLE IF EXISTS poster_jobs;
  `);
}
