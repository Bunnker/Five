import type {
  components as FiveApiComponents,
  operations as FiveApiOperations,
} from "@five/api-contract";
import {
  DRAFT_MODULE_CODES,
  DRAFT_MODULE_REQUIRED_KEYS,
  isAdminDailyImageSet,
  isDraftImageAssetList,
  isDraftImageAssetResult,
  isDraftModuleCode,
  isDraftModuleUpdate,
  isErrorCode,
  isImageAssetWithdrawalResult,
} from "@five/api-contract/runtime";

export type AdminSession = FiveApiComponents["schemas"]["AdminSession"];
export type EmergencyControlStatus = FiveApiComponents["schemas"]["EmergencyControlStatus"];
export type PasswordChallenge = FiveApiComponents["schemas"]["PasswordChallenge"];
export type RecoveryChallenge = FiveApiComponents["schemas"]["RecoveryChallenge"];
export type RecoveryCompletion = FiveApiComponents["schemas"]["RecoveryCompletion"];
export type SecurityEventPage = FiveApiComponents["schemas"]["SecurityEventPage"];
export type SecurityEvent = SecurityEventPage["items"][number];
export type AdminContentVersion = FiveApiComponents["schemas"]["AdminContentVersion"];
export type ContentDraft = FiveApiComponents["schemas"]["ContentDraft"];
export type ContentDraftList = FiveApiComponents["schemas"]["ContentDraftList"];
export type ContentVersionSummary = FiveApiComponents["schemas"]["ContentVersionSummary"];
export type DraftModuleCode = FiveApiComponents["schemas"]["ModuleCode"];
export type DraftModuleUpdate = FiveApiComponents["schemas"]["DraftModuleUpdate"];
export type LifecycleActionResult = FiveApiComponents["schemas"]["LifecycleActionResult"];
export type SubmitDraftResult = FiveApiComponents["schemas"]["SubmitDraftResult"];
export type UpdatedDraftModule = FiveApiComponents["schemas"]["UpdatedDraftModule"];
export type AdminDailyImageSet = FiveApiComponents["schemas"]["AdminDailyImageSet"];
export type AdminImageAsset = FiveApiComponents["schemas"]["AdminImageAsset"];
export type DraftImageAssetList = FiveApiComponents["schemas"]["DraftImageAssetList"];
export type DraftImageAssetResult = FiveApiComponents["schemas"]["DraftImageAssetResult"];
export type ImageAssetReviewRequest = FiveApiComponents["schemas"]["ImageAssetReviewRequest"];
export type ImageAssetUploadMetadata = FiveApiComponents["schemas"]["ImageAssetUploadMetadata"];
export type ImageAssetWithdrawalResult = FiveApiComponents["schemas"]["ImageAssetWithdrawalResult"];
export type WithdrawImageAssetRequest = FiveApiComponents["schemas"]["WithdrawImageAssetRequest"];
export type AdminErrorCode = FiveApiComponents["schemas"]["ErrorCode"];

export type ContentVersionList =
  FiveApiOperations["listDailyContentVersions"]["responses"][200]["content"]["application/json"];

type CompleteRecoveryRequest = FiveApiComponents["schemas"]["CompleteRecoveryRequest"];
type CreateAdminSessionRequest = FiveApiComponents["schemas"]["CreateAdminSessionRequest"];
type CreatePasswordChallengeRequest =
  FiveApiComponents["schemas"]["CreatePasswordChallengeRequest"];
type CreateRecoveryChallengeRequest =
  FiveApiComponents["schemas"]["CreateRecoveryChallengeRequest"];
type EmergencyResumeRequest = FiveApiComponents["schemas"]["EmergencyResumeRequest"];
type EmergencyStopRequest = FiveApiComponents["schemas"]["EmergencyStopRequest"];
type AddMasterReviewEvidenceRequest =
  FiveApiComponents["schemas"]["AddMasterReviewEvidenceRequest"];
