/**
 * What-if machinery.
 *
 * A scenario is the user's real plan with a few knobs turned. Rather than
 * inventing a parallel calculation, it rewrites the input data and runs the
 * same projection — so a scenario can never disagree with the plan it is
 * being compared against.
 */

import type { AppData, Settings } from './types';
import { type Projection, project } from './engine';
import { type Cents, maxZero, scaleCents, sumCents } from './money';
import { type MonthKey, monthIndex, monthsBetween } from './dates';

export interface ScenarioKnobs {
  /** Extra money arriving each month — a raise, a side income. */
  extraIncomeCents: Cents;
  /** Fraction (0–1) trimmed from every expense not marked essential. */
  expenseCutShare: number;
  savingsFactor: number;
  bufferCents: Cents;
  debtExtraShare: number;
  allocationStrategy: Settings['allocationStrategy'];
}

export function knobsFrom(data: AppData): ScenarioKnobs {
  return {
    extraIncomeCents: 0,
    expenseCutShare: 0,
    savingsFactor: data.settings.savingsFactor,
    bufferCents: data.settings.bufferCents,
    debtExtraShare: data.settings.debtExtraShare,
    allocationStrategy: data.settings.allocationStrategy,
  };
}

export function isUntouched(knobs: ScenarioKnobs, data: AppData): boolean {
  const base = knobsFrom(data);
  return (
    knobs.extraIncomeCents === base.extraIncomeCents &&
    knobs.expenseCutShare === base.expenseCutShare &&
    knobs.savingsFactor === base.savingsFactor &&
    knobs.bufferCents === base.bufferCents &&
    knobs.debtExtraShare === base.debtExtraShare &&
    knobs.allocationStrategy === base.allocationStrategy
  );
}

const SCENARIO_INCOME_ID = '__scenario_extra_income';

export function applyScenario(data: AppData, knobs: ScenarioKnobs): AppData {
  const cut = Number.isFinite(knobs.expenseCutShare)
    ? Math.min(Math.max(knobs.expenseCutShare, 0), 1)
    : 0;

  return {
    ...data,
    income:
      knobs.extraIncomeCents > 0
        ? [
            ...data.income,
            {
              id: SCENARIO_INCOME_ID,
              name: 'Extra income (what-if)',
              amountCents: knobs.extraIncomeCents,
              frequency: 'monthly' as const,
              active: true,
            },
          ]
        : data.income,
    expenses:
      cut > 0
        ? data.expenses.map((e) =>
            e.essential ? e : { ...e, amountCents: scaleCents(e.amountCents, 1 - cut) },
          )
        : data.expenses,
    settings: {
      ...data.settings,
      savingsFactor: knobs.savingsFactor,
      bufferCents: maxZero(knobs.bufferCents),
      debtExtraShare: knobs.debtExtraShare,
      allocationStrategy: knobs.allocationStrategy,
    },
  };
}

export function projectScenario(data: AppData, knobs: ScenarioKnobs): Projection {
  return project(applyScenario(data, knobs));
}

// ---------------------------------------------------------------------------
// Reverse solve
// ---------------------------------------------------------------------------

export interface SolveResult {
  /** Extra monthly income needed on top of the scenario to hit the date. */
  extraIncomeCents: Cents;
  /** What ends up going into goals each month once that is in place. */
  toGoalsCents: Cents;
  /** How much more that is than the scenario currently manages. */
  additionalToGoalsCents: Cents;
  projection: Projection;
}

/**
 * Answers "what would it take to have everything by then?".
 *
 * Binary search over extra monthly income, because that is the one lever that
 * is always available and always monotonic: more money in can never push a
 * finish date later. The search runs against a horizon that stops at the
 * target month, so an infeasible amount fails fast instead of simulating
 * decades.
 */
export function solveForDate(
  data: AppData,
  knobs: ScenarioKnobs,
  targetMonth: MonthKey,
): SolveResult | null {
  const startMonth = data.settings.startMonth;
  const horizon = startMonth
    ? monthsBetween(startMonth, targetMonth) + 1
    : monthIndex(targetMonth) - monthIndex(currentStart()) + 1;

  if (horizon <= 0) return null;

  const hits = (extra: Cents): Projection | null => {
    const projection = project(applyScenario(data, { ...knobs, extraIncomeCents: extra }), {
      horizonMonths: horizon,
    });
    return projection.allGoalsCompleteMonth !== null ? projection : null;
  };

  const alreadyThere = hits(knobs.extraIncomeCents);
  if (alreadyThere) {
    return {
      extraIncomeCents: 0,
      toGoalsCents: alreadyThere.cashFlow.toGoalsCents,
      additionalToGoalsCents: 0,
      projection: alreadyThere,
    };
  }

  // Everything still owed on goals, plus every debt, is more than enough to
  // finish in a single month — so it bounds the search from above.
  const outstanding = sumCents(
    data.goals
      .filter((g) => !g.archived)
      .map((g) => maxZero(g.targetCents - g.savedCents)),
  );
  const debts = sumCents(data.debts.filter((d) => d.active).map((d) => d.balanceCents));
  let high = (outstanding + debts) * 4 + 100_000;

  const atHigh = hits(high);
  if (!atHigh) return null;

  let low = knobs.extraIncomeCents;
  let best = atHigh;

  // Whole rupees are precise enough for a "you would need about this much"
  // answer, and it keeps the search to a couple of dozen projections.
  const precision = 100;
  while (high - low > precision) {
    const mid = low + Math.floor((high - low) / 2);
    const result = hits(mid);
    if (result) {
      high = mid;
      best = result;
    } else {
      low = mid;
    }
  }

  const baseline = project(applyScenario(data, knobs));

  return {
    extraIncomeCents: maxZero(high - knobs.extraIncomeCents),
    toGoalsCents: best.cashFlow.toGoalsCents,
    additionalToGoalsCents: maxZero(best.cashFlow.toGoalsCents - baseline.cashFlow.toGoalsCents),
    projection: best,
  };
}

function currentStart(): MonthKey {
  const now = new Date();
  const month = now.getMonth() + 1;
  return `${now.getFullYear()}-${month < 10 ? `0${month}` : month}`;
}
