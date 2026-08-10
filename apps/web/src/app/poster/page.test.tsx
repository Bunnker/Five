import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayPageData } from "../../lib/today";
import PosterPage from "./page";

const { headersMock, loadTodayMock } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  loadTodayMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("../../components/public-content-boundary-guard", () => ({
  PublicContentBoundaryGuard: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../lib/today", () => ({ loadToday: loadTodayMock }));

const contentVersion = "fd-20260715-r1";
const posterTemplateVersion = "poster-template-v3";
const today = {
  basis: {
    contentVersion,
    disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
    steps: ["固定历法规则"],
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
  imagePreviewSection: {
    cards: [{ aiDisclosure: "AI 生成穿搭示意图" }],
    contentVersion,
  },
  publicContentContext: {
    advancedFromCivilDate: true,
    servedFortuneDate: "2026-07-15",
    switchBoundary: "18:00",
  },
  requestContext: {
    civilDate: "2026-07-14",
    crossedDayBoundary: false,
    fortuneDate: "2026-07-14",
    shichen: "酉",
  },
  share: {
    contentVersion,
    copyText: "2026年7月15日 · 木日\n大吉：红色\n内容基于传统文化规则整理，仅供穿搭参考。",
    posterJobEndpoint: "/api/v1/poster-jobs",
    posterTemplateVersion,
    summaryText: "今日木日，优先参考红色。",
  },
} as TodayPageData;

const validSearchParams = {
  channelId: "wechat_group",
  expectedContentVersion: contentVersion,
  fortuneDate: "2026-07-15",
  posterTemplateVersion,
};

describe("PosterPage", () => {
  beforeEach(() => {
    headersMock.mockReset();
    loadTodayMock.mockReset();
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "request-poster-page" }));
    loadTodayMock.mockResolvedValue(today);
  });

  it("automatically prepares the served next-day poster without exposing internal versions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          assetUrl: "https://cdn.example.com/posters/poster-ready.svg",
          channelId: "user_share",
          currentActiveContentVersion: contentVersion,
          entry: {
            landingUrl:
              "https://five.example/daily/2026-07-15?channelId=user_share&expectedContentVersion=fd-20260715-r1&referralId=poster-job-ready&referralKind=poster",
            type: "web_qr",
          },
          jobId: "poster-job-ready",
          posterInstanceId: "poster-instance-ready",
          posterTemplateVersion,
          sourceContentVersion: contentVersion,
          status: "ready",
        }),
        {
          headers: {
            "content-type": "application/json",
            "x-request-id": "request-poster-job",
          },
          status: 200,
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(await PosterPage({ searchParams: Promise.resolve(validSearchParams) }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({
      channelId: "user_share",
      expectedContentVersion: contentVersion,
      fortuneDate: "2026-07-15",
    });
    expect(screen.getByRole("heading", { level: 1, name: "分享日签海报" })).toBeVisible();
    expect(screen.queryByText(contentVersion)).not.toBeInTheDocument();
    expect(screen.queryByText(posterTemplateVersion)).not.toBeInTheDocument();
    expect(screen.queryByText(/固定模板|已审核素材|来源内容/u)).not.toBeInTheDocument();
    expect(screen.getByText("内容基于传统文化规则整理，仅供穿搭参考。")).toBeVisible();
    expect(screen.getByText(/不会在访问时额外调用 AI 生图/u)).toBeVisible();
    expect(screen.getByText(/图片标识：AI 生成穿搭示意图/u)).toBeVisible();
    expect(await screen.findByRole("img", { name: "2026-07-15 日签海报" })).toBeVisible();

    const dailyUrl = new URL(
      screen.getByRole("link", { name: "返回当日内容" }).getAttribute("href") ?? "",
      "https://five.test",
    );
    expect(dailyUrl.pathname).toBe("/daily/2026-07-15");
    expect(Object.fromEntries(dailyUrl.searchParams)).toEqual({
      channelId: "user_share",
      expectedContentVersion: contentVersion,
    });
    const shareUrl = new URL(
      screen.getByRole("link", { name: "返回分享页" }).getAttribute("href") ?? "",
      "https://five.test",
    );
    expect(shareUrl.pathname).toBe("/share");
    expect(Object.fromEntries(shareUrl.searchParams)).toEqual({
      channelId: "wechat_group",
      expectedContentVersion: contentVersion,
      fortuneDate: "2026-07-15",
    });
  });

  it("rejects a template version that is not locked to the current share content", async () => {
    render(
      await PosterPage({
        searchParams: Promise.resolve({
          ...validSearchParams,
          posterTemplateVersion: "poster-template-old",
        }),
      }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("这份海报配置已经更新");
    expect(screen.queryByRole("button", { name: "生成日签海报" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回今日首页" })).toHaveAttribute("href", "/");
  });

  it("keeps the user-safe fallback and return path after automatic generation fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network unavailable")));
    render(await PosterPage({ searchParams: Promise.resolve(validSearchParams) }));

    expect(await screen.findByText(/海报暂时没有生成成功/u)).toBeVisible();
    expect(screen.queryByText(contentVersion)).not.toBeInTheDocument();
    expect(screen.getByText(/图片标识：AI 生成穿搭示意图/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "复制当日链接" })).toBeEnabled();
  });
});
