import { CALENDAR_RULE_VERSION, CalendarRuleEngine } from "../calendar/calendar-rule-engine";
import { isDeliverableAdminImageAsset } from "@five/api-contract/runtime";
import type { FiveElement } from "../calendar/calendar-rule-engine";
import {
  CURRENT_CALENDAR_ALGORITHM_VERSION,
  CURRENT_CALENDAR_DATA_VERSION,
} from "../calendar/calendar-content.values";
import {
  FIVE_ELEMENT_PRESENTATION,
  TIER_CODES_IN_RANK_ORDER,
  TIER_PRESENTATION,
} from "../calendar/five-element-presentation";
import { assessCurrentImageReleaseSafety } from "../daily-images/current-image-release-safety";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";
import type {
  DraftModules,
  PreflightCheck,
  StoredMasterReviewEvidence,
} from "./content-lifecycle.store";

export {
  CURRENT_CALENDAR_ALGORITHM_VERSION,
  CURRENT_CALENDAR_DATA_VERSION,
} from "../calendar/calendar-content.values";

const CALENDAR_ENGINE = new CalendarRuleEngine();

type CheckCode = PreflightCheck["code"];

const CHECK_ORDER: readonly CheckCode[] = [
  "calendar_algorithm",
  "calendar_golden_data",
  "master_review_evidence",
  "copy_and_formula",
  "required_images",
  "visual_and_rights",
  "ai_label",
  "poster_consistency",
  "reference_integrity",
];

