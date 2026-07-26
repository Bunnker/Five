import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DaJiCardData } from "../lib/today";
import { DaJiColorCard } from "./da-ji-color-card";

const daJi = {
  algorithmLabel: "大吉",
  colors: [
    { colorCode: "purple", name: "紫色" },
    { colorCode: "red", name: "红色" },
    { colorCode: "orange", name: "橙色" },
  ],
  contentVersion: "fd-20260724-r1",
  displayLabel: "今日优先",
  element: "fire",
  elementLabel: "火",
  explanation: "今日木日，木生火，火为大吉。",
  rank: 1,
  relationText: "木生火",
} satisfies DaJiCardData;

describe("DaJiColorCard", () => {
  it("shows the published tier labels, element and complete color order", () => {
    render(<DaJiColorCard tier={daJi} />);

    expect(screen.getByText("01")).toBeVisible();
    expect(screen.getByText("大吉")).toBeVisible();
    expect(screen.getByText("今日优先")).toBeVisible();
    expect(screen.getByText("火")).toBeVisible();
    expect(screen.getByText("木生火")).toBeVisible();

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "紫色",
      "红色",
      "橙色",
    ]);
  });

  it("uses the reviewed presentation color without changing the published Chinese name", () => {
    render(<DaJiColorCard tier={daJi} />);

    expect(screen.getByTestId("color-dot-purple")).toHaveStyle({
      "--swatch-color": "#8b5a91",
    });
    expect(screen.getByTestId("color-dot-red")).toHaveStyle({
      "--swatch-color": "#c63d32",
    });
    expect(screen.getByText("紫色")).toBeVisible();
    expect(screen.getByText("红色")).toBeVisible();
  });

  it("keeps pale colors visible with a border", () => {
    const metalTier = {
      ...daJi,
      colors: [
        { colorCode: "white", name: "白色" },
        { colorCode: "ivory", name: "乳白" },
      ],
      element: "metal",
      elementLabel: "金",
    } satisfies DaJiCardData;

    render(<DaJiColorCard tier={metalTier} />);

    expect(screen.getByTestId("color-dot-white")).toHaveClass("color-swatch__dot--light");
    expect(screen.getByTestId("color-dot-ivory")).toHaveClass("color-swatch__dot--light");
  });

  it("does not add a promise, purchase or unfinished action", () => {
    render(<DaJiColorCard tier={daJi} />);

    expect(screen.queryByText(/保证|好运|转运|贵人|助运|购买|即将上线/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
