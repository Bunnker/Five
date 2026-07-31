import type { CompleteTodayPageData, TodaySnapshot } from "./today";
import { resolveTodayContextBoundary } from "./today-refresh-policy";

const CACHE_SCHEMA_VERSION = 1;
export const TODAY_CACHE_KEY_PREFIX = "five:today:v1";
export const TODAY_PENDING_REFRESH_ANCHOR_KEY = `${TODAY_CACHE_KEY_PREFIX}:pending-refresh-anchor`;

export const TODAY_CACHE_POINTER_KEY = `${TODAY_CACHE_KEY_PREFIX}:active`;

type TodayCacheStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

interface TodayCachePointer {
  cacheKey: string;
  contentVersion: string;
  fortuneDate: string;
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
}

interface TodayCacheEnvelope {
  anchorClientMs: number;
  checksum: string;
  contentVersion: string;
  fortuneDate: string;
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  snapshotJson: string;
}

export interface TodaySnapshotCacheHit {
  expiresInMs: number;
  snapshot: TodaySnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFortuneDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function isContentVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 128 &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

function isVersioned(value: unknown, contentVersion: string): value is Record<string, unknown> {
  return isRecord(value) && value.contentVersion === contentVersion;
}

function isCompleteTodayData(
  value: unknown,
  fortuneDate: string,
  contentVersion: string,
): value is CompleteTodayPageData {
  if (
    !isRecord(value) ||
    !isRecord(value.content) ||
    !isRecord(value.requestContext) ||
    value.content.fortuneDate !== fortuneDate ||
    value.requestContext.fortuneDate !== fortuneDate ||
    !isVersioned(value.daJiCard, contentVersion) ||
    !isVersioned(value.ciJiCard, contentVersion) ||
    !isVersioned(value.pingCard, contentVersion) ||
    !isVersioned(value.attentionSection, contentVersion) ||
    !isVersioned(value.outfitPreviewSection, contentVersion) ||
    !isVersioned(value.imagePreviewSection, contentVersion) ||
    !isVersioned(value.basis, contentVersion) ||
    !isVersioned(value.share, contentVersion) ||
    !isVersioned(value.nextSteps, contentVersion)
  ) {
    return false;
  }
  const nextSteps = value.nextSteps as Record<string, unknown>;
  return (
    Array.isArray(value.attentionSection.groups) &&
    value.attentionSection.groups.length === 2 &&
    Array.isArray(value.outfitPreviewSection.cards) &&
    value.outfitPreviewSection.cards.length >= 3 &&
    Array.isArray(value.imagePreviewSection.cards) &&
    value.imagePreviewSection.cards.length >= 2 &&
    value.imagePreviewSection.cards.length <= 3 &&
    ["basisHref", "colorsHref", "outfitsHref", "shareHref"].every(
      (field) => typeof nextSteps[field] === "string" && String(nextSteps[field]).startsWith("/"),
    )
  );
}

function isZonedDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isTodaySnapshot(value: unknown): value is TodaySnapshot {
  if (
    !isRecord(value) ||
    !isFortuneDate(value.fortuneDate) ||
    !isContentVersion(value.contentVersion) ||
    !isZonedDateTime(value.effectiveFrom) ||
    !isZonedDateTime(value.effectiveTo) ||
    !isZonedDateTime(value.responseGeneratedAt) ||
    Date.parse(value.effectiveFrom) >= Date.parse(value.effectiveTo) ||
    (value.serverObservedAtMs !== null &&
      (typeof value.serverObservedAtMs !== "number" ||
        !Number.isFinite(value.serverObservedAtMs) ||
        value.serverObservedAtMs < 0))
  ) {
    return false;
  }
  return isCompleteTodayData(value.data, value.fortuneDate, value.contentVersion);
}

// This checksum detects partial/quota-corrupted local writes. The cache only contains public data,
// so it is an integrity guard rather than an authentication mechanism.
function checksum(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

function parsePointer(value: string): TodayCachePointer | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== 4 ||
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
      !isFortuneDate(parsed.fortuneDate) ||
      !isContentVersion(parsed.contentVersion) ||
      parsed.cacheKey !== todaySnapshotCacheKey(parsed.fortuneDate, parsed.contentVersion)
    ) {
      return null;
    }
    return parsed as unknown as TodayCachePointer;
  } catch {
    return null;
  }
}

