import { createHash, timingSafeEqual } from "node:crypto";

import {
  type HmacSecretDigester,
  type NodeScryptPasswordHasher,
  type SystemAdminAuthRandom,
} from "./admin-auth.crypto";
import type {
  AdminAuthAction,
  AdminRequestEvidence,
  AdminSecurityStore,
  ApplyEmergencyControlResult,
  CreatePasswordSessionInput,
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
}

const DEFAULT_OPTIONS: AdminAuthServiceOptions = {
  absoluteSessionSeconds: 12 * 60 * 60,
  idleSessionSeconds: 30 * 60,
};

const RATE_LIMITS = {
  login: {
    account: { capacity: 5, windowSeconds: 15 * 60 },
    source: { capacity: 10, windowSeconds: 15 * 60 },
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

export type OfflineResetResult = { readonly kind: "completed" } | { readonly kind: "invalid" };

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
    }
  | { readonly kind: "already_initialized" }
  | { readonly kind: "invalid" };

export class AdminAuthService {
  constructor(
    private readonly store: AdminSecurityStore,
    private readonly passwordHasher: NodeScryptPasswordHasher,
    private readonly digester: HmacSecretDigester,
    private readonly random: SystemAdminAuthRandom,
    private readonly clock: AdminAuthClock,
    private readonly options: AdminAuthServiceOptions = DEFAULT_OPTIONS,
  ) {}

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
    readonly username: string;
  }): Promise<BootstrapResult> {
    const username = normalizeUsername(input.username);
    const now = this.clock.now();
    if (username === null) {
      return { kind: "invalid" };
    }
    let passwordHash: string;
    try {
      passwordHash = await this.passwordHasher.hash(input.password);
    } catch {
      return { kind: "invalid" };
    }
    const accountId = this.random.identifier("admin");
    const evidence = this.requestEvidence(input.context);
    const created = await this.store.createAccount({
      accountId,
      createdAt: now,
      event: this.event("account_bootstrapped", "success", accountId, evidence, null, now),
      passwordHash,
      username,
    });
    return created === "created" ? { accountId, kind: "created" } : { kind: "already_initialized" };
  }

  async login(input: {
    readonly password: string;
    readonly permit: AdminSourceRateLimitPermit;
    readonly username: string;
  }): Promise<CompleteLoginResult> {
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
    const sessionToken = this.random.opaqueToken();
    const csrfToken = this.csrfTokenForSession(sessionToken);
    const absoluteExpiresAt = plusSeconds(now, this.options.absoluteSessionSeconds);
    const idleExpiresAt = plusSeconds(now, this.options.idleSessionSeconds);
    const sessionInput: CreatePasswordSessionInput = {
      ...input.permit.evidence,
      absoluteExpiresAt,
      accountId: account.accountId,
      createdAt: now,
      credentialRevision: account.credentialRevision,
      csrfTokenDigest: this.digester.digest("csrf-verifier", csrfToken),
      event: this.event(
        "login_password_succeeded",
        "success",
        account.accountId,
        input.permit.evidence,
        null,
        now,
      ),
      idleExpiresAt,
      sessionTokenDigest: this.digester.digest("session", sessionToken),
    };
    const created = await this.store.createPasswordSession(sessionInput);
    if (created !== "created") {
      await this.store.appendSecurityEvent(
        this.event(
          "login_password_failed",
          "failure",
          account.accountId,
          input.permit.evidence,
          null,
          now,
        ),
      );
      return { kind: "invalid" };
    }
    return {
      absoluteExpiresAt,
      accountId: account.accountId,
      credentialRevision: account.credentialRevision,
      csrfToken,
      idleExpiresAt,
      issuedAt: now,
      kind: "authenticated",
      sessionToken,
      username: account.username,
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

  async offlineReset(input: {
    readonly context: AdminRequestContextInput;
    readonly newPassword: string;
    readonly username: string;
  }): Promise<OfflineResetResult> {
    const username = normalizeUsername(input.username);
    const account = username === null ? null : await this.store.findAccountByUsername(username);
    const now = this.clock.now();
    if (account === null) {
      return { kind: "invalid" };
    }
    let passwordHash: string;
    try {
      passwordHash = await this.passwordHasher.hash(input.newPassword);
    } catch {
      return { kind: "invalid" };
    }
    const evidence = this.requestEvidence(input.context);
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
      passwordHash,
    });
    return completed === "completed" ? { kind: "completed" } : { kind: "invalid" };
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
  ApplyEmergencyControlResult | { readonly kind: "invalid_confirmation" };

export class EmergencyControlService {
  constructor(
    private readonly store: AdminSecurityStore,
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
      return { kind: "invalid_confirmation" };
    }
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
      reason: input.reason.trim(),
      requestHash,
    });
    if (result.kind === "idempotency_conflict" || result.kind === "invalid_state") {
      await this.store.appendSecurityEvent(
        this.event(
          `${input.action === "stop" ? "public_access_stop" : "public_access_resume"}_${result.kind}`,
          "denied",
          account.accountId,
          evidence,
          null,
          now,
        ),
      );
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
