import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TodayPageData } from "../lib/today";
import { TodayPageContent } from "./today-page-content";

const baseToday = {
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
  requestContext: {
    civilDate: "2026-07-15",
    crossedDayBoundary: false,
    fortuneDate: "2026-07-15",
    shichen: "午",
  },
  imagePreviewSection: null,
  outfitPreviewSection: null,
} satisfies Omit<TodayPageData, "attentionSection" | "ciJiCard" | "daJiCard" | "pingCard">;

const daJiCard = {
  algorithmLabel: "大吉",
  colors: [{ colorCode: "red", name: "红色" }],
  contentVersion: "fd-20260715-r1",
  displayLabel: "今日优先",
  element: "fire",
  elementLabel: "火",
  explanation: "今日木日，木生火，火为大吉。",
  rank: 1,
  relationText: "木生火",
  tierCode: "da_ji",
} satisfies NonNullable<TodayPageData["daJiCard"]>;

const ciJiCard = {
  algorithmLabel: "次吉",
  colors: [{ colorCode: "lake_blue", name: "湖蓝" }],
  contentVersion: "fd-20260715-r1",
  displayLabel: "稳妥选择",
  element: "wood",
  elementLabel: "木",
  explanation: "与今日五行相同，作为稳妥选择。",
  rank: 2,
  relationText: "木与木同类",
  tierCode: "ci_ji",
} satisfies NonNullable<TodayPageData["ciJiCard"]>;

const pingCard = {
  algorithmLabel: "平",
  colors: [{ colorCode: "white", name: "白色" }],
  contentVersion: "fd-20260715-r1",
  displayLabel: "日常可穿",
  element: "metal",
  elementLabel: "金",
  explanation: "适合作为日常穿搭参考。",
  rank: 3,
  relationText: "金克木",
  tierCode: "ping",
} satisfies NonNullable<TodayPageData["pingCard"]>;

const attentionSection = {
  balanceSuggestion: {
    accessoryExamples: ["丝巾", "包"],
    description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
    preferredTierCode: "da_ji",
    title: "已经穿了注意色",
  },
  contentVersion: "fd-20260715-r1",
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
} satisfies NonNullable<TodayPageData["attentionSection"]>;

