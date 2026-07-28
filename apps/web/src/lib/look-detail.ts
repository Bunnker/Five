import type { FiveApiPaths } from "./api-contract";
import { isReviewedColorCode, type ReviewedColorCode } from "./color-palette";
import {
  DEFAULT_PUBLIC_REQUEST_TIMEOUT_MS,
  getPublicApiOrigin,
  resolvePublicRequestId,
} from "./public-api-client";
import { isSafeImageCopy } from "./public-content-safety";
import {
  isMember,
  isOpaquePublicValue as isOpaqueValue,
  isPublicCode as isSafeCode,
  isRecord,
  parsePublicImage,
  parseUniquePublicImages,
  publicGarmentCategories as garmentCategories,
  publicImageResourceIdentity,
  type PublicImageData,
} from "./public-response-validation";

type LookDetailResponse =
  FiveApiPaths["/api/v1/daily/{fortuneDate}/looks/{lookId}"]["get"]["responses"][200]["content"]["application/json"];
type PublicLook = LookDetailResponse["look"];

export type LookDetailImageData = PublicImageData;

export interface LookDetailItemData {
  category: PublicLook["items"][number]["category"];
  categoryLabel: string;
  colorCode: ReviewedColorCode;
  description: string;
}

export interface LookDetailData {
  alternatives: Array<{
    description: string;
    replaceCategory: string;
  }>;
  audienceLabel: string;
  contentVersion: LookDetailResponse["contentVersion"];
  coverImage: LookDetailImageData;
  detailImages: LookDetailImageData[];
  formulaId: string;
  fortuneDate: LookDetailResponse["fortuneDate"];
  items: LookDetailItemData[];
  lookId: string;
  scenarioLabel: string;
  title: string;
}

export type LookDetailLoadResult =
  | {
      detail: LookDetailData;
      status: "ready";
    }
  | {
      status: "invalid" | "missing" | "stale" | "unavailable";
    };

export interface LoadLookDetailOptions {
  apiOrigin?: string;
  expectedContentVersion: string;
  fortuneDate: string;
  lookId: string;
  requestId?: string | null;
  timeoutMs?: number;
}

const fortuneDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

async function isContentVersionChangedResponse(
  response: Response,
  expectedContentVersion: string,
): Promise<boolean> {
  const contentType = response.headers.get("content-type");
  const currentContentVersion = response.headers.get("x-content-version");
  const responseRequestId = response.headers.get("x-request-id");
  if (
    contentType === null ||
    !contentType.toLowerCase().includes("application/json") ||
    !isOpaqueValue(currentContentVersion) ||
    currentContentVersion === expectedContentVersion ||
    !isOpaqueValue(responseRequestId) ||
    responseRequestId.length < 8
  ) {
    return false;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return false;
  }

  if (!isRecord(body) || !isRecord(body.error)) {
    return false;
  }

  const { error } = body;
  if (!isRecord(error.details)) {
    return false;
  }
  const { details } = error;
  return (
    error.code === "CONTENT_VERSION_CHANGED" &&
    typeof error.message === "string" &&
    error.message.trim().length > 0 &&
    error.message.length <= 500 &&
    error.retryable === true &&
    error.requestId === responseRequestId &&
    details.expectedContentVersion === expectedContentVersion &&
    details.currentContentVersion === currentContentVersion
  );
}

function toItems(value: unknown): LookDetailItemData[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    return null;
  }

  const items: LookDetailItemData[] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !isMember(garmentCategories, candidate.category) ||
      !isSafeImageCopy(candidate.categoryLabel, 32) ||
      !isReviewedColorCode(candidate.colorCode) ||
      !isSafeImageCopy(candidate.description, 120)
    ) {
      return null;
    }

    items.push({
      category: candidate.category,
      categoryLabel: candidate.categoryLabel,
      colorCode: candidate.colorCode,
      description: candidate.description,
    });
  }
  return items;
}

function toAlternatives(value: unknown): LookDetailData["alternatives"] | null {
  if (!Array.isArray(value) || value.length > 12) {
    return null;
  }

  const alternatives: LookDetailData["alternatives"] = [];
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !isSafeImageCopy(candidate.replaceCategory, 64) ||
      !isSafeImageCopy(candidate.description, 200)
    ) {
      return null;
    }
    alternatives.push({
      description: candidate.description,
      replaceCategory: candidate.replaceCategory,
    });
  }
  return alternatives;
}

