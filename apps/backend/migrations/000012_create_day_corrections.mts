import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE day_corrections (
      correction_id varchar(80) PRIMARY KEY,
      fortune_date date NOT NULL,
      draft_id varchar(80) NOT NULL REFERENCES content_drafts(draft_id),
      source_content_version varchar(80) REFERENCES content_versions(content_version),
      baseline_active_content_version varchar(80) REFERENCES content_versions(content_version),
      baseline_lifecycle_revision bigint NOT NULL,
      correction_revision bigint NOT NULL,
      status varchar(24) NOT NULL,
      apply_started_revision bigint,
      apply_draft_revision bigint,
      apply_idempotency_key_hash char(64),
      apply_request_hash char(64),
      apply_mode varchar(24),
      scheduled_effective_from timestamptz,
      submitted_content_version varchar(80) REFERENCES content_versions(content_version),
      submitted_lifecycle_revision bigint,
      applied_action jsonb,
      terminal_failure jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT day_corrections_id_check CHECK (char_length(correction_id) BETWEEN 1 AND 80),
      CONSTRAINT day_corrections_baseline_revision_check CHECK (baseline_lifecycle_revision >= 0),
      CONSTRAINT day_corrections_revision_check CHECK (correction_revision >= 1),
      CONSTRAINT day_corrections_status_check CHECK (
        status IN ('open', 'applying', 'submitted', 'applied', 'abandoned')
      ),
      CONSTRAINT day_corrections_apply_mode_check CHECK (
        apply_mode IS NULL OR apply_mode IN ('immediate', 'scheduled')
      ),
      CONSTRAINT day_corrections_apply_key_check CHECK (
        apply_idempotency_key_hash IS NULL
        OR apply_idempotency_key_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT day_corrections_apply_request_hash_check CHECK (
        apply_request_hash IS NULL OR apply_request_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT day_corrections_time_check CHECK (updated_at >= created_at),
      CONSTRAINT day_corrections_schedule_time_check CHECK (
        (apply_mode = 'scheduled' AND scheduled_effective_from IS NOT NULL)
        OR (apply_mode IS DISTINCT FROM 'scheduled' AND scheduled_effective_from IS NULL)
      ),
      CONSTRAINT day_corrections_progress_check CHECK (
        (status = 'open'
          AND apply_started_revision IS NULL
          AND apply_draft_revision IS NULL
          AND apply_idempotency_key_hash IS NULL
          AND apply_request_hash IS NULL
          AND apply_mode IS NULL
          AND submitted_content_version IS NULL
          AND submitted_lifecycle_revision IS NULL
          AND applied_action IS NULL
          AND terminal_failure IS NULL)
        OR
        (status = 'applying'
          AND apply_started_revision >= 1
          AND apply_draft_revision >= 1
          AND apply_idempotency_key_hash IS NOT NULL
          AND apply_request_hash IS NOT NULL
          AND apply_mode IS NOT NULL
          AND submitted_content_version IS NULL
          AND submitted_lifecycle_revision IS NULL
          AND applied_action IS NULL
          AND terminal_failure IS NULL)
        OR
        (status = 'submitted'
          AND apply_started_revision >= 1
          AND apply_draft_revision >= 1
          AND apply_idempotency_key_hash IS NOT NULL
          AND apply_request_hash IS NOT NULL
          AND apply_mode IS NOT NULL
          AND submitted_content_version IS NOT NULL
          AND submitted_lifecycle_revision >= 1
          AND applied_action IS NULL
          AND terminal_failure IS NULL)
        OR
        (status = 'applied'
          AND apply_started_revision >= 1
          AND apply_draft_revision >= 1
          AND apply_idempotency_key_hash IS NOT NULL
          AND apply_request_hash IS NOT NULL
          AND apply_mode IS NOT NULL
          AND submitted_content_version IS NOT NULL
          AND submitted_lifecycle_revision >= 1
          AND jsonb_typeof(applied_action) = 'object'
          AND terminal_failure IS NULL)
        OR
        (status = 'abandoned'
          AND apply_started_revision >= 1
          AND apply_draft_revision >= 1
          AND apply_idempotency_key_hash IS NOT NULL
          AND apply_request_hash IS NOT NULL
          AND apply_mode IS NOT NULL
          AND submitted_content_version IS NOT NULL
          AND submitted_lifecycle_revision >= 1
          AND applied_action IS NULL
          AND jsonb_typeof(terminal_failure) = 'object')
      ),
      CONSTRAINT day_corrections_owner_unique UNIQUE (
        correction_id, draft_id, fortune_date
      )
    );

    CREATE UNIQUE INDEX day_corrections_one_unfinished_per_day_idx
      ON day_corrections (fortune_date)
      WHERE status IN ('open', 'applying', 'submitted');
    CREATE INDEX day_corrections_updated_idx
      ON day_corrections (updated_at DESC, correction_id DESC);

    CREATE TABLE day_correction_open_intents (
      fortune_date date PRIMARY KEY,
      correction_id varchar(80) NOT NULL UNIQUE,
      draft_id varchar(80) NOT NULL UNIQUE,
      source_content_version varchar(80) REFERENCES content_versions(content_version),
      baseline_active_content_version varchar(80) REFERENCES content_versions(content_version),
      baseline_lifecycle_revision bigint NOT NULL,
      created_at timestamptz NOT NULL,
      CONSTRAINT day_correction_open_intents_id_check CHECK (
        char_length(correction_id) BETWEEN 1 AND 80
        AND char_length(draft_id) BETWEEN 1 AND 80
      ),
      CONSTRAINT day_correction_open_intents_revision_check CHECK (
        baseline_lifecycle_revision >= 0
      )
    );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS day_correction_open_intents;
    DROP TABLE IF EXISTS day_corrections;
  `);
}
