import { describe, expect, it } from 'vitest';
import { project } from './engine';
import {
  buildForecast,
  describeEvent,
  fullReportCsv,
  milestoneReportCsv,
  monthlyReportCsv,
  yearlyReportCsv,
} from './forecast';
import { sumCents } from './money';
import { makeData, makeExpense, makeGoal, makeIncome } from './testFactories';

/**
 * The shape Sreeni described: two loan-preclosure goals whose EMIs stop when
 * they land, then a goal that benefits from the freed money.
 */
const preclosurePlan = () =>
  makeData({
    goals: [
      makeGoal({ id: 'loan', name: 'Loan closure', targetCents: 4_000_000, priority: 1 }),
      makeGoal({ id: 'marriage', name: 'Marriage', targetCents: 9_000_000, priority: 2 }),
    ],
    income: [makeIncome({ amountCents: 10_000_000 })],
    expenses: [
      makeExpense({ id: 'living', amountCents: 6_000_000 }),
      makeExpense({ id: 'emi', amountCents: 2_000_000, endsWithGoalId: 'loan' }),
    ],
  });

describe('forecast rows', () => {
  it('has one row per simulated month', () => {
    const p = project(preclosurePlan());
    const f = buildForecast(p);
    expect(f.rows).toHaveLength(p.months.length);
    expect(f.rows[0]?.monthNumber).toBe(1);
    expect(f.rows[0]?.month).toBe(p.months[0]?.month);
  });

  it('shows the monthly pool stepping up when the EMI stops', () => {
    const f = buildForecast(project(preclosurePlan()));
    // 2M a month while the EMI runs, 4M once it stops.
    expect(f.rows[0]?.poolCents).toBe(2_000_000);
    expect(f.rows[1]?.poolCents).toBe(2_000_000);
    expect(f.rows[2]?.poolCents).toBe(4_000_000);
    expect(f.startingPoolCents).toBe(2_000_000);
    expect(f.peakPoolCents).toBe(4_000_000);
  });

  it('reports outgoings that have stopped, cumulatively', () => {
    const f = buildForecast(project(preclosurePlan()));
    expect(f.rows[0]?.freedExpenseCents).toBe(0);
    expect(f.rows[1]?.freedExpenseCents).toBe(0);
    expect(f.rows[2]?.freedExpenseCents).toBe(2_000_000);
    expect(f.totalFreedCents).toBe(2_000_000);
  });

  it('names the goals that land in each month', () => {
    const f = buildForecast(project(preclosurePlan()));
    expect(f.rows[1]?.completedGoalNames).toEqual(['Loan closure']);
    expect(f.rows[0]?.completedGoalNames).toEqual([]);
  });

  it('tracks the running total against the projection', () => {
    const p = project(preclosurePlan());
    const f = buildForecast(p);
    const last = f.rows[f.rows.length - 1];
    expect(last?.totalSavedCents).toBe(p.months[p.months.length - 1]?.goalBalanceCents);
    expect(sumCents(f.rows.map((r) => r.contributedCents))).toBe(p.totalContributedCents);
  });

  it('splits each month across the goals that were funded', () => {
    const f = buildForecast(project(preclosurePlan()));
    for (const row of f.rows) {
      const perGoal = sumCents(Object.values(row.perGoalContributionCents));
      expect(perGoal).toBe(row.contributedCents);
    }
  });
});

describe('forecast events', () => {
  it('records one event per goal that lands', () => {
    const f = buildForecast(project(preclosurePlan()));
    expect(f.events.map((e) => e.goalName)).toEqual(['Loan closure', 'Marriage']);
  });

  it('separates money that is genuinely new from money that is merely freed', () => {
    const f = buildForecast(project(preclosurePlan()));
    const loan = f.events[0];
    // The EMI stopping is new money.
    expect(loan?.expenseFreedCents).toBe(2_000_000);
    // What it was absorbing was already in the pool, and is now free for others.
    expect(loan?.wasAbsorbingCents).toBe(2_000_000);
    // Which is why the pool afterwards is 4M, not 6M — no double counting.
    expect(loan?.poolBeforeCents).toBe(2_000_000);
    expect(loan?.poolAfterCents).toBe(4_000_000);
  });

  it('reports no freed payments for a goal with nothing tied to it', () => {
    const f = buildForecast(project(preclosurePlan()));
    expect(f.events[1]?.expenseFreedCents).toBe(0);
  });

  it('describes the change in words that do not double count', () => {
    const f = buildForecast(project(preclosurePlan()));
    const text = describeEvent(f.events[0]!, 'INR', 'en-IN');
    expect(text).toContain('₹20,000 a month of payments stops');
    expect(text).toContain('₹40,000 a month now goes to your remaining goal');
  });

  it('does not claim money goes to other goals when none are left', () => {
    const f = buildForecast(project(preclosurePlan()));
    const last = f.events[f.events.length - 1]!;
    expect(last.remainingGoals).toBe(0);
    const text = describeEvent(last, 'INR', 'en-IN');
    expect(text).toContain('with every goal funded');
    expect(text).not.toContain('remaining');
  });

  it('has no events when nothing ever lands', () => {
    const f = buildForecast(
      project(
        makeData({
          goals: [makeGoal({ targetCents: 90_000_000 })],
          income: [makeIncome({ amountCents: 5_000_000 })],
          expenses: [makeExpense({ amountCents: 5_000_000 })],
        }),
      ),
    );
    expect(f.events).toEqual([]);
  });
});

