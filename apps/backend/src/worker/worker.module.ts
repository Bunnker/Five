import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module";
import { PosterModule } from "../poster/poster.module";
import { RequestContextModule } from "../request-context/request-context.module";

@Module({
  imports: [DatabaseModule, PosterModule, RequestContextModule],
})
export class WorkerModule {}
