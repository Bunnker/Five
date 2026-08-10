import type { components } from "@five/api-contract";

import type { FiveElement } from "../calendar/calendar-rule-engine";
import { StructuredDailyContentGenerator } from "../content-production/structured-daily-content.generator";
import { DEMO_POSTER_TEMPLATE_VERSION } from "../poster/poster-template.values";
import { PublicContentWindowResolver } from "../public-content/public-content-window-resolver";
import type { PublishedContentReader } from "./today-content.service";

type DailyContent = components["schemas"]["DailyContent"];
type OutfitFormula = components["schemas"]["OutfitFormula"];
type PublicImageAsset = components["schemas"]["PublicImageAsset"];
type PublicLook = components["schemas"]["PublicLook"];
type Tier = components["schemas"]["Tier"];

const PUBLIC_WINDOW = new PublicContentWindowResolver();
const STRUCTURED_GENERATOR = new StructuredDailyContentGenerator();
const DEMO_PLACEHOLDER_HEX: Readonly<Record<FiveElement, string>> = {
  earth: "B99A6A",
  fire: "C65B4B",
  metal: "D8CFBA",
  water: "354B66",
  wood: "4F8A6C",
};

function requireAt<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Missing ${label} at index ${index}`);
  }
  return value;
}

function requireTier(tiers: readonly Tier[], tierCode: Tier["tierCode"]): Tier {
  const tier = tiers.find((candidate) => candidate.tierCode === tierCode);
  if (tier === undefined) {
    throw new Error(`Missing demo ${tierCode} tier`);
  }
  return tier;
}

function requireFormula(
  formulas: readonly OutfitFormula[],
  kind: OutfitFormula["kind"],
): OutfitFormula {
  const formula = formulas.find((candidate) => candidate.kind === kind);
  if (formula === undefined) {
    throw new Error(`Missing demo ${kind} formula`);
  }
  return formula;
}

function requireTierColor(tier: Tier, colorCode: string): Tier["colors"][number] {
  const color = tier.colors.find((candidate) => candidate.colorCode === colorCode);
  if (color === undefined) {
    throw new Error(`Missing ${colorCode} in demo ${tier.tierCode} palette`);
  }
  return color;
}

function placeholderImage(assetId: string, title: string, element: FiveElement): PublicImageAsset {
  const background = DEMO_PLACEHOLDER_HEX[element];
  return {
    aiDisclosure: "AI 生成穿搭示意图",
    aiGenerated: true,
    altText: title,
    assetId,
    height: 1_600,
    mediaType: "image/png",
    url: `https://placehold.co/1200x1600/${background}/FFFFFF.png?text=FIVE%20DEMO&id=${assetId}`,
    width: 1_200,
  };
}

