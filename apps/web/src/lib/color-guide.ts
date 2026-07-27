import type {
  AttentionSectionData,
  CiJiCardData,
  DaJiCardData,
  DecisionCardData,
  OutfitPreviewSectionData,
  PingCardData,
  TodayPageData,
} from "./today";

interface ColorGuideCard<Tier> {
  outfitHref: string;
  tier: Tier;
}

export interface ColorGuideData {
  attentionSection: AttentionSectionData;
  ciJi: ColorGuideCard<CiJiCardData>;
  contentVersion: DaJiCardData["contentVersion"];
  daJi: ColorGuideCard<DaJiCardData>;
  defaultOutfitHref: string;
  ping: ColorGuideCard<PingCardData>;
}

function findOutfitHrefForTier(
  section: OutfitPreviewSectionData,
  tierCode: DecisionCardData["tierCode"],
): string | null {
  return (
    section.cards.find((card) => card.slots.some((slot) => slot.tierCode === tierCode))?.href ??
    null
  );
}

export function toColorGuideData(today: TodayPageData | null): ColorGuideData | null {
  if (
    today === null ||
    today.daJiCard === null ||
    today.ciJiCard === null ||
    today.pingCard === null ||
    today.attentionSection === null ||
    today.outfitPreviewSection === null
  ) {
    return null;
  }

  const versions = [
    today.daJiCard.contentVersion,
    today.ciJiCard.contentVersion,
    today.pingCard.contentVersion,
    today.attentionSection.contentVersion,
    today.outfitPreviewSection.contentVersion,
  ];
  if (!versions.every((version) => version === versions[0])) {
    return null;
  }

  const daJiOutfitHref = findOutfitHrefForTier(today.outfitPreviewSection, "da_ji");
  const ciJiOutfitHref = findOutfitHrefForTier(today.outfitPreviewSection, "ci_ji");
  const pingOutfitHref = findOutfitHrefForTier(today.outfitPreviewSection, "ping");
  const defaultOutfitHref =
    today.outfitPreviewSection.cards.find((card) => card.kind === "mono")?.href ?? null;
  if (
    daJiOutfitHref === null ||
    ciJiOutfitHref === null ||
    pingOutfitHref === null ||
    defaultOutfitHref === null
  ) {
    return null;
  }

  return {
    attentionSection: today.attentionSection,
    ciJi: {
      outfitHref: ciJiOutfitHref,
      tier: today.ciJiCard,
    },
    contentVersion: today.daJiCard.contentVersion,
    daJi: {
      outfitHref: daJiOutfitHref,
      tier: today.daJiCard,
    },
    defaultOutfitHref,
    ping: {
      outfitHref: pingOutfitHref,
      tier: today.pingCard,
    },
  };
}
