import { describe, expect, it, vi } from "vitest";

import type { DailyContentResolutionReader } from "./daily-content-resolution.reader";
import { dailyContentResolutionReaderFor } from "./today.module";
import type { PublishedContentReader } from "./today-content.service";

describe("dailyContentResolutionReaderFor", () => {
  it("keeps a lifecycle-aware database reader so historical links get exact reasons", () => {
    const reader: PublishedContentReader & DailyContentResolutionReader = {
      findActiveByFortuneDate: vi.fn(),
      resolve: vi.fn(),
    };

    expect(dailyContentResolutionReaderFor(reader)).toBe(reader);
  });

  it("adapts readers that only expose the active public version", () => {
    const reader: PublishedContentReader = { findActiveByFortuneDate: vi.fn() };

    expect(dailyContentResolutionReaderFor(reader)).not.toBe(reader);
  });
});
