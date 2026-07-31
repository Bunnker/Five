"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  clearTodaySnapshotPointer,
  getTodayCacheClientAnchorMs,
  getTodaySnapshotRemainingMs,
  readTodaySnapshotCache,
  writeTodaySnapshotCache,
} from "../lib/today-cache";
import type { TodaySnapshotCacheHit } from "../lib/today-cache";
import type { LoadTodayResult } from "../lib/today";
import { TodayPageContent } from "./today-page-content";
import { TodayPageSkeleton } from "./today-page-skeleton";

export interface TodayPageStateProps {
  result: LoadTodayResult;
}

const PENDING_REFRESH_ANCHOR_KEY = "five:today:v1:pending-refresh-anchor";

function clearPendingRefreshAnchor(): void {
  try {
    window.sessionStorage.removeItem(PENDING_REFRESH_ANCHOR_KEY);
  } catch {
    // The response will use the conservative fallback anchor below.
  }
}

function rememberPendingRefreshAnchor(clientNowMs: number): void {
  try {
    window.sessionStorage.setItem(PENDING_REFRESH_ANCHOR_KEY, String(clientNowMs));
  } catch {
    // The response will use the conservative fallback anchor below.
  }
}

function consumeResponseClientAnchor(clientNowMs: number): number {
  const navigationAnchorMs = getTodayCacheClientAnchorMs();
  try {
    const pendingValue = window.sessionStorage.getItem(PENDING_REFRESH_ANCHOR_KEY);
    window.sessionStorage.removeItem(PENDING_REFRESH_ANCHOR_KEY);
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
  const [activeSnapshot, setActiveSnapshot] = useState<TodaySnapshotCacheHit | null>(null);
  const [stateChecked, setStateChecked] = useState(result.kind === "content_not_ready");
  const [hasExpired, setHasExpired] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    setIsRetrying(false);
    setHasExpired(false);
    if (result.kind === "ready") {
      const clientNowMs = Date.now();
      const anchorClientMs = consumeResponseClientAnchor(clientNowMs);
      const expiresInMs = getTodaySnapshotRemainingMs(result.snapshot, anchorClientMs, clientNowMs);
      if (expiresInMs === null) {
        setActiveSnapshot(null);
        setHasExpired(true);
        setStateChecked(true);
        return;
      }
      writeTodaySnapshotCache(result.snapshot, undefined, anchorClientMs, clientNowMs);
      setActiveSnapshot({ expiresInMs, snapshot: result.snapshot });
      setStateChecked(true);
      return;
    }
    if (result.kind === "content_not_ready") {
      clearPendingRefreshAnchor();
      clearTodaySnapshotPointer();
      setActiveSnapshot(null);
      setStateChecked(true);
      return;
    }
    clearPendingRefreshAnchor();
    setActiveSnapshot(readTodaySnapshotCache());
    setStateChecked(true);
  }, [result]);

  useEffect(() => {
    if (activeSnapshot === null) {
      return;
    }
    const timeout = window.setTimeout(
      () => {
        setActiveSnapshot(null);
        setHasExpired(true);
      },
      Math.max(1, activeSnapshot.expiresInMs),
    );
    return () => window.clearTimeout(timeout);
  }, [activeSnapshot]);

  function retry(): void {
    rememberPendingRefreshAnchor(Date.now());
    setIsRetrying(true);
    router.refresh();
  }

  if (!stateChecked) {
    return <TodayPageSkeleton />;
  }

  if (activeSnapshot !== null) {
    if (result.kind !== "refresh_failed") {
      return <TodayPageContent today={activeSnapshot.snapshot.data} />;
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
          <p>{contentNotReady ? "内容发布状态" : "加载状态"}</p>
          <h1>{contentNotReady ? "今日内容正在校验中" : unavailableHeadline}</h1>
          <span>
            {contentNotReady && result.retryAfterSeconds !== null
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
