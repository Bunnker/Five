import "reflect-metadata";

import type { components } from "@five/api-contract";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PublishedContentReader } from "../today/today-content.service";
import { PosterJobController } from "./poster-job.controller";
import { InMemoryPosterJobRepository, type PosterJobRecord } from "./poster-job.repository";
import { PosterJobService } from "./poster-job.service";

type DailyContent = components["schemas"]["DailyContent"];

const content = {
  fortuneDate: "2026-07-15",
  looks: [],
  share: { posterTemplateVersion: "poster-template-v3" },
  versions: {
    contentVersion: "fd-20260715-r3",
    posterTemplateVersion: "poster-template-v3",
  },
} as unknown as DailyContent;

const reader: PublishedContentReader = {
  findActiveByFortuneDate: () => Promise.resolve(content),
};

class DatabaseFailurePosterJobRepository extends InMemoryPosterJobRepository {
  override findById(jobId: string): Promise<PosterJobRecord | null> {
    if (jobId === "database-failure") {
      return Promise.reject(new Error("database connection lost"));
    }
    return super.findById(jobId);
  }
}

const repository = new DatabaseFailurePosterJobRepository(1);

@Module({
  controllers: [PosterJobController],
  providers: [
    {
      provide: PosterJobService,
      useFactory: () =>
        new PosterJobService(
          repository,
          reader,
          () => "poster-job-http-01",
          "https://five.example.com",
        ),
    },
  ],
})
class PosterJobHttpTestModule {}

describe("poster job HTTP API", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      PosterJobHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts a contract-valid poster job and preserves the request id", async () => {
    const response = await app.inject({
      headers: {
        "idempotency-key": "018f9d15-7c70-7bb2-8f9d-123456789abc",
        "x-request-id": "poster-request-01",
      },
      method: "POST",
      payload: {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      url: "/api/v1/poster-jobs",
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe("poster-request-01");
    expect(response.json()).toEqual({
      assetUrl: null,
      channelId: "organic",
      currentActiveContentVersion: "fd-20260715-r3",
      entry: null,
      jobId: "poster-job-http-01",
      posterInstanceId: null,
      posterTemplateVersion: "poster-template-v3",
      sourceContentVersion: "fd-20260715-r3",
      status: "processing",
    });
  });

  it("returns the existing processing job for an idempotent replay", async () => {
    const response = await app.inject({
      headers: {
        "idempotency-key": "018f9d15-7c70-7bb2-8f9d-123456789abc",
        "x-request-id": "poster-request-replay",
      },
      method: "POST",
      payload: {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      url: "/api/v1/poster-jobs",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ jobId: "poster-job-http-01", status: "processing" });
  });

  it("rejects an idempotency key reused for another channel", async () => {
    const response = await app.inject({
      headers: {
        "idempotency-key": "018f9d15-7c70-7bb2-8f9d-123456789abc",
        "x-request-id": "poster-request-conflict",
      },
      method: "POST",
      payload: {
        channelId: "another-channel",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      url: "/api/v1/poster-jobs",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: {
        code: "IDEMPOTENCY_KEY_REUSED",
        details: {},
        message: "该幂等键已经用于另一份海报请求。",
        requestId: "poster-request-conflict",
        retryable: false,
      },
    });
  });

  it("does not create a job when the expected content version is no longer active", async () => {
    const response = await app.inject({
      headers: {
        "idempotency-key": "018f9d15-7c70-7bb2-8f9d-stale-version",
        "x-request-id": "poster-request-stale",
      },
      method: "POST",
      payload: {
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r2",
        fortuneDate: "2026-07-15",
      },
      url: "/api/v1/poster-jobs",
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: {
        code: "CONTENT_VERSION_CHANGED",
        details: {
          currentContentVersion: "fd-20260715-r3",
          expectedContentVersion: "fd-20260715-r2",
        },
        retryable: true,
      },
    });
  });

  it("rejects missing headers and additional request fields before touching the service", async () => {
    const response = await app.inject({
      method: "POST",
      payload: {
        accountId: "private-account",
        channelId: "organic",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      url: "/api/v1/poster-jobs",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  });

  it("returns the contract 429 response when the durable processing queue is full", async () => {
    const response = await app.inject({
      headers: {
        "idempotency-key": "018f9d15-7c70-7bb2-8f9d-queue-full",
        "x-request-id": "poster-request-queue-full",
      },
      method: "POST",
      payload: {
        channelId: "queue-capacity-test",
        expectedContentVersion: "fd-20260715-r3",
        fortuneDate: "2026-07-15",
      },
      url: "/api/v1/poster-jobs",
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        details: {},
        message: "海报生成队列暂时已满，请稍后重试。",
        requestId: "poster-request-queue-full",
        retryable: true,
      },
    });
  });

  it("returns an existing job and a contract error for an unknown job", async () => {
    const existing = await app.inject({
      headers: { "x-request-id": "poster-get-existing" },
      method: "GET",
      url: "/api/v1/poster-jobs/poster-job-http-01",
    });
    const missing = await app.inject({
      headers: { "x-request-id": "poster-get-missing" },
      method: "GET",
      url: "/api/v1/poster-jobs/does-not-exist",
    });

    expect(existing.statusCode).toBe(200);
    expect(existing.json()).toMatchObject({ jobId: "poster-job-http-01" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      error: { code: "RESOURCE_NOT_FOUND", requestId: "poster-get-missing" },
    });
  });

  it("maps a GET repository failure to the stable retryable poster error", async () => {
    const response = await app.inject({
      headers: { "x-request-id": "poster-get-database-failure" },
      method: "GET",
      url: "/api/v1/poster-jobs/database-failure",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.headers["x-request-id"]).toBe("poster-get-database-failure");
    expect(response.json()).toEqual({
      error: {
        code: "POSTER_GENERATION_UNAVAILABLE",
        details: {},
        message: "海报暂时不可用，今日内容和分享链接不受影响。",
        requestId: "poster-get-database-failure",
        retryable: true,
      },
    });
  });
});
