import { createHash, randomUUID } from "node:crypto";

import type { components } from "@five/api-contract";
import {
  isAdminDailyImageSet,
  isDeliverableAdminImageAsset,
  isImageAssetReviewRequest,
  isImageAssetUploadMetadata,
  isWithdrawImageAssetRequest,
} from "@five/api-contract/runtime";

import type { ContentLifecycleStore } from "../content-lifecycle/content-lifecycle.store";
import { CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN } from "../content-lifecycle/content-lifecycle.values";
import type {
  DraftImageAssetResult,
  ImageAssetWithdrawalResult,
  ImageAssetReviewRequest,
  ImageAssetUploadMetadata,
  StoredDailyImageSet,
  StoredDraftImageAsset,
} from "./daily-image-asset.store";
import { projectDailyImageSet } from "./image-delivery-projection";
import { ImageFileError, inspectImageFile } from "./image-file";
import type { BinaryImageAssetStore } from "./local-binary-image-asset.store";

type DraftImageAssetList = components["schemas"]["DraftImageAssetList"];

export interface DailyImageAssetClock {
  now(): Date;
}

export interface DailyImageAssetIdentifiers {
  nextAssetId(): string;
  nextAuditEventId(): string;
  nextCachePurgeIntentId(): string;
  nextReviewId(): string;
  nextWithdrawalEventId(): string;
}