type CreateDraftRequest = FiveApiComponents["schemas"]["CreateDraftRequest"];
type ExpectedActiveVersionRequest = FiveApiComponents["schemas"]["ExpectedActiveVersionRequest"];
type ReviewDecisionRequest = FiveApiComponents["schemas"]["ReviewDecisionRequest"];
type RollbackRequest = FiveApiComponents["schemas"]["RollbackRequest"];
type ScheduleRequest = FiveApiComponents["schemas"]["ScheduleRequest"];
type WithdrawRequest = FiveApiComponents["schemas"]["WithdrawRequest"];

export type AdminApiError = {
  code?: AdminErrorCode;
  details?: Record<string, unknown>;
  kind: "api-error";
  requestId: string | null;
  retryAfterSeconds: number | null;
  retryable?: boolean;
  status: number;
};

export type AdminApiResult<T> =
  { data: T; ok: true; response: Response } | { error: AdminApiError; ok: false };

type Validator<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, minimum = 1, maximum = 2048): value is string {
  if (typeof value !== "string") return false;
  const codePointLength = Array.from(value).length;
  return codePointLength >= minimum && codePointLength <= maximum;
}

function isZonedDateTime(value: unknown): value is string {
  if (!isBoundedString(value, 1, 64)) return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function isAdminSession(value: unknown): value is AdminSession {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "absoluteExpiresAt",
      "credentialRevision",
      "csrfToken",
      "idleExpiresAt",
      "issuedAt",
      "username",
    ]) &&
    isBoundedString(value.username, 3, 64) &&
    /^[a-z0-9][a-z0-9._-]*$/u.test(value.username) &&
    isZonedDateTime(value.issuedAt) &&
    isZonedDateTime(value.idleExpiresAt) &&
    isZonedDateTime(value.absoluteExpiresAt) &&
    isBoundedString(value.csrfToken, 32, 256) &&
    Number.isInteger(value.credentialRevision) &&
    Number(value.credentialRevision) >= 1
  );
}

function isPasswordChallenge(value: unknown): value is PasswordChallenge {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["challengeToken", "expiresAt"]) &&
    isBoundedString(value.challengeToken, 32, 512) &&
    isZonedDateTime(value.expiresAt)
  );
}

function isRecoveryChallenge(value: unknown): value is RecoveryChallenge {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["challengeToken", "expiresAt", "totpProvisioning"]) ||
    !isBoundedString(value.challengeToken, 32, 512) ||
    !isZonedDateTime(value.expiresAt) ||
    !isRecord(value.totpProvisioning)
  ) {
    return false;
  }

  const provisioning = value.totpProvisioning;
  return (
    hasExactKeys(provisioning, ["algorithm", "digits", "otpauthUri", "periodSeconds", "secret"]) &&
    isBoundedString(provisioning.secret, 32, 128) &&
    /^[A-Z2-7]+=*$/u.test(provisioning.secret) &&
    isBoundedString(provisioning.otpauthUri, 1, 2048) &&
    provisioning.otpauthUri.startsWith("otpauth://totp/") &&
    provisioning.algorithm === "SHA1" &&
    provisioning.digits === 6 &&
    provisioning.periodSeconds === 30
  );
}

function isRecoveryCompletion(value: unknown): value is RecoveryCompletion {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["recoveryCodes", "session"]) &&
    isAdminSession(value.session) &&
    Array.isArray(value.recoveryCodes) &&
    value.recoveryCodes.length === 10 &&
    new Set(value.recoveryCodes).size === 10 &&
    value.recoveryCodes.every((code) => isBoundedString(code, 16, 128))
  );
}

