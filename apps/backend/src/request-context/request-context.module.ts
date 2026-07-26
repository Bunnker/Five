import { Module } from "@nestjs/common";

import { RequestContextResolver } from "./request-context-resolver";
import { SystemClock } from "./system-clock";

@Module({
  exports: [RequestContextResolver],
  providers: [
    SystemClock,
    {
      inject: [SystemClock],
      provide: RequestContextResolver,
      useFactory: (clock: SystemClock) => new RequestContextResolver(clock),
    },
  ],
})
export class RequestContextModule {}
