/**
 * Closed-form time-value-of-money helpers.
 *
 * These answer single-account questions ("what does one goal need per month?").
 * The multi-goal projection in `engine.ts` is a month-by-month simulation and
 * is the source of truth whenever goals compete for the same money — these
 * functions are what the simulation uses to decide each month's target, and
 * what the UI uses for instant per-goal readouts.
 *
 * Convention: `rate` is the *periodic* rate (monthly), contributions are made
 * at the END of each period (ordinary annuity), and interest is credited
 * before the contribution lands.
 */

import { Cents, ceilCents, maxZero, roundCents } from './money';

export const MAX_HORIZON_MONTHS = 1200; // 100 years — anything beyond is "never"

export function monthlyRate(annualRate: number): number {
  if (!Number.isFinite(annualRate) || annualRate <= 0) return 0;
  // Nominal annual rate compounded monthly — matches how banks quote savings
  // interest and how card APR accrues, so the numbers reconcile with statements.
  return annualRate / 12;
}

/** Value after `periods` of compounding `principal` plus a level `payment`. */
export function futureValue(
  principal: Cents,
  payment: Cents,
  rate: number,
  periods: number,
): Cents {
  if (periods <= 0) return principal;
  if (rate <= 0) return roundCents(principal + payment * periods);
  const growth = Math.pow(1 + rate, periods);
  return roundCents(principal * growth + payment * ((growth - 1) / rate));
}

/**
 * Level monthly payment needed to grow `principal` to `target` in `periods`.
 * Returns 0 when the goal is already funded by growth alone.
 */
export function paymentForTarget(
  target: Cents,
  principal: Cents,
  rate: number,
  periods: number,
): Cents {
  if (periods <= 0) return maxZero(ceilCents(target - principal));
  if (rate <= 0) return maxZero(ceilCents((target - principal) / periods));

  const growth = Math.pow(1 + rate, periods);
  const shortfall = target - principal * growth;
  if (shortfall <= 0) return 0;
  return maxZero(ceilCents((shortfall * rate) / (growth - 1)));
}

/**
 * Months to clear a debt paying `payment` each month against `rate` interest,
 * while `newCharges` keep landing on it.
 * `null` means the balance never clears (payment does not out-run interest).
 */
export function monthsToClearDebt(
  balance: Cents,
  payment: Cents,
  rate: number,
  newCharges: Cents = 0,
  horizon: number = MAX_HORIZON_MONTHS,
): number | null {
  if (balance <= 0) return 0;
  if (payment <= 0) return null;

  let current = balance;
  for (let month = 1; month <= horizon; month += 1) {
    const interest = roundCents(current * rate);
    current = current + interest + newCharges - payment;
    if (current <= 0) return month;
    // Balance stopped shrinking — no payment schedule of this size ever clears it.
    if (interest + newCharges >= payment) return null;
  }
  return null;
}

/**
 * Smallest level payment that clears `balance` within `periods`, given ongoing
 * `newCharges`.
 *
 * The annuity gives the answer to the cent, but the actual schedule rounds
 * interest to whole cents every month, and those fractions accumulate — a
 * payment that is mathematically exact can leave a few cents outstanding and
 * spill into one extra month. So the closed form is only used as a starting
 * point, and the result is the smallest payment that a real month-by-month
 * schedule confirms.
 */
export function paymentToClearDebt(
  balance: Cents,
  rate: number,
  periods: number,
  newCharges: Cents = 0,
): Cents {
  if (balance <= 0) return maxZero(newCharges);
  if (periods <= 0) return maxZero(ceilCents(balance + newCharges));
  if (rate <= 0) return maxZero(ceilCents(balance / periods) + maxZero(newCharges));

  const growth = Math.pow(1 + rate, periods);
  const annuity = (balance * rate * growth) / (growth - 1);
  const estimate = maxZero(ceilCents(annuity) + maxZero(newCharges));

  const clears = (payment: Cents): boolean => {
    const months = monthsToClearDebt(balance, payment, rate, newCharges, periods);
    return months !== null && months <= periods;
  };

  if (clears(estimate)) return estimate;

  // Paying the whole grossed-up balance in one go always clears it, which
  // bounds the search from above.
  let high = maxZero(ceilCents(balance * (1 + rate)) + maxZero(newCharges));
  if (high <= estimate) return estimate + 1;

  let low = estimate;
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2);
    if (clears(mid)) high = mid;
    else low = mid;
  }
  return high;
}
