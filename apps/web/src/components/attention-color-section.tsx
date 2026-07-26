import { reviewedColorPalette } from "../lib/color-palette";
import type { AttentionSectionData } from "../lib/today";
import { ColorSwatch } from "./visual-foundation";

const groupLabels = ["第一组", "第二组"] as const;

export interface AttentionColorSectionProps {
  section: AttentionSectionData;
}

export function AttentionColorSection({ section }: AttentionColorSectionProps) {
  return (
    <section
      className="attention-section"
      data-content-version={section.contentVersion}
      aria-labelledby="attention-section-title"
    >
      <header className="attention-section__header">
        <div>
          <p className="attention-section__eyebrow">今天建议少用</p>
          <h2 id="attention-section-title">注意</h2>
        </div>
        <p>减少大面积使用即可</p>
      </header>

      <div className="attention-section__groups">
        {section.groups.map((group, index) => (
          <div
            className="attention-group"
            data-tier-code={group.tierCode}
            data-tier-rank={group.rank}
            key={group.tierCode}
          >
            <header className="attention-group__header">
              <p>
                <span>{groupLabels[index]}</span>
                {group.elementLabel}系颜色
              </p>
              <small>{group.relationText}</small>
            </header>

            <ul
              className="color-grid attention-group__colors"
              aria-label={`${groupLabels[index]}颜色`}
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
          </div>
        ))}
      </div>

      <aside className="attention-balance">
        <div>
          <p className="attention-balance__eyebrow">已经穿了也不用换</p>
          <h3>{section.balanceSuggestion.title}</h3>
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
