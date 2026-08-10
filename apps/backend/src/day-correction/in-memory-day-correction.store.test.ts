import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { StoredDayCorrection } from "./day-correction.store";
import { InMemoryDayCorrectionStore } from "./in-memory-day-correction.store";

function correction(overrides: Partial<StoredDayCorrection> = {}): StoredDayCorrection {
  return {
    appliedAction: null,
    applyDraftRevision: null,
    applyIdempotencyKeyHash: null,
    applyRequestHash: null,
    applyMode: null,
    applyStartedRevision: null,
    baselineActiveContentVersion: null,
    baselineLifecycleRevision: 0,
    correctionId: "correction-store-retry",
    correctionRevision: 1,
    createdAt: "2026-08-06T08:00:00.000Z",
    draftId: "draft-store-retry",
    fortuneDate: "2026-08-07",
    scheduledEffectiveFrom: null,
    sourceContentVersion: null,
    status: "open",
    submittedContentVersion: null,
    submittedLifecycleRevision: null,
    updatedAt: "2026-08-06T08:00:00.000Z",
    ...overrides,
  };
}

describe("InMemoryDayCorrectionStore", () => {
  it("resumes one apply intent with either its starting or current internal correction revision", async () => {
    const store = new InMemoryDayCorrectionStore([correction()]);
    const keyHash = createHash("sha256").update("same-external-key").digest("hex");
    const input = {
      applyDraftRevision: 3,
      applyIdempotencyKeyHash: keyHash,
      applyRequestHash: "a".repeat(64),
      applyMode: "immediate" as const,
      correctionId: "correction-store-retry",
      expectedCorrectionRevision: 1,
      scheduledEffectiveFrom: null,
      updatedAt: "2026-08-06T08:01:00.000Z",
    };

    await expect(store.beginApply(input)).resolves.toMatchObject({
      correction: { correctionRevision: 2, status: "applying" },
      kind: "started",
    });
    await expect(store.beginApply(input)).resolves.toMatchObject({ kind: "existing" });
    await expect(
      store.beginApply({ ...input, expectedCorrectionRevision: 2 }),
    ).resolves.toMatchObject({ kind: "existing" });
    await expect(
      store.beginApply({ ...input, expectedCorrectionRevision: 9 }),
    ).resolves.toMatchObject({
      kind: "existing",
    });
    await expect(
      store.beginApply({
        ...input,
        applyIdempotencyKeyHash: createHash("sha256").update("different-key").digest("hex"),
        expectedCorrectionRevision: 2,
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
    await expect(
      store.beginApply({
        ...input,
        applyRequestHash: "b".repeat(64),
        expectedCorrectionRevision: 2,
      }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
  });

  it("treats only a recently renewed open correction as worker ownership", async () => {
    const store = new InMemoryDayCorrectionStore([correction()]);

    await expect(
      store.hasOpenOwnership("2026-08-07", new Date("2026-08-06T08:14:59.999Z")),
    ).resolves.toBe(true);
    await expect(
      store.hasOpenOwnership("2026-08-07", new Date("2026-08-06T08:15:00.000Z")),
    ).resolves.toBe(false);

    await store.renewOpenOwnership("correction-store-retry", "2026-08-06T08:15:00.000Z");
    await expect(
      store.hasOpenOwnership("2026-08-07", new Date("2026-08-06T08:29:59.999Z")),
    ).resolves.toBe(true);
  });

  it("leases applying and submitted corrections while active but releases stale work", async () => {
    const store = new InMemoryDayCorrectionStore([
      correction({ status: "applying" }),
      correction({
        correctionId: "correction-submitted",
        draftId: "draft-submitted",
        fortuneDate: "2026-08-08",
        status: "submitted",
      }),
    ]);
    const fresh = new Date("2026-08-06T08:14:59.999Z");
    const stale = new Date("2026-08-06T08:15:00.000Z");

    await expect(store.hasOpenOwnership("2026-08-07", fresh)).resolves.toBe(true);
    await expect(store.hasOpenOwnership("2026-08-08", fresh)).resolves.toBe(true);
    await expect(store.hasOpenOwnership("2026-08-07", stale)).resolves.toBe(false);
    await expect(store.hasOpenOwnership("2026-08-08", stale)).resolves.toBe(false);
  });

  it("expires abandoned open intents and permits a new owner to reserve the date", async () => {
    const now = new Date("2026-08-06T08:16:00.000Z");
    const store = new InMemoryDayCorrectionStore();
    const expired = {
      baselineActiveContentVersion: null,
      baselineLifecycleRevision: 0,
      correctionId: "correction-expired",
      createdAt: "2026-08-06T08:00:00.000Z",
      draftId: "draft-expired",
      expiresAt: "2026-08-06T08:15:00.000Z",
      fortuneDate: "2026-08-07",
      sourceContentVersion: "content-source",
    } as const;
    const replacement = {
      ...expired,
      correctionId: "correction-replacement",
      createdAt: now.toISOString(),
      draftId: "draft-replacement",
      expiresAt: "2026-08-06T08:31:00.000Z",
    } as const;

    await store.reserveOrGetOpenIntent(expired);
    await expect(store.hasOpenOwnership("2026-08-07", now)).resolves.toBe(false);
    await expect(store.reserveOrGetOpenIntent(replacement)).resolves.toMatchObject({
      correctionId: "correction-replacement",
      draftId: "draft-replacement",
    });
    await expect(store.hasOpenOwnership("2026-08-07", now)).resolves.toBe(true);
  });
});
