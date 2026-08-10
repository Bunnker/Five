import { Module } from "@nestjs/common";
import type { Pool } from "pg";

import { ContentReleaseService } from "../content-release/content-release.service";
import { CONTENT_RELEASE_STORE } from "../content-release/content-release.store";
import { ContentReleaseWorker } from "../content-release/content-release.worker";
import { publicCachePurgerFromEnvironment } from "../content-release/http-public-cache-purger";
import { PostgresContentReleaseStore } from "../content-release/postgres-content-release.store";
import {
  PUBLIC_CACHE_PURGER,
  PublicCachePurgeWorker,
  type PublicCachePurger,
} from "../content-release/public-cache-purge.worker";
import { DatabaseModule } from "../database/database.module";
import { DATABASE_POOL } from "../database/postgres-pool";
import { PostgresContentLifecycleStore } from "../content-lifecycle/postgres-content-lifecycle.store";
import { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { ContentAutoPublicationWorker } from "../content-production/content-auto-publication.worker";
import { AutomaticContentProductionService } from "../content-production/content-production.service";
import { CONTENT_PRODUCTION_STORE } from "../content-production/content-production.store";
import { PostgresContentProductionStore } from "../content-production/postgres-content-production.store";
import { ContentProductionWorker } from "../content-production/content-production.worker";
import { ContentImageProductionWorker } from "../content-production/content-image-production.worker";
import { DailyImageCandidateUploader } from "../content-production/daily-image-candidate.uploader";
import { openAiImageGeneratorFromEnvironment } from "../content-production/openai-image.generator";
import { ImageCachePurgeWorker } from "../daily-images/image-cache-purge.worker";
import { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import { LocalBinaryImageAssetStore } from "../daily-images/local-binary-image-asset.store";
import {
  IMAGE_CACHE_PURGE_STORE,
  type ImageCachePurgeStore,
} from "../daily-images/image-cache-purge.store";
import { PosterModule } from "../poster/poster.module";
import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { PublicContentModule } from "../public-content/public-content.module";
import { DayCorrectionImageWorker } from "../day-correction/day-correction-image.worker";
import { PostgresDayCorrectionImageJobStore } from "../day-correction/postgres-day-correction-image-job.store";
import { PostgresDayCorrectionStore } from "../day-correction/postgres-day-correction.store";
import { RequestContextModule } from "../request-context/request-context.module";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import { SystemClock } from "../request-context/system-clock";
import { ProductAnalyticsModule } from "../product-analytics/product-analytics.module";

const IMAGE_GENERATOR = Symbol("IMAGE_GENERATOR");

@Module({
  imports: [
    DatabaseModule,
    PosterModule,
    ProductAnalyticsModule,
    PublicContentModule,
    RequestContextModule,
  ],
  providers: [
    SystemClock,
    {
      inject: [DATABASE_POOL],
      provide: CONTENT_RELEASE_STORE,
      useFactory: (pool: Pool) => new PostgresContentReleaseStore(pool),
    },
    {
      inject: [DATABASE_POOL],
      provide: PostgresContentLifecycleStore,
      useFactory: (pool: Pool) => new PostgresContentLifecycleStore(pool),
    },
    {
      inject: [PostgresContentLifecycleStore, SystemClock],
      provide: ContentLifecycleService,
      useFactory: (store: PostgresContentLifecycleStore, clock: SystemClock) =>
        new ContentLifecycleService(store, clock),
    },
    { provide: IMAGE_CACHE_PURGE_STORE, useExisting: PostgresContentLifecycleStore },
    {
      inject: [DATABASE_POOL],
      provide: CONTENT_PRODUCTION_STORE,
      useFactory: (pool: Pool) => new PostgresContentProductionStore(pool),
    },
    {
      inject: [CONTENT_PRODUCTION_STORE, SystemClock],
      provide: AutomaticContentProductionService,
      useFactory: (store: PostgresContentProductionStore, clock: SystemClock) =>
        new AutomaticContentProductionService(store, clock),
    },
    {
      inject: [
        AutomaticContentProductionService,
        RequestContextResolver,
        PublicContentContextResolver,
      ],
      provide: ContentProductionWorker,
      useFactory: (
        service: AutomaticContentProductionService,
        resolver: RequestContextResolver,
        publicContentContextResolver: PublicContentContextResolver,
      ) => new ContentProductionWorker(service, resolver, publicContentContextResolver),
    },
    { provide: LocalBinaryImageAssetStore, useFactory: () => new LocalBinaryImageAssetStore() },
    {
      inject: [PostgresContentLifecycleStore, LocalBinaryImageAssetStore, SystemClock],
      provide: DailyImageAssetService,
      useFactory: (
        store: PostgresContentLifecycleStore,
        binaryStore: LocalBinaryImageAssetStore,
        clock: SystemClock,
      ) =>
        new DailyImageAssetService(
          store,
          binaryStore,
          clock,
          undefined,
          process.env.FIVE_PUBLIC_ASSET_BASE_URL ?? null,
        ),
    },
    {
      inject: [DailyImageAssetService, SystemClock],
      provide: DailyImageCandidateUploader,
      useFactory: (service: DailyImageAssetService, clock: SystemClock) =>
        new DailyImageCandidateUploader(service, clock),
    },
    { provide: IMAGE_GENERATOR, useFactory: () => openAiImageGeneratorFromEnvironment() },
    {
      inject: [CONTENT_PRODUCTION_STORE, IMAGE_GENERATOR, DailyImageCandidateUploader, SystemClock],
      provide: ContentImageProductionWorker,
      useFactory: (
        store: PostgresContentProductionStore,
        generator: ReturnType<typeof openAiImageGeneratorFromEnvironment>,
        uploader: DailyImageCandidateUploader,
        clock: SystemClock,
      ) => new ContentImageProductionWorker(store, generator, uploader, clock),
    },
    {
      inject: [DATABASE_POOL],
      provide: PostgresDayCorrectionImageJobStore,
      useFactory: (pool: Pool) => new PostgresDayCorrectionImageJobStore(pool),
    },
    {
      inject: [DATABASE_POOL],
      provide: PostgresDayCorrectionStore,
      useFactory: (pool: Pool) => new PostgresDayCorrectionStore(pool),
    },
    {
      inject: [
        PostgresDayCorrectionImageJobStore,
        IMAGE_GENERATOR,
        DailyImageCandidateUploader,
        SystemClock,
      ],
      provide: DayCorrectionImageWorker,
      useFactory: (
        store: PostgresDayCorrectionImageJobStore,
        generator: ReturnType<typeof openAiImageGeneratorFromEnvironment>,
        uploader: DailyImageCandidateUploader,
        clock: SystemClock,
      ) => new DayCorrectionImageWorker(store, generator, uploader, clock),
    },
    {
      inject: [CONTENT_RELEASE_STORE, SystemClock],
      provide: ContentReleaseService,
      useFactory: (store: PostgresContentReleaseStore, clock: SystemClock) =>
        new ContentReleaseService(store, clock),
    },
    {
      inject: [CONTENT_RELEASE_STORE, ContentReleaseService, SystemClock],
      provide: ContentReleaseWorker,
      useFactory: (
        store: PostgresContentReleaseStore,
        service: ContentReleaseService,
        clock: SystemClock,
      ) => new ContentReleaseWorker(store, service, clock),
    },
    {
      inject: [
        PostgresContentLifecycleStore,
        ContentLifecycleService,
        ContentReleaseService,
        CONTENT_RELEASE_STORE,
        AutomaticContentProductionService,
        SystemClock,
        PostgresDayCorrectionStore,
        PublicContentContextResolver,
      ],
      provide: ContentAutoPublicationWorker,
      useFactory: (
        store: PostgresContentLifecycleStore,
        lifecycle: ContentLifecycleService,
        release: ContentReleaseService,
        releaseStore: PostgresContentReleaseStore,
        production: AutomaticContentProductionService,
        clock: SystemClock,
        correctionStore: PostgresDayCorrectionStore,
        publicContentContextResolver: PublicContentContextResolver,
      ) =>
        new ContentAutoPublicationWorker(
          store,
          lifecycle,
          release,
          releaseStore,
          production,
          clock,
          correctionStore,
          publicContentContextResolver,
        ),
    },
    {
      provide: PUBLIC_CACHE_PURGER,
      useFactory: () => publicCachePurgerFromEnvironment(),
    },
    {
      inject: [CONTENT_RELEASE_STORE, PUBLIC_CACHE_PURGER, SystemClock],
      provide: PublicCachePurgeWorker,
      useFactory: (
        store: PostgresContentReleaseStore,
        purger: PublicCachePurger,
        clock: SystemClock,
      ) => new PublicCachePurgeWorker(store, purger, clock),
    },
    {
      inject: [IMAGE_CACHE_PURGE_STORE, PUBLIC_CACHE_PURGER, SystemClock],
      provide: ImageCachePurgeWorker,
      useFactory: (store: ImageCachePurgeStore, purger: PublicCachePurger, clock: SystemClock) =>
        new ImageCachePurgeWorker(store, purger, clock),
    },
  ],
})
export class WorkerModule {}
