import type { components } from "@five/api-contract";

import type { PublishedContentReader } from "./today-content.service";

type LookDetailResponse = components["schemas"]["LookDetailResponse"];

export interface ReadLookDetailInput {
  expectedContentVersion: string;
  fortuneDate: string;
  lookId: string;
}

export type LookDetailResult =
  | {
      body: LookDetailResponse;
      contentVersion: string;
      kind: "ready";
    }
  | {
      currentContentVersion: string;
      expectedContentVersion: string;
      kind: "version_changed";
    }
  | {
      kind: "missing";
    };

export class LookDetailService {
  constructor(private readonly publishedContentReader: PublishedContentReader) {}

  async read({
    expectedContentVersion,
    fortuneDate,
    lookId,
  }: ReadLookDetailInput): Promise<LookDetailResult> {
    // One reader call keeps the active pointer, immutable payload, and look on one snapshot.
    const content = await this.publishedContentReader.findActiveByFortuneDate(fortuneDate);
    if (content === null || content.fortuneDate !== fortuneDate) {
      return { kind: "missing" };
    }

    const contentVersion = content.versions.contentVersion;
    if (contentVersion !== expectedContentVersion) {
      return {
        currentContentVersion: contentVersion,
        expectedContentVersion,
        kind: "version_changed",
      };
    }

    const look = content.looks.find((candidate) => candidate.lookId === lookId);
    if (look === undefined) {
      return { kind: "missing" };
    }

    return {
      body: {
        contentVersion,
        fortuneDate: content.fortuneDate,
        look,
      },
      contentVersion,
      kind: "ready",
    };
  }
}
