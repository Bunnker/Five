import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import type { components } from "@five/api-contract";

import {
  canonicalModulePair,
  CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
  CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
  hashCanonicalValue,
  type ContentProductionRebaseModulePair,
} from "../src/content-production/content-production-rebase";

type DraftModules = components["schemas"]["DraftModules"];

const SHA_256 = /^[0-9a-f]{64}$/u;
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/u;
const FORTUNE_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;
const SAFE_ID = /^[-A-Za-z0-9_:.]{8,128}$/u;
const MAX_STOP_EVIDENCE_AGE_MS = 15 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 60 * 1_000;

interface JsonObject {
  readonly [key: string]: unknown;
}

export interface LegacyRuntimeFileEvidence {
  readonly path: string;
  readonly sha256: string;
}

export interface ParsedLegacyProductionSourceAllowlist {
  readonly canonicalizationVersion: typeof CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION;
  readonly days: ReadonlyArray<{
    readonly fortuneDate: string;
    readonly source: ContentProductionRebaseModulePair;
  }>;
  readonly legacyDemoBlob: string;
  readonly legacyDemoFileSha256: string;
  readonly legacyGeneratorBlob: string;
  readonly legacyGeneratorFileSha256: string;
  readonly legacyBlobOidAggregate: string;
  readonly runtimeFiles: readonly LegacyRuntimeFileEvidence[];
  readonly schemaVersion: "five-content-production-legacy-source-v1";
  readonly sourceBuildId: string;
  readonly sourceGeneratorFingerprint: string;
  readonly sourceModuleManifestSha256: string;
  readonly sourceTree: string;
}

export type ContentProductionRebasePlanInspection =
  | {
      readonly createdAt: string;
      readonly draftId: string;
      readonly draftRevision: 1;
      readonly fortuneDate: string;
      readonly kind: "eligible";
      readonly source: ContentProductionRebaseModulePair;
      readonly target: ContentProductionRebaseModulePair;
    }
  | {
      readonly code: "published_active_version";
      readonly fortuneDate: string;
      readonly kind: "protected";
    }
  | {
      readonly code: "not_found";
      readonly fortuneDate: string;
      readonly kind: "missing";
    };

export type ContentProductionRebasePlanDay =
  | {
      readonly action: "rebase";
      readonly draftId: string;
      readonly expectedDraftRevision: 1;
      readonly fortuneDate: string;
      readonly idempotencyKey: string;
      readonly source: ContentProductionRebaseModulePair;
      readonly sourceCreatedAt: string;
      readonly target: ContentProductionRebaseModulePair;
    }
  | {
      readonly action: "protected";
      readonly fortuneDate: string;
      readonly reason: "published_active_version";
      readonly target: ContentProductionRebaseModulePair;
    }
  | {
      readonly action: "missing";
      readonly fortuneDate: string;
      readonly reason: "not_found";
      readonly target: ContentProductionRebaseModulePair;
    };

export interface ContentProductionRebasePlan {
  readonly actionCounts: {
    readonly missing: number;
    readonly protected: number;
    readonly rebase: number;
  };
  readonly batchManifestSha256: string;
  readonly canonicalizationVersion: typeof CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION;
  readonly createdAt: string;
  readonly days: readonly ContentProductionRebasePlanDay[];
  readonly generatorId: typeof CONTENT_PRODUCTION_REBASE_GENERATOR_ID;
  readonly legacyAllowlistSha256: string;
  readonly planId: string;
  readonly range: {
    readonly dayCount: number;
    readonly endFortuneDate: string;
    readonly startFortuneDate: string;
  };
  readonly schemaVersion: "five-content-production-rebase-plan-v1";
  readonly sourceBuildId: string;
  readonly sourceGeneratorFingerprint: string;
  readonly sourceModuleManifestSha256: string;
  readonly targetBuildId: string;
}

export interface ContentProductionRebaseStopEvidence {
  readonly observedAt: string;
  readonly schemaVersion: "five-content-rebase-stop-evidence-v1";
  readonly services: { readonly http: "stopped"; readonly worker: "stopped" };
  readonly source: "docker-compose-ps";
}

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(codeUnitCompare);
  const sortedExpected = [...expected].sort(codeUnitCompare);
  if (!isDeepStrictEqual(actual, sortedExpected)) {
    throw new Error(`${label} has unexpected or missing fields`);
  }
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredString(value: unknown, label: string, maximumLength = 512): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximumLength) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const parsed = requiredString(value, label, 64);
  if (!SHA_256.test(parsed)) throw new Error(`${label} must be a lowercase SHA-256`);
  return parsed;
}

