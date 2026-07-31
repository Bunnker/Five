import { randomBytes, randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AesGcmTotpSecretCipher,
  HmacSecretDigester,
  NodeScryptPasswordHasher,
  SystemAdminAuthRandom,
  generateTotpCode,
} from "./admin-auth.crypto";
import {
  AdminAuthService,
  EmergencyControlService,
  summarizeAdminUserAgent,
} from "./admin-auth.service";
import type { SecurityEventRecord } from "./admin-auth.store";
import { PostgresAdminSecurityStore } from "./postgres-admin-security.store";

const databaseUrl = process.env.FIVE_ADMIN_SECURITY_TEST_DATABASE_URL;
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

class MutableClock {
  constructor(private value: Date) {}

  advanceMilliseconds(milliseconds: number): void {
    this.value = new Date(this.value.getTime() + milliseconds);
  }

  now(): Date {
    return new Date(this.value);
  }
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of value) {
    const next = alphabet.indexOf(character);
    if (next < 0) {
      throw new Error("Unexpected Base32 character");
    }
    buffer = (buffer << 5) | next;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function codeAt(secret: Buffer, now: Date): string {
  return generateTotpCode(secret, Math.floor(now.getTime() / 30_000));
}

describeDatabase("PostgresAdminSecurityStore through the admin security services", () => {
  let pool: Pool;
  let store: PostgresAdminSecurityStore;
  let auth: AdminAuthService;
  let emergency: EmergencyControlService;
  let clock: MutableClock;
  let cipher: AesGcmTotpSecretCipher;
  let digester: HmacSecretDigester;
  let passwordHasher: NodeScryptPasswordHasher;
  let random: SystemAdminAuthRandom;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 12 });
    store = new PostgresAdminSecurityStore(pool);
    clock = new MutableClock(new Date("2026-07-31T10:00:00.000Z"));
    cipher = new AesGcmTotpSecretCipher({
      activeVersion: 1,
      keys: new Map([[1, randomBytes(32)]]),
    });
    digester = new HmacSecretDigester(randomBytes(32));
    passwordHasher = new NodeScryptPasswordHasher({
      blockSize: 8,
      cost: 1_024,
      parallelization: 1,
    });
    random = new SystemAdminAuthRandom();
    auth = new AdminAuthService(store, passwordHasher, cipher, digester, random, clock);
    emergency = new EmergencyControlService(
      store,
      cipher,
      new SystemAdminAuthRandom(),
      clock,
      auth,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("runs bootstrap, login, recovery, session, emergency, and append-only audit as one secure workflow", async () => {
    const rawUserAgent =
      "Mozilla/5.0 (iPhone15,2; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.7339.122 Mobile/15E148";
    const context = (requestId: string) => ({
      requestId,
      source: "203.0.113.42",
      userAgent: rawUserAgent,
    });
    expect(summarizeAdminUserAgent(rawUserAgent)).toBe("browser=chrome;platform=ios");

    const initialSetup = auth.prepareTotpSetup("operator");
    expect(initialSetup).not.toBeNull();
    if (initialSetup === null) return;
    const initialSecret = Buffer.from(initialSetup.secret);
    const bootstrap = await auth.bootstrapAccount({
      context: context(`bootstrap-${randomUUID()}`),
      password: "InitialPassword!123",
      setup: initialSetup,
      totpCode: codeAt(initialSecret, clock.now()),
      username: "operator",
    });
    expect(bootstrap.kind).toBe("created");
    if (bootstrap.kind !== "created") return;
    expect(bootstrap.recoveryCodes).toHaveLength(10);
    await expect(store.findPasswordVerification("unknown-operator")).resolves.toMatchObject({
      account: null,
      passwordHash: expect.stringContaining("scrypt$v=1$n=1024"),
    });
    expect(
      await auth.bootstrapAccount({
        context: context(`bootstrap-again-${randomUUID()}`),
        password: "AnotherPassword!123",
        setup: initialSetup,
        totpCode: codeAt(initialSecret, clock.now()),
        username: "another",
      }),
    ).toEqual({ kind: "already_initialized" });

    clock.advanceMilliseconds(30_000);
    const loginPermit = await auth.preflight("login", context(`login-password-${randomUUID()}`));
    const passwordChallenge = await auth.beginLogin({
      password: "InitialPassword!123",
      permit: loginPermit,
      username: "OPERATOR",
    });
    expect(passwordChallenge.kind).toBe("challenge");
    if (passwordChallenge.kind !== "challenge") return;
    const totpPermit = await auth.preflight("login_totp", context(`login-totp-${randomUUID()}`));
    const loggedIn = await auth.completeLogin({
      challengeToken: passwordChallenge.challengeToken,
      permit: totpPermit,
      totpCode: codeAt(initialSecret, clock.now()),
    });
    expect(loggedIn).toMatchObject({
      accountId: bootstrap.accountId,
      credentialRevision: 1,
      kind: "authenticated",
      username: "operator",
    });
    if (loggedIn.kind !== "authenticated") return;
    expect(loggedIn.idleExpiresAt.getTime() - loggedIn.issuedAt.getTime()).toBe(30 * 60 * 1_000);
    expect(loggedIn.absoluteExpiresAt.getTime() - loggedIn.issuedAt.getTime()).toBe(
      12 * 60 * 60 * 1_000,
    );
    const fetchedSession = await auth.getSession(loggedIn.sessionToken);
    expect(fetchedSession).toMatchObject({
      accountId: bootstrap.accountId,
      csrfToken: loggedIn.csrfToken,
      username: "operator",
    });
    expect(
      await auth.authenticateSession({
        csrfToken: "wrong-csrf",
        requireCsrf: true,
        sessionToken: loggedIn.sessionToken,
      }),
    ).toBeNull();
    expect(
      await auth.authenticateSession({
        csrfToken: loggedIn.csrfToken,
        requireCsrf: true,
        sessionToken: loggedIn.sessionToken,
      }),
    ).toMatchObject({ csrfToken: loggedIn.csrfToken, username: "operator" });

    const recoveryPermit = await auth.preflight("recovery", context(`recovery-${randomUUID()}`));
    const recovery = await auth.beginRecovery({
      permit: recoveryPermit,
      recoveryCode: bootstrap.recoveryCodes[0] ?? "missing",
      username: "Operator",
    });
    expect(recovery.kind).toBe("challenge");
    if (recovery.kind !== "challenge") return;
    expect(await auth.getSession(loggedIn.sessionToken)).toBeNull();
    const recoveredSecret = decodeBase32(recovery.totpSetup.secretBase32);
    const completionPermit = await auth.preflight("recovery_complete", {
      ...context(`recovery-complete-${randomUUID()}`),
      source: "198.51.100.24",
    });
    const recovered = await auth.completeRecovery({
      challengeToken: recovery.challengeToken,
      newPassword: "RecoveredPassword!456",
      permit: completionPermit,
      totpCode: codeAt(recoveredSecret, clock.now()),
    });
    expect(recovered).toMatchObject({
      kind: "completed",
      recoveryCodes: expect.any(Array),
      session: { accountId: bootstrap.accountId, credentialRevision: 2, username: "operator" },
    });
    if (recovered.kind !== "completed") return;
    expect(recovered.recoveryCodes).toHaveLength(10);
    expect(
      await auth.authenticateSession({
        csrfToken: recovered.session.csrfToken,
        requireCsrf: true,
        sessionToken: recovered.session.sessionToken,
      }),
    ).toMatchObject({ credentialRevision: 2 });

    const replayPermit = await auth.preflight(
      "recovery",
      context(`recovery-replay-${randomUUID()}`),
    );
    await expect(
      auth.beginRecovery({
        permit: replayPermit,
        recoveryCode: bootstrap.recoveryCodes[0] ?? "missing",
        username: "operator",
      }),
    ).resolves.toEqual({ kind: "invalid" });
    const unknownPermit = await auth.preflight(
      "recovery",
      context(`recovery-unknown-${randomUUID()}`),
    );
    await expect(
      auth.beginRecovery({
        permit: unknownPermit,
        recoveryCode: bootstrap.recoveryCodes[1] ?? "missing",
        username: "unknown",
      }),
    ).resolves.toEqual({ kind: "invalid" });

    clock.advanceMilliseconds(30_000);
    const newLoginPermit = await auth.preflight("login", context(`new-login-${randomUUID()}`));
    const newChallenge = await auth.beginLogin({
      password: "RecoveredPassword!456",
      permit: newLoginPermit,
      username: "operator",
    });
    expect(newChallenge.kind).toBe("challenge");
    if (newChallenge.kind !== "challenge") return;
    const newTotpPermit = await auth.preflight("login_totp", context(`new-totp-${randomUUID()}`));
    const newLogin = await auth.completeLogin({
      challengeToken: newChallenge.challengeToken,
      permit: newTotpPermit,
      totpCode: codeAt(recoveredSecret, clock.now()),
    });
    expect(newLogin.kind).toBe("authenticated");
    if (newLogin.kind !== "authenticated") return;

    const pendingPermit = await auth.preflight(
      "login",
      context(`pending-before-logout-${randomUUID()}`),
    );
    const pendingBeforeLogout = await auth.beginLogin({
      password: "RecoveredPassword!456",
      permit: pendingPermit,
      username: "operator",
    });
    expect(pendingBeforeLogout.kind).toBe("challenge");
    if (pendingBeforeLogout.kind !== "challenge") return;

    const revisionBeforeLogoutAll = (await store.findAccountById(bootstrap.accountId))
      ?.credentialRevision;
    const principal = await auth.authenticateSession({
      csrfToken: newLogin.csrfToken,
      requireCsrf: true,
      sessionToken: newLogin.sessionToken,
    });
    expect(principal).not.toBeNull();
    if (principal === null) return;
    expect(
      await auth.logoutAll({ context: context(`logout-all-${randomUUID()}`), principal }),
    ).toBe(true);
    expect((await store.findAccountById(bootstrap.accountId))?.credentialRevision).toBe(
      revisionBeforeLogoutAll,
    );
    expect(await auth.getSession(newLogin.sessionToken)).toBeNull();

    clock.advanceMilliseconds(30_000);
    const invalidatedChallengePermit = await auth.preflight(
      "login_totp",
      context(`invalidated-after-logout-${randomUUID()}`),
    );
    await expect(
      auth.completeLogin({
        challengeToken: pendingBeforeLogout.challengeToken,
        permit: invalidatedChallengePermit,
        totpCode: codeAt(recoveredSecret, clock.now()),
      }),
    ).resolves.toEqual({ kind: "invalid" });

    clock.advanceMilliseconds(30_000);
    const emergencyLoginPermit = await auth.preflight(
      "login",
      context(`emergency-login-${randomUUID()}`),
    );
    const emergencyChallenge = await auth.beginLogin({
      password: "RecoveredPassword!456",
      permit: emergencyLoginPermit,
      username: "operator",
    });
    expect(emergencyChallenge.kind).toBe("challenge");
    if (emergencyChallenge.kind !== "challenge") return;
    const emergencyTotpPermit = await auth.preflight(
      "login_totp",
      context(`emergency-totp-${randomUUID()}`),
    );
    const emergencyLogin = await auth.completeLogin({
      challengeToken: emergencyChallenge.challengeToken,
      permit: emergencyTotpPermit,
      totpCode: codeAt(recoveredSecret, clock.now()),
    });
    expect(emergencyLogin.kind).toBe("authenticated");
    if (emergencyLogin.kind !== "authenticated") return;
    const emergencyPrincipal = await auth.authenticateSession({
      csrfToken: emergencyLogin.csrfToken,
      requireCsrf: true,
      sessionToken: emergencyLogin.sessionToken,
    });
    expect(emergencyPrincipal).not.toBeNull();
    if (emergencyPrincipal === null) return;

    expect(await emergency.getState()).toMatchObject({
      auditEventId: null,
      publiclyEnabled: true,
      revision: 1,
    });
    clock.advanceMilliseconds(30_000);
    const stopInput = {
      action: "stop" as const,
      confirmationPhrase: "停止全部公开内容",
      context: context(`emergency-stop-${randomUUID()}`),
      expectedRevision: 1,
      idempotencyKey: `emergency-stop-${randomUUID()}`,
      principal: emergencyPrincipal,
      reason: "安全复核".repeat(300),
      totpCode: codeAt(recoveredSecret, clock.now()),
    };
    const concurrentStops = await Promise.all([
      emergency.apply(stopInput),
      emergency.apply(stopInput),
    ]);
    expect(concurrentStops.map((result) => result.kind).sort()).toEqual(["applied", "existing"]);
    const stopped = concurrentStops.find((result) => result.kind === "applied");
    expect(stopped).toMatchObject({
      kind: "applied",
      state: { auditEventId: expect.any(String), publiclyEnabled: false, revision: 2 },
    });
    await expect(emergency.apply(stopInput)).resolves.toMatchObject({ kind: "existing" });
    await expect(
      emergency.apply({ ...stopInput, reason: `${stopInput.reason}不同` }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    await expect(
      emergency.apply({
        ...stopInput,
        action: "resume",
        confirmationPhrase: "恢复全部公开内容",
        expectedRevision: 2,
        idempotencyKey: `emergency-resume-replay-${randomUUID()}`,
      }),
    ).resolves.toEqual({ kind: "totp_replayed" });
    clock.advanceMilliseconds(30_000);
    const resumed = await emergency.apply({
      ...stopInput,
      action: "resume",
      confirmationPhrase: "恢复全部公开内容",
      expectedRevision: 2,
      idempotencyKey: `emergency-resume-${randomUUID()}`,
      totpCode: codeAt(recoveredSecret, clock.now()),
    });
    expect(resumed).toMatchObject({
      kind: "applied",
      state: { auditEventId: expect.any(String), publiclyEnabled: true, revision: 3 },
    });
    clock.advanceMilliseconds(60_000);
    await expect(emergency.apply(stopInput)).resolves.toMatchObject({
      kind: "existing",
      state: { publiclyEnabled: false, revision: 2 },
    });

    clock.advanceMilliseconds(30_000);
    const shortSessionAuth = new AdminAuthService(
      store,
      passwordHasher,
      cipher,
      digester,
      random,
      clock,
      {
        absoluteSessionSeconds: 180,
        idleSessionSeconds: 120,
        loginChallengeSeconds: 300,
        recoveryChallengeSeconds: 600,
      },
    );
    const shortPasswordPermit = await shortSessionAuth.preflight(
      "login",
      context(`short-session-login-${randomUUID()}`),
    );
    const shortChallenge = await shortSessionAuth.beginLogin({
      password: "RecoveredPassword!456",
      permit: shortPasswordPermit,
      username: "operator",
    });
    expect(shortChallenge.kind).toBe("challenge");
    if (shortChallenge.kind !== "challenge") return;
    const shortTotpPermit = await shortSessionAuth.preflight(
      "login_totp",
      context(`short-session-totp-${randomUUID()}`),
    );
    const shortLogin = await shortSessionAuth.completeLogin({
      challengeToken: shortChallenge.challengeToken,
      permit: shortTotpPermit,
      totpCode: codeAt(recoveredSecret, clock.now()),
    });
    expect(shortLogin.kind).toBe("authenticated");
    if (shortLogin.kind !== "authenticated") return;
    clock.advanceMilliseconds(100_000);
    const touched = await shortSessionAuth.getSession(shortLogin.sessionToken);
    expect(touched?.idleExpiresAt).toEqual(shortLogin.absoluteExpiresAt);
    clock.advanceMilliseconds(80_000);
    expect(await shortSessionAuth.getSession(shortLogin.sessionToken)).toBeNull();

    clock.advanceMilliseconds(15 * 60 * 1_000);
    const offlineSetup = auth.prepareTotpSetup("OPERATOR");
    expect(offlineSetup).not.toBeNull();
    if (offlineSetup === null) return;
    const offlineSecret = Buffer.from(offlineSetup.secret);
    const offlineReset = await auth.offlineReset({
      context: context(`offline-reset-${randomUUID()}`),
      newPassword: "OfflineResetPassword!789",
      setup: offlineSetup,
      totpCode: codeAt(offlineSecret, clock.now()),
      username: "OPERATOR",
    });
    expect(offlineReset).toMatchObject({
      kind: "completed",
      recoveryCodes: expect.arrayContaining([expect.stringMatching(/^RC-/u)]),
    });
    expect((await store.findAccountById(bootstrap.accountId))?.credentialRevision).toBe(3);
    expect(await auth.getSession(emergencyLogin.sessionToken)).toBeNull();
    clock.advanceMilliseconds(30_000);
    const offlineLoginPermit = await auth.preflight(
      "login",
      context(`offline-login-${randomUUID()}`),
    );
    const offlineChallenge = await auth.beginLogin({
      password: "OfflineResetPassword!789",
      permit: offlineLoginPermit,
      username: "operator",
    });
    expect(offlineChallenge.kind).toBe("challenge");
    if (offlineChallenge.kind !== "challenge") return;
    const offlineTotpPermit = await auth.preflight(
      "login_totp",
      context(`offline-login-totp-${randomUUID()}`),
    );
    await expect(
      auth.completeLogin({
        challengeToken: offlineChallenge.challengeToken,
        permit: offlineTotpPermit,
        totpCode: codeAt(offlineSecret, clock.now()),
      }),
    ).resolves.toMatchObject({ credentialRevision: 3, kind: "authenticated" });
    clock.advanceMilliseconds(30_000);
    const replayRacePasswordPermit = await auth.preflight(
      "login",
      context(`replay-race-password-${randomUUID()}`),
    );
    const replayRaceChallenge = await auth.beginLogin({
      password: "OfflineResetPassword!789",
      permit: replayRacePasswordPermit,
      username: "operator",
    });
    expect(replayRaceChallenge.kind).toBe("challenge");
    if (replayRaceChallenge.kind !== "challenge") return;
    const replayRaceRequestIds = [
      `replay-race-totp-a-${randomUUID()}`,
      `replay-race-totp-b-${randomUUID()}`,
    ] as const;
    const [replayRacePermitA, replayRacePermitB] = await Promise.all([
      auth.preflight("login_totp", context(replayRaceRequestIds[0])),
      auth.preflight("login_totp", context(replayRaceRequestIds[1])),
    ]);
    const replayRaceResults = await Promise.all([
      auth.completeLogin({
        challengeToken: replayRaceChallenge.challengeToken,
        permit: replayRacePermitA,
        totpCode: codeAt(offlineSecret, clock.now()),
      }),
      auth.completeLogin({
        challengeToken: replayRaceChallenge.challengeToken,
        permit: replayRacePermitB,
        totpCode: codeAt(offlineSecret, clock.now()),
      }),
    ]);
    expect(replayRaceResults.map((result) => result.kind).sort()).toEqual([
      "authenticated",
      "invalid",
    ]);
    const unknownLoginPermit = await auth.preflight(
      "login",
      context(`unknown-login-${randomUUID()}`),
    );
    await expect(
      auth.beginLogin({
        password: "NotThePassword!123",
        permit: unknownLoginPermit,
        username: "unknown",
      }),
    ).resolves.toEqual({ kind: "invalid" });
    const sourceLimitAttempts = [];
    for (let index = 0; index < 12; index += 1) {
      sourceLimitAttempts.push(
        await auth.preflight("login", context(`source-limit-${index}-${randomUUID()}`)),
      );
    }
    expect(sourceLimitAttempts.some((permit) => !permit.result.allowed)).toBe(true);

    await auth.recordCsrfRejected({
      accountId: bootstrap.accountId,
      context: context(`csrf-rejected-${randomUUID()}`),
      reasonCategory: "origin_untrusted",
    });
    const invalidPage = await auth.listSecurityEvents(bootstrap.accountId, {
      cursor: "tampered.invalid",
      limit: 2,
    });
    expect(invalidPage).toEqual({ kind: "invalid_cursor" });
    const events: SecurityEventRecord[] = [];
    let cursor: string | null = null;
    do {
      const page = await auth.listSecurityEvents(bootstrap.accountId, { cursor, limit: 2 });
      expect(page.kind).toBe("page");
      if (page.kind !== "page") return;
      events.push(...page.items);
      cursor = page.nextCursor;
      if (cursor !== null) expect(cursor.length).toBeLessThanOrEqual(256);
    } while (cursor !== null);
    expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
    expect(events.some((event) => event.eventType === "csrf_rejected")).toBe(true);
    expect(events.some((event) => event.eventType === "public_access_stopped")).toBe(true);
    expect(
      events.some(
        (event) => event.accountId === null && event.eventType === "recovery_code_failed",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) => event.accountId === null && event.eventType === "login_password_failed",
      ),
    ).toBe(true);
    expect(events.some((event) => event.eventType === "login_source_rate_limited")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.eventType === "login_totp_failed" &&
          replayRaceRequestIds.includes(event.requestId as (typeof replayRaceRequestIds)[number]),
      ),
    ).toBe(true);
    expect(events.every((event) => event.userAgentSummary === "browser=chrome;platform=ios")).toBe(
      true,
    );
    expect(JSON.stringify(events)).not.toContain("iPhone15,2");
    expect(JSON.stringify(events)).not.toContain("203.0.113.42");
    expect(
      events.every((event) => Buffer.from(event.sourceFingerprint, "base64url").length === 32),
    ).toBe(true);

    const retention = await pool.query<{ retained: boolean }>(
      `SELECT bool_and(retain_until >= occurred_at + interval '365 days') AS retained
       FROM admin_security_events`,
    );
    expect(retention.rows[0]?.retained).toBe(true);
    await expect(
      pool.query("UPDATE admin_security_events SET outcome = 'success' WHERE event_id = $1", [
        events[0]?.eventId,
      ]),
    ).rejects.toThrow("admin_security_events is append-only");
  });

  it("atomically enforces one fixed PostgreSQL rate-limit bucket across concurrent callers", async () => {
    const identityDigest = randomBytes(32);
    const now = new Date("2026-07-31T11:59:41.123Z");
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        store.consumeRateLimit({
          action: "login",
          capacity: 3,
          dimension: "source",
          identityDigest,
          now,
          requestId: `concurrent-rate-${index}-${randomUUID()}`,
          windowSeconds: 60,
        }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    expect(results.filter((result) => !result.allowed)).toHaveLength(9);
    const persisted = await pool.query<{ attempt_count: number }>(
      `SELECT attempt_count FROM admin_auth_rate_limit_windows
       WHERE action = 'login' AND dimension = 'source' AND identity_digest = $1`,
      [identityDigest],
    );
    expect(persisted.rows).toEqual([{ attempt_count: 12 }]);
  });
});
