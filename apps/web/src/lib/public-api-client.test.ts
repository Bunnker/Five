import { describe, expect, it, vi } from "vitest";

import { resolvePublicRequestId } from "./public-api-client";

describe("resolvePublicRequestId", () => {
  it("keeps a valid incoming request identifier", () => {
    expect(resolvePublicRequestId(" request-issue-20 ")).toBe("request-issue-20");
  });

  it("replaces an unsafe incoming request identifier", () => {
    const requestId = resolvePublicRequestId("request\r\ninjected");

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(requestId).not.toContain("\r");
    expect(requestId).not.toContain("\n");
  });

  it("does not depend on a caller-provided random function", () => {
    const randomSpy = vi.spyOn(Math, "random");

    expect(resolvePublicRequestId(null)).toMatch(/^[0-9a-f-]{36}$/u);
    expect(randomSpy).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});
