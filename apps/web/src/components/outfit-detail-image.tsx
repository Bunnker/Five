"use client";

import type { LookDetailImageData } from "../lib/look-detail";
import type { TodayImagePreviewItemData } from "../lib/today";
import { ReviewedImageFallback, useReviewedImageFailure } from "./reviewed-image";

interface OutfitDetailImageProps {
  caption: string;
  contentVersion: string;
  eager: boolean;
  image: LookDetailImageData;
  items: TodayImagePreviewItemData[];
}

export function OutfitDetailImage({
  caption,
  contentVersion,
  eager,
  image,
  items,
}: OutfitDetailImageProps) {
  const { handleImageError, handleImageRef, imageFailed } = useReviewedImageFailure({
    assetId: image.assetId,
    contentVersion,
    url: image.url,
  });

  return (
    <figure className="outfit-detail__figure">
      <div
        className={
          imageFailed
            ? "outfit-detail__image outfit-detail__image--fallback"
            : "outfit-detail__image"
        }
      >
        {imageFailed ? (
          <ReviewedImageFallback
            aiDisclosure={image.aiDisclosure}
            contentVersion={contentVersion}
            items={items}
            note="图片暂时无法显示，下方颜色与穿法仍可参考。"
          />
        ) : (
          <>
            <img
              alt={image.altText}
              decoding="async"
              fetchPriority={eager ? "high" : "auto"}
              height={image.height}
              loading={eager ? "eager" : "lazy"}
              onError={handleImageError}
              ref={handleImageRef}
              referrerPolicy="no-referrer"
              src={image.url}
              width={image.width}
            />
            {image.aiDisclosure === null ? null : (
              <span className="outfit-overview__disclosure">{image.aiDisclosure}</span>
            )}
          </>
        )}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
