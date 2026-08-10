import type { MigrationBuilder } from "node-pg-migrate";

/**
 * Keeps correction working-copy provenance explicit and makes image selection
 * cloning truthful. Neither source is a manual operator selection.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE day_corrections
      ADD COLUMN source_draft_id varchar(80) REFERENCES content_drafts(draft_id);
    ALTER TABLE day_correction_open_intents
      ADD COLUMN source_draft_id varchar(80) REFERENCES content_drafts(draft_id),
      ADD COLUMN expires_at timestamptz;

    -- Future-day corrections created before this provenance column existed were cloned from
    -- the one automatic production draft for the same fortuneDate. Recover that exact source
    -- instead of guessing from visual=null or labeling the copy as a manual selection.
    UPDATE day_corrections AS correction
       SET source_draft_id = production.draft_id
      FROM daily_content_productions AS production
     WHERE correction.fortune_date = production.fortune_date
       AND correction.source_content_version IS NULL
       AND correction.source_draft_id IS NULL;
    UPDATE day_correction_open_intents AS intent
       SET source_draft_id = production.draft_id
      FROM daily_content_productions AS production
     WHERE intent.fortune_date = production.fortune_date
       AND intent.source_content_version IS NULL
       AND intent.source_draft_id IS NULL;
    UPDATE day_correction_open_intents
       SET expires_at = created_at + interval '15 minutes'
     WHERE expires_at IS NULL;

    ALTER TABLE day_corrections
      ADD CONSTRAINT day_corrections_source_xor_check CHECK (
        (source_content_version IS NULL) <> (source_draft_id IS NULL)
      );
    ALTER TABLE day_correction_open_intents
      ALTER COLUMN expires_at SET NOT NULL,
      ADD CONSTRAINT day_correction_open_intents_source_xor_check CHECK (
        (source_content_version IS NULL) <> (source_draft_id IS NULL)
      ),
      ADD CONSTRAINT day_correction_open_intents_expiry_check CHECK (expires_at > created_at);

    ALTER TABLE draft_image_slot_selections
      DROP CONSTRAINT draft_image_slot_selections_source_check,
      ADD CONSTRAINT draft_image_slot_selections_source_check CHECK (
        selection_source IN (
          'automatic_generation', 'manual_upload', 'manual_selection',
          'migration_unique', 'correction_library', 'version_copy',
          'correction_draft_copy'
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
     WHERE selection_source IN ('version_copy', 'correction_draft_copy');

    ALTER TABLE draft_image_slot_selections
      DROP CONSTRAINT IF EXISTS draft_image_slot_selections_source_check,
      ADD CONSTRAINT draft_image_slot_selections_source_check CHECK (
        selection_source IN (
          'automatic_generation', 'manual_upload', 'manual_selection',
          'migration_unique', 'correction_library'
        )
        AND (selection_source = 'automatic_generation') = (source_job_id IS NOT NULL)
      );

    ALTER TABLE day_correction_open_intents
      DROP CONSTRAINT day_correction_open_intents_expiry_check,
      DROP CONSTRAINT day_correction_open_intents_source_xor_check,
      DROP COLUMN expires_at,
      DROP COLUMN source_draft_id;
    ALTER TABLE day_corrections
      DROP CONSTRAINT day_corrections_source_xor_check,
      DROP COLUMN source_draft_id;
  `);
}
