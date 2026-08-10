import type { TodaySnapshot } from "./today";

const SHANGHAI_OFFSET_MILLISECONDS = 8 * 60 * 60 * 1_000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;
const DEFAULT_POLL_INTERVAL_MILLISECONDS = 60_000;
const shichenBoundaryHours = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23] as const;

export type TodayContextBoundaryReason =
  "civil_midnight" | "fortune_context_boundary" | "public_content_boundary" | "shichen_boundary";

export interface TodayContextBoundary {
  atMs: number;
  reason: TodayContextBoundaryReason;
}

export interface TodayRefreshSchedule {
  blocksStaleContext: boolean;
  delayMs: number;
  reason: TodayContextBoundaryReason | "poll";
}

function nextCivilMidnightMs(civilDate: string): number | null {
  const civilMidnightMs = Date.parse(`${civilDate}T00:00:00+08:00`);
  return Number.isFinite(civilMidnightMs) ? civilMidnightMs + MILLISECONDS_PER_DAY : null;
}

function nextFortuneContextBoundaryMs(responseGeneratedAt: string): number | null {
  const responseGeneratedAtMs = Date.parse(responseGeneratedAt);
  if (!Number.isFinite(responseGeneratedAtMs)) return null;
  const shanghaiWallClock = new Date(responseGeneratedAtMs + SHANGHAI_OFFSET_MILLISECONDS);
  const candidate =
    Date.UTC(
      shanghaiWallClock.getUTCFullYear(),
      shanghaiWallClock.getUTCMonth(),
      shanghaiWallClock.getUTCDate(),
      23,
    ) - SHANGHAI_OFFSET_MILLISECONDS;
  return candidate > responseGeneratedAtMs ? candidate : candidate + MILLISECONDS_PER_DAY;
}

function nextPublicContentBoundaryMs(servedFortuneDate: string): number | null {
  const boundary = Date.parse(`${servedFortuneDate}T18:00:00+08:00`);
  return Number.isFinite(boundary) ? boundary : null;
}

function nextShichenBoundaryMs(responseGeneratedAt: string): number | null {
  const responseGeneratedAtMs = Date.parse(responseGeneratedAt);
  if (!Number.isFinite(responseGeneratedAtMs)) {
    return null;
  }
  const shanghaiWallClock = new Date(responseGeneratedAtMs + SHANGHAI_OFFSET_MILLISECONDS);
  const year = shanghaiWallClock.getUTCFullYear();
  const month = shanghaiWallClock.getUTCMonth();
  const date = shanghaiWallClock.getUTCDate();

  for (const hour of shichenBoundaryHours) {
    const candidate = Date.UTC(year, month, date, hour) - SHANGHAI_OFFSET_MILLISECONDS;
    if (candidate > responseGeneratedAtMs) {
      return candidate;
    }
  }

  return Date.UTC(year, month, date + 1, 1) - SHANGHAI_OFFSET_MILLISECONDS;
}

export function resolveTodayContextBoundary(snapshot: TodaySnapshot): TodayContextBoundary | null {
  const effectiveToMs = Date.parse(snapshot.effectiveTo);
  const civilMidnightMs = nextCivilMidnightMs(snapshot.data.requestContext.civilDate);
  const fortuneContextBoundaryMs = nextFortuneContextBoundaryMs(snapshot.responseGeneratedAt);
  const publicContentBoundaryMs = nextPublicContentBoundaryMs(
    snapshot.data.publicContentContext.servedFortuneDate,
  );
  const shichenBoundaryMs = nextShichenBoundaryMs(snapshot.responseGeneratedAt);
  if (
    !Number.isFinite(effectiveToMs) ||
    publicContentBoundaryMs === null ||
    effectiveToMs !== publicContentBoundaryMs ||
    civilMidnightMs === null ||
    fortuneContextBoundaryMs === null ||
    shichenBoundaryMs === null
  ) {
    return null;
  }

  const candidates: Array<TodayContextBoundary & { priority: number }> = [
    { atMs: publicContentBoundaryMs, priority: 0, reason: "public_content_boundary" },
    { atMs: fortuneContextBoundaryMs, priority: 1, reason: "fortune_context_boundary" },
    { atMs: civilMidnightMs, priority: 2, reason: "civil_midnight" },
    { atMs: shichenBoundaryMs, priority: 3, reason: "shichen_boundary" },
  ];
  candidates.sort((left, right) => left.atMs - right.atMs || left.priority - right.priority);
  const first = candidates[0];
  return first === undefined ? null : { atMs: first.atMs, reason: first.reason };
}

export function resolveTodayRefreshSchedule(
  snapshot: TodaySnapshot,
  contextExpiresInMs: number,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MILLISECONDS,
): TodayRefreshSchedule | null {
  const boundary = resolveTodayContextBoundary(snapshot);
  if (
    boundary === null ||
    !Number.isFinite(contextExpiresInMs) ||
    contextExpiresInMs <= 0 ||
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs <= 0
  ) {
    return null;
  }
  if (contextExpiresInMs <= pollIntervalMs) {
    return {
      blocksStaleContext: true,
      delayMs: contextExpiresInMs,
      reason: boundary.reason,
    };
  }
  return {
    blocksStaleContext: false,
    delayMs: pollIntervalMs,
    reason: "poll",
  };
}
