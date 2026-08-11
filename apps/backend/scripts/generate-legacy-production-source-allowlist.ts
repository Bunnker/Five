import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { components } from "@five/api-contract";

import {
  canonicalModulePair,
  CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
  hashCanonicalValue,
} from "../src/content-production/content-production-rebase";
import { parseLegacyProductionSourceAllowlist } from "./content-production-rebase-plan";

type DraftModules = components["schemas"]["DraftModules"];

const SOURCE_TREE = "fabc5018212d92b10449c669104c2d58682af91d";
const LEGACY_GENERATOR_BLOB = "4f3a4b479aa88c9eaf4827420cf14a0726f79d8a";
const LEGACY_DEMO_BLOB = "41c2aff7e63e6c2f9ae35c578a2454418cf2566b";
const LEGACY_BLOB_OID_AGGREGATE =
  "3f639ec2f2b6b625f0be08c6b50a092b23cd10dbc2a9481da90c47819fee997b";
const START_FORTUNE_DATE = "2026-08-11";
const DAY_COUNT = 30;
const RUNTIME_FILES = [
  {
    path: ".nvmrc",
    sha256: "51849cee918b92b09b95121b54380f6124c0f578d8c2323221c0d75bbbadb08d",
  },
  {
    path: "apps/backend/package.json",
    sha256: "1df4e0a5d7cf77820ae38ffa8e240d6161b31829b9166a152332fe3e592c22bf",
  },
  {
    path: "apps/backend/src/calendar/calendar-rule-engine.ts",
    sha256: "deffdbce5fcbd5e89b06bf70d7852cafab8269fd99e0657f8bafaca2e4ca7bae",
  },
  {
    path: "apps/backend/src/content-production/deterministic-draft.generator.ts",
    sha256: "f3283067a5ec95a530b35340646b3d8881d087e21cdfd9e90136a464a07c0f7e",
  },
  {
    path: "apps/backend/src/today/demo-published-content.reader.ts",
    sha256: "50c59987d54a8f9043602abe414d0172016000c8d11770451777a78ce8866298",
  },
  {
    path: "package.json",
    sha256: "acbc012f1bcb34612747955dc9dc2a59d65438ff996fca48383bd3993b9e381e",
  },
  {
    path: "pnpm-lock.yaml",
    sha256: "9c24e06f043e6f9853a99941a2f043bba62293cb08b1f06009234f4f2e678b47",
  },
] as const;
const LEGACY_SOURCE_FILES = [
  "apps/backend/src/calendar/calendar-rule-engine.ts",
  "apps/backend/src/content-production/deterministic-draft.generator.ts",
  "apps/backend/src/today/demo-published-content.reader.ts",
] as const;

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readTreeFile(path: string): Buffer {
  return execFileSync("git", ["show", `${SOURCE_TREE}:${path}`], {
    cwd: resolve(__dirname, "../../.."),
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function loadLegacyGenerator(): Promise<{
  generate(fortuneDate: string): DraftModules;
}> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "five-legacy-generator-"));
  try {
    for (const path of LEGACY_SOURCE_FILES) {
      const target = join(temporaryRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, readTreeFile(path), { flag: "wx", mode: 0o600 });
    }
    await symlink(
      resolve(__dirname, "../node_modules"),
      join(temporaryRoot, "node_modules"),
      "dir",
    );
    // The script itself is started with ts-node, so the restored TypeScript source uses the
    // same transient compiler hook while resolving its runtime dependency through this symlink.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const restored = require(
      join(temporaryRoot, "apps/backend/src/content-production/deterministic-draft.generator.ts"),
    ) as {
      readonly DeterministicDraftGenerator: new () => {
        generate(fortuneDate: string): DraftModules;
      };
    };
    return new restored.DeterministicDraftGenerator();
  } finally {
    // The returned class has already loaded its dependencies into memory.
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function generate(outputPath: string): Promise<void> {
  for (const file of RUNTIME_FILES) {
    const actual = sha256(readTreeFile(file.path));
    if (actual !== file.sha256) throw new Error(`legacy runtime file changed: ${file.path}`);
  }
  const generator = await loadLegacyGenerator();
  const days: Array<{
    canonicalSha256: string;
    fortuneDate: string;
    modules: DraftModules;
  }> = [];
  let fortuneDate = START_FORTUNE_DATE;
  for (let index = 0; index < DAY_COUNT; index += 1) {
    const modules = generator.generate(fortuneDate);
    const canonical = canonicalModulePair(modules);
    days.push({ canonicalSha256: canonical.canonicalSha256, fortuneDate, modules });
    fortuneDate = nextDate(fortuneDate);
  }
  const runtimeFingerprint = hashCanonicalValue({ files: RUNTIME_FILES });
  const sourceModuleManifestSha256 = hashCanonicalValue(
    Object.fromEntries(days.map((day) => [day.fortuneDate, day.canonicalSha256])),
  );
  const artifact = {
    canonicalizationVersion: CONTENT_PRODUCTION_REBASE_CANONICALIZATION_VERSION,
    days,
    provenance: {
      legacyBlobOidAggregate: LEGACY_BLOB_OID_AGGREGATE,
      legacyDemoBlob: LEGACY_DEMO_BLOB,
      legacyDemoFileSha256: RUNTIME_FILES.find((file) =>
        file.path.endsWith("demo-published-content.reader.ts"),
      )!.sha256,
      legacyGeneratorBlob: LEGACY_GENERATOR_BLOB,
      legacyGeneratorFileSha256: RUNTIME_FILES.find((file) =>
        file.path.endsWith("deterministic-draft.generator.ts"),
      )!.sha256,
      runtimeFiles: RUNTIME_FILES,
      runtimeFingerprint,
      sourceBuildId: SOURCE_TREE,
      sourceTree: SOURCE_TREE,
    },
    schemaVersion: "five-content-production-legacy-source-v1",
    sourceModuleManifestSha256,
  };
  parseLegacyProductionSourceAllowlist(artifact, { expectedDayCount: DAY_COUNT });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  process.stdout.write(
    `${JSON.stringify({
      dayCount: DAY_COUNT,
      endFortuneDate: days.at(-1)!.fortuneDate,
      outputPath,
      runtimeFingerprint,
      sourceModuleManifestSha256,
      startFortuneDate: START_FORTUNE_DATE,
    })}\n`,
  );
}

const outputFlag = process.argv.indexOf("--output");
const outputValue = outputFlag === -1 ? undefined : process.argv[outputFlag + 1];
if (outputValue === undefined || outputValue.startsWith("--")) {
  throw new Error("Usage: generate-legacy-production-source-allowlist.ts --output <new-file>");
}

void generate(resolve(outputValue)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown failure";
  process.stderr.write(`Legacy source allowlist generation failed: ${message}\n`);
  process.exitCode = 1;
});