function createDemoLooks(tiers: readonly Tier[], formulas: readonly OutfitFormula[]): PublicLook[] {
  const daJi = requireTier(tiers, "da_ji");
  const ciJi = requireTier(tiers, "ci_ji");
  const ping = requireTier(tiers, "ping");
  const monoFormula = requireFormula(formulas, "mono");
  const dualFormula = requireFormula(formulas, "dual");
  const tripleFormula = requireFormula(formulas, "triple");
  const monoSlot = requireAt(monoFormula.slots, 0, "demo mono slot");
  const dualPrimarySlot = requireAt(dualFormula.slots, 0, "demo dual primary slot");
  const dualSecondarySlot = requireAt(dualFormula.slots, 1, "demo dual secondary slot");
  const triplePrimarySlot = requireAt(tripleFormula.slots, 0, "demo triple primary slot");
  const tripleSecondarySlot = requireAt(tripleFormula.slots, 1, "demo triple secondary slot");
  const tripleAccentSlot = requireAt(tripleFormula.slots, 2, "demo triple accent slot");
  const monoPrimary = requireTierColor(
    daJi,
    requireAt(monoSlot.colorCodes, 0, "demo mono primary color"),
  );
  const monoFamily = requireTierColor(
    daJi,
    requireAt(monoSlot.colorCodes, 1, "demo mono family color"),
  );
  const dualPrimary = requireTierColor(
    daJi,
    requireAt(dualPrimarySlot.colorCodes, 0, "demo dual primary color"),
  );
  const dualSecondary = requireTierColor(
    ciJi,
    requireAt(dualSecondarySlot.colorCodes, 0, "demo dual secondary color"),
  );
  const triplePrimary = requireTierColor(
    daJi,
    requireAt(triplePrimarySlot.colorCodes, 0, "demo triple primary color"),
  );
  const tripleSecondary = requireTierColor(
    ciJi,
    requireAt(tripleSecondarySlot.colorCodes, 0, "demo triple secondary color"),
  );
  const tripleAccent = requireTierColor(
    ping,
    requireAt(tripleAccentSlot.colorCodes, 0, "demo triple accent color"),
  );
  const monoLookId = requireAt(monoFormula.lookIds, 0, "demo mono look");
  const dualLookId = requireAt(dualFormula.lookIds, 0, "demo dual look");
  const tripleLookId = requireAt(tripleFormula.lookIds, 0, "demo triple look");

  const tripleLook: PublicLook = {
    alternatives: [
      {
        description: `配饰也可以换成其他小面积${tripleAccent.name}单品。`,
        replaceCategory: "配饰",
      },
    ],
    audience: tripleFormula.audience,
    coverImage: placeholderImage(
      "demo-asset-triple",
      `${triplePrimary.name}、${tripleSecondary.name}和${tripleAccent.name}通勤穿搭`,
      daJi.element,
    ),
    detailImages: [],
    formulaId: tripleFormula.formulaId,
    items: [
      {
        category: "top",
        categoryLabel: "上衣",
        colorCode: triplePrimary.colorCode,
        description: `${triplePrimary.name}通勤上衣`,
      },
      {
        category: "bottom",
        categoryLabel: "下装",
        colorCode: tripleSecondary.colorCode,
        description: `${tripleSecondary.name}通勤下装`,
      },
      {
        category: "accessory",
        categoryLabel: "鞋包/配饰",
        colorCode: tripleAccent.colorCode,
        description: `${tripleAccent.name}小面积点缀`,
      },
    ],
    lookId: tripleLookId,
    requiredForPublish: true,
    scenario: tripleFormula.scenario,
    sortOrder: 1,
    title: "今日通勤三色方案",
  };
  const dualLook: PublicLook = {
    alternatives: [
      {
        description: `上衣和下装的${dualPrimary.name}、${dualSecondary.name}可以互换。`,
        replaceCategory: "上下装",
      },
    ],
    audience: dualFormula.audience,
    coverImage: placeholderImage(
      "demo-asset-dual",
      `${dualPrimary.name}与${dualSecondary.name}日常穿搭`,
      ciJi.element,
    ),
    detailImages: [],
    formulaId: dualFormula.formulaId,
    items: [
      {
        category: "top",
        categoryLabel: "上衣",
        colorCode: dualPrimary.colorCode,
        description: `${dualPrimary.name}日常上衣`,
      },
      {
        category: "bottom",
        categoryLabel: "下装",
        colorCode: dualSecondary.colorCode,
        description: `${dualSecondary.name}简洁下装`,
      },
    ],
    lookId: dualLookId,
    requiredForPublish: true,
    scenario: dualFormula.scenario,
    sortOrder: 2,
    title: `${dualPrimary.name}与${dualSecondary.name}日常方案`,
  };
  const monoLook: PublicLook = {
    alternatives: [],
    audience: monoFormula.audience,
    coverImage: placeholderImage(
      "demo-asset-mono",
      `${monoPrimary.name}${monoFamily.name}同色系穿搭`,
      daJi.element,
    ),
    detailImages: [],
    formulaId: monoFormula.formulaId,
    items: [
      {
        category: "top",
        categoryLabel: "上衣",
        colorCode: monoPrimary.colorCode,
        description: `${monoPrimary.name}简洁上衣`,
      },
      {
        category: "bottom",
        categoryLabel: "下装",
        colorCode: monoFamily.colorCode,
        description: `${monoFamily.name}同色系下装`,
      },
    ],
    lookId: monoLookId,
    requiredForPublish: false,
    scenario: monoFormula.scenario,
    sortOrder: 3,
    title: `${monoPrimary.name}同色系日常方案`,
  };

  return [tripleLook, dualLook, monoLook];
}

/**
 * Explicit local-only adapter used when FIVE_DEMO_CONTENT=1 outside production.
 * All deterministic copy, calendar, tiers and formula references come from the
 * production generator; only image placeholders and demo version identity are
 * added here.
 */
export function createDemoDailyContent(fortuneDate: string): DailyContent {
  const publicWindow = PUBLIC_WINDOW.resolve(fortuneDate);
  const modules = STRUCTURED_GENERATOR.generate(fortuneDate);
  const calendar = modules.calendar_algorithm;
  const copy = modules.copy_and_formula;
  if (calendar === null || copy === null) {
    throw new Error("Structured generator returned incomplete demo modules");
  }

  return {
    balanceSuggestion: copy.balanceSuggestion,
    basis: copy.basis,
    calendar: calendar.calendar,
    effectiveFrom: publicWindow.effectiveFrom,
    effectiveTo: publicWindow.effectiveTo,
    fortuneDate,
    looks: createDemoLooks(calendar.tiers, copy.outfitFormulas),
    outfitFormulas: copy.outfitFormulas,
    share: {
      ...copy.share,
      posterTemplateVersion: DEMO_POSTER_TEMPLATE_VERSION,
    },
    tiers: calendar.tiers,
    versions: {
      algorithmVersion: calendar.algorithmVersion,
      assetManifestVersion: "demo-assets-v1",
      calendarDataVersion: calendar.calendarDataVersion,
      calendarRuleVersion: calendar.calendarRuleVersion,
      contentVersion: `demo-${fortuneDate}`,
      copyVersion: copy.copyVersion,
      outfitVersion: copy.outfitVersion,
      posterTemplateVersion: DEMO_POSTER_TEMPLATE_VERSION,
    },
  };
}

export class DemoPublishedContentReader implements PublishedContentReader {
  findActiveByFortuneDate(fortuneDate: string): Promise<DailyContent | null> {
    return Promise.resolve(createDemoDailyContent(fortuneDate));
  }
}