function gitObjectId(value: unknown, label: string): string {
  const parsed = requiredString(value, label, 40);
  if (!GIT_OBJECT_ID.test(parsed)) throw new Error(`${label} must be a Git SHA-1 object id`);
  return parsed;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const parsed = requiredString(value, label, 64);
  const instant = new Date(parsed);
  if (!Number.isFinite(instant.valueOf()) || instant.toISOString() !== parsed) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  return parsed;
}

function assertFortuneDate(value: string, label: string): void {
  if (!FORTUNE_DATE.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a real date`);
}

function nextFortuneDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function assertOrderedContiguousDates(dates: readonly string[], label: string): void {
  for (const [index, fortuneDate] of dates.entries()) {
    assertFortuneDate(fortuneDate, `${label}[${index}]`);
    if (index > 0 && fortuneDate !== nextFortuneDate(dates[index - 1]!)) {
      throw new Error(`${label} must be unique, ordered, and contiguous`);
    }
  }
}

function runtimePath(value: unknown, label: string): string {
  const path = requiredString(value, label, 512);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} must be a normalized relative path`);
  }
  return path;
}

export function parseLegacyProductionSourceAllowlist(
  value: unknown,
  options: { readonly expectedDayCount?: number } = {},
): ParsedLegacyProductionSourceAllowlist {
  const root = asObject(value, "legacy source allowlist");
  exactKeys(
    root,
    [
      "canonicalizationVersion",
      "days",
      "provenance",
      "schemaVersion",
      "sourceModuleManifestSha256",
    ],
    "legacy source allowlist",
  );
  if (root.schemaVersion !== "five-content-production-legacy-source-v1") {
    throw new Error("legacy source allowlist schemaVersion is unsupported");
  }
  if (root.canonicalizationVersion !== CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION) {
    throw new Error("legacy source allowlist canonicalizationVersion is unsupported");
  }
  if (!Array.isArray(root.days)) throw new Error("legacy source allowlist days must be an array");
  const expectedDayCount = options.expectedDayCount ?? 30;
  if (root.days.length !== expectedDayCount) {
    throw new Error("legacy source allowlist does not have the expected day count");
  }
  const provenance = asObject(root.provenance, "legacy source allowlist provenance");
  exactKeys(
    provenance,
    [
      "legacyDemoBlob",
      "legacyDemoFileSha256",
      "legacyBlobOidAggregate",
      "legacyGeneratorBlob",
      "legacyGeneratorFileSha256",
      "runtimeFiles",
      "runtimeFingerprint",
      "sourceBuildId",
      "sourceTree",
    ],
    "legacy source allowlist provenance",
  );
  if (!Array.isArray(provenance.runtimeFiles) || provenance.runtimeFiles.length !== 7) {
    throw new Error("legacy source allowlist must contain exactly seven runtime files");
  }
  const runtimeFiles = provenance.runtimeFiles.map((raw, index) => {
    const file = asObject(raw, `legacy runtime file[${index}]`);
    exactKeys(file, ["path", "sha256"], `legacy runtime file[${index}]`);
    return {
      path: runtimePath(file.path, `legacy runtime file[${index}].path`),
      sha256: sha256(file.sha256, `legacy runtime file[${index}].sha256`),
    };
  });
  const sortedRuntimePaths = [...runtimeFiles].sort((left, right) =>
    codeUnitCompare(left.path, right.path),
  );
  if (
    !isDeepStrictEqual(runtimeFiles, sortedRuntimePaths) ||
    new Set(runtimeFiles.map((file) => file.path)).size !== runtimeFiles.length
  ) {
    throw new Error("legacy runtime files must be unique and code-unit sorted");
  }
  const sourceGeneratorFingerprint = sha256(
    provenance.runtimeFingerprint,
    "legacy source allowlist provenance.runtimeFingerprint",
  );
  if (sourceGeneratorFingerprint !== hashCanonicalValue({ files: runtimeFiles })) {
    throw new Error("legacy runtime fingerprint does not match its seven-file manifest");
  }

  const days = root.days.map((raw, index) => {
    const day = asObject(raw, `legacy source allowlist days[${index}]`);
    exactKeys(day, ["canonicalSha256", "fortuneDate", "modules"], `legacy source day[${index}]`);
    const fortuneDate = requiredString(
      day.fortuneDate,
      `legacy source day[${index}].fortuneDate`,
      10,
    );
    assertFortuneDate(fortuneDate, `legacy source day[${index}].fortuneDate`);
    const source = canonicalModulePair(day.modules as DraftModules);
    if (source.canonicalSha256 !== sha256(day.canonicalSha256, `legacy source ${fortuneDate}`)) {
      throw new Error(`legacy source ${fortuneDate} canonical hash does not match its modules`);
    }
    return { fortuneDate, source };
  });
  assertOrderedContiguousDates(
    days.map((day) => day.fortuneDate),
    "legacy source allowlist dates",
  );
  const expectedManifest = hashCanonicalValue(
    Object.fromEntries(days.map((day) => [day.fortuneDate, day.source.canonicalSha256])),
  );
  const sourceModuleManifestSha256 = sha256(
    root.sourceModuleManifestSha256,
    "legacy source allowlist sourceModuleManifestSha256",
  );
  if (sourceModuleManifestSha256 !== expectedManifest) {
    throw new Error("legacy source module manifest hash does not match its days");
  }

  const sourceBuildId = gitObjectId(provenance.sourceBuildId, "legacy source build id");
  const sourceTree = gitObjectId(provenance.sourceTree, "legacy source tree");
  if (sourceBuildId !== sourceTree) {
    throw new Error("legacy source build id must equal its source tree");
  }

  return {
    canonicalizationVersion: CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
    days,
    legacyDemoBlob: gitObjectId(provenance.legacyDemoBlob, "legacy demo blob"),
    legacyDemoFileSha256: sha256(provenance.legacyDemoFileSha256, "legacy demo file SHA-256"),
    legacyGeneratorBlob: gitObjectId(provenance.legacyGeneratorBlob, "legacy generator blob"),
    legacyGeneratorFileSha256: sha256(
      provenance.legacyGeneratorFileSha256,
      "legacy generator file SHA-256",
    ),
    legacyBlobOidAggregate: sha256(provenance.legacyBlobOidAggregate, "legacy blob OID aggregate"),
    runtimeFiles,
    schemaVersion: "five-content-production-legacy-source-v1",
    sourceBuildId,
    sourceGeneratorFingerprint,
    sourceModuleManifestSha256,
    sourceTree,
  };
}

