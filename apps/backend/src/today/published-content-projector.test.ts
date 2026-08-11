import type { components } from "@five/api-contract";
import { describe, expect, it } from "vitest";

import type { StoredContentVersion } from "../content-lifecycle/content-lifecycle.store";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";
import {
  projectAdminDailyContentSnapshot,
  projectPublishedDailyContent,
} from "./published-content-projector";

type AdminImageAsset = components["schemas"]["AdminImageAsset"];
type DraftModules = components["schemas"]["DraftModules"];

const fortuneDate = "2026-08-08";
const contentVersion = "content-public-projection-v1";

function reviewedAsset(
  assetId: string,
  sourceType: "ai_generated" | "licensed" = "licensed",
): AdminImageAsset {
  const common = {
    altText: `${assetId} 穿搭图`,
    assetId,
    fileUrl: `https://cdn.five.test/${assetId}.webp`,
    height: 1600,
    manualReview: {
      aiLabelCompliance: "passed" as const,
      colorAndCopyConsistency: "passed" as const,
      garmentAndPersonIntegrity: "passed" as const,
      mobileAndWechatPreview: "passed" as const,
      notes: "六项检查通过。",
      reviewId: `review-${assetId}`,
      reviewedAt: "2026-08-01T11:00:00+08:00",
      reviewerAccountId: "operator-one",
      rightsAndIdentityRisk: "passed" as const,
      scenarioAndImitability: "passed" as const,
    },
    mediaType: "image/webp" as const,
    reviewStatus: "approved" as const,
    rightsRecordIds: [`rights-${assetId}`],
    rightsStatus: "cleared" as const,
    sha256: assetId
      .padEnd(64, "a")
      .slice(0, 64)
      .replaceAll(/[^a-f0-9]/gu, "a"),
    sourceMaterialReferences: [`source-${assetId}`],
    width: 1200,
  };
  return sourceType === "ai_generated"
    ? {
        ...common,
        aiLabelStatus: "complete",
        declaredModel: "gpt-image-2",
        generatedAt: "2026-08-01T10:00:00+08:00",
        generationMethod: "codex",
        promptVersion: "prompt-v1",
        reproductionReference: `generation-${assetId}`,
        sourceType,
      }
    : {
        ...common,
        aiLabelStatus: "not_applicable",
        declaredModel: null,
        generatedAt: null,
        generationMethod: "licensed_upload",
        promptVersion: null,
        reproductionReference: null,
        sourceType,
      };
}

const primaryCover = reviewedAsset("asset-primary-cover");
const primaryFallback = reviewedAsset("asset-primary-fallback", "ai_generated");
const primaryDetail = reviewedAsset("asset-primary-detail", "ai_generated");
const alternativeCover = reviewedAsset("asset-alternative-cover", "ai_generated");
const alternativeFallback = reviewedAsset("asset-alternative-fallback");
const optionalCover = reviewedAsset("asset-optional-cover");

