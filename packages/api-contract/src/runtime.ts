import type { components } from "./generated";

export type DraftModuleCode = components["schemas"]["ModuleCode"];
export type DraftModuleUpdate = components["schemas"]["DraftModuleUpdate"];
export type ImageAssetUploadMetadata = components["schemas"]["ImageAssetUploadMetadata"];
export type ImageAssetReviewRequest = components["schemas"]["ImageAssetReviewRequest"];
export type DraftImageAssetResult = components["schemas"]["DraftImageAssetResult"];
export type DraftImageAssetList = components["schemas"]["DraftImageAssetList"];
export type AdminDailyImageSet = components["schemas"]["AdminDailyImageSet"];
export type WithdrawImageAssetRequest = components["schemas"]["WithdrawImageAssetRequest"];
export type ImageAssetWithdrawalResult = components["schemas"]["ImageAssetWithdrawalResult"];
export type ErrorCode = components["schemas"]["ErrorCode"];
type AdminImageAsset = components["schemas"]["AdminImageAsset"];

const ERROR_CODE_RECORD = {
  ACTIVE_CONTENT_VERSION_CHANGED: true,
  ADMIN_SERVICE_UNAVAILABLE: true,
  AUTHENTICATION_FAILED: true,
  AUTH_CHALLENGE_EXPIRED: true,
  CONTENT_NOT_FOUND: true,
  CONTENT_NOT_READY: true,
  CONTENT_VERSION_CHANGED: true,
  CSRF_VALIDATION_FAILED: true,
  EMERGENCY_CONTROL_CONFLICT: true,
  FEEDBACK_UNAVAILABLE: true,
  FORBIDDEN: true,
  HISTORICAL_CONTENT_EXPIRED: true,
  IDEMPOTENCY_KEY_REUSED: true,
  IMAGE_FILE_INVALID: true,
  IMAGE_FILE_TOO_LARGE: true,
  IMAGE_MEDIA_TYPE_UNSUPPORTED: true,
  IMAGE_REVIEW_INCOMPLETE: true,
  IMAGE_SET_INVALID: true,
  IMAGE_WITHDRAWAL_BLOCKED: true,
  INVALID_ARGUMENT: true,
  INVALID_FORTUNE_DATE: true,
  INVALID_STATE_TRANSITION: true,
  LOOK_NOT_FOUND: true,
  MASTER_REVIEW_EVIDENCE_MISSING: true,
  POSTER_GENERATION_UNAVAILABLE: true,
  PRECONDITION_REQUIRED: true,
  PUBLIC_ACCESS_STOPPED: true,
  PUBLISH_PRECHECK_FAILED: true,
  RATE_LIMITED: true,
  RECOVERY_CHALLENGE_EXPIRED: true,
  REQUIRED_REVIEW_MISSING: true,
  RESOURCE_NOT_FOUND: true,
  REVISION_MISMATCH: true,
  SCHEDULE_TIME_INVALID: true,
  TOTP_REPLAYED: true,
  UNAUTHENTICATED: true,
  VERSION_WITHDRAWN: true,
} as const satisfies Record<ErrorCode, true>;

