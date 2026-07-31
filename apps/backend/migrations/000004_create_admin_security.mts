import type { MigrationBuilder } from "node-pg-migrate";

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE admin_operator_accounts (
      singleton_id smallint PRIMARY KEY DEFAULT 1,
      account_id varchar(80) NOT NULL UNIQUE,
      username varchar(64) NOT NULL UNIQUE,
      password_hash varchar(512) NOT NULL,
      totp_ciphertext bytea NOT NULL,
      totp_initialization_vector bytea NOT NULL,
      totp_authentication_tag bytea NOT NULL,
      totp_key_version integer NOT NULL,
      totp_aad varchar(200) NOT NULL,
      last_accepted_totp_counter bigint NOT NULL DEFAULT -1,
      credential_revision bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CONSTRAINT admin_operator_accounts_singleton_check CHECK (singleton_id = 1),
      CONSTRAINT admin_operator_accounts_id_check CHECK (char_length(account_id) BETWEEN 1 AND 80),
      CONSTRAINT admin_operator_accounts_username_check CHECK (
        username = lower(username)
        AND username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
      ),
      CONSTRAINT admin_operator_accounts_totp_iv_check CHECK (octet_length(totp_initialization_vector) = 12),
      CONSTRAINT admin_operator_accounts_totp_tag_check CHECK (octet_length(totp_authentication_tag) = 16),
      CONSTRAINT admin_operator_accounts_totp_key_version_check CHECK (totp_key_version > 0),
      CONSTRAINT admin_operator_accounts_totp_counter_check CHECK (last_accepted_totp_counter >= -1),
      CONSTRAINT admin_operator_accounts_credential_revision_check CHECK (credential_revision >= 1)
    );

    CREATE TABLE admin_recovery_codes (
      code_id varchar(80) PRIMARY KEY,
      account_id varchar(80) NOT NULL REFERENCES admin_operator_accounts(account_id),
      code_digest bytea NOT NULL UNIQUE,
      credential_revision bigint NOT NULL,
      created_at timestamptz NOT NULL,
      consumed_at timestamptz,
      invalidated_at timestamptz,
      CONSTRAINT admin_recovery_codes_digest_check CHECK (octet_length(code_digest) = 32),
      CONSTRAINT admin_recovery_codes_revision_check CHECK (credential_revision >= 1),
      CONSTRAINT admin_recovery_codes_terminal_state_check CHECK (
        consumed_at IS NULL OR invalidated_at IS NULL
      )
    );
    CREATE INDEX admin_recovery_codes_active_idx
      ON admin_recovery_codes (account_id, credential_revision)
      WHERE consumed_at IS NULL AND invalidated_at IS NULL;

    CREATE TABLE admin_login_challenges (
      token_digest bytea PRIMARY KEY,
      account_id varchar(80) NOT NULL REFERENCES admin_operator_accounts(account_id),
      credential_revision bigint NOT NULL,
      source_fingerprint bytea NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL,
      CONSTRAINT admin_login_challenges_token_check CHECK (octet_length(token_digest) = 32),
      CONSTRAINT admin_login_challenges_source_check CHECK (octet_length(source_fingerprint) = 32),
      CONSTRAINT admin_login_challenges_expiry_check CHECK (expires_at > created_at)
    );
    CREATE INDEX admin_login_challenges_expiry_idx ON admin_login_challenges (expires_at);

    CREATE TABLE admin_sessions (
      token_digest bytea PRIMARY KEY,
      csrf_token_digest bytea NOT NULL,
      account_id varchar(80) NOT NULL REFERENCES admin_operator_accounts(account_id),
      credential_revision bigint NOT NULL,
      source_fingerprint bytea NOT NULL,
      user_agent_summary varchar(160) NOT NULL,
      created_at timestamptz NOT NULL,
      last_seen_at timestamptz NOT NULL,
      idle_expires_at timestamptz NOT NULL,
      absolute_expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      CONSTRAINT admin_sessions_token_check CHECK (octet_length(token_digest) = 32),
      CONSTRAINT admin_sessions_csrf_check CHECK (octet_length(csrf_token_digest) = 32),
      CONSTRAINT admin_sessions_source_check CHECK (octet_length(source_fingerprint) = 32),
      CONSTRAINT admin_sessions_expiry_check CHECK (
        created_at <= last_seen_at
        AND last_seen_at < idle_expires_at
        AND idle_expires_at <= absolute_expires_at
      )
    );
    CREATE INDEX admin_sessions_account_active_idx
      ON admin_sessions (account_id, absolute_expires_at)
      WHERE revoked_at IS NULL;

    CREATE TABLE admin_recovery_challenges (
      token_digest bytea PRIMARY KEY,
      account_id varchar(80) NOT NULL REFERENCES admin_operator_accounts(account_id),
      credential_revision bigint NOT NULL,
      source_fingerprint bytea NOT NULL,
      pending_totp_ciphertext bytea NOT NULL,
      pending_totp_initialization_vector bytea NOT NULL,
      pending_totp_authentication_tag bytea NOT NULL,
      pending_totp_key_version integer NOT NULL,
      pending_totp_aad varchar(200) NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL,
      CONSTRAINT admin_recovery_challenges_token_check CHECK (octet_length(token_digest) = 32),
      CONSTRAINT admin_recovery_challenges_source_check CHECK (octet_length(source_fingerprint) = 32),
      CONSTRAINT admin_recovery_challenges_totp_iv_check CHECK (octet_length(pending_totp_initialization_vector) = 12),
      CONSTRAINT admin_recovery_challenges_totp_tag_check CHECK (octet_length(pending_totp_authentication_tag) = 16),
      CONSTRAINT admin_recovery_challenges_expiry_check CHECK (expires_at > created_at)
    );
    CREATE INDEX admin_recovery_challenges_expiry_idx ON admin_recovery_challenges (expires_at);

    CREATE TABLE admin_auth_rate_limit_windows (
      action varchar(24) NOT NULL,
      dimension varchar(16) NOT NULL,
      identity_digest bytea NOT NULL,
      window_started_at timestamptz NOT NULL,
      window_ends_at timestamptz NOT NULL,
      attempt_count integer NOT NULL,
      last_request_id varchar(128) NOT NULL,
      updated_at timestamptz NOT NULL,
      PRIMARY KEY (action, dimension, identity_digest, window_started_at),
      CONSTRAINT admin_auth_rate_limit_action_check CHECK (
        action IN ('login', 'login_totp', 'recovery', 'recovery_complete')
      ),
      CONSTRAINT admin_auth_rate_limit_dimension_check CHECK (dimension IN ('source', 'account')),
      CONSTRAINT admin_auth_rate_limit_identity_check CHECK (octet_length(identity_digest) = 32),
      CONSTRAINT admin_auth_rate_limit_window_check CHECK (window_ends_at > window_started_at),
      CONSTRAINT admin_auth_rate_limit_count_check CHECK (attempt_count >= 1),
      CONSTRAINT admin_auth_rate_limit_request_id_check CHECK (char_length(last_request_id) BETWEEN 8 AND 128)
    );
    CREATE INDEX admin_auth_rate_limit_expiry_idx ON admin_auth_rate_limit_windows (window_ends_at);

    CREATE TABLE admin_security_events (
      event_id varchar(80) PRIMARY KEY,
      occurred_at timestamptz NOT NULL,
      event_type varchar(64) NOT NULL,
      outcome varchar(16) NOT NULL,
      account_id varchar(80),
      request_id varchar(128) NOT NULL,
      source_fingerprint bytea NOT NULL,
      user_agent_summary varchar(160) NOT NULL,
      reason varchar(2000),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      retain_until timestamptz NOT NULL,
      CONSTRAINT admin_security_events_outcome_check CHECK (outcome IN ('success', 'failure', 'denied')),
      CONSTRAINT admin_security_events_request_id_check CHECK (char_length(request_id) BETWEEN 8 AND 128),
      CONSTRAINT admin_security_events_source_check CHECK (octet_length(source_fingerprint) = 32),
      CONSTRAINT admin_security_events_retention_check CHECK (
        retain_until >= occurred_at + interval '365 days'
      )
    );
    CREATE INDEX admin_security_events_occurred_idx ON admin_security_events (occurred_at DESC);

    CREATE FUNCTION reject_admin_security_event_mutation() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'admin_security_events is append-only';
    END;
    $$;
    CREATE TRIGGER admin_security_events_append_only
      BEFORE UPDATE OR DELETE ON admin_security_events
      FOR EACH ROW EXECUTE FUNCTION reject_admin_security_event_mutation();

    CREATE TABLE public_access_control (
      singleton_id smallint PRIMARY KEY DEFAULT 1,
      publicly_enabled boolean NOT NULL,
      revision bigint NOT NULL,
      changed_at timestamptz NOT NULL,
      changed_by varchar(80),
      reason varchar(2000),
      request_id varchar(128),
      audit_event_id varchar(80) REFERENCES admin_security_events(event_id),
      CONSTRAINT public_access_control_singleton_check CHECK (singleton_id = 1),
      CONSTRAINT public_access_control_revision_check CHECK (revision >= 1)
    );
    INSERT INTO public_access_control (
      singleton_id, publicly_enabled, revision, changed_at
    ) VALUES (1, true, 1, clock_timestamp());

    CREATE TABLE admin_emergency_idempotency (
      account_id varchar(80) NOT NULL REFERENCES admin_operator_accounts(account_id),
      action varchar(16) NOT NULL,
      idempotency_key varchar(128) NOT NULL,
      request_hash bytea NOT NULL,
      resulting_revision bigint NOT NULL,
      publicly_enabled boolean NOT NULL,
      resulting_changed_at timestamptz NOT NULL,
      resulting_reason varchar(2000) NOT NULL,
      resulting_request_id varchar(128) NOT NULL,
      resulting_audit_event_id varchar(80) NOT NULL REFERENCES admin_security_events(event_id),
      created_at timestamptz NOT NULL,
      PRIMARY KEY (account_id, action, idempotency_key),
      CONSTRAINT admin_emergency_idempotency_action_check CHECK (action IN ('stop', 'resume')),
      CONSTRAINT admin_emergency_idempotency_hash_check CHECK (octet_length(request_hash) = 32),
      CONSTRAINT admin_emergency_idempotency_revision_check CHECK (resulting_revision >= 1)
    );
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE IF EXISTS admin_emergency_idempotency;
    DROP TABLE IF EXISTS public_access_control;
    DROP TRIGGER IF EXISTS admin_security_events_append_only ON admin_security_events;
    DROP FUNCTION IF EXISTS reject_admin_security_event_mutation();
    DROP TABLE IF EXISTS admin_security_events;
    DROP TABLE IF EXISTS admin_auth_rate_limit_windows;
    DROP TABLE IF EXISTS admin_recovery_challenges;
    DROP TABLE IF EXISTS admin_sessions;
    DROP TABLE IF EXISTS admin_login_challenges;
    DROP TABLE IF EXISTS admin_recovery_codes;
    DROP TABLE IF EXISTS admin_operator_accounts;
  `);
}
