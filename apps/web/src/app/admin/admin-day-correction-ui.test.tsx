import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  adminApi,
  type AdminApiResult,
  type AdminDayDetail,
  type AdminImageAsset,
  type AdminSession,
  type DayCorrectionApplyResult,
  type DayCorrectionPatchResult,
  type DayCorrectionWorkingCopy,
} from "./admin-api";
import type { AdminDayImageAdapter } from "./admin-day-image-adapter";
import { AdminDayDetailView, AdminOperationsDay } from "./admin-operations-ui";
import { AdminSessionProvider } from "./admin-session-context";

const mockToday = vi.hoisted(() => ({
  attentionSection: {
    balanceSuggestion: { description: "旧配饰说明" },
    groups: [
      {
        algorithmLabel: "较差",
        colors: [{ name: "红色" }],
        elementLabel: "火",
        explanation: "旧较差说明",
        tierCode: "jiao_cha",
      },
      {
        algorithmLabel: "不利",
        colors: [{ name: "蓝色" }],
        elementLabel: "水",
        explanation: "旧不利说明",
        tierCode: "bu_li",
      },
    ],
  },
  basis: { disclaimer: "旧参考说明" },
  ciJiCard: {
    algorithmLabel: "次吉",
    colors: [{ name: "黄色" }],
    elementLabel: "土",
    explanation: "旧次吉说明",
    tierCode: "ci_ji",
  },
  daJiCard: {
    algorithmLabel: "大吉",
    colors: [{ name: "白色" }],
    elementLabel: "金",
    explanation: "旧大吉说明",
    tierCode: "da_ji",
  },
  imagePreviewSection: {
    cards: [
      { assetId: "asset-primary", placement: "primary", title: "主方案图片" },
      { assetId: "asset-alternative", placement: "alternate", title: "备选方案图片" },
    ],
  },
  outfitPreviewSection: {
    cards: [
      { description: "旧穿搭说明", formulaId: "formula-mono", title: "旧穿搭标题" },
      { description: "二", formulaId: "formula-dual", title: "二" },
      { description: "三", formulaId: "formula-triple", title: "三" },
    ],
  },
  pingCard: {
    algorithmLabel: "平",
    colors: [{ name: "绿色" }],
    elementLabel: "木",
    explanation: "旧平说明",
    tierCode: "ping",
  },
  share: { copyText: "旧分享文案" },
}));

const mockAuthoritativePreview = vi.hoisted(() => ({
  daJiExplanation: "旧大吉说明",
  primaryAssetId: "asset-primary",
  primaryTitle: "主方案图片",
}));

vi.mock("../../lib/today", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/today")>()),
  parseDailyExperienceViewData: () => ({
    ...mockToday,
    daJiCard: {
      ...mockToday.daJiCard,
      explanation: mockAuthoritativePreview.daJiExplanation,
    },
    imagePreviewSection: {
      cards: mockToday.imagePreviewSection.cards.map((card) =>
        card.placement === "primary"
          ? {
              ...card,
              assetId: mockAuthoritativePreview.primaryAssetId,
              title: mockAuthoritativePreview.primaryTitle,
            }
          : card,
      ),
    },
  }),
}));

vi.mock("../../components/daily-experience-view", () => ({
  DailyExperienceView: ({
    onSelectionChange,
    today,
  }: {
    onSelectionChange?: (key: string) => void;
    today: typeof mockToday;
  }) => (
    <div>
      <button type="button" onClick={() => onSelectionChange?.("tier.da_ji.explanation")}>
        {today.daJiCard.explanation}
      </button>
      <button type="button" onClick={() => onSelectionChange?.("tier.da_ji.algorithm")}>
        大吉算法
      </button>
      <button type="button" onClick={() => onSelectionChange?.("formula.formula-mono.title")}>
        {today.outfitPreviewSection.cards[0]?.title}
      </button>
      {today.imagePreviewSection.cards.map((card) => (
        <button
          aria-label={`选择预览图片 ${card.placement}`}
          key={card.assetId}
          type="button"
          onClick={() =>
            onSelectionChange?.(
              card.placement === "primary"
                ? "image.required_primary"
                : "image.required_alternative",
            )
          }
        >
          {card.title}
        </button>
      ))}
    </div>
  ),
}));

const session: AdminSession = {
  absoluteExpiresAt: "2026-08-07T05:00:00+08:00",
  credentialRevision: 1,
  csrfToken: "csrf-token-that-is-longer-than-thirty-two-characters",
  idleExpiresAt: "2026-08-06T17:30:00+08:00",
  issuedAt: "2026-08-06T17:00:00+08:00",
  username: "maintainer",
};

function reviewedAsset(assetId: string, index: number): AdminImageAsset {
  return {
    aiLabelStatus: "not_applicable",
    altText: `${assetId} 模特穿搭`,
    assetId,
    declaredModel: null,
    fileUrl: `https://cdn.example.com/${assetId}.webp`,
    generatedAt: null,
    generationMethod: "owned_upload",
    height: 1200,
    manualReview: null,
    mediaType: "image/webp",
    promptVersion: null,
    reproductionReference: null,
    reviewStatus: "approved",
    rightsRecordIds: [],
    rightsStatus: "cleared",
    sha256: String(index).repeat(64),
    sourceMaterialReferences: [`source:${assetId}`],
    sourceType: "licensed",
    width: 900,
  };
}

function calendarAlgorithm(daJiExplanation: string) {
  const tiers: NonNullable<DayCorrectionWorkingCopy["modules"]["calendar_algorithm"]>["tiers"] = [
    {
      algorithmLabel: "大吉",
      colors: [{ colorCode: "black", name: "黑色" }],
      displayLabel: "今日优先",
      displaySection: "primary",
      element: "water",
      elementLabel: "水",
      explanation: daJiExplanation,
      rank: 1,
      relationText: "金生水",
      tierCode: "da_ji",
    },
    {
      algorithmLabel: "次吉",
      colors: [{ colorCode: "white", name: "白色" }],
      displayLabel: "稳妥选择",
      displaySection: "primary",
      element: "metal",
      elementLabel: "金",
      explanation: "旧次吉说明",
      rank: 2,
      relationText: "金与金同类",
      tierCode: "ci_ji",
    },
    {
      algorithmLabel: "平",
      colors: [{ colorCode: "red", name: "红色" }],
      displayLabel: "日常可穿",
      displaySection: "primary",
      element: "fire",
      elementLabel: "火",
      explanation: "旧平说明",
      rank: 3,
      relationText: "火克金",
      tierCode: "ping",
    },
    {
      algorithmLabel: "较差",
      colors: [{ colorCode: "yellow", name: "黄色" }],
      displayLabel: "注意",
      displaySection: "attention",
      element: "earth",
      elementLabel: "土",
      explanation: "旧较差说明",
      rank: 4,
      relationText: "土生金",
      tierCode: "jiao_cha",
    },
    {
      algorithmLabel: "不利",
      colors: [{ colorCode: "green", name: "绿色" }],
      displayLabel: "注意",
      displaySection: "attention",
      element: "wood",
      elementLabel: "木",
      explanation: "旧不利说明",
      rank: 5,
      relationText: "金克木",
      tierCode: "bu_li",
    },
  ];
  return {
    algorithmVersion: "algorithm-v1",
    calendar: {
      branch: "酉",
      dayElement: "metal",
      dayElementLabel: "金",
      ganzhiDay: "己酉",
      lunarDateText: "六月廿一",
      weekdayText: "星期四",
    },
    calendarDataVersion: "data-v1",
    calendarRuleVersion: "rule-v1",
    tiers,
  } satisfies NonNullable<DayCorrectionWorkingCopy["modules"]["calendar_algorithm"]>;
}

