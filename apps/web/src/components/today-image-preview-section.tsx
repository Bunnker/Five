"use client";

import { useCallback, useState, type CSSProperties } from "react";

import { reviewedColorPalette } from "../lib/color-palette";
import type { TodayImagePreviewCardData, TodayImagePreviewSectionData } from "../lib/today";

export interface TodayImagePreviewSectionProps {
  section: TodayImagePreviewSectionData;
}

interface TodayImagePreviewCardProps {
  card: TodayImagePreviewCardData;
  contentVersion: string;
}

function TodayImagePreviewCard({ card, contentVersion }: TodayImagePreviewCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const titleId = `today-image-title-${card.sortOrder}`;
  const handleImageRef = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) {
      setImageFailed(true);
    }
  }, []);

  return (
    <article
      aria-labelledby={titleId}
      className={`today-image-card today-image-card--${card.placement}`}
      data-content-version={contentVersion}
      data-image-placement={card.placement}
    >
      <div className="today-image-card__media">
        {imageFailed ? (
          <div className="today-image-fallback" role="status">
            <div className="today-image-fallback__swatches" aria-hidden="true">
              {card.items.map((item, index) => {
                const color = reviewedColorPalette[item.color.colorCode];
                const style = {
                  "--today-image-color": color.value,
                } as CSSProperties;

                return (
                  <span
                    className={
                      color.isLight
                        ? "today-image-fallback__swatch today-image-fallback__swatch--light"
                        : "today-image-fallback__swatch"
                    }
                    data-testid={`image-fallback-swatch-${item.color.colorCode}`}
                    key={`${item.categoryLabel}-${item.color.colorCode}-${index}`}
                    style={style}
                  />
                );
              })}
            </div>
            <strong>已切换为配色示意</strong>
            <span>图片暂时无法显示，今日配色仍可参考。</span>
          </div>
        ) : (
          <img
            alt={card.altText}
            decoding="async"
            fetchPriority={card.placement === "primary" ? "high" : "auto"}
            height={card.height}
            loading={card.placement === "primary" ? "eager" : "lazy"}
            onError={() => setImageFailed(true)}
            ref={handleImageRef}
            referrerPolicy="no-referrer"
            src={card.url}
            width={card.width}
          />
        )}
      </div>

      <div className="today-image-card__body">
        <div className="today-image-card__meta">
          <span>{card.displayLabel}</span>
          <span>{card.scenarioLabel}</span>
        </div>
        <h3 id={titleId}>{card.title}</h3>

        <ul className="today-image-card__items" aria-label={`${card.title}配色`}>
          {card.items.map((item, index) => {
            const color = reviewedColorPalette[item.color.colorCode];
            const style = {
              "--today-image-color": color.value,
            } as CSSProperties;

            return (
              <li key={`${item.categoryLabel}-${item.color.colorCode}-${index}`}>
                <span
                  aria-hidden="true"
                  className={
                    color.isLight
                      ? "today-image-color__dot today-image-color__dot--light"
                      : "today-image-color__dot"
                  }
                  data-testid={`today-image-dot-${item.color.colorCode}`}
                  style={style}
                />
                <span className="today-image-card__item-label">{item.categoryLabel}</span>
                <span>{item.color.name}</span>
              </li>
            );
          })}
        </ul>

        {imageFailed || card.aiDisclosure === null ? null : (
          <p className="today-image-card__disclosure">{card.aiDisclosure}</p>
        )}
      </div>
    </article>
  );
}

export function TodayImagePreviewSection({ section }: TodayImagePreviewSectionProps) {
  return (
    <section
      aria-labelledby="today-image-preview-title"
      className="today-image-preview"
      data-content-version={section.contentVersion}
    >
      <header className="today-image-preview__header">
        <div>
          <p className="today-image-preview__eyebrow">图片预览</p>
          <h2 id="today-image-preview-title">今日图片示范</h2>
        </div>
        <p>2 张重点参考 · 最多 1 张补充</p>
      </header>

      <div className="today-image-preview__grid">
        {section.cards.map((card) => (
          <TodayImagePreviewCard
            card={card}
            contentVersion={section.contentVersion}
            key={`${section.contentVersion}:${card.lookId}:${card.assetId}:${card.url}`}
          />
        ))}
      </div>

      <p className="today-image-preview__note">图片只作穿搭示意，颜色名称以当天文字说明为准。</p>
    </section>
  );
}
