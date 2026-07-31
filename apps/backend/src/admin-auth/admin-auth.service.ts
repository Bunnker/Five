import { createHash, timingSafeEqual } from "node:crypto";

import {
  type AesGcmTotpSecretCipher,
  type HmacSecretDigester,
  type NodeScryptPasswordHasher,
  type SystemAdminAuthRandom,
  matchTotpCounter,
  type TotpSetup,
} from "./admin-auth.crypto";
import type {
  AdminAuthAction,
  AdminRequestEvidence,
  AdminSecurityStore,
  ApplyEmergencyControlResult,
  EmergencyAction,
  PublicAccessControlRecord,
  SecurityEventInput,
  SecurityEventRecord,
  StoredSessionPrincipal,
} from "./admin-auth.store";

export interface AdminAuthClock {
  now(): Date;
}

export interface AdminAuthServiceOptions {
  readonly absoluteSessionSeconds: number;
  readonly idleSessionSeconds: number;
  readonly loginChallengeSeconds: number;
  readonly recoveryChallengeSeconds: number;
}

const DEFAULT_OPTIONS: AdminAuthServiceOptions = {
  absoluteSessionSeconds: 12 * 60 * 60,
  idleSessionSeconds: 30 * 60,
  loginChallengeSeconds: 5 * 60,
  recoveryChallengeSeconds: 10 * 60,
};

const RATE_LIMITS = {
  login: {
    account: { capacity: 5, windowSeconds: 15 * 60 },
    source: { capacity: 10, windowSeconds: 15 * 60 },
  },
  login_totp: {
    account: { capacity: 5, windowSeconds: 15 * 60 },
    source: { capacity: 10, windowSeconds: 15 * 60 },
  },
  recovery: {
    account: { capacity: 3, windowSeconds: 60 * 60 },
    source: { capacity: 5, windowSeconds: 60 * 60 },
  },
  recovery_complete: {
    account: { capacity: 3, windowSeconds: 60 * 60 },
    source: { capacity: 5, windowSeconds: 60 * 60 },
  },
} as const;

const FAKE_PASSWORD_HASH =
  "scrypt$v=1$n=32768$r=8$p=1$Zml2ZS1hZG1pbi1mYWtlIQ$AZPZWN4S9ZYnZGBs2M9L4ryzRQufvEAc06Ik_ze2J6M$end";
const RETENTION_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

function plusSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1_000);
}

function normalizeUsername(value: string): string | null {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,63}$/u.test(normalized) ? normalized : null;
}

export function summarizeAdminUserAgent(value: string | null): string {
  const userAgent = value ?? "";
  const browser = /MicroMessenger/iu.test(userAgent)
    ? "wechat"
    : /(?:Chrome|CriOS)\//iu.test(userAgent)
      ? "chrome"
      : /Safari\//iu.test(userAgent) && /Version\//iu.test(userAgent)
        ? "safari"
        : "other";
  const platform = /(?:iPhone|iPad|iPod)/iu.test(userAgent)
    ? "ios"
    : /Android/iu.test(userAgent)
      ? "android"
      : /Macintosh|Mac OS X/iu.test(userAgent)
        ? "macos"
        : /Windows/iu.test(userAgent)
          ? "windows"
          : "other";
  return `browser=${browser};platform=${platform}`;
}

function equalDigest(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function totpCounterAt(now: Date): number {
  return Math.floor(now.getTime() / 30_000);
}

function validReason(reason: string): boolean {
  const length = Array.from(reason.trim()).length;
  return length >= 1 && length <= 2_000;
}

export interface AdminRequestContextInput {
  readonly requestId: string;
  readonly source: string;
  readonly userAgent: string | null;
}

export interface SessionPrincipal extends StoredSessionPrincipal {
  readonly csrfToken: string;
}

export interface AdminSourceRateLimitPermit {
  readonly action: AdminAuthAction;
  readonly evidence: AdminRequestEvidence;
  readonly result:
    { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };
}

export type BeginLoginResult =
  | {
      readonly challengeExpiresAt: Date;
      readonly challengeToken: string;
      readonly kind: "challenge";
    }
  | { readonly kind: "invalid" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number };

export type CompleteLoginResult =
  | {
      readonly absoluteExpiresAt: Date;
      readonly accountId: string;
      readonly credentialRevision: number;
      readonly csrfToken: string;
      readonly idleExpiresAt: Date;
      readonly issuedAt: Date;
      readonly kind: "authenticated";
      readonly sessionToken: string;
      readonly username: string;
    }
  | { readonly kind: "invalid" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number };

export type BeginRecoveryResult =
  | {
      readonly challengeExpiresAt: Date;
      readonly challengeToken: string;
      readonly kind: "challenge";
      readonly totpSetup: Omit<TotpSetup, "secret">;
    }
  | { readonly kind: "invalid" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number };

export type CompleteRecoveryResult =
  | {
      readonly kind: "completed";
      readonly recoveryCodes: readonly string[];
      readonly session: {
        readonly absoluteExpiresAt: Date;
        readonly accountId: string;
        readonly credentialRevision: number;
        readonly csrfToken: string;
        readonly idleExpiresAt: Date;
        readonly issuedAt: Date;
        readonly sessionToken: string;
        readonly username: string;
      };
    }
  | { readonly kind: "invalid" }
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number };

