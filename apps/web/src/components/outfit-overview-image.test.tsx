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
    render(<OutfitOverviewImage card={card} eager />);

    fireEvent.error(
      screen.getByRole("img", {
        name: "红色上衣、绿色下装和白色配饰的通勤穿搭",
      }),
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已切换为配色示意");
    expect(screen.getByRole("status")).toHaveTextContent("图片暂时无法显示");
    expect(screen.getByTestId("outfit-overview-fallback-red")).toBeVisible();
    expect(screen.getByTestId("outfit-overview-fallback-green")).toBeVisible();
    expect(screen.getByTestId("outfit-overview-fallback-white")).toHaveClass(
      "outfit-overview-fallback__swatch--light",
    );
    expect(screen.queryByText("AI 生成穿搭示意图")).not.toBeInTheDocument();
  });
});
