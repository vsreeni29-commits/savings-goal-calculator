import { describe, expect, it } from 'vitest';
import {
  computeCashFlow,
  debtHint,
  monthlyIncomeCents,
  periodsUntilDeadline,
  project,
  toMonthlyCents,
} from './engine';
import type { GoalProjection, Projection } from './engine';
import { formatMonthKey, monthIndex, monthKeyFromIndex } from './dates';
import { sumCents } from './money';
import {
  TEST_START_MONTH,
  makeData,
  makeDebt,
  makeExpense,
  makeGoal,
  makeIncome,
} from './testFactories';

const START = monthIndex(TEST_START_MONTH);

function monthAfter(n: number): string {
  return monthKeyFromIndex(START + n - 1);
}

function goalById(p: Projection, id: string): GoalProjection {
  const found = p.goals.find((g) => g.goalId === id);
  if (!found) throw new Error(`no projection for goal ${id}`);
  return found;
}

describe('frequency normalisation', () => {
  it('converts every frequency to a monthly figure', () => {
    expect(toMonthlyCents(120_000, 'monthly')).toBe(120_000);
    expect(toMonthlyCents(120_000, 'yearly')).toBe(10_000);
    expect(toMonthlyCents(120_000, 'quarterly')).toBe(40_000);
    expect(toMonthlyCents(100_000, 'weekly')).toBe(433_333);
    expect(toMonthlyCents(100_000, 'biweekly')).toBe(216_667);
  });

  it('adds up only the active income sources', () => {
    const income = [
      makeIncome({ amountCents: 5_000_000 }),
      makeIncome({ amountCents: 1_200_000, frequency: 'yearly' }),
      makeIncome({ amountCents: 9_000_000, active: false }),
    ];
    expect(monthlyIncomeCents(income)).toBe(5_100_000);
  });
});

describe('cash flow', () => {
  it('leaves the surplus after cash costs, minimums and buffer', () => {
    const data = makeData({
      income: [makeIncome({ amountCents: 10_000_000 })],
      expenses: [makeExpense({ amountCents: 4_000_000 })],
      debts: [makeDebt({ balanceCents: 2_000_000, minPaymentCents: 500_000 })],
      settings: { bufferCents: 500_000 },
    });
    const cf = computeCashFlow(data);
    expect(cf.incomeCents).toBe(10_000_000);
    expect(cf.debitExpenseCents).toBe(4_000_000);
    expect(cf.minDebtPaymentCents).toBe(500_000);
    expect(cf.surplusCents).toBe(5_000_000);
    expect(cf.toGoalsCents).toBe(5_000_000);
  });

  it('does not treat card spending as cash leaving the account', () => {
    const data = makeData({
      income: [makeIncome({ amountCents: 10_000_000 })],
      expenses: [
        makeExpense({ amountCents: 4_000_000, account: 'debit' }),
        makeExpense({ amountCents: 1_000_000, account: 'credit' }),
      ],
      debts: [makeDebt({ balanceCents: 0, minPaymentCents: 0 })],
    });
    const cf = computeCashFlow(data);
    expect(cf.creditExpenseCents).toBe(1_000_000);
    expect(cf.unlinkedCreditExpenseCents).toBe(0);
    // Card spending hits the card, so this month's cash is untouched by it.
    expect(cf.surplusCents).toBe(6_000_000);
  });

  it('charges card spending to cash when there is no card to carry it', () => {
    const data = makeData({
      income: [makeIncome({ amountCents: 10_000_000 })],
      expenses: [makeExpense({ amountCents: 1_000_000, account: 'credit' })],
    });
    const cf = computeCashFlow(data);
    expect(cf.unlinkedCreditExpenseCents).toBe(1_000_000);
    expect(cf.surplusCents).toBe(9_000_000);
  });

  it('applies the savings factor and the debt share to the surplus', () => {
    const data = makeData({
      income: [makeIncome({ amountCents: 10_000_000 })],
      expenses: [makeExpense({ amountCents: 6_000_000 })],
      debts: [makeDebt({ balanceCents: 5_000_000, minPaymentCents: 0 })],
      settings: { savingsFactor: 0.5, debtExtraShare: 0.25 },
    });
    const cf = computeCashFlow(data);
    expect(cf.surplusCents).toBe(4_000_000);
    expect(cf.savableCents).toBe(2_000_000);
    expect(cf.lifestyleCents).toBe(2_000_000);
    expect(cf.extraDebtCents).toBe(500_000);
    expect(cf.toGoalsCents).toBe(1_500_000);
  });

  it('never hands debt more than is owed', () => {
    const data = makeData({
      income: [makeIncome({ amountCents: 10_000_000 })],
      debts: [makeDebt({ balanceCents: 100_000, minPaymentCents: 0 })],
      settings: { debtExtraShare: 1 },
    });
    const cf = computeCashFlow(data);
    // 100_000 owed plus the 2_000 of interest that lands before it is paid.
    expect(cf.extraDebtCents).toBe(102_000);
    expect(cf.toGoalsCents).toBe(9_898_000);
  });
});

