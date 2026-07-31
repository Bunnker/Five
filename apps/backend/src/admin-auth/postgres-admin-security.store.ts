import type { Pool, PoolClient } from "pg";

import type { EncryptedTotpSecret } from "./admin-auth.crypto";
import type {
  AdminAccountRecord,
  AdminSecurityStore,
  ApplyEmergencyControlInput,
  ApplyEmergencyControlResult,
  AuthenticateSessionInput,
  BeginRecoveryInput,
  CompleteLoginInput,
  CompleteRecoveryInput,
  CreateAdminAccountInput,
  CreateLoginChallengeInput,
  LoginChallengeRecord,
  OfflineResetInput,
  PasswordVerificationLookup,
  PublicAccessControlRecord,
  RateLimitAttemptInput,
  RateLimitAttemptResult,
  RecoveryChallengeRecord,
  RevokeAllSessionsInput,
  RevokeSessionInput,
  SecurityEventInput,
  SecurityEventRecord,
  StoredSessionPrincipal,
} from "./admin-auth.store";

interface AccountRow {
  account_id: string;
  credential_revision: string;
  last_accepted_totp_counter: string;
  password_hash: string;
  totp_aad: string;
  totp_authentication_tag: Buffer;
  totp_ciphertext: Buffer;
  totp_initialization_vector: Buffer;
  totp_key_version: number;
  username: string;
}

interface PublicAccessRow {
  audit_event_id: string | null;
  changed_at: Date;
  publicly_enabled: boolean;
  reason: string | null;
  request_id: string | null;
  revision: string;
}

const ACCOUNT_COLUMNS = `
  account_id,
  username,
  password_hash,
  totp_ciphertext,
  totp_initialization_vector,
  totp_authentication_tag,
  totp_key_version,
  totp_aad,
  last_accepted_totp_counter,
  credential_revision
`;

const QUALIFIED_ACCOUNT_COLUMNS = `
  account.account_id AS account_id,
  account.username AS username,
  account.password_hash AS password_hash,
  account.totp_ciphertext AS totp_ciphertext,
  account.totp_initialization_vector AS totp_initialization_vector,
  account.totp_authentication_tag AS totp_authentication_tag,
  account.totp_key_version AS totp_key_version,
  account.totp_aad AS totp_aad,
  account.last_accepted_totp_counter AS last_accepted_totp_counter,
  account.credential_revision AS credential_revision
`;

function safeInteger(value: string, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${field} exceeded the JavaScript safe-integer range`);
  }
  return result;
}

function encryptedTotp(row: AccountRow): EncryptedTotpSecret {
  return {
    aad: row.totp_aad,
    authenticationTag: row.totp_authentication_tag,
    ciphertext: row.totp_ciphertext,
    initializationVector: row.totp_initialization_vector,
    keyVersion: row.totp_key_version,
  };
}

function accountRecord(row: AccountRow): AdminAccountRecord {
  return {
    accountId: row.account_id,
    credentialRevision: safeInteger(row.credential_revision, "credential_revision"),
    lastAcceptedTotpCounter: safeInteger(
      row.last_accepted_totp_counter,
      "last_accepted_totp_counter",
    ),
    passwordHash: row.password_hash,
    totpSecret: encryptedTotp(row),
    username: row.username,
  };
}

function publicAccessRecord(row: PublicAccessRow): PublicAccessControlRecord {
  return {
    auditEventId: row.audit_event_id,
    changedAt: row.changed_at,
    publiclyEnabled: row.publicly_enabled,
    reason: row.reason,
    requestId: row.request_id,
    revision: safeInteger(row.revision, "public_access_control.revision"),
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query("ROLLBACK").catch(() => undefined);
}

async function insertSecurityEvent(client: PoolClient, event: SecurityEventInput): Promise<void> {
  await client.query(
    `INSERT INTO admin_security_events (
       event_id, occurred_at, event_type, outcome, account_id, request_id,
       source_fingerprint, user_agent_summary, reason, metadata, retain_until
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      event.eventId,
      event.occurredAt,
      event.eventType,
      event.outcome,
      event.accountId,
      event.requestId,
      event.sourceFingerprint,
      event.userAgentSummary,
      event.reason ?? null,
      JSON.stringify(event.metadata ?? {}),
      event.retainUntil,
    ],
  );
}

