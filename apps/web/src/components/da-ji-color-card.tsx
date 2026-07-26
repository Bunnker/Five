import { reviewedColorPalette } from "../lib/color-palette";
import type { DaJiCardData } from "../lib/today";
import { ColorSwatch } from "./visual-foundation";

export interface DaJiColorCardProps {
  tier: DaJiCardData;
}

export function DaJiColorCard({ tier }: DaJiColorCardProps) {
  return (
    <article
      className="decision-card decision-card--primary"
      data-content-version={tier.contentVersion}
      data-tier-element={tier.element}
      aria-labelledby="da-ji-card-title"
    >
      <div className="decision-card__rank" aria-label={`第 ${tier.rank} 档`}>
        <span className="decision-card__number">{String(tier.rank).padStart(2, "0")}</span>
        <span className="decision-card__algorithm">{tier.algorithmLabel}</span>
      </div>

      <div className="decision-card__body">
        <header className="decision-card__header">
          <h2 id="da-ji-card-title">{tier.displayLabel}</h2>
          <p className="decision-card__element">
            <span>{tier.elementLabel}</span>
            {tier.relationText}
          </p>
        </header>

        <ul className="color-grid decision-card__colors" aria-label="大吉颜色">
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
