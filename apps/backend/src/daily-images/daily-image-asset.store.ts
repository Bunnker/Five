import type { components } from "@five/api-contract";

export type AdminImageAsset = components["schemas"]["AdminImageAsset"];
export type AdminDailyImageSet = components["schemas"]["AdminDailyImageSet"];
export type DraftImageAssetResult = components["schemas"]["DraftImageAssetResult"];
export type ImageAssetReviewRequest = components["schemas"]["ImageAssetReviewRequest"];
export type ImageAssetUploadMetadata = components["schemas"]["ImageAssetUploadMetadata"];
export type ImageAssetWithdrawalResult = components["schemas"]["ImageAssetWithdrawalResult"];

export interface StoredDraftImageAsset {
  readonly asset: AdminImageAsset;
  readonly draftId: string;
  readonly fortuneDate: string;
  readonly reviewLocked: boolean;
  readonly storageKey: string;
  readonly uploadedAt: string;
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
