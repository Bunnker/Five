import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HmacSecretDigester,
  NodeScryptPasswordHasher,
  SystemAdminAuthRandom,
} from "./admin-auth.crypto";
import { AdminAuthService } from "./admin-auth.service";
import { PostgresAdminSecurityStore } from "./postgres-admin-security.store";

const databaseUrl = process.env.FIVE_ADMIN_PASSWORD_MIGRATION_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;
const migrationOptions = {
  databaseUrl: databaseUrl!,
  dir: resolve(process.cwd(), "migrations"),
  log: () => undefined,
  migrationsTable: "pgmigrations",
} as const;

describeDatabase("password-only administrator migration", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
  });

  afterAll(async () => pool.end());

  it("supports an empty up/down/up cycle, preserves old password login, and refuses an unsafe down", async () => {
    const { runner } = await import("node-pg-migrate");
    await runner({ ...migrationOptions, direction: "up" });

    const nullableAfterUp = await pool.query<{ is_nullable: string }>(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'admin_operator_accounts'
          AND column_name = 'totp_ciphertext'`,
    );
    expect(nullableAfterUp.rows).toEqual([{ is_nullable: "YES" }]);

    const appliedFromPasswordOnly = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pgmigrations WHERE name >= '000014_'",
    );
    const rollbackCount = Number(appliedFromPasswordOnly.rows[0]?.count ?? "0");
    expect(rollbackCount).toBeGreaterThanOrEqual(1);

    // Roll back 000014 and every installed successor so this keeps exercising
    // the password-only migration itself when later migrations are appended.
    await runner({ ...migrationOptions, count: rollbackCount, direction: "down" });
    const requiredAfterDown = await pool.query<{ is_nullable: string }>(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'admin_operator_accounts'
          AND column_name = 'totp_ciphertext'`,
    );
    expect(requiredAfterDown.rows).toEqual([{ is_nullable: "NO" }]);
    await runner({ ...migrationOptions, count: rollbackCount, direction: "up" });
    await runner({ ...migrationOptions, count: rollbackCount, direction: "down" });

    const passwordHasher = new NodeScryptPasswordHasher({
      blockSize: 8,
      cost: 1_024,
      parallelization: 1,
    });
    const legacyPasswordHash = await passwordHasher.hash("12345678");
    await pool.query(
      `INSERT INTO admin_operator_accounts (
         singleton_id, account_id, username, password_hash,
         totp_ciphertext, totp_initialization_vector, totp_authentication_tag,
         totp_key_version, totp_aad, last_accepted_totp_counter,
         credential_revision, created_at, updated_at
       ) VALUES (
         1, 'legacy-admin', 'admin', $1,
         $2, $3, $4, 1, 'legacy-totp-aad', 42,
         1, $5, $5
       )`,
      [
        legacyPasswordHash,
        Buffer.from("legacy-ciphertext"),
        Buffer.alloc(12, 1),
        Buffer.alloc(16, 2),
        new Date("2026-08-06T09:00:00.000Z"),
      ],
    );
    await runner({ ...migrationOptions, count: rollbackCount, direction: "up" });

    const auth = new AdminAuthService(
      new PostgresAdminSecurityStore(pool),
      passwordHasher,
      new HmacSecretDigester(randomBytes(32)),
      new SystemAdminAuthRandom(),
      { now: () => new Date("2026-08-06T10:00:00.000Z") },
    );
    const context = {
      requestId: "legacy-password-login-0001",
      source: "203.0.113.99",
      userAgent: null,
    };
    const permit = await auth.preflight("login", context);
    await expect(
      auth.login({ password: "12345678", permit, username: "admin" }),
    ).resolves.toMatchObject({ kind: "authenticated" });

    await pool.query(
      `UPDATE admin_operator_accounts
          SET totp_ciphertext = NULL,
              totp_initialization_vector = NULL,
              totp_authentication_tag = NULL,
              totp_key_version = NULL,
              totp_aad = NULL,
              last_accepted_totp_counter = NULL
        WHERE account_id = 'legacy-admin'`,
    );
    await expect(
      runner({ ...migrationOptions, count: rollbackCount, direction: "down" }),
    ).rejects.toThrow(/Cannot roll back password-only administrator accounts/u);
    const preserved = await pool.query<{
      credential_revision: string;
      totp_ciphertext: Buffer | null;
    }>(
      `SELECT credential_revision, totp_ciphertext
         FROM admin_operator_accounts
        WHERE account_id = 'legacy-admin'`,
    );
    expect(preserved.rows).toEqual([{ credential_revision: "1", totp_ciphertext: null }]);
  });
});
