import type { components } from "@five/api-contract";

export type AdminImageAsset = components["schemas"]["AdminImageAsset"];
export type AdminDailyImageSet = components["schemas"]["AdminDailyImageSet"];
export type DraftImageAssetResult = components["schemas"]["DraftImageAssetResult"];
export type ImageAssetReviewRequest = components["schemas"]["ImageAssetReviewRequest"];
export type ImageAssetUploadMetadata = components["schemas"]["ImageAssetUploadMetadata"];
export type ImageAssetWithdrawalResult = components["schemas"]["ImageAssetWithdrawalResult"];

export type StoredDraftImageSelectionSource =
  | "automatic_generation"
  | "correction_draft_copy"
  | "correction_library"
  | "manual_selection"
  | "manual_upload"
  | "migration_unique"
  | "version_copy";

export interface StoredDraftImageAsset {
  readonly asset: AdminImageAsset;
  readonly draftId: string;
  readonly fortuneDate: string;
  readonly imageSlot: components["schemas"]["DailyImageSlot"] | null;
  readonly reviewLocked: boolean;
  readonly selectionSource: StoredDraftImageSelectionSource | null;
  readonly selectedForSlot: boolean;
  readonly storageKey: string;
  readonly uploadedAt: string;
}

export interface StoredDraftImageSlotSelection {
  readonly actorId: string;
  readonly assetId: string;
  readonly draftId: string;
  readonly imageSlot: components["schemas"]["DailyImageSlot"];
  readonly reason: string;
  readonly requestId: string;
  readonly selectedAt: string;
  readonly selectionSource: Extract<
    StoredDraftImageSelectionSource,
    | "correction_draft_copy"
    | "correction_library"
    | "manual_selection"
    | "manual_upload"
    | "version_copy"
  >;
}

export type StoredDailyImageSet = AdminDailyImageSet;

export interface StoredImageAssetWithdrawalEvent {
  readonly contentVersion: string;
  readonly event: components["schemas"]["ImageAssetWithdrawalEvent"];
}

export interface StoredCachePurgeIntent {
  readonly assetId: string;
  readonly contentVersion: string;
  readonly createdAt: string;
  readonly fortuneDate: string;
  readonly purgeIntentId: string;
  readonly requestId: string;
}

export type ImageCachePurgeIntentStatus = "completed" | "pending" | "processing";

export interface StoredImageCachePurgeIntent extends StoredCachePurgeIntent {
  readonly attemptToken: string | null;
  readonly attempts: number;
  readonly availableAt: string;
  readonly claimedAt: string | null;
  readonly lastError: string | null;
  readonly leaseExpiresAt: string | null;
  readonly processedAt: string | null;
  readonly status: ImageCachePurgeIntentStatus;
  readonly workerId: string | null;
}
