import { describe, expect, it } from 'vitest';
import {
  addMonths,
  daysInMonth,
  endOfMonthISO,
  formatMonthKey,
  humanizeMonths,
  isValidISODate,
  isValidMonthKey,
  monthIndex,
  monthKeyFromIndex,
  monthKeyOf,
  monthsBetween,
} from './dates';

describe('validation', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isValidISODate('2026-02-28')).toBe(true);
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-1-1')).toBe(false);
    expect(isValidISODate(42)).toBe(false);
  });

  it('validates month keys', () => {
    expect(isValidMonthKey('2026-08')).toBe(true);
    expect(isValidMonthKey('2026-00')).toBe(false);
    expect(isValidMonthKey('2026-8')).toBe(false);
  });
});

describe('month arithmetic', () => {
  it('round-trips a month key through its index', () => {
    for (const key of ['1970-01', '2026-08', '2099-12', '2000-02']) {
      expect(monthKeyFromIndex(monthIndex(key))).toBe(key);
    }
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-08', 24)).toBe('2028-08');
    expect(addMonths('2026-08', 0)).toBe('2026-08');
  });

  it('measures distance between months with a sign', () => {
    expect(monthsBetween('2026-01', '2026-12')).toBe(11);
    expect(monthsBetween('2026-12', '2026-01')).toBe(-11);
    expect(monthsBetween('2026-08', '2026-08')).toBe(0);
  });

  it('extracts a month key from a date', () => {
    expect(monthKeyOf('2026-08-09')).toBe('2026-08');
  });
});

describe('calendar', () => {
  it('knows month lengths including leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('finds the last day of a month', () => {
    expect(endOfMonthISO('2026-02')).toBe('2026-02-28');
    expect(endOfMonthISO('2024-02')).toBe('2024-02-29');
    expect(endOfMonthISO('2026-04')).toBe('2026-04-30');
  });
});

describe('formatting', () => {
  it('renders month keys for humans', () => {
    expect(formatMonthKey('2026-08')).toBe('August 2026');
    expect(formatMonthKey('2026-08', 'short')).toBe("Aug '26");
  });

  it('describes month spans in plain words', () => {
    expect(humanizeMonths(0)).toBe('this month');
    expect(humanizeMonths(1)).toBe('1 month');
    expect(humanizeMonths(12)).toBe('1 year');
    expect(humanizeMonths(27)).toBe('2 years, 3 months');
  });
});
