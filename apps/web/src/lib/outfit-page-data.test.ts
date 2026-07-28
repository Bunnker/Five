import { describe, expect, it } from "vitest";

import type { LookDetailData, LookDetailLoadResult } from "./look-detail";
import { resolveLookDetailSnapshot, type SelectedOutfit } from "./outfit-page-data";
import type { OutfitPreviewCardData, TodayImagePreviewCardData } from "./today";

const card = {
  description: "三色比例已由维护者确认。",
  formulaId: "formula-triple-01",
  href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-triple-01",
  kind: "triple",
  scenarioLabel: "通勤",
  slots: [
    {
      colors: [{ colorCode: "red", name: "红色" }],
      garmentParts: ["上衣"],
      ratioPercent: 60,
      role: "primary",
      roleLabel: "主色",
      tierCode: "da_ji",
    },
  ],
  title: "通勤三色搭配",
} satisfies OutfitPreviewCardData;

const preview = {
  aiDisclosure: "AI 生成穿搭示意图",
  altText: "红色针织上衣通勤穿搭",
  assetId: "asset-look-main-cover",
  displayLabel: "主方案",
  formulaId: "formula-triple-01",
  height: 1600,
  items: [{ categoryLabel: "上衣", color: { colorCode: "red", name: "红色" } }],
  lookId: "look-triple-01",
  mediaType: "image/webp",
  placement: "primary",
  scenarioLabel: "通勤",
  sortOrder: 1,
  title: "木日通勤主方案",
  url: "https://cdn.five.test/assets/fd-20260715-r1/main.webp",
  width: 1200,
} satisfies TodayImagePreviewCardData;

const selection = {
  cards: [card],
  contentVersion: "fd-20260715-r1",
  fortuneDate: "2026-07-15",
  imagesByFormula: new Map([[card.formulaId, preview]]),
  selectedCard: card,
  shareHref:
    "/share?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&channelId=organic",
  view: "plan",
} satisfies SelectedOutfit;

const detail = {
  alternatives: [],
  audienceLabel: "成人通用",
  contentVersion: "fd-20260715-r1",
  coverImage: {
    aiDisclosure: "AI 生成穿搭示意图",
    aiGenerated: true,
    altText: "红色针织上衣通勤穿搭",
    assetId: "asset-look-main-cover",
    height: 1600,
    mediaType: "image/webp",
    url: "https://cdn.five.test/assets/fd-20260715-r1/main.webp",
    width: 1200,
  },
  detailImages: [],
  formulaId: "formula-triple-01",
  fortuneDate: "2026-07-15",
  items: [
    {
      category: "top",
      categoryLabel: "上衣",
      colorCode: "red",
      description: "针织上衣",
    },
  ],
  lookId: "look-triple-01",
  scenarioLabel: "通勤",
  title: "木日通勤主方案",
} satisfies LookDetailData;

describe("resolveLookDetailSnapshot", () => {
  it("keeps a detail only when it belongs to the selected published snapshot", () => {
    const result = resolveLookDetailSnapshot(
      { detail, status: "ready" },
      "look-triple-01",
      selection,
    );

    expect(result).toEqual({ detail, status: "ready" });
  });

  it.each([
    ["content version", { contentVersion: "fd-20260715-r2" }],
    ["fortune date", { fortuneDate: "2026-07-16" }],
    ["formula", { formulaId: "formula-dual-01" }],
    ["look", { lookId: "look-other-01" }],
    ["scenario", { scenarioLabel: "日常" }],
    [
      "cover asset",
      {
        coverImage: {
          ...detail.coverImage,
          assetId: "asset-from-another-look",
        },
      },
    ],
    [
      "item set",
      {
        items: [
          ...detail.items,
          {
            category: "accessory" as const,
            categoryLabel: "配饰",
            colorCode: "red" as const,
            description: "耳饰",
          },
        ],
      },
    ],
  ])("rejects a detail with a mismatched %s", (_label, replacement) => {
    const result = resolveLookDetailSnapshot(
      {
        detail: { ...detail, ...replacement },
        status: "ready",
      } satisfies LookDetailLoadResult,
      "look-triple-01",
      selection,
    );

    expect(result).toEqual({ status: "invalid" });
  });
});