function isSecurityEventPage(value: unknown): value is SecurityEventPage {
  const allowedActions = new Set<SecurityEvent["action"]>([
    "bootstrap_completed",
    "login_password",
    "login_totp",
    "logout_current",
    "logout_all",
    "recovery_code",
    "recovery_completed",
    "offline_reset",
    "csrf_rejected",
    "rate_limited",
    "emergency_stop",
    "emergency_resume",
  ]);
  return (
    isRecord(value) &&
    hasExactKeys(value, ["items", "nextCursor"]) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        hasExactKeys(item, [
          "action",
          "clientSummary",
          "eventId",
          "occurredAt",
          "outcome",
          "reason",
          "requestId",
          "sourceFingerprint",
        ]) &&
        isBoundedString(item.eventId, 1, 128) &&
        isZonedDateTime(item.occurredAt) &&
        isBoundedString(item.action, 1, 64) &&
        allowedActions.has(item.action as SecurityEvent["action"]) &&
        (item.outcome === "succeeded" || item.outcome === "rejected") &&
        isBoundedString(item.requestId, 8, 128) &&
        isBoundedString(item.sourceFingerprint, 16, 128) &&
        (item.clientSummary === null || isBoundedString(item.clientSummary, 0, 160)) &&
        (item.reason === null || isBoundedString(item.reason, 1, 2000)),
    ) &&
    (value.nextCursor === null || isBoundedString(value.nextCursor, 1, 256))
  );
}

function isEmergencyControlStatus(value: unknown): value is EmergencyControlStatus {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "auditEventId",
      "changedAt",
      "publicAccessEnabled",
      "reason",
      "revision",
    ]) &&
    typeof value.publicAccessEnabled === "boolean" &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    isZonedDateTime(value.changedAt) &&
    (value.reason === null || isBoundedString(value.reason, 1, 2000)) &&
    (value.auditEventId === null || isBoundedString(value.auditEventId, 1, 128))
  );
}

const contentStates = new Set([
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "published",
  "superseded",
  "withdrawn",
]);

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1;
}

function isFortuneDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

function isOpaqueId(value: unknown): value is string {
  return isBoundedString(value, 1, 128);
}

function isContentVersion(value: unknown): value is string {
  const hasForbiddenControl =
    typeof value === "string" &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    });
  return isBoundedString(value, 1, 128) && value.trim() === value && !hasForbiddenControl;
}

function isContentState(value: unknown): boolean {
  return typeof value === "string" && contentStates.has(value);
}

function isDraftModules(value: unknown): value is ContentDraft["modules"] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "calendar_algorithm",
      "copy_and_formula",
      "poster_consistency",
      "visual_and_rights",
    ])
  ) {
    return false;
  }
  return DRAFT_MODULE_CODES.every(
    (code) => value[code] === null || isDraftModuleUpdate(code, value[code]),
  );
}

function isContentDraft(value: unknown): value is ContentDraft {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "createdAt",
      "draftId",
      "draftRevision",
      "fortuneDate",
      "modules",
      "state",
      "updatedAt",
    ]) &&
    isOpaqueId(value.draftId) &&
    isFortuneDate(value.fortuneDate) &&
    value.state === "draft" &&
    isPositiveInteger(value.draftRevision) &&
    isDraftModules(value.modules) &&
    isZonedDateTime(value.createdAt) &&
    isZonedDateTime(value.updatedAt)
  );
}

function isContentDraftSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "createdAt",
      "draftId",
      "draftRevision",
      "fortuneDate",
      "state",
      "updatedAt",
    ]) &&
    isOpaqueId(value.draftId) &&
    isFortuneDate(value.fortuneDate) &&
    value.state === "draft" &&
    isPositiveInteger(value.draftRevision) &&
    isZonedDateTime(value.createdAt) &&
    isZonedDateTime(value.updatedAt)
  );
}

function isContentDraftList(value: unknown): value is ContentDraftList {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["items"]) &&
    Array.isArray(value.items) &&
    value.items.every(isContentDraftSummary)
  );
}

function isUpdatedDraftModule(value: unknown): value is UpdatedDraftModule {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["draftId", "draftRevision", "module", "moduleCode"]) &&
    isOpaqueId(value.draftId) &&
    isPositiveInteger(value.draftRevision) &&
    isDraftModuleCode(value.moduleCode) &&
    isDraftModuleUpdate(value.moduleCode, value.module)
  );
}

function isSubmitDraftResult(value: unknown): value is SubmitDraftResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["contentVersion", "draftId", "lifecycleRevision", "state"]) &&
    isOpaqueId(value.draftId) &&
    isContentVersion(value.contentVersion) &&
    value.state === "in_review" &&
    isPositiveInteger(value.lifecycleRevision)
  );
}