export type OfflineResetResult =
  | { readonly kind: "completed"; readonly recoveryCodes: readonly string[] }
  | { readonly kind: "invalid" };

export type SecurityEventsPageResult =
  | {
      readonly items: readonly SecurityEventRecord[];
      readonly kind: "page";
      readonly nextCursor: string | null;
    }
  | { readonly kind: "invalid_cursor" };

export type BootstrapResult =
  | {
      readonly accountId: string;
      readonly kind: "created";
      readonly recoveryCodes: readonly string[];
    }
  | { readonly kind: "already_initialized" }
  | { readonly kind: "invalid" };

export class AdminAuthService {
  constructor(
    private readonly store: AdminSecurityStore,
    private readonly passwordHasher: NodeScryptPasswordHasher,
    private readonly secretCipher: AesGcmTotpSecretCipher,
    private readonly digester: HmacSecretDigester,
    private readonly random: SystemAdminAuthRandom,
    private readonly clock: AdminAuthClock,
    private readonly options: AdminAuthServiceOptions = DEFAULT_OPTIONS,
  ) {}

  prepareTotpSetup(username: string): TotpSetup | null {
    const normalized = normalizeUsername(username);
    return normalized === null ? null : this.random.totpSetup(normalized);
  }

  requestEvidence(input: AdminRequestContextInput): AdminRequestEvidence {
    return {
      requestId: input.requestId.slice(0, 128),
      sourceFingerprint: this.digester.digest("source-fingerprint", input.source),
      userAgentSummary: summarizeAdminUserAgent(input.userAgent),
    };
  }

  async preflight(
    action: AdminAuthAction,
    context: AdminRequestContextInput,
  ): Promise<AdminSourceRateLimitPermit> {
    const evidence = this.requestEvidence(context);
    const policy = RATE_LIMITS[action].source;
    const result = await this.store.consumeRateLimit({
      action,
      capacity: policy.capacity,
      dimension: "source",
      identityDigest: evidence.sourceFingerprint,
      now: this.clock.now(),
      requestId: evidence.requestId,
      windowSeconds: policy.windowSeconds,
    });
    if (!result.allowed) {
      await this.store.appendSecurityEvent(
        this.event(`${action}_source_rate_limited`, "denied", null, evidence, null),
      );
    }
    return { action, evidence, result };
  }

  async bootstrapAccount(input: {
    readonly context: AdminRequestContextInput;
    readonly password: string;
    readonly setup: TotpSetup;
    readonly totpCode: string;
    readonly username: string;
  }): Promise<BootstrapResult> {
    const username = normalizeUsername(input.username);
    const now = this.clock.now();
    const matchedCounter = matchTotpCounter(
      input.setup.secret,
      input.totpCode,
      totpCounterAt(now),
      1,
    );
    if (username === null || matchedCounter === null) {
      return { kind: "invalid" };
    }
    let passwordHash: string;
    try {
      passwordHash = await this.passwordHasher.hash(input.password);
    } catch {
      return { kind: "invalid" };
    }
    const accountId = this.random.identifier("admin");
    const recoveryCodes = this.random.recoveryCodes();
    const evidence = this.requestEvidence(input.context);
    const created = await this.store.createAccount({
      accountId,
      createdAt: now,
      event: this.event("account_bootstrapped", "success", accountId, evidence, null, now),
      lastAcceptedTotpCounter: matchedCounter,
      passwordHash,
      recoveryCodes: this.recoveryCodeRecords(recoveryCodes),
      totpSecret: this.secretCipher.encrypt(input.setup.secret, accountId, 1),
      username,
    });
    return created === "created"
      ? { accountId, kind: "created", recoveryCodes }
      : { kind: "already_initialized" };
  }

