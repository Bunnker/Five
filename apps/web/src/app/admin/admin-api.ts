import type {
  components as FiveApiComponents,
  operations as FiveApiOperations,
} from "@five/api-contract";
import {
  DRAFT_MODULE_CODES,
  DRAFT_MODULE_REQUIRED_KEYS,
  isAdminDailyImageSet,
  isDraftImageAssetList,
  isDraftImageAssetResult,
  isDraftModuleCode,
  isDraftModuleUpdate,
  isErrorCode,
  isImageAssetWithdrawalResult,
} from "@five/api-contract/runtime";

export type AdminSession = FiveApiComponents["schemas"]["AdminSession"];
export type EmergencyControlStatus = FiveApiComponents["schemas"]["EmergencyControlStatus"];
export type SecurityEventPage = FiveApiComponents["schemas"]["SecurityEventPage"];
export type SecurityEvent = SecurityEventPage["items"][number];
export type AdminContentVersion = FiveApiComponents["schemas"]["AdminContentVersion"];
export type ContentDraft = FiveApiComponents["schemas"]["ContentDraft"];
export type ContentDraftList = FiveApiComponents["schemas"]["ContentDraftList"];
export type DailyContentProduction = FiveApiComponents["schemas"]["DailyContentProduction"];
export type DailyContentProductionList = FiveApiComponents["schemas"]["DailyContentProductionList"];
export type ContentVersionSummary = FiveApiComponents["schemas"]["ContentVersionSummary"];
export type DraftModuleCode = FiveApiComponents["schemas"]["ModuleCode"];
export type DraftModuleUpdate = FiveApiComponents["schemas"]["DraftModuleUpdate"];
export type LifecycleActionResult = FiveApiComponents["schemas"]["LifecycleActionResult"];
export type SubmitDraftResult = FiveApiComponents["schemas"]["SubmitDraftResult"];
export type UpdatedDraftModule = FiveApiComponents["schemas"]["UpdatedDraftModule"];
export type AdminDailyImageSet = FiveApiComponents["schemas"]["AdminDailyImageSet"];
export type AdminImageAsset = FiveApiComponents["schemas"]["AdminImageAsset"];
export type DraftImageAssetList = FiveApiComponents["schemas"]["DraftImageAssetList"];
export type DraftImageAssetResult = FiveApiComponents["schemas"]["DraftImageAssetResult"];
export type ImageAssetReviewRequest = FiveApiComponents["schemas"]["ImageAssetReviewRequest"];
export type ImageAssetUploadMetadata = FiveApiComponents["schemas"]["ImageAssetUploadMetadata"];
export type ImageAssetWithdrawalResult = FiveApiComponents["schemas"]["ImageAssetWithdrawalResult"];
export type WithdrawImageAssetRequest = FiveApiComponents["schemas"]["WithdrawImageAssetRequest"];
export type AdminErrorCode = FiveApiComponents["schemas"]["ErrorCode"];
export type AdminOperationsOverview = FiveApiComponents["schemas"]["AdminOperationsOverview"];
export type AdminAnalyticsOverview = FiveApiComponents["schemas"]["AdminAnalyticsOverview"];
export type AdminAnalyticsReport = FiveApiComponents["schemas"]["AdminAnalyticsReport"];
export type AdminAnalyticsDailyPoint = FiveApiComponents["schemas"]["AdminAnalyticsDailyPoint"];
export type AdminAnalyticsChannelPoint = FiveApiComponents["schemas"]["AdminAnalyticsChannelPoint"];
export type PublicContentContext = FiveApiComponents["schemas"]["PublicContentContext"];
export type AdminCalendarMonth = FiveApiComponents["schemas"]["AdminCalendarMonth"];
export type AdminActionableIssueList = FiveApiComponents["schemas"]["AdminActionableIssueList"];
export type AdminDayDetail = FiveApiComponents["schemas"]["AdminDayDetail"];
export type DailyImageSlot = FiveApiComponents["schemas"]["DailyImageSlot"];
export type DayCorrectionCommand = FiveApiComponents["schemas"]["DayCorrectionCommand"];
export type DayCorrectionWorkingCopy = FiveApiComponents["schemas"]["DayCorrectionWorkingCopy"];
export type DayCorrectionPatchResult = FiveApiComponents["schemas"]["DayCorrectionPatchResult"];
export type DayCorrectionApplyResult = FiveApiComponents["schemas"]["DayCorrectionApplyResult"];
export type DayCorrectionImageStatus = FiveApiComponents["schemas"]["DayCorrectionImageStatus"];
export type DayCorrectionImageSelectionResult =
  FiveApiComponents["schemas"]["DayCorrectionImageSelectionResult"];
export type DayCorrectionImageLibraryPage =
  FiveApiComponents["schemas"]["DayCorrectionImageLibraryPage"];
export type ReusableDayCorrectionImage = FiveApiComponents["schemas"]["ReusableDayCorrectionImage"];

export type ContentVersionList =
  FiveApiOperations["listDailyContentVersions"]["responses"][200]["content"]["application/json"];

type CreateAdminSessionRequest = FiveApiComponents["schemas"]["CreateAdminSessionRequest"];
type EmergencyResumeRequest = FiveApiComponents["schemas"]["EmergencyResumeRequest"];
type EmergencyStopRequest = FiveApiComponents["schemas"]["EmergencyStopRequest"];
type AddMasterReviewEvidenceRequest =
  FiveApiComponents["schemas"]["AddMasterReviewEvidenceRequest"];
type CreateDraftRequest = FiveApiComponents["schemas"]["CreateDraftRequest"];
type ExpectedActiveVersionRequest = FiveApiComponents["schemas"]["ExpectedActiveVersionRequest"];
type ReviewDecisionRequest = FiveApiComponents["schemas"]["ReviewDecisionRequest"];
type RollbackRequest = FiveApiComponents["schemas"]["RollbackRequest"];
type ScheduleRequest = FiveApiComponents["schemas"]["ScheduleRequest"];
type WithdrawRequest = FiveApiComponents["schemas"]["WithdrawRequest"];

export type AdminApiError = {
  code?: AdminErrorCode;
  details?: Record<string, unknown>;
  kind: "api-error";
  requestId: string | null;
  retryAfterSeconds: number | null;
  retryable?: boolean;
  /** Opaque server concurrency token, preserved verbatim when an error returns one. */
  etag?: string | null;
  status: number;
};

export type AdminApiResult<T> =
  { data: T; ok: true; response: Response } | { error: AdminApiError; ok: false };

type Validator<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, minimum = 1, maximum = 2048): value is string {
  if (typeof value !== "string") return false;
  const codePointLength = Array.from(value).length;
  return codePointLength >= minimum && codePointLength <= maximum;
}

function isZonedDateTime(value: unknown): value is string {
  if (!isBoundedString(value, 1, 64)) return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59
  );
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function isAdminSession(value: unknown): value is AdminSession {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "absoluteExpiresAt",
      "credentialRevision",
      "csrfToken",
      "idleExpiresAt",
      "issuedAt",
      "username",
    ]) &&
    isBoundedString(value.username, 3, 64) &&
    /^[a-z0-9][a-z0-9._-]*$/u.test(value.username) &&
    isZonedDateTime(value.issuedAt) &&
    isZonedDateTime(value.idleExpiresAt) &&
    isZonedDateTime(value.absoluteExpiresAt) &&
    isBoundedString(value.csrfToken, 32, 256) &&
    Number.isInteger(value.credentialRevision) &&
    Number(value.credentialRevision) >= 1
  );
}

function isSecurityEventPage(value: unknown): value is SecurityEventPage {
  const allowedActions = new Set<SecurityEvent["action"]>([
    "bootstrap_completed",
    "login_password",
    "logout_current",
    "logout_all",
    "offline_reset",
    "csrf_rejected",
    "rate_limited",
    "emergency_stop",
    "emergency_resume",
  ]);
  return (
    isRecord(value) &&
    hasExactKeys(value, ["items", "nextCursor"]) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        hasExactKeys(item, [
          "action",
          "clientSummary",
          "eventId",
          "occurredAt",
          "outcome",
          "reason",
          "requestId",
          "sourceFingerprint",
        ]) &&
        isBoundedString(item.eventId, 1, 128) &&
        isZonedDateTime(item.occurredAt) &&
        isBoundedString(item.action, 1, 64) &&
        allowedActions.has(item.action as SecurityEvent["action"]) &&
        (item.outcome === "succeeded" || item.outcome === "rejected") &&
        isBoundedString(item.requestId, 8, 128) &&
        isBoundedString(item.sourceFingerprint, 16, 128) &&
        (item.clientSummary === null || isBoundedString(item.clientSummary, 0, 160)) &&
        (item.reason === null || isBoundedString(item.reason, 1, 2000)),
    ) &&
    (value.nextCursor === null || isBoundedString(value.nextCursor, 1, 256))
  );
}