const copyAndFormula = {
  balanceSuggestion: {
    accessoryExamples: ["丝巾", "包"],
    description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
    preferredTierCode: "da_ji",
    title: "已经穿了注意色",
  },
  basis: {
    disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
    steps: ["今日干支为己酉", "酉属金，因此今日为金日"],
  },
  copyVersion: "copy-v1",
  outfitFormulas: ["mono", "dual", "triple"].map((suffix, index) => ({
    audience: { code: "all", label: "通用" },
    disclaimer: suffix === "mono" ? "旧穿搭说明" : index === 1 ? "二" : "三",
    formulaId: `formula-${suffix}`,
    kind: "mono" as const,
    lookIds: [`look-${index + 1}`],
    scenario: { code: "daily", label: "日常" },
    slots: [
      {
        colorCodes: ["black"],
        garmentParts: ["上衣", "下装"],
        ratioPercent: 100,
        role: "primary" as const,
        roleLabel: "主色",
        tierCode: "da_ji" as const,
      },
    ],
    title: suffix === "mono" ? "旧穿搭标题" : index === 1 ? "二" : "三",
  })),
  outfitVersion: "outfit-v1",
  share: {
    copyText: "今日金日穿搭参考。",
    posterJobEndpoint: "/api/v1/poster-jobs",
    posterTemplateVersion: "poster-v1",
    summaryText: "今日优先参考黑色。",
  },
} satisfies NonNullable<DayCorrectionWorkingCopy["modules"]["copy_and_formula"]>;

const primaryAsset = reviewedAsset("asset-primary", 1);
const alternativeAsset = reviewedAsset("asset-alternative", 2);
const completeVisual = {
  assetManifestVersion: "assets-v1",
  assets: [primaryAsset, alternativeAsset],
  looks: [
    {
      alternatives: [],
      audience: { code: "all", label: "通用" },
      coverAssetId: primaryAsset.assetId,
      detailAssetIds: [],
      fallbackAssetId: alternativeAsset.assetId,
      formulaId: "formula-mono",
      imageSlot: "required_primary",
      items: [],
      lookId: "look-primary",
      requiredForPublish: true,
      scenario: { code: "daily", label: "日常" },
      sortOrder: 1,
      title: "主方案",
    },
    {
      alternatives: [],
      audience: { code: "all", label: "通用" },
      coverAssetId: alternativeAsset.assetId,
      detailAssetIds: [],
      fallbackAssetId: primaryAsset.assetId,
      formulaId: "formula-dual",
      imageSlot: "required_alternative",
      items: [],
      lookId: "look-alternative",
      requiredForPublish: true,
      scenario: { code: "daily", label: "日常" },
      sortOrder: 2,
      title: "备选方案",
    },
  ],
  rightsRecords: [],
} satisfies NonNullable<DayCorrectionWorkingCopy["modules"]["visual_and_rights"]>;

const workingCopy: DayCorrectionWorkingCopy = {
  applyMode: null,
  baselineActiveContentVersion: "content-20260806-v1",
  correctionId: "correction-20260806-0001",
  correctionRevision: 3,
  createdAt: "2026-08-06T17:00:00+08:00",
  draftId: "draft-correction-20260806-0001",
  draftRevision: 7,
  fortuneDate: "2026-08-06",
  modules: {
    calendar_algorithm: calendarAlgorithm("旧大吉说明"),
    copy_and_formula: copyAndFormula,
    poster_consistency: null,
    visual_and_rights: completeVisual,
  },
  sourceContentVersion: "content-20260806-v1",
  status: "open",
  submittedContentVersion: null,
  updatedAt: "2026-08-06T17:00:00+08:00",
};

function workingCopyWithEditableCopy({
  daJiExplanation,
  formulaTitle,
  draftRevision = workingCopy.draftRevision,
}: {
  daJiExplanation: string;
  draftRevision?: number;
  formulaTitle: string;
}): DayCorrectionWorkingCopy {
  return {
    ...workingCopy,
    draftRevision,
    modules: {
      ...workingCopy.modules,
      calendar_algorithm: calendarAlgorithm(daJiExplanation),
      copy_and_formula: {
        ...copyAndFormula,
        outfitFormulas: copyAndFormula.outfitFormulas.map((formula) =>
          formula.formulaId === "formula-mono" ? { ...formula, title: formulaTitle } : formula,
        ),
      },
    },
  };
}

