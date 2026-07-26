import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("Five local start page", () => {
  it("shows that the web process is running without pretending the product is finished", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "Five 本地工程已启动" })).toBeVisible();
    expect(screen.getByText("当前只验证网页与服务能够正常运行。")).toBeVisible();
  });
});
