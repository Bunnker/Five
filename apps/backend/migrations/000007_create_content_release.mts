import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE content_lifecycle_days
      ADD COLUMN schedule_slot_revision bigint NOT NULL DEFAULT 0,
      ADD COLUMN scheduled_content_version varchar(80),
      ADD COLUMN scheduled_effective_from timestamptz,
      ADD CONSTRAINT content_lifecycle_days_schedule_revision_check
        CHECK (schedule_slot_revision >= 0),
      ADD CONSTRAINT content_lifecycle_days_schedule_pair_check CHECK (
        (scheduled_content_version IS NULL AND scheduled_effective_from IS NULL)
        OR (scheduled_content_version IS NOT NULL AND scheduled_effective_from IS NOT NULL)
      ),
      ADD CONSTRAINT content_lifecycle_days_scheduled_version_fkey
        FOREIGN KEY (scheduled_content_version) REFERENCES content_versions(content_version)
        DEFERRABLE INITIALLY IMMEDIATE;

    ALTER TABLE content_lifecycle_idempotency
      DROP CONSTRAINT content_lifecycle_idempotency_operation_check;
    ALTER TABLE content_lifecycle_idempotency
      ADD CONSTRAINT content_lifecycle_idempotency_operation_check CHECK (
        operation IN (
          'submit', 'add_master_review_evidence', 'review_decision',
          'image_upload', 'image_review', 'image_withdrawal',
          'schedule', 'cancel_schedule', 'publish', 'withdraw', 'rollback'
        )
      );

    CREATE TABLE content_release_effective_window_backfill (
      content_version varchar(80) PRIMARY KEY REFERENCES content_versions(content_version),
      effective_from_was_null boolean NOT NULL,
      effective_to_was_null boolean NOT NULL,
      CONSTRAINT content_release_effective_window_backfill_null_check CHECK (
        effective_from_was_null OR effective_to_was_null
      )
    );
    INSERT INTO content_release_effective_window_backfill (
      content_version, effective_from_was_null, effective_to_was_null
    )
    SELECT content_version, effective_from IS NULL, effective_to IS NULL
      FROM content_versions
     WHERE effective_from IS NULL OR effective_to IS NULL;

    UPDATE content_versions
       SET effective_from = COALESCE(
             effective_from,
             ((fortune_date - 1) + time '23:00') AT TIME ZONE 'Asia/Shanghai'
           ),
           effective_to = COALESCE(
             effective_to,
             (fortune_date + time '23:00') AT TIME ZONE 'Asia/Shanghai'
           )
     WHERE effective_from IS NULL OR effective_to IS NULL;
    ALTER TABLE content_versions
      ALTER COLUMN effective_from SET NOT NULL,
      ALTER COLUMN effective_to SET NOT NULL;

    CREATE OR REPLACE FUNCTION protect_content_version_snapshot() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'content_versions cannot be deleted';
      END IF;
      IF OLD.content_version IS DISTINCT FROM NEW.content_version
        OR OLD.draft_id IS DISTINCT FROM NEW.draft_id
        OR OLD.fortune_date IS DISTINCT FROM NEW.fortune_date
        OR OLD.snapshot IS DISTINCT FROM NEW.snapshot
        OR OLD.preflight_checks IS DISTINCT FROM NEW.preflight_checks
        OR OLD.created_at IS DISTINCT FROM NEW.created_at
        OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
        OR OLD.effective_to IS DISTINCT FROM NEW.effective_to THEN
        RAISE EXCEPTION 'content version snapshot is immutable';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TABLE content_schedule_tasks (
      task_id varchar(80) PRIMARY KEY,
      fortune_date date NOT NULL REFERENCES content_lifecycle_days(fortune_date),
      content_version varchar(80) NOT NULL REFERENCES content_versions(content_version),
      schedule_slot_revision bigint NOT NULL,
      effective_from timestamptz NOT NULL,
      status varchar(24) NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL,
      claimed_at timestamptz,
      lease_expires_at timestamptz,
      worker_id varchar(128),
      attempt_token varchar(128),
      last_error text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      completed_at timestamptz,
      terminated_at timestamptz,
      termination_reason varchar(2000),
      CONSTRAINT content_schedule_tasks_id_check
        CHECK (char_length(task_id) BETWEEN 1 AND 80),
      CONSTRAINT content_schedule_tasks_slot_revision_check
        CHECK (schedule_slot_revision >= 1),
      CONSTRAINT content_schedule_tasks_status_check
        CHECK (status IN ('pending', 'processing', 'completed', 'terminated', 'retrying')),
      CONSTRAINT content_schedule_tasks_attempts_check CHECK (attempts >= 0),
      CONSTRAINT content_schedule_tasks_time_check CHECK (updated_at >= created_at),
      CONSTRAINT content_schedule_tasks_claim_check CHECK (
        (status = 'processing'
          AND claimed_at IS NOT NULL
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at > claimed_at
          AND worker_id IS NOT NULL
          AND attempt_token IS NOT NULL)
        OR
        (status <> 'processing'
          AND claimed_at IS NULL
          AND lease_expires_at IS NULL
          AND worker_id IS NULL
          AND attempt_token IS NULL)
      ),
      CONSTRAINT content_schedule_tasks_terminal_check CHECK (
        (status = 'completed'
          AND completed_at IS NOT NULL
          AND terminated_at IS NULL
          AND termination_reason IS NULL)
        OR
        (status = 'terminated'
          AND completed_at IS NULL
          AND terminated_at IS NOT NULL
          AND char_length(btrim(termination_reason)) BETWEEN 1 AND 2000)
        OR
        (status IN ('pending', 'processing', 'retrying')
          AND completed_at IS NULL
          AND terminated_at IS NULL
          AND termination_reason IS NULL)
      ),
      CONSTRAINT content_schedule_tasks_retry_check CHECK (
        status <> 'retrying' OR last_error IS NOT NULL
      ),
      UNIQUE (fortune_date, schedule_slot_revision)
    );
    CREATE UNIQUE INDEX content_schedule_tasks_one_open_per_day_idx
      ON content_schedule_tasks (fortune_date)
      WHERE status IN ('pending', 'processing', 'retrying');
    CREATE INDEX content_schedule_tasks_claim_idx
      ON content_schedule_tasks (available_at, created_at, task_id)
      WHERE status IN ('pending', 'processing', 'retrying');

    CREATE TABLE content_schedule_task_events (
      event_id varchar(80) PRIMARY KEY,
      task_id varchar(80) NOT NULL REFERENCES content_schedule_tasks(task_id),
      action varchar(24) NOT NULL,
      status varchar(24) NOT NULL,
      occurred_at timestamptz NOT NULL,
      reason varchar(2000) NOT NULL,
      CONSTRAINT content_schedule_task_events_action_check
        CHECK (action IN ('created', 'claimed', 'retry_scheduled', 'completed', 'terminated')),
      CONSTRAINT content_schedule_task_events_status_check
        CHECK (status IN ('pending', 'processing', 'completed', 'terminated', 'retrying')),
      CONSTRAINT content_schedule_task_events_reason_check
        CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000)
    );
    CREATE INDEX content_schedule_task_events_task_time_idx
      ON content_schedule_task_events (task_id, occurred_at, event_id);
    CREATE TRIGGER content_schedule_task_events_append_only
      BEFORE UPDATE OR DELETE ON content_schedule_task_events
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();

    CREATE FUNCTION protect_content_schedule_task() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'content_schedule_tasks cannot be deleted';
      END IF;
      IF OLD.task_id IS DISTINCT FROM NEW.task_id
        OR OLD.fortune_date IS DISTINCT FROM NEW.fortune_date
        OR OLD.content_version IS DISTINCT FROM NEW.content_version
        OR OLD.schedule_slot_revision IS DISTINCT FROM NEW.schedule_slot_revision
        OR OLD.effective_from IS DISTINCT FROM NEW.effective_from
        OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'content schedule task identity is immutable';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER content_schedule_tasks_identity_immutable
      BEFORE UPDATE OR DELETE ON content_schedule_tasks
      FOR EACH ROW EXECUTE FUNCTION protect_content_schedule_task();

    CREATE TABLE content_release_events (
      release_event_id varchar(80) PRIMARY KEY,
      action varchar(32) NOT NULL,
      occurred_at timestamptz NOT NULL,
      request_id varchar(128) NOT NULL,
      fortune_date date NOT NULL REFERENCES content_lifecycle_days(fortune_date),
      content_version varchar(80) NOT NULL REFERENCES content_versions(content_version),
      actor_id varchar(80) NOT NULL,
      reason varchar(2000) NOT NULL,
      idempotency_key varchar(128),
      before_active_content_version varchar(80) REFERENCES content_versions(content_version),
      after_active_content_version varchar(80) REFERENCES content_versions(content_version),
      before_schedule_slot_revision bigint NOT NULL,
      after_schedule_slot_revision bigint NOT NULL,
      transitions_json jsonb NOT NULL,
      schedule_task_id varchar(80) REFERENCES content_schedule_tasks(task_id),
      CONSTRAINT content_release_events_action_check CHECK (
        action IN (
          'schedule', 'cancel_schedule', 'publish', 'withdraw', 'rollback',
          'scheduled_publish', 'scheduled_publish_failed'
        )
      ),
      CONSTRAINT content_release_events_request_check
        CHECK (char_length(request_id) BETWEEN 8 AND 128),
      CONSTRAINT content_release_events_actor_check
        CHECK (char_length(actor_id) BETWEEN 1 AND 80),
      CONSTRAINT content_release_events_reason_check
        CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
      CONSTRAINT content_release_events_idempotency_check CHECK (
        idempotency_key IS NULL OR idempotency_key ~ '^[-A-Za-z0-9_:.]{16,128}$'
      ),
      CONSTRAINT content_release_events_slot_revision_check CHECK (
        before_schedule_slot_revision >= 0
        AND after_schedule_slot_revision >= 0
      ),
      CONSTRAINT content_release_events_transitions_check CHECK (
        jsonb_typeof(transitions_json) = 'array'
        AND jsonb_array_length(transitions_json) >= 1
      )
    );
    CREATE INDEX content_release_events_date_time_idx
      ON content_release_events (fortune_date, occurred_at, release_event_id);
    CREATE INDEX content_release_events_version_time_idx
      ON content_release_events (content_version, occurred_at, release_event_id);
    CREATE TRIGGER content_release_events_append_only
      BEFORE UPDATE OR DELETE ON content_release_events
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();

    CREATE TABLE public_cache_purge_intents (
      purge_intent_id varchar(80) PRIMARY KEY,
      action varchar(32) NOT NULL,
      fortune_date date NOT NULL REFERENCES content_lifecycle_days(fortune_date),
      before_active_content_version varchar(80) REFERENCES content_versions(content_version),
      after_active_content_version varchar(80) REFERENCES content_versions(content_version),
      request_id varchar(128) NOT NULL,
      created_at timestamptz NOT NULL,
      status varchar(24) NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      available_at timestamptz NOT NULL,
      claimed_at timestamptz,
      lease_expires_at timestamptz,
      worker_id varchar(128),
      attempt_token varchar(128),
      last_error text,
      processed_at timestamptz,
      CONSTRAINT public_cache_purge_intents_action_check CHECK (
        action IN (
          'schedule', 'cancel_schedule', 'publish', 'withdraw', 'rollback',
          'scheduled_publish', 'scheduled_publish_failed'
        )
      ),
      CONSTRAINT public_cache_purge_intents_request_check
        CHECK (char_length(request_id) BETWEEN 8 AND 128),
      CONSTRAINT public_cache_purge_intents_status_check
        CHECK (status IN ('pending', 'processing', 'completed')),
      CONSTRAINT public_cache_purge_intents_attempts_check CHECK (attempts >= 0),
      CONSTRAINT public_cache_purge_intents_available_check CHECK (available_at >= created_at),
      CONSTRAINT public_cache_purge_intents_claim_check CHECK (
        (status = 'processing'
          AND claimed_at IS NOT NULL
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at > claimed_at
          AND worker_id IS NOT NULL
          AND attempt_token IS NOT NULL)
        OR
        (status <> 'processing'
          AND claimed_at IS NULL
          AND lease_expires_at IS NULL
          AND worker_id IS NULL
          AND attempt_token IS NULL)
      ),
      CONSTRAINT public_cache_purge_intents_processed_check
        CHECK (
          (status = 'completed' AND processed_at IS NOT NULL AND processed_at >= created_at)
          OR (status <> 'completed' AND processed_at IS NULL)
        )
    );
    CREATE INDEX public_cache_purge_intents_pending_idx
      ON public_cache_purge_intents (available_at, created_at, purge_intent_id)
      WHERE status IN ('pending', 'processing');
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS public_cache_purge_intents;
    DROP TRIGGER IF EXISTS content_release_events_append_only ON content_release_events;
    DROP TABLE IF EXISTS content_release_events;
    DROP TRIGGER IF EXISTS content_schedule_tasks_identity_immutable ON content_schedule_tasks;
    DROP FUNCTION IF EXISTS protect_content_schedule_task();
    DROP TRIGGER IF EXISTS content_schedule_task_events_append_only ON content_schedule_task_events;
    DROP TABLE IF EXISTS content_schedule_task_events;
    DROP TABLE IF EXISTS content_schedule_tasks;

    DELETE FROM content_lifecycle_idempotency
     WHERE operation IN ('schedule', 'cancel_schedule', 'publish', 'withdraw', 'rollback');
    ALTER TABLE content_lifecycle_idempotency
      DROP CONSTRAINT content_lifecycle_idempotency_operation_check;
    ALTER TABLE content_lifecycle_idempotency
      ADD CONSTRAINT content_lifecycle_idempotency_operation_check CHECK (
        operation IN (
          'submit', 'add_master_review_evidence', 'review_decision',
          'image_upload', 'image_review', 'image_withdrawal'
        )
      );

    CREATE OR REPLACE FUNCTION protect_content_version_snapshot() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'content_versions cannot be deleted';
      END IF;
      IF OLD.content_version IS DISTINCT FROM NEW.content_version
        OR OLD.draft_id IS DISTINCT FROM NEW.draft_id
        OR OLD.fortune_date IS DISTINCT FROM NEW.fortune_date
        OR OLD.snapshot IS DISTINCT FROM NEW.snapshot
        OR OLD.preflight_checks IS DISTINCT FROM NEW.preflight_checks
        OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'content version snapshot is immutable';
      END IF;
      RETURN NEW;
    END;
    $$;

    ALTER TABLE content_versions
      ALTER COLUMN effective_from DROP NOT NULL,
      ALTER COLUMN effective_to DROP NOT NULL;
    DO $$
    BEGIN
      IF to_regclass('content_release_effective_window_backfill') IS NOT NULL THEN
        UPDATE content_versions AS version
           SET effective_from = CASE
                 WHEN backfill.effective_from_was_null THEN NULL
                 ELSE version.effective_from
               END,
               effective_to = CASE
                 WHEN backfill.effective_to_was_null THEN NULL
                 ELSE version.effective_to
               END
          FROM content_release_effective_window_backfill AS backfill
         WHERE version.content_version = backfill.content_version;
      END IF;
    END;
    $$;
    DROP TABLE IF EXISTS content_release_effective_window_backfill;

    ALTER TABLE content_lifecycle_days
      DROP CONSTRAINT IF EXISTS content_lifecycle_days_scheduled_version_fkey,
      DROP CONSTRAINT IF EXISTS content_lifecycle_days_schedule_pair_check,
      DROP CONSTRAINT IF EXISTS content_lifecycle_days_schedule_revision_check,
      DROP COLUMN IF EXISTS scheduled_effective_from,
      DROP COLUMN IF EXISTS scheduled_content_version,
      DROP COLUMN IF EXISTS schedule_slot_revision;
  `);
}
