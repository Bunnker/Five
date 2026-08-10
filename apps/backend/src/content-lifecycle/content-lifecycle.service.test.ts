import { describe, expect, it } from "vitest";
import { isAdminDailyImageSet } from "@five/api-contract/runtime";

import { ContentLifecycleService } from "./content-lifecycle.service";
import { evaluateContentPreflight } from "./content-preflight";
import type {
  ContentLifecycleTransaction,
  DraftModules,
  StoredMasterReviewEvidence,
} from "./content-lifecycle.store";
import { InMemoryContentLifecycleStore } from "./in-memory-content-lifecycle.store";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";

function completeModules(): DraftModules {
  const scenario = { code: "daily", label: "日常" };
  const audience = { code: "all", label: "通用" };
  const tiers: NonNullable<DraftModules["calendar_algorithm"]>["tiers"] = [
    {
      algorithmLabel: "大吉",
      colors: [
        { colorCode: "black", name: "黑色" },
        { colorCode: "navy", name: "藏青" },
        { colorCode: "royal_blue", name: "宝蓝" },
        { colorCode: "dark_green", name: "墨绿" },
        { colorCode: "dark_gray_family", name: "深灰系" },
      ],
      displayLabel: "今日优先",
      displaySection: "primary",
      element: "water",
      elementLabel: "水",
      explanation: "优先黑色",
      rank: 1,
      relationText: "金生水",
      tierCode: "da_ji",
    },
    {
      algorithmLabel: "次吉",
      colors: [
        { colorCode: "white", name: "白色" },
        { colorCode: "ivory", name: "乳白" },
        { colorCode: "silver", name: "银色" },
        { colorCode: "gold", name: "金色" },
        { colorCode: "light_family", name: "浅色系" },
      ],
      displayLabel: "稳妥选择",
      displaySection: "primary",
      element: "metal",
      elementLabel: "金",
      explanation: "稳妥白色",
      rank: 2,
      relationText: "金与金同类",
      tierCode: "ci_ji",
    },
    {
      algorithmLabel: "平",
      colors: [
        { colorCode: "red", name: "红色" },
        { colorCode: "orange", name: "橙色" },
        { colorCode: "purple", name: "紫色" },
        { colorCode: "pink_family", name: "粉色系" },
      ],
      displayLabel: "日常可穿",
      displaySection: "primary",
      element: "fire",
      elementLabel: "火",
      explanation: "日常红色",
      rank: 3,
      relationText: "火克金",
      tierCode: "ping",
    },
    {
      algorithmLabel: "较差",
      colors: [
        { colorCode: "yellow", name: "黄色" },
        { colorCode: "coffee", name: "咖色" },
        { colorCode: "brown", name: "棕色" },
        { colorCode: "khaki", name: "卡其" },
        { colorCode: "dark_brown_family", name: "褐色系" },
      ],
      displayLabel: "注意",
      displaySection: "attention",
      element: "earth",
      elementLabel: "土",
      explanation: "减少黄色",
      rank: 4,
      relationText: "土生金",
      tierCode: "jiao_cha",
    },
    {
      algorithmLabel: "不利",
      colors: [
        { colorCode: "green", name: "绿色" },
        { colorCode: "cyan", name: "青色" },
        { colorCode: "emerald", name: "翠色" },
        { colorCode: "lake_blue", name: "湖蓝" },
        { colorCode: "light_green_family", name: "浅绿系" },
      ],
      displayLabel: "注意",
      displaySection: "attention",
      element: "wood",
      elementLabel: "木",
      explanation: "减少绿色",
      rank: 5,
      relationText: "金克木",
      tierCode: "bu_li",
    },
  ];
  type OutfitFormula = NonNullable<DraftModules["copy_and_formula"]>["outfitFormulas"][number];
  const formulaSlots: OutfitFormula["slots"][] = [
    [
      {
        colorCodes: ["black"],
        garmentParts: ["上衣"],
        ratioPercent: 100,
        role: "primary",
        roleLabel: "主色",
        tierCode: "da_ji",
      },
    ],
    [
      {
        colorCodes: ["black"],
        garmentParts: ["上衣"],
        ratioPercent: 70,
        role: "primary",
        roleLabel: "主色",
        tierCode: "da_ji",
      },
      {
        colorCodes: ["white"],
        garmentParts: ["下装"],
        ratioPercent: 30,
        role: "secondary",
        roleLabel: "辅助色",
        tierCode: "ci_ji",
      },
    ],
    [
      {
        colorCodes: ["black"],
        garmentParts: ["上衣"],
        ratioPercent: 60,
        role: "primary",
        roleLabel: "主色",
        tierCode: "da_ji",
      },
      {
        colorCodes: ["white"],
        garmentParts: ["下装"],
        ratioPercent: 30,
        role: "secondary",
        roleLabel: "辅助色",
        tierCode: "ci_ji",
      },
      {
        colorCodes: ["red"],
        garmentParts: ["配饰"],
        ratioPercent: 10,
        role: "accent",
        roleLabel: "点缀色",
        tierCode: "ping",
      },
    ],
  ];
  const formulas: NonNullable<DraftModules["copy_and_formula"]>["outfitFormulas"] = [
    "one",
    "two",
    "three",
  ].map((suffix, index) => ({
    audience,
    disclaimer: "传统文化配色仅供穿搭参考。",
    formulaId: `formula-${suffix}`,
    kind: index === 0 ? "mono" : index === 1 ? "dual" : "triple",
    lookIds: index < 2 ? [`look-${index + 1}`] : [],
    scenario,
    slots: formulaSlots[index]!,
    title: `公式 ${suffix}`,
  }));
  const assets: NonNullable<DraftModules["visual_and_rights"]>["assets"] = [1, 2, 3, 4].map(
    (number) => ({
      aiLabelStatus: "not_applicable",
      altText: number <= 2 ? `搭配图 ${number}` : `降级图 ${number - 2}`,
      assetId: `asset-${number}`,
      declaredModel: null,
      fileUrl: `https://cdn.example.com/content/asset-${number}.webp`,
      ...(number <= 2
        ? { generationMethod: "licensed_upload" as const, sourceType: "licensed" as const }
        : {
            generationMethod: "fallback_template" as const,
            sourceType: "fallback_template" as const,
          }),
      generatedAt: null,
      height: 1200,
      manualReview: {
        aiLabelCompliance: "passed",
        colorAndCopyConsistency: "passed",
        garmentAndPersonIntegrity: "passed",
        mobileAndWechatPreview: "passed",
        notes: "六项检查通过。",
        reviewId: `image-review-${number}`,
        reviewedAt: "2026-07-31T23:00:00+08:00",
        reviewerAccountId: "operator-1",
        rightsAndIdentityRisk: "passed",
        scenarioAndImitability: "passed",
      },
      mediaType: "image/webp",
      promptVersion: null,
      reproductionReference: null,
      reviewStatus: "approved",
      rightsRecordIds: [`rights-${number}`],
      rightsStatus: "cleared",
      sha256: String(number).repeat(64),
      sourceMaterialReferences: [`source-record-${number}`],
      width: 900,
    }),
  );
  return {
    calendar_algorithm: {
      algorithmVersion: "gbt-33661-2017-anchor-1949-10-01-jiazi",
      calendar: {
        branch: "申",
        dayElement: "metal",
        dayElementLabel: "金",
        ganzhiDay: "戊申",
        lunarDateText: "六月十九",
        weekdayText: "星期六",
      },
      calendarDataVersion: "calendar-golden-fortune-date-23h-v1",
      calendarRuleVersion: "fortune-date-23h-v1",
      tiers,
    },
    copy_and_formula: {
      balanceSuggestion: {
        accessoryExamples: ["包", "鞋"],
        description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
        preferredTierCode: "da_ji",
        title: "已经穿了注意色",
      },
      basis: {
        disclaimer: "传统文化配色仅供穿搭参考。",
        steps: ["确认命理日", "按关系排序"],
      },
      copyVersion: "copy-v1",
      outfitFormulas: formulas,
      outfitVersion: "outfit-v1",
      share: {
        copyText: "今日穿搭参考",
        posterJobEndpoint: "/api/v1/poster-jobs",
        posterTemplateVersion: "poster-v1",
        summaryText: "今日优先黑色",
      },
    },
    poster_consistency: {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "asset-1",
      templateId: "template-v1",
    },
    visual_and_rights: {
      assetManifestVersion: "assets-v1",
      assets,
      looks: [1, 2].map((number) => ({
        alternatives: [],
        audience,
        coverAssetId: `asset-${number}`,
        detailAssetIds: [],
        fallbackAssetId: `asset-${number + 2}`,
        formulaId: number === 1 ? "formula-one" : "formula-two",
        imageSlot: number === 1 ? ("required_primary" as const) : ("required_alternative" as const),
        items:
          number === 1
            ? [
                {
                  category: "top" as const,
                  categoryLabel: "上衣",
                  colorCode: "black",
                  description: "黑色上衣",
                },
              ]
            : [
                {
                  category: "top" as const,
                  categoryLabel: "上衣",
                  colorCode: "black",
                  description: "黑色上衣",
                },
                {
                  category: "bottom" as const,
                  categoryLabel: "下装",
                  colorCode: "white",
                  description: "白色下装",
                },
              ],
        lookId: `look-${number}`,
        requiredForPublish: true,
        scenario,
        sortOrder: number,
        title: `搭配 ${number}`,
      })),
      rightsRecords: [1, 2, 3, 4].map((number) => ({
        kind: "license",
        recordedAt: "2026-07-31T23:00:00+08:00",
        reference: `license-record-${number}`,
        rightsRecordId: `rights-${number}`,
      })),
    },
  };
}

