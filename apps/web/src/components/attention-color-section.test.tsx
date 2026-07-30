import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AttentionSectionData } from "../lib/today";
import { AttentionColorSection } from "./attention-color-section";

const section = {
  balanceSuggestion: {
    accessoryExamples: ["丝巾", "包", "鞋", "耳饰"],
    description: "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
    preferredTierCode: "da_ji",
    title: "已经穿了注意色",
  },
  contentVersion: "fd-20260715-r1",
  groups: [
    {
      algorithmLabel: "较差",
      colors: [
        { colorCode: "black", name: "黑色" },
        { colorCode: "navy", name: "藏青" },
        { colorCode: "royal_blue", name: "宝蓝" },
        { colorCode: "dark_green", name: "墨绿" },
        { colorCode: "dark_gray_family", name: "深灰系" },
      ],
      displayLabel: "注意",
      element: "water",
      elementLabel: "水",
      explanation: "今日建议降低大面积使用比例。",
      rank: 4,
      relationText: "水生木",
      tierCode: "jiao_cha",
    },
    {
      algorithmLabel: "不利",
      colors: [
        { colorCode: "yellow", name: "黄色" },
        { colorCode: "coffee", name: "咖色" },
        { colorCode: "brown", name: "棕色" },
        { colorCode: "khaki", name: "卡其" },
        { colorCode: "dark_brown_family", name: "褐色系" },
      ],
      displayLabel: "注意",
      element: "earth",
      elementLabel: "土",
      explanation: "今日建议减少使用。",
      rank: 5,
      relationText: "木克土",
      tierCode: "bu_li",
    },
  ],
} satisfies AttentionSectionData;

describe("AttentionColorSection", () => {
  it("shows the direct lower-tier labels while preserving both published groups and color order", () => {
    const { container } = render(<AttentionColorSection section={section} />);

    const lowerTiers = screen.getByRole("region", { name: "较差 · 不利" });
    expect(lowerTiers).toHaveAttribute("data-content-version", "fd-20260715-r1");
    expect(within(lowerTiers).getByRole("heading", { name: "较差" })).toBeVisible();
    expect(within(lowerTiers).getByRole("heading", { name: "不利" })).toBeVisible();
    expect(lowerTiers).not.toHaveTextContent("注意");

    expect(
      within(screen.getByRole("list", { name: "较差颜色" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["黑色", "藏青", "宝蓝", "墨绿", "深灰系"]);
    expect(
      within(screen.getByRole("list", { name: "不利颜色" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["黄色", "咖色", "棕色", "卡其", "褐色系"]);
    expect(lowerTiers).toHaveTextContent("今日建议降低大面积使用比例。");
    expect(lowerTiers).toHaveTextContent("今日建议减少使用。");

    expect(
      [...container.querySelectorAll<HTMLElement>("[data-tier-rank]")].map((group) => ({
        rank: group.dataset.tierRank,
        tierCode: group.dataset.tierCode,
      })),
    ).toEqual([
      { rank: "4", tierCode: "jiao_cha" },
      { rank: "5", tierCode: "bu_li" },
    ]);
  });

  it("shows the reviewed balance advice without creating a negative detail action", () => {
    render(<AttentionColorSection section={section} />);

    const lowerTiers = screen.getByRole("region", { name: "较差 · 不利" });
    expect(within(lowerTiers).getByRole("heading", { name: "用大吉色小配饰补充" })).toBeVisible();
    expect(lowerTiers).toHaveTextContent(
      "可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。",
    );
    expect(
      within(screen.getByRole("list", { name: "可选的小面积配饰" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["丝巾", "包", "鞋", "耳饰"]);

    expect(within(lowerTiers).queryByRole("link")).not.toBeInTheDocument();
    expect(within(lowerTiers).queryByRole("button")).not.toBeInTheDocument();
    expect(within(lowerTiers).queryByRole("alert")).not.toBeInTheDocument();
    expect(lowerTiers.querySelector('[aria-live="assertive"]')).not.toBeInTheDocument();
    expect(lowerTiers).not.toHaveTextContent(/化解|保证转运|查看穿法|详情|→|➜|›/u);
  });
});
