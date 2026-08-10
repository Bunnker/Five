import type { components } from "@five/api-contract";
import { describe, expect, it, vi } from "vitest";

import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import type { DailyContentResolutionReader } from "./daily-content-resolution.reader";
import { DailyContentService } from "./daily-content.service";
import { TodayCachePolicy } from "./today-cache-policy";

type DailyContent = components["schemas"]["DailyContent"];

function serviceAt(instant: string, resolve: DailyContentResolutionReader["resolve"]) {
  return new DailyContentService(
    new RequestContextResolver({ now: () => new Date(instant) }),
    new PublicContentContextResolver(),
    { resolve },
    new TodayCachePolicy(),
  );
}

describe("DailyContentService", () => {
  it("anchors the 90-day public retention window to the date served at 18:00", async () => {
    const requestedFortuneDate = "2026-05-08";
    const content = {
      effectiveTo: "2026-08-07T18:00:00+08:00",
      fortuneDate: requestedFortuneDate,
      versions: { contentVersion: "content-retention-boundary" },
    } as DailyContent;
    const beforeResolve = vi.fn<DailyContentResolutionReader["resolve"]>().mockResolvedValue({
      content,
      kind: "ready",
      reason: "current",
    });
    const afterResolve = vi.fn<DailyContentResolutionReader["resolve"]>().mockResolvedValue({
      content,
      kind: "ready",
      reason: "current",
    });

    await expect(
      serviceAt("2026-08-06T17:59:59+08:00", beforeResolve).read({
        expectedContentVersion: null,
        fortuneDate: requestedFortuneDate,
      }),
    ).resolves.toMatchObject({ kind: "ready" });
    await expect(
      serviceAt("2026-08-06T18:00:00+08:00", afterResolve).read({
        expectedContentVersion: null,
        fortuneDate: requestedFortuneDate,
      }),
    ).resolves.toEqual({ kind: "expired" });
    expect(beforeResolve).toHaveBeenCalledOnce();
    expect(afterResolve).not.toHaveBeenCalled();
  });
});
