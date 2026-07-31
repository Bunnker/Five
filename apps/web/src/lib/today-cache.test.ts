import { describe, expect, it } from "vitest";

import type { CompleteTodayPageData, TodaySnapshot } from "./today";
import {
  clearTodaySnapshotPointer,
  readTodaySnapshotCache,
  TODAY_CACHE_POINTER_KEY,
  todaySnapshotCacheKey,
  writeTodaySnapshotCache,
} from "./today-cache";

class MemoryStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const contentVersion = "fd-20260715-r1";
const fortuneDate = "2026-07-15";
const serverObservedAtMs = Date.parse("2026-07-15T10:00:00+08:00");

function completeData(version = contentVersion, date = fortuneDate): CompleteTodayPageData {
  const versioned = { contentVersion: version };
  return {
    attentionSection: { ...versioned, groups: [{}, {}] },
    basis: versioned,
    ciJiCard: versioned,
    content: { calendar: {}, fortuneDate: date },
    daJiCard: versioned,
    imagePreviewSection: { ...versioned, cards: [{}, {}] },
    nextSteps: {
      ...versioned,
      basisHref: "/basis",
      colorsHref: "/colors",
      outfitsHref: "/outfits",
      shareHref: "/share",
    },
    outfitPreviewSection: { ...versioned, cards: [{}, {}, {}] },
    pingCard: versioned,
    requestContext: {
      civilDate: date,
      crossedDayBoundary: false,
      fortuneDate: date,
      shichen: "巳",
    },
    share: versioned,
  } as unknown as CompleteTodayPageData;
}

function snapshot(
  overrides: Partial<TodaySnapshot> = {},
  data: CompleteTodayPageData = completeData(),
): TodaySnapshot {
  return {
    contentVersion,
    data,
    effectiveFrom: "2026-07-15T00:00:00+08:00",
    effectiveTo: "2026-07-15T23:00:00+08:00",
    fortuneDate,
    responseGeneratedAt: "2026-07-15T09:59:58+08:00",
    serverObservedAtMs,
    ...overrides,
  };
}

