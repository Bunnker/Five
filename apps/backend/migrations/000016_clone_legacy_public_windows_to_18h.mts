import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Converts release-owned legacy 23:00 snapshots without mutating immutable
 * versions. Every migrated version gets a new draft/version identity, while
 * active and scheduled pointers move atomically and the original audit trail
 * remains intact.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    -- Correction workflows already serialize each fortune date with this advisory
    -- key before they read a baseline. Take those same locks first, in date order,
    -- so an old workflow finishes before the migration snapshots it and a new one
    -- waits until the cloned pointer commits. Advisory-before-lifecycle matches the
    -- application lock order and avoids a migration/apply deadlock.
    CREATE TEMP TABLE public_content_18h_candidate_dates (
      fortune_date date PRIMARY KEY
    ) ON COMMIT DROP;

    INSERT INTO public_content_18h_candidate_dates (fortune_date)
    SELECT DISTINCT version.fortune_date
      FROM content_versions AS version
      JOIN content_lifecycle_days AS day
        ON day.fortune_date = version.fortune_date
      LEFT JOIN daily_content_productions AS production
        ON production.draft_id = version.draft_id
     WHERE (
       day.active_content_version = version.content_version
       OR day.scheduled_content_version = version.content_version
       OR production.draft_id IS NOT NULL
     )
       AND (
         version.effective_from IS DISTINCT FROM
           ((version.fortune_date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai'
         OR version.effective_to IS DISTINCT FROM
           (version.fortune_date + time '18:00') AT TIME ZONE 'Asia/Shanghai'
       );

    DO $migration$
    DECLARE
      candidate_date date;
    BEGIN
      FOR candidate_date IN
        SELECT fortune_date
          FROM public_content_18h_candidate_dates
         ORDER BY fortune_date
      LOOP
        PERFORM pg_advisory_xact_lock(
          hashtextextended('five:day-correction:open:' || candidate_date::text, 0)
        );
      END LOOP;
    END
    $migration$;

    -- Lifecycle mutations take a day row FOR UPDATE before changing versions.
    -- Once correction baselines are fenced, this table lock makes the ownership
    -- snapshot atomic with every release pointer mutation.
    LOCK TABLE content_lifecycle_days IN EXCLUSIVE MODE;

    CREATE TABLE public_content_18h_version_migrations (
      old_content_version varchar(80) PRIMARY KEY
        REFERENCES content_versions(content_version) ON DELETE CASCADE,
      new_content_version varchar(80) NOT NULL UNIQUE,
      old_draft_id varchar(80) NOT NULL
        REFERENCES content_drafts(draft_id) ON DELETE CASCADE,
      new_draft_id varchar(80) NOT NULL UNIQUE,
      fortune_date date NOT NULL,
      original_state varchar(24) NOT NULL,
      was_active boolean NOT NULL,
      was_scheduled boolean NOT NULL,
      previous_active_content_version varchar(80)
        REFERENCES content_versions(content_version),
      previous_schedule_slot_revision bigint NOT NULL,
      becomes_active boolean NOT NULL DEFAULT false,
      remains_scheduled boolean NOT NULL DEFAULT false,
      moved_production boolean NOT NULL,
      migrated_at timestamptz NOT NULL,
      CONSTRAINT public_content_18h_version_migrations_owned_check CHECK (
        was_active OR was_scheduled OR moved_production
      )
    );

    INSERT INTO public_content_18h_version_migrations (
      old_content_version, new_content_version, old_draft_id, new_draft_id,
      fortune_date, original_state, was_active, was_scheduled,
      previous_active_content_version, previous_schedule_slot_revision,
      moved_production, migrated_at
    )
    SELECT
      version.content_version,
      'm18-v-' || md5(version.content_version),
      version.draft_id,
      'm18-d-' || md5(version.content_version),
      version.fortune_date,
      version.state,
      COALESCE(day.active_content_version = version.content_version, false),
      COALESCE(day.scheduled_content_version = version.content_version, false),
      day.active_content_version,
      day.schedule_slot_revision,
      production.draft_id IS NOT NULL,
      transaction_timestamp()
      FROM content_versions AS version
      JOIN content_lifecycle_days AS day
        ON day.fortune_date = version.fortune_date
      LEFT JOIN daily_content_productions AS production
        ON production.draft_id = version.draft_id
     WHERE (
       day.active_content_version = version.content_version
       OR day.scheduled_content_version = version.content_version
       OR production.draft_id IS NOT NULL
     )
       AND (
         version.effective_from IS DISTINCT FROM
           ((version.fortune_date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai'
         OR version.effective_to IS DISTINCT FROM
           (version.fortune_date + time '18:00') AT TIME ZONE 'Asia/Shanghai'
       );

    -- A lifecycle day may be created between the candidate scan and the table
    -- lock. Fail closed instead of migrating a date whose correction lock was not
    -- acquired; rerunning the rolled-back migration will include that date.
    DO $migration$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM public_content_18h_version_migrations AS migration
          LEFT JOIN public_content_18h_candidate_dates AS candidate
            ON candidate.fortune_date = migration.fortune_date
         WHERE candidate.fortune_date IS NULL
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '40001',
          MESSAGE = 'legacy public-window candidate date changed while migration locks were acquired';
      END IF;
    END
    $migration$;

    UPDATE public_content_18h_version_migrations AS candidate
       SET becomes_active = (
             candidate.was_scheduled
             AND candidate.migrated_at >=
               ((candidate.fortune_date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai'
             AND candidate.migrated_at <
               (candidate.fortune_date + time '18:00') AT TIME ZONE 'Asia/Shanghai'
           ) OR (
             candidate.was_active
             AND NOT EXISTS (
               SELECT 1
                 FROM public_content_18h_version_migrations AS due_schedule
                WHERE due_schedule.fortune_date = candidate.fortune_date
                  AND due_schedule.was_scheduled
                  AND due_schedule.migrated_at >=
                    ((due_schedule.fortune_date - 1) + time '18:00')
                      AT TIME ZONE 'Asia/Shanghai'
                  AND due_schedule.migrated_at <
                    (due_schedule.fortune_date + time '18:00') AT TIME ZONE 'Asia/Shanghai'
             )
           ),
           remains_scheduled = candidate.was_scheduled
             AND candidate.migrated_at <
               ((candidate.fortune_date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai';

    INSERT INTO content_drafts (
      draft_id, fortune_date, draft_revision, modules,
      submitted_content_version, created_at, updated_at, submitted_at
    )
    SELECT
      migration.new_draft_id,
      draft.fortune_date,
      draft.draft_revision,
      draft.modules,
      NULL,
      migration.migrated_at,
      migration.migrated_at,
      NULL
      FROM public_content_18h_version_migrations AS migration
      JOIN content_drafts AS draft ON draft.draft_id = migration.old_draft_id;

    INSERT INTO content_versions (
      content_version, draft_id, fortune_date, state, snapshot,
      preflight_checks, created_at, effective_from, effective_to
    )
    SELECT
      migration.new_content_version,
      migration.new_draft_id,
      version.fortune_date,
      CASE
        WHEN migration.becomes_active THEN 'published'
        WHEN migration.remains_scheduled THEN 'scheduled'
        WHEN migration.was_active THEN 'superseded'
        WHEN migration.was_scheduled THEN 'approved'
        ELSE version.state
      END,
      version.snapshot,
      version.preflight_checks,
      migration.migrated_at,
      ((version.fortune_date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai',
      (version.fortune_date + time '18:00') AT TIME ZONE 'Asia/Shanghai'
      FROM public_content_18h_version_migrations AS migration
      JOIN content_versions AS version
        ON version.content_version = migration.old_content_version;

    INSERT INTO draft_image_candidates (
      draft_id, asset_id, fortune_date, review_locked, uploaded_at, image_slot
    )
    SELECT
      migration.new_draft_id,
      candidate.asset_id,
      candidate.fortune_date,
      candidate.review_locked,
      candidate.uploaded_at,
      candidate.image_slot
      FROM public_content_18h_version_migrations AS migration
      JOIN draft_image_candidates AS candidate
        ON candidate.draft_id = migration.old_draft_id;

    INSERT INTO draft_image_slot_selections (
      draft_id, image_slot, asset_id, selection_revision, selection_source,
      source_job_id, actor_id, reason, request_id, selected_at
    )
    SELECT
      migration.new_draft_id,
      selection.image_slot,
      selection.asset_id,
      selection.selection_revision,
      selection.selection_source,
      selection.source_job_id,
      selection.actor_id,
      selection.reason,
      selection.request_id,
      selection.selected_at
      FROM public_content_18h_version_migrations AS migration
      JOIN draft_image_slot_selections AS selection
        ON selection.draft_id = migration.old_draft_id;

    UPDATE content_drafts AS draft
       SET submitted_content_version = migration.new_content_version,
           submitted_at = migration.migrated_at
      FROM public_content_18h_version_migrations AS migration
     WHERE draft.draft_id = migration.new_draft_id;

    INSERT INTO daily_image_sets (
      content_version, fortune_date, lifecycle_revision,
      assets_json, slots_json, created_at
    )
    SELECT
      migration.new_content_version,
      image_set.fortune_date,
      image_set.lifecycle_revision,
      image_set.assets_json,
      image_set.slots_json,
      migration.migrated_at
      FROM public_content_18h_version_migrations AS migration
      JOIN daily_image_sets AS image_set
        ON image_set.content_version = migration.old_content_version;

    INSERT INTO master_review_evidence (
      evidence_id, content_version, reviewer_display_name, reviewed_at,
      conclusion, notes, references_json, recorded_at, recorded_revision
    )
    SELECT
      'm18-e-' || md5(evidence.evidence_id || ':' || migration.new_content_version),
      migration.new_content_version,
      evidence.reviewer_display_name,
      evidence.reviewed_at,
      evidence.conclusion,
      evidence.notes,
      evidence.references_json,
      migration.migrated_at,
      evidence.recorded_revision
      FROM public_content_18h_version_migrations AS migration
      JOIN master_review_evidence AS evidence
        ON evidence.content_version = migration.old_content_version;

    UPDATE daily_content_productions AS production
       SET draft_id = migration.new_draft_id,
           updated_at = migration.migrated_at
      FROM public_content_18h_version_migrations AS migration
     WHERE migration.moved_production
       AND production.draft_id = migration.old_draft_id;

    UPDATE content_schedule_tasks AS task
       SET status = 'terminated',
           claimed_at = NULL,
           lease_expires_at = NULL,
           worker_id = NULL,
           attempt_token = NULL,
           updated_at = migration.migrated_at,
           terminated_at = migration.migrated_at,
           termination_reason = '18:00 公开切换迁移已替换原 23:00 排期任务。'
      FROM public_content_18h_version_migrations AS migration
     WHERE migration.was_scheduled
       AND task.content_version = migration.old_content_version
       AND task.status IN ('pending', 'processing', 'retrying');

    INSERT INTO content_schedule_task_events (
      event_id, task_id, action, status, occurred_at, reason
    )
    SELECT
      'm18-te-' || md5(task.task_id),
      task.task_id,
      'terminated',
      'terminated',
      migration.migrated_at,
      '18:00 公开切换迁移已替换原 23:00 排期任务。'
      FROM public_content_18h_version_migrations AS migration
      JOIN content_schedule_tasks AS task
        ON task.content_version = migration.old_content_version
     WHERE migration.was_scheduled
       AND task.status = 'terminated'
       AND task.termination_reason = '18:00 公开切换迁移已替换原 23:00 排期任务。'
    ON CONFLICT (event_id) DO NOTHING;

    UPDATE content_versions AS version
       SET state = CASE
         WHEN migration.was_active THEN 'superseded'
         WHEN migration.was_scheduled THEN 'approved'
         ELSE version.state
       END
      FROM public_content_18h_version_migrations AS migration
     WHERE version.content_version = migration.old_content_version
       AND (migration.was_active OR migration.was_scheduled);

    UPDATE content_versions AS previous_active
       SET state = 'superseded'
      FROM public_content_18h_version_migrations AS due_schedule
     WHERE due_schedule.was_scheduled
       AND due_schedule.becomes_active
       AND due_schedule.previous_active_content_version IS NOT NULL
       AND due_schedule.previous_active_content_version <> due_schedule.old_content_version
       AND previous_active.content_version = due_schedule.previous_active_content_version
       AND previous_active.state = 'published';

    WITH day_changes AS (
      SELECT
        migration.fortune_date,
        bool_or(migration.becomes_active) AS has_active,
        bool_or(migration.was_scheduled) AS has_scheduled,
        bool_or(migration.was_scheduled AND migration.becomes_active)
          AS active_from_schedule,
        max(migration.new_content_version) FILTER (WHERE migration.becomes_active) AS new_active,
        max(migration.new_content_version) FILTER (WHERE migration.remains_scheduled)
          AS new_scheduled,
        max(migration.migrated_at) AS migrated_at
        FROM public_content_18h_version_migrations AS migration
       GROUP BY migration.fortune_date
    )
    UPDATE content_lifecycle_days AS day
       SET active_content_version = CASE
             WHEN change.has_active THEN change.new_active
             ELSE day.active_content_version
           END,
           scheduled_content_version = CASE
             WHEN change.has_scheduled THEN change.new_scheduled
             ELSE day.scheduled_content_version
           END,
           scheduled_effective_from = CASE
             WHEN change.has_scheduled AND change.new_scheduled IS NOT NULL
               THEN ((day.fortune_date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai'
             WHEN change.has_scheduled THEN NULL
             ELSE day.scheduled_effective_from
           END,
           lifecycle_revision = day.lifecycle_revision
             + change.has_scheduled::integer
             + (change.has_active AND NOT change.active_from_schedule)::integer,
           schedule_slot_revision = day.schedule_slot_revision
             + change.has_scheduled::integer
      FROM day_changes AS change
     WHERE day.fortune_date = change.fortune_date;

    -- An open correction is still a mutable working copy. Repoint its source
    -- to the byte-equivalent cloned version and advance the optimistic baseline
    -- only when that same logical source remains the active/scheduled owner.
    -- Applying/submitted corrections retain their original fence and will fail
    -- closed instead of silently overwriting a different owner.
    UPDATE day_corrections AS correction
       SET source_content_version = migration.new_content_version,
           baseline_active_content_version = CASE
             WHEN migration.becomes_active OR migration.remains_scheduled
               THEN day.active_content_version
             ELSE correction.baseline_active_content_version
           END,
           baseline_lifecycle_revision = CASE
             WHEN migration.becomes_active OR migration.remains_scheduled
               THEN day.lifecycle_revision
             ELSE correction.baseline_lifecycle_revision
           END,
           updated_at = migration.migrated_at
      FROM public_content_18h_version_migrations AS migration
      JOIN content_lifecycle_days AS day
        ON day.fortune_date = migration.fortune_date
     WHERE correction.status = 'open'
       AND correction.source_content_version = migration.old_content_version;

    UPDATE day_corrections AS correction
       SET source_draft_id = migration.new_draft_id,
           updated_at = migration.migrated_at
      FROM public_content_18h_version_migrations AS migration
     WHERE correction.status = 'open'
       AND correction.source_draft_id = migration.old_draft_id;

    UPDATE day_correction_open_intents AS intent
       SET source_content_version = migration.new_content_version,
           baseline_active_content_version = CASE
             WHEN migration.becomes_active OR migration.remains_scheduled
               THEN day.active_content_version
             ELSE intent.baseline_active_content_version
           END,
           baseline_lifecycle_revision = CASE
             WHEN migration.becomes_active OR migration.remains_scheduled
               THEN day.lifecycle_revision
             ELSE intent.baseline_lifecycle_revision
           END
      FROM public_content_18h_version_migrations AS migration
      JOIN content_lifecycle_days AS day
        ON day.fortune_date = migration.fortune_date
     WHERE intent.source_content_version = migration.old_content_version;

    UPDATE day_correction_open_intents AS intent
       SET source_draft_id = migration.new_draft_id
      FROM public_content_18h_version_migrations AS migration
     WHERE intent.source_draft_id = migration.old_draft_id;

    INSERT INTO content_schedule_tasks (
      task_id, fortune_date, content_version, schedule_slot_revision,
      effective_from, status, attempts, available_at,
      claimed_at, lease_expires_at, worker_id, attempt_token, last_error,
      created_at, updated_at, completed_at, terminated_at, termination_reason
    )
    SELECT
      'm18-t-' || md5(migration.old_content_version),
      migration.fortune_date,
      migration.new_content_version,
      day.schedule_slot_revision,
      ((migration.fortune_date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai',
      'pending',
      0,
      ((migration.fortune_date - 1) + time '18:00') AT TIME ZONE 'Asia/Shanghai',
      NULL, NULL, NULL, NULL, NULL,
      migration.migrated_at,
      migration.migrated_at,
      NULL, NULL, NULL
      FROM public_content_18h_version_migrations AS migration
      JOIN content_lifecycle_days AS day
        ON day.fortune_date = migration.fortune_date
     WHERE migration.remains_scheduled;

    INSERT INTO content_schedule_task_events (
      event_id, task_id, action, status, occurred_at, reason
    )
    SELECT
      'm18-create-' || md5(task.task_id),
      task.task_id,
      'created',
      'pending',
      migration.migrated_at,
      '由 23:00 旧排期安全克隆为 18:00 公开排期。'
      FROM public_content_18h_version_migrations AS migration
      JOIN content_schedule_tasks AS task
        ON task.content_version = migration.new_content_version
     WHERE migration.remains_scheduled;

    INSERT INTO content_release_events (
      release_event_id, action, occurred_at, request_id, fortune_date,
      content_version, actor_id, reason, idempotency_key,
      before_active_content_version, after_active_content_version,
      before_schedule_slot_revision, after_schedule_slot_revision,
      transitions_json, schedule_task_id
    )
    SELECT
      'm18-re-a-' || md5(migration.old_content_version),
      CASE WHEN migration.was_scheduled THEN 'scheduled_publish' ELSE 'publish' END,
      migration.migrated_at,
      'migration-000016-public-18h',
      migration.fortune_date,
      migration.new_content_version,
      'system:migration-000016',
      CASE
        WHEN migration.was_scheduled
          THEN '18:00 公开窗口已开始，迁移事务内立即发布旧排期的克隆版本。'
        ELSE '保留旧快照并将 18:00 克隆版本设为当前 ActiveVersion。'
      END,
      NULL,
      migration.previous_active_content_version,
      migration.new_content_version,
      migration.previous_schedule_slot_revision,
      CASE
        WHEN migration.was_scheduled THEN day.schedule_slot_revision
        ELSE migration.previous_schedule_slot_revision
      END,
      CASE
        WHEN migration.previous_active_content_version IS NOT NULL
          AND migration.previous_active_content_version <> migration.old_content_version
          THEN jsonb_build_array(jsonb_build_object(
            'contentVersion', migration.previous_active_content_version,
            'fromState', 'published',
            'toState', 'superseded'
          ))
        ELSE '[]'::jsonb
      END || jsonb_build_array(jsonb_build_object(
        'contentVersion', migration.old_content_version,
        'fromState', migration.original_state,
        'toState', CASE
          WHEN migration.was_scheduled THEN 'approved'
          ELSE 'superseded'
        END
      )) || jsonb_build_array(jsonb_build_object(
        'contentVersion', migration.new_content_version,
        'fromState', 'approved',
        'toState', 'published'
      )),
      NULL
      FROM public_content_18h_version_migrations AS migration
      JOIN content_lifecycle_days AS day
        ON day.fortune_date = migration.fortune_date
     WHERE migration.becomes_active;

    INSERT INTO content_release_events (
      release_event_id, action, occurred_at, request_id, fortune_date,
      content_version, actor_id, reason, idempotency_key,
      before_active_content_version, after_active_content_version,
      before_schedule_slot_revision, after_schedule_slot_revision,
      transitions_json, schedule_task_id
    )
    SELECT
      'm18-re-s-' || md5(migration.old_content_version),
      CASE WHEN migration.remains_scheduled THEN 'schedule' ELSE 'cancel_schedule' END,
      migration.migrated_at,
      'migration-000016-public-18h',
      migration.fortune_date,
      migration.new_content_version,
      'system:migration-000016',
      CASE
        WHEN migration.remains_scheduled
          THEN '将旧 23:00 排期安全克隆为 18:00 公开排期。'
        ELSE '18:00 公开窗口已过期，迁移已安全取消旧排期。'
      END,
      NULL,
      day.active_content_version,
      day.active_content_version,
      migration.previous_schedule_slot_revision,
      day.schedule_slot_revision,
      jsonb_build_array(jsonb_build_object(
        'contentVersion', migration.old_content_version,
        'fromState', migration.original_state,
        'toState', 'approved'
      )) || CASE
        WHEN migration.remains_scheduled THEN jsonb_build_array(jsonb_build_object(
          'contentVersion', migration.new_content_version,
          'fromState', 'approved',
          'toState', 'scheduled'
        ))
        ELSE '[]'::jsonb
      END,
      task.task_id
      FROM public_content_18h_version_migrations AS migration
      JOIN content_lifecycle_days AS day
        ON day.fortune_date = migration.fortune_date
      LEFT JOIN content_schedule_tasks AS task
        ON task.content_version = migration.new_content_version
     WHERE migration.was_scheduled
       AND NOT migration.becomes_active;

    INSERT INTO content_lifecycle_audit_events (
      audit_event_id, action, occurred_at, request_id, fortune_date,
      content_version, actor_id, reason, from_state, to_state,
      idempotency_key, retain_until
    )
    SELECT
      'm18-a-' || md5(migration.old_content_version),
      'public_window_cloned_to_18h',
      migration.migrated_at,
      'migration-000016-public-18h',
      migration.fortune_date,
      migration.new_content_version,
      'system:migration-000016',
      '保留原不可变版本，克隆为北京时间 18:00 公开窗口。',
      migration.original_state,
      version.state,
      'migration-000016:' || md5(migration.old_content_version),
      migration.migrated_at + interval '400 days'
      FROM public_content_18h_version_migrations AS migration
      JOIN content_versions AS version
        ON version.content_version = migration.new_content_version;

    WITH final_active AS (
      SELECT
        migration.fortune_date,
        max(migration.previous_active_content_version) FILTER (WHERE migration.becomes_active)
          AS before_active_content_version,
        max(migration.new_content_version) FILTER (WHERE migration.becomes_active)
          AS after_active_content_version,
        max(migration.migrated_at) AS migrated_at
        FROM public_content_18h_version_migrations AS migration
       GROUP BY migration.fortune_date
      HAVING bool_or(migration.becomes_active)
    )
    INSERT INTO public_cache_purge_intents (
      purge_intent_id, action, fortune_date,
      before_active_content_version, after_active_content_version,
      request_id, created_at, status, attempts, available_at,
      claimed_at, lease_expires_at, worker_id, attempt_token,
      last_error, processed_at
    )
    SELECT
      'm18-p-' || md5(active.fortune_date::text || ':' || active.after_active_content_version),
      'publish',
      active.fortune_date,
      active.before_active_content_version,
      active.after_active_content_version,
      'migration-000016-public-18h',
      active.migrated_at,
      'pending',
      0,
      active.migrated_at,
      NULL, NULL, NULL, NULL, NULL, NULL
      FROM final_active AS active;

    WITH final_active AS (
      SELECT
        migration.fortune_date,
        max(migration.new_content_version) FILTER (WHERE migration.becomes_active)
          AS after_active_content_version,
        max(migration.migrated_at) AS migrated_at
        FROM public_content_18h_version_migrations AS migration
       GROUP BY migration.fortune_date
      HAVING bool_or(migration.becomes_active)
    )
    UPDATE poster_jobs AS job
       SET status = 'version_changed',
           current_active_content_version = active.after_active_content_version,
           locked_at = NULL,
           locked_by = NULL,
           attempt_token = NULL,
           updated_at = active.migrated_at
      FROM final_active AS active
     WHERE job.fortune_date = active.fortune_date
       AND job.status = 'processing';

    ALTER TABLE public_content_18h_version_migrations
      ADD CONSTRAINT public_content_18h_version_migrations_new_version_fkey
      FOREIGN KEY (new_content_version) REFERENCES content_versions(content_version)
        ON DELETE CASCADE,
      ADD CONSTRAINT public_content_18h_version_migrations_new_draft_fkey
      FOREIGN KEY (new_draft_id) REFERENCES content_drafts(draft_id)
        ON DELETE CASCADE;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM public_content_18h_version_migrations)
         OR EXISTS (
           SELECT 1 FROM content_lifecycle_audit_events
            WHERE action = 'public_window_cloned_to_18h'
         )
         OR EXISTS (
           SELECT 1 FROM content_versions
            WHERE content_version LIKE 'm18-v-%'
         ) THEN
        RAISE EXCEPTION
          'Cannot roll back the 18:00 public-window migration after immutable versions were cloned';
      END IF;
    END;
    $$;
    DROP TABLE public_content_18h_version_migrations;
  `);
}
