import "reflect-metadata";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module";
import { installFeedbackRequestProtection } from "./feedback-request-protection";
import { FeedbackReportController } from "./feedback-report.controller";
import type {
  CreateFeedbackReportRecordInput,
  CreateFeedbackReportResult,
  FeedbackReportRepository,
} from "./feedback-report.repository";
import { FeedbackReportService } from "./feedback-report.service";

class MemoryFeedbackReportRepository implements FeedbackReportRepository {
  private readonly acceptedInputs: CreateFeedbackReportRecordInput[] = [];
  private acceptedCount = 0;
  private shouldFail = false;

  constructor(private readonly capacity: number) {}

  create(input: CreateFeedbackReportRecordInput): Promise<CreateFeedbackReportResult> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return Promise.reject(new Error("database secret: postgres://private-host/five"));
    }
    if (this.acceptedCount >= this.capacity) {
      return Promise.resolve({ kind: "rate_limited", retryAfterSeconds: 37 });
    }

    this.acceptedCount += 1;
    this.acceptedInputs.push(input);
    return Promise.resolve({ feedbackId: input.feedbackId, kind: "accepted" });
  }

  reset(): void {
    this.acceptedCount = 0;
    this.acceptedInputs.length = 0;
    this.shouldFail = false;
  }

  failNext(): void {
    this.shouldFail = true;
  }

  latestAcceptedInput(): CreateFeedbackReportRecordInput | undefined {
    return this.acceptedInputs.at(-1);
  }
}

const repository = new MemoryFeedbackReportRepository(2);
let feedbackSequence = 0;

@Module({
  controllers: [FeedbackReportController],
  providers: [
    {
      provide: FeedbackReportService,
      useFactory: () =>
        new FeedbackReportService(repository, () => `feedback-http-${++feedbackSequence}`),
    },
  ],
})
class FeedbackReportHttpTestModule {}

const validRequest = {
  category: "content_error",
  channelId: "organic",
  contact: null,
  contentVersion: "fd-20260715-r3",
  fortuneDate: "2026-07-15",
  message: "图片主色与文字配方不一致",
} as const;

