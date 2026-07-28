import type { components } from "@five/api-contract";
import { describe, expect, it, vi } from "vitest";

import { LookDetailService } from "./look-detail.service";
import type { PublishedContentReader } from "./today-content.service";

type DailyContent = components["schemas"]["DailyContent"];
type PublicLook = components["schemas"]["PublicLook"];

const fortuneDate = "2026-07-15";
const currentContentVersion = "fd-20260715-r3";
const expectedContentVersion = "fd-20260715-r2";

const look = {
  alternatives: [
    {
      description: "没有白色包时，可以换成白色耳饰。",
      replaceCategory: "配饰",
    },
  ],
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
  lookId: "look-main-01",
  requiredForPublish: true,
  scenario: { code: "commute", label: "通勤" },
  sortOrder: 1,
  title: "木日通勤主方案",
} satisfies PublicLook;

function content(contentVersion: string, looks: PublicLook[]): DailyContent {
  return {
    contentVersion,
    fortuneDate,
    looks,
    versions: { contentVersion },
  } as unknown as DailyContent;
}

function serviceWith(
  findActiveByFortuneDate: PublishedContentReader["findActiveByFortuneDate"],
): LookDetailService {
  return new LookDetailService({ findActiveByFortuneDate });
}

describe("LookDetailService", () => {
  it("returns one complete active snapshot when the expected version still matches", async () => {
    const reader = vi.fn().mockResolvedValue(content(currentContentVersion, [look]));
    const service = serviceWith(reader);

    await expect(
      service.read({
        expectedContentVersion: currentContentVersion,
        fortuneDate,
        lookId: look.lookId,
      }),
    ).resolves.toEqual({
      body: {
        contentVersion: currentContentVersion,
        fortuneDate,
        look,
      },
      contentVersion: currentContentVersion,
      kind: "ready",
    });
    expect(reader).toHaveBeenCalledOnce();
    expect(reader).toHaveBeenCalledWith(fortuneDate);
  });

  it("returns version_changed before considering whether the look exists in the new version", async () => {
    const service = serviceWith(vi.fn().mockResolvedValue(content(currentContentVersion, [])));

    await expect(
      service.read({
        expectedContentVersion,
        fortuneDate,
        lookId: look.lookId,
      }),
    ).resolves.toEqual({
      currentContentVersion,
      expectedContentVersion,
      kind: "version_changed",
    });
  });

  it("returns missing only when the active version matches and has no requested look", async () => {
    const service = serviceWith(vi.fn().mockResolvedValue(content(currentContentVersion, [])));

    await expect(
      service.read({
        expectedContentVersion: currentContentVersion,
        fortuneDate,
        lookId: "look-missing-01",
      }),
    ).resolves.toEqual({ kind: "missing" });
  });

  it("observes an active pointer switch as complete snapshots across separate requests", async () => {
    const reader = vi
      .fn()
      .mockResolvedValueOnce(content(expectedContentVersion, [look]))
      .mockResolvedValueOnce(content(currentContentVersion, []));
    const service = serviceWith(reader);
    const request = {
      expectedContentVersion,
      fortuneDate,
      lookId: look.lookId,
    };

    await expect(service.read(request)).resolves.toMatchObject({
      body: {
        contentVersion: expectedContentVersion,
        look,
      },
      kind: "ready",
    });
    await expect(service.read(request)).resolves.toEqual({
      currentContentVersion,
      expectedContentVersion,
      kind: "version_changed",
    });
    expect(reader).toHaveBeenCalledTimes(2);
  });
});
