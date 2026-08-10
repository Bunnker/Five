import { Module } from "@nestjs/common";
import type { Pool } from "pg";

import { DATABASE_POOL } from "../database/postgres-pool";
import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { PublicContentWindowResolver } from "../public-content/public-content-window-resolver";
import { PublicContentModule } from "../public-content/public-content.module";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import { RequestContextModule } from "../request-context/request-context.module";
import {
  LOOK_DETAIL_READER,
  LookDetailController,
  type LookDetailReader,
} from "./look-detail.controller";
import { LookDetailService } from "./look-detail.service";
import {
  DAILY_CONTENT_READER,
  DailyContentController,
  type DailyContentReader,
} from "./daily-content.controller";
import {
  ActivePublishedDailyContentResolutionReader,
  DAILY_CONTENT_RESOLUTION_READER,
  type DailyContentResolutionReader,
} from "./daily-content-resolution.reader";
import { DailyContentService } from "./daily-content.service";
import { DemoPublishedContentReader } from "./demo-published-content.reader";
import { NoPublishedContentReader } from "./no-published-content.reader";
import { PostgresPublishedContentReader } from "./postgres-published-content.reader";
import {
  PUBLISHED_CONTENT_READER,
  type PublishedContentReader,
  TodayContentService,
} from "./today-content.service";
import { TodayCachePolicy } from "./today-cache-policy";
import { TODAY_CONTENT_READER, TodayController, type TodayContentReader } from "./today.controller";

export function dailyContentResolutionReaderFor(
  publishedContentReader: PublishedContentReader,
): DailyContentResolutionReader {
  const lifecycleAwareReader = publishedContentReader as PublishedContentReader &
    Partial<DailyContentResolutionReader>;
  return typeof lifecycleAwareReader.resolve === "function"
    ? (lifecycleAwareReader as PublishedContentReader & DailyContentResolutionReader)
    : new ActivePublishedDailyContentResolutionReader(publishedContentReader);
}

@Module({
  controllers: [DailyContentController, LookDetailController, TodayController],
  exports: [PUBLISHED_CONTENT_READER],
  imports: [PublicContentModule, RequestContextModule],
  providers: [
    TodayCachePolicy,
    {
      inject: [{ optional: true, token: DATABASE_POOL }],
      provide: PUBLISHED_CONTENT_READER,
      useFactory: (pool: Pool | undefined): PublishedContentReader => {
        if (
          pool === undefined &&
          process.env.NODE_ENV === "development" &&
          process.env.FIVE_DEMO_CONTENT === "1"
        ) {
          return new DemoPublishedContentReader();
        }
        return pool === undefined
          ? new NoPublishedContentReader()
          : new PostgresPublishedContentReader(pool);
      },
    },
    {
      inject: [
        RequestContextResolver,
        PublicContentContextResolver,
        PUBLISHED_CONTENT_READER,
        TodayCachePolicy,
        PublicContentWindowResolver,
      ],
      provide: TodayContentService,
      useFactory: (
        requestContextResolver: RequestContextResolver,
        publicContentContextResolver: PublicContentContextResolver,
        publishedContentReader: PublishedContentReader,
        cachePolicy: TodayCachePolicy,
        publicContentWindowResolver: PublicContentWindowResolver,
      ) =>
        new TodayContentService(
          requestContextResolver,
          publicContentContextResolver,
          publishedContentReader,
          cachePolicy,
          publicContentWindowResolver,
        ),
    },
    {
      inject: [PUBLISHED_CONTENT_READER],
      provide: LookDetailService,
      useFactory: (publishedContentReader: PublishedContentReader) =>
        new LookDetailService(publishedContentReader),
    },
    {
      inject: [PUBLISHED_CONTENT_READER],
      provide: DAILY_CONTENT_RESOLUTION_READER,
      useFactory: (publishedContentReader: PublishedContentReader): DailyContentResolutionReader =>
        dailyContentResolutionReaderFor(publishedContentReader),
    },
    {
      inject: [
        RequestContextResolver,
        PublicContentContextResolver,
        DAILY_CONTENT_RESOLUTION_READER,
        TodayCachePolicy,
      ],
      provide: DailyContentService,
      useFactory: (
        requestContextResolver: RequestContextResolver,
        publicContentContextResolver: PublicContentContextResolver,
        dailyContentResolutionReader: DailyContentResolutionReader,
        cachePolicy: TodayCachePolicy,
      ) =>
        new DailyContentService(
          requestContextResolver,
          publicContentContextResolver,
          dailyContentResolutionReader,
          cachePolicy,
        ),
    },
    {
      inject: [DailyContentService],
      provide: DAILY_CONTENT_READER,
      useFactory: (service: DailyContentService): DailyContentReader => service,
    },
    {
      inject: [LookDetailService],
      provide: LOOK_DETAIL_READER,
      useFactory: (service: LookDetailService): LookDetailReader => service,
    },
    {
      provide: TODAY_CONTENT_READER,
      useFactory: (service: TodayContentService): TodayContentReader => service,
      inject: [TodayContentService],
    },
  ],
})
export class TodayModule {}
