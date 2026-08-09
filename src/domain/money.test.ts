import { describe, expect, it } from 'vitest';
import {
  addCents,
  ceilCents,
  clampCents,
  parseAmountToCents,
  roundCents,
  scaleCents,
  splitCents,
  sumCents,
} from './money';

describe('rounding', () => {
  it('rounds half away from zero in both directions', () => {
    expect(roundCents(10.5)).toBe(11);
    expect(roundCents(-10.5)).toBe(-11);
    expect(roundCents(10.4)).toBe(10);
    expect(roundCents(-10.4)).toBe(-10);
  });

  it('treats non-finite input as zero rather than propagating NaN', () => {
    expect(roundCents(Number.NaN)).toBe(0);
    expect(roundCents(Number.POSITIVE_INFINITY)).toBe(0);
    expect(ceilCents(Number.NaN)).toBe(0);
  });

  it('ceils away from zero', () => {
    expect(ceilCents(10.01)).toBe(11);
    expect(ceilCents(-10.01)).toBe(-11);
    expect(ceilCents(10)).toBe(10);
  });
});

describe('arithmetic', () => {
  it('adds and sums to whole cents', () => {
    expect(addCents(100, 250, -50)).toBe(300);
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(sumCents([])).toBe(0);
  });

  it('scales without leaving fractional cents', () => {
    expect(scaleCents(1000, 0.333)).toBe(333);
    expect(scaleCents(1001, 0.5)).toBe(501);
    expect(Number.isInteger(scaleCents(9999, 0.777))).toBe(true);
  });

  it('clamps within bounds and survives an inverted range', () => {
    expect(clampCents(50, 0, 100)).toBe(50);
    expect(clampCents(-5, 0, 100)).toBe(0);
    expect(clampCents(500, 0, 100)).toBe(100);
    expect(clampCents(50, 100, 0)).toBe(100);
  });
});

describe('splitCents', () => {
  it('never loses or invents a cent', () => {
    const cases: [number, number[]][] = [
      [100, [1, 1, 1]],
      [10_001, [1, 2, 3, 4]],
      [7, [1, 1]],
      [1, [5, 5, 5]],
      [999_999, [0.1, 0.2, 0.7]],
    ];
    for (const [amount, weights] of cases) {
      const parts = splitCents(amount, weights);
      expect(sumCents(parts)).toBe(amount);
      expect(parts.every((p) => Number.isInteger(p))).toBe(true);
    }
  });

  it('splits evenly when weights are equal', () => {
    expect(splitCents(100, [1, 1, 1, 1])).toEqual([25, 25, 25, 25]);
  });

  it('gives remainder cents to the largest fractional parts', () => {
    expect(splitCents(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });

  it('falls back to the first slot when every weight is meaningless', () => {
    expect(splitCents(500, [0, 0, 0])).toEqual([500, 0, 0]);
    expect(splitCents(500, [Number.NaN, -1])).toEqual([500, 0]);
  });

  it('returns nothing for no slots', () => {
    expect(splitCents(500, [])).toEqual([]);
  });
});

describe('parseAmountToCents', () => {
  it('reads plain and formatted numbers', () => {
    expect(parseAmountToCents('1200')).toBe(120_000);
    expect(parseAmountToCents('1,200.50')).toBe(120_050);
    expect(parseAmountToCents('₹ 1 200')).toBe(120_000);
    expect(parseAmountToCents('  42.05  ')).toBe(4205);
  });

  it('understands shorthand suffixes', () => {
    expect(parseAmountToCents('1.2k')).toBe(120_000);
    expect(parseAmountToCents('5L')).toBe(50_000_000);
    expect(parseAmountToCents('2 lakh')).toBe(20_000_000);
    expect(parseAmountToCents('1cr')).toBe(1_000_000_000);
    expect(parseAmountToCents('3m')).toBe(300_000_000);
  });

  it('rejects input with no number in it', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('.')).toBeNull();
    expect(parseAmountToCents('-')).toBeNull();
  });

  it('rounds sub-cent input rather than truncating it', () => {
    expect(parseAmountToCents('0.005')).toBe(1);
    expect(parseAmountToCents('0.004')).toBe(0);
  });
});
