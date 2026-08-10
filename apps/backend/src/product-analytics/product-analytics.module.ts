import { Logger, Module } from "@nestjs/common";
import type { Pool } from "pg";

import { DatabaseModule } from "../database/database.module";
import { DATABASE_POOL } from "../database/postgres-pool";
import { SystemClock } from "../request-context/system-clock";
import { ANALYTICS_EVENT_REPOSITORY } from "./analytics-event.repository";
import { AnalyticsEventController } from "./analytics-event.controller";
import {
  ANALYTICS_CLOCK,
  AnalyticsEventService,
  ANALYTICS_HMAC_DIGESTER,
} from "./analytics-event.service";
import { analyticsHmacDigesterFromEnvironment } from "./analytics-hmac";
import { PostgresAnalyticsEventRepository } from "./postgres-analytics-event.repository";
import { AnalyticsRetentionWorker } from "./analytics-retention.worker";

function runtimeAnalyticsEnvironment(): NodeJS.ProcessEnv {
  if (process.env.NODE_ENV !== "test") return process.env;
  return {
    ...process.env,
    FIVE_ANALYTICS_HMAC_KEY_BASE64:
      process.env.FIVE_ANALYTICS_HMAC_KEY_BASE64 ?? Buffer.alloc(32, 0xa2).toString("base64"),
  };
}

@Module({
  controllers: [AnalyticsEventController],
  exports: [AnalyticsEventService, AnalyticsRetentionWorker],
  imports: [DatabaseModule],
  providers: [
    {
      inject: [DATABASE_POOL],
      provide: ANALYTICS_EVENT_REPOSITORY,
      useFactory: (pool: Pool) => new PostgresAnalyticsEventRepository(pool),
    },
    {
      provide: ANALYTICS_HMAC_DIGESTER,
      useFactory: () => {
        const digester = analyticsHmacDigesterFromEnvironment(runtimeAnalyticsEnvironment());
        if (!digester.available) {
          Logger.warn(
            "Anonymous analytics collection is unavailable; public content and workers will continue.",
            ProductAnalyticsModule.name,
          );
        }
        return digester;
      },
    },
    { provide: ANALYTICS_CLOCK, useClass: SystemClock },
    AnalyticsEventService,
    {
      inject: [AnalyticsEventService],
      provide: AnalyticsRetentionWorker,
      useFactory: (analytics: AnalyticsEventService) => new AnalyticsRetentionWorker(analytics),
    },
  ],
})
export class ProductAnalyticsModule {}