describe('deadlines', () => {
  it('counts the deadline month only when the date sits at its end', () => {
    // From 2026-01 to a 2026-06 deadline.
    expect(periodsUntilDeadline('2026-06-30', monthIndex('2026-01'))).toBe(6);
    expect(periodsUntilDeadline('2026-06-01', monthIndex('2026-01'))).toBe(5);
    expect(periodsUntilDeadline('2026-01-15', monthIndex('2026-01'))).toBe(0);
    expect(periodsUntilDeadline('2025-06-30', monthIndex('2026-01'))).toBe(-6);
  });
});

describe('single goal', () => {
  const data = makeData({
    goals: [makeGoal({ id: 'g1', targetCents: 40_000_000 })],
    income: [makeIncome({ amountCents: 10_000_000 })],
    expenses: [makeExpense({ amountCents: 6_000_000 })],
  });

  it('lands exactly when the arithmetic says it should', () => {
    const p = project(data);
    const g = goalById(p, 'g1');
    expect(p.cashFlow.toGoalsCents).toBe(4_000_000);
    expect(g.monthsToComplete).toBe(10);
    expect(g.completionMonth).toBe(monthAfter(10));
    expect(p.allGoalsCompleteMonth).toBe(monthAfter(10));
    expect(p.monthsToAllGoals).toBe(10);
    expect(p.feasible).toBe(true);
  });

  it('never puts in more than the goal still needs', () => {
    const p = project(data);
    const last = p.months[p.months.length - 1];
    expect(last?.goalBalanceCents).toBe(40_000_000);
    expect(sumCents(p.months.map((m) => m.contributedCents))).toBe(40_000_000);
  });

  it('counts a goal that is already funded as done immediately', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 1_000_000, savedCents: 1_000_000 })],
        income: [makeIncome()],
      }),
    );
    expect(goalById(p, 'g1').monthsToComplete).toBe(0);
  });

  it('reports never when nothing can be saved', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 40_000_000 })],
        income: [makeIncome({ amountCents: 6_000_000 })],
        expenses: [makeExpense({ amountCents: 6_000_000 })],
      }),
    );
    expect(goalById(p, 'g1').completionMonth).toBeNull();
    expect(p.allGoalsCompleteMonth).toBeNull();
    expect(p.feasible).toBe(false);
    expect(p.warnings.some((w) => w.id === 'nothing-to-save')).toBe(true);
  });

  it('gets there on growth alone when a goal is nearly funded', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({
            id: 'g1',
            targetCents: 10_000_000,
            savedCents: 9_900_000,
            annualReturnRate: 0.12,
          }),
        ],
        income: [makeIncome({ amountCents: 5_000_000 })],
        expenses: [makeExpense({ amountCents: 5_000_000 })],
      }),
    );
    const g = goalById(p, 'g1');
    expect(g.monthsToComplete).toBe(2);
    expect(g.totalGrowthCents).toBeGreaterThan(0);
  });
});