const ERROR_CODE_SET: ReadonlySet<string> = new Set(Object.keys(ERROR_CODE_RECORD));

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && ERROR_CODE_SET.has(value);
}

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
const IMAGE_GENERATION_METHOD_SET = new Set([
  "codex",
  "relay",
  "external_tool",
  "licensed_upload",
  "owned_upload",
  "fallback_template",
]);
const AI_GENERATION_METHOD_SET = new Set(["codex", "relay", "external_tool"]);
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
const IMAGE_MANUAL_CHECK_STATUS_SET = new Set(["passed", "failed"]);
const IMAGE_SLOT_SET = new Set(["required_primary", "required_alternative", "optional"]);
const IMAGE_DELIVERY_STATUS_SET = new Set(["active", "fallback", "omitted", "unavailable"]);
const IMAGE_WITHDRAWAL_ACTION_SET = new Set([
  "fallback_activated",
  "optional_omitted",
  "detail_omitted",
  "no_public_change",
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

function isNonBlankBoundedString(value: unknown, maximum: number): value is string {
  return isBoundedString(value, 1, maximum) && value.trim().length > 0;
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

function isFortuneDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

function adminPreviewAssetId(value: unknown): string | null {
  if (!isBoundedString(value, 1, 2048)) return null;
  const match = /^\/admin\/api\/v1\/image-assets\/([^/?#]+)\/preview$/u.exec(value);
  if (match === null) return null;
  try {
    const parsed = new URL(value, "https://five.invalid");
    const assetId = decodeURIComponent(match[1] ?? "");
    return parsed.origin === "https://five.invalid" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      isOpaqueId(assetId)
      ? assetId
      : null;
  } catch {
    return null;
  }
}

function isAdminPreviewUriReference(value: unknown): value is string {
  return adminPreviewAssetId(value) !== null;
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

function isImageManualCheckStatus(value: unknown): value is string {
  return typeof value === "string" && IMAGE_MANUAL_CHECK_STATUS_SET.has(value);
}

function isImageManualReview(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "aiLabelCompliance",
      "colorAndCopyConsistency",
      "garmentAndPersonIntegrity",
      "mobileAndWechatPreview",
      "notes",
      "reviewId",
      "reviewedAt",
      "reviewerAccountId",
      "rightsAndIdentityRisk",
      "scenarioAndImitability",
    ]) &&
    isOpaqueId(value.reviewId) &&
    isOpaqueId(value.reviewerAccountId) &&
    isStrictRfc3339DateTime(value.reviewedAt) &&
    isBoundedString(value.notes, 0, 2000) &&
    isImageManualCheckStatus(value.colorAndCopyConsistency) &&
    isImageManualCheckStatus(value.garmentAndPersonIntegrity) &&
    isImageManualCheckStatus(value.rightsAndIdentityRisk) &&
    isImageManualCheckStatus(value.scenarioAndImitability) &&
    isImageManualCheckStatus(value.mobileAndWechatPreview) &&
    isImageManualCheckStatus(value.aiLabelCompliance)
  );
}

function hasAllPassedImageChecks(value: Record<string, unknown>): boolean {
  return (
    value.colorAndCopyConsistency === "passed" &&
    value.garmentAndPersonIntegrity === "passed" &&
    value.rightsAndIdentityRisk === "passed" &&
    value.scenarioAndImitability === "passed" &&
    value.mobileAndWechatPreview === "passed" &&
    value.aiLabelCompliance === "passed"
  );
}

function hasValidGenerationMetadata(value: Record<string, unknown>): boolean {
  if (typeof value.generationMethod !== "string") return false;
  const aiGenerated = AI_GENERATION_METHOD_SET.has(value.generationMethod);
  if (aiGenerated !== (value.sourceType === "ai_generated")) return false;
  if (value.generationMethod === "fallback_template" && value.sourceType !== "fallback_template") {
    return false;
  }
  if (
    (value.generationMethod === "licensed_upload" || value.generationMethod === "owned_upload") &&
    value.sourceType !== "licensed"
  ) {
    return false;
  }
  if (!aiGenerated) return true;
  return (
    isVersionLabel(value.declaredModel) &&
    isVersionLabel(value.promptVersion) &&
    isStrictRfc3339DateTime(value.generatedAt) &&
    isNonBlankBoundedString(value.reproductionReference, 500)
  );
}

export function isAdminImageAsset(value: unknown): value is AdminImageAsset {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "aiLabelStatus",
      "altText",
      "assetId",
      "declaredModel",
      "fileUrl",
      "generationMethod",
      "generatedAt",
      "height",
      "mediaType",
      "manualReview",
      "promptVersion",
      "reproductionReference",
      "reviewStatus",
      "rightsRecordIds",
      "rightsStatus",
      "sha256",
      "sourceMaterialReferences",
      "sourceType",
      "width",
    ]) &&
    isOpaqueId(value.assetId) &&
    (value.fileUrl === null || isUri(value.fileUrl)) &&
    isSafeInteger(value.width, 1) &&
    isSafeInteger(value.height, 1) &&
    typeof value.mediaType === "string" &&
    IMAGE_MEDIA_TYPE_SET.has(value.mediaType) &&
    isNonBlankBoundedString(value.altText, 300) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sha256) &&
    typeof value.sourceType === "string" &&
    IMAGE_SOURCE_TYPE_SET.has(value.sourceType) &&
    typeof value.generationMethod === "string" &&
    IMAGE_GENERATION_METHOD_SET.has(value.generationMethod) &&
    (value.declaredModel === null || isVersionLabel(value.declaredModel)) &&
    (value.promptVersion === null || isVersionLabel(value.promptVersion)) &&
    (value.generatedAt === null || isStrictRfc3339DateTime(value.generatedAt)) &&
    (value.reproductionReference === null ||
      isNonBlankBoundedString(value.reproductionReference, 500)) &&
    isUniqueStringArray(value.sourceMaterialReferences, 1, 20, (item): item is string =>
      isNonBlankBoundedString(item, 500),
    ) &&
    (value.manualReview === null || isImageManualReview(value.manualReview)) &&
    typeof value.reviewStatus === "string" &&
    IMAGE_REVIEW_STATUS_SET.has(value.reviewStatus) &&
    typeof value.rightsStatus === "string" &&
    RIGHTS_STATUS_SET.has(value.rightsStatus) &&
    typeof value.aiLabelStatus === "string" &&
    AI_LABEL_STATUS_SET.has(value.aiLabelStatus) &&
    isUniqueStringArray(value.rightsRecordIds, 1, 20, isOpaqueId) &&
    hasValidGenerationMetadata(value) &&
    (value.reviewStatus !== "approved" ||
      (isRecord(value.manualReview) &&
        hasAllPassedImageChecks(value.manualReview) &&
        value.rightsStatus === "cleared" &&
        (value.sourceType === "ai_generated"
          ? value.aiLabelStatus === "complete"
          : value.aiLabelStatus === "not_applicable")))
  );
}

