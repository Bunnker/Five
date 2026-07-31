import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  requestContext: {
    civilDate: "2026-07-15",
    crossedDayBoundary: false,
    fortuneDate: "2026-07-15",
    shichen: "午",
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
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-share-page" }));
    loadTodayMock.mockResolvedValue(today);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "execCommand");
  });

  it("opens the system share panel with only the specified-date landing parameters", async () => {
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
    expect(screen.getByRole("heading", { level: 1, name: "分享今日参考" })).toBeVisible();
    expect(screen.getByText("今日木日，优先参考红、橙、紫、粉色系。")).toBeVisible();
    expect(screen.getByText("可以直接复制，也可以长按选择下面的文字。")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "可选择的今日分享文字" })).toHaveValue(
      dailyCopyText,
    );
    expect(screen.getByRole("textbox", { name: "可选择的今日分享文字" })).toHaveAttribute(
      "readonly",
    );
    fireEvent.click(screen.getByRole("button", { name: "系统分享" }));

    await waitFor(() => expect(shareMock).toHaveBeenCalledTimes(1));
    expect(writeTextMock).not.toHaveBeenCalled();
    const shareData = shareMock.mock.calls[0]?.[0] as ShareData;
    const shareUrl = new URL(shareData.url ?? "");
    expect(shareUrl.pathname).toBe("/daily/2026-07-15");
    expect(Object.fromEntries(shareUrl.searchParams)).toEqual({
      channelId: "wechat_group",
      expectedContentVersion: contentVersion,
    });
    expect(shareData).toMatchObject({
      text: "今日木日，优先参考红、橙、紫、粉色系。",
      title: "Five · 2026-07-15 今日穿衣参考",
    });
    expect(screen.getByRole("article", { name: "分享今日参考" })).toHaveAttribute(
      "data-content-version",
      contentVersion,
    );
    expect(screen.getByRole("article", { name: "分享今日参考" })).toHaveAttribute(
      "data-channel-id",
      "wechat_group",
    );
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
    const posterUrl = new URL(
      screen.getByRole("link", { name: "生成日签海报" }).getAttribute("href") ?? "",
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

  it("copies the complete public daily summary for pasting into a WeChat group", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
      share: vi.fn().mockResolvedValue(undefined),
    });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "复制今日文字" }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith(dailyCopyText));
    const copiedText = writeTextMock.mock.calls[0]?.[0] as string;
    expect(copiedText).toContain("2026年7月15日 · 木日");
    expect(copiedText).toContain("大吉：");
    expect(copiedText).toContain("次吉：");
    expect(copiedText).toContain("平：");
    expect(copiedText).toContain("较差：");
    expect(copiedText).toContain("不利：");
    expect(copiedText).not.toMatch(/contentVersion|published|version|吉祥物|商品|卖货|转运/u);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "今日文字已复制，可直接粘贴到微信群",
    );
  });

  it("keeps browsing available and selects the public summary when text copying fails", async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    const execCommandMock = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommandMock,
    });
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
    });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "复制今日文字" }));

    const selectableCopy = screen.getByRole("textbox", { name: "可选择的今日分享文字" });
    await waitFor(() => expect(selectableCopy).toHaveFocus());
    expect(selectableCopy).toHaveProperty("selectionStart", 0);
    expect(selectableCopy).toHaveProperty("selectionEnd", dailyCopyText.length);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "自动复制失败，请长按上方文字手动复制",
    );
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });

  it("copies the specified-date link when the browser has no system share capability", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
    });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "系统分享" }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    const copiedUrl = new URL(writeTextMock.mock.calls[0]?.[0] as string);
    expect(copiedUrl.pathname).toBe("/daily/2026-07-15");
    expect(Object.fromEntries(copiedUrl.searchParams)).toEqual({
      channelId: "wechat_group",
      expectedContentVersion: contentVersion,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "当前浏览器不支持系统分享，链接已复制",
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

  it("falls back to copying the same link when system sharing fails", async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error("share unavailable"));
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: writeTextMock },
      share: shareMock,
    });

    render(await SharePage({ searchParams: Promise.resolve(validSearchParams) }));
    fireEvent.click(screen.getByRole("button", { name: "系统分享" }));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    expect(writeTextMock.mock.calls[0]?.[0]).toBe(
      new URL(
        "/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
        window.location.origin,
      ).toString(),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("系统分享未完成，链接已复制");
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
        "/daily/2026-07-15?channelId=wechat_group&expectedContentVersion=fd-20260715-r1",
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
