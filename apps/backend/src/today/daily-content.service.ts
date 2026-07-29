import { createHash } from "node:crypto";

import type { components } from "@five/api-contract";

import { RequestContextResolver } from "../request-context/request-context-resolver";
import type {
  DailyContentResolutionReader,
  ResolveDailyContentInput,
} from "./daily-content-resolution.reader";
import { TodayCachePolicy } from "./today-cache-policy";

type DailyContent = components["schemas"]["DailyContent"];
type DailyContentResponse = components["schemas"]["DailyContentResponse"];

export type ReadDailyContentInput = ResolveDailyContentInput;

export interface ReadyDailyContent {
  body: DailyContentResponse;
  cacheControl: string;
  contentVersion: string;
  etag: string;
  kind: "ready";
}

export type DailyContentResult =
  | ReadyDailyContent
  | {
      kind: "expired";
    }
  | {
      kind: "missing";
    };

const PUBLIC_RETENTION_DAYS = 90;
const MILLISECONDS_PER_DAY = 86_400_000;

function toUtcMidnight(fortuneDate: string): number {
  return Date.parse(`${fortuneDate}T00:00:00.000Z`);
}

function isOutsidePublicRetention(
  requestedFortuneDate: string,
  currentFortuneDate: string,
): boolean {
  const ageMilliseconds = toUtcMidnight(currentFortuneDate) - toUtcMidnight(requestedFortuneDate);

  // Keeping the boundary day public satisfies the PRD's "at least 90 days" guarantee.
  return ageMilliseconds > PUBLIC_RETENTION_DAYS * MILLISECONDS_PER_DAY;
}

function createRepresentationEtag(body: DailyContentResponse): string {
  const digest = createHash("sha256").update(JSON.stringify(body), "utf8").digest("base64url");
  return `"sha256-${digest}"`;
}

function createResolution(
  content: DailyContent,
  expectedContentVersion: string | null,
  reason: DailyContentResponse["resolution"]["reason"],
): DailyContentResponse["resolution"] {
  const servedContentVersion = content.versions.contentVersion;
  const versionChanged =
    expectedContentVersion !== null && expectedContentVersion !== servedContentVersion;

  if ((versionChanged && reason === "current") || (!versionChanged && reason !== "current")) {
    throw new RangeError("Daily content resolution reason does not match the served version");
  }

  return {
    expectedContentVersion,
    reason,
    servedContentVersion,
    versionChanged,
  };
}

export class DailyContentService {
  constructor(
    private readonly requestContextResolver: RequestContextResolver,
    private readonly dailyContentResolutionReader: DailyContentResolutionReader,
    private readonly cachePolicy: TodayCachePolicy,
  ) {}

  async read({
    expectedContentVersion,
    fortuneDate,
  }: ReadDailyContentInput): Promise<DailyContentResult> {
    const requestContext = this.requestContextResolver.resolve();
    if (isOutsidePublicRetention(fortuneDate, requestContext.fortuneDate)) {
      return { kind: "expired" };
    }

    // The resolver returns the active pointer, public payload, and lifecycle reason from one
    // safe snapshot; the old link never selects an immutable historical payload directly.
    const resolved = await this.dailyContentResolutionReader.resolve({
      expectedContentVersion,
      fortuneDate,
    });
    if (resolved.kind === "missing" || resolved.content.fortuneDate !== fortuneDate) {
      return { kind: "missing" };
    }
    const { content } = resolved;

    const body: DailyContentResponse = {
      content,
      requestedFortuneDate: fortuneDate,
      resolution: createResolution(content, expectedContentVersion, resolved.reason),
    };
    const cache = this.cachePolicy.calculate(requestContext, content.effectiveTo);

    return {
      body,
      cacheControl: cache.cacheControl,
      contentVersion: content.versions.contentVersion,
      etag: createRepresentationEtag(body),
      kind: "ready",
    };
  }
}
