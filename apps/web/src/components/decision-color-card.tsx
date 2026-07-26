import { reviewedColorPalette } from "../lib/color-palette";
import type { DecisionCardData } from "../lib/today";
import { ColorSwatch } from "./visual-foundation";

const cardPresentation = {
  ci_ji: {
    cardId: "ci-ji-card-title",
    priority: "secondary",
  },
  da_ji: {
    cardId: "da-ji-card-title",
    priority: "primary",
  },
  ping: {
    cardId: "ping-card-title",
    priority: "tertiary",
  },
} as const;

export interface DecisionColorCardProps {
  tier: DecisionCardData;
}

export function DecisionColorCard({ tier }: DecisionColorCardProps) {
  const { cardId, priority } = cardPresentation[tier.tierCode];

  return (
    <article
      className={`decision-card decision-card--${priority}`}
      data-content-version={tier.contentVersion}
      data-tier-element={tier.element}
      aria-labelledby={cardId}
    >
      <div className="decision-card__rank" aria-label={`第 ${tier.rank} 档`}>
        <span className="decision-card__number">{String(tier.rank).padStart(2, "0")}</span>
        <span className="decision-card__algorithm">{tier.algorithmLabel}</span>
      </div>

      <div className="decision-card__body">
        <header className="decision-card__header">
          <h2 id={cardId}>{tier.displayLabel}</h2>
          <p className="decision-card__element">
            <span>{tier.elementLabel}</span>
            {tier.relationText}
          </p>
        </header>

        <ul className="color-grid decision-card__colors" aria-label={`${tier.algorithmLabel}颜色`}>
          {tier.colors.map((color) => {
            const presentation = reviewedColorPalette[color.colorCode];

            return (
              <ColorSwatch
                colorCode={color.colorCode}
                isLight={presentation.isLight}
                key={color.colorCode}
                name={color.name}
                value={presentation.value}
              />
            );
          })}
        </ul>

        <p className="decision-card__explanation">{tier.explanation}</p>
      </div>
    </article>
  );
}
