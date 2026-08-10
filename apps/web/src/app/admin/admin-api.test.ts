import { afterEach, describe, expect, it, vi } from "vitest";

import { adminApi } from "./admin-api";

const validSession = {
  absoluteExpiresAt: "2026-08-01T08:00:00+08:00",
  credentialRevision: 3,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: "2026-07-31T20:30:00+08:00",
  issuedAt: "2026-07-31T20:00:00+08:00",
  username: "maintainer",
};

const requestContext = {
  civilDate: "2026-08-06",
  crossedDayBoundary: false,
  dayBoundary: "23:00",
  fortuneDate: "2026-08-06",
  responseGeneratedAt: "2026-08-06T17:00:00+08:00",
  shichen: "酉",
  timezone: "Asia/Shanghai",
};

const publicContentContext = {
  advancedFromCivilDate: false,
  servedFortuneDate: "2026-08-06",
  switchBoundary: "18:00",
};

const validDaySummary = {
  dayElement: "metal",
  dayElementLabel: "金",
  effectiveFrom: "2026-08-05T18:00:00+08:00",
  effectiveTo: "2026-08-06T18:00:00+08:00",
  fortuneDate: "2026-08-06",
  issueCodes: [],
  lifecycleRevision: 3,
  operationalStatus: "published_healthy",
  optionalImageStatus: "not_requested",
  prepareBy: "2026-08-05T13:00:00+08:00",
  previewAvailable: true,
  primaryColors: [{ colorCode: "ivory", name: "乳白" }],
  relation: "current",
  requiredImages: { deliverySafeCount: 2, modelReadyCount: 2, requiredCount: 2 },
  scheduleSlotRevision: 1,
  updatedAt: "2026-08-06T16:30:00+08:00",
};

function adminJsonResponse(body: unknown, headers: Record<string, string> = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Request-Id": "request-admin-api-0001",
      ...headers,
    },
    status,
  });
}

function zeroAnalyticsReport() {
  const daily = Array.from({ length: 7 }, (_, index) => ({
    anonymousBrowsers: 0,
    fortuneDate: `2026-08-${String(index + 3).padStart(2, "0")}`,
    outfitDetailVisitors: 0,
    outfitHubVisitors: 0,
    pageViews: 0,
    posterSaveSucceeded: 0,
    referredBrowsers: 0,
    shareInitiations: 0,
    sharingBrowsers: 0,
  }));
  const summary = {
    anonymousBrowsers: 0,
    channelId: null,
    collectionStatus: "active",
    contentVersion: null,
    fromFortuneDate: "2026-08-03",
    generatedAt: "2026-08-09T17:10:00+08:00",
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
    toFortuneDate: "2026-08-09",
  };
  return {
    channelBreakdown: [],
    collectionStatus: "active",
    daily,
    days: 7,
    fromFortuneDate: "2026-08-03",
    generatedAt: "2026-08-09T17:10:00+08:00",
    summary,
    toFortuneDate: "2026-08-09",
  };
}

