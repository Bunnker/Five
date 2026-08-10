import type { Pool, PoolClient } from "pg";

import type {
  AdminAccountRecord,
  AdminSecurityStore,
  ApplyEmergencyControlInput,
  ApplyEmergencyControlResult,
  AuthenticateSessionInput,
  CreateAdminAccountInput,
  CreatePasswordSessionInput,
  OfflineResetInput,
  PasswordVerificationLookup,
  PublicAccessControlRecord,
  RateLimitAttemptInput,
  RateLimitAttemptResult,
  RevokeAllSessionsInput,
  RevokeSessionInput,
  SecurityEventInput,
  SecurityEventRecord,
  StoredSessionPrincipal,
} from "./admin-auth.store";

interface AccountRow {
  account_id: string;
  credential_revision: string;
  password_hash: string;
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
  credential_revision
`;

function safeInteger(value: string, field: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${field} exceeded the JavaScript safe-integer range`);
  }
  return result;
}

function accountRecord(row: AccountRow): AdminAccountRecord {
  return {
    accountId: row.account_id,
    credentialRevision: safeInteger(row.credential_revision, "credential_revision"),
    passwordHash: row.password_hash,
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
           singleton_id, account_id, username, password_hash, credential_revision,
           created_at, updated_at
         ) VALUES (1, $1, $2, $3, 1, $4, $4)
         ON CONFLICT (singleton_id) DO NOTHING
         RETURNING account_id`,
        [input.accountId, input.username, input.passwordHash, input.createdAt],
      );
      if (created.rowCount !== 1) {
        await client.query("COMMIT");
        return "already_initialized";
      }
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

  async createPasswordSession(input: CreatePasswordSessionInput): Promise<"created" | "invalid"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query(
        `SELECT account_id
           FROM admin_operator_accounts
          WHERE account_id = $1 AND credential_revision = $2
          FOR UPDATE`,
        [input.accountId, input.credentialRevision],
      );
      if (account.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "invalid";
      }
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
                credential_revision = $2,
                updated_at = $3
          WHERE account_id = $4 AND credential_revision = $5`,
        [
          input.passwordHash,
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
      const account = await client.query(
        `SELECT account_id FROM admin_operator_accounts
          WHERE account_id = $1 AND credential_revision = $2
          FOR UPDATE`,
        [input.accountId, input.credentialRevision],
      );
      if (account.rowCount !== 1) {
        await client.query("ROLLBACK");
        return { kind: "invalid_state" };
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
