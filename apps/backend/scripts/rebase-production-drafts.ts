import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { Pool } from "pg";

import {
  canonicalModulePair,
  CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
} from "../src/content-production/content-production-rebase";
import { ContentProductionRebaseService } from "../src/content-production/content-production-rebase.service";
import { DeterministicDraftGenerator } from "../src/content-production/deterministic-draft.generator";
import { PostgresContentProductionRebaseStore } from "../src/content-production/postgres-content-production-rebase.store";
import {
  applyContentProductionRebasePlan,
  inspectContentProductionRebasePlan,
  type ContentProductionRebaseTargetBatch,
} from "./content-production-rebase-cli";
import { withContentProductionRebaseMaintenanceLock } from "./content-production-rebase-maintenance-lock";
import {
  parseContentProductionRebasePlan,
  parseLegacyProductionSourceAllowlist,
  rawBytesSha256,
  validateContentProductionRebaseApplyGate,
  writeNewPrivateJson,
  type ContentProductionRebasePlan,
  type ParsedLegacyProductionSourceAllowlist,
} from "./content-production-rebase-plan";
import { validateProductionBatch } from "./production-batch-admin-import";

const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
interface Arguments {
  readonly command: "apply" | "inspect";
  readonly values: ReadonlyMap<string, string>;
}

interface RebaseLedger {
  readonly createdAt: string;
  readonly days: Record<
    string,
    {
      readonly action: "missing" | "protected" | "rebase";
      readonly eventId: string | null;
      readonly status: "complete" | "pending";
    }
  >;
  readonly planId: string;
  readonly planSha256: string;
  readonly schemaVersion: "five-content-production-rebase-ledger-v1";
  readonly updatedAt: string;
}

function parseArguments(argv: readonly string[]): Arguments {
  const filtered = argv.filter((argument) => argument !== "--");
  const command = filtered[0];
  if (command !== "inspect" && command !== "apply") {
    throw new Error("Usage: production-batch:rebase <inspect|apply> [options]");
  }
  const values = new Map<string, string>();
  for (let index = 1; index < filtered.length; index += 2) {
    const name = filtered[index];
    const value = filtered[index + 1];
    if (
      name === undefined ||
      !name.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error(`Invalid ${command} option list`);
    }
    if (values.has(name)) throw new Error(`Duplicate option ${name}`);
    values.set(name, value);
  }
  return { command, values };
}

function option(arguments_: Arguments, name: string, path = false): string {
  const value = arguments_.values.get(name);
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  if (path && !isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return path ? resolve(value) : value;
}

function assertOnlyOptions(arguments_: Arguments, expected: readonly string[]): void {
  const expectedSet = new Set(expected);
  for (const name of arguments_.values.keys()) {
    if (!expectedSet.has(name)) throw new Error(`Unsupported ${arguments_.command} option ${name}`);
  }
}

async function readRegularFile(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > MAX_EVIDENCE_BYTES) {
    throw new Error(
      "Evidence path must be a non-empty regular non-symlink file within size limits",
    );
  }
  return readFile(path);
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function databasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error("DATABASE_URL is required");
  }
  return new Pool({
    application_name: "five-content-production-rebase",
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 4,
  });
}

function targetBatch(
  batch: Awaited<ReturnType<typeof validateProductionBatch>>,
): ContentProductionRebaseTargetBatch {
  return {
    days: batch.days.map((day) => ({
      fortuneDate: day.fortuneDate,
      target: canonicalModulePair({
        calendar_algorithm: day.algorithm.modules.calendar_algorithm,
        copy_and_formula: day.algorithm.modules.copy_and_formula,
        poster_consistency: null,
        visual_and_rights: null,
      }),
    })),
    manifestSha256: batch.manifestSha256,
  };
}

function runtime(allowlist: ParsedLegacyProductionSourceAllowlist, targetBuildId: string) {
  return {
    approvedLegacySources: new Map(
      allowlist.days.map((day) => [
        day.fortuneDate,
        {
          sourceBuildId: allowlist.sourceBuildId,
          sourceGeneratorFingerprint: allowlist.sourceGeneratorFingerprint,
          sourceModuleManifestSha256: allowlist.sourceModuleManifestSha256,
          source: day.source,
        },
      ]),
    ),
    generatorId: CONTENT_PRODUCTION_REBASE_GENERATOR_ID,
    targetBuildId,
  } as const;
}

