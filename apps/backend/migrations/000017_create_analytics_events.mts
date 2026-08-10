import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE analytics_events (
      event_id varchar(128) PRIMARY KEY,
      request_hash char(64) NOT NULL,
      event_name varchar(40) NOT NULL,
      anonymous_id_hmac char(64) NOT NULL,
      fortune_date date NOT NULL,
      content_version varchar(128) NOT NULL,
      channel_id varchar(64) NOT NULL,
      referral_id_hmac char(64),
      poster_instance_id_hmac char(64),
      source_content_version varchar(128),
      observed_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      CONSTRAINT analytics_events_event_id_check
        CHECK (event_id ~ '^[-A-Za-z0-9_:.]{16,128}$'),
      CONSTRAINT analytics_events_request_hash_check
        CHECK (request_hash ~ '^[0-9a-f]{64}$'),
      CONSTRAINT analytics_events_event_name_check CHECK (event_name IN (
        'view_today_summary',
        'open_outfit_hub',
        'view_daily_look',
        'view_look_detail',
        'share_summary_initiated',
        'share_link_landing_view',
        'share_poster_initiated',
        'poster_save_requested',
        'poster_save_succeeded',
        'poster_save_failed',
        'poster_landing_view'
      )),
      CONSTRAINT analytics_events_anonymous_hmac_check
        CHECK (anonymous_id_hmac ~ '^[0-9a-f]{64}$'),
      CONSTRAINT analytics_events_content_version_check
        CHECK (char_length(content_version) BETWEEN 1 AND 128 AND btrim(content_version) = content_version),
      CONSTRAINT analytics_events_source_content_version_check
        CHECK (
          source_content_version IS NULL OR (
            char_length(source_content_version) BETWEEN 1 AND 128
            AND btrim(source_content_version) = source_content_version
          )
        ),
      CONSTRAINT analytics_events_channel_id_check
        CHECK (char_length(channel_id) BETWEEN 1 AND 64 AND btrim(channel_id) = channel_id),
      CONSTRAINT analytics_events_referral_hmac_check
        CHECK (referral_id_hmac IS NULL OR referral_id_hmac ~ '^[0-9a-f]{64}$'),
      CONSTRAINT analytics_events_poster_hmac_check
        CHECK (poster_instance_id_hmac IS NULL OR poster_instance_id_hmac ~ '^[0-9a-f]{64}$'),
      CONSTRAINT analytics_events_semantics_check CHECK (
        (
          event_name IN ('view_today_summary', 'open_outfit_hub', 'view_daily_look', 'view_look_detail')
          AND referral_id_hmac IS NULL
          AND poster_instance_id_hmac IS NULL
          AND source_content_version IS NULL
        ) OR (
          event_name = 'share_summary_initiated'
          AND referral_id_hmac IS NOT NULL
          AND poster_instance_id_hmac IS NULL
          AND source_content_version IS NULL
        ) OR (
          event_name = 'share_link_landing_view'
          AND referral_id_hmac IS NOT NULL
          AND poster_instance_id_hmac IS NULL
          AND source_content_version IS NOT NULL
        ) OR (
          event_name = 'share_poster_initiated'
          AND referral_id_hmac IS NOT NULL
          AND poster_instance_id_hmac IS NOT NULL
          AND source_content_version IS NULL
        ) OR (
          event_name IN ('poster_save_requested', 'poster_save_succeeded', 'poster_save_failed')
          AND referral_id_hmac IS NULL
          AND poster_instance_id_hmac IS NOT NULL
          AND source_content_version IS NULL
        ) OR (
          event_name = 'poster_landing_view'
          AND referral_id_hmac IS NOT NULL
          AND poster_instance_id_hmac IS NULL
          AND source_content_version IS NOT NULL
        )
      ),
      CONSTRAINT analytics_events_retention_check
        CHECK (expires_at > observed_at AND expires_at <= observed_at + INTERVAL '90 days')
    );

    CREATE INDEX analytics_events_overview_idx
      ON analytics_events (fortune_date, event_name, channel_id, content_version);
    CREATE INDEX analytics_events_anonymous_overview_idx
      ON analytics_events (fortune_date, anonymous_id_hmac);
    CREATE INDEX analytics_events_referral_idx
      ON analytics_events (referral_id_hmac, event_name)
      WHERE referral_id_hmac IS NOT NULL;
    CREATE INDEX analytics_events_observed_at_idx ON analytics_events (observed_at);
    CREATE INDEX analytics_events_expiry_idx ON analytics_events (expires_at);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql("DROP TABLE IF EXISTS analytics_events;");
}