function isEmergencyControlStatus(value: unknown): value is EmergencyControlStatus {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "auditEventId",
      "changedAt",
      "publicAccessEnabled",
      "reason",
      "revision",
    ]) &&
    typeof value.publicAccessEnabled === "boolean" &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    isZonedDateTime(value.changedAt) &&
    (value.reason === null || isBoundedString(value.reason, 1, 2000)) &&
    (value.auditEventId === null || isBoundedString(value.auditEventId, 1, 128))
  );
}

const contentStates = new Set([
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "scheduled",
  "published",
  "superseded",
  "withdrawn",
]);

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
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
  return month >= 1 && month <= 12 && day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

function nextFortuneDate(value: string): string | null {
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(instant)
    ? new Date(instant + 86_400_000).toISOString().slice(0, 10)
    : null;
}

const adminDayRelations = new Set(["current", "next", "future", "past"]);
const adminOperationalStatuses = new Set([
  "published_healthy",
  "published_degraded",
  "scheduled_ready",
  "preparing",
  "overdue",
  "generation_failed",
  "publication_failed",
  "missing",
  "invariant_broken",
]);
const adminIssueCodes = new Set([
  "CURRENT_CONTENT_UNAVAILABLE",
  "NEXT_DAY_OVERDUE",
  "REQUIRED_IMAGE_MISSING",
  "REQUIRED_IMAGE_GENERATION_FAILED",
  "CONTENT_GENERATION_FAILED",
  "AUTO_PUBLICATION_FAILED",
  "ACTIVE_VERSION_INCONSISTENT",
  "REQUIRED_IMAGE_DEGRADED",
  "SAFE_FALLBACK_EXHAUSTED",
]);
const optionalImageStatuses = new Set(["not_requested", "pending", "ready", "failed", "omitted"]);
const elementCodes = new Set(["wood", "fire", "earth", "metal", "water"]);
const elementLabels = new Set(["木", "火", "土", "金", "水"]);
const earthlyBranches = new Set([
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

function isRequestContext(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "responseGeneratedAt",
      "civilDate",
      "fortuneDate",
      "shichen",
      "timezone",
      "dayBoundary",
      "crossedDayBoundary",
    ]) &&
    isZonedDateTime(value.responseGeneratedAt) &&
    isFortuneDate(value.civilDate) &&
    isFortuneDate(value.fortuneDate) &&
    earthlyBranches.has(value.shichen as string) &&
    value.timezone === "Asia/Shanghai" &&
    value.dayBoundary === "23:00" &&
    typeof value.crossedDayBoundary === "boolean"
  );
}

function isPublicContentContext(value: unknown): value is PublicContentContext {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["servedFortuneDate", "switchBoundary", "advancedFromCivilDate"]) &&
    isFortuneDate(value.servedFortuneDate) &&
    value.switchBoundary === "18:00" &&
    typeof value.advancedFromCivilDate === "boolean"
  );
}

function isSamePublicContentContext(left: unknown, right: unknown): boolean {
  return (
    isPublicContentContext(left) &&
    isPublicContentContext(right) &&
    left.advancedFromCivilDate === right.advancedFromCivilDate &&
    left.servedFortuneDate === right.servedFortuneDate &&
    left.switchBoundary === right.switchBoundary
  );
}

function isPreviewAlignedWithPublicContext(preview: unknown, context: unknown): boolean {
  return (
    isPublicContentContext(context) &&
    (preview === null || (isRecord(preview) && preview.fortuneDate === context.servedFortuneDate))
  );
}

function isDailyContentPreview(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      hasExactKeys(value, [
        "fortuneDate",
        "effectiveFrom",
        "effectiveTo",
        "calendar",
        "tiers",
        "balanceSuggestion",
        "outfitFormulas",
        "looks",
        "basis",
        "share",
        "versions",
      ]) &&
      isFortuneDate(value.fortuneDate) &&
      isZonedDateTime(value.effectiveFrom) &&
      isZonedDateTime(value.effectiveTo) &&
      isRecord(value.versions) &&
      isBoundedString(value.versions.contentVersion, 1, 128))
  );
}

function isRequiredImageReadiness(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["requiredCount", "modelReadyCount", "deliverySafeCount"]) &&
    value.requiredCount === 2 &&
    Number.isInteger(value.modelReadyCount) &&
    Number(value.modelReadyCount) >= 0 &&
    Number(value.modelReadyCount) <= 2 &&
    Number.isInteger(value.deliverySafeCount) &&
    Number(value.deliverySafeCount) >= 0 &&
    Number(value.deliverySafeCount) <= 2
  );
}

function isAdminDaySummary(value: unknown): value is AdminOperationsOverview["current"] {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "fortuneDate",
      "relation",
      "effectiveFrom",
      "effectiveTo",
      "prepareBy",
      "dayElement",
      "dayElementLabel",
      "primaryColors",
      "operationalStatus",
      "requiredImages",
      "optionalImageStatus",
      "previewAvailable",
      "issueCodes",
      "lifecycleRevision",
      "scheduleSlotRevision",
      "updatedAt",
    ]) &&
    isFortuneDate(value.fortuneDate) &&
    adminDayRelations.has(value.relation as string) &&
    isZonedDateTime(value.effectiveFrom) &&
    isZonedDateTime(value.effectiveTo) &&
    isZonedDateTime(value.prepareBy) &&
    elementCodes.has(value.dayElement as string) &&
    elementLabels.has(value.dayElementLabel as string) &&
    Array.isArray(value.primaryColors) &&
    value.primaryColors.length <= 12 &&
    value.primaryColors.every(
      (color) =>
        isRecord(color) &&
        hasExactKeys(color, ["colorCode", "name"]) &&
        isBoundedString(color.colorCode, 1, 64) &&
        isBoundedString(color.name, 1, 32),
    ) &&
    adminOperationalStatuses.has(value.operationalStatus as string) &&
    isRequiredImageReadiness(value.requiredImages) &&
    optionalImageStatuses.has(value.optionalImageStatus as string) &&
    typeof value.previewAvailable === "boolean" &&
    Array.isArray(value.issueCodes) &&
    value.issueCodes.every((code) => adminIssueCodes.has(code as string)) &&
    Number.isInteger(value.lifecycleRevision) &&
    Number(value.lifecycleRevision) >= 0 &&
    Number.isInteger(value.scheduleSlotRevision) &&
    Number(value.scheduleSlotRevision) >= 0 &&
    (value.updatedAt === null || isZonedDateTime(value.updatedAt))
  );
}

function isAdminOperationsOverview(value: unknown): value is AdminOperationsOverview {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "requestContext",
      "publicContentContext",
      "nextOperationalBoundaryAt",
      "health",
      "issueCount",
      "current",
      "currentPreview",
      "currentPreviewRequestContext",
      "currentPreviewPublicContentContext",
      "next",
      "nextPreview",
      "nextPreviewRequestContext",
      "nextPreviewPublicContentContext",
    ]) &&
    isRequestContext(value.requestContext) &&
    isPublicContentContext(value.publicContentContext) &&
    isZonedDateTime(value.nextOperationalBoundaryAt) &&
    (value.health === "healthy" ||
      value.health === "attention" ||
      value.health === "unavailable") &&
    Number.isInteger(value.issueCount) &&
    Number(value.issueCount) >= 0 &&
    isAdminDaySummary(value.current) &&
    value.current.fortuneDate === value.publicContentContext.servedFortuneDate &&
    value.current.relation === "current" &&
    isDailyContentPreview(value.currentPreview) &&
    isRequestContext(value.currentPreviewRequestContext) &&
    isSamePublicContentContext(
      value.currentPreviewPublicContentContext,
      value.publicContentContext,
    ) &&
    isPreviewAlignedWithPublicContext(
      value.currentPreview,
      value.currentPreviewPublicContentContext,
    ) &&
    isAdminDaySummary(value.next) &&
    value.next.fortuneDate === nextFortuneDate(value.publicContentContext.servedFortuneDate) &&
    value.next.relation === "next" &&
    isDailyContentPreview(value.nextPreview) &&
    isRequestContext(value.nextPreviewRequestContext) &&
    isPublicContentContext(value.nextPreviewPublicContentContext) &&
    value.nextPreviewPublicContentContext.servedFortuneDate === value.next.fortuneDate &&
    isPreviewAlignedWithPublicContext(value.nextPreview, value.nextPreviewPublicContentContext)
  );
}