function deterministicService(
  store = new InMemoryContentLifecycleStore(),
): ContentLifecycleService {
  let draftNumber = 0;
  let contentNumber = 0;
  let evidenceNumber = 0;
  let auditNumber = 0;
  return new ContentLifecycleService(
    store,
    { now: () => new Date("2026-07-31T15:00:00.000Z") },
    {
      nextAuditEventId: () => `audit-${++auditNumber}`,
      nextContentVersion: () => `content-opaque-${++contentNumber}`,
      nextDraftId: () => `draft-${++draftNumber}`,
      nextEvidenceId: () => `evidence-${++evidenceNumber}`,
    },
  );
}

function seedTrustedImageCandidates(
  store: InMemoryContentLifecycleStore,
  draftId: string,
  fortuneDate: string,
  visual: NonNullable<DraftModules["visual_and_rights"]>,
): void {
  const slotByCoverAssetId = new Map(
    visual.looks.map(({ coverAssetId, imageSlot }) => [coverAssetId, imageSlot]),
  );
  store.seedDraftImageAssetsForTest(
    visual.assets.map((asset) => ({
      asset,
      draftId,
      fortuneDate,
      imageSlot: slotByCoverAssetId.get(asset.assetId) ?? null,
      reviewLocked: false,
      selectionSource: slotByCoverAssetId.has(asset.assetId) ? "manual_selection" : null,
      selectedForSlot: slotByCoverAssetId.has(asset.assetId),
      storageKey: `${asset.sha256.slice(0, 2)}/${asset.sha256}.webp`,
      uploadedAt: "2026-07-31T15:00:00.000Z",
    })),
  );
}

function frozenImageSet(
  snapshot: DraftModules,
  contentVersion = "content-image-safety",
): StoredDailyImageSet {
  const visual = snapshot.visual_and_rights;
  if (visual === null) throw new Error("fixture missing visual module");
  return {
    assets: structuredClone(visual.assets),
    contentVersion,
    fortuneDate: "2026-08-02",
    lifecycleRevision: 1,
    slots: visual.looks.map((look) => {
      if (look.imageSlot === "optional") {
        return {
          coverAssetId: look.coverAssetId,
          deliveryStatus: "active" as const,
          detailAssetIds: structuredClone(look.detailAssetIds),
          fallbackAssetId: look.fallbackAssetId,
          imageSlot: "optional" as const,
          lookId: look.lookId,
          servedCoverAssetId: look.coverAssetId,
          servedDetailAssetIds: structuredClone(look.detailAssetIds),
        };
      }
      if (look.fallbackAssetId === null) throw new Error("required fixture fallback missing");
      return {
        coverAssetId: look.coverAssetId,
        deliveryStatus: "active" as const,
        detailAssetIds: structuredClone(look.detailAssetIds),
        fallbackAssetId: look.fallbackAssetId,
        imageSlot: look.imageSlot,
        lookId: look.lookId,
        servedCoverAssetId: look.coverAssetId,
        servedDetailAssetIds: structuredClone(look.detailAssetIds),
      };
    }),
    withdrawalEvents: [],
  };
}

class WithdrawalAtProjectionLockStore extends InMemoryContentLifecycleStore {
  private pendingWithdrawal: {
    readonly assetId: string;
    readonly contentVersion: string;
  } | null = null;

  armWithdrawal(contentVersion: string, assetId: string): void {
    this.pendingWithdrawal = { assetId, contentVersion };
  }

  override transaction<T>(
    work: (transaction: ContentLifecycleTransaction) => Promise<T>,
  ): Promise<T> {
    return super.transaction((transaction) =>
      work({
        ...transaction,
        getOrCreateProjectionForUpdate: async (fortuneDate) => {
          let projection = await transaction.getOrCreateProjectionForUpdate(fortuneDate);
          const withdrawal = this.pendingWithdrawal;
          if (withdrawal !== null) {
            this.pendingWithdrawal = null;
            await transaction.insertImageAssetWithdrawalEvent({
              contentVersion: withdrawal.contentVersion,
              event: {
                assetId: withdrawal.assetId,
                auditEventId: "audit-submit-lock-race",
                reason: "提交等待日期锁时素材已完成全局下线。",
                withdrawalEventId: "withdraw-submit-lock-race",
                withdrawnAt: "2026-08-02T05:00:00.000Z",
              },
            });
            projection = { ...projection, revision: projection.revision + 1 };
            await transaction.updateProjection(projection);
          }
          return projection;
        },
      }),
    );
  }
}

