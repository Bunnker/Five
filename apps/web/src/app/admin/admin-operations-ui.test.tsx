import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminApi,
  type AdminActionableIssueList,
  type AdminApiResult,
  type AdminCalendarMonth,
  type AdminAnalyticsOverview,
  type AdminDayDetail,
  type AdminOperationsOverview,
  type AdminSession,
} from "./admin-api";
import {
  AdminCalendarView,
  CalendarLoader,
  AdminDayDetailView,
  AdminOperationsDay,
  AdminOperationsIssues,
  AdminOperationsToday,
  AdminIssuesView,
  AdminTodayView,
} from "./admin-operations-ui";
import { AdminSessionProvider } from "./admin-session-context";
import { dailyContentFixture } from "../../test-fixtures/daily-content";

const requestContext = {
  civilDate: "2026-08-06",
  crossedDayBoundary: false,
  dayBoundary: "23:00" as const,
  fortuneDate: "2026-08-06",
  responseGeneratedAt: "2026-08-06T17:00:00+08:00",
  shichen: "酉" as const,
  timezone: "Asia/Shanghai" as const,
};

const publicContentContext = {
  advancedFromCivilDate: false,
  servedFortuneDate: "2026-08-06",
  switchBoundary: "18:00" as const,
};

const session: AdminSession = {
  absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
  credentialRevision: 3,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
  issuedAt: new Date().toISOString(),
  username: "maintainer",
};

