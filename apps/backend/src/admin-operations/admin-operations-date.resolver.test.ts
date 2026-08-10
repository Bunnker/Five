import { describe, expect, it } from "vitest";

import { RequestContextResolver, type Clock } from "../request-context/request-context-resolver";
import { AdminOperationsDateResolver } from "./admin-operations-date.resolver";

class FixedClock implements Clock {
  constructor(private readonly instant: string) {}

  now(): Date {
    return new Date(this.instant);
  }
}

function resolverAt(instant: string): AdminOperationsDateResolver {
  return new AdminOperationsDateResolver(new RequestContextResolver(new FixedClock(instant)));
}

describe("AdminOperationsDateResolver", () => {
  it("delegates the current business date to the injected request-context resolver", () => {
    expect(resolverAt("2026-08-06T15:00:00.000Z").resolveCurrent().fortuneDate).toBe("2026-08-07");
  });

  it("builds a stable Shanghai-noon context for a backend-provided fortune date", () => {
    const resolver = resolverAt("2026-07-01T00:00:00.000Z");

    expect(resolver.resolveForFortuneDate("2026-08-07")).toEqual({
      civilDate: "2026-08-07",
      crossedDayBoundary: false,
      dayBoundary: "23:00",
      fortuneDate: "2026-08-07",
      responseGeneratedAt: "2026-08-07T12:00:00+08:00",
      shichen: "午",
      timezone: "Asia/Shanghai",
    });
    expect(() => resolver.resolveForFortuneDate("2026-02-29")).toThrow(RangeError);
  });

  it("owns date shifting and weekday lookup without depending on the process timezone", () => {
    const resolver = resolverAt("2026-07-01T00:00:00.000Z");

    expect(resolver.shiftFortuneDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(resolver.shiftFortuneDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(resolver.weekdayIndex("2026-08-01")).toBe(6);
  });

  it("reuses request-context formatting for instants and PostgreSQL Date values", () => {
    const resolver = resolverAt("2026-07-01T00:00:00.000Z");

    expect(resolver.formatInstant(new Date("2026-08-06T10:00:00.000Z"))).toBe(
      "2026-08-06T18:00:00+08:00",
    );
    expect(resolver.formatShanghaiDate(new Date("2026-08-06T16:30:00.000Z"))).toBe("2026-08-07");
  });
});
