import type { FiveApiPaths } from "./api-contract";
import {
  DEFAULT_PUBLIC_REQUEST_TIMEOUT_MS,
  getPublicApiOrigin,
  resolvePublicRequestId,
} from "./public-api-client";
import { isOpaquePublicValue, isRecord } from "./public-response-validation";
import { isPublicFortuneDate, parsePublicDailyContent, type PublicDailyContentData } from "./today";

type DailyContentResponse =
  FiveApiPaths["/api/v1/daily/{fortuneDate}"]["get"]["responses"][200]["content"]["application/json"];
type VersionResolution = DailyContentResponse["resolution"];

export interface DailyLandingData extends PublicDailyContentData {
  versionChanged: boolean;
}

export type LoadDailyResult =
  { daily: DailyLandingData; kind: "ready" } | { kind: "expired" } | { kind: "unavailable" };

export interface LoadDailyOptions {
  apiOrigin?: string;
  expectedContentVersion?: string | null;
  fortuneDate: string;
  requestId?: string | null;
  timeoutMs?: number;
}

const versionResolutionReasons = [
  "current",
  "replaced",
  "rolled_back",
  "withdrawn",
] as const satisfies readonly VersionResolution["reason"][];

function isVersionResolutionReason(value: unknown): value is VersionResolution["reason"] {
  return versionResolutionReasons.some((reason) => reason === value);
}

function hasConsistentResolution(
  value: unknown,
  expectedContentVersion: string | null,
  servedContentVersion: string,
): value is VersionResolution {
  if (
    !isRecord(value) ||
    value.expectedContentVersion !== expectedContentVersion ||
    value.servedContentVersion !== servedContentVersion ||
    typeof value.versionChanged !== "boolean" ||
    !isVersionResolutionReason(value.reason)
  ) {
    return false;
  }

  if (value.versionChanged) {
    return (
      expectedContentVersion !== null &&
      expectedContentVersion !== servedContentVersion &&
      value.reason !== "current"
    );
  }

  return (
    value.reason === "current" &&
    (expectedContentVersion === null || expectedContentVersion === servedContentVersion)
  );
}

function isJsonResponse(headers: Headers): boolean {
  return headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isHistoricalContentExpiredEnvelope(
  value: unknown,
  responseRequestId: string | null,
  sentRequestId: string,
  fortuneDate: string,
): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.error)) {
    return false;
  }

  const error = value.error;
  return (
    Object.keys(error).length === 5 &&
    error.code === "HISTORICAL_CONTENT_EXPIRED" &&
    isOpaquePublicValue(error.message, 500) &&
    error.retryable === false &&
    isOpaquePublicValue(error.requestId) &&
    error.requestId.length >= 8 &&
    error.requestId === responseRequestId &&
    error.requestId === sentRequestId &&
    isRecord(error.details) &&
    Object.keys(error.details).length === 1 &&
    error.details.fortuneDate === fortuneDate
  );
}

export async function loadDailyResult({
  apiOrigin = getPublicApiOrigin(),
  expectedContentVersion = null,
  fortuneDate,
  requestId,
  timeoutMs = DEFAULT_PUBLIC_REQUEST_TIMEOUT_MS,
}: LoadDailyOptions): Promise<LoadDailyResult> {
  if (
    !isPublicFortuneDate(fortuneDate) ||
    (expectedContentVersion !== null && !isOpaquePublicValue(expectedContentVersion))
  ) {
    return { kind: "unavailable" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = new URL(`/api/v1/daily/${encodeURIComponent(fortuneDate)}`, apiOrigin);
    if (expectedContentVersion !== null) {
      endpoint.searchParams.set("expectedContentVersion", expectedContentVersion);
    }

    const sentRequestId = resolvePublicRequestId(requestId);
    const response = await fetch(endpoint.toString(), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-request-id": sentRequestId,
      },
      signal: controller.signal,
    });
    let body: unknown;
    try {
      body = (await response.json()) as unknown;
    } catch {
      return { kind: "unavailable" };
    }

    if (!response.ok) {
      return response.status === 410 &&
        isJsonResponse(response.headers) &&
        isHistoricalContentExpiredEnvelope(
          body,
          response.headers.get("x-request-id"),
          sentRequestId,
          fortuneDate,
        )
        ? { kind: "expired" }
        : { kind: "unavailable" };
    }

    const responseContentVersion = response.headers.get("x-content-version");
    if (
      !isJsonResponse(response.headers) ||
      !isRecord(body) ||
      body.requestedFortuneDate !== fortuneDate ||
      !isRecord(body.content) ||
      !isRecord(body.content.versions) ||
      !isOpaquePublicValue(responseContentVersion) ||
      body.content.versions.contentVersion !== responseContentVersion ||
      !hasConsistentResolution(body.resolution, expectedContentVersion, responseContentVersion)
    ) {
      return { kind: "unavailable" };
    }

    const dailyContent = parsePublicDailyContent(body.content, responseContentVersion);
    if (dailyContent === null || dailyContent.content.fortuneDate !== fortuneDate) {
      return { kind: "unavailable" };
    }

    return {
      daily: {
        ...dailyContent,
        versionChanged: body.resolution.versionChanged,
      },
      kind: "ready",
    };
  } catch {
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadDaily(options: LoadDailyOptions): Promise<DailyLandingData | null> {
  const result = await loadDailyResult(options);
  return result.kind === "ready" ? result.daily : null;
}