const SYSTEM_IDENTIFIERS: DailyImageAssetIdentifiers = {
  nextAssetId: () => `asset-${randomUUID()}`,
  nextAuditEventId: () => `audit-${randomUUID()}`,
  nextCachePurgeIntentId: () => `purge-${randomUUID()}`,
  nextReviewId: () => `image-review-${randomUUID()}`,
  nextWithdrawalEventId: () => `image-withdrawal-${randomUUID()}`,
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

function validMetadata(value: unknown): value is ImageAssetUploadMetadata {
  return (
    isImageAssetUploadMetadata(value) &&
    value.rightsRecordIds.length > 0 &&
    value.sourceMaterialReferences.length > 0
  );
}

function previewUrl(assetId: string): string {
  return `/admin/api/v1/image-assets/${encodeURIComponent(assetId)}/preview`;
}

function publicFileUrl(base: string, storageKey: string): string {
  return new URL(storageKey, base.endsWith("/") ? base : `${base}/`).toString();
}

function validatedPublicAssetBaseUrl(value: string | null): string | null {
  if (value === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("FIVE_PUBLIC_ASSET_BASE_URL must be an absolute HTTPS URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      "FIVE_PUBLIC_ASSET_BASE_URL must be an absolute HTTPS URL without credentials, query, or fragment",
    );
  }
  return parsed.toString();
}

export type UploadDraftImageAssetResult =
  | { readonly kind: "existing" | "uploaded"; readonly result: DraftImageAssetResult }
  | { readonly kind: "not_found" | "invalid_state" | "invalid_metadata" }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" }
  | { readonly code: ImageFileError["code"]; readonly kind: "file_error" };

export type ReviewDraftImageAssetResult =
  | { readonly kind: "existing" | "reviewed"; readonly result: DraftImageAssetResult }
  | { readonly kind: "not_found" | "invalid_state" | "invalid_review" | "review_locked" }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" };

export type WithdrawVersionImageAssetResult =
  | { readonly kind: "existing" | "withdrawn"; readonly result: ImageAssetWithdrawalResult }
  | { readonly kind: "not_found" | "invalid_state" | "invalid_argument" }
  | { readonly kind: "withdrawal_blocked" }
  | { readonly kind: "active_version_asset_reference" }
  | { readonly kind: "active_version_mismatch" }
  | { readonly currentRevision: number; readonly kind: "revision_mismatch" }
  | { readonly kind: "idempotency_conflict" };

function requiredSlotsRemainAvailableAfterWithdrawal(
  imageSet: StoredDailyImageSet,
  assetId: string,
): boolean {
  const projected = projectDailyImageSet(imageSet, [
    {
      assetId,
      auditEventId: "prospective-withdrawal",
      reason: "prospective withdrawal safety check",
      withdrawalEventId: "prospective-withdrawal",
      withdrawnAt: "9999-12-31T23:59:59.999Z",
    },
  ]);
  return projected.slots
    .filter((slot) => slot.imageSlot !== "optional")
    .every((slot) => slot.deliveryStatus !== "unavailable");
}

export class DailyImageAssetService {
  private readonly assetBaseUrl: string | null;

  constructor(
    private readonly store: ContentLifecycleStore,
    private readonly binaryStore: BinaryImageAssetStore,
    private readonly clock: DailyImageAssetClock,
    private readonly identifiers: DailyImageAssetIdentifiers = SYSTEM_IDENTIFIERS,
    assetBaseUrl: string | null = null,
  ) {
    this.assetBaseUrl = validatedPublicAssetBaseUrl(assetBaseUrl);
  }

  async listDraftAssets(draftId: string): Promise<DraftImageAssetList | null> {
    const view = await this.store.readDraftImageAssetView(draftId);
    if (view === null) return null;
    return {
      draftId,
      draftRevision: view.draft.draftRevision,
      fortuneDate: view.draft.fortuneDate,
      items: view.candidates.map(({ asset, reviewLocked }) => ({
        asset,
        previewUrl: previewUrl(asset.assetId),
        reviewLocked,
      })),
    };
  }

  async uploadDraftAsset(input: {
    readonly actorId: string;
    readonly bytes: Buffer;
    readonly declaredMediaType: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly idempotencyKey: string;
    readonly metadata: ImageAssetUploadMetadata;
    readonly requestId: string;
  }): Promise<UploadDraftImageAssetResult> {
    if (
      !validRevision(input.expectedDraftRevision) ||
      !CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) ||
      !validMetadata(input.metadata)
    ) {
      return { kind: "invalid_metadata" };
    }
    let inspected: Awaited<ReturnType<typeof inspectImageFile>>;
    try {
      inspected = await inspectImageFile({
        bytes: input.bytes,
        declaredMediaType: input.declaredMediaType,
        maximumBytes: 8 * 1024 * 1024,
      });
    } catch (error) {
      return error instanceof ImageFileError
        ? { code: error.code, kind: "file_error" }
        : { code: "invalid", kind: "file_error" };
    }
    const requestHash = hash({
      draftId: input.draftId,
      expectedDraftRevision: input.expectedDraftRevision,
      metadata: input.metadata,
      sha256: inspected.sha256,
    });
    return this.store.transaction(async (transaction) => {
      await transaction.lockIdempotency("image_upload", input.draftId, input.idempotencyKey);
      const prior = await transaction.findIdempotency(
        "image_upload",
        input.draftId,
        input.idempotencyKey,
      );
      if (prior !== null) {
        return prior.requestHash === requestHash
          ? { kind: "existing", result: prior.response as DraftImageAssetResult }
          : { kind: "idempotency_conflict" };
      }
      const storedDraft = await transaction.findDraftForUpdate(input.draftId);
      if (storedDraft === null) return { kind: "not_found" } as const;
      if (storedDraft.submittedContentVersion !== null) return { kind: "invalid_state" } as const;
      if (storedDraft.draft.draftRevision !== input.expectedDraftRevision) {
        return {
          currentRevision: storedDraft.draft.draftRevision,
          kind: "revision_mismatch",
        } as const;
      }
      const storedBinary = await this.binaryStore.put({
        bytes: input.bytes,
        extension: inspected.extension,
        sha256: inspected.sha256,
      });
      const assetId = this.identifiers.nextAssetId();
      const now = this.clock.now().toISOString();
      const asset: StoredDraftImageAsset = {
        asset: {
          ...structuredClone(input.metadata),
          assetId,
          fileUrl: null,
          height: inspected.height,
          manualReview: null,
          mediaType: inspected.mediaType,
          reviewStatus: "pending",
          rightsStatus: "pending",
          sha256: inspected.sha256,
          width: inspected.width,
        },
        draftId: input.draftId,
        fortuneDate: storedDraft.draft.fortuneDate,
        reviewLocked: false,
        storageKey: storedBinary.storageKey,
        uploadedAt: now,
      };
      const draftRevision = storedDraft.draft.draftRevision + 1;
      const result: DraftImageAssetResult = {
        asset: asset.asset,
        draftId: input.draftId,
        draftRevision,
        fortuneDate: storedDraft.draft.fortuneDate,
        previewUrl: previewUrl(assetId),
        reviewLocked: asset.reviewLocked,
      };
      await transaction.insertDraftImageAsset(asset);
      await transaction.updateDraft({
        draft: {
          ...storedDraft.draft,
          draftRevision,
          updatedAt: now,
        },
        submittedContentVersion: null,
      });
      await transaction.insertIdempotency({
        idempotencyKey: input.idempotencyKey,
        operation: "image_upload",
        requestHash,
        resourceId: input.draftId,
        response: result,
      });
      return { kind: "uploaded", result } as const;
    });
  }

  async reviewDraftAsset(input: {
    readonly actorId: string;
    readonly assetId: string;
    readonly draftId: string;
    readonly expectedDraftRevision: number;
    readonly idempotencyKey: string;
    readonly requestId: string;
    readonly review: ImageAssetReviewRequest;
  }): Promise<ReviewDraftImageAssetResult> {
    if (
      !validRevision(input.expectedDraftRevision) ||
      !CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) ||
      !isImageAssetReviewRequest(input.review)
    ) {
      return { kind: "invalid_review" };
    }
    const requestHash = hash({
      assetId: input.assetId,
      draftId: input.draftId,
      expectedDraftRevision: input.expectedDraftRevision,
      review: input.review,
    });
    return this.store.transaction(async (transaction) => {
      await transaction.lockIdempotency("image_review", input.assetId, input.idempotencyKey);
      const prior = await transaction.findIdempotency(
        "image_review",
        input.assetId,
        input.idempotencyKey,
      );
      if (prior !== null) {
        return prior.requestHash === requestHash
          ? { kind: "existing", result: prior.response as DraftImageAssetResult }
          : { kind: "idempotency_conflict" };
      }
      const storedDraft = await transaction.findDraftForUpdate(input.draftId);
      if (storedDraft === null) return { kind: "not_found" } as const;
      if (storedDraft.submittedContentVersion !== null) return { kind: "invalid_state" } as const;
      if (storedDraft.draft.draftRevision !== input.expectedDraftRevision) {
        return {
          currentRevision: storedDraft.draft.draftRevision,
          kind: "revision_mismatch",
        } as const;
      }
      const candidate = await transaction.findDraftImageAssetForUpdate(
        input.draftId,
        input.assetId,
      );
      if (candidate === null) return { kind: "not_found" } as const;
      if (candidate.reviewLocked === true) return { kind: "review_locked" } as const;
      const approved = input.review.decision === "approved";
      if (
        approved &&
        (input.review.rightsStatus !== "cleared" ||
          (candidate.asset.sourceType === "ai_generated"
            ? input.review.aiLabelStatus !== "complete"
            : input.review.aiLabelStatus !== "not_applicable"))
      ) {
        return { kind: "invalid_review" } as const;
      }
      const reviewedAt = this.clock.now().toISOString();
      const updated: StoredDraftImageAsset = {
        ...candidate,
        asset: {
          ...candidate.asset,
          aiLabelStatus: input.review.aiLabelStatus,
          fileUrl:
            approved && this.assetBaseUrl !== null
              ? publicFileUrl(this.assetBaseUrl, candidate.storageKey)
              : null,
          manualReview: {
            aiLabelCompliance: input.review.aiLabelCompliance,
            colorAndCopyConsistency: input.review.colorAndCopyConsistency,
            garmentAndPersonIntegrity: input.review.garmentAndPersonIntegrity,
            mobileAndWechatPreview: input.review.mobileAndWechatPreview,
            notes: input.review.notes,
            reviewId: this.identifiers.nextReviewId(),
            reviewedAt,
            reviewerAccountId: input.actorId,
            rightsAndIdentityRisk: input.review.rightsAndIdentityRisk,
            scenarioAndImitability: input.review.scenarioAndImitability,
          },
          reviewStatus: approved ? "approved" : "rejected",
          rightsStatus: input.review.rightsStatus,
        },
      };
      const draftRevision = storedDraft.draft.draftRevision + 1;
      const result: DraftImageAssetResult = {
        asset: updated.asset,
        draftId: input.draftId,
        draftRevision,
        fortuneDate: storedDraft.draft.fortuneDate,
        previewUrl: previewUrl(input.assetId),
        reviewLocked: updated.reviewLocked,
      };
      await transaction.updateDraftImageAsset(updated);
      await transaction.updateDraft({
        draft: {
          ...storedDraft.draft,
          draftRevision,
          updatedAt: reviewedAt,
        },
        submittedContentVersion: null,
      });
      await transaction.insertIdempotency({
        idempotencyKey: input.idempotencyKey,
        operation: "image_review",
        requestHash,
        resourceId: input.assetId,
        response: result,
      });
      return { kind: "reviewed", result } as const;
    });
  }

  async readAssetBinary(assetId: string): Promise<{
    readonly bytes: Buffer;
    readonly mediaType: StoredDraftImageAsset["asset"]["mediaType"];
  } | null> {
    const candidate = await this.store.readImageAsset(assetId);
    if (candidate === null) return null;
    const bytes = await this.binaryStore.read(candidate.storageKey);
    return bytes === null ? null : { bytes, mediaType: candidate.asset.mediaType };
  }

  async getDailyImageSet(contentVersion: string) {
    const view = await this.store.readDailyImageSetView(contentVersion);
    if (view === null) return null;
    return { ...view.imageSet, lifecycleRevision: view.projection.revision };
  }

  async withdrawVersionAsset(input: {
    readonly actorId: string;
    readonly assetId: string;
    readonly contentVersion: string;
    readonly expectedActiveContentVersion: string | null;
    readonly expectedLifecycleRevision: number;
    readonly idempotencyKey: string;
    readonly reason: string;
    readonly requestId: string;
  }): Promise<WithdrawVersionImageAssetResult> {
    if (
      !validRevision(input.expectedLifecycleRevision) ||
      !CONTENT_LIFECYCLE_IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey) ||
      input.reason.trim().length === 0 ||
      !isWithdrawImageAssetRequest({
        expectedActiveContentVersion: input.expectedActiveContentVersion,
        reason: input.reason,
      })
    ) {
      return { kind: "invalid_argument" };
    }
    const requestHash = hash({
      assetId: input.assetId,
      contentVersion: input.contentVersion,
      expectedActiveContentVersion: input.expectedActiveContentVersion,
      expectedLifecycleRevision: input.expectedLifecycleRevision,
      reason: input.reason,
    });
    return this.store.transaction(async (transaction) => {
      await transaction.lockIdempotency(
        "image_withdrawal",
        input.contentVersion,
        input.idempotencyKey,
      );
      const prior = await transaction.findIdempotency(
        "image_withdrawal",
        input.contentVersion,
        input.idempotencyKey,
      );
      if (prior !== null) {
        return prior.requestHash === requestHash
          ? { kind: "existing", result: prior.response as ImageAssetWithdrawalResult }
          : { kind: "idempotency_conflict" };
      }
      const version = await transaction.findVersion(input.contentVersion);
      if (version === null) return { kind: "not_found" } as const;
      const projection = await transaction.getOrCreateProjectionForUpdate(version.fortuneDate);
      if (projection.revision !== input.expectedLifecycleRevision) {
        return { currentRevision: projection.revision, kind: "revision_mismatch" } as const;
      }
      if (projection.activeContentVersion !== input.expectedActiveContentVersion) {
        return { kind: "active_version_mismatch" } as const;
      }
      const current = await transaction.findDailyImageSetForUpdate(input.contentVersion);
      if (current === null || !current.assets.some((asset) => asset.assetId === input.assetId)) {
        return { kind: "not_found" } as const;
      }
      await transaction.lockImageAssetWithdrawal(input.assetId);
      const globallyWithdrawn = new Set(
        await transaction.listGloballyWithdrawnAssetIds(
          current.assets.map((asset) => asset.assetId),
        ),
      );
      if (globallyWithdrawn.has(input.assetId)) return { kind: "invalid_state" } as const;
      if (
        projection.activeContentVersion !== null &&
        projection.activeContentVersion !== input.contentVersion
      ) {
        const activeImageSet = await transaction.findDailyImageSetForUpdate(
          projection.activeContentVersion,
        );
        if (
          activeImageSet?.assets.some((asset) => asset.assetId === input.assetId) === true &&
          !activeImageSet.withdrawalEvents.some((event) => event.assetId === input.assetId) &&
          !requiredSlotsRemainAvailableAfterWithdrawal(activeImageSet, input.assetId)
        ) {
          return { kind: "active_version_asset_reference" } as const;
        }
      }
      const withdrawn = new Set(current.withdrawalEvents.map((event) => event.assetId));
      if (withdrawn.has(input.assetId)) return { kind: "invalid_state" } as const;
      const assets = new Map(current.assets.map((asset) => [asset.assetId, asset]));
      let deliveryAction: ImageAssetWithdrawalResult["deliveryAction"] = "no_public_change";
      let blocked = false;
      const slots: StoredDailyImageSet["slots"] = current.slots.map((slot) => {
        let next = {
          ...slot,
          servedDetailAssetIds: [...slot.servedDetailAssetIds],
        } as StoredDailyImageSet["slots"][number];
        if (slot.servedCoverAssetId === input.assetId && slot.coverAssetId !== input.assetId) {
          if (slot.imageSlot === "optional") {
            next = {
              ...next,
              deliveryStatus: "omitted",
              imageSlot: "optional",
              servedCoverAssetId: null,
            } as StoredDailyImageSet["slots"][number];
            deliveryAction = "optional_omitted";
          } else if (projection.activeContentVersion !== input.contentVersion) {
            next = {
              ...next,
              deliveryStatus: "unavailable",
              servedCoverAssetId: null,
            } as StoredDailyImageSet["slots"][number];
          } else {
            blocked = true;
          }
        }
        if (slot.coverAssetId === input.assetId && slot.servedCoverAssetId === input.assetId) {
          if (slot.imageSlot === "optional") {
            next = {
              ...next,
              deliveryStatus: "omitted",
              imageSlot: "optional",
              servedCoverAssetId: null,
            } as StoredDailyImageSet["slots"][number];
            deliveryAction = "optional_omitted";
          } else {
            const fallback =
              slot.fallbackAssetId === null ? undefined : assets.get(slot.fallbackAssetId);
            if (
              slot.fallbackAssetId === null ||
              withdrawn.has(slot.fallbackAssetId) ||
              globallyWithdrawn.has(slot.fallbackAssetId) ||
              !isDeliverableAdminImageAsset(fallback)
            ) {
              if (projection.activeContentVersion === input.contentVersion) {
                blocked = true;
              } else {
                next = {
                  ...next,
                  deliveryStatus: "unavailable",
                  servedCoverAssetId: null,
                } as StoredDailyImageSet["slots"][number];
              }
            } else {
              next = {
                ...next,
                deliveryStatus: "fallback",
                servedCoverAssetId: slot.fallbackAssetId,
              } as StoredDailyImageSet["slots"][number];
              deliveryAction = "fallback_activated";
            }
          }
        }
        if (slot.servedDetailAssetIds.includes(input.assetId)) {
          next.servedDetailAssetIds = slot.servedDetailAssetIds.filter(
            (assetId) => assetId !== input.assetId,
          );
          if (deliveryAction === "no_public_change") deliveryAction = "detail_omitted";
        }
        return next;
      });
      if (blocked) return { kind: "withdrawal_blocked" } as const;

      const now = this.clock.now().toISOString();
      const lifecycleRevision = projection.revision + 1;
      const auditEventId = this.identifiers.nextAuditEventId();
      const event = {
        assetId: input.assetId,
        auditEventId,
        reason: input.reason,
        withdrawalEventId: this.identifiers.nextWithdrawalEventId(),
        withdrawnAt: now,
      };
      const dailyImageSet = {
        ...current,
        lifecycleRevision,
        slots,
        withdrawalEvents: [...current.withdrawalEvents, event],
      };
      if (!isAdminDailyImageSet(dailyImageSet)) return { kind: "withdrawal_blocked" } as const;
      const result: ImageAssetWithdrawalResult = {
        assetId: input.assetId,
        auditEventId,
        dailyImageSet,
        deliveryAction:
          projection.activeContentVersion === input.contentVersion
            ? deliveryAction
            : "no_public_change",
        lifecycleRevision,
      };
      await transaction.updateDailyImageSet(dailyImageSet);
      await transaction.insertAuditEvent({
        action: "image_asset_withdrawn",
        actorId: input.actorId,
        auditEventId,
        contentVersion: input.contentVersion,
        fortuneDate: version.fortuneDate,
        fromState: version.state,
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
        reason: input.reason,
        requestId: input.requestId,
        toState: version.state,
      });
      await transaction.insertImageAssetWithdrawalEvent({
        contentVersion: input.contentVersion,
        event,
      });
      await transaction.updateProjection({ ...projection, revision: lifecycleRevision });
      await transaction.insertCachePurgeIntent({
        assetId: input.assetId,
        contentVersion: input.contentVersion,
        createdAt: now,
        fortuneDate: version.fortuneDate,
        purgeIntentId: this.identifiers.nextCachePurgeIntentId(),
        requestId: input.requestId,
      });
      await transaction.insertIdempotency({
        idempotencyKey: input.idempotencyKey,
        operation: "image_withdrawal",
        requestHash,
        resourceId: input.contentVersion,
        response: result,
      });
      return { kind: "withdrawn", result } as const;
    });
  }
}