describe("ContentLifecycleService", () => {
  it("creates an editable draft that can be resumed from the server", async () => {
    const service = new ContentLifecycleService(new InMemoryContentLifecycleStore());

    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-01",
      requestId: "request-create-draft-0001",
    });

    expect(created).toMatchObject({
      kind: "created",
      draft: {
        draftRevision: 1,
        fortuneDate: "2026-08-01",
        modules: {
          calendar_algorithm: null,
          copy_and_formula: null,
          poster_consistency: null,
          visual_and_rights: null,
        },
        state: "draft",
      },
    });
    await expect(service.listDrafts("2026-08-01")).resolves.toEqual({
      items: [
        expect.objectContaining({
          draftId: created.kind === "created" ? created.draft.draftId : "missing",
          draftRevision: 1,
          fortuneDate: "2026-08-01",
        }),
      ],
    });
  });

  it("updates only the requested draft module with optimistic concurrency", async () => {
    const service = new ContentLifecycleService(new InMemoryContentLifecycleStore());
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-01",
      requestId: "request-create-draft-0002",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const module = {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: "asset-sample",
      templateId: "template-1",
    };

    await expect(
      service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        module,
        moduleCode: "poster_consistency",
        requestId: "request-update-draft-0001",
      }),
    ).resolves.toEqual({
      kind: "updated",
      result: {
        draftId: created.draft.draftId,
        draftRevision: 2,
        module,
        moduleCode: "poster_consistency",
      },
    });
    await expect(
      service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        module,
        moduleCode: "poster_consistency",
        requestId: "request-update-draft-0002",
      }),
    ).resolves.toEqual({ kind: "revision_mismatch", currentRevision: 2 });
  });

  it("freezes one opaque version and returns it for idempotent submit retries", async () => {
    const service = deterministicService();
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-01",
      requestId: "request-create-draft-0003",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const idempotencyKey = "submit-idempotency-0001";
    const input = {
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey,
      requestId: "request-submit-draft-0001",
    };

    const submitted = await service.submitDraft(input);
    expect(submitted).toEqual({
      kind: "submitted",
      result: {
        contentVersion: "content-opaque-1",
        draftId: created.draft.draftId,
        lifecycleRevision: 1,
        state: "in_review",
      },
    });
    expect(
      submitted.kind === "submitted" ? submitted.result.contentVersion : "2026-08-01",
    ).not.toContain("2026-08-01");
    await expect(service.submitDraft(input)).resolves.toEqual({
      kind: "existing",
      result: submitted.kind === "submitted" ? submitted.result : null,
    });
    await expect(
      service.submitDraft({
        ...input,
        expectedDraftRevision: 2,
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    await expect(
      service.submitDraft({
        ...input,
        idempotencyKey: "invalid key!!!!!!!!",
      }),
    ).resolves.toEqual({ kind: "invalid_argument" });
    await expect(
      service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        module: {
          posterTemplateVersion: "changed-after-submit",
          sampleAssetId: "asset-2",
          templateId: "template-2",
        },
        moduleCode: "poster_consistency",
        requestId: "request-update-after-submit",
      }),
    ).resolves.toEqual({ kind: "invalid_state" });

    const version = await service.getVersion("content-opaque-1");
    expect(version).toMatchObject({
      contentVersion: "content-opaque-1",
      lifecycleRevision: 1,
      snapshot: created.draft.modules,
      state: "in_review",
    });
    await expect(service.listVersions("2026-08-01")).resolves.toMatchObject({
      items: [
        {
          contentVersion: "content-opaque-1",
          effectiveFrom: "2026-07-31T18:00:00+08:00",
          effectiveTo: "2026-08-01T18:00:00+08:00",
        },
      ],
    });
  });

  it("keeps an ordinary submit in review even when two selected images could materialize visual", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-standard-null-visual",
    });
    if (created.kind !== "created") throw new Error("draft fixture was not created");
    const complete = completeModules();
    if (complete.visual_and_rights === null) throw new Error("fixture missing visual module");
    seedTrustedImageCandidates(
      store,
      created.draft.draftId,
      created.draft.fortuneDate,
      complete.visual_and_rights,
    );
    let revision = 1;
    for (const moduleCode of ["calendar_algorithm", "copy_and_formula"] as const) {
      const updated = await service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: complete[moduleCode]!,
        moduleCode,
        requestId: `request-standard-null-visual-${moduleCode}`,
      });
      if (updated.kind !== "updated") throw new Error("module fixture was not updated");
      revision = updated.result.draftRevision;
    }
    const input = {
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: revision,
      idempotencyKey: "submit-standard-null-visual-0001",
      requestId: "request-submit-standard-null-visual",
    };

    const submitted = await service.submitDraft(input);
    expect(submitted).toMatchObject({ kind: "submitted", result: { state: "in_review" } });
    if (submitted.kind !== "submitted") return;
    await expect(service.getVersion(submitted.result.contentVersion)).resolves.toMatchObject({
      snapshot: { visual_and_rights: null },
      state: "in_review",
    });
    await expect(service.submitAutomaticProductionDraft(input)).resolves.toEqual({
      kind: "idempotency_conflict",
    });
  });

  it("approves an automatic production draft only after two required images materialize visual", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "system:auto-publication-worker",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-automatic-null-visual",
    });
    if (created.kind !== "created") throw new Error("draft fixture was not created");
    const complete = completeModules();
    if (complete.visual_and_rights === null) throw new Error("fixture missing visual module");
    seedTrustedImageCandidates(
      store,
      created.draft.draftId,
      created.draft.fortuneDate,
      complete.visual_and_rights,
    );
    let revision = 1;
    for (const moduleCode of ["calendar_algorithm", "copy_and_formula"] as const) {
      const updated = await service.updateDraftModule({
        actorId: "system:auto-publication-worker",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: complete[moduleCode]!,
        moduleCode,
        requestId: `request-automatic-null-visual-${moduleCode}`,
      });
      if (updated.kind !== "updated") throw new Error("module fixture was not updated");
      revision = updated.result.draftRevision;
    }

    const submitted = await service.submitAutomaticProductionDraft({
      actorId: "system:auto-publication-worker",
      draftId: created.draft.draftId,
      expectedDraftRevision: revision,
      idempotencyKey: "submit-automatic-null-visual-0001",
      requestId: "request-submit-automatic-null-visual",
    });
    expect(submitted).toMatchObject({ kind: "submitted", result: { state: "approved" } });
    if (submitted.kind !== "submitted") return;
    await expect(service.getVersion(submitted.result.contentVersion)).resolves.toMatchObject({
      snapshot: {
        poster_consistency: expect.any(Object),
        visual_and_rights: {
          looks: expect.arrayContaining([
            expect.objectContaining({ imageSlot: "required_primary" }),
            expect.objectContaining({ imageSlot: "required_alternative" }),
          ]),
        },
      },
      state: "approved",
    });
  });

  it("rejects automatic production freeze while either required image is missing", async () => {
    const service = deterministicService();
    const created = await service.createDraft({
      actorId: "system:auto-publication-worker",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-automatic-missing-images",
    });
    if (created.kind !== "created") throw new Error("draft fixture was not created");
    const complete = completeModules();
    let revision = 1;
    for (const moduleCode of ["calendar_algorithm", "copy_and_formula"] as const) {
      const updated = await service.updateDraftModule({
        actorId: "system:auto-publication-worker",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: complete[moduleCode]!,
        moduleCode,
        requestId: `request-automatic-missing-images-${moduleCode}`,
      });
      if (updated.kind !== "updated") throw new Error("module fixture was not updated");
      revision = updated.result.draftRevision;
    }

    await expect(
      service.submitAutomaticProductionDraft({
        actorId: "system:auto-publication-worker",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        idempotencyKey: "submit-automatic-missing-images-0001",
        requestId: "request-submit-automatic-missing-images",
      }),
    ).resolves.toEqual({ kind: "invalid_state" });
  });

  it("freezes a triple primary look and a mono optional look through the lifecycle seam", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-contract-valid-looks",
    });
    if (created.kind !== "created") throw new Error("draft fixture was not created");
    const modules = completeModules();
    const copy = modules.copy_and_formula;
    const visual = modules.visual_and_rights;
    if (copy === null || visual === null) throw new Error("complete fixture modules missing");
    const mono = copy.outfitFormulas.find((formula) => formula.kind === "mono");
    const triple = copy.outfitFormulas.find((formula) => formula.kind === "triple");
    if (mono === undefined || triple === undefined) throw new Error("formula fixture missing");

    mono.lookIds = ["look-optional-scene"];
    triple.lookIds = ["look-1"];
    triple.scenario = { code: "commute", label: "通勤" };
    visual.looks[0] = {
      ...visual.looks[0]!,
      formulaId: triple.formulaId,
      items: [
        {
          category: "top",
          categoryLabel: "上衣",
          colorCode: "black",
          description: "黑色上衣",
        },
        {
          category: "bottom",
          categoryLabel: "下装",
          colorCode: "white",
          description: "白色下装",
        },
        {
          category: "accessory",
          categoryLabel: "配饰",
          colorCode: "red",
          description: "红色配饰",
        },
      ],
      scenario: { code: "commute", label: "通勤" },
    };
    const optionalAsset = {
      ...visual.assets[0]!,
      assetId: "asset-optional-scene",
      fileUrl: "https://cdn.example.com/content/asset-optional-scene.webp",
      rightsRecordIds: ["rights-optional-scene"],
      sha256: "5".repeat(64),
      sourceMaterialReferences: ["source-record-optional-scene"],
    };
    visual.assets.push(optionalAsset);
    visual.rightsRecords.push({
      kind: "license",
      recordedAt: "2026-07-31T23:00:00+08:00",
      reference: "license-record-optional-scene",
      rightsRecordId: "rights-optional-scene",
    });
    visual.looks.push({
      alternatives: [],
      audience: { code: "all", label: "通用" },
      coverAssetId: optionalAsset.assetId,
      detailAssetIds: [],
      fallbackAssetId: null,
      formulaId: mono.formulaId,
      imageSlot: "optional",
      items: [
        {
          category: "top",
          categoryLabel: "上衣",
          colorCode: "black",
          description: "黑色同色系日常穿搭",
        },
      ],
      lookId: "look-optional-scene",
      requiredForPublish: false,
      scenario: { code: "daily", label: "日常" },
      sortOrder: 3,
      title: "日常场景补充方案",
    });
    seedTrustedImageCandidates(store, created.draft.draftId, created.draft.fortuneDate, visual);

    let revision = created.draft.draftRevision;
    for (const moduleCode of [
      "calendar_algorithm",
      "copy_and_formula",
      "visual_and_rights",
      "poster_consistency",
    ] as const) {
      const updated = await service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: modules[moduleCode]!,
        moduleCode,
        requestId: `request-save-contract-valid-${moduleCode}`,
      });
      if (updated.kind !== "updated") throw new Error(`${moduleCode} fixture was not saved`);
      revision = updated.result.draftRevision;
    }
    const submitted = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: revision,
      idempotencyKey: "submit-contract-valid-looks-0001",
      requestId: "request-submit-contract-valid-looks",
    });
    if (submitted.kind !== "submitted") throw new Error("fixture was not submitted");

    const version = await service.getVersion(submitted.result.contentVersion);
    expect(version?.preflightChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "required_images", status: "passed" }),
        expect.objectContaining({ code: "reference_integrity", status: "passed" }),
      ]),
    );
    await expect(store.readDailyImageSet(submitted.result.contentVersion)).resolves.toMatchObject({
      slots: expect.arrayContaining([
        expect.objectContaining({ imageSlot: "required_primary", lookId: "look-1" }),
        expect.objectContaining({ imageSlot: "optional", lookId: "look-optional-scene" }),
      ]),
    });
  });

  it("requires all nine checks and complete confirmed master evidence before approval", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-complete-draft",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const complete = completeModules();
    if (complete.visual_and_rights === null) throw new Error("fixture missing visual module");
    seedTrustedImageCandidates(
      store,
      created.draft.draftId,
      created.draft.fortuneDate,
      complete.visual_and_rights,
    );
    let revision = 1;
    for (const moduleCode of [
      "calendar_algorithm",
      "copy_and_formula",
      "visual_and_rights",
      "poster_consistency",
    ] as const) {
      const update = await service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: complete[moduleCode]!,
        moduleCode,
        requestId: `request-update-${moduleCode}`,
      });
      expect(update.kind).toBe("updated");
      revision += 1;
    }
    const submitted = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: revision,
      idempotencyKey: "submit-idempotency-complete",
      requestId: "request-submit-complete",
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;
    const frozenImageSet = await store.readDailyImageSet(submitted.result.contentVersion);
    expect(frozenImageSet).toMatchObject({
      contentVersion: submitted.result.contentVersion,
      fortuneDate: "2026-08-02",
      lifecycleRevision: 1,
      slots: [
        expect.objectContaining({
          deliveryStatus: "active",
          imageSlot: "required_primary",
          servedCoverAssetId: "asset-1",
        }),
        expect.objectContaining({
          deliveryStatus: "active",
          imageSlot: "required_alternative",
          servedCoverAssetId: "asset-2",
        }),
      ],
      withdrawalEvents: [],
    });
    expect(isAdminDailyImageSet(frozenImageSet)).toBe(true);

    const missingMaster = await service.decideReview({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      decision: "approved",
      expectedLifecycleRevision: 1,
      idempotencyKey: "approve-without-master-001",
      reason: null,
      requestId: "request-approve-without-master",
    });
    expect(missingMaster).toMatchObject({
      kind: "master_review_missing",
      preflightChecks: expect.arrayContaining([
        expect.objectContaining({ code: "master_review_evidence", status: "failed" }),
      ]),
    });
    expect(
      missingMaster.kind === "master_review_missing" ? missingMaster.preflightChecks : [],
    ).toHaveLength(9);

    await expect(
      service.addMasterReviewEvidence({
        actorId: "operator-1",
        contentVersion: submitted.result.contentVersion,
        evidence: {
          conclusion: "confirmed",
          notes: "无效日期不应入库。",
          references: [{ kind: "note", reference: "invalid-date-note" }],
          reviewedAt: "2026-02-30T22:30:00+08:00",
          reviewerDisplayName: "林老师",
        },
        expectedLifecycleRevision: 1,
        idempotencyKey: "master-invalid-date-0001",
        requestId: "request-master-invalid-date",
      }),
    ).resolves.toEqual({ kind: "invalid_argument" });

    const evidence = await service.addMasterReviewEvidence({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      evidence: {
        conclusion: "confirmed",
        notes: "已核对五行、五档与颜色关系。",
        references: [{ kind: "document", reference: "master-review-2026-08-02.pdf" }],
        reviewedAt: "2026-07-31T22:30:00+08:00",
        reviewerDisplayName: "林老师",
      },
      expectedLifecycleRevision: 1,
      idempotencyKey: "master-evidence-idempotency-001",
      requestId: "request-master-evidence-001",
    });
    expect(evidence).toMatchObject({
      kind: "added",
      version: {
        lifecycleRevision: 2,
        masterReviewEvidence: [
          expect.objectContaining({
            conclusion: "confirmed",
            evidenceId: "evidence-1",
            reviewerDisplayName: "林老师",
          }),
        ],
      },
    });
    expect(evidence.kind === "added" ? evidence.version.preflightChecks : []).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "passed" })]),
    );
    expect(
      evidence.kind === "added"
        ? evidence.version.preflightChecks.every((check) => check.status === "passed")
        : false,
    ).toBe(true);

    const approved = await service.decideReview({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      decision: "approved",
      expectedLifecycleRevision: 2,
      idempotencyKey: "approve-idempotency-complete",
      reason: null,
      requestId: "request-approve-complete",
    });
    expect(approved).toMatchObject({
      action: {
        activeContentVersion: null,
        contentVersion: submitted.result.contentVersion,
        lifecycleRevision: 3,
        state: "approved",
        transitions: [
          {
            contentVersion: submitted.result.contentVersion,
            fromState: "in_review",
            toState: "approved",
          },
        ],
      },
      kind: "applied",
    });
    expect(approved.kind).toBe("applied");
    if (approved.kind !== "applied") return;
    await expect(
      service.decideReview({
        actorId: "operator-1",
        contentVersion: submitted.result.contentVersion,
        decision: "approved",
        expectedLifecycleRevision: 2,
        idempotencyKey: "approve-idempotency-complete",
        reason: null,
        requestId: "request-approve-complete-retry",
      }),
    ).resolves.toMatchObject({ kind: "existing", action: approved.action });

    const firstAuditPage = await service.listAuditEvents({
      contentVersion: submitted.result.contentVersion,
      cursor: null,
      fortuneDate: "2026-08-02",
      limit: 2,
    });
    expect(firstAuditPage).toMatchObject({
      kind: "page",
      items: [
        expect.objectContaining({ action: "content_review_approved" }),
        expect.objectContaining({ action: "master_review_evidence_added" }),
      ],
      nextCursor: expect.any(String),
    });
    if (firstAuditPage.kind !== "page") return;
    const secondAuditPage = await service.listAuditEvents({
      contentVersion: submitted.result.contentVersion,
      cursor: firstAuditPage.nextCursor,
      fortuneDate: "2026-08-02",
      limit: 2,
    });
    expect(secondAuditPage).toMatchObject({
      kind: "page",
      items: [expect.objectContaining({ action: "content_submitted" })],
      nextCursor: null,
    });
    await expect(
      service.listAuditEvents({
        contentVersion: null,
        cursor: "tampered.invalid",
        fortuneDate: null,
        limit: 50,
      }),
    ).resolves.toEqual({ kind: "invalid_cursor" });
    const impossibleDateCursor = Buffer.from(
      JSON.stringify({
        id: "audit-forged",
        occurredAt: "2026-02-30T00:00:00.000Z",
        version: 1,
      }),
    ).toString("base64url");
    await expect(
      service.listAuditEvents({
        contentVersion: null,
        cursor: impossibleDateCursor,
        fortuneDate: null,
        limit: 50,
      }),
    ).resolves.toEqual({ kind: "invalid_cursor" });
  });

  it("blocks approval when the current image-set projection has withdrawn a required fallback", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-current-image-preflight",
    });
    if (created.kind !== "created") return;
    const complete = completeModules();
    if (complete.visual_and_rights === null) throw new Error("fixture missing visual module");
    seedTrustedImageCandidates(
      store,
      created.draft.draftId,
      created.draft.fortuneDate,
      complete.visual_and_rights,
    );
    let revision = 1;
    for (const moduleCode of [
      "calendar_algorithm",
      "copy_and_formula",
      "visual_and_rights",
      "poster_consistency",
    ] as const) {
      const updated = await service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: complete[moduleCode]!,
        moduleCode,
        requestId: `request-current-image-${moduleCode}`,
      });
      expect(updated.kind).toBe("updated");
      revision += 1;
    }
    const submitted = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: revision,
      idempotencyKey: "submit-current-image-preflight-0001",
      requestId: "request-submit-current-image-preflight",
    });
    if (submitted.kind !== "submitted") return;
    const evidence = await service.addMasterReviewEvidence({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      evidence: {
        conclusion: "confirmed",
        notes: "已完成核对。",
        references: [{ kind: "note", reference: "current-image-preflight" }],
        reviewedAt: "2026-08-01T12:00:00.000Z",
        reviewerDisplayName: "林老师",
      },
      expectedLifecycleRevision: 1,
      idempotencyKey: "evidence-current-image-preflight-0001",
      requestId: "request-evidence-current-image-preflight",
    });
    expect(evidence.kind).toBe("added");
    await store.transaction(async (transaction) => {
      const imageSet = await transaction.findDailyImageSetForUpdate(
        submitted.result.contentVersion,
      );
      if (imageSet === null) throw new Error("fixture image set missing");
      const event = {
        assetId: "asset-3",
        auditEventId: "audit-current-image-fallback",
        reason: "必备备用图授权撤销。",
        withdrawalEventId: "withdraw-current-image-fallback",
        withdrawnAt: "2026-08-02T05:00:00.000Z",
      };
      await transaction.updateDailyImageSet({
        ...imageSet,
        lifecycleRevision: 3,
        withdrawalEvents: [...imageSet.withdrawalEvents, event],
      });
      await transaction.insertImageAssetWithdrawalEvent({
        contentVersion: submitted.result.contentVersion,
        event,
      });
      const projection = await transaction.getOrCreateProjectionForUpdate("2026-08-02");
      await transaction.updateProjection({ ...projection, revision: 3 });
    });

    await expect(
      service.decideReview({
        actorId: "operator-1",
        contentVersion: submitted.result.contentVersion,
        decision: "approved",
        expectedLifecycleRevision: 3,
        idempotencyKey: "approve-current-image-preflight-0001",
        reason: null,
        requestId: "request-approve-current-image-preflight",
      }),
    ).resolves.toMatchObject({
      kind: "required_review_missing",
      preflightChecks: expect.arrayContaining([
        expect.objectContaining({ code: "required_images", status: "failed" }),
      ]),
    });
  });

  it("reports failed preflight when another version globally withdraws a required cover and fallback", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-global-read-source",
    });
    if (created.kind !== "created") throw new Error("source draft fixture was not created");
    const modules = completeModules();
    const visual = modules.visual_and_rights;
    if (visual === null) throw new Error("fixture missing visual module");
    seedTrustedImageCandidates(store, created.draft.draftId, created.draft.fortuneDate, visual);
    let revision = 1;
    for (const moduleCode of [
      "calendar_algorithm",
      "copy_and_formula",
      "visual_and_rights",
      "poster_consistency",
    ] as const) {
      const updated = await service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: modules[moduleCode]!,
        moduleCode,
        requestId: `request-global-read-source-${moduleCode}`,
      });
      if (updated.kind !== "updated") throw new Error("source module fixture was not saved");
      revision += 1;
    }
    const source = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: revision,
      idempotencyKey: "submit-global-read-source-0001",
      requestId: "request-submit-global-read-source",
    });
    if (source.kind !== "submitted") throw new Error("source version fixture was not submitted");
    const copied = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: source.result.contentVersion,
      fortuneDate: "2026-08-02",
      requestId: "request-create-global-read-target",
    });
    if (copied.kind !== "created") throw new Error("target draft fixture was not created");
    const target = await service.submitDraft({
      actorId: "operator-1",
      draftId: copied.draft.draftId,
      expectedDraftRevision: copied.draft.draftRevision,
      idempotencyKey: "submit-global-read-target-0001",
      requestId: "request-submit-global-read-target",
    });
    if (target.kind !== "submitted") throw new Error("target version fixture was not submitted");

    await store.transaction(async (transaction) => {
      for (const [assetId, suffix] of [
        ["asset-1", "cover"],
        ["asset-3", "fallback"],
      ] as const) {
        await transaction.insertImageAssetWithdrawalEvent({
          contentVersion: source.result.contentVersion,
          event: {
            assetId,
            auditEventId: `audit-global-read-${suffix}`,
            reason: "跨版本全局素材安全撤销。",
            withdrawalEventId: `withdraw-global-read-${suffix}`,
            withdrawnAt:
              suffix === "cover" ? "2026-08-02T05:00:00.000Z" : "2026-08-02T05:01:00.000Z",
          },
        });
      }
      const projection = await transaction.getOrCreateProjectionForUpdate("2026-08-02");
      await transaction.updateProjection({ ...projection, revision: projection.revision + 2 });
    });

    const version = await service.getVersion(target.result.contentVersion);

    expect(version?.preflightChecks).toContainEqual(
      expect.objectContaining({ code: "required_images", status: "failed" }),
    );
  });

  it("rejects submit when a global withdrawal commits as the submit acquires the day lock", async () => {
    const store = new WithdrawalAtProjectionLockStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-submit-lock-source",
    });
    if (created.kind !== "created") throw new Error("source draft fixture was not created");
    const modules = completeModules();
    const visual = modules.visual_and_rights;
    if (visual === null) throw new Error("fixture missing visual module");
    seedTrustedImageCandidates(store, created.draft.draftId, created.draft.fortuneDate, visual);
    let revision = 1;
    for (const moduleCode of [
      "calendar_algorithm",
      "copy_and_formula",
      "visual_and_rights",
      "poster_consistency",
    ] as const) {
      const updated = await service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: modules[moduleCode]!,
        moduleCode,
        requestId: `request-submit-lock-source-${moduleCode}`,
      });
      if (updated.kind !== "updated") throw new Error("source module fixture was not saved");
      revision += 1;
    }
    const source = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: revision,
      idempotencyKey: "submit-lock-race-source-0001",
      requestId: "request-submit-lock-race-source",
    });
    if (source.kind !== "submitted") throw new Error("source version fixture was not submitted");
    const copied = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: source.result.contentVersion,
      fortuneDate: "2026-08-02",
      requestId: "request-create-submit-lock-target",
    });
    if (copied.kind !== "created") throw new Error("target draft fixture was not created");
    store.armWithdrawal(source.result.contentVersion, "asset-1");

    const result = await service.submitDraft({
      actorId: "operator-1",
      draftId: copied.draft.draftId,
      expectedDraftRevision: copied.draft.draftRevision,
      idempotencyKey: "submit-lock-race-target-0001",
      requestId: "request-submit-lock-race-target",
    });

    expect(result).toEqual({ kind: "image_withdrawn" });
  });

  it("rejects forged server-managed image fields in the visual module", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-forged-visual",
    });
    if (created.kind !== "created") return;
    const modules = completeModules();
    if (modules.visual_and_rights === null) throw new Error("fixture missing visual module");
    seedTrustedImageCandidates(
      store,
      created.draft.draftId,
      created.draft.fortuneDate,
      modules.visual_and_rights,
    );
    modules.visual_and_rights.assets[0] = {
      ...modules.visual_and_rights.assets[0]!,
      sha256: "f".repeat(64),
    };

    await expect(
      service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        module: modules.visual_and_rights,
        moduleCode: "visual_and_rights",
        requestId: "request-save-forged-visual",
      }),
    ).resolves.toEqual({ kind: "invalid_asset_reference" });
  });

  it("revalidates frozen visual assets against authoritative candidates at submit time", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-submit-image-revalidation",
    });
    if (created.kind !== "created") return;
    const modules = completeModules();
    const visual = modules.visual_and_rights;
    if (visual === null) throw new Error("fixture missing visual module");
    seedTrustedImageCandidates(store, created.draft.draftId, created.draft.fortuneDate, visual);
    let revision = 1;
    for (const moduleCode of [
      "calendar_algorithm",
      "copy_and_formula",
      "visual_and_rights",
      "poster_consistency",
    ] as const) {
      const updated = await service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision,
        module: modules[moduleCode]!,
        moduleCode,
        requestId: `request-submit-image-revalidation-${moduleCode}`,
      });
      expect(updated.kind).toBe("updated");
      revision += 1;
    }
    await store.transaction(async (transaction) => {
      const draft = await transaction.findDraftForUpdate(created.draft.draftId);
      const candidate = await transaction.findDraftImageAssetForUpdate(
        created.draft.draftId,
        visual.assets[0]!.assetId,
      );
      if (draft === null || candidate === null) throw new Error("fixture candidate missing");
      await transaction.updateDraftImageAsset({
        ...candidate,
        asset: {
          ...candidate.asset,
          fileUrl: null,
          reviewStatus: "rejected",
        },
      });
      await transaction.updateDraft({
        ...draft,
        draft: { ...draft.draft, draftRevision: revision + 1 },
      });
    });

    await expect(
      service.submitDraft({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: revision + 1,
        idempotencyKey: "submit-image-revalidation-0001",
        requestId: "request-submit-image-revalidation",
      }),
    ).resolves.toEqual({ kind: "invalid_asset_reference" });
    await expect(store.readDailyImageSet("content-opaque-1")).resolves.toBeNull();
  });

  it("rejects duplicate cover assets across frozen image slots", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-duplicate-cover",
    });
    if (created.kind !== "created") return;
    const modules = completeModules();
    if (modules.visual_and_rights === null) throw new Error("fixture missing visual module");
    seedTrustedImageCandidates(
      store,
      created.draft.draftId,
      created.draft.fortuneDate,
      modules.visual_and_rights,
    );
    modules.visual_and_rights.looks[1] = {
      ...modules.visual_and_rights.looks[1]!,
      coverAssetId: modules.visual_and_rights.looks[0]!.coverAssetId,
    };

    await expect(
      service.updateDraftModule({
        actorId: "operator-1",
        draftId: created.draft.draftId,
        expectedDraftRevision: 1,
        module: modules.visual_and_rights,
        moduleCode: "visual_and_rights",
        requestId: "request-save-duplicate-cover",
      }),
    ).resolves.toEqual({ kind: "invalid_asset_reference" });
  });

  it("rebinds trusted snapshot assets into a copied draft and blocks globally withdrawn assets on submit", async () => {
    const store = new InMemoryContentLifecycleStore();
    const service = deterministicService(store);
    const modules = completeModules();
    if (modules.visual_and_rights === null) throw new Error("fixture missing visual module");
    const source = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-02",
      requestId: "request-create-copy-source-visual",
    });
    if (source.kind !== "created") return;
    seedTrustedImageCandidates(
      store,
      source.draft.draftId,
      source.draft.fortuneDate,
      modules.visual_and_rights,
    );
    const frozen = await service.updateDraftModule({
      actorId: "operator-1",
      draftId: source.draft.draftId,
      expectedDraftRevision: 1,
      module: modules.visual_and_rights,
      moduleCode: "visual_and_rights",
      requestId: "request-freeze-copy-source-visual",
    });
    expect(frozen.kind).toBe("updated");
    const submitted = await service.submitDraft({
      actorId: "operator-1",
      draftId: source.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: "submit-copy-source-visual-0001",
      requestId: "request-submit-copy-source-visual",
    });
    if (submitted.kind !== "submitted") return;
    await store.transaction(async (transaction) => {
      await transaction.insertImageAssetWithdrawalEvent({
        contentVersion: submitted.result.contentVersion,
        event: {
          assetId: "asset-1",
          auditEventId: "audit-global-withdrawal-1",
          reason: "权利方撤销授权。",
          withdrawalEventId: "global-withdrawal-1",
          withdrawnAt: "2026-08-01T12:00:00.000Z",
        },
      });
    });

    const copied = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: submitted.result.contentVersion,
      fortuneDate: "2026-08-02",
      requestId: "request-copy-frozen-visual",
    });
    expect(copied.kind).toBe("created");
    if (copied.kind !== "created") return;
    expect(
      (await store.listDraftImageAssets(copied.draft.draftId)).map(({ asset }) => asset.assetId),
    ).toEqual(["asset-1", "asset-2", "asset-3", "asset-4"]);
    await expect(
      service.updateDraftModule({
        actorId: "operator-1",
        draftId: copied.draft.draftId,
        expectedDraftRevision: 1,
        module: modules.visual_and_rights,
        moduleCode: "visual_and_rights",
        requestId: "request-edit-copied-visual",
      }),
    ).resolves.toMatchObject({ kind: "updated", result: { draftRevision: 2 } });
    await expect(
      service.submitDraft({
        actorId: "operator-1",
        draftId: copied.draft.draftId,
        expectedDraftRevision: 2,
        idempotencyKey: "submit-copied-withdrawn-asset-0001",
        requestId: "request-submit-copied-withdrawn-asset",
      }),
    ).resolves.toEqual({ kind: "image_withdrawn" });
  });

  it("reports non-master preflight failures separately", async () => {
    const service = deterministicService();
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-04",
      requestId: "request-create-incomplete-draft",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const submitted = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      idempotencyKey: "submit-incomplete-0001",
      requestId: "request-submit-incomplete",
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;
    await service.addMasterReviewEvidence({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      evidence: {
        conclusion: "confirmed",
        notes: "仅完成大师核对。",
        references: [{ kind: "note", reference: "master-note-2026-08-04" }],
        reviewedAt: "2026-07-31T22:30:00+08:00",
        reviewerDisplayName: "林老师",
      },
      expectedLifecycleRevision: 1,
      idempotencyKey: "master-incomplete-0001",
      requestId: "request-master-incomplete",
    });

    await expect(
      service.decideReview({
        actorId: "operator-1",
        contentVersion: submitted.result.contentVersion,
        decision: "approved",
        expectedLifecycleRevision: 2,
        idempotencyKey: "approve-incomplete-0001",
        reason: null,
        requestId: "request-approve-incomplete",
      }),
    ).resolves.toMatchObject({
      kind: "required_review_missing",
      preflightChecks: expect.arrayContaining([
        expect.objectContaining({ code: "master_review_evidence", status: "passed" }),
        expect.objectContaining({ code: "required_images", status: "failed" }),
      ]),
    });
  });

  it("rejects golden-data dates outside the frozen range and duplicate required covers", () => {
    const confirmedEvidence: StoredMasterReviewEvidence[] = [
      {
        conclusion: "confirmed",
        contentVersion: "opaque-version",
        evidenceId: "evidence-1",
        notes: "确认",
        recordedAt: "2026-07-31T15:00:00.000Z",
        recordedRevision: 1,
        references: [{ kind: "note", reference: "master-note" }],
        reviewedAt: "2026-07-31T14:00:00.000Z",
        reviewerDisplayName: "林老师",
      },
    ];
    const outside = evaluateContentPreflight(completeModules(), confirmedEvidence, "2027-01-02");
    expect(outside).toContainEqual(
      expect.objectContaining({ code: "calendar_golden_data", status: "failed" }),
    );

    const duplicateCover = completeModules();
    if (duplicateCover.visual_and_rights === null) throw new Error("fixture missing visual module");
    duplicateCover.visual_and_rights.looks[1] = {
      ...duplicateCover.visual_and_rights.looks[1]!,
      coverAssetId: duplicateCover.visual_and_rights.looks[0]!.coverAssetId,
    };
    const duplicateChecks = evaluateContentPreflight(
      duplicateCover,
      confirmedEvidence,
      "2026-08-02",
    );
    expect(duplicateChecks).toContainEqual(
      expect.objectContaining({ code: "required_images", status: "failed" }),
    );
  });

  it("rejects colors that do not belong to the tier's fixed five-element palette", () => {
    const snapshot = completeModules();
    if (snapshot.calendar_algorithm === null) throw new Error("fixture missing calendar module");
    snapshot.calendar_algorithm.tiers[0] = {
      ...snapshot.calendar_algorithm.tiers[0]!,
      colors: [{ colorCode: "green", name: "绿色" }],
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "calendar_algorithm", status: "failed" }),
    );
  });

  it("allows a required cover to fall back while an unusable optional cover is omitted", () => {
    const snapshot = completeModules();
    if (snapshot.visual_and_rights === null || snapshot.copy_and_formula === null) {
      throw new Error("fixture missing visual module");
    }
    snapshot.visual_and_rights.assets[0] = {
      ...snapshot.visual_and_rights.assets[0]!,
      fileUrl: null,
      reviewStatus: "rejected",
    };
    if (snapshot.poster_consistency === null) throw new Error("fixture missing poster module");
    snapshot.poster_consistency.sampleAssetId = "asset-3";
    const optionalAsset = {
      ...snapshot.visual_and_rights.assets[1]!,
      assetId: "asset-optional-rejected",
      fileUrl: null,
      reviewStatus: "rejected" as const,
      sha256: "a".repeat(64),
    };
    snapshot.visual_and_rights.assets.push(optionalAsset);
    snapshot.visual_and_rights.looks.push({
      alternatives: [],
      audience: { code: "all", label: "通用" },
      coverAssetId: optionalAsset.assetId,
      detailAssetIds: [],
      fallbackAssetId: null,
      formulaId: "formula-three",
      imageSlot: "optional",
      items: [
        {
          category: "accessory",
          categoryLabel: "配饰",
          colorCode: "red",
          description: "红色配饰",
        },
      ],
      lookId: "look-3",
      requiredForPublish: false,
      scenario: { code: "daily", label: "日常" },
      sortOrder: 3,
      title: "可选搭配",
    });
    snapshot.copy_and_formula.outfitFormulas[2] = {
      ...snapshot.copy_and_formula.outfitFormulas[2]!,
      lookIds: ["look-3"],
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "required_images", status: "passed" }),
        expect.objectContaining({ code: "visual_and_rights", status: "passed" }),
        expect.objectContaining({ code: "ai_label", status: "passed" }),
        expect.objectContaining({ code: "reference_integrity", status: "passed" }),
      ]),
    );

    const unsafeOptionalFallback = {
      ...optionalAsset,
      assetId: "asset-optional-fallback-rejected",
      sha256: "c".repeat(64),
    };
    snapshot.visual_and_rights.assets.push(unsafeOptionalFallback);
    snapshot.visual_and_rights.looks[2] = {
      ...snapshot.visual_and_rights.looks[2]!,
      fallbackAssetId: unsafeOptionalFallback.assetId,
    };
    expect(evaluateContentPreflight(snapshot, [], "2026-08-02")).toContainEqual(
      expect.objectContaining({ code: "required_images", status: "failed" }),
    );
  });

  it("does not let an unreferenced failed candidate block the frozen selection", () => {
    const snapshot = completeModules();
    if (snapshot.visual_and_rights === null) throw new Error("fixture missing visual module");
    snapshot.visual_and_rights.assets.push({
      ...snapshot.visual_and_rights.assets[0]!,
      assetId: "asset-unselected-failed",
      aiLabelStatus: "failed",
      fileUrl: null,
      reviewStatus: "rejected",
      rightsStatus: "rejected",
      sha256: "b".repeat(64),
    });

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "required_images", status: "passed" }),
        expect.objectContaining({ code: "visual_and_rights", status: "passed" }),
        expect.objectContaining({ code: "ai_label", status: "passed" }),
      ]),
    );
  });

  it("requires a safe same-snapshot fallback for each required image slot", () => {
    const snapshot = completeModules();
    if (snapshot.visual_and_rights === null) throw new Error("fixture missing visual module");
    snapshot.visual_and_rights.looks[0] = {
      ...snapshot.visual_and_rights.looks[0]!,
      fallbackAssetId: null,
    } as unknown as NonNullable<DraftModules["visual_and_rights"]>["looks"][number];

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "required_images", status: "failed" }),
    );
  });

  it("uses the latest withdrawal projection when assessing release safety", () => {
    const fallbackWithdrawnSnapshot = completeModules();
    const fallbackWithdrawn = frozenImageSet(fallbackWithdrawnSnapshot);
    fallbackWithdrawn.withdrawalEvents.push({
      assetId: "asset-3",
      auditEventId: "audit-withdraw-fallback",
      reason: "备用图授权撤销。",
      withdrawalEventId: "withdraw-fallback",
      withdrawnAt: "2026-08-02T05:00:00.000Z",
    });
    expect(
      evaluateContentPreflight(fallbackWithdrawnSnapshot, [], "2026-08-02", fallbackWithdrawn),
    ).toContainEqual(expect.objectContaining({ code: "required_images", status: "failed" }));

    const coverWithdrawnSnapshot = completeModules();
    if (coverWithdrawnSnapshot.poster_consistency === null) {
      throw new Error("fixture missing poster module");
    }
    coverWithdrawnSnapshot.poster_consistency.sampleAssetId = "asset-2";
    const coverWithdrawn = frozenImageSet(coverWithdrawnSnapshot);
    coverWithdrawn.slots[0] = {
      ...coverWithdrawn.slots[0]!,
      deliveryStatus: "fallback",
      servedCoverAssetId: "asset-3",
    } as StoredDailyImageSet["slots"][number];
    coverWithdrawn.withdrawalEvents.push({
      assetId: "asset-1",
      auditEventId: "audit-withdraw-cover",
      reason: "主图授权撤销，已切换安全备用图。",
      withdrawalEventId: "withdraw-cover",
      withdrawnAt: "2026-08-02T05:00:00.000Z",
    });
    expect(
      evaluateContentPreflight(coverWithdrawnSnapshot, [], "2026-08-02", coverWithdrawn),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "required_images", status: "passed" }),
        expect.objectContaining({ code: "visual_and_rights", status: "passed" }),
      ]),
    );

    const unavailable = structuredClone(coverWithdrawn);
    unavailable.slots[0] = {
      ...unavailable.slots[0]!,
      deliveryStatus: "unavailable",
      servedCoverAssetId: null,
    } as StoredDailyImageSet["slots"][number];
    unavailable.withdrawalEvents.push({
      assetId: "asset-3",
      auditEventId: "audit-withdraw-last-fallback",
      reason: "最后一张必备备用图也已撤销。",
      withdrawalEventId: "withdraw-last-fallback",
      withdrawnAt: "2026-08-02T06:00:00.000Z",
    });
    expect(
      evaluateContentPreflight(coverWithdrawnSnapshot, [], "2026-08-02", unavailable),
    ).toContainEqual(expect.objectContaining({ code: "required_images", status: "failed" }));
  });

  it("rejects public tier labels that disagree with the tier code and rank", () => {
    const snapshot = completeModules();
    if (snapshot.calendar_algorithm === null) throw new Error("fixture missing calendar module");
    snapshot.calendar_algorithm.tiers[3] = {
      ...snapshot.calendar_algorithm.tiers[3]!,
      algorithmLabel: "不利",
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "calendar_algorithm", status: "failed" }),
    );
  });

  it("rejects formula sets that do not contain mono, dual, and triple choices", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    snapshot.copy_and_formula.outfitFormulas = snapshot.copy_and_formula.outfitFormulas.map(
      (formula) => ({ ...formula, kind: "mono", slots: [formula.slots[0]!] }),
    );

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects formulas whose slot count does not match mono, dual, or triple", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    const dual = snapshot.copy_and_formula.outfitFormulas.find(
      (formula) => formula.kind === "dual",
    );
    if (dual === undefined) throw new Error("fixture missing dual formula");
    dual.slots = [dual.slots[0]!];

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects a mono formula that is not a primary great-fortune color", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    const mono = snapshot.copy_and_formula.outfitFormulas.find(
      (formula) => formula.kind === "mono",
    );
    if (mono === undefined) throw new Error("fixture missing mono formula");
    mono.slots[0] = {
      ...mono.slots[0]!,
      colorCodes: ["green"],
      role: "accent",
      roleLabel: "点缀色",
      tierCode: "bu_li",
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects a dual formula that is not great-fortune paired with secondary or neutral", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    const dual = snapshot.copy_and_formula.outfitFormulas.find(
      (formula) => formula.kind === "dual",
    );
    if (dual === undefined) throw new Error("fixture missing dual formula");
    dual.slots[1] = {
      ...dual.slots[1]!,
      colorCodes: ["green"],
      role: "accent",
      roleLabel: "点缀色",
      tierCode: "bu_li",
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects a triple formula whose declared ratios do not total one hundred", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    const triple = snapshot.copy_and_formula.outfitFormulas.find(
      (formula) => formula.kind === "triple",
    );
    if (triple === undefined) throw new Error("fixture missing triple formula");
    triple.slots[2] = { ...triple.slots[2]!, ratioPercent: 20 };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "copy_and_formula", status: "failed" }),
    );
  });

  it("rejects a formula that points at a missing or mismatched look", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    snapshot.copy_and_formula.outfitFormulas[0] = {
      ...snapshot.copy_and_formula.outfitFormulas[0]!,
      lookIds: ["look-missing"],
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "reference_integrity", status: "failed" }),
    );
  });

  it("rejects formula colors that are not declared by their referenced tiers", () => {
    const snapshot = completeModules();
    if (snapshot.copy_and_formula === null) throw new Error("fixture missing copy module");
    snapshot.copy_and_formula.outfitFormulas[0]!.slots[0] = {
      ...snapshot.copy_and_formula.outfitFormulas[0]!.slots[0]!,
      colorCodes: ["green"],
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "reference_integrity", status: "failed" }),
    );
  });

  it("rejects a look color that is not declared by its linked formula", () => {
    const snapshot = completeModules();
    if (snapshot.visual_and_rights === null) throw new Error("fixture missing visual module");
    snapshot.visual_and_rights.looks[0]!.items[0] = {
      ...snapshot.visual_and_rights.looks[0]!.items[0]!,
      colorCode: "green",
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "reference_integrity", status: "failed" }),
    );
  });

  it("allows an unusable detail asset to be omitted without blocking the image set", () => {
    const snapshot = completeModules();
    if (snapshot.visual_and_rights === null) throw new Error("fixture missing visual module");
    const sourceAsset = snapshot.visual_and_rights.assets[0];
    if (sourceAsset === undefined) throw new Error("fixture missing source asset");
    snapshot.visual_and_rights.assets.push({
      ...sourceAsset,
      assetId: "asset-detail-unusable",
      fileUrl: null,
      sha256: "3".repeat(64),
    });
    snapshot.visual_and_rights.looks[0] = {
      ...snapshot.visual_and_rights.looks[0]!,
      detailAssetIds: ["asset-detail-unusable"],
    };

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "reference_integrity", status: "passed" }),
    );
  });

  it("rejects a poster sample whose template version differs from share copy", () => {
    const snapshot = completeModules();
    if (snapshot.poster_consistency === null) throw new Error("fixture missing poster module");
    snapshot.poster_consistency.posterTemplateVersion = "poster-v2";

    const checks = evaluateContentPreflight(snapshot, [], "2026-08-02");

    expect(checks).toContainEqual(
      expect.objectContaining({ code: "poster_consistency", status: "failed" }),
    );
  });

  it("returns every resumable draft without a hidden five-hundred-row cutoff", async () => {
    const service = deterministicService();
    for (let index = 0; index < 501; index += 1) {
      const created = await service.createDraft({
        actorId: "operator-1",
        copyFromContentVersion: null,
        fortuneDate: "2026-08-05",
        requestId: `request-bulk-draft-${index.toString().padStart(4, "0")}`,
      });
      expect(created.kind).toBe("created");
    }
    expect((await service.listDrafts("2026-08-05")).items).toHaveLength(501);
  });

  it("copies a rejected immutable snapshot only through an explicit new-draft request", async () => {
    const service = deterministicService();
    const created = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: null,
      fortuneDate: "2026-08-03",
      requestId: "request-create-rejected-draft",
    });
    expect(created.kind).toBe("created");
    if (created.kind !== "created") return;
    const updated = await service.updateDraftModule({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 1,
      module: completeModules().copy_and_formula!,
      moduleCode: "copy_and_formula",
      requestId: "request-update-rejected-draft",
    });
    expect(updated.kind).toBe("updated");
    const submitted = await service.submitDraft({
      actorId: "operator-1",
      draftId: created.draft.draftId,
      expectedDraftRevision: 2,
      idempotencyKey: "submit-idempotency-rejected",
      requestId: "request-submit-rejected",
    });
    expect(submitted.kind).toBe("submitted");
    if (submitted.kind !== "submitted") return;

    await expect(
      service.decideReview({
        actorId: "operator-1",
        contentVersion: submitted.result.contentVersion,
        decision: "changes_requested",
        expectedLifecycleRevision: 1,
        idempotencyKey: "reject-idempotency-no-reason",
        reason: "   ",
        requestId: "request-reject-no-reason",
      }),
    ).resolves.toEqual({ kind: "invalid_argument" });
    const rejected = await service.decideReview({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      decision: "changes_requested",
      expectedLifecycleRevision: 1,
      idempotencyKey: "reject-idempotency-with-reason",
      reason: "大师要求重新核对五档颜色关系。",
      requestId: "request-reject-with-reason",
    });
    expect(rejected).toMatchObject({
      action: { lifecycleRevision: 2, state: "changes_requested" },
      kind: "applied",
    });
    await expect(service.listDrafts("2026-08-03")).resolves.toEqual({ items: [] });
    await service.decideReview({
      actorId: "operator-1",
      contentVersion: submitted.result.contentVersion,
      decision: "changes_requested",
      expectedLifecycleRevision: 1,
      idempotencyKey: "reject-idempotency-with-reason",
      reason: "大师要求重新核对五档颜色关系。",
      requestId: "request-reject-with-reason-retry",
    });
    await expect(service.listDrafts("2026-08-03")).resolves.toEqual({ items: [] });
    const copy = await service.createDraft({
      actorId: "operator-1",
      copyFromContentVersion: submitted.result.contentVersion,
      fortuneDate: "2026-08-03",
      requestId: "request-copy-rejected-version",
    });
    expect(copy).toMatchObject({
      draft: { draftId: "draft-2", draftRevision: 1 },
      kind: "created",
    });
    const copied = await service.getDraft("draft-2");
    expect(copied?.modules).toEqual(
      (await service.getVersion(submitted.result.contentVersion))?.snapshot,
    );
    const changedCopy = await service.updateDraftModule({
      actorId: "operator-1",
      draftId: "draft-2",
      expectedDraftRevision: 1,
      module: completeModules().poster_consistency!,
      moduleCode: "poster_consistency",
      requestId: "request-edit-copied-draft",
    });
    expect(changedCopy.kind).toBe("updated");
    expect(
      (await service.getVersion(submitted.result.contentVersion))?.snapshot.poster_consistency,
    ).toBe(null);
    expect((await service.listDrafts("2026-08-03")).items).toHaveLength(1);
  });
});