function isContentVersionSummary(value: unknown): value is ContentVersionSummary {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "contentVersion",
      "createdAt",
      "effectiveFrom",
      "effectiveTo",
      "lifecycleRevision",
      "state",
    ]) &&
    isContentVersion(value.contentVersion) &&
    isContentState(value.state) &&
    isPositiveInteger(value.lifecycleRevision) &&
    isZonedDateTime(value.createdAt) &&
    (value.effectiveFrom === null || isZonedDateTime(value.effectiveFrom)) &&
    (value.effectiveTo === null || isZonedDateTime(value.effectiveTo))
  );
}

function isContentVersionList(value: unknown): value is ContentVersionList {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["activeContentVersion", "fortuneDate", "items"]) &&
    isFortuneDate(value.fortuneDate) &&
    (value.activeContentVersion === null || isContentVersion(value.activeContentVersion)) &&
    Array.isArray(value.items) &&
    value.items.every(isContentVersionSummary)
  );
}

function isEvidenceReference(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["kind", "reference"]) &&
    ["attachment", "message_link", "document", "note"].includes(String(value.kind)) &&
    isBoundedString(value.reference, 1, 500)
  );
}

function isMasterReviewEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "conclusion",
      "evidenceId",
      "notes",
      "references",
      "reviewedAt",
      "reviewerDisplayName",
    ]) &&
    isOpaqueId(value.evidenceId) &&
    isBoundedString(value.reviewerDisplayName, 1, 80) &&
    isZonedDateTime(value.reviewedAt) &&
    (value.conclusion === "confirmed" || value.conclusion === "changes_requested") &&
    isBoundedString(value.notes, 0, 2000) &&
    Array.isArray(value.references) &&
    value.references.length >= 1 &&
    value.references.length <= 20 &&
    value.references.every(isEvidenceReference)
  );
}

function isPreflightCheck(value: unknown): boolean {
  const codes = [
    "calendar_algorithm",
    "calendar_golden_data",
    "master_review_evidence",
    "copy_and_formula",
    "required_images",
    "visual_and_rights",
    "ai_label",
    "poster_consistency",
    "reference_integrity",
  ];
  return (
    isRecord(value) &&
    hasExactKeys(value, ["code", "message", "status"]) &&
    codes.includes(String(value.code)) &&
    ["pending", "passed", "failed"].includes(String(value.status)) &&
    isBoundedString(value.message, 0, 300)
  );
}

function isAdminContentVersion(value: unknown): value is AdminContentVersion {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "activeContentVersion",
      "contentVersion",
      "fortuneDate",
      "lifecycleRevision",
      "masterReviewEvidence",
      "preflightChecks",
      "snapshot",
      "state",
    ]) &&
    isContentVersion(value.contentVersion) &&
    isFortuneDate(value.fortuneDate) &&
    isContentState(value.state) &&
    isPositiveInteger(value.lifecycleRevision) &&
    (value.activeContentVersion === null || isContentVersion(value.activeContentVersion)) &&
    isDraftModules(value.snapshot) &&
    Array.isArray(value.preflightChecks) &&
    value.preflightChecks.every(isPreflightCheck) &&
    Array.isArray(value.masterReviewEvidence) &&
    value.masterReviewEvidence.every(isMasterReviewEvidence)
  );
}

function isLifecycleActionResult(value: unknown): value is LifecycleActionResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "activeContentVersion",
      "auditEventId",
      "contentVersion",
      "fortuneDate",
      "lifecycleRevision",
      "state",
      "transitions",
    ]) &&
    isFortuneDate(value.fortuneDate) &&
    isContentVersion(value.contentVersion) &&
    isContentState(value.state) &&
    isPositiveInteger(value.lifecycleRevision) &&
    (value.activeContentVersion === null || isContentVersion(value.activeContentVersion)) &&
    isOpaqueId(value.auditEventId) &&
    Array.isArray(value.transitions) &&
    value.transitions.length >= 1 &&
    value.transitions.every(
      (transition) =>
        isRecord(transition) &&
        hasExactKeys(transition, ["contentVersion", "fromState", "toState"]) &&
        isContentVersion(transition.contentVersion) &&
        isContentState(transition.fromState) &&
        isContentState(transition.toState),
    )
  );
}

