"use client";

import { useCallback, useEffect, useState } from "react";

const FALLBACK_REFRESH_INTERVAL_MS = 30_000;

/**
 * Refreshes operational reads from a server-owned interval. This hook intentionally
 * knows nothing about the 18:00 product rule and never compares server time with the
 * device wall clock.
 */
export function useAdminOperationsRefresh(
  nextOperationalBoundaryAt: string | null,
  responseGeneratedAt: string | null,
): number {
  const [revision, setRevision] = useState(0);
  const requestRefresh = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") requestRefresh();
    };
    window.addEventListener("pageshow", requestRefresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("pageshow", requestRefresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [requestRefresh]);

  useEffect(() => {
    if (nextOperationalBoundaryAt === null) {
      const interval = window.setInterval(requestRefresh, FALLBACK_REFRESH_INTERVAL_MS);
      return () => window.clearInterval(interval);
    }

    const boundaryMs = Date.parse(nextOperationalBoundaryAt);
    const responseGeneratedAtMs = Date.parse(responseGeneratedAt ?? "");
    if (!Number.isFinite(boundaryMs) || !Number.isFinite(responseGeneratedAtMs)) {
      const interval = window.setInterval(requestRefresh, FALLBACK_REFRESH_INTERVAL_MS);
      return () => window.clearInterval(interval);
    }

    const timeout = window.setTimeout(
      requestRefresh,
      Math.max(0, boundaryMs - responseGeneratedAtMs),
    );
    return () => window.clearTimeout(timeout);
  }, [nextOperationalBoundaryAt, requestRefresh, responseGeneratedAt]);

  return revision;
}