  async beginLogin(input: {
    readonly password: string;
    readonly permit: AdminSourceRateLimitPermit;
    readonly username: string;
  }): Promise<BeginLoginResult> {
    if (input.permit.action !== "login") {
      throw new Error("A login attempt requires a login source-rate-limit permit");
    }
    if (!input.permit.result.allowed) {
      return { kind: "rate_limited", retryAfterSeconds: input.permit.result.retryAfterSeconds };
    }
    const username = normalizeUsername(input.username);
    const accountIdentity = username ?? "invalid-account-identifier";
    const accountRateLimit = await this.accountRateLimit(
      "login",
      accountIdentity,
      input.permit.evidence.requestId,
    );
    if (!accountRateLimit.allowed) {
      await this.store.appendSecurityEvent(
        this.event("login_account_rate_limited", "denied", null, input.permit.evidence, null),
      );
      return { kind: "rate_limited", retryAfterSeconds: accountRateLimit.retryAfterSeconds };
    }

    const verification = await this.store.findPasswordVerification(
      username ?? "invalid-account-identifier",
    );
    const account = verification.account;
    const verified = await this.passwordHasher.verify(
      input.password,
      verification.passwordHash ?? FAKE_PASSWORD_HASH,
    );
    if (!verified || account === null) {
      await this.store.appendSecurityEvent(
        this.event("login_password_failed", "failure", null, input.permit.evidence, null),
      );
      return { kind: "invalid" };
    }

    const now = this.clock.now();
    const challengeToken = this.random.opaqueToken();
    const challengeExpiresAt = plusSeconds(now, this.options.loginChallengeSeconds);
    const created = await this.store.createLoginChallenge({
      ...input.permit.evidence,
      accountId: account.accountId,
      createdAt: now,
      credentialRevision: account.credentialRevision,
      event: this.event(
        "login_password_succeeded",
        "success",
        account.accountId,
        input.permit.evidence,
        null,
        now,
      ),
      expiresAt: challengeExpiresAt,
      tokenDigest: this.digester.digest("login-challenge", challengeToken),
    });
    return created === "created"
      ? { challengeExpiresAt, challengeToken, kind: "challenge" }
      : { kind: "invalid" };
  }

  async completeLogin(input: {
    readonly challengeToken: string;
    readonly permit: AdminSourceRateLimitPermit;
    readonly totpCode: string;
  }): Promise<CompleteLoginResult> {
    if (input.permit.action !== "login_totp") {
      throw new Error("A TOTP login attempt requires a login_totp source-rate-limit permit");
    }
    if (!input.permit.result.allowed) {
      return { kind: "rate_limited", retryAfterSeconds: input.permit.result.retryAfterSeconds };
    }
    const evidence = input.permit.evidence;
    const challengeRateLimit = await this.accountRateLimit(
      "login_totp",
      `challenge:${input.challengeToken}`,
      evidence.requestId,
    );
    if (!challengeRateLimit.allowed) {
      await this.store.appendSecurityEvent(
        this.event("login_totp_rate_limited", "denied", null, evidence, null),
      );
      return { kind: "rate_limited", retryAfterSeconds: challengeRateLimit.retryAfterSeconds };
    }
    const now = this.clock.now();
    const challengeTokenDigest = this.digester.digest("login-challenge", input.challengeToken);
    const challenge = await this.store.findLoginChallenge(challengeTokenDigest, now);
    if (
      challenge === null ||
      !equalDigest(challenge.sourceFingerprint, evidence.sourceFingerprint)
    ) {
      await this.store.appendSecurityEvent(
        this.event("login_totp_failed", "failure", null, evidence, null, now),
      );
      return { kind: "invalid" };
    }
    let secret: Buffer;
    try {
      secret = this.secretCipher.decrypt(
        challenge.account.totpSecret,
        challenge.account.accountId,
        challenge.account.credentialRevision,
      );
    } catch {
      await this.store.appendSecurityEvent(
        this.event(
          "login_totp_failed",
          "failure",
          challenge.account.accountId,
          evidence,
          null,
          now,
        ),
      );
      return { kind: "invalid" };
    }
    const matchedTotpCounter = matchTotpCounter(secret, input.totpCode, totpCounterAt(now), 1);
    secret.fill(0);
    if (matchedTotpCounter === null) {
      await this.store.appendSecurityEvent(
        this.event(
          "login_totp_failed",
          "failure",
          challenge.account.accountId,
          evidence,
          null,
          now,
        ),
      );
      return { kind: "invalid" };
    }

    const sessionToken = this.random.opaqueToken();
    const csrfToken = this.csrfTokenForSession(sessionToken);
    const absoluteExpiresAt = plusSeconds(now, this.options.absoluteSessionSeconds);
    const idleExpiresAt = plusSeconds(now, this.options.idleSessionSeconds);
    const created = await this.store.completeLogin({
      ...evidence,
      absoluteExpiresAt,
      accountId: challenge.account.accountId,
      challengeTokenDigest,
      createdAt: now,
      credentialRevision: challenge.account.credentialRevision,
      csrfTokenDigest: this.digester.digest("csrf-verifier", csrfToken),
      event: this.event(
        "login_totp_succeeded",
        "success",
        challenge.account.accountId,
        evidence,
        null,
        now,
      ),
      idleExpiresAt,
      matchedTotpCounter,
      sessionTokenDigest: this.digester.digest("session", sessionToken),
    });
    if (created !== "created") {
      await this.store.appendSecurityEvent(
        this.event(
          "login_totp_failed",
          "failure",
          challenge.account.accountId,
          evidence,
          null,
          now,
        ),
      );
      return { kind: "invalid" };
    }
    return {
      absoluteExpiresAt,
      accountId: challenge.account.accountId,
      credentialRevision: challenge.account.credentialRevision,
      csrfToken,
      idleExpiresAt,
      issuedAt: now,
      kind: "authenticated",
      sessionToken,
      username: challenge.account.username,
    };
  }

