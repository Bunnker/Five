import { reviewedColorPalette } from "../lib/color-palette";
import type { AttentionSectionData } from "../lib/today";
import { ColorSwatch } from "./visual-foundation";

export interface AttentionColorSectionProps {
  section: AttentionSectionData;
}

export function AttentionColorSection({ section }: AttentionColorSectionProps) {
  return (
    <section
      className="attention-section"
      data-content-version={section.contentVersion}
      aria-labelledby="lower-tier-section-title"
    >
      <header className="attention-section__header">
        <div>
          <p className="attention-section__eyebrow">今天建议少用</p>
          <h2 id="lower-tier-section-title">较差 · 不利</h2>
        </div>
        <p>大面积使用请谨慎</p>
      </header>

      <div className="attention-section__groups">
        {section.groups.map((group) => (
          <div
            className="attention-group"
            data-tier-code={group.tierCode}
            data-tier-rank={group.rank}
            key={group.tierCode}
          >
            <header className="attention-group__header">
              <span aria-hidden="true" className="attention-group__rank">
                {String(group.rank).padStart(2, "0")}
              </span>
              <div>
                <h3>{group.algorithmLabel}</h3>
                <p>{group.elementLabel}系颜色</p>
              </div>
              <small>{group.relationText}</small>
            </header>

            <ul
              className="color-grid attention-group__colors"
              aria-label={`${group.algorithmLabel}颜色`}
            >
              {group.colors.map((color) => {
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

            <p className="attention-group__explanation">{group.explanation}</p>
          </div>
        ))}
      </div>

      <aside className="attention-balance">
        <div>
          <p className="attention-balance__eyebrow">已经穿了也不用换</p>
          <h3>用大吉色小配饰补充</h3>
          <p>{section.balanceSuggestion.description}</p>
        </div>
        <ul aria-label="可选的小面积配饰">
          {section.balanceSuggestion.accessoryExamples.map((example) => (
            <li key={example}>{example}</li>
          ))}
        </ul>
      </aside>
    </section>
  );
}
