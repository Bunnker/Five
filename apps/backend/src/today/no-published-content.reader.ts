import type { components } from "@five/api-contract";

import type { PublishedContentReader } from "./today-content.service";

type DailyContent = components["schemas"]["DailyContent"];

export class NoPublishedContentReader implements PublishedContentReader {
  findActiveByFortuneDate(): Promise<DailyContent | null> {
    // Until the content lifecycle provides a persistence adapter, fail closed instead of
    // inventing or exposing draft content through the public endpoint.
    return Promise.resolve(null);
  }
}
