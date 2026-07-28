"use client";

import type { TodayImagePreviewCardData } from "../lib/today";
import { ReviewedImageFallback, useReviewedImageFailure } from "./reviewed-image";

export interface OutfitOverviewImageProps {
  card: TodayImagePreviewCardData;
  contentVersion: string;
  eager: boolean;
}

export function OutfitOverviewImage({ card, contentVersion, eager }: OutfitOverviewImageProps) {
  const { handleImageError, handleImageRef, imageFailed } = useReviewedImageFailure({
    assetId: card.assetId,
    contentVersion,
    url: card.url,
  });

  if (imageFailed) {
    return (
      <ReviewedImageFallback items={card.items} note="图片暂时无法显示，颜色与比例仍可参考。" />
    );
  }

  return (
    <>
      <img
        alt={card.altText}
        decoding="async"
        fetchPriority={eager ? "high" : "auto"}
        height={card.height}
        loading={eager ? "eager" : "lazy"}
        onError={handleImageError}
        ref={handleImageRef}
        referrerPolicy="no-referrer"
        src={card.url}
        width={card.width}
      />
      {card.aiDisclosure === null ? null : (
        <span className="outfit-overview__disclosure">{card.aiDisclosure}</span>
      )}
    </>
  );
}