  async authenticateSession(input: {
    readonly csrfToken?: string;
    readonly requireCsrf: boolean;
    readonly sessionToken: string;
  }): Promise<SessionPrincipal | null> {
    const now = this.clock.now();
    const stored = await this.store.authenticateSession({
      csrfTokenDigest:
        input.csrfToken === undefined
          ? null
          : this.digester.digest("csrf-verifier", input.csrfToken),
      idleExpiresAt: plusSeconds(now, this.options.idleSessionSeconds),
      now,
      requireCsrf: input.requireCsrf,
      sessionTokenDigest: this.digester.digest("session", input.sessionToken),
    });
    return stored === null
      ? null
      : { ...stored, csrfToken: this.csrfTokenForSession(input.sessionToken) };
  }

  async getSession(
    sessionToken: string,
  ): Promise<Omit<SessionPrincipal, "sessionTokenDigest"> | null> {
    const principal = await this.authenticateSession({ requireCsrf: false, sessionToken });
    if (principal === null) {
      return null;
    }
    return {
      absoluteExpiresAt: principal.absoluteExpiresAt,
      accountId: principal.accountId,
      credentialRevision: principal.credentialRevision,
      csrfToken: principal.csrfToken,
      idleExpiresAt: principal.idleExpiresAt,
      issuedAt: principal.issuedAt,
      username: principal.username,
    };
  }

  async logout(input: {
    readonly context: AdminRequestContextInput;
    readonly csrfToken: string;
    readonly sessionToken: string;
  }): Promise<boolean> {
    const principal = await this.authenticateSession({
      csrfToken: input.csrfToken,
      requireCsrf: true,
      sessionToken: input.sessionToken,
    });
    if (principal === null) {
      return false;
    }
    const now = this.clock.now();
    return this.store.revokeSession({
      event: this.event(
        "session_logged_out",
        "success",
        principal.accountId,
        this.requestEvidence(input.context),
        null,
        now,
      ),
      now,
      sessionTokenDigest: principal.sessionTokenDigest,
    });
  }

  async logoutAll(input: {
    readonly context: AdminRequestContextInput;
    readonly principal: SessionPrincipal;
  }): Promise<boolean> {
    const now = this.clock.now();
    return this.store.revokeAllSessions({
      accountId: input.principal.accountId,
      event: this.event(
        "all_sessions_logged_out",
        "success",
        input.principal.accountId,
        this.requestEvidence(input.context),
        null,
        now,
      ),
      now,
    });
  }

