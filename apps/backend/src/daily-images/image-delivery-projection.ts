import type { components } from "@five/api-contract";
import { isDeliverableAdminImageAsset } from "@five/api-contract/runtime";

import type { StoredDailyImageSet } from "./daily-image-asset.store";

type WithdrawalEvent = components["schemas"]["ImageAssetWithdrawalEvent"];

function mergedEvents(
  imageSet: StoredDailyImageSet,
  globallyApplicableEvents: readonly WithdrawalEvent[],
): WithdrawalEvent[] {
  const ordered = [...imageSet.withdrawalEvents, ...globallyApplicableEvents].sort(
    (left, right) =>
      left.withdrawnAt.localeCompare(right.withdrawnAt) ||
      left.withdrawalEventId.localeCompare(right.withdrawalEventId),
  );
  const byAssetId = new Map<string, WithdrawalEvent>();
  for (const event of ordered) {
    if (!byAssetId.has(event.assetId)) {
      byAssetId.set(event.assetId, structuredClone(event));
    }
  }
  return [...byAssetId.values()];
}

/** Rebuilds mutable delivery fields from frozen references and global deny events. */
export function projectDailyImageSet(
  imageSet: StoredDailyImageSet,
  globallyApplicableEvents: readonly WithdrawalEvent[],
): StoredDailyImageSet {
  const withdrawalEvents = mergedEvents(imageSet, globallyApplicableEvents);
  const withdrawn = new Set(withdrawalEvents.map((event) => event.assetId));
  const assets = new Map(imageSet.assets.map((asset) => [asset.assetId, asset]));
  const slots: StoredDailyImageSet["slots"] = imageSet.slots.map((slot) => {
    const servedDetailAssetIds = slot.detailAssetIds.filter(
      (assetId) => !withdrawn.has(assetId) && isDeliverableAdminImageAsset(assets.get(assetId)),
    );
    const coverUsable =
      !withdrawn.has(slot.coverAssetId) &&
      isDeliverableAdminImageAsset(assets.get(slot.coverAssetId));
    const base = { ...slot, servedDetailAssetIds };
    if (slot.imageSlot === "optional") {
      return coverUsable
        ? {
            ...base,
            deliveryStatus: "active",
            imageSlot: "optional",
            servedCoverAssetId: slot.coverAssetId,
          }
        : {
            ...base,
            deliveryStatus: "omitted",
            imageSlot: "optional",
            servedCoverAssetId: null,
          };
    }
    if (slot.fallbackAssetId === null) {
      throw new Error(`Required image slot ${slot.lookId} is missing its frozen fallback`);
    }
    const requiredBase = {
      ...base,
      fallbackAssetId: slot.fallbackAssetId,
      imageSlot: slot.imageSlot,
    };
    const fallbackUsable =
      !withdrawn.has(slot.fallbackAssetId) &&
      isDeliverableAdminImageAsset(assets.get(slot.fallbackAssetId));
    if (coverUsable) {
      return {
        ...requiredBase,
        deliveryStatus: "active",
        servedCoverAssetId: slot.coverAssetId,
      };
    }
    if (!fallbackUsable) {
      return {
        ...requiredBase,
        deliveryStatus: "unavailable",
        servedCoverAssetId: null,
      };
    }
    return {
      ...requiredBase,
      deliveryStatus: "fallback",
      servedCoverAssetId: slot.fallbackAssetId,
    };
  });
  return { ...structuredClone(imageSet), slots, withdrawalEvents };
}
