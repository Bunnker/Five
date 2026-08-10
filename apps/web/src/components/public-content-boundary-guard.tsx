"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

interface PublicContentBoundaryGuardProps {
  children: ReactNode;
  effectiveTo?: string;
  responseGeneratedAt?: string;
}

interface BoundaryBaseline {
  anchorMonotonicMs: number;
  effectiveToMs: number;
  responseGeneratedAtMs: number;
}

const REFRESH_RETRY_MILLISECONDS = 5_000;

function remainingMilliseconds(baseline: BoundaryBaseline, monotonicNowMs: number): number | null {
  const elapsed = monotonicNowMs - baseline.anchorMonotonicMs;
  if (
    !Number.isFinite(baseline.effectiveToMs) ||
    !Number.isFinite(baseline.responseGeneratedAtMs) ||
    !Number.isFinite(elapsed) ||
    elapsed < 0
  ) {
    return null;
  }
  return baseline.effectiveToMs - baseline.responseGeneratedAtMs - elapsed;
}

export function PublicContentBoundaryGuard({
  children,
  effectiveTo,
  responseGeneratedAt,
}: PublicContentBoundaryGuardProps) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(false);
  const baselineRef = useRef<BoundaryBaseline | null>(null);
  const refreshInFlightRef = useRef(false);
  const retryHandleRef = useRef<number | null>(null);

  const requestRefresh = useCallback(() => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    router.refresh();
    retryHandleRef.current = window.setTimeout(() => {
      retryHandleRef.current = null;
      refreshInFlightRef.current = false;
      if (baselineRef.current !== null) {
        const remaining = remainingMilliseconds(baselineRef.current, performance.now());
        if (remaining === null || remaining <= 0) requestRefresh();
      }
    }, REFRESH_RETRY_MILLISECONDS);
  }, [router]);

  useEffect(() => {
    if (retryHandleRef.current !== null) {
      window.clearTimeout(retryHandleRef.current);
      retryHandleRef.current = null;
    }
    refreshInFlightRef.current = false;
    const baseline = {
      anchorMonotonicMs: performance.now(),
      effectiveToMs: Date.parse(effectiveTo ?? ""),
      responseGeneratedAtMs: Date.parse(responseGeneratedAt ?? ""),
    };
    baselineRef.current = baseline;
    const remaining = remainingMilliseconds(baseline, performance.now());
    if (remaining === null || remaining <= 0) {
      setBlocked(true);
      requestRefresh();
      return;
    }
    setBlocked(false);
    const boundaryHandle = window.setTimeout(() => {
      setBlocked(true);
      requestRefresh();
    }, remaining);
    return () => window.clearTimeout(boundaryHandle);
  }, [effectiveTo, requestRefresh, responseGeneratedAt]);

  useEffect(() => {
    const refreshVisiblePage = () => {
      const baseline = baselineRef.current;
      const remaining =
        baseline === null ? null : remainingMilliseconds(baseline, performance.now());
      if (remaining === null || remaining <= 0) setBlocked(true);
      requestRefresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshVisiblePage();
    };
    window.addEventListener("pageshow", refreshVisiblePage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("pageshow", refreshVisiblePage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [requestRefresh]);

  useEffect(
    () => () => {
      if (retryHandleRef.current !== null) window.clearTimeout(retryHandleRef.current);
    },
    [],
  );

  if (blocked) {
    return (
      <main className="page-shell">
        <section className="today-load-error" role="status">
          <h1>正在切换公开内容</h1>
          <span>页面会在新的完整内容准备好后自动恢复。</span>
        </section>
      </main>
    );
  }

  return children;
}
