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
    description: "可以用当日大吉色的普通配饰做小面积补充。",
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

describe("TodayPageContent", () => {
  it("keeps the fixed date, three positive cards and attention page order", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          attentionSection,
          ciJiCard,
          daJiCard,
          pingCard,
        }}
      />,
    );

    const text = screen.getByRole("main").textContent ?? "";
    expect(text.indexOf("今日 木 日")).toBeLessThan(text.indexOf("今日优先"));
    expect(text.indexOf("今日优先")).toBeLessThan(text.indexOf("稳妥选择"));
    expect(text.indexOf("稳妥选择")).toBeLessThan(text.indexOf("日常可穿"));
    expect(text.indexOf("日常可穿")).toBeLessThan(text.indexOf("注意"));

    const decisionRegions = [
      screen.getByRole("article", { name: "今日优先" }),
      screen.getByRole("article", { name: "稳妥选择" }),
      screen.getByRole("article", { name: "日常可穿" }),
      screen.getByRole("region", { name: "注意" }),
    ];
    expect(new Set(decisionRegions.map((card) => card.getAttribute("aria-labelledby"))).size).toBe(
      4,
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

  it("keeps all three positive cards when attention is unavailable", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          attentionSection: null,
          ciJiCard,
          daJiCard,
          pingCard,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "今日优先" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "稳妥选择" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "日常可穿" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "注意" })).not.toBeInTheDocument();
  });
});
