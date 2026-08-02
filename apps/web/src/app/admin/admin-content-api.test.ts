import { afterEach, describe, expect, it, vi } from "vitest";

import { adminApi } from "./admin-api";
import { createAdminJsonResponse } from "./admin-test-responses";

const csrfToken = "csrf-token-that-is-longer-than-thirty-two-characters";

const lifecycleResult = {
  activeContentVersion: "fd-20260801-r0",
  auditEventId: "audit-lifecycle-001",
  contentVersion: "fd-20260801-r1",
  fortuneDate: "2026-08-01",
  lifecycleRevision: 7,
  state: "scheduled" as const,
  transitions: [
    {
      contentVersion: "fd-20260801-r1",
      fromState: "approved" as const,
      toState: "scheduled" as const,
    },
  ],
};

const imageAsset = {
  aiLabelStatus: "complete" as const,
  altText: "墨绿外套日常穿搭",
  assetId: "asset-primary",
  declaredModel: "gpt-image-2",
  fileUrl: null,
  generatedAt: "2026-08-01T02:00:00.000Z",
  generationMethod: "codex" as const,
  height: 1600,
  manualReview: null,
  mediaType: "image/webp" as const,
  promptVersion: "prompt-v3",
  reproductionReference: "job-image-001",
  reviewStatus: "pending" as const,
  rightsRecordIds: ["rights-ai-001"],
  rightsStatus: "pending" as const,
  sha256: "a".repeat(64),
  sourceMaterialReferences: ["brief:2026-08-01"],
  sourceType: "ai_generated" as const,
  width: 1200,
};

const emptyDraft = {
  createdAt: "2026-07-31T10:00:00+08:00",
  draftId: "draft-31",
  draftRevision: 1,
  fortuneDate: "2026-08-01",
  modules: {
    calendar_algorithm: null,
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  },
  state: "draft" as const,
  updatedAt: "2026-07-31T10:00:00+08:00",
};

