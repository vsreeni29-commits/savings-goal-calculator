import { describe, expect, it } from 'vitest';
import { applyScenario, knobsFrom, projectScenario, solveForDate } from './scenario';
import { project } from './engine';
import { monthIndex, monthKeyFromIndex } from './dates';
import { TEST_START_MONTH, makeData, makeExpense, makeGoal, makeIncome } from './testFactories';

const START = monthIndex(TEST_START_MONTH);
const monthAfter = (n: number) => monthKeyFromIndex(START + n - 1);

const base = () =>
  makeData({
    goals: [makeGoal({ id: 'g1', targetCents: 24_000_000 })],
    income: [makeIncome({ amountCents: 10_000_000 })],
    expenses: [
      makeExpense({ id: 'rent', amountCents: 6_000_000, essential: true }),
      makeExpense({ id: 'fun', amountCents: 2_000_000, essential: false }),
    ],
  });

describe('scenario knobs', () => {
  it('changes nothing when every knob is where it started', () => {
    const data = base();
    const plain = project(data);
    const scenario = projectScenario(data, knobsFrom(data));
    expect(scenario.allGoalsCompleteMonth).toBe(plain.allGoalsCompleteMonth);
    expect(scenario.cashFlow.toGoalsCents).toBe(plain.cashFlow.toGoalsCents);
  });

  it('adds extra income to the pool', () => {
    const data = base();
    const scenario = projectScenario(data, { ...knobsFrom(data), extraIncomeCents: 2_000_000 });
    expect(scenario.cashFlow.toGoalsCents).toBe(4_000_000);
    expect(scenario.goals[0]?.monthsToComplete).toBe(6);
  });

  it('trims only the spending that is not essential', () => {
    const data = base();
    const scenario = applyScenario(data, { ...knobsFrom(data), expenseCutShare: 0.5 });
    const byId = new Map(scenario.expenses.map((e) => [e.id, e.amountCents]));
    expect(byId.get('rent')).toBe(6_000_000);
    expect(byId.get('fun')).toBe(1_000_000);
  });

  it('turns a spending cut into a faster finish', () => {
    const data = base();
    const scenario = projectScenario(data, { ...knobsFrom(data), expenseCutShare: 1 });
    expect(scenario.cashFlow.toGoalsCents).toBe(4_000_000);
    expect(scenario.goals[0]?.monthsToComplete).toBe(6);
  });

  it('leaves the real plan untouched', () => {
    const data = base();
    const before = JSON.stringify(data);
    projectScenario(data, { ...knobsFrom(data), extraIncomeCents: 5_000_000, expenseCutShare: 1 });
    expect(JSON.stringify(data)).toBe(before);
  });

  it('does not stack up extra income sources across runs', () => {
    const data = base();
    const once = applyScenario(data, { ...knobsFrom(data), extraIncomeCents: 1_000_000 });
    const twice = applyScenario(once, { ...knobsFrom(once), extraIncomeCents: 1_000_000 });
    expect(twice.income.filter((i) => i.name.includes('what-if'))).toHaveLength(2);
    // ...which is why scenarios are always built from the stored plan, never
    // from another scenario. This test pins that assumption in place.
    expect(applyScenario(data, { ...knobsFrom(data), extraIncomeCents: 1_000_000 }).income).toHaveLength(2);
  });
});

describe('solveForDate', () => {
  it('asks for nothing when the date is already met', () => {
    const data = base();
    // 2_000_000 a month clears 24_000_000 in twelve months.
    const result = solveForDate(data, knobsFrom(data), monthAfter(12));
    expect(result).not.toBeNull();
    expect(result?.extraIncomeCents).toBe(0);
    expect(result?.additionalToGoalsCents).toBe(0);
  });

  it('finds the extra income that makes an earlier date work', () => {
    const data = base();
    const result = solveForDate(data, knobsFrom(data), monthAfter(6));
    expect(result).not.toBeNull();
    // Six months of 4_000_000 clears the goal, so 2_000_000 more a month.
    expect(result?.toGoalsCents).toBeGreaterThanOrEqual(4_000_000);
    expect(result?.extraIncomeCents).toBeGreaterThan(0);
    expect(result?.projection.allGoalsCompleteMonth).not.toBeNull();
  });

  it('returns an amount that genuinely hits the date', () => {
    const data = makeData({
      goals: [
        makeGoal({ id: 'a', targetCents: 50_000_000, annualReturnRate: 0.06 }),
        makeGoal({ id: 'b', targetCents: 15_000_000, priority: 2 }),
      ],
      income: [makeIncome({ amountCents: 12_000_000 })],
      expenses: [makeExpense({ amountCents: 9_000_000 })],
    });
    const target = monthAfter(18);
    const result = solveForDate(data, knobsFrom(data), target);
    expect(result).not.toBeNull();

    const verified = projectScenario(data, {
      ...knobsFrom(data),
      extraIncomeCents: result?.extraIncomeCents ?? 0,
    });
    expect(verified.allGoalsCompleteMonth).not.toBeNull();
    expect(verified.allGoalsCompleteMonth! <= target).toBe(true);
  });

  it('gives back the smallest amount that works, near enough', () => {
    const data = base();
    const target = monthAfter(8);
    const result = solveForDate(data, knobsFrom(data), target);
    expect(result).not.toBeNull();

    // A rupee under the answer should miss the date.
    const short = projectScenario(data, {
      ...knobsFrom(data),
      extraIncomeCents: Math.max(0, (result?.extraIncomeCents ?? 0) - 100),
    });
    const missed =
      short.allGoalsCompleteMonth === null || short.allGoalsCompleteMonth > target;
    expect(missed).toBe(true);
  });

  it('refuses a date in the past', () => {
    const data = base();
    expect(solveForDate(data, knobsFrom(data), monthKeyFromIndex(START - 2))).toBeNull();
  });

  it('handles a plan with no goals at all', () => {
    const data = makeData({ income: [makeIncome()] });
    const result = solveForDate(data, knobsFrom(data), monthAfter(6));
    expect(result?.extraIncomeCents).toBe(0);
  });
});
