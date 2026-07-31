import type { EncryptedTotpSecret } from "./admin-auth.crypto";

export type AdminAuthAction = "login" | "login_totp" | "recovery" | "recovery_complete";
export type AdminAuthRateLimitDimension = "account" | "source";
export type SecurityEventOutcome = "denied" | "failure" | "success";

export interface AdminRequestEvidence {
  readonly requestId: string;
  readonly sourceFingerprint: Buffer;
  readonly userAgentSummary: string;
}

export interface SecurityEventInput extends AdminRequestEvidence {
  readonly accountId: string | null;
  readonly eventId: string;
  readonly eventType: string;
  readonly metadata?: Readonly<Record<string, boolean | number | string | null>>;
  readonly occurredAt: Date;
  readonly outcome: SecurityEventOutcome;
  readonly reason?: string | null;
  readonly retainUntil: Date;
}

export interface SecurityEventRecord {
  readonly accountId: string | null;
  readonly eventId: string;
  readonly eventType: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly outcome: SecurityEventOutcome;
  readonly reason: string | null;
  readonly requestId: string;
  readonly sourceFingerprint: string;
  readonly userAgentSummary: string;
}

export interface SecurityEventCursorPosition {
  readonly eventId: string;
  readonly occurredAt: Date;
}

export interface AdminAccountRecord {
  readonly accountId: string;
  readonly credentialRevision: number;
  readonly lastAcceptedTotpCounter: number;
  readonly passwordHash: string;
  readonly totpSecret: EncryptedTotpSecret;
  readonly username: string;
}

export interface PasswordVerificationLookup {
  readonly account: AdminAccountRecord | null;
  readonly passwordHash: string | null;
}

export interface RecoveryCodeRecordInput {
  readonly codeDigest: Buffer;
  readonly codeId: string;
}

export interface CreateAdminAccountInput {
  readonly accountId: string;
  readonly createdAt: Date;
  readonly event: SecurityEventInput;
  readonly lastAcceptedTotpCounter: number;
  readonly passwordHash: string;
  readonly recoveryCodes: readonly RecoveryCodeRecordInput[];
  readonly totpSecret: EncryptedTotpSecret;
  readonly username: string;
}

export interface RateLimitAttemptInput {
  readonly action: AdminAuthAction;
  readonly capacity: number;
  readonly dimension: AdminAuthRateLimitDimension;
  readonly identityDigest: Buffer;
  readonly now: Date;
  readonly requestId: string;
  readonly windowSeconds: number;
}

