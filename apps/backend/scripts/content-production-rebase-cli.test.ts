import type { components } from "@five/api-contract";
import { describe, expect, it, vi } from "vitest";

import {
  canonicalModulePair,
  CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
  CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
  contentProductionRebaseRequestHash,
  hashCanonicalValue,
  type ContentProductionRebaseApplyInput,
  type ContentProductionRebaseEvent,
} from "../src/content-production/content-production-rebase";
import type { ContentProductionRebaseService } from "../src/content-production/content-production-rebase.service";
import { DeterministicDraftGenerator } from "../src/content-production/deterministic-draft.generator";
import {
  applyContentProductionRebasePlan,
  inspectContentProductionRebasePlan,
} from "./content-production-rebase-cli";
import { parseLegacyProductionSourceAllowlist } from "./content-production-rebase-plan";

type DraftModules = components["schemas"]["DraftModules"];
const DATES = ["2026-08-11", "2026-08-12", "2026-08-13"] as const;
const SOURCE_TREE = "fabc5018212d92b10449c669104c2d58682af91d";
const TARGET_BUILD = "c4adbe35885d2ff3cd56e00e6e80caf83f498560";

function legacyModules(fortuneDate: string): DraftModules {
  const generated = new DeterministicDraftGenerator().generate(fortuneDate);
  if (generated.calendar_algorithm === null || generated.copy_and_formula === null) {
    throw new Error("fixture is incomplete");
  }
  return {
    ...generated,
    calendar_algorithm: { ...generated.calendar_algorithm, algorithmVersion: "legacy-v0" },
    copy_and_formula: { ...generated.copy_and_formula, copyVersion: "legacy-v0" },
  };
}

function fixture() {
  const runtimeFiles = Array.from({ length: 7 }, (_, index) => ({
    path: `runtime/${index}.ts`,
    sha256: String(index + 1).repeat(64),
  }));
  const sourceDays = DATES.map((fortuneDate) => {
    const modules = legacyModules(fortuneDate);
    return { canonicalSha256: canonicalModulePair(modules).canonicalSha256, fortuneDate, modules };
  });
  const sourceAllowlist = parseLegacyProductionSourceAllowlist(
    {
      canonicalizationVersion: CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
      days: sourceDays,
      provenance: {
        legacyBlobOidAggregate: "8".repeat(64),
        legacyDemoBlob: "4".repeat(40),
        legacyDemoFileSha256: "4".repeat(64),
        legacyGeneratorBlob: "3".repeat(40),
        legacyGeneratorFileSha256: "3".repeat(64),
        runtimeFiles,
        runtimeFingerprint: hashCanonicalValue({ files: runtimeFiles }),
        sourceBuildId: SOURCE_TREE,
        sourceTree: SOURCE_TREE,
      },
      schemaVersion: "five-content-production-legacy-source-v1",
      sourceModuleManifestSha256: hashCanonicalValue(
        Object.fromEntries(sourceDays.map((day) => [day.fortuneDate, day.canonicalSha256])),
      ),
    },
    { expectedDayCount: DATES.length },
  );
  const batch = {
    days: DATES.map((fortuneDate) => ({
      fortuneDate,
      target: canonicalModulePair(new DeterministicDraftGenerator().generate(fortuneDate)),
    })),
    manifestSha256: "a".repeat(64),
  };
  return { batch, sourceAllowlist };
}

