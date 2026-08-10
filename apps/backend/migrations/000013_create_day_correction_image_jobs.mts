import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE day_correction_image_jobs (
      job_id varchar(80) PRIMARY KEY,
      correction_id varchar(80) NOT NULL,
      draft_id varchar(80) NOT NULL REFERENCES content_drafts(draft_id),
      fortune_date date NOT NULL,
      image_slot varchar(32) NOT NULL,
      generation_revision bigint NOT NULL,
      prompt_version varchar(128) NOT NULL,
      status varchar(24) NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      attempt_limit integer NOT NULL DEFAULT 3,
      available_at timestamptz NOT NULL,
      claimed_at timestamptz,
      lease_expires_at timestamptz,
      worker_id varchar(128),
      attempt_token varchar(80),
      last_error varchar(2000),
      completed_asset_id varchar(80) REFERENCES daily_image_assets(asset_id),
      completed_at timestamptz,
      actor_id varchar(80) NOT NULL,
      reason varchar(500) NOT NULL,
      request_id varchar(128) NOT NULL,
      requested_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL,
      CONSTRAINT day_correction_image_jobs_id_check CHECK (
        char_length(job_id) BETWEEN 1 AND 80
      ),
      CONSTRAINT day_correction_image_jobs_slot_check CHECK (
        image_slot IN ('required_primary', 'required_alternative', 'optional')
      ),
      CONSTRAINT day_correction_image_jobs_revision_check CHECK (generation_revision >= 1),
      CONSTRAINT day_correction_image_jobs_prompt_check CHECK (
        char_length(prompt_version) BETWEEN 1 AND 128
      ),
      CONSTRAINT day_correction_image_jobs_request_evidence_check CHECK (
        char_length(actor_id) BETWEEN 1 AND 80
        AND char_length(btrim(reason)) BETWEEN 1 AND 500
        AND char_length(request_id) BETWEEN 8 AND 128
      ),
      CONSTRAINT day_correction_image_jobs_status_check CHECK (
        status IN ('queued', 'claimed', 'retryable', 'failed', 'completed')
      ),
      CONSTRAINT day_correction_image_jobs_attempt_check CHECK (
        attempts >= 0 AND attempt_limit >= 1 AND attempts <= attempt_limit
      ),
      CONSTRAINT day_correction_image_jobs_claim_check CHECK (
        (status = 'claimed'
          AND claimed_at IS NOT NULL
          AND lease_expires_at IS NOT NULL
          AND worker_id IS NOT NULL
          AND attempt_token IS NOT NULL)
        OR
        (status <> 'claimed'
          AND claimed_at IS NULL
          AND lease_expires_at IS NULL
          AND worker_id IS NULL
          AND attempt_token IS NULL)
      ),
      CONSTRAINT day_correction_image_jobs_completion_check CHECK (
        (status = 'completed' AND completed_asset_id IS NOT NULL AND completed_at IS NOT NULL)
        OR
        (status <> 'completed' AND completed_asset_id IS NULL AND completed_at IS NULL)
      ),
      CONSTRAINT day_correction_image_jobs_generation_unique UNIQUE (
        correction_id, image_slot, generation_revision
      ),
      CONSTRAINT day_correction_image_jobs_current_identity_unique UNIQUE (
        job_id, correction_id, draft_id, fortune_date, image_slot, generation_revision
      ),
      CONSTRAINT day_correction_image_jobs_owner_fk FOREIGN KEY (
        correction_id, draft_id, fortune_date
      ) REFERENCES day_corrections(correction_id, draft_id, fortune_date),
      CONSTRAINT day_correction_image_jobs_candidate_fk FOREIGN KEY (
        draft_id, completed_asset_id, image_slot
      ) REFERENCES draft_image_candidates(draft_id, asset_id, image_slot)
    );

    CREATE TABLE day_correction_image_slot_currents (
      correction_id varchar(80) NOT NULL,
      draft_id varchar(80) NOT NULL REFERENCES content_drafts(draft_id),
      fortune_date date NOT NULL,
      image_slot varchar(32) NOT NULL,
      current_job_id varchar(80) NOT NULL,
      generation_revision bigint NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (correction_id, image_slot),
      CONSTRAINT day_correction_image_slot_currents_slot_check CHECK (
        image_slot IN ('required_primary', 'required_alternative', 'optional')
      ),
      CONSTRAINT day_correction_image_slot_currents_revision_check CHECK (
        generation_revision >= 1
      ),
      CONSTRAINT day_correction_image_slot_currents_owner_fk FOREIGN KEY (
        correction_id, draft_id, fortune_date
      ) REFERENCES day_corrections(correction_id, draft_id, fortune_date),
      CONSTRAINT day_correction_image_slot_currents_job_fk FOREIGN KEY (
        current_job_id, correction_id, draft_id, fortune_date, image_slot,
        generation_revision
      ) REFERENCES day_correction_image_jobs(
        job_id, correction_id, draft_id, fortune_date, image_slot, generation_revision
      )
    );
    CREATE INDEX day_correction_image_slot_currents_job_idx
      ON day_correction_image_slot_currents(current_job_id);

    CREATE TABLE day_correction_image_idempotency (
      operation varchar(32) NOT NULL,
      correction_id varchar(80) NOT NULL REFERENCES day_corrections(correction_id),
      idempotency_key varchar(128) NOT NULL,
      request_hash char(64) NOT NULL,
      response_json jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (operation, correction_id, idempotency_key),
      CONSTRAINT day_correction_image_idempotency_operation_check CHECK (
        operation IN ('candidate_select', 'regenerate', 'reuse', 'upload')
      ),
      CONSTRAINT day_correction_image_idempotency_key_check CHECK (
        idempotency_key ~ '^[-A-Za-z0-9_:.]{16,128}$'
      ),
      CONSTRAINT day_correction_image_idempotency_hash_check CHECK (
        request_hash ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT day_correction_image_idempotency_response_check CHECK (
        jsonb_typeof(response_json) = 'object'
      )
    );

    CREATE INDEX day_correction_image_jobs_claim_idx
      ON day_correction_image_jobs(available_at, job_id)
      WHERE status IN ('queued', 'retryable', 'claimed');

    CREATE TABLE day_correction_image_request_events (
      request_event_id varchar(80) PRIMARY KEY,
      job_id varchar(80) NOT NULL UNIQUE REFERENCES day_correction_image_jobs(job_id),
      correction_id varchar(80) NOT NULL,
      draft_id varchar(80) NOT NULL,
      fortune_date date NOT NULL,
      image_slot varchar(32) NOT NULL,
      actor_id varchar(80) NOT NULL,
      reason varchar(500) NOT NULL,
      request_id varchar(128) NOT NULL,
      requested_at timestamptz NOT NULL,
      CONSTRAINT day_correction_image_request_events_owner_fk FOREIGN KEY (
        correction_id, draft_id, fortune_date
      ) REFERENCES day_corrections(correction_id, draft_id, fortune_date),
      CONSTRAINT day_correction_image_request_events_slot_check CHECK (
        image_slot IN ('required_primary', 'required_alternative', 'optional')
      ),
      CONSTRAINT day_correction_image_request_events_evidence_check CHECK (
        char_length(actor_id) BETWEEN 1 AND 80
        AND char_length(btrim(reason)) BETWEEN 1 AND 500
        AND char_length(request_id) BETWEEN 8 AND 128
      )
    );
    CREATE TRIGGER day_correction_image_request_events_append_only
      BEFORE UPDATE OR DELETE ON day_correction_image_request_events
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();

    CREATE TABLE day_correction_image_reuse_events (
      reuse_event_id varchar(80) PRIMARY KEY,
      correction_id varchar(80) NOT NULL,
      draft_id varchar(80) NOT NULL REFERENCES content_drafts(draft_id),
      fortune_date date NOT NULL,
      asset_id varchar(80) NOT NULL REFERENCES daily_image_assets(asset_id),
      source_content_version varchar(80) NOT NULL REFERENCES content_versions(content_version),
      image_slot varchar(32) NOT NULL,
      actor_id varchar(80) NOT NULL,
      reason varchar(500) NOT NULL,
      request_id varchar(128) NOT NULL,
      occurred_at timestamptz NOT NULL,
      CONSTRAINT day_correction_image_reuse_slot_check CHECK (
        image_slot IN ('required_primary', 'required_alternative', 'optional')
      ),
      CONSTRAINT day_correction_image_reuse_owner_fk FOREIGN KEY (
        correction_id, draft_id, fortune_date
      ) REFERENCES day_corrections(correction_id, draft_id, fortune_date),
      CONSTRAINT day_correction_image_reuse_actor_check CHECK (
        char_length(actor_id) BETWEEN 1 AND 80
      ),
      CONSTRAINT day_correction_image_reuse_reason_check CHECK (
        char_length(btrim(reason)) BETWEEN 1 AND 500
      ),
      CONSTRAINT day_correction_image_reuse_request_check CHECK (
        char_length(request_id) BETWEEN 8 AND 128
      )
    );
    CREATE TRIGGER day_correction_image_reuse_events_append_only
      BEFORE UPDATE OR DELETE ON day_correction_image_reuse_events
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();

    ALTER TABLE draft_image_slot_selections
      DROP CONSTRAINT draft_image_slot_selections_source_check,
      ADD CONSTRAINT draft_image_slot_selections_source_check CHECK (
        selection_source IN (
          'automatic_generation', 'manual_upload', 'manual_selection',
          'migration_unique', 'correction_library'
        )
        AND (selection_source = 'automatic_generation') = (source_job_id IS NOT NULL)
      );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    UPDATE draft_image_slot_selections
       SET selection_source = 'manual_selection',
           source_job_id = NULL
     WHERE selection_source = 'correction_library';
    ALTER TABLE draft_image_slot_selections
      DROP CONSTRAINT IF EXISTS draft_image_slot_selections_source_check,
      ADD CONSTRAINT draft_image_slot_selections_source_check CHECK (
        selection_source IN (
          'automatic_generation', 'manual_upload', 'manual_selection', 'migration_unique'
        )
        AND (selection_source = 'automatic_generation') = (source_job_id IS NOT NULL)
      );
    DROP TABLE IF EXISTS day_correction_image_reuse_events;
    DROP TABLE IF EXISTS day_correction_image_request_events;
    DROP TABLE IF EXISTS day_correction_image_idempotency;
    DROP TABLE IF EXISTS day_correction_image_slot_currents;
    DROP TABLE IF EXISTS day_correction_image_jobs;
  `);
}
