import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Loading from "../app/loading";
import { TodayPageSkeleton } from "./today-page-skeleton";

describe("TodayPageSkeleton", () => {
  it("keeps the complete today-page rhythm without announcing placeholder content", () => {
    const { container } = render(<TodayPageSkeleton />);

    const main = screen.getByRole("main");
    expect(main).toHaveClass("page-shell");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main.querySelector(".today-masthead")).not.toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载今日内容");

    const sections = Array.from(main.querySelectorAll<HTMLElement>("[data-skeleton-section]"));
    expect(sections.map((section) => section.dataset.skeletonSection)).toEqual([
      "date",
      "tier-primary",
      "tier-secondary",
      "tier-tertiary",
      "attention",
      "outfits",
      "images",
      "next-steps",
    ]);
    expect(sections.every((section) => section.getAttribute("aria-hidden") === "true")).toBe(true);

    expect(container.querySelector("time")).toBeNull();
    expect(main).not.toHaveTextContent(/\d{4}年|红色|绿色|白色|黑色/u);
  });

  it("is the loading UI exposed by the home route", () => {
    render(<Loading />);

    expect(screen.getByRole("status")).toHaveTextContent("正在加载今日内容");
    expect(screen.getByRole("main").querySelector('[data-skeleton-section="date"]')).not.toBeNull();
  });
});
