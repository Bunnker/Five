import { isDeepStrictEqual } from "node:util";

import {
  contentProductionRebaseRequestHash,
  type ContentProductionRebaseApplyInput,
  type ContentProductionRebaseEvent,
  type ContentProductionRebaseModulePair,
} from "../src/content-production/content-production-rebase";
import type {
  ContentProductionRebaseService,
  ContentProductionRebaseServiceInspection,
} from "../src/content-production/content-production-rebase.service";
import {
  buildContentProductionRebasePlan,
  type ContentProductionRebasePlan,
  type ParsedLegacyProductionSourceAllowlist,
} from "./content-production-rebase-plan";

export interface ContentProductionRebaseTargetBatch {
  readonly days: ReadonlyArray<{
    readonly fortuneDate: string;
    readonly target: ContentProductionRebaseModulePair;
  }>;
  readonly manifestSha256: string;
}

type RebaseService = Pick<ContentProductionRebaseService, "apply" | "inspect" | "inspectEvent">;

export async function inspectContentProductionRebasePlan(input: {
  readonly batch: ContentProductionRebaseTargetBatch;
  readonly createdAt: string;
  readonly legacyAllowlistSha256: string;
  readonly planId: string;
  readonly service: RebaseService;
  readonly sourceAllowlist: ParsedLegacyProductionSourceAllowlist;
  readonly targetBuildId: string;
}): Promise<ContentProductionRebasePlan> {
  const inspections = [];
  for (const day of input.batch.days) {
    const inspected = await input.service.inspect(day.fortuneDate);
    if (inspected.kind === "state_conflict") {
      throw new Error(`${day.fortuneDate} rebase inspection blocked: ${inspected.code}`);
    }
    if (inspected.kind === "eligible") {
      inspections.push(inspected);
    } else if (inspected.kind === "protected") {
      inspections.push({ ...inspected, kind: "protected" as const });
    } else {
      inspections.push({ ...inspected, kind: "missing" as const });
    }
  }
  return buildContentProductionRebasePlan({
    batch: input.batch,
    createdAt: input.createdAt,
    inspections,
    legacyAllowlistSha256: input.legacyAllowlistSha256,
    planId: input.planId,
    sourceAllowlist: input.sourceAllowlist,
    targetBuildId: input.targetBuildId,
  });
}

function applyInputForDay(input: {
  readonly actorId: string;
  readonly occurredAt: string;
  readonly plan: ContentProductionRebasePlan;
  readonly planDay: Extract<
    ContentProductionRebasePlan["days"][number],
    { readonly action: "rebase" }
  >;
  readonly planSha256: string;
  readonly reason: string;
}): ContentProductionRebaseApplyInput {
  return {
    actorId: input.actorId,
    batchManifestSha256: input.plan.batchManifestSha256,
    canonicalizationVersion: input.plan.canonicalizationVersion,
    draftId: input.planDay.draftId,
    expectedDraftRevision: input.planDay.expectedDraftRevision,
    fortuneDate: input.planDay.fortuneDate,
    generatorId: input.plan.generatorId,
    idempotencyKey: input.planDay.idempotencyKey,
    occurredAt: input.occurredAt,
    planId: input.plan.planId,
    planSha256: input.planSha256,
    reason: input.reason,
    requestId: `request-rebase-${input.planDay.fortuneDate}-${input.planSha256.slice(0, 16)}`,
    sourceBuildId: input.plan.sourceBuildId,
    sourceCreatedAt: input.planDay.sourceCreatedAt,
    sourceGeneratorFingerprint: input.plan.sourceGeneratorFingerprint,
    sourceModuleManifestSha256: input.plan.sourceModuleManifestSha256,
    source: input.planDay.source,
    targetBuildId: input.plan.targetBuildId,
    target: input.planDay.target,
  };
}

