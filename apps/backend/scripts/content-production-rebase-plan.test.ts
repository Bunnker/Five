import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalModulePair,
  CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
  CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
  hashCanonicalValue,
} from "../src/content-production/content-production-rebase";
import { DeterministicDraftGenerator } from "../src/content-production/deterministic-draft.generator";
import {
  buildContentProductionRebasePlan,
  contentProductionRebaseConfirmation,
  parseContentProductionRebasePlan,
  parseLegacyProductionSourceAllowlist,
  validateContentProductionRebaseApplyGate,
  writeNewPrivateJson,
} from "./content-production-rebase-plan";

const FORTUNE_DATE = "2026-08-20";
const TARGET_BUILD = "c4adbe35885d2ff3cd56e00e6e80caf83f498560";

function legacyModules() {
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

function allowlistDocument() {
  const source = canonicalModulePair(legacyModules());
  const runtimeFiles = Array.from({ length: 7 }, (_, index) => ({
    path: `legacy-runtime/file-${index + 1}.ts`,
    sha256: String(index + 1).repeat(64),
  }));
  return {
    canonicalizationVersion: CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
    days: [
      {
        canonicalSha256: source.canonicalSha256,
        fortuneDate: FORTUNE_DATE,
        modules: legacyModules(),
      },
    ],
    provenance: {
      legacyDemoBlob: "4".repeat(40),
      legacyDemoFileSha256: "4".repeat(64),
      legacyBlobOidAggregate: "8".repeat(64),
      legacyGeneratorBlob: "3".repeat(40),
      legacyGeneratorFileSha256: "3".repeat(64),
      runtimeFiles,
      runtimeFingerprint: hashCanonicalValue({ files: runtimeFiles }),
      sourceBuildId: "fabc5018212d92b10449c669104c2d58682af91d",
      sourceTree: "fabc5018212d92b10449c669104c2d58682af91d",
    },
    schemaVersion: "five-content-production-legacy-source-v1",
    sourceModuleManifestSha256: hashCanonicalValue({ [FORTUNE_DATE]: source.canonicalSha256 }),
  };
}

function plan() {
  const allowlist = parseLegacyProductionSourceAllowlist(allowlistDocument(), {
    expectedDayCount: 1,
  });
  const source = allowlist.days[0]!.source;
  const target = canonicalModulePair(new DeterministicDraftGenerator().generate(FORTUNE_DATE));
  return buildContentProductionRebasePlan({
    batch: {
      days: [{ fortuneDate: FORTUNE_DATE, target }],
      manifestSha256: "a".repeat(64),
    },
    createdAt: "2026-08-11T10:00:00.000Z",
    inspections: [
      {
        createdAt: "2026-08-10T00:00:00.000Z",
        draftId: "draft-production-rebase-plan",
        draftRevision: 1,
        fortuneDate: FORTUNE_DATE,
        kind: "eligible",
        source,
        target,
      },
    ],
    legacyAllowlistSha256: "c".repeat(64),
    planId: "five-production-rebase-2026-08-v1",
    sourceAllowlist: allowlist,
    targetBuildId: TARGET_BUILD,
  });
}

describe("content production rebase plan", () => {
  it("validates seven-file legacy provenance and a full-module per-date allowlist", () => {
    const parsed = parseLegacyProductionSourceAllowlist(allowlistDocument(), {
      expectedDayCount: 1,
    });

    expect(parsed.sourceGeneratorFingerprint).toBe(
      allowlistDocument().provenance.runtimeFingerprint,
    );
    expect(parsed.days[0]).toMatchObject({
      fortuneDate: FORTUNE_DATE,
      source: { canonicalSha256: canonicalModulePair(legacyModules()).canonicalSha256 },
    });
    const invalid = allowlistDocument();
    invalid.days[0]!.modules = {
      ...invalid.days[0]!.modules,
      visual_and_rights: { looks: [] },
    } as never;
    expect(() => parseLegacyProductionSourceAllowlist(invalid, { expectedDayCount: 1 })).toThrow(
      "exact unfrozen deterministic modules",
    );

    const mismatchedTree = allowlistDocument();
    mismatchedTree.provenance.sourceTree = "9".repeat(40);
    expect(() =>
      parseLegacyProductionSourceAllowlist(mismatchedTree, { expectedDayCount: 1 }),
    ).toThrow("source build id must equal its source tree");
  });

  it("freezes source, target, provenance, revision and deterministic idempotency per day", () => {
    const result = plan();

    expect(result).toMatchObject({
      batchManifestSha256: "a".repeat(64),
      canonicalizationVersion: CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
      generatorId: CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
      legacyAllowlistSha256: "c".repeat(64),
      schemaVersion: "five-content-production-rebase-plan-v1",
      targetBuildId: TARGET_BUILD,
    });
    expect(result.days[0]).toMatchObject({
      draftId: "draft-production-rebase-plan",
      expectedDraftRevision: 1,
      fortuneDate: FORTUNE_DATE,
      idempotencyKey: expect.stringMatching(/^content-rebase:/u),
      source: { canonicalSha256: canonicalModulePair(legacyModules()).canonicalSha256 },
    });
  });

  it("requires a separately approved plan, fresh stopped-service evidence and exact phrase", () => {
    const value = plan();
    const planSha256 = "d".repeat(64);
    const stopEvidenceSha256 = "e".repeat(64);
    const confirmation = contentProductionRebaseConfirmation(value);
    const environment = {
      FIVE_CONTENT_REBASE_APPROVED_LEGACY_ALLOWLIST_SHA256: value.legacyAllowlistSha256,
      FIVE_CONTENT_REBASE_APPROVED_PLAN_SHA256: planSha256,
      FIVE_CONTENT_REBASE_CONFIRMATION: confirmation,
      FIVE_CONTENT_REBASE_ENABLED: "1",
      FIVE_CONTENT_REBASE_EXPECTED_MISSING_COUNT: "0",
      FIVE_CONTENT_REBASE_EXPECTED_PROTECTED_COUNT: "0",
      FIVE_CONTENT_REBASE_EXPECTED_REBASE_COUNT: "1",
      FIVE_CONTENT_REBASE_HTTP_STOPPED: "1",
      FIVE_CONTENT_REBASE_OPERATOR_ID: "operator-content-rebase",
      FIVE_CONTENT_REBASE_REASON: "生产旧自动草稿确定性重算。",
      FIVE_CONTENT_REBASE_STOP_EVIDENCE_SHA256: stopEvidenceSha256,
      FIVE_CONTENT_REBASE_TARGET_BUILD_ID: TARGET_BUILD,
      FIVE_CONTENT_REBASE_WORKER_STOPPED: "1",
    };
    const evidence = {
      observedAt: "2026-08-11T10:00:00.000Z",
      schemaVersion: "five-content-rebase-stop-evidence-v1",
      services: { http: "stopped", worker: "stopped" },
      source: "docker-compose-ps",
    } as const;

    expect(
      validateContentProductionRebaseApplyGate({
        environment,
        evidence,
        legacyAllowlistSha256: value.legacyAllowlistSha256,
        now: "2026-08-11T10:05:00.000Z",
        plan: value,
        planSha256,
        stopEvidenceSha256,
      }),
    ).toEqual({
      actorId: "operator-content-rebase",
      reason: "生产旧自动草稿确定性重算。",
    });
    expect(() =>
      validateContentProductionRebaseApplyGate({
        environment: { ...environment, FIVE_CONTENT_REBASE_CONFIRMATION: "REBASE" },
        evidence,
        legacyAllowlistSha256: value.legacyAllowlistSha256,
        now: "2026-08-11T10:05:00.000Z",
        plan: value,
        planSha256,
        stopEvidenceSha256,
      }),
    ).toThrow("confirmation phrase");
  });

  it("strictly rebuilds an untrusted plan and rejects changed counts or per-day evidence", () => {
    const value = plan();
    const allowlist = parseLegacyProductionSourceAllowlist(allowlistDocument(), {
      expectedDayCount: 1,
    });
    const batch = {
      days: [
        {
          fortuneDate: FORTUNE_DATE,
          target: canonicalModulePair(new DeterministicDraftGenerator().generate(FORTUNE_DATE)),
        },
      ],
      manifestSha256: "a".repeat(64),
    };

    expect(
      parseContentProductionRebasePlan(value, {
        batch,
        expectedDayCount: 1,
        legacyAllowlistSha256: "c".repeat(64),
        sourceAllowlist: allowlist,
        targetBuildId: TARGET_BUILD,
      }),
    ).toEqual(value);
    expect(() =>
      parseContentProductionRebasePlan(
        { ...value, actionCounts: { ...value.actionCounts, rebase: 0 } },
        {
          batch,
          expectedDayCount: 1,
          legacyAllowlistSha256: "c".repeat(64),
          sourceAllowlist: allowlist,
          targetBuildId: TARGET_BUILD,
        },
      ),
    ).toThrow("does not exactly match");
    const tamperedDay = { ...value.days[0], idempotencyKey: "content-rebase:tampered" };
    expect(() =>
      parseContentProductionRebasePlan(
        { ...value, days: [tamperedDay] },
        {
          batch,
          expectedDayCount: 1,
          legacyAllowlistSha256: "c".repeat(64),
          sourceAllowlist: allowlist,
          targetBuildId: TARGET_BUILD,
        },
      ),
    ).toThrow("does not exactly match");
  });

  it("writes a new plan with mode 0600 and refuses to replace evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "five-rebase-plan-"));
    const path = join(directory, "plan.json");

    await writeNewPrivateJson(path, plan());

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      schemaVersion: "five-content-production-rebase-plan-v1",
    });
    await expect(writeNewPrivateJson(path, plan())).rejects.toMatchObject({ code: "EEXIST" });
  });
});