function parseRetryAfter(response: Response): number | null {
  const rawValue = response.headers.get("Retry-After");
  if (rawValue === null) return null;
  const seconds = Number.parseInt(rawValue, 10);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

function readValidRequestId(response: Response): string | null {
  const requestId = response.headers.get("X-Request-Id");
  return isBoundedString(requestId, 8, 128) ? requestId : null;
}

function hasNoStoreHeader(response: Response): boolean {
  return response.headers.get("Cache-Control")?.trim().toLowerCase() === "no-store";
}

function hasJsonMediaType(response: Response): boolean {
  const contentType = response.headers.get("Content-Type");
  return (
    isBoundedString(contentType, 1, 256) &&
    contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function hasStrongEmergencyControlEtag(response: Response): boolean {
  const etag = response.headers.get("ETag");
  return isBoundedString(etag, 1, 128) && /^"emergency-control:(?:0|[1-9]\d*)"$/u.test(etag);
}

function hasStrongDraftEtag(response: Response): boolean {
  const etag = response.headers.get("ETag");
  return isBoundedString(etag, 1, 128) && /^"draft:[1-9]\d*"$/u.test(etag);
}

function hasStrongLifecycleEtag(response: Response): boolean {
  const etag = response.headers.get("ETag");
  return isBoundedString(etag, 1, 128) && /^"lifecycle:[1-9]\d*"$/u.test(etag);
}

type SuccessHeaderRequirements = {
  draftEtag?: boolean;
  emergencyControlEtag?: boolean;
  lifecycleEtag?: boolean;
};

async function readContractError(
  response: Response,
  requestId: string | null,
): Promise<Pick<AdminApiError, "code" | "details" | "retryable"> | null> {
  if (requestId === null || !hasNoStoreHeader(response) || !hasJsonMediaType(response)) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !hasExactKeys(body, ["error"]) || !isRecord(body.error)) return null;
  const error = body.error;
  if (
    !hasExactKeys(error, ["code", "details", "message", "requestId", "retryable"]) ||
    !isErrorCode(error.code) ||
    !isRecord(error.details) ||
    !isBoundedString(error.message, 1, 500) ||
    error.requestId !== requestId ||
    typeof error.retryable !== "boolean"
  ) {
    return null;
  }
  return { code: error.code, details: error.details, retryable: error.retryable };
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  expectedStatus: number,
  validator: Validator<T>,
  headerRequirements: SuccessHeaderRequirements = {},
): Promise<AdminApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });
  } catch {
    return {
      error: { kind: "api-error", requestId: null, retryAfterSeconds: null, status: 0 },
      ok: false,
    };
  }

  const requestId = readValidRequestId(response);
  if (response.status !== expectedStatus) {
    const contractError = await readContractError(response, requestId);
    return {
      error: {
        ...(contractError ?? {}),
        kind: "api-error",
        requestId,
        retryAfterSeconds: parseRetryAfter(response),
        status: response.status,
      },
      ok: false,
    };
  }

  if (
    requestId === null ||
    !hasNoStoreHeader(response) ||
    !hasJsonMediaType(response) ||
    (headerRequirements.draftEtag === true && !hasStrongDraftEtag(response)) ||
    (headerRequirements.emergencyControlEtag === true &&
      !hasStrongEmergencyControlEtag(response)) ||
    (headerRequirements.lifecycleEtag === true && !hasStrongLifecycleEtag(response))
  ) {
    return {
      error: { kind: "api-error", requestId, retryAfterSeconds: null, status: 502 },
      ok: false,
    };
  }

  const body: unknown = await response.json().catch(() => null);
  if (!validator(body)) {
    return {
      error: { kind: "api-error", requestId, retryAfterSeconds: null, status: 502 },
      ok: false,
    };
  }

  return { data: body, ok: true, response };
}

