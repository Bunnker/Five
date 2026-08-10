import { describe, expect, it, vi } from "vitest";

import { PublicContentContextResolver } from "../public-content/public-content-context-resolver";
import { RequestContextResolver } from "../request-context/request-context-resolver";
import type { ContentProductionService } from "./content-production.service";
import { ContentProductionWorker } from "./content-production.worker";

describe("content production worker", () => {
  it("ensures a rolling 30-day window from the date served after 18:00", async () => {
    const ensureDay = vi.fn().mockResolvedValue({
      kind: "existing",
      production: {
        completedImageSlots: 0,
        draftId: "draft-existing",
        draftRevision: 1,
        fortuneDate: "2026-08-02",
        lastError: null,
        pendingImageSlots: 3,
        status: "generating",
        updatedAt: "2026-08-01T08:00:00.000Z",
      },
    });
    const service = { ensureDay, list: vi.fn() } as unknown as ContentProductionService;
    const worker = new ContentProductionWorker(
      service,
      new RequestContextResolver({ now: () => new Date("2026-08-02T18:00:00+08:00") }),
      new PublicContentContextResolver(),
    );

    const result = await worker.runWindow();

    expect(result).toEqual({ accepted: 0, existing: 30, failed: 0 });
    expect(ensureDay).toHaveBeenCalledTimes(30);
    expect(ensureDay.mock.calls[0]?.[0]).toMatchObject({ fortuneDate: "2026-08-03" });
    expect(ensureDay.mock.calls[29]?.[0]).toMatchObject({ fortuneDate: "2026-09-01" });
  });
});