describe('deadline goals', () => {
  it('asks for the level payment that hits the target date', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({ id: 'g1', targetCents: 12_000_000, targetDate: '2026-12-31' }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 4_000_000 })],
      }),
    );
    const g = goalById(p, 'g1');
    // 12 contributing months from January to December, no interest.
    expect(g.requiredMonthlyCents).toBe(1_000_000);
    expect(g.meetsDeadline).toBe(true);
    // Nothing else is competing for the 6_000_000 a month that is spare, so
    // the deadline is the floor on the plan, not the ceiling.
    expect(g.plannedMonthlyCents).toBe(6_000_000);
    expect(g.completionMonth).toBe('2026-02');
  });

  it('flags a target date the money cannot reach', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({ id: 'g1', targetCents: 60_000_000, targetDate: '2026-06-30' }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 8_000_000 })],
      }),
    );
    const g = goalById(p, 'g1');
    expect(g.requiredMonthlyCents).toBe(10_000_000);
    expect(g.plannedMonthlyCents).toBe(2_000_000);
    expect(g.shortfallMonthlyCents).toBe(8_000_000);
    expect(g.meetsDeadline).toBe(false);
    expect(p.feasible).toBe(false);
    expect(p.warnings.some((w) => w.id === `deadline-g1`)).toBe(true);
  });

  it('funds the nearest deadline first when two compete', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({
            id: 'far',
            name: 'Far',
            targetCents: 12_000_000,
            targetDate: '2027-12-31',
            priority: 1,
          }),
          makeGoal({
            id: 'near',
            name: 'Near',
            targetCents: 6_000_000,
            targetDate: '2026-06-30',
            priority: 2,
          }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 8_500_000 })],
      }),
    );
    // Only 1_500_000 a month exists; the June goal needs 1_000_000 of it even
    // though the other goal is marked more important.
    expect(goalById(p, 'near').plannedMonthlyCents).toBe(1_000_000);
    expect(goalById(p, 'far').plannedMonthlyCents).toBe(500_000);
    expect(goalById(p, 'near').meetsDeadline).toBe(true);
  });

  it('demands the whole shortfall once the date has gone by', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({ id: 'g1', targetCents: 5_000_000, targetDate: '2025-06-30' }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 9_000_000 })],
      }),
    );
    const g = goalById(p, 'g1');
    expect(g.requiredMonthlyCents).toBe(5_000_000);
    expect(g.meetsDeadline).toBe(false);
  });
});

describe('allocation strategies', () => {
  const twoGoals = () => [
    makeGoal({ id: 'a', name: 'A', targetCents: 4_000_000, priority: 1 }),
    makeGoal({ id: 'b', name: 'B', targetCents: 4_000_000, priority: 2 }),
  ];
  const base = {
    income: [makeIncome({ amountCents: 10_000_000 })],
    expenses: [makeExpense({ amountCents: 8_000_000 })],
  };

  it('priority pours everything into the top goal first', () => {
    const p = project(makeData({ ...base, goals: twoGoals() }));
    expect(goalById(p, 'a').plannedMonthlyCents).toBe(2_000_000);
    expect(goalById(p, 'b').plannedMonthlyCents).toBe(0);
    expect(goalById(p, 'a').monthsToComplete).toBe(2);
    expect(goalById(p, 'b').monthsToComplete).toBe(4);
  });

  it('balanced splits by priority weight', () => {
    const p = project(
      makeData({
        ...base,
        goals: [
          makeGoal({ id: 'a', targetCents: 4_000_000, priority: 1 }),
          makeGoal({ id: 'b', targetCents: 4_000_000, priority: 1 }),
        ],
        settings: { allocationStrategy: 'balanced' },
      }),
    );
    expect(goalById(p, 'a').plannedMonthlyCents).toBe(1_000_000);
    expect(goalById(p, 'b').plannedMonthlyCents).toBe(1_000_000);
    expect(p.monthsToAllGoals).toBe(4);
  });

  it('weights a priority-1 goal at twice a priority-2 goal', () => {
    const p = project(
      makeData({
        ...base,
        goals: twoGoals(),
        settings: { allocationStrategy: 'balanced' },
      }),
    );
    // The odd cent goes to the larger fractional share, so the two still add
    // up to exactly the 2_000_000 available.
    expect(goalById(p, 'a').plannedMonthlyCents).toBe(1_333_333);
    expect(goalById(p, 'b').plannedMonthlyCents).toBe(666_667);
  });

  it('fastest-first clears the smallest goal before the bigger one', () => {
    const p = project(
      makeData({
        ...base,
        goals: [
          makeGoal({ id: 'big', targetCents: 6_000_000, priority: 1 }),
          makeGoal({ id: 'small', targetCents: 2_000_000, priority: 2 }),
        ],
        settings: { allocationStrategy: 'fastestFirst' },
      }),
    );
    expect(goalById(p, 'small').monthsToComplete).toBe(1);
    expect(goalById(p, 'big').monthsToComplete).toBe(4);
  });

  it('honours a pinned monthly amount ahead of the strategy', () => {
    const p = project(
      makeData({
        ...base,
        goals: [
          makeGoal({ id: 'a', targetCents: 4_000_000, priority: 1 }),
          makeGoal({
            id: 'b',
            targetCents: 4_000_000,
            priority: 2,
            manualMonthlyCents: 500_000,
          }),
        ],
      }),
    );
    expect(goalById(p, 'b').plannedMonthlyCents).toBe(500_000);
    expect(goalById(p, 'a').plannedMonthlyCents).toBe(1_500_000);
  });

  it('takes the same total time whichever strategy shares the money', () => {
    const strategies = ['priority', 'balanced', 'fastestFirst'] as const;
    const finishes = strategies.map((allocationStrategy) => {
      const p = project(
        makeData({
          ...base,
          goals: twoGoals(),
          settings: { allocationStrategy },
        }),
      );
      return p.monthsToAllGoals;
    });
    expect(new Set(finishes).size).toBe(1);
    expect(finishes[0]).toBe(4);
  });

  it('rolls a finished goal\'s money straight into the next one', () => {
    const p = project(
      makeData({
        ...base,
        goals: [
          makeGoal({ id: 'a', targetCents: 3_000_000, priority: 1 }),
          makeGoal({ id: 'b', targetCents: 1_000_000, priority: 2 }),
        ],
      }),
    );
    // Month 2 finishes A with 1_000_000 and spills the other 1_000_000 to B.
    expect(goalById(p, 'a').monthsToComplete).toBe(2);
    expect(goalById(p, 'b').monthsToComplete).toBe(2);
    expect(p.months[1]?.contributedCents).toBe(2_000_000);
  });

  it('reports money with nowhere left to go', () => {
    const p = project(
      makeData({
        ...base,
        goals: [makeGoal({ id: 'a', targetCents: 1_000_000 })],
      }),
    );
    expect(p.months[0]?.unallocatedCents).toBe(1_000_000);
  });
});