const outfitPreviewSection = {
  cards: [
    {
      description: "同色系深浅变化属于穿搭参考。",
      formulaId: "formula-mono",
      href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-mono",
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
      title: "红色同色系",
    },
    {
      description: "双色比例未确认时不编造百分比。",
      formulaId: "formula-dual",
      href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-dual",
      kind: "dual",
      scenarioLabel: "日常",
      slots: [
        {
          colors: [{ colorCode: "red", name: "红色" }],
          garmentParts: ["上衣"],
          ratioPercent: null,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
        {
          colors: [{ colorCode: "lake_blue", name: "湖蓝" }],
          garmentParts: ["下装"],
          ratioPercent: null,
          role: "secondary",
          roleLabel: "辅助色",
          tierCode: "ci_ji",
        },
      ],
      title: "红色与湖蓝",
    },
    {
      description: "60/30/10 为穿搭参考，不是五行推算规则。",
      formulaId: "formula-triple",
      href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-triple",
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
          colors: [{ colorCode: "lake_blue", name: "湖蓝" }],
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
      title: "三色通勤",
    },
  ],
  contentVersion: "fd-20260715-r1",
} satisfies NonNullable<TodayPageData["outfitPreviewSection"]>;

const imagePreviewSection = {
  cards: [
    {
      aiDisclosure: "AI 生成穿搭示意图",
      altText: "红色通勤穿搭",
      assetId: "asset-main",
      displayLabel: "主方案",
      formulaId: "formula-triple",
      height: 1600,
      items: [{ categoryLabel: "上衣", color: { colorCode: "red", name: "红色" } }],
      lookId: "look-main",
      mediaType: "image/webp",
      placement: "primary",
      scenarioLabel: "通勤",
      sortOrder: 1,
      title: "红色通勤主方案",
      url: "https://cdn.five.test/assets/fd-20260715-r1/main.webp",
      width: 1200,
    },
    {
      aiDisclosure: "AI 生成穿搭示意图",
      altText: "红色上衣和湖蓝下装的日常穿搭",
      assetId: "asset-alternate",
      displayLabel: "替代方案",
      formulaId: "formula-dual",
      height: 1600,
      items: [
        { categoryLabel: "上衣", color: { colorCode: "red", name: "红色" } },
        { categoryLabel: "下装", color: { colorCode: "lake_blue", name: "湖蓝" } },
      ],
      lookId: "look-alternate",
      mediaType: "image/webp",
      placement: "alternate",
      scenarioLabel: "日常",
      sortOrder: 2,
      title: "红色与湖蓝替代方案",
      url: "https://cdn.five.test/assets/fd-20260715-r1/alternate.webp",
      width: 1200,
    },
  ],
  contentVersion: "fd-20260715-r1",
} satisfies NonNullable<TodayPageData["imagePreviewSection"]>;

const basis = {
  contentVersion: "fd-20260715-r1",
  disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
  steps: ["今日干支为庚寅", "日柱地支取寅", "寅属木，因此今日为木日"],
} satisfies NonNullable<TodayPageData["basis"]>;

const nextSteps = {
  basisHref: "/basis?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1",
  colorsHref: "/colors?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1",
  contentVersion: "fd-20260715-r1",
  outfitsHref:
    "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-mono",
  shareHref:
    "/share?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&channelId=organic",
} satisfies NonNullable<TodayPageData["nextSteps"]>;

const share = {
  contentVersion: "fd-20260715-r1",
  copyText: "今日穿搭参考：优先火色，稳妥选择木色。",
  summaryText: "今日木日，优先参考红、橙、紫、粉色系。",
} satisfies NonNullable<TodayPageData["share"]>;

describe("TodayPageContent", () => {
  it("keeps the fixed date, color decisions, formulas and image preview page order", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          attentionSection,
          ciJiCard,
          daJiCard,
          imagePreviewSection,
          outfitPreviewSection,
          pingCard,
        }}
      />,
    );

    const text = screen.getByRole("main").textContent ?? "";
    expect(text.indexOf("今日 木 日")).toBeLessThan(text.indexOf("今日优先"));
    expect(text.indexOf("今日优先")).toBeLessThan(text.indexOf("稳妥选择"));
    expect(text.indexOf("稳妥选择")).toBeLessThan(text.indexOf("日常可穿"));
    expect(text.indexOf("日常可穿")).toBeLessThan(text.indexOf("注意"));
    expect(text.indexOf("注意")).toBeLessThan(text.indexOf("今日怎么搭"));
    expect(text.indexOf("今日怎么搭")).toBeLessThan(text.indexOf("今日图片示范"));

    const decisionRegions = [
      screen.getByRole("article", { name: "今日优先" }),
      screen.getByRole("article", { name: "稳妥选择" }),
      screen.getByRole("article", { name: "日常可穿" }),
      screen.getByRole("region", { name: "注意" }),
      screen.getByRole("region", { name: "今日怎么搭" }),
      screen.getByRole("region", { name: "今日图片示范" }),
    ];
    expect(new Set(decisionRegions.map((card) => card.getAttribute("aria-labelledby"))).size).toBe(
      6,
    );
    expect(new Set(decisionRegions.map((card) => card.dataset.contentVersion))).toEqual(
      new Set(["fd-20260715-r1"]),
    );
  });

  it("keeps da_ji but does not show an orphan ping card when ci_ji is unavailable", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          attentionSection,
          ciJiCard: null,
          daJiCard,
          pingCard,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "今日优先" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "稳妥选择" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "日常可穿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "注意" })).not.toBeInTheDocument();
  });

  it("does not show orphan ci_ji or ping cards when da_ji is unavailable", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          attentionSection,
          ciJiCard,
          daJiCard: null,
          pingCard,
        }}
      />,
    );

    expect(screen.queryByRole("heading", { name: "今日优先" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "稳妥选择" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "日常可穿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "注意" })).not.toBeInTheDocument();
  });

  it("keeps da_ji and ci_ji when ping is unavailable", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          attentionSection,
          ciJiCard,
          daJiCard,
          pingCard: null,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "今日优先" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "稳妥选择" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "日常可穿" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "注意" })).not.toBeInTheDocument();
  });

  it("keeps positive cards, formulas and images when attention is unavailable", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          attentionSection: null,
          basis,
          ciJiCard,
          daJiCard,
          imagePreviewSection,
          outfitPreviewSection,
          pingCard,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "今日优先" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "稳妥选择" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "日常可穿" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "注意" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "今日怎么搭" })).toBeVisible();
    expect(screen.getByRole("region", { name: "今日图片示范" })).toBeVisible();
    expect(screen.getByText(basis.disclaimer)).toBeVisible();
  });

  it("offers four real next steps and shows the reviewed reference statement after the images", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          attentionSection,
          basis,
          ciJiCard,
          daJiCard,
          imagePreviewSection,
          nextSteps,
          outfitPreviewSection,
          pingCard,
          share,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "分享今天" })).toHaveAttribute(
      "href",
      nextSteps.shareHref,
    );
    expect(screen.getByRole("link", { name: "查看今日颜色" })).toHaveAttribute(
      "href",
      nextSteps.colorsHref,
    );
    expect(screen.getByRole("link", { name: "查看今日颜色" })).toHaveClass(
      "foundation-action",
      "foundation-action--full",
    );
    expect(screen.getByRole("link", { name: "看看怎么搭" })).toHaveAttribute(
      "href",
      nextSteps.outfitsHref,
    );
    expect(screen.getByRole("link", { name: "为什么这样排" })).toHaveAttribute(
      "href",
      nextSteps.basisHref,
    );

    const statement = screen.getByText(basis.disclaimer);
    expect(statement.closest("footer")).toHaveAttribute("data-content-version", "fd-20260715-r1");

    const text = screen.getByRole("main").textContent ?? "";
    expect(text.indexOf("今日图片示范")).toBeLessThan(text.indexOf("查看今日颜色"));
    expect(text.indexOf("查看今日颜色")).toBeLessThan(text.indexOf(basis.disclaimer));
    expect(text).not.toMatch(/即将上线|登录|收藏|历史|吉祥物/u);
  });
});
