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
  it("shows one gentle attention region while preserving both published groups and color order", () => {
    const { container } = render(<AttentionColorSection section={section} />);

    const attention = screen.getByRole("region", { name: "注意" });
    expect(attention).toHaveAttribute("data-content-version", "fd-20260715-r1");
    expect(screen.getAllByRole("heading", { name: "注意" })).toHaveLength(1);
    expect(attention).not.toHaveTextContent(/较差|不利/u);
    expect(screen.queryByLabelText(/较差|不利/u)).not.toBeInTheDocument();

    expect(
      within(screen.getByRole("list", { name: "第一组颜色" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["黑色", "藏青", "宝蓝", "墨绿", "深灰系"]);
    expect(
      within(screen.getByRole("list", { name: "第二组颜色" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["黄色", "咖色", "棕色", "卡其", "褐色系"]);

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

    const attention = screen.getByRole("region", { name: "注意" });
    expect(within(attention).getByRole("heading", { name: "已经穿了注意色" })).toBeVisible();
    expect(attention).toHaveTextContent("可以用当日大吉色的普通配饰做小面积补充，不需要整套换衣。");
    expect(
      within(screen.getByRole("list", { name: "可选的小面积配饰" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["丝巾", "包", "鞋", "耳饰"]);

    expect(within(attention).queryByRole("link")).not.toBeInTheDocument();
    expect(within(attention).queryByRole("button")).not.toBeInTheDocument();
    expect(within(attention).queryByRole("alert")).not.toBeInTheDocument();
    expect(attention.querySelector('[aria-live="assertive"]')).not.toBeInTheDocument();
    expect(attention).not.toHaveTextContent(/化解|保证转运|查看穿法|详情|→|➜|›/u);
  });
});
