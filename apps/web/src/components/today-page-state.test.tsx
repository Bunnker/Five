import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoadTodayResult, TodaySnapshot } from "../lib/today";
import { TodayPageState } from "./today-page-state";

const mocks = vi.hoisted(() => ({
  anchor: vi.fn(),
  clear: vi.fn(),
  read: vi.fn(),
  refresh: vi.fn(),
  remaining: vi.fn(),
  write: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("../lib/today-cache", () => ({
  clearTodaySnapshotPointer: mocks.clear,
  getTodayCacheClientAnchorMs: mocks.anchor,
  getTodaySnapshotRemainingMs: mocks.remaining,
  readTodaySnapshotCache: mocks.read,
  writeTodaySnapshotCache: mocks.write,
}));

vi.mock("./today-page-content", () => ({
  TodayPageContent: ({ today }: { today: TodaySnapshot["data"] }) => (
    <main data-content-version={today.daJiCard.contentVersion}>
      <h1>{today.content.fortuneDate}</h1>
      <p>完整内容</p>
    </main>
  ),
}));

vi.mock("./today-page-skeleton", () => ({
  TodayPageSkeleton: () => <div role="status">正在加载今日内容</div>,
}));

const snapshot = {
  contentVersion: "fd-20260715-r1",
  data: {
    content: { fortuneDate: "2026-07-15" },
    daJiCard: { contentVersion: "fd-20260715-r1" },
  },
  effectiveFrom: "2026-07-14T23:00:00+08:00",
  effectiveTo: "2026-07-15T23:00:00+08:00",
  fortuneDate: "2026-07-15",
  responseGeneratedAt: "2026-07-15T10:00:00+08:00",
  serverObservedAtMs: Date.parse("2026-07-15T10:00:05+08:00"),
} as TodaySnapshot;

function renderResult(result: LoadTodayResult) {
  return render(<TodayPageState result={result} />);
}

describe("TodayPageState", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    mocks.anchor.mockReturnValue(1_000);
    mocks.read.mockReturnValue(null);
    mocks.remaining.mockReturnValue(60_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("renders and caches one complete online snapshot without a stale-content notice", async () => {
    mocks.write.mockReturnValue(true);
    renderResult({ kind: "ready", snapshot });

    expect(await screen.findByRole("heading", { name: "2026-07-15" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("data-content-version", "fd-20260715-r1");
    expect(screen.queryByText(/网络暂时不可用/u)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.write).toHaveBeenCalledWith(snapshot, undefined, 1_000, expect.any(Number)),
    );
  });

  it("uses one valid cached snapshot after a refresh failure and labels its source", async () => {
    mocks.read.mockReturnValue({ expiresInMs: 60_000, snapshot });
    renderResult({ kind: "refresh_failed", reason: "network" });

    expect(await screen.findByRole("heading", { name: "2026-07-15" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("data-content-version", "fd-20260715-r1");
    expect(screen.getByRole("status")).toHaveTextContent(
      "暂时无法更新，正在显示仍有效的上次完整内容",
    );
    expect(screen.getByText(/服务端生成于/u)).toBeVisible();
  });

  it("shows only a retryable error when no complete unexpired cache exists", async () => {
    mocks.read.mockReturnValue(null);
    renderResult({ kind: "refresh_failed", reason: "timeout" });

    expect(await screen.findByRole("heading", { name: "暂时没能加载今日内容" })).toBeVisible();
    expect(screen.queryByText("2026-07-15")).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "重新加载" });
    fireEvent.click(retry);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(retry).toBeDisabled();
    expect(retry).toHaveTextContent("正在重试");
  });

  it("treats CONTENT_NOT_READY as authoritative and never displays an older cache", async () => {
    mocks.read.mockReturnValue({ expiresInMs: 60_000, snapshot });
    renderResult({ kind: "content_not_ready", retryAfterSeconds: 30 });

    expect(screen.getByRole("heading", { name: "今日内容正在校验中" })).toBeVisible();
    expect(screen.getByText("建议 30 秒后重试。")).toBeVisible();
    expect(screen.queryByText("2026-07-15")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledTimes(1));
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("keeps the exact retry anchor after hours on-page and more than a minute in transit", async () => {
    vi.mocked(Date.now).mockReturnValue(45_010_000);
    const view = renderResult({ kind: "refresh_failed", reason: "network" });
    await screen.findByRole("heading", { name: "暂时没能加载今日内容" });

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    vi.mocked(Date.now).mockReturnValue(45_071_001);
    view.rerender(<TodayPageState result={{ kind: "ready", snapshot }} />);

    expect(await screen.findByRole("heading", { name: "2026-07-15" })).toBeVisible();
    expect(mocks.remaining).toHaveBeenLastCalledWith(snapshot, 45_010_000, 45_071_001);
    expect(mocks.write).toHaveBeenLastCalledWith(snapshot, undefined, 45_010_000, 45_071_001);
  });

  it("withdraws cached content at effectiveTo instead of leaving a wrong date mounted", async () => {
    vi.useFakeTimers();
    mocks.read.mockReturnValue({ expiresInMs: 50, snapshot });
    renderResult({ kind: "refresh_failed", reason: "network" });
    await act(async () => undefined);
    expect(screen.getByRole("heading", { name: "2026-07-15" })).toBeVisible();

    act(() => vi.advanceTimersByTime(50));

    expect(screen.queryByText("2026-07-15")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今日内容已到有效期" })).toBeVisible();
  });
});
