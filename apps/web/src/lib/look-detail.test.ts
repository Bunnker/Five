import { afterEach, describe, expect, it, vi } from "vitest";

import { loadLookDetail } from "./look-detail";

const contentVersion = "fd-20260715-r1";
const fortuneDate = "2026-07-15";
const lookId = "look-triple-01";

const lookDetailResponse = {
  contentVersion,
  fortuneDate,
  look: {
    alternatives: [
      {
        description: "没有白色包时，可以换成白色耳饰或手机壳。",
        replaceCategory: "配饰",
      },
    ],
    audience: {
      code: "adult_unisex",
      label: "成人通用",
    },
    coverImage: {
      aiDisclosure: "AI 生成穿搭示意图",
      aiGenerated: true,
      altText: "红色上衣、绿色下装和白色配饰的通勤穿搭",
      assetId: "asset-look-main-cover",
      height: 1600,
      mediaType: "image/webp",
      url: "https://cdn.five.test/assets/fd-20260715-r1/main.webp",
      width: 1200,
    },
    detailImages: [
      {
        aiDisclosure: "AI 生成穿搭示意图",
        aiGenerated: true,
        altText: "白色包和耳饰的搭配细节",
        assetId: "asset-look-main-detail-01",
        height: 1200,
        mediaType: "image/webp",
        url: "https://cdn.five.test/assets/fd-20260715-r1/detail-01.webp",
        width: 1200,
      },
    ],
    formulaId: "formula-triple-01",
    items: [
      {
        category: "top",
        categoryLabel: "上衣",
        colorCode: "red",
        description: "红色针织上衣",
      },
      {
        category: "bottom",
        categoryLabel: "下装",
        colorCode: "green",
        description: "绿色直筒长裤",
      },
      {
        category: "accessory",
        categoryLabel: "配饰",
        colorCode: "white",
        description: "白色小包或耳饰",
      },
    ],
    lookId,
    requiredForPublish: true,
    scenario: {
      code: "commute",
      label: "通勤",
    },
    sortOrder: 1,
    title: "木日通勤主方案",
  },
};

describe("loadLookDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads one reviewed look from the frozen versioned detail endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(lookDetailResponse), {
        headers: {
          "content-type": "application/json",
          "x-content-version": contentVersion,
        },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadLookDetail({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion: contentVersion,
        fortuneDate,
        lookId,
        requestId: "request-look-detail",
      }),
    ).resolves.toEqual({
      detail: {
        alternatives: lookDetailResponse.look.alternatives,
        audienceLabel: "成人通用",
        contentVersion,
        coverImage: lookDetailResponse.look.coverImage,
        detailImages: lookDetailResponse.look.detailImages,
        formulaId: "formula-triple-01",
        fortuneDate,
        items: lookDetailResponse.look.items,
        lookId,
        scenarioLabel: "通勤",
        title: "木日通勤主方案",
      },
      status: "ready",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.test:3100/api/v1/daily/2026-07-15/looks/look-triple-01?expectedContentVersion=fd-20260715-r1",
      expect.objectContaining({
        cache: "no-store",
        headers: {
          accept: "application/json",
          "x-request-id": "request-look-detail",
        },
      }),
    );
  });

  it("reports a content version change without returning partial look data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 409,
        }),
      ),
    );

    await expect(
      loadLookDetail({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion: contentVersion,
        fortuneDate,
        lookId,
      }),
    ).resolves.toEqual({ status: "stale" });
  });

  it("reports a missing look separately from a temporary loading failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 404,
        }),
      ),
    );

    await expect(
      loadLookDetail({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion: contentVersion,
        fortuneDate,
        lookId,
      }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("reports a rejected date or identifier as an invalid detail request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 400,
        }),
      ),
    );

    await expect(
      loadLookDetail({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion: contentVersion,
        fortuneDate,
        lookId,
      }),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("rejects a detail response containing a prohibited outcome promise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...lookDetailResponse,
            look: {
              ...lookDetailResponse.look,
              title: "保证谈判成功的通勤方案",
            },
          }),
          {
            headers: {
              "content-type": "application/json",
              "x-content-version": contentVersion,
            },
            status: 200,
          },
        ),
      ),
    );

    await expect(
      loadLookDetail({
        apiOrigin: "http://backend.test:3100",
        expectedContentVersion: contentVersion,
        fortuneDate,
        lookId,
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
