import type { components } from "@five/api-contract";
import { isAdminDailyImageSet } from "@five/api-contract/runtime";

import type { StoredContentVersion } from "../content-lifecycle/content-lifecycle.store";
import type { StoredDailyImageSet } from "../daily-images/daily-image-asset.store";

type AdminImageAsset = components["schemas"]["AdminImageAsset"];
type DailyContent = components["schemas"]["DailyContent"];
type PublicImageAsset = components["schemas"]["PublicImageAsset"];
type PublicLook = components["schemas"]["PublicLook"];

const REVIEWED_AI_DISCLOSURE = "AI 生成穿搭示意图";

function publicImage(asset: AdminImageAsset | undefined): PublicImageAsset | null {
  if (asset?.fileUrl === null || asset?.reviewStatus !== "approved") return null;
  if (asset === undefined) return null;

  const aiGenerated = asset.sourceType === "ai_generated";
  return {
    aiDisclosure: aiGenerated ? REVIEWED_AI_DISCLOSURE : null,
    aiGenerated,
    altText: asset.altText,
    assetId: asset.assetId,
    height: asset.height,
    mediaType: asset.mediaType,
    url: asset.fileUrl,
    width: asset.width,
  };
}

export function projectPublishedDailyContent(
  version: StoredContentVersion,
  imageSet: StoredDailyImageSet,
): DailyContent | null {
  const calendar = version.snapshot.calendar_algorithm;
  const copy = version.snapshot.copy_and_formula;
  const visual = version.snapshot.visual_and_rights;
  const poster = version.snapshot.poster_consistency;
  if (
    version.state !== "published" ||
    version.effectiveFrom === null ||
    version.effectiveTo === null ||
    calendar === null ||
    copy === null ||
    visual === null ||
    poster === null ||
    !isAdminDailyImageSet(imageSet) ||
    imageSet.contentVersion !== version.contentVersion ||
    imageSet.fortuneDate !== version.fortuneDate
  ) {
    return null;
  }

  const assets = new Map(imageSet.assets.map((asset) => [asset.assetId, asset]));
  const slots = new Map(imageSet.slots.map((slot) => [slot.lookId, slot]));
  const looks: PublicLook[] = [];

  for (const look of [...visual.looks].sort((left, right) => left.sortOrder - right.sortOrder)) {
    const slot = slots.get(look.lookId);
    if (slot === undefined) return null;
    if (slot.deliveryStatus === "omitted" && look.imageSlot === "optional") continue;
    if (slot.servedCoverAssetId === null) return null;

    const coverImage = publicImage(assets.get(slot.servedCoverAssetId));
    if (coverImage === null) return null;
    const detailImages = slot.servedDetailAssetIds.map((assetId) =>
      publicImage(assets.get(assetId)),
    );
    if (detailImages.some((asset) => asset === null)) return null;

    looks.push({
      alternatives: structuredClone(look.alternatives),
      audience: structuredClone(look.audience),
      coverImage,
      detailImages: detailImages as PublicImageAsset[],
      formulaId: look.formulaId,
      items: structuredClone(look.items),
      lookId: look.lookId,
      requiredForPublish: look.requiredForPublish,
      scenario: structuredClone(look.scenario),
      sortOrder: look.sortOrder,
      title: look.title,
    });
  }

  return {
    balanceSuggestion: structuredClone(copy.balanceSuggestion),
    basis: structuredClone(copy.basis),
    calendar: structuredClone(calendar.calendar),
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    fortuneDate: version.fortuneDate,
    looks,
    outfitFormulas: structuredClone(copy.outfitFormulas),
    share: structuredClone(copy.share),
    tiers: structuredClone(calendar.tiers),
    versions: {
      algorithmVersion: calendar.algorithmVersion,
      assetManifestVersion: visual.assetManifestVersion,
      calendarDataVersion: calendar.calendarDataVersion,
      calendarRuleVersion: calendar.calendarRuleVersion,
      contentVersion: version.contentVersion,
      copyVersion: copy.copyVersion,
      outfitVersion: copy.outfitVersion,
      posterTemplateVersion: poster.posterTemplateVersion,
    },
  };
}