function detail(relation: "current" | "future" | "past" = "current"): AdminDayDetail {
  return {
    concurrency: {
      activeContentVersion: relation === "current" ? "content-20260806-v1" : null,
      lifecycleRevision: 3,
      scheduleSlotRevision: 1,
    },
    editableSelectionKeys: [
      "tier.da_ji.explanation",
      "formula.formula-mono.title",
      "image.required_primary",
    ],
    nextOperationalBoundaryAt: "2026-08-06T18:00:00+08:00",
    preview: {
      versions: { contentVersion: "content-20260806-v1" },
    } as AdminDayDetail["preview"],
    previewPublicContentContext: {
      advancedFromCivilDate: false,
      servedFortuneDate: "2026-08-06",
      switchBoundary: "18:00",
    },
    previewSource: relation === "future" ? "scheduled" : "published",
    previewRequestContext: {
      civilDate: "2026-08-06",
      crossedDayBoundary: false,
      dayBoundary: "23:00",
      fortuneDate: "2026-08-06",
      responseGeneratedAt: "2026-08-06T17:00:00+08:00",
      shichen: "酉",
      timezone: "Asia/Shanghai",
    },
    publicContentContext: {
      advancedFromCivilDate: false,
      servedFortuneDate: "2026-08-06",
      switchBoundary: "18:00",
    },
    readonlySelectionKeys: ["calendar.summary", "tier.da_ji.algorithm"],
    requestContext: {
      civilDate: "2026-08-06",
      crossedDayBoundary: false,
      dayBoundary: "23:00",
      fortuneDate: "2026-08-06",
      responseGeneratedAt: "2026-08-06T17:00:00+08:00",
      shichen: "酉",
      timezone: "Asia/Shanghai",
    },
    summary: {
      dayElement: "metal",
      dayElementLabel: "金",
      effectiveFrom: "2026-08-05T18:00:00+08:00",
      effectiveTo: "2026-08-06T18:00:00+08:00",
      fortuneDate: "2026-08-06",
      issueCodes: [],
      lifecycleRevision: 3,
      operationalStatus: relation === "current" ? "published_healthy" : "scheduled_ready",
      optionalImageStatus: "not_requested",
      prepareBy: "2026-08-05T13:00:00+08:00",
      previewAvailable: true,
      primaryColors: [{ colorCode: "ivory", name: "乳白" }],
      relation,
      requiredImages: { deliverySafeCount: 2, modelReadyCount: 2, requiredCount: 2 },
      scheduleSlotRevision: 1,
      updatedAt: "2026-08-06T16:30:00+08:00",
    },
  };
}

