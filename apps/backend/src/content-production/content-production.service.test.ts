import { describe, expect, it } from "vitest";

import { InMemoryContentProductionStore } from "./in-memory-content-production.store";
import { AutomaticContentProductionService } from "./content-production.service";

describe("automatic content production", () => {
  it("returns the same generated draft when a date is ensured more than once", async () => {
    const store = new InMemoryContentProductionStore();
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
      {
        nextDraftId: () => "auto-draft-1",
        nextImageJobId: (slot) => `image-job-${slot}`,
      },
    );

    const first = await service.ensureDay({
      actorId: "admin-1",
      fortuneDate: "2026-08-02",
      idempotencyKey: "generate-2026-08-02-once",
      requestId: "production-request-1",
    });
    const repeated = await service.ensureDay({
      actorId: "system-worker",
      fortuneDate: "2026-08-02",
      idempotencyKey: "generate-2026-08-02-retry",
      requestId: "production-request-2",
    });

    expect(first).toMatchObject({
      kind: "accepted",
      production: {
        completedImageSlots: 0,
        draftId: "auto-draft-1",
        imageSlots: [
          { imageSlot: "required_primary", status: "pending" },
          { imageSlot: "required_alternative", status: "pending" },
          { imageSlot: "optional", status: "not_requested" },
        ],
        optionalImageStatus: "not_requested",
        pendingImageSlots: 2,
        requiredGenerationComplete: false,
      },
    });
    expect(repeated).toEqual({
      kind: "existing",
      production: first.kind === "accepted" ? first.production : undefined,
    });
    expect(await service.list()).toEqual({
      items: [first.kind === "accepted" ? first.production : undefined],
    });
  });

  it("rejects a new image generation cycle after the production draft is submitted", async () => {
    const store = new InMemoryContentProductionStore();
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
      {
        nextDraftId: () => "auto-draft-submitted",
        nextImageJobId: (slot) => `image-job-submitted-${slot}`,
      },
    );
    await service.ensureDay({
      actorId: "admin-1",
      fortuneDate: "2026-08-02",
      idempotencyKey: "generate-2026-08-02-before-submit", // gitleaks:allow -- deterministic test fixture
      requestId: "production-before-submit",
    });
    store.markDraftSubmitted("auto-draft-submitted");

    await expect(
      service.requestImageSlotGeneration({
        actorId: "admin-1",
        draftId: "auto-draft-submitted",
        expectedDraftRevision: 1,
        fortuneDate: "2026-08-02",
        idempotencyKey: "generate-optional-after-submit-0001",
        imageSlot: "optional",
        reason: "已提交的 production 草稿不能再生图。",
        requestId: "production-after-submit",
      }),
    ).resolves.toEqual({ kind: "invalid_state" });
  });
});
