import { Module } from "@nestjs/common";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { resolve } from "node:path";

import { DatabaseModule } from "../database/database.module";
import { DATABASE_POOL } from "../database/postgres-pool";
import { TodayModule } from "../today/today.module";
import {
  PUBLISHED_CONTENT_READER,
  type PublishedContentReader,
} from "../today/today-content.service";
import { PosterAssetController } from "./poster-asset.controller";
import {
  LocalPosterAssetStore,
  POSTER_ASSET_STORE,
  type PosterAssetStore,
} from "./poster-asset.store";
import { PosterJobController } from "./poster-job.controller";
import { POSTER_JOB_REPOSITORY, type PosterJobRepository } from "./poster-job.repository";
import { PosterJobService } from "./poster-job.service";
import { PostgresPosterJobRepository } from "./postgres-poster-job.repository";
import {
  FixedSvgPosterRenderer,
  POSTER_RENDERER,
  PublicWebPosterImageOriginPolicy,
  type PosterRenderer,
} from "./poster-renderer";
import { PosterWorker } from "./poster-worker";

function localAssetDirectory(): string {
  return process.env.FIVE_POSTER_ASSET_DIR ?? resolve(process.cwd(), ".five-assets", "posters");
}

function publicWebOrigin(): string {
  return process.env.FIVE_PUBLIC_WEB_ORIGIN ?? "http://127.0.0.1:3000";
}

function assetOrigin(): string {
  return (
    process.env.FIVE_POSTER_ASSET_ORIGIN ??
    new URL("/api/v1/poster-assets/", publicWebOrigin()).toString()
  );
}

function queueCapacity(): number {
  const parsed = Number(process.env.FIVE_POSTER_QUEUE_CAPACITY);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10_000 ? parsed : 100;
}

function publicAssetAllowedOrigins(): string[] {
  const configured = process.env.FIVE_PUBLIC_ASSET_ALLOWED_ORIGINS;
  if (configured === undefined || configured.trim().length === 0) {
    return [];
  }
  const origins = configured.split(",").map((origin) => origin.trim());
  if (origins.some((origin) => origin.length === 0)) {
    throw new Error("FIVE_PUBLIC_ASSET_ALLOWED_ORIGINS must be a comma-separated origin list");
  }
  return origins;
}

function workerInstanceId(): string {
  const configured = process.env.FIVE_WORKER_INSTANCE_ID;
  let instanceScope: string;
  if (configured !== undefined) {
    if (
      configured.length < 1 ||
      configured.length > 64 ||
      configured.trim() !== configured ||
      Array.from(configured).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f;
      })
    ) {
      throw new Error("FIVE_WORKER_INSTANCE_ID must be an opaque value between 1 and 64 chars");
    }
    instanceScope = configured;
  } else {
    instanceScope = hostname().slice(0, 48);
  }
  // The random boot suffix prevents PID collisions across hosts and rolling deployments.
  return `poster-worker-${instanceScope}-${process.pid}-${randomUUID()}`;
}

@Module({
  controllers: [PosterAssetController, PosterJobController],
  exports: [PosterWorker],
  imports: [DatabaseModule, TodayModule],
  providers: [
    {
      inject: [DATABASE_POOL],
      provide: POSTER_JOB_REPOSITORY,
      useFactory: (pool: Pool): PosterJobRepository =>
        new PostgresPosterJobRepository(pool, queueCapacity()),
    },
    {
      provide: POSTER_ASSET_STORE,
      useFactory: (): PosterAssetStore => new LocalPosterAssetStore(localAssetDirectory()),
    },
    {
      provide: POSTER_RENDERER,
      useFactory: (): PosterRenderer =>
        new FixedSvgPosterRenderer(
          undefined,
          new PublicWebPosterImageOriginPolicy(publicWebOrigin(), publicAssetAllowedOrigins()),
        ),
    },
    {
      inject: [POSTER_JOB_REPOSITORY, PUBLISHED_CONTENT_READER],
      provide: PosterJobService,
      useFactory: (
        repository: PosterJobRepository,
        publishedContentReader: PublishedContentReader,
      ) => new PosterJobService(repository, publishedContentReader, undefined, publicWebOrigin()),
    },
    {
      inject: [
        POSTER_JOB_REPOSITORY,
        PUBLISHED_CONTENT_READER,
        POSTER_RENDERER,
        POSTER_ASSET_STORE,
      ],
      provide: PosterWorker,
      useFactory: (
        repository: PosterJobRepository,
        publishedContentReader: PublishedContentReader,
        renderer: PosterRenderer,
        posterAssetStore: PosterAssetStore,
      ) =>
        new PosterWorker(
          repository,
          publishedContentReader,
          renderer,
          posterAssetStore,
          assetOrigin(),
          workerInstanceId(),
        ),
    },
  ],
})
export class PosterModule {}
