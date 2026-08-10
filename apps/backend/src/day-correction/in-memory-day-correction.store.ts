import type {
  DayCorrectionStore,
  StoredDayCorrection,
  StoredDayCorrectionOpenIntent,
} from "./day-correction.store";

export class InMemoryDayCorrectionStore implements DayCorrectionStore {
  private readonly corrections = new Map<string, StoredDayCorrection>();
  private readonly openIntents = new Map<string, StoredDayCorrectionOpenIntent>();
  private readonly openFortuneDateLockTails = new Map<string, Promise<void>>();

  constructor(seed: readonly StoredDayCorrection[] = []) {
    for (const correction of seed) {
      this.corrections.set(correction.correctionId, structuredClone(correction));
    }
  }

  abandonApply(
    input: Parameters<DayCorrectionStore["abandonApply"]>[0],
  ): ReturnType<DayCorrectionStore["abandonApply"]> {
    const current = this.corrections.get(input.correctionId);
    if (
      current === undefined ||
      current.status !== "applying" ||
      current.correctionRevision !== input.expectedCorrectionRevision
    ) {
      return Promise.resolve(null);
    }
    const next: StoredDayCorrection = {
      ...current,
      applyDraftRevision: null,
      applyIdempotencyKeyHash: null,
      applyRequestHash: null,
      applyMode: null,
      applyStartedRevision: null,
      correctionRevision: current.correctionRevision + 1,
      scheduledEffectiveFrom: null,
      status: "open",
      updatedAt: input.updatedAt,
    };
    this.corrections.set(next.correctionId, next);
    return Promise.resolve(structuredClone(next));
  }

  discardOpenIntent(
    input: Parameters<DayCorrectionStore["discardOpenIntent"]>[0],
  ): ReturnType<DayCorrectionStore["discardOpenIntent"]> {
    const current = this.openIntents.get(input.fortuneDate);
    if (current?.correctionId === input.correctionId && current.draftId === input.draftId) {
      this.openIntents.delete(input.fortuneDate);
    }
    return Promise.resolve();
  }

  finalizeOpenIntent(
    correction: StoredDayCorrection,
  ): ReturnType<DayCorrectionStore["finalizeOpenIntent"]> {
    const existing = [...this.corrections.values()].find(
      (candidate) =>
        candidate.fortuneDate === correction.fortuneDate &&
        (candidate.status === "open" ||
          candidate.status === "applying" ||
          candidate.status === "submitted"),
    );
    if (existing !== undefined) return Promise.resolve(structuredClone(existing));
    const intent = this.openIntents.get(correction.fortuneDate);
    if (
      intent === undefined ||
      intent.correctionId !== correction.correctionId ||
      intent.draftId !== correction.draftId
    ) {
      throw new Error("Day correction open intent is missing or does not own the draft");
    }
    this.corrections.set(correction.correctionId, structuredClone(correction));
    this.openIntents.delete(correction.fortuneDate);
    return Promise.resolve(structuredClone(correction));
  }

  beginApply(
    input: Parameters<DayCorrectionStore["beginApply"]>[0],
  ): ReturnType<DayCorrectionStore["beginApply"]> {
    const current = this.corrections.get(input.correctionId);
    if (current === undefined) return Promise.resolve({ kind: "not_found" });
    if (current.status === "applying" || current.status === "submitted") {
      if (
        current.applyIdempotencyKeyHash !== input.applyIdempotencyKeyHash ||
        current.applyRequestHash !== input.applyRequestHash ||
        current.applyMode !== input.applyMode ||
        current.applyDraftRevision !== input.applyDraftRevision ||
        current.scheduledEffectiveFrom !== input.scheduledEffectiveFrom
      ) {
        return Promise.resolve({ kind: "idempotency_conflict" });
      }
      return Promise.resolve({ correction: structuredClone(current), kind: "existing" });
    }
    if (current.status !== "open") return Promise.resolve({ kind: "invalid_state" });
    if (current.correctionRevision !== input.expectedCorrectionRevision) {
      return Promise.resolve({
        currentRevision: current.correctionRevision,
        kind: "revision_mismatch",
      });
    }
    const next: StoredDayCorrection = {
      ...current,
      applyDraftRevision: input.applyDraftRevision,
      applyIdempotencyKeyHash: input.applyIdempotencyKeyHash,
      applyRequestHash: input.applyRequestHash,
      applyMode: input.applyMode,
      applyStartedRevision: current.correctionRevision,
      correctionRevision: current.correctionRevision + 1,
      scheduledEffectiveFrom: input.scheduledEffectiveFrom,
      status: "applying",
      updatedAt: input.updatedAt,
    };
    this.corrections.set(next.correctionId, next);
    return Promise.resolve({ correction: structuredClone(next), kind: "started" });
  }

  findById(correctionId: string): Promise<StoredDayCorrection | null> {
    const correction = this.corrections.get(correctionId);
    return Promise.resolve(correction === undefined ? null : structuredClone(correction));
  }

  findOpenByFortuneDate(fortuneDate: string): Promise<StoredDayCorrection | null> {
    const correction = [...this.corrections.values()].find(
      (candidate) =>
        candidate.fortuneDate === fortuneDate &&
        (candidate.status === "open" ||
          candidate.status === "applying" ||
          candidate.status === "submitted"),
    );
    return Promise.resolve(correction === undefined ? null : structuredClone(correction));
  }

  async hasOpenOwnership(fortuneDate: string, now: Date): Promise<boolean> {
    const nowMs = now.getTime();
    const intent = this.openIntents.get(fortuneDate);
    if (intent !== undefined && this.openIntentExpiry(intent) > nowMs) {
      return true;
    }
    const correction = await this.findOpenByFortuneDate(fortuneDate);
    return correction !== null && Date.parse(correction.updatedAt) > nowMs - 15 * 60 * 1_000;
  }

