import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayPageData } from "../../lib/today";
import SharePage from "./page";

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
  ciJiCard: null,
  content: {
    calendar: {
      branch: "寅",
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
  share: {
    contentVersion,
    copyText: "今日穿搭参考：优先火色，稳妥选择木色。",
    summaryText: "今日木日，优先参考红、橙、紫、粉色系。",
  },
} as TodayPageData;

const validSearchParams = {
  channelId: "wechat_group",
  expectedContentVersion: contentVersion,
  fortuneDate: "2026-07-15",
};

describe("SharePage", () => {
  beforeEach(() => {
    headersMock.mockReset();
    loadTodayMock.mockReset();
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-share-page" }));
    loadTodayMock.mockResolvedValue(today);
  });

  it("shows the published summary and selectable copy without starting later share features", async () => {
    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(loadTodayMock).toHaveBeenCalledWith({ requestId: "request-share-page" });
    expect(screen.getByRole("heading", { level: 1, name: "分享今日参考" })).toBeVisible();
    expect(screen.getByText("今日木日，优先参考红、橙、紫、粉色系。")).toBeVisible();
    expect(screen.getByText("可以长按选择下面的文字。")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "可选择的今日分享文字" })).toHaveValue(
      "今日穿搭参考：优先火色，稳妥选择木色。",
    );
    expect(screen.getByRole("textbox", { name: "可选择的今日分享文字" })).toHaveAttribute(
      "readonly",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/系统分享|复制链接|生成海报/u)).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "分享今日参考" })).toHaveAttribute(
      "data-content-version",
      contentVersion,
    );
    expect(screen.getByRole("article", { name: "分享今日参考" })).toHaveAttribute(
      "data-channel-id",
      "wechat_group",
    );
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });

  it.each([
    [
      "invalid",
      {
        channelId: ["wechat_group", "organic"],
        expectedContentVersion: contentVersion,
        fortuneDate: "2026-07-15",
      },
      "暂时找不到这份分享内容",
    ],
    [
      "stale",
      {
        channelId: "wechat_group",
        expectedContentVersion: "fd-20260714-r9",
        fortuneDate: "2026-07-15",
      },
      "这份分享内容已经更新",
    ],
  ])("shows an understandable %s state", async (_status, searchParams, title) => {
    render(await SharePage({ searchParams: Promise.resolve(searchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent(title);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });

  it("shows unavailable when the versioned share text is missing", async () => {
    loadTodayMock.mockResolvedValue({ ...today, share: null });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent("分享内容暂时无法打开");
    expect(screen.getByRole("status")).toHaveTextContent("当日分享文字还没有加载完整");
  });
});
