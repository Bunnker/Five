import type { components } from "@five/api-contract";

export { isDraftModuleCode as isModuleCode, isDraftModuleUpdate } from "@five/api-contract/runtime";

import {
  CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN,
  isStrictRfc3339DateTime,
} from "../content-lifecycle/content-lifecycle.values";
import { isFortuneDate, isOpaquePublicValue } from "../today/public-route-params";
import { codePointLength, hasExactlyKeys } from "./admin-http";

type AddMasterReviewEvidenceRequest = components["schemas"]["AddMasterReviewEvidenceRequest"];
type ApplyDayCorrectionRequest = components["schemas"]["ApplyDayCorrectionRequest"];
type CreateDraftRequest = components["schemas"]["CreateDraftRequest"];
type ExpectedActiveVersionRequest = components["schemas"]["ExpectedActiveVersionRequest"];
type RollbackRequest = components["schemas"]["RollbackRequest"];
type ReviewDecisionRequest = components["schemas"]["ReviewDecisionRequest"];
type ScheduleRequest = components["schemas"]["ScheduleRequest"];
type WithdrawRequest = components["schemas"]["WithdrawRequest"];

function isBoundedText(value: unknown, minimum: number, maximum: number): value is string {
  return (
    typeof value === "string" &&
    codePointLength(value) >= minimum &&
    codePointLength(value) <= maximum
  );
}

function isNonBlankBoundedText(value: unknown, maximum: number): value is string {
  return isBoundedText(value, 1, maximum) && value.trim().length > 0;
}

export function isOpaqueAdminId(value: unknown): value is string {
  return typeof value === "string" && isOpaquePublicValue(value);
}

export function isCreateDraftRequest(value: unknown): value is CreateDraftRequest {
  if (!hasExactlyKeys(value, ["copyFromContentVersion", "fortuneDate"])) {
    return false;
  }
  return (
    typeof value.fortuneDate === "string" &&
    isFortuneDate(value.fortuneDate) &&
    (value.copyFromContentVersion === null || isOpaqueAdminId(value.copyFromContentVersion))
  );
}

export function isOpenDayCorrectionRequest(
  value: unknown,
): value is components["schemas"]["OpenDayCorrectionRequest"] {
  return (
    hasExactlyKeys(value, ["fortuneDate"]) &&
    typeof value.fortuneDate === "string" &&
    isFortuneDate(value.fortuneDate)
  );
}

export function isApplyDayCorrectionRequest(value: unknown): value is ApplyDayCorrectionRequest {
  return hasExactlyKeys(value, ["reason"]) && isNonBlankBoundedText(value.reason, 2_000);
}

export function isGenerateDailyContentRequest(
  value: unknown,
): value is components["schemas"]["GenerateDailyContentRequest"] {
  return (
    hasExactlyKeys(value, ["fortuneDate"]) &&
    typeof value.fortuneDate === "string" &&
    isFortuneDate(value.fortuneDate)
  );
}

export function isDailyImageSlot(value: unknown): value is components["schemas"]["DailyImageSlot"] {
  return value === "required_primary" || value === "required_alternative" || value === "optional";
}

export function isRequestImageSlotGenerationRequest(
  value: unknown,
): value is components["schemas"]["RequestImageSlotGenerationRequest"] {
  return hasExactlyKeys(value, ["reason"]) && isNonBlankBoundedText(value.reason, 500);
}

export function isSelectDraftImageAssetRequest(
  value: unknown,
): value is components["schemas"]["SelectDraftImageAssetRequest"] {
  return (
    hasExactlyKeys(value, ["imageSlot", "reason"]) &&
    isDailyImageSlot(value.imageSlot) &&
    isNonBlankBoundedText(value.reason, 500)
  );
}

