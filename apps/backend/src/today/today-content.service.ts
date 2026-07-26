import { createHash } from "node:crypto";

import type { components } from "@five/api-contract";

import {
  RequestContextResolver,
  type RequestContext,
} from "../request-context/request-context-resolver";
import { parseZonedDateTime } from "../request-context/zoned-date-time";
import { TodayCachePolicy } from "./today-cache-policy";

type DailyContent = components["schemas"]["DailyContent"];
type TodayResponse = components["schemas"]["TodayResponse"];

export const PUBLISHED_CONTENT_READER = Symbol("PUBLISHED_CONTENT_READER");

export interface PublishedContentReader {
  findActiveByFortuneDate(fortuneDate: string): Promise<DailyContent | null>;
}

export interface ReadyTodayContent {
  body: TodayResponse;
  cacheControl: string;
  contentVersion: string;
  etag: string;
  kind: "ready";
  representationDate: string;
  sharedMaxAgeSeconds: number;
}

export interface NotReadyTodayContent {
  kind: "not_ready";
  requestContext: RequestContext;
  retryAfterSeconds: number;
}

export type TodayContentResult = ReadyTodayContent | NotReadyTodayContent;

const NOT_READY_RETRY_SECONDS = 30;

function isCurrentContent(
  content: DailyContent,
  requestContext: RequestContext,
  generatedAt: number,
): boolean {
  if (content.fortuneDate !== requestContext.fortuneDate) {
    return false;
  }

  const effectiveFrom = parseZonedDateTime(content.effectiveFrom);
  const effectiveTo = parseZonedDateTime(content.effectiveTo);

  return (
    effectiveFrom !== null &&
    effectiveTo !== null &&
    effectiveFrom <= generatedAt &&
    generatedAt < effectiveTo
  );
}

function createRepresentationEtag(body: TodayResponse): string {
  const digest = createHash("sha256").update(JSON.stringify(body), "utf8").digest("base64url");
  return `"sha256-${digest}"`;
}

export class TodayContentService {
  constructor(
    private readonly requestContextResolver: RequestContextResolver,
    private readonly publishedContentReader: PublishedContentReader,
    private readonly cachePolicy: TodayCachePolicy,
  ) {}

  async read(): Promise<TodayContentResult> {
    // One resolver call keeps every returned date and time field tied to the same instant.
    const requestContext = this.requestContextResolver.resolve();
    const generatedAt = parseZonedDateTime(requestContext.responseGeneratedAt);
    const content = await this.publishedContentReader.findActiveByFortuneDate(
      requestContext.fortuneDate,
    );

    if (
      generatedAt === null ||
      content === null ||
      !isCurrentContent(content, requestContext, generatedAt)
    ) {
      return {
        kind: "not_ready",
        requestContext,
        retryAfterSeconds: NOT_READY_RETRY_SECONDS,
      };
    }

    const body: TodayResponse = {
      content,
      requestContext,
    };
    const cache = this.cachePolicy.calculate(requestContext, content.effectiveTo);

    return {
      body,
      cacheControl: cache.cacheControl,
      contentVersion: content.versions.contentVersion,
      etag: createRepresentationEtag(body),
      kind: "ready",
      representationDate: new Date(generatedAt).toUTCString(),
      sharedMaxAgeSeconds: cache.sharedMaxAgeSeconds,
    };
  }
}