describe("adminApi response boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ["undeclared response properties", { ...validSession, unexpected: "must fail closed" }],
    ["date-times without a timezone", { ...validSession, issuedAt: "2026-07-31T20:00:00" }],
    ["calendar-invalid RFC3339 dates", { ...validSession, issuedAt: "2026-02-30T20:00:00+08:00" }],
  ])("rejects %s", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(adminJsonResponse(body)));

    const result = await adminApi.getSession();

    expect(result).toEqual({
      error: {
        kind: "api-error",
        requestId: "request-admin-api-0001",
        retryAfterSeconds: null,
        status: 502,
      },
      ok: false,
    });
  });

  it.each([
    ["a JSON media type", { "Content-Type": "text/plain" }],
    ["no-store cache control", { "Cache-Control": "private" }],
    ["a request id", { "X-Request-Id": "" }],
  ])("rejects a successful response without %s", async (_label, changedHeader) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(adminJsonResponse(validSession, changedHeader)),
    );

    const result = await adminApi.getSession();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(502);
  });

  it("requires the strong emergency-control ETag on emergency responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminJsonResponse(
          {
            auditEventId: null,
            changedAt: "2026-07-31T20:00:00+08:00",
            publicAccessEnabled: true,
            reason: null,
            revision: 4,
          },
          { ETag: 'W/"emergency-control:4"' },
        ),
      ),
    );

    const result = await adminApi.getEmergencyStatus();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(502);
  });

  it("accepts an exact payload with the required no-store response headers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(adminJsonResponse(validSession)));

    const result = await adminApi.getSession();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(validSession);
  });

  it("does not parse or expose an error response body", async () => {
    const response = new Response(JSON.stringify({ password: "must-not-leak" }), {
      headers: { "Content-Type": "application/json", "X-Request-Id": "request-error-0001" },
      status: 401,
    });
    const jsonSpy = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const result = await adminApi.getSession();

    expect(jsonSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: {
        kind: "api-error",
        requestId: "request-error-0001",
        retryAfterSeconds: null,
        status: 401,
      },
      ok: false,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
  });

  it("loads the operations overview through the protected no-store boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      adminJsonResponse({
        current: validDaySummary,
        currentPreview: null,
        currentPreviewPublicContentContext: publicContentContext,
        currentPreviewRequestContext: requestContext,
        health: "healthy",
        issueCount: 0,
        next: { ...validDaySummary, fortuneDate: "2026-08-07", relation: "next" },
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
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminApi.getOperationsOverview();

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/operations/overview",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("loads a strict anonymous analytics overview through the protected no-store boundary", async () => {
    const analyticsOverview = {
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
    };
    const fetchMock = vi.fn().mockResolvedValue(adminJsonResponse(analyticsOverview));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminApi.getAnalyticsOverview({
      from: "2026-08-06",
      to: "2026-08-06",
    });

    expect(result).toMatchObject({ data: analyticsOverview, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/analytics/overview?from=2026-08-06&to=2026-08-06",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("loads a strict seven-day analytics report through the protected no-store boundary", async () => {
    const daily = Array.from({ length: 7 }, (_, index) => ({
      anonymousBrowsers: index + 2,
      fortuneDate: `2026-08-${String(index + 3).padStart(2, "0")}`,
      outfitDetailVisitors: index,
      outfitHubVisitors: index + 1,
      pageViews: index + 4,
      posterSaveSucceeded: index === 6 ? 1 : 0,
      referredBrowsers: index === 6 ? 1 : 0,
      shareInitiations: index,
      sharingBrowsers: index,
    }));
    const summary = {
      anonymousBrowsers: 18,
      channelId: null,
      collectionStatus: "active",
      contentVersion: null,
      fromFortuneDate: "2026-08-03",
      generatedAt: "2026-08-09T17:10:00+08:00",
      outfitDetailRate: { denominator: 18, numerator: 7, ratio: 7 / 18 },
      outfitDetailVisitors: 7,
      outfitHubVisitors: 11,
      pageViews: 30,
      posterSaveFailed: 0,
      posterSaveRequests: 2,
      posterSaveSucceeded: 2,
      referredBrowsers: 1,
      shareInitiationRate: { denominator: 18, numerator: 4, ratio: 4 / 18 },
      shareInitiations: 5,
      sharingBrowsers: 4,
      toFortuneDate: "2026-08-09",
    };
    const report = {
      channelBreakdown: [
        { anonymousBrowsers: 12, channelId: "organic", pageViews: 20, ratio: 2 / 3 },
        { anonymousBrowsers: 6, channelId: "user_share", pageViews: 10, ratio: 1 / 3 },
      ],
      collectionStatus: "active",
      daily,
      days: 7,
      fromFortuneDate: "2026-08-03",
      generatedAt: "2026-08-09T17:10:00+08:00",
      summary,
      toFortuneDate: "2026-08-09",
    };
    const fetchMock = vi.fn().mockResolvedValue(adminJsonResponse(report));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminApi.getAnalyticsReport(7);

    expect(result).toMatchObject({ data: report, ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/analytics/report?days=7",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it.each([
    [
      "a ratio that disagrees with page views",
      () => ({
        ...zeroAnalyticsReport(),
        channelBreakdown: [
          { anonymousBrowsers: 1, channelId: "organic", pageViews: 1, ratio: 0.25 },
        ],
        summary: { ...zeroAnalyticsReport().summary, pageViews: 1 },
      }),
    ],
    [
      "a non-null ratio when total page views are zero",
      () => ({
        ...zeroAnalyticsReport(),
        channelBreakdown: [{ anonymousBrowsers: 0, channelId: "organic", pageViews: 0, ratio: 0 }],
      }),
    ],
    [
      "duplicate channel buckets",
      () => ({
        ...zeroAnalyticsReport(),
        channelBreakdown: [
          { anonymousBrowsers: 1, channelId: "organic", pageViews: 1, ratio: 0.5 },
          { anonymousBrowsers: 1, channelId: "organic", pageViews: 1, ratio: 0.5 },
        ],
        summary: { ...zeroAnalyticsReport().summary, pageViews: 2 },
      }),
    ],
    [
      "more than five channel buckets",
      () => ({
        ...zeroAnalyticsReport(),
        channelBreakdown: [
          { anonymousBrowsers: 0, channelId: "organic", pageViews: 0, ratio: null },
          { anonymousBrowsers: 0, channelId: "wechat_official", pageViews: 0, ratio: null },
          { anonymousBrowsers: 0, channelId: "wechat_group", pageViews: 0, ratio: null },
          { anonymousBrowsers: 0, channelId: "user_share", pageViews: 0, ratio: null },
          { anonymousBrowsers: 0, channelId: "other", pageViews: 0, ratio: null },
          { anonymousBrowsers: 0, channelId: "other", pageViews: 0, ratio: null },
        ],
      }),
    ],
  ])("rejects an analytics report with %s", async (_label, createBody) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(adminJsonResponse(createBody())));

    const result = await adminApi.getAnalyticsReport(7);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(502);
  });

  it("fails closed when analytics returns an undeclared property", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminJsonResponse({
          anonymousBrowsers: 0,
          channelId: null,
          contentVersion: null,
          collectionStatus: "active",
          fromFortuneDate: "2026-08-06",
          generatedAt: "2026-08-06T17:10:00+08:00",
          internalVisitorIds: ["must-not-cross-the-boundary"],
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
          toFortuneDate: "2026-08-06",
        }),
      ),
    );

    const result = await adminApi.getAnalyticsOverview({
      from: "2026-08-06",
      to: "2026-08-06",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(502);
  });

  it("loads issue and day responses with server-owned operational and preview contexts", async () => {
    const issues = {
      items: [],
      nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
      publicContentContext,
      requestContext,
    };
    const day = {
      concurrency: {
        activeContentVersion: null,
        lifecycleRevision: 3,
        scheduleSlotRevision: 1,
      },
      editableSelectionKeys: [],
      nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
      preview: null,
      previewPublicContentContext: publicContentContext,
      previewRequestContext: requestContext,
      previewSource: "none",
      publicContentContext,
      readonlySelectionKeys: [],
      requestContext,
      summary: validDaySummary,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(adminJsonResponse(issues))
        .mockResolvedValueOnce(adminJsonResponse(day)),
    );

    await expect(adminApi.getOperationsIssues()).resolves.toMatchObject({ ok: true });
    await expect(adminApi.getOperationsDay("2026-08-06")).resolves.toMatchObject({ ok: true });
  });

  it("fails closed when an operations day summary contains an undeclared property", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminJsonResponse({
          current: { ...validDaySummary, internalVersionId: "hidden" },
          currentPreview: null,
          currentPreviewPublicContentContext: publicContentContext,
          currentPreviewRequestContext: requestContext,
          health: "healthy",
          issueCount: 0,
          next: { ...validDaySummary, fortuneDate: "2026-08-07", relation: "next" },
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
        }),
      ),
    );

    const result = await adminApi.getOperationsOverview();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(502);
  });

  it("fails closed when the operations response omits or corrupts the public content context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminJsonResponse({
          current: validDaySummary,
          currentPreview: null,
          currentPreviewPublicContentContext: publicContentContext,
          currentPreviewRequestContext: requestContext,
          health: "healthy",
          issueCount: 0,
          next: { ...validDaySummary, fortuneDate: "2026-08-07", relation: "next" },
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
          publicContentContext: { ...publicContentContext, switchBoundary: "23:00" },
          requestContext,
        }),
      ),
    );

    const result = await adminApi.getOperationsOverview();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(502);
  });

  it("preserves an opaque correction ETag from open through PATCH", async () => {
    const workingCopy = {
      applyMode: null,
      baselineActiveContentVersion: null,
      correctionId: "correction-20260806-0001",
      correctionRevision: 3,
      createdAt: "2026-08-06T17:00:00+08:00",
      draftId: "draft-correction-20260806-0001",
      draftRevision: 7,
      fortuneDate: "2026-08-06",
      modules: {
        calendar_algorithm: null,
        copy_and_formula: null,
        poster_consistency: null,
        visual_and_rights: null,
      },
      sourceContentVersion: null,
      status: "open",
      submittedContentVersion: null,
      updatedAt: "2026-08-06T17:00:00+08:00",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(adminJsonResponse(workingCopy, { ETag: '"correction:3|draft:7"' }))
      .mockResolvedValueOnce(
        adminJsonResponse(
          {
            correctionId: workingCopy.correctionId,
            correctionRevision: 3,
            draftRevision: 8,
            fortuneDate: workingCopy.fortuneDate,
            moduleCode: "calendar_algorithm",
          },
          { ETag: '"correction:3|draft:8"' },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const opened = await adminApi.openDayCorrection({
      csrfToken: validSession.csrfToken,
      fortuneDate: workingCopy.fortuneDate,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const etag = opened.response.headers.get("ETag");
    expect(etag).toBe('"correction:3|draft:7"');

    const patched = await adminApi.patchDayCorrection({
      command: {
        explanation: "只修改这一档说明。",
        kind: "set_tier_explanation",
        tierCode: "da_ji",
      },
      correctionId: workingCopy.correctionId,
      csrfToken: validSession.csrfToken,
      etag: etag ?? "",
    });

    expect(patched.ok).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/admin/api/v1/day-corrections/${workingCopy.correctionId}`,
      expect.objectContaining({
        headers: expect.objectContaining({ "If-Match": '"correction:3|draft:7"' }),
        method: "PATCH",
      }),
    );
  });

  it("keeps the server's latest opaque ETag on a 412 correction response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "REVISION_MISMATCH",
              details: {},
              message: "revision changed",
              requestId: "request-admin-api-0001",
              retryable: false,
            },
          }),
          {
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json",
              ETag: '"correction:9|draft:12"',
              "X-Request-Id": "request-admin-api-0001",
            },
            status: 412,
          },
        ),
      ),
    );

    const result = await adminApi.applyDayCorrection({
      correctionId: "correction-20260806-0001",
      csrfToken: validSession.csrfToken,
      etag: '"correction:9|draft:11"',
      idempotencyKey: "11111111111111111111111111111111",
      reason: "可视化订正",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.etag).toBe('"correction:9|draft:12"');
  });

  it("selects a reusable image through the exact OpenAPI library route", async () => {
    const workingCopy = {
      applyMode: null,
      baselineActiveContentVersion: "content-source-20260806",
      correctionId: "correction-library-0001",
      correctionRevision: 5,
      createdAt: "2026-08-06T17:00:00+08:00",
      draftId: "draft-correction-library-0001",
      draftRevision: 9,
      fortuneDate: "2026-08-06",
      modules: {
        calendar_algorithm: null,
        copy_and_formula: null,
        poster_consistency: null,
        visual_and_rights: null,
      },
      sourceContentVersion: "content-source-20260806",
      status: "open",
      submittedContentVersion: null,
      updatedAt: "2026-08-06T17:05:00+08:00",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      adminJsonResponse(
        {
          assetId: "asset-library-0001",
          correctionRevision: workingCopy.correctionRevision,
          draftRevision: workingCopy.draftRevision,
          previewUrl: "/admin/api/v1/image-assets/asset-library-0001/preview",
          workingCopy,
        },
        { ETag: '"correction:5|draft:9"' },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminApi.reuseDayCorrectionImage({
      assetId: "asset-library-0001",
      correctionId: workingCopy.correctionId,
      csrfToken: validSession.csrfToken,
      etag: '"correction:5|draft:8"',
      idempotencyKey: "library-select-idempotency-key-0001",
      imageSlot: "required_alternative",
      reason: "复用已检查且配色一致的搭配图。",
      sourceContentVersion: "content-source-20260806",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `/admin/api/v1/day-corrections/${workingCopy.correctionId}/images/required_alternative/library/select`,
      expect.objectContaining({
        body: JSON.stringify({
          assetId: "asset-library-0001",
          reason: "复用已检查且配色一致的搭配图。",
          sourceContentVersion: "content-source-20260806",
        }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": "library-select-idempotency-key-0001",
          "If-Match": '"correction:5|draft:8"',
          "X-CSRF-Token": validSession.csrfToken,
        }),
        method: "POST",
      }),
    );
  });

  it("uploads a correction image with only the simple multipart fields", async () => {
    const workingCopy = {
      applyMode: null,
      baselineActiveContentVersion: null,
      correctionId: "correction-20260806-0002",
      correctionRevision: 4,
      createdAt: "2026-08-06T17:00:00+08:00",
      draftId: "draft-correction-20260806-0002",
      draftRevision: 8,
      fortuneDate: "2026-08-06",
      modules: {
        calendar_algorithm: null,
        copy_and_formula: null,
        poster_consistency: null,
        visual_and_rights: null,
      },
      sourceContentVersion: null,
      status: "open",
      submittedContentVersion: null,
      updatedAt: "2026-08-06T17:02:00+08:00",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      adminJsonResponse(
        {
          assetId: "asset-uploaded",
          correctionRevision: 4,
          draftRevision: 8,
          previewUrl: "/admin/api/v1/image-assets/asset-uploaded/preview",
          workingCopy,
        },
        { ETag: '"correction:4|draft:8"' },
        201,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const formData = new FormData();
    formData.append("file", new File(["png"], "look.png", { type: "image/png" }));
    formData.append("reason", "替换不符合配色的主图");
    formData.append("altText", "黑色通勤模特穿搭");

    const result = await adminApi.uploadDayCorrectionImage({
      correctionId: workingCopy.correctionId,
      csrfToken: validSession.csrfToken,
      etag: '"correction:3|draft:7"',
      formData,
      idempotencyKey: "22222222222222222222222222222222",
      imageSlot: "required_primary",
    });

    expect(result.ok).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.body).toBe(formData);
    expect(Array.from(formData.keys())).toEqual(["file", "reason", "altText"]);
    expect((request.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      `/admin/api/v1/day-corrections/${workingCopy.correctionId}/images/required_primary/upload`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
