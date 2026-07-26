import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayPageData } from "../../lib/today";
import ColorsPage from "./page";

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
  attentionSection: {
    balanceSuggestion: {
      accessoryExamples: ["丝巾", "包"],
      description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      preferredTierCode: "da_ji",
      title: "已经穿了注意色",
    },
    contentVersion,
    groups: [
      {
        colors: [{ colorCode: "black", name: "黑色" }],
        element: "water",
        elementLabel: "水",
        explanation: "今日建议降低大面积使用比例。",
        rank: 4,
        relationText: "水生木",
        tierCode: "jiao_cha",
      },
      {
        colors: [{ colorCode: "yellow", name: "黄色" }],
        element: "earth",
        elementLabel: "土",
        explanation: "今日建议减少使用。",
        rank: 5,
        relationText: "木克土",
        tierCode: "bu_li",
      },
    ],
  },
  ciJiCard: {
    algorithmLabel: "次吉",
    colors: [{ colorCode: "green", name: "绿色" }],
    contentVersion,
    displayLabel: "稳妥选择",
    element: "wood",
    elementLabel: "木",
    explanation: "与今日五行相同，作为稳妥选择。",
    rank: 2,
    relationText: "木与木同类",
    tierCode: "ci_ji",
  },
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
  daJiCard: {
    algorithmLabel: "大吉",
    colors: [{ colorCode: "red", name: "红色" }],
    contentVersion,
    displayLabel: "今日优先",
    element: "fire",
    elementLabel: "火",
    explanation: "今日木日，木生火，火为大吉。",
    rank: 1,
    relationText: "木生火",
    tierCode: "da_ji",
  },
  imagePreviewSection: null,
  outfitPreviewSection: null,
  pingCard: {
    algorithmLabel: "平",
    colors: [{ colorCode: "white", name: "白色" }],
    contentVersion,
    displayLabel: "日常可穿",
    element: "metal",
    elementLabel: "金",
    explanation: "适合作为日常穿搭参考。",
    rank: 3,
    relationText: "金克木",
    tierCode: "ping",
  },
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

describe("ColorsPage", () => {
  beforeEach(() => {
    headersMock.mockReset();
    loadTodayMock.mockReset();
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-colors-page" }));
    loadTodayMock.mockResolvedValue(today);
  });

  it("shows the three positive decisions and the combined attention section from one version", async () => {
    render(await ColorsPage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(loadTodayMock).toHaveBeenCalledWith({ requestId: "request-colors-page" });
    expect(screen.getByRole("heading", { level: 1, name: "完整颜色建议" })).toBeVisible();
    expect(screen.getByRole("article", { name: "今日优先" })).toBeVisible();
    expect(screen.getByRole("article", { name: "稳妥选择" })).toBeVisible();
    expect(screen.getByRole("article", { name: "日常可穿" })).toBeVisible();
    expect(screen.getByRole("region", { name: "注意" })).toBeVisible();
    expect(screen.getByRole("article", { name: "完整颜色建议" })).toHaveAttribute(
      "data-content-version",
      contentVersion,
    );
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });

  it.each([
    ["invalid", { expectedContentVersion: contentVersion }, "暂时找不到这份颜色建议"],
    [
      "stale",
      { expectedContentVersion: "fd-20260714-r9", fortuneDate: "2026-07-15" },
      "这份颜色建议已经更新",
    ],
  ])("shows an understandable %s state", async (_status, searchParams, title) => {
    render(await ColorsPage({ searchParams: Promise.resolve(searchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent(title);
    expect(screen.queryByRole("heading", { name: "今日优先" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });

  it("shows unavailable when the current content cannot be loaded", async () => {
    loadTodayMock.mockResolvedValue(null);

    render(await ColorsPage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent("今日颜色暂时无法打开");
    expect(screen.getByRole("status")).toHaveTextContent("今日内容还没有加载成功");
  });
});
