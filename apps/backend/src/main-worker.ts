import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { DATABASE_PROBE, type DatabaseProbe } from "./database/database-probe";
import { WorkerModule } from "./worker/worker.module";

function readInterval(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 ? parsed : 30_000;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const database = app.get<DatabaseProbe>(DATABASE_PROBE);

  await database.check();
  Logger.log(
    JSON.stringify({
      database: "reachable",
      service: "five-worker",
      status: "ready",
    }),
    "Worker",
  );

  if (process.env.WORKER_ONCE === "1") {
    await app.close();
    return;
  }

  const interval = setInterval(() => {
    void database
      .check()
      .then(() => Logger.log("PostgreSQL is reachable", "Worker"))
      .catch((error: unknown) => Logger.error(error, "Worker database check failed", "Worker"));
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
