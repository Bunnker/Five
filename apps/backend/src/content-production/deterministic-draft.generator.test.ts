import { describe, expect, it } from "vitest";

import { CONTRACT_POSTER_TEMPLATE_VERSION } from "../poster/poster-template.values";
import { DeterministicDraftGenerator } from "./deterministic-draft.generator";

describe("deterministic daily draft generation", () => {
  it("fills calendar, five tiers, copy and outfit formulas without inventing image approval", () => {
    const modules = new DeterministicDraftGenerator().generate("2026-07-15");

    expect(modules.calendar_algorithm).toMatchObject({
      calendar: { ganzhiDay: "庚寅" },
      tiers: [
        { rank: 1, tierCode: "da_ji" },
        { rank: 2, tierCode: "ci_ji" },
        { rank: 3, tierCode: "ping" },
        { rank: 4, tierCode: "jiao_cha" },
        { rank: 5, tierCode: "bu_li" },
      ],
    });
    expect(modules.copy_and_formula?.outfitFormulas).toHaveLength(3);
    expect(modules.copy_and_formula?.share.posterTemplateVersion).toBe(
      CONTRACT_POSTER_TEMPLATE_VERSION,
    );
    expect(modules.visual_and_rights).toBeNull();
    expect(modules.poster_consistency).toBeNull();
  });

  it("produces the structured production draft for the documented calendar day", () => {
    const modules = new DeterministicDraftGenerator().generate("2026-07-15");
    const serialized = JSON.stringify(modules);

    expect(serialized).not.toContain("demo-");
    expect(serialized).not.toContain("placehold.co");
    expect(serialized).not.toContain("FIVE DEMO");
    expect(modules.calendar_algorithm).toMatchObject({
      calendar: {
        branch: "寅",
        dayElement: "wood",
        dayElementLabel: "木",
        ganzhiDay: "庚寅",
        lunarDateText: "六月初二",
        weekdayText: "星期三",
      },
      tiers: [
        { element: "fire", rank: 1, tierCode: "da_ji" },
        { element: "wood", rank: 2, tierCode: "ci_ji" },
        { element: "metal", rank: 3, tierCode: "ping" },
        { element: "water", rank: 4, tierCode: "jiao_cha" },
        { element: "earth", rank: 5, tierCode: "bu_li" },
      ],
    });

    const calendar = modules.calendar_algorithm;
    const copy = modules.copy_and_formula;
    expect(calendar).not.toBeNull();
    expect(copy).not.toBeNull();
    if (calendar === null || copy === null) return;

    expect(
      copy.outfitFormulas.map(({ formulaId, kind, lookIds }) => ({ formulaId, kind, lookIds })),
    ).toEqual([
      { formulaId: "formula-mono-01", kind: "mono", lookIds: ["look-alt-01"] },
      { formulaId: "formula-dual-01", kind: "dual", lookIds: ["look-alt-02"] },
      { formulaId: "formula-triple-01", kind: "triple", lookIds: ["look-main-01"] },
    ]);

    const colorsByTier = new Map(
      calendar.tiers.map((tier) => [
        tier.tierCode,
        new Set(tier.colors.map((color) => color.colorCode)),
      ]),
    );
    for (const formula of copy.outfitFormulas) {
      for (const slot of formula.slots) {
        expect(colorsByTier.has(slot.tierCode)).toBe(true);
        expect(
          slot.colorCodes.every((colorCode) => colorsByTier.get(slot.tierCode)?.has(colorCode)),
        ).toBe(true);
      }
    }
  });
});