describe('debt', () => {
  it('clears a card and then speeds the goals up', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 100_000_000 })],
        income: [makeIncome({ amountCents: 5_000_000 })],
        expenses: [makeExpense({ amountCents: 4_000_000 })],
        debts: [
          makeDebt({
            id: 'card',
            balanceCents: 1_000_000,
            aprRate: 0.24,
            minPaymentCents: 100_000,
          }),
        ],
        settings: { debtExtraShare: 1 },
      }),
    );
    const card = p.debts.find((d) => d.debtId === 'card');
    expect(card?.monthsToClear).toBe(2);
    expect(card?.growing).toBe(false);
    expect(p.debtFreeMonth).toBe(monthAfter(2));
    // Nothing reaches the goal while the card is being cleared.
    expect(p.months[0]?.contributedCents).toBe(0);
    expect(p.months[2]?.contributedCents).toBe(1_000_000);
  });

  it('charges card spending to the card rather than to cash', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 100_000_000 })],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [
          makeExpense({ amountCents: 5_000_000, account: 'debit' }),
          makeExpense({ id: 'e-card', amountCents: 1_000_000, account: 'credit', debtId: 'card' }),
        ],
        debts: [
          makeDebt({ id: 'card', balanceCents: 0, aprRate: 0, minPaymentCents: 1_000_000 }),
        ],
      }),
    );
    // The 1_000_000 of card spending is met by the 1_000_000 minimum payment,
    // so the balance stays flat and cash is reduced by the payment, not the spend.
    expect(p.months[0]?.debtBalanceCents).toBe(0);
    expect(p.cashFlow.toGoalsCents).toBe(4_000_000);
  });

  it('spots a card whose spending outruns its repayment', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 10_000_000 })],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [
          makeExpense({ amountCents: 5_000_000, account: 'debit' }),
          makeExpense({ id: 'e-card', amountCents: 2_000_000, account: 'credit', debtId: 'card' }),
        ],
        debts: [
          makeDebt({
            id: 'card',
            balanceCents: 1_000_000,
            aprRate: 0.36,
            minPaymentCents: 500_000,
          }),
        ],
      }),
    );
    const card = p.debts.find((d) => d.debtId === 'card');
    expect(card?.growing).toBe(true);
    expect(card?.clearedMonth).toBeNull();
    expect(p.warnings.some((w) => w.id === 'debt-growing-card')).toBe(true);
  });

  it('avalanche attacks the most expensive debt first', () => {
    const p = project(
      makeData({
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 8_000_000 })],
        debts: [
          makeDebt({ id: 'cheap', balanceCents: 1_000_000, aprRate: 0.1, minPaymentCents: 0 }),
          makeDebt({ id: 'dear', balanceCents: 5_000_000, aprRate: 0.4, minPaymentCents: 0 }),
        ],
        settings: { debtExtraShare: 1, debtStrategy: 'avalanche' },
      }),
    );
    expect(p.debts.find((d) => d.debtId === 'dear')?.firstMonthPaymentCents).toBe(2_000_000);
    expect(p.debts.find((d) => d.debtId === 'cheap')?.firstMonthPaymentCents).toBe(0);
  });

  it('snowball attacks the smallest balance first', () => {
    const p = project(
      makeData({
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 8_000_000 })],
        debts: [
          makeDebt({ id: 'cheap', balanceCents: 1_000_000, aprRate: 0.1, minPaymentCents: 0 }),
          makeDebt({ id: 'dear', balanceCents: 5_000_000, aprRate: 0.4, minPaymentCents: 0 }),
        ],
        settings: { debtExtraShare: 1, debtStrategy: 'snowball' },
      }),
    );
    // The small balance is cleared outright and the rest rolls onto the other.
    const cheap = p.debts.find((d) => d.debtId === 'cheap');
    expect(cheap?.monthsToClear).toBe(1);
    expect(p.debts.find((d) => d.debtId === 'dear')?.firstMonthPaymentCents).toBeGreaterThan(0);
  });

  it('sends debt money that the debts cannot use back to the goals', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 100_000_000 })],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 8_000_000 })],
        debts: [makeDebt({ id: 'card', balanceCents: 500_000, aprRate: 0, minPaymentCents: 0 })],
        settings: { debtExtraShare: 1 },
      }),
    );
    // 2_000_000 was aimed at debt but only 500_000 was owed; the rest saves.
    expect(p.months[0]?.debtPaidCents).toBe(500_000);
    expect(p.months[0]?.contributedCents).toBe(1_500_000);
  });
});

