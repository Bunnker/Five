import { createHash } from "node:crypto";

import type { components } from "@five/api-contract";
import { isDraftModuleUpdate } from "@five/api-contract/runtime";

type DraftModules = components["schemas"]["DraftModules"];
export type RebaseCalendarAlgorithm = NonNullable<DraftModules["calendar_algorithm"]>;
export type RebaseCopyAndFormula = NonNullable<DraftModules["copy_and_formula"]>;

export const CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION = "canonical-json-v1" as const;
export const CONTENT_PRODUCTION_REBASE_GENERATOR_ID = "deterministic-draft-generator-v1" as const;

export interface ContentProductionRebaseModulePair {
  readonly calendarAlgorithm: RebaseCalendarAlgorithm;
  readonly calendarSha256: string;
  readonly canonicalSha256: string;
  readonly copyAndFormula: RebaseCopyAndFormula;
  readonly copySha256: string;
}

export interface ContentProductionRebaseApplyInput {
  readonly actorId: string;
  readonly batchManifestSha256: string;
  readonly canonicalizationVersion: typeof CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION;
  readonly draftId: string;
  readonly expectedDraftRevision: number;
  readonly fortuneDate: string;
  readonly generatorId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly planId: string;
  readonly planSha256: string;
  readonly reason: string;
  readonly requestId: string;
  readonly sourceBuildId: string;
  readonly sourceCreatedAt: string;
  readonly sourceGeneratorFingerprint: string;
  readonly sourceModuleManifestSha256: string;
  readonly source: ContentProductionRebaseModulePair;
  readonly targetBuildId: string;
  readonly target: ContentProductionRebaseModulePair;
}

export interface ContentProductionRebaseEvent {
  readonly actorId: string;
  readonly batchManifestSha256: string;
  readonly canonicalizationVersion: typeof CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION;
  readonly draftId: string;
  readonly eventId: string;
  readonly fortuneDate: string;
  readonly fromDraftRevision: number;
  readonly generatorId: string;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
  readonly planId: string;
  readonly planSha256: string;
  readonly reason: string;
  readonly requestHash: string;
  readonly requestId: string;
  readonly retainUntil: string;
  readonly sourceBuildId: string;
  readonly sourceCreatedAt: string;
  readonly sourceGeneratorFingerprint: string;
  readonly sourceModuleManifestSha256: string;
  readonly source: ContentProductionRebaseModulePair;
  readonly targetBuildId: string;
  readonly target: ContentProductionRebaseModulePair;
  readonly toDraftRevision: number;
}

export type ContentProductionRebaseConflictCode =
  | "candidates_present"
  | "correction_present"
  | "draft_revision_mismatch"
  | "extra_draft_present"
  | "image_jobs_not_pristine"
  | "image_selections_present"
  | "lifecycle_version_present"
  | "not_found"
  | "plan_already_applied"
  | "replay_state_mismatch"
  | "source_mismatch"
  | "submitted"
  | "visual_modules_present";

export type ContentProductionRebaseResult =
  | { readonly event: ContentProductionRebaseEvent; readonly kind: "existing" | "rebased" }
  | { readonly kind: "idempotency_conflict" }
  | { readonly code: ContentProductionRebaseConflictCode; readonly kind: "state_conflict" };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashCanonicalValue(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalModulePair(input: DraftModules): ContentProductionRebaseModulePair {
  if (
    !isDeepExactDraftModules(input) ||
    !isDraftModuleUpdate("calendar_algorithm", input.calendar_algorithm) ||
    !isDraftModuleUpdate("copy_and_formula", input.copy_and_formula)
  ) {
    throw new Error("Content production rebase requires exact unfrozen deterministic modules");
  }
  const calendarAlgorithm = structuredClone(input.calendar_algorithm);
  const copyAndFormula = structuredClone(input.copy_and_formula);
  return {
    calendarAlgorithm,
    calendarSha256: hashCanonicalValue(calendarAlgorithm),
    canonicalSha256: hashCanonicalValue({
      calendar_algorithm: calendarAlgorithm,
      copy_and_formula: copyAndFormula,
      poster_consistency: null,
      visual_and_rights: null,
    }),
    copyAndFormula,
    copySha256: hashCanonicalValue(copyAndFormula),
  };
}

function isDeepExactDraftModules(input: DraftModules): input is DraftModules & {
  readonly calendar_algorithm: RebaseCalendarAlgorithm;
  readonly copy_and_formula: RebaseCopyAndFormula;
  readonly poster_consistency: null;
  readonly visual_and_rights: null;
} {
  return (
    Object.keys(input)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .join("\0") ===
      "calendar_algorithm\0copy_and_formula\0poster_consistency\0visual_and_rights" &&
    input.calendar_algorithm !== null &&
    input.copy_and_formula !== null &&
    input.poster_consistency === null &&
    input.visual_and_rights === null
  );
}

export function contentProductionRebaseRequestHash(
  input: ContentProductionRebaseApplyInput,
): string {
  return hashCanonicalValue({
    actorId: input.actorId,
    batchManifestSha256: input.batchManifestSha256,
    canonicalizationVersion: input.canonicalizationVersion,
    draftId: input.draftId,
    expectedDraftRevision: input.expectedDraftRevision,
    fortuneDate: input.fortuneDate,
    generatorId: input.generatorId,
    planId: input.planId,
    planSha256: input.planSha256,
    reason: input.reason,
    sourceBuildId: input.sourceBuildId,
    sourceCreatedAt: input.sourceCreatedAt,
    sourceCanonicalSha256: input.source.canonicalSha256,
    sourceGeneratorFingerprint: input.sourceGeneratorFingerprint,
    sourceModuleManifestSha256: input.sourceModuleManifestSha256,
    targetBuildId: input.targetBuildId,
    targetCanonicalSha256: input.target.canonicalSha256,
  });
}
