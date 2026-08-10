import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import type { Pool } from "pg";

import { adminSecurityCryptoFromEnvironment } from "../admin-auth/admin-auth.configuration";
import { NodeScryptPasswordHasher, SystemAdminAuthRandom } from "../admin-auth/admin-auth.crypto";
import { AdminAuthService, EmergencyControlService } from "../admin-auth/admin-auth.service";
import { PostgresAdminSecurityStore } from "../admin-auth/postgres-admin-security.store";
import { AdminOperationsService } from "../admin-operations/admin-operations.service";
import { AdminOperationsDateResolver } from "../admin-operations/admin-operations-date.resolver";
import { PostgresAdminOperationsStore } from "../admin-operations/postgres-admin-operations.store";
import { CalendarRuleEngine } from "../calendar/calendar-rule-engine";
import { ContentLifecycleService } from "../content-lifecycle/content-lifecycle.service";
import { CONTENT_LIFECYCLE_STORE } from "../content-lifecycle/content-lifecycle.store";
import { PostgresContentLifecycleStore } from "../content-lifecycle/postgres-content-lifecycle.store";
import { AutomaticContentProductionService } from "../content-production/content-production.service";
import { CONTENT_PRODUCTION_STORE } from "../content-production/content-production.store";
import { PostgresContentProductionStore } from "../content-production/postgres-content-production.store";
import { ContentReleaseService } from "../content-release/content-release.service";
import { CONTENT_RELEASE_STORE } from "../content-release/content-release.store";
import { PostgresContentReleaseStore } from "../content-release/postgres-content-release.store";
import { DailyImageAssetService } from "../daily-images/daily-image-asset.service";
import { LocalBinaryImageAssetStore } from "../daily-images/local-binary-image-asset.store";
import { DayCorrectionWorkflow } from "../day-correction/day-correction.workflow";
import { DayCorrectionImageJobService } from "../day-correction/day-correction-image-job.service";
import { DayCorrectionImageWorkflow } from "../day-correction/day-correction-image.workflow";
import { ExistingContentDayCorrectionPort } from "../day-correction/existing-content-day-correction.port";
import { PostgresCorrectionImageLibrary } from "../day-correction/postgres-correction-image-library";
import { PostgresDayCorrectionImageActionIdempotencyStore } from "../day-correction/postgres-day-correction-image-action-idempotency.store";
import { PostgresDayCorrectionImageJobStore } from "../day-correction/postgres-day-correction-image-job.store";
import { PostgresDayCorrectionStore } from "../day-correction/postgres-day-correction.store";
import { DatabaseModule } from "../database/database.module";
import { DATABASE_POOL } from "../database/postgres-pool";
import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import { SystemClock } from "../request-context/system-clock";
import { ProductAnalyticsModule } from "../product-analytics/product-analytics.module";
import { AdminAnalyticsController } from "./admin-analytics.controller";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminContentController } from "./admin-content.controller";
import { AdminDayCorrectionController } from "./admin-day-correction.controller";
import { AdminDayCorrectionImageController } from "./admin-day-correction-image.controller";
import { AdminOperationsController } from "./admin-operations.controller";
import { AdminHttpExceptionFilter } from "./admin-http-exception.filter";
import { AdminImageController } from "./admin-image.controller";
import {
  ADMIN_AUTH_SERVICE,
  ADMIN_OPERATIONS_SERVICE,
  CONTENT_LIFECYCLE_SERVICE,
  CONTENT_PRODUCTION_SERVICE,
  CONTENT_RELEASE_SERVICE,
  DAILY_IMAGE_ASSET_SERVICE,
  DAY_CORRECTION_IMAGE_JOB_SERVICE,
  DAY_CORRECTION_IMAGE_WORKFLOW,
  DAY_CORRECTION_WORKFLOW,
  EMERGENCY_CONTROL_SERVICE,
} from "./admin-http.providers";
import { AdminSecurityController } from "./admin-security.controller";
import { PublicImageController } from "./public-image.controller";

const ADMIN_SECURITY_STORE = Symbol("ADMIN_SECURITY_STORE");
const ADMIN_SECURITY_CRYPTO = Symbol("ADMIN_SECURITY_CRYPTO");
const BINARY_IMAGE_ASSET_STORE = Symbol("BINARY_IMAGE_ASSET_STORE");
const DAY_CORRECTION_STORE = Symbol("DAY_CORRECTION_STORE");
const DAY_CORRECTION_CONTENT_PORT = Symbol("DAY_CORRECTION_CONTENT_PORT");

