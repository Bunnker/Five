// `datetime-local` carries no zone; Five's supported calendar range uses Shanghai's UTC+08:00.
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const LOCAL_DATE_TIME_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})$/u;

const dateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
});

const dateTimeWithYearFormat = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

export function formatAdminDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

export function formatAdminDateTimeWithYear(value: string): string {
  return dateTimeWithYearFormat.format(new Date(value));
}

export function shanghaiLocalDateTimeToIso(value: string): string | null {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (match?.groups === undefined) return null;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const localDate = new Date(0);
  localDate.setUTCFullYear(year, month - 1, day);
  localDate.setUTCHours(hour, minute, 0, 0);
  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hour ||
    localDate.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return new Date(localDate.getTime() - SHANGHAI_UTC_OFFSET_MS).toISOString();
}
