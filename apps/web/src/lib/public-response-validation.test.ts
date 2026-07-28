import { describe, expect, it } from "vitest";

import {
  parsePublicImage,
  parseUniquePublicImages,
  publicImageResourceIdentity,
} from "./public-response-validation";

const image = {
  aiDisclosure: "AI 生成穿搭示意图",
  aiGenerated: true,
  altText: "红色针织上衣通勤穿搭",
  assetId: "asset-main-01",
  height: 1600,
  mediaType: "image/webp",
  url: "https://cdn.five.test/assets/main.webp#preview",
  width: 1200,
};

describe("public response validation", () => {
  it("parses one reviewed public image with the required visible AI disclosure", () => {
    expect(parsePublicImage(image)).toEqual(image);
  });

  it.each([
    ["a missing AI disclosure", { ...image, aiDisclosure: null }],
    ["a credentialed URL", { ...image, url: "https://user:secret@cdn.five.test/main.webp" }],
    ["unsafe public copy", { ...image, altText: "购买这套商品" }],
  ])("rejects %s", (_label, candidate) => {
    expect(parsePublicImage(candidate)).toBeNull();
  });

  it("rejects duplicate assets and URLs across a public image list", () => {
    expect(
      parseUniquePublicImages([image, { ...image, assetId: "asset-detail-01" }], 4),
    ).toBeNull();
    expect(
      parseUniquePublicImages(
        [
          image,
          {
            ...image,
            assetId: "asset-detail-01",
            url: "https://cdn.five.test/assets/detail.webp",
          },
        ],
        4,
      ),
    ).toHaveLength(2);
  });

  it("compares image URLs without fragments", () => {
    expect(publicImageResourceIdentity(image.url)).toBe("https://cdn.five.test/assets/main.webp");
  });
});
