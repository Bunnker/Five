import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const running = [];

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: {
      ...process.env,
      ...options.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  running.push(child);
  return child;
}

async function waitForUrl(url, validate, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok && (await validate(response))) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }

  throw lastError ?? new Error(`${url} did not become ready`);
}

function waitForExit(child, timeoutMs = 30_000) {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(
      () => rejectExit(new Error("Process did not exit in time")),
      timeoutMs,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolveExit();
        return;
      }
      rejectExit(
        new Error(`Process exited with code ${code ?? "none"} and signal ${signal ?? "none"}`),
      );
    });
  });
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

const backendDist = resolve(root, "apps/backend/dist");
const webDirectory = resolve(root, "apps/web");
const nextCli = resolve(root, "apps/web/node_modules/next/dist/bin/next");

try {
  start("http", process.execPath, [resolve(backendDist, "main-http.js")]);
  start("web", process.execPath, [nextCli, "start", "--port", "3000"], {
    cwd: webDirectory,
  });

  await Promise.all([
    waitForUrl("http://127.0.0.1:3100/health/ready", async (response) => {
      const payload = await response.json();
      return payload.status === "ready" && payload.database === "reachable";
    }),
    waitForUrl("http://127.0.0.1:3000", async (response) => {
      const html = await response.text();
      return html.includes("每日五行搭配参考");
    }),
  ]);

  const worker = start("worker", process.execPath, [resolve(backendDist, "main-worker.js")], {
    env: {
      WORKER_ONCE: "1",
    },
  });
  await waitForExit(worker);

  console.log("Smoke check passed: web, HTTP, Worker and PostgreSQL are ready.");
} finally {
  await Promise.all(running.map((child) => stop(child)));
}