export function isImageAssetUploadMetadata(value: unknown): value is ImageAssetUploadMetadata {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "aiLabelStatus",
      "altText",
      "declaredModel",
      "generatedAt",
      "generationMethod",
      "promptVersion",
      "reproductionReference",
      "rightsRecordIds",
      "sourceMaterialReferences",
      "sourceType",
    ]) &&
    isNonBlankBoundedString(value.altText, 300) &&
    typeof value.sourceType === "string" &&
    IMAGE_SOURCE_TYPE_SET.has(value.sourceType) &&
    typeof value.generationMethod === "string" &&
    IMAGE_GENERATION_METHOD_SET.has(value.generationMethod) &&
    (value.declaredModel === null || isVersionLabel(value.declaredModel)) &&
    (value.promptVersion === null || isVersionLabel(value.promptVersion)) &&
    (value.generatedAt === null || isStrictRfc3339DateTime(value.generatedAt)) &&
    (value.reproductionReference === null ||
      isNonBlankBoundedString(value.reproductionReference, 500)) &&
    isUniqueStringArray(value.sourceMaterialReferences, 1, 20, (item): item is string =>
      isNonBlankBoundedString(item, 500),
    ) &&
    isUniqueStringArray(value.rightsRecordIds, 1, 20, isOpaqueId) &&
    typeof value.aiLabelStatus === "string" &&
    AI_LABEL_STATUS_SET.has(value.aiLabelStatus) &&
    hasValidGenerationMetadata(value)
  );
}

export function isImageAssetReviewRequest(value: unknown): value is ImageAssetReviewRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "aiLabelCompliance",
      "aiLabelStatus",
      "colorAndCopyConsistency",
      "decision",
      "garmentAndPersonIntegrity",
      "mobileAndWechatPreview",
      "notes",
      "rightsAndIdentityRisk",
      "rightsStatus",
      "scenarioAndImitability",
    ]) ||
    (value.decision !== "approved" && value.decision !== "rejected") ||
    !isBoundedString(value.notes, 0, 2000) ||
    typeof value.rightsStatus !== "string" ||
    !RIGHTS_STATUS_SET.has(value.rightsStatus) ||
    typeof value.aiLabelStatus !== "string" ||
    !AI_LABEL_STATUS_SET.has(value.aiLabelStatus) ||
    !isImageManualCheckStatus(value.colorAndCopyConsistency) ||
    !isImageManualCheckStatus(value.garmentAndPersonIntegrity) ||
    !isImageManualCheckStatus(value.rightsAndIdentityRisk) ||
    !isImageManualCheckStatus(value.scenarioAndImitability) ||
    !isImageManualCheckStatus(value.mobileAndWechatPreview) ||
    !isImageManualCheckStatus(value.aiLabelCompliance)
  ) {
    return false;
  }
  return (
    value.decision !== "approved" ||
    (hasAllPassedImageChecks(value) &&
      value.rightsStatus === "cleared" &&
      (value.aiLabelStatus === "complete" || value.aiLabelStatus === "not_applicable"))
  );
}

