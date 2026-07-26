import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { RequestContextModule } from "../request-context/request-context.module";

@Module({
  imports: [DatabaseModule, RequestContextModule],
})
export class WorkerModule {}
