import { Module } from "@nestjs/common";

import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { RequestContextModule } from "./request-context/request-context.module";

@Module({
  imports: [DatabaseModule, HealthModule, RequestContextModule],
})
export class AppModule {}
