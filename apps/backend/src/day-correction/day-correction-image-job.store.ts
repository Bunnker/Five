import type { components } from "@five/api-contract";

import type { DayCorrectionStatus } from "./day-correction.store";

export type DayCorrectionImageSlot = components["schemas"]["DailyImageSlot"];
export type DayCorrectionImageJobStatus =
  "claimed" | "completed" | "failed" | "queued" | "retryable";

export interface DayCorrectionWorkingRevision {
  readonly correctionRevision: number;
  readonly draftRevision: number;
}

export interface StoredDayCorrectionImageJob {
  readonly actorId: string;
  readonly attempts: number;
  readonly attemptLimit: number;
  readonly availableAt: string;
  readonly completedAssetId: string | null;
  readonly correctionId: string;
  readonly draftId: string;
  readonly fortuneDate: string;
  readonly generationRevision: number;
  readonly imageSlot: DayCorrectionImageSlot;
  readonly jobId: string;
  readonly lastError: string | null;
  readonly promptVersion: string;
  readonly reason: string;
  readonly requestId: string;
  readonly requestedAt: string;
  readonly status: DayCorrectionImageJobStatus;
}

export interface DayCorrectionImageJobView {
  readonly job: StoredDayCorrectionImageJob | null;
  readonly revision: DayCorrectionWorkingRevision;
}

export interface ClaimedDayCorrectionImageJob extends StoredDayCorrectionImageJob {
  readonly draftRevision: number;
  readonly modules: components["schemas"]["DraftModules"];
}

export interface DayCorrectionImageWorkingCopyState {
  readonly correctionId: string;
  readonly correctionRevision: number;
  readonly correctionStatus: DayCorrectionStatus;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly fortuneDate: string;
  readonly modules: components["schemas"]["DraftModules"];
  readonly submittedContentVersion: string | null;
}

export type RequestDayCorrectionImageGenerationStoreResult =
  | { readonly kind: "requested" | "existing"; readonly view: DayCorrectionImageJobView }
  | {
      readonly currentRevision: DayCorrectionWorkingRevision;
      readonly kind: "revision_mismatch";
    }
  | { readonly kind: "idempotency_conflict" | "invalid_state" | "not_found" };

export type DayCorrectionImageJobFailureResult = "exhausted" | "retry_scheduled" | "stale";

export interface DayCorrectionImageJobStore {
  claimNext(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<ClaimedDayCorrectionImageJob | null>;
  complete(input: {
    readonly assetId: string;
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly jobId: string;
    readonly workerId: string;
  }): Promise<"completed" | "stale">;
  getCurrent(
    correctionId: string,
    imageSlot: DayCorrectionImageSlot,
  ): Promise<DayCorrectionImageJobView | null>;
  recordFailure(input: {
    readonly attemptToken: string;
    readonly error: string;
    readonly failedAt: string;
    readonly jobId: string;
    readonly retryAt: string;
    readonly workerId: string;
  }): Promise<DayCorrectionImageJobFailureResult>;
  requestGeneration(input: {
    readonly actorId: string;
    readonly correctionId: string;
    readonly expectedRevision: DayCorrectionWorkingRevision;
    readonly idempotencyKey: string;
    readonly imageSlot: DayCorrectionImageSlot;
    readonly jobId: string;
    readonly promptVersion: string;
    readonly reason: string;
    readonly requestId: string;
    readonly requestHash: string;
    readonly requestedAt: string;
  }): Promise<RequestDayCorrectionImageGenerationStoreResult>;
}
