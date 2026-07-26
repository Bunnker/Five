declare module "lunar-javascript" {
  interface Lunar {
    getDayInGanZhi(): string;
  }

  interface SolarDate {
    getLunar(): Lunar;
  }

  export const Solar: {
    fromYmd(year: number, month: number, day: number): SolarDate;
  };
}
