import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE draft_image_candidates
      ADD COLUMN image_slot varchar(32),
      ADD CONSTRAINT draft_image_candidates_image_slot_check CHECK (
        image_slot IS NULL
        OR image_slot IN ('required_primary', 'required_alternative', 'optional')
      );

    DROP TRIGGER draft_image_candidates_immutable ON draft_image_candidates;
    WITH slot_evidence AS (
      SELECT
        candidate.draft_id,
        candidate.asset_id,
        job.image_slot
      FROM draft_image_candidates AS candidate
      JOIN daily_image_assets AS asset
        ON asset.asset_id = candidate.asset_id
      JOIN daily_content_productions AS production
        ON production.draft_id = candidate.draft_id
       AND production.fortune_date = candidate.fortune_date
      JOIN daily_content_image_jobs AS job
        ON job.fortune_date = production.fortune_date
       AND (
         (job.completed_asset_id = candidate.asset_id AND job.status = 'completed')
         OR asset.asset_json @> jsonb_build_object(
           'sourceMaterialReferences',
           jsonb_build_array('production-job-' || job.job_id)
         )
       )
    ), uniquely_proven_slots AS (
      SELECT
        draft_id,
        asset_id,
        min(image_slot) AS image_slot
      FROM slot_evidence
      GROUP BY draft_id, asset_id
      HAVING count(DISTINCT image_slot) = 1
    )
    UPDATE draft_image_candidates AS candidate
       SET image_slot = proven.image_slot
      FROM uniquely_proven_slots AS proven
     WHERE candidate.draft_id = proven.draft_id
       AND candidate.asset_id = proven.asset_id;
    CREATE TRIGGER draft_image_candidates_immutable
      BEFORE UPDATE OR DELETE ON draft_image_candidates
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();

    CREATE INDEX draft_image_candidates_draft_slot_uploaded_idx
      ON draft_image_candidates (draft_id, image_slot, uploaded_at, asset_id);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX IF EXISTS draft_image_candidates_draft_slot_uploaded_idx;
    ALTER TABLE draft_image_candidates
      DROP CONSTRAINT IF EXISTS draft_image_candidates_image_slot_check,
      DROP COLUMN IF EXISTS image_slot;
  `);
}
