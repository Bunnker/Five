import { render, screen, within } from "@testing-library/react";
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
  attentionSection: {
    balanceSuggestion: {
      accessoryExamples: ["丝巾"],
      description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      preferredTierCode: "da_ji",
      title: "已经穿了注意色",
    },
    contentVersion,
    groups: [
      {
        algorithmLabel: "较差",
        colors: [{ colorCode: "black", name: "黑色" }],
        displayLabel: "注意",
        element: "water",
        elementLabel: "水",
        explanation: "今日建议降低大面积使用比例。",
        rank: 4,
        relationText: "水生木",
        tierCode: "jiao_cha",
      },
      {
        algorithmLabel: "不利",
        colors: [{ colorCode: "yellow", name: "黄色" }],
        displayLabel: "注意",
        element: "earth",
        elementLabel: "土",
        explanation: "今日建议减少使用。",
        rank: 5,
        relationText: "木克土",
        tierCode: "bu_li",
      },
    ],
  },
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
    explanation: "与今日五行相同，作为稳妥选择。",
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

describe("BasisPage", () => {
  beforeEach(() => {
    headersMock.mockReset();
    loadTodayMock.mockReset();
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-basis-page" }));
    loadTodayMock.mockResolvedValue(today);
  });

  it("explains the published day branch and all five color tiers from one active snapshot", async () => {
    render(await BasisPage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(loadTodayMock).toHaveBeenCalledWith({ requestId: "request-basis-page" });
    expect(screen.getByRole("heading", { level: 1, name: "为什么这样排" })).toBeVisible();
    const steps = within(screen.getByRole("region", { name: "三步看懂当天五行" })).getAllByRole(
      "listitem",
    );
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent("今日干支");
    expect(steps[0]).toHaveTextContent("庚寅日");
    expect(steps[1]).toHaveTextContent("日柱地支");
    expect(steps[1]).toHaveTextContent("寅");
    expect(steps[2]).toHaveTextContent("当日五行");
    expect(steps[2]).toHaveTextContent("木日");

    const relations = screen.getByRole("region", { name: "五档与颜色" });
    const tiers = within(relations).getAllByRole("article");
    expect(tiers).toHaveLength(5);
    expect(within(relations).getByRole("article", { name: "大吉 今日优先" })).toHaveTextContent(
      "木生火",
    );
    expect(within(relations).getByRole("article", { name: "次吉 稳妥选择" })).toHaveTextContent(
      "木与木同类",
    );
    expect(within(relations).getByRole("article", { name: "平 日常可穿" })).toHaveTextContent(
      "金克木",
    );
    expect(within(relations).getByRole("article", { name: "较差" })).toHaveTextContent("水生木");
    expect(within(relations).getByRole("article", { name: "不利" })).toHaveTextContent("木克土");
    expect(relations).not.toHaveTextContent("注意");
    expect(within(relations).getByText("红色")).toBeVisible();
    expect(within(relations).getByText("绿色")).toBeVisible();
    expect(within(relations).getByText("白色")).toBeVisible();
    expect(within(relations).getByText("黑色")).toBeVisible();
    expect(within(relations).getByText("黄色")).toBeVisible();
    expect(screen.getByText("内容基于传统文化规则整理，仅供穿搭参考。")).toBeVisible();
    expect(screen.queryByText(/黄历|今日运程|年柱|月柱|保证转运/u)).not.toBeInTheDocument();
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

  it.each([
    [
      "a tier from another content version",
      {
        ...today,
        attentionSection: {
          ...today.attentionSection!,
          contentVersion: "fd-20260715-r2",
        },
      },
    ],
    [
      "basis copy that disagrees with the structured calendar",
      {
        ...today,
        basis: {
          ...today.basis!,
          steps: ["今日干支为辛卯", "日柱地支取卯", "卯属木，因此今日为木日"],
        },
      },
    ],
  ])("does not render %s as a complete calculation basis", async (_case, invalidToday) => {
    loadTodayMock.mockResolvedValue(invalidToday);

    render(await BasisPage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent("推算依据暂时无法打开");
    expect(screen.queryByRole("region", { name: "三步看懂当天五行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "五档与颜色" })).not.toBeInTheDocument();
  });
});
