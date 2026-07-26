import { Module } from "@nestjs/common";

import { RequestContextResolver } from "../request-context/request-context-resolver";
import { RequestContextModule } from "../request-context/request-context.module";
import { NoPublishedContentReader } from "./no-published-content.reader";
import {
  PUBLISHED_CONTENT_READER,
  type PublishedContentReader,
  TodayContentService,
} from "./today-content.service";
import { TodayCachePolicy } from "./today-cache-policy";
import { TODAY_CONTENT_READER, TodayController, type TodayContentReader } from "./today.controller";

@Module({
  controllers: [TodayController],
  imports: [RequestContextModule],
  providers: [
    TodayCachePolicy,
    {
      provide: PUBLISHED_CONTENT_READER,
      useClass: NoPublishedContentReader,
    },
    {
      inject: [RequestContextResolver, PUBLISHED_CONTENT_READER, TodayCachePolicy],
      provide: TodayContentService,
      useFactory: (
        requestContextResolver: RequestContextResolver,
        publishedContentReader: PublishedContentReader,
        cachePolicy: TodayCachePolicy,
      ) => new TodayContentService(requestContextResolver, publishedContentReader, cachePolicy),
    },
    {
      provide: TODAY_CONTENT_READER,
      useFactory: (service: TodayContentService): TodayContentReader => service,
      inject: [TodayContentService],
    },
  ],
})
export class TodayModule {}
