import { describe, expect, it } from 'vitest';
import {
  futureValue,
  monthlyRate,
  monthsToClearDebt,
  paymentForTarget,
  paymentToClearDebt,
} from './finance';

describe('monthlyRate', () => {
  it('divides a nominal annual rate by twelve', () => {
    expect(monthlyRate(0.12)).toBeCloseTo(0.01, 12);
  });

  it('clamps nonsense to zero', () => {
    expect(monthlyRate(0)).toBe(0);
    expect(monthlyRate(-0.05)).toBe(0);
    expect(monthlyRate(Number.NaN)).toBe(0);
  });
});

describe('futureValue', () => {
  it('is simple addition with no interest', () => {
    expect(futureValue(100_000, 10_000, 0, 12)).toBe(220_000);
  });

  it('matches the textbook annuity value', () => {
    // 1000/month for 12 months at 1%/month, no starting balance.
    expect(futureValue(0, 100_000, 0.01, 12)).toBe(1_268_250);
  });

  it('returns the principal untouched over zero periods', () => {
    expect(futureValue(500_000, 100_000, 0.01, 0)).toBe(500_000);
    expect(futureValue(500_000, 100_000, 0.01, -3)).toBe(500_000);
  });

  it('grows a lone principal by compounding alone', () => {
    expect(futureValue(100_000, 0, 0.01, 12)).toBe(112_683);
  });
});

describe('paymentForTarget', () => {
  it('spreads the gap evenly with no interest', () => {
    expect(paymentForTarget(1_200_000, 0, 0, 12)).toBe(100_000);
    expect(paymentForTarget(1_200_000, 200_000, 0, 10)).toBe(100_000);
  });

  it('asks for nothing when growth alone gets there', () => {
    expect(paymentForTarget(100_000, 100_000, 0.01, 12)).toBe(0);
    expect(paymentForTarget(105_000, 100_000, 0.01, 12)).toBe(0);
  });

  it('demands the whole shortfall when there is no time left', () => {
    expect(paymentForTarget(500_000, 200_000, 0.01, 0)).toBe(300_000);
    expect(paymentForTarget(500_000, 200_000, 0.01, -5)).toBe(300_000);
  });

  it('produces a payment that actually reaches the target', () => {
    const cases: [number, number, number, number][] = [
      [5_000_000, 0, 0.005, 60],
      [5_000_000, 1_000_000, 0.004, 36],
      [123_457, 1, 0.0075, 17],
      [10_000_000, 250_000, 0, 84],
    ];
    for (const [target, principal, rate, periods] of cases) {
      const pmt = paymentForTarget(target, principal, rate, periods);
      expect(futureValue(principal, pmt, rate, periods)).toBeGreaterThanOrEqual(target);
      // ...and is not wastefully large: one cent less should fall short.
      if (pmt > 0) {
        expect(futureValue(principal, pmt - 1, rate, periods)).toBeLessThan(target + periods);
      }
    }
  });
});

describe('debt maths', () => {
  it('clears an interest-free balance by simple division', () => {
    expect(monthsToClearDebt(1_000_000, 100_000, 0)).toBe(10);
  });

  it('never clears when the payment cannot beat the interest', () => {
    // 24% APR on 100000 is 2000/month of interest; paying 1500 goes backwards.
    expect(monthsToClearDebt(10_000_000, 150_000, monthlyRate(0.24))).toBeNull();
    expect(monthsToClearDebt(1_000_000, 0, 0.01)).toBeNull();
  });

  it('never clears when ongoing spending swamps the payment', () => {
    expect(monthsToClearDebt(500_000, 100_000, 0.02, 120_000)).toBeNull();
  });

  it('still clears when the payment beats interest plus spending', () => {
    const months = monthsToClearDebt(500_000, 100_000, 0.02, 20_000);
    expect(months).not.toBeNull();
    expect(months).toBeGreaterThan(5);
  });

  it('finds a payment that clears the balance in the time asked for', () => {
    const cases: [number, number, number, number][] = [
      [10_000_000, monthlyRate(0.36), 24, 0],
      [2_500_000, monthlyRate(0.18), 36, 50_000],
      [750_000, 0, 12, 0],
    ];
    for (const [balance, rate, periods, charges] of cases) {
      const payment = paymentToClearDebt(balance, rate, periods, charges);
      const months = monthsToClearDebt(balance, payment, rate, charges);
      expect(months).not.toBeNull();
      expect(months ?? Infinity).toBeLessThanOrEqual(periods);
    }
  });

  it('treats a settled debt as nothing to do', () => {
    expect(monthsToClearDebt(0, 100_000, 0.01)).toBe(0);
  });
});
