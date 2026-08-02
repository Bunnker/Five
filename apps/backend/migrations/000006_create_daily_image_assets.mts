import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE content_lifecycle_idempotency
      DROP CONSTRAINT content_lifecycle_idempotency_operation_check;
    ALTER TABLE content_lifecycle_idempotency
      ADD CONSTRAINT content_lifecycle_idempotency_operation_check CHECK (
        operation IN (
          'submit', 'add_master_review_evidence', 'review_decision',
          'image_upload', 'image_review', 'image_withdrawal'
        )
      );

    CREATE TABLE daily_image_assets (
      asset_id varchar(80) PRIMARY KEY,
      storage_key varchar(180) NOT NULL,
      sha256 char(64) NOT NULL,
      asset_json jsonb NOT NULL,
      uploaded_at timestamptz NOT NULL,
      CONSTRAINT daily_image_assets_id_check CHECK (char_length(asset_id) BETWEEN 1 AND 80),
      CONSTRAINT daily_image_assets_storage_key_check CHECK (
        storage_key ~ '^[0-9a-f]{2}/[0-9a-f]{64}\\.(avif|jpg|png|webp)$'
      ),
      CONSTRAINT daily_image_assets_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      CONSTRAINT daily_image_assets_json_check CHECK (
        jsonb_typeof(asset_json) = 'object'
        AND asset_json ->> 'assetId' = asset_id
        AND asset_json ->> 'sha256' = sha256
      )
    );
    CREATE INDEX daily_image_assets_sha_idx ON daily_image_assets (sha256);

    CREATE TABLE draft_image_candidates (
      draft_id varchar(80) NOT NULL REFERENCES content_drafts(draft_id),
      asset_id varchar(80) NOT NULL REFERENCES daily_image_assets(asset_id),
      fortune_date date NOT NULL,
      review_locked boolean NOT NULL DEFAULT false,
      uploaded_at timestamptz NOT NULL,
      PRIMARY KEY (draft_id, asset_id)
    );
    CREATE INDEX draft_image_candidates_draft_uploaded_idx
      ON draft_image_candidates (draft_id, uploaded_at, asset_id);
    CREATE TRIGGER draft_image_candidates_immutable
      BEFORE UPDATE OR DELETE ON draft_image_candidates
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();

    CREATE TABLE daily_image_sets (
      content_version varchar(80) PRIMARY KEY REFERENCES content_versions(content_version),
      fortune_date date NOT NULL,
      lifecycle_revision bigint NOT NULL,
      assets_json jsonb NOT NULL,
      slots_json jsonb NOT NULL,
      created_at timestamptz NOT NULL,
      CONSTRAINT daily_image_sets_revision_check CHECK (lifecycle_revision >= 1),
      CONSTRAINT daily_image_sets_assets_check CHECK (jsonb_typeof(assets_json) = 'array'),
      CONSTRAINT daily_image_sets_slots_check CHECK (jsonb_typeof(slots_json) = 'array')
    );

    CREATE TABLE image_asset_withdrawal_events (
      withdrawal_event_id varchar(80) PRIMARY KEY,
      content_version varchar(80) NOT NULL REFERENCES daily_image_sets(content_version),
      asset_id varchar(80) NOT NULL REFERENCES daily_image_assets(asset_id),
      reason varchar(2000) NOT NULL,
      withdrawn_at timestamptz NOT NULL,
      audit_event_id varchar(80) NOT NULL UNIQUE REFERENCES content_lifecycle_audit_events(audit_event_id),
      UNIQUE (asset_id),
      CONSTRAINT image_asset_withdrawal_reason_check CHECK (
        char_length(btrim(reason)) BETWEEN 1 AND 2000
      )
    );
    CREATE INDEX image_asset_withdrawal_version_idx
      ON image_asset_withdrawal_events (content_version, withdrawn_at, withdrawal_event_id);
    CREATE INDEX image_asset_withdrawal_asset_idx
      ON image_asset_withdrawal_events (asset_id, withdrawn_at DESC);

    CREATE FUNCTION validate_image_asset_withdrawal_membership() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM daily_image_sets AS image_set
         WHERE image_set.content_version = NEW.content_version
           AND EXISTS (
             SELECT 1
               FROM jsonb_array_elements(image_set.assets_json) AS asset
              WHERE asset ->> 'assetId' = NEW.asset_id
           )
      ) THEN
        RAISE EXCEPTION 'withdrawal asset does not belong to daily image set';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER image_asset_withdrawal_membership
      BEFORE INSERT ON image_asset_withdrawal_events
      FOR EACH ROW EXECUTE FUNCTION validate_image_asset_withdrawal_membership();

    CREATE TABLE image_cache_purge_intents (
      purge_intent_id varchar(80) PRIMARY KEY,
      content_version varchar(80) NOT NULL REFERENCES daily_image_sets(content_version),
      fortune_date date NOT NULL,
      asset_id varchar(80) NOT NULL REFERENCES daily_image_assets(asset_id),
      request_id varchar(128) NOT NULL,
      created_at timestamptz NOT NULL,
      processed_at timestamptz,
      CONSTRAINT image_cache_purge_request_check CHECK (char_length(request_id) BETWEEN 8 AND 128)
    );
    CREATE INDEX image_cache_purge_pending_idx
      ON image_cache_purge_intents (created_at, purge_intent_id)
      WHERE processed_at IS NULL;

    CREATE FUNCTION protect_daily_image_asset_server_fields() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.asset_id IS DISTINCT FROM NEW.asset_id
        OR OLD.storage_key IS DISTINCT FROM NEW.storage_key
        OR OLD.sha256 IS DISTINCT FROM NEW.sha256
        OR OLD.uploaded_at IS DISTINCT FROM NEW.uploaded_at
        OR OLD.asset_json - ARRAY[
          'fileUrl', 'manualReview', 'reviewStatus', 'rightsStatus', 'aiLabelStatus'
        ] IS DISTINCT FROM NEW.asset_json - ARRAY[
          'fileUrl', 'manualReview', 'reviewStatus', 'rightsStatus', 'aiLabelStatus'
        ] THEN
        RAISE EXCEPTION 'daily image asset server fields are immutable';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER daily_image_assets_server_fields_immutable
      BEFORE UPDATE ON daily_image_assets
      FOR EACH ROW EXECUTE FUNCTION protect_daily_image_asset_server_fields();

    CREATE FUNCTION protect_daily_image_set_snapshot() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      old_slots_snapshot jsonb;
      new_slots_snapshot jsonb;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'daily image sets cannot be deleted';
      END IF;
      SELECT COALESCE(jsonb_agg(
        slot - ARRAY['deliveryStatus', 'servedCoverAssetId', 'servedDetailAssetIds']
        ORDER BY ordinal
      ), '[]'::jsonb)
        INTO old_slots_snapshot
        FROM jsonb_array_elements(OLD.slots_json) WITH ORDINALITY AS entry(slot, ordinal);
      SELECT COALESCE(jsonb_agg(
        slot - ARRAY['deliveryStatus', 'servedCoverAssetId', 'servedDetailAssetIds']
        ORDER BY ordinal
      ), '[]'::jsonb)
        INTO new_slots_snapshot
        FROM jsonb_array_elements(NEW.slots_json) WITH ORDINALITY AS entry(slot, ordinal);
      IF OLD.content_version IS DISTINCT FROM NEW.content_version
        OR OLD.fortune_date IS DISTINCT FROM NEW.fortune_date
        OR OLD.assets_json IS DISTINCT FROM NEW.assets_json
        OR old_slots_snapshot IS DISTINCT FROM new_slots_snapshot
        OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'daily image set snapshot is immutable';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER daily_image_sets_snapshot_immutable
      BEFORE UPDATE OR DELETE ON daily_image_sets
      FOR EACH ROW EXECUTE FUNCTION protect_daily_image_set_snapshot();

    CREATE TRIGGER image_asset_withdrawal_events_append_only
      BEFORE UPDATE OR DELETE ON image_asset_withdrawal_events
      FOR EACH ROW EXECUTE FUNCTION reject_content_lifecycle_append_mutation();
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TRIGGER IF EXISTS image_asset_withdrawal_events_append_only
      ON image_asset_withdrawal_events;
    DROP TRIGGER IF EXISTS image_asset_withdrawal_membership
      ON image_asset_withdrawal_events;
    DROP FUNCTION IF EXISTS validate_image_asset_withdrawal_membership();
    DROP TRIGGER IF EXISTS daily_image_sets_snapshot_immutable ON daily_image_sets;
    DROP FUNCTION IF EXISTS protect_daily_image_set_snapshot();
    DROP TRIGGER IF EXISTS daily_image_assets_server_fields_immutable ON daily_image_assets;
    DROP FUNCTION IF EXISTS protect_daily_image_asset_server_fields();
    DROP TABLE IF EXISTS image_cache_purge_intents;
    DROP TABLE IF EXISTS image_asset_withdrawal_events;
    DROP TABLE IF EXISTS daily_image_sets;
    DROP TRIGGER IF EXISTS draft_image_candidates_immutable ON draft_image_candidates;
    DROP TABLE IF EXISTS draft_image_candidates;
    DROP TABLE IF EXISTS daily_image_assets;
    DELETE FROM content_lifecycle_idempotency
      WHERE operation IN ('image_upload', 'image_review', 'image_withdrawal');
    ALTER TABLE content_lifecycle_idempotency
      DROP CONSTRAINT content_lifecycle_idempotency_operation_check;
    ALTER TABLE content_lifecycle_idempotency
      ADD CONSTRAINT content_lifecycle_idempotency_operation_check CHECK (
        operation IN ('submit', 'add_master_review_evidence', 'review_decision')
      );
  `);
}