describe('expenses that end when a goal lands', () => {
  // The loan-preclosure case: the EMI is an expense, the lump sum to clear the
  // loan is a goal, and once that goal is funded the EMI stops and its money
  // joins everything else.
  const preclosure = () =>
    makeData({
      goals: [
        makeGoal({ id: 'payoff', name: 'Loan closure', targetCents: 4_000_000, priority: 1 }),
        makeGoal({ id: 'later', name: 'Marriage', targetCents: 6_000_000, priority: 2 }),
      ],
      income: [makeIncome({ amountCents: 10_000_000 })],
      expenses: [
        makeExpense({ id: 'living', amountCents: 6_000_000 }),
        makeExpense({ id: 'emi', amountCents: 2_000_000, endsWithGoalId: 'payoff' }),
      ],
    });

  it('counts the expense while the goal is still being saved for', () => {
    const p = project(preclosure());
    // 10M in, 6M living, 2M EMI, so 2M a month is spare to start with.
    expect(p.cashFlow.toGoalsCents).toBe(2_000_000);
    expect(goalById(p, 'payoff').monthsToComplete).toBe(2);
  });

  it('frees the money the month after the goal is funded', () => {
    const p = project(preclosure());
    // Months 1-2 fund the closure at 2M. The EMI still goes out in month 2,
    // the month the goal completes — that payment had already left.
    expect(p.months[1]?.contributedCents).toBe(2_000_000);
    // From month 3 the EMI is gone, so 4M a month goes to the next goal,
    // which needs 6M and therefore lands in month 4.
    expect(p.months[2]?.contributedCents).toBe(4_000_000);
    expect(goalById(p, 'later').monthsToComplete).toBe(4);
  });

  it('reports how much each goal frees up', () => {
    const p = project(preclosure());
    expect(goalById(p, 'payoff').freesMonthlyCents).toBe(2_000_000);
    expect(goalById(p, 'later').freesMonthlyCents).toBe(0);
  });

  it('finishes sooner than the same plan without the link', () => {
    const linked = project(preclosure());
    const unlinked = project(
      makeData({
        goals: preclosure().goals,
        income: preclosure().income,
        expenses: preclosure().expenses.map((e) => ({ ...e, endsWithGoalId: undefined })),
      }),
    );
    expect(unlinked.monthsToAllGoals).toBe(5);
    expect(linked.monthsToAllGoals).toBe(4);
  });

  it('treats a goal funded before the plan starts as already ended', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({ id: 'payoff', targetCents: 4_000_000, savedCents: 4_000_000 }),
          makeGoal({ id: 'later', targetCents: 6_000_000, priority: 2 }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [
          makeExpense({ id: 'living', amountCents: 6_000_000 }),
          makeExpense({ id: 'emi', amountCents: 2_000_000, endsWithGoalId: 'payoff' }),
        ],
      }),
    );
    expect(p.cashFlow.toGoalsCents).toBe(4_000_000);
    expect(goalById(p, 'later').monthsToComplete).toBe(2);
  });

  it('keeps paying an expense tied to an archived goal', () => {
    // Archiving a goal abandons it rather than achieving it, so the expense
    // it was going to end must carry on.
    const p = project(
      makeData({
        goals: [
          makeGoal({ id: 'payoff', targetCents: 4_000_000, archived: true }),
          makeGoal({ id: 'later', targetCents: 6_000_000 }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [
          makeExpense({ id: 'living', amountCents: 6_000_000 }),
          makeExpense({ id: 'emi', amountCents: 2_000_000, endsWithGoalId: 'payoff' }),
        ],
      }),
    );
    expect(p.cashFlow.toGoalsCents).toBe(2_000_000);
    expect(goalById(p, 'later').monthsToComplete).toBe(3);
  });

  it('stops card spending that is tied to a goal too', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({ id: 'payoff', targetCents: 2_000_000, priority: 1 }),
          makeGoal({ id: 'later', targetCents: 90_000_000, priority: 2 }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [
          makeExpense({ id: 'living', amountCents: 6_000_000 }),
          makeExpense({
            id: 'card-sub',
            amountCents: 1_000_000,
            account: 'credit',
            debtId: 'card',
            endsWithGoalId: 'payoff',
          }),
        ],
        debts: [
          makeDebt({ id: 'card', balanceCents: 0, aprRate: 0, minPaymentCents: 1_000_000 }),
        ],
      }),
    );
    // While the subscription is live the card takes 1M a month of minimums.
    expect(p.cashFlow.minDebtPaymentCents).toBe(1_000_000);
    expect(p.months[0]?.debtPaidCents).toBe(1_000_000);
    // Once the goal lands the charge stops, so the card needs nothing.
    const after = p.months[3];
    expect(after?.debtPaidCents).toBe(0);
    expect(after?.debtBalanceCents).toBe(0);
  });

  it('still balances the books when an expense ends mid-plan', () => {
    const p = project(preclosure());
    const startingSaved = sumCents(p.goals.map((g) => g.startingSavedCents));
    const last = p.months[p.months.length - 1];
    expect(last?.goalBalanceCents).toBe(
      startingSaved + p.totalContributedCents + p.totalGrowthEarnedCents,
    );
    for (const m of p.months) {
      expect(m.contributedCents + m.unallocatedCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('debtHint', () => {
  it('tells the three debt states apart', () => {
    const noDebt = project(
      makeData({ income: [makeIncome()], expenses: [makeExpense({ amountCents: 1_000_000 })] }),
    );
    expect(debtHint(noDebt)).toBe('nothing owed');

    // A card that exists but has been paid off is still "nothing owed".
    const settled = project(
      makeData({
        income: [makeIncome()],
        debts: [makeDebt({ balanceCents: 0, minPaymentCents: 0 })],
      }),
    );
    expect(debtHint(settled)).toBe('nothing owed');

    const clears = project(
      makeData({
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 8_000_000 })],
        debts: [makeDebt({ balanceCents: 1_000_000, aprRate: 0, minPaymentCents: 1_000_000 })],
      }),
    );
    expect(debtHint(clears)).toBe(`clear by ${formatMonthKey(monthAfter(1), 'short')}`);

    const stuck = project(
      makeData({
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 9_000_000 })],
        debts: [makeDebt({ balanceCents: 5_000_000, aprRate: 0.4, minPaymentCents: 10_000 })],
      }),
    );
    expect(debtHint(stuck)).toBe('never clears');
  });
});