function isAnalyticsRate(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["numerator", "denominator", "ratio"]) &&
    isNonnegativeInteger(value.numerator) &&
    isNonnegativeInteger(value.denominator) &&
    Number(value.numerator) <= Number(value.denominator) &&
    (value.ratio === null ||
      (typeof value.ratio === "number" &&
        Number.isFinite(value.ratio) &&
        value.ratio >= 0 &&
        value.ratio <= 1)) &&
    (Number(value.denominator) === 0 ? value.ratio === null : value.ratio !== null)
  );
}

function isAdminAnalyticsOverview(value: unknown): value is AdminAnalyticsOverview {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "fromFortuneDate",
      "toFortuneDate",
      "channelId",
      "contentVersion",
      "collectionStatus",
      "generatedAt",
      "pageViews",
      "anonymousBrowsers",
      "outfitHubVisitors",
      "outfitDetailVisitors",
      "shareInitiations",
      "sharingBrowsers",
      "referredBrowsers",
      "posterSaveRequests",
      "posterSaveSucceeded",
      "posterSaveFailed",
      "outfitDetailRate",
      "shareInitiationRate",
    ]) &&
    isFortuneDate(value.fromFortuneDate) &&
    isFortuneDate(value.toFortuneDate) &&
    value.fromFortuneDate <= value.toFortuneDate &&
    (value.channelId === null || isBoundedString(value.channelId, 1, 64)) &&
    (value.contentVersion === null || isBoundedString(value.contentVersion, 1, 128)) &&
    (value.collectionStatus === "active" || value.collectionStatus === "unavailable") &&
    isZonedDateTime(value.generatedAt) &&
    isNonnegativeInteger(value.pageViews) &&
    isNonnegativeInteger(value.anonymousBrowsers) &&
    isNonnegativeInteger(value.outfitHubVisitors) &&
    isNonnegativeInteger(value.outfitDetailVisitors) &&
    isNonnegativeInteger(value.shareInitiations) &&
    isNonnegativeInteger(value.sharingBrowsers) &&
    isNonnegativeInteger(value.referredBrowsers) &&
    isNonnegativeInteger(value.posterSaveRequests) &&
    isNonnegativeInteger(value.posterSaveSucceeded) &&
    isNonnegativeInteger(value.posterSaveFailed) &&
    isAnalyticsRate(value.outfitDetailRate) &&
    isAnalyticsRate(value.shareInitiationRate)
  );
}

const analyticsChannelBuckets = new Set([
  "organic",
  "wechat_official",
  "wechat_group",
  "user_share",
  "other",
]);

function isAdminAnalyticsDailyPoint(value: unknown): value is AdminAnalyticsDailyPoint {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "fortuneDate",
      "pageViews",
      "anonymousBrowsers",
      "outfitHubVisitors",
      "outfitDetailVisitors",
      "shareInitiations",
      "sharingBrowsers",
      "referredBrowsers",
      "posterSaveSucceeded",
    ]) &&
    isFortuneDate(value.fortuneDate) &&
    isNonnegativeInteger(value.pageViews) &&
    isNonnegativeInteger(value.anonymousBrowsers) &&
    isNonnegativeInteger(value.outfitHubVisitors) &&
    isNonnegativeInteger(value.outfitDetailVisitors) &&
    isNonnegativeInteger(value.shareInitiations) &&
    isNonnegativeInteger(value.sharingBrowsers) &&
    isNonnegativeInteger(value.referredBrowsers) &&
    isNonnegativeInteger(value.posterSaveSucceeded)
  );
}

function isAdminAnalyticsChannelPoint(value: unknown): value is AdminAnalyticsChannelPoint {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["channelId", "pageViews", "anonymousBrowsers", "ratio"]) &&
    typeof value.channelId === "string" &&
    analyticsChannelBuckets.has(value.channelId) &&
    isNonnegativeInteger(value.pageViews) &&
    isNonnegativeInteger(value.anonymousBrowsers) &&
    (value.ratio === null ||
      (typeof value.ratio === "number" &&
        Number.isFinite(value.ratio) &&
        value.ratio >= 0 &&
        value.ratio <= 1))
  );
}

function isSequentialAnalyticsDays(
  daily: AdminAnalyticsDailyPoint[],
  fromFortuneDate: string,
  toFortuneDate: string,
): boolean {
  if (daily[0]?.fortuneDate !== fromFortuneDate) return false;
  if (daily.at(-1)?.fortuneDate !== toFortuneDate) return false;
  return daily.every(
    (point, index) =>
      index === 0 || point.fortuneDate === nextFortuneDate(daily[index - 1]!.fortuneDate),
  );
}

function isAdminAnalyticsReport(value: unknown): value is AdminAnalyticsReport {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "days",
      "fromFortuneDate",
      "toFortuneDate",
      "collectionStatus",
      "generatedAt",
      "summary",
      "daily",
      "channelBreakdown",
    ]) ||
    (value.days !== 7 && value.days !== 30) ||
    !isFortuneDate(value.fromFortuneDate) ||
    !isFortuneDate(value.toFortuneDate) ||
    (value.collectionStatus !== "active" && value.collectionStatus !== "unavailable") ||
    !isZonedDateTime(value.generatedAt) ||
    !isAdminAnalyticsOverview(value.summary) ||
    !Array.isArray(value.daily) ||
    value.daily.length !== value.days ||
    !value.daily.every(isAdminAnalyticsDailyPoint) ||
    !Array.isArray(value.channelBreakdown) ||
    !value.channelBreakdown.every(isAdminAnalyticsChannelPoint)
  ) {
    return false;
  }

  const report = value as AdminAnalyticsReport;
  const summaryAligned =
    report.summary.fromFortuneDate === report.fromFortuneDate &&
    report.summary.toFortuneDate === report.toFortuneDate &&
    report.summary.channelId === null &&
    report.summary.contentVersion === null &&
    report.summary.collectionStatus === report.collectionStatus &&
    report.summary.generatedAt === report.generatedAt;
  if (!summaryAligned) return false;
  if (!isSequentialAnalyticsDays(report.daily, report.fromFortuneDate, report.toFortuneDate)) {
    return false;
  }

  if (report.channelBreakdown.length > 5) return false;
  const channelIds = report.channelBreakdown.map((item) => item.channelId);
  if (new Set(channelIds).size !== channelIds.length) return false;
  const channelPageViews = report.channelBreakdown.reduce((sum, item) => sum + item.pageViews, 0);
  if (channelPageViews !== report.summary.pageViews) return false;
  if (report.summary.pageViews === 0) {
    return report.channelBreakdown.every((item) => item.ratio === null);
  }
  const ratioTolerance = 1e-9;
  const ratiosAligned = report.channelBreakdown.every(
    (item) =>
      item.ratio !== null &&
      Math.abs(item.ratio - item.pageViews / report.summary.pageViews) <= ratioTolerance,
  );
  const ratioTotal = report.channelBreakdown.reduce((sum, item) => sum + (item.ratio ?? 0), 0);
  return ratiosAligned && Math.abs(ratioTotal - 1) <= ratioTolerance;
}

function isAdminCalendarMonth(value: unknown): value is AdminCalendarMonth {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "requestContext",
      "publicContentContext",
      "nextOperationalBoundaryAt",
      "month",
      "items",
    ]) &&
    isRequestContext(value.requestContext) &&
    isPublicContentContext(value.publicContentContext) &&
    isZonedDateTime(value.nextOperationalBoundaryAt) &&
    typeof value.month === "string" &&
    /^\d{4}-(0[1-9]|1[0-2])$/u.test(value.month) &&
    Array.isArray(value.items) &&
    value.items.length === 42 &&
    value.items.every(isAdminDaySummary)
  );
}

