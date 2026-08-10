import { randomBytes, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HmacSecretDigester,
  NodeScryptPasswordHasher,
  SystemAdminAuthRandom,
} from "./admin-auth.crypto";
import { AdminAuthService } from "./admin-auth.service";
import { PostgresAdminSecurityStore } from "./postgres-admin-security.store";

const databaseUrl = process.env.FIVE_ADMIN_SECURITY_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

class FixedClock {
  constructor(private readonly value: Date) {}

  now(): Date {
    return new Date(this.value);
  }
}

describeDatabase("password-only PostgreSQL administrator authentication", () => {
  let pool: Pool;
  let store: PostgresAdminSecurityStore;
  let auth: AdminAuthService;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 12 });
    store = new PostgresAdminSecurityStore(pool);
    auth = new AdminAuthService(
      store,
      new NodeScryptPasswordHasher({ blockSize: 8, cost: 1_024, parallelization: 1 }),
      new HmacSecretDigester(randomBytes(32)),
      new SystemAdminAuthRandom(),
      new FixedClock(new Date("2026-08-06T10:00:00.000Z")),
    );
  });

  afterAll(async () => pool.end());

  it("bootstraps without TOTP data and resets the password, sessions, revision, and audit atomically", async () => {
    const context = (requestId: string) => ({
      requestId,
      source: "203.0.113.42",
      userAgent: "Mozilla/5.0 Macintosh Version/18.0 Safari/605.1.15",
    });
    const bootstrap = await auth.bootstrapAccount({
      context: context("password-bootstrap-0001"),
      password: "12345678",
      username: "admin",
    });
    expect(bootstrap).toMatchObject({ kind: "created" });
    if (bootstrap.kind !== "created") return;

    const storedAccount = await pool.query<{
      credential_revision: string;
      last_accepted_totp_counter: string | null;
      totp_aad: string | null;
      totp_authentication_tag: Buffer | null;
      totp_ciphertext: Buffer | null;
      totp_initialization_vector: Buffer | null;
      totp_key_version: number | null;
    }>(
      `SELECT credential_revision, last_accepted_totp_counter, totp_aad,
              totp_authentication_tag, totp_ciphertext, totp_initialization_vector,
              totp_key_version
         FROM admin_operator_accounts
        WHERE account_id = $1`,
      [bootstrap.accountId],
    );
    expect(storedAccount.rows).toEqual([
      {
        credential_revision: "1",
        last_accepted_totp_counter: null,
        totp_aad: null,
        totp_authentication_tag: null,
        totp_ciphertext: null,
        totp_initialization_vector: null,
        totp_key_version: null,
      },
    ]);
    const recoveryCodeCount = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM admin_recovery_codes",
    );
    expect(recoveryCodeCount.rows[0]?.count).toBe("0");

    const permit = await auth.preflight("login", context("password-login-before-reset-0001"));
    const login = await auth.login({ password: "12345678", permit, username: "admin" });
    expect(login).toMatchObject({ credentialRevision: 1, kind: "authenticated" });
    if (login.kind !== "authenticated") return;
    await expect(auth.getSession(login.sessionToken)).resolves.not.toBeNull();

    await expect(
      auth.offlineReset({
        context: context("password-reset-0001"),
        newPassword: "87654321",
        username: "admin",
      }),
    ).resolves.toEqual({ kind: "completed" });
    await expect(auth.getSession(login.sessionToken)).resolves.toBeNull();

    const oldPermit = await auth.preflight("login", context("password-login-old-0001"));
    await expect(
      auth.login({ password: "12345678", permit: oldPermit, username: "admin" }),
    ).resolves.toEqual({ kind: "invalid" });
    const newPermit = await auth.preflight("login", context("password-login-new-0001"));
    await expect(
      auth.login({ password: "87654321", permit: newPermit, username: "admin" }),
    ).resolves.toMatchObject({ credentialRevision: 2, kind: "authenticated" });

    const committed = await pool.query<{
      credential_revision: string;
      reset_events: string;
      revoked_sessions: string;
    }>(
      `SELECT
         account.credential_revision,
         (
           SELECT count(*)::text FROM admin_security_events
            WHERE account_id = account.account_id
              AND event_type = 'account_offline_reset'
              AND outcome = 'success'
         ) AS reset_events,
         (
           SELECT count(*)::text FROM admin_sessions
            WHERE account_id = account.account_id AND revoked_at IS NOT NULL
         ) AS revoked_sessions
       FROM admin_operator_accounts account
       WHERE account.account_id = $1`,
      [bootstrap.accountId],
    );
    expect(committed.rows).toEqual([
      { credential_revision: "2", reset_events: "1", revoked_sessions: "1" },
    ]);

    await expect(
      pool.query(
        "UPDATE admin_security_events SET reason = 'tampered' WHERE event_type = 'account_offline_reset'",
      ),
    ).rejects.toThrow(/append-only/u);
  });

  it("atomically enforces one fixed PostgreSQL login rate-limit bucket across callers", async () => {
    const identityDigest = randomBytes(32);
    const now = new Date("2026-08-06T10:01:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.consumeRateLimit({
          action: "login",
          capacity: 5,
          dimension: "source",
          identityDigest,
          now,
          requestId: `rate-limit-${randomUUID()}-${index}`,
          windowSeconds: 15 * 60,
        }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(3);
  });
});
