import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { DATABASE_PROBE, type DatabaseProbe } from "./database/database-probe";
import { PosterWorker } from "./poster/poster-worker";
import { WorkerModule } from "./worker/worker.module";

function readInterval(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 ? parsed : 30_000;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const database = app.get<DatabaseProbe>(DATABASE_PROBE);
  const posterWorker = app.get(PosterWorker);

  await database.check();
  const initialPosterResult = await posterWorker.runOne();
  Logger.log(
    JSON.stringify({
      database: "reachable",
      service: "five-worker",
      status: "ready",
      posterWorker: initialPosterResult,
    }),
    "Worker",
  );

  if (process.env.WORKER_ONCE === "1") {
    await app.close();
    return;
  }

  let cycleRunning = false;
  const interval = setInterval(() => {
    if (cycleRunning) {
      return;
    }
    cycleRunning = true;
    void Promise.all([database.check(), posterWorker.runOne()])
      .then(([, posterResult]) =>
        Logger.log(`PostgreSQL is reachable; poster worker: ${posterResult}`, "Worker"),
      )
      .catch((error: unknown) => Logger.error(error, "Worker cycle failed", "Worker"))
      .finally(() => {
        cycleRunning = false;
      });
  }, readInterval(process.env.WORKER_POLL_INTERVAL_MS));

  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });

  clearInterval(interval);
  await app.close();
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, "Five Worker failed to start", "Worker");
  process.exitCode = 1;
});
