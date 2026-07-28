import "reflect-metadata";

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOOK_DETAIL_READER,
  LookDetailController,
  type LookDetailReader,
} from "./look-detail.controller";
import type { LookDetailResult } from "./look-detail.service";

const fortuneDate = "2026-07-15";
const currentContentVersion = "fd-20260715-r3";
const expectedContentVersion = "fd-20260715-r2";
const lookId = "look-main-01";

const readyResult = {
  body: {
    contentVersion: currentContentVersion,
    fortuneDate,
    look: {
      alternatives: [],
      audience: { code: "adult_women", label: "成年女性" },
      coverImage: {
        aiDisclosure: "AI 生成穿搭示意图",
        aiGenerated: true,
        altText: "红色上衣、绿色下装和白色配饰的通勤穿搭",
        assetId: "asset-main",
        height: 1600,
        mediaType: "image/webp",
        url: "https://cdn.five.test/assets/main.webp",
        width: 1200,
      },
      detailImages: [],
      formulaId: "formula-triple-01",
      items: [
        {
          category: "top",
          categoryLabel: "上衣",
          colorCode: "red",
          description: "红色简洁上衣",
        },
      ],
      lookId,
      requiredForPublish: true,
      scenario: { code: "commute", label: "通勤" },
      sortOrder: 1,
      title: "木日通勤主方案",
    },
  },
  contentVersion: currentContentVersion,
  kind: "ready",
} satisfies Extract<LookDetailResult, { kind: "ready" }>;

const readLookDetail = vi.fn<LookDetailReader["read"]>();

@Module({
  controllers: [LookDetailController],
  providers: [
    {
      provide: LOOK_DETAIL_READER,
      useValue: {
        read: (input: Parameters<LookDetailReader["read"]>[0]) => readLookDetail(input),
      } satisfies LookDetailReader,
    },
  ],
})
class LookDetailHttpTestModule {}

describe("GET /api/v1/daily/:fortuneDate/looks/:lookId", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      LookDetailHttpTestModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();
  });

  beforeEach(() => {
    readLookDetail.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the exact active look snapshot when all three versions match", async () => {
    readLookDetail.mockResolvedValue(readyResult);

    const response = await app.inject({
      headers: { "x-request-id": "edge-request-look-200" },
      method: "GET",
      url: `/api/v1/daily/${fortuneDate}/looks/${lookId}?expectedContentVersion=${currentContentVersion}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-version"]).toBe(currentContentVersion);
    expect(response.headers["x-request-id"]).toBe("edge-request-look-200");
    expect(response.json()).toEqual(readyResult.body);
    expect(readLookDetail).toHaveBeenCalledWith({
      expectedContentVersion: currentContentVersion,
      fortuneDate,
      lookId,
    });
  });

  it("returns a stable conflict without any look fields when the active version changed", async () => {
    readLookDetail.mockResolvedValue({
      currentContentVersion,
      expectedContentVersion,
      kind: "version_changed",
    });

    const response = await app.inject({
      headers: { "x-request-id": "edge-request-look-409" },
      method: "GET",
      url: `/api/v1/daily/${fortuneDate}/looks/${lookId}?expectedContentVersion=${expectedContentVersion}`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-version"]).toBe(currentContentVersion);
    expect(response.headers["x-request-id"]).toBe("edge-request-look-409");
    const body = response.json();
    expect(body).toEqual({
      error: {
        code: "CONTENT_VERSION_CHANGED",
        details: {
          currentContentVersion,
          expectedContentVersion,
        },
        message: "页面内容版本已经变化，请刷新后重试。",
        requestId: "edge-request-look-409",
        retryable: true,
      },
    });
    expect(body).not.toHaveProperty("look");
  });

  it("returns LOOK_NOT_FOUND only after the active version has matched", async () => {
    readLookDetail.mockResolvedValue({ kind: "missing" });

    const response = await app.inject({
      headers: { "x-request-id": "edge-request-look-404" },
      method: "GET",
      url: `/api/v1/daily/${fortuneDate}/looks/look-missing-01?expectedContentVersion=${currentContentVersion}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      error: {
        code: "LOOK_NOT_FOUND",
        requestId: "edge-request-look-404",
        retryable: false,
      },
    });
  });

  it.each([
    {
      code: "INVALID_FORTUNE_DATE",
      url: `/api/v1/daily/2026-02-31/looks/${lookId}?expectedContentVersion=${currentContentVersion}`,
    },
    {
      code: "INVALID_ARGUMENT",
      url: `/api/v1/daily/${fortuneDate}/looks/${lookId}`,
    },
  ])("rejects invalid input with $code before reading content", async ({ code, url }) => {
    const response = await app.inject({
      headers: { "x-request-id": "edge-request-look-400" },
      method: "GET",
      url,
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      error: {
        code,
        requestId: "edge-request-look-400",
        retryable: false,
      },
    });
    expect(readLookDetail).not.toHaveBeenCalled();
  });
});
