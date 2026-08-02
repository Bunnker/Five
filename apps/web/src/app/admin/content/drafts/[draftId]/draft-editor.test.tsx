import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSessionProvider } from "../../../admin-session-context";
import { createAdminJsonResponse } from "../../../admin-test-responses";
import { DraftEditor } from "./draft-editor";

const now = Date.now();
const session = {
  absoluteExpiresAt: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
  credentialRevision: 1,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
  issuedAt: new Date(now).toISOString(),
  username: "maintainer",
};
const draft = {
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
  state: "draft",
  updatedAt: "2026-07-31T10:00:00+08:00",
};

const tierRows = [
  [1, "da_ji", "大吉", "今日优先", "primary", "wood", "木"],
  [2, "ci_ji", "次吉", "稳妥选择", "primary", "fire", "火"],
  [3, "ping", "平", "日常可穿", "primary", "earth", "土"],
  [4, "jiao_cha", "较差", "注意", "attention", "metal", "金"],
  [5, "bu_li", "不利", "注意", "attention", "water", "水"],
] as const;

const completeModules = {
  calendar_algorithm: {
    algorithmVersion: "algorithm-v1",
    calendar: {
      branch: "申",
      dayElement: "wood",
      dayElementLabel: "木",
      ganzhiDay: "甲申",
      lunarDateText: "六月十九",
      weekdayText: "星期六",
    },
    calendarDataVersion: "data-v1",
    calendarRuleVersion: "rule-v1",
    tiers: tierRows.map(
      ([rank, tierCode, algorithmLabel, displayLabel, displaySection, element, elementLabel]) => ({
        algorithmLabel,
        colors: [{ colorCode: `color-${rank}`, name: `${elementLabel}色` }],
        displayLabel,
        displaySection,
        element,
        elementLabel,
        explanation: `${algorithmLabel}档说明`,
        rank,
        relationText: `${elementLabel}关系`,
        tierCode,
      }),
    ),
  },
  copy_and_formula: {
    balanceSuggestion: {
      accessoryExamples: ["丝巾"],
      description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      preferredTierCode: "da_ji",
      title: "已经穿了注意色",
    },
    basis: { disclaimer: "传统文化参考", steps: ["依据日历规则生成"] },
    copyVersion: "copy-v1",
    outfitFormulas: [1, 2, 3].map((index) => ({
      audience: { code: "all", label: "通用" },
      disclaimer: "普通穿搭建议",
      formulaId: `formula-${index}`,
      kind: "mono" as const,
      lookIds: [`look-${index}`],
      scenario: { code: "daily", label: "日常" },
      slots: [
        {
          colorCodes: [`color-${index}`],
          garmentParts: ["上装"],
          ratioPercent: 80,
          role: "primary" as const,
          roleLabel: "主色" as const,
          tierCode: "da_ji" as const,
        },
      ],
      title: `穿法 ${index}`,
    })),
    outfitVersion: "outfit-v1",
    share: {
      copyText: "今日穿搭建议",
      posterJobEndpoint: "/api/v1/poster-jobs" as const,
      posterTemplateVersion: "poster-v1",
      summaryText: "今日宜穿木色",
    },
  },
  poster_consistency: {
    posterTemplateVersion: "poster-v1",
    sampleAssetId: "asset-1",
    templateId: "template-mobile",
  },
  visual_and_rights: {
    assetManifestVersion: "assets-v1",
    assets: [1, 2].map((index) => ({
      aiLabelStatus: "not_applicable" as const,
      altText: `穿搭图 ${index}`,
      assetId: `asset-${index}`,
      declaredModel: null,
      fileUrl: null,
      generatedAt: null,
      height: 1200,
      mediaType: "image/webp" as const,
      promptVersion: null,
      reviewStatus: "pending" as const,
      rightsRecordIds: [],
      rightsStatus: "pending" as const,
      sha256: String(index).repeat(64),
      sourceType: "licensed" as const,
      width: 900,
    })),
    looks: [1, 2].map((index) => ({
      alternatives: [],
      audience: { code: "all", label: "通用" },
      coverAssetId: `asset-${index}`,
      detailAssetIds: [],
      formulaId: `formula-${index}`,
      items: [
        {
          category: "top" as const,
          categoryLabel: "上装",
          colorCode: `color-${index}`,
          description: "日常上装",
        },
      ],
      lookId: `look-${index}`,
      requiredForPublish: true,
      scenario: { code: "daily", label: "日常" },
      sortOrder: index,
      title: `造型 ${index}`,
    })),
    rightsRecords: [],
  },
};

