import type { components } from "@five/api-contract";

export type DayCorrectionApplyMode = "immediate" | "scheduled";
export type DayCorrectionStatus = "abandoned" | "applied" | "applying" | "open" | "submitted";

export interface StoredDayCorrectionOpenIntent {
  readonly baselineActiveContentVersion: string | null;
  readonly baselineLifecycleRevision: number;
  readonly correctionId: string;
  readonly createdAt: string;
  readonly draftId: string;
  readonly expiresAt?: string;
  readonly fortuneDate: string;
  readonly sourceContentVersion: string | null;
  readonly sourceDraftId?: string | null;
}

export interface StoredDayCorrection {
  readonly appliedAction: components["schemas"]["LifecycleActionResult"] | null;
  readonly applyDraftRevision: number | null;
  readonly applyIdempotencyKeyHash: string | null;
  readonly applyRequestHash: string | null;
  readonly applyMode: DayCorrectionApplyMode | null;
  readonly applyStartedRevision: number | null;
  readonly baselineActiveContentVersion: string | null;
  readonly baselineLifecycleRevision: number;
  readonly correctionId: string;
  readonly correctionRevision: number;
  readonly createdAt: string;
  readonly draftId: string;
  readonly fortuneDate: string;
  readonly scheduledEffectiveFrom: string | null;
  readonly sourceContentVersion: string | null;
  readonly sourceDraftId?: string | null;
  readonly status: DayCorrectionStatus;
  readonly submittedContentVersion: string | null;
  readonly submittedLifecycleRevision: number | null;
  readonly terminalFailure?: object | null;
  readonly updatedAt: string;
}

export interface DayCorrectionStore {
  abandonApply(input: {
    readonly correctionId: string;
    readonly expectedCorrectionRevision: number;
    readonly updatedAt: string;
  }): Promise<StoredDayCorrection | null>;
  discardOpenIntent(input: {
    readonly correctionId: string;
    readonly draftId: string;
    readonly fortuneDate: string;
  }): Promise<void>;
  finalizeOpenIntent(correction: StoredDayCorrection): Promise<StoredDayCorrection>;
  beginApply(input: {
    readonly applyDraftRevision: number;
    readonly applyIdempotencyKeyHash: string;
    readonly applyRequestHash: string;
    readonly applyMode: DayCorrectionApplyMode;
    readonly correctionId: string;
    readonly expectedCorrectionRevision: number;
    readonly scheduledEffectiveFrom: string | null;
    readonly updatedAt: string;
  }): Promise<
    | { readonly correction: StoredDayCorrection; readonly kind: "started" | "existing" }
    | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
    | { readonly kind: "idempotency_conflict" | "invalid_state" | "not_found" }
  >;
  findById(correctionId: string): Promise<StoredDayCorrection | null>;
  findOpenByFortuneDate(fortuneDate: string): Promise<StoredDayCorrection | null>;
  hasOpenOwnership(fortuneDate: string, now: Date): Promise<boolean>;
  reserveOrGetOpenIntent(
    intent: StoredDayCorrectionOpenIntent,
  ): Promise<StoredDayCorrectionOpenIntent>;
  renewOpenOwnership(correctionId: string, updatedAt: string): Promise<void>;
  withOpenFortuneDateLock<T>(fortuneDate: string, work: () => Promise<T>): Promise<T>;
  recordApplied(input: {
    readonly action: components["schemas"]["LifecycleActionResult"];
    readonly correctionId: string;
    readonly expectedCorrectionRevision: number;
    readonly updatedAt: string;
  }): Promise<StoredDayCorrection | null>;
  recordAbandoned(input: {
    readonly correctionId: string;
    readonly expectedCorrectionRevision: number;
    readonly failure: object;
    readonly updatedAt: string;
  }): Promise<StoredDayCorrection | null>;
  recordSubmitted(input: {
    readonly contentVersion: string;
    readonly correctionId: string;
    readonly expectedCorrectionRevision: number;
    readonly lifecycleRevision: number;
    readonly updatedAt: string;
  }): Promise<StoredDayCorrection | null>;
  refreshApplyMode(input: {
    readonly applyMode: DayCorrectionApplyMode;
    readonly applyRequestHash: string;
    readonly correctionId: string;
    readonly expectedCorrectionRevision: number;
    readonly scheduledEffectiveFrom: string | null;
    readonly updatedAt: string;
  }): Promise<StoredDayCorrection | null>;
}
