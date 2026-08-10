import { createHash, randomUUID } from "node:crypto";

import type { components } from "@five/api-contract";

import type { PublishedContentReader } from "../today/today-content.service";
import type { PosterJobRecord, PosterJobRepository } from "./poster-job.repository";

type CreatePosterJobRequest = components["schemas"]["CreatePosterJobRequest"];
type PosterJob = components["schemas"]["PosterJob"];

export type CreatePosterJobResult =
  | { job: PosterJob; kind: "accepted" | "existing" }
  | {
      currentActiveContentVersion: string | null;
      kind: "version_changed";
    }
  | { kind: "idempotency_conflict" }
  | { kind: "rate_limited"; queueCapacity: number; retryAfterSeconds: number }
  | { kind: "unavailable" };

const QUEUE_RETRY_AFTER_SECONDS = 30;

function canonicalRequestHash(input: CreatePosterJobRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        channelId: input.channelId,
        expectedContentVersion: input.expectedContentVersion,
        fortuneDate: input.fortuneDate,
      }),
      "utf8",
    )
    .digest("hex");
}

function publicJob(record: PosterJobRecord): PosterJob {
  return {
    assetUrl: record.assetUrl,
    channelId: record.channelId,
    currentActiveContentVersion: record.currentActiveContentVersion,
    entry: record.entry,
    jobId: record.jobId,
    posterInstanceId: record.posterInstanceId,
    posterTemplateVersion: record.posterTemplateVersion,
    sourceContentVersion: record.sourceContentVersion,
    status: record.status,
  };
}

function createLandingUrl(
  webOrigin: string,
  { channelId, expectedContentVersion, fortuneDate }: CreatePosterJobRequest,
  referralId: string,
): string {
  const url = new URL(`/daily/${fortuneDate}`, webOrigin);
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("expectedContentVersion", expectedContentVersion);
  url.searchParams.set("referralId", referralId);
  url.searchParams.set("referralKind", "poster");
  return url.toString();
}

export class PosterJobService {
  constructor(
    private readonly repository: PosterJobRepository,
    private readonly publishedContentReader: PublishedContentReader,
    private readonly createJobId: () => string = randomUUID,
    private readonly publicWebOrigin = "http://127.0.0.1:3000",
  ) {}

  async create(
    input: CreatePosterJobRequest,
    idempotencyKey: string,
  ): Promise<CreatePosterJobResult> {
    const requestHash = canonicalRequestHash(input);
    try {
      const replay = await this.repository.findByIdempotency(idempotencyKey, requestHash);
      if (replay.kind === "existing") {
        return { job: publicJob(replay.record), kind: "existing" };
      }
      if (replay.kind === "idempotency_conflict") {
        return replay;
      }
    } catch {
      return { kind: "unavailable" };
    }

    let content;
    try {
      content = await this.publishedContentReader.findActiveByFortuneDate(input.fortuneDate);
    } catch {
      return { kind: "unavailable" };
    }

    const currentActiveContentVersion = content?.versions.contentVersion ?? null;
    if (
      content === null ||
      content.fortuneDate !== input.fortuneDate ||
      currentActiveContentVersion !== input.expectedContentVersion
    ) {
      return { currentActiveContentVersion, kind: "version_changed" };
    }

    const posterTemplateVersion = content.versions.posterTemplateVersion;
    if (
      posterTemplateVersion.length === 0 ||
      content.share.posterTemplateVersion !== posterTemplateVersion
    ) {
      return { kind: "unavailable" };
    }

    try {
      const jobId = this.createJobId();
      const result = await this.repository.createOrReuse({
        ...input,
        currentActiveContentVersion,
        idempotencyKey,
        jobId,
        landingUrl: createLandingUrl(this.publicWebOrigin, input, jobId),
        posterTemplateVersion,
        requestHash,
      });
      if (result.kind === "idempotency_conflict") {
        return result;
      }
      if (result.kind === "rate_limited") {
        return { ...result, retryAfterSeconds: QUEUE_RETRY_AFTER_SECONDS };
      }
      return {
        job: publicJob(result.record),
        kind: result.kind === "created" ? "accepted" : "existing",
      };
    } catch {
      return { kind: "unavailable" };
    }
  }

  async get(jobId: string): Promise<PosterJob | null> {
    const record = await this.repository.findById(jobId);
    return record === null ? null : publicJob(record);
  }
}
