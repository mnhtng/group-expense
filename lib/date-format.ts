/**
 * Date-only values are stored and transported as ISO YYYY-MM-DD.
 * All user-facing dates use day/month/four-digit-year without padding.
 * Never parse a date-only string with new Date("YYYY-MM-DD") for display.
 */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month && date.getUTCDate() === day;
}

export function formatDateDMY(iso: string): string {
  const match = ISO_DATE.exec(iso);
  if (!match) return "—";
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  return validCalendarDate(year, month, day) ? `${day}/${month}/${year}` : "—";
}

export function parseDateDMY(input: string): string | null {
  const match = DMY_DATE.exec(input.trim());
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  if (!validCalendarDate(year, month, day)) return null;
  return `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Date and time in Vietnam's timezone, e.g. 4/11/2026 07:05. */
export function formatDateTimeDMY(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (!Number.isFinite(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "numeric", month: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? "";
  return `${Number(part("day"))}/${Number(part("month"))}/${part("year")} ${part("hour")}:${part("minute")}`;
}

export function todayVietnamISO(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric",
  }).formatToParts(new Date());
  const part = (name: string) => parts.find(item => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
