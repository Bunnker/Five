import { Module } from "@nestjs/common";
import type { Pool } from "pg";

import { DatabaseModule } from "../database/database.module";
import { DATABASE_POOL } from "../database/postgres-pool";
import { FeedbackReportController } from "./feedback-report.controller";
import {
  FEEDBACK_REPORT_REPOSITORY,
  type FeedbackReportRepository,
} from "./feedback-report.repository";
import {
  createFeedbackId,
  FEEDBACK_ID_FACTORY,
  FeedbackReportService,
} from "./feedback-report.service";
import { PostgresFeedbackReportRepository } from "./postgres-feedback-report.repository";

@Module({
  controllers: [FeedbackReportController],
  imports: [DatabaseModule],
  providers: [
    {
      inject: [DATABASE_POOL],
      provide: FEEDBACK_REPORT_REPOSITORY,
      useFactory: (pool: Pool): FeedbackReportRepository =>
        new PostgresFeedbackReportRepository(pool),
    },
    {
      provide: FEEDBACK_ID_FACTORY,
      useValue: createFeedbackId,
    },
    FeedbackReportService,
  ],
})
export class FeedbackModule {}
