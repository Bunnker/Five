import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DailyLandingData } from "../../../lib/daily";
import DailyPage from "./page";

const { headersMock, loadDailyResultMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  loadDailyResultMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("../../../lib/daily", () => ({
  loadDailyResult: loadDailyResultMock,
}));

const contentVersion = "fd-20260715-r4";
const daily = {
  attentionSection: null,
  basis: {
    contentVersion,
    disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
    steps: ["今日干支为庚寅", "日柱地支取寅", "寅属木，因此今日为木日"],
  },
  ciJiCard: {
    algorithmLabel: "次吉",
    colors: [{ colorCode: "green", name: "绿色" }],
    contentVersion,
    displayLabel: "稳妥选择",
    element: "wood",
    elementLabel: "木",
    explanation: "与当日五行相同，作为稳妥选择。",
    rank: 2,
    relationText: "木与木同类",
    tierCode: "ci_ji",
  },
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
  daJiCard: {
    algorithmLabel: "大吉",
    colors: [{ colorCode: "red", name: "红色" }],
    contentVersion,
    displayLabel: "今日优先",
    element: "fire",
    elementLabel: "火",
    explanation: "当日木日，木生火，火为大吉。",
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
  versionChanged: true,
} as DailyLandingData;

describe("DailyPage", () => {
  beforeEach(() => {
    headersMock.mockReset();
    loadDailyResultMock.mockReset();
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-daily-page" }));
    loadDailyResultMock.mockResolvedValue({ daily, kind: "ready" });
  });

  it("renders the specified date and its current safe public version", async () => {
    render(
      await DailyPage({
        params: Promise.resolve({ fortuneDate: "2026-07-15" }),
        searchParams: Promise.resolve({
          channelId: "organic",
          expectedContentVersion: "fd-20260715-r3",
        }),
      }),
    );

    expect(loadDailyResultMock).toHaveBeenCalledWith({
      expectedContentVersion: "fd-20260715-r3",
      fortuneDate: "2026-07-15",
      requestId: "request-daily-page",
    });
    expect(screen.getByText("2026年7月15日")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "当日木日" })).toBeVisible();
    expect(screen.getByText("这份日期内容已更新")).toBeVisible();
    expect(screen.getByText("红色")).toBeVisible();
    expect(screen.getByText("绿色")).toBeVisible();
    expect(screen.getByText("白色")).toBeVisible();
    expect(screen.queryByText("当前时辰")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看今日参考" })).toHaveAttribute("href", "/");
  });

  it("does not add history, date browsing, or previous and next date entry points", async () => {
    render(
      await DailyPage({
        params: Promise.resolve({ fortuneDate: "2026-07-15" }),
        searchParams: Promise.resolve({}),
      }),
    );

    const forbidden = /历史|日历|上一日|下一日|选择日期/u;
    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAccessibleName(forbidden);
      expect(link.getAttribute("href") ?? "").not.toMatch(/history|calendar|date-picker/iu);
    }
    expect(screen.queryByRole("button", { name: forbidden })).not.toBeInTheDocument();
  });

  it("shows one safe state when the target is not public", async () => {
    loadDailyResultMock.mockResolvedValue({ kind: "unavailable" });

    render(
      await DailyPage({
        params: Promise.resolve({ fortuneDate: "2026-07-15" }),
        searchParams: Promise.resolve({
          expectedContentVersion: "old-private-version",
        }),
      }),
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("该日期内容暂时无法查看");
    expect(status).not.toHaveTextContent(/old-private-version|draft|withdrawn|草稿|下线/iu);
    expect(screen.queryByText("红色")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看今日参考" })).toHaveAttribute("href", "/");
  });

  it("shows an explicit safe landing when the historical share has expired", async () => {
    loadDailyResultMock.mockResolvedValue({ kind: "expired" });

    render(
      await DailyPage({
        params: Promise.resolve({ fortuneDate: "2026-04-01" }),
        searchParams: Promise.resolve({
          expectedContentVersion: "fd-20260401-r1",
        }),
      }),
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("历史内容已下线");
    expect(status).not.toHaveTextContent(/2026-04-01|fd-20260401-r1/iu);
    expect(screen.queryByText("红色")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到今日参考" })).toHaveAttribute("href", "/");
  });

  it("fails closed when the expected version query is ambiguous", async () => {
    render(
      await DailyPage({
        params: Promise.resolve({ fortuneDate: "2026-07-15" }),
        searchParams: Promise.resolve({
          expectedContentVersion: ["fd-20260715-r3", "fd-20260715-r4"],
        }),
      }),
    );

    expect(loadDailyResultMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("该日期内容暂时无法查看");
  });
});
