import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE content_lifecycle_days (
      fortune_date date PRIMARY KEY,
      lifecycle_revision bigint NOT NULL DEFAULT 0,
      active_content_version varchar(80),
      CONSTRAINT content_lifecycle_days_revision_check CHECK (lifecycle_revision >= 0)
    );

    CREATE TABLE content_drafts (
      draft_id varchar(80) PRIMARY KEY,
      fortune_date date NOT NULL,
      draft_revision bigint NOT NULL,
      modules jsonb NOT NULL,
      submitted_content_version varchar(80) UNIQUE,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      submitted_at timestamptz,
      CONSTRAINT content_drafts_id_check CHECK (char_length(draft_id) BETWEEN 1 AND 80),
      CONSTRAINT content_drafts_revision_check CHECK (draft_revision >= 1),
      CONSTRAINT content_drafts_modules_check CHECK (jsonb_typeof(modules) = 'object'),
      CONSTRAINT content_drafts_time_check CHECK (updated_at >= created_at),
      CONSTRAINT content_drafts_submission_check CHECK (
        (submitted_content_version IS NULL AND submitted_at IS NULL)
        OR (submitted_content_version IS NOT NULL AND submitted_at IS NOT NULL)
      )
    );
    CREATE INDEX content_drafts_editable_updated_idx
      ON content_drafts (updated_at DESC, draft_id DESC)
      WHERE submitted_content_version IS NULL;
    CREATE INDEX content_drafts_editable_date_updated_idx
      ON content_drafts (fortune_date, updated_at DESC, draft_id DESC)
      WHERE submitted_content_version IS NULL;

    CREATE TABLE content_versions (
      content_version varchar(80) PRIMARY KEY,
      draft_id varchar(80) NOT NULL UNIQUE REFERENCES content_drafts(draft_id),
      fortune_date date NOT NULL REFERENCES content_lifecycle_days(fortune_date),
      state varchar(24) NOT NULL,
      snapshot jsonb NOT NULL,
      preflight_checks jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      effective_from timestamptz,
      effective_to timestamptz,
      CONSTRAINT content_versions_id_check CHECK (char_length(content_version) BETWEEN 1 AND 80),
      CONSTRAINT content_versions_state_check CHECK (
        state IN (
          'in_review', 'changes_requested', 'approved', 'scheduled',
          'published', 'superseded', 'withdrawn'
        )
      ),
      CONSTRAINT content_versions_snapshot_check CHECK (jsonb_typeof(snapshot) = 'object'),
      CONSTRAINT content_versions_preflight_check CHECK (jsonb_typeof(preflight_checks) = 'array'),
      CONSTRAINT content_versions_effective_interval_check CHECK (
        effective_from IS NULL OR effective_to IS NULL OR effective_to > effective_from
      )
    );
    CREATE INDEX content_versions_date_created_idx
      ON content_versions (fortune_date, created_at DESC, content_version DESC);

    ALTER TABLE content_drafts
      ADD CONSTRAINT content_drafts_submitted_version_fkey
      FOREIGN KEY (submitted_content_version) REFERENCES content_versions(content_version)
      DEFERRABLE INITIALLY IMMEDIATE;
    ALTER TABLE content_lifecycle_days
      ADD CONSTRAINT content_lifecycle_days_active_version_fkey
      FOREIGN KEY (active_content_version) REFERENCES content_versions(content_version)
      DEFERRABLE INITIALLY IMMEDIATE;

    CREATE TABLE master_review_evidence (
      evidence_id varchar(80) PRIMARY KEY,
      content_version varchar(80) NOT NULL REFERENCES content_versions(content_version),
      reviewer_display_name varchar(80) NOT NULL,
      reviewed_at timestamptz NOT NULL,
      conclusion varchar(24) NOT NULL,
      notes varchar(2000) NOT NULL,
      references_json jsonb NOT NULL,
      recorded_at timestamptz NOT NULL,
      recorded_revision bigint NOT NULL,
      CONSTRAINT master_review_evidence_id_check CHECK (char_length(evidence_id) BETWEEN 1 AND 80),
      CONSTRAINT master_review_evidence_reviewer_check CHECK (
        char_length(btrim(reviewer_display_name)) BETWEEN 1 AND 80
      ),
      CONSTRAINT master_review_evidence_conclusion_check CHECK (
        conclusion IN ('confirmed', 'changes_requested')
      ),
      CONSTRAINT master_review_evidence_references_check CHECK (
        jsonb_typeof(references_json) = 'array'
        AND jsonb_array_length(references_json) BETWEEN 1 AND 20
      ),
      CONSTRAINT master_review_evidence_revision_check CHECK (recorded_revision >= 1),
      CONSTRAINT master_review_evidence_version_revision_unique
        UNIQUE (content_version, recorded_revision)
    );
    CREATE INDEX master_review_evidence_version_recorded_idx
      ON master_review_evidence (content_version, recorded_revision);

    CREATE TABLE content_lifecycle_audit_events (
      audit_event_id varchar(80) PRIMARY KEY,
      action varchar(80) NOT NULL,
      occurred_at timestamptz NOT NULL,
      request_id varchar(128) NOT NULL,
      fortune_date date NOT NULL,
      content_version varchar(80) NOT NULL REFERENCES content_versions(content_version),
      actor_id varchar(80) NOT NULL,
      reason varchar(2000) NOT NULL,
      from_state varchar(24),
      to_state varchar(24) NOT NULL,
      idempotency_key varchar(128) NOT NULL,
      retain_until timestamptz NOT NULL,
      CONSTRAINT content_lifecycle_audit_action_check CHECK (char_length(action) BETWEEN 1 AND 80),
      CONSTRAINT content_lifecycle_audit_request_check CHECK (char_length(request_id) BETWEEN 8 AND 128),
      CONSTRAINT content_lifecycle_audit_actor_check CHECK (char_length(actor_id) BETWEEN 1 AND 80),
      CONSTRAINT content_lifecycle_audit_reason_check CHECK (char_length(reason) BETWEEN 1 AND 2000),
      CONSTRAINT content_lifecycle_audit_from_state_check CHECK (
        from_state IS NULL OR from_state IN (
          'draft', 'in_review', 'changes_requested', 'approved', 'scheduled',
          'published', 'superseded', 'withdrawn'
        )
      ),
      CONSTRAINT content_lifecycle_audit_to_state_check CHECK (
        to_state IN (
          'draft', 'in_review', 'changes_requested', 'approved', 'scheduled',
          'published', 'superseded', 'withdrawn'
        )
      ),
      CONSTRAINT content_lifecycle_audit_idempotency_check CHECK (
        idempotency_key ~ '^[-A-Za-z0-9_:.]{16,128}$'
      ),
      CONSTRAINT content_lifecycle_audit_retention_check CHECK (
        retain_until >= occurred_at + interval '365 days'
      )
    );
    CREATE INDEX content_lifecycle_audit_occurred_idx
      ON content_lifecycle_audit_events (occurred_at DESC, audit_event_id DESC);
    CREATE INDEX content_lifecycle_audit_date_occurred_idx
      ON content_lifecycle_audit_events (fortune_date, occurred_at DESC, audit_event_id DESC);
    CREATE INDEX content_lifecycle_audit_version_occurred_idx
      ON content_lifecycle_audit_events (content_version, occurred_at DESC, audit_event_id DESC);

    CREATE TABLE content_lifecycle_idempotency (
      operation varchar(40) NOT NULL,
      resource_id varchar(80) NOT NULL,
      idempotency_key varchar(128) NOT NULL,
      request_hash char(64) NOT NULL,
      response_json jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (operation, resource_id, idempotency_key),
      CONSTRAINT content_lifecycle_idempotency_operation_check CHECK (
        operation IN ('submit', 'add_master_review_evidence', 'review_decision')
      ),
      CONSTRAINT content_lifecycle_idempotency_resource_check CHECK (
        char_length(resource_id) BETWEEN 1 AND 80
      ),
      CONSTRAINT content_lifecycle_idempotency_key_check CHECK (
        idempotency_key ~ '^[-A-Za-z0-9_:.]{16,128}$'
      ),
      CONSTRAINT content_lifecycle_idempotency_hash_check CHECK (
        request_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT content_lifecycle_idempotency_response_check CHECK (
        jsonb_typeof(response_json) = 'object'
      )
    );

    CREATE FUNCTION reject_content_lifecycle_append_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
    END;
    $$;
    CREATE TRIGGER master_review_evidence_append_only
      BEFORE UPDATE OR DELETE ON master_review_evidence
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();
    CREATE TRIGGER content_lifecycle_audit_events_append_only
      BEFORE UPDATE OR DELETE ON content_lifecycle_audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();

    CREATE FUNCTION protect_content_version_snapshot() RETURNS trigger
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
    CREATE TRIGGER content_versions_snapshot_immutable
      BEFORE UPDATE OR DELETE ON content_versions
      FOR EACH ROW EXECUTE FUNCTION protect_content_version_snapshot();

    CREATE FUNCTION protect_submitted_content_draft() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'content drafts cannot be deleted';
      END IF;
      IF OLD.submitted_content_version IS NOT NULL THEN
        RAISE EXCEPTION 'submitted content draft is immutable';
      END IF;
      IF NEW.submitted_content_version IS NOT NULL AND (
        OLD.draft_id IS DISTINCT FROM NEW.draft_id
        OR OLD.fortune_date IS DISTINCT FROM NEW.fortune_date
        OR OLD.draft_revision IS DISTINCT FROM NEW.draft_revision
        OR OLD.modules IS DISTINCT FROM NEW.modules
        OR OLD.created_at IS DISTINCT FROM NEW.created_at
        OR OLD.updated_at IS DISTINCT FROM NEW.updated_at
      ) THEN
        RAISE EXCEPTION 'draft submission cannot modify its payload';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER content_drafts_submitted_immutable
      BEFORE UPDATE OR DELETE ON content_drafts
      FOR EACH ROW EXECUTE FUNCTION protect_submitted_content_draft();
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TRIGGER IF EXISTS content_drafts_submitted_immutable ON content_drafts;
    DROP FUNCTION IF EXISTS protect_submitted_content_draft();
    DROP TRIGGER IF EXISTS content_versions_snapshot_immutable ON content_versions;
    DROP FUNCTION IF EXISTS protect_content_version_snapshot();
    DROP TRIGGER IF EXISTS content_lifecycle_audit_events_append_only ON content_lifecycle_audit_events;
    DROP TRIGGER IF EXISTS master_review_evidence_append_only ON master_review_evidence;
    DROP FUNCTION IF EXISTS reject_content_lifecycle_append_mutation();
    DROP TABLE IF EXISTS content_lifecycle_idempotency;
    DROP TABLE IF EXISTS content_lifecycle_audit_events;
    DROP TABLE IF EXISTS master_review_evidence;
    ALTER TABLE IF EXISTS content_lifecycle_days
      DROP CONSTRAINT IF EXISTS content_lifecycle_days_active_version_fkey;
    ALTER TABLE IF EXISTS content_drafts
      DROP CONSTRAINT IF EXISTS content_drafts_submitted_version_fkey;
    DROP TABLE IF EXISTS content_versions;
    DROP TABLE IF EXISTS content_drafts;
    DROP TABLE IF EXISTS content_lifecycle_days;
  `);
}