function isAdminActionableIssueList(value: unknown): value is AdminActionableIssueList {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "requestContext",
      "publicContentContext",
      "nextOperationalBoundaryAt",
      "items",
    ]) &&
    isRequestContext(value.requestContext) &&
    isPublicContentContext(value.publicContentContext) &&
    isZonedDateTime(value.nextOperationalBoundaryAt) &&
    Array.isArray(value.items) &&
    value.items.every(
      (issue) =>
        isRecord(issue) &&
        hasExactKeys(issue, [
          "code",
          "fortuneDate",
          "severity",
          "title",
          "impact",
          "mitigation",
          "actionLabel",
          "actionHref",
          "firstDetectedAt",
          "updatedAt",
        ]) &&
        adminIssueCodes.has(issue.code as string) &&
        isFortuneDate(issue.fortuneDate) &&
        (issue.severity === "critical" || issue.severity === "warning") &&
        isBoundedString(issue.title, 1, 100) &&
        isBoundedString(issue.impact, 1, 300) &&
        (issue.mitigation === null || isBoundedString(issue.mitigation, 1, 300)) &&
        isBoundedString(issue.actionLabel, 1, 40) &&
        isBoundedString(issue.actionHref, 7, 512) &&
        issue.actionHref.startsWith("/admin/") &&
        isZonedDateTime(issue.firstDetectedAt) &&
        isZonedDateTime(issue.updatedAt),
    )
  );
}

function isAdminDayDetail(value: unknown): value is AdminDayDetail {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "requestContext",
      "publicContentContext",
      "nextOperationalBoundaryAt",
      "summary",
      "previewSource",
      "preview",
      "previewRequestContext",
      "previewPublicContentContext",
      "editableSelectionKeys",
      "readonlySelectionKeys",
      "concurrency",
    ]) &&
    isRequestContext(value.requestContext) &&
    isPublicContentContext(value.publicContentContext) &&
    isZonedDateTime(value.nextOperationalBoundaryAt) &&
    isAdminDaySummary(value.summary) &&
    (value.summary.relation !== "current" ||
      value.summary.fortuneDate === value.publicContentContext.servedFortuneDate) &&
    new Set(["published", "scheduled", "approved", "draft", "none"]).has(
      value.previewSource as string,
    ) &&
    isDailyContentPreview(value.preview) &&
    isRequestContext(value.previewRequestContext) &&
    isPublicContentContext(value.previewPublicContentContext) &&
    value.previewPublicContentContext.servedFortuneDate === value.summary.fortuneDate &&
    isPreviewAlignedWithPublicContext(value.preview, value.previewPublicContentContext) &&
    Array.isArray(value.editableSelectionKeys) &&
    value.editableSelectionKeys.every((key) => isBoundedString(key, 1, 128)) &&
    Array.isArray(value.readonlySelectionKeys) &&
    value.readonlySelectionKeys.every((key) => isBoundedString(key, 1, 128)) &&
    isRecord(value.concurrency) &&
    hasExactKeys(value.concurrency, [
      "activeContentVersion",
      "lifecycleRevision",
      "scheduleSlotRevision",
    ]) &&
    (value.concurrency.activeContentVersion === null ||
      isBoundedString(value.concurrency.activeContentVersion, 1, 128)) &&
    Number.isInteger(value.concurrency.lifecycleRevision) &&
    Number(value.concurrency.lifecycleRevision) >= 0 &&
    Number.isInteger(value.concurrency.scheduleSlotRevision) &&
    Number(value.concurrency.scheduleSlotRevision) >= 0
  );
}

function isOpaqueId(value: unknown): value is string {
  return isBoundedString(value, 1, 128);
}

function isContentVersion(value: unknown): value is string {
  const hasForbiddenControl =
    typeof value === "string" &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    });
  return isBoundedString(value, 1, 128) && value.trim() === value && !hasForbiddenControl;
}

function isDailyImageSlot(value: unknown): value is DailyImageSlot {
  return value === "required_primary" || value === "required_alternative" || value === "optional";
}

function isContentState(value: unknown): boolean {
  return typeof value === "string" && contentStates.has(value);
}

function isDraftModules(value: unknown): value is ContentDraft["modules"] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "calendar_algorithm",
      "copy_and_formula",
      "poster_consistency",
      "visual_and_rights",
    ])
  ) {
    return false;
  }
  return DRAFT_MODULE_CODES.every(
    (code) => value[code] === null || isDraftModuleUpdate(code, value[code]),
  );
}

function isContentDraft(value: unknown): value is ContentDraft {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "createdAt",
      "draftId",
      "draftRevision",
      "fortuneDate",
      "modules",
      "state",
      "updatedAt",
    ]) &&
    isOpaqueId(value.draftId) &&
    isFortuneDate(value.fortuneDate) &&
    value.state === "draft" &&
    isPositiveInteger(value.draftRevision) &&
    isDraftModules(value.modules) &&
    isZonedDateTime(value.createdAt) &&
    isZonedDateTime(value.updatedAt)
  );
}

function isDayCorrectionWorkingCopy(value: unknown): value is DayCorrectionWorkingCopy {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "applyMode",
      "baselineActiveContentVersion",
      "correctionId",
      "correctionRevision",
      "createdAt",
      "draftId",
      "draftRevision",
      "fortuneDate",
      "modules",
      "sourceContentVersion",
      "status",
      "submittedContentVersion",
      "updatedAt",
    ]) &&
    isOpaqueId(value.correctionId) &&
    isOpaqueId(value.draftId) &&
    isFortuneDate(value.fortuneDate) &&
    isPositiveInteger(value.correctionRevision) &&
    isPositiveInteger(value.draftRevision) &&
    (value.status === "open" ||
      value.status === "applying" ||
      value.status === "submitted" ||
      value.status === "applied" ||
      value.status === "abandoned") &&
    (value.applyMode === null ||
      value.applyMode === "immediate" ||
      value.applyMode === "scheduled") &&
    (value.sourceContentVersion === null || isContentVersion(value.sourceContentVersion)) &&
    (value.baselineActiveContentVersion === null ||
      isContentVersion(value.baselineActiveContentVersion)) &&
    (value.submittedContentVersion === null || isContentVersion(value.submittedContentVersion)) &&
    isZonedDateTime(value.createdAt) &&
    isZonedDateTime(value.updatedAt) &&
    isDraftModules(value.modules)
  );
}

function isDayCorrectionPatchResult(value: unknown): value is DayCorrectionPatchResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "correctionId",
      "correctionRevision",
      "draftRevision",
      "fortuneDate",
      "moduleCode",
    ]) &&
    isOpaqueId(value.correctionId) &&
    isPositiveInteger(value.correctionRevision) &&
    isPositiveInteger(value.draftRevision) &&
    isFortuneDate(value.fortuneDate) &&
    isDraftModuleCode(value.moduleCode)
  );
}

function isDayCorrectionApplyResult(value: unknown): value is DayCorrectionApplyResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "action",
      "correctionId",
      "correctionRevision",
      "draftRevision",
      "mode",
    ]) &&
    isOpaqueId(value.correctionId) &&
    isPositiveInteger(value.correctionRevision) &&
    isPositiveInteger(value.draftRevision) &&
    (value.mode === "immediate" || value.mode === "scheduled") &&
    isLifecycleActionResult(value.action)
  );
}

function isDayCorrectionImageJob(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "actorId",
      "attemptLimit",
      "attempts",
      "availableAt",
      "completedAssetId",
      "correctionId",
      "draftId",
      "fortuneDate",
      "generationRevision",
      "imageSlot",
      "jobId",
      "lastError",
      "promptVersion",
      "reason",
      "requestId",
      "requestedAt",
      "status",
    ]) &&
    isOpaqueId(value.actorId) &&
    isOpaqueId(value.correctionId) &&
    isOpaqueId(value.draftId) &&
    isOpaqueId(value.jobId) &&
    isFortuneDate(value.fortuneDate) &&
    isDailyImageSlot(value.imageSlot) &&
    isPositiveInteger(value.generationRevision) &&
    isPositiveInteger(value.attemptLimit) &&
    Number.isSafeInteger(value.attempts) &&
    Number(value.attempts) >= 0 &&
    Number(value.attempts) <= Number(value.attemptLimit) &&
    isBoundedString(value.promptVersion, 1, 128) &&
    new Set(["queued", "claimed", "retryable", "failed", "completed"]).has(
      value.status as string,
    ) &&
    isZonedDateTime(value.availableAt) &&
    isZonedDateTime(value.requestedAt) &&
    (value.lastError === null || isBoundedString(value.lastError, 1, 500)) &&
    (value.completedAssetId === null || isOpaqueId(value.completedAssetId)) &&
    isBoundedString(value.reason, 1, 500) &&
    isBoundedString(value.requestId, 1, 128)
  );
}

