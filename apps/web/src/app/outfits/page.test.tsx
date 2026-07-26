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

vi.mock("../../lib/today", () => ({
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
        formulaId: "formula-mono-01",
        href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-mono-01",
        kind: "mono",
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
        formulaId: "formula-dual-01",
        href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-dual-01",
        kind: "dual",
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
        formulaId: "formula-triple-01",
        href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-triple-01",
        kind: "triple",
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

  it("opens the selected current-version formula instead of a 404", async () => {
    const result = await OutfitsPage({
      searchParams: Promise.resolve({
        expectedContentVersion: "fd-20260715-r1",
        formulaId: "formula-triple-01",
        fortuneDate: "2026-07-15",
      }),
    });
    render(result);

    expect(loadTodayMock).toHaveBeenCalledWith({ requestId: "request-issue-15" });
    expect(screen.getByRole("heading", { level: 1, name: "今日怎么搭" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "通勤三色搭配" })).toBeVisible();
    expect(screen.getByText("2026-07-15 · 三色方案")).toBeVisible();

    const formula = screen.getByRole("region", { name: "通勤三色搭配" });
    expect(formula).toHaveAttribute("data-content-version", "fd-20260715-r1");
    expect(within(formula).getByText("主色")).toBeVisible();
    expect(within(formula).getByText("辅助色")).toBeVisible();
    expect(within(formula).getByText("点缀色")).toBeVisible();
    expect(within(formula).getByText("60%")).toBeVisible();
    expect(within(formula).getByText("30%")).toBeVisible();
    expect(within(formula).getByText("10%")).toBeVisible();
    expect(within(formula).getByText("红色")).toBeVisible();
    expect(within(formula).getByText("绿色")).toBeVisible();
    expect(within(formula).getByText("白色")).toBeVisible();
    expect(screen.getByRole("link", { name: "返回今日颜色" })).toHaveAttribute("href", "/");
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
