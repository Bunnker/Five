import type { components } from "@five/api-contract";

import type { PublishedContentReader } from "./today-content.service";

type DailyContent = components["schemas"]["DailyContent"];
type VersionResolutionReason = components["schemas"]["VersionResolution"]["reason"];

export const DAILY_CONTENT_RESOLUTION_READER = Symbol("DAILY_CONTENT_RESOLUTION_READER");

export interface ResolveDailyContentInput {
  expectedContentVersion: string | null;
  fortuneDate: string;
}

export type ResolvedDailyContent =
  | {
      content: DailyContent;
      kind: "ready";
      reason: VersionResolutionReason;
    }
  | {
      kind: "missing";
    };

export interface DailyContentResolutionReader {
  resolve(input: ResolveDailyContentInput): Promise<ResolvedDailyContent>;
}

export class ActivePublishedDailyContentResolutionReader implements DailyContentResolutionReader {
  constructor(private readonly publishedContentReader: PublishedContentReader) {}

  async resolve({
    expectedContentVersion,
    fortuneDate,
  }: ResolveDailyContentInput): Promise<ResolvedDailyContent> {
    // This adapter represents the current active-only storage seam. A lifecycle-aware
    // persistence adapter replaces it when rollback and withdrawal history are available,
    // returning the content and its true public resolution reason from one snapshot.
    const content = await this.publishedContentReader.findActiveByFortuneDate(fortuneDate);
    if (content === null || content.fortuneDate !== fortuneDate) {
      return { kind: "missing" };
    }

    return {
      content,
      kind: "ready",
      reason:
        expectedContentVersion !== null &&
        expectedContentVersion !== content.versions.contentVersion
          ? "replaced"
          : "current",
    };
  }
}
