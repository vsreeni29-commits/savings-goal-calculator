import { Cents, roundCents } from './money';
import { DAYS_PER_MONTH, WEEKS_PER_MONTH } from './dates';
import type { ViewMode } from './types';

export interface CurrencyMeta {
  code: string;
  symbol: string;
  locale: string;
  name: string;
}

export const CURRENCIES: CurrencyMeta[] = [
  { code: 'INR', symbol: '₹', locale: 'en-IN', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', locale: 'en-US', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', locale: 'en-IE', name: 'Euro' },
  { code: 'GBP', symbol: '£', locale: 'en-GB', name: 'British Pound' },
  { code: 'AED', symbol: 'د.إ', locale: 'en-AE', name: 'UAE Dirham' },
  { code: 'AUD', symbol: 'A$', locale: 'en-AU', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', locale: 'en-CA', name: 'Canadian Dollar' },
  { code: 'SGD', symbol: 'S$', locale: 'en-SG', name: 'Singapore Dollar' },
  { code: 'JPY', symbol: '¥', locale: 'ja-JP', name: 'Japanese Yen' },
  { code: 'ZAR', symbol: 'R', locale: 'en-ZA', name: 'South African Rand' },
];

export function currencyMeta(code: string): CurrencyMeta {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0]!;
}

export function currencySymbol(code: string): string {
  return currencyMeta(code).symbol;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(
  locale: string,
  currency: string,
  minimumFractionDigits: number,
  maximumFractionDigits: number,
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${minimumFractionDigits}|${maximumFractionDigits}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
    });
  } catch {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits,
      maximumFractionDigits,
    });
  }
  formatterCache.set(key, formatter);
  return formatter;
}

export interface FormatOptions {
  /** Show the minor units. Off by default — plans read better in round numbers. */
  decimals?: boolean;
  /** Render 1 250 000 as "12.5L" / "1.25M" for headline figures. */
  compact?: boolean;
  signed?: boolean;
}

export function formatMoney(
  cents: Cents,
  currency: string,
  locale: string,
  options: FormatOptions = {},
): string {
  const value = cents / 100;
  const decimals = options.decimals ?? false;

  if (options.compact) {
    const compact = compactNumber(Math.abs(value), locale);
    if (compact) {
      const sign = value < 0 ? '-' : options.signed && value > 0 ? '+' : '';
      return `${sign}${currencySymbol(currency)}${compact}`;
    }
  }

  const formatted = getFormatter(locale, currency, decimals ? 2 : 0, decimals ? 2 : 0).format(value);
  if (options.signed && value > 0) return `+${formatted}`;
  return formatted;
}

/** Indian locales group in lakh/crore; everywhere else uses K/M/B. */
function compactNumber(abs: number, locale: string): string | null {
  const indian = locale.endsWith('-IN');
  if (indian) {
    if (abs >= 1e7) return `${trim(abs / 1e7)}Cr`;
    if (abs >= 1e5) return `${trim(abs / 1e5)}L`;
    if (abs >= 1e3) return `${trim(abs / 1e3)}K`;
    return null;
  }
  if (abs >= 1e9) return `${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${trim(abs / 1e3)}K`;
  return null;
}

function trim(value: number): string {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded);
}

// ---------------------------------------------------------------------------
// Timescale conversion
// ---------------------------------------------------------------------------

export const VIEW_MODES: { id: ViewMode; label: string; short: string; per: string }[] = [
  { id: 'day', label: 'Per day', short: 'Day', per: 'a day' },
  { id: 'week', label: 'Per week', short: 'Week', per: 'a week' },
  { id: 'month', label: 'Per month', short: 'Month', per: 'a month' },
  { id: 'year', label: 'Per year', short: 'Year', per: 'a year' },
];

/**
 * Restates a monthly figure on another timescale.
 *
 * Days and weeks use the average Gregorian month rather than 30 or 4, so a
 * daily figure multiplied back up lands on the monthly figure again instead of
 * drifting a few percent.
 */
export function perView(monthlyCents: Cents, view: ViewMode): Cents {
  switch (view) {
    case 'day':
      return roundCents(monthlyCents / DAYS_PER_MONTH);
    case 'week':
      return roundCents(monthlyCents / WEEKS_PER_MONTH);
    case 'year':
      return roundCents(monthlyCents * 12);
    case 'month':
    default:
      return monthlyCents;
  }
}

export function viewLabel(view: ViewMode): string {
  return VIEW_MODES.find((v) => v.id === view)?.per ?? 'a month';
}

export function formatPercent(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return '0%';
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return '0%';
  const pct = rate * 100;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2).replace(/0$/, '')}%`;
}