function deterministicIdempotencyKey(input: {
  readonly fortuneDate: string;
  readonly planId: string;
  readonly source: string;
  readonly target: string;
}): string {
  const digest = hashCanonicalValue(input).slice(0, 32);
  return `content-rebase:${input.fortuneDate}:${digest}`;
}

export function buildContentProductionRebasePlan(input: {
  readonly batch: {
    readonly days: ReadonlyArray<{
      readonly fortuneDate: string;
      readonly target: ContentProductionRebaseModulePair;
    }>;
    readonly manifestSha256: string;
  };
  readonly createdAt: string;
  readonly inspections: readonly ContentProductionRebasePlanInspection[];
  readonly legacyAllowlistSha256: string;
  readonly planId: string;
  readonly sourceAllowlist: ParsedLegacyProductionSourceAllowlist;
  readonly targetBuildId: string;
}): ContentProductionRebasePlan {
  const createdAt = canonicalTimestamp(input.createdAt, "plan createdAt");
  const planId = requiredString(input.planId, "planId", 128);
  if (!SAFE_ID.test(planId)) throw new Error("planId has unsupported characters");
  const batchManifestSha256 = sha256(input.batch.manifestSha256, "batch manifest SHA-256");
  const legacyAllowlistSha256 = sha256(input.legacyAllowlistSha256, "legacy allowlist SHA-256");
  const targetBuildId = gitObjectId(input.targetBuildId, "target build id");
  if (input.batch.days.length === 0) throw new Error("rebase plan batch cannot be empty");
  const dates = input.batch.days.map((day) => day.fortuneDate);
  assertOrderedContiguousDates(dates, "rebase plan batch dates");
  if (
    input.inspections.length !== input.batch.days.length ||
    input.sourceAllowlist.days.length !== input.batch.days.length
  ) {
    throw new Error("rebase plan must classify every validated batch day exactly once");
  }
  const sourceByDate = new Map(
    input.sourceAllowlist.days.map((day) => [day.fortuneDate, day.source] as const),
  );
  const inspectionByDate = new Map(
    input.inspections.map((inspection) => [inspection.fortuneDate, inspection] as const),
  );
  if (inspectionByDate.size !== input.inspections.length) {
    throw new Error("rebase plan inspections contain duplicate dates");
  }
  const days: ContentProductionRebasePlanDay[] = input.batch.days.map((batchDay) => {
    const source = sourceByDate.get(batchDay.fortuneDate);
    const inspection = inspectionByDate.get(batchDay.fortuneDate);
    if (source === undefined || inspection === undefined) {
      throw new Error(`rebase plan is missing evidence for ${batchDay.fortuneDate}`);
    }
    const target = canonicalModulePair({
      calendar_algorithm: batchDay.target.calendarAlgorithm,
      copy_and_formula: batchDay.target.copyAndFormula,
      poster_consistency: null,
      visual_and_rights: null,
    });
    if (!isDeepStrictEqual(target, batchDay.target)) {
      throw new Error(`rebase plan target hashes are inconsistent for ${batchDay.fortuneDate}`);
    }
    if (inspection.kind === "eligible") {
      if (
        inspection.draftRevision !== 1 ||
        !isDeepStrictEqual(inspection.source, source) ||
        !isDeepStrictEqual(inspection.target, target)
      ) {
        throw new Error(`rebase plan eligible evidence disagrees for ${batchDay.fortuneDate}`);
      }
      return {
        action: "rebase",
        draftId: requiredString(inspection.draftId, "eligible draftId", 80),
        expectedDraftRevision: 1,
        fortuneDate: batchDay.fortuneDate,
        idempotencyKey: deterministicIdempotencyKey({
          fortuneDate: batchDay.fortuneDate,
          planId,
          source: source.canonicalSha256,
          target: target.canonicalSha256,
        }),
        source,
        sourceCreatedAt: canonicalTimestamp(inspection.createdAt, "eligible createdAt"),
        target,
      };
    }
    if (inspection.kind === "protected") {
      return {
        action: "protected",
        fortuneDate: batchDay.fortuneDate,
        reason: inspection.code,
        target,
      };
    }
    return {
      action: "missing",
      fortuneDate: batchDay.fortuneDate,
      reason: inspection.code,
      target,
    };
  });
  const actionCounts = {
    missing: days.filter((day) => day.action === "missing").length,
    protected: days.filter((day) => day.action === "protected").length,
    rebase: days.filter((day) => day.action === "rebase").length,
  };
  return {
    actionCounts,
    batchManifestSha256,
    canonicalizationVersion: CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
    createdAt,
    days,
    generatorId: CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
    legacyAllowlistSha256,
    planId,
    range: {
      dayCount: days.length,
      endFortuneDate: days.at(-1)!.fortuneDate,
      startFortuneDate: days[0]!.fortuneDate,
    },
    schemaVersion: "five-content-production-rebase-plan-v1",
    sourceBuildId: input.sourceAllowlist.sourceBuildId,
    sourceGeneratorFingerprint: input.sourceAllowlist.sourceGeneratorFingerprint,
    sourceModuleManifestSha256: input.sourceAllowlist.sourceModuleManifestSha256,
    targetBuildId,
  };
}