async function inspectCommand(arguments_: Arguments): Promise<unknown> {
  assertOnlyOptions(arguments_, [
    "--batch-root",
    "--legacy-allowlist",
    "--plan-id",
    "--plan-output",
    "--target-build-id",
  ]);
  const batchRoot = option(arguments_, "--batch-root", true);
  const allowlistPath = option(arguments_, "--legacy-allowlist", true);
  const planOutput = option(arguments_, "--plan-output", true);
  const planId = option(arguments_, "--plan-id");
  const targetBuildId = option(arguments_, "--target-build-id");
  const [batch, allowlistBytes] = await Promise.all([
    validateProductionBatch(batchRoot, { expectedDayCount: 30 }),
    readRegularFile(allowlistPath),
  ]);
  const allowlist = parseLegacyProductionSourceAllowlist(
    parseJson(allowlistBytes, "legacy allowlist"),
    { expectedDayCount: 30 },
  );
  const pool = databasePool();
  const lockClient = await pool.connect();
  try {
    return await withContentProductionRebaseMaintenanceLock(
      {
        query: async (statement, parameters) => {
          const result = await lockClient.query<{ readonly acquired?: boolean }>(statement, [
            ...parameters,
          ]);
          return { rows: result.rows };
        },
      },
      "shared",
      async () => {
        const service = new ContentProductionRebaseService(
          new PostgresContentProductionRebaseStore(pool),
          runtime(allowlist, targetBuildId),
          new DeterministicDraftGenerator(),
        );
        const plan = await inspectContentProductionRebasePlan({
          batch: targetBatch(batch),
          createdAt: new Date().toISOString(),
          legacyAllowlistSha256: rawBytesSha256(allowlistBytes),
          planId,
          service,
          sourceAllowlist: allowlist,
          targetBuildId,
        });
        await writeNewPrivateJson(planOutput, plan);
        const planBytes = await readRegularFile(planOutput);
        return {
          actionCounts: plan.actionCounts,
          batchManifestSha256: plan.batchManifestSha256,
          command: "inspect",
          legacyAllowlistSha256: plan.legacyAllowlistSha256,
          planId: plan.planId,
          planOutput,
          planSha256: rawBytesSha256(planBytes),
          range: plan.range,
          sourceModuleManifestSha256: plan.sourceModuleManifestSha256,
          status: "plan_written",
          targetBuildId: plan.targetBuildId,
        };
      },
    );
  } finally {
    lockClient.release();
    await pool.end();
  }
}

function initialLedger(
  plan: ContentProductionRebasePlan,
  planSha256: string,
  now: string,
): RebaseLedger {
  return {
    createdAt: now,
    days: Object.fromEntries(
      plan.days.map((day) => [
        day.fortuneDate,
        {
          action: day.action,
          eventId: null,
          status: day.action === "rebase" ? "pending" : "complete",
        },
      ]),
    ),
    planId: plan.planId,
    planSha256,
    schemaVersion: "five-content-production-rebase-ledger-v1",
    updatedAt: now,
  };
}

async function loadOrCreateLedger(
  path: string,
  plan: ContentProductionRebasePlan,
  planSha256: string,
): Promise<RebaseLedger> {
  try {
    const bytes = await readRegularFile(path);
    const value = parseJson(bytes, "rebase ledger") as Partial<RebaseLedger>;
    const expectedDates = plan.days.map((day) => day.fortuneDate).sort();
    if (
      value.schemaVersion !== "five-content-production-rebase-ledger-v1" ||
      value.planId !== plan.planId ||
      value.planSha256 !== planSha256 ||
      typeof value.days !== "object" ||
      value.days === null ||
      JSON.stringify(Object.keys(value.days).sort()) !== JSON.stringify(expectedDates)
    ) {
      throw new Error("Existing rebase ledger does not match the approved plan");
    }
    for (const planDay of plan.days) {
      const ledgerDay = value.days[planDay.fortuneDate];
      if (
        typeof ledgerDay !== "object" ||
        ledgerDay === null ||
        JSON.stringify(Object.keys(ledgerDay).sort()) !==
          JSON.stringify(["action", "eventId", "status"]) ||
        ledgerDay.action !== planDay.action ||
        !["complete", "pending"].includes(ledgerDay.status) ||
        (ledgerDay.eventId !== null && typeof ledgerDay.eventId !== "string") ||
        (planDay.action !== "rebase" &&
          (ledgerDay.status !== "complete" || ledgerDay.eventId !== null))
      ) {
        throw new Error("Existing rebase ledger day does not match the approved plan");
      }
    }
    return value as RebaseLedger;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const ledger = initialLedger(plan, planSha256, new Date().toISOString());
    await writeNewPrivateJson(path, ledger);
    return ledger;
  }
}

async function saveLedger(path: string, ledger: RebaseLedger): Promise<void> {
  const temporary = resolve(dirname(path), `.${randomUUID()}.rebase-ledger.tmp`);
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, {
    flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    mode: 0o600,
  });
  await rename(temporary, path);
}