  async beginRecovery(input: {
    readonly permit: AdminSourceRateLimitPermit;
    readonly recoveryCode: string;
    readonly username: string;
  }): Promise<BeginRecoveryResult> {
    if (input.permit.action !== "recovery") {
      throw new Error("A recovery attempt requires a recovery source-rate-limit permit");
    }
    if (!input.permit.result.allowed) {
      return { kind: "rate_limited", retryAfterSeconds: input.permit.result.retryAfterSeconds };
    }
    const username = normalizeUsername(input.username);
    const accountIdentity = username ?? "invalid-account-identifier";
    const accountRateLimit = await this.accountRateLimit(
      "recovery",
      accountIdentity,
      input.permit.evidence.requestId,
    );
    if (!accountRateLimit.allowed) {
      await this.store.appendSecurityEvent(
        this.event("recovery_account_rate_limited", "denied", null, input.permit.evidence, null),
      );
      return { kind: "rate_limited", retryAfterSeconds: accountRateLimit.retryAfterSeconds };
    }

    const account = username === null ? null : await this.store.findAccountByUsername(username);
    const recoveryCodeDigest = this.digester.digest("recovery-code", input.recoveryCode);
    const challengeToken = this.random.opaqueToken();
    const setup = this.random.totpSetup(username ?? "operator");
    const accountId = account?.accountId ?? "admin_unknown";
    const now = this.clock.now();
    const challengeExpiresAt = plusSeconds(now, this.options.recoveryChallengeSeconds);
    const expectedCredentialRevision = account?.credentialRevision ?? 1;
    const created = await this.store.beginRecovery({
      ...input.permit.evidence,
      accountId,
      challengeTokenDigest: this.digester.digest("recovery-challenge", challengeToken),
      createdAt: now,
      event: this.event(
        "recovery_code_consumed",
        "success",
        accountId,
        input.permit.evidence,
        null,
        now,
      ),
      expectedCredentialRevision,
      expiresAt: challengeExpiresAt,
      pendingTotpSecret: this.secretCipher.encrypt(
        setup.secret,
        accountId,
        expectedCredentialRevision + 1,
      ),
      recoveryCodeDigest,
      username: username ?? "invalid-account-identifier",
    });
    setup.secret.fill(0);
    if (created !== "created") {
      await this.store.appendSecurityEvent(
        this.event(
          "recovery_code_failed",
          "failure",
          account?.accountId ?? null,
          input.permit.evidence,
          null,
          now,
        ),
      );
      return { kind: "invalid" };
    }
    return {
      challengeExpiresAt,
      challengeToken,
      kind: "challenge",
      totpSetup: { otpauthUri: setup.otpauthUri, secretBase32: setup.secretBase32 },
    };
  }

