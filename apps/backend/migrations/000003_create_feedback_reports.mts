import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE feedback_reports (
      feedback_id varchar(128) PRIMARY KEY,
      category varchar(32) NOT NULL,
      message varchar(2000) NOT NULL,
      fortune_date date NOT NULL,
      content_version varchar(128) NOT NULL,
      channel_id varchar(64) NOT NULL,
      contact varchar(200),
      request_id varchar(128) NOT NULL,
      status varchar(32) NOT NULL DEFAULT 'received',
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT feedback_reports_category_check
        CHECK (category IN ('content_error', 'product_feedback')),
      CONSTRAINT feedback_reports_message_check
        CHECK (char_length(message) BETWEEN 1 AND 2000 AND btrim(message) <> ''),
      CONSTRAINT feedback_reports_content_version_check
        CHECK (char_length(content_version) BETWEEN 1 AND 128),
      CONSTRAINT feedback_reports_channel_id_check
        CHECK (char_length(channel_id) BETWEEN 1 AND 64),
      CONSTRAINT feedback_reports_contact_check
        CHECK (contact IS NULL OR (char_length(contact) BETWEEN 1 AND 200 AND btrim(contact) <> '')),
      CONSTRAINT feedback_reports_request_id_check
        CHECK (char_length(request_id) BETWEEN 8 AND 128),
      CONSTRAINT feedback_reports_status_check CHECK (status = 'received')
    );

    CREATE INDEX feedback_reports_rate_limit_idx ON feedback_reports (created_at);

    -- One aggregate row per global window records abuse-control outcomes without retaining IP,
    -- user agent, cookies, a durable visitor ID, or one row per rejected request.
    CREATE TABLE feedback_rate_limit_windows (
      window_started_at timestamptz PRIMARY KEY,
      window_ends_at timestamptz NOT NULL,
      accepted_count integer NOT NULL DEFAULT 0,
      rejected_count integer NOT NULL DEFAULT 0,
      last_request_id varchar(128) NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT feedback_rate_limit_windows_bounds_check
        CHECK (window_ends_at > window_started_at),
      CONSTRAINT feedback_rate_limit_windows_counts_check
        CHECK (accepted_count >= 0 AND rejected_count >= 0),
      CONSTRAINT feedback_rate_limit_windows_request_id_check
        CHECK (char_length(last_request_id) BETWEEN 8 AND 128)
    );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS feedback_rate_limit_windows;
    DROP TABLE IF EXISTS feedback_reports;
  `);
}