export function isDraftImageAssetResult(value: unknown): value is DraftImageAssetResult {
  if (!isRecord(value) || !isAdminImageAsset(value.asset)) return false;
  return (
    hasExactKeys(value, [
      "asset",
      "draftId",
      "draftRevision",
      "fortuneDate",
      "previewUrl",
      "reviewLocked",
    ]) &&
    isOpaqueId(value.draftId) &&
    isFortuneDate(value.fortuneDate) &&
    isSafeInteger(value.draftRevision, 1) &&
    isAdminPreviewUriReference(value.previewUrl) &&
    typeof value.reviewLocked === "boolean" &&
    adminPreviewAssetId(value.previewUrl) === value.asset.assetId
  );
}

function isDraftImageCandidate(value: unknown): boolean {
  if (!isRecord(value) || !isAdminImageAsset(value.asset)) return false;
  return (
    hasExactKeys(value, ["asset", "previewUrl", "reviewLocked"]) &&
    isAdminPreviewUriReference(value.previewUrl) &&
    typeof value.reviewLocked === "boolean" &&
    adminPreviewAssetId(value.previewUrl) === value.asset.assetId
  );
}

export function isDraftImageAssetList(value: unknown): value is DraftImageAssetList {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["draftId", "draftRevision", "fortuneDate", "items"]) &&
    isOpaqueId(value.draftId) &&
    isFortuneDate(value.fortuneDate) &&
    isSafeInteger(value.draftRevision, 1) &&
    isArrayOf(value.items, 0, Number.MAX_SAFE_INTEGER, isDraftImageCandidate)
  );
}

function isImageSetSlotDelivery(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "coverAssetId",
      "deliveryStatus",
      "detailAssetIds",
      "fallbackAssetId",
      "imageSlot",
      "lookId",
      "servedCoverAssetId",
      "servedDetailAssetIds",
    ]) &&
    typeof value.imageSlot === "string" &&
    IMAGE_SLOT_SET.has(value.imageSlot) &&
    isOpaqueId(value.lookId) &&
    isOpaqueId(value.coverAssetId) &&
    isUniqueStringArray(value.detailAssetIds, 0, 4, isOpaqueId) &&
    (value.fallbackAssetId === null || isOpaqueId(value.fallbackAssetId)) &&
    (value.servedCoverAssetId === null || isOpaqueId(value.servedCoverAssetId)) &&
    isUniqueStringArray(value.servedDetailAssetIds, 0, 4, isOpaqueId) &&
    typeof value.deliveryStatus === "string" &&
    IMAGE_DELIVERY_STATUS_SET.has(value.deliveryStatus)
  );
}

function isImageAssetWithdrawalEvent(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "assetId",
      "auditEventId",
      "reason",
      "withdrawalEventId",
      "withdrawnAt",
    ]) &&
    isOpaqueId(value.withdrawalEventId) &&
    isOpaqueId(value.assetId) &&
    isBoundedString(value.reason, 1, 2000) &&
    isStrictRfc3339DateTime(value.withdrawnAt) &&
    isOpaqueId(value.auditEventId)
  );
}

export function isDeliverableAdminImageAsset(value: unknown): boolean {
  return isAdminImageAsset(value) && value.fileUrl !== null && value.reviewStatus === "approved";
}

