const FORTUNE_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function parseFortuneDate(value: string): { day: number; month: number; year: number } {
  const match = FORTUNE_DATE_PATTERN.exec(value);
  if (match === null) throw new RangeError("fortuneDate must use YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1 ||
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new RangeError("fortuneDate must be a real Gregorian date");
  }
  return { day, month, year };
}

export function shiftFortuneDate(value: string, days: number): string {
  const { day, month, year } = parseFortuneDate(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )}`;
}