async function requestEmpty(path: string, init: RequestInit): Promise<AdminApiResult<null>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });
  } catch {
    return {
      error: { kind: "api-error", requestId: null, retryAfterSeconds: null, status: 0 },
      ok: false,
    };
  }

  if (response.status !== 204) {
    return {
      error: {
        kind: "api-error",
        requestId: readValidRequestId(response),
        retryAfterSeconds: parseRetryAfter(response),
        status: response.status,
      },
      ok: false,
    };
  }
  const requestId = readValidRequestId(response);
  if (requestId === null || !hasNoStoreHeader(response)) {
    return {
      error: { kind: "api-error", requestId, retryAfterSeconds: null, status: 502 },
      ok: false,
    };
  }
  return { data: null, ok: true, response };
}

function jsonBody(value: unknown): Pick<RequestInit, "body" | "headers"> {
  return {
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  };
}

export function describeAdminApiError(error: AdminApiError, authenticated = false): string {
  if (error.status === 0) return "无法连接后台服务，请检查网络后重试。";
  if (error.status === 401) {
    return authenticated ? "后台会话已失效，请重新登录。" : "账号、密码、动态码或恢复凭据无效。";
  }
  if (error.status === 403) return "安全校验未通过，请刷新页面后重新登录。";
  if (error.status === 409) return "动态码已使用或操作状态已经变化，请刷新后使用新的动态码。";
  if (error.status === 412) return "页面中的状态已过期，请刷新最新状态后再操作。";
  if (error.status === 422) return "必审检查或大师凭证尚未通过，请按页面提示补全后重试。";
  if (error.status === 428) return "缺少最新状态凭据，请刷新页面后再操作。";
  if (error.status === 429) {
    return error.retryAfterSeconds === null
      ? "尝试次数较多，请稍后再试。"
      : `尝试次数较多，请 ${error.retryAfterSeconds} 秒后再试。`;
  }
  if (error.status === 503) return "后台服务暂时不可用，请稍后重试。";
  if (error.status === 502) return "后台返回了无法确认的响应，请勿继续操作并稍后重试。";
  if (error.status === 400) return "请检查输入格式后重试。";
  return "操作没有完成，请稍后重试。";
}

export function describeAdminContentApiError(error: AdminApiError): string {
  if (error.code === "ACTIVE_CONTENT_VERSION_CHANGED") {
    return "当前在线版本已经变化，请重新读取同日版本后再操作。";
  }
  if (error.code === "IDEMPOTENCY_KEY_REUSED") {
    return "安全操作编号已用于另一项内容，请重新读取状态后开始新操作。";
  }
  if (error.code === "INVALID_STATE_TRANSITION") {
    return "当前内容状态不允许这项操作，请重新读取最新状态。";
  }
  if (error.code === "VERSION_WITHDRAWN") {
    return "已下线版本不能直接发布或恢复，请复制为新草稿重新核对。";
  }
  if (error.code === "REVISION_MISMATCH") {
    return "页面中的生命周期修订已过期，请重新读取后再操作。";
  }
  if (error.code === "PUBLISH_PRECHECK_FAILED") {
    return "发布预检未通过，请按上方检查清单处理失败项后重试。";
  }
  if (error.code === "SCHEDULE_TIME_INVALID") {
    return "服务端返回的生效时间已失效或不符合内容有效区间，请重新读取。";
  }
  if (error.code === "PRECONDITION_REQUIRED") {
    return "缺少最新生命周期凭据，请重新读取这份版本。";
  }
  if (error.status === 404) return "没有找到这份草稿或内容版本，请返回工作台重新查询。";
  if (error.status === 409) return "内容状态已经变化或存在冲突，请重新读取最新版本后操作。";
  return describeAdminApiError(error, true);
}

export function describeAdminImageApiError(error: AdminApiError): string {
  if (error.status === 413) return "图片文件过大，请压缩到上传限制以内后重试。";
  if (error.status === 415) return "图片格式不支持，请改用 AVIF、WebP、JPEG 或 PNG。";
  if (error.status === 422) return "图片元数据、权利状态或人工检查尚未满足要求。";
  return describeAdminContentApiError(error);
}

