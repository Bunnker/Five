import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { adminSecurityCryptoFromEnvironment } from "./admin-auth.configuration";
import { NodeScryptPasswordHasher, SystemAdminAuthRandom } from "./admin-auth.crypto";
import { AdminAuthService } from "./admin-auth.service";
import type {
  AdminAccountRecord,
  AdminSecurityStore,
  ApplyEmergencyControlInput,
  ApplyEmergencyControlResult,
  AuthenticateSessionInput,
  CreateAdminAccountInput,
  CreatePasswordSessionInput,
  OfflineResetInput,
  PublicAccessControlRecord,
  RevokeAllSessionsInput,
  RevokeSessionInput,
  SecurityEventInput,
  SecurityEventRecord,
  StoredSessionPrincipal,
} from "./admin-auth.store";

class PasswordOnlyMemoryStore implements AdminSecurityStore {
  account: AdminAccountRecord | null = null;
  readonly events: SecurityEventInput[] = [];
  private readonly sessions = new Map<string, StoredSessionPrincipal>();

  async appendSecurityEvent(event: SecurityEventInput): Promise<void> {
    this.events.push(event);
  }

  async applyEmergencyControl(
    input: ApplyEmergencyControlInput,
  ): Promise<ApplyEmergencyControlResult> {
    void input;
    return { kind: "invalid_state" };
  }

  async authenticateSession(
    input: AuthenticateSessionInput,
  ): Promise<StoredSessionPrincipal | null> {
    const session = this.sessions.get(input.sessionTokenDigest.toString("base64url")) ?? null;
    return session?.credentialRevision === this.account?.credentialRevision ? session : null;
  }

  async consumeRateLimit(): Promise<{ readonly allowed: true }> {
    return { allowed: true };
  }

  async createAccount(input: CreateAdminAccountInput): Promise<"already_initialized" | "created"> {
    if (this.account !== null) return "already_initialized";
    this.account = {
      accountId: input.accountId,
      credentialRevision: 1,
      passwordHash: input.passwordHash,
      username: input.username,
    };
    this.events.push(input.event);
    return "created";
  }

  async createPasswordSession(input: CreatePasswordSessionInput): Promise<"created" | "invalid"> {
    if (
      this.account?.accountId !== input.accountId ||
      this.account.credentialRevision !== input.credentialRevision
    ) {
      return "invalid";
    }
    this.sessions.set(input.sessionTokenDigest.toString("base64url"), {
      absoluteExpiresAt: input.absoluteExpiresAt,
      accountId: input.accountId,
      credentialRevision: input.credentialRevision,
      idleExpiresAt: input.idleExpiresAt,
      issuedAt: input.createdAt,
      sessionTokenDigest: input.sessionTokenDigest,
      username: this.account.username,
    });
    this.events.push(input.event);
    return "created";
  }

  async findAccountById(accountId: string): Promise<AdminAccountRecord | null> {
    return this.account?.accountId === accountId ? this.account : null;
  }

  async findAccountByUsername(username: string): Promise<AdminAccountRecord | null> {
    return this.account?.username === username ? this.account : null;
  }

  async findPasswordVerification(username: string) {
    return {
      account: this.account?.username === username ? this.account : null,
      passwordHash: this.account?.passwordHash ?? null,
    };
  }

  async getPublicAccessControl(): Promise<PublicAccessControlRecord> {
    return {
      auditEventId: null,
      changedAt: new Date("2026-08-06T10:00:00.000Z"),
      publiclyEnabled: true,
      reason: null,
      requestId: null,
      revision: 1,
    };
  }

  async isInitialized(): Promise<boolean> {
    return this.account !== null;
  }

  async listSecurityEvents(
    accountId: string,
    limit: number,
  ): Promise<readonly SecurityEventRecord[]> {
    return this.events
      .filter((event) => event.accountId === null || event.accountId === accountId)
      .slice(0, limit)
      .map((event) => ({
        accountId: event.accountId,
        eventId: event.eventId,
        eventType: event.eventType,
        metadata: event.metadata ?? {},
        occurredAt: event.occurredAt,
        outcome: event.outcome,
        reason: event.reason ?? null,
        requestId: event.requestId,
        sourceFingerprint: event.sourceFingerprint.toString("base64url"),
        userAgentSummary: event.userAgentSummary,
      }));
  }

  async offlineReset(input: OfflineResetInput): Promise<"completed" | "invalid"> {
    if (
      this.account?.accountId !== input.accountId ||
      this.account.credentialRevision !== input.expectedCredentialRevision
    ) {
      return "invalid";
    }
    this.account = {
      ...this.account,
      credentialRevision: this.account.credentialRevision + 1,
      passwordHash: input.passwordHash,
    };
    this.sessions.clear();
    this.events.push(input.event);
    return "completed";
  }

  async revokeAllSessions(input: RevokeAllSessionsInput): Promise<boolean> {
    if (this.account?.accountId !== input.accountId) return false;
    this.sessions.clear();
    this.events.push(input.event);
    return true;
  }

  async revokeSession(input: RevokeSessionInput): Promise<boolean> {
    const deleted = this.sessions.delete(input.sessionTokenDigest.toString("base64url"));
    if (deleted) this.events.push(input.event);
    return deleted;
  }
}

describe("password-only administrator credentials", () => {
  it("bootstraps, logs in, and atomically invalidates the old password and session on reset", async () => {
    const store = new PasswordOnlyMemoryStore();
    const { digester } = adminSecurityCryptoFromEnvironment({
      FIVE_ADMIN_HMAC_KEY_BASE64: randomBytes(32).toString("base64"),
    });
    const auth = new AdminAuthService(
      store,
      new NodeScryptPasswordHasher({ blockSize: 8, cost: 1_024, parallelization: 1 }),
      digester,
      new SystemAdminAuthRandom(),
      { now: () => new Date("2026-08-06T10:00:00.000Z") },
    );
    const context = {
      requestId: "offline-password-only-0001",
      source: "offline-console",
      userAgent: null,
    };

    await expect(
      auth.bootstrapAccount({ context, password: "12345678", username: "admin" }),
    ).resolves.toMatchObject({ kind: "created" });
    const firstPermit = await auth.preflight("login", context);
    const firstLogin = await auth.login({
      password: "12345678",
      permit: firstPermit,
      username: "admin",
    });
    expect(firstLogin).toMatchObject({ credentialRevision: 1, kind: "authenticated" });
    if (firstLogin.kind !== "authenticated") return;
    await expect(auth.getSession(firstLogin.sessionToken)).resolves.not.toBeNull();

    await expect(
      auth.offlineReset({ context, newPassword: "87654321", username: "admin" }),
    ).resolves.toEqual({ kind: "completed" });
    await expect(auth.getSession(firstLogin.sessionToken)).resolves.toBeNull();

    const oldPasswordPermit = await auth.preflight("login", context);
    await expect(
      auth.login({ password: "12345678", permit: oldPasswordPermit, username: "admin" }),
    ).resolves.toEqual({ kind: "invalid" });
    const newPasswordPermit = await auth.preflight("login", context);
    await expect(
      auth.login({ password: "87654321", permit: newPasswordPermit, username: "admin" }),
    ).resolves.toMatchObject({ credentialRevision: 2, kind: "authenticated" });
    expect(store.events.at(-2)?.eventType).toBe("login_password_failed");
    expect(store.events.some((event) => event.eventType === "account_offline_reset")).toBe(true);
  });
});