function isDayCorrectionImageStatus(value: unknown): value is DayCorrectionImageStatus {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["candidate", "correctionRevision", "draftRevision", "job"]) &&
    isPositiveInteger(value.correctionRevision) &&
    isPositiveInteger(value.draftRevision) &&
    (value.job === null || isDayCorrectionImageJob(value.job)) &&
    (value.candidate === null || isDraftImageAssetResult(value.candidate))
  );
}

function isDayCorrectionImageSelectionResult(
  value: unknown,
): value is DayCorrectionImageSelectionResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "assetId",
      "correctionRevision",
      "draftRevision",
      "previewUrl",
      "workingCopy",
    ]) &&
    isOpaqueId(value.assetId) &&
    isPositiveInteger(value.correctionRevision) &&
    isPositiveInteger(value.draftRevision) &&
    isBoundedString(value.previewUrl, 1, 2048) &&
    value.previewUrl.startsWith("/admin/api/v1/image-assets/") &&
    isDayCorrectionWorkingCopy(value.workingCopy) &&
    value.workingCopy.correctionRevision === value.correctionRevision &&
    value.workingCopy.draftRevision === value.draftRevision
  );
}

function isDayCorrectionImageLibraryPage(value: unknown): value is DayCorrectionImageLibraryPage {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["copyEnabled", "items"]) &&
    value.copyEnabled === true &&
    Array.isArray(value.items) &&
    value.items.length <= 100 &&
    value.items.every(
      (item) =>
        isRecord(item) &&
        hasExactKeys(item, [
          "assetId",
          "colorCodes",
          "imageSlot",
          "previewUrl",
          "sourceContentVersion",
          "sourceFortuneDate",
        ]) &&
        isOpaqueId(item.assetId) &&
        isDailyImageSlot(item.imageSlot) &&
        Array.isArray(item.colorCodes) &&
        item.colorCodes.length <= 12 &&
        item.colorCodes.every((colorCode) => isBoundedString(colorCode, 1, 64)) &&
        isBoundedString(item.previewUrl, 1, 2048) &&
        isContentVersion(item.sourceContentVersion) &&
        isFortuneDate(item.sourceFortuneDate),
    )
  );
}

function isContentDraftSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "createdAt",
      "draftId",
      "draftRevision",
      "fortuneDate",
      "state",
      "updatedAt",
    ]) &&
    isOpaqueId(value.draftId) &&
    isFortuneDate(value.fortuneDate) &&
    value.state === "draft" &&
    isPositiveInteger(value.draftRevision) &&
    isZonedDateTime(value.createdAt) &&
    isZonedDateTime(value.updatedAt)
  );
}

function isContentDraftList(value: unknown): value is ContentDraftList {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["items"]) &&
    Array.isArray(value.items) &&
    value.items.every(isContentDraftSummary)
  );
}

function isDailyContentProductionSlot(value: unknown, imageSlot: DailyImageSlot): boolean {
  const allowedStatuses =
    imageSlot === "optional"
      ? new Set(["not_requested", "pending", "ready", "failed"])
      : new Set(["pending", "ready", "failed"]);
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "attemptLimit",
      "attempts",
      "canRetry",
      "deliveryReady",
      "imageSlot",
      "lastError",
      "nextAttemptAt",
      "status",
    ]) &&
    value.imageSlot === imageSlot &&
    allowedStatuses.has(value.status as string) &&
    Number.isSafeInteger(value.attempts) &&
    Number(value.attempts) >= 0 &&
    Number.isSafeInteger(value.attemptLimit) &&
    Number(value.attemptLimit) >= 0 &&
    Number(value.attempts) <= Number(value.attemptLimit) &&
    typeof value.deliveryReady === "boolean" &&
    typeof value.canRetry === "boolean" &&
    (value.lastError === null || isBoundedString(value.lastError, 1, 500)) &&
    (value.nextAttemptAt === null || isZonedDateTime(value.nextAttemptAt))
  );
}

function isDailyContentProduction(value: unknown): value is DailyContentProduction {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "completedImageSlots",
      "draftId",
      "draftRevision",
      "fortuneDate",
      "imageSlots",
      "lastError",
      "optionalImageStatus",
      "pendingImageSlots",
      "requiredGenerationComplete",
      "requiredImagesReady",
      "status",
      "updatedAt",
    ]) &&
    isOpaqueId(value.draftId) &&
    isFortuneDate(value.fortuneDate) &&
    isPositiveInteger(value.draftRevision) &&
    Number.isInteger(value.completedImageSlots) &&
    Number(value.completedImageSlots) >= 0 &&
    Number(value.completedImageSlots) <= 2 &&
    Number.isInteger(value.pendingImageSlots) &&
    Number(value.pendingImageSlots) >= 0 &&
    Number(value.pendingImageSlots) <= 2 &&
    Array.isArray(value.imageSlots) &&
    value.imageSlots.length === 3 &&
    isDailyContentProductionSlot(value.imageSlots[0], "required_primary") &&
    isDailyContentProductionSlot(value.imageSlots[1], "required_alternative") &&
    isDailyContentProductionSlot(value.imageSlots[2], "optional") &&
    typeof value.requiredGenerationComplete === "boolean" &&
    value.requiredGenerationComplete ===
      (value.imageSlots[0]?.status === "ready" && value.imageSlots[1]?.status === "ready") &&
    typeof value.requiredImagesReady === "boolean" &&
    value.requiredImagesReady ===
      (value.imageSlots[0]?.deliveryReady === true &&
        value.imageSlots[1]?.deliveryReady === true) &&
    value.optionalImageStatus === value.imageSlots[2]?.status &&
    (value.status === "generating" ||
      value.status === "awaiting_review" ||
      value.status === "failed") &&
    (value.lastError === null || isBoundedString(value.lastError, 1, 500)) &&
    isZonedDateTime(value.updatedAt)
  );
}

function isDailyContentProductionList(value: unknown): value is DailyContentProductionList {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["items"]) &&
    Array.isArray(value.items) &&
    value.items.every(isDailyContentProduction)
  );
}

function isUpdatedDraftModule(value: unknown): value is UpdatedDraftModule {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["draftId", "draftRevision", "module", "moduleCode"]) &&
    isOpaqueId(value.draftId) &&
    isPositiveInteger(value.draftRevision) &&
    isDraftModuleCode(value.moduleCode) &&
    isDraftModuleUpdate(value.moduleCode, value.module)
  );
}

function isSubmitDraftResult(value: unknown): value is SubmitDraftResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["contentVersion", "draftId", "lifecycleRevision", "state"]) &&
    isOpaqueId(value.draftId) &&
    isContentVersion(value.contentVersion) &&
    (value.state === "approved" || value.state === "in_review") &&
    isPositiveInteger(value.lifecycleRevision)
  );
}

function isContentVersionSummary(value: unknown): value is ContentVersionSummary {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "contentVersion",
      "createdAt",
      "effectiveFrom",
      "effectiveTo",
      "lifecycleRevision",
      "state",
    ]) &&
    isContentVersion(value.contentVersion) &&
    isContentState(value.state) &&
    isPositiveInteger(value.lifecycleRevision) &&
    isZonedDateTime(value.createdAt) &&
    (value.effectiveFrom === null || isZonedDateTime(value.effectiveFrom)) &&
    (value.effectiveTo === null || isZonedDateTime(value.effectiveTo))
  );
}

function isContentVersionList(value: unknown): value is ContentVersionList {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["activeContentVersion", "fortuneDate", "items"]) &&
    isFortuneDate(value.fortuneDate) &&
    (value.activeContentVersion === null || isContentVersion(value.activeContentVersion)) &&
    Array.isArray(value.items) &&
    value.items.every(isContentVersionSummary)
  );
}

function isEvidenceReference(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["kind", "reference"]) &&
    ["attachment", "message_link", "document", "note"].includes(String(value.kind)) &&
    isBoundedString(value.reference, 1, 500)
  );
}

function isMasterReviewEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "conclusion",
      "evidenceId",
      "notes",
      "references",
      "reviewedAt",
      "reviewerDisplayName",
    ]) &&
    isOpaqueId(value.evidenceId) &&
    isBoundedString(value.reviewerDisplayName, 1, 80) &&
    isZonedDateTime(value.reviewedAt) &&
    (value.conclusion === "confirmed" || value.conclusion === "changes_requested") &&
    isBoundedString(value.notes, 0, 2000) &&
    Array.isArray(value.references) &&
    value.references.length >= 1 &&
    value.references.length <= 20 &&
    value.references.every(isEvidenceReference)
  );
}

function isPreflightCheck(value: unknown): boolean {
  const codes = [
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
  return (
    isRecord(value) &&
    hasExactKeys(value, ["code", "message", "status"]) &&
    codes.includes(String(value.code)) &&
    ["pending", "passed", "failed"].includes(String(value.status)) &&
    isBoundedString(value.message, 0, 300)
  );
}

function isAdminContentVersion(value: unknown): value is AdminContentVersion {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "activeContentVersion",
      "contentVersion",
      "fortuneDate",
      "lifecycleRevision",
      "masterReviewEvidence",
      "preflightChecks",
      "snapshot",
      "state",
    ]) &&
    isContentVersion(value.contentVersion) &&
    isFortuneDate(value.fortuneDate) &&
    isContentState(value.state) &&
    isPositiveInteger(value.lifecycleRevision) &&
    (value.activeContentVersion === null || isContentVersion(value.activeContentVersion)) &&
    isDraftModules(value.snapshot) &&
    Array.isArray(value.preflightChecks) &&
    value.preflightChecks.every(isPreflightCheck) &&
    Array.isArray(value.masterReviewEvidence) &&
    value.masterReviewEvidence.every(isMasterReviewEvidence)
  );
}

function isLifecycleActionResult(value: unknown): value is LifecycleActionResult {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "activeContentVersion",
      "auditEventId",
      "contentVersion",
      "fortuneDate",
      "lifecycleRevision",
      "state",
      "transitions",
    ]) &&
    isFortuneDate(value.fortuneDate) &&
    isContentVersion(value.contentVersion) &&
    isContentState(value.state) &&
    isPositiveInteger(value.lifecycleRevision) &&
    (value.activeContentVersion === null || isContentVersion(value.activeContentVersion)) &&
    isOpaqueId(value.auditEventId) &&
    Array.isArray(value.transitions) &&
    value.transitions.length >= 1 &&
    value.transitions.every(
      (transition) =>
        isRecord(transition) &&
        hasExactKeys(transition, ["contentVersion", "fromState", "toState"]) &&
        isContentVersion(transition.contentVersion) &&
        isContentState(transition.fromState) &&
        isContentState(transition.toState),
    )
  );
}

function parseRetryAfter(response: Response): number | null {
  const rawValue = response.headers.get("Retry-After");
  if (rawValue === null) return null;
  const seconds = Number.parseInt(rawValue, 10);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

function readValidRequestId(response: Response): string | null {
  const requestId = response.headers.get("X-Request-Id");
  return isBoundedString(requestId, 8, 128) ? requestId : null;
}

function hasNoStoreHeader(response: Response): boolean {
  return response.headers.get("Cache-Control")?.trim().toLowerCase() === "no-store";
}

function hasJsonMediaType(response: Response): boolean {
  const contentType = response.headers.get("Content-Type");
  return (
    isBoundedString(contentType, 1, 256) &&
    contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function hasStrongEmergencyControlEtag(response: Response): boolean {
  const etag = response.headers.get("ETag");
  return isBoundedString(etag, 1, 128) && /^"emergency-control:(?:0|[1-9]\d*)"$/u.test(etag);
}

function hasStrongDraftEtag(response: Response): boolean {
  const etag = response.headers.get("ETag");
  return isBoundedString(etag, 1, 128) && /^"draft:[1-9]\d*"$/u.test(etag);
}

function hasStrongLifecycleEtag(response: Response): boolean {
  const etag = response.headers.get("ETag");
  return isBoundedString(etag, 1, 128) && /^"lifecycle:[1-9]\d*"$/u.test(etag);
}

function readOpaqueEtag(response: Response): string | null {
  const etag = response.headers.get("ETag");
  return isBoundedString(etag, 3, 256) && /^"[^"\r\n]+"$/u.test(etag) ? etag : null;
}

type SuccessHeaderRequirements = {
  draftEtag?: boolean;
  emergencyControlEtag?: boolean;
  lifecycleEtag?: boolean;
  opaqueEtag?: boolean;
};

async function readContractError(
  response: Response,
  requestId: string | null,
): Promise<Pick<AdminApiError, "code" | "details" | "retryable"> | null> {
  if (requestId === null || !hasNoStoreHeader(response) || !hasJsonMediaType(response)) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !hasExactKeys(body, ["error"]) || !isRecord(body.error)) return null;
  const error = body.error;
  if (
    !hasExactKeys(error, ["code", "details", "message", "requestId", "retryable"]) ||
    !isErrorCode(error.code) ||
    !isRecord(error.details) ||
    !isBoundedString(error.message, 1, 500) ||
    error.requestId !== requestId ||
    typeof error.retryable !== "boolean"
  ) {
    return null;
  }
  return { code: error.code, details: error.details, retryable: error.retryable };
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  expectedStatus: number,
  validator: Validator<T>,
  headerRequirements: SuccessHeaderRequirements = {},
): Promise<AdminApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });
  } catch {
    return {
      error: { kind: "api-error", requestId: null, retryAfterSeconds: null, status: 0 },
      ok: false,
    };
  }

  const requestId = readValidRequestId(response);
  if (response.status !== expectedStatus) {
    const contractError = await readContractError(response, requestId);
    const etag = readOpaqueEtag(response);
    return {
      error: {
        ...(contractError ?? {}),
        ...(etag === null ? {} : { etag }),
        kind: "api-error",
        requestId,
        retryAfterSeconds: parseRetryAfter(response),
        status: response.status,
      },
      ok: false,
    };
  }

  if (
    requestId === null ||
    !hasNoStoreHeader(response) ||
    !hasJsonMediaType(response) ||
    (headerRequirements.draftEtag === true && !hasStrongDraftEtag(response)) ||
    (headerRequirements.emergencyControlEtag === true &&
      !hasStrongEmergencyControlEtag(response)) ||
    (headerRequirements.lifecycleEtag === true && !hasStrongLifecycleEtag(response)) ||
    (headerRequirements.opaqueEtag === true && readOpaqueEtag(response) === null)
  ) {
    return {
      error: { kind: "api-error", requestId, retryAfterSeconds: null, status: 502 },
      ok: false,
    };
  }

  const body: unknown = await response.json().catch(() => null);
  if (!validator(body)) {
    return {
      error: { kind: "api-error", requestId, retryAfterSeconds: null, status: 502 },
      ok: false,
    };
  }

  return { data: body, ok: true, response };
}

async function requestEmpty(path: string, init: RequestInit): Promise<AdminApiResult<null>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });
  } catch {
    return {
      error: { kind: "api-error", requestId: null, retryAfterSeconds: null, status: 0 },
      ok: false,
    };
  }

  if (response.status !== 204) {
    return {
      error: {
        kind: "api-error",
        requestId: readValidRequestId(response),
        retryAfterSeconds: parseRetryAfter(response),
        status: response.status,
      },
      ok: false,
    };
  }
  const requestId = readValidRequestId(response);
  if (requestId === null || !hasNoStoreHeader(response)) {
    return {
      error: { kind: "api-error", requestId, retryAfterSeconds: null, status: 502 },
      ok: false,
    };
  }
  return { data: null, ok: true, response };
}

function jsonBody(value: unknown): Pick<RequestInit, "body" | "headers"> {
  return {
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  };
}