function check(code: CheckCode, passed: boolean, passedMessage: string, failedMessage: string) {
  return {
    code,
    message: passed ? passedMessage : failedMessage,
    status: passed ? ("passed" as const) : ("failed" as const),
  };
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function hasFixedElementPalette(
  element: FiveElement,
  colors: ReadonlyArray<{ readonly colorCode: string; readonly name: string }>,
): boolean {
  const expected = FIVE_ELEMENT_PRESENTATION[element].colors;
  if (colors.length !== expected.length) return false;
  const actual = new Map(colors.map((color) => [color.colorCode, color.name]));
  return (
    actual.size === expected.length &&
    expected.every((color) => actual.get(color.colorCode) === color.name)
  );
}

function hasExpectedTierMetadata(
  tier: NonNullable<DraftModules["calendar_algorithm"]>["tiers"][number],
  index: number,
): boolean {
  const tierCode = TIER_CODES_IN_RANK_ORDER[index];
  if (tierCode === undefined) return false;
  const expected = TIER_PRESENTATION[tierCode];
  return (
    tier.rank === expected.rank &&
    tier.tierCode === tierCode &&
    tier.algorithmLabel === expected.algorithmLabel &&
    tier.displayLabel === expected.displayLabel &&
    tier.displaySection === expected.displaySection &&
    tier.elementLabel === FIVE_ELEMENT_PRESENTATION[tier.element].label
  );
}

function latestEvidence(
  evidence: readonly StoredMasterReviewEvidence[],
): StoredMasterReviewEvidence | null {
  return evidence.at(-1) ?? null;
}

function hasRequiredFormulaKinds(
  formulas: NonNullable<DraftModules["copy_and_formula"]>["outfitFormulas"],
): boolean {
  const kinds = new Set(formulas.map((formula) => formula.kind));
  const expectedSlotCount = { dual: 2, mono: 1, triple: 3 } as const;
  const validSlotSemantics = (
    formula: NonNullable<DraftModules["copy_and_formula"]>["outfitFormulas"][number],
  ): boolean => {
    const tiersByRole = new Map(formula.slots.map((slot) => [slot.role, slot.tierCode]));
    if (tiersByRole.size !== formula.slots.length || tiersByRole.get("primary") !== "da_ji") {
      return false;
    }
    if (formula.kind === "mono") return tiersByRole.size === 1;
    const secondaryTier = tiersByRole.get("secondary");
    if (formula.kind === "dual") {
      return tiersByRole.size === 2 && (secondaryTier === "ci_ji" || secondaryTier === "ping");
    }
    return (
      tiersByRole.size === 3 && secondaryTier === "ci_ji" && tiersByRole.get("accent") === "ping"
    );
  };
  const validTripleRatio = (
    formula: NonNullable<DraftModules["copy_and_formula"]>["outfitFormulas"][number],
  ): boolean => {
    if (formula.kind !== "triple") return true;
    const ratios = formula.slots.map((slot) => slot.ratioPercent);
    return (
      ratios.every((ratio) => ratio === null) ||
      (ratios.every((ratio): ratio is number => ratio !== null) &&
        ratios.reduce((total, ratio) => total + ratio, 0) === 100)
    );
  };
  return (
    kinds.has("mono") &&
    kinds.has("dual") &&
    kinds.has("triple") &&
    formulas.every(
      (formula) =>
        formula.slots.length === expectedSlotCount[formula.kind] &&
        validSlotSemantics(formula) &&
        validTripleRatio(formula),
    )
  );
}

function lookMatchesFormulaRole(
  look: NonNullable<DraftModules["visual_and_rights"]>["looks"][number],
  formula: NonNullable<DraftModules["copy_and_formula"]>["outfitFormulas"][number] | undefined,
): boolean {
  if (formula === undefined) return false;
  const tiers = new Set(formula.slots.map((slot) => slot.tierCode));
  const hasGreatFortunePrimary = formula.slots.some(
    (slot) => slot.role === "primary" && slot.tierCode === "da_ji",
  );
  if (look.imageSlot === "required_primary") {
    return hasGreatFortunePrimary;
  }
  if (look.imageSlot === "required_alternative") {
    return formula.kind === "dual" && hasGreatFortunePrimary && tiers.has("ci_ji");
  }
  return hasGreatFortunePrimary;
}

export function evaluateContentPreflight(
  snapshot: DraftModules,
  evidence: readonly StoredMasterReviewEvidence[],
  fortuneDate: string,
  currentImageSet: StoredDailyImageSet | null | undefined = undefined,
  globallyWithdrawnAssetIds: readonly string[] = [],
): PreflightCheck[] {
  const calendar = snapshot.calendar_algorithm;
  const copy = snapshot.copy_and_formula;
  const visual = snapshot.visual_and_rights;
  const poster = snapshot.poster_consistency;
  const assets = new Map(visual?.assets.map((asset) => [asset.assetId, asset]) ?? []);
  const rights = new Set(visual?.rightsRecords.map((record) => record.rightsRecordId) ?? []);
  const formulas = new Map(
    copy?.outfitFormulas.map((formula) => [formula.formulaId, formula]) ?? [],
  );
  const looks = new Map(visual?.looks.map((look) => [look.lookId, look]) ?? []);
  const tierColors = new Map(
    calendar?.tiers.map((tier) => [
      tier.tierCode,
      new Set(tier.colors.map((color) => color.colorCode)),
    ]) ?? [],
  );
  const currentImageSafety = assessCurrentImageReleaseSafety(
    currentImageSet ?? null,
    globallyWithdrawnAssetIds,
  );
  const currentImageSetReady =
    currentImageSet === undefined || visual === null || currentImageSet !== null;
  const calendarReady =
    calendar !== null &&
    calendar.tiers.length === 5 &&
    calendar.tiers.every(
      (tier, index) =>
        hasExpectedTierMetadata(tier, index) && hasFixedElementPalette(tier.element, tier.colors),
    );
  const expectedCalendar = CALENDAR_ENGINE.evaluate(fortuneDate);
  const goldenDataReady =
    calendar !== null &&
    fortuneDate >= "2026-01-01" &&
    fortuneDate <= "2027-01-01" &&
    calendar.calendarDataVersion === CURRENT_CALENDAR_DATA_VERSION &&
    calendar.calendarRuleVersion === CALENDAR_RULE_VERSION &&
    calendar.algorithmVersion === CURRENT_CALENDAR_ALGORITHM_VERSION &&
    calendar.calendar.ganzhiDay === expectedCalendar.ganzhiDay &&
    calendar.calendar.branch === expectedCalendar.dayBranch &&
    calendar.calendar.dayElement === expectedCalendar.dayElement &&
    calendar.calendar.dayElementLabel ===
      FIVE_ELEMENT_PRESENTATION[expectedCalendar.dayElement].label &&
    calendar.tiers.length === expectedCalendar.tiers.length &&
    calendar.tiers.every((tier, index) => {
      const expectedTier = expectedCalendar.tiers[index];
      return (
        expectedTier !== undefined &&
        tier.rank === expectedTier.rank &&
        tier.tierCode === expectedTier.tierCode &&
        tier.element === expectedTier.element &&
        tier.elementLabel === FIVE_ELEMENT_PRESENTATION[expectedTier.element].label
      );
    });
  const currentEvidence = latestEvidence(evidence);
  const masterConfirmed =
    currentEvidence !== null &&
    currentEvidence.conclusion === "confirmed" &&
    nonBlank(currentEvidence.reviewerDisplayName) &&
    !Number.isNaN(Date.parse(currentEvidence.reviewedAt)) &&
    currentEvidence.references.length > 0 &&
    currentEvidence.references.every((reference) => nonBlank(reference.reference));
  const copyReady =
    copy !== null &&
    copy.outfitFormulas.length >= 3 &&
    hasRequiredFormulaKinds(copy.outfitFormulas);
  const usableAsset = (assetId: string): boolean => {
    const asset = assets.get(assetId);
    return (
      asset !== undefined &&
      !currentImageSafety.withdrawnAssetIds.has(assetId) &&
      isDeliverableAdminImageAsset(asset) &&
      asset.rightsRecordIds.every((rightsRecordId) => rights.has(rightsRecordId))
    );
  };
  const requiredLooks =
    visual?.looks.filter(
      (look) => look.imageSlot === "required_primary" || look.imageSlot === "required_alternative",
    ) ?? [];
  const slotCodes = visual?.looks.map((look) => look.imageSlot) ?? [];
  const coverAssetIds = visual?.looks.map((look) => look.coverAssetId) ?? [];
  const slotShapeReady =
    slotCodes.filter((slot) => slot === "required_primary").length === 1 &&
    slotCodes.filter((slot) => slot === "required_alternative").length === 1 &&
    slotCodes.filter((slot) => slot === "optional").length <= 1 &&
    new Set(coverAssetIds).size === coverAssetIds.length &&
    visual?.looks.every(
      (look) =>
        look.requiredForPublish === (look.imageSlot !== "optional") &&
        (look.imageSlot === "optional"
          ? look.fallbackAssetId === null || usableAsset(look.fallbackAssetId)
          : look.fallbackAssetId !== null && usableAsset(look.fallbackAssetId)),
    ) === true;
  const requiredImagesReady =
    slotShapeReady &&
    currentImageSetReady &&
    currentImageSafety.requiredSlotsSafe &&
    requiredLooks.length === 2 &&
    new Set(requiredLooks.map((look) => look.coverAssetId)).size === 2 &&
    requiredLooks.every(
      (look) =>
        usableAsset(look.coverAssetId) ||
        (look.fallbackAssetId !== null && usableAsset(look.fallbackAssetId)),
    );
  const deliveryCriticalAssetIds = new Set(
    requiredLooks.flatMap((look) => [
      ...(usableAsset(look.coverAssetId) ? [look.coverAssetId] : []),
      ...(look.fallbackAssetId === null ? [] : [look.fallbackAssetId]),
    ]),
  );
  if (poster !== null) deliveryCriticalAssetIds.add(poster.sampleAssetId);
  const visualReady =
    visual !== null &&
    slotShapeReady &&
    requiredImagesReady &&
    [...deliveryCriticalAssetIds].every(usableAsset);
  const aiLabelsReady = [...deliveryCriticalAssetIds].every(usableAsset);
  const posterReady =
    poster !== null &&
    copy !== null &&
    poster.posterTemplateVersion === copy.share.posterTemplateVersion &&
    usableAsset(poster.sampleAssetId);
  const referencesReady =
    copy !== null &&
    visual !== null &&
    poster !== null &&
    copy.outfitFormulas.every(
      (formula) =>
        formula.slots.every((slot) => {
          const declaredColors = tierColors.get(slot.tierCode);
          return (
            declaredColors !== undefined &&
            slot.colorCodes.every((colorCode) => declaredColors.has(colorCode))
          );
        }) && formula.lookIds.every((lookId) => looks.get(lookId)?.formulaId === formula.formulaId),
    ) &&
    visual.looks.every((look) => {
      const formula = formulas.get(look.formulaId);
      const formulaColors = new Set(formula?.slots.flatMap((slot) => slot.colorCodes) ?? []);
      return (
        formula !== undefined &&
        lookMatchesFormulaRole(look, formula) &&
        formula.lookIds.includes(look.lookId) &&
        look.items.every((item) => formulaColors.has(item.colorCode)) &&
        assets.has(look.coverAssetId) &&
        look.detailAssetIds.every((assetId) => assets.has(assetId)) &&
        (look.fallbackAssetId === null || assets.has(look.fallbackAssetId))
      );
    }) &&
    assets.has(poster.sampleAssetId);

  const checks: Record<CheckCode, PreflightCheck> = {
    ai_label: check(
      "ai_label",
      aiLabelsReady,
      "AI 生成内容标识状态完整。",
      "AI 生成内容标识尚未全部完成。",
    ),
    calendar_algorithm: check(
      "calendar_algorithm",
      calendarReady,
      "日历算法模块与完整五档已冻结。",
      "日历算法模块或完整五档缺失。",
    ),
    calendar_golden_data: check(
      "calendar_golden_data",
      goldenDataReady,
      "固定答案、规则与算法版本已绑定。",
      "固定答案、规则或算法版本未绑定。",
    ),
    copy_and_formula: check(
      "copy_and_formula",
      copyReady,
      "文案与三套穿搭公式已冻结。",
      "文案或三套穿搭公式不完整。",
    ),
    master_review_evidence: check(
      "master_review_evidence",
      masterConfirmed,
      "最新大师核对依据已确认当前版本。",
      "缺少覆盖当前版本的完整大师确认依据。",
    ),
    poster_consistency: check(
      "poster_consistency",
      posterReady,
      "海报模板和已审核样张已绑定。",
      "海报模板或已审核样张缺失。",
    ),
    reference_integrity: check(
      "reference_integrity",
      referencesReady,
      "公式、搭配、素材和海报引用完整。",
      "公式、搭配、素材或海报引用不完整。",
    ),
    required_images: check(
      "required_images",
      requiredImagesReady,
      "两张必备图片均可安全使用。",
      "必须恰有两张可安全使用的必备图片。",
    ),
    visual_and_rights: check(
      "visual_and_rights",
      visualReady,
      "图片人工检查和权利材料完整。",
      "图片人工检查或权利材料不完整。",
    ),
  };
  return CHECK_ORDER.map((code) => checks[code]);
}