  async completeRecovery(input: {
    readonly challengeToken: string;
    readonly newPassword: string;
    readonly permit: AdminSourceRateLimitPermit;
    readonly totpCode: string;
  }): Promise<CompleteRecoveryResult> {
    if (input.permit.action !== "recovery_complete") {
      throw new Error(
        "A recovery completion requires a recovery_complete source-rate-limit permit",
      );
    }
    if (!input.permit.result.allowed) {
      return { kind: "rate_limited", retryAfterSeconds: input.permit.result.retryAfterSeconds };
    }
    const now = this.clock.now();
    const evidence = input.permit.evidence;
    const challengeRateLimit = await this.accountRateLimit(
      "recovery_complete",
      `challenge:${input.challengeToken}`,
      evidence.requestId,
    );
    if (!challengeRateLimit.allowed) {
      await this.store.appendSecurityEvent(
        this.event("recovery_completion_rate_limited", "denied", null, evidence, null, now),
      );
      return { kind: "rate_limited", retryAfterSeconds: challengeRateLimit.retryAfterSeconds };
    }
    const challengeTokenDigest = this.digester.digest("recovery-challenge", input.challengeToken);
    const challenge = await this.store.findRecoveryChallenge(challengeTokenDigest, now);
    if (challenge === null) {
      await this.store.appendSecurityEvent(
        this.event("recovery_completion_failed", "failure", null, evidence, null, now),
      );
      return { kind: "invalid" };
    }
    let secret: Buffer;
    try {
      secret = this.secretCipher.decrypt(
        challenge.pendingTotpSecret,
        challenge.accountId,
        challenge.credentialRevision,
      );
    } catch {
      return { kind: "invalid" };
    }
    const matchedCounter = matchTotpCounter(secret, input.totpCode, totpCounterAt(now), 1);
    if (matchedCounter === null) {
      secret.fill(0);
      await this.store.appendSecurityEvent(
        this.event(
          "recovery_completion_failed",
          "failure",
          challenge.accountId,
          evidence,
          null,
          now,
        ),
      );
      return { kind: "invalid" };
    }
    let passwordHash: string;
    try {
      passwordHash = await this.passwordHasher.hash(input.newPassword);
    } catch {
      secret.fill(0);
      return { kind: "invalid" };
    }
    const recoveryCodes = this.random.recoveryCodes();
    const sessionToken = this.random.opaqueToken();
    const csrfToken = this.csrfTokenForSession(sessionToken);
    const absoluteExpiresAt = plusSeconds(now, this.options.absoluteSessionSeconds);
    const idleExpiresAt = plusSeconds(now, this.options.idleSessionSeconds);
    const completed = await this.store.completeRecovery({
      ...evidence,
      absoluteExpiresAt,
      accountId: challenge.accountId,
      challengeTokenDigest,
      completedAt: now,
      credentialRevision: challenge.credentialRevision,
      csrfTokenDigest: this.digester.digest("csrf-verifier", csrfToken),
      event: this.event("recovery_completed", "success", challenge.accountId, evidence, null, now),
      lastAcceptedTotpCounter: matchedCounter,
      idleExpiresAt,
      passwordHash,
      recoveryCodes: this.recoveryCodeRecords(recoveryCodes),
      sessionTokenDigest: this.digester.digest("session", sessionToken),
      totpSecret: this.secretCipher.encrypt(
        secret,
        challenge.accountId,
        challenge.credentialRevision,
      ),
    });
    secret.fill(0);
    if (completed !== "completed") {
      await this.store.appendSecurityEvent(
        this.event(
          "recovery_completion_failed",
          "failure",
          challenge.accountId,
          evidence,
          null,
          now,
        ),
      );
      return { kind: "invalid" };
    }
    return {
      kind: "completed",
      recoveryCodes,
      session: {
        absoluteExpiresAt,
        accountId: challenge.accountId,
        credentialRevision: challenge.credentialRevision,
        csrfToken,
        idleExpiresAt,
        issuedAt: now,
        sessionToken,
        username: challenge.username,
      },
    };
  }

  async offlineReset(input: {
    readonly context: AdminRequestContextInput;
    readonly newPassword: string;
    readonly setup: TotpSetup;
    readonly totpCode: string;
    readonly username: string;
  }): Promise<OfflineResetResult> {
    const username = normalizeUsername(input.username);
    const account = username === null ? null : await this.store.findAccountByUsername(username);
    const now = this.clock.now();
    const matchedCounter = matchTotpCounter(
      input.setup.secret,
      input.totpCode,
      totpCounterAt(now),
      1,
    );
    if (account === null || matchedCounter === null) {
      return { kind: "invalid" };
    }
    let passwordHash: string;
    try {
      passwordHash = await this.passwordHasher.hash(input.newPassword);
    } catch {
      return { kind: "invalid" };
    }
    const evidence = this.requestEvidence(input.context);
    const recoveryCodes = this.random.recoveryCodes();
    const completed = await this.store.offlineReset({
      accountId: account.accountId,
      completedAt: now,
      event: this.event(
        "account_offline_reset",
        "success",
        account.accountId,
        evidence,
        "server-console",
        now,
      ),
      expectedCredentialRevision: account.credentialRevision,
      lastAcceptedTotpCounter: matchedCounter,
      passwordHash,
      recoveryCodes: this.recoveryCodeRecords(recoveryCodes),
      totpSecret: this.secretCipher.encrypt(
        input.setup.secret,
        account.accountId,
        account.credentialRevision + 1,
      ),
    });
    return completed === "completed" ? { kind: "completed", recoveryCodes } : { kind: "invalid" };
  }

