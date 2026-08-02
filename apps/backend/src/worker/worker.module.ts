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
import { ImageCachePurgeWorker } from "../daily-images/image-cache-purge.worker";
import {
  IMAGE_CACHE_PURGE_STORE,
  type ImageCachePurgeStore,
} from "../daily-images/image-cache-purge.store";
import { PosterModule } from "../poster/poster.module";
import { RequestContextModule } from "../request-context/request-context.module";
import { SystemClock } from "../request-context/system-clock";

@Module({
  imports: [DatabaseModule, PosterModule, RequestContextModule],
  providers: [
    SystemClock,
    {
      inject: [DATABASE_POOL],
      provide: CONTENT_RELEASE_STORE,
      useFactory: (pool: Pool) => new PostgresContentReleaseStore(pool),
    },
    {
      inject: [DATABASE_POOL],
      provide: IMAGE_CACHE_PURGE_STORE,
      useFactory: (pool: Pool) => new PostgresContentLifecycleStore(pool),
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
