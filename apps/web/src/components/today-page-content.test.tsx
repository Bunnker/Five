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
} satisfies Omit<TodayPageData, "ciJiCard" | "daJiCard" | "pingCard">;

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

describe("TodayPageContent", () => {
  it("keeps the fixed date, da_ji, ci_ji, ping page order", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
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

    const decisionCards = [
      screen.getByRole("article", { name: "今日优先" }),
      screen.getByRole("article", { name: "稳妥选择" }),
      screen.getByRole("article", { name: "日常可穿" }),
    ];
    expect(new Set(decisionCards.map((card) => card.getAttribute("aria-labelledby"))).size).toBe(3);
  });

  it("keeps da_ji but does not show an orphan ping card when ci_ji is unavailable", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          ciJiCard: null,
          daJiCard,
          pingCard,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "今日优先" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "稳妥选择" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "日常可穿" })).not.toBeInTheDocument();
  });

  it("does not show orphan ci_ji or ping cards when da_ji is unavailable", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          ciJiCard,
          daJiCard: null,
          pingCard,
        }}
      />,
    );

    expect(screen.queryByRole("heading", { name: "今日优先" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "稳妥选择" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "日常可穿" })).not.toBeInTheDocument();
  });

  it("keeps da_ji and ci_ji when ping is unavailable", () => {
    render(
      <TodayPageContent
        today={{
          ...baseToday,
          ciJiCard,
          daJiCard,
          pingCard: null,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "今日优先" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "稳妥选择" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "日常可穿" })).not.toBeInTheDocument();
  });
});