function parseStoredModulePair(value: unknown, label: string): ContentProductionRebaseModulePair {
  const pair = asObject(value, label);
  exactKeys(
    pair,
    ["calendarAlgorithm", "calendarSha256", "canonicalSha256", "copyAndFormula", "copySha256"],
    label,
  );
  const rebuilt = canonicalModulePair({
    calendar_algorithm: pair.calendarAlgorithm as DraftModules["calendar_algorithm"],
    copy_and_formula: pair.copyAndFormula as DraftModules["copy_and_formula"],
    poster_consistency: null,
    visual_and_rights: null,
  });
  if (!isDeepStrictEqual(pair, rebuilt)) throw new Error(`${label} hashes are inconsistent`);
  return rebuilt;
}

export function parseContentProductionRebasePlan(
  value: unknown,
  context: {
    readonly batch: {
      readonly days: ReadonlyArray<{
        readonly fortuneDate: string;
        readonly target: ContentProductionRebaseModulePair;
      }>;
      readonly manifestSha256: string;
    };
    readonly expectedDayCount?: number;
    readonly legacyAllowlistSha256: string;
    readonly sourceAllowlist: ParsedLegacyProductionSourceAllowlist;
    readonly targetBuildId: string;
  },
): ContentProductionRebasePlan {
  const root = asObject(value, "content production rebase plan");
  exactKeys(
    root,
    [
      "actionCounts",
      "batchManifestSha256",
      "canonicalizationVersion",
      "createdAt",
      "days",
      "generatorId",
      "legacyAllowlistSha256",
      "planId",
      "range",
      "schemaVersion",
      "sourceBuildId",
      "sourceGeneratorFingerprint",
      "sourceModuleManifestSha256",
      "targetBuildId",
    ],
    "content production rebase plan",
  );
  if (root.schemaVersion !== "five-content-production-rebase-plan-v1") {
    throw new Error("content production rebase plan schemaVersion is unsupported");
  }
  if (!Array.isArray(root.days))
    throw new Error("content production rebase plan days must be an array");
  const expectedDayCount = context.expectedDayCount ?? 30;
  if (root.days.length !== expectedDayCount) {
    throw new Error("content production rebase plan must classify the complete validated batch");
  }
  const inspections: ContentProductionRebasePlanInspection[] = root.days.map((raw, index) => {
    const day = asObject(raw, `content production rebase plan days[${index}]`);
    const action = requiredString(
      day.action,
      `content production rebase plan days[${index}].action`,
    );
    const fortuneDate = requiredString(day.fortuneDate, `plan day[${index}].fortuneDate`, 10);
    assertFortuneDate(fortuneDate, `plan day[${index}].fortuneDate`);
    const target = parseStoredModulePair(day.target, `plan ${fortuneDate} target`);
    if (action === "rebase") {
      exactKeys(
        day,
        [
          "action",
          "draftId",
          "expectedDraftRevision",
          "fortuneDate",
          "idempotencyKey",
          "source",
          "sourceCreatedAt",
          "target",
        ],
        `plan ${fortuneDate} rebase day`,
      );
      if (day.expectedDraftRevision !== 1) {
        throw new Error(`plan ${fortuneDate} expectedDraftRevision must be one`);
      }
      requiredString(day.idempotencyKey, `plan ${fortuneDate} idempotencyKey`, 128);
      return {
        createdAt: canonicalTimestamp(day.sourceCreatedAt, `plan ${fortuneDate} sourceCreatedAt`),
        draftId: requiredString(day.draftId, `plan ${fortuneDate} draftId`, 80),
        draftRevision: 1,
        fortuneDate,
        kind: "eligible",
        source: parseStoredModulePair(day.source, `plan ${fortuneDate} source`),
        target,
      };
    }
    exactKeys(day, ["action", "fortuneDate", "reason", "target"], `plan ${fortuneDate} day`);
    if (action === "protected" && day.reason === "published_active_version") {
      return { code: "published_active_version", fortuneDate, kind: "protected" };
    }
    if (action === "missing" && day.reason === "not_found") {
      return { code: "not_found", fortuneDate, kind: "missing" };
    }
    throw new Error(`plan ${fortuneDate} action or reason is unsupported`);
  });
  const rebuilt = buildContentProductionRebasePlan({
    batch: context.batch,
    createdAt: requiredString(root.createdAt, "plan createdAt", 64),
    inspections,
    legacyAllowlistSha256: context.legacyAllowlistSha256,
    planId: requiredString(root.planId, "planId", 128),
    sourceAllowlist: context.sourceAllowlist,
    targetBuildId: context.targetBuildId,
  });
  if (!isDeepStrictEqual(root, rebuilt)) {
    throw new Error("content production rebase plan does not exactly match its trusted inputs");
  }
  return rebuilt;
}