function runtimeAdminSecurityEnvironment(): NodeJS.ProcessEnv {
  if (process.env.NODE_ENV !== "test") {
    return process.env;
  }
  return {
    ...process.env,
    FIVE_ADMIN_HMAC_KEY_BASE64:
      process.env.FIVE_ADMIN_HMAC_KEY_BASE64 ?? Buffer.alloc(32, 0xa1).toString("base64"),
  };
}

@Module({
  controllers: [
    AdminAnalyticsController,
    AdminAuthController,
    AdminContentController,
    AdminDayCorrectionController,
    AdminDayCorrectionImageController,
    AdminImageController,
    AdminOperationsController,
    AdminSecurityController,
    PublicImageController,
  ],
  exports: [
    ADMIN_AUTH_SERVICE,
    ADMIN_OPERATIONS_SERVICE,
    CONTENT_LIFECYCLE_SERVICE,
    CONTENT_PRODUCTION_SERVICE,
    CONTENT_RELEASE_SERVICE,
    DAILY_IMAGE_ASSET_SERVICE,
    DAY_CORRECTION_IMAGE_JOB_SERVICE,
    DAY_CORRECTION_IMAGE_WORKFLOW,
    DAY_CORRECTION_WORKFLOW,
    EMERGENCY_CONTROL_SERVICE,
  ],
  imports: [DatabaseModule, ProductAnalyticsModule],
  providers: [
    PublicContentContextResolver,
    SystemClock,
    {
      inject: [SystemClock],
      provide: RequestContextResolver,
      useFactory: (clock: SystemClock) => new RequestContextResolver(clock),
    },
    CalendarRuleEngine,
    NodeScryptPasswordHasher,
    SystemAdminAuthRandom,
    { provide: BINARY_IMAGE_ASSET_STORE, useFactory: () => new LocalBinaryImageAssetStore() },
    {
      inject: [DATABASE_POOL],
      provide: ADMIN_SECURITY_STORE,
      useFactory: (pool: Pool) => new PostgresAdminSecurityStore(pool),
    },
    {
      inject: [DATABASE_POOL],
      provide: CONTENT_LIFECYCLE_STORE,
      useFactory: (pool: Pool) => new PostgresContentLifecycleStore(pool),
    },
    {
      inject: [DATABASE_POOL],
      provide: CONTENT_RELEASE_STORE,
      useFactory: (pool: Pool) => new PostgresContentReleaseStore(pool),
    },
    {
      inject: [DATABASE_POOL],
      provide: CONTENT_PRODUCTION_STORE,
      useFactory: (pool: Pool) => new PostgresContentProductionStore(pool),
    },
    {
      inject: [DATABASE_POOL, RequestContextResolver, CalendarRuleEngine],
      provide: ADMIN_OPERATIONS_SERVICE,
      useFactory: (
        pool: Pool,
        requestContextResolver: RequestContextResolver,
        calendarRuleEngine: CalendarRuleEngine,
      ) => {
        const dateResolver = new AdminOperationsDateResolver(requestContextResolver);
        return new AdminOperationsService(
          new PostgresAdminOperationsStore(pool, dateResolver),
          dateResolver,
          calendarRuleEngine,
        );
      },
    },
    {
      provide: ADMIN_SECURITY_CRYPTO,
      useFactory: () => adminSecurityCryptoFromEnvironment(runtimeAdminSecurityEnvironment()),
    },
    {
      inject: [
        ADMIN_SECURITY_STORE,
        NodeScryptPasswordHasher,
        ADMIN_SECURITY_CRYPTO,
        SystemAdminAuthRandom,
        SystemClock,
      ],
      provide: ADMIN_AUTH_SERVICE,
      useFactory: (
        store: PostgresAdminSecurityStore,
        passwordHasher: NodeScryptPasswordHasher,
        crypto: ReturnType<typeof adminSecurityCryptoFromEnvironment>,
        random: SystemAdminAuthRandom,
        clock: SystemClock,
      ) => new AdminAuthService(store, passwordHasher, crypto.digester, random, clock),
    },
    {
      inject: [ADMIN_SECURITY_STORE, SystemAdminAuthRandom, SystemClock, ADMIN_AUTH_SERVICE],
      provide: EMERGENCY_CONTROL_SERVICE,
      useFactory: (
        store: PostgresAdminSecurityStore,
        random: SystemAdminAuthRandom,
        clock: SystemClock,
        authService: AdminAuthService,
      ) => new EmergencyControlService(store, random, clock, authService),
    },
    {
      inject: [CONTENT_LIFECYCLE_STORE, SystemClock],
      provide: CONTENT_LIFECYCLE_SERVICE,
      useFactory: (store: PostgresContentLifecycleStore, clock: SystemClock) =>
        new ContentLifecycleService(store, clock),
    },
    {
      inject: [CONTENT_RELEASE_STORE, SystemClock],
      provide: CONTENT_RELEASE_SERVICE,
      useFactory: (store: PostgresContentReleaseStore, clock: SystemClock) =>
        new ContentReleaseService(store, clock),
    },
    {
      inject: [CONTENT_PRODUCTION_STORE, SystemClock],
      provide: CONTENT_PRODUCTION_SERVICE,
      useFactory: (store: PostgresContentProductionStore, clock: SystemClock) =>
        new AutomaticContentProductionService(store, clock),
    },
    {
      inject: [DATABASE_POOL],
      provide: DAY_CORRECTION_STORE,
      useFactory: (pool: Pool) => new PostgresDayCorrectionStore(pool),
    },
    {
      inject: [
        CONTENT_LIFECYCLE_SERVICE,
        CONTENT_RELEASE_SERVICE,
        CONTENT_RELEASE_STORE,
        CONTENT_LIFECYCLE_STORE,
        CONTENT_PRODUCTION_STORE,
      ],
      provide: DAY_CORRECTION_CONTENT_PORT,
      useFactory: (
        lifecycle: ContentLifecycleService,
        release: ContentReleaseService,
        releaseStore: PostgresContentReleaseStore,
        lifecycleStore: PostgresContentLifecycleStore,
        productionStore: PostgresContentProductionStore,
      ) =>
        new ExistingContentDayCorrectionPort(
          lifecycle,
          release,
          releaseStore,
          lifecycleStore,
          productionStore,
        ),
    },
    {
      inject: [
        DAY_CORRECTION_STORE,
        DAY_CORRECTION_CONTENT_PORT,
        RequestContextResolver,
        SystemClock,
      ],
      provide: DAY_CORRECTION_WORKFLOW,
      useFactory: (
        store: PostgresDayCorrectionStore,
        content: ExistingContentDayCorrectionPort,
        resolver: RequestContextResolver,
        clock: SystemClock,
      ) => new DayCorrectionWorkflow(store, content, resolver, clock),
    },
    {
      inject: [CONTENT_LIFECYCLE_STORE, BINARY_IMAGE_ASSET_STORE, SystemClock],
      provide: DAILY_IMAGE_ASSET_SERVICE,
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
      inject: [DATABASE_POOL],
      provide: PostgresDayCorrectionImageJobStore,
      useFactory: (pool: Pool) => new PostgresDayCorrectionImageJobStore(pool),
    },
    {
      inject: [PostgresDayCorrectionImageJobStore, SystemClock],
      provide: DAY_CORRECTION_IMAGE_JOB_SERVICE,
      useFactory: (store: PostgresDayCorrectionImageJobStore, clock: SystemClock) =>
        new DayCorrectionImageJobService(store, clock),
    },
    {
      inject: [DATABASE_POOL],
      provide: PostgresCorrectionImageLibrary,
      useFactory: (pool: Pool) => new PostgresCorrectionImageLibrary(pool),
    },
    {
      inject: [DATABASE_POOL],
      provide: PostgresDayCorrectionImageActionIdempotencyStore,
      useFactory: (pool: Pool) => new PostgresDayCorrectionImageActionIdempotencyStore(pool),
    },
    {
      inject: [
        DAY_CORRECTION_WORKFLOW,
        DAILY_IMAGE_ASSET_SERVICE,
        DAY_CORRECTION_IMAGE_JOB_SERVICE,
        PostgresCorrectionImageLibrary,
        PostgresDayCorrectionImageActionIdempotencyStore,
      ],
      provide: DAY_CORRECTION_IMAGE_WORKFLOW,
      useFactory: (
        corrections: DayCorrectionWorkflow,
        images: DailyImageAssetService,
        jobs: DayCorrectionImageJobService,
        library: PostgresCorrectionImageLibrary,
        actionIdempotency: PostgresDayCorrectionImageActionIdempotencyStore,
      ) => new DayCorrectionImageWorkflow(corrections, images, jobs, library, actionIdempotency),
    },
    { provide: APP_FILTER, useClass: AdminHttpExceptionFilter },
  ],
})
export class AdminHttpModule {}
