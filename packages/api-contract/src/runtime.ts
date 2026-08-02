import type { components } from "./generated";

export type DraftModuleCode = components["schemas"]["ModuleCode"];
export type DraftModuleUpdate = components["schemas"]["DraftModuleUpdate"];

export const DRAFT_MODULE_CODES = [
  "calendar_algorithm",
  "copy_and_formula",
  "visual_and_rights",
  "poster_consistency",
] as const satisfies readonly DraftModuleCode[];

export const DRAFT_MODULE_REQUIRED_KEYS = {
  calendar_algorithm: [
    "algorithmVersion",
    "calendar",
    "calendarDataVersion",
    "calendarRuleVersion",
    "tiers",
  ],
  copy_and_formula: [
    "balanceSuggestion",
    "basis",
    "copyVersion",
    "outfitFormulas",
    "outfitVersion",
    "share",
  ],
  poster_consistency: ["posterTemplateVersion", "sampleAssetId", "templateId"],
  visual_and_rights: ["assetManifestVersion", "assets", "looks", "rightsRecords"],
} as const satisfies Record<DraftModuleCode, readonly string[]>;

const MODULE_CODE_SET = new Set<string>(DRAFT_MODULE_CODES);
const ACCESSORY_EXAMPLE_SET = new Set([
  "丝巾",
  "围巾",
  "包",
  "鞋",
  "领带",
  "耳饰",
  "手机壳",
  "帽子",
  "腰带",
  "首饰",
]);
const BRANCH_SET = new Set([
  "子",
  "丑",
  "寅",
  "卯",
  "辰",
  "巳",
  "午",
  "未",
  "申",
  "酉",
  "戌",
  "亥",
]);
const ELEMENT_CODE_SET = new Set(["wood", "fire", "earth", "metal", "water"]);
const ELEMENT_LABEL_SET = new Set(["木", "火", "土", "金", "水"]);
const TIER_CODE_SET = new Set(["da_ji", "ci_ji", "ping", "jiao_cha", "bu_li"]);
const ALGORITHM_LABEL_SET = new Set(["大吉", "次吉", "平", "较差", "不利"]);
const DISPLAY_LABEL_SET = new Set(["今日优先", "稳妥选择", "日常可穿", "注意"]);
const GARMENT_CATEGORY_SET = new Set([
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "bag",
  "accessory",
]);
const IMAGE_MEDIA_TYPE_SET = new Set(["image/avif", "image/webp", "image/jpeg", "image/png"]);
const IMAGE_SOURCE_TYPE_SET = new Set(["licensed", "ai_generated", "fallback_template"]);
const IMAGE_REVIEW_STATUS_SET = new Set(["pending", "approved", "rejected", "withdrawn"]);
const RIGHTS_STATUS_SET = new Set(["pending", "cleared", "rejected", "revoked"]);
const AI_LABEL_STATUS_SET = new Set(["not_applicable", "pending", "complete", "failed"]);
const RIGHTS_KIND_SET = new Set([
  "license",
  "terms_snapshot",
  "purchase_receipt",
  "consent",
  "internal_record",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
  if (typeof value !== "string") return false;
  const length = Array.from(value).length;
  return length >= minimum && length <= maximum;
}

function isVersionLabel(value: unknown): value is string {
  return isBoundedString(value, 1, 128) && value.trim().length > 0;
}

function isSafeInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isArrayOf(
  value: unknown,
  minimum: number,
  maximum: number,
  predicate: (item: unknown) => boolean,
): boolean {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every(predicate)
  );
}

function isUniqueStringArray(
  value: unknown,
  minimum: number,
  maximum: number,
  predicate: (item: unknown) => item is string,
): value is string[] {
  return (
    isArrayOf(value, minimum, maximum, predicate) &&
    new Set(value as string[]).size === (value as string[]).length
  );
}

function isOpaqueId(value: unknown): value is string {
  if (!isBoundedString(value, 1, 128) || value.trim() !== value) return false;
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function isStrictRfc3339DateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function isUri(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isCalendarInfo(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "branch",
      "dayElement",
      "dayElementLabel",
      "ganzhiDay",
      "lunarDateText",
      "weekdayText",
    ]) &&
    isBoundedString(value.weekdayText, 1, 16) &&
    isBoundedString(value.lunarDateText, 1, 32) &&
    isBoundedString(value.ganzhiDay, 2, 8) &&
    typeof value.branch === "string" &&
    BRANCH_SET.has(value.branch) &&
    typeof value.dayElement === "string" &&
    ELEMENT_CODE_SET.has(value.dayElement) &&
    typeof value.dayElementLabel === "string" &&
    ELEMENT_LABEL_SET.has(value.dayElementLabel)
  );
}

function isColorRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["colorCode", "name"]) &&
    isBoundedString(value.colorCode, 1, 64) &&
    isBoundedString(value.name, 1, 32)
  );
}

