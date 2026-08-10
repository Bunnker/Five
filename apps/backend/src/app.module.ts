import { Module } from "@nestjs/common";

import { AdminHttpModule } from "./admin-http/admin-http.module";
import { DatabaseModule } from "./database/database.module";
import { FeedbackModule } from "./feedback/feedback.module";
import { HealthModule } from "./health/health.module";
import { PosterModule } from "./poster/poster.module";
import { ProductAnalyticsModule } from "./product-analytics/product-analytics.module";
import { RequestContextModule } from "./request-context/request-context.module";
import { TodayModule } from "./today/today.module";

@Module({
  imports: [
    AdminHttpModule,
    DatabaseModule,
    FeedbackModule,
    HealthModule,
    PosterModule,
    ProductAnalyticsModule,
    RequestContextModule,
    TodayModule,
  ],
})
export class AppModule {}
