import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayPageData } from "../../lib/today";
import SharePage from "./page";

const { generateAnalyticsReferralIdMock, headersMock, loadTodayMock, trackAnalyticsEventMock } =
  vi.hoisted(() => ({
    generateAnalyticsReferralIdMock: vi.fn(),
    headersMock: vi.fn(),
    loadTodayMock: vi.fn(),
    trackAnalyticsEventMock: vi.fn(),
  }));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("../../components/public-content-boundary-guard", () => ({
  PublicContentBoundaryGuard: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../../lib/today", () => ({
  loadToday: loadTodayMock,
}));

vi.mock("../../lib/analytics", () => ({
  generateAnalyticsReferralId: generateAnalyticsReferralIdMock,
  trackAnalyticsEvent: trackAnalyticsEventMock,
}));

const contentVersion = "fd-20260715-r1";
const dailyCopyText = [
  "2026年7月15日 · 木日",
  "大吉：红色、橙色、紫色、粉色系",
  "次吉：绿色、青色、翠色、湖蓝、浅绿系",
  "平：白色、乳白、银色、金色、浅色系",
  "较差：黑色、藏青、宝蓝、墨绿、深灰系",
  "不利：黄色、咖色、棕色、卡其、褐色系",
  "内容基于传统文化规则整理，仅供穿搭参考。",
].join("\n");
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
  publicContentContext: {
    advancedFromCivilDate: true,
    servedFortuneDate: "2026-07-15",
    switchBoundary: "18:00",
  },
  requestContext: {
    civilDate: "2026-07-14",
    crossedDayBoundary: false,
    fortuneDate: "2026-07-14",
    shichen: "酉",
  },
  share: {
    contentVersion,
    copyText: dailyCopyText,
    posterJobEndpoint: "/api/v1/poster-jobs",
    posterTemplateVersion: "poster-template-v3",
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
    generateAnalyticsReferralIdMock.mockReset();
    trackAnalyticsEventMock.mockReset();
    generateAnalyticsReferralIdMock.mockReturnValue(
      "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-share-page" }));
    loadTodayMock.mockResolvedValue(today);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "execCommand");
  });

  it("shares the served next-day content after 18:00 with specified-date parameters", async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
      share: shareMock,
    });

    render(
      await SharePage({
        searchParams: Promise.resolve({
          ...validSearchParams,
          accountId: "private-account",
          birthDate: "1990-01-01",
        }),
      }),
    );

    expect(loadTodayMock).toHaveBeenCalledWith({ requestId: "request-share-page" });
    expect(screen.getByRole("heading", { level: 1, name: "分享当天五行页面" })).toBeVisible();
    expect(screen.queryByText("今日木日，优先参考红、橙、紫、粉色系。")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "可选择的今日分享文字" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制今日文字" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "分享到微信或更多应用" }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(writeTextMock).not.toHaveBeenCalled();
    const shareData = shareMock.mock.calls[0]?.[0] as ShareData;
    const shareUrl = new URL(shareData.url ?? "");
    expect(shareUrl.pathname).toBe("/daily/2026-07-15");
    expect(Object.fromEntries(shareUrl.searchParams)).toEqual({
      channelId: "user_share",
      expectedContentVersion: contentVersion,
      referralId: "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(shareData).toEqual({
      title: "Five · 2026-07-15 五行穿衣",
      url: expect.any(String),
    });
    expect(trackAnalyticsEventMock).toHaveBeenCalledWith({
      channelId: "user_share",
      contentVersion,
      eventName: "share_summary_initiated",
      fortuneDate: "2026-07-15",
      referralId: "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(trackAnalyticsEventMock.mock.invocationCallOrder[0]).toBeLessThan(
      shareMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(screen.getByRole("article", { name: "分享当天五行页面" })).toHaveAttribute(
      "data-content-version",
      contentVersion,
    );
    expect(screen.getByRole("article", { name: "分享当天五行页面" })).toHaveAttribute(
      "data-channel-id",
      "wechat_group",
    );
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute(
      "href",
      "/?channelId=wechat_group",
    );
    const posterUrl = new URL(
      screen.getByRole("link", { name: "生成并分享海报" }).getAttribute("href") ?? "",
      "https://five.test",
    );
    expect(posterUrl.pathname).toBe("/poster");
    expect(Object.fromEntries(posterUrl.searchParams)).toEqual({
      channelId: "wechat_group",
      expectedContentVersion: contentVersion,
      fortuneDate: "2026-07-15",
      posterTemplateVersion: "poster-template-v3",
    });
  });

  it("explains the native WeChat menu path without pretending the page sent anything", async () => {
    const shareMock = vi.fn();
    const writeTextMock = vi.fn();
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
      share: shareMock,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) MicroMessenger/8.0.60",
    });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "分享到微信或更多应用" }));

    expect(await screen.findByRole("status")).toHaveTextContent("微信右上角会分享当前引导页");
    expect(screen.getByRole("link", { name: "打开完整当日页面" })).toHaveAttribute(
      "href",
      "/daily/2026-07-15?channelId=user_share&expectedContentVersion=fd-20260715-r1&referralId=referral%3Aaaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(shareMock).not.toHaveBeenCalled();
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("copies the specified-date link when direct page sharing is unavailable", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
    });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "分享到微信或更多应用" }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    const copiedUrl = new URL(writeTextMock.mock.calls[0]?.[0] as string);
    expect(copiedUrl.pathname).toBe("/daily/2026-07-15");
    expect(Object.fromEntries(copiedUrl.searchParams)).toEqual({
      channelId: "user_share",
      expectedContentVersion: contentVersion,
      referralId: "referral:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "当前浏览器无法直接分享，页面链接已复制",
    );
  });

  it("always offers a separate copy-link action", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
      share: vi.fn().mockResolvedValue(undefined),
    });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("指定日期链接已复制");
  });

  it("falls back to copying the same page link when sharing fails", async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error("share unavailable"));
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
      share: shareMock,
    });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "分享到微信或更多应用" }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    expect(writeTextMock.mock.calls[0]?.[0]).toBe(
      new URL(
        "/daily/2026-07-15?channelId=user_share&expectedContentVersion=fd-20260715-r1&referralId=referral%3Aaaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        window.location.origin,
      ).toString(),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("页面分享未完成，链接已复制");
  });

  it("uses the selectable-copy fallback when clipboard permission is denied", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    const execCommandMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommandMock,
    });
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
    });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));

    await waitFor(() => expect(execCommandMock).toHaveBeenCalledWith("copy"));
    expect(await screen.findByRole("status")).toHaveTextContent("指定日期链接已复制");
    expect(screen.queryByRole("textbox", { name: "指定日期分享链接" })).not.toBeInTheDocument();
  });

  it("keeps a selectable dated link when automatic copying is unavailable", async () => {
    vi.stubGlobal("navigator", {});

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));

    const manualLink = await screen.findByRole("textbox", { name: "指定日期分享链接" });
    expect(manualLink).toHaveValue(
      new URL(
        "/daily/2026-07-15?channelId=user_share&expectedContentVersion=fd-20260715-r1&referralId=referral%3Aaaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        window.location.origin,
      ).toString(),
    );
    expect(manualLink).toHaveAttribute("readonly");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "自动复制失败，请长按下方链接手动复制",
    );
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
      "/",
    ],
    [
      "stale",
      {
        channelId: "wechat_group",
        expectedContentVersion: "fd-20260714-r9",
        fortuneDate: "2026-07-15",
      },
      "这份分享内容已经更新",
      "/?channelId=wechat_group",
    ],
  ])("shows an understandable %s state", async (_status, searchParams, title, homeHref) => {
    render(await SharePage({ searchParams: Promise.resolve(searchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent(title);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", homeHref);
  });

  it("shows unavailable when the versioned share text is missing", async () => {
    loadTodayMock.mockResolvedValue({ ...today, share: null });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent("分享内容暂时无法打开");
    expect(screen.getByRole("status")).toHaveTextContent("当日页面还没有加载完整");
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute(
      "href",
      "/?channelId=wechat_group",
    );
  });
});