describe('a month that does not balance', () => {
  it('puts the shortfall on the card and warns about it', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 10_000_000 })],
        income: [makeIncome({ amountCents: 5_000_000 })],
        expenses: [makeExpense({ amountCents: 7_000_000 })],
        debts: [makeDebt({ id: 'card', balanceCents: 0, aprRate: 0.24, minPaymentCents: 0 })],
      }),
    );
    expect(p.cashFlow.surplusCents).toBe(-2_000_000);
    expect(p.months[0]?.debtBalanceCents).toBe(2_000_000);
    expect(p.months[0]?.contributedCents).toBe(0);
    expect(p.warnings.some((w) => w.id === 'deficit')).toBe(true);
    expect(p.feasible).toBe(false);
  });

  it('still refuses to save when there is no card to absorb the gap', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 10_000_000 })],
        income: [makeIncome({ amountCents: 5_000_000 })],
        expenses: [makeExpense({ amountCents: 7_000_000 })],
      }),
    );
    expect(p.months[0]?.contributedCents).toBe(0);
    expect(goalById(p, 'g1').completionMonth).toBeNull();
  });
});

describe('bookkeeping', () => {
  it('accounts for every cent that goes into the goals', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({ id: 'a', targetCents: 20_000_000, savedCents: 500_000, annualReturnRate: 0.06 }),
          makeGoal({ id: 'b', targetCents: 8_000_000, priority: 2, annualReturnRate: 0.03 }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 7_000_000 })],
      }),
    );
    const last = p.months[p.months.length - 1];
    const startingSaved = sumCents(p.goals.map((g) => g.startingSavedCents));
    expect(last?.goalBalanceCents).toBe(
      startingSaved + p.totalContributedCents + p.totalGrowthEarnedCents,
    );
    expect(p.totalContributedCents).toBe(sumCents(p.months.map((m) => m.contributedCents)));
  });

  it('accounts for every cent that goes into the debts', () => {
    const p = project(
      makeData({
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 6_000_000 })],
        debts: [
          makeDebt({ id: 'card', balanceCents: 4_000_000, aprRate: 0.24, minPaymentCents: 200_000 }),
        ],
        settings: { debtExtraShare: 1 },
      }),
    );
    const paid = sumCents(p.months.map((m) => m.debtPaidCents));
    const interest = sumCents(p.months.map((m) => m.debtInterestCents));
    const finalBalance = p.months[p.months.length - 1]?.debtBalanceCents ?? 0;
    expect(paid).toBe(4_000_000 + interest - finalBalance);
    expect(p.totalInterestPaidCents).toBe(interest);
  });

  it('never allocates more than the plan actually has', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({ id: 'a', targetCents: 5_000_000 }),
          makeGoal({ id: 'b', targetCents: 5_000_000, priority: 2 }),
          makeGoal({ id: 'c', targetCents: 5_000_000, priority: 3 }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 6_666_667 })],
      }),
    );
    const budget = p.cashFlow.toGoalsCents;
    for (const m of p.months) {
      expect(m.contributedCents + m.unallocatedCents).toBe(budget);
    }
  });
});

