import { describe, expect, it } from 'vitest';
import {
  buildMilestones,
  buildMonthProgress,
  buildSpendSummary,
  buildStreaks,
  categoryBudgetsFrom,
  contributedTotalForGoal,
} from './tracking';
import { makeData, makeExpense } from './testFactories';
import type { Contribution, SpendLog } from './types';

const NOW = new Date('2026-03-15T12:00:00Z');

let seq = 0;
function contribution(date: string, amountCents: number, goalId = 'g1'): Contribution {
  seq += 1;
  return { id: `c${seq}`, goalId, amountCents, date };
}
function spend(date: string, amountCents: number, category = 'Food'): SpendLog {
  seq += 1;
  return { id: `s${seq}`, amountCents, category, account: 'debit', date };
}

describe('contributions', () => {
  it('totals what went into one goal', () => {
    const contributions = [
      contribution('2026-01-05', 100_000, 'g1'),
      contribution('2026-01-20', 50_000, 'g1'),
      contribution('2026-01-20', 900_000, 'g2'),
    ];
    expect(contributedTotalForGoal(contributions, 'g1')).toBe(150_000);
    expect(contributedTotalForGoal(contributions, 'nope')).toBe(0);
  });

  it('has nothing to report before the first deposit', () => {
    expect(buildMonthProgress(makeData(), 100_000, NOW)).toEqual([]);
  });

  it('fills in the quiet months between deposits', () => {
    const data = makeData({
      contributions: [contribution('2026-01-10', 500_000), contribution('2026-03-02', 500_000)],
    });
    const months = buildMonthProgress(data, 500_000, NOW);
    expect(months.map((m) => m.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(months[1]?.actualCents).toBe(0);
    expect(months[1]?.met).toBe(false);
  });

  it('counts a month as met once the target is reached', () => {
    const data = makeData({
      contributions: [contribution('2026-01-10', 300_000), contribution('2026-01-25', 200_000)],
    });
    const months = buildMonthProgress(data, 500_000, NOW);
    expect(months[0]?.actualCents).toBe(500_000);
    expect(months[0]?.met).toBe(true);
    expect(months[0]?.ratio).toBe(1);
  });

  it('caps the ratio so one huge month cannot distort a chart', () => {
    const data = makeData({ contributions: [contribution('2026-01-10', 5_000_000)] });
    expect(buildMonthProgress(data, 500_000, NOW)[0]?.ratio).toBe(2);
  });
});

describe('streaks', () => {
  const withMonths = (amounts: [string, number][]) =>
    makeData({ contributions: amounts.map(([date, amount]) => contribution(date, amount)) });

  it('counts consecutive complete months', () => {
    const data = withMonths([
      ['2025-11-01', 500_000],
      ['2025-12-01', 500_000],
      ['2026-01-01', 500_000],
      ['2026-02-01', 500_000],
    ]);
    const streaks = buildStreaks(buildMonthProgress(data, 500_000, NOW), NOW);
    expect(streaks.current).toBe(4);
    expect(streaks.best).toBe(4);
    expect(streaks.trackedCount).toBe(4);
    expect(streaks.metCount).toBe(4);
  });

  it('breaks the streak on a missed month but remembers the best run', () => {
    const data = withMonths([
      ['2025-09-01', 500_000],
      ['2025-10-01', 500_000],
      ['2025-11-01', 500_000],
      ['2025-12-01', 100_000],
      ['2026-01-01', 500_000],
      ['2026-02-01', 500_000],
    ]);
    const streaks = buildStreaks(buildMonthProgress(data, 500_000, NOW), NOW);
    expect(streaks.best).toBe(3);
    expect(streaks.current).toBe(2);
  });

  it('does not let the month in progress break a streak', () => {
    // March is under way and short, but February was met.
    const data = withMonths([
      ['2026-01-01', 500_000],
      ['2026-02-01', 500_000],
      ['2026-03-01', 10_000],
    ]);
    const streaks = buildStreaks(buildMonthProgress(data, 500_000, NOW), NOW);
    expect(streaks.current).toBe(2);
    expect(streaks.trackedCount).toBe(2);
  });

  it('lets a month in progress extend the streak once it is met', () => {
    const data = withMonths([
      ['2026-01-01', 500_000],
      ['2026-02-01', 500_000],
      ['2026-03-01', 500_000],
    ]);
    const streaks = buildStreaks(buildMonthProgress(data, 500_000, NOW), NOW);
    expect(streaks.current).toBe(3);
    expect(streaks.best).toBe(3);
  });

  it('starts everyone at zero', () => {
    const streaks = buildStreaks([], NOW);
    expect(streaks.current).toBe(0);
    expect(streaks.best).toBe(0);
  });
});

describe('spending', () => {
  const budgets = new Map<string, number>([['Food', 3_000_000]]);

  it('is empty until something is logged', () => {
    const summary = buildSpendSummary(makeData(), '2026-03', 3_000_000, budgets, NOW);
    expect(summary.totalCents).toBe(0);
    expect(summary.days).toEqual([]);
    expect(summary.trackedDays).toBe(0);
  });

  it('never judges days before the very first log', () => {
    const data = makeData({ spendLogs: [spend('2026-03-10', 50_000)] });
    const summary = buildSpendSummary(data, '2026-03', 3_100_000, budgets, NOW);
    // 10th to 15th inclusive — the first nine days are simply unknown.
    expect(summary.trackedDays).toBe(6);
    expect(summary.days[0]?.date).toBe('2026-03-10');
  });

  it('stops at today rather than judging the rest of the month', () => {
    const data = makeData({ spendLogs: [spend('2026-03-01', 10_000)] });
    const summary = buildSpendSummary(data, '2026-03', 3_100_000, budgets, NOW);
    expect(summary.days[summary.days.length - 1]?.date).toBe('2026-03-15');
  });

  it('spreads the budget into a daily allowance', () => {
    const summary = buildSpendSummary(
      makeData({ spendLogs: [spend('2026-03-01', 10_000)] }),
      '2026-03',
      3_100_000,
      budgets,
      NOW,
    );
    expect(summary.dailyAllowanceCents).toBe(100_000);
    expect(summary.days[0]?.underBudget).toBe(true);
  });

  it('marks a day over the allowance', () => {
    const summary = buildSpendSummary(
      makeData({ spendLogs: [spend('2026-03-01', 500_000)] }),
      '2026-03',
      3_100_000,
      budgets,
      NOW,
    );
    expect(summary.days[0]?.underBudget).toBe(false);
    expect(summary.days[0]?.noSpend).toBe(false);
    expect(summary.days[1]?.noSpend).toBe(true);
  });

  it('tracks the current and best runs of quiet days', () => {
    const data = makeData({
      spendLogs: [
        spend('2026-03-01', 10_000),
        // 2nd to 6th quiet — five days
        spend('2026-03-07', 10_000),
        spend('2026-03-11', 10_000),
        // 12th to 15th quiet — four days, and still running
      ],
    });
    const summary = buildSpendSummary(data, '2026-03', 3_100_000, budgets, NOW);
    expect(summary.bestNoSpendStreak).toBe(5);
    expect(summary.noSpendStreak).toBe(4);
  });

  it('adds up spending by category alongside its budget', () => {
    const data = makeData({
      spendLogs: [
        spend('2026-03-01', 100_000, 'Food'),
        spend('2026-03-02', 250_000, 'Transport'),
        spend('2026-03-03', 50_000, 'Food'),
      ],
    });
    const summary = buildSpendSummary(data, '2026-03', 3_100_000, budgets, NOW);
    expect(summary.totalCents).toBe(400_000);
    expect(summary.byCategory[0]).toEqual({
      category: 'Transport',
      spentCents: 250_000,
      budgetCents: 0,
    });
    expect(summary.byCategory.find((c) => c.category === 'Food')).toEqual({
      category: 'Food',
      spentCents: 150_000,
      budgetCents: 3_000_000,
    });
  });

  it('ignores logs from other months', () => {
    const data = makeData({
      spendLogs: [spend('2026-02-20', 900_000), spend('2026-03-02', 100_000)],
    });
    expect(buildSpendSummary(data, '2026-03', 3_100_000, budgets, NOW).totalCents).toBe(100_000);
  });
});

describe('category budgets', () => {
  it('rolls planned expenses up into per-category monthly budgets', () => {
    const data = makeData({
      expenses: [
        makeExpense({ amountCents: 2_000_000, category: 'Housing' }),
        makeExpense({ amountCents: 1_200_000, category: 'Housing', frequency: 'yearly' }),
        makeExpense({ amountCents: 500_000, category: 'Food' }),
        makeExpense({ amountCents: 900_000, category: 'Food', active: false }),
      ],
    });
    const budgets = categoryBudgetsFrom(data);
    expect(budgets.get('Housing')).toBe(2_100_000);
    expect(budgets.get('Food')).toBe(500_000);
  });
});

describe('milestones', () => {
  it('unlocks as the numbers behind them are met', () => {
    const data = makeData({ contributions: [contribution('2026-01-10', 100_000)] });
    const months = buildMonthProgress(data, 100_000, NOW);
    const streaks = buildStreaks(months, NOW);
    const spendSummary = buildSpendSummary(data, '2026-03', 0, new Map(), NOW);

    const milestones = buildMilestones(data, streaks, spendSummary, 0.6, false);
    const byId = new Map(milestones.map((m) => [m.id, m]));

    expect(byId.get('first-contribution')?.achieved).toBe(true);
    expect(byId.get('quarter-way')?.achieved).toBe(true);
    expect(byId.get('half-way')?.achieved).toBe(true);
    expect(byId.get('three-quarters')?.achieved).toBe(false);
    expect(byId.get('three-quarters')?.progress).toBeCloseTo(0.8, 5);
    expect(byId.get('debt-free')?.achieved).toBe(false);
  });

  it('never reports progress above one', () => {
    const data = makeData();
    const spendSummary = buildSpendSummary(data, '2026-03', 0, new Map(), NOW);
    const milestones = buildMilestones(data, buildStreaks([], NOW), spendSummary, 5, true);
    for (const m of milestones) {
      expect(m.progress).toBeLessThanOrEqual(1);
      expect(m.progress).toBeGreaterThanOrEqual(0);
    }
  });
});
