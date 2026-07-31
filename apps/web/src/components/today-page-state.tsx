"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  clearTodaySnapshotCache,
  clearTodaySnapshotPointer,
  getTodayCacheClientAnchorMs,
  getTodaySnapshotRemainingMs,
  readTodaySnapshotCache,
  TODAY_PENDING_REFRESH_ANCHOR_KEY,
  writeTodaySnapshotCache,
} from "../lib/today-cache";
import type { TodaySnapshotCacheHit } from "../lib/today-cache";
import type { LoadTodayResult, TodaySnapshot } from "../lib/today";
import { resolveTodayRefreshSchedule } from "../lib/today-refresh-policy";
import { TodayPageContent } from "./today-page-content";
import { TodayPageSkeleton } from "./today-page-skeleton";

export interface TodayPageStateProps {
  result: LoadTodayResult;
}

const REFRESH_WATCHDOG_MILLISECONDS = 10_000;

interface ActiveTodaySnapshot extends TodaySnapshotCacheHit {
  expiresAtClientMs: number;
}

type TodayUpdateKind = "civil_midnight" | "content_version" | "fortune_day";

interface TodayUpdateNotice {
  description: string;
  headline: string;
  kind: TodayUpdateKind;
}

function activateSnapshot(
  hit: TodaySnapshotCacheHit,
  clientNowMs = Date.now(),
): ActiveTodaySnapshot {
  return {
    ...hit,
    expiresAtClientMs: clientNowMs + hit.expiresInMs,
  };
}

function describeSnapshotUpdate(
  previous: TodaySnapshot | null,
  next: TodaySnapshot,
): TodayUpdateNotice | null {
  if (previous === null) {
    return null;
  }
  if (previous.fortuneDate !== next.fortuneDate) {
    return {
      description: "日期、时辰与穿衣建议已经整包切换。",
      headline: "已进入新命理日，今日内容已更新",
      kind: "fortune_day",
    };
  }
  if (previous.data.requestContext.civilDate !== next.data.requestContext.civilDate) {
    return {
      description: "民用日期已更新，命理日没有再次顺延。",
      headline: "已过午夜，仍按当前命理日展示",
      kind: "civil_midnight",
    };
  }
  if (previous.contentVersion !== next.contentVersion) {
    return {
      description: "颜色、穿法与图片均来自同一个最新版本。",
      headline: "今日内容已更新，已切换为最新完整内容",
      kind: "content_version",
    };
  }
  return null;
}

function clearPendingRefreshAnchor(): void {
  try {
    window.sessionStorage.removeItem(TODAY_PENDING_REFRESH_ANCHOR_KEY);
  } catch {
    // The response will use the conservative fallback anchor below.
  }
}

function rememberPendingRefreshAnchor(clientNowMs: number): void {
  try {
    window.sessionStorage.setItem(TODAY_PENDING_REFRESH_ANCHOR_KEY, String(clientNowMs));
  } catch {
    // The response will use the conservative fallback anchor below.
  }
}

function consumeResponseClientAnchor(clientNowMs: number): number {
  const navigationAnchorMs = getTodayCacheClientAnchorMs();
  try {
    const pendingValue = window.sessionStorage.getItem(TODAY_PENDING_REFRESH_ANCHOR_KEY);
    window.sessionStorage.removeItem(TODAY_PENDING_REFRESH_ANCHOR_KEY);
    const pendingAnchorMs = pendingValue === null ? Number.NaN : Number(pendingValue);
    if (Number.isFinite(pendingAnchorMs) && pendingAnchorMs <= clientNowMs) {
      return pendingAnchorMs;
    }
  } catch {
    // Navigation start is older than this response and therefore fails closed by expiring early.
  }
  return navigationAnchorMs;
}

function formatGeneratedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "long",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function PageMasthead() {
  return (
    <header className="today-masthead">
      <div className="today-masthead__identity">
        <p className="today-masthead__brand">
          <span>Five</span>
          <span>五行穿衣</span>
        </p>
        <p className="today-masthead__description">每日五行搭配参考</p>
      </div>
    </header>
  );
}

interface RetryButtonProps {
  isRetrying: boolean;
  onRetry: () => void;
}