function toLookDetail(
  body: unknown,
  expected: Pick<LoadLookDetailOptions, "expectedContentVersion" | "fortuneDate" | "lookId">,
  responseContentVersion: string | null,
): LookDetailData | null {
  if (
    !isRecord(body) ||
    body.fortuneDate !== expected.fortuneDate ||
    body.contentVersion !== expected.expectedContentVersion ||
    responseContentVersion !== expected.expectedContentVersion ||
    !isRecord(body.look) ||
    body.look.lookId !== expected.lookId ||
    !isOpaqueValue(body.look.formulaId) ||
    typeof body.look.requiredForPublish !== "boolean" ||
    !Number.isInteger(body.look.sortOrder) ||
    Number(body.look.sortOrder) < 1 ||
    Number(body.look.sortOrder) > 3 ||
    !isSafeImageCopy(body.look.title, 80) ||
    !isRecord(body.look.scenario) ||
    !isSafeCode(body.look.scenario.code) ||
    !isSafeImageCopy(body.look.scenario.label, 32) ||
    !isRecord(body.look.audience) ||
    !isSafeCode(body.look.audience.code) ||
    !isSafeImageCopy(body.look.audience.label, 32)
  ) {
    return null;
  }

  const coverImage = parsePublicImage(body.look.coverImage);
  const detailImages = parseUniquePublicImages(body.look.detailImages, 4);
  const items = toItems(body.look.items);
  const alternatives = toAlternatives(body.look.alternatives);
  if (coverImage === null || detailImages === null || items === null || alternatives === null) {
    return null;
  }
  const coverResourceUrl = publicImageResourceIdentity(coverImage.url);
  if (
    detailImages.some((image) => {
      return (
        image.assetId === coverImage.assetId ||
        publicImageResourceIdentity(image.url) === coverResourceUrl
      );
    })
  ) {
    return null;
  }

  return {
    alternatives,
    audienceLabel: body.look.audience.label,
    contentVersion: body.contentVersion,
    coverImage,
    detailImages,
    formulaId: body.look.formulaId,
    fortuneDate: body.fortuneDate,
    items,
    lookId: body.look.lookId,
    scenarioLabel: body.look.scenario.label,
    title: body.look.title,
  };
}

export async function loadLookDetail({
  apiOrigin = getPublicApiOrigin(),
  expectedContentVersion,
  fortuneDate,
  lookId,
  requestId,
  timeoutMs = DEFAULT_PUBLIC_REQUEST_TIMEOUT_MS,
}: LoadLookDetailOptions): Promise<LookDetailLoadResult> {
  if (
    !fortuneDatePattern.test(fortuneDate) ||
    !isOpaqueValue(expectedContentVersion) ||
    !isOpaqueValue(lookId)
  ) {
    return { status: "invalid" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const pathname = `/api/v1/daily/${encodeURIComponent(fortuneDate)}/looks/${encodeURIComponent(lookId)}`;
    const endpoint = new URL(pathname, apiOrigin);
    endpoint.searchParams.set("expectedContentVersion", expectedContentVersion);
    const response = await fetch(endpoint.toString(), {
      cache: "no-store",
      headers: {
        accept: "application/json",
        "x-request-id": resolvePublicRequestId(requestId),
      },
      signal: controller.signal,
    });

    if (response.status === 409) {
      return (await isContentVersionChangedResponse(response, expectedContentVersion))
        ? { status: "stale" }
        : { status: "unavailable" };
    }
    if (response.status === 404) {
      return { status: "missing" };
    }
    if (response.status === 400) {
      return { status: "invalid" };
    }
    if (!response.ok) {
      return { status: "unavailable" };
    }

    const body: unknown = await response.json();
    const detail = toLookDetail(
      body,
      { expectedContentVersion, fortuneDate, lookId },
      response.headers.get("x-content-version"),
    );
    return detail === null ? { status: "unavailable" } : { detail, status: "ready" };
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
