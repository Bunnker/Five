import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalDataControls } from "./local-data-controls";

describe("LocalDataControls", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("clears only Five today data from both browser storage areas", () => {
    window.localStorage.setItem("five:today:v1:active", "cached");
    window.localStorage.setItem("five:today:v1:2026-07-15:r1", "snapshot");
    window.localStorage.setItem("unrelated", "keep");
    window.sessionStorage.setItem("five:today:v1:pending-refresh-anchor", "123");
    window.sessionStorage.setItem("unrelated", "keep");
    render(<LocalDataControls />);

    fireEvent.click(screen.getByRole("button", { name: "清除本机 Five 数据" }));

    expect(window.localStorage.getItem("five:today:v1:active")).toBeNull();
    expect(window.localStorage.getItem("five:today:v1:2026-07-15:r1")).toBeNull();
    expect(window.sessionStorage.getItem("five:today:v1:pending-refresh-anchor")).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
    expect(window.sessionStorage.getItem("unrelated")).toBe("keep");
    expect(screen.getByRole("status")).toHaveTextContent("本机数据已清除");
  });
});
