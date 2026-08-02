import { afterEach, describe, expect, it, vi } from "vitest";

import { adminApi } from "./admin-api";
import { createAdminJsonResponse } from "./admin-test-responses";

const csrfToken = "csrf-token-that-is-longer-than-thirty-two-characters";

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