describe('what-if levers', () => {
  const base = () =>
    makeData({
      goals: [makeGoal({ id: 'g1', targetCents: 24_000_000 })],
      income: [makeIncome({ amountCents: 10_000_000 })],
      expenses: [makeExpense({ amountCents: 8_000_000 })],
    });

  it('slows the plan down as the savings factor drops', () => {
    const full = project(base());
    const half = project({ ...base(), settings: { ...base().settings, savingsFactor: 0.5 } });
    expect(goalById(full, 'g1').monthsToComplete).toBe(12);
    expect(goalById(half, 'g1').monthsToComplete).toBe(24);
  });

  it('treats the buffer as money the plan cannot touch', () => {
    const p = project({
      ...base(),
      settings: { ...base().settings, bufferCents: 1_000_000 },
    });
    expect(p.cashFlow.toGoalsCents).toBe(1_000_000);
    expect(goalById(p, 'g1').monthsToComplete).toBe(24);
  });

  it('leaves archived goals out of the plan entirely', () => {
    const p = project(
      makeData({
        goals: [
          makeGoal({ id: 'live', targetCents: 2_000_000 }),
          makeGoal({ id: 'dead', targetCents: 90_000_000, archived: true }),
        ],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 8_000_000 })],
      }),
    );
    expect(p.goals).toHaveLength(1);
    expect(p.monthsToAllGoals).toBe(1);
  });
});