function summary(fortuneDate: string, relation: "current" | "future" | "next" | "past") {
  const previousDate = new Date(Date.parse(`${fortuneDate}T00:00:00.000Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    dayElement: "metal" as const,
    dayElementLabel: "金" as const,
    effectiveFrom: `${previousDate}T18:00:00+08:00`,
    effectiveTo: `${fortuneDate}T18:00:00+08:00`,
    fortuneDate,
    issueCodes: [],
    lifecycleRevision: 3,
    operationalStatus:
      relation === "current" ? ("published_healthy" as const) : ("scheduled_ready" as const),
    optionalImageStatus: "not_requested" as const,
    prepareBy: `${previousDate}T13:00:00+08:00`,
    previewAvailable: true,
    primaryColors: [{ colorCode: "ivory", name: "乳白" }],
    relation,
    requiredImages: { deliverySafeCount: 2, modelReadyCount: 2, requiredCount: 2 as const },
    scheduleSlotRevision: 1,
    updatedAt: `${fortuneDate}T17:00:00+08:00`,
  };
}

function apiSuccess<T>(data: T): AdminApiResult<T> {
  return { data, ok: true, response: new Response(null, { status: 200 }) };
}

function apiUnauthorized<T>(): AdminApiResult<T> {
  return {
    error: {
      kind: "api-error",
      requestId: "request-expired-session",
      retryAfterSeconds: null,
      status: 401,
    },
    ok: false,
  };
}

function apiUnavailable<T>(): AdminApiResult<T> {
  return {
    error: {
      kind: "api-error",
      requestId: "request-background-refresh-failure",
      retryAfterSeconds: 30,
      status: 503,
    },
    ok: false,
  };
}

function emptyIssues(
  nextOperationalBoundaryAt = new Date(Date.now() + 60_000).toISOString(),
): AdminActionableIssueList {
  return {
    items: [],
    nextOperationalBoundaryAt,
    publicContentContext,
    requestContext,
  };
}

function operationsOverview(
  overrides: Partial<AdminOperationsOverview> = {},
): AdminOperationsOverview {
  const current = summary("2026-08-06", "current");
  const next = summary("2026-08-07", "next");
  const nextPreviewRequestContext = {
    ...requestContext,
    civilDate: "2026-08-07",
    fortuneDate: "2026-08-07",
    responseGeneratedAt: "2026-08-07T12:00:00+08:00",
    shichen: "午" as const,
  };
  return {
    current,
    currentPreview: null,
    currentPreviewPublicContentContext: publicContentContext,
    currentPreviewRequestContext: requestContext,
    health: "healthy",
    issueCount: 0,
    next,
    nextOperationalBoundaryAt: new Date(Date.now() + 60_000).toISOString(),
    nextPreview: null,
    nextPreviewPublicContentContext: {
      ...publicContentContext,
      servedFortuneDate: "2026-08-07",
    },
    nextPreviewRequestContext,
    publicContentContext,
    requestContext,
    ...overrides,
  };
}

function analyticsOverview(
  overrides: Partial<AdminAnalyticsOverview> = {},
): AdminAnalyticsOverview {
  return {
    anonymousBrowsers: 12,
    channelId: null,
    collectionStatus: "active",
    contentVersion: null,
    fromFortuneDate: "2026-08-06",
    generatedAt: "2026-08-06T17:10:00+08:00",
    outfitDetailRate: { denominator: 12, numerator: 5, ratio: 0.4167 },
    outfitDetailVisitors: 5,
    outfitHubVisitors: 7,
    pageViews: 19,
    posterSaveFailed: 1,
    posterSaveRequests: 4,
    posterSaveSucceeded: 3,
    referredBrowsers: 2,
    shareInitiationRate: { denominator: 12, numerator: 4, ratio: 0.3333 },
    shareInitiations: 6,
    sharingBrowsers: 4,
    toFortuneDate: "2026-08-06",
    ...overrides,
  };
}

function dayDetail(overrides: Partial<AdminDayDetail> = {}): AdminDayDetail {
  return {
    concurrency: {
      activeContentVersion: null,
      lifecycleRevision: 3,
      scheduleSlotRevision: 1,
    },
    editableSelectionKeys: [],
    nextOperationalBoundaryAt: new Date(Date.now() + 60_000).toISOString(),
    preview: null,
    previewPublicContentContext: publicContentContext,
    previewRequestContext: requestContext,
    previewSource: "none",
    publicContentContext,
    readonlySelectionKeys: [],
    requestContext,
    summary: summary("2026-08-06", "current"),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("admin operations presentations", () => {
  it("shows anonymous usage, outfit conversion, share initiation and referral without claiming delivery", () => {
    render(
      <AdminTodayView
        analytics={analyticsOverview()}
        issues={emptyIssues()}
        overview={operationsOverview()}
      />,
    );

    expect(screen.getByRole("heading", { name: "今日使用情况" })).toBeInTheDocument();
    expect(screen.getByText("19 次浏览")).toBeInTheDocument();
    expect(screen.getByText("12 个匿名浏览器")).toBeInTheDocument();
    expect(screen.getByText("7 个打开搭配")).toBeInTheDocument();
    expect(screen.getByText("5 个查看具体穿法 · 41.7% 访问者深入率")).toBeInTheDocument();
    expect(screen.getByText("6 次分享发起")).toBeInTheDocument();
    expect(screen.getByText("33.3% 发起率")).toBeInTheDocument();
    expect(screen.getByText("2 个分享回流")).toBeInTheDocument();
    expect(screen.getByText("4 次保存请求")).toBeInTheDocument();
    expect(screen.getByText("用户确认成功 3 · 已知失败 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看完整数据报表" })).toHaveAttribute(
      "href",
      "/admin/analytics?days=7",
    );
    expect(document.body.textContent).not.toMatch(/微信分享成功|真实用户|设备指纹/u);
  });

  it("keeps content operations usable when anonymous usage is temporarily unavailable", () => {
    render(
      <AdminTodayView analytics={null} issues={emptyIssues()} overview={operationsOverview()} />,
    );

    expect(screen.getByRole("heading", { name: "今日使用情况" })).toBeInTheDocument();
    expect(screen.getByText(/统计暂时没有读取成功/u)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /今日内容正常/u })).toBeInTheDocument();
  });

  it("does not present incomplete zeroes as real usage when collection configuration is unavailable", () => {
    render(
      <AdminTodayView
        analytics={analyticsOverview({ collectionStatus: "unavailable" })}
        issues={emptyIssues()}
        overview={operationsOverview()}
      />,
    );

    expect(screen.getByText(/匿名统计采集当前不可用/u)).toBeInTheDocument();
    expect(screen.queryByText("19 次浏览")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /今日内容正常/u })).toBeInTheDocument();
  });

  it("uses the server public date to separate the content users see from the next release", () => {
    const atPublicSwitchRequestContext = {
      ...requestContext,
      responseGeneratedAt: "2026-08-06T18:30:00+08:00",
    };
    const advancedPublicContext = {
      advancedFromCivilDate: true,
      servedFortuneDate: "2026-08-07",
      switchBoundary: "18:00" as const,
    };
    const overview: AdminOperationsOverview = {
      current: summary("2026-08-07", "current"),
      currentPreview: null,
      currentPreviewPublicContentContext: advancedPublicContext,
      currentPreviewRequestContext: atPublicSwitchRequestContext,
      health: "healthy",
      issueCount: 0,
      next: summary("2026-08-08", "next"),
      nextOperationalBoundaryAt: "2026-08-07T18:00:00+08:00",
      nextPreview: null,
      nextPreviewPublicContentContext: {
        advancedFromCivilDate: false,
        servedFortuneDate: "2026-08-08",
        switchBoundary: "18:00",
      },
      nextPreviewRequestContext: {
        ...requestContext,
        civilDate: "2026-08-08",
        fortuneDate: "2026-08-08",
        responseGeneratedAt: "2026-08-08T12:00:00+08:00",
        shichen: "午",
      },
      publicContentContext: advancedPublicContext,
      requestContext: atPublicSwitchRequestContext,
    };

    render(
      <AdminTodayView
        issues={{
          items: [
            {
              actionHref: "/admin/calendar/2026-08-08",
              actionLabel: "补齐必备图片",
              code: "REQUIRED_IMAGE_MISSING",
              firstDetectedAt: "2026-08-06T17:00:00+08:00",
              fortuneDate: "2026-08-08",
              impact: "明天还缺一张必备模特图。",
              mitigation: null,
              severity: "warning",
              title: "必备模特图不足两张",
              updatedAt: "2026-08-06T17:00:00+08:00",
            },
          ],
          nextOperationalBoundaryAt: "2026-08-07T18:00:00+08:00",
          publicContentContext: advancedPublicContext,
          requestContext: atPublicSwitchRequestContext,
        }}
        overview={{ ...overview, health: "attention", issueCount: 1 }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "用户正在看到 · 8月7日（明日建议）" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "下一期 · 8月8日" })).toBeInTheDocument();
    expect(screen.getAllByText("必备模特图 2/2")).toHaveLength(2);
    expect(screen.getByText("2026-08-07")).toBeInTheDocument();
    expect(screen.getByText("2026-08-08")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "当前需要处理" })).toBeInTheDocument();
    expect(screen.getByText("必备模特图不足两张")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看全部异常" })).toHaveAttribute(
      "href",
      "/admin/issues",
    );
    expect(document.body.textContent).not.toMatch(/JSON|contentVersion|draft-/u);
  });

  it("renders current and next overview previews with each server-provided public context", () => {
    const atPublicSwitchRequestContext = {
      ...requestContext,
      responseGeneratedAt: "2026-08-06T18:30:00+08:00",
    };
    const advancedPublicContext = {
      advancedFromCivilDate: true,
      servedFortuneDate: "2026-08-07",
      switchBoundary: "18:00" as const,
    };
    const nextPreviewRequestContext = {
      ...requestContext,
      civilDate: "2026-08-08",
      fortuneDate: "2026-08-08",
      responseGeneratedAt: "2026-08-08T12:00:00+08:00",
      shichen: "午" as const,
    };
    const overview: AdminOperationsOverview = {
      current: summary("2026-08-07", "current"),
      currentPreview: dailyContentFixture("2026-08-07"),
      currentPreviewPublicContentContext: advancedPublicContext,
      currentPreviewRequestContext: atPublicSwitchRequestContext,
      health: "healthy",
      issueCount: 0,
      next: summary("2026-08-08", "next"),
      nextOperationalBoundaryAt: "2026-08-07T18:00:00+08:00",
      nextPreview: dailyContentFixture("2026-08-08"),
      nextPreviewPublicContentContext: {
        advancedFromCivilDate: false,
        servedFortuneDate: "2026-08-08",
        switchBoundary: "18:00",
      },
      nextPreviewRequestContext,
      publicContentContext: advancedPublicContext,
      requestContext: atPublicSwitchRequestContext,
    };

    render(<AdminTodayView issues={null} overview={overview} />);

    expect(
      screen.getByRole("heading", { name: "今日内容正常，下一份内容已准备完成" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "当前和下一期" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "用户端预览与待处理问题" })).toBeInTheDocument();
    expect(screen.getByLabelText("2026年8月7日 星期五")).toBeInTheDocument();
    expect(screen.queryByLabelText("2026年8月8日 星期五")).not.toBeInTheDocument();
    expect(screen.getAllByText("明日建议已更新")).toHaveLength(1);
    expect(screen.queryByText("还没有完整预览")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看结果预览" }));
    expect(screen.getByLabelText("2026年8月8日 星期五")).toBeInTheDocument();
    expect(screen.queryByLabelText("2026年8月7日 星期五")).not.toBeInTheDocument();
  });

  it("renders a day preview with its server-provided public context", () => {
    const previewRequestContext = {
      ...requestContext,
      responseGeneratedAt: "2026-08-06T18:30:00+08:00",
    };
    const detail = dayDetail({
      preview: dailyContentFixture("2026-08-07"),
      previewPublicContentContext: {
        advancedFromCivilDate: true,
        servedFortuneDate: "2026-08-07",
        switchBoundary: "18:00",
      },
      previewRequestContext,
      previewSource: "scheduled",
      summary: summary("2026-08-07", "next"),
    });

    render(<AdminDayDetailView detail={detail} session={session} />);

    expect(screen.getByText(/明天 · 已就绪/u)).toBeInTheDocument();
    expect(screen.getByLabelText("2026年8月7日 星期五")).toBeInTheDocument();
    expect(screen.getByText("明日建议已更新")).toBeInTheDocument();
    expect(screen.queryByText("主模特图待补充")).not.toBeInTheDocument();
  });

  it("renders a calm 42-cell month without treating the optional image as a requirement", () => {
    const month: AdminCalendarMonth = {
      items: Array.from({ length: 42 }, (_, index) =>
        summary(`2026-08-${String((index % 28) + 1).padStart(2, "0")}`, "future"),
      ),
      month: "2026-08",
      nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
      publicContentContext,
      requestContext,
    };

    const onMonthChange = vi.fn();
    render(<AdminCalendarView month={month} onMonthChange={onMonthChange} />);

    expect(screen.getAllByTestId("admin-calendar-day")).toHaveLength(42);
    expect(screen.getAllByText("未来")).toHaveLength(42);
    expect(screen.getAllByText("2/2")).toHaveLength(42);
    expect(screen.queryByText(/可选图|\/3/u)).not.toBeInTheDocument();
    expect(screen.getAllByTestId("admin-calendar-day")[0]).toHaveClass("admin-ops-calendar-day");

    fireEvent.click(screen.getByRole("button", { name: "回到当前月份" }));
    expect(onMonthChange).toHaveBeenCalledWith("2026-08");
  });

  it("explains an empty month in plain language without inventing dates", () => {
    render(
      <AdminCalendarView
        month={{
          items: [],
          month: "2026-09",
          nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
          publicContentContext,
          requestContext,
        }}
        notice="新月份暂时没有读取成功，下面保留上次已经加载的日期。"
        onMonthChange={() => undefined}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("新月份暂时没有读取成功");
    expect(screen.getByText("这个月还没有可显示的日期")).toBeInTheDocument();
    expect(screen.getByText(/系统没有返回任何真实日级数据/u)).toBeInTheDocument();
  });

  it("keeps the last loaded dates visible when a later month request fails", async () => {
    const current = summary("2026-08-06", "current");
    const next = summary("2026-08-07", "next");
    const overview: AdminOperationsOverview = {
      current,
      currentPreview: null,
      currentPreviewPublicContentContext: publicContentContext,
      currentPreviewRequestContext: requestContext,
      health: "healthy",
      issueCount: 0,
      next,
      nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
      nextPreview: null,
      nextPreviewPublicContentContext: {
        ...publicContentContext,
        servedFortuneDate: "2026-08-07",
      },
      nextPreviewRequestContext: {
        ...requestContext,
        civilDate: "2026-08-07",
        fortuneDate: "2026-08-07",
        responseGeneratedAt: "2026-08-07T12:00:00+08:00",
        shichen: "午",
      },
      publicContentContext,
      requestContext,
    };
    const loadedMonth: AdminCalendarMonth = {
      items: Array.from({ length: 42 }, (_, index) =>
        summary(`2026-08-${String((index % 28) + 1).padStart(2, "0")}`, "future"),
      ),
      month: "2026-08",
      nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
      publicContentContext,
      requestContext,
    };
    vi.spyOn(adminApi, "getSession").mockResolvedValue(
      apiSuccess({
        absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
        credentialRevision: 3,
        csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
        idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
        issuedAt: new Date().toISOString(),
        username: "maintainer",
      }),
    );
    vi.spyOn(adminApi, "getOperationsOverview").mockResolvedValue(apiSuccess(overview));
    vi.spyOn(adminApi, "getOperationsCalendar")
      .mockResolvedValueOnce(apiSuccess(loadedMonth))
      .mockResolvedValueOnce({
        error: {
          kind: "api-error",
          requestId: "request-calendar-failure",
          retryAfterSeconds: null,
          status: 503,
        },
        ok: false,
      });

    render(
      <AdminSessionProvider>
        <CalendarLoader />
      </AdminSessionProvider>,
    );
    expect(await screen.findAllByTestId("admin-calendar-day")).toHaveLength(42);

    fireEvent.click(screen.getByRole("button", { name: "下个月" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "2026-09 暂时没有读取成功，下面保留 2026-08 已经加载的日期。",
      ),
    );
    expect(screen.getAllByTestId("admin-calendar-day")).toHaveLength(42);
    expect(screen.getByRole("heading", { name: "2026 年 08 月" })).toBeInTheDocument();
  });

  it("shows only human-actionable issue language and a direct action", () => {
    const issues: AdminActionableIssueList = {
      items: [
        {
          actionHref: "/admin/calendar/2026-08-07",
          actionLabel: "立即处理明天",
          code: "NEXT_DAY_OVERDUE",
          firstDetectedAt: "2026-08-06T18:00:00+08:00",
          fortuneDate: "2026-08-07",
          impact: "如果不处理，明天切换后用户将看不到内容。",
          mitigation: "可以先补齐两张必备图。",
          severity: "warning",
          title: "明天的内容尚未准备好",
          updatedAt: "2026-08-06T18:00:00+08:00",
        },
      ],
      nextOperationalBoundaryAt: "2026-08-06T19:00:00+08:00",
      publicContentContext,
      requestContext,
    };

    render(<AdminIssuesView issues={issues} />);

    expect(screen.getByRole("heading", { name: "明天的内容尚未准备好" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "立即处理明天" })).toHaveAttribute(
      "href",
      "/admin/calendar/2026-08-07",
    );
    expect(document.body.textContent).not.toMatch(/stack|worker|JSON/u);
  });

  it("clears an expired session before Today starts any follow-up business request", async () => {
    const session = {
      absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
      credentialRevision: 3,
      csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
      idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
      issuedAt: new Date().toISOString(),
      username: "maintainer",
    };
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    vi.spyOn(adminApi, "getOperationsOverview").mockResolvedValue(apiUnauthorized());
    const issues = vi.spyOn(adminApi, "getOperationsIssues");

    render(
      <AdminSessionProvider>
        <AdminOperationsToday />
      </AdminSessionProvider>,
    );

    expect(await screen.findByRole("link", { name: "前往登录" })).toBeInTheDocument();
    expect(issues).not.toHaveBeenCalled();
  });

  it("labels the Today loading state as current public content", async () => {
    const session = {
      absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
      credentialRevision: 3,
      csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
      idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
      issuedAt: new Date().toISOString(),
      username: "maintainer",
    };
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    vi.spyOn(adminApi, "getOperationsOverview").mockReturnValue(new Promise(() => undefined));

    render(
      <AdminSessionProvider>
        <AdminOperationsToday />
      </AdminSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "正在查看当前内容" })).toBeInTheDocument();
  });

  it("keeps Today available when the independent analytics request fails", async () => {
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    vi.spyOn(adminApi, "getOperationsOverview").mockResolvedValue(apiSuccess(operationsOverview()));
    vi.spyOn(adminApi, "getOperationsIssues").mockResolvedValue(apiSuccess(emptyIssues()));
    vi.spyOn(adminApi, "getAnalyticsOverview").mockResolvedValue(apiUnavailable());

    render(
      <AdminSessionProvider>
        <AdminOperationsToday />
      </AdminSessionProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "今日内容正常，下一份内容已准备完成" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/统计暂时没有读取成功/u)).toBeInTheDocument();
  });

  it("refreshes Today when the server-relative operational boundary arrives", async () => {
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    const getOverview = vi
      .spyOn(adminApi, "getOperationsOverview")
      .mockResolvedValueOnce(
        apiSuccess(
          operationsOverview({
            health: "attention",
            issueCount: 1,
            nextOperationalBoundaryAt: new Date(Date.now() - 1).toISOString(),
            requestContext: {
              ...requestContext,
              responseGeneratedAt: new Date(Date.now() - 2).toISOString(),
            },
          }),
        ),
      )
      .mockResolvedValue(apiSuccess(operationsOverview()));
    vi.spyOn(adminApi, "getOperationsIssues").mockResolvedValue(apiSuccess(emptyIssues()));
    vi.spyOn(adminApi, "getAnalyticsOverview").mockResolvedValue(apiSuccess(analyticsOverview()));

    render(
      <AdminSessionProvider>
        <AdminOperationsToday />
      </AdminSessionProvider>,
    );

    await waitFor(() => expect(getOverview).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("heading", { name: "今日内容正常，下一份内容已准备完成" }),
    ).toBeInTheDocument();
  });

  it("refreshes the calendar when its server-relative boundary arrives", async () => {
    const calendarItems = Array.from({ length: 42 }, (_, index) =>
      summary(`2026-08-${String((index % 28) + 1).padStart(2, "0")}`, "future"),
    );
    const firstMonth: AdminCalendarMonth = {
      items: calendarItems,
      month: "2026-08",
      nextOperationalBoundaryAt: new Date(Date.now() - 1).toISOString(),
      publicContentContext,
      requestContext: {
        ...requestContext,
        responseGeneratedAt: new Date(Date.now() - 2).toISOString(),
      },
    };
    const refreshedMonth: AdminCalendarMonth = {
      ...firstMonth,
      items: [
        { ...calendarItems[0]!, operationalStatus: "generation_failed" },
        ...calendarItems.slice(1),
      ],
      nextOperationalBoundaryAt: new Date(Date.now() + 60_000).toISOString(),
    };
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    vi.spyOn(adminApi, "getOperationsOverview").mockResolvedValue(apiSuccess(operationsOverview()));
    const getCalendar = vi
      .spyOn(adminApi, "getOperationsCalendar")
      .mockResolvedValueOnce(apiSuccess(firstMonth))
      .mockResolvedValue(apiSuccess(refreshedMonth));

    render(
      <AdminSessionProvider>
        <CalendarLoader />
      </AdminSessionProvider>,
    );

    await waitFor(() => expect(getCalendar).toHaveBeenCalledTimes(2));
    expect(screen.getByText("自动生成失败")).toBeInTheDocument();
  });

  it("refreshes actionable issues when a restored page is shown again", async () => {
    const firstIssues: AdminActionableIssueList = {
      ...emptyIssues(),
      items: [
        {
          actionHref: "/admin/calendar/2026-08-07",
          actionLabel: "立即处理明天",
          code: "NEXT_DAY_OVERDUE",
          firstDetectedAt: "2026-08-06T17:00:00+08:00",
          fortuneDate: "2026-08-07",
          impact: "明天切换后会不可用。",
          mitigation: null,
          severity: "warning",
          title: "恢复前的待处理问题",
          updatedAt: "2026-08-06T17:00:00+08:00",
        },
      ],
    };
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    const getIssues = vi
      .spyOn(adminApi, "getOperationsIssues")
      .mockResolvedValueOnce(apiSuccess(firstIssues))
      .mockResolvedValue(apiSuccess(emptyIssues()));

    render(
      <AdminSessionProvider>
        <AdminOperationsIssues />
      </AdminSessionProvider>,
    );
    expect(await screen.findByRole("heading", { name: "恢复前的待处理问题" })).toBeInTheDocument();

    fireEvent(window, new Event("pageshow"));

    await waitFor(() => expect(getIssues).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("heading", { name: "现在没有需要处理的问题" })).toBeInTheDocument();
  });

  it("refreshes a day detail after the page becomes visible", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const firstDetail = dayDetail({
      summary: { ...summary("2026-08-06", "current"), operationalStatus: "scheduled_ready" },
    });
    const refreshedDetail = dayDetail({
      summary: { ...summary("2026-08-06", "current"), operationalStatus: "generation_failed" },
    });
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    const getDay = vi
      .spyOn(adminApi, "getOperationsDay")
      .mockResolvedValueOnce(apiSuccess(firstDetail))
      .mockResolvedValue(apiSuccess(refreshedDetail));

    render(
      <AdminSessionProvider>
        <AdminOperationsDay fortuneDate="2026-08-06" />
      </AdminSessionProvider>,
    );
    expect(await screen.findByText("今天 · 用户正在看 · 已就绪")).toBeInTheDocument();

    fireEvent(document, new Event("visibilitychange"));

    await waitFor(() => expect(getDay).toHaveBeenCalledTimes(2));
    expect(screen.getByText("今天 · 用户正在看 · 自动生成失败")).toBeInTheDocument();
  });

  it("reconciles a same-day refresh by preserving dirty copy and updating clean authoritative fields", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const firstPreview = dailyContentFixture("2026-08-06", "content-20260806-v1");
    const refreshedPreview = dailyContentFixture("2026-08-06", "content-20260806-v2");
    refreshedPreview.tiers = refreshedPreview.tiers.map((tier) =>
      tier.tierCode === "da_ji" ? { ...tier, explanation: "服务端刷新后的大吉说明" } : tier,
    );
    refreshedPreview.outfitFormulas = refreshedPreview.outfitFormulas.map((formula) =>
      formula.formulaId === "formula-mono"
        ? { ...formula, title: "服务端刷新后的穿搭标题" }
        : formula,
    );
    const editableSelectionKeys = ["tier.da_ji.explanation", "formula.formula-mono.title"];
    const firstDetail = dayDetail({
      editableSelectionKeys,
      preview: firstPreview,
      previewSource: "published",
    });
    const refreshedDetail = dayDetail({
      editableSelectionKeys,
      preview: refreshedPreview,
      previewSource: "published",
      requestContext: {
        ...requestContext,
        responseGeneratedAt: "2026-08-06T17:01:00+08:00",
      },
      summary: {
        ...summary("2026-08-06", "current"),
        lifecycleRevision: 4,
        updatedAt: "2026-08-06T17:01:00+08:00",
      },
    });
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    const getDay = vi
      .spyOn(adminApi, "getOperationsDay")
      .mockResolvedValueOnce(apiSuccess(firstDetail))
      .mockResolvedValue(apiSuccess(refreshedDetail));

    render(
      <AdminSessionProvider>
        <AdminOperationsDay fortuneDate="2026-08-06" />
      </AdminSessionProvider>,
    );
    const dirtyEditor = await screen.findByRole("textbox", { name: "大吉颜色说明" });
    fireEvent.change(dirtyEditor, { target: { value: "维护者尚未保存的大吉说明" } });

    fireEvent(document, new Event("visibilitychange"));

    await waitFor(() => expect(getDay).toHaveBeenCalledTimes(2));
    expect(dirtyEditor).toHaveValue("维护者尚未保存的大吉说明");
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "“服务端刷新后的穿搭标题”标题" })).toHaveValue(
        "服务端刷新后的穿搭标题",
      ),
    );
    expect(screen.getAllByText("维护者尚未保存的大吉说明").length).toBeGreaterThan(1);
    expect(screen.getAllByText("服务端刷新后的穿搭标题").length).toBeGreaterThan(1);
  });

  it("keeps a dirty ready editor mounted across a failed refresh and reconciles the next success", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const firstPreview = dailyContentFixture("2026-08-06", "content-20260806-v1");
    const refreshedPreview = dailyContentFixture("2026-08-06", "content-20260806-v2");
    refreshedPreview.outfitFormulas = refreshedPreview.outfitFormulas.map((formula) =>
      formula.formulaId === "formula-mono"
        ? { ...formula, title: "恢复刷新后的穿搭标题" }
        : formula,
    );
    const editableSelectionKeys = ["tier.da_ji.explanation", "formula.formula-mono.title"];
    const firstDetail = dayDetail({
      editableSelectionKeys,
      preview: firstPreview,
      previewSource: "published",
    });
    const refreshedDetail = dayDetail({
      editableSelectionKeys,
      preview: refreshedPreview,
      previewSource: "published",
      requestContext: {
        ...requestContext,
        responseGeneratedAt: "2026-08-06T17:02:00+08:00",
      },
      summary: {
        ...summary("2026-08-06", "current"),
        lifecycleRevision: 4,
        updatedAt: "2026-08-06T17:02:00+08:00",
      },
    });
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    const getDay = vi
      .spyOn(adminApi, "getOperationsDay")
      .mockResolvedValueOnce(apiSuccess(firstDetail))
      .mockResolvedValueOnce(apiUnavailable())
      .mockResolvedValue(apiSuccess(refreshedDetail));

    render(
      <AdminSessionProvider>
        <AdminOperationsDay fortuneDate="2026-08-06" />
      </AdminSessionProvider>,
    );
    const dirtyEditor = await screen.findByRole("textbox", { name: "大吉颜色说明" });
    fireEvent.change(dirtyEditor, { target: { value: "刷新失败也必须保留的输入" } });

    fireEvent(document, new Event("visibilitychange"));

    expect(
      await screen.findByText(
        "最新内容暂时没有刷新成功，当前已打开的内容和未保存输入仍保留。下次切回本页时会再次检查。",
      ),
    ).toBeInTheDocument();
    expect(dirtyEditor).toHaveValue("刷新失败也必须保留的输入");
    expect(screen.getByRole("textbox", { name: "“红色日常搭配”标题" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/503|request-background/u);

    fireEvent(document, new Event("visibilitychange"));

    await waitFor(() => expect(getDay).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "“恢复刷新后的穿搭标题”标题" })).toHaveValue(
        "恢复刷新后的穿搭标题",
      ),
    );
    expect(dirtyEditor).toHaveValue("刷新失败也必须保留的输入");
    expect(
      screen.queryByText(
        "最新内容暂时没有刷新成功，当前已打开的内容和未保存输入仍保留。下次切回本页时会再次检查。",
      ),
    ).not.toBeInTheDocument();
  });

  it("remounts the editor when the route moves to another fortune date", async () => {
    const firstDetail = dayDetail({
      editableSelectionKeys: ["tier.da_ji.explanation"],
      preview: dailyContentFixture("2026-08-06", "content-20260806-v1"),
      previewSource: "published",
    });
    const nextRequestContext = {
      ...requestContext,
      civilDate: "2026-08-07",
      fortuneDate: "2026-08-07",
      responseGeneratedAt: "2026-08-07T12:00:00+08:00",
      shichen: "午" as const,
    };
    const nextPublicContext = {
      ...publicContentContext,
      servedFortuneDate: "2026-08-07",
    };
    const nextDetail = dayDetail({
      editableSelectionKeys: ["tier.da_ji.explanation"],
      preview: dailyContentFixture("2026-08-07", "content-20260807-v1"),
      previewPublicContentContext: nextPublicContext,
      previewRequestContext: nextRequestContext,
      previewSource: "scheduled",
      publicContentContext: nextPublicContext,
      requestContext: nextRequestContext,
      summary: summary("2026-08-07", "future"),
    });
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    const getDay = vi
      .spyOn(adminApi, "getOperationsDay")
      .mockImplementation(async (fortuneDate) =>
        apiSuccess(fortuneDate === "2026-08-06" ? firstDetail : nextDetail),
      );

    const { rerender } = render(
      <AdminSessionProvider>
        <AdminOperationsDay fortuneDate="2026-08-06" />
      </AdminSessionProvider>,
    );
    const firstEditor = await screen.findByRole("textbox", { name: "大吉颜色说明" });
    fireEvent.change(firstEditor, { target: { value: "只属于前一天的未保存内容" } });

    rerender(
      <AdminSessionProvider>
        <AdminOperationsDay fortuneDate="2026-08-07" />
      </AdminSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "2026-08-07" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "大吉颜色说明" })).toHaveValue("今日优先参考红色。");
    expect(screen.queryByDisplayValue("只属于前一天的未保存内容")).not.toBeInTheDocument();
    expect(getDay).toHaveBeenLastCalledWith("2026-08-07");
  });

  it("clears an expired session when a day preview returns 401", async () => {
    const session = {
      absoluteExpiresAt: new Date(Date.now() + 12 * 60 * 60 * 1_000).toISOString(),
      credentialRevision: 3,
      csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
      idleExpiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
      issuedAt: new Date().toISOString(),
      username: "maintainer",
    };
    vi.spyOn(adminApi, "getSession").mockResolvedValue(apiSuccess(session));
    vi.spyOn(adminApi, "getOperationsDay").mockResolvedValue(apiUnauthorized());

    render(
      <AdminSessionProvider>
        <AdminOperationsDay fortuneDate="2026-08-07" />
      </AdminSessionProvider>,
    );

    expect(await screen.findByRole("link", { name: "前往登录" })).toBeInTheDocument();
  });
});
