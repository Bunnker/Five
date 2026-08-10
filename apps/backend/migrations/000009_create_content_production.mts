import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE daily_content_productions (
      fortune_date date PRIMARY KEY,
      draft_id varchar(80) NOT NULL UNIQUE REFERENCES content_drafts(draft_id),
      status varchar(24) NOT NULL,
      completed_image_slots smallint NOT NULL DEFAULT 0,
      pending_image_slots smallint NOT NULL DEFAULT 3,
      last_error varchar(500),
      actor_id varchar(80) NOT NULL,
      request_id varchar(128) NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT daily_content_productions_status_check CHECK (
        status IN ('generating', 'awaiting_review', 'failed')
      ),
      CONSTRAINT daily_content_productions_slot_count_check CHECK (
        completed_image_slots BETWEEN 0 AND 3
        AND pending_image_slots BETWEEN 0 AND 3
        AND completed_image_slots + pending_image_slots <= 3
      ),
      CONSTRAINT daily_content_productions_actor_check CHECK (
        char_length(actor_id) BETWEEN 1 AND 80
      ),
      CONSTRAINT daily_content_productions_request_check CHECK (
        char_length(request_id) BETWEEN 8 AND 128
      )
    );
    CREATE INDEX daily_content_productions_status_date_idx
      ON daily_content_productions (status, fortune_date);

    CREATE TABLE daily_content_image_jobs (
      job_id varchar(80) PRIMARY KEY,
      fortune_date date NOT NULL REFERENCES daily_content_productions(fortune_date),
      image_slot varchar(32) NOT NULL,
      prompt_version varchar(80) NOT NULL,
      status varchar(24) NOT NULL DEFAULT 'queued',
      attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL,
      claimed_at timestamptz,
      lease_expires_at timestamptz,
      worker_id varchar(128),
      attempt_token varchar(128),
      last_error varchar(2000),
      completed_asset_id varchar(80) REFERENCES daily_image_assets(asset_id),
      UNIQUE (fortune_date, image_slot, prompt_version),
      CONSTRAINT daily_content_image_jobs_slot_check CHECK (
        image_slot IN ('required_primary', 'required_alternative', 'optional')
      ),
      CONSTRAINT daily_content_image_jobs_status_check CHECK (
        status IN ('queued', 'claimed', 'retryable', 'completed', 'failed')
      ),
      CONSTRAINT daily_content_image_jobs_attempts_check CHECK (attempts >= 0)
    );
    CREATE INDEX daily_content_image_jobs_pending_idx
      ON daily_content_image_jobs (available_at, fortune_date, image_slot)
      WHERE status IN ('queued', 'retryable');

    CREATE TABLE daily_content_production_idempotency (
      idempotency_key varchar(128) PRIMARY KEY,
      fortune_date date NOT NULL REFERENCES daily_content_productions(fortune_date),
      request_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL,
      CONSTRAINT daily_content_production_idempotency_key_check CHECK (
        idempotency_key ~ '^[-A-Za-z0-9_:.]{16,128}$'
      ),
      CONSTRAINT daily_content_production_idempotency_hash_check CHECK (
        request_hash ~ '^[0-9a-f]{64}$'
      )
    );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS daily_content_production_idempotency;
    DROP TABLE IF EXISTS daily_content_image_jobs;
    DROP TABLE IF EXISTS daily_content_productions;
  `);
}
