import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE content_draft_rebase_events (
      rebase_event_id varchar(80) PRIMARY KEY,
      fortune_date date NOT NULL REFERENCES daily_content_productions(fortune_date),
      draft_id varchar(80) NOT NULL REFERENCES content_drafts(draft_id),
      actor_id varchar(80) NOT NULL,
      reason varchar(2000) NOT NULL,
      request_id varchar(128) NOT NULL,
      idempotency_key varchar(128) NOT NULL UNIQUE,
      request_hash char(64) NOT NULL,
      plan_id varchar(128) NOT NULL,
      plan_sha256 char(64) NOT NULL,
      batch_manifest_sha256 char(64) NOT NULL,
      canonicalization_version varchar(40) NOT NULL,
      source_build_id varchar(128) NOT NULL,
      source_created_at timestamptz NOT NULL,
      source_generator_fingerprint char(64) NOT NULL,
      source_module_manifest_sha256 char(64) NOT NULL,
      target_build_id varchar(128) NOT NULL,
      target_generator_id varchar(128) NOT NULL,
      before_calendar_algorithm jsonb NOT NULL,
      before_copy_and_formula jsonb NOT NULL,
      after_calendar_algorithm jsonb NOT NULL,
      after_copy_and_formula jsonb NOT NULL,
      before_calendar_sha256 char(64) NOT NULL,
      before_copy_sha256 char(64) NOT NULL,
      source_canonical_sha256 char(64) NOT NULL,
      after_calendar_sha256 char(64) NOT NULL,
      after_copy_sha256 char(64) NOT NULL,
      target_canonical_sha256 char(64) NOT NULL,
      from_draft_revision bigint NOT NULL,
      to_draft_revision bigint NOT NULL,
      occurred_at timestamptz NOT NULL,
      retain_until timestamptz NOT NULL,
      CONSTRAINT content_draft_rebase_events_id_check CHECK (
        char_length(rebase_event_id) BETWEEN 1 AND 80
      ),
      CONSTRAINT content_draft_rebase_events_actor_check CHECK (
        char_length(actor_id) BETWEEN 1 AND 80
      ),
      CONSTRAINT content_draft_rebase_events_reason_check CHECK (
        char_length(btrim(reason)) BETWEEN 1 AND 2000
      ),
      CONSTRAINT content_draft_rebase_events_request_check CHECK (
        char_length(request_id) BETWEEN 8 AND 128
      ),
      CONSTRAINT content_draft_rebase_events_idempotency_check CHECK (
        idempotency_key ~ '^[-A-Za-z0-9_:.]{16,128}$'
      ),
      CONSTRAINT content_draft_rebase_events_plan_id_check CHECK (
        char_length(plan_id) BETWEEN 1 AND 128
      ),
      CONSTRAINT content_draft_rebase_events_build_identity_check CHECK (
        char_length(source_build_id) BETWEEN 1 AND 128
        AND char_length(target_build_id) BETWEEN 1 AND 128
        AND char_length(target_generator_id) BETWEEN 1 AND 128
      ),
      CONSTRAINT content_draft_rebase_events_canonicalization_check CHECK (
        canonicalization_version = 'canonical-json-v1'
      ),
      CONSTRAINT content_draft_rebase_events_hashes_check CHECK (
        request_hash ~ '^[0-9a-f]{64}$'
        AND plan_sha256 ~ '^[0-9a-f]{64}$'
        AND batch_manifest_sha256 ~ '^[0-9a-f]{64}$'
        AND source_generator_fingerprint ~ '^[0-9a-f]{64}$'
        AND source_module_manifest_sha256 ~ '^[0-9a-f]{64}$'
        AND before_calendar_sha256 ~ '^[0-9a-f]{64}$'
        AND before_copy_sha256 ~ '^[0-9a-f]{64}$'
        AND source_canonical_sha256 ~ '^[0-9a-f]{64}$'
        AND after_calendar_sha256 ~ '^[0-9a-f]{64}$'
        AND after_copy_sha256 ~ '^[0-9a-f]{64}$'
        AND target_canonical_sha256 ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT content_draft_rebase_events_modules_check CHECK (
        jsonb_typeof(before_calendar_algorithm) = 'object'
        AND jsonb_typeof(before_copy_and_formula) = 'object'
        AND jsonb_typeof(after_calendar_algorithm) = 'object'
        AND jsonb_typeof(after_copy_and_formula) = 'object'
      ),
      CONSTRAINT content_draft_rebase_events_revision_check CHECK (
        from_draft_revision >= 1
        AND to_draft_revision = from_draft_revision + 1
      ),
      CONSTRAINT content_draft_rebase_events_retention_check CHECK (
        retain_until >= occurred_at + interval '365 days'
      ),
      CONSTRAINT content_draft_rebase_events_plan_day_unique UNIQUE (
        plan_sha256, fortune_date
      )
    );

    CREATE INDEX content_draft_rebase_events_date_occurred_idx
      ON content_draft_rebase_events (fortune_date, occurred_at DESC, rebase_event_id DESC);
    CREATE INDEX content_draft_rebase_events_draft_occurred_idx
      ON content_draft_rebase_events (draft_id, occurred_at DESC, rebase_event_id DESC);

    CREATE TRIGGER content_draft_rebase_events_append_only
      BEFORE UPDATE OR DELETE ON content_draft_rebase_events
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();
    CREATE TRIGGER content_draft_rebase_events_truncate_rejected
      BEFORE TRUNCATE ON content_draft_rebase_events
      FOR EACH STATEMENT EXECUTE FUNCTION reject_content_lifecycle_append_mutation();
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $migration$
    BEGIN
      IF EXISTS (SELECT 1 FROM content_draft_rebase_events LIMIT 1) THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'Cannot roll back content draft rebase audit while evidence exists',
          HINT = 'Retain the append-only rebase evidence and roll forward instead.';
      END IF;
    END
    $migration$;

    DROP TRIGGER IF EXISTS content_draft_rebase_events_truncate_rejected
      ON content_draft_rebase_events;
    DROP TRIGGER IF EXISTS content_draft_rebase_events_append_only
      ON content_draft_rebase_events;
    DROP TABLE IF EXISTS content_draft_rebase_events;
  `);
}
