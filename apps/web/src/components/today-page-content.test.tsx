import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TodayPageData } from "../lib/today";
import { TodayPageContent } from "./today-page-content";
import { DailyExperienceView } from "./daily-experience-view";

const baseToday = {
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
  publicContentContext: {
    advancedFromCivilDate: false,
    servedFortuneDate: "2026-07-15",
    switchBoundary: "18:00",
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
  posterJobEndpoint: "/api/v1/poster-jobs",
  posterTemplateVersion: "poster-v1",
  summaryText: "今日木日，优先参考红、橙、紫、粉色系。",
} satisfies NonNullable<TodayPageData["share"]>;

const completeToday = {
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
};

describe("TodayPageContent", () => {
  it("uses the same public component tree while reporting only the last selected admin object", () => {
    const onSelectionChange = vi.fn();
    render(<DailyExperienceView today={completeToday} onSelectionChange={onSelectionChange} />);

    fireEvent.click(screen.getByRole("heading", { name: "今日木日" }));
    fireEvent.click(screen.getByText("今日木日，木生火，火为大吉。"));
    fireEvent.click(screen.getByRole("heading", { name: "红色同色系" }));
    fireEvent.click(screen.getByRole("link", { name: "分享今天" }));
    const helpNavigationAllowed = fireEvent.click(
      screen.getByRole("link", { name: "使用说明与反馈" }),
    );

    expect(onSelectionChange).toHaveBeenNthCalledWith(1, "calendar.summary");
    expect(onSelectionChange).toHaveBeenNthCalledWith(2, "tier.da_ji.explanation");
    expect(onSelectionChange).toHaveBeenNthCalledWith(3, "formula.formula-mono.title");
    expect(onSelectionChange).toHaveBeenLastCalledWith("share.copy");
    expect(helpNavigationAllowed).toBe(false);
    expect(screen.getByRole("main")).toHaveClass("page-shell");
  });

  it("opens the visible tier body as editable copy while keeping the rank algorithm readonly", () => {
    const onSelectionChange = vi.fn();
    render(
      <DailyExperienceView
        mode="admin-preview"
        today={completeToday}
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(screen.getByRole("heading", { name: "今日优先" }));
    fireEvent.click(screen.getByLabelText("第 1 档"));

    expect(onSelectionChange).toHaveBeenNthCalledWith(1, "tier.da_ji.explanation");
    expect(onSelectionChange).toHaveBeenNthCalledWith(2, "tier.da_ji.algorithm");
  });

  it("keeps the fixed date, color decisions, formulas and image preview page order", () => {
    render(<TodayPageContent today={completeToday} />);

    const text = screen.getByRole("main").textContent ?? "";
    expect(text.indexOf("今日木日")).toBeLessThan(text.indexOf("今日优先"));
    expect(text.indexOf("今日优先")).toBeLessThan(text.indexOf("稳妥选择"));
    expect(text.indexOf("稳妥选择")).toBeLessThan(text.indexOf("日常可穿"));
    expect(text.indexOf("日常可穿")).toBeLessThan(text.indexOf("较差"));
    expect(text.indexOf("较差")).toBeLessThan(text.indexOf("不利"));
    expect(text.indexOf("不利")).toBeLessThan(text.indexOf("今日怎么搭"));
    expect(text.indexOf("今日怎么搭")).toBeLessThan(text.indexOf("今日图片示范"));

    const decisionRegions = [
      screen.getByRole("article", { name: "今日优先" }),
      screen.getByRole("article", { name: "稳妥选择" }),
      screen.getByRole("article", { name: "日常可穿" }),
      screen.getByRole("region", { name: "较差 · 不利" }),
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

  it("emphasizes each tier element without exposing the professional relation label", () => {
    render(<TodayPageContent today={completeToday} />);

    const daJi = screen.getByRole("article", { name: "今日优先" });
    const ciJi = screen.getByRole("article", { name: "稳妥选择" });
    const ping = screen.getByRole("article", { name: "日常可穿" });
    const lowerTiers = screen.getByRole("region", { name: "较差 · 不利" });

    expect(within(daJi).getByText("火", { selector: "strong" })).toBeVisible();
    expect(within(ciJi).getByText("木", { selector: "strong" })).toBeVisible();
    expect(within(ping).getByText("金", { selector: "strong" })).toBeVisible();
    expect(within(lowerTiers).getByText("水", { selector: "strong" })).toBeVisible();
    expect(within(lowerTiers).getByText("土", { selector: "strong" })).toBeVisible();

    expect(within(daJi).queryByText("木生火")).not.toBeInTheDocument();
    expect(within(ciJi).queryByText("木与木同类")).not.toBeInTheDocument();
    expect(within(ping).queryByText("金克木")).not.toBeInTheDocument();
    expect(within(lowerTiers).queryByText("水生木")).not.toBeInTheDocument();
    expect(within(lowerTiers).queryByText("木克土")).not.toBeInTheDocument();
    expect(within(daJi).getByText("今日木日，木生火，火为大吉。")).toBeVisible();
  });

  it("offers real next steps and shows the reviewed reference statement after the images", () => {
    render(<TodayPageContent channelId="wechat_official" today={completeToday} />);

    expect(screen.getByRole("link", { name: "分享今天" })).toHaveAttribute(
      "href",
      "/share?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&channelId=wechat_official",
    );
    expect(screen.getByRole("link", { name: "使用说明与反馈" })).toHaveAttribute(
      "href",
      "/help?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&channelId=wechat_official",
    );
    expect(screen.getByRole("link", { name: "查看今日颜色" })).toHaveAttribute(
      "href",
      `${nextSteps.colorsHref}&channelId=wechat_official`,
    );
    expect(screen.getByRole("link", { name: "查看今日颜色" })).toHaveClass(
      "foundation-action",
      "foundation-action--full",
    );
    expect(screen.getByRole("link", { name: "看看怎么搭" })).toHaveAttribute(
      "href",
      `${nextSteps.outfitsHref}&channelId=wechat_official`,
    );
    expect(screen.getByRole("link", { name: "为什么这样排" })).toHaveAttribute(
      "href",
      `${nextSteps.basisHref}&channelId=wechat_official`,
    );
    expect(screen.getByRole("link", { name: "查看单色穿法：红色同色系" })).toHaveAttribute(
      "href",
      expect.stringContaining("channelId=wechat_official"),
    );

    const statement = screen.getByText(basis.disclaimer);
    expect(statement.closest("footer")).toHaveAttribute("data-content-version", "fd-20260715-r1");

    const text = screen.getByRole("main").textContent ?? "";
    expect(text.indexOf("今日图片示范")).toBeLessThan(text.indexOf("查看今日颜色"));
    expect(text.indexOf("查看今日颜色")).toBeLessThan(text.indexOf(basis.disclaimer));
    expect(text).not.toMatch(/即将上线|登录|收藏|历史|吉祥物/u);
  });
});