export function describeAdminApiError(error: AdminApiError, authenticated = false): string {
  if (error.status === 0) return "无法连接后台服务，请检查网络后重试。";
  if (error.status === 401) {
    return authenticated ? "后台会话已失效，请重新登录。" : "账号或密码无效。";
  }
  if (error.status === 403) return "安全校验未通过，请刷新页面后重新登录。";
  if (error.status === 409) return "操作状态已经变化，请刷新最新状态后重试。";
  if (error.status === 412) return "页面中的状态已过期，请刷新最新状态后再操作。";
  if (error.status === 422) return "内容暂时无法处理，请刷新页面后重试。";
  if (error.status === 428) return "缺少最新状态凭据，请刷新页面后再操作。";
  if (error.status === 429) {
    return error.retryAfterSeconds === null
      ? "尝试次数较多，请稍后再试。"
      : `尝试次数较多，请 ${error.retryAfterSeconds} 秒后再试。`;
  }
  if (error.status === 503) return "后台服务暂时不可用，请稍后重试。";
  if (error.status === 502) return "后台返回了无法确认的响应，请勿继续操作并稍后重试。";
  if (error.status === 400) return "请检查输入格式后重试。";
  return "操作没有完成，请稍后重试。";
}

export function describeAdminContentApiError(error: AdminApiError): string {
  if (error.code === "ACTIVE_CONTENT_VERSION_CHANGED") {
    return "当前在线版本已经变化，请重新读取同日版本后再操作。";
  }
  if (error.code === "IDEMPOTENCY_KEY_REUSED") {
    return "安全操作编号已用于另一项内容，请重新读取状态后开始新操作。";
  }
  if (error.code === "INVALID_STATE_TRANSITION") {
    return "当前内容状态不允许这项操作，请重新读取最新状态。";
  }
  if (error.code === "VERSION_WITHDRAWN") {
    return "已下线版本不能直接发布或恢复，请复制为新草稿重新核对。";
  }
  if (error.code === "REVISION_MISMATCH") {
    return "页面中的生命周期修订已过期，请重新读取后再操作。";
  }
  if (error.code === "PUBLISH_PRECHECK_FAILED") {
    return "发布预检未通过，请按上方检查清单处理失败项后重试。";
  }
  if (error.code === "SCHEDULE_TIME_INVALID") {
    return "服务端返回的生效时间已失效或不符合内容有效区间，请重新读取。";
  }
  if (error.code === "PRECONDITION_REQUIRED") {
    return "缺少最新生命周期凭据，请重新读取这份版本。";
  }
  if (error.status === 404) return "没有找到这份草稿或内容版本，请返回工作台重新查询。";
  if (error.status === 409) return "内容状态已经变化或存在冲突，请重新读取最新版本后操作。";
  return describeAdminApiError(error, true);
}

export function describeAdminImageApiError(error: AdminApiError): string {
  if (error.status === 413) return "图片文件过大，请压缩到上传限制以内后重试。";
  if (error.status === 415) return "图片格式不支持，请改用 AVIF、WebP、JPEG 或 PNG。";
  if (error.status === 422) return "图片元数据、权利状态或人工检查尚未满足要求。";
  return describeAdminContentApiError(error);
}

type LifecycleActionInput<TBody> = {
  body: TBody;
  contentVersion: string;
  csrfToken: string;
  etag: string;
  idempotencyKey: string;
};

function requestLifecycleAction<TBody>(path: string, input: LifecycleActionInput<TBody>) {
  return requestJson(
    path,
    {
      ...jsonBody(input.body),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
        "If-Match": input.etag,
        "X-CSRF-Token": input.csrfToken,
      },
      method: "POST",
    },
    200,
    isLifecycleActionResult,
    { lifecycleEtag: true },
  );
}