async function insertRecoveryCodes(
  client: PoolClient,
  accountId: string,
  credentialRevision: number,
  createdAt: Date,
  codes: CompleteRecoveryInput["recoveryCodes"],
): Promise<void> {
  for (const code of codes) {
    await client.query(
      `INSERT INTO admin_recovery_codes (
         code_id, account_id, code_digest, credential_revision, created_at
       ) VALUES ($1, $2, $3, $4, $5)`,
      [code.codeId, accountId, code.codeDigest, credentialRevision, createdAt],
    );
  }
}

export class PostgresAdminSecurityStore implements AdminSecurityStore {
  constructor(private readonly pool: Pick<Pool, "connect" | "query">) {}

  async appendSecurityEvent(event: SecurityEventInput): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await insertSecurityEvent(client, event);
      await client.query("COMMIT");
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async consumeRateLimit(input: RateLimitAttemptInput): Promise<RateLimitAttemptResult> {
    const windowMilliseconds = input.windowSeconds * 1_000;
    const windowStartedAt = new Date(
      Math.floor(input.now.getTime() / windowMilliseconds) * windowMilliseconds,
    );
    const windowEndsAt = new Date(windowStartedAt.getTime() + windowMilliseconds);
    const result = await this.pool.query<{ attempt_count: number }>(
      `WITH pruned AS (
         DELETE FROM admin_auth_rate_limit_windows
          WHERE window_ends_at < $7::timestamptz - interval '24 hours'
       ), consumed AS (
         INSERT INTO admin_auth_rate_limit_windows (
           action, dimension, identity_digest, window_started_at, window_ends_at,
           attempt_count, last_request_id, updated_at
         ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
         ON CONFLICT (action, dimension, identity_digest, window_started_at)
         DO UPDATE SET
           attempt_count = admin_auth_rate_limit_windows.attempt_count + 1,
           last_request_id = EXCLUDED.last_request_id,
           updated_at = EXCLUDED.updated_at
         RETURNING attempt_count
       )
       SELECT attempt_count FROM consumed`,
      [
        input.action,
        input.dimension,
        input.identityDigest,
        windowStartedAt,
        windowEndsAt,
        input.requestId,
        input.now,
      ],
    );
    const attemptCount = result.rows[0]?.attempt_count;
    if (attemptCount === undefined) {
      throw new Error("Rate limit attempt did not return a count");
    }
    return attemptCount <= input.capacity
      ? { allowed: true }
      : {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((windowEndsAt.getTime() - input.now.getTime()) / 1_000),
          ),
        };
  }

  async createAccount(input: CreateAdminAccountInput): Promise<"already_initialized" | "created"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query<{ account_id: string }>(
        `INSERT INTO admin_operator_accounts (
           singleton_id, account_id, username, password_hash, totp_ciphertext,
           totp_initialization_vector, totp_authentication_tag, totp_key_version,
           totp_aad, last_accepted_totp_counter, credential_revision, created_at, updated_at
         ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10)
         ON CONFLICT (singleton_id) DO NOTHING
         RETURNING account_id`,
        [
          input.accountId,
          input.username,
          input.passwordHash,
          input.totpSecret.ciphertext,
          input.totpSecret.initializationVector,
          input.totpSecret.authenticationTag,
          input.totpSecret.keyVersion,
          input.totpSecret.aad,
          input.lastAcceptedTotpCounter,
          input.createdAt,
        ],
      );
      if (created.rowCount !== 1) {
        await client.query("COMMIT");
        return "already_initialized";
      }
      await insertRecoveryCodes(client, input.accountId, 1, input.createdAt, input.recoveryCodes);
      await insertSecurityEvent(client, input.event);
      await client.query("COMMIT");
      return "created";
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async findAccountById(accountId: string): Promise<AdminAccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM admin_operator_accounts WHERE account_id = $1`,
      [accountId],
    );
    return result.rows[0] === undefined ? null : accountRecord(result.rows[0]);
  }

  async findAccountByUsername(username: string): Promise<AdminAccountRecord | null> {
    const result = await this.pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM admin_operator_accounts WHERE username = $1`,
      [username],
    );
    return result.rows[0] === undefined ? null : accountRecord(result.rows[0]);
  }

  async findPasswordVerification(username: string): Promise<PasswordVerificationLookup> {
    const result = await this.pool.query<AccountRow & { username_matches: boolean }>(
      `SELECT ${ACCOUNT_COLUMNS}, username = $1 AS username_matches
         FROM admin_operator_accounts
        WHERE singleton_id = 1`,
      [username],
    );
    const row = result.rows[0];
    if (row === undefined) {
      return { account: null, passwordHash: null };
    }
    return {
      account: row.username_matches ? accountRecord(row) : null,
      passwordHash: row.password_hash,
    };
  }

  async isInitialized(): Promise<boolean> {
    const result = await this.pool.query<{ initialized: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM admin_operator_accounts) AS initialized",
    );
    return result.rows[0]?.initialized === true;
  }

  async createLoginChallenge(input: CreateLoginChallengeInput): Promise<"created" | "invalid"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO admin_login_challenges (
           token_digest, account_id, credential_revision, source_fingerprint,
           expires_at, created_at
         )
         SELECT $1, account_id, credential_revision, $4, $5, $6
           FROM admin_operator_accounts
          WHERE account_id = $2 AND credential_revision = $3
         RETURNING token_digest`,
        [
          input.tokenDigest,
          input.accountId,
          input.credentialRevision,
          input.sourceFingerprint,
          input.expiresAt,
          input.createdAt,
        ],
      );
      if (inserted.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      await insertSecurityEvent(client, input.event);
      await client.query(
        `DELETE FROM admin_login_challenges
          WHERE expires_at < $1::timestamptz - interval '24 hours'`,
        [input.createdAt],
      );
      await client.query("COMMIT");
      return "created";
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async findLoginChallenge(tokenDigest: Buffer, now: Date): Promise<LoginChallengeRecord | null> {
    const result = await this.pool.query<AccountRow & { source_fingerprint: Buffer }>(
      `SELECT ${QUALIFIED_ACCOUNT_COLUMNS}, challenge.source_fingerprint
         FROM admin_login_challenges challenge
         JOIN admin_operator_accounts account
           ON account.account_id = challenge.account_id
          AND account.credential_revision = challenge.credential_revision
        WHERE challenge.token_digest = $1
          AND challenge.consumed_at IS NULL
          AND challenge.expires_at > $2`,
      [tokenDigest, now],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : { account: accountRecord(row), sourceFingerprint: row.source_fingerprint };
  }

  async completeLogin(input: CompleteLoginInput): Promise<"created" | "invalid"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const challenge = await client.query<{ account_id: string }>(
        `SELECT challenge.account_id
           FROM admin_login_challenges challenge
           JOIN admin_operator_accounts account ON account.account_id = challenge.account_id
          WHERE challenge.token_digest = $1
            AND challenge.account_id = $2
            AND challenge.credential_revision = $3
            AND challenge.source_fingerprint = $4
            AND challenge.consumed_at IS NULL
            AND challenge.expires_at > $5
            AND account.credential_revision = $3
          FOR UPDATE OF challenge, account`,
        [
          input.challengeTokenDigest,
          input.accountId,
          input.credentialRevision,
          input.sourceFingerprint,
          input.createdAt,
        ],
      );
      if (challenge.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      const accepted = await client.query(
        `UPDATE admin_operator_accounts
            SET last_accepted_totp_counter = $1, updated_at = $2
          WHERE account_id = $3
            AND credential_revision = $4
            AND last_accepted_totp_counter < $1`,
        [input.matchedTotpCounter, input.createdAt, input.accountId, input.credentialRevision],
      );
      if (accepted.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      await client.query(
        `UPDATE admin_login_challenges SET consumed_at = $2 WHERE token_digest = $1`,
        [input.challengeTokenDigest, input.createdAt],
      );
      await client.query(
        `INSERT INTO admin_sessions (
           token_digest, csrf_token_digest, account_id, credential_revision,
           source_fingerprint, user_agent_summary, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
        [
          input.sessionTokenDigest,
          input.csrfTokenDigest,
          input.accountId,
          input.credentialRevision,
          input.sourceFingerprint,
          input.userAgentSummary,
          input.createdAt,
          input.idleExpiresAt,
          input.absoluteExpiresAt,
        ],
      );
      await insertSecurityEvent(client, input.event);
      await client.query("COMMIT");
      return "created";
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async authenticateSession(
    input: AuthenticateSessionInput,
  ): Promise<StoredSessionPrincipal | null> {
    const result = await this.pool.query<{
      absolute_expires_at: Date;
      account_id: string;
      credential_revision: string;
      idle_expires_at: Date;
      issued_at: Date;
      token_digest: Buffer;
      username: string;
    }>(
      `UPDATE admin_sessions session
          SET last_seen_at = $2,
              idle_expires_at = LEAST($3::timestamptz, session.absolute_expires_at)
         FROM admin_operator_accounts account
        WHERE session.token_digest = $1
          AND session.revoked_at IS NULL
          AND session.idle_expires_at > $2
          AND session.absolute_expires_at > $2
          AND session.credential_revision = account.credential_revision
          AND session.account_id = account.account_id
          AND ($4::boolean = false OR session.csrf_token_digest = $5)
       RETURNING
         session.token_digest,
         session.account_id,
         session.credential_revision,
         session.created_at AS issued_at,
         session.idle_expires_at,
         session.absolute_expires_at,
         account.username`,
      [
        input.sessionTokenDigest,
        input.now,
        input.idleExpiresAt,
        input.requireCsrf,
        input.csrfTokenDigest,
      ],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          absoluteExpiresAt: row.absolute_expires_at,
          accountId: row.account_id,
          credentialRevision: safeInteger(row.credential_revision, "session.credential_revision"),
          idleExpiresAt: row.idle_expires_at,
          issuedAt: row.issued_at,
          sessionTokenDigest: row.token_digest,
          username: row.username,
        };
  }

  async revokeSession(input: RevokeSessionInput): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const revoked = await client.query(
        `UPDATE admin_sessions
            SET revoked_at = $2
          WHERE token_digest = $1 AND revoked_at IS NULL
         RETURNING account_id`,
        [input.sessionTokenDigest, input.now],
      );
      if (revoked.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await insertSecurityEvent(client, input.event);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeAllSessions(input: RevokeAllSessionsInput): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query(
        `SELECT account_id FROM admin_operator_accounts WHERE account_id = $1 FOR UPDATE`,
        [input.accountId],
      );
      if (account.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `UPDATE admin_sessions SET revoked_at = $2
          WHERE account_id = $1 AND revoked_at IS NULL`,
        [input.accountId, input.now],
      );
      await client.query(
        `UPDATE admin_login_challenges SET consumed_at = $2
          WHERE account_id = $1 AND consumed_at IS NULL`,
        [input.accountId, input.now],
      );
      await insertSecurityEvent(client, input.event);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async beginRecovery(input: BeginRecoveryInput): Promise<"created" | "invalid"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const candidate = await client.query<AccountRow & { code_id: string }>(
        `SELECT ${QUALIFIED_ACCOUNT_COLUMNS}, code.code_id
           FROM admin_operator_accounts account
           JOIN admin_recovery_codes code
             ON code.account_id = account.account_id
            AND code.credential_revision = account.credential_revision
          WHERE account.username = $1
            AND account.credential_revision = $2
            AND code.code_digest = $3
            AND code.consumed_at IS NULL
            AND code.invalidated_at IS NULL
          FOR UPDATE OF account, code`,
        [input.username, input.expectedCredentialRevision, input.recoveryCodeDigest],
      );
      const row = candidate.rows[0];
      if (row === undefined || row.account_id !== input.accountId) {
        // Unknown accounts and wrong codes take the same transaction and query path.
        await client.query("ROLLBACK");
        return "invalid";
      }
      const newCredentialRevision = safeInteger(row.credential_revision, "credential_revision") + 1;
      await client.query(`UPDATE admin_recovery_codes SET consumed_at = $2 WHERE code_id = $1`, [
        row.code_id,
        input.createdAt,
      ]);
      await client.query(
        `UPDATE admin_recovery_codes
            SET invalidated_at = $2
          WHERE account_id = $1
            AND consumed_at IS NULL
            AND invalidated_at IS NULL`,
        [input.accountId, input.createdAt],
      );
      const bumped = await client.query(
        `UPDATE admin_operator_accounts
            SET credential_revision = $1, updated_at = $2
          WHERE account_id = $3 AND credential_revision = $4`,
        [newCredentialRevision, input.createdAt, input.accountId, input.expectedCredentialRevision],
      );
      if (bumped.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      await client.query(
        `UPDATE admin_sessions SET revoked_at = $2
          WHERE account_id = $1 AND revoked_at IS NULL`,
        [input.accountId, input.createdAt],
      );
      await client.query(
        `UPDATE admin_login_challenges SET consumed_at = $2
          WHERE account_id = $1 AND consumed_at IS NULL`,
        [input.accountId, input.createdAt],
      );
      await client.query(
        `UPDATE admin_recovery_challenges SET consumed_at = $2
          WHERE account_id = $1 AND consumed_at IS NULL`,
        [input.accountId, input.createdAt],
      );
      await client.query(
        `INSERT INTO admin_recovery_challenges (
           token_digest, account_id, credential_revision, source_fingerprint,
           pending_totp_ciphertext, pending_totp_initialization_vector,
           pending_totp_authentication_tag, pending_totp_key_version,
           pending_totp_aad, expires_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          input.challengeTokenDigest,
          input.accountId,
          newCredentialRevision,
          input.sourceFingerprint,
          input.pendingTotpSecret.ciphertext,
          input.pendingTotpSecret.initializationVector,
          input.pendingTotpSecret.authenticationTag,
          input.pendingTotpSecret.keyVersion,
          input.pendingTotpSecret.aad,
          input.expiresAt,
          input.createdAt,
        ],
      );
      await insertSecurityEvent(client, input.event);
      await client.query("COMMIT");
      return "created";
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async findRecoveryChallenge(
    tokenDigest: Buffer,
    now: Date,
  ): Promise<RecoveryChallengeRecord | null> {
    const result = await this.pool.query<{
      account_id: string;
      credential_revision: string;
      pending_totp_aad: string;
      pending_totp_authentication_tag: Buffer;
      pending_totp_ciphertext: Buffer;
      pending_totp_initialization_vector: Buffer;
      pending_totp_key_version: number;
      source_fingerprint: Buffer;
      username: string;
    }>(
      `SELECT
         challenge.account_id,
         challenge.credential_revision,
         challenge.source_fingerprint,
         challenge.pending_totp_ciphertext,
         challenge.pending_totp_initialization_vector,
         challenge.pending_totp_authentication_tag,
         challenge.pending_totp_key_version,
         challenge.pending_totp_aad,
         account.username
       FROM admin_recovery_challenges challenge
       JOIN admin_operator_accounts account
         ON account.account_id = challenge.account_id
        AND account.credential_revision = challenge.credential_revision
      WHERE challenge.token_digest = $1
        AND challenge.consumed_at IS NULL
        AND challenge.expires_at > $2`,
      [tokenDigest, now],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          accountId: row.account_id,
          credentialRevision: safeInteger(row.credential_revision, "credential_revision"),
          pendingTotpSecret: {
            aad: row.pending_totp_aad,
            authenticationTag: row.pending_totp_authentication_tag,
            ciphertext: row.pending_totp_ciphertext,
            initializationVector: row.pending_totp_initialization_vector,
            keyVersion: row.pending_totp_key_version,
          },
          sourceFingerprint: row.source_fingerprint,
          username: row.username,
        };
  }

  async completeRecovery(input: CompleteRecoveryInput): Promise<"completed" | "invalid"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const challenge = await client.query<{ account_id: string }>(
        `SELECT challenge.account_id
           FROM admin_recovery_challenges challenge
           JOIN admin_operator_accounts account ON account.account_id = challenge.account_id
          WHERE challenge.token_digest = $1
            AND challenge.account_id = $2
            AND challenge.credential_revision = $3
            AND challenge.consumed_at IS NULL
            AND challenge.expires_at > $4
            AND account.credential_revision = $3
          FOR UPDATE OF challenge, account`,
        [input.challengeTokenDigest, input.accountId, input.credentialRevision, input.completedAt],
      );
      if (challenge.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      const updated = await client.query(
        `UPDATE admin_operator_accounts
            SET password_hash = $1,
                totp_ciphertext = $2,
                totp_initialization_vector = $3,
                totp_authentication_tag = $4,
                totp_key_version = $5,
                totp_aad = $6,
                last_accepted_totp_counter = $7,
                updated_at = $8
          WHERE account_id = $9 AND credential_revision = $10`,
        [
          input.passwordHash,
          input.totpSecret.ciphertext,
          input.totpSecret.initializationVector,
          input.totpSecret.authenticationTag,
          input.totpSecret.keyVersion,
          input.totpSecret.aad,
          input.lastAcceptedTotpCounter,
          input.completedAt,
          input.accountId,
          input.credentialRevision,
        ],
      );
      if (updated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      await client.query(
        `UPDATE admin_recovery_challenges SET consumed_at = $2 WHERE token_digest = $1`,
        [input.challengeTokenDigest, input.completedAt],
      );
      await client.query(
        `UPDATE admin_recovery_codes SET invalidated_at = $2
          WHERE account_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [input.accountId, input.completedAt],
      );
      await insertRecoveryCodes(
        client,
        input.accountId,
        input.credentialRevision,
        input.completedAt,
        input.recoveryCodes,
      );
      await client.query(
        `INSERT INTO admin_sessions (
           token_digest, csrf_token_digest, account_id, credential_revision,
           source_fingerprint, user_agent_summary, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
        [
          input.sessionTokenDigest,
          input.csrfTokenDigest,
          input.accountId,
          input.credentialRevision,
          input.sourceFingerprint,
          input.userAgentSummary,
          input.completedAt,
          input.idleExpiresAt,
          input.absoluteExpiresAt,
        ],
      );
      await insertSecurityEvent(client, input.event);
      await client.query("COMMIT");
      return "completed";
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async offlineReset(input: OfflineResetInput): Promise<"completed" | "invalid"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query<{ credential_revision: string }>(
        `SELECT credential_revision FROM admin_operator_accounts
          WHERE account_id = $1 FOR UPDATE`,
        [input.accountId],
      );
      const row = account.rows[0];
      if (
        row === undefined ||
        safeInteger(row.credential_revision, "credential_revision") !==
          input.expectedCredentialRevision
      ) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      const newCredentialRevision = input.expectedCredentialRevision + 1;
      const updated = await client.query(
        `UPDATE admin_operator_accounts
            SET password_hash = $1,
                totp_ciphertext = $2,
                totp_initialization_vector = $3,
                totp_authentication_tag = $4,
                totp_key_version = $5,
                totp_aad = $6,
                last_accepted_totp_counter = $7,
                credential_revision = $8,
                updated_at = $9
          WHERE account_id = $10 AND credential_revision = $11`,
        [
          input.passwordHash,
          input.totpSecret.ciphertext,
          input.totpSecret.initializationVector,
          input.totpSecret.authenticationTag,
          input.totpSecret.keyVersion,
          input.totpSecret.aad,
          input.lastAcceptedTotpCounter,
          newCredentialRevision,
          input.completedAt,
          input.accountId,
          input.expectedCredentialRevision,
        ],
      );
      if (updated.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      await client.query(
        `UPDATE admin_sessions SET revoked_at = $2
          WHERE account_id = $1 AND revoked_at IS NULL`,
        [input.accountId, input.completedAt],
      );
      await client.query(
        `UPDATE admin_login_challenges SET consumed_at = $2
          WHERE account_id = $1 AND consumed_at IS NULL`,
        [input.accountId, input.completedAt],
      );
      await client.query(
        `UPDATE admin_recovery_challenges SET consumed_at = $2
          WHERE account_id = $1 AND consumed_at IS NULL`,
        [input.accountId, input.completedAt],
      );
      await client.query(
        `UPDATE admin_recovery_codes SET invalidated_at = $2
          WHERE account_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [input.accountId, input.completedAt],
      );
      await insertRecoveryCodes(
        client,
        input.accountId,
        newCredentialRevision,
        input.completedAt,
        input.recoveryCodes,
      );
      await insertSecurityEvent(client, input.event);
      await client.query("COMMIT");
      return "completed";
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async listSecurityEvents(
    accountId: string,
    limit: number,
    before: { readonly eventId: string; readonly occurredAt: Date } | null,
  ): Promise<readonly SecurityEventRecord[]> {
    const result = await this.pool.query<{
      account_id: string | null;
      event_id: string;
      event_type: string;
      metadata: Record<string, unknown>;
      occurred_at: Date;
      outcome: SecurityEventRecord["outcome"];
      reason: string | null;
      request_id: string;
      source_fingerprint: Buffer;
      user_agent_summary: string;
    }>(
      `SELECT
         event_id, occurred_at, event_type, outcome, account_id, request_id,
         source_fingerprint, user_agent_summary, reason, metadata
       FROM admin_security_events
       WHERE (account_id = $1 OR account_id IS NULL)
         AND (
           $3::timestamptz IS NULL
           OR (occurred_at, event_id) < ($3::timestamptz, $4::varchar)
         )
       ORDER BY occurred_at DESC, event_id DESC
       LIMIT $2`,
      [accountId, limit, before?.occurredAt ?? null, before?.eventId ?? null],
    );
    return result.rows.map((row) => ({
      accountId: row.account_id,
      eventId: row.event_id,
      eventType: row.event_type,
      metadata: row.metadata,
      occurredAt: row.occurred_at,
      outcome: row.outcome,
      reason: row.reason,
      requestId: row.request_id,
      sourceFingerprint: row.source_fingerprint.toString("base64url"),
      userAgentSummary: row.user_agent_summary,
    }));
  }

  async getPublicAccessControl(): Promise<PublicAccessControlRecord> {
    const result = await this.pool.query<PublicAccessRow>(
      `SELECT
         audit_event_id, changed_at, publicly_enabled, reason, request_id, revision
       FROM public_access_control WHERE singleton_id = 1`,
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error("The public access control singleton is missing");
    }
    return publicAccessRecord(row);
  }

  async applyEmergencyControl(
    input: ApplyEmergencyControlInput,
  ): Promise<ApplyEmergencyControlResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `admin-emergency:${input.accountId}:${input.action}:${input.idempotencyKey}`,
      ]);
      const idempotent = await client.query<PublicAccessRow & { request_hash: Buffer }>(
        `SELECT
           request_hash,
           resulting_audit_event_id AS audit_event_id,
           resulting_changed_at AS changed_at,
           publicly_enabled,
           resulting_reason AS reason,
           resulting_request_id AS request_id,
           resulting_revision AS revision
         FROM admin_emergency_idempotency
         WHERE account_id = $1 AND action = $2 AND idempotency_key = $3`,
        [input.accountId, input.action, input.idempotencyKey],
      );
      const existing = idempotent.rows[0];
      if (existing !== undefined) {
        await client.query("COMMIT");
        return existing.request_hash.equals(input.requestHash)
          ? { kind: "existing", state: publicAccessRecord(existing) }
          : { kind: "idempotency_conflict" };
      }
      if (input.matchedTotpCounter === null) {
        await client.query("ROLLBACK");
        return { kind: "totp_replayed" };
      }

      const stateResult = await client.query<PublicAccessRow>(
        `SELECT
           audit_event_id, changed_at, publicly_enabled, reason, request_id, revision
         FROM public_access_control WHERE singleton_id = 1 FOR UPDATE`,
      );
      const stateRow = stateResult.rows[0];
      if (stateRow === undefined) {
        throw new Error("The public access control singleton is missing");
      }
      const current = publicAccessRecord(stateRow);
      if (current.revision !== input.expectedRevision) {
        await client.query("COMMIT");
        return { current, kind: "revision_conflict" };
      }
      const targetEnabled = input.action === "resume";
      if (current.publiclyEnabled === targetEnabled) {
        await client.query("COMMIT");
        return { kind: "invalid_state" };
      }
      const accepted = await client.query(
        `UPDATE admin_operator_accounts
            SET last_accepted_totp_counter = $1, updated_at = $2
          WHERE account_id = $3
            AND credential_revision = $4
            AND last_accepted_totp_counter < $1`,
        [input.matchedTotpCounter, input.changedAt, input.accountId, input.credentialRevision],
      );
      if (accepted.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { kind: "totp_replayed" };
      }
      const nextRevision = current.revision + 1;
      // The FK makes the control state impossible to commit without its append-only audit event.
      await insertSecurityEvent(client, input.event);
      const changed = await client.query<PublicAccessRow>(
        `UPDATE public_access_control
            SET publicly_enabled = $1,
                revision = $2,
                changed_at = $3,
                changed_by = $4,
                reason = $5,
                request_id = $6,
                audit_event_id = $7
          WHERE singleton_id = 1
         RETURNING
           audit_event_id, changed_at, publicly_enabled, reason, request_id, revision`,
        [
          targetEnabled,
          nextRevision,
          input.changedAt,
          input.accountId,
          input.reason,
          input.requestId,
          input.event.eventId,
        ],
      );
      const changedRow = changed.rows[0];
      if (changedRow === undefined) {
        throw new Error("Public access control update did not return the changed state");
      }
      await client.query(
        `INSERT INTO admin_emergency_idempotency (
           account_id, action, idempotency_key, request_hash, resulting_revision,
           publicly_enabled, resulting_changed_at, resulting_reason,
           resulting_request_id, resulting_audit_event_id, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $7)`,
        [
          input.accountId,
          input.action,
          input.idempotencyKey,
          input.requestHash,
          nextRevision,
          targetEnabled,
          input.changedAt,
          input.reason,
          input.requestId,
          input.event.eventId,
        ],
      );
      await client.query("COMMIT");
      return { kind: "applied", state: publicAccessRecord(changedRow) };
    } catch (error) {
      await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }
}
