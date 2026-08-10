import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PingCardData } from "../lib/today";
import { PingColorCard } from "./ping-color-card";

const ping = {
  algorithmLabel: "平",
  colors: [
    { colorCode: "white", name: "白色" },
    { colorCode: "ivory", name: "乳白" },
    { colorCode: "silver", name: "银色" },
    { colorCode: "gold", name: "金色" },
    { colorCode: "light_family", name: "浅色系" },
  ],
  contentVersion: "fd-20260715-r1",
  displayLabel: "日常可穿",
  element: "metal",
  elementLabel: "金",
  explanation: "适合作为日常穿搭参考。",
  rank: 3,
  relationText: "金克木",
  tierCode: "ping",
} satisfies PingCardData;

describe("PingColorCard", () => {
  it("shows the published third tier and complete color order", () => {
    render(<PingColorCard tier={ping} />);

    const card = screen.getByRole("article", { name: "日常可穿" });
    expect(card).toHaveClass("decision-card--tertiary");
    expect(card).toHaveAttribute("data-content-version", "fd-20260715-r1");
    expect(screen.getByText("03")).toBeVisible();
    expect(screen.getByText("平")).toBeVisible();
    expect(screen.getByText("日常可穿")).toBeVisible();
    expect(screen.getByText("金", { selector: "strong" })).toBeVisible();
    expect(screen.queryByText("金克木")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "白色",
      "乳白",
      "银色",
      "金色",
      "浅色系",
    ]);
  });

  it("gives every reviewed pale color a persistent visible border", () => {
    render(<PingColorCard tier={ping} />);

    for (const colorCode of ["white", "ivory", "silver", "light_family"]) {
      expect(screen.getByTestId(`color-dot-${colorCode}`)).toHaveClass("color-swatch__dot--light");
    }
    expect(screen.getByTestId("color-dot-gold")).not.toHaveClass("color-swatch__dot--light");
  });

  it("adds no negative, exaggerated, sales or unfinished copy", () => {
    render(<PingColorCard tier={ping} />);

    expect(
      screen.queryByText(/运势平平|勉强|较差|不推荐|保证|好运|转运|购买|即将上线/u),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