  async listSecurityEvents(
    accountId: string,
    input: { readonly cursor?: string | null; readonly limit?: number } = {},
  ): Promise<SecurityEventsPageResult> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const before =
      input.cursor == null ? null : this.parseSecurityEventCursor(input.cursor, accountId);
    if (input.cursor != null && before === null) {
      return { kind: "invalid_cursor" };
    }
    const records = await this.store.listSecurityEvents(accountId, limit + 1, before);
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      kind: "page",
      nextCursor:
        hasMore && last !== undefined
          ? this.securityEventCursor(accountId, last.occurredAt, last.eventId)
          : null,
    };
  }

  async recordCsrfRejected(input: {
    readonly accountId: string | null;
    readonly context: AdminRequestContextInput;
    readonly reasonCategory:
      "csrf_mismatch" | "csrf_missing" | "origin_missing" | "origin_untrusted";
  }): Promise<void> {
    const evidence = this.requestEvidence(input.context);
    await this.store.appendSecurityEvent({
      ...this.event("csrf_rejected", "denied", input.accountId, evidence, null),
      metadata: { reasonCategory: input.reasonCategory },
    });
  }

  private async accountRateLimit(
    action: AdminAuthAction,
    accountIdentity: string,
    requestId: string,
  ) {
    const policy = RATE_LIMITS[action].account;
    return this.store.consumeRateLimit({
      action,
      capacity: policy.capacity,
      dimension: "account",
      identityDigest: this.digester.digest("account-rate-limit", accountIdentity),
      now: this.clock.now(),
      requestId,
      windowSeconds: policy.windowSeconds,
    });
  }

  private event(
    eventType: string,
    outcome: SecurityEventInput["outcome"],
    accountId: string | null,
    evidence: AdminRequestEvidence,
    reason: string | null,
    occurredAt = this.clock.now(),
  ): SecurityEventInput {
    return {
      ...evidence,
      accountId,
      eventId: this.random.identifier("security-event"),
      eventType,
      occurredAt,
      outcome,
      reason,
      retainUntil: new Date(occurredAt.getTime() + RETENTION_MILLISECONDS),
    };
  }

  private recoveryCodeRecords(codes: readonly string[]) {
    return codes.map((code) => ({
      codeDigest: this.digester.digest("recovery-code", code),
      codeId: this.random.identifier("recovery-code"),
    }));
  }

  private csrfTokenForSession(sessionToken: string): string {
    return this.digester.digest("csrf-token", sessionToken).toString("base64url");
  }

  private parseSecurityEventCursor(
    cursor: string,
    accountId: string,
  ): { eventId: string; occurredAt: Date } | null {
    if (cursor.length > 256) {
      return null;
    }
    const [timestampEncoded, eventIdEncoded, signatureEncoded, extra] = cursor.split(".");
    if (
      timestampEncoded === undefined ||
      eventIdEncoded === undefined ||
      signatureEncoded === undefined ||
      extra !== undefined ||
      !/^[0-9a-z]+$/u.test(timestampEncoded)
    ) {
      return null;
    }
    const payload = `${timestampEncoded}.${eventIdEncoded}`;
    const expected = this.digester.digest("security-event-cursor", `${accountId}\0${payload}`);
    const received = Buffer.from(signatureEncoded, "base64url");
    if (!equalDigest(expected, received)) {
      return null;
    }
    const occurredAtMilliseconds = Number.parseInt(timestampEncoded, 36);
    const eventIdBytes = Buffer.from(eventIdEncoded, "base64url");
    const eventId = eventIdBytes.toString("utf8");
    if (
      !Number.isSafeInteger(occurredAtMilliseconds) ||
      occurredAtMilliseconds < 0 ||
      occurredAtMilliseconds.toString(36) !== timestampEncoded ||
      eventIdBytes.toString("base64url") !== eventIdEncoded ||
      eventId.length < 1 ||
      eventId.length > 80
    ) {
      return null;
    }
    return { eventId, occurredAt: new Date(occurredAtMilliseconds) };
  }

  private securityEventCursor(accountId: string, occurredAt: Date, eventId: string): string {
    const payloadEncoded = `${occurredAt.getTime().toString(36)}.${Buffer.from(eventId, "utf8").toString("base64url")}`;
    const signature = this.digester
      .digest("security-event-cursor", `${accountId}\0${payloadEncoded}`)
      .toString("base64url");
    return `${payloadEncoded}.${signature}`;
  }
}

export interface EmergencyControlServiceOptions {
  readonly resumeConfirmationPhrase: string;
  readonly stopConfirmationPhrase: string;
}

const DEFAULT_EMERGENCY_OPTIONS: EmergencyControlServiceOptions = {
  resumeConfirmationPhrase: "恢复全部公开内容",
  stopConfirmationPhrase: "停止全部公开内容",
};

