import type { components as FiveApiComponents } from "@five/api-contract";

export type AdminSession = FiveApiComponents["schemas"]["AdminSession"];
export type EmergencyControlStatus = FiveApiComponents["schemas"]["EmergencyControlStatus"];
export type PasswordChallenge = FiveApiComponents["schemas"]["PasswordChallenge"];
export type RecoveryChallenge = FiveApiComponents["schemas"]["RecoveryChallenge"];
export type RecoveryCompletion = FiveApiComponents["schemas"]["RecoveryCompletion"];
export type SecurityEventPage = FiveApiComponents["schemas"]["SecurityEventPage"];
export type SecurityEvent = SecurityEventPage["items"][number];

type CompleteRecoveryRequest = FiveApiComponents["schemas"]["CompleteRecoveryRequest"];
type CreateAdminSessionRequest = FiveApiComponents["schemas"]["CreateAdminSessionRequest"];
type CreatePasswordChallengeRequest =
  FiveApiComponents["schemas"]["CreatePasswordChallengeRequest"];
type CreateRecoveryChallengeRequest =
  FiveApiComponents["schemas"]["CreateRecoveryChallengeRequest"];
type EmergencyResumeRequest = FiveApiComponents["schemas"]["EmergencyResumeRequest"];
type EmergencyStopRequest = FiveApiComponents["schemas"]["EmergencyStopRequest"];

export type AdminApiError = {
  kind: "api-error";
  requestId: string | null;
  retryAfterSeconds: number | null;
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

type SuccessHeaderRequirements = {
  emergencyControlEtag?: boolean;
};

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
    return {
      error: {
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
    (headerRequirements.emergencyControlEtag === true && !hasStrongEmergencyControlEtag(response))
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

export const adminApi = {
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
};

export function createIdempotencyKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random number generation is unavailable");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