type LifecycleActionInput<TBody> = {
  body: TBody;
  contentVersion: string;
  csrfToken: string;
  etag: string;
  idempotencyKey: string;
};

function requestLifecycleAction<TBody>(path: string, input: LifecycleActionInput<TBody>) {
  return requestJson(
    path,
    {
      ...jsonBody(input.body),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
        "If-Match": input.etag,
        "X-CSRF-Token": input.csrfToken,
      },
      method: "POST",
    },
    200,
    isLifecycleActionResult,
    { lifecycleEtag: true },
  );
}

export const adminApi = {
  addMasterReviewEvidence(input: {
    body: AddMasterReviewEvidenceRequest;
    contentVersion: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/master-review-evidence`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isAdminContentVersion,
      { lifecycleEtag: true },
    );
  },
  cancelContentSchedule(input: LifecycleActionInput<ExpectedActiveVersionRequest>) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/cancel-schedule`,
      input,
    );
  },
  completeRecovery(input: CompleteRecoveryRequest) {
    return requestJson(
      "/admin/api/v1/auth/recovery-completions",
      { ...jsonBody(input), method: "POST" },
      201,
      isRecoveryCompletion,
    );
  },
  createPasswordChallenge(input: CreatePasswordChallengeRequest) {
    return requestJson(
      "/admin/api/v1/auth/password-challenges",
      { ...jsonBody(input), method: "POST" },
      200,
      isPasswordChallenge,
    );
  },
  createDraft(input: { csrfToken: string; input: CreateDraftRequest }) {
    return requestJson(
      "/admin/api/v1/daily-content-drafts",
      {
        ...jsonBody(input.input),
        headers: { "Content-Type": "application/json", "X-CSRF-Token": input.csrfToken },
        method: "POST",
      },
      201,
      isContentDraft,
      { draftEtag: true },
    );
  },
  createRecoveryChallenge(input: CreateRecoveryChallengeRequest) {
    return requestJson(
      "/admin/api/v1/auth/recovery-challenges",
      { ...jsonBody(input), method: "POST" },
      200,
      isRecoveryChallenge,
    );
  },
  createSession(input: CreateAdminSessionRequest) {
    return requestJson(
      "/admin/api/v1/auth/sessions",
      { ...jsonBody(input), method: "POST" },
      201,
      isAdminSession,
    );
  },
  getEmergencyStatus() {
    return requestJson(
      "/admin/api/v1/emergency-control",
      { method: "GET" },
      200,
      isEmergencyControlStatus,
      { emergencyControlEtag: true },
    );
  },
  getContentVersion(contentVersion: string) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(contentVersion)}`,
      { method: "GET" },
      200,
      isAdminContentVersion,
      { lifecycleEtag: true },
    );
  },
  getDailyImageSet(contentVersion: string) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(contentVersion)}/daily-image-set`,
      { method: "GET" },
      200,
      isAdminDailyImageSet,
      { lifecycleEtag: true },
    );
  },
  getDraft(draftId: string) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(draftId)}`,
      { method: "GET" },
      200,
      isContentDraft,
      { draftEtag: true },
    );
  },
  getSession() {
    return requestJson("/admin/api/v1/auth/session", { method: "GET" }, 200, isAdminSession);
  },
  listSecurityEvents(cursor: string | null) {
    const search = new URLSearchParams({ limit: "50" });
    if (cursor !== null) search.set("cursor", cursor);
    return requestJson(
      `/admin/api/v1/security-events?${search.toString()}`,
      { method: "GET" },
      200,
      isSecurityEventPage,
    );
  },
  listContentVersions(fortuneDate: string) {
    const search = new URLSearchParams({ fortuneDate });
    return requestJson(
      `/admin/api/v1/daily-content-versions?${search.toString()}`,
      { method: "GET" },
      200,
      isContentVersionList,
    );
  },
  listDraftImages(draftId: string) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(draftId)}/image-assets`,
      { method: "GET" },
      200,
      isDraftImageAssetList,
      { draftEtag: true },
    );
  },
  listDrafts(fortuneDate: string | null = null) {
    const search = new URLSearchParams();
    if (fortuneDate !== null) search.set("fortuneDate", fortuneDate);
    const query = search.size === 0 ? "" : `?${search.toString()}`;
    return requestJson(
      `/admin/api/v1/daily-content-drafts${query}`,
      { method: "GET" },
      200,
      isContentDraftList,
    );
  },
  logout(csrfToken: string) {
    return requestEmpty("/admin/api/v1/auth/session", {
      headers: { "X-CSRF-Token": csrfToken },
      method: "DELETE",
    });
  },
  logoutAll(csrfToken: string) {
    return requestEmpty("/admin/api/v1/auth/logout-all", {
      headers: { "X-CSRF-Token": csrfToken },
      method: "POST",
    });
  },
  publishContentVersion(input: LifecycleActionInput<ExpectedActiveVersionRequest>) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/publish`,
      input,
    );
  },
  setEmergencyStatus(input: {
    body: EmergencyResumeRequest | EmergencyStopRequest;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
    operation: "resume" | "stop";
  }) {
    return requestJson(
      `/admin/api/v1/emergency-control/${input.operation}`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isEmergencyControlStatus,
      { emergencyControlEtag: true },
    );
  },
  reviewDraftImage(input: {
    assetId: string;
    body: ImageAssetReviewRequest;
    csrfToken: string;
    draftId: string;
    etag: string;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(input.draftId)}/image-assets/${encodeURIComponent(input.assetId)}/review`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isDraftImageAssetResult,
      { draftEtag: true },
    );
  },
  rollbackContentDay(input: LifecycleActionInput<RollbackRequest> & { fortuneDate: string }) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-days/${encodeURIComponent(input.fortuneDate)}/rollback`,
      input,
    );
  },
  scheduleContentVersion(input: LifecycleActionInput<ScheduleRequest>) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/schedule`,
      input,
    );
  },
  submitDraft(input: { csrfToken: string; draftId: string; etag: string; idempotencyKey: string }) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(input.draftId)}/submit`,
      {
        headers: {
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      201,
      isSubmitDraftResult,
      { lifecycleEtag: true },
    );
  },
  updateDraftModule(input: {
    csrfToken: string;
    draftId: string;
    etag: string;
    module: DraftModuleUpdate;
    moduleCode: DraftModuleCode;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(input.draftId)}/modules/${input.moduleCode}`,
      {
        ...jsonBody(input.module),
        headers: {
          "Content-Type": "application/json",
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "PATCH",
      },
      200,
      isUpdatedDraftModule,
      { draftEtag: true },
    );
  },
  uploadDraftImage(input: {
    csrfToken: string;
    draftId: string;
    etag: string;
    formData: FormData;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(input.draftId)}/image-assets`,
      {
        body: input.formData,
        headers: {
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      201,
      isDraftImageAssetResult,
      { draftEtag: true },
    );
  },
  withdrawImage(input: {
    assetId: string;
    body: WithdrawImageAssetRequest;
    contentVersion: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/image-assets/${encodeURIComponent(input.assetId)}/withdraw`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isImageAssetWithdrawalResult,
      { lifecycleEtag: true },
    );
  },
  withdrawContentVersion(input: LifecycleActionInput<WithdrawRequest>) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/withdraw`,
      input,
    );
  },
  decideContentReview(input: {
    body: ReviewDecisionRequest;
    contentVersion: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/review-decision`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isLifecycleActionResult,
      { lifecycleEtag: true },
    );
  },
};

export function parseDraftModuleJson(
  moduleCode: DraftModuleCode,
  source: string,
): { ok: true; value: DraftModuleUpdate } | { message: string; ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { message: "内容不是有效 JSON，请检查括号、引号与逗号。", ok: false };
  }
  if (!isDraftModuleUpdate(moduleCode, parsed)) {
    return {
      message: `模块结构不符合接口契约。顶层字段应为：${DRAFT_MODULE_REQUIRED_KEYS[moduleCode].join("、")}。`,
      ok: false,
    };
  }
  return { ok: true, value: parsed };
}

export function createIdempotencyKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random number generation is unavailable");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