function isTier(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "algorithmLabel",
      "colors",
      "displayLabel",
      "displaySection",
      "element",
      "elementLabel",
      "explanation",
      "rank",
      "relationText",
      "tierCode",
    ]) &&
    isSafeInteger(value.rank, 1, 5) &&
    typeof value.tierCode === "string" &&
    TIER_CODE_SET.has(value.tierCode) &&
    typeof value.algorithmLabel === "string" &&
    ALGORITHM_LABEL_SET.has(value.algorithmLabel) &&
    typeof value.displayLabel === "string" &&
    DISPLAY_LABEL_SET.has(value.displayLabel) &&
    (value.displaySection === "primary" || value.displaySection === "attention") &&
    typeof value.element === "string" &&
    ELEMENT_CODE_SET.has(value.element) &&
    typeof value.elementLabel === "string" &&
    ELEMENT_LABEL_SET.has(value.elementLabel) &&
    isArrayOf(value.colors, 1, 12, isColorRef) &&
    isBoundedString(value.relationText, 1, 64) &&
    isBoundedString(value.explanation, 1, 300)
  );
}

function isBalanceSuggestion(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["accessoryExamples", "description", "preferredTierCode", "title"]) &&
    value.title === "已经穿了注意色" &&
    value.description === "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。" &&
    value.preferredTierCode === "da_ji" &&
    isUniqueStringArray(
      value.accessoryExamples,
      1,
      10,
      (item): item is string => typeof item === "string" && ACCESSORY_EXAMPLE_SET.has(item),
    )
  );
}

function isCodeLabel(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["code", "label"]) &&
    isBoundedString(value.code, 1, 64) &&
    isBoundedString(value.label, 1, 32)
  );
}

function isOutfitSlot(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "colorCodes",
      "garmentParts",
      "ratioPercent",
      "role",
      "roleLabel",
      "tierCode",
    ]) &&
    (value.role === "primary" || value.role === "secondary" || value.role === "accent") &&
    (value.roleLabel === "主色" || value.roleLabel === "辅助色" || value.roleLabel === "点缀色") &&
    typeof value.tierCode === "string" &&
    TIER_CODE_SET.has(value.tierCode) &&
    isUniqueStringArray(value.colorCodes, 1, 12, (item): item is string =>
      isBoundedString(item, 1, 64),
    ) &&
    (value.ratioPercent === null || isSafeInteger(value.ratioPercent, 1, 100)) &&
    isArrayOf(value.garmentParts, 1, 12, (item) => isBoundedString(item, 1, 32))
  );
}

function isOutfitFormula(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "audience",
      "disclaimer",
      "formulaId",
      "kind",
      "lookIds",
      "scenario",
      "slots",
      "title",
    ]) &&
    isOpaqueId(value.formulaId) &&
    (value.kind === "mono" || value.kind === "dual" || value.kind === "triple") &&
    isBoundedString(value.title, 1, 80) &&
    isCodeLabel(value.scenario) &&
    isCodeLabel(value.audience) &&
    isArrayOf(value.slots, 1, 3, isOutfitSlot) &&
    isUniqueStringArray(value.lookIds, 0, 3, isOpaqueId) &&
    isBoundedString(value.disclaimer, 1, 300)
  );
}

function isBasis(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["disclaimer", "steps"]) &&
    isArrayOf(value.steps, 1, 12, (item) => isBoundedString(item, 0, 300)) &&
    isBoundedString(value.disclaimer, 1, 300)
  );
}

function isShareContent(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "copyText",
      "posterJobEndpoint",
      "posterTemplateVersion",
      "summaryText",
    ]) &&
    isBoundedString(value.summaryText, 1, 200) &&
    isBoundedString(value.copyText, 1, 500) &&
    isVersionLabel(value.posterTemplateVersion) &&
    value.posterJobEndpoint === "/api/v1/poster-jobs"
  );
}

function isGarmentItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["category", "categoryLabel", "colorCode", "description"]) &&
    typeof value.category === "string" &&
    GARMENT_CATEGORY_SET.has(value.category) &&
    isBoundedString(value.categoryLabel, 1, 32) &&
    isBoundedString(value.colorCode, 1, 64) &&
    isBoundedString(value.description, 1, 120)
  );
}

function isLookAlternative(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["description", "replaceCategory"]) &&
    isBoundedString(value.replaceCategory, 0, 64) &&
    isBoundedString(value.description, 0, 200)
  );
}