function RetryButton({ isRetrying, onRetry }: RetryButtonProps) {
  return (
    <button
      aria-busy={isRetrying}
      className="foundation-action foundation-action--button foundation-action--full"
      disabled={isRetrying}
      onClick={onRetry}
      type="button"
    >
      <span>{isRetrying ? "正在重试…" : "重新加载"}</span>
      <span aria-hidden="true">↻</span>
    </button>
  );
}

export function TodayPageState({ result }: TodayPageStateProps) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [activeSnapshot, setActiveSnapshot] = useState<ActiveTodaySnapshot | null>(null);
  const [stateChecked, setStateChecked] = useState(
    result.kind === "content_not_ready" || result.kind === "public_access_stopped",
  );
  const [hasExpired, setHasExpired] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isBoundaryRefreshing, setIsBoundaryRefreshing] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<TodayUpdateNotice | null>(null);
  const activeSnapshotRef = useRef<ActiveTodaySnapshot | null>(null);
  const boundaryBlockedRef = useRef(false);
  const boundaryRefreshPendingRef = useRef(false);
  const lastDisplayedSnapshotRef = useRef<TodaySnapshot | null>(null);
  const refreshInFlightRef = useRef(false);
  const requestRefreshRef = useRef<(showRetryProgress?: boolean) => boolean>(() => false);
  const refreshWatchdogRef = useRef<number | null>(null);

  const clearRefreshWatchdog = useCallback((): void => {
    if (refreshWatchdogRef.current !== null) {
      window.clearTimeout(refreshWatchdogRef.current);
      refreshWatchdogRef.current = null;
    }
  }, []);

  const requestRefresh = useCallback(
    (showRetryProgress = false): boolean => {
      if (refreshInFlightRef.current) {
        return false;
      }
      refreshInFlightRef.current = true;
      rememberPendingRefreshAnchor(Date.now());
      if (showRetryProgress) {
        setIsRetrying(true);
      }
      routerRef.current.refresh();
      clearRefreshWatchdog();
      refreshWatchdogRef.current = window.setTimeout(() => {
        refreshWatchdogRef.current = null;
        refreshInFlightRef.current = false;
        if (boundaryBlockedRef.current && boundaryRefreshPendingRef.current) {
          boundaryRefreshPendingRef.current = false;
          requestRefreshRef.current();
          return;
        }
        setIsRetrying(false);
        if (boundaryBlockedRef.current) {
          setIsBoundaryRefreshing(false);
        }
      }, REFRESH_WATCHDOG_MILLISECONDS);
      return true;
    },
    [clearRefreshWatchdog],
  );
  requestRefreshRef.current = requestRefresh;

  const blockExpiredContext = useCallback(
    (snapshot: ActiveTodaySnapshot): void => {
      if (activeSnapshotRef.current !== snapshot) {
        return;
      }
      boundaryBlockedRef.current = true;
      activeSnapshotRef.current = null;
      setActiveSnapshot(null);
      setHasExpired(true);
      setIsBoundaryRefreshing(true);
      boundaryRefreshPendingRef.current = !requestRefresh();
    },
    [requestRefresh],
  );

  useEffect(() => {
    clearRefreshWatchdog();
    refreshInFlightRef.current = false;
    const wasBoundaryBlocked = boundaryBlockedRef.current;
    const queuedBoundaryRefresh = boundaryRefreshPendingRef.current;
    boundaryRefreshPendingRef.current = false;
    setIsRetrying(false);
    setHasExpired(false);
    if (result.kind === "ready") {
      const clientNowMs = Date.now();
      const anchorClientMs = consumeResponseClientAnchor(clientNowMs);
      const expiresInMs = getTodaySnapshotRemainingMs(result.snapshot, anchorClientMs, clientNowMs);
      if (expiresInMs === null) {
        boundaryBlockedRef.current = true;
        activeSnapshotRef.current = null;
        setActiveSnapshot(null);
        setHasExpired(true);
        if (queuedBoundaryRefresh || !wasBoundaryBlocked) {
          setIsBoundaryRefreshing(true);
          requestRefresh();
        } else {
          setIsBoundaryRefreshing(false);
        }
        setStateChecked(true);
        return;
      }
      writeTodaySnapshotCache(result.snapshot, undefined, anchorClientMs, clientNowMs);
      const nextActiveSnapshot = activateSnapshot(
        { expiresInMs, snapshot: result.snapshot },
        clientNowMs,
      );
      setUpdateNotice(describeSnapshotUpdate(lastDisplayedSnapshotRef.current, result.snapshot));
      lastDisplayedSnapshotRef.current = result.snapshot;
      boundaryBlockedRef.current = false;
      boundaryRefreshPendingRef.current = false;
      activeSnapshotRef.current = nextActiveSnapshot;
      setActiveSnapshot(nextActiveSnapshot);
      setIsBoundaryRefreshing(false);
      setStateChecked(true);
      return;
    }
    if (result.kind === "content_not_ready") {
      clearPendingRefreshAnchor();
      boundaryBlockedRef.current = false;
      boundaryRefreshPendingRef.current = false;
      activeSnapshotRef.current = null;
      lastDisplayedSnapshotRef.current = null;
      setActiveSnapshot(null);
      setUpdateNotice(null);
      setIsBoundaryRefreshing(false);
      setStateChecked(true);
      try {
        clearTodaySnapshotPointer();
      } catch {
        // The authoritative server state already removed the in-memory snapshot; disabled storage cannot restore it.
      }
      return;
    }
    if (result.kind === "public_access_stopped") {
      clearPendingRefreshAnchor();
      boundaryBlockedRef.current = false;
      boundaryRefreshPendingRef.current = false;
      activeSnapshotRef.current = null;
      lastDisplayedSnapshotRef.current = null;
      setActiveSnapshot(null);
      setUpdateNotice(null);
      setIsBoundaryRefreshing(false);
      setStateChecked(true);
      try {
        clearTodaySnapshotCache();
      } catch {
        // Emergency stop is authoritative even when browser storage is unavailable.
      }
      return;
    }
    clearPendingRefreshAnchor();
    if (boundaryBlockedRef.current) {
      activeSnapshotRef.current = null;
      setActiveSnapshot(null);
      setHasExpired(true);
      if (queuedBoundaryRefresh) {
        setIsBoundaryRefreshing(true);
        requestRefresh();
      } else {
        setIsBoundaryRefreshing(false);
      }
      setStateChecked(true);
      return;
    }
    const clientNowMs = Date.now();
    const currentSnapshot = activeSnapshotRef.current;
    const fallbackHit =
      currentSnapshot !== null && currentSnapshot.expiresAtClientMs > clientNowMs
        ? {
            expiresInMs: currentSnapshot.expiresAtClientMs - clientNowMs,
            snapshot: currentSnapshot.snapshot,
          }
        : readTodaySnapshotCache();
    const fallbackSnapshot =
      fallbackHit === null ? null : activateSnapshot(fallbackHit, clientNowMs);
    activeSnapshotRef.current = fallbackSnapshot;
    if (fallbackSnapshot !== null && lastDisplayedSnapshotRef.current === null) {
      lastDisplayedSnapshotRef.current = fallbackSnapshot.snapshot;
    }
    setActiveSnapshot(fallbackSnapshot);
    setIsBoundaryRefreshing(false);
    setStateChecked(true);
  }, [clearRefreshWatchdog, requestRefresh, result]);

  useEffect(() => () => clearRefreshWatchdog(), [clearRefreshWatchdog]);

  useEffect(() => {
    if (activeSnapshot === null) {
      return;
    }
    const remainingMs = activeSnapshot.expiresAtClientMs - Date.now();
    if (remainingMs <= 0) {
      blockExpiredContext(activeSnapshot);
      return;
    }
    const hardBoundaryTimeout = window.setTimeout(
      () => blockExpiredContext(activeSnapshot),
      Math.max(1, remainingMs),
    );
    const schedule = resolveTodayRefreshSchedule(activeSnapshot.snapshot, remainingMs);
    const pollInterval =
      schedule !== null && !schedule.blocksStaleContext
        ? window.setInterval(() => requestRefresh(), schedule.delayMs)
        : null;
    return () => {
      window.clearTimeout(hardBoundaryTimeout);
      if (pollInterval !== null) {
        window.clearInterval(pollInterval);
      }
    };
  }, [activeSnapshot, blockExpiredContext, requestRefresh]);

  useEffect(() => {
    function revalidateVisiblePage(): void {
      const currentSnapshot = activeSnapshotRef.current;
      if (currentSnapshot !== null && currentSnapshot.expiresAtClientMs <= Date.now()) {
        blockExpiredContext(currentSnapshot);
        return;
      }
      requestRefresh();
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        revalidateVisiblePage();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", revalidateVisiblePage);
    window.addEventListener("pageshow", revalidateVisiblePage);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", revalidateVisiblePage);
      window.removeEventListener("pageshow", revalidateVisiblePage);
    };
  }, [blockExpiredContext, requestRefresh]);

  function retry(): void {
    boundaryRefreshPendingRef.current = false;
    requestRefresh(true);
  }

  if (!stateChecked || isBoundaryRefreshing) {
    return <TodayPageSkeleton />;
  }

  const authoritativeUnavailable =
    result.kind === "content_not_ready" || result.kind === "public_access_stopped";

  if (activeSnapshot !== null && !authoritativeUnavailable) {
    if (result.kind !== "refresh_failed") {
      return (
        <>
          {updateNotice === null ? null : (
            <aside
              className="today-cache-notice today-update-notice"
              data-update-kind={updateNotice.kind}
              role="status"
            >
              <div>
                <strong>{updateNotice.headline}</strong>
                <span>{updateNotice.description}</span>
              </div>
            </aside>
          )}
          <TodayPageContent today={activeSnapshot.snapshot.data} />
        </>
      );
    }
    return (
      <>
        <aside className="today-cache-notice" role="status">
          <div>
            <strong>暂时无法更新，正在显示仍有效的上次完整内容</strong>
            <span>
              服务端生成于 {formatGeneratedAt(activeSnapshot.snapshot.responseGeneratedAt)}
            </span>
          </div>
          <button disabled={isRetrying} onClick={retry} type="button">
            {isRetrying ? "正在重试…" : "重新获取"}
          </button>
        </aside>
        <TodayPageContent today={activeSnapshot.snapshot.data} />
      </>
    );
  }

  const contentNotReady = result.kind === "content_not_ready";
  const publicAccessStopped = result.kind === "public_access_stopped";
  const unavailableHeadline = hasExpired
    ? "今日内容已到有效期"
    : result.kind === "refresh_failed" && result.reason === "rate_limited"
      ? "请求较多，暂时没能更新"
      : result.kind === "refresh_failed" &&
          (result.reason === "http" || result.reason === "invalid_response")
        ? "今日内容暂时无法确认"
        : "暂时没能加载今日内容";
  const unavailableDescription = hasExpired
    ? "请重新加载获取新的完整内容。"
    : result.kind === "refresh_failed" &&
        (result.reason === "network" || result.reason === "timeout")
      ? "请检查网络后重新加载，页面不会展示不完整或过期内容。"
      : "请稍后重新加载，页面不会展示不完整或过期内容。";
  return (
    <main className="page-shell">
      <div className="today-page today-page--home">
        <PageMasthead />
        <section className="today-load-error" role="status">
          <p>
            {publicAccessStopped ? "内容安全状态" : contentNotReady ? "内容发布状态" : "加载状态"}
          </p>
          <h1>
            {publicAccessStopped
              ? "公开内容已暂停"
              : contentNotReady
                ? "今日内容正在校验中"
                : unavailableHeadline}
          </h1>
          <span>
            {publicAccessStopped
              ? "维护者正在处理内容安全问题，请稍后再来。"
              : contentNotReady && result.retryAfterSeconds !== null
                ? `建议 ${result.retryAfterSeconds} 秒后重试。`
                : contentNotReady
                  ? "请稍后重新加载，页面不会展示尚未发布的内容。"
                  : unavailableDescription}
          </span>
          <RetryButton isRetrying={isRetrying} onRetry={retry} />
        </section>
      </div>
    </main>
  );
}
