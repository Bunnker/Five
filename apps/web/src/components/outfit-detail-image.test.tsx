import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { LookDetailImageData } from "../lib/look-detail";
import type { TodayImagePreviewItemData } from "../lib/today";
import { OutfitDetailImage } from "./outfit-detail-image";

const image = {
  aiDisclosure: "AI 生成穿搭示意图",
  aiGenerated: true,
  altText: "红色上衣、绿色下装和白色配饰的通勤穿搭细节",
  assetId: "asset-look-main-detail-01",
  height: 1600,
  mediaType: "image/webp",
  url: "https://cdn.five.test/assets/fd-20260715-r1/main-detail-a1b2c3.webp",
  width: 1200,
} satisfies LookDetailImageData;

const items = [
  { categoryLabel: "上衣", color: { colorCode: "red", name: "红色" } },
  { categoryLabel: "下装", color: { colorCode: "green", name: "绿色" } },
  { categoryLabel: "鞋包/配饰", color: { colorCode: "white", name: "白色" } },
] satisfies TodayImagePreviewItemData[];

describe("OutfitDetailImage", () => {
  it("keeps the caption, original disclosure, and version when one detail image fails", () => {
    render(
      <OutfitDetailImage
        caption="通勤主图"
        contentVersion="fd-20260715-r1"
        eager
        image={image}
        items={items}
      />,
    );

    fireEvent.error(screen.getByRole("img"));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("通勤主图")).toBeVisible();
    const fallback = screen.getByRole("status");
    expect(within(fallback).getByRole("list", { name: "参考配色" })).toBeVisible();
    const metadata = within(fallback).getByRole("group", { name: "图片说明" });
    expect(metadata).toHaveTextContent("AI 生成穿搭示意图");
    expect(fallback).not.toHaveTextContent("fd-20260715-r1");
    expect(fallback).toHaveTextContent("图片暂时无法显示，请参考下方配色");
  });
});
