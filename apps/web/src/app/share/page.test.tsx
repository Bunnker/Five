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
    expect(screen.getByText("可以长按选择下面的文字。")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "可选择的今日分享文字" })).toHaveValue(
      "今日穿搭参考：优先火色，稳妥选择木色。",
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
    expect(screen.getByRole("status")).toHaveTextContent("当前浏览器不支持系统分享，链接已复制");
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
    expect(screen.getByRole("status")).toHaveTextContent("指定日期链接已复制");
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
    expect(screen.getByRole("status")).toHaveTextContent("系统分享未完成，链接已复制");
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
    expect(screen.getByRole("status")).toHaveTextContent("指定日期链接已复制");
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
    expect(screen.getByRole("status")).toHaveTextContent("自动复制失败，请长按下方链接手动复制");
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