export function isMasterReviewEvidenceRequest(
  value: unknown,
): value is AddMasterReviewEvidenceRequest {
  if (
    !hasExactlyKeys(value, [
      "conclusion",
      "notes",
      "references",
      "reviewedAt",
      "reviewerDisplayName",
    ]) ||
    !isNonBlankBoundedText(value.reviewerDisplayName, 80) ||
    !isStrictRfc3339DateTime(value.reviewedAt) ||
    (value.conclusion !== "confirmed" && value.conclusion !== "changes_requested") ||
    !isBoundedText(value.notes, 0, 2_000) ||
    !Array.isArray(value.references) ||
    value.references.length < 1 ||
    value.references.length > 20
  ) {
    return false;
  }
  return value.references.every(
    (reference) =>
      hasExactlyKeys(reference, ["kind", "reference"]) &&
      (reference.kind === "attachment" ||
        reference.kind === "message_link" ||
        reference.kind === "document" ||
        reference.kind === "note") &&
      isNonBlankBoundedText(reference.reference, 500),
  );
}

export function isReviewDecisionRequest(value: unknown): value is ReviewDecisionRequest {
  if (!hasExactlyKeys(value, ["decision", "reason"])) {
    return false;
  }
  if (value.decision === "changes_requested") {
    return isNonBlankBoundedText(value.reason, 2_000);
  }
  return (
    value.decision === "approved" &&
    (value.reason === null || isNonBlankBoundedText(value.reason, 2_000))
  );
}

function isExpectedActiveContentVersion(value: unknown): value is string | null {
  return value === null || isOpaqueAdminId(value);
}

export function isExpectedActiveVersionRequest(
  value: unknown,
): value is ExpectedActiveVersionRequest {
  return (
    hasExactlyKeys(value, ["expectedActiveContentVersion", "reason"]) &&
    isExpectedActiveContentVersion(value.expectedActiveContentVersion) &&
    isNonBlankBoundedText(value.reason, 2_000)
  );
}

export function isScheduleRequest(value: unknown): value is ScheduleRequest {
  return (
    hasExactlyKeys(value, ["effectiveFrom", "expectedActiveContentVersion", "reason"]) &&
    isStrictRfc3339DateTime(value.effectiveFrom) &&
    isExpectedActiveContentVersion(value.expectedActiveContentVersion) &&
    isNonBlankBoundedText(value.reason, 2_000)
  );
}

export function isWithdrawRequest(value: unknown): value is WithdrawRequest {
  return (
    hasExactlyKeys(value, [
      "expectedActiveContentVersion",
      "reason",
      "replacementContentVersion",
    ]) &&
    isExpectedActiveContentVersion(value.expectedActiveContentVersion) &&
    isNonBlankBoundedText(value.reason, 2_000) &&
    (value.replacementContentVersion === null || isOpaqueAdminId(value.replacementContentVersion))
  );
}

export function isRollbackRequest(value: unknown): value is RollbackRequest {
  return (
    hasExactlyKeys(value, ["expectedActiveContentVersion", "reason", "targetContentVersion"]) &&
    isExpectedActiveContentVersion(value.expectedActiveContentVersion) &&
    isNonBlankBoundedText(value.reason, 2_000) &&
    isOpaqueAdminId(value.targetContentVersion)
  );
}

export function parseStrongRevisionEtag(
  value: string | string[] | undefined,
  resource: "draft" | "lifecycle",
): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = new RegExp(`^"${resource}:([1-9]\\d*)"$`, "u").exec(value);
  if (match === null) {
    return null;
  }
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : null;
}

export interface DayCorrectionEtagRevision {
  readonly correctionRevision: number;
  readonly draftRevision: number;
}

export function formatDayCorrectionEtag(revision: DayCorrectionEtagRevision): string {
  const payload = Buffer.from(
    `${revision.correctionRevision}:${revision.draftRevision}`,
    "utf8",
  ).toString("base64url");
  return `"dc:${payload}"`;
}

export function parseDayCorrectionEtag(
  value: string | string[] | undefined,
): DayCorrectionEtagRevision | null {
  if (typeof value !== "string") return null;
  const match = /^"dc:([-_A-Za-z0-9]+)"$/u.exec(value);
  if (match === null) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1] ?? "", "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (Buffer.from(decoded, "utf8").toString("base64url") !== match[1]) return null;
  const revisions = /^([1-9]\d*):([1-9]\d*)$/u.exec(decoded);
  if (revisions === null) return null;
  const correctionRevision = Number(revisions[1]);
  const draftRevision = Number(revisions[2]);
  return Number.isSafeInteger(correctionRevision) && Number.isSafeInteger(draftRevision)
    ? { correctionRevision, draftRevision }
    : null;
}

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(value);
}