describe("adminApi content workflow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("creates a draft with the in-memory CSRF token and requires its strong ETag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createAdminJsonResponse(emptyDraft, {
        headers: { ETag: '"draft:1"' },
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminApi.createDraft({
      csrfToken,
      input: { copyFromContentVersion: "version-before", fortuneDate: "2026-08-01" },
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/daily-content-drafts",
      expect.objectContaining({
        body: JSON.stringify({
          copyFromContentVersion: "version-before",
          fortuneDate: "2026-08-01",
        }),
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        }),
        method: "POST",
      }),
    );
  });

  it("returns a fail-closed result when a draft response omits its ETag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(createAdminJsonResponse(emptyDraft, { status: 201 })),
    );

    const result = await adminApi.createDraft({
      csrfToken,
      input: { copyFromContentVersion: null, fortuneDate: "2026-08-01" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(502);
  });

  it("preserves a validated lifecycle error code, retryability, and details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createAdminJsonResponse(
          {
            error: {
              code: "ACTIVE_CONTENT_VERSION_CHANGED",
              details: {
                currentActiveContentVersion: "fd-20260801-r2",
                expectedActiveContentVersion: "fd-20260801-r1",
              },
              message: "当前在线版本已经变化，请重新读取。",
              requestId: "request-active-version-change-0001",
              retryable: true,
            },
          },
          {
            headers: { "X-Request-Id": "request-active-version-change-0001" },
            status: 409,
          },
        ),
      ),
    );

    const result = await adminApi.getContentVersion("fd-20260801-r1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "ACTIVE_CONTENT_VERSION_CHANGED",
        details: {
          currentActiveContentVersion: "fd-20260801-r2",
          expectedActiveContentVersion: "fd-20260801-r1",
        },
        kind: "api-error",
        requestId: "request-active-version-change-0001",
        retryAfterSeconds: null,
        retryable: true,
        status: 409,
      });
    }
  });

  it("schedules a version with the server active version and all lifecycle guards", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createAdminJsonResponse(lifecycleResult, { headers: { ETag: '"lifecycle:7"' } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminApi.scheduleContentVersion({
      body: {
        effectiveFrom: "2026-07-31T23:00:00+08:00",
        expectedActiveContentVersion: "fd-20260801-r0",
        reason: "按已确认的生效时间上线",
      },
      contentVersion: "fd-20260801-r1",
      csrfToken,
      etag: '"lifecycle:6"',
      idempotencyKey: "idem-schedule-000000000000001",
    });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/daily-content-versions/fd-20260801-r1/schedule",
      expect.objectContaining({
        body: JSON.stringify({
          effectiveFrom: "2026-07-31T23:00:00+08:00",
          expectedActiveContentVersion: "fd-20260801-r0",
          reason: "按已确认的生效时间上线",
        }),
        cache: "no-store",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Idempotency-Key": "idem-schedule-000000000000001",
          "If-Match": '"lifecycle:6"',
          "X-CSRF-Token": csrfToken,
        }),
        method: "POST",
      }),
    );
  });

  it("cancels a schedule through its contract path with the frozen intent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createAdminJsonResponse(
        {
          ...lifecycleResult,
          state: "approved",
          transitions: [
            {
              contentVersion: "fd-20260801-r1",
              fromState: "scheduled",
              toState: "approved",
            },
          ],
        },
        { headers: { ETag: '"lifecycle:7"' } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.cancelContentSchedule({
      body: {
        expectedActiveContentVersion: "fd-20260801-r0",
        reason: "上线时间需要重新确认",
      },
      contentVersion: "fd-20260801-r1",
      csrfToken,
      etag: '"lifecycle:6"',
      idempotencyKey: "idem-cancel-00000000000000001",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/daily-content-versions/fd-20260801-r1/cancel-schedule",
      expect.objectContaining({
        body: JSON.stringify({
          expectedActiveContentVersion: "fd-20260801-r0",
          reason: "上线时间需要重新确认",
        }),
        headers: expect.objectContaining({
          "Idempotency-Key": "idem-cancel-00000000000000001",
          "If-Match": '"lifecycle:6"',
          "X-CSRF-Token": csrfToken,
        }),
        method: "POST",
      }),
    );
  });

  it("publishes immediately with active-version, ETag, CSRF, and idempotency guards", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createAdminJsonResponse(
        {
          ...lifecycleResult,
          activeContentVersion: "fd-20260801-r1",
          state: "published",
          transitions: [
            {
              contentVersion: "fd-20260801-r1",
              fromState: "approved",
              toState: "published",
            },
          ],
        },
        { headers: { ETag: '"lifecycle:7"' } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.publishContentVersion({
      body: {
        expectedActiveContentVersion: "fd-20260801-r0",
        reason: "全部检查通过，立即上线",
      },
      contentVersion: "fd-20260801-r1",
      csrfToken,
      etag: '"lifecycle:6"',
      idempotencyKey: "idem-publish-0000000000000001",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/daily-content-versions/fd-20260801-r1/publish",
      expect.objectContaining({
        body: JSON.stringify({
          expectedActiveContentVersion: "fd-20260801-r0",
          reason: "全部检查通过，立即上线",
        }),
        headers: expect.objectContaining({
          "Idempotency-Key": "idem-publish-0000000000000001",
          "If-Match": '"lifecycle:6"',
          "X-CSRF-Token": csrfToken,
        }),
        method: "POST",
      }),
    );
  });

  it("withdraws the active version with an explicit safe replacement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createAdminJsonResponse(
        {
          ...lifecycleResult,
          activeContentVersion: "fd-20260801-r0",
          state: "withdrawn",
          transitions: [
            {
              contentVersion: "fd-20260801-r1",
              fromState: "published",
              toState: "withdrawn",
            },
            {
              contentVersion: "fd-20260801-r0",
              fromState: "superseded",
              toState: "published",
            },
          ],
        },
        { headers: { ETag: '"lifecycle:7"' } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.withdrawContentVersion({
      body: {
        expectedActiveContentVersion: "fd-20260801-r1",
        reason: "正文出现需要立即修正的问题",
        replacementContentVersion: "fd-20260801-r0",
      },
      contentVersion: "fd-20260801-r1",
      csrfToken,
      etag: '"lifecycle:6"',
      idempotencyKey: "idem-withdraw-version-0000000001",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/daily-content-versions/fd-20260801-r1/withdraw",
      expect.objectContaining({
        body: JSON.stringify({
          expectedActiveContentVersion: "fd-20260801-r1",
          reason: "正文出现需要立即修正的问题",
          replacementContentVersion: "fd-20260801-r0",
        }),
        headers: expect.objectContaining({
          "Idempotency-Key": "idem-withdraw-version-0000000001",
          "If-Match": '"lifecycle:6"',
          "X-CSRF-Token": csrfToken,
        }),
        method: "POST",
      }),
    );
  });

  it("rolls one fortune day back to a server-listed historical version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createAdminJsonResponse(
        {
          ...lifecycleResult,
          activeContentVersion: "fd-20260801-r0",
          contentVersion: "fd-20260801-r0",
          state: "published",
          transitions: [
            {
              contentVersion: "fd-20260801-r1",
              fromState: "published",
              toState: "superseded",
            },
            {
              contentVersion: "fd-20260801-r0",
              fromState: "superseded",
              toState: "published",
            },
          ],
        },
        { headers: { ETag: '"lifecycle:7"' } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.rollbackContentDay({
      body: {
        expectedActiveContentVersion: "fd-20260801-r1",
        reason: "当前版本体验异常，恢复已验证版本",
        targetContentVersion: "fd-20260801-r0",
      },
      contentVersion: "fd-20260801-r0",
      csrfToken,
      etag: '"lifecycle:6"',
      fortuneDate: "2026-08-01",
      idempotencyKey: "idem-rollback-0000000000000001",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/daily-content-days/2026-08-01/rollback",
      expect.objectContaining({
        body: JSON.stringify({
          expectedActiveContentVersion: "fd-20260801-r1",
          reason: "当前版本体验异常，恢复已验证版本",
          targetContentVersion: "fd-20260801-r0",
        }),
        headers: expect.objectContaining({
          "Idempotency-Key": "idem-rollback-0000000000000001",
          "If-Match": '"lifecycle:6"',
          "X-CSRF-Token": csrfToken,
        }),
        method: "POST",
      }),
    );
  });

  it("lists server-side drafts with an optional fortune-date filter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createAdminJsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.listDrafts("2026-08-01");

    expect(fetchMock).toHaveBeenCalledWith(
      "/admin/api/v1/daily-content-drafts?fortuneDate=2026-08-01",
      expect.objectContaining({ credentials: "same-origin", method: "GET" }),
    );
  });

  it("updates one module with If-Match, then submits with one idempotency key", async () => {
    const posterModule = {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "asset-sample",
      templateId: "template-mobile",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            draftId: "draft-31",
            draftRevision: 2,
            module: posterModule,
            moduleCode: "poster_consistency",
          },
          { headers: { ETag: '"draft:2"' } },
        ),
      )
      .mockResolvedValueOnce(
        createAdminJsonResponse(
          {
            contentVersion: "fd-20260801-r1",
            draftId: "draft-31",
            lifecycleRevision: 1,
            state: "in_review",
          },
          { headers: { ETag: '"lifecycle:1"' }, status: 201 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await adminApi.updateDraftModule({
      csrfToken,
      draftId: "draft-31",
      etag: '"draft:1"',
      module: posterModule,
      moduleCode: "poster_consistency",
    });
    await adminApi.submitDraft({
      csrfToken,
      draftId: "draft-31",
      etag: '"draft:2"',
      idempotencyKey: "idem-submit-0000000000000001",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/admin/api/v1/daily-content-drafts/draft-31/modules/poster_consistency",
      expect.objectContaining({
        headers: expect.objectContaining({
          "If-Match": '"draft:1"',
          "X-CSRF-Token": csrfToken,
        }),
        method: "PATCH",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/admin/api/v1/daily-content-drafts/draft-31/submit",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": "idem-submit-0000000000000001",
          "If-Match": '"draft:2"',
          "X-CSRF-Token": csrfToken,
        }),
        method: "POST",
      }),
    );
  });

  it("uploads an image as multipart data without overriding the browser boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createAdminJsonResponse(
        {
          asset: imageAsset,
          draftId: "draft-31",
          draftRevision: 2,
          fortuneDate: "2026-08-01",
          previewUrl: "/admin/api/v1/image-assets/asset-primary/preview",
          reviewLocked: false,
        },
        { headers: { ETag: '"draft:2"' }, status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const formData = new FormData();
    formData.append("file", new File(["image"], "outfit.webp", { type: "image/webp" }));
    formData.append("metadata", new Blob(["{}"], { type: "application/json" }));

    const result = await adminApi.uploadDraftImage({
      csrfToken,
      draftId: "draft-31",
      etag: '"draft:1"',
      formData,
      idempotencyKey: "idem-upload-0000000000000001",
    });

    expect(result.ok).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(request.body).toBe(formData);
    expect(headers.get("Content-Type")).toBeNull();
    expect(headers.get("If-Match")).toBe('"draft:1"');
    expect(headers.get("Idempotency-Key")).toBe("idem-upload-0000000000000001");
    expect(headers.get("X-CSRF-Token")).toBe(csrfToken);
  });

  it("reviews an image and reads the refreshed draft revision", async () => {
    const reviewedAsset = {
      ...imageAsset,
      fileUrl: "https://cdn.example.com/asset-primary.webp",
      manualReview: {
        aiLabelCompliance: "passed" as const,
        colorAndCopyConsistency: "passed" as const,
        garmentAndPersonIntegrity: "passed" as const,
        mobileAndWechatPreview: "passed" as const,
        notes: "逐项检查通过",
        reviewId: "review-1",
        reviewedAt: "2026-08-01T03:00:00.000Z",
        reviewerAccountId: "maintainer",
        rightsAndIdentityRisk: "passed" as const,
        scenarioAndImitability: "passed" as const,
      },
      reviewStatus: "approved" as const,
      rightsStatus: "cleared" as const,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      createAdminJsonResponse(
        {
          asset: reviewedAsset,
          draftId: "draft-31",
          draftRevision: 3,
          fortuneDate: "2026-08-01",
          previewUrl: "/admin/api/v1/image-assets/asset-primary/preview",
          reviewLocked: false,
        },
        { headers: { ETag: '"draft:3"' } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminApi.reviewDraftImage({
      assetId: "asset-primary",
      body: {
        aiLabelCompliance: "passed",
        aiLabelStatus: "complete",
        colorAndCopyConsistency: "passed",
        decision: "approved",
        garmentAndPersonIntegrity: "passed",
        mobileAndWechatPreview: "passed",
        notes: "逐项检查通过",
        rightsAndIdentityRisk: "passed",
        rightsStatus: "cleared",
        scenarioAndImitability: "passed",
      },
      csrfToken,
      draftId: "draft-31",
      etag: '"draft:2"',
      idempotencyKey: "idem-review-0000000000000001",
    });

    expect(result.ok).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("If-Match")).toBe('"draft:2"');
    expect(new Headers(request.headers).get("Idempotency-Key")).toBe(
      "idem-review-0000000000000001",
    );
    expect(JSON.parse(String(request.body))).toEqual(
      expect.objectContaining({ decision: "approved", mobileAndWechatPreview: "passed" }),
    );
  });

  it("withdraws one image with the lifecycle ETag and idempotency key", async () => {
    const approvedAsset = (assetId: string, shaCharacter: string) => ({
      ...imageAsset,
      assetId,
      fileUrl: `https://cdn.example.com/${assetId}.webp`,
      manualReview: {
        aiLabelCompliance: "passed" as const,
        colorAndCopyConsistency: "passed" as const,
        garmentAndPersonIntegrity: "passed" as const,
        mobileAndWechatPreview: "passed" as const,
        notes: "逐项检查通过",
        reviewId: `review-${assetId}`,
        reviewedAt: "2026-08-01T03:00:00.000Z",
        reviewerAccountId: "maintainer",
        rightsAndIdentityRisk: "passed" as const,
        scenarioAndImitability: "passed" as const,
      },
      reviewStatus: "approved" as const,
      rightsStatus: "cleared" as const,
      sha256: shaCharacter.repeat(64),
    });
    const imageSet = {
      assets: [
        approvedAsset("asset-primary", "a"),
        approvedAsset("asset-fallback", "b"),
        approvedAsset("asset-alternative", "c"),
        approvedAsset("asset-alternative-fallback", "d"),
      ],
      contentVersion: "fd-20260801-r1",
      fortuneDate: "2026-08-01",
      lifecycleRevision: 4,
      slots: [
        {
          coverAssetId: "asset-primary",
          deliveryStatus: "fallback" as const,
          detailAssetIds: [],
          fallbackAssetId: "asset-fallback",
          imageSlot: "required_primary" as const,
          lookId: "look-primary",
          servedCoverAssetId: "asset-fallback",
          servedDetailAssetIds: [],
        },
        {
          coverAssetId: "asset-alternative",
          deliveryStatus: "active" as const,
          detailAssetIds: [],
          fallbackAssetId: "asset-alternative-fallback",
          imageSlot: "required_alternative" as const,
          lookId: "look-alternative",
          servedCoverAssetId: "asset-alternative",
          servedDetailAssetIds: [],
        },
      ],
      withdrawalEvents: [
        {
          assetId: "asset-primary",
          auditEventId: "audit-withdraw-1",
          reason: "授权范围变化",
          withdrawalEventId: "withdrawal-1",
          withdrawnAt: "2026-08-01T04:00:00.000Z",
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      createAdminJsonResponse(
        {
          assetId: "asset-primary",
          auditEventId: "audit-withdraw-1",
          dailyImageSet: imageSet,
          deliveryAction: "fallback_activated",
          lifecycleRevision: 4,
        },
        { headers: { ETag: '"lifecycle:4"' } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await adminApi.withdrawImage({
      assetId: "asset-primary",
      body: { expectedActiveContentVersion: "fd-20260801-r1", reason: "授权范围变化" },
      contentVersion: "fd-20260801-r1",
      csrfToken,
      etag: '"lifecycle:3"',
      idempotencyKey: "idem-withdraw-0000000000001",
    });

    expect(result.ok).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(headers.get("If-Match")).toBe('"lifecycle:3"');
    expect(headers.get("Idempotency-Key")).toBe("idem-withdraw-0000000000001");
    expect(headers.get("X-CSRF-Token")).toBe(csrfToken);
  });

  it.each([
    [
      "calendar nested fields",
      "calendar_algorithm",
      {
        algorithmVersion: "algorithm-v1",
        calendar: {},
        calendarDataVersion: "data-v1",
        calendarRuleVersion: "rule-v1",
        tiers: [{}, {}, {}, {}, {}],
      },
    ],
    [
      "copy and formula nested fields",
      "copy_and_formula",
      {
        balanceSuggestion: {},
        basis: {},
        copyVersion: "copy-v1",
        outfitFormulas: [{}, {}, {}],
        outfitVersion: "outfit-v1",
        share: {},
      },
    ],
    [
      "visual and rights nested fields",
      "visual_and_rights",
      {
        assetManifestVersion: "assets-v1",
        assets: [{}, {}],
        looks: [{}, {}],
        rightsRecords: [],
      },
    ],
    [
      "poster consistency fields",
      "poster_consistency",
      {
        posterTemplateVersion: "",
        sampleAssetId: "asset-sample",
        templateId: "template-mobile",
      },
    ],
  ])(
    "rejects malformed %s instead of trusting top-level keys",
    async (_label, moduleCode, module) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          createAdminJsonResponse(
            {
              ...emptyDraft,
              modules: { ...emptyDraft.modules, [moduleCode]: module },
            },
            { headers: { ETag: '"draft:1"' } },
          ),
        ),
      );

      const result = await adminApi.getDraft("draft-31");

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.status).toBe(502);
    },
  );

  it("does not silently cap the unpaginated draft recovery list", async () => {
    const items = Array.from({ length: 501 }, (_, index) => ({
      createdAt: "2026-07-31T10:00:00+08:00",
      draftId: `draft-${index + 1}`,
      draftRevision: 1,
      fortuneDate: "2026-08-01",
      state: "draft",
      updatedAt: "2026-07-31T10:00:00+08:00",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createAdminJsonResponse({ items })));

    const result = await adminApi.listDrafts();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.items).toHaveLength(501);
  });
});
