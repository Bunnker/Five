import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HomePage from "./page";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  loadTodayResult: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("../lib/today", () => ({ loadTodayResult: mocks.loadTodayResult }));
vi.mock("../components/today-page-state", () => ({
  TodayPageState: ({ result }: { result: { kind: string } }) => (
    <main data-result-kind={result.kind}>homepage state</main>
  ),
}));

describe("HomePage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes the edge request id and the complete loader result to the client state boundary", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "x-request-id": "edge-request-123" }));
    mocks.loadTodayResult.mockResolvedValue({ kind: "refresh_failed", reason: "network" });

    render(await HomePage());

    expect(mocks.loadTodayResult).toHaveBeenCalledWith({ requestId: "edge-request-123" });
    expect(screen.getByRole("main")).toHaveAttribute("data-result-kind", "refresh_failed");
  });

  it("does not require an incoming request id", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    mocks.loadTodayResult.mockResolvedValue({ kind: "content_not_ready", retryAfterSeconds: null });

    render(await HomePage());

    expect(mocks.loadTodayResult).toHaveBeenCalledWith({ requestId: null });
    expect(screen.getByRole("main")).toHaveAttribute("data-result-kind", "content_not_ready");
  });
});
