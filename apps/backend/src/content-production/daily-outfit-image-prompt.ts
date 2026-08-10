import type { components } from "@five/api-contract";

import type { ImageProductionSlot } from "./content-production.store";

function colorsForSlot(
  modules: components["schemas"]["DraftModules"],
  slot: ImageProductionSlot,
): string {
  const tiers = modules.calendar_algorithm?.tiers ?? [];
  const tier = (code: string) => tiers.find((item) => item.tierCode === code);
  const names = (code: string) =>
    tier(code)
      ?.colors.slice(0, 2)
      .map((color) => color.name) ?? [];
  const selected =
    slot === "required_primary"
      ? names("da_ji")
      : slot === "required_alternative"
        ? [names("da_ji")[0], names("ci_ji")[0]]
        : [names("da_ji")[0], names("ping")[0]];
  return selected.filter((value): value is string => value !== undefined).join("与");
}

export function buildDailyOutfitImagePrompt(input: {
  readonly imageSlot: ImageProductionSlot;
  readonly modules: components["schemas"]["DraftModules"];
}): string {
  const colors = colorsForSlot(input.modules, input.imageSlot);
  const scene = input.imageSlot === "required_primary" ? "通勤城市街景" : "简洁摄影棚";
  return `写实时尚摄影，成年东亚模特，全身站姿，${scene}，穿着以${colors}为核心的日常服装，服装结构自然、可模仿，手脚完整，无文字、无品牌标志、无水印，竖版构图。`;
}
