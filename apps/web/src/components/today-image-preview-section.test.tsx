import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { TodayImagePreviewSectionData } from "../lib/today";
import { TodayImagePreviewSection } from "./today-image-preview-section";

const section = {
  cards: [
    {
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
    },
    {
      aiDisclosure: "AI 生成穿搭示意图",
      altText: "橙色上衣和湖蓝下装的日常穿搭",
      assetId: "asset-look-alternate-cover",
      displayLabel: "替代方案",
      formulaId: "formula-dual-01",
      height: 1600,
      items: [
        { categoryLabel: "上衣", color: { colorCode: "orange", name: "橙色" } },
        { categoryLabel: "下装", color: { colorCode: "lake_blue", name: "湖蓝" } },
      ],
      lookId: "look-dual-01",
      mediaType: "image/webp",
      placement: "alternate",
      scenarioLabel: "日常",
      sortOrder: 2,
      title: "橙色与湖蓝日常方案",
      url: "https://cdn.five.test/assets/fd-20260715-r1/alternate-d4e5f6.webp",
      width: 1200,
    },
    {
      aiDisclosure: null,
      altText: "红橙同色系日常穿搭",
      assetId: "asset-look-supplemental-cover",
      displayLabel: "更多场景",
      formulaId: "formula-mono-01",
      height: 1600,
      items: [
        { categoryLabel: "上衣", color: { colorCode: "orange", name: "橙色" } },
        { categoryLabel: "下装", color: { colorCode: "red", name: "红色" } },
      ],
      lookId: "look-mono-01",
      mediaType: "image/webp",
      placement: "supplemental",
      scenarioLabel: "日常",
      sortOrder: 3,
      title: "红橙同色系日常方案",
      url: "https://cdn.five.test/assets/fd-20260715-r1/supplemental-g7h8i9.webp",
      width: 1200,
    },
  ],
  contentVersion: "fd-20260715-r1",
} satisfies TodayImagePreviewSectionData;

describe("TodayImagePreviewSection", () => {
  it("shows the two required images and the valid supplemental image with the same version", () => {
    render(<TodayImagePreviewSection section={section} />);

    const preview = screen.getByRole("region", { name: "今日图片示范" });
    const cards = within(preview).getAllByRole("article");
    expect(cards.map((card) => card.getAttribute("data-image-placement"))).toEqual([
      "primary",
      "alternate",
      "supplemental",
    ]);
    expect(cards.map((card) => card.getAttribute("data-content-version"))).toEqual([
      "fd-20260715-r1",
      "fd-20260715-r1",
      "fd-20260715-r1",
    ]);

    expect(within(cards[0]).getByText("主方案")).toBeVisible();
    expect(within(cards[1]).getByText("替代方案")).toBeVisible();
    expect(within(cards[2]).getByText("更多场景")).toBeVisible();
    expect(within(cards[0]).getByRole("img")).toHaveAttribute(
      "alt",
      "红色上衣、绿色下装和白色配饰的通勤穿搭",
    );
    expect(within(cards[0]).getByText("AI 生成穿搭示意图")).toBeVisible();
    expect(within(cards[1]).getByText("AI 生成穿搭示意图")).toBeVisible();
    expect(within(cards[2]).queryByText(/AI 生成/u)).not.toBeInTheDocument();
    expect(within(preview).queryByRole("link")).not.toBeInTheDocument();
    expect(within(preview).queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not add a blank placeholder when only the two required images exist", () => {
    render(
      <TodayImagePreviewSection
        section={{
          ...section,
          cards: section.cards.slice(0, 2),
        }}
      />,
    );

    const preview = screen.getByRole("region", { name: "今日图片示范" });
    expect(within(preview).getAllByRole("article")).toHaveLength(2);
    expect(preview).not.toHaveTextContent(/待补充|敬请期待|暂无图片/u);
  });

  it("replaces only the failed image with a reviewed color card and keeps the other image", () => {
    render(<TodayImagePreviewSection section={section} />);

    const mainCard = screen.getByRole("article", { name: "木日通勤主方案" });
    const alternateCard = screen.getByRole("article", { name: "橙色与湖蓝日常方案" });
    fireEvent.error(within(mainCard).getByRole("img"));

    expect(within(mainCard).queryByRole("img")).not.toBeInTheDocument();
    expect(within(mainCard).getByRole("status")).toHaveTextContent("已切换为配色示意");
    expect(within(mainCard).getByText("上衣")).toBeVisible();
    expect(within(mainCard).getByText("红色")).toBeVisible();
    expect(within(mainCard).getByText("下装")).toBeVisible();
    expect(within(mainCard).getByText("绿色")).toBeVisible();
    expect(within(mainCard).getByText("鞋包/配饰")).toBeVisible();
    expect(within(mainCard).getByText("白色")).toBeVisible();
    expect(within(mainCard).getByTestId("today-image-dot-white")).toHaveClass(
      "today-image-color__dot--light",
    );
    expect(within(mainCard).getByTestId("image-fallback-swatch-white")).toHaveClass(
      "today-image-fallback__swatch--light",
    );
    expect(within(mainCard).queryByText("AI 生成穿搭示意图")).not.toBeInTheDocument();
    expect(within(alternateCard).getByRole("img")).toBeVisible();
  });

  it("detects an image that failed before the page finished attaching its error handler", () => {
    const completeSpy = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockImplementation(function (this: HTMLImageElement) {
        return this.alt.startsWith("红色");
      });
    const naturalWidthSpy = vi
      .spyOn(HTMLImageElement.prototype, "naturalWidth", "get")
      .mockImplementation(function (this: HTMLImageElement) {
        return this.alt.startsWith("红色") ? 0 : 1200;
      });

    render(<TodayImagePreviewSection section={section} />);

    const mainCard = screen.getByRole("article", { name: "木日通勤主方案" });
    const alternateCard = screen.getByRole("article", { name: "橙色与湖蓝日常方案" });
    expect(within(mainCard).queryByRole("img")).not.toBeInTheDocument();
    expect(within(mainCard).getByRole("status")).toHaveTextContent("已切换为配色示意");
    expect(within(alternateCard).getByRole("img")).toBeVisible();

    completeSpy.mockRestore();
    naturalWidthSpy.mockRestore();
  });

  it("tries a new image when the same look is republished with a new asset", () => {
    const { rerender } = render(<TodayImagePreviewSection section={section} />);
    const originalCard = screen.getByRole("article", { name: "木日通勤主方案" });
    fireEvent.error(within(originalCard).getByRole("img"));
    expect(within(originalCard).getByRole("status")).toBeVisible();

    const nextSection = {
      ...section,
      cards: [
        {
          ...section.cards[0],
          assetId: "asset-look-main-cover-v2",
          url: "https://cdn.five.test/assets/fd-20260715-r2/main-v2.webp",
        },
        ...section.cards.slice(1),
      ],
      contentVersion: "fd-20260715-r2",
    } satisfies TodayImagePreviewSectionData;
    rerender(<TodayImagePreviewSection section={nextSection} />);

    const republishedCard = screen.getByRole("article", { name: "木日通勤主方案" });
    expect(within(republishedCard).queryByRole("status")).not.toBeInTheDocument();
    expect(within(republishedCard).getByRole("img")).toHaveAttribute(
      "src",
      "https://cdn.five.test/assets/fd-20260715-r2/main-v2.webp",
    );
  });
});
