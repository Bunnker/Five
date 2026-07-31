import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { URL } from "node:url";

import pg from "pg";

const { Client } = pg;
const databaseName = `five_integration_test_${process.pid}_${randomUUID().replaceAll("-", "")}`;
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
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

async function dropDisposableDatabase(baseUrl) {
  const client = new Client({ connectionString: baseUrl.toString() });
  await client.connect();
  try {
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
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
  cleanupPromise = dropDisposableDatabase(baseUrlForCleanup);
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

async function createDisposableDatabase(baseUrl) {
  const client = new Client({ connectionString: baseUrl.toString() });
  try {
    await client.connect();
    await client.query(`CREATE DATABASE "${databaseName}"`);
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
    setupPromise = createDisposableDatabase(baseUrl);
    await setupPromise;
    assertNotInterrupted();
    await run(["--filter", "@five/backend", "exec", "node-pg-migrate", "-j", "mts", "up"], {
      DATABASE_URL: testUrl.toString(),
    });
    await run(
      [
        "--filter",
        "@five/backend",
        "exec",
        "vitest",
        "run",
        "src/poster/postgres-poster-job.repository.integration.test.ts",
        "src/feedback/postgres-feedback-report.repository.integration.test.ts",
      ],
      {
        FIVE_FEEDBACK_TEST_DATABASE_URL: testUrl.toString(),
        FIVE_POSTER_TEST_DATABASE_URL: testUrl.toString(),
      },
    );
    assertNotInterrupted();
    process.stdout.write(
      "Poster and feedback PostgreSQL integration checks passed in an isolated disposable database.\n",
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