async function reconcileLedger(
  ledger: RebaseLedger,
  plan: ContentProductionRebasePlan,
  service: ContentProductionRebaseService,
): Promise<RebaseLedger> {
  const days = { ...ledger.days };
  for (const day of plan.days) {
    if (day.action !== "rebase") continue;
    const event = await service.inspectEvent(day.idempotencyKey);
    if (
      event !== null &&
      (event.planSha256 !== ledger.planSha256 ||
        event.planId !== plan.planId ||
        event.fortuneDate !== day.fortuneDate ||
        event.draftId !== day.draftId ||
        event.sourceCreatedAt !== day.sourceCreatedAt ||
        event.fromDraftRevision !== day.expectedDraftRevision ||
        event.source.canonicalSha256 !== day.source.canonicalSha256 ||
        event.target.canonicalSha256 !== day.target.canonicalSha256)
    ) {
      throw new Error(`${day.fortuneDate} stored event does not match the ledger plan`);
    }
    days[day.fortuneDate] = {
      action: "rebase",
      eventId: event?.eventId ?? null,
      status: event === null ? "pending" : "complete",
    };
  }
  return { ...ledger, days, updatedAt: new Date().toISOString() };
}

async function applyCommand(arguments_: Arguments): Promise<unknown> {
  assertOnlyOptions(arguments_, [
    "--batch-root",
    "--ledger",
    "--legacy-allowlist",
    "--plan",
    "--stop-evidence",
  ]);
  const batchRoot = option(arguments_, "--batch-root", true);
  const ledgerPath = option(arguments_, "--ledger", true);
  const allowlistPath = option(arguments_, "--legacy-allowlist", true);
  const planPath = option(arguments_, "--plan", true);
  const stopEvidencePath = option(arguments_, "--stop-evidence", true);
  const [batch, allowlistBytes, planBytes, stopEvidenceBytes] = await Promise.all([
    validateProductionBatch(batchRoot, { expectedDayCount: 30 }),
    readRegularFile(allowlistPath),
    readRegularFile(planPath),
    readRegularFile(stopEvidencePath),
  ]);
  const allowlistSha256 = rawBytesSha256(allowlistBytes);
  const planSha256 = rawBytesSha256(planBytes);
  const stopEvidenceSha256 = rawBytesSha256(stopEvidenceBytes);
  const allowlist = parseLegacyProductionSourceAllowlist(
    parseJson(allowlistBytes, "legacy allowlist"),
    { expectedDayCount: 30 },
  );
  const targetBuildId = process.env.FIVE_CONTENT_REBASE_TARGET_BUILD_ID ?? "";
  const plan = parseContentProductionRebasePlan(parseJson(planBytes, "rebase plan"), {
    batch: targetBatch(batch),
    expectedDayCount: 30,
    legacyAllowlistSha256: allowlistSha256,
    sourceAllowlist: allowlist,
    targetBuildId,
  });
  const gate = validateContentProductionRebaseApplyGate({
    environment: process.env,
    evidence: parseJson(stopEvidenceBytes, "stop evidence"),
    legacyAllowlistSha256: allowlistSha256,
    now: new Date().toISOString(),
    plan,
    planSha256,
    stopEvidenceSha256,
  });
  let ledger = await loadOrCreateLedger(ledgerPath, plan, planSha256);
  const pool = databasePool();
  const lockClient = await pool.connect();
  try {
    return await withContentProductionRebaseMaintenanceLock(
      {
        query: async (statement, parameters) => {
          const result = await lockClient.query<{ readonly acquired?: boolean }>(statement, [
            ...parameters,
          ]);
          return { rows: result.rows };
        },
      },
      "exclusive",
      async () => {
        const service = new ContentProductionRebaseService(
          new PostgresContentProductionRebaseStore(pool),
          runtime(allowlist, plan.targetBuildId),
          new DeterministicDraftGenerator(),
        );
        try {
          const summary = await applyContentProductionRebasePlan({
            actorId: gate.actorId,
            plan,
            planSha256,
            reason: gate.reason,
            service,
          });
          ledger = await reconcileLedger(ledger, plan, service);
          await saveLedger(ledgerPath, ledger);
          if (Object.values(ledger.days).some((day) => day.status !== "complete")) {
            throw new Error("Rebase ledger is incomplete after apply");
          }
          return {
            ...summary,
            command: "apply",
            ledgerPath,
            planId: plan.planId,
            planSha256,
            status: "complete",
          };
        } catch (error) {
          ledger = await reconcileLedger(ledger, plan, service);
          await saveLedger(ledgerPath, ledger);
          throw error;
        }
      },
    );
  } finally {
    lockClient.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const result =
    arguments_.command === "inspect"
      ? await inspectCommand(arguments_)
      : await applyCommand(arguments_);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown content production rebase error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
