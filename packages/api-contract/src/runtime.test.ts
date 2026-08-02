import type { components } from "./generated";
import { describe, expect, it } from "vitest";

import {
  DRAFT_MODULE_CODES,
  DRAFT_MODULE_REQUIRED_KEYS,
  isDraftModuleCode,
  isDraftModuleUpdate,
} from "./runtime";

type DraftModuleCode = components["schemas"]["ModuleCode"];
type DraftModuleUpdate = components["schemas"]["DraftModuleUpdate"];

const modules = {
  calendar_algorithm: {
    algorithmVersion: "algorithm-v1",
    calendar: {
      branch: "申",
      dayElement: "metal",
      dayElementLabel: "金",
      ganzhiDay: "戊申",
      lunarDateText: "六月十九",
      weekdayText: "星期六",
    },
    calendarDataVersion: "calendar-data-v1",
    calendarRuleVersion: "calendar-rule-v1",
    tiers: [
      [1, "da_ji", "大吉", "今日优先", "primary", "water", "水"],
      [2, "ci_ji", "次吉", "稳妥选择", "primary", "metal", "金"],
      [3, "ping", "平", "日常可穿", "primary", "fire", "火"],
      [4, "jiao_cha", "较差", "注意", "attention", "earth", "土"],
      [5, "bu_li", "不利", "注意", "attention", "wood", "木"],
    ].map(
      ([rank, tierCode, algorithmLabel, displayLabel, displaySection, element, elementLabel]) => ({
        algorithmLabel,
        colors: [{ colorCode: `color-${rank}`, name: `颜色${rank}` }],
        displayLabel,
        displaySection,
        element,
        elementLabel,
        explanation: `说明${rank}`,
        rank,
        relationText: `关系${rank}`,
        tierCode,
      }),
    ),
  },
  copy_and_formula: {
    balanceSuggestion: {
      accessoryExamples: ["包", "鞋"],
      description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
      preferredTierCode: "da_ji",
      title: "已经穿了注意色",
    },
    basis: { disclaimer: "仅供参考", steps: ["确认命理日"] },
    copyVersion: "copy-v1",
    outfitFormulas: ["one", "two", "three"].map((suffix, index) => ({
      audience: { code: "all", label: "通用" },
      disclaimer: "仅供参考",
      formulaId: `formula-${suffix}`,
      kind: index === 0 ? "mono" : index === 1 ? "dual" : "triple",
      lookIds: [],
      scenario: { code: "daily", label: "日常" },
      slots: [
        {
          colorCodes: ["green"],
          garmentParts: ["上衣"],
          ratioPercent: 100,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
      ],
      title: `公式 ${suffix}`,
    })),
    outfitVersion: "outfit-v1",
    share: {
      copyText: "今日穿搭参考",
      posterJobEndpoint: "/api/v1/poster-jobs",
      posterTemplateVersion: "poster-v1",
      summaryText: "今日优先绿色",
    },
  },
  poster_consistency: {
    posterTemplateVersion: "poster-v1",
    sampleAssetId: "asset-1",
    templateId: "template-v1",
  },
  visual_and_rights: {
    assetManifestVersion: "assets-v1",
    assets: [1, 2].map((index) => ({
      aiLabelStatus: "not_applicable",
      altText: `搭配图 ${index}`,
      assetId: `asset-${index}`,
      declaredModel: null,
      fileUrl: `https://cdn.example.com/asset-${index}.webp`,
      generatedAt: null,
      height: 1200,
      mediaType: "image/webp",
      promptVersion: null,
      reviewStatus: "approved",
      rightsRecordIds: [`rights-${index}`],
      rightsStatus: "cleared",
      sha256: String(index).repeat(64),
      sourceType: "licensed",
      width: 900,
    })),
    looks: [1, 2].map((index) => ({
      alternatives: [],
      audience: { code: "all", label: "通用" },
      coverAssetId: `asset-${index}`,
      detailAssetIds: [],
      formulaId: `formula-${index === 1 ? "one" : "two"}`,
      items: [
        {
          category: "top",
          categoryLabel: "上衣",
          colorCode: "green",
          description: "绿色上衣",
        },
      ],
      lookId: `look-${index}`,
      requiredForPublish: true,
      scenario: { code: "daily", label: "日常" },
      sortOrder: index,
      title: `搭配 ${index}`,
    })),
    rightsRecords: [1, 2].map((index) => ({
      kind: "license",
      recordedAt: "2026-07-31T23:00:00+08:00",
      reference: `license-${index}`,
      rightsRecordId: `rights-${index}`,
    })),
  },
} as unknown as Record<DraftModuleCode, DraftModuleUpdate>;

describe("generated contract runtime guards", () => {
  it("keeps module values, required keys, and nested guards in one shared contract", () => {
    expect(DRAFT_MODULE_CODES).toEqual([
      "calendar_algorithm",
      "copy_and_formula",
      "visual_and_rights",
      "poster_consistency",
    ]);
    for (const moduleCode of DRAFT_MODULE_CODES) {
      expect(isDraftModuleCode(moduleCode)).toBe(true);
      expect(isDraftModuleUpdate(moduleCode, modules[moduleCode])).toBe(true);
      expect(Object.keys(modules[moduleCode]).sort()).toEqual(
        [...DRAFT_MODULE_REQUIRED_KEYS[moduleCode]].sort(),
      );
    }
  });

  it("rejects a valid module under the wrong module code", () => {
    expect(isDraftModuleUpdate("poster_consistency", modules.calendar_algorithm)).toBe(false);
  });

  it("rejects public five-tier labels that collapse the distinct lower tiers", () => {
    const calendar = structuredClone(modules.calendar_algorithm) as Record<string, unknown>;
    const tiers = calendar.tiers as Array<Record<string, unknown>>;
    tiers[3] = { ...tiers[3], algorithmLabel: "注意" };

    expect(isDraftModuleUpdate("calendar_algorithm", calendar)).toBe(false);
  });

  it("rejects invalid image and rights enum values", () => {
    const visual = structuredClone(modules.visual_and_rights) as Record<string, unknown>;
    const assets = visual.assets as Array<Record<string, unknown>>;
    const rightsRecords = visual.rightsRecords as Array<Record<string, unknown>>;
    assets[0] = { ...assets[0], rightsStatus: "unknown" };
    rightsRecords[0] = { ...rightsRecords[0], kind: "web_search" };

    expect(isDraftModuleUpdate("visual_and_rights", visual)).toBe(false);
  });
});
