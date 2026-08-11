import { createHash } from "node:crypto";

import type { components } from "@five/api-contract";
import { describe, expect, it, vi } from "vitest";

import {
  canonicalJson,
  canonicalModulePair,
  CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
  CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
  hashCanonicalValue,
  type ContentProductionRebaseApplyInput,
} from "./content-production-rebase";
import type { ContentProductionRebaseStore } from "./content-production-rebase.store";
import { ContentProductionRebaseService } from "./content-production-rebase.service";
import { DeterministicDraftGenerator } from "./deterministic-draft.generator";

type DraftModules = components["schemas"]["DraftModules"];
const FORTUNE_DATE = "2026-08-20";

function sourceModules(): DraftModules {
  const generated = new DeterministicDraftGenerator().generate(FORTUNE_DATE);
  if (generated.calendar_algorithm === null || generated.copy_and_formula === null) {
    throw new Error("deterministic fixture is incomplete");
  }
  return {
    ...generated,
    calendar_algorithm: {
      ...generated.calendar_algorithm,
      algorithmVersion: "legacy-calendar-algorithm-v0",
    },
    copy_and_formula: { ...generated.copy_and_formula, copyVersion: "legacy-copy-v0" },
  };
}

function input(): ContentProductionRebaseApplyInput {
  return {
    actorId: "operator-content-rebase",
    batchManifestSha256: "a".repeat(64),
    canonicalizationVersion: CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
    draftId: "draft-content-rebase-unit",
    expectedDraftRevision: 1,
    fortuneDate: FORTUNE_DATE,
    generatorId: CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
    idempotencyKey: "content-rebase-service-unit-0001",
    occurredAt: "2026-08-11T10:00:00.000Z",
    planId: "content-rebase-plan-unit-v1",
    planSha256: "b".repeat(64),
    reason: "验证受控来源和当前确定性生成器边界。",
    requestId: "request-content-rebase-unit-0001",
    sourceBuildId: "fabc5018212d92b10449c669104c2d58682af91d",
    sourceCreatedAt: "2026-08-11T10:00:00.000Z",
    sourceGeneratorFingerprint: "3".repeat(64),
    sourceModuleManifestSha256: "5".repeat(64),
    source: canonicalModulePair(sourceModules()),
    targetBuildId: "c4adbe35885d2ff3cd56e00e6e80caf83f498560",
    target: canonicalModulePair(new DeterministicDraftGenerator().generate(FORTUNE_DATE)),
  };
}

function dependencies(value: ContentProductionRebaseApplyInput) {
  const rebase = vi.fn().mockResolvedValue({
    event: {},
    kind: "rebased",
  });
  const store = {
    inspectEvent: vi.fn(),
    rebase,
  } as unknown as ContentProductionRebaseStore;
  const runtime = {
    approvedLegacySources: new Map([
      [
        value.fortuneDate,
        {
          sourceBuildId: value.sourceBuildId,
          sourceGeneratorFingerprint: value.sourceGeneratorFingerprint,
          sourceModuleManifestSha256: value.sourceModuleManifestSha256,
          source: value.source,
        },
      ],
    ]),
    generatorId: CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
    targetBuildId: value.targetBuildId,
  } as const;
  return { rebase, runtime, store };
}

describe("content production rebase evidence", () => {
  it("uses deterministic code-unit key ordering for canonical JSON", () => {
    const left = { 中文: 4, z: 1, _: 2, nested: { β: 3, a: 2 } };
    const right = { nested: { a: 2, β: 3 }, _: 2, z: 1, 中文: 4 };
    const expected = '{"_":2,"nested":{"a":2,"β":3},"z":1,"中文":4}';

    expect(canonicalJson(left)).toBe(expected);
    expect(canonicalJson(right)).toBe(expected);
    expect(hashCanonicalValue(left)).toBe(createHash("sha256").update(expected).digest("hex"));
  });

  it("hashes only an exact four-module unfrozen DraftModules object", () => {
    const valid = sourceModules();
    expect(canonicalModulePair(valid).canonicalSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => canonicalModulePair({ ...valid, extra: true } as DraftModules)).toThrow(
      "exact unfrozen deterministic modules",
    );
    expect(() =>
      canonicalModulePair({
        ...valid,
        visual_and_rights: { looks: [] },
      } as unknown as DraftModules),
    ).toThrow("exact unfrozen deterministic modules");
  });

  it("rejects a revision, build, generator, or source outside the frozen runtime allowlist", async () => {
    const value = input();
    const { rebase, runtime, store } = dependencies(value);
    const service = new ContentProductionRebaseService(
      store,
      runtime,
      new DeterministicDraftGenerator(),
    );

    await expect(service.apply({ ...value, expectedDraftRevision: 2 })).rejects.toThrow(
      "revision-one",
    );
    await expect(service.apply({ ...value, targetBuildId: "different-build" })).rejects.toThrow(
      "server build",
    );
    await expect(service.apply({ ...value, generatorId: "different-generator" })).rejects.toThrow(
      "server generator",
    );
    await expect(
      new ContentProductionRebaseService(
        store,
        { ...runtime, approvedLegacySources: new Map() },
        new DeterministicDraftGenerator(),
      ).apply(value),
    ).rejects.toThrow("approved legacy allowlist");
    expect(rebase).not.toHaveBeenCalled();
  });
});
