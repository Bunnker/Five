import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX IF EXISTS image_cache_purge_pending_idx;

    ALTER TABLE image_cache_purge_intents
      ADD COLUMN status varchar(24),
      ADD COLUMN attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN available_at timestamptz,
      ADD COLUMN claimed_at timestamptz,
      ADD COLUMN lease_expires_at timestamptz,
      ADD COLUMN worker_id varchar(128),
      ADD COLUMN attempt_token varchar(128),
      ADD COLUMN last_error text;

    UPDATE image_cache_purge_intents
       SET status = CASE WHEN processed_at IS NULL THEN 'pending' ELSE 'completed' END,
           available_at = created_at;

    ALTER TABLE image_cache_purge_intents
      ALTER COLUMN status SET NOT NULL,
      ALTER COLUMN status SET DEFAULT 'pending',
      ALTER COLUMN available_at SET NOT NULL,
      ALTER COLUMN available_at SET DEFAULT clock_timestamp(),
      ADD CONSTRAINT image_cache_purge_status_check
        CHECK (status IN ('pending', 'processing', 'completed')),
      ADD CONSTRAINT image_cache_purge_attempts_check CHECK (attempts >= 0),
      ADD CONSTRAINT image_cache_purge_available_check CHECK (available_at >= created_at),
      ADD CONSTRAINT image_cache_purge_claim_check CHECK (
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
      ADD CONSTRAINT image_cache_purge_processed_check CHECK (
        (status = 'completed' AND processed_at IS NOT NULL AND processed_at >= created_at)
        OR (status <> 'completed' AND processed_at IS NULL)
      );

    CREATE INDEX image_cache_purge_pending_idx
      ON image_cache_purge_intents (available_at, created_at, purge_intent_id)
      WHERE status IN ('pending', 'processing');
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX IF EXISTS image_cache_purge_pending_idx;
    ALTER TABLE image_cache_purge_intents
      DROP CONSTRAINT IF EXISTS image_cache_purge_processed_check,
      DROP CONSTRAINT IF EXISTS image_cache_purge_claim_check,
      DROP CONSTRAINT IF EXISTS image_cache_purge_available_check,
      DROP CONSTRAINT IF EXISTS image_cache_purge_attempts_check,
      DROP CONSTRAINT IF EXISTS image_cache_purge_status_check,
      DROP COLUMN IF EXISTS last_error,
      DROP COLUMN IF EXISTS attempt_token,
      DROP COLUMN IF EXISTS worker_id,
      DROP COLUMN IF EXISTS lease_expires_at,
      DROP COLUMN IF EXISTS claimed_at,
      DROP COLUMN IF EXISTS available_at,
      DROP COLUMN IF EXISTS attempts,
      DROP COLUMN IF EXISTS status;
    CREATE INDEX image_cache_purge_pending_idx
      ON image_cache_purge_intents (created_at, purge_intent_id)
      WHERE processed_at IS NULL;
  `);
}
