const FORTUNE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_OPAQUE_VALUE_LENGTH = 128;

export function isFortuneDate(value: string): boolean {
  if (!FORTUNE_DATE_PATTERN.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isOpaquePublicValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    [...value].length >= 1 &&
    [...value].length <= MAX_OPAQUE_VALUE_LENGTH &&
    value.trim() === value &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  );
}
