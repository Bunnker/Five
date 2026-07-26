import { Module } from "@nestjs/common";

import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { RequestContextModule } from "./request-context/request-context.module";
import { TodayModule } from "./today/today.module";

@Module({
  imports: [DatabaseModule, HealthModule, RequestContextModule, TodayModule],
})
export class AppModule {}
