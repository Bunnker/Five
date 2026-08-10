import { reviewedColorPalette } from "../lib/color-palette";
import type { AttentionGroupData, AttentionSectionData, DecisionCardData } from "../lib/today";
import { ColorSwatch } from "./visual-foundation";

const cardPresentation = {
  bu_li: {
    cardId: "bu-li-card-title",
    headingLabel: "不利 · 今日先收起",
    priority: "quinary",
  },
  ci_ji: {
    cardId: "ci-ji-card-title",
    headingLabel: "稳妥选择",
    priority: "secondary",
  },
  da_ji: {
    cardId: "da-ji-card-title",
    headingLabel: "今日优先",
    priority: "primary",
  },
  jiao_cha: {
    cardId: "jiao-cha-card-title",
    headingLabel: "较差 · 建议减少",
    priority: "quaternary",
  },
  ping: {
    cardId: "ping-card-title",
    headingLabel: "日常可穿",
    priority: "tertiary",
  },
} as const;

type LowerTierCardData = AttentionGroupData & {
  contentVersion: AttentionSectionData["contentVersion"];
};

interface PositiveDecisionColorCardProps {
  actionHref?: string | undefined;
  tier: DecisionCardData;
}

interface LowerTierDecisionColorCardProps {
  actionHref?: never;
  tier: LowerTierCardData;
}

export type DecisionColorCardProps =
  LowerTierDecisionColorCardProps | PositiveDecisionColorCardProps;

export function DecisionColorCard({ actionHref, tier }: DecisionColorCardProps) {
  const { cardId, headingLabel, priority } = cardPresentation[tier.tierCode];

  return (
    <article
      className={`decision-card today-tier-card decision-card--${priority}`}
      data-content-version={tier.contentVersion}
      data-tier-element={tier.element}
      data-tier-code={tier.tierCode}
      data-tier-rank={tier.rank}
      aria-labelledby={cardId}
    >
      <div
        className="decision-card__rank"
        data-admin-selection-key={`tier.${tier.tierCode}.algorithm`}
        aria-label={`第 ${tier.rank} 档`}
      >
        <span className="decision-card__number">{String(tier.rank).padStart(2, "0")}</span>
        <span className="decision-card__algorithm">{tier.algorithmLabel}</span>
      </div>

      <div
        className="decision-card__body"
        data-admin-selection-key={`tier.${tier.tierCode}.explanation`}
      >
        <header className="decision-card__header">
          <h2 id={cardId}>{headingLabel}</h2>
          <p className="decision-card__element">
            <strong>{tier.elementLabel}</strong>
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

        <p
          className="decision-card__explanation"
          data-admin-selection-key={`tier.${tier.tierCode}.explanation`}
        >
          {tier.explanation}
        </p>

        {actionHref === undefined ? null : (
          <a
            aria-label={`查看${tier.algorithmLabel}穿法`}
            className="decision-card__action"
            href={actionHref}
          >
            <span>查看穿法</span>
            <span aria-hidden="true">›</span>
          </a>
        )}
      </div>
    </article>
  );
}
