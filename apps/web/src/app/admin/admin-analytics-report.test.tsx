import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminApi,
  type AdminAnalyticsReport,
  type AdminApiResult,
  type AdminSession,
} from "./admin-api";
import { AdminAnalyticsReportScreen, AdminAnalyticsReportView } from "./admin-analytics-report";
import { AdminSessionProvider } from "./admin-session-context";

const session: AdminSession = {
  absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
  credentialRevision: 3,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
  issuedAt: new Date().toISOString(),
  username: "maintainer",
};

function apiSuccess<T>(data: T): AdminApiResult<T> {
  return { data, ok: true, response: new Response(null, { status: 200 }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function report(overrides: Partial<AdminAnalyticsReport> = {}): AdminAnalyticsReport {
  const daily = Array.from({ length: 7 }, (_, index) => ({
    anonymousBrowsers: [4, 5, 7, 6, 9, 10, 12][index] ?? 0,
    fortuneDate: `2026-08-${String(index + 3).padStart(2, "0")}`,
    outfitDetailVisitors: [1, 1, 2, 2, 3, 4, 5][index] ?? 0,
    outfitHubVisitors: [2, 3, 4, 3, 5, 6, 7][index] ?? 0,
    pageViews: [6, 8, 11, 9, 14, 16, 19][index] ?? 0,
    posterSaveSucceeded: index === 5 || index === 6 ? 1 : 0,
    referredBrowsers: index >= 4 ? 1 : 0,
    shareInitiations: [0, 1, 1, 2, 2, 3, 6][index] ?? 0,
    sharingBrowsers: [0, 1, 1, 1, 2, 3, 4][index] ?? 0,
  }));
  return {
    channelBreakdown: [
      { anonymousBrowsers: 12, channelId: "organic", pageViews: 50, ratio: 50 / 83 },
      {
        anonymousBrowsers: 8,
        channelId: "wechat_official",
        pageViews: 21,
        ratio: 21 / 83,
      },
      { anonymousBrowsers: 5, channelId: "user_share", pageViews: 12, ratio: 12 / 83 },
      { anonymousBrowsers: 0, channelId: "other", pageViews: 0, ratio: 0 },
    ],
    collectionStatus: "active",
    daily,
    days: 7,
    fromFortuneDate: "2026-08-03",
    generatedAt: "2026-08-09T17:10:00+08:00",
    summary: {
      anonymousBrowsers: 24,
      channelId: null,
      collectionStatus: "active",
      contentVersion: null,
      fromFortuneDate: "2026-08-03",
      generatedAt: "2026-08-09T17:10:00+08:00",
      outfitDetailRate: { denominator: 24, numerator: 9, ratio: 0.375 },
      outfitDetailVisitors: 9,
      outfitHubVisitors: 15,
      pageViews: 83,
      posterSaveFailed: 1,
      posterSaveRequests: 3,
      posterSaveSucceeded: 2,
      referredBrowsers: 3,
      shareInitiationRate: { denominator: 24, numerator: 8, ratio: 1 / 3 },
      shareInitiations: 15,
      sharingBrowsers: 8,
      toFortuneDate: "2026-08-09",
    },
    toFortuneDate: "2026-08-09",
    ...overrides,
  };
}

describe("AdminAnalyticsReportView", () => {
  it("shows an accessible seven-day report without claiming anonymous browsers are people", () => {
    render(<AdminAnalyticsReportView report={report()} />);

    expect(screen.getByRole("heading", { name: "数据报表" })).toBeInTheDocument();
    const range = screen.getByRole("group", { name: "报表时间范围" });
    expect(within(range).getByRole("link", { name: "近 7 天" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(range).getByRole("link", { name: "近 30 天" })).toHaveAttribute(
      "href",
      "/admin/analytics?days=30",
    );

    expect(screen.getByText("24 个")).toBeInTheDocument();
    expect(screen.getByText("83 次")).toBeInTheDocument();
    expect(screen.getByText("37.5%")).toBeInTheDocument();
    expect(screen.getByText("33.3%")).toBeInTheDocument();
    expect(screen.getByText("3 个")).toBeInTheDocument();
    expect(screen.getByText("2 次")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "最近 7 天访问趋势" })).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "区间行为人数对比" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "关键行为发生了多少" })).toBeInTheDocument();
    expect(screen.getByText("分享回流浏览器")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "页面浏览来源占比" })).toBeInTheDocument();
    expect(screen.getByText("公众号")).toBeInTheDocument();
    expect(screen.getByText("用户分享")).toBeInTheDocument();
    expect(screen.queryByText("其他")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("wechat_official");
    expect(document.body.textContent).toContain("匿名浏览器不等于真实用户");
    expect(document.body.textContent).toContain("分享发起不等于微信发送成功");
    expect(screen.getByText("查看每日明细数据")).toBeInTheDocument();
  });

  it("shows a true empty state instead of rendering all-zero charts", () => {
    const empty = report({
      channelBreakdown: [],
      daily: report().daily.map((point) => ({
        ...point,
        anonymousBrowsers: 0,
        outfitDetailVisitors: 0,
        outfitHubVisitors: 0,
        pageViews: 0,
        posterSaveSucceeded: 0,
        referredBrowsers: 0,
        shareInitiations: 0,
        sharingBrowsers: 0,
      })),
      summary: {
        ...report().summary,
        anonymousBrowsers: 0,
        outfitDetailRate: { denominator: 0, numerator: 0, ratio: null },
        outfitDetailVisitors: 0,
        outfitHubVisitors: 0,
        pageViews: 0,
        posterSaveFailed: 0,
        posterSaveRequests: 0,
        posterSaveSucceeded: 0,
        referredBrowsers: 0,
        shareInitiationRate: { denominator: 0, numerator: 0, ratio: null },
        shareInitiations: 0,
        sharingBrowsers: 0,
      },
    });

    render(<AdminAnalyticsReportView report={empty} />);

    expect(screen.getByRole("heading", { name: "还没有真实访问数据" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /访问趋势/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /来源占比/u })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/演示数据|demo/iu);
  });

  it("does not present an unavailable collection window as complete zeroes", () => {
    const unavailable = report({
      collectionStatus: "unavailable",
      summary: { ...report().summary, collectionStatus: "unavailable" },
    });

    render(<AdminAnalyticsReportView report={unavailable} />);

    expect(screen.getByRole("heading", { name: "匿名统计暂时不可用" })).toBeInTheDocument();
    expect(screen.queryByText("83 次")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /访问趋势/u })).not.toBeInTheDocument();
  });

  it("warns when only one day has enough traffic to draw a point but not a trend", () => {
    const sparse = report({
      daily: report().daily.map((point, index) => ({
        ...point,
        anonymousBrowsers: index === 6 ? 2 : 0,
        pageViews: index === 6 ? 3 : 0,
        shareInitiations: 0,
      })),
    });

    render(<AdminAnalyticsReportView report={sparse} />);

    expect(screen.getByText("目前样本不足以判断趋势")).toBeInTheDocument();
  });

  it("does not draw a source donut when other events exist without page views", () => {
    const noPageViews = report({
      channelBreakdown: [{ anonymousBrowsers: 0, channelId: "organic", pageViews: 0, ratio: null }],
      summary: {
        ...report().summary,
        pageViews: 0,
        shareInitiations: 1,
        sharingBrowsers: 1,
      },
    });

    render(<AdminAnalyticsReportView report={noPageViews} />);

    expect(screen.getByRole("heading", { name: "暂无可计算的访问来源" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "页面浏览来源占比" })).not.toBeInTheDocument();
    expect(screen.queryByText("直接访问")).not.toBeInTheDocument();
  });

  it("keeps a zero behavior bar at zero width", () => {
    const zeroReferral = report({
      summary: { ...report().summary, referredBrowsers: 0 },
    });

    render(<AdminAnalyticsReportView report={zeroReferral} />);

    const bar = screen
      .getByText("分享回流浏览器")
      .closest("li")
      ?.querySelector(".admin-analytics-bar-fill");
    expect(bar).toHaveAttribute("data-zero", "true");
  });
});

describe("AdminAnalyticsReportScreen", () => {
  it("loads the requested real report after the protected session is ready", async () => {
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    const getReport = vi
      .spyOn(adminApi, "getAnalyticsReport")
      .mockResolvedValue(apiSuccess(report()));

    render(
      <AdminSessionProvider>
        <AdminAnalyticsReportScreen days={7} />
      </AdminSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "数据报表" })).toBeInTheDocument();
    expect(getReport).toHaveBeenCalledWith(7);
  });

  it("separates a loading failure from the zero-data state and can retry", async () => {
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    const getReport = vi
      .spyOn(adminApi, "getAnalyticsReport")
      .mockResolvedValueOnce({
        error: {
          kind: "api-error",
          requestId: "request-analytics-unavailable",
          retryAfterSeconds: 30,
          status: 503,
        },
        ok: false,
      })
      .mockResolvedValueOnce(apiSuccess(report()));

    render(
      <AdminSessionProvider>
        <AdminAnalyticsReportScreen days={7} />
      </AdminSessionProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "暂时没有拿到数据报表" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "还没有真实访问数据" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));

    await waitFor(() => expect(getReport).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("heading", { name: "数据报表" })).toBeInTheDocument();
  });
});
