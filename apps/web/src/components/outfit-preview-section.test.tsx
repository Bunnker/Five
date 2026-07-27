import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OutfitPreviewSectionData } from "../lib/today";
import { OutfitPreviewSection } from "./outfit-preview-section";

const section = {
  cards: [
    {
      description: "同色系深浅变化属于穿搭参考。",
      formulaId: "formula-mono-01",
      href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-mono-01",
      kind: "mono",
      scenarioLabel: "日常",
      slots: [
        {
          colors: [
            { colorCode: "red", name: "红色" },
            { colorCode: "orange", name: "橙色" },
          ],
          ratioPercent: 100,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
      ],
      title: "红橙同色系",
    },
    {
      description: "双色比例未确认时不编造百分比。",
      formulaId: "formula-dual-01",
      href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-dual-01",
      kind: "dual",
      scenarioLabel: "日常",
      slots: [
        {
          colors: [{ colorCode: "orange", name: "橙色" }],
          ratioPercent: null,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
        {
          colors: [{ colorCode: "lake_blue", name: "湖蓝" }],
          ratioPercent: null,
          role: "secondary",
          roleLabel: "辅助色",
          tierCode: "ci_ji",
        },
      ],
      title: "橙色与湖蓝",
    },
    {
      description: "60/30/10 为穿搭参考，不是五行推算规则。",
      formulaId: "formula-triple-01",
      href: "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-triple-01",
      kind: "triple",
      scenarioLabel: "通勤",
      slots: [
        {
          colors: [{ colorCode: "red", name: "红色" }],
          ratioPercent: 60,
          role: "primary",
          roleLabel: "主色",
          tierCode: "da_ji",
        },
        {
          colors: [{ colorCode: "green", name: "绿色" }],
          ratioPercent: 30,
          role: "secondary",
          roleLabel: "辅助色",
          tierCode: "ci_ji",
        },
        {
          colors: [{ colorCode: "white", name: "白色" }],
          ratioPercent: 10,
          role: "accent",
          roleLabel: "点缀色",
          tierCode: "ping",
        },
      ],
      title: "通勤三色搭配",
    },
  ],
  contentVersion: "fd-20260715-r1",
} satisfies OutfitPreviewSectionData;

describe("OutfitPreviewSection", () => {
  it("shows three actionable summaries in the fixed mono, dual and triple order", () => {
    render(<OutfitPreviewSection section={section} />);

    const preview = screen.getByRole("region", { name: "今日怎么搭" });
    const links = within(preview).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("data-outfit-kind"))).toEqual([
      "mono",
      "dual",
      "triple",
    ]);
    expect(links.map((link) => link.getAttribute("data-content-version"))).toEqual([
      "fd-20260715-r1",
      "fd-20260715-r1",
      "fd-20260715-r1",
    ]);
    expect(links[0]).toHaveAccessibleName("查看单色穿法：红橙同色系");
    expect(links[1]).toHaveAccessibleName("查看双色穿法：橙色与湖蓝");
    expect(links[2]).toHaveAccessibleName("查看三色穿法：通勤三色搭配");
    expect(links[2]).toHaveAttribute(
      "href",
      "/outfits?fortuneDate=2026-07-15&expectedContentVersion=fd-20260715-r1&formulaId=formula-triple-01",
    );
  });

  it("keeps Chinese names, dots, confirmed ratios and the three explicit roles visible", () => {
    render(<OutfitPreviewSection section={section} />);

    const preview = screen.getByRole("region", { name: "今日怎么搭" });
    expect(within(preview).getAllByText("红色")).toHaveLength(2);
    expect(within(preview).getAllByText("橙色")).toHaveLength(2);
    expect(within(preview).getByText("湖蓝")).toBeVisible();
    expect(within(preview).getByText("绿色")).toBeVisible();
    expect(within(preview).getByText("白色")).toBeVisible();

    expect(screen.getAllByTestId("outfit-color-dot-red")).toHaveLength(2);
    expect(screen.getByTestId("outfit-color-dot-white")).toHaveClass(
      "outfit-preview-color__dot--light",
    );
    expect(within(preview).getByText("100%")).toBeVisible();
    expect(within(preview).getByText("60%")).toBeVisible();
    expect(within(preview).getByText("30%")).toBeVisible();
    expect(within(preview).getByText("10%")).toBeVisible();
    expect(within(preview).queryByText("null")).not.toBeInTheDocument();
    expect(within(preview).queryByText("0%")).not.toBeInTheDocument();

    const triple = linksByKind(preview, "triple");
    expect(within(triple).getByText("主色")).toBeVisible();
    expect(within(triple).getByText("辅助色")).toBeVisible();
    expect(within(triple).getByText("点缀色")).toBeVisible();
    expect(preview).toHaveTextContent("比例为穿搭参考，不是五行推算规则");
  });

  it("does not add images, purchasing, accounts or future product entry points", () => {
    render(<OutfitPreviewSection section={section} />);

    const preview = screen.getByRole("region", { name: "今日怎么搭" });
    expect(within(preview).queryByRole("img")).not.toBeInTheDocument();
    expect(within(preview).queryByRole("button")).not.toBeInTheDocument();
    expect(preview).not.toHaveTextContent(/收藏|购买|商品|吉祥物|登录|拍照试搭/u);
  });
});

function linksByKind(
  preview: HTMLElement,
  kind: OutfitPreviewSectionData["cards"][number]["kind"],
) {
  const link = within(preview)
    .getAllByRole("link")
    .find((candidate) => candidate.getAttribute("data-outfit-kind") === kind);

  if (link === undefined) {
    throw new Error(`Missing ${kind} preview link`);
  }
  return link;
}
