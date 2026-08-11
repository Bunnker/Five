import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  canonicalModulePair,
  CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
  CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
  contentProductionRebaseRequestHash,
  type ContentProductionRebaseApplyInput,
  type ContentProductionRebaseModulePair,
  type ContentProductionRebaseResult,
} from "./content-production-rebase";
import type { ContentProductionRebaseStore } from "./content-production-rebase.store";
import { DeterministicDraftGenerator } from "./deterministic-draft.generator";

const SHA_256 = /^[0-9a-f]{64}$/u;
const FORTUNE_DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u;
const IDEMPOTENCY_KEY = /^[-A-Za-z0-9_:.]{16,128}$/u;
const DAYS_365_IN_MILLISECONDS = 365 * 24 * 60 * 60 * 1_000;

function nonBlank(value: string, maximumLength: number, label: string): void {
  if (value.trim().length === 0 || value.length > maximumLength) {
    throw new Error(`${label} is invalid`);
  }
}

function assertSha256(value: string, label: string): void {
  if (!SHA_256.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
}

function assertEvidenceHashes(
  input: ContentProductionRebaseApplyInput["source"],
  label: string,
): void {
  const actual = canonicalModulePair({
    calendar_algorithm: input.calendarAlgorithm,
    copy_and_formula: input.copyAndFormula,
    poster_consistency: null,
    visual_and_rights: null,
  });
  if (!isDeepStrictEqual(actual, input)) throw new Error(`${label} hashes are inconsistent`);
}

export interface ApprovedLegacyProductionSource {
  readonly sourceBuildId: string;
  readonly sourceGeneratorFingerprint: string;
  readonly sourceModuleManifestSha256: string;
  readonly source: ContentProductionRebaseModulePair;
}

export interface ContentProductionRebaseRuntime {
  readonly approvedLegacySources: ReadonlyMap<string, ApprovedLegacyProductionSource>;
  readonly generatorId: typeof CONTENT_PRODUCTION_REBASE_GENERATOR_ID;
  readonly targetBuildId: string;
}

export type ContentProductionRebaseServiceInspection =
  | {
      readonly createdAt: string;
      readonly draftId: string;
      readonly draftRevision: 1;
      readonly fortuneDate: string;
      readonly kind: "eligible";
      readonly source: ContentProductionRebaseModulePair;
      readonly target: ContentProductionRebaseModulePair;
    }
  | Extract<
      Awaited<ReturnType<ContentProductionRebaseStore["inspect"]>>,
      { readonly kind: "missing" | "protected" | "state_conflict" }
    >;

export class ContentProductionRebaseService {
  constructor(
    private readonly store: ContentProductionRebaseStore,
    private readonly runtime: ContentProductionRebaseRuntime,
    private readonly generator = new DeterministicDraftGenerator(),
    private readonly nextEventId: () => string = () => `draft-rebase-${randomUUID()}`,
  ) {}

  async inspect(fortuneDate: string): Promise<ContentProductionRebaseServiceInspection> {
    if (!FORTUNE_DATE.test(fortuneDate)) throw new Error("fortuneDate is invalid");
    const inspected = await this.store.inspect(fortuneDate);
    if (inspected.kind !== "eligible") return inspected;
    const approvedSource = this.approvedSource(fortuneDate);
    if (!isDeepStrictEqual(approvedSource.source, inspected.source)) {
      throw new Error("Live source modules differ from the approved legacy allowlist");
    }
    return {
      ...inspected,
      target: this.generatedTarget(fortuneDate),
    };
  }

  async inspectEvent(idempotencyKey: string) {
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) throw new Error("idempotencyKey is invalid");
    return this.store.inspectEvent(idempotencyKey);
  }

  async apply(input: ContentProductionRebaseApplyInput): Promise<ContentProductionRebaseResult> {
    nonBlank(input.actorId, 80, "actorId");
    nonBlank(input.draftId, 80, "draftId");
    nonBlank(input.generatorId, 128, "generatorId");
    nonBlank(input.planId, 128, "planId");
    nonBlank(input.reason, 2_000, "reason");
    nonBlank(input.requestId, 128, "requestId");
    nonBlank(input.sourceBuildId, 128, "sourceBuildId");
    nonBlank(input.targetBuildId, 128, "targetBuildId");
    if (input.requestId.length < 8) throw new Error("requestId is invalid");
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) throw new Error("idempotencyKey is invalid");
    if (!FORTUNE_DATE.test(input.fortuneDate)) throw new Error("fortuneDate is invalid");
    if (input.expectedDraftRevision !== 1) {
      throw new Error("Only untouched revision-one automatic drafts can be rebased");
    }
    if (input.canonicalizationVersion !== CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION) {
      throw new Error("canonicalizationVersion is unsupported");
    }
    if (
      input.generatorId !== this.runtime.generatorId ||
      input.generatorId !== CONTENT_PRODUCTION_REBASE_GENERATOR_ID
    ) {
      throw new Error("generatorId does not identify this server generator");
    }
    if (input.targetBuildId !== this.runtime.targetBuildId) {
      throw new Error("targetBuildId does not identify this server build");
    }
    assertSha256(input.batchManifestSha256, "batchManifestSha256");
    assertSha256(input.planSha256, "planSha256");
    assertSha256(input.sourceGeneratorFingerprint, "sourceGeneratorFingerprint");
    assertSha256(input.sourceModuleManifestSha256, "sourceModuleManifestSha256");
    assertEvidenceHashes(input.source, "source");
    assertEvidenceHashes(input.target, "target");
    const sourceCreatedAt = new Date(input.sourceCreatedAt);
    if (
      !Number.isFinite(sourceCreatedAt.getTime()) ||
      sourceCreatedAt.toISOString() !== input.sourceCreatedAt
    ) {
      throw new Error("sourceCreatedAt must be a canonical UTC timestamp");
    }
    const approvedSource = this.approvedSource(input.fortuneDate);
    if (
      approvedSource.sourceBuildId !== input.sourceBuildId ||
      approvedSource.sourceGeneratorFingerprint !== input.sourceGeneratorFingerprint ||
      approvedSource.sourceModuleManifestSha256 !== input.sourceModuleManifestSha256 ||
      !isDeepStrictEqual(approvedSource.source, input.source)
    ) {
      throw new Error("Source modules are not in the approved legacy allowlist");
    }
    const generatedTarget = this.generatedTarget(input.fortuneDate);
    if (!isDeepStrictEqual(generatedTarget, input.target)) {
      throw new Error("Rebase target differs from the current deterministic generator");
    }
    const occurredAt = new Date(input.occurredAt);
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.toISOString() !== input.occurredAt) {
      throw new Error("occurredAt must be a canonical UTC timestamp");
    }
    return this.store.rebase({
      ...input,
      eventId: this.nextEventId(),
      requestHash: contentProductionRebaseRequestHash(input),
      retainUntil: new Date(occurredAt.getTime() + DAYS_365_IN_MILLISECONDS).toISOString(),
    });
  }

  private approvedSource(fortuneDate: string): ApprovedLegacyProductionSource {
    const approvedSource = this.runtime.approvedLegacySources.get(fortuneDate);
    if (approvedSource === undefined) {
      throw new Error("Source modules are not in the approved legacy allowlist");
    }
    return approvedSource;
  }

  private generatedTarget(fortuneDate: string): ContentProductionRebaseModulePair {
    const generated = this.generator.generate(fortuneDate);
    if (generated.visual_and_rights !== null || generated.poster_consistency !== null) {
      throw new Error("Current deterministic generator produced frozen visual modules");
    }
    return canonicalModulePair(generated);
  }
}
