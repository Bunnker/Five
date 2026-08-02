import type { StoredDailyImageSet } from "./daily-image-asset.store";

export interface CurrentImageReleaseSafety {
  readonly requiredSlotsSafe: boolean;
  readonly withdrawnAssetIds: ReadonlySet<string>;
}

export function assessCurrentImageReleaseSafety(
  imageSet: StoredDailyImageSet | null,
  globallyWithdrawnAssetIds: readonly string[] = [],
): CurrentImageReleaseSafety {
  const withdrawnAssetIds = new Set([
    ...globallyWithdrawnAssetIds,
    ...(imageSet?.withdrawalEvents.map((event) => event.assetId) ?? []),
  ]);
  const requiredSlotsSafe =
    imageSet === null ||
    imageSet.slots
      .filter((slot) => slot.imageSlot !== "optional")
      .every((slot) => {
        if (
          slot.fallbackAssetId === null ||
          withdrawnAssetIds.has(slot.fallbackAssetId) ||
          slot.servedCoverAssetId === null ||
          withdrawnAssetIds.has(slot.servedCoverAssetId)
        ) {
          return false;
        }
        if (slot.deliveryStatus === "active") {
          return slot.servedCoverAssetId === slot.coverAssetId;
        }
        return (
          slot.deliveryStatus === "fallback" && slot.servedCoverAssetId === slot.fallbackAssetId
        );
      });
  return { requiredSlotsSafe, withdrawnAssetIds };
}
