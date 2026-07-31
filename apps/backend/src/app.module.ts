import { Module } from "@nestjs/common";

import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { PosterModule } from "./poster/poster.module";
import { RequestContextModule } from "./request-context/request-context.module";
import { TodayModule } from "./today/today.module";

@Module({
  imports: [DatabaseModule, HealthModule, PosterModule, RequestContextModule, TodayModule],
})
export class AppModule {}
