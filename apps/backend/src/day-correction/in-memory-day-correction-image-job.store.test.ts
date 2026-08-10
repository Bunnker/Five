import { describe, expect, it } from "vitest";

import type { DayCorrectionImageWorkingCopyState } from "./day-correction-image-job.store";
import { InMemoryDayCorrectionImageJobStore } from "./in-memory-day-correction-image-job.store";

const requestedAt = "2026-08-06T10:00:00.000Z";

function workingCopy(): DayCorrectionImageWorkingCopyState {
  return {
    correctionId: "correction-images-1",
    correctionRevision: 3,
    correctionStatus: "open",
    draftId: "draft-images-1",
    draftRevision: 7,
    fortuneDate: "2026-08-07",
    modules: {
      calendar_algorithm: null,
      copy_and_formula: null,
      poster_consistency: null,
      visual_and_rights: null,
    },
    submittedContentVersion: null,
  };
}

function request(
  store: InMemoryDayCorrectionImageJobStore,
  overrides: Record<string, unknown> = {},
) {
  return store.requestGeneration({
    actorId: "admin-1",
    correctionId: "correction-images-1",
    expectedRevision: { correctionRevision: 3, draftRevision: 7 },
    idempotencyKey: "correction-image-request-0001",
    imageSlot: "required_primary",
    jobId: "correction-image-job-1",
    promptVersion: "five-outfit-model-v1",
    reason: "重新生成主图。",
    requestId: "correction-image-request-http-1",
    requestHash: "a".repeat(64),
    requestedAt,
    ...overrides,
  });
}

describe("InMemoryDayCorrectionImageJobStore", () => {
  it("keeps generation current inside the correction without mutating its working revisions", async () => {
    const store = new InMemoryDayCorrectionImageJobStore([workingCopy()]);

    await expect(request(store)).resolves.toMatchObject({
      kind: "requested",
      view: {
        job: {
          correctionId: "correction-images-1",
          draftId: "draft-images-1",
          generationRevision: 1,
          imageSlot: "required_primary",
          status: "queued",
        },
        revision: { correctionRevision: 3, draftRevision: 7 },
      },
    });
    await expect(
      store.getCurrent("correction-images-1", "required_primary"),
    ).resolves.toMatchObject({ revision: { correctionRevision: 3, draftRevision: 7 } });
  });

  it("replays the same idempotency key before checking a now-stale working revision", async () => {
    const state = workingCopy();
    const store = new InMemoryDayCorrectionImageJobStore([state]);
    await request(store);
    store.setWorkingCopy({ ...state, correctionRevision: 4, draftRevision: 9 });

    await expect(request(store)).resolves.toMatchObject({
      kind: "existing",
      view: { revision: { correctionRevision: 3, draftRevision: 7 } },
    });
    await expect(request(store, { requestHash: "b".repeat(64) })).resolves.toEqual({
      kind: "idempotency_conflict",
    });
  });

  it("rejects either stale correction or draft component of the composite revision", async () => {
    const store = new InMemoryDayCorrectionImageJobStore([workingCopy()]);

    await expect(
      request(store, {
        expectedRevision: { correctionRevision: 2, draftRevision: 7 },
      }),
    ).resolves.toEqual({
      currentRevision: { correctionRevision: 3, draftRevision: 7 },
      kind: "revision_mismatch",
    });
    await expect(
      request(store, {
        expectedRevision: { correctionRevision: 3, draftRevision: 6 },
      }),
    ).resolves.toEqual({
      currentRevision: { correctionRevision: 3, draftRevision: 7 },
      kind: "revision_mismatch",
    });
  });

  it("switches only the correction slot current and leaves the late job as an unselected stale candidate", async () => {
    const store = new InMemoryDayCorrectionImageJobStore([workingCopy()]);
    await request(store);
    const first = await store.claimNext({
      attemptToken: "attempt-first",
      claimedAt: requestedAt,
      leaseExpiresAt: "2026-08-06T10:10:00.000Z",
      workerId: "worker-1",
    });
    expect(first?.jobId).toBe("correction-image-job-1");

    await request(store, {
      idempotencyKey: "correction-image-request-0002",
      jobId: "correction-image-job-2",
      requestHash: "b".repeat(64),
    });
    await expect(
      store.complete({
        assetId: "asset-late",
        attemptToken: "attempt-first",
        completedAt: "2026-08-06T10:02:00.000Z",
        jobId: "correction-image-job-1",
        workerId: "worker-1",
      }),
    ).resolves.toBe("stale");
    await expect(
      store.getCurrent("correction-images-1", "required_primary"),
    ).resolves.toMatchObject({
      job: { completedAssetId: null, generationRevision: 2, jobId: "correction-image-job-2" },
    });
  });

  it("claims with the latest draft revision and retries without selecting any asset", async () => {
    const state = workingCopy();
    const store = new InMemoryDayCorrectionImageJobStore([state]);
    await request(store);
    store.setWorkingCopy({ ...state, draftRevision: 8 });
    await expect(
      store.claimNext({
        attemptToken: "attempt-retry",
        claimedAt: requestedAt,
        leaseExpiresAt: "2026-08-06T10:10:00.000Z",
        workerId: "worker-1",
      }),
    ).resolves.toMatchObject({ attempts: 1, draftRevision: 8 });
    await expect(
      store.recordFailure({
        attemptToken: "attempt-retry",
        error: "draft revision raced",
        failedAt: "2026-08-06T10:01:00.000Z",
        jobId: "correction-image-job-1",
        retryAt: "2026-08-06T10:02:00.000Z",
        workerId: "worker-1",
      }),
    ).resolves.toBe("retry_scheduled");
    await expect(
      store.getCurrent("correction-images-1", "required_primary"),
    ).resolves.toMatchObject({ job: { completedAssetId: null, status: "retryable" } });
  });
});
