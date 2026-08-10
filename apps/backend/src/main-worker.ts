import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { DATABASE_PROBE, type DatabaseProbe } from "./database/database-probe";
import { ContentReleaseBoundaryWakeup } from "./content-release/content-release-boundary-wakeup";
import { ContentReleaseRetryWakeup } from "./content-release/content-release-retry-wakeup";
import { PublicCachePurgeWorker } from "./content-release/public-cache-purge.worker";
import { ContentReleaseWorker } from "./content-release/content-release.worker";
import { ImageCachePurgeWorker } from "./daily-images/image-cache-purge.worker";
import { ContentProductionWorker } from "./content-production/content-production.worker";
import { ContentImageProductionWorker } from "./content-production/content-image-production.worker";
import { ContentAutoPublicationWorker } from "./content-production/content-auto-publication.worker";
import { DayCorrectionImageWorker } from "./day-correction/day-correction-image.worker";
import { PosterWorker } from "./poster/poster-worker";
import { AnalyticsRetentionWorker } from "./product-analytics/analytics-retention.worker";
import { WorkerModule } from "./worker/worker.module";
import {
  createWorkerCycleRunner,
  settleWorkerTasks,
  type WorkerCycleTask,
  type WorkerCycleTaskOutcome,
} from "./worker/worker-cycle-runner";

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
  const contentProductionWorker = app.get(ContentProductionWorker);
  const contentImageProductionWorker = app.get(ContentImageProductionWorker);
  const contentAutoPublicationWorker = app.get(ContentAutoPublicationWorker);
  const dayCorrectionImageWorker = app.get(DayCorrectionImageWorker);
  const analyticsRetentionWorker = app.get(AnalyticsRetentionWorker);
  const runContinuously = process.env.WORKER_ONCE !== "1";
  const contentReleaseBoundaryWakeup = new ContentReleaseBoundaryWakeup(contentReleaseWorker, {
    onError: (error) => Logger.error(error, "Content release boundary wakeup failed", "Worker"),
  });
  const contentReleaseRetryWakeup = new ContentReleaseRetryWakeup(contentReleaseWorker, {
    onError: (error) => Logger.error(error, "Content release retry wakeup failed", "Worker"),
  });
  let interval: ReturnType<typeof setInterval> | undefined;

  await database.check();
  if (runContinuously) {
    contentReleaseBoundaryWakeup.start();
    contentReleaseRetryWakeup.start();
  }

  const workerTasks: ReadonlyArray<WorkerCycleTask> = [
    { name: "contentReleaseWorker", run: () => contentReleaseWorker.runOne() },
    { name: "publicCachePurgeWorker", run: () => publicCachePurgeWorker.runOne() },
    { name: "imageCachePurgeWorker", run: () => imageCachePurgeWorker.runOne() },
    { name: "posterWorker", run: () => posterWorker.runOne() },
    { name: "contentProductionWorker", run: () => contentProductionWorker.runWindow() },
    {
      name: "contentImageProductionWorker",
      run: () => contentImageProductionWorker.runOne(),
    },
    {
      name: "contentAutoPublicationWorker",
      run: () => contentAutoPublicationWorker.runWindow(),
    },
    { name: "dayCorrectionImageWorker", run: () => dayCorrectionImageWorker.runOne() },
    { name: "analyticsRetentionWorker", run: () => analyticsRetentionWorker.runOne() },
  ];
  const logTaskFailure = ({
    error,
    taskName,
  }: {
    readonly error: unknown;
    readonly taskName: string;
  }) => Logger.error(error, `${taskName} failed`, "Worker");
  const outcomeValues = (outcomes: ReadonlyArray<WorkerCycleTaskOutcome>) =>
    Object.fromEntries(
      outcomes.map((outcome) => [
        outcome.taskName,
        outcome.status === "fulfilled" ? outcome.value : "failed",
      ]),
    );

  try {
    const initialOutcomes = await settleWorkerTasks(workerTasks, {
      onTaskFailure: logTaskFailure,
    });
    const initialFailed = initialOutcomes.some((outcome) => outcome.status === "rejected");
    Logger.log(
      JSON.stringify({
        database: "reachable",
        service: "five-worker",
        status: initialFailed ? "degraded" : "ready",
        ...outcomeValues(initialOutcomes),
      }),
      "Worker",
    );

    if (!runContinuously) {
      if (initialFailed) throw new Error("One or more one-shot Worker tasks failed");
      return;
    }

    const workerCycle = createWorkerCycleRunner(
      [{ name: "database", run: () => database.check() }, ...workerTasks],
      {
        onCycleSettled: (outcomes) =>
          Logger.log(`Worker cycle settled: ${JSON.stringify(outcomeValues(outcomes))}`, "Worker"),
        onTaskFailure: logTaskFailure,
      },
    );
    interval = setInterval(() => {
      void workerCycle
        .run()
        .catch((error: unknown) =>
          Logger.error(error, "Worker cycle supervision failed", "Worker"),
        );
    }, readInterval(process.env.WORKER_POLL_INTERVAL_MS));

    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } finally {
    if (interval !== undefined) clearInterval(interval);
    contentReleaseBoundaryWakeup.stop();
    contentReleaseRetryWakeup.stop();
    await app.close();
  }
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, "Five Worker failed to start", "Worker");
  process.exitCode = 1;
});
