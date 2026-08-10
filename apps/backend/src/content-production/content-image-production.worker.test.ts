import { describe, expect, it, vi } from "vitest";

import { AutomaticContentProductionService } from "./content-production.service";
import { ContentImageProductionWorker } from "./content-image-production.worker";
import { InMemoryContentProductionStore } from "./in-memory-content-production.store";

describe("content image production worker", () => {
  it("turns one queued slot into an uploaded model-image candidate", async () => {
    const store = new InMemoryContentProductionStore();
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
      {
        nextDraftId: () => "auto-draft-1",
        nextImageJobId: (slot) => `job-${slot}`,
      },
    );
    await service.ensureDay({
      actorId: "system-worker",
      fortuneDate: "2026-08-02",
      idempotencyKey: "automatic-production:2026-08-02:v1",
      requestId: "worker-production-2026-08-02",
    });
    const generator = {
      generate: vi.fn().mockResolvedValue({
        bytes: Buffer.from("generated-png"),
        declaredMediaType: "image/png",
        model: "gpt-image-2",
        reproductionReference: "openai-request-1",
      }),
    };
    const uploader = {
      upload: vi.fn().mockImplementation(() => {
        const draftRevision = store.advanceDraftRevision(
          "auto-draft-1",
          "2026-08-01T08:00:00.000Z",
        );
        return Promise.resolve({
          assetId: "asset-generated-1",
          draftRevision,
          sha256: "a".repeat(64),
        });
      }),
    };
    const worker = new ContentImageProductionWorker(store, generator, uploader, {
      now: () => new Date("2026-08-01T08:00:00.000Z"),
    });

    expect(await worker.runOne()).toBe("generated");
    expect(generator.generate).toHaveBeenCalledWith({
      prompt: expect.stringMatching(/模特.*全身.*无文字/u),
    });
    expect(uploader.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        draftId: "auto-draft-1",
        imageSlot: "required_primary",
        model: "gpt-image-2",
      }),
    );
    expect(await service.list()).toMatchObject({
      items: [
        {
          completedImageSlots: 1,
          imageSlots: [
            { imageSlot: "required_primary", status: "ready" },
            { imageSlot: "required_alternative", status: "pending" },
            { imageSlot: "optional", status: "not_requested" },
          ],
          optionalImageStatus: "not_requested",
          pendingImageSlots: 1,
          requiredGenerationComplete: false,
          status: "generating",
        },
      ],
    });
  });

  it("becomes ready after both required slots complete without requesting an optional image", async () => {
    const store = new InMemoryContentProductionStore();
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
      {
        nextDraftId: () => "auto-draft-ready",
        nextImageJobId: (slot) => `job-${slot}`,
      },
    );
    await service.ensureDay({
      actorId: "system-worker",
      fortuneDate: "2026-08-02",
      idempotencyKey: "automatic-production:2026-08-02:ready",
      requestId: "worker-production-2026-08-02-ready",
    });
    const worker = new ContentImageProductionWorker(
      store,
      {
        generate: vi.fn().mockResolvedValue({
          bytes: Buffer.from("generated-png"),
          declaredMediaType: "image/png",
          model: "test-image-generator",
          reproductionReference: "fake-request",
        }),
      },
      {
        upload: vi.fn().mockImplementation((input) => {
          const draftRevision = store.advanceDraftRevision(
            "auto-draft-ready",
            "2026-08-01T08:00:00.000Z",
          );
          expect(draftRevision).toBe(input.expectedDraftRevision + 1);
          return Promise.resolve({
            assetId: `asset-${draftRevision}`,
            draftRevision,
            sha256: `${draftRevision}`.repeat(64),
          });
        }),
      },
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
    );

    expect(await worker.runOne()).toBe("generated");
    expect(await worker.runOne()).toBe("generated");
    expect(await worker.runOne()).toBe("idle");
    await expect(service.list()).resolves.toMatchObject({
      items: [
        {
          completedImageSlots: 2,
          imageSlots: [
            { imageSlot: "required_primary", status: "ready" },
            { imageSlot: "required_alternative", status: "ready" },
            { imageSlot: "optional", status: "not_requested" },
          ],
          optionalImageStatus: "not_requested",
          pendingImageSlots: 0,
          requiredGenerationComplete: true,
          status: "awaiting_review",
        },
      ],
    });
  });

  it("does not advance beyond the upload revision when a late worker finishes behind a manual selection", async () => {
    const store = new InMemoryContentProductionStore([
      {
        assetId: "asset-manual-primary",
        fortuneDate: "2026-08-02",
        imageSlot: "required_primary",
        source: "manual_selection",
      },
    ]);
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
      {
        nextDraftId: () => "auto-draft-manual-wins",
        nextImageJobId: (slot) => `job-manual-wins-${slot}`,
      },
    );
    await service.ensureDay({
      actorId: "system-worker",
      fortuneDate: "2026-08-02",
      idempotencyKey: "automatic-production:2026-08-02:manual-wins",
      requestId: "worker-production-2026-08-02-manual-wins",
    });
    const worker = new ContentImageProductionWorker(
      store,
      {
        generate: vi.fn().mockResolvedValue({
          bytes: Buffer.from("late-worker-image"),
          declaredMediaType: "image/png",
          model: "test-image-generator",
          reproductionReference: "fake-late-worker-request",
        }),
      },
      {
        upload: vi.fn().mockImplementation(() => {
          const draftRevision = store.advanceDraftRevision(
            "auto-draft-manual-wins",
            "2026-08-01T08:00:00.000Z",
          );
          return Promise.resolve({
            assetId: "asset-late-worker-primary",
            draftRevision,
            sha256: "c".repeat(64),
          });
        }),
      },
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
    );

    expect(await worker.runOne()).toBe("generated");
    await expect(service.list()).resolves.toMatchObject({
      items: [
        {
          draftRevision: 2,
          imageSlots: [
            {
              deliveryReady: true,
              imageSlot: "required_primary",
              status: "ready",
            },
            expect.anything(),
            expect.anything(),
          ],
        },
      ],
    });
  });

  it("does not report 2/2 delivery readiness when required assets have the same sha256", async () => {
    const store = new InMemoryContentProductionStore();
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
      {
        nextDraftId: () => "auto-draft-duplicate-required",
        nextImageJobId: (slot) => `job-duplicate-required-${slot}`,
      },
    );
    await service.ensureDay({
      actorId: "system-worker",
      fortuneDate: "2026-08-02",
      idempotencyKey: "automatic-production:2026-08-02:duplicate-required",
      requestId: "worker-production-2026-08-02-duplicate-required",
    });
    const worker = new ContentImageProductionWorker(
      store,
      {
        generate: vi.fn().mockResolvedValue({
          bytes: Buffer.from("duplicate-required-image"),
          declaredMediaType: "image/png",
          model: "test-image-generator",
          reproductionReference: "fake-duplicate-required-request",
        }),
      },
      {
        upload: vi.fn().mockImplementation((input) => {
          const draftRevision = store.advanceDraftRevision(
            "auto-draft-duplicate-required",
            "2026-08-01T08:00:30.000Z",
          );
          expect(draftRevision).toBe(input.expectedDraftRevision + 1);
          return Promise.resolve({
            assetId: `asset-${input.imageSlot}`,
            draftRevision,
            sha256: "f".repeat(64),
          });
        }),
      },
      { now: () => new Date("2026-08-01T08:01:00.000Z") },
    );

    await expect(worker.runOne()).resolves.toBe("generated");
    await expect(worker.runOne()).resolves.toBe("generated");
    await expect(service.list()).resolves.toMatchObject({
      items: [
        {
          completedImageSlots: 2,
          lastError: "两张必备图片内容重复，请替换备选图。",
          requiredGenerationComplete: true,
          requiredImagesReady: false,
          status: "failed",
          imageSlots: [
            { deliveryReady: true, imageSlot: "required_primary" },
            {
              deliveryReady: false,
              imageSlot: "required_alternative",
              lastError: "两张必备图片内容重复，请替换备选图。",
            },
            expect.anything(),
          ],
        },
      ],
    });
  });

  it("does not call the paid generator for a queued job after its production draft is submitted", async () => {
    const store = new InMemoryContentProductionStore();
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
      {
        nextDraftId: () => "auto-draft-submitted",
        nextImageJobId: (slot) => `job-submitted-${slot}`,
      },
    );
    await service.ensureDay({
      actorId: "system-worker",
      fortuneDate: "2026-08-02",
      idempotencyKey: "automatic-production:2026-08-02:submitted",
      requestId: "worker-production-2026-08-02-submitted",
    });
    store.markDraftSubmitted("auto-draft-submitted");
    const generator = {
      generate: vi.fn(),
    };
    const uploader = {
      upload: vi.fn(),
    };
    const worker = new ContentImageProductionWorker(store, generator, uploader, {
      now: () => new Date("2026-08-01T08:01:00.000Z"),
    });

    await expect(worker.runOne()).resolves.toBe("idle");
    expect(generator.generate).not.toHaveBeenCalled();
    expect(uploader.upload).not.toHaveBeenCalled();
  });

  it("completes generation without selecting the image when the draft is submitted mid-flight", async () => {
    const store = new InMemoryContentProductionStore();
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
      {
        nextDraftId: () => "auto-draft-submitted-mid-flight",
        nextImageJobId: (slot) => `job-submitted-mid-flight-${slot}`,
      },
    );
    await service.ensureDay({
      actorId: "system-worker",
      fortuneDate: "2026-08-02",
      idempotencyKey: "automatic-production:2026-08-02:submitted-mid-flight",
      requestId: "worker-production-2026-08-02-submitted-mid-flight",
    });
    const worker = new ContentImageProductionWorker(
      store,
      {
        generate: vi.fn().mockResolvedValue({
          bytes: Buffer.from("submitted-mid-flight-image"),
          declaredMediaType: "image/png",
          model: "test-image-generator",
          reproductionReference: "fake-submitted-mid-flight-request",
        }),
      },
      {
        upload: vi.fn().mockImplementation(() => {
          expect(
            store.advanceDraftRevision(
              "auto-draft-submitted-mid-flight",
              "2026-08-01T08:00:30.000Z",
            ),
          ).toBe(2);
          store.markDraftSubmitted("auto-draft-submitted-mid-flight");
          return Promise.resolve({
            assetId: "asset-submitted-mid-flight",
            draftRevision: 2,
            sha256: "d".repeat(64),
          });
        }),
      },
      { now: () => new Date("2026-08-01T08:01:00.000Z") },
    );

    await expect(worker.runOne()).resolves.toBe("generated");
    await expect(service.list()).resolves.toMatchObject({
      items: [
        {
          completedImageSlots: 1,
          draftRevision: 2,
          imageSlots: [
            {
              deliveryReady: false,
              imageSlot: "required_primary",
              status: "ready",
            },
            expect.anything(),
            expect.anything(),
          ],
        },
      ],
    });
  });

  it("keeps a stale automatic completion claimed when the draft changed after upload", async () => {
    const store = new InMemoryContentProductionStore();
    const service = new AutomaticContentProductionService(
      store,
      { now: () => new Date("2026-08-01T08:00:00.000Z") },
      {
        nextDraftId: () => "auto-draft-stale-completion",
        nextImageJobId: (slot) => `job-stale-completion-${slot}`,
      },
    );
    await service.ensureDay({
      actorId: "system-worker",
      fortuneDate: "2026-08-02",
      idempotencyKey: "automatic-production:2026-08-02:stale-completion",
      requestId: "worker-production-stale-completion",
    });
    const worker = new ContentImageProductionWorker(
      store,
      {
        generate: vi.fn().mockResolvedValue({
          bytes: Buffer.from("stale-worker-image"),
          declaredMediaType: "image/png",
          model: "test-image-generator",
          reproductionReference: "fake-stale-worker-request",
        }),
      },
      {
        upload: vi.fn().mockImplementation(() => {
          expect(
            store.advanceDraftRevision("auto-draft-stale-completion", "2026-08-01T08:00:30.000Z"),
          ).toBe(2);
          expect(
            store.advanceDraftRevision("auto-draft-stale-completion", "2026-08-01T08:00:45.000Z"),
          ).toBe(3);
          return Promise.resolve({
            assetId: "asset-stale-worker",
            draftRevision: 2,
            sha256: "e".repeat(64),
          });
        }),
      },
      { now: () => new Date("2026-08-01T08:01:00.000Z") },
    );

    await expect(worker.runOne()).resolves.toBe("generated");
    await expect(service.list()).resolves.toMatchObject({
      items: [
        {
          completedImageSlots: 0,
          draftRevision: 3,
          imageSlots: [
            {
              deliveryReady: false,
              imageSlot: "required_primary",
              status: "pending",
            },
            expect.anything(),
            expect.anything(),
          ],
        },
      ],
    });
  });
});
