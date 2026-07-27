import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayPageData } from "../../lib/today";
import OutfitsPage from "./page";

const { headersMock, loadTodayMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  loadTodayMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: headersMock,
}));

vi.mock("../../lib/today", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/today")>()),
  loadToday: loadTodayMock,
}));

const today = {
  attentionSection: null,
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
  outfitPreviewSection: {
    cards: [
      {
        description: "同色系深浅变化属于穿搭参考。",
        formulaId: "formula-mono-01",
        href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-mono-01",
        kind: "mono",
        scenarioLabel: "日常",
        slots: [
          {
            colors: [{ colorCode: "red", name: "红色" }],
            ratioPercent: 100,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
        ],
        title: "红色同色系",
      },
      {
        description: "双色比例未确认时不编造百分比。",
        formulaId: "formula-dual-01",
        href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-dual-01",
        kind: "dual",
        scenarioLabel: "日常",
        slots: [
          {
            colors: [{ colorCode: "orange", name: "橙色" }],
            ratioPercent: 70,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
          {
            colors: [{ colorCode: "green", name: "绿色" }],
            ratioPercent: 30,
            role: "secondary",
            roleLabel: "辅助色",
            tierCode: "ci_ji",
          },
        ],
        title: "橙绿双色",
      },
      {
        description: "三色比例已由维护者确认。",
        formulaId: "formula-triple-01",
        href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-triple-01",
        kind: "triple",
        scenarioLabel: "通勤",
        slots: [
          {
            colors: [{ colorCode: "red", name: "红色" }],
            ratioPercent: 60,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
          {
            colors: [{ colorCode: "green", name: "绿色" }],
            ratioPercent: 30,
            role: "secondary",
            roleLabel: "辅助色",
            tierCode: "ci_ji",
          },
          {
            colors: [{ colorCode: "white", name: "白色" }],
            ratioPercent: 10,
            role: "accent",
            roleLabel: "点缀色",
            tierCode: "ping",
          },
        ],
        title: "通勤三色搭配",
      },
    ],
    contentVersion: "fd-20260715-r1",
  },
  imagePreviewSection: {
    cards: [
      {
        aiDisclosure: "AI 生成穿搭示意图",
        altText: "红色上衣、绿色下装和白色配饰的通勤穿搭",
        assetId: "asset-look-main-cover",
        displayLabel: "主方案",
        formulaId: "formula-triple-01",
        height: 1600,
        items: [
          { categoryLabel: "上衣", color: { colorCode: "red", name: "红色" } },
          { categoryLabel: "下装", color: { colorCode: "green", name: "绿色" } },
          { categoryLabel: "鞋包/配饰", color: { colorCode: "white", name: "白色" } },
        ],
        lookId: "look-triple-01",
        mediaType: "image/webp",
        placement: "primary",
        scenarioLabel: "通勤",
        sortOrder: 1,
        title: "木日通勤主方案",
        url: "https://cdn.five.test/assets/fd-20260715-r1/main-a1b2c3.webp",
        width: 1200,
      },
      {
        aiDisclosure: "AI 生成穿搭示意图",
        altText: "橙色上衣和绿色下装的日常穿搭",
        assetId: "asset-look-alternate-cover",
        displayLabel: "替代方案",
        formulaId: "formula-dual-01",
        height: 1600,
        items: [
          { categoryLabel: "上衣", color: { colorCode: "orange", name: "橙色" } },
          { categoryLabel: "下装", color: { colorCode: "green", name: "绿色" } },
        ],
        lookId: "look-dual-01",
        mediaType: "image/webp",
        placement: "alternate",
        scenarioLabel: "日常",
        sortOrder: 2,
        title: "橙绿双色日常方案",
        url: "https://cdn.five.test/assets/fd-20260715-r1/alternate-d4e5f6.webp",
        width: 1200,
      },
      {
        aiDisclosure: null,
        altText: "红色同色系日常穿搭",
        assetId: "asset-look-supplemental-cover",
        displayLabel: "更多场景",
        formulaId: "formula-mono-01",
        height: 1600,
        items: [
          { categoryLabel: "上衣", color: { colorCode: "red", name: "红色" } },
          { categoryLabel: "下装", color: { colorCode: "orange", name: "橙色" } },
        ],
        lookId: "look-mono-01",
        mediaType: "image/webp",
        placement: "supplemental",
        scenarioLabel: "日常",
        sortOrder: 3,
        title: "红色同色系日常方案",
        url: "https://cdn.five.test/assets/fd-20260715-r1/supplemental-g7h8i9.webp",
        width: 1200,
      },
    ],
    contentVersion: "fd-20260715-r1",
  },
  pingCard: null,
  requestContext: {
    civilDate: "2026-07-15",
    crossedDayBoundary: false,
    fortuneDate: "2026-07-15",
    shichen: "午",
  },
} satisfies TodayPageData;

describe("OutfitsPage", () => {
  beforeEach(() => {
    headersMock.mockReset();
    loadTodayMock.mockReset();
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-issue-15" }));
    loadTodayMock.mockResolvedValue(today);
  });

  it("shows mono, dual and triple sections with reviewed images and versioned detail links", async () => {
    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260715-r1",
        formulaId: "formula-dual-01",
        fortuneDate: "2026-07-15",
      }),
    });
    render(result);

    expect(loadTodayMock).toHaveBeenCalledWith({ requestId: "request-issue-15" });
    expect(screen.getByRole("heading", { level: 1, name: "今日怎么搭" })).toBeVisible();
    expect(screen.getByText("2026-07-15 · 当天已审核方案")).toBeVisible();

    const mono = screen.getByRole("region", { name: "单色 · 红色同色系" });
    const dual = screen.getByRole("region", { name: "双色 · 橙绿双色" });
    const triple = screen.getByRole("region", { name: "三色 · 通勤三色搭配" });
    expect([mono, dual, triple].map((section) => section.dataset.contentVersion)).toEqual([
      "fd-20260715-r1",
      "fd-20260715-r1",
      "fd-20260715-r1",
    ]);
    expect(dual).toHaveAttribute("data-selected", "true");

    expect(within(mono).getByRole("img", { name: "红色同色系日常穿搭" })).toHaveAttribute(
      "src",
      "https://cdn.five.test/assets/fd-20260715-r1/supplemental-g7h8i9.webp",
    );
    expect(within(dual).getByRole("img", { name: "橙色上衣和绿色下装的日常穿搭" })).toBeVisible();
    const monoImage = within(mono).getByRole("img", { name: "红色同色系日常穿搭" });
    const dualImage = within(dual).getByRole("img", {
      name: "橙色上衣和绿色下装的日常穿搭",
    });
    const tripleImage = within(triple).getByRole("img", {
      name: "红色上衣、绿色下装和白色配饰的通勤穿搭",
    });
    expect(monoImage).toHaveAttribute("loading", "eager");
    expect(dualImage).toHaveAttribute("loading", "lazy");
    expect(tripleImage).toBeVisible();

    expect(mono).toHaveTextContent("日常");
    expect(mono).toHaveTextContent("同色系深浅变化属于穿搭参考。");
    expect(dual).toHaveTextContent("主色");
    expect(dual).toHaveTextContent("辅助色");
    expect(triple).toHaveTextContent("点缀色");
    expect(triple).toHaveTextContent("60%");
    expect(triple).toHaveTextContent("30%");
    expect(triple).toHaveTextContent("10%");
    expect(triple).toHaveTextContent("红色");
    expect(triple).toHaveTextContent("绿色");
    expect(triple).toHaveTextContent("白色");
    expect(triple).toHaveTextContent("三色比例已由维护者确认。");
    expect(screen.getByText("比例为穿搭参考，不是五行推算规则。")).toBeVisible();

    expect(within(mono).getByRole("link", { name: "查看红色同色系详情" })).toHaveAttribute(
      "href",
      "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-mono-01&view=plan",
    );
    expect(within(dual).getByRole("link", { name: "查看橙绿双色详情" })).toHaveAttribute(
      "href",
      "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-dual-01&view=plan",
    );
    expect(within(triple).getByRole("link", { name: "查看通勤三色搭配详情" })).toHaveAttribute(
      "href",
      "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-triple-01&view=plan",
    );
    expect(screen.queryByText(/生成图片|重新生图|立即生图/u)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日颜色" })).toHaveAttribute("href", "/");
  });

  it("keeps the existing minimal plan view available until the detail issue expands it", async () => {
    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260715-r1",
        formulaId: "formula-triple-01",
        fortuneDate: "2026-07-15",
        view: "plan",
      }),
    });
    render(result);

    expect(screen.getByRole("heading", { level: 2, name: "通勤三色搭配" })).toBeVisible();
    expect(screen.getByText("2026-07-15 · 三色方案")).toBeVisible();
    expect(screen.getByRole("region", { name: "通勤三色搭配" })).toHaveAttribute(
      "data-content-version",
      "fd-20260715-r1",
    );
    expect(screen.getByRole("link", { name: "查看其他搭配" })).toHaveAttribute(
      "href",
      "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-triple-01",
    );
  });

  it("keeps all text formulas and the other reviewed images when one formula has no image", async () => {
    loadTodayMock.mockResolvedValue({
      ...today,
      imagePreviewSection: {
        cards: today.imagePreviewSection.cards.filter(
          (image) => image.formulaId !== "formula-mono-01",
        ),
        contentVersion: "fd-20260715-r1",
      },
    });

    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260715-r1",
        formulaId: "formula-mono-01",
        fortuneDate: "2026-07-15",
      }),
    });
    render(result);

    const mono = screen.getByRole("region", { name: "单色 · 红色同色系" });
    const dual = screen.getByRole("region", { name: "双色 · 橙绿双色" });
    const triple = screen.getByRole("region", { name: "三色 · 通勤三色搭配" });
    expect(within(mono).queryByRole("img")).not.toBeInTheDocument();
    expect(within(dual).getByRole("img")).toBeVisible();
    expect(within(triple).getByRole("img")).toBeVisible();
    expect(screen.queryAllByRole("img")).toHaveLength(2);
    expect(screen.queryByText(/暂无图片|图片生成中|点击生图/u)).not.toBeInTheDocument();
  });

  it("does not mix images from an older content version into current formulas", async () => {
    loadTodayMock.mockResolvedValue({
      ...today,
      imagePreviewSection: {
        ...today.imagePreviewSection,
        contentVersion: "fd-20260714-r9",
      },
    });

    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260715-r1",
        formulaId: "formula-mono-01",
        fortuneDate: "2026-07-15",
      }),
    });
    render(result);

    expect(screen.getByRole("region", { name: "单色 · 红色同色系" })).toBeVisible();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("uses the highest-priority reviewed image when one formula has multiple looks", async () => {
    loadTodayMock.mockResolvedValue({
      ...today,
      imagePreviewSection: {
        cards: [
          ...today.imagePreviewSection.cards,
          {
            ...today.imagePreviewSection.cards[2],
            altText: "三色方案的补充场景",
            formulaId: "formula-triple-01",
            lookId: "look-triple-supplemental-01",
            url: "https://cdn.five.test/assets/fd-20260715-r1/triple-supplemental.webp",
          },
        ],
        contentVersion: "fd-20260715-r1",
      },
    });

    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260715-r1",
        formulaId: "formula-triple-01",
        fortuneDate: "2026-07-15",
      }),
    });
    render(result);

    expect(
      within(screen.getByRole("region", { name: "三色 · 通勤三色搭配" })).getByRole("img"),
    ).toHaveAttribute("src", "https://cdn.five.test/assets/fd-20260715-r1/main-a1b2c3.webp");
  });

  it("does not show a formula when the expected content version is stale", async () => {
    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260714-r9",
        formulaId: "formula-triple-01",
        fortuneDate: "2026-07-15",
      }),
    });
    render(result);

    expect(screen.getByRole("status")).toHaveTextContent("这条搭配已经更新");
    expect(screen.queryByText("通勤三色搭配")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日颜色" })).toHaveAttribute("href", "/");
  });

  it("describes a temporary loading failure without claiming the content changed", async () => {
    loadTodayMock.mockResolvedValue(null);

    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260715-r1",
        formulaId: "formula-triple-01",
        fortuneDate: "2026-07-15",
      }),
    });
    render(result);

    expect(screen.getByRole("status")).toHaveTextContent("今日搭配暂时无法打开");
    expect(screen.getByRole("status")).toHaveTextContent("今日内容还没有加载成功");
    expect(screen.queryByText("这条搭配已经更新")).not.toBeInTheDocument();
    expect(screen.queryByText("通勤三色搭配")).not.toBeInTheDocument();
  });

  it("does not guess when the date or formula identifier is missing", async () => {
    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260715-r1",
        formulaId: ["formula-triple-01", "formula-dual-01"],
      }),
    });
    render(result);

    expect(screen.getByRole("status")).toHaveTextContent("暂时找不到这条搭配");
    expect(screen.queryByText("通勤三色搭配")).not.toBeInTheDocument();
  });

  it("describes an unknown formula as missing rather than updated", async () => {
    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260715-r1",
        formulaId: "formula-unknown-01",
        fortuneDate: "2026-07-15",
      }),
    });
    render(result);

    expect(screen.getByRole("status")).toHaveTextContent("暂时找不到这条搭配");
    expect(screen.queryByText("这条搭配已经更新")).not.toBeInTheDocument();
  });
});
