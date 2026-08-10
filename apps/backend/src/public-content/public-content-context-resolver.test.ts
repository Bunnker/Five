import { describe, expect, it } from "vitest";

import { RequestContextResolver } from "../request-context/request-context-resolver";
import { PublicContentContextResolver } from "./public-content-context-resolver";

function resolveAt(instant: string) {
  const requestContext = new RequestContextResolver({ now: () => new Date(instant) }).resolve();
  return {
    publicContentContext: new PublicContentContextResolver().resolve(requestContext),
    requestContext,
  };
}

describe("PublicContentContextResolver", () => {
  it.each([
    ["2026-08-06T17:59:59+08:00", "2026-08-06", false, "2026-08-06"],
    ["2026-08-06T18:00:00+08:00", "2026-08-07", true, "2026-08-06"],
    ["2026-08-06T22:59:59+08:00", "2026-08-07", true, "2026-08-06"],
    ["2026-08-06T23:00:00+08:00", "2026-08-07", true, "2026-08-07"],
    ["2026-08-06T23:59:59+08:00", "2026-08-07", true, "2026-08-07"],
    ["2026-08-07T00:00:00+08:00", "2026-08-07", false, "2026-08-07"],
    ["2026-08-07T17:59:59+08:00", "2026-08-07", false, "2026-08-07"],
    ["2026-08-07T18:00:00+08:00", "2026-08-08", true, "2026-08-07"],
  ])(
    "serves %s at the public boundary without changing the 23:00 fortune date",
    (instant, servedFortuneDate, advancedFromCivilDate, internalFortuneDate) => {
      const result = resolveAt(instant);

      expect(result.publicContentContext).toEqual({
        advancedFromCivilDate,
        servedFortuneDate,
        switchBoundary: "18:00",
      });
      expect(result.requestContext.fortuneDate).toBe(internalFortuneDate);
      expect(result.requestContext.dayBoundary).toBe("23:00");
    },
  );

  it("rejects a context whose civil date is not tied to its response instant", () => {
    const requestContext = resolveAt("2026-08-06T18:00:00+08:00").requestContext;

    expect(() =>
      new PublicContentContextResolver().resolve({
        ...requestContext,
        civilDate: "2026-08-05",
      }),
    ).toThrow(/civilDate/u);
  });
});
