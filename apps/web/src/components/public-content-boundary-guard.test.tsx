import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicContentBoundaryGuard } from "./public-content-boundary-guard";

const { refresh, router } = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

describe("PublicContentBoundaryGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"));
    vi.spyOn(performance, "timeOrigin", "get").mockReturnValue(1_000);
    refresh.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses a fresh monotonic anchor and removes stale content at the server boundary", () => {
    render(
      <PublicContentBoundaryGuard
        effectiveTo="2026-08-06T18:00:00+08:00"
        responseGeneratedAt="2026-08-06T17:59:59.500+08:00"
      >
        <p>旧日颜色</p>
      </PublicContentBoundaryGuard>,
    );

    expect(screen.getByText("旧日颜色")).toBeVisible();

    act(() => vi.advanceTimersByTime(500));

    expect(screen.queryByText("旧日颜色")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("正在切换公开内容");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
