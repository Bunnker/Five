import type { CSSProperties } from "react";

import { reviewedColorPalette } from "../lib/color-palette";
import { withPublicChannelId } from "../lib/channel-links";
import type { OutfitPreviewSectionData } from "../lib/today";

const cardPresentation = {
  dual: {
    label: "双色",
    number: "02",
  },
  mono: {
    label: "单色",
    number: "01",
  },
  triple: {
    label: "三色",
    number: "03",
  },
} as const;

export interface OutfitPreviewSectionProps {
  channelId?: string;
  dateLabel?: "今日" | "当日";
  interactive?: boolean;
  section: OutfitPreviewSectionData;
}

export function OutfitPreviewSection({
  channelId,
  dateLabel = "今日",
  interactive = true,
  section,
}: OutfitPreviewSectionProps) {
  return (
    <section
      aria-labelledby="outfit-preview-title"
      className="outfit-preview"
      data-content-version={section.contentVersion}
    >
      <header className="outfit-preview__header">
        <div>
          <p className="outfit-preview__eyebrow">组合预览</p>
          <h2 id="outfit-preview-title">{dateLabel}怎么搭</h2>
        </div>
        <p>单色、双色、三色</p>
      </header>

      <div className="outfit-preview__cards">
        {section.cards.map((card) => {
          const presentation = cardPresentation[card.kind];

          const cardContent = (
            <>
              <div className="outfit-preview-card__topline" aria-hidden="true">
                <span>{presentation.number}</span>
                <span>{presentation.label}</span>
              </div>

              <h3 data-admin-selection-key={`formula.${card.formulaId}.title`}>{card.title}</h3>

              <ul
                className="outfit-preview-card__slots"
                aria-label={`${presentation.label}颜色组合`}
              >
                {card.slots.map((slot) => (
                  <li className="outfit-preview-slot" key={slot.role}>
                    <div className="outfit-preview-slot__meta">
                      <span>{slot.roleLabel}</span>
                      {slot.ratioPercent === null ? null : <strong>{slot.ratioPercent}%</strong>}
                    </div>
                    <ul aria-label={`${slot.roleLabel}颜色`}>
                      {slot.colors.map((color) => {
                        const colorPresentation = reviewedColorPalette[color.colorCode];
                        const dotClassName = colorPresentation.isLight
                          ? "outfit-preview-color__dot outfit-preview-color__dot--light"
                          : "outfit-preview-color__dot";
                        const style = {
                          "--outfit-color": colorPresentation.value,
                        } as CSSProperties;

                        return (
                          <li className="outfit-preview-color" key={color.colorCode}>
                            <span
                              aria-hidden="true"
                              className={dotClassName}
                              data-testid={`outfit-color-dot-${color.colorCode}`}
                              style={style}
                            />
                            <span>{color.name}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>

              {interactive ? (
                <span className="outfit-preview-card__action" aria-hidden="true">
                  查看穿法
                  <span>›</span>
                </span>
              ) : null}
            </>
          );

          const className = `outfit-preview-card outfit-preview-card--${card.kind}${
            interactive ? "" : " outfit-preview-card--static"
          }`;
          return interactive ? (
            <a
              aria-label={`查看${presentation.label}穿法：${card.title}`}
              className={className}
              data-admin-selection-key={`formula.${card.formulaId}.disclaimer`}
              data-content-version={section.contentVersion}
              data-outfit-kind={card.kind}
              href={withPublicChannelId(card.href, channelId)}
              key={card.formulaId}
            >
              {cardContent}
            </a>
          ) : (
            <article
              aria-label={`${presentation.label}穿法：${card.title}`}
              className={className}
              data-admin-selection-key={`formula.${card.formulaId}.disclaimer`}
              data-content-version={section.contentVersion}
              data-outfit-kind={card.kind}
              key={card.formulaId}
            >
              {cardContent}
            </article>
          );
        })}
      </div>

      <p className="outfit-preview__disclaimer">比例为穿搭参考，不是五行推算规则。</p>
    </section>
  );
}
