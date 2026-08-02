import { describe, expect, it } from "vitest";

import {
  formatAdminDateTime,
  formatAdminDateTimeWithYear,
  shanghaiLocalDateTimeToIso,
} from "./admin-date-time";

describe("admin date-time", () => {
  it("formats stored instants in Asia/Shanghai", () => {
    expect(formatAdminDateTime("2026-07-31T12:00:00.000Z")).toContain("20:00");
    expect(formatAdminDateTimeWithYear("2026-07-31T12:00:00.000Z")).toContain("2026");
  });

  it("interprets datetime-local input as Asia/Shanghai independent of the device zone", () => {
    expect(shanghaiLocalDateTimeToIso("2026-07-31T20:00")).toBe("2026-07-31T12:00:00.000Z");
  });

  it("rejects malformed and impossible local times", () => {
    expect(shanghaiLocalDateTimeToIso("2026-02-30T20:00")).toBeNull();
    expect(shanghaiLocalDateTimeToIso("2026-07-31 20:00")).toBeNull();
  });
});