export type RateLimitAttemptResult =
  { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface CreateLoginChallengeInput extends AdminRequestEvidence {
  readonly accountId: string;
  readonly createdAt: Date;
  readonly credentialRevision: number;
  readonly event: SecurityEventInput;
  readonly expiresAt: Date;
  readonly tokenDigest: Buffer;
}

export interface LoginChallengeRecord {
  readonly account: AdminAccountRecord;
  readonly sourceFingerprint: Buffer;
}

export interface CompleteLoginInput extends AdminRequestEvidence {
  readonly absoluteExpiresAt: Date;
  readonly accountId: string;
  readonly challengeTokenDigest: Buffer;
  readonly createdAt: Date;
  readonly csrfTokenDigest: Buffer;
  readonly credentialRevision: number;
  readonly event: SecurityEventInput;
  readonly idleExpiresAt: Date;
  readonly matchedTotpCounter: number;
  readonly sessionTokenDigest: Buffer;
}

export interface StoredSessionPrincipal {
  readonly accountId: string;
  readonly absoluteExpiresAt: Date;
  readonly credentialRevision: number;
  readonly idleExpiresAt: Date;
  readonly issuedAt: Date;
  readonly sessionTokenDigest: Buffer;
  readonly username: string;
}

export interface AuthenticateSessionInput {
  readonly csrfTokenDigest: Buffer | null;
  readonly idleExpiresAt: Date;
  readonly now: Date;
  readonly requireCsrf: boolean;
  readonly sessionTokenDigest: Buffer;
}

export interface RevokeSessionInput {
  readonly event: SecurityEventInput;
  readonly now: Date;
  readonly sessionTokenDigest: Buffer;
}

export interface RevokeAllSessionsInput {
  readonly accountId: string;
  readonly event: SecurityEventInput;
  readonly now: Date;
}

export interface BeginRecoveryInput extends AdminRequestEvidence {
  readonly accountId: string;
  readonly challengeTokenDigest: Buffer;
  readonly createdAt: Date;
  readonly event: SecurityEventInput;
  readonly expiresAt: Date;
  readonly expectedCredentialRevision: number;
  readonly pendingTotpSecret: EncryptedTotpSecret;
  readonly recoveryCodeDigest: Buffer;
  readonly username: string;
}

export interface RecoveryChallengeRecord {
  readonly accountId: string;
  readonly credentialRevision: number;
  readonly pendingTotpSecret: EncryptedTotpSecret;
  readonly sourceFingerprint: Buffer;
  readonly username: string;
}

export interface CompleteRecoveryInput extends AdminRequestEvidence {
  readonly absoluteExpiresAt: Date;
  readonly accountId: string;
  readonly challengeTokenDigest: Buffer;
  readonly completedAt: Date;
  readonly credentialRevision: number;
  readonly csrfTokenDigest: Buffer;
  readonly event: SecurityEventInput;
  readonly lastAcceptedTotpCounter: number;
  readonly idleExpiresAt: Date;
  readonly passwordHash: string;
  readonly recoveryCodes: readonly RecoveryCodeRecordInput[];
  readonly sessionTokenDigest: Buffer;
  readonly totpSecret: EncryptedTotpSecret;
}

export interface OfflineResetInput {
  readonly accountId: string;
  readonly completedAt: Date;
  readonly event: SecurityEventInput;
  readonly expectedCredentialRevision: number;
  readonly lastAcceptedTotpCounter: number;
  readonly passwordHash: string;
  readonly recoveryCodes: readonly RecoveryCodeRecordInput[];
  readonly totpSecret: EncryptedTotpSecret;
}

export interface PublicAccessControlRecord {
  readonly auditEventId: string | null;
  readonly changedAt: Date;
  readonly publiclyEnabled: boolean;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly revision: number;
}

export type EmergencyAction = "resume" | "stop";

export interface ApplyEmergencyControlInput extends AdminRequestEvidence {
  readonly accountId: string;
  readonly action: EmergencyAction;
  readonly changedAt: Date;
  readonly credentialRevision: number;
  readonly event: SecurityEventInput;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly matchedTotpCounter: number | null;
  readonly reason: string;
  readonly requestHash: Buffer;
}

export type ApplyEmergencyControlResult =
  | { readonly kind: "applied" | "existing"; readonly state: PublicAccessControlRecord }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "invalid_state" }
  | { readonly kind: "revision_conflict"; readonly current: PublicAccessControlRecord }
  | { readonly kind: "totp_replayed" };

export interface AdminSecurityStore {
  appendSecurityEvent(event: SecurityEventInput): Promise<void>;
  applyEmergencyControl(input: ApplyEmergencyControlInput): Promise<ApplyEmergencyControlResult>;
  authenticateSession(input: AuthenticateSessionInput): Promise<StoredSessionPrincipal | null>;
  beginRecovery(input: BeginRecoveryInput): Promise<"created" | "invalid">;
  completeLogin(input: CompleteLoginInput): Promise<"created" | "invalid">;
  completeRecovery(input: CompleteRecoveryInput): Promise<"completed" | "invalid">;
  consumeRateLimit(input: RateLimitAttemptInput): Promise<RateLimitAttemptResult>;
  createAccount(input: CreateAdminAccountInput): Promise<"already_initialized" | "created">;
  createLoginChallenge(input: CreateLoginChallengeInput): Promise<"created" | "invalid">;
  findAccountById(accountId: string): Promise<AdminAccountRecord | null>;
  findAccountByUsername(username: string): Promise<AdminAccountRecord | null>;
  findPasswordVerification(username: string): Promise<PasswordVerificationLookup>;
  findLoginChallenge(tokenDigest: Buffer, now: Date): Promise<LoginChallengeRecord | null>;
  findRecoveryChallenge(tokenDigest: Buffer, now: Date): Promise<RecoveryChallengeRecord | null>;
  getPublicAccessControl(): Promise<PublicAccessControlRecord>;
  isInitialized(): Promise<boolean>;
  listSecurityEvents(
    accountId: string,
    limit: number,
    before: SecurityEventCursorPosition | null,
  ): Promise<readonly SecurityEventRecord[]>;
  offlineReset(input: OfflineResetInput): Promise<"completed" | "invalid">;
  revokeAllSessions(input: RevokeAllSessionsInput): Promise<boolean>;
  revokeSession(input: RevokeSessionInput): Promise<boolean>;
}
