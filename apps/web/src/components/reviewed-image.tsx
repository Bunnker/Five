"use client";

import { useCallback, useState, type CSSProperties } from "react";

import { reviewedColorPalette } from "../lib/color-palette";
import type { TodayImagePreviewItemData } from "../lib/today";

interface ReviewedImageIdentity {
  assetId: string;
  contentVersion: string;
  url: string;
}

export function useReviewedImageFailure({ assetId, contentVersion, url }: ReviewedImageIdentity) {
  const imageIdentity = JSON.stringify([contentVersion, assetId, url]);
  const [failedImageIdentity, setFailedImageIdentity] = useState<string | null>(null);
  const imageFailed = failedImageIdentity === imageIdentity;
  const handleImageRef = useCallback(
    (image: HTMLImageElement | null) => {
      if (image?.complete && image.naturalWidth === 0) {
        setFailedImageIdentity(imageIdentity);
      }
    },
    [imageIdentity],
  );
  const handleImageError = useCallback(() => {
    setFailedImageIdentity(imageIdentity);
  }, [imageIdentity]);

  return { handleImageError, handleImageRef, imageFailed };
}

interface ReviewedImageFallbackProps {
  items: TodayImagePreviewItemData[];
  note: string;
}

export function ReviewedImageFallback({ items, note }: ReviewedImageFallbackProps) {
  return (
    <div className="reviewed-image-fallback" role="status">
      <ul className="reviewed-image-fallback__colors" aria-label="审核配色">
        {items.map((item, index) => {
          const color = reviewedColorPalette[item.color.colorCode];
          const style = {
            "--reviewed-image-color": color.value,
          } as CSSProperties;

          return (
            <li
              className="reviewed-image-fallback__color"
              key={`${item.categoryLabel}:${item.color.colorCode}:${index}`}
            >
              <span
                aria-hidden="true"
                className={
                  color.isLight
                    ? "reviewed-image-fallback__swatch reviewed-image-fallback__swatch--light"
                    : "reviewed-image-fallback__swatch"
                }
                data-testid={`reviewed-image-fallback-${item.color.colorCode}`}
                style={style}
              />
              <span>{item.color.name}</span>
            </li>
          );
        })}
      </ul>
      <strong>已切换为配色示意</strong>
      <span>{note}</span>
    </div>
  );
}
