import { describe, expect, it } from "vitest";

import { DayCorrectionImageJobService } from "./day-correction-image-job.service";
import type { DayCorrectionImageWorkingCopyState } from "./day-correction-image-job.store";
import { InMemoryDayCorrectionImageJobStore } from "./in-memory-day-correction-image-job.store";

const state: DayCorrectionImageWorkingCopyState = {
  correctionId: "correction-image-service",
  correctionRevision: 2,
  correctionStatus: "open",
  draftId: "draft-image-service",
  draftRevision: 5,
  fortuneDate: "2026-08-08",
  modules: {
    calendar_algorithm: null,
    copy_and_formula: null,
    poster_consistency: null,
    visual_and_rights: null,
  },
  submittedContentVersion: null,
};

describe("DayCorrectionImageJobService", () => {
  it("creates a correction-scoped job and makes an exact retry idempotent", async () => {
    const store = new InMemoryDayCorrectionImageJobStore([state]);
    const service = new DayCorrectionImageJobService(
      store,
      { now: () => new Date("2026-08-06T12:00:00.000Z") },
      { nextJobId: () => "correction-image-job-service-1" },
    );
    const input = {
      actorId: "admin-1",
      correctionId: state.correctionId,
      expectedRevision: { correctionRevision: 2, draftRevision: 5 },
      idempotencyKey: "correction-image-service-key-0001",
      imageSlot: "required_primary",
      reason: "重新生成主图。",
      requestId: "request-correction-image-service",
    } as const;

    await expect(service.requestGeneration(input)).resolves.toMatchObject({
      kind: "requested",
      view: {
        job: {
          actorId: "admin-1",
          jobId: "correction-image-job-service-1",
          reason: "重新生成主图。",
          requestId: "request-correction-image-service",
          requestedAt: "2026-08-06T12:00:00.000Z",
          status: "queued",
        },
      },
    });
    await expect(service.requestGeneration(input)).resolves.toMatchObject({ kind: "existing" });
  });

  it("rejects invalid slots, reasons and composite revisions before touching the store", async () => {
    const service = new DayCorrectionImageJobService(
      new InMemoryDayCorrectionImageJobStore([state]),
    );
    await expect(
      service.requestGeneration({
        actorId: "admin-1",
        correctionId: state.correctionId,
        expectedRevision: { correctionRevision: 0, draftRevision: 5 },
        idempotencyKey: "correction-image-invalid-key-0001",
        imageSlot: "unknown",
        reason: "",
        requestId: "request-invalid-correction-image",
      }),
    ).resolves.toEqual({ kind: "invalid_argument" });
  });
});