function isAdminImageAsset(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "aiLabelStatus",
      "altText",
      "assetId",
      "declaredModel",
      "fileUrl",
      "generatedAt",
      "height",
      "mediaType",
      "promptVersion",
      "reviewStatus",
      "rightsRecordIds",
      "rightsStatus",
      "sha256",
      "sourceType",
      "width",
    ]) &&
    isOpaqueId(value.assetId) &&
    (value.fileUrl === null || isUri(value.fileUrl)) &&
    isSafeInteger(value.width, 1) &&
    isSafeInteger(value.height, 1) &&
    typeof value.mediaType === "string" &&
    IMAGE_MEDIA_TYPE_SET.has(value.mediaType) &&
    isBoundedString(value.altText, 1, 300) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sha256) &&
    typeof value.sourceType === "string" &&
    IMAGE_SOURCE_TYPE_SET.has(value.sourceType) &&
    (value.declaredModel === null || isVersionLabel(value.declaredModel)) &&
    (value.promptVersion === null || isVersionLabel(value.promptVersion)) &&
    (value.generatedAt === null || isStrictRfc3339DateTime(value.generatedAt)) &&
    typeof value.reviewStatus === "string" &&
    IMAGE_REVIEW_STATUS_SET.has(value.reviewStatus) &&
    typeof value.rightsStatus === "string" &&
    RIGHTS_STATUS_SET.has(value.rightsStatus) &&
    typeof value.aiLabelStatus === "string" &&
    AI_LABEL_STATUS_SET.has(value.aiLabelStatus) &&
    isUniqueStringArray(value.rightsRecordIds, 0, 20, isOpaqueId)
  );
}

function isLookDraft(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "alternatives",
      "audience",
      "coverAssetId",
      "detailAssetIds",
      "formulaId",
      "items",
      "lookId",
      "requiredForPublish",
      "scenario",
      "sortOrder",
      "title",
    ]) &&
    isOpaqueId(value.lookId) &&
    isOpaqueId(value.formulaId) &&
    typeof value.requiredForPublish === "boolean" &&
    isSafeInteger(value.sortOrder, 1, 3) &&
    isBoundedString(value.title, 1, 80) &&
    isCodeLabel(value.scenario) &&
    isCodeLabel(value.audience) &&
    isOpaqueId(value.coverAssetId) &&
    isUniqueStringArray(value.detailAssetIds, 0, 4, isOpaqueId) &&
    isArrayOf(value.items, 1, 12, isGarmentItem) &&
    isArrayOf(value.alternatives, 0, 12, isLookAlternative)
  );
}

function isRightsRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["kind", "recordedAt", "reference", "rightsRecordId"]) &&
    isOpaqueId(value.rightsRecordId) &&
    typeof value.kind === "string" &&
    RIGHTS_KIND_SET.has(value.kind) &&
    isBoundedString(value.reference, 1, 500) &&
    isStrictRfc3339DateTime(value.recordedAt)
  );
}

function isCalendarAlgorithmModule(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, DRAFT_MODULE_REQUIRED_KEYS.calendar_algorithm) &&
    isCalendarInfo(value.calendar) &&
    isArrayOf(value.tiers, 5, 5, isTier) &&
    isVersionLabel(value.calendarDataVersion) &&
    isVersionLabel(value.calendarRuleVersion) &&
    isVersionLabel(value.algorithmVersion)
  );
}

function isCopyAndFormulaModule(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, DRAFT_MODULE_REQUIRED_KEYS.copy_and_formula) &&
    isBalanceSuggestion(value.balanceSuggestion) &&
    isArrayOf(value.outfitFormulas, 3, Number.MAX_SAFE_INTEGER, isOutfitFormula) &&
    isBasis(value.basis) &&
    isShareContent(value.share) &&
    isVersionLabel(value.copyVersion) &&
    isVersionLabel(value.outfitVersion)
  );
}

function isVisualAndRightsModule(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, DRAFT_MODULE_REQUIRED_KEYS.visual_and_rights) &&
    isArrayOf(value.looks, 2, 3, isLookDraft) &&
    isArrayOf(value.assets, 2, Number.MAX_SAFE_INTEGER, isAdminImageAsset) &&
    isArrayOf(value.rightsRecords, 0, Number.MAX_SAFE_INTEGER, isRightsRecord) &&
    isVersionLabel(value.assetManifestVersion)
  );
}

function isPosterConsistencyModule(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, DRAFT_MODULE_REQUIRED_KEYS.poster_consistency) &&
    isVersionLabel(value.posterTemplateVersion) &&
    isOpaqueId(value.templateId) &&
    isOpaqueId(value.sampleAssetId)
  );
}

export function isDraftModuleCode(value: unknown): value is DraftModuleCode {
  return typeof value === "string" && MODULE_CODE_SET.has(value);
}

export function isDraftModuleUpdate(
  moduleCode: DraftModuleCode,
  value: unknown,
): value is DraftModuleUpdate {
  if (moduleCode === "calendar_algorithm") return isCalendarAlgorithmModule(value);
  if (moduleCode === "copy_and_formula") return isCopyAndFormulaModule(value);
  if (moduleCode === "visual_and_rights") return isVisualAndRightsModule(value);
  return isPosterConsistencyModule(value);
}
