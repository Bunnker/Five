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

export async function loadDaily({
  apiOrigin = getPublicApiOrigin(),
  expectedContentVersion = null,
  fortuneDate,
  requestId,
  timeoutMs = DEFAULT_PUBLIC_REQUEST_TIMEOUT_MS,
}: LoadDailyOptions): Promise<DailyLandingData | null> {
  if (
    !isPublicFortuneDate(fortuneDate) ||
    (expectedContentVersion !== null && !isOpaquePublicValue(expectedContentVersion))
  ) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = new URL(`/api/v1/daily/${encodeURIComponent(fortuneDate)}`, apiOrigin);
    if (expectedContentVersion !== null) {
      endpoint.searchParams.set("expectedContentVersion", expectedContentVersion);
    }

    const response = await fetch(endpoint.toString(), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-request-id": resolvePublicRequestId(requestId),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }

    const body: unknown = await response.json();
    const responseContentVersion = response.headers.get("x-content-version");
    if (
      !isRecord(body) ||
      body.requestedFortuneDate !== fortuneDate ||
      !isRecord(body.content) ||
      !isRecord(body.content.versions) ||
      !isOpaquePublicValue(responseContentVersion) ||
      body.content.versions.contentVersion !== responseContentVersion ||
      !hasConsistentResolution(body.resolution, expectedContentVersion, responseContentVersion)
    ) {
      return null;
    }

    const dailyContent = parsePublicDailyContent(body.content, responseContentVersion);
    if (dailyContent === null || dailyContent.content.fortuneDate !== fortuneDate) {
      return null;
    }

    return {
      ...dailyContent,
      versionChanged: body.resolution.versionChanged,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
