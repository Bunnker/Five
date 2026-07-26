import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CiJiCardData } from "../lib/today";
import { CiJiColorCard } from "./ci-ji-color-card";

const ciJi = {
  algorithmLabel: "次吉",
  colors: [
    { colorCode: "lake_blue", name: "湖蓝" },
    { colorCode: "green", name: "绿色" },
    { colorCode: "cyan", name: "青色" },
    { colorCode: "emerald", name: "翠色" },
    { colorCode: "light_green_family", name: "浅绿系" },
  ],
  contentVersion: "fd-20260724-r1",
  displayLabel: "稳妥选择",
  element: "wood",
  elementLabel: "木",
  explanation: "与今日五行相同，作为稳妥选择。",
  rank: 2,
  relationText: "木与木同类",
  tierCode: "ci_ji",
} satisfies CiJiCardData;

describe("CiJiColorCard", () => {
  it("shows the published secondary tier without changing its color order", () => {
    render(<CiJiColorCard tier={ciJi} />);

    const card = screen.getByRole("article", { name: "稳妥选择" });
    expect(card).toHaveClass("decision-card--secondary");
    expect(card).toHaveAttribute("data-content-version", "fd-20260724-r1");
    expect(screen.getByText("02")).toBeVisible();
    expect(screen.getByText("次吉")).toBeVisible();
    expect(screen.getByText("稳妥选择")).toBeVisible();
    expect(screen.getByText("木")).toBeVisible();
    expect(screen.getByText("木与木同类")).toBeVisible();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "湖蓝",
      "绿色",
      "青色",
      "翠色",
      "浅绿系",
    ]);
  });

  it("keeps color dots and Chinese names together and adds no sales action", () => {
    render(<CiJiColorCard tier={ciJi} />);

    expect(screen.getByTestId("color-dot-lake_blue")).toBeVisible();
    expect(screen.getByText("湖蓝")).toBeVisible();
    expect(screen.queryByText(/购买|转运|好运|即将上线/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