function parseEnvelope(
  value: string,
  pointer: TodayCachePointer,
  clientNowMs: number,
): TodaySnapshotCacheHit | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).length !== 6 ||
      parsed.schemaVersion !== CACHE_SCHEMA_VERSION ||
      parsed.fortuneDate !== pointer.fortuneDate ||
      parsed.contentVersion !== pointer.contentVersion ||
      typeof parsed.snapshotJson !== "string" ||
      typeof parsed.checksum !== "string" ||
      checksum(parsed.snapshotJson) !== parsed.checksum ||
      typeof parsed.anchorClientMs !== "number" ||
      !Number.isFinite(parsed.anchorClientMs)
    ) {
      return null;
    }
    const snapshotValue: unknown = JSON.parse(parsed.snapshotJson);
    if (
      !isTodaySnapshot(snapshotValue) ||
      snapshotValue.serverObservedAtMs === null ||
      snapshotValue.fortuneDate !== pointer.fortuneDate ||
      snapshotValue.contentVersion !== pointer.contentVersion
    ) {
      return null;
    }
    const expiresInMs = getTodaySnapshotRemainingMs(
      snapshotValue,
      parsed.anchorClientMs,
      clientNowMs,
    );
    if (expiresInMs === null) {
      return null;
    }
    return { expiresInMs, snapshot: snapshotValue };
  } catch {
    return null;
  }
}

export function getTodayCacheClientAnchorMs(): number {
  const navigationStartMs =
    typeof performance === "undefined" ? Number.NaN : performance.timeOrigin;
  return Number.isFinite(navigationStartMs) ? navigationStartMs : Date.now();
}

export function getTodaySnapshotRemainingMs(
  snapshot: TodaySnapshot,
  anchorClientMs: number,
  clientNowMs: number,
): number | null {
  if (
    !isTodaySnapshot(snapshot) ||
    snapshot.serverObservedAtMs === null ||
    !Number.isFinite(anchorClientMs) ||
    !Number.isFinite(clientNowMs)
  ) {
    return null;
  }
  const elapsed = clientNowMs - anchorClientMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return null;
  }
  // The matching navigation or retry starts no later than the server response. Counting the
  // whole request therefore expires content early rather than letting hydration extend it.
  const estimatedServerNow = snapshot.serverObservedAtMs + elapsed;
  const effectiveFromMs = Date.parse(snapshot.effectiveFrom);
  const contextBoundary = resolveTodayContextBoundary(snapshot);
  if (
    contextBoundary === null ||
    estimatedServerNow < effectiveFromMs ||
    estimatedServerNow >= contextBoundary.atMs
  ) {
    return null;
  }
  return contextBoundary.atMs - estimatedServerNow;
}

export function todaySnapshotCacheKey(fortuneDate: string, contentVersion: string): string {
  return `${TODAY_CACHE_KEY_PREFIX}:${encodeURIComponent(fortuneDate)}:${encodeURIComponent(contentVersion)}`;
}

export function clearTodaySnapshotCache(storage: Storage = window.localStorage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(`${TODAY_CACHE_KEY_PREFIX}:`)) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    storage.removeItem(key);
  }
}

export function writeTodaySnapshotCache(
  snapshot: TodaySnapshot,
  storage: TodayCacheStorage = window.localStorage,
  anchorClientMs = getTodayCacheClientAnchorMs(),
  clientNowMs = Date.now(),
): boolean {
  if (getTodaySnapshotRemainingMs(snapshot, anchorClientMs, clientNowMs) === null) {
    return false;
  }
  const cacheKey = todaySnapshotCacheKey(snapshot.fortuneDate, snapshot.contentVersion);
  const pointer: TodayCachePointer = {
    cacheKey,
    contentVersion: snapshot.contentVersion,
    fortuneDate: snapshot.fortuneDate,
    schemaVersion: CACHE_SCHEMA_VERSION,
  };
  try {
    const snapshotJson = JSON.stringify(snapshot);
    const envelope: TodayCacheEnvelope = {
      anchorClientMs,
      checksum: checksum(snapshotJson),
      contentVersion: snapshot.contentVersion,
      fortuneDate: snapshot.fortuneDate,
      schemaVersion: CACHE_SCHEMA_VERSION,
      snapshotJson,
    };
    const serializedEnvelope = JSON.stringify(envelope);
    storage.setItem(cacheKey, serializedEnvelope);
    if (
      storage.getItem(cacheKey) !== serializedEnvelope ||
      parseEnvelope(serializedEnvelope, pointer, clientNowMs) === null
    ) {
      return false;
    }
    storage.setItem(TODAY_CACHE_POINTER_KEY, JSON.stringify(pointer));
    return true;
  } catch {
    return false;
  }
}

export function readTodaySnapshotCache(
  storage: TodayCacheStorage = window.localStorage,
  clientNowMs = Date.now(),
): TodaySnapshotCacheHit | null {
  try {
    const pointerValue = storage.getItem(TODAY_CACHE_POINTER_KEY);
    if (pointerValue === null) {
      return null;
    }
    const pointer = parsePointer(pointerValue);
    if (pointer === null) {
      return null;
    }
    const envelope = storage.getItem(pointer.cacheKey);
    return envelope === null ? null : parseEnvelope(envelope, pointer, clientNowMs);
  } catch {
    return null;
  }
}

export function clearTodaySnapshotPointer(storage: TodayCacheStorage = window.localStorage): void {
  try {
    storage.removeItem(TODAY_CACHE_POINTER_KEY);
  } catch {
    // Storage policy or quota failures must not replace the public error state.
  }
}
