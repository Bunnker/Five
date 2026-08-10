import type { FiveApiPaths } from "./api-contract";
import {
  hasAsciiControlCharacter,
  isSafeImageCopy,
  reviewedAiImageDisclosure,
} from "./public-content-safety";

type TodayResponse =
  FiveApiPaths["/api/v1/today"]["get"]["responses"][200]["content"]["application/json"];

export type PublicImageData = TodayResponse["content"]["looks"][number]["coverImage"];

export const publicGarmentCategories = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "bag",
  "accessory",
] as const;

const publicImageMediaTypes = ["image/avif", "image/webp", "image/jpeg", "image/png"] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isOpaquePublicValue(value: unknown, maxLength = 128): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !hasAsciiControlCharacter(value)
  );
}

export function isPublicCode(value: unknown): value is string {
  return isOpaquePublicValue(value, 64);
}

export function isMember<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function isSafePublicImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
    return false;
  }

  try {
    if (value.startsWith("//")) return false;
    const url = new URL(value, "https://five.invalid");
    const sameOriginPath = value.startsWith("/");
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      (!sameOriginPath || url.origin === "https://five.invalid")
    );
  } catch {
    return false;
  }
}

export function publicImageResourceIdentity(value: string): string {
  const url = new URL(value, "https://five.invalid");
  url.hash = "";
  return url.href;
}

export function parsePublicImage(value: unknown): PublicImageData | null {
  if (
    !isRecord(value) ||
    !isOpaquePublicValue(value.assetId) ||
    !isSafePublicImageUrl(value.url) ||
    !Number.isInteger(value.width) ||
    Number(value.width) < 1 ||
    !Number.isInteger(value.height) ||
    Number(value.height) < 1 ||
    !isMember(publicImageMediaTypes, value.mediaType) ||
    !isSafeImageCopy(value.altText, 300) ||
    typeof value.aiGenerated !== "boolean"
  ) {
    return null;
  }

  if (
    (value.aiGenerated && value.aiDisclosure !== reviewedAiImageDisclosure) ||
    (!value.aiGenerated && value.aiDisclosure !== null)
  ) {
    return null;
  }

  return {
    aiDisclosure: value.aiGenerated ? reviewedAiImageDisclosure : null,
    aiGenerated: value.aiGenerated,
    altText: value.altText,
    assetId: value.assetId,
    height: Number(value.height),
    mediaType: value.mediaType,
    url: value.url,
    width: Number(value.width),
  };
}

export function parseUniquePublicImages(
  value: unknown,
  maxLength: number,
): PublicImageData[] | null {
  if (!Array.isArray(value) || value.length > maxLength) {
    return null;
  }

  const images: PublicImageData[] = [];
  const assetIds = new Set<string>();
  const resourceUrls = new Set<string>();
  for (const candidate of value) {
    const image = parsePublicImage(candidate);
    if (image === null) {
      return null;
    }

    const resourceUrl = publicImageResourceIdentity(image.url);
    if (assetIds.has(image.assetId) || resourceUrls.has(resourceUrl)) {
      return null;
    }
    assetIds.add(image.assetId);
    resourceUrls.add(resourceUrl);
    images.push(image);
  }

  return images;
}
