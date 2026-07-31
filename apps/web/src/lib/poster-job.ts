import type { FiveApiPaths } from "./api-contract";
import { isMember, isOpaquePublicValue, isRecord } from "./public-response-validation";

type CreatePosterOperation = FiveApiPaths["/api/v1/poster-jobs"]["post"];
export type CreatePosterJobRequest =
  CreatePosterOperation["requestBody"]["content"]["application/json"];
export type PosterJobData = CreatePosterOperation["responses"][200]["content"]["application/json"];

export interface PosterIntent extends CreatePosterJobRequest {
  posterJobEndpoint: "/api/v1/poster-jobs";
  posterTemplateVersion: PosterJobData["posterTemplateVersion"];
}

const posterStatuses = ["processing", "ready", "failed", "version_changed"] as const;
const posterJobKeys = [
  "assetUrl",
  "channelId",
  "currentActiveContentVersion",
  "entry",
  "jobId",
  "posterInstanceId",
  "posterTemplateVersion",
  "sourceContentVersion",
  "status",
] as const;

function hasOnlyPosterJobKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === posterJobKeys.length &&
    keys.every((key) => posterJobKeys.includes(key as never))
  );
}

function isSafePublicUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isExpectedLandingUrl(value: unknown, intent: PosterIntent): value is string {
  if (!isSafePublicUrl(value)) {
    return false;
  }

  const url = new URL(value);
  const entries = [...url.searchParams.entries()];
  return (
    url.pathname === `/daily/${encodeURIComponent(intent.fortuneDate)}` &&
    entries.length === 2 &&
    url.searchParams.getAll("channelId").length === 1 &&
    url.searchParams.get("channelId") === intent.channelId &&
    url.searchParams.getAll("expectedContentVersion").length === 1 &&
    url.searchParams.get("expectedContentVersion") === intent.expectedContentVersion
  );
}

function hasEmptyArtifact(value: Record<string, unknown>): boolean {
  return value.assetUrl === null && value.entry === null && value.posterInstanceId === null;
}

export function parsePosterJob(
  value: unknown,
  intent: PosterIntent,
  expectedJobId?: string,
): PosterJobData | null {
  if (
    !isRecord(value) ||
    !hasOnlyPosterJobKeys(value) ||
    !isOpaquePublicValue(value.jobId) ||
    (expectedJobId !== undefined && value.jobId !== expectedJobId) ||
    !isMember(posterStatuses, value.status) ||
    value.sourceContentVersion !== intent.expectedContentVersion ||
    value.posterTemplateVersion !== intent.posterTemplateVersion ||
    value.channelId !== intent.channelId ||
    (value.currentActiveContentVersion !== null &&
      !isOpaquePublicValue(value.currentActiveContentVersion))
  ) {
    return null;
  }

  if (value.status === "ready") {
    if (
      value.currentActiveContentVersion !== intent.expectedContentVersion ||
      !isOpaquePublicValue(value.posterInstanceId) ||
      !isSafePublicUrl(value.assetUrl) ||
      !isRecord(value.entry) ||
      Object.keys(value.entry).length !== 2 ||
      value.entry.type !== "web_qr" ||
      !isExpectedLandingUrl(value.entry.landingUrl, intent)
    ) {
      return null;
    }
  } else if (!hasEmptyArtifact(value)) {
    return null;
  } else if (
    value.status === "processing" &&
    value.currentActiveContentVersion !== intent.expectedContentVersion
  ) {
    return null;
  } else if (
    value.status === "version_changed" &&
    value.currentActiveContentVersion === intent.expectedContentVersion
  ) {
    return null;
  }

  return value as PosterJobData;
}

export function isPosterVersionChangedError(
  value: unknown,
  intent: PosterIntent,
  responseRequestId: string,
): boolean {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !isRecord(value.error)) {
    return false;
  }

  const error = value.error;
  const errorKeys = Object.keys(error);
  if (
    errorKeys.length !== 5 ||
    !["code", "details", "message", "requestId", "retryable"].every((key) =>
      errorKeys.includes(key),
    ) ||
    error.code !== "CONTENT_VERSION_CHANGED" ||
    error.retryable !== true ||
    error.requestId !== responseRequestId ||
    typeof error.message !== "string" ||
    error.message.length < 1 ||
    error.message.length > 500 ||
    !isRecord(error.details)
  ) {
    return false;
  }

  const currentContentVersion = error.details.currentContentVersion;
  return (
    error.details.expectedContentVersion === intent.expectedContentVersion &&
    (currentContentVersion === null || isOpaquePublicValue(currentContentVersion)) &&
    currentContentVersion !== intent.expectedContentVersion
  );
}

export function buildDailyLandingPath(
  intent: Pick<PosterIntent, "channelId" | "expectedContentVersion" | "fortuneDate">,
): string {
  const searchParams = new URLSearchParams({
    channelId: intent.channelId,
    expectedContentVersion: intent.expectedContentVersion,
  });
  return `/daily/${encodeURIComponent(intent.fortuneDate)}?${searchParams.toString()}`;
}

export function buildPosterPagePath(intent: PosterIntent): string {
  const searchParams = new URLSearchParams({
    channelId: intent.channelId,
    expectedContentVersion: intent.expectedContentVersion,
    fortuneDate: intent.fortuneDate,
    posterTemplateVersion: intent.posterTemplateVersion,
  });
  return `/poster?${searchParams.toString()}`;
}

export function buildSharePagePath(
  intent: Pick<PosterIntent, "channelId" | "expectedContentVersion" | "fortuneDate">,
): string {
  const searchParams = new URLSearchParams({
    channelId: intent.channelId,
    expectedContentVersion: intent.expectedContentVersion,
    fortuneDate: intent.fortuneDate,
  });
  return `/share?${searchParams.toString()}`;
}