describe("DraftEditor", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("validates and saves a module using the latest draft ETag", async () => {
    const posterModule = {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "asset-sample",
      templateId: "template-mobile",
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(createAdminJsonResponse(draft, { headers: { ETag: '"draft:1"' } }))
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
      );

    render(
      <AdminSessionProvider>
        <DraftEditor draftId="draft-31" />
      </AdminSessionProvider>,
    );

    const editor = await screen.findByLabelText("海报一致性 JSON");
    fireEvent.change(editor, { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "保存海报一致性" }));
    expect(await screen.findByText(/不是有效 JSON/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.change(editor, { target: { value: JSON.stringify(posterModule) } });
    fireEvent.click(screen.getByRole("button", { name: "保存海报一致性" }));

    expect(await screen.findByText(/草稿修订 2/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/admin/api/v1/daily-content-drafts/draft-31/modules/poster_consistency",
      expect.objectContaining({
        headers: expect.objectContaining({
          "If-Match": '"draft:1"',
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "PATCH",
      }),
    );
  });

  it("stops on a revision conflict and reloads before another edit", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(createAdminJsonResponse(draft, { headers: { ETag: '"draft:1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }));

    render(
      <AdminSessionProvider>
        <DraftEditor draftId="draft-31" />
      </AdminSessionProvider>,
    );

    fireEvent.change(await screen.findByLabelText("海报一致性 JSON"), {
      target: {
        value: JSON.stringify({
          posterTemplateVersion: "poster-v1",
          sampleAssetId: "asset-sample",
          templateId: "template-mobile",
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存海报一致性" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("其他页面已经更新这份草稿");
    expect(screen.getByRole("button", { name: "重新载入草稿" })).toBeInTheDocument();
  });

  it("locks a module editor while its save is in flight", async () => {
    const posterModule = {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "asset-sample",
      templateId: "template-mobile",
    };
    let resolveSave: ((response: Response) => void) | undefined;
    const saveResponse = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(createAdminJsonResponse(draft, { headers: { ETag: '"draft:1"' } }))
      .mockReturnValueOnce(saveResponse);

    render(
      <AdminSessionProvider>
        <DraftEditor draftId="draft-31" />
      </AdminSessionProvider>,
    );

    const editor = await screen.findByLabelText("海报一致性 JSON");
    fireEvent.change(editor, { target: { value: JSON.stringify(posterModule) } });
    fireEvent.click(screen.getByRole("button", { name: "保存海报一致性" }));

    await waitFor(() => expect(editor).toBeDisabled());
    resolveSave?.(
      createAdminJsonResponse(
        {
          draftId: "draft-31",
          draftRevision: 2,
          module: posterModule,
          moduleCode: "poster_consistency",
        },
        { headers: { ETag: '"draft:2"' } },
      ),
    );
    await waitFor(() => expect(editor).not.toBeDisabled());
    expect(editor).toHaveValue(JSON.stringify(posterModule, null, 2));
  });

  it("freezes a complete draft with If-Match and an idempotency key", async () => {
    const completeDraft = {
      ...draft,
      modules: completeModules,
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
        createAdminJsonResponse(completeDraft, { headers: { ETag: '"draft:4"' } }),
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

    render(
      <AdminSessionProvider>
        <DraftEditor draftId="draft-31" />
      </AdminSessionProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "提交并冻结版本" }));

    expect(await screen.findByRole("link", { name: "查看不可变版本" })).toHaveAttribute(
      "href",
      "/admin/content/versions/fd-20260801-r1",
    );
    const headers = new Headers(fetchMock.mock.calls[2]?.[1]?.headers);
    expect(headers.get("If-Match")).toBe('"draft:4"');
    expect(headers.get("Idempotency-Key")).toMatch(/^[a-f0-9]{32}$/u);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("blocks freezing when a module has unsaved edits", async () => {
    const completeDraft = {
      ...draft,
      modules: completeModules,
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(createAdminJsonResponse(session))
      .mockResolvedValueOnce(
        createAdminJsonResponse(completeDraft, { headers: { ETag: '"draft:4"' } }),
      );

    render(
      <AdminSessionProvider>
        <DraftEditor draftId="draft-31" />
      </AdminSessionProvider>,
    );

    const copyEditor = await screen.findByLabelText("文案与穿法 JSON");
    fireEvent.change(copyEditor, {
      target: {
        value: JSON.stringify({
          ...completeModules.copy_and_formula,
          copyVersion: "copy-unsaved",
        }),
      },
    });

    expect(screen.getByText("有未保存修改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "提交并冻结版本" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "提交前必须保存所有修改。尚未保存：文案与穿法。",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
