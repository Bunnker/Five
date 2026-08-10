import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAdminOperationsRefresh } from "./use-admin-operations-refresh";

describe("useAdminOperationsRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("uses the server-relative boundary delay when the device clock is skewed", () => {
    const { result } = renderHook(() =>
      useAdminOperationsRefresh("2026-08-06T18:00:00+08:00", "2026-08-06T17:59:59.500+08:00"),
    );

    act(() => vi.advanceTimersByTime(499));
    expect(result.current).toBe(0);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(1);
  });
});
