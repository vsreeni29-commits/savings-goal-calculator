/**
 * Calendar helpers.
 *
 * Everything is computed in UTC from plain `YYYY-MM-DD` / `YYYY-MM` strings.
 * The projection is a month-index simulation, so the only thing that ever has
 * to be exact is the mapping between a month index and a calendar month —
 * never a wall-clock instant. Working in UTC keeps a user in UTC+13 and a user
 * in UTC-8 on the same month boundary.
 */

/** `YYYY-MM-DD` */
export type ISODate = string;
/** `YYYY-MM` */
export type MonthKey = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

export function isValidMonthKey(value: unknown): value is MonthKey {
  if (typeof value !== 'string') return false;
  const m = MONTH_RE.exec(value);
  if (!m) return false;
  const month = Number(m[2]);
  return month >= 1 && month <= 12;
}

/** `month` is 1-based. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function currentMonthKey(now: Date = new Date()): MonthKey {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

export function monthKeyOf(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

/** Months elapsed since January 1970 — the simulation's time axis. */
export function monthIndex(key: MonthKey): number {
  const m = MONTH_RE.exec(key);
  if (!m) return 0;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

export function monthKeyFromIndex(index: number): MonthKey {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${pad2(month)}`;
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  return monthKeyFromIndex(monthIndex(key) + delta);
}

export function monthsBetween(from: MonthKey, to: MonthKey): number {
  return monthIndex(to) - monthIndex(from);
}

/** Last calendar day of a month, as an ISO date. */
export function endOfMonthISO(key: MonthKey): ISODate {
  const m = MONTH_RE.exec(key);
  if (!m) return `${key}-01`;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return `${key}-${pad2(daysInMonth(year, month))}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatMonthKey(key: MonthKey, style: 'long' | 'short' = 'long'): string {
  const m = MONTH_RE.exec(key);
  if (!m) return key;
  const year = m[1] ?? '';
  const name = MONTH_NAMES[Number(m[2]) - 1] ?? key;
  // The apostrophe matters: "Feb 29" reads as a day of the month, "Feb '29"
  // can only be a year.
  return style === 'long' ? `${name} ${year}` : `${name.slice(0, 3)} '${year.slice(2)}`;
}

export function formatISODate(date: ISODate, style: 'long' | 'short' = 'long'): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  const name = MONTH_NAMES[Number(m[2]) - 1] ?? '';
  const day = Number(m[3]);
  return style === 'long' ? `${day} ${name} ${m[1]}` : `${day} ${name.slice(0, 3)}`;
}

/** "in 2 years, 3 months" style copy for a month distance. */
export function humanizeMonths(months: number): string {
  if (months <= 0) return 'this month';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'month' : 'months'}`);
  return parts.join(', ');
}

/** Average days per month over the Gregorian 400-year cycle (146097 / 4800). */
export const DAYS_PER_MONTH = 30.436875;
export const DAYS_PER_YEAR = 365.2425;
export const WEEKS_PER_MONTH = DAYS_PER_YEAR / 12 / 7;