describe('edge cases', () => {
  it('survives a completely empty plan', () => {
    const p = project(makeData());
    expect(p.goals).toEqual([]);
    expect(p.allGoalsCompleteMonth).toBe(TEST_START_MONTH);
    expect(p.warnings.some((w) => w.id === 'no-income')).toBe(true);
    expect(() => project(makeData())).not.toThrow();
  });

  it('handles a zero-value goal without dividing by zero', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 0 })],
        income: [makeIncome()],
      }),
    );
    expect(goalById(p, 'g1').monthsToComplete).toBe(0);
    expect(Number.isFinite(goalById(p, 'g1').progressRatio)).toBe(true);
  });

  it('stops at the horizon instead of running forever', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 1_000_000_000_000 })],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [makeExpense({ amountCents: 9_999_900 })],
      }),
      { horizonMonths: 60 },
    );
    expect(p.months).toHaveLength(60);
    expect(goalById(p, 'g1').completionMonth).toBeNull();
  });

  it('ignores inactive income, expenses and debts', () => {
    const p = project(
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 4_000_000 })],
        income: [makeIncome({ amountCents: 10_000_000 }), makeIncome({ amountCents: 9_000_000, active: false })],
        expenses: [makeExpense({ amountCents: 6_000_000 }), makeExpense({ amountCents: 9_000_000, active: false })],
        debts: [makeDebt({ balanceCents: 9_000_000, active: false })],
      }),
    );
    expect(p.cashFlow.toGoalsCents).toBe(4_000_000);
    expect(p.debts).toHaveLength(0);
  });

  it('agrees with its own headline figures in the first month', () => {
    // The dashboard shows the cash-flow summary while the charts show the
    // simulation. If these two ever drift the app contradicts itself, so the
    // agreement is pinned across a spread of awkward setups.
    const scenarios = [
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 90_000_000 })],
        income: [makeIncome({ amountCents: 9_123_456 })],
        expenses: [makeExpense({ amountCents: 3_210_987 })],
      }),
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 90_000_000 })],
        income: [makeIncome({ amountCents: 10_000_000 })],
        expenses: [
          makeExpense({ amountCents: 4_000_000, account: 'debit' }),
          makeExpense({ id: 'ec', amountCents: 1_500_000, account: 'credit', debtId: 'card' }),
        ],
        debts: [
          makeDebt({ id: 'card', balanceCents: 3_000_000, aprRate: 0.36, minPaymentCents: 400_000 }),
        ],
        settings: { debtExtraShare: 0.4, savingsFactor: 0.8, bufferCents: 250_000 },
      }),
      makeData({
        goals: [makeGoal({ id: 'g1', targetCents: 90_000_000 })],
        income: [makeIncome({ amountCents: 8_000_000 })],
        expenses: [makeExpense({ amountCents: 2_000_000 })],
        debts: [makeDebt({ id: 'card', balanceCents: 50_000, aprRate: 0.2, minPaymentCents: 0 })],
        settings: { debtExtraShare: 1 },
      }),
    ];

    for (const data of scenarios) {
      const p = project(data);
      const first = p.months[0];
      expect(first).toBeDefined();
      expect(p.cashFlow.toGoalsCents).toBe(
        (first?.contributedCents ?? 0) + (first?.unallocatedCents ?? 0),
      );
      expect(p.cashFlow.minDebtPaymentCents + p.cashFlow.extraDebtCents).toBe(
        first?.debtPaidCents ?? 0,
      );
    }
  });

  it('produces the same answer every time it is asked', () => {
    const data = makeData({
      goals: [
        makeGoal({ id: 'a', targetCents: 7_777_777, annualReturnRate: 0.07 }),
        makeGoal({ id: 'b', targetCents: 3_333_333, priority: 2, annualReturnRate: 0.04 }),
      ],
      income: [makeIncome({ amountCents: 9_876_543 })],
      expenses: [makeExpense({ amountCents: 6_543_210 })],
      settings: { allocationStrategy: 'balanced' },
    });
    const a = project(data);
    const b = project(data);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
