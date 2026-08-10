import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalDataControls } from "./local-data-controls";
import { ANALYTICS_ANONYMOUS_ID_KEY, ANALYTICS_OPT_OUT_KEY } from "../../lib/analytics";

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
    window.localStorage.setItem("five:today:v2:active", "cached");
    window.localStorage.setItem("five:today:v2:2026-07-15:r1", "snapshot");
    window.localStorage.setItem("unrelated", "keep");
    window.localStorage.setItem(ANALYTICS_ANONYMOUS_ID_KEY, "browser:existing-anonymous-id");
    window.localStorage.setItem(ANALYTICS_OPT_OUT_KEY, "true");
    window.sessionStorage.setItem("five:today:v2:pending-refresh-anchor", "123");
    window.sessionStorage.setItem("unrelated", "keep");
    render(<LocalDataControls />);

    fireEvent.click(screen.getByRole("button", { name: "清除本机 Five 数据" }));

    expect(window.localStorage.getItem("five:today:v2:active")).toBeNull();
    expect(window.localStorage.getItem("five:today:v2:2026-07-15:r1")).toBeNull();
    expect(window.sessionStorage.getItem("five:today:v2:pending-refresh-anchor")).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
    expect(window.localStorage.getItem(ANALYTICS_ANONYMOUS_ID_KEY)).toBeNull();
    expect(window.localStorage.getItem(ANALYTICS_OPT_OUT_KEY)).toBe("true");
    expect(window.sessionStorage.getItem("unrelated")).toBe("keep");
    expect(screen.getByRole("status")).toHaveTextContent("本机数据已清除");
  });

  it("lets this browser opt out without creating a replacement identifier", async () => {
    window.localStorage.setItem(ANALYTICS_ANONYMOUS_ID_KEY, "browser:existing-anonymous-id");
    render(<LocalDataControls />);

    fireEvent.click(await screen.findByRole("button", { name: "退出匿名使用统计" }));

    expect(window.localStorage.getItem(ANALYTICS_OPT_OUT_KEY)).toBe("true");
    expect(window.localStorage.getItem(ANALYTICS_ANONYMOUS_ID_KEY)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("这台浏览器已退出匿名使用统计");

    fireEvent.click(screen.getByRole("button", { name: "重新启用匿名使用统计" }));

    expect(window.localStorage.getItem(ANALYTICS_OPT_OUT_KEY)).toBeNull();
    expect(window.localStorage.getItem(ANALYTICS_ANONYMOUS_ID_KEY)).toBeNull();
  });
});