export function isAdminDailyImageSet(value: unknown): value is AdminDailyImageSet {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "assets",
      "contentVersion",
      "fortuneDate",
      "lifecycleRevision",
      "slots",
      "withdrawalEvents",
    ]) ||
    !isFortuneDate(value.fortuneDate) ||
    !isOpaqueId(value.contentVersion) ||
    !isSafeInteger(value.lifecycleRevision, 1) ||
    !isArrayOf(value.slots, 2, 3, isImageSetSlotDelivery) ||
    !isArrayOf(value.assets, 2, Number.MAX_SAFE_INTEGER, isAdminImageAsset) ||
    !isArrayOf(value.withdrawalEvents, 0, Number.MAX_SAFE_INTEGER, isImageAssetWithdrawalEvent)
  ) {
    return false;
  }
  const assets = value.assets as Array<Record<string, unknown>>;
  const slots = value.slots as Array<Record<string, unknown>>;
  const withdrawalEvents = value.withdrawalEvents as Array<Record<string, unknown>>;
  const assetIds = assets.map((asset) => asset.assetId as string);
  const lookIds = slots.map((slot) => slot.lookId as string);
  const coverAssetIds = slots.map((slot) => slot.coverAssetId as string);
  const withdrawalEventIds = withdrawalEvents.map((event) => event.withdrawalEventId as string);
  const auditEventIds = withdrawalEvents.map((event) => event.auditEventId as string);
  const assetsById = new Map(assets.map((asset) => [asset.assetId as string, asset]));
  const withdrawnAssetIds = new Set(withdrawalEvents.map((event) => event.assetId as string));

  if (
    new Set(assetIds).size !== assetIds.length ||
    new Set(lookIds).size !== lookIds.length ||
    new Set(coverAssetIds).size !== coverAssetIds.length ||
    new Set(withdrawalEventIds).size !== withdrawalEventIds.length ||
    new Set(auditEventIds).size !== auditEventIds.length ||
    withdrawnAssetIds.size !== withdrawalEvents.length ||
    withdrawalEvents.some((event) => !assetsById.has(event.assetId as string))
  ) {
    return false;
  }

  const slotCodes = slots.map((slot) => slot.imageSlot);
  if (
    slotCodes.filter((slot) => slot === "required_primary").length !== 1 ||
    slotCodes.filter((slot) => slot === "required_alternative").length !== 1 ||
    slotCodes.filter((slot) => slot === "optional").length > 1
  ) {
    return false;
  }

  return slots.every((slot) => {
    const imageSlot = slot.imageSlot as string;
    const coverAssetId = slot.coverAssetId as string;
    const fallbackAssetId = slot.fallbackAssetId as string | null;
    const detailAssetIds = slot.detailAssetIds as string[];
    const servedCoverAssetId = slot.servedCoverAssetId as string | null;
    const servedDetailAssetIds = slot.servedDetailAssetIds as string[];
    const deliveryStatus = slot.deliveryStatus as string;
    const required = imageSlot !== "optional";
    const coverAsset = assetsById.get(coverAssetId);
    const fallbackAsset = fallbackAssetId === null ? undefined : assetsById.get(fallbackAssetId);
    const coverDeliverable = isDeliverableAdminImageAsset(coverAsset);
    const expectedServedDetailAssetIds = detailAssetIds.filter((assetId) => {
      const asset = assetsById.get(assetId);
      return isDeliverableAdminImageAsset(asset) && !withdrawnAssetIds.has(assetId);
    });

    if (
      coverAsset === undefined ||
      detailAssetIds.some((assetId) => !assetsById.has(assetId)) ||
      servedDetailAssetIds.length !== expectedServedDetailAssetIds.length ||
      servedDetailAssetIds.some(
        (assetId, index) => assetId !== expectedServedDetailAssetIds[index],
      ) ||
      (required && fallbackAssetId === null) ||
      (fallbackAssetId !== null &&
        (fallbackAssetId === coverAssetId ||
          fallbackAsset === undefined ||
          !isDeliverableAdminImageAsset(fallbackAsset)))
    ) {
      return false;
    }

    if (deliveryStatus === "active") {
      return (
        coverDeliverable &&
        servedCoverAssetId === coverAssetId &&
        !withdrawnAssetIds.has(coverAssetId)
      );
    }
    if (deliveryStatus === "fallback") {
      return (
        fallbackAssetId !== null &&
        servedCoverAssetId === fallbackAssetId &&
        (!coverDeliverable || withdrawnAssetIds.has(coverAssetId)) &&
        !withdrawnAssetIds.has(fallbackAssetId)
      );
    }
    if (deliveryStatus === "unavailable") {
      return (
        required &&
        servedCoverAssetId === null &&
        (!coverDeliverable || withdrawnAssetIds.has(coverAssetId)) &&
        (fallbackAssetId === null ||
          fallbackAsset === undefined ||
          !isDeliverableAdminImageAsset(fallbackAsset) ||
          withdrawnAssetIds.has(fallbackAssetId))
      );
    }
    return (
      !required &&
      deliveryStatus === "omitted" &&
      servedCoverAssetId === null &&
      (!coverDeliverable || withdrawnAssetIds.has(coverAssetId))
    );
  });
}

export function isWithdrawImageAssetRequest(value: unknown): value is WithdrawImageAssetRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["expectedActiveContentVersion", "reason"]) &&
    (value.expectedActiveContentVersion === null ||
      isOpaqueId(value.expectedActiveContentVersion)) &&
    isBoundedString(value.reason, 1, 2000) &&
    value.reason.trim().length > 0
  );
}