function completeSnapshot(): DraftModules {
  const scenario = { code: "daily", label: "日常" };
  const audience = { code: "all", label: "通用" };
  return {
    calendar_algorithm: {
      algorithmVersion: "algorithm-v1",
      calendar: {
        branch: "申",
        dayElement: "metal",
        dayElementLabel: "金",
        ganzhiDay: "庚申日",
        lunarDateText: "六月廿五",
        weekdayText: "星期六",
      },
      calendarDataVersion: "calendar-data-v1",
      calendarRuleVersion: "calendar-rule-v1",
      tiers: [
        ["da_ji", "大吉", "今日优先", "wood", "木"],
        ["ci_ji", "次吉", "稳妥选择", "water", "水"],
        ["ping", "平", "日常可穿", "metal", "金"],
        ["jiao_cha", "较差", "注意", "earth", "土"],
        ["bu_li", "不利", "注意", "fire", "火"],
      ].map(([tierCode, algorithmLabel, displayLabel, element, elementLabel], index) => ({
        algorithmLabel,
        colors: [{ colorCode: `color-${index + 1}`, name: `颜色${index + 1}` }],
        displayLabel,
        displaySection: index < 3 ? "primary" : "attention",
        element,
        elementLabel,
        explanation: `第 ${index + 1} 档解释`,
        rank: index + 1,
        relationText: `第 ${index + 1} 档关系`,
        tierCode,
      })) as NonNullable<DraftModules["calendar_algorithm"]>["tiers"],
    },
    copy_and_formula: {
      balanceSuggestion: {
        accessoryExamples: ["丝巾", "包"],
        description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
        preferredTierCode: "da_ji",
        title: "已经穿了注意色",
      },
      basis: {
        disclaimer: "内容基于传统文化规则整理，仅供穿搭参考。",
        steps: ["日期干支按固定历法规则计算。"],
      },
      copyVersion: "copy-v1",
      outfitFormulas: ["primary", "alternative", "optional"].map((name, index) => ({
        audience,
        disclaimer: "普通穿搭建议。",
        formulaId: `formula-${name}`,
        kind: index === 0 ? "mono" : index === 1 ? "dual" : "triple",
        lookIds: [`look-${name}`],
        scenario,
        slots: [
          {
            colorCodes: [`color-${index + 1}`],
            garmentParts: ["上衣"],
            ratioPercent: 100,
            role: "primary",
            roleLabel: "主色",
            tierCode: "da_ji",
          },
        ],
        title: `${name} 方案`,
      })),
      outfitVersion: "outfit-v1",
      share: {
        copyText: "今日五行穿衣建议",
        posterJobEndpoint: "/api/v1/poster-jobs",
        posterTemplateVersion: "poster-v1",
        summaryText: "今日穿衣配色",
      },
    },
    poster_consistency: {
      posterTemplateVersion: "poster-v1",
      sampleAssetId: primaryCover.assetId,
      templateId: "poster-template-one",
    },
    visual_and_rights: {
      assetManifestVersion: "assets-v1",
      assets: [
        primaryCover,
        primaryFallback,
        primaryDetail,
        alternativeCover,
        alternativeFallback,
        optionalCover,
      ],
      looks: [
        {
          alternatives: [],
          audience,
          coverAssetId: primaryCover.assetId,
          detailAssetIds: [primaryDetail.assetId],
          fallbackAssetId: primaryFallback.assetId,
          formulaId: "formula-primary",
          imageSlot: "required_primary",
          items: [
            {
              category: "top",
              categoryLabel: "上衣",
              colorCode: "color-1",
              description: "绿色上衣",
            },
          ],
          lookId: "look-primary",
          requiredForPublish: true,
          scenario,
          sortOrder: 1,
          title: "常可穿",
        },
        {
          alternatives: [],
          audience,
          coverAssetId: alternativeCover.assetId,
          detailAssetIds: [],
          fallbackAssetId: alternativeFallback.assetId,
          formulaId: "formula-alternative",
          imageSlot: "required_alternative",
          items: [
            {
              category: "dress",
              categoryLabel: "连衣裙",
              colorCode: "color-2",
              description: "藏青连衣裙",
            },
          ],
          lookId: "look-alternative",
          requiredForPublish: true,
          scenario,
          sortOrder: 2,
          title: "换一种穿法",
        },
        {
          alternatives: [],
          audience,
          coverAssetId: optionalCover.assetId,
          detailAssetIds: [],
          fallbackAssetId: null,
          formulaId: "formula-optional",
          imageSlot: "optional",
          items: [
            {
              category: "accessory",
              categoryLabel: "配饰",
              colorCode: "color-3",
              description: "金色耳饰",
            },
          ],
          lookId: "look-optional",
          requiredForPublish: false,
          scenario,
          sortOrder: 3,
          title: "可选灵感",
        },
      ],
      rightsRecords: [
        primaryCover,
        primaryFallback,
        primaryDetail,
        alternativeCover,
        alternativeFallback,
        optionalCover,
      ].map((asset) => ({
        kind: "internal_record" as const,
        recordedAt: "2026-08-01T09:00:00+08:00",
        reference: `rights-reference-${asset.assetId}`,
        rightsRecordId: asset.rightsRecordIds[0]!,
      })),
    },
  };
}

function publishedVersion(overrides: Partial<StoredContentVersion> = {}): StoredContentVersion {
  return {
    contentVersion,
    createdAt: "2026-08-01T12:00:00.000Z",
    draftId: "draft-public-projection",
    effectiveFrom: "2026-08-07T23:00:00+08:00",
    effectiveTo: "2026-08-08T23:00:00+08:00",
    fortuneDate,
    preflightChecks: [],
    snapshot: completeSnapshot(),
    state: "published",
    ...overrides,
  };
}

function activeImageSet(): StoredDailyImageSet {
  return {
    assets: completeSnapshot().visual_and_rights!.assets,
    contentVersion,
    fortuneDate,
    lifecycleRevision: 7,
    slots: [
      {
        coverAssetId: primaryCover.assetId,
        deliveryStatus: "active",
        detailAssetIds: [primaryDetail.assetId],
        fallbackAssetId: primaryFallback.assetId,
        imageSlot: "required_primary",
        lookId: "look-primary",
        servedCoverAssetId: primaryCover.assetId,
        servedDetailAssetIds: [primaryDetail.assetId],
      },
      {
        coverAssetId: alternativeCover.assetId,
        deliveryStatus: "active",
        detailAssetIds: [],
        fallbackAssetId: alternativeFallback.assetId,
        imageSlot: "required_alternative",
        lookId: "look-alternative",
        servedCoverAssetId: alternativeCover.assetId,
        servedDetailAssetIds: [],
      },
      {
        coverAssetId: optionalCover.assetId,
        deliveryStatus: "active",
        detailAssetIds: [],
        fallbackAssetId: null,
        imageSlot: "optional",
        lookId: "look-optional",
        servedCoverAssetId: optionalCover.assetId,
        servedDetailAssetIds: [],
      },
    ],
    withdrawalEvents: [],
  };
}