function serviceMock(
  overrides: Partial<
    Pick<ContentProductionRebaseService, "apply" | "inspect" | "inspectEvent">
  > = {},
) {
  return {
    apply: vi.fn(),
    inspect: vi.fn(),
    inspectEvent: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as Pick<ContentProductionRebaseService, "apply" | "inspect" | "inspectEvent">;
}

function eventFromInput(input: ContentProductionRebaseApplyInput): ContentProductionRebaseEvent {
  return {
    ...input,
    eventId: `event-${input.fortuneDate}`,
    fromDraftRevision: input.expectedDraftRevision,
    requestHash: contentProductionRebaseRequestHash(input),
    retainUntil: "2027-08-11T10:00:00.000Z",
    toDraftRevision: input.expectedDraftRevision + 1,
  };
}

describe("content production rebase CLI orchestration", () => {
  it("freezes every validated day as rebase, protected, or truly missing", async () => {
    const { batch, sourceAllowlist } = fixture();
    const inspect = vi
      .fn()
      .mockResolvedValueOnce({
        createdAt: "2026-08-10T00:00:00.000Z",
        draftId: "draft-rebase-0811",
        draftRevision: 1,
        fortuneDate: DATES[0],
        kind: "eligible",
        source: sourceAllowlist.days[0]!.source,
        target: batch.days[0]!.target,
      })
      .mockResolvedValueOnce({
        code: "published_active_version",
        fortuneDate: DATES[1],
        kind: "protected",
      })
      .mockResolvedValueOnce({ code: "not_found", fortuneDate: DATES[2], kind: "missing" });

    const plan = await inspectContentProductionRebasePlan({
      batch,
      createdAt: "2026-08-11T10:00:00.000Z",
      legacyAllowlistSha256: "c".repeat(64),
      planId: "content-rebase-cli-test-plan",
      service: serviceMock({ inspect }),
      sourceAllowlist,
      targetBuildId: TARGET_BUILD,
    });

    expect(plan.actionCounts).toEqual({ missing: 1, protected: 1, rebase: 1 });
    expect(plan.days.map((day) => day.action)).toEqual(["rebase", "protected", "missing"]);
    expect(inspect).toHaveBeenCalledTimes(3);
  });

  it("preflights the complete plan before the first write", async () => {
    const { batch, sourceAllowlist } = fixture();
    const inspectService = serviceMock({
      inspect: vi
        .fn()
        .mockResolvedValueOnce({
          createdAt: "2026-08-10T00:00:00.000Z",
          draftId: "draft-rebase-0811",
          draftRevision: 1,
          fortuneDate: DATES[0],
          kind: "eligible",
          source: sourceAllowlist.days[0]!.source,
          target: batch.days[0]!.target,
        })
        .mockResolvedValueOnce({ code: "source_mismatch", kind: "state_conflict" }),
    });
    const plan = await inspectContentProductionRebasePlan({
      batch: { ...batch, days: batch.days.slice(0, 2) },
      createdAt: "2026-08-11T10:00:00.000Z",
      legacyAllowlistSha256: "c".repeat(64),
      planId: "content-rebase-cli-preflight-plan",
      service: serviceMock({
        inspect: vi
          .fn()
          .mockResolvedValueOnce({
            createdAt: "2026-08-10T00:00:00.000Z",
            draftId: "draft-rebase-0811",
            draftRevision: 1,
            fortuneDate: DATES[0],
            kind: "eligible",
            source: sourceAllowlist.days[0]!.source,
            target: batch.days[0]!.target,
          })
          .mockResolvedValueOnce({
            createdAt: "2026-08-10T00:00:00.000Z",
            draftId: "draft-rebase-0812",
            draftRevision: 1,
            fortuneDate: DATES[1],
            kind: "eligible",
            source: sourceAllowlist.days[1]!.source,
            target: batch.days[1]!.target,
          }),
      }),
      sourceAllowlist: { ...sourceAllowlist, days: sourceAllowlist.days.slice(0, 2) },
      targetBuildId: TARGET_BUILD,
    });

    await expect(
      applyContentProductionRebasePlan({
        actorId: "operator-content-rebase",
        now: () => new Date("2026-08-11T10:05:00.000Z"),
        plan,
        planSha256: "d".repeat(64),
        reason: "受控重算。",
        service: inspectService,
      }),
    ).rejects.toThrow(DATES[1]);
    expect(inspectService.apply).not.toHaveBeenCalled();
  });

  it("recovers an existing event and idempotently applies only the remaining rebase day", async () => {
    const { batch, sourceAllowlist } = fixture();
    const plan = await inspectContentProductionRebasePlan({
      batch: { ...batch, days: batch.days.slice(0, 2) },
      createdAt: "2026-08-11T10:00:00.000Z",
      legacyAllowlistSha256: "c".repeat(64),
      planId: "content-rebase-cli-recovery-plan",
      service: serviceMock({
        inspect: vi
          .fn()
          .mockResolvedValueOnce({
            createdAt: "2026-08-10T00:00:00.000Z",
            draftId: "draft-rebase-0811",
            draftRevision: 1,
            fortuneDate: DATES[0],
            kind: "eligible",
            source: sourceAllowlist.days[0]!.source,
            target: batch.days[0]!.target,
          })
          .mockResolvedValueOnce({
            createdAt: "2026-08-10T00:00:00.000Z",
            draftId: "draft-rebase-0812",
            draftRevision: 1,
            fortuneDate: DATES[1],
            kind: "eligible",
            source: sourceAllowlist.days[1]!.source,
            target: batch.days[1]!.target,
          }),
      }),
      sourceAllowlist: { ...sourceAllowlist, days: sourceAllowlist.days.slice(0, 2) },
      targetBuildId: TARGET_BUILD,
    });
    const first = plan.days[0];
    const second = plan.days[1];
    if (first?.action !== "rebase" || second?.action !== "rebase") throw new Error("bad fixture");
    const common = {
      actorId: "operator-content-rebase",
      batchManifestSha256: plan.batchManifestSha256,
      canonicalizationVersion: plan.canonicalizationVersion,
      expectedDraftRevision: 1,
      generatorId: CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
      occurredAt: "2026-08-11T10:05:00.000Z",
      planId: plan.planId,
      planSha256: "d".repeat(64),
      reason: "受控重算。",
      sourceBuildId: plan.sourceBuildId,
      sourceGeneratorFingerprint: plan.sourceGeneratorFingerprint,
      sourceModuleManifestSha256: plan.sourceModuleManifestSha256,
      targetBuildId: plan.targetBuildId,
    } as const;
    const firstInput: ContentProductionRebaseApplyInput = {
      ...common,
      draftId: first.draftId,
      fortuneDate: first.fortuneDate,
      idempotencyKey: first.idempotencyKey,
      requestId: `request-rebase-${first.fortuneDate}`,
      source: first.source,
      sourceCreatedAt: first.sourceCreatedAt,
      target: first.target,
    };
    const existing = eventFromInput(firstInput);
    const inspectEvent = vi.fn().mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
    const apply = vi.fn(async (input: ContentProductionRebaseApplyInput) => ({
      event: eventFromInput(input),
      kind: "rebased" as const,
    }));
    const service = serviceMock({
      apply,
      inspect: vi.fn().mockResolvedValue({
        createdAt: second.sourceCreatedAt,
        draftId: second.draftId,
        draftRevision: 1,
        fortuneDate: second.fortuneDate,
        kind: "eligible",
        source: second.source,
        target: second.target,
      }),
      inspectEvent,
    });

    await expect(
      applyContentProductionRebasePlan({
        actorId: common.actorId,
        now: () => new Date(common.occurredAt),
        plan,
        planSha256: common.planSha256,
        reason: common.reason,
        service,
      }),
    ).resolves.toMatchObject({ existing: 1, rebased: 1, total: 2 });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ fortuneDate: second.fortuneDate }),
    );
  });
});