export function isImageAssetWithdrawalResult(value: unknown): value is ImageAssetWithdrawalResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "assetId",
      "auditEventId",
      "dailyImageSet",
      "deliveryAction",
      "lifecycleRevision",
    ]) &&
    isOpaqueId(value.assetId) &&
    typeof value.deliveryAction === "string" &&
    IMAGE_WITHDRAWAL_ACTION_SET.has(value.deliveryAction) &&
    isSafeInteger(value.lifecycleRevision, 1) &&
    isOpaqueId(value.auditEventId) &&
    isAdminDailyImageSet(value.dailyImageSet) &&
    value.lifecycleRevision === value.dailyImageSet.lifecycleRevision &&
    value.dailyImageSet.assets.some((asset) => asset.assetId === value.assetId) &&
    value.dailyImageSet.withdrawalEvents.some(
      (event) => event.assetId === value.assetId && event.auditEventId === value.auditEventId,
    )
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
      "fallbackAssetId",
      "formulaId",
      "imageSlot",
      "items",
      "lookId",
      "requiredForPublish",
      "scenario",
      "sortOrder",
      "title",
    ]) &&
    isOpaqueId(value.lookId) &&
    isOpaqueId(value.formulaId) &&
    typeof value.imageSlot === "string" &&
    IMAGE_SLOT_SET.has(value.imageSlot) &&
    typeof value.requiredForPublish === "boolean" &&
    value.requiredForPublish === (value.imageSlot !== "optional") &&
    isSafeInteger(value.sortOrder, 1, 3) &&
    isBoundedString(value.title, 1, 80) &&
    isCodeLabel(value.scenario) &&
    isCodeLabel(value.audience) &&
    isOpaqueId(value.coverAssetId) &&
    isUniqueStringArray(value.detailAssetIds, 0, 4, isOpaqueId) &&
    (value.fallbackAssetId === null || isOpaqueId(value.fallbackAssetId)) &&
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
    isNonBlankBoundedString(value.reference, 500) &&
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
  if (
    !isRecord(value) ||
    !hasExactKeys(value, DRAFT_MODULE_REQUIRED_KEYS.visual_and_rights) ||
    !isArrayOf(value.looks, 2, 3, isLookDraft) ||
    !isArrayOf(value.assets, 2, Number.MAX_SAFE_INTEGER, isAdminImageAsset) ||
    !isArrayOf(value.rightsRecords, 0, Number.MAX_SAFE_INTEGER, isRightsRecord) ||
    !isVersionLabel(value.assetManifestVersion)
  ) {
    return false;
  }
  const looks = value.looks as Array<Record<string, unknown>>;
  const assets = value.assets as Array<Record<string, unknown>>;
  const rightsRecords = value.rightsRecords as Array<Record<string, unknown>>;
  const assetIds = assets.map((asset) => asset.assetId as string);
  const rightsRecordIds = rightsRecords.map((record) => record.rightsRecordId as string);
  const lookIds = looks.map((look) => look.lookId as string);
  const sortOrders = looks.map((look) => look.sortOrder as number);
  const coverAssetIds = looks.map((look) => look.coverAssetId as string);
  const assetsById = new Map(assets.map((asset) => [asset.assetId as string, asset]));
  const knownRightsRecordIds = new Set(rightsRecordIds);
  const slots = looks.map((look) => look.imageSlot);
  return (
    new Set(assetIds).size === assetIds.length &&
    new Set(rightsRecordIds).size === rightsRecordIds.length &&
    new Set(lookIds).size === lookIds.length &&
    new Set(sortOrders).size === sortOrders.length &&
    new Set(coverAssetIds).size === coverAssetIds.length &&
    assets.every((asset) =>
      (asset.rightsRecordIds as string[]).every((rightsRecordId) =>
        knownRightsRecordIds.has(rightsRecordId),
      ),
    ) &&
    slots.filter((slot) => slot === "required_primary").length === 1 &&
    slots.filter((slot) => slot === "required_alternative").length === 1 &&
    slots.filter((slot) => slot === "optional").length <= 1 &&
    looks.every((look) => {
      const required = look.imageSlot !== "optional";
      const coverAssetId = look.coverAssetId as string;
      const detailAssetIds = look.detailAssetIds as string[];
      const fallbackAssetId = look.fallbackAssetId as string | null;
      if (
        !assetsById.has(coverAssetId) ||
        detailAssetIds.some((assetId) => !assetsById.has(assetId))
      ) {
        return false;
      }
      if (fallbackAssetId === null) return !required;
      const fallbackAsset = assetsById.get(fallbackAssetId);
      return (
        fallbackAssetId !== coverAssetId &&
        fallbackAsset !== undefined &&
        isDeliverableAdminImageAsset(fallbackAsset)
      );
    })
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