export type EmergencyControlResult =
  | ApplyEmergencyControlResult
  | { readonly kind: "invalid_confirmation" }
  | { readonly kind: "invalid_totp" };

export class EmergencyControlService {
  constructor(
    private readonly store: AdminSecurityStore,
    private readonly secretCipher: AesGcmTotpSecretCipher,
    private readonly random: SystemAdminAuthRandom,
    private readonly clock: AdminAuthClock,
    private readonly evidenceFactory: Pick<AdminAuthService, "requestEvidence">,
    private readonly options: EmergencyControlServiceOptions = DEFAULT_EMERGENCY_OPTIONS,
  ) {}

  getState(): Promise<PublicAccessControlRecord> {
    return this.store.getPublicAccessControl();
  }

  async apply(input: {
    readonly action: EmergencyAction;
    readonly confirmationPhrase: string;
    readonly context: AdminRequestContextInput;
    readonly expectedRevision: number;
    readonly idempotencyKey: string;
    readonly principal: SessionPrincipal;
    readonly reason: string;
    readonly totpCode: string;
  }): Promise<EmergencyControlResult> {
    const expectedPhrase =
      input.action === "stop"
        ? this.options.stopConfirmationPhrase
        : this.options.resumeConfirmationPhrase;
    const evidence = this.evidenceFactory.requestEvidence(input.context);
    const now = this.clock.now();
    if (
      input.confirmationPhrase !== expectedPhrase ||
      !validReason(input.reason) ||
      !/^[-A-Za-z0-9_:.]{16,128}$/u.test(input.idempotencyKey) ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1
    ) {
      await this.store.appendSecurityEvent(
        this.event(
          input.action === "stop"
            ? "public_access_stop_confirmation_rejected"
            : "public_access_resume_confirmation_rejected",
          "denied",
          input.principal.accountId,
          evidence,
          null,
          now,
        ),
      );
      return { kind: "invalid_confirmation" };
    }
    const account = await this.store.findAccountById(input.principal.accountId);
    if (account === null || account.credentialRevision !== input.principal.credentialRevision) {
      return { kind: "invalid_totp" };
    }
    let secret: Buffer;
    try {
      secret = this.secretCipher.decrypt(
        account.totpSecret,
        account.accountId,
        account.credentialRevision,
      );
    } catch {
      return { kind: "invalid_totp" };
    }
    const matchedTotpCounter = matchTotpCounter(secret, input.totpCode, totpCounterAt(now), 1);
    secret.fill(0);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          action: input.action,
          confirmationPhrase: input.confirmationPhrase,
          expectedRevision: input.expectedRevision,
          reason: input.reason.trim(),
        }),
      )
      .digest();
    const result = await this.store.applyEmergencyControl({
      ...evidence,
      accountId: account.accountId,
      action: input.action,
      changedAt: now,
      credentialRevision: account.credentialRevision,
      event: this.event(
        input.action === "stop" ? "public_access_stopped" : "public_access_resumed",
        "success",
        account.accountId,
        evidence,
        input.reason.trim(),
        now,
      ),
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      matchedTotpCounter,
      reason: input.reason.trim(),
      requestHash,
    });
    if (
      result.kind === "totp_replayed" ||
      result.kind === "idempotency_conflict" ||
      result.kind === "invalid_state"
    ) {
      await this.store.appendSecurityEvent(
        this.event(
          `${input.action === "stop" ? "public_access_stop" : "public_access_resume"}_${
            result.kind === "totp_replayed" && matchedTotpCounter === null
              ? "totp_rejected"
              : result.kind
          }`,
          result.kind === "totp_replayed" ? "failure" : "denied",
          account.accountId,
          evidence,
          null,
          now,
        ),
      );
    }
    if (result.kind === "totp_replayed" && matchedTotpCounter === null) {
      return { kind: "invalid_totp" };
    }
    return result;
  }

  private event(
    eventType: string,
    outcome: SecurityEventInput["outcome"],
    accountId: string,
    evidence: AdminRequestEvidence,
    reason: string | null,
    occurredAt: Date,
  ): SecurityEventInput {
    return {
      ...evidence,
      accountId,
      eventId: this.random.identifier("security-event"),
      eventType,
      occurredAt,
      outcome,
      reason,
      retainUntil: new Date(occurredAt.getTime() + RETENTION_MILLISECONDS),
    };
  }
}