function assertEligibleInspection(
  day: Extract<ContentProductionRebasePlan["days"][number], { readonly action: "rebase" }>,
  inspected: ContentProductionRebaseServiceInspection,
): void {
  if (
    inspected.kind !== "eligible" ||
    inspected.fortuneDate !== day.fortuneDate ||
    inspected.draftId !== day.draftId ||
    inspected.draftRevision !== day.expectedDraftRevision ||
    inspected.createdAt !== day.sourceCreatedAt ||
    !isDeepStrictEqual(inspected.source, day.source) ||
    !isDeepStrictEqual(inspected.target, day.target)
  ) {
    throw new Error(`${day.fortuneDate} no longer matches the approved rebase plan`);
  }
}

function assertExistingEvent(
  event: ContentProductionRebaseEvent,
  input: ContentProductionRebaseApplyInput,
) {
  if (
    event.requestHash !== contentProductionRebaseRequestHash(input) ||
    event.idempotencyKey !== input.idempotencyKey ||
    event.planSha256 !== input.planSha256 ||
    event.fortuneDate !== input.fortuneDate ||
    event.draftId !== input.draftId ||
    event.fromDraftRevision !== input.expectedDraftRevision ||
    event.sourceCreatedAt !== input.sourceCreatedAt ||
    !isDeepStrictEqual(event.source, input.source) ||
    !isDeepStrictEqual(event.target, input.target)
  ) {
    throw new Error(`${input.fortuneDate} existing event does not match the approved plan`);
  }
}

export async function applyContentProductionRebasePlan(input: {
  readonly actorId: string;
  readonly now?: () => Date;
  readonly plan: ContentProductionRebasePlan;
  readonly planSha256: string;
  readonly reason: string;
  readonly service: RebaseService;
}): Promise<{
  readonly existing: number;
  readonly missing: number;
  readonly protected: number;
  readonly rebased: number;
  readonly total: number;
}> {
  const occurredAt = (input.now ?? (() => new Date()))().toISOString();
  const recoveredEvents = new Map<string, ContentProductionRebaseEvent>();

  // This is intentionally a complete read-only pass. No date may be mutated until all thirty
  // classifications still match the independently approved plan.
  for (const day of input.plan.days) {
    if (day.action === "rebase") {
      const rebaseInput = applyInputForDay({ ...input, occurredAt, planDay: day });
      const existing = await input.service.inspectEvent(day.idempotencyKey);
      if (existing !== null) {
        assertExistingEvent(existing, rebaseInput);
        recoveredEvents.set(day.fortuneDate, existing);
        continue;
      }
      assertEligibleInspection(day, await input.service.inspect(day.fortuneDate));
      continue;
    }
    const inspected = await input.service.inspect(day.fortuneDate);
    if (
      day.action === "protected" &&
      inspected.kind === "protected" &&
      inspected.code === day.reason
    ) {
      continue;
    }
    if (day.action === "missing" && inspected.kind === "missing" && inspected.code === day.reason) {
      continue;
    }
    throw new Error(`${day.fortuneDate} classification no longer matches the approved plan`);
  }

  let existing = 0;
  let rebased = 0;
  for (const day of input.plan.days) {
    if (day.action !== "rebase") continue;
    const rebaseInput = applyInputForDay({ ...input, occurredAt, planDay: day });
    const recovered = recoveredEvents.get(day.fortuneDate);
    if (recovered !== undefined) {
      existing += 1;
      continue;
    }
    const result = await input.service.apply(rebaseInput);
    if (result.kind === "idempotency_conflict" || result.kind === "state_conflict") {
      throw new Error(
        `${day.fortuneDate} rebase failed closed: ${result.kind === "state_conflict" ? result.code : result.kind}`,
      );
    }
    assertExistingEvent(result.event, rebaseInput);
    if (result.kind === "existing") existing += 1;
    else rebased += 1;
  }

  return {
    existing,
    missing: input.plan.actionCounts.missing,
    protected: input.plan.actionCounts.protected,
    rebased,
    total: input.plan.days.length,
  };
}
