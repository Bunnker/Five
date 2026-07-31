import { Module } from "@nestjs/common";

import { AdminHttpModule } from "./admin-http/admin-http.module";
import { DatabaseModule } from "./database/database.module";
import { FeedbackModule } from "./feedback/feedback.module";
import { HealthModule } from "./health/health.module";
import { PosterModule } from "./poster/poster.module";
import { RequestContextModule } from "./request-context/request-context.module";
import { TodayModule } from "./today/today.module";

@Module({
  imports: [
    AdminHttpModule,
    DatabaseModule,
    FeedbackModule,
    HealthModule,
    PosterModule,
    RequestContextModule,
    TodayModule,
  ],
})
export class AppModule {}
