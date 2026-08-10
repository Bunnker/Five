import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE daily_content_image_jobs
      ADD COLUMN attempt_limit integer NOT NULL DEFAULT 3,
      ADD COLUMN generation_revision integer NOT NULL DEFAULT 1;
    UPDATE daily_content_image_jobs
       SET attempt_limit = greatest(attempts, 3);
    WITH revisions AS (
      SELECT
        job_id,
        row_number() OVER (
          PARTITION BY fortune_date, image_slot
          ORDER BY job_id
        )::integer AS generation_revision
      FROM daily_content_image_jobs
    )
    UPDATE daily_content_image_jobs AS job
       SET generation_revision = revisions.generation_revision
      FROM revisions
     WHERE revisions.job_id = job.job_id;
    ALTER TABLE daily_content_image_jobs
      DROP CONSTRAINT daily_content_image_jobs_fortune_date_image_slot_prompt_ver_key,
      ADD CONSTRAINT daily_content_image_jobs_attempt_limit_check CHECK (
        attempt_limit >= 1 AND attempts <= attempt_limit
      ),
      ADD CONSTRAINT daily_content_image_jobs_generation_revision_check CHECK (
        generation_revision >= 1
      ),
      ADD CONSTRAINT daily_content_image_jobs_generation_unique UNIQUE (
        fortune_date, image_slot, generation_revision
      ),
      ADD CONSTRAINT daily_content_image_jobs_current_identity_unique UNIQUE (
        job_id, fortune_date, image_slot, generation_revision
      );

    CREATE TABLE daily_content_image_slot_currents (
      fortune_date date NOT NULL REFERENCES daily_content_productions(fortune_date),
      image_slot varchar(32) NOT NULL,
      current_job_id varchar(80),
      generation_revision integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (fortune_date, image_slot),
      CONSTRAINT daily_content_image_slot_currents_slot_check CHECK (
        image_slot IN ('required_primary', 'required_alternative', 'optional')
      ),
      CONSTRAINT daily_content_image_slot_currents_revision_check CHECK (
        generation_revision >= 0
        AND (current_job_id IS NULL) = (generation_revision = 0)
      ),
      CONSTRAINT daily_content_image_slot_currents_job_fk FOREIGN KEY (
        current_job_id, fortune_date, image_slot, generation_revision
      ) REFERENCES daily_content_image_jobs(
        job_id, fortune_date, image_slot, generation_revision
      )
    );

    INSERT INTO daily_content_image_slot_currents (
      fortune_date, image_slot, current_job_id, generation_revision, updated_at
    )
    SELECT
      production.fortune_date,
      slot.image_slot,
      unique_job.job_id,
      coalesce(unique_job.generation_revision, 0),
      production.updated_at
    FROM daily_content_productions AS production
    CROSS JOIN (VALUES
      ('required_primary'),
      ('required_alternative'),
      ('optional')
    ) AS slot(image_slot)
    LEFT JOIN LATERAL (
      SELECT min(job.job_id) AS job_id, min(job.generation_revision) AS generation_revision
        FROM daily_content_image_jobs AS job
       WHERE job.fortune_date = production.fortune_date
         AND job.image_slot = slot.image_slot
      HAVING count(*) = 1
    ) AS unique_job ON true;

    CREATE INDEX daily_content_image_slot_currents_job_idx
      ON daily_content_image_slot_currents (current_job_id)
      WHERE current_job_id IS NOT NULL;

    ALTER TABLE content_lifecycle_idempotency
      DROP CONSTRAINT content_lifecycle_idempotency_operation_check;
    ALTER TABLE content_lifecycle_idempotency
      ADD CONSTRAINT content_lifecycle_idempotency_operation_check CHECK (
        operation IN (
          'submit', 'add_master_review_evidence', 'review_decision',
          'image_upload', 'image_review', 'image_withdrawal', 'image_selection',
          'schedule', 'cancel_schedule', 'publish', 'withdraw', 'rollback'
        )
      );

    ALTER TABLE draft_image_candidates
      ADD CONSTRAINT draft_image_candidates_slot_identity_unique UNIQUE (
        draft_id, asset_id, image_slot
      );

    CREATE TABLE draft_image_slot_selections (
      draft_id varchar(80) NOT NULL,
      image_slot varchar(32) NOT NULL,
      asset_id varchar(80) NOT NULL,
      selection_revision bigint NOT NULL,
      selection_source varchar(32) NOT NULL,
      source_job_id varchar(80),
      actor_id varchar(80) NOT NULL,
      reason varchar(500) NOT NULL,
      request_id varchar(128) NOT NULL,
      selected_at timestamptz NOT NULL,
      PRIMARY KEY (draft_id, image_slot),
      CONSTRAINT draft_image_slot_selections_candidate_fk FOREIGN KEY (
        draft_id, asset_id, image_slot
      ) REFERENCES draft_image_candidates(draft_id, asset_id, image_slot),
      CONSTRAINT draft_image_slot_selections_job_fk FOREIGN KEY (source_job_id)
        REFERENCES daily_content_image_jobs(job_id),
      CONSTRAINT draft_image_slot_selections_slot_check CHECK (
        image_slot IN ('required_primary', 'required_alternative', 'optional')
      ),
      CONSTRAINT draft_image_slot_selections_revision_check CHECK (selection_revision >= 1),
      CONSTRAINT draft_image_slot_selections_source_check CHECK (
        selection_source IN (
          'automatic_generation', 'manual_upload', 'manual_selection', 'migration_unique'
        )
        AND (selection_source = 'automatic_generation') = (source_job_id IS NOT NULL)
      ),
      CONSTRAINT draft_image_slot_selections_actor_check CHECK (
        char_length(actor_id) BETWEEN 1 AND 80
      ),
      CONSTRAINT draft_image_slot_selections_reason_check CHECK (
        char_length(reason) BETWEEN 1 AND 500
      ),
      CONSTRAINT draft_image_slot_selections_request_check CHECK (
        char_length(request_id) BETWEEN 8 AND 128
      )
    );

    WITH candidate_counts AS (
      SELECT
        candidate.draft_id,
        candidate.image_slot,
        count(*) AS candidate_count,
        min(candidate.asset_id) AS unique_asset_id
      FROM draft_image_candidates AS candidate
      WHERE candidate.image_slot IS NOT NULL
      GROUP BY candidate.draft_id, candidate.image_slot
    ), current_completed AS (
      SELECT
        production.draft_id,
        current.image_slot,
        job.completed_asset_id AS asset_id,
        job.job_id
      FROM daily_content_image_slot_currents AS current
      JOIN daily_content_image_jobs AS job
        ON job.job_id = current.current_job_id
       AND job.fortune_date = current.fortune_date
       AND job.image_slot = current.image_slot
       AND job.generation_revision = current.generation_revision
       AND job.status = 'completed'
       AND job.completed_asset_id IS NOT NULL
      JOIN daily_content_productions AS production
        ON production.fortune_date = current.fortune_date
      JOIN draft_image_candidates AS candidate
        ON candidate.draft_id = production.draft_id
       AND candidate.asset_id = job.completed_asset_id
       AND candidate.image_slot = current.image_slot
    ), resolved AS (
      SELECT
        counts.draft_id,
        counts.image_slot,
        coalesce(current.asset_id, CASE
          WHEN counts.candidate_count = 1 THEN counts.unique_asset_id
          ELSE NULL
        END) AS asset_id,
        current.job_id
      FROM candidate_counts AS counts
      LEFT JOIN current_completed AS current
        ON current.draft_id = counts.draft_id
       AND current.image_slot = counts.image_slot
    )
    INSERT INTO draft_image_slot_selections (
      draft_id, image_slot, asset_id, selection_revision, selection_source,
      source_job_id, actor_id, reason, request_id, selected_at
    )
    SELECT
      resolved.draft_id,
      resolved.image_slot,
      resolved.asset_id,
      1,
      CASE WHEN resolved.job_id IS NULL THEN 'migration_unique' ELSE 'automatic_generation' END,
      resolved.job_id,
      'system-migration',
      '迁移已有且能够唯一证明的图片槽位选择。',
      'migration-image-selection',
      clock_timestamp()
    FROM resolved
    WHERE resolved.asset_id IS NOT NULL;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $migration$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM daily_content_image_jobs
         GROUP BY fortune_date, image_slot, prompt_version
        HAVING count(*) > 1
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '55000',
          MESSAGE = 'Cannot roll back current image generation while repeated generations exist',
          HINT = 'Archive or remove superseded generation rows before retrying this rollback.';
      END IF;
    END
    $migration$;

    DROP TABLE IF EXISTS draft_image_slot_selections;
    ALTER TABLE draft_image_candidates
      DROP CONSTRAINT IF EXISTS draft_image_candidates_slot_identity_unique;
    DELETE FROM content_lifecycle_idempotency WHERE operation = 'image_selection';
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
    DROP TABLE IF EXISTS daily_content_image_slot_currents;
    ALTER TABLE daily_content_image_jobs
      DROP CONSTRAINT IF EXISTS daily_content_image_jobs_current_identity_unique,
      DROP CONSTRAINT IF EXISTS daily_content_image_jobs_generation_unique,
      DROP CONSTRAINT IF EXISTS daily_content_image_jobs_generation_revision_check,
      DROP CONSTRAINT IF EXISTS daily_content_image_jobs_attempt_limit_check,
      DROP COLUMN IF EXISTS generation_revision,
      DROP COLUMN IF EXISTS attempt_limit;
    ALTER TABLE daily_content_image_jobs
      ADD CONSTRAINT daily_content_image_jobs_fortune_date_image_slot_prompt_ver_key
      UNIQUE (fortune_date, image_slot, prompt_version);
  `);
}
