import type { AttentionSectionData } from "../lib/today";
import { DecisionColorCard } from "./decision-color-card";

export interface AttentionColorSectionProps {
  section: AttentionSectionData;
}

export function AttentionColorSection({ section }: AttentionColorSectionProps) {
  return (
    <section
      aria-label="较差 · 不利"
      className="attention-section attention-section--tier-cards"
      data-content-version={section.contentVersion}
    >
      <div className="attention-section__groups">
        {section.groups.map((group) => (
          <DecisionColorCard
            key={group.tierCode}
            tier={{ ...group, contentVersion: section.contentVersion }}
          />
        ))}
      </div>

      <aside className="attention-balance">
        <div>
          <p className="attention-balance__eyebrow">已经穿了也不用换</p>
          <h3>用大吉色小配饰补充</h3>
          <p data-admin-selection-key="balanceSuggestion.description">
            {section.balanceSuggestion.description}
          </p>
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
