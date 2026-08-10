import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { URL } from "node:url";

import pg from "pg";

const { Client } = pg;
const databaseName = `five_integration_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const productionDatabaseName = `five_prod_test_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const createdDatabaseNames = new Set();
let activeChild = null;
let baseUrlForCleanup = null;
let cleanupPromise = null;
let receivedSignal = null;
let setupPromise = Promise.resolve();

function checkedDatabaseUrl(value) {
  if (value === undefined || value.trim().length === 0) {
    throw new Error("DATABASE_URL is required for the PostgreSQL integration check");
  }
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }
  return url;
}

function run(args, environment) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(pnpm, args, {
      env: {
        ...process.env,
        ...environment,
      },
      stdio: "inherit",
    });
    activeChild = child;
    child.once("error", (error) => {
      if (activeChild === child) {
        activeChild = null;
      }
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      if (activeChild === child) {
        activeChild = null;
      }
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(
        new Error(
          `PostgreSQL integration check command exited with code ${code ?? "none"} and signal ${signal ?? "none"}`,
        ),
      );
    });
  });
}

function signalExitCode(signal) {
  return signal === "SIGINT" ? 130 : 143;
}

async function dropDisposableDatabase(baseUrl, targetDatabaseName) {
  const client = new Client({ connectionString: baseUrl.toString() });
  await client.connect();
  try {
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [targetDatabaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${targetDatabaseName}" WITH (FORCE)`);
    createdDatabaseNames.delete(targetDatabaseName);
  } finally {
    await client.end();
  }
}

function cleanupDisposableDatabase() {
  if (cleanupPromise !== null) {
    return cleanupPromise;
  }
  if (baseUrlForCleanup === null) {
    return Promise.resolve();
  }
  cleanupPromise = (async () => {
    for (const targetDatabaseName of [...createdDatabaseNames]) {
      await dropDisposableDatabase(baseUrlForCleanup, targetDatabaseName);
    }
  })();
  return cleanupPromise;
}

function assertNotInterrupted() {
  if (receivedSignal !== null) {
    throw new Error(`PostgreSQL integration check interrupted by ${receivedSignal}`);
  }
}

function handleSignal(signal) {
  if (receivedSignal !== null) {
    return;
  }
  receivedSignal = signal;
  activeChild?.kill("SIGTERM");
  void setupPromise
    .catch(() => undefined)
    .then(() => cleanupDisposableDatabase())
    .then(
      () => process.exit(signalExitCode(signal)),
      () => {
        process.stderr.write("PostgreSQL integration check cleanup failed after interruption.\n");
        process.exit(1);
      },
    );
}

process.once("SIGINT", () => handleSignal("SIGINT"));
process.once("SIGTERM", () => handleSignal("SIGTERM"));

async function createDisposableDatabase(baseUrl, targetDatabaseName) {
  const client = new Client({ connectionString: baseUrl.toString() });
  try {
    await client.connect();
    await client.query(`CREATE DATABASE "${targetDatabaseName}"`);
    createdDatabaseNames.add(targetDatabaseName);
  } finally {
    await client.end();
  }
}

async function main() {
  const baseUrl = checkedDatabaseUrl(process.env.DATABASE_URL);
  baseUrlForCleanup = baseUrl;
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${databaseName}`;

  try {
    setupPromise = createDisposableDatabase(baseUrl, databaseName);
    await setupPromise;
    assertNotInterrupted();
    await run(["--filter", "@five/backend", "exec", "node-pg-migrate", "-j", "mts", "up"], {
      DATABASE_URL: testUrl.toString(),
    });
    // This test intentionally rolls the migration chain back to 000005. Run it
    // before repository tests create valid password-only administrator rows,
    // which 000014 must refuse to convert back into legacy TOTP accounts.
    await run(
      [
        "--filter",
        "@five/backend",
        "exec",
        "vitest",
        "run",
        "src/daily-images/postgres-daily-image-migration.integration.test.ts",
      ],
      {
        FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL: testUrl.toString(),
      },
    );
    await run(
      [
        "--filter",
        "@five/backend",
        "exec",
        "vitest",
        "run",
        "src/public-content/public-content-18h-migration.integration.test.ts",
      ],
      {
        FIVE_PUBLIC_WINDOW_MIGRATION_TEST_DATABASE_URL: testUrl.toString(),
      },
    );
    await run(
      [
        "--filter",
        "@five/backend",
        "exec",
        "vitest",
        "run",
        "--no-file-parallelism",
        "src/content-release/postgres-content-release-migration.integration.test.ts",
        "src/content-release/postgres-content-release.store.integration.test.ts",
        "src/content-release/content-release-public-flow.integration.test.ts",
      ],
      {
        FIVE_CONTENT_RELEASE_TEST_DATABASE_URL: testUrl.toString(),
      },
    );
    await run(
      [
        "--filter",
        "@five/backend",
        "exec",
        "vitest",
        "run",
        "src/poster/postgres-poster-job.repository.integration.test.ts",
        "src/feedback/postgres-feedback-report.repository.integration.test.ts",
        "src/admin-auth/postgres-admin-security.store.integration.test.ts",
        "src/admin-operations/postgres-admin-operations.store.integration.test.ts",
        "src/content-lifecycle/postgres-content-lifecycle.store.integration.test.ts",
        "src/daily-images/postgres-daily-image-assets.integration.test.ts",
        "src/product-analytics/postgres-analytics-event.repository.integration.test.ts",
      ],
      {
        FIVE_FEEDBACK_TEST_DATABASE_URL: testUrl.toString(),
        FIVE_ADMIN_SECURITY_TEST_DATABASE_URL: testUrl.toString(),
        FIVE_POSTER_TEST_DATABASE_URL: testUrl.toString(),
        FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL: testUrl.toString(),
        FIVE_ANALYTICS_TEST_DATABASE_URL: testUrl.toString(),
      },
    );
    // The production-current suite intentionally leaves historical production rows behind and
    // expects an otherwise empty business database. Give it a separately migrated disposable
    // database so neither it nor the shared repository suites can contaminate the other.
    const productionTestUrl = new URL(baseUrl);
    productionTestUrl.pathname = `/${productionDatabaseName}`;
    await createDisposableDatabase(baseUrl, productionDatabaseName);
    await run(["--filter", "@five/backend", "exec", "node-pg-migrate", "-j", "mts", "up"], {
      DATABASE_URL: productionTestUrl.toString(),
    });
    await run(
      [
        "--filter",
        "@five/backend",
        "exec",
        "vitest",
        "run",
        "--no-file-parallelism",
        "src/content-production/postgres-content-production-current.integration.test.ts",
      ],
      {
        FIVE_CONTENT_LIFECYCLE_TEST_DATABASE_URL: productionTestUrl.toString(),
      },
    );
    await dropDisposableDatabase(baseUrl, productionDatabaseName);
    assertNotInterrupted();
    process.stdout.write(
      "Poster, feedback, admin-security, content-lifecycle, daily-image, content-release, and anonymous-analytics PostgreSQL integration checks passed in an isolated disposable database.\n",
    );
  } finally {
    await cleanupDisposableDatabase();
  }
}

try {
  await main();
} catch (error) {
  if (receivedSignal === null) {
    throw error;
  }
}
