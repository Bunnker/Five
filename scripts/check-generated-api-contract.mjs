#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = join(repositoryRoot, "docs/api/openapi.yaml");
const checkedInPath = join(repositoryRoot, "packages/api-contract/src/generated.ts");

async function main() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "five-api-contract-"));
  const generatedPath = join(temporaryDirectory, "generated.ts");
  try {
    const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const { stderr, stdout } = await execFileAsync(
      executable,
      ["exec", "openapi-typescript", contractPath, "-o", generatedPath],
      { cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024 },
    );
    if (stdout !== "") process.stdout.write(stdout);
    if (stderr !== "") process.stderr.write(stderr);

    const [checkedIn, generated] = await Promise.all([
      readFile(checkedInPath),
      readFile(generatedPath),
    ]);
    if (!checkedIn.equals(generated)) {
      process.stderr.write(
        "Generated API contract types are stale. Run `pnpm contract:generate` and review the result.\n",
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write("Generated API contract types match docs/api/openapi.yaml.\n");
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Unable to verify generated API contract types: ${message}\n`);
  process.exitCode = 1;
});
