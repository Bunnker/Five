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
    const fallbackMetadata = screen.getByRole("group", { name: "图片说明" });
    expect(fallbackMetadata).toHaveTextContent("AI 生成穿搭示意图");
    expect(screen.getByRole("status")).not.toHaveTextContent("fd-20260715-r1");
    expect(screen.getByRole("status")).toHaveTextContent("图片暂时无法显示，请参考下方配色");
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
    expect(fallback).toHaveAttribute("data-content-version", contentVersion);
    expect(screen.queryByRole("group", { name: "图片说明" })).not.toBeInTheDocument();
    expect(fallback).not.toHaveTextContent(contentVersion);
    expect(fallback).not.toHaveTextContent(/AI/u);
  });
});