describe("today snapshot browser cache", () => {
  it("writes the complete date+version entry before its active pointer and restores it", () => {
    const storage = new MemoryStorage();
    const value = snapshot();

    expect(writeTodaySnapshotCache(value, storage, serverObservedAtMs, serverObservedAtMs)).toBe(
      true,
    );
    expect([...storage.values.keys()]).toEqual([
      todaySnapshotCacheKey(fortuneDate, contentVersion),
      TODAY_CACHE_POINTER_KEY,
    ]);
    expect(readTodaySnapshotCache(storage, serverObservedAtMs)).toEqual({
      expiresInMs: Date.parse("2026-07-15T11:00:00+08:00") - serverObservedAtMs,
      snapshot: value,
    });
  });

  it("uses the server Date+Age anchor and expires at the next context boundary", () => {
    const storage = new MemoryStorage();
    const value = snapshot();
    expect(writeTodaySnapshotCache(value, storage, serverObservedAtMs, serverObservedAtMs)).toBe(
      true,
    );

    const remaining = Date.parse("2026-07-15T11:00:00+08:00") - serverObservedAtMs;
    expect(readTodaySnapshotCache(storage, serverObservedAtMs + remaining - 1)).toEqual({
      expiresInMs: 1,
      snapshot: value,
    });
    expect(readTodaySnapshotCache(storage, serverObservedAtMs + remaining)).toBeNull();
  });

  it("rejects a device clock rollback, a mixed pointer tuple and corrupted JSON", () => {
    const storage = new MemoryStorage();
    const value = snapshot();
    expect(writeTodaySnapshotCache(value, storage, serverObservedAtMs, serverObservedAtMs)).toBe(
      true,
    );
    expect(readTodaySnapshotCache(storage, serverObservedAtMs - 1)).toBeNull();

    storage.setItem(
      TODAY_CACHE_POINTER_KEY,
      JSON.stringify({
        cacheKey: todaySnapshotCacheKey("2026-07-16", contentVersion),
        contentVersion,
        fortuneDate: "2026-07-16",
        schemaVersion: 1,
      }),
    );
    expect(readTodaySnapshotCache(storage, serverObservedAtMs)).toBeNull();

    storage.setItem(TODAY_CACHE_POINTER_KEY, "not-json");
    expect(readTodaySnapshotCache(storage, serverObservedAtMs)).toBeNull();
  });

  it("rejects an entry whose complete snapshot was changed after its verified write", () => {
    const storage = new MemoryStorage();
    const value = snapshot();
    expect(writeTodaySnapshotCache(value, storage, serverObservedAtMs, serverObservedAtMs)).toBe(
      true,
    );
    const entryKey = todaySnapshotCacheKey(fortuneDate, contentVersion);
    const envelope = JSON.parse(storage.getItem(entryKey) ?? "null") as {
      snapshotJson: string;
    };
    envelope.snapshotJson = envelope.snapshotJson.replace(contentVersion, "fd-20260715-r2");
    storage.setItem(entryKey, JSON.stringify(envelope));

    expect(readTodaySnapshotCache(storage, serverObservedAtMs)).toBeNull();
  });

  it("rejects partial or mixed-version content even when a caller tries to cache it", () => {
    const storage = new MemoryStorage();
    const partial = completeData();
    partial.imagePreviewSection = { ...partial.imagePreviewSection, cards: [] };
    expect(
      writeTodaySnapshotCache(
        snapshot({}, partial),
        storage,
        serverObservedAtMs,
        serverObservedAtMs,
      ),
    ).toBe(false);

    const mixed = completeData();
    mixed.pingCard = { ...mixed.pingCard, contentVersion: "fd-20260715-r2" };
    expect(
      writeTodaySnapshotCache(snapshot({}, mixed), storage, serverObservedAtMs, serverObservedAtMs),
    ).toBe(false);
    expect(storage.values.size).toBe(0);
  });

  it("keeps the previous pointer when a new snapshot write fails and never throws on storage errors", () => {
    const storage = new MemoryStorage();
    const oldValue = snapshot();
    expect(writeTodaySnapshotCache(oldValue, storage, serverObservedAtMs, serverObservedAtMs)).toBe(
      true,
    );
    const oldPointer = storage.getItem(TODAY_CACHE_POINTER_KEY);
    const originalSetItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      if (key.includes("fd-20260715-r2")) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      originalSetItem(key, value);
    };
    const next = snapshot({ contentVersion: "fd-20260715-r2" }, completeData("fd-20260715-r2"));

    expect(writeTodaySnapshotCache(next, storage, serverObservedAtMs, serverObservedAtMs)).toBe(
      false,
    );
    expect(storage.getItem(TODAY_CACHE_POINTER_KEY)).toBe(oldPointer);
    expect(readTodaySnapshotCache(storage, serverObservedAtMs)?.snapshot).toEqual(oldValue);
  });

  it("does not persist a response without a trustworthy server observation time", () => {
    const storage = new MemoryStorage();
    expect(
      writeTodaySnapshotCache(
        snapshot({ serverObservedAtMs: null }),
        storage,
        serverObservedAtMs,
        serverObservedAtMs,
      ),
    ).toBe(false);
    expect(storage.values.size).toBe(0);
  });

  it("clears only the active pointer for an authoritative CONTENT_NOT_READY response", () => {
    const storage = new MemoryStorage();
    expect(
      writeTodaySnapshotCache(snapshot(), storage, serverObservedAtMs, serverObservedAtMs),
    ).toBe(true);
    const entryKey = todaySnapshotCacheKey(fortuneDate, contentVersion);

    clearTodaySnapshotPointer(storage);

    expect(storage.getItem(TODAY_CACHE_POINTER_KEY)).toBeNull();
    expect(storage.getItem(entryKey)).not.toBeNull();
    expect(readTodaySnapshotCache(storage, serverObservedAtMs)).toBeNull();
  });

  it("expires conservatively when more than a minute in transit crosses effectiveTo", () => {
    const storage = new MemoryStorage();
    const nearBoundary = snapshot({
      responseGeneratedAt: "2026-07-15T22:58:59+08:00",
      serverObservedAtMs: Date.parse("2026-07-15T22:58:59+08:00"),
    });

    expect(writeTodaySnapshotCache(nearBoundary, storage, 1_000, 62_001)).toBe(false);
    expect(storage.values.size).toBe(0);
  });
});
