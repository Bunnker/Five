"use client";

import { useCallback, useState, type CSSProperties } from "react";

import { reviewedColorPalette } from "../lib/color-palette";
import type { TodayImagePreviewCardData } from "../lib/today";

export interface OutfitOverviewImageProps {
  card: TodayImagePreviewCardData;
  eager: boolean;
}

export function OutfitOverviewImage({ card, eager }: OutfitOverviewImageProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const handleImageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) {
      setImageFailed(true);
    }
  }, []);

  if (imageFailed) {
    return (
      <div className="outfit-overview-fallback" role="status">
        <div className="outfit-overview-fallback__swatches" aria-hidden="true">
          {card.items.map((item, index) => {
            const color = reviewedColorPalette[item.color.colorCode];
            const style = {
              "--outfit-overview-fallback-color": color.value,
            } as CSSProperties;

            return (
              <span
                className={
                  color.isLight
                    ? "outfit-overview-fallback__swatch outfit-overview-fallback__swatch--light"
                    : "outfit-overview-fallback__swatch"
                }
                data-testid={`outfit-overview-fallback-${item.color.colorCode}`}
                key={`${item.categoryLabel}:${item.color.colorCode}:${index}`}
                style={style}
              />
            );
          })}
        </div>
        <strong>已切换为配色示意</strong>
        <span>图片暂时无法显示，颜色与比例仍可参考。</span>
      </div>
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
        onError={() => setImageFailed(true)}
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
