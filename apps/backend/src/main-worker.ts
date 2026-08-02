import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { DATABASE_PROBE, type DatabaseProbe } from "./database/database-probe";
import { PublicCachePurgeWorker } from "./content-release/public-cache-purge.worker";
import { ContentReleaseWorker } from "./content-release/content-release.worker";
import { ImageCachePurgeWorker } from "./daily-images/image-cache-purge.worker";
import { PosterWorker } from "./poster/poster-worker";
import { WorkerModule } from "./worker/worker.module";

function readInterval(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 ? parsed : 30_000;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const database = app.get<DatabaseProbe>(DATABASE_PROBE);
  const contentReleaseWorker = app.get(ContentReleaseWorker);
  const publicCachePurgeWorker = app.get(PublicCachePurgeWorker);
  const imageCachePurgeWorker = app.get(ImageCachePurgeWorker);
  const posterWorker = app.get(PosterWorker);

  await database.check();
  const [
    initialReleaseResult,
    initialCachePurgeResult,
    initialImageCachePurgeResult,
    initialPosterResult,
  ] = await Promise.all([
    contentReleaseWorker.runOne(),
    publicCachePurgeWorker.runOne(),
    imageCachePurgeWorker.runOne(),
    posterWorker.runOne(),
  ]);
  Logger.log(
    JSON.stringify({
      database: "reachable",
      service: "five-worker",
      status: "ready",
      contentReleaseWorker: initialReleaseResult,
      publicCachePurgeWorker: initialCachePurgeResult,
      imageCachePurgeWorker: initialImageCachePurgeResult,
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
    void Promise.all([
      database.check(),
      contentReleaseWorker.runOne(),
      publicCachePurgeWorker.runOne(),
      imageCachePurgeWorker.runOne(),
      posterWorker.runOne(),
    ])
      .then(([, releaseResult, cachePurgeResult, imageCachePurgeResult, posterResult]) =>
        Logger.log(
          `PostgreSQL is reachable; content release worker: ${releaseResult}; public cache purge worker: ${cachePurgeResult}; image cache purge worker: ${imageCachePurgeResult}; poster worker: ${posterResult}`,
          "Worker",
        ),
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
