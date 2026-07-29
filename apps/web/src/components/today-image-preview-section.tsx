"use client";

import type { CSSProperties } from "react";

import { reviewedColorPalette } from "../lib/color-palette";
import type { TodayImagePreviewCardData, TodayImagePreviewSectionData } from "../lib/today";
import { ReviewedImageFallback, useReviewedImageFailure } from "./reviewed-image";

export interface TodayImagePreviewSectionProps {
  dateLabel?: "今日" | "当日";
  section: TodayImagePreviewSectionData;
}

interface TodayImagePreviewCardProps {
  card: TodayImagePreviewCardData;
  contentVersion: string;
}

function TodayImagePreviewCard({ card, contentVersion }: TodayImagePreviewCardProps) {
  const titleId = `today-image-title-${card.sortOrder}`;
  const { handleImageError, handleImageRef, imageFailed } = useReviewedImageFailure({
    assetId: card.assetId,
    contentVersion,
    url: card.url,
  });

  return (
    <article
      aria-labelledby={titleId}
      className={`today-image-card today-image-card--${card.placement}`}
      data-content-version={contentVersion}
      data-image-placement={card.placement}
    >
      <div className="today-image-card__media">
        {imageFailed ? (
          <ReviewedImageFallback items={card.items} note="图片暂时无法显示，今日配色仍可参考。" />
        ) : (
          <img
            alt={card.altText}
            decoding="async"
            fetchPriority={card.placement === "primary" ? "high" : "auto"}
            height={card.height}
            loading={card.placement === "primary" ? "eager" : "lazy"}
            onError={handleImageError}
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

export function TodayImagePreviewSection({
  dateLabel = "今日",
  section,
}: TodayImagePreviewSectionProps) {
  return (
    <section
      aria-labelledby="today-image-preview-title"
      className="today-image-preview"
      data-content-version={section.contentVersion}
    >
      <header className="today-image-preview__header">
        <div>
          <p className="today-image-preview__eyebrow">图片预览</p>
          <h2 id="today-image-preview-title">{dateLabel}图片示范</h2>
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
