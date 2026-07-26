import { describe, expect, it } from "vitest";

import { reviewedColorPalette } from "./color-palette";

describe("reviewedColorPalette", () => {
  it("covers every PRD color code with its approved Chinese name", () => {
    const names = Object.fromEntries(
      Object.entries(reviewedColorPalette).map(([colorCode, presentation]) => [
        colorCode,
        presentation.name,
      ]),
    );

    expect(names).toEqual({
      black: "黑色",
      brown: "棕色",
      coffee: "咖色",
      cyan: "青色",
      dark_brown_family: "褐色系",
      dark_gray_family: "深灰系",
      dark_green: "墨绿",
      emerald: "翠色",
      gold: "金色",
      green: "绿色",
      ivory: "乳白",
      khaki: "卡其",
      lake_blue: "湖蓝",
      light_family: "浅色系",
      light_green_family: "浅绿系",
      navy: "藏青",
      orange: "橙色",
      pink_family: "粉色系",
      purple: "紫色",
      red: "红色",
      royal_blue: "宝蓝",
      silver: "银色",
      white: "白色",
      yellow: "黄色",
    });
  });

  it("uses CSS-safe colors and marks the palest swatches for a visible border", () => {
    for (const presentation of Object.values(reviewedColorPalette)) {
      expect(presentation.value).toMatch(/^#[0-9a-f]{6}$/u);
    }

    for (const colorCode of ["white", "ivory", "silver", "light_family"] as const) {
      expect(reviewedColorPalette[colorCode].isLight).toBe(true);
    }
  });
});