describe("POST /api/v1/feedback-reports", () => {
  let app: NestFastifyApplication;
  let registeredApp: NestFastifyApplication;
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      FeedbackReportHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();

    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL ??= "postgresql://five:five@127.0.0.1:1/five";
    registeredApp = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false, trustProxy: "loopback" }),
      { logger: false },
    );
    installFeedbackRequestProtection(registeredApp.getHttpAdapter().getInstance());
    await registeredApp.init();
  });

  beforeEach(() => {
    feedbackSequence = 0;
    repository.reset();
  });

  afterAll(async () => {
    await Promise.all([app.close(), registeredApp.close()]);
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("registers the feedback route through the real application module", async () => {
    const response = await registeredApp.inject({
      headers: { "x-request-id": "registered-feedback-route" },
      method: "POST",
      payload: { ...validRequest, accountId: "must-not-be-accepted" },
      url: "/api/v1/feedback-reports",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["x-request-id"]).toBe("registered-feedback-route");
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_ARGUMENT", requestId: "registered-feedback-route" },
    });
  });

  it.each([
    ["malformed JSON", "{", "malformed-feedback-json"],
    [
      "an oversized JSON body",
      JSON.stringify({ ...validRequest, message: "x".repeat(1024 * 1024) }),
      "oversized-feedback-json",
    ],
  ])(
    "maps %s to the frozen 400 envelope before the controller runs",
    async (_caseName, payload, requestId) => {
      const response = await registeredApp.inject({
        headers: {
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        method: "POST",
        payload,
        url: "/api/v1/feedback-reports",
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-request-id"]).toBe(requestId);
      expect(response.json()).toEqual({
        error: {
          code: "INVALID_ARGUMENT",
          details: {},
          message: "反馈信息格式无效，请检查后重试。",
          requestId,
          retryable: false,
        },
      });
      expect(response.body).not.toMatch(/Body is not valid JSON|body limit|entity too large/iu);
    },
  );

  it("limits one anonymous source before parsing repeated invalid bodies", async () => {
    let response;
    for (let attempt = 0; attempt < 13; attempt += 1) {
      response = await registeredApp.inject({
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.10",
          "x-request-id": `feedback-source-limit-${attempt}`,
        },
        method: "POST",
        payload: "{",
        url: "/api/v1/feedback-reports",
      });
      if (response.statusCode === 429) {
        break;
      }
    }

    expect(response?.statusCode).toBe(429);
    expect(response?.headers["cache-control"]).toBe("no-store");
    expect(response?.headers["retry-after"]).toEqual(expect.any(String));
    expect(response?.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response?.json()).toMatchObject({
      error: { code: "RATE_LIMITED", retryable: true },
    });

    const otherSource = await registeredApp.inject({
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.11",
        "x-request-id": "feedback-other-source",
      },
      method: "POST",
      payload: "{",
      url: "/api/v1/feedback-reports",
    });
    expect(otherSource.statusCode).toBe(400);
    expect(otherSource.headers["x-request-id"]).toBe("feedback-other-source");
  });

  it("ignores spoofed forwarded addresses from a direct untrusted connection", async () => {
    let response;
    for (let attempt = 0; attempt < 13; attempt += 1) {
      response = await registeredApp.inject({
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `192.0.2.${attempt + 1}`,
          "x-request-id": `feedback-direct-limit-${attempt}`,
        },
        method: "POST",
        payload: "{",
        remoteAddress: "198.51.100.20",
        url: "/api/v1/feedback-reports",
      });
      if (response.statusCode === 429) {
        break;
      }
    }

    expect(response?.statusCode).toBe(429);
    expect(response?.json()).toMatchObject({
      error: { code: "RATE_LIMITED", retryable: true },
    });
  });

  it("accepts a contract-valid anonymous report and preserves its request id", async () => {
    const response = await app.inject({
      headers: {
        "x-request-id": "feedback-request-01",
      },
      method: "POST",
      payload: validRequest,
      url: "/api/v1/feedback-reports",
    });

    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe("feedback-request-01");
    expect(response.json()).toEqual({
      feedbackId: "feedback-http-1",
      status: "received",
    });
    expect(response.body).not.toMatch(/account|anonymousId|birth|ip|user-agent/iu);
  });

  it("accepts the frozen text boundaries and an explicitly supplied contact", async () => {
    const response = await app.inject({
      method: "POST",
      payload: {
        ...validRequest,
        category: "product_feedback",
        contact: "user@example.com",
        message: "建".repeat(2_000),
      },
      url: "/api/v1/feedback-reports",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "received" });
  });

  it("measures contract string limits in Unicode code points", async () => {
    const response = await app.inject({
      method: "POST",
      payload: {
        ...validRequest,
        channelId: "🙂".repeat(64),
        contact: "🙂".repeat(200),
        contentVersion: "🙂".repeat(128),
      },
      url: "/api/v1/feedback-reports",
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: "received" });
  });

  it("stores only normalized message and contact text", async () => {
    const response = await app.inject({
      method: "POST",
      payload: {
        ...validRequest,
        contact: "  user@example.com  ",
        message: "  第一行\n第二行  ",
      },
      url: "/api/v1/feedback-reports",
    });

    expect(response.statusCode).toBe(202);
    expect(repository.latestAcceptedInput()).toMatchObject({
      contact: "user@example.com",
      message: "第一行\n第二行",
    });
  });

  it.each([
    ["missing required contact", { ...validRequest, contact: undefined }],
    ["additional private field", { ...validRequest, accountId: "private-account" }],
    ["unknown category", { ...validRequest, category: "account_problem" }],
    ["blank message", { ...validRequest, message: "  \n " }],
    ["overlong message", { ...validRequest, message: "问".repeat(2_001) }],
    ["impossible fortune date", { ...validRequest, fortuneDate: "2026-02-30" }],
    ["empty content version", { ...validRequest, contentVersion: "" }],
    ["overlong channel", { ...validRequest, channelId: "c".repeat(65) }],
    ["empty contact", { ...validRequest, contact: "" }],
    ["overlong contact", { ...validRequest, contact: "联".repeat(201) }],
    ["message control character", { ...validRequest, message: "问题\u0000描述" }],
    ["contact control character", { ...validRequest, contact: "user\n@example.com" }],
  ])("returns the stable 400 envelope for %s", async (_caseName, payload) => {
    const response = await app.inject({
      headers: {
        "x-request-id": "feedback-invalid-01",
      },
      method: "POST",
      payload,
      url: "/api/v1/feedback-reports",
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-request-id"]).toBe("feedback-invalid-01");
    expect(response.json()).toEqual({
      error: {
        code: "INVALID_ARGUMENT",
        details: {},
        message: "反馈信息格式无效，请检查后重试。",
        requestId: "feedback-invalid-01",
        retryable: false,
      },
    });
  });

  it("returns the contract 429 response after the anonymous global window is full", async () => {
    await app.inject({
      method: "POST",
      payload: validRequest,
      url: "/api/v1/feedback-reports",
    });
    await app.inject({
      method: "POST",
      payload: { ...validRequest, category: "product_feedback" },
      url: "/api/v1/feedback-reports",
    });

    const response = await app.inject({
      headers: {
        "x-request-id": "feedback-rate-limited",
      },
      method: "POST",
      payload: validRequest,
      url: "/api/v1/feedback-reports",
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["retry-after"]).toBe("37");
    expect(response.headers["x-request-id"]).toBe("feedback-rate-limited");
    expect(response.json()).toEqual({
      error: {
        code: "RATE_LIMITED",
        details: {},
        message: "提交过于频繁，请稍后再试。",
        requestId: "feedback-rate-limited",
        retryable: true,
      },
    });
  });

  it("replaces a malformed incoming request id in both header and success payload", async () => {
    const response = await app.inject({
      headers: {
        "x-request-id": "short",
      },
      method: "POST",
      payload: validRequest,
      url: "/api/v1/feedback-reports",
    });

    const requestId = response.headers["x-request-id"];
    expect(response.statusCode).toBe(202);
    expect(requestId).toEqual(expect.any(String));
    expect(requestId).not.toBe("short");
    expect(String(requestId).length).toBeGreaterThanOrEqual(8);
  });

  it("returns a stable retryable 503 without leaking a database failure", async () => {
    repository.failNext();

    const response = await app.inject({
      headers: {
        "x-request-id": "feedback-database-failure",
      },
      method: "POST",
      payload: validRequest,
      url: "/api/v1/feedback-reports",
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["retry-after"]).toBe("30");
    expect(response.headers["x-request-id"]).toBe("feedback-database-failure");
    expect(response.json()).toEqual({
      error: {
        code: "FEEDBACK_UNAVAILABLE",
        details: {},
        message: "反馈暂时无法接收，请稍后再试。",
        requestId: "feedback-database-failure",
        retryable: true,
      },
    });
    expect(response.body).not.toContain("postgres://private-host/five");
    expect(response.body).not.toContain("database secret");
  });
});
