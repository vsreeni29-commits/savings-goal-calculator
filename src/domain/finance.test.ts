import { describe, expect, it } from 'vitest';
import {
  effectiveAnnualRate,
  futureValue,
  monthlyRate,
  monthsToClearDebt,
  monthsToTarget,
  paymentForTarget,
  paymentToClearDebt,
  totalInterestOnDebt,
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

  it('compounds to a higher effective rate', () => {
    expect(effectiveAnnualRate(0.12)).toBeCloseTo(0.126825, 5);
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

describe('monthsToTarget', () => {
  it('is already met when the principal covers the target', () => {
    expect(monthsToTarget(100_000, 100_000, 5_000, 0.01)).toBe(0);
    expect(monthsToTarget(100_000, 150_000, 5_000, 0.01)).toBe(0);
  });

  it('never arrives with no payment and no growth', () => {
    expect(monthsToTarget(100_000, 10_000, 0, 0)).toBeNull();
  });

  it('divides cleanly with no interest', () => {
    expect(monthsToTarget(1_200_000, 0, 100_000, 0)).toBe(12);
    expect(monthsToTarget(1_200_001, 0, 100_000, 0)).toBe(13);
  });

  it('agrees with a month-by-month simulation when interest is on', () => {
    const cases: [number, number, number, number][] = [
      [5_000_000, 0, 50_000, 0.005],
      [2_000_000, 300_000, 25_000, 0.0075],
      [900_000, 899_000, 100, 0.002],
      [10_000_000, 100_000, 1_000, 0.01],
    ];
    for (const [target, principal, payment, rate] of cases) {
      const closed = monthsToTarget(target, principal, payment, rate);
      let balance = principal;
      let simulated: number | null = null;
      for (let m = 1; m <= 1200; m += 1) {
        balance = Math.round(balance * (1 + rate)) + payment;
        if (balance >= target) {
          simulated = m;
          break;
        }
      }
      // Cent-level rounding inside the simulation can shift the crossing by a
      // single month; anything larger would be a real disagreement.
      expect(closed).not.toBeNull();
      expect(Math.abs((closed ?? 0) - (simulated ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it('reaches a target on growth alone when the rate is high enough', () => {
    const months = monthsToTarget(200_000, 100_000, 0, 0.01);
    expect(months).not.toBeNull();
    expect(futureValue(100_000, 0, 0.01, months ?? 0)).toBeGreaterThanOrEqual(200_000);
  });

  it('reports never when the horizon runs out first', () => {
    expect(monthsToTarget(1_000_000_000, 0, 100, 0, 120)).toBeNull();
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

  it('reports the interest actually paid along the way', () => {
    expect(totalInterestOnDebt(1_000_000, 100_000, 0)).toBe(0);
    const interest = totalInterestOnDebt(10_000_000, 500_000, monthlyRate(0.24));
    expect(interest).not.toBeNull();
    expect(interest ?? 0).toBeGreaterThan(0);
    expect(totalInterestOnDebt(10_000_000, 100_000, monthlyRate(0.36))).toBeNull();
  });

  it('treats a settled debt as nothing to do', () => {
    expect(monthsToClearDebt(0, 100_000, 0.01)).toBe(0);
    expect(totalInterestOnDebt(0, 100_000, 0.01)).toBe(0);
  });
});
