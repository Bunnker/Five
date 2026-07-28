import { render, screen, within } from "@testing-library/react";
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
  outfitPreviewSection: {
    cards: [
      {
        description: "同色系深浅变化属于穿搭参考。",
        formulaId: "formula-mono-01",
        href: `/outfits?fortuneDate=2026-07-15&expectedContentVersion=${contentVersion}&formulaId=formula-mono-01`,
        kind: "mono",
        scenarioLabel: "日常",
        slots: [
          {
            colors: [{ colorCode: "red", name: "红色" }],
            garmentParts: ["上衣", "下装"],
            ratioPercent: 100,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
        ],
        title: "大吉色同色系",
      },
      {
        description: "双色比例可按场景灵活调整，不必固定百分比。",
        formulaId: "formula-dual-01",
        href: `/outfits?fortuneDate=2026-07-15&expectedContentVersion=${contentVersion}&formulaId=formula-dual-01`,
        kind: "dual",
        scenarioLabel: "日常",
        slots: [
          {
            colors: [{ colorCode: "red", name: "红色" }],
            garmentParts: ["上衣"],
            ratioPercent: 70,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
          {
            colors: [{ colorCode: "green", name: "绿色" }],
            garmentParts: ["下装"],
            ratioPercent: 30,
            role: "secondary",
            roleLabel: "辅助色",
            tierCode: "ci_ji",
          },
        ],
        title: "大吉 × 次吉",
      },
      {
        description: "60/30/10 为穿搭参考，不是五行推算规则。",
        formulaId: "formula-triple-01",
        href: `/outfits?fortuneDate=2026-07-15&expectedContentVersion=${contentVersion}&formulaId=formula-triple-01`,
        kind: "triple",
        scenarioLabel: "通勤",
        slots: [
          {
            colors: [{ colorCode: "red", name: "红色" }],
            garmentParts: ["上衣"],
            ratioPercent: 60,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
          {
            colors: [{ colorCode: "green", name: "绿色" }],
            garmentParts: ["下装"],
            ratioPercent: 30,
            role: "secondary",
            roleLabel: "辅助色",
            tierCode: "ci_ji",
          },
          {
            colors: [{ colorCode: "white", name: "白色" }],
            garmentParts: ["鞋包", "配饰"],
            ratioPercent: 10,
            role: "accent",
            roleLabel: "点缀色",
            tierCode: "ping",
          },
        ],
        title: "大吉 × 次吉 × 平",
      },
    ],
    contentVersion,
  },
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
    const daJi = screen.getByRole("article", { name: "今日优先" });
    const ciJi = screen.getByRole("article", { name: "稳妥选择" });
    const ping = screen.getByRole("article", { name: "日常可穿" });
    const attention = screen.getByRole("region", { name: "注意" });

    expect(daJi).toHaveTextContent("大吉");
    expect(daJi).toHaveTextContent("火");
    expect(daJi).toHaveTextContent("木生火");
    expect(daJi).toHaveTextContent("今日木日，木生火，火为大吉。");
    expect(daJi).toHaveTextContent("红色");
    expect(ciJi).toHaveTextContent("次吉");
    expect(ciJi).toHaveTextContent("木与木同类");
    expect(ping).toHaveTextContent("平");
    expect(ping).toHaveTextContent("金克木");
    expect(attention).toBeVisible();
    expect(within(attention).queryByRole("link")).not.toBeInTheDocument();

    expect(within(daJi).getByRole("link", { name: "查看大吉穿法" })).toHaveAttribute(
      "href",
      `/outfits?fortuneDate=2026-07-15&expectedContentVersion=${contentVersion}&formulaId=formula-mono-01`,
    );
    expect(within(ciJi).getByRole("link", { name: "查看次吉穿法" })).toHaveAttribute(
      "href",
      `/outfits?fortuneDate=2026-07-15&expectedContentVersion=${contentVersion}&formulaId=formula-dual-01`,
    );
    expect(within(ping).getByRole("link", { name: "查看平穿法" })).toHaveAttribute(
      "href",
      `/outfits?fortuneDate=2026-07-15&expectedContentVersion=${contentVersion}&formulaId=formula-triple-01`,
    );
    expect(screen.getByRole("link", { name: "看看怎么搭" })).toHaveAttribute(
      "href",
      `/outfits?fortuneDate=2026-07-15&expectedContentVersion=${contentVersion}&formulaId=formula-mono-01`,
    );
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

  it("does not mix color cards with outfit links from another content version", async () => {
    loadTodayMock.mockResolvedValue({
      ...today,
      outfitPreviewSection: {
        ...today.outfitPreviewSection!,
        contentVersion: "fd-20260715-r2",
      },
    });

    render(await ColorsPage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(screen.getByRole("status")).toHaveTextContent("今日颜色暂时无法打开");
    expect(screen.queryByRole("link", { name: /查看.*穿法/u })).not.toBeInTheDocument();
  });

  it("opens the first published outfit that actually uses each positive tier", async () => {
    const outfitPreviewSection = today.outfitPreviewSection!;
    loadTodayMock.mockResolvedValue({
      ...today,
      outfitPreviewSection: {
        ...outfitPreviewSection,
        cards: [
          outfitPreviewSection.cards[0],
          {
            ...outfitPreviewSection.cards[1],
            slots: [
              outfitPreviewSection.cards[1].slots[0]!,
              {
                colors: [{ colorCode: "white", name: "白色" }],
                garmentParts: ["下装"],
                ratioPercent: 30,
                role: "secondary",
                roleLabel: "辅助色",
                tierCode: "ping",
              },
            ],
          },
          outfitPreviewSection.cards[2],
        ],
      },
    });

    render(await ColorsPage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(screen.getByRole("link", { name: "查看次吉穿法" })).toHaveAttribute(
      "href",
      expect.stringContaining("formulaId=formula-triple-01"),
    );
    expect(screen.getByRole("link", { name: "查看平穿法" })).toHaveAttribute(
      "href",
      expect.stringContaining("formulaId=formula-dual-01"),
    );
  });
});