  reserveOrGetOpenIntent(
    intent: StoredDayCorrectionOpenIntent,
  ): ReturnType<DayCorrectionStore["reserveOrGetOpenIntent"]> {
    const current = this.openIntents.get(intent.fortuneDate);
    if (current !== undefined && this.openIntentExpiry(current) > Date.parse(intent.createdAt)) {
      return Promise.resolve(structuredClone(current));
    }
    if (current !== undefined) this.openIntents.delete(intent.fortuneDate);
    this.openIntents.set(intent.fortuneDate, structuredClone(intent));
    return Promise.resolve(structuredClone(intent));
  }

  private openIntentExpiry(intent: StoredDayCorrectionOpenIntent): number {
    return (
      Date.parse(intent.expiresAt ?? intent.createdAt) +
      (intent.expiresAt === undefined ? 15 * 60 * 1_000 : 0)
    );
  }

  renewOpenOwnership(correctionId: string, updatedAt: string): Promise<void> {
    const current = this.corrections.get(correctionId);
    if (current?.status === "open") {
      this.corrections.set(correctionId, { ...current, updatedAt });
    }
    return Promise.resolve();
  }

  async withOpenFortuneDateLock<T>(fortuneDate: string, work: () => Promise<T>): Promise<T> {
    const previous = this.openFortuneDateLockTails.get(fortuneDate) ?? Promise.resolve();
    let releaseCurrent: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = previous.then(() => current);
    this.openFortuneDateLockTails.set(fortuneDate, tail);
    await previous;
    try {
      return await work();
    } finally {
      releaseCurrent?.();
      if (this.openFortuneDateLockTails.get(fortuneDate) === tail) {
        this.openFortuneDateLockTails.delete(fortuneDate);
      }
    }
  }

  recordApplied(
    input: Parameters<DayCorrectionStore["recordApplied"]>[0],
  ): ReturnType<DayCorrectionStore["recordApplied"]> {
    const current = this.corrections.get(input.correctionId);
    if (current === undefined) return Promise.resolve(null);
    if (current.status === "applied") return Promise.resolve(structuredClone(current));
    if (
      current.status !== "submitted" ||
      current.correctionRevision !== input.expectedCorrectionRevision
    ) {
      return Promise.resolve(null);
    }
    const next: StoredDayCorrection = {
      ...current,
      appliedAction: structuredClone(input.action),
      correctionRevision: current.correctionRevision + 1,
      status: "applied",
      updatedAt: input.updatedAt,
    };
    this.corrections.set(next.correctionId, next);
    return Promise.resolve(structuredClone(next));
  }

  recordAbandoned(
    input: Parameters<DayCorrectionStore["recordAbandoned"]>[0],
  ): ReturnType<DayCorrectionStore["recordAbandoned"]> {
    const current = this.corrections.get(input.correctionId);
    if (
      current === undefined ||
      current.status !== "submitted" ||
      current.correctionRevision !== input.expectedCorrectionRevision
    ) {
      return Promise.resolve(null);
    }
    const next: StoredDayCorrection = {
      ...current,
      correctionRevision: current.correctionRevision + 1,
      status: "abandoned",
      terminalFailure: structuredClone(input.failure),
      updatedAt: input.updatedAt,
    };
    this.corrections.set(next.correctionId, next);
    return Promise.resolve(structuredClone(next));
  }

  recordSubmitted(
    input: Parameters<DayCorrectionStore["recordSubmitted"]>[0],
  ): ReturnType<DayCorrectionStore["recordSubmitted"]> {
    const current = this.corrections.get(input.correctionId);
    if (current === undefined) return Promise.resolve(null);
    if (current.status === "submitted") {
      return Promise.resolve(
        current.submittedContentVersion === input.contentVersion &&
          current.submittedLifecycleRevision === input.lifecycleRevision
          ? structuredClone(current)
          : null,
      );
    }
    if (
      current.status !== "applying" ||
      current.correctionRevision !== input.expectedCorrectionRevision
    ) {
      return Promise.resolve(null);
    }
    const next: StoredDayCorrection = {
      ...current,
      correctionRevision: current.correctionRevision + 1,
      status: "submitted",
      submittedContentVersion: input.contentVersion,
      submittedLifecycleRevision: input.lifecycleRevision,
      updatedAt: input.updatedAt,
    };
    this.corrections.set(next.correctionId, next);
    return Promise.resolve(structuredClone(next));
  }

  refreshApplyMode(
    input: Parameters<DayCorrectionStore["refreshApplyMode"]>[0],
  ): ReturnType<DayCorrectionStore["refreshApplyMode"]> {
    const current = this.corrections.get(input.correctionId);
    if (
      current === undefined ||
      (current.status !== "applying" && current.status !== "submitted") ||
      current.correctionRevision !== input.expectedCorrectionRevision
    ) {
      return Promise.resolve(null);
    }
    if (
      current.applyMode === input.applyMode &&
      current.applyRequestHash === input.applyRequestHash &&
      current.scheduledEffectiveFrom === input.scheduledEffectiveFrom
    ) {
      return Promise.resolve(structuredClone(current));
    }
    const next: StoredDayCorrection = {
      ...current,
      applyMode: input.applyMode,
      applyRequestHash: input.applyRequestHash,
      correctionRevision: current.correctionRevision + 1,
      scheduledEffectiveFrom: input.scheduledEffectiveFrom,
      updatedAt: input.updatedAt,
    };
    this.corrections.set(next.correctionId, next);
    return Promise.resolve(structuredClone(next));
  }
}