describe("projectPublishedDailyContent", () => {
  it("exposes only the currently served cover and detail image fields", () => {
    const projected = projectPublishedDailyContent(publishedVersion(), activeImageSet());

    expect(projected?.looks[0]?.coverImage).toEqual({
      aiDisclosure: null,
      aiGenerated: false,
      altText: "asset-primary-cover 穿搭图",
      assetId: "asset-primary-cover",
      height: 1600,
      mediaType: "image/webp",
      url: "https://cdn.five.test/asset-primary-cover.webp",
      width: 1200,
    });
    expect(projected?.looks[0]?.detailImages).toEqual([
      {
        aiDisclosure: "AI 生成穿搭示意图",
        aiGenerated: true,
        altText: "asset-primary-detail 穿搭图",
        assetId: "asset-primary-detail",
        height: 1600,
        mediaType: "image/webp",
        url: "https://cdn.five.test/asset-primary-detail.webp",
        width: 1200,
      },
    ]);
    expect(projected?.versions).toEqual({
      algorithmVersion: "algorithm-v1",
      assetManifestVersion: "assets-v1",
      calendarDataVersion: "calendar-data-v1",
      calendarRuleVersion: "calendar-rule-v1",
      contentVersion,
      copyVersion: "copy-v1",
      outfitVersion: "outfit-v1",
      posterTemplateVersion: "poster-v1",
    });
    expect(JSON.stringify(projected)).not.toContain("sha256");
    expect(JSON.stringify(projected)).not.toContain("manualReview");
    expect(JSON.stringify(projected)).not.toContain("rightsRecordIds");
  });

  it("uses the frozen fallback when a required cover is no longer served", () => {
    const imageSet = activeImageSet();
    const primarySlot = imageSet.slots[0]!;
    if (primarySlot.imageSlot !== "required_primary") throw new Error("primary slot missing");
    imageSet.slots[0] = {
      ...primarySlot,
      deliveryStatus: "fallback",
      servedCoverAssetId: primaryFallback.assetId,
    };
    imageSet.withdrawalEvents.push({
      assetId: primaryCover.assetId,
      auditEventId: "audit-primary-cover-withdrawn",
      reason: "版权材料失效。",
      withdrawalEventId: "withdraw-primary-cover",
      withdrawnAt: "2026-08-02T12:00:00.000Z",
    });

    const projected = projectPublishedDailyContent(publishedVersion(), imageSet);

    expect(projected?.looks[0]?.coverImage).toEqual({
      aiDisclosure: "AI 生成穿搭示意图",
      aiGenerated: true,
      altText: "asset-primary-fallback 穿搭图",
      assetId: "asset-primary-fallback",
      height: 1600,
      mediaType: "image/webp",
      url: "https://cdn.five.test/asset-primary-fallback.webp",
      width: 1200,
    });
  });

  it("omits an optional look whose current delivery projection is omitted", () => {
    const imageSet = activeImageSet();
    const optionalSlot = imageSet.slots[2]!;
    if (optionalSlot.imageSlot !== "optional") throw new Error("optional slot missing");
    imageSet.slots[2] = {
      ...optionalSlot,
      deliveryStatus: "omitted",
      servedCoverAssetId: null,
    };
    imageSet.withdrawalEvents.push({
      assetId: optionalCover.assetId,
      auditEventId: "audit-optional-cover-withdrawn",
      reason: "可选图片停止交付。",
      withdrawalEventId: "withdraw-optional-cover",
      withdrawnAt: "2026-08-02T12:00:00.000Z",
    });

    const projected = projectPublishedDailyContent(publishedVersion(), imageSet);

    expect(projected?.looks.map((look) => look.lookId)).toEqual([
      "look-primary",
      "look-alternative",
    ]);
  });

  it.each([
    ["an unpublished version", publishedVersion({ state: "approved" })],
    ["a missing effectiveFrom", publishedVersion({ effectiveFrom: null })],
    ["a missing effectiveTo", publishedVersion({ effectiveTo: null })],
  ])("rejects %s", (_label, version) => {
    expect(projectPublishedDailyContent(version, activeImageSet())).toBeNull();
  });

  it("rejects a served image that no longer satisfies the reviewed delivery contract", () => {
    const imageSet = activeImageSet();
    imageSet.assets[0] = { ...imageSet.assets[0]!, rightsStatus: "revoked" };

    expect(projectPublishedDailyContent(publishedVersion(), imageSet)).toBeNull();
  });

  it("projects a scheduled admin preview with only the two required named slots", () => {
    const imageSet = activeImageSet();
    imageSet.slots = imageSet.slots.filter((slot) => slot.imageSlot !== "optional");

    const projected = projectAdminDailyContentSnapshot(
      publishedVersion({ state: "scheduled" }),
      imageSet,
      new Set(["scheduled"]),
    );

    expect(projected?.looks.map((look) => look.lookId)).toEqual([
      "look-primary",
      "look-alternative",
    ]);
    expect(
      projected?.looks.flatMap((look) => [
        look.coverImage.url,
        ...look.detailImages.map((image) => image.url),
      ]),
    ).toEqual([
      "/admin/api/v1/image-assets/asset-primary-cover/preview",
      "/admin/api/v1/image-assets/asset-primary-detail/preview",
      "/admin/api/v1/image-assets/asset-alternative-cover/preview",
    ]);
  });
});
