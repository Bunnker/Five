export const reviewedColorPalette = {
  black: { isLight: false, name: "黑色", value: "#2f3032" },
  brown: { isLight: false, name: "棕色", value: "#76513a" },
  coffee: { isLight: false, name: "咖色", value: "#8a6045" },
  cyan: { isLight: false, name: "青色", value: "#3f9892" },
  dark_brown_family: { isLight: false, name: "褐色系", value: "#695047" },
  dark_gray_family: { isLight: false, name: "深灰系", value: "#5d6267" },
  dark_green: { isLight: false, name: "墨绿", value: "#274f45" },
  emerald: { isLight: false, name: "翠色", value: "#26806a" },
  gold: { isLight: false, name: "金色", value: "#c99a43" },
  green: { isLight: false, name: "绿色", value: "#4f8a5b" },
  ivory: { isLight: true, name: "乳白", value: "#f5edd7" },
  khaki: { isLight: false, name: "卡其", value: "#b99a6a" },
  lake_blue: { isLight: false, name: "湖蓝", value: "#498ca4" },
  light_family: { isLight: true, name: "浅色系", value: "#ddd6c7" },
  light_green_family: { isLight: true, name: "浅绿系", value: "#a9bf9f" },
  navy: { isLight: false, name: "藏青", value: "#263b59" },
  orange: { isLight: false, name: "橙色", value: "#df762c" },
  pink_family: { isLight: false, name: "粉色系", value: "#df8fa5" },
  purple: { isLight: false, name: "紫色", value: "#8b5a91" },
  red: { isLight: false, name: "红色", value: "#c63d32" },
  royal_blue: { isLight: false, name: "宝蓝", value: "#3566b8" },
  silver: { isLight: true, name: "银色", value: "#c9c9c5" },
  white: { isLight: true, name: "白色", value: "#fffef9" },
  yellow: { isLight: false, name: "黄色", value: "#d9ad42" },
} as const;

export type ReviewedColorCode = keyof typeof reviewedColorPalette;

export function isReviewedColorCode(value: unknown): value is ReviewedColorCode {
  return (
    typeof value === "string" && Object.prototype.hasOwnProperty.call(reviewedColorPalette, value)
  );
}