describe('the state the plan ends in', () => {
  // The last goal to land is often the one clearing a loan, so its payment
  // only stops after everything else is already funded. The forecast has to
  // run past the finish line or it would never show what you end up free to
  // save — which is the whole point of looking forward.
  const lastGoalFrees = () =>
    makeData({
      goals: [
        makeGoal({ id: 'first', name: 'First', targetCents: 2_000_000, priority: 1 }),
        makeGoal({ id: 'loan', name: 'Loan closure', targetCents: 2_000_000, priority: 2 }),
      ],
      income: [makeIncome({ amountCents: 10_000_000 })],
      expenses: [
        makeExpense({ id: 'living', amountCents: 6_000_000 }),
        makeExpense({ id: 'emi', amountCents: 2_000_000, endsWithGoalId: 'loan' }),
      ],
    });

  it('carries on one month past the last goal', () => {
    const f = buildForecast(project(lastGoalFrees()));
    expect(f.rows).toHaveLength(3);
    expect(f.rows[1]?.completedGoalNames).toEqual(['Loan closure']);
  });

  it('counts the final payment that stops', () => {
    const f = buildForecast(project(lastGoalFrees()));
    // Without the trailing month this would report nothing freed at all.
    expect(f.rows[1]?.freedExpenseCents).toBe(0);
    expect(f.rows[2]?.freedExpenseCents).toBe(2_000_000);
    expect(f.totalFreedCents).toBe(2_000_000);
  });

  it('shows what is left free once every goal is funded', () => {
    const f = buildForecast(project(lastGoalFrees()));
    // 2M a month while the EMI runs, 4M a month once everything has landed.
    expect(f.startingPoolCents).toBe(2_000_000);
    expect(f.peakPoolCents).toBe(4_000_000);
    // With nothing left to fund, that money is spare rather than allocated.
    expect(f.rows[2]?.contributedCents).toBe(0);
    expect(f.rows[2]?.unallocatedCents).toBe(4_000_000);
  });
});

describe('yearly summary', () => {
  it('groups the months into calendar years', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 100_000_000 })],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 8_000_000 })],
      }),
    );
    const f = buildForecast(p);
    expect(f.years[0]?.year).toBe(2026);
    expect(f.years[0]?.months).toBe(12);
    // 2M a month for twelve months.
    expect(f.years[0]?.savedCents).toBe(24_000_000);
    expect(f.years[0]?.totalSavedCents).toBe(24_000_000);
  });

  it('adds up to the same total as the monthly rows', () => {
    const f = buildForecast(project(preclosurePlan()));
    expect(sumCents(f.years.map((y) => y.savedCents))).toBe(
      sumCents(f.rows.map((r) => r.contributedCents)),
    );
  });

  it('lists the goals that landed in each year', () => {
    const f = buildForecast(project(preclosurePlan()));
    expect(f.years[0]?.goalsLanded).toEqual(['Loan closure', 'Marriage']);
  });
});

describe('reports', () => {
  const p = project(preclosurePlan());
  const f = buildForecast(p);

  it('writes a header and a row per month', () => {
    const lines = monthlyReportCsv(f, p, 'INR').trim().split('\r\n');
    expect(lines).toHaveLength(f.rows.length + 1);
    expect(lines[0]).toContain('Month');
    expect(lines[0]).toContain('Available to goals (INR)');
  });

  it('gives every goal its own column', () => {
    const header = monthlyReportCsv(f, p, 'INR').split('\r\n')[0] ?? '';
    expect(header).toContain('Loan closure (INR)');
    expect(header).toContain('Marriage (INR)');
  });

  it('writes money as plain decimals a spreadsheet can add up', () => {
    const row = monthlyReportCsv(f, p, 'INR').split('\r\n')[1] ?? '';
    // 2_000_000 cents is 20000.00 rupees.
    expect(row).toContain('20000.00');
    expect(row).not.toContain('₹');
  });

  it('starts with a byte order mark so Excel reads it as UTF-8', () => {
    expect(monthlyReportCsv(f, p, 'INR').charCodeAt(0)).toBe(0xfeff);
  });

  it('quotes fields that contain a comma', () => {
    const plan = makeData({
      goals: [makeGoal({ id: 'g', name: 'House, car and boat', targetCents: 2_000_000 })],
      income: [makeIncome({ amountCents: 10_000_000 })],
      expenses: [makeExpense({ amountCents: 8_000_000 })],
    });
    const projection = project(plan);
    const csv = monthlyReportCsv(buildForecast(projection), projection, 'INR');
    expect(csv).toContain('"House, car and boat (INR)"');
  });

  it('writes a year per row', () => {
    const lines = yearlyReportCsv(f, 'INR').trim().split('\r\n');
    expect(lines).toHaveLength(f.years.length + 1);
  });

  it('writes a milestone per goal that lands', () => {
    const lines = milestoneReportCsv(f, 'INR', 'en-IN').trim().split('\r\n');
    expect(lines).toHaveLength(f.events.length + 1);
    expect(lines[1]).toContain('Loan closure');
  });

  it('puts all three tables in the combined report', () => {
    const csv = fullReportCsv(f, p, 'INR', 'en-IN');
    expect(csv).toContain('GOALVAULT FORECAST — MILESTONES');
    expect(csv).toContain('YEAR BY YEAR');
    expect(csv).toContain('MONTH BY MONTH');
  });

  it('survives a plan with no goals at all', () => {
    const empty = project(makeData({ income: [makeIncome()] }));
    const forecast = buildForecast(empty);
    expect(() => fullReportCsv(forecast, empty, 'INR', 'en-IN')).not.toThrow();
    expect(forecast.events).toEqual([]);
  });
});
