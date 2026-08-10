import { describe, expect, it } from "vitest";

import { PublicContentWindowResolver } from "./public-content-window-resolver";

describe("PublicContentWindowResolver", () => {
  it("defines one public day from the previous civil date at 18:00 until 18:00", () => {
    expect(new PublicContentWindowResolver().resolve("2026-08-07")).toEqual({
      effectiveFrom: "2026-08-06T18:00:00+08:00",
      effectiveTo: "2026-08-07T18:00:00+08:00",
      prepareBy: "2026-08-06T13:00:00+08:00",
      switchBoundary: "18:00",
    });
  });

  it("handles month, year, and leap-day boundaries without touching calendar goldens", () => {
    const resolver = new PublicContentWindowResolver();

    expect(resolver.resolve("2026-01-01").effectiveFrom).toBe("2025-12-31T18:00:00+08:00");
    expect(resolver.resolve("2028-02-29").effectiveFrom).toBe("2028-02-28T18:00:00+08:00");
    expect(() => resolver.resolve("2026-02-30")).toThrow(/Gregorian/u);
  });
});