function success<T>(data: T, etag: string): AdminApiResult<T> {
  return {
    data,
    ok: true,
    response: new Response(null, { headers: { ETag: etag } }),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const patchResult: DayCorrectionPatchResult = {
  correctionId: workingCopy.correctionId,
  correctionRevision: 3,
  draftRevision: 8,
  fortuneDate: workingCopy.fortuneDate,
  moduleCode: "calendar_algorithm",
};

const applyResult: DayCorrectionApplyResult = {
  action: {
    activeContentVersion: "content-20260806-v2",
    auditEventId: "audit-correction-20260806-0001",
    contentVersion: "content-20260806-v2",
    fortuneDate: "2026-08-06",
    lifecycleRevision: 4,
    state: "published",
    transitions: [],
  },
  correctionId: workingCopy.correctionId,
  correctionRevision: 4,
  draftRevision: 8,
  mode: "immediate",
};

describe("visual day correction", () => {
  afterEach(() => {
    mockAuthoritativePreview.daJiExplanation = "旧大吉说明";
    mockAuthoritativePreview.primaryAssetId = "asset-primary";
    mockAuthoritativePreview.primaryTitle = "主方案图片";
    vi.restoreAllMocks();
  });

  it("shows direct structured editors and three independent image cards without exposing algorithm controls", () => {
    render(<AdminDayDetailView detail={detail()} session={session} />);

    expect(screen.getByRole("textbox", { name: "大吉颜色说明" })).toHaveValue("旧大吉说明");
    expect(screen.getByRole("textbox", { name: "“旧穿搭标题”标题" })).toHaveValue("旧穿搭标题");
    expect(screen.getByRole("region", { name: "算法结果 · 只读" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /算法/u })).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "主方案" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "备选方案" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "可选图" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("article", { name: "主方案" })).getByRole("button", {
        name: "手动上传",
      }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/工作副本|图片槽位|草稿 ID|JSON/u);
  });

  it("opens lazily, PATCHes only the selected copy, updates preview, and retries apply with one key", async () => {
    const open = vi
      .spyOn(adminApi, "openDayCorrection")
      .mockResolvedValue(success(workingCopy, '"correction:3|draft:7"'));
    const patch = vi
      .spyOn(adminApi, "patchDayCorrection")
      .mockResolvedValue(success(patchResult, '"correction:3|draft:8"'));
    vi.spyOn(adminApi, "getDayCorrection").mockResolvedValue(
      success(
        {
          ...workingCopy,
          draftRevision: 8,
          modules: {
            ...workingCopy.modules,
            calendar_algorithm: calendarAlgorithm("新的大吉说明"),
          },
        },
        '"correction:3|draft:8"',
      ),
    );
    const apply = vi
      .spyOn(adminApi, "applyDayCorrection")
      .mockResolvedValueOnce({
        error: {
          kind: "api-error",
          requestId: "request-correction-0001",
          retryAfterSeconds: 30,
          status: 503,
        },
        ok: false,
      })
      .mockResolvedValueOnce(success(applyResult, '"correction:4|draft:8"'));

    render(<AdminDayDetailView detail={detail()} session={session} />);

    expect(
      screen.getByText(/当前公开日期会创建新版本并立即替换 · 必备图片 2\/2/u),
    ).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "大吉颜色说明" }), {
      target: { value: "新的大吉说明" },
    });
    const primary = screen.getByRole("button", { name: "保存并立即替换" });
    expect(primary).toBeEnabled();
    fireEvent.click(primary);
    expect(await screen.findByText(/内容已安全保存，但发布暂不可用/u)).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          explanation: "新的大吉说明",
          kind: "set_tier_explanation",
          tierCode: "da_ji",
        },
        etag: '"correction:3|draft:7"',
      }),
    );
    expect(screen.getByRole("button", { name: "新的大吉说明" })).toBeInTheDocument();
    fireEvent.click(primary);
    expect(await screen.findByText("新版本已立即替换，用户端会读取这次修改。")).toBeInTheDocument();

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0]?.[0].etag).toBe('"correction:3|draft:8"');
    expect(apply.mock.calls[0]?.[0].idempotencyKey).toBe(apply.mock.calls[1]?.[0].idempotencyKey);
    expect(primary).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "大吉颜色说明" })).toBeDisabled();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("reopens same-day editing only after refreshed authority confirms the applied version", async () => {
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    vi.spyOn(adminApi, "patchDayCorrection").mockResolvedValue(
      success(patchResult, '"correction:3|draft:8"'),
    );
    vi.spyOn(adminApi, "getDayCorrection").mockResolvedValue(
      success(
        workingCopyWithEditableCopy({
          daJiExplanation: "第一次已经生效的说明",
          draftRevision: 8,
          formulaTitle: "旧穿搭标题",
        }),
        '"correction:3|draft:8"',
      ),
    );
    vi.spyOn(adminApi, "applyDayCorrection").mockResolvedValue(
      success(applyResult, '"correction:4|draft:8"'),
    );

    const initialDetail = detail();
    const { rerender } = render(<AdminDayDetailView detail={initialDetail} session={session} />);
    const editor = screen.getByRole("textbox", { name: "大吉颜色说明" });
    fireEvent.change(editor, { target: { value: "第一次已经生效的说明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并立即替换" }));

    expect(await screen.findByText("新版本已立即替换，用户端会读取这次修改。")).toBeInTheDocument();
    expect(editor).toBeDisabled();
    expect(editor).toHaveValue("第一次已经生效的说明");

    rerender(<AdminDayDetailView detail={{ ...initialDetail }} session={session} />);

    expect(editor).toBeDisabled();
    expect(editor).toHaveValue("第一次已经生效的说明");
    expect(screen.getByText("新版本已立即替换，用户端会读取这次修改。")).toBeInTheDocument();

    const confirmedDetail = detail();
    confirmedDetail.summary.lifecycleRevision = applyResult.action.lifecycleRevision;
    confirmedDetail.concurrency.lifecycleRevision = applyResult.action.lifecycleRevision;
    confirmedDetail.concurrency.activeContentVersion = applyResult.action.activeContentVersion;
    if (confirmedDetail.preview !== null) {
      confirmedDetail.preview.versions.contentVersion = applyResult.action.contentVersion;
    }
    rerender(<AdminDayDetailView detail={confirmedDetail} session={session} />);

    await waitFor(() => expect(editor).toBeEnabled());
    expect(screen.queryByText("新版本已立即替换，用户端会读取这次修改。")).not.toBeInTheDocument();
    fireEvent.change(editor, { target: { value: "第二次订正的说明" } });
    expect(screen.getByRole("button", { name: "保存并立即替换" })).toBeEnabled();
  });

  it("reopens immediately when refreshed authority arrives before the apply response", async () => {
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    vi.spyOn(adminApi, "patchDayCorrection").mockResolvedValue(
      success(patchResult, '"correction:3|draft:8"'),
    );
    vi.spyOn(adminApi, "getDayCorrection").mockResolvedValue(
      success(
        workingCopyWithEditableCopy({
          daJiExplanation: "已经生效的反向竞态说明",
          draftRevision: 8,
          formulaTitle: "旧穿搭标题",
        }),
        '"correction:3|draft:8"',
      ),
    );
    const pendingApply = deferred<AdminApiResult<DayCorrectionApplyResult>>();
    vi.spyOn(adminApi, "applyDayCorrection").mockReturnValue(pendingApply.promise);

    const initialDetail = detail();
    const { rerender } = render(<AdminDayDetailView detail={initialDetail} session={session} />);
    const editor = screen.getByRole("textbox", { name: "大吉颜色说明" });
    fireEvent.change(editor, { target: { value: "已经生效的反向竞态说明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并立即替换" }));

    await waitFor(() => expect(adminApi.applyDayCorrection).toHaveBeenCalledTimes(1));
    expect(editor).toBeDisabled();

    mockAuthoritativePreview.daJiExplanation = "更高权威版本的说明";
    mockAuthoritativePreview.primaryAssetId = "asset-authority-v3";
    mockAuthoritativePreview.primaryTitle = "更高权威版本主图";
    const authorityArrivedFirst = detail();
    authorityArrivedFirst.summary.lifecycleRevision = applyResult.action.lifecycleRevision + 1;
    authorityArrivedFirst.concurrency.lifecycleRevision = applyResult.action.lifecycleRevision + 1;
    authorityArrivedFirst.concurrency.activeContentVersion = "content-20260806-v3";
    if (authorityArrivedFirst.preview !== null) {
      authorityArrivedFirst.preview.versions.contentVersion = "content-20260806-v3";
    }
    rerender(<AdminDayDetailView detail={authorityArrivedFirst} session={session} />);
    expect(editor).toBeDisabled();

    await act(async () => {
      pendingApply.resolve(success(applyResult, '"correction:4|draft:8"'));
      await pendingApply.promise;
    });

    await waitFor(() => expect(editor).toBeEnabled());
    expect(editor).toHaveValue("更高权威版本的说明");
    expect(screen.getByRole("button", { name: "选择预览图片 primary" })).toHaveTextContent(
      "更高权威版本主图",
    );
    expect(screen.queryByText("新版本已立即替换，用户端会读取这次修改。")).not.toBeInTheDocument();
    fireEvent.change(editor, { target: { value: "无需额外刷新即可再次订正" } });
    expect(screen.getByRole("button", { name: "保存并立即替换" })).toBeEnabled();
  });

  it("asks the day loader for fresh authority immediately after apply succeeds", async () => {
    const initialDetail = detail();
    const confirmedDetail = detail();
    confirmedDetail.summary.lifecycleRevision = applyResult.action.lifecycleRevision;
    confirmedDetail.concurrency.lifecycleRevision = applyResult.action.lifecycleRevision;
    confirmedDetail.concurrency.activeContentVersion = applyResult.action.activeContentVersion;
    if (confirmedDetail.preview !== null) {
      confirmedDetail.preview.versions.contentVersion = applyResult.action.contentVersion;
    }
    vi.spyOn(adminApi, "getSession").mockResolvedValue(success(session, '"session:1"'));
    const getDay = vi
      .spyOn(adminApi, "getOperationsDay")
      .mockResolvedValueOnce(success(initialDetail, '"day:3"'))
      .mockResolvedValue(success(confirmedDetail, '"day:4"'));
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    vi.spyOn(adminApi, "patchDayCorrection").mockResolvedValue(
      success(patchResult, '"correction:3|draft:8"'),
    );
    vi.spyOn(adminApi, "getDayCorrection").mockResolvedValue(
      success(
        workingCopyWithEditableCopy({
          daJiExplanation: "等待主动刷新确认的说明",
          draftRevision: 8,
          formulaTitle: "旧穿搭标题",
        }),
        '"correction:3|draft:8"',
      ),
    );
    vi.spyOn(adminApi, "applyDayCorrection").mockImplementation(async () => {
      mockAuthoritativePreview.daJiExplanation = "主动刷新返回的权威说明";
      return success(applyResult, '"correction:4|draft:8"');
    });

    render(
      <AdminSessionProvider>
        <AdminOperationsDay fortuneDate="2026-08-06" />
      </AdminSessionProvider>,
    );
    const editor = await screen.findByRole("textbox", { name: "大吉颜色说明" });
    const callsBeforeApply = getDay.mock.calls.length;
    expect(callsBeforeApply).toBeGreaterThanOrEqual(1);
    fireEvent.change(editor, { target: { value: "等待主动刷新确认的说明" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并立即替换" }));

    await waitFor(() => expect(getDay).toHaveBeenCalledTimes(callsBeforeApply + 1));
    await waitFor(() => expect(editor).toBeEnabled());
    expect(editor).toHaveValue("主动刷新返回的权威说明");
  });

  it("saves every dirty field in sequence with the latest ETag before one apply", async () => {
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    const patch = vi
      .spyOn(adminApi, "patchDayCorrection")
      .mockResolvedValueOnce(success(patchResult, '"correction:3|draft:8"'))
      .mockResolvedValueOnce(
        success({ ...patchResult, draftRevision: 9 }, '"correction:3|draft:9"'),
      );
    vi.spyOn(adminApi, "getDayCorrection")
      .mockResolvedValueOnce(
        success({ ...workingCopy, draftRevision: 8 }, '"correction:3|draft:8"'),
      )
      .mockResolvedValueOnce(
        success({ ...workingCopy, draftRevision: 9 }, '"correction:3|draft:9"'),
      );
    const apply = vi
      .spyOn(adminApi, "applyDayCorrection")
      .mockResolvedValue(success(applyResult, '"correction:4|draft:9"'));

    render(<AdminDayDetailView detail={detail()} session={session} />);
    fireEvent.change(screen.getByRole("textbox", { name: "大吉颜色说明" }), {
      target: { value: "批量保存的大吉说明" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "“旧穿搭标题”标题" }), {
      target: { value: "批量保存的穿搭标题" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并立即替换" }));

    expect(await screen.findByText("新版本已立即替换，用户端会读取这次修改。")).toBeInTheDocument();
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ etag: '"correction:3|draft:7"' }),
    );
    expect(patch.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ etag: '"correction:3|draft:8"' }),
    );
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ etag: '"correction:3|draft:9"' }));
  });

  it("locks every copy editor while sequential PATCHes and apply are in flight", async () => {
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    const firstPatch = deferred<AdminApiResult<DayCorrectionPatchResult>>();
    const patch = vi
      .spyOn(adminApi, "patchDayCorrection")
      .mockImplementationOnce(() => firstPatch.promise)
      .mockResolvedValueOnce(
        success({ ...patchResult, draftRevision: 9 }, '"correction:3|draft:9"'),
      );
    vi.spyOn(adminApi, "getDayCorrection")
      .mockResolvedValueOnce(
        success(
          workingCopyWithEditableCopy({
            daJiExplanation: "锁定保存的大吉说明",
            draftRevision: 8,
            formulaTitle: "旧穿搭标题",
          }),
          '"correction:3|draft:8"',
        ),
      )
      .mockResolvedValueOnce(
        success(
          workingCopyWithEditableCopy({
            daJiExplanation: "锁定保存的大吉说明",
            draftRevision: 9,
            formulaTitle: "锁定保存的穿搭标题",
          }),
          '"correction:3|draft:9"',
        ),
      );
    const apply = vi
      .spyOn(adminApi, "applyDayCorrection")
      .mockResolvedValue(success(applyResult, '"correction:4|draft:9"'));

    render(<AdminDayDetailView detail={detail()} session={session} />);
    const tierEditor = screen.getByRole("textbox", { name: "大吉颜色说明" });
    const outfitEditor = screen.getByRole("textbox", { name: "“旧穿搭标题”标题" });
    fireEvent.change(tierEditor, { target: { value: "锁定保存的大吉说明" } });
    fireEvent.change(outfitEditor, { target: { value: "锁定保存的穿搭标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并立即替换" }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(tierEditor).toBeDisabled();
    expect(outfitEditor).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在安全保存…" })).toBeDisabled();
    expect(screen.getAllByText("正在安全保存，暂时不能继续编辑").length).toBeGreaterThan(0);
    expect(apply).not.toHaveBeenCalled();

    firstPatch.resolve(success(patchResult, '"correction:3|draft:8"'));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(screen.getByText("新版本已立即替换，用户端会读取这次修改。")).toBeInTheDocument();
  });

  it("keeps multiple unsaved inputs while the responsive preview opens, switches targets, and closes", () => {
    const { container } = render(<AdminDayDetailView detail={detail()} session={session} />);
    const tierEditor = screen.getByRole("textbox", { name: "大吉颜色说明" });
    const outfitEditor = screen.getByRole("textbox", { name: "“旧穿搭标题”标题" });
    fireEvent.change(tierEditor, { target: { value: "还没保存的大吉说明" } });
    fireEvent.change(outfitEditor, { target: { value: "还没保存的穿搭标题" } });

    const preview = screen.getByLabelText("用户端结果预览");
    const backdrop = screen.getByRole("button", { name: "关闭用户端预览" });
    expect(preview).toHaveClass("admin-preview-stage");
    expect(preview).toHaveAttribute("data-open", "false");
    expect(backdrop).toHaveClass("admin-preview-backdrop");
    fireEvent.click(screen.getByRole("button", { name: "打开用户端预览" }));
    expect(preview).toHaveAttribute("data-open", "true");
    expect(backdrop).toHaveAttribute("data-open", "true");
    fireEvent.click(screen.getByRole("button", { name: "还没保存的大吉说明" }));
    expect(preview).toHaveAttribute("data-open", "false");

    fireEvent.click(screen.getByRole("button", { name: "打开用户端预览" }));
    fireEvent.click(screen.getByRole("button", { name: "还没保存的穿搭标题" }));
    expect(tierEditor).toHaveValue("还没保存的大吉说明");
    expect(outfitEditor).toHaveValue("还没保存的穿搭标题");
    expect(container.querySelector(".admin-preview-stage")).toBe(preview);
  });

  it("updates the real preview for multiple text fields before saving without opening a correction", () => {
    const open = vi.spyOn(adminApi, "openDayCorrection");
    const patch = vi.spyOn(adminApi, "patchDayCorrection");

    render(<AdminDayDetailView detail={detail()} session={session} />);
    fireEvent.change(screen.getByRole("textbox", { name: "大吉颜色说明" }), {
      target: { value: "尚未保存的大吉组合" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "“旧穿搭标题”标题" }), {
      target: { value: "尚未保存的穿搭组合" },
    });

    expect(screen.getByRole("button", { name: "尚未保存的大吉组合" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "尚未保存的穿搭组合" })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("hydrates a reused correction, preserves local dirty copy, and requires another confirmation before apply", async () => {
    const reused = workingCopyWithEditableCopy({
      daJiExplanation: "服务端此前保存的大吉说明",
      formulaTitle: "服务端此前保存的穿搭标题",
    });
    const afterLocalSave = workingCopyWithEditableCopy({
      daJiExplanation: "本地尚未保存的大吉说明",
      draftRevision: 8,
      formulaTitle: "服务端此前保存的穿搭标题",
    });
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(reused, '"correction:3|draft:7"'),
    );
    const patch = vi
      .spyOn(adminApi, "patchDayCorrection")
      .mockResolvedValue(success(patchResult, '"correction:3|draft:8"'));
    vi.spyOn(adminApi, "getDayCorrection").mockResolvedValue(
      success(afterLocalSave, '"correction:3|draft:8"'),
    );
    const apply = vi
      .spyOn(adminApi, "applyDayCorrection")
      .mockResolvedValue(success(applyResult, '"correction:4|draft:8"'));

    render(<AdminDayDetailView detail={detail()} session={session} />);
    const localEditor = screen.getByRole("textbox", { name: "大吉颜色说明" });
    fireEvent.change(localEditor, { target: { value: "本地尚未保存的大吉说明" } });
    const primary = screen.getByRole("button", { name: "保存并立即替换" });
    fireEvent.click(primary);

    expect(await screen.findByText(/发现此前已保存的订正/u)).toBeInTheDocument();
    expect(localEditor).toHaveValue("本地尚未保存的大吉说明");
    expect(screen.getByRole("textbox", { name: "“服务端此前保存的穿搭标题”标题" })).toHaveValue(
      "服务端此前保存的穿搭标题",
    );
    expect(screen.getByRole("button", { name: "本地尚未保存的大吉说明" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "服务端此前保存的穿搭标题" })).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();

    fireEvent.click(primary);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.objectContaining({ explanation: "本地尚未保存的大吉说明" }),
      }),
    );
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });

  it("treats a failed optional image as non-blocking when required images are complete", async () => {
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    vi.spyOn(adminApi, "patchDayCorrection").mockResolvedValue(
      success(patchResult, '"correction:3|draft:8"'),
    );
    vi.spyOn(adminApi, "getDayCorrection").mockResolvedValue(
      success({ ...workingCopy, draftRevision: 8 }, '"correction:3|draft:8"'),
    );
    const apply = vi
      .spyOn(adminApi, "applyDayCorrection")
      .mockResolvedValue(success(applyResult, '"correction:4|draft:8"'));
    const withOptionalFailure = detail();
    withOptionalFailure.summary.optionalImageStatus = "failed";

    render(<AdminDayDetailView detail={withOptionalFailure} session={session} />);
    expect(screen.getAllByText("生成未完成 · 不影响发布").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole("textbox", { name: "大吉颜色说明" }), {
      target: { value: "只改必备内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并立即替换" }));

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(screen.getByText("新版本已立即替换，用户端会读取这次修改。")).toBeInTheDocument();
  });

  it("hydrates concurrent server copy after 412 while keeping the user's dirty field for a safe retry", async () => {
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    const concurrent = workingCopyWithEditableCopy({
      daJiExplanation: "服务端并发的大吉说明",
      draftRevision: 9,
      formulaTitle: "服务端并发的穿搭标题",
    });
    const afterRetry = workingCopyWithEditableCopy({
      daJiExplanation: "保留的输入",
      draftRevision: 10,
      formulaTitle: "服务端并发的穿搭标题",
    });
    vi.spyOn(adminApi, "getDayCorrection")
      .mockResolvedValueOnce(
        success({ ...concurrent, correctionRevision: 4 }, '"correction:4|draft:9"'),
      )
      .mockResolvedValueOnce(
        success({ ...afterRetry, correctionRevision: 4 }, '"correction:4|draft:10"'),
      );
    const patch = vi
      .spyOn(adminApi, "patchDayCorrection")
      .mockResolvedValueOnce({
        error: {
          etag: '"correction:4|draft:9"',
          kind: "api-error",
          requestId: "request-correction-0002",
          retryAfterSeconds: null,
          status: 412,
        },
        ok: false,
      })
      .mockResolvedValueOnce(
        success({ ...patchResult, draftRevision: 10 }, '"correction:4|draft:10"'),
      );
    vi.spyOn(adminApi, "applyDayCorrection").mockResolvedValue(
      success({ ...applyResult, mode: "scheduled" }, '"correction:5|draft:10"'),
    );

    render(<AdminDayDetailView detail={detail("future")} session={session} />);
    const editor = screen.getByRole("textbox", { name: "大吉颜色说明" });
    fireEvent.change(editor, { target: { value: "保留的输入" } });
    const primary = screen.getByRole("button", { name: "保存并在 8月5日 18:00 生效" });
    fireEvent.click(primary);

    expect(await screen.findByText(/已读取最新修订/u)).toBeInTheDocument();
    expect(editor).toHaveValue("保留的输入");
    expect(screen.getByRole("textbox", { name: "“服务端并发的穿搭标题”标题" })).toHaveValue(
      "服务端并发的穿搭标题",
    );
    expect(screen.getByRole("button", { name: "保留的输入" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "服务端并发的穿搭标题" })).toBeInTheDocument();
    expect(adminApi.applyDayCorrection).not.toHaveBeenCalled();
    fireEvent.click(primary);

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls[1]?.[0].etag).toBe('"correction:4|draft:9"');
    expect(await screen.findByText(/新版本已安排/u)).toBeInTheDocument();
  });

  it("keeps every preview object inert for a past date", () => {
    const open = vi.spyOn(adminApi, "openDayCorrection");

    render(<AdminDayDetailView detail={detail("past")} session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "旧大吉说明" }));

    expect(screen.getAllByText("过去日期只读").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/历史公开内容不会在这里被改写；当前页面只用于核对。 · 必备图片 2\/2/u),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "大吉颜色说明" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /保存并/u })).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps algorithm fields readonly and explains 409 without opening another control", async () => {
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    vi.spyOn(adminApi, "patchDayCorrection").mockResolvedValue({
      error: {
        kind: "api-error",
        requestId: "request-correction-0003",
        retryAfterSeconds: null,
        status: 409,
      },
      ok: false,
    });

    render(<AdminDayDetailView detail={detail()} session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "大吉算法" }));
    expect(
      screen.getByText("这档算法结果是算法生成结果，当前页面只读；如有错误请进入规则修正流程。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /算法/u })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "大吉颜色说明" }), {
      target: { value: "用户输入仍保留" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并立即替换" }));
    expect(await screen.findByText(/内容状态已经变化/u)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "大吉颜色说明" })).toHaveValue("用户输入仍保留");
  });

  it("shows regenerated candidates before an explicit asset selection and keeps apply blocked without 2/2 visual data", async () => {
    const incompleteWorkingCopy: DayCorrectionWorkingCopy = {
      ...workingCopy,
      modules: { ...workingCopy.modules, visual_and_rights: null },
    };
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(incompleteWorkingCopy, '"correction:3|draft:7"'),
    );
    const patch = vi.spyOn(adminApi, "patchDayCorrection");
    const candidateAsset: AdminImageAsset = {
      aiLabelStatus: "pending",
      altText: "重新生成的黑色通勤模特穿搭",
      assetId: "asset-regenerated",
      declaredModel: "gpt-image-2",
      fileUrl: null,
      generatedAt: "2026-08-06T17:05:00+08:00",
      generationMethod: "codex",
      height: 1536,
      manualReview: null,
      mediaType: "image/png",
      promptVersion: "five-look-v1",
      reproductionReference: "job-regenerated",
      reviewStatus: "pending",
      rightsRecordIds: [],
      rightsStatus: "pending",
      sha256: "a".repeat(64),
      sourceMaterialReferences: ["prompt:five-look-v1"],
      sourceType: "ai_generated",
      width: 1024,
    };
    const correction = { etag: '"correction:3|draft:8"', workingCopy: incompleteWorkingCopy };
    const regenerate = vi.fn(async () => ({
      choices: [
        {
          asset: candidateAsset,
          imageSlot: "required_primary" as const,
          previewUrl: "/admin/api/v1/image-assets/asset-regenerated/preview",
          selectedForSlot: false,
        },
      ],
      correction,
    }));
    const selectCandidate = vi.fn(async () => ({
      correction,
      selectedImage: {
        asset: candidateAsset,
        imageSlot: "required_primary" as const,
        previewUrl: "/admin/api/v1/image-assets/asset-regenerated/preview",
        selectedForSlot: true,
      },
    }));
    const imageAdapter: AdminDayImageAdapter = {
      listExisting: async () => ({ choices: [], correction }),
      listLibrary: async () => [],
      regenerate,
      selectCandidate,
      selectLibrary: async () => {
        throw new Error("not used");
      },
      upload: async () => {
        throw new Error("not used");
      },
      withdrawPublished: async () => ({ previewImage: null }),
    };

    render(<AdminDayDetailView detail={detail()} imageAdapter={imageAdapter} session={session} />);
    const primaryImage = within(screen.getByRole("article", { name: "主方案" }));
    fireEvent.click(primaryImage.getByRole("button", { name: "重新生成" }));

    expect(await screen.findByAltText("重新生成的黑色通勤模特穿搭")).toBeInTheDocument();
    expect(selectCandidate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "使用这张候选图" }));

    await waitFor(() =>
      expect(selectCandidate).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: "asset-regenerated" }),
      ),
    );
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "先补齐必备图" })).toBeDisabled();
  });

  it("clears image picker state and focuses the matching card when preview switches image slots", async () => {
    const candidateAsset = reviewedAsset("asset-new-primary", 3);
    const correction = { etag: '"correction:3|draft:7"', workingCopy };
    const imageAdapter: AdminDayImageAdapter = {
      listExisting: async ({ imageSlot }) => ({
        choices:
          imageSlot === "required_primary"
            ? [
                {
                  asset: candidateAsset,
                  imageSlot,
                  previewUrl: "/admin/api/v1/image-assets/asset-new-primary/preview",
                  selectedForSlot: false,
                },
              ]
            : [],
        correction,
      }),
      listLibrary: async () => [],
      regenerate: async ({ imageSlot }) => ({
        choices: [
          {
            asset: candidateAsset,
            imageSlot,
            previewUrl: "/admin/api/v1/image-assets/asset-new-primary/preview",
            selectedForSlot: false,
          },
        ],
        correction,
      }),
      selectCandidate: async () => {
        throw new Error("not used");
      },
      selectLibrary: async () => {
        throw new Error("not used");
      },
      upload: async () => {
        throw new Error("not used");
      },
      withdrawPublished: async () => ({ previewImage: null }),
    };
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    render(<AdminDayDetailView detail={detail()} imageAdapter={imageAdapter} session={session} />);
    const primaryCard = within(screen.getByRole("article", { name: "主方案" }));
    fireEvent.click(primaryCard.getByRole("button", { name: "重新生成" }));
    expect(await screen.findByAltText("asset-new-primary 模特穿搭")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "选择预览图片 alternate" }));

    expect(screen.queryByAltText("asset-new-primary 模特穿搭")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("article", { name: "备选方案" }));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("ignores a cancelled candidate load before it can roll back a newer correction ETag", async () => {
    const oldCorrection = { etag: '"correction:3|draft:7"', workingCopy };
    const newerWorkingCopy = {
      ...workingCopy,
      draftRevision: 9,
      updatedAt: "2026-08-06T17:09:00+08:00",
    };
    const newerCorrection = {
      etag: '"correction:3|draft:9"',
      workingCopy: newerWorkingCopy,
    };
    const pendingCandidates = deferred<{
      choices: [];
      correction: typeof oldCorrection;
    }>();
    const listExisting = vi
      .fn<AdminDayImageAdapter["listExisting"]>()
      .mockImplementationOnce(() => pendingCandidates.promise)
      .mockResolvedValue({ choices: [], correction: oldCorrection });
    const uploadedAlternative = reviewedAsset("asset-uploaded-alternative", 5);
    const upload = vi.fn<AdminDayImageAdapter["upload"]>(async () => ({
      correction: newerCorrection,
      selectedImage: {
        asset: uploadedAlternative,
        imageSlot: "required_alternative",
        previewUrl: "/admin/api/v1/image-assets/asset-uploaded-alternative/preview",
        selectedForSlot: true,
      },
    }));
    const imageAdapter: AdminDayImageAdapter = {
      listExisting,
      listLibrary: async () => [],
      regenerate: async () => ({ choices: [], correction: oldCorrection }),
      selectCandidate: async () => {
        throw new Error("not used");
      },
      selectLibrary: async () => {
        throw new Error("not used");
      },
      upload,
      withdrawPublished: async () => ({ previewImage: null }),
    };
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(workingCopy, '"correction:3|draft:7"'),
    );
    const savedCopy = workingCopyWithEditableCopy({
      daJiExplanation: "图片竞态后的安全文案",
      draftRevision: 10,
      formulaTitle: "旧穿搭标题",
    });
    vi.spyOn(adminApi, "getDayCorrection").mockResolvedValue(
      success(savedCopy, '"correction:3|draft:10"'),
    );
    const patch = vi
      .spyOn(adminApi, "patchDayCorrection")
      .mockResolvedValue(success({ ...patchResult, draftRevision: 10 }, '"correction:3|draft:10"'));
    vi.spyOn(adminApi, "applyDayCorrection").mockResolvedValue(
      success(applyResult, '"correction:4|draft:10"'),
    );
    const editableDetail = detail();
    editableDetail.editableSelectionKeys.push("image.required_alternative");

    render(
      <AdminDayDetailView detail={editableDetail} imageAdapter={imageAdapter} session={session} />,
    );
    fireEvent.click(
      within(screen.getByRole("article", { name: "主方案" })).getByRole("button", {
        name: "选择已有候选",
      }),
    );
    await waitFor(() => expect(listExisting).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "选择预览图片 alternate" }));
    fireEvent.click(
      within(screen.getByRole("article", { name: "备选方案" })).getByRole("button", {
        name: "手动上传",
      }),
    );
    fireEvent.change(screen.getByLabelText("选择图片"), {
      target: { files: [new File(["image"], "alternative.webp", { type: "image/webp" })] },
    });
    fireEvent.change(screen.getByLabelText("替换原因"), {
      target: { value: "替换为已确认的备选图" },
    });
    fireEvent.click(screen.getByRole("button", { name: "上传并使用" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("图片修改已保存，等待统一生效。")).toBeInTheDocument();

    await act(async () => {
      pendingCandidates.resolve({ choices: [], correction: oldCorrection });
      await pendingCandidates.promise;
    });
    await waitFor(() => expect(listExisting).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("textbox", { name: "大吉颜色说明" }), {
      target: { value: "图片竞态后的安全文案" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并立即替换" }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(expect.objectContaining({ etag: '"correction:3|draft:9"' }));
  });

  it("removes a baseline image missing from the authoritative correction without dropping unselected candidates", async () => {
    const unselectedAlternative = reviewedAsset("asset-unselected-alternative", 4);
    const missingAlternative: DayCorrectionWorkingCopy = {
      ...workingCopy,
      modules: {
        ...workingCopy.modules,
        visual_and_rights: {
          ...completeVisual,
          looks: completeVisual.looks.filter((look) => look.imageSlot !== "required_alternative"),
        },
      },
    };
    const correction = {
      etag: '"correction:3|draft:7"',
      workingCopy: missingAlternative,
    };
    const imageAdapter: AdminDayImageAdapter = {
      listExisting: async ({ imageSlot }) => ({
        choices:
          imageSlot === "required_alternative"
            ? [
                {
                  asset: unselectedAlternative,
                  imageSlot,
                  previewUrl: "/admin/api/v1/image-assets/asset-unselected-alternative/preview",
                  selectedForSlot: false,
                },
              ]
            : [],
        correction,
      }),
      listLibrary: async () => [],
      regenerate: async () => ({ choices: [], correction }),
      selectCandidate: async () => {
        throw new Error("not used");
      },
      selectLibrary: async () => {
        throw new Error("not used");
      },
      upload: async () => {
        throw new Error("not used");
      },
      withdrawPublished: async () => ({ previewImage: null }),
    };
    vi.spyOn(adminApi, "openDayCorrection").mockResolvedValue(
      success(missingAlternative, '"correction:3|draft:7"'),
    );

    const editableDetail = detail();
    editableDetail.editableSelectionKeys.push("image.required_alternative");
    render(
      <AdminDayDetailView detail={editableDetail} imageAdapter={imageAdapter} session={session} />,
    );
    fireEvent.click(
      within(screen.getByRole("article", { name: "主方案" })).getByRole("button", {
        name: "选择已有候选",
      }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "选择预览图片 alternate" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("article", { name: "备选方案" })).getByText("当前未显示图片"),
    ).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole("article", { name: "备选方案" })).getByRole("button", {
        name: "选择已有候选",
      }),
    );
    expect(await screen.findByAltText("asset-unselected-alternative 模特穿搭")).toBeInTheDocument();
  });

  it("shows true required delivery validation and blocks misleading apply copy when required images are missing", () => {
    const open = vi.spyOn(adminApi, "openDayCorrection");
    const patch = vi.spyOn(adminApi, "patchDayCorrection");
    const missingRequired = detail();
    missingRequired.summary.requiredImages = {
      deliverySafeCount: 1,
      modelReadyCount: 1,
      requiredCount: 2,
    };

    render(<AdminDayDetailView detail={missingRequired} session={session} />);

    expect(
      within(screen.getByRole("article", { name: "主方案" })).getByText("必备 · 主图"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("article", { name: "备选方案" })).getByText("必备 · 备选图"),
    ).toBeInTheDocument();
    expect(screen.getByText(/必备图片 1\/2/u)).toBeInTheDocument();
    expect(screen.getByText(/先补齐主图和备选图/u)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "大吉颜色说明" }), {
      target: { value: "缺图时仍在本地的文案" },
    });
    expect(screen.getByRole("button", { name: "先补齐必备图" })).toBeDisabled();
    expect(open).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("does not expose single-image withdrawal for a future day without an active version", () => {
    render(<AdminDayDetailView detail={detail("future")} session={session} />);

    expect(screen.queryByRole("button", { name: "单图下线" })).not.toBeInTheDocument();
  });

  it("does not open editing or invent blank text fields while preview is missing", async () => {
    const open = vi
      .spyOn(adminApi, "openDayCorrection")
      .mockResolvedValue(success(workingCopy, '"correction:3|draft:7"'));
    const correction = { etag: '"correction:3|draft:7"', workingCopy };
    const imageAdapter: AdminDayImageAdapter = {
      listExisting: async () => ({ choices: [], correction }),
      listLibrary: async () => [],
      regenerate: async () => ({ choices: [], correction }),
      selectCandidate: async () => {
        throw new Error("not used");
      },
      selectLibrary: async () => {
        throw new Error("not used");
      },
      upload: async () => {
        throw new Error("not used");
      },
      withdrawPublished: async () => ({ previewImage: null }),
    };
    const withoutPreview = detail("future");
    withoutPreview.preview = null;
    withoutPreview.previewSource = "draft";
    withoutPreview.summary.previewAvailable = false;
    withoutPreview.summary.requiredImages = {
      deliverySafeCount: 0,
      modelReadyCount: 0,
      requiredCount: 2,
    };

    render(
      <AdminDayDetailView detail={withoutPreview} imageAdapter={imageAdapter} session={session} />,
    );

    const realSummary = within(screen.getByRole("region", { name: "当日真实摘要" }));
    expect(realSummary.getByText("2026-08-06")).toBeInTheDocument();
    expect(realSummary.getByRole("heading", { name: "当日金日" })).toBeInTheDocument();
    expect(realSummary.getByText("主要颜色：乳白")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /颜色说明|穿搭/u })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "先补齐必备图" })).toBeDisabled();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /主模特图待补充/u }));
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(
      within(screen.getByRole("article", { name: "主方案" })).getByRole("button", {
        name: "选择已有候选",
      }),
    );
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("textbox", { name: /颜色说明|穿搭/u })).not.toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
