import type { components } from "@five/api-contract";

import type { DailyContentProduction } from "./content-production.service";
import type { DailyImageSlot } from "./content-production.status";

export const CONTENT_PRODUCTION_STORE = Symbol("CONTENT_PRODUCTION_STORE");

export type GeneratedContentDraft = components["schemas"]["ContentDraft"];
export type ImageProductionSlot = DailyImageSlot;

export interface StoredImageProductionJob {
  readonly fortuneDate: string;
  readonly imageSlot: ImageProductionSlot;
  readonly jobId: string;
  readonly promptVersion: string;
}

export interface ClaimedImageProductionJob extends StoredImageProductionJob {
  readonly attempts: number;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly modules: components["schemas"]["DraftModules"];
}

export interface EnsureGeneratedDayInput {
  readonly actorId: string;
  readonly draft: GeneratedContentDraft;
  readonly idempotencyKey: string;
  readonly imageJobs: readonly StoredImageProductionJob[];
  readonly production: DailyContentProduction;
  readonly requestHash: string;
  readonly requestId: string;
}

export type EnsureGeneratedDayStoreResult =
  | { readonly kind: "created" }
  | { readonly kind: "existing"; readonly production: DailyContentProduction }
  | { readonly kind: "idempotency_conflict" };

export type ImageJobFailureResult = "exhausted" | "retry_scheduled" | "stale";

export type RequestImageSlotGenerationStoreResult =
  | { readonly kind: "requested"; readonly production: DailyContentProduction }
  | { readonly kind: "existing"; readonly production: DailyContentProduction }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" | "invalid_state" | "not_found" };

export interface ContentProductionStore {
  claimNextImageJob(input: {
    readonly attemptToken: string;
    readonly claimedAt: string;
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  }): Promise<ClaimedImageProductionJob | null>;
  completeImageJob(input: {
    readonly assetId: string;
    readonly attemptToken: string;
    readonly completedAt: string;
    readonly draftRevision: number;
    readonly jobId: string;
    readonly sha256: string;
    readonly workerId: string;
  }): Promise<void>;
  ensureGeneratedDay(input: EnsureGeneratedDayInput): Promise<EnsureGeneratedDayStoreResult>;
  listProductions(): Promise<DailyContentProduction[]>;
  recordImageJobFailure(input: {
    readonly attemptToken: string;
    readonly error: string;
    readonly failedAt: string;
    readonly jobId: string;
    readonly retryAt: string;
    readonly workerId: string;
  }): Promise<ImageJobFailureResult>;
  requestImageSlotGeneration(input: {
    readonly actorId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly fortuneDate: string;
    readonly idempotencyKey: string;
    readonly imageJob: StoredImageProductionJob;
    readonly reason: string;
    readonly requestHash: string;
    readonly requestId: string;
    readonly requestedAt: string;
  }): Promise<RequestImageSlotGenerationStoreResult>;
}