export function contentProductionRebaseConfirmation(plan: ContentProductionRebasePlan): string {
  return `REBASE ${plan.planId} ${plan.range.startFortuneDate}..${plan.range.endFortuneDate} rebase=${plan.actionCounts.rebase} protected=${plan.actionCounts.protected} missing=${plan.actionCounts.missing}`;
}

function expectedCount(value: string | undefined, label: string): number {
  if (value === undefined || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${label} must be an explicit non-negative integer`);
  }
  return Number(value);
}

function validateStopEvidence(value: unknown): ContentProductionRebaseStopEvidence {
  const evidence = asObject(value, "stop evidence");
  exactKeys(evidence, ["observedAt", "schemaVersion", "services", "source"], "stop evidence");
  const services = asObject(evidence.services, "stop evidence services");
  exactKeys(services, ["http", "worker"], "stop evidence services");
  if (
    evidence.schemaVersion !== "five-content-rebase-stop-evidence-v1" ||
    evidence.source !== "docker-compose-ps" ||
    services.http !== "stopped" ||
    services.worker !== "stopped"
  ) {
    throw new Error("stop evidence does not prove both services stopped");
  }
  return {
    observedAt: canonicalTimestamp(evidence.observedAt, "stop evidence observedAt"),
    schemaVersion: "five-content-rebase-stop-evidence-v1",
    services: { http: "stopped", worker: "stopped" },
    source: "docker-compose-ps",
  };
}

export function validateContentProductionRebaseApplyGate(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly evidence: unknown;
  readonly legacyAllowlistSha256: string;
  readonly now: string;
  readonly plan: ContentProductionRebasePlan;
  readonly planSha256: string;
  readonly stopEvidenceSha256: string;
}): { readonly actorId: string; readonly reason: string } {
  const env = input.environment;
  if (env.FIVE_CONTENT_REBASE_ENABLED !== "1") throw new Error("content rebase is disabled");
  if (
    env.FIVE_CONTENT_REBASE_HTTP_STOPPED !== "1" ||
    env.FIVE_CONTENT_REBASE_WORKER_STOPPED !== "1"
  ) {
    throw new Error("HTTP and Worker stopped confirmations are required");
  }
  const planSha256 = sha256(input.planSha256, "plan SHA-256");
  const allowlistSha256 = sha256(input.legacyAllowlistSha256, "legacy allowlist SHA-256");
  const stopEvidenceSha256 = sha256(input.stopEvidenceSha256, "stop evidence SHA-256");
  if (env.FIVE_CONTENT_REBASE_APPROVED_PLAN_SHA256 !== planSha256) {
    throw new Error("raw plan SHA-256 was not separately approved");
  }
  if (
    env.FIVE_CONTENT_REBASE_APPROVED_LEGACY_ALLOWLIST_SHA256 !== allowlistSha256 ||
    input.plan.legacyAllowlistSha256 !== allowlistSha256
  ) {
    throw new Error("raw legacy allowlist SHA-256 was not separately approved");
  }
  if (env.FIVE_CONTENT_REBASE_STOP_EVIDENCE_SHA256 !== stopEvidenceSha256) {
    throw new Error("raw stop evidence SHA-256 was not approved");
  }
  if (env.FIVE_CONTENT_REBASE_TARGET_BUILD_ID !== input.plan.targetBuildId) {
    throw new Error("target build approval does not match the plan");
  }
  if (env.FIVE_CONTENT_REBASE_CONFIRMATION !== contentProductionRebaseConfirmation(input.plan)) {
    throw new Error("confirmation phrase does not match the plan");
  }
  const expectedActionCounts = {
    missing: expectedCount(
      env.FIVE_CONTENT_REBASE_EXPECTED_MISSING_COUNT,
      "expected missing count",
    ),
    protected: expectedCount(
      env.FIVE_CONTENT_REBASE_EXPECTED_PROTECTED_COUNT,
      "expected protected count",
    ),
    rebase: expectedCount(env.FIVE_CONTENT_REBASE_EXPECTED_REBASE_COUNT, "expected rebase count"),
  };
  if (!isDeepStrictEqual(expectedActionCounts, input.plan.actionCounts)) {
    throw new Error("explicit expected action counts do not match the plan");
  }
  const actorId = requiredString(env.FIVE_CONTENT_REBASE_OPERATOR_ID, "operator id", 80);
  const reason = requiredString(env.FIVE_CONTENT_REBASE_REASON, "rebase reason", 2_000);
  const evidence = validateStopEvidence(input.evidence);
  const observedAt = new Date(evidence.observedAt).valueOf();
  const now = new Date(canonicalTimestamp(input.now, "gate current time")).valueOf();
  if (observedAt > now + MAX_CLOCK_SKEW_MS || now - observedAt > MAX_STOP_EVIDENCE_AGE_MS) {
    throw new Error("stop evidence is not fresh");
  }
  return { actorId, reason };
}

export async function writeNewPrivateJson(path: string, value: unknown): Promise<void> {
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, bytes, {
    flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    mode: 0o600,
  });
}

export function rawBytesSha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
