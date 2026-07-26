import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("Five P0 visual foundation", () => {
  it("renders the reusable paper, card and numbered-band samples", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "Five P0 视觉基础" })).toBeVisible();
    expect(screen.getByText("01")).toBeVisible();
    expect(screen.getByText("02")).toBeVisible();
    expect(screen.getByText("03")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看色彩样本" })).toBeVisible();
  });

  it("shows a Chinese name for every sample color and marks pale colors for a border", () => {
    render(<HomePage />);

    for (const colorName of ["红色", "橙色", "绿色", "湖蓝", "白色", "乳白"]) {
      expect(screen.getByText(colorName)).toBeVisible();
    }

    expect(screen.getByTestId("color-dot-white")).toHaveClass("color-swatch__dot--light");
    expect(screen.getByTestId("color-dot-ivory")).toHaveClass("color-swatch__dot--light");
  });

  it("does not render product areas that are outside P0", () => {
    render(<HomePage />);

    for (const forbiddenLabel of ["底部导航", "历史", "出生信息", "个人五行", "账户"]) {
      expect(screen.queryByText(forbiddenLabel)).not.toBeInTheDocument();
    }
  });
});
