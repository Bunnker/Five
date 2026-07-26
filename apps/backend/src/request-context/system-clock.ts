import { Injectable } from "@nestjs/common";

import type { Clock } from "./request-context-resolver";

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