export const adminApi = {
  applyDayCorrection(input: {
    correctionId: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
    reason: string;
  }) {
    return requestJson(
      `/admin/api/v1/day-corrections/${encodeURIComponent(input.correctionId)}/apply`,
      {
        ...jsonBody({ reason: input.reason }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isDayCorrectionApplyResult,
      { opaqueEtag: true },
    );
  },
  getDayCorrection(correctionId: string) {
    return requestJson(
      `/admin/api/v1/day-corrections/${encodeURIComponent(correctionId)}`,
      { method: "GET" },
      200,
      isDayCorrectionWorkingCopy,
      { opaqueEtag: true },
    );
  },
  getDayCorrectionImageStatus(input: { correctionId: string; imageSlot: DailyImageSlot }) {
    return requestJson(
      `/admin/api/v1/day-corrections/${encodeURIComponent(input.correctionId)}/images/${input.imageSlot}`,
      { method: "GET" },
      200,
      isDayCorrectionImageStatus,
      { opaqueEtag: true },
    );
  },
  listReusableDayCorrectionImages(input: { correctionId: string; imageSlot: DailyImageSlot }) {
    return requestJson(
      `/admin/api/v1/day-corrections/${encodeURIComponent(input.correctionId)}/images/${input.imageSlot}/library`,
      { method: "GET" },
      200,
      isDayCorrectionImageLibraryPage,
    );
  },
  getOperationsCalendar(month: string) {
    const search = new URLSearchParams({ month });
    return requestJson(
      `/admin/api/v1/operations/calendar?${search.toString()}`,
      { method: "GET" },
      200,
      isAdminCalendarMonth,
    );
  },
  getOperationsDay(fortuneDate: string) {
    return requestJson(
      `/admin/api/v1/operations/days/${encodeURIComponent(fortuneDate)}`,
      { method: "GET" },
      200,
      isAdminDayDetail,
    );
  },
  getOperationsIssues() {
    return requestJson(
      "/admin/api/v1/operations/issues",
      { method: "GET" },
      200,
      isAdminActionableIssueList,
    );
  },
  getOperationsOverview() {
    return requestJson(
      "/admin/api/v1/operations/overview",
      { method: "GET" },
      200,
      isAdminOperationsOverview,
    );
  },
  getAnalyticsOverview(input: {
    channelId?: string;
    contentVersion?: string;
    from: string;
    to: string;
  }) {
    const search = new URLSearchParams({ from: input.from, to: input.to });
    if (input.channelId !== undefined) search.set("channelId", input.channelId);
    if (input.contentVersion !== undefined) search.set("contentVersion", input.contentVersion);
    return requestJson(
      `/admin/api/v1/analytics/overview?${search.toString()}`,
      { method: "GET" },
      200,
      isAdminAnalyticsOverview,
    );
  },
  getAnalyticsReport(days: 7 | 30) {
    return requestJson(
      `/admin/api/v1/analytics/report?days=${days}`,
      { method: "GET" },
      200,
      isAdminAnalyticsReport,
    );
  },
  openDayCorrection(input: { csrfToken: string; fortuneDate: string }) {
    return requestJson(
      "/admin/api/v1/day-corrections",
      {
        ...jsonBody({ fortuneDate: input.fortuneDate }),
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isDayCorrectionWorkingCopy,
      { opaqueEtag: true },
    );
  },
  patchDayCorrection(input: {
    command: DayCorrectionCommand;
    correctionId: string;
    csrfToken: string;
    etag: string;
  }) {
    return requestJson(
      `/admin/api/v1/day-corrections/${encodeURIComponent(input.correctionId)}`,
      {
        ...jsonBody(input.command),
        headers: {
          "Content-Type": "application/json",
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "PATCH",
      },
      200,
      isDayCorrectionPatchResult,
      { opaqueEtag: true },
    );
  },
  regenerateDayCorrectionImage(input: {
    correctionId: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
    imageSlot: DailyImageSlot;
    reason: string;
  }) {
    return requestJson(
      `/admin/api/v1/day-corrections/${encodeURIComponent(input.correctionId)}/images/${input.imageSlot}/regenerate`,
      {
        ...jsonBody({ reason: input.reason }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      202,
      isDayCorrectionImageStatus,
      { opaqueEtag: true },
    );
  },
  reuseDayCorrectionImage(input: {
    assetId: string;
    correctionId: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
    imageSlot: DailyImageSlot;
    reason: string;
    sourceContentVersion: string;
  }) {
    return requestJson(
      `/admin/api/v1/day-corrections/${encodeURIComponent(input.correctionId)}/images/${input.imageSlot}/library/select`,
      {
        ...jsonBody({
          assetId: input.assetId,
          reason: input.reason,
          sourceContentVersion: input.sourceContentVersion,
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isDayCorrectionImageSelectionResult,
      { opaqueEtag: true },
    );
  },
  selectDayCorrectionImageCandidate(input: {
    assetId: string;
    correctionId: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
    imageSlot: DailyImageSlot;
    reason: string;
  }) {
    return requestJson(
      `/admin/api/v1/day-corrections/${encodeURIComponent(input.correctionId)}/images/${input.imageSlot}/select`,
      {
        ...jsonBody({ assetId: input.assetId, reason: input.reason }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isDayCorrectionImageSelectionResult,
      { opaqueEtag: true },
    );
  },
  uploadDayCorrectionImage(input: {
    correctionId: string;
    csrfToken: string;
    etag: string;
    formData: FormData;
    idempotencyKey: string;
    imageSlot: DailyImageSlot;
  }) {
    return requestJson(
      `/admin/api/v1/day-corrections/${encodeURIComponent(input.correctionId)}/images/${input.imageSlot}/upload`,
      {
        body: input.formData,
        headers: {
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      201,
      isDayCorrectionImageSelectionResult,
      { opaqueEtag: true },
    );
  },
  addMasterReviewEvidence(input: {
    body: AddMasterReviewEvidenceRequest;
    contentVersion: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/master-review-evidence`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isAdminContentVersion,
      { lifecycleEtag: true },
    );
  },
  cancelContentSchedule(input: LifecycleActionInput<ExpectedActiveVersionRequest>) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/cancel-schedule`,
      input,
    );
  },
  createDraft(input: { csrfToken: string; input: CreateDraftRequest }) {
    return requestJson(
      "/admin/api/v1/daily-content-drafts",
      {
        ...jsonBody(input.input),
        headers: { "Content-Type": "application/json", "X-CSRF-Token": input.csrfToken },
        method: "POST",
      },
      201,
      isContentDraft,
      { draftEtag: true },
    );
  },
  createSession(input: CreateAdminSessionRequest) {
    return requestJson(
      "/admin/api/v1/auth/sessions",
      { ...jsonBody(input), method: "POST" },
      201,
      isAdminSession,
    );
  },
  getEmergencyStatus() {
    return requestJson(
      "/admin/api/v1/emergency-control",
      { method: "GET" },
      200,
      isEmergencyControlStatus,
      { emergencyControlEtag: true },
    );
  },
  getContentVersion(contentVersion: string) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(contentVersion)}`,
      { method: "GET" },
      200,
      isAdminContentVersion,
      { lifecycleEtag: true },
    );
  },
  getDailyImageSet(contentVersion: string) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(contentVersion)}/daily-image-set`,
      { method: "GET" },
      200,
      isAdminDailyImageSet,
      { lifecycleEtag: true },
    );
  },
  getDraft(draftId: string) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(draftId)}`,
      { method: "GET" },
      200,
      isContentDraft,
      { draftEtag: true },
    );
  },
  getSession() {
    return requestJson("/admin/api/v1/auth/session", { method: "GET" }, 200, isAdminSession);
  },
  generateDailyContent(input: { csrfToken: string; fortuneDate: string; idempotencyKey: string }) {
    return requestJson(
      "/admin/api/v1/daily-content-productions",
      {
        ...jsonBody({ fortuneDate: input.fortuneDate }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      202,
      isDailyContentProduction,
    );
  },
  listSecurityEvents(cursor: string | null) {
    const search = new URLSearchParams({ limit: "50" });
    if (cursor !== null) search.set("cursor", cursor);
    return requestJson(
      `/admin/api/v1/security-events?${search.toString()}`,
      { method: "GET" },
      200,
      isSecurityEventPage,
    );
  },
  listContentVersions(fortuneDate: string) {
    const search = new URLSearchParams({ fortuneDate });
    return requestJson(
      `/admin/api/v1/daily-content-versions?${search.toString()}`,
      { method: "GET" },
      200,
      isContentVersionList,
    );
  },
  listDraftImages(draftId: string) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(draftId)}/image-assets`,
      { method: "GET" },
      200,
      isDraftImageAssetList,
      { draftEtag: true },
    );
  },
  listDrafts(fortuneDate: string | null = null) {
    const search = new URLSearchParams();
    if (fortuneDate !== null) search.set("fortuneDate", fortuneDate);
    const query = search.size === 0 ? "" : `?${search.toString()}`;
    return requestJson(
      `/admin/api/v1/daily-content-drafts${query}`,
      { method: "GET" },
      200,
      isContentDraftList,
    );
  },
  listProductions() {
    return requestJson(
      "/admin/api/v1/daily-content-productions",
      { method: "GET" },
      200,
      isDailyContentProductionList,
    );
  },
  logout(csrfToken: string) {
    return requestEmpty("/admin/api/v1/auth/session", {
      headers: { "X-CSRF-Token": csrfToken },
      method: "DELETE",
    });
  },
  logoutAll(csrfToken: string) {
    return requestEmpty("/admin/api/v1/auth/logout-all", {
      headers: { "X-CSRF-Token": csrfToken },
      method: "POST",
    });
  },
  publishContentVersion(input: LifecycleActionInput<ExpectedActiveVersionRequest>) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/publish`,
      input,
    );
  },
  setEmergencyStatus(input: {
    body: EmergencyResumeRequest | EmergencyStopRequest;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
    operation: "resume" | "stop";
  }) {
    return requestJson(
      `/admin/api/v1/emergency-control/${input.operation}`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isEmergencyControlStatus,
      { emergencyControlEtag: true },
    );
  },
  reviewDraftImage(input: {
    assetId: string;
    body: ImageAssetReviewRequest;
    csrfToken: string;
    draftId: string;
    etag: string;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(input.draftId)}/image-assets/${encodeURIComponent(input.assetId)}/review`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isDraftImageAssetResult,
      { draftEtag: true },
    );
  },
  rollbackContentDay(input: LifecycleActionInput<RollbackRequest> & { fortuneDate: string }) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-days/${encodeURIComponent(input.fortuneDate)}/rollback`,
      input,
    );
  },
  scheduleContentVersion(input: LifecycleActionInput<ScheduleRequest>) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/schedule`,
      input,
    );
  },
  submitDraft(input: { csrfToken: string; draftId: string; etag: string; idempotencyKey: string }) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(input.draftId)}/submit`,
      {
        headers: {
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      201,
      isSubmitDraftResult,
      { lifecycleEtag: true },
    );
  },
  updateDraftModule(input: {
    csrfToken: string;
    draftId: string;
    etag: string;
    module: DraftModuleUpdate;
    moduleCode: DraftModuleCode;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(input.draftId)}/modules/${input.moduleCode}`,
      {
        ...jsonBody(input.module),
        headers: {
          "Content-Type": "application/json",
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "PATCH",
      },
      200,
      isUpdatedDraftModule,
      { draftEtag: true },
    );
  },
  uploadDraftImage(input: {
    csrfToken: string;
    draftId: string;
    etag: string;
    formData: FormData;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-drafts/${encodeURIComponent(input.draftId)}/image-assets`,
      {
        body: input.formData,
        headers: {
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      201,
      isDraftImageAssetResult,
      { draftEtag: true },
    );
  },
  withdrawImage(input: {
    assetId: string;
    body: WithdrawImageAssetRequest;
    contentVersion: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/image-assets/${encodeURIComponent(input.assetId)}/withdraw`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isImageAssetWithdrawalResult,
      { lifecycleEtag: true },
    );
  },
  withdrawContentVersion(input: LifecycleActionInput<WithdrawRequest>) {
    return requestLifecycleAction(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/withdraw`,
      input,
    );
  },
  decideContentReview(input: {
    body: ReviewDecisionRequest;
    contentVersion: string;
    csrfToken: string;
    etag: string;
    idempotencyKey: string;
  }) {
    return requestJson(
      `/admin/api/v1/daily-content-versions/${encodeURIComponent(input.contentVersion)}/review-decision`,
      {
        ...jsonBody(input.body),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": input.idempotencyKey,
          "If-Match": input.etag,
          "X-CSRF-Token": input.csrfToken,
        },
        method: "POST",
      },
      200,
      isLifecycleActionResult,
      { lifecycleEtag: true },
    );
  },
};

export function parseDraftModuleJson(
  moduleCode: DraftModuleCode,
  source: string,
): { ok: true; value: DraftModuleUpdate } | { message: string; ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { message: "内容不是有效 JSON，请检查括号、引号与逗号。", ok: false };
  }
  if (!isDraftModuleUpdate(moduleCode, parsed)) {
    return {
      message: `模块结构不符合接口契约。顶层字段应为：${DRAFT_MODULE_REQUIRED_KEYS[moduleCode].join("、")}。`,
      ok: false,
    };
  }
  return { ok: true, value: parsed };
}

export function createIdempotencyKey(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("Secure random number generation is unavailable");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
