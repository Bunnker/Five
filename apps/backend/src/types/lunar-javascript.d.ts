declare module "lunar-javascript" {
  interface Lunar {
    getDayInChinese(): string;
    getDayInGanZhi(): string;
    getMonthInChinese(): string;
  }

  interface SolarDate {
    getLunar(): Lunar;
  }

  export const Solar: {
    fromYmd(year: number, month: number, day: number): SolarDate;
  };
}
