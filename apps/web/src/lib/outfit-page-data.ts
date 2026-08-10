import { loadLookDetail, type LookDetailData, type LookDetailLoadResult } from "./look-detail";
import { parsePublicChannelId } from "./channel-links";
import {
  loadToday,
  resolveOutfitPreviewImages,
  type OutfitPreviewCardData,
  type TodayImagePreviewCardData,
  type TodayPageData,
} from "./today";

export type OutfitSearchParamValue = string | string[] | undefined;

export interface SelectedOutfit {
  cards: OutfitPreviewCardData[];
  channelId: string;
  contentVersion: string;
  effectiveTo?: string;
  fortuneDate: string;
  imagesByFormula: ReadonlyMap<string, TodayImagePreviewCardData>;
  selectedCard: OutfitPreviewCardData;
  shareHref: string | null;
  responseGeneratedAt?: string;
  view: "all" | "plan";
}

type SelectionErrorReason = "invalid" | "stale" | "unavailable";
type DetailErrorReason = Exclude<LookDetailLoadResult["status"], "ready">;

export type OutfitPageDataResult =
  | {
      reason: SelectionErrorReason;
      status: "selection-error";
    }
  | {
      selection: SelectedOutfit;
      status: "overview";
    }
  | {
      detail: LookDetailData;
      selection: SelectedOutfit;
      status: "detail";
    }
  | {
      reason: DetailErrorReason;
      selection: SelectedOutfit;
      status: "detail-error";
    };

interface LoadOutfitPageDataOptions {
  params: Record<string, OutfitSearchParamValue>;
  requestId?: string | null;
}

type OutfitSelectionResult =
  | {
      selection: SelectedOutfit;
      status: "selected";
    }
  | {
      status: SelectionErrorReason;
    };

function getSingleSearchParam(value: OutfitSearchParamValue): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : null;
}

function selectOutfit(
  today: TodayPageData | null,
  params: Record<string, OutfitSearchParamValue>,
): OutfitSelectionResult {
  const expectedContentVersion = getSingleSearchParam(params.expectedContentVersion);
  const carriesChannelId = params.channelId !== undefined;
  const channelId = carriesChannelId ? parsePublicChannelId(params.channelId) : "organic";
  const formulaId = getSingleSearchParam(params.formulaId);
  const fortuneDate = getSingleSearchParam(params.fortuneDate);
  const view = params.view === undefined ? "all" : getSingleSearchParam(params.view);

  if (
    channelId === null ||
    expectedContentVersion === null ||
    formulaId === null ||
    fortuneDate === null ||
    (view !== "all" && view !== "plan")
  ) {
    return { status: "invalid" };
  }

  const section = today?.outfitPreviewSection;
  if (today === null || section === null || section === undefined) {
    return { status: "unavailable" };
  }

  if (
    today.content.fortuneDate !== fortuneDate ||
    section.contentVersion !== expectedContentVersion
  ) {
    return { status: "stale" };
  }

  const selectedCard = section.cards.find((candidate) => candidate.formulaId === formulaId);
  if (selectedCard === undefined) {
    return { status: "invalid" };
  }

  return {
    selection: {
      cards: section.cards,
      channelId,
      contentVersion: section.contentVersion,
      effectiveTo: today.content.effectiveTo,
      fortuneDate,
      imagesByFormula: resolveOutfitPreviewImages(section, today.imagePreviewSection),
      selectedCard,
      shareHref:
        today.nextSteps?.contentVersion === section.contentVersion
          ? today.nextSteps.shareHref
          : null,
      responseGeneratedAt: today.requestContext.responseGeneratedAt,
      view,
    },
    status: "selected",
  };
}

export function resolveLookDetailSnapshot(
  result: LookDetailLoadResult,
  lookId: string,
  selection: SelectedOutfit,
): LookDetailLoadResult {
  if (result.status !== "ready") {
    return result;
  }

  const { detail } = result;
  if (
    detail.contentVersion !== selection.contentVersion ||
    detail.fortuneDate !== selection.fortuneDate ||
    detail.formulaId !== selection.selectedCard.formulaId ||
    detail.lookId !== lookId ||
    detail.scenarioLabel !== selection.selectedCard.scenarioLabel
  ) {
    return { status: "invalid" };
  }

  const selectedPreview = selection.imagesByFormula.get(selection.selectedCard.formulaId);
  if (
    selectedPreview === undefined ||
    selectedPreview.lookId !== lookId ||
    selectedPreview.title !== detail.title ||
    selectedPreview.assetId !== detail.coverImage.assetId ||
    selectedPreview.url !== detail.coverImage.url ||
    selectedPreview.altText !== detail.coverImage.altText ||
    selectedPreview.width !== detail.coverImage.width ||
    selectedPreview.height !== detail.coverImage.height ||
    selectedPreview.mediaType !== detail.coverImage.mediaType ||
    selectedPreview.aiDisclosure !== detail.coverImage.aiDisclosure
  ) {
    return { status: "invalid" };
  }

  const formulaColorCodes = new Set(
    selection.selectedCard.slots.flatMap((slot) => slot.colors.map((color) => color.colorCode)),
  );
  if (!detail.items.every((item) => formulaColorCodes.has(item.colorCode))) {
    return { status: "invalid" };
  }

  const detailItemSignatures = detail.items
    .map((item) => `${item.categoryLabel}\n${item.colorCode}`)
    .sort();
  const previewItemSignatures = selectedPreview.items
    .map((item) => `${item.categoryLabel}\n${item.color.colorCode}`)
    .sort();
  const hasSameItems =
    detailItemSignatures.length === previewItemSignatures.length &&
    detailItemSignatures.every((signature, index) => signature === previewItemSignatures[index]);

  return hasSameItems ? result : { status: "invalid" };
}

export async function loadOutfitPageData({
  params,
  requestId,
}: LoadOutfitPageDataOptions): Promise<OutfitPageDataResult> {
  const today = await loadToday({ requestId });
  const resolution = selectOutfit(today, params);
  if (resolution.status !== "selected") {
    return { reason: resolution.status, status: "selection-error" };
  }

  const { selection } = resolution;
  if (selection.view === "all") {
    return { selection, status: "overview" };
  }

  const lookId = getSingleSearchParam(params.lookId);
  const selectedPreview = selection.imagesByFormula.get(selection.selectedCard.formulaId);
  if (lookId === null || selectedPreview?.lookId !== lookId) {
    return { reason: "invalid", selection, status: "detail-error" };
  }

  const detailResult = resolveLookDetailSnapshot(
    await loadLookDetail({
      expectedContentVersion: selection.contentVersion,
      fortuneDate: selection.fortuneDate,
      lookId,
      requestId,
    }),
    lookId,
    selection,
  );
  if (detailResult.status !== "ready") {
    return { reason: detailResult.status, selection, status: "detail-error" };
  }

  return { detail: detailResult.detail, selection, status: "detail" };
}
