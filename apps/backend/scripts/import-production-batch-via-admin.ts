import { isAbsolute, resolve } from "node:path";

import { importProductionBatchViaAdmin } from "./production-batch-admin-import";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const [batchRootValue, ledgerPathValue, ...extraArguments] = process.argv
    .slice(2)
    .filter((argument) => argument !== "--");
  if (extraArguments.length > 0 || batchRootValue === undefined || ledgerPathValue === undefined) {
    throw new Error("Usage: production-batch:import <absolute-batch-root> <absolute-ledger-path>");
  }
  if (!isAbsolute(batchRootValue) || !isAbsolute(ledgerPathValue)) {
    throw new Error("Batch root and ledger path must both be absolute paths");
  }
  const summary = await importProductionBatchViaAdmin({
    baseUrl: requiredEnvironment("FIVE_ADMIN_API_BASE_URL"),
    batchRoot: resolve(batchRootValue),
    confirmWorkerStopped: process.env.FIVE_BATCH_IMPORT_WORKER_STOPPED === "1",
    ledgerPath: resolve(ledgerPathValue),
    origin: requiredEnvironment("FIVE_ADMIN_ORIGIN"),
    password: requiredEnvironment("FIVE_ADMIN_PASSWORD"),
    username: requiredEnvironment("FIVE_ADMIN_USERNAME"),
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Unknown batch import error"}\n`,
  );
  process.exitCode = 1;
});
