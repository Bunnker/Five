import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TodayImagePreviewCardData } from "../lib/today";
import { OutfitOverviewImage } from "./outfit-overview-image";

const card = {
  aiDisclosure: "AI 生成穿搭示意图",
  altText: "红色上衣、绿色下装和白色配饰的通勤穿搭",
  assetId: "asset-look-main-cover",
  displayLabel: "主方案",
  formulaId: "formula-triple-01",
  height: 1600,
  items: [
    { categoryLabel: "上衣", color: { colorCode: "red", name: "红色" } },
    { categoryLabel: "下装", color: { colorCode: "green", name: "绿色" } },
    { categoryLabel: "鞋包/配饰", color: { colorCode: "white", name: "白色" } },
  ],
  lookId: "look-triple-01",
  mediaType: "image/webp",
  placement: "primary",
  scenarioLabel: "通勤",
  sortOrder: 1,
  title: "木日通勤主方案",
  url: "https://cdn.five.test/assets/fd-20260715-r1/main-a1b2c3.webp",
  width: 1200,
} satisfies TodayImagePreviewCardData;

describe("OutfitOverviewImage", () => {
  it("replaces an unavailable reviewed image with its reviewed color summary", () => {
    render(<OutfitOverviewImage card={card} contentVersion="fd-20260715-r1" eager />);

    fireEvent.error(
      screen.getByRole("img", {
        name: "红色上衣、绿色下装和白色配饰的通勤穿搭",
      }),
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已切换为配色示意");
    expect(screen.getByRole("status")).toHaveTextContent("图片暂时无法显示");
    expect(screen.getByTestId("reviewed-image-fallback-red")).toBeVisible();
    expect(screen.getByTestId("reviewed-image-fallback-green")).toBeVisible();
    expect(screen.getByTestId("reviewed-image-fallback-white")).toHaveClass(
      "reviewed-image-fallback__swatch--light",
    );
    expect(screen.getByText("红色")).toBeVisible();
    expect(screen.getByText("绿色")).toBeVisible();
    expect(screen.getByText("白色")).toBeVisible();
    const fallbackMetadata = screen.getByRole("group", { name: "图片失败信息" });
    expect(fallbackMetadata).toHaveTextContent("原图说明 · AI 生成穿搭示意图");
    expect(fallbackMetadata).toHaveTextContent("内容版本 · fd-20260715-r1");
    expect(screen.getByRole("status")).toHaveTextContent("当前仅显示已审核配色，未使用替换图片");
  });

  it("retries when navigation supplies a different reviewed image", () => {
    const { rerender } = render(
      <OutfitOverviewImage card={card} contentVersion="fd-20260715-r1" eager />,
    );
    fireEvent.error(screen.getByRole("img"));

    rerender(
      <OutfitOverviewImage
        card={{
          ...card,
          assetId: "asset-look-main-cover-v2",
          url: "https://cdn.five.test/assets/fd-20260715-r1/main-v2.webp",
        }}
        contentVersion="fd-20260715-r1"
        eager
      />,
    );

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://cdn.five.test/assets/fd-20260715-r1/main-v2.webp",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("retries the same asset when a new content version is served", () => {
    const { rerender } = render(
      <OutfitOverviewImage card={card} contentVersion="fd-20260715-r1" eager />,
    );
    fireEvent.error(screen.getByRole("img"));

    rerender(<OutfitOverviewImage card={card} contentVersion="fd-20260715-r2" eager />);

    expect(screen.getByRole("img")).toHaveAttribute("src", card.url);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps compact version metadata without inventing an AI label for a non-AI image", () => {
    const contentVersion = "fd-20260715-reviewed-version-with-a-long-opaque-suffix";
    render(
      <OutfitOverviewImage
        card={{ ...card, aiDisclosure: null }}
        contentVersion={contentVersion}
        eager
      />,
    );
    fireEvent.error(screen.getByRole("img"));

    const fallback = screen.getByRole("status");
    const metadata = screen.getByRole("group", { name: "图片失败信息" });
    expect(fallback).toHaveAttribute("data-content-version", contentVersion);
    expect(metadata).toHaveTextContent(`内容版本 · ${contentVersion}`);
    expect(metadata).not.toHaveTextContent("原图说明");
    expect(fallback).not.toHaveTextContent(/AI/u);
  });
});
