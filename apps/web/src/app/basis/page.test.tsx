import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayPageData } from "../../lib/today";
import BasisPage from "./page";

const { headersMock, loadTodayMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  loadTodayMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("../../lib/today", () => ({
  loadToday: loadTodayMock,
}));

const contentVersion = "fd-20260715-r1";
const today = {
  attentionSection: null,
  basis: {
    contentVersion,
    disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
    steps: ["今日干支为庚寅", "日柱地支取寅", "寅属木，因此今日为木日"],
  },
  ciJiCard: null,
  content: {
    calendar: {
      dayElement: "wood",
      dayElementLabel: "木",
      ganzhiDay: "庚寅",
      lunarDateText: "六月初二",
      weekdayText: "星期三",
    },
    fortuneDate: "2026-07-15",
  },
  daJiCard: null,
  imagePreviewSection: null,
  outfitPreviewSection: null,
  pingCard: null,
  requestContext: {
    civilDate: "2026-07-15",
    crossedDayBoundary: false,
    fortuneDate: "2026-07-15",
    shichen: "午",
  },
} as TodayPageData;

const validSearchParams = {
  expectedContentVersion: contentVersion,
  fortuneDate: "2026-07-15",
};

describe("BasisPage", () => {
  beforeEach(() => {
    headersMock.mockReset();
    loadTodayMock.mockReset();
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-basis-page" }));
    loadTodayMock.mockResolvedValue(today);
  });

  it("shows the published basis steps and disclaimer without inventing another source", async () => {
    render(await BasisPage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(loadTodayMock).toHaveBeenCalledWith({ requestId: "request-basis-page" });
    expect(screen.getByRole("heading", { level: 1, name: "为什么这样排" })).toBeVisible();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "今日干支为庚寅",
      "日柱地支取寅",
      "寅属木，因此今日为木日",
    ]);
    expect(screen.getByText("内容基于传统文化规则整理，仅供穿搭参考。")).toBeVisible();
    expect(screen.queryByText(/黄历/u)).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "为什么这样排" })).toHaveAttribute(
      "data-content-version",
      contentVersion,
    );
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });

  it.each([
    [
      "invalid",
      { expectedContentVersion: contentVersion, fortuneDate: ["2026-07-15"] },
      "暂时找不到这份推算依据",
    ],
    [
      "stale",
      { expectedContentVersion: contentVersion, fortuneDate: "2026-07-14" },
      "这份推算依据已经更新",
    ],
  ])("shows an understandable %s state", async (_status, searchParams, title) => {
    render(await BasisPage({ searchParams: Promise.resolve(searchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent(title);
    expect(screen.queryByText("今日干支为庚寅")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });

  it("shows unavailable when the versioned basis is missing", async () => {
    loadTodayMock.mockResolvedValue({ ...today, basis: null });

    render(await BasisPage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent("推算依据暂时无法打开");
    expect(screen.getByRole("status")).toHaveTextContent("当日依据还没有加载完整");
  });
});
