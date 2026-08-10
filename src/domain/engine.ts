/**
 * The projection engine.
 *
 * Given income, expenses, credit-card debt and a set of goals, it simulates
 * the plan one month at a time and reports when each goal actually lands.
 *
 * Why a simulation rather than a formula: as soon as goals compete for the
 * same spare cash, the answer stops being closed-form. A card getting paid off
 * frees money; a goal completing frees money; a deadline goal's required
 * payment changes every month as its balance grows. The month loop captures
 * all of that exactly, and stays cheap (a 60-year horizon over a dozen goals
 * is a few thousand iterations).
 *
 * Order of operations inside one month — chosen to match how a real month
 * works, and held constant so the numbers are reproducible:
 *   1. Cards accrue interest and absorb the month's credit-card spending.
 *   2. Minimum payments and cash expenses leave the bank account.
 *   3. Whatever is left is scaled by the savings factor.
 *   4. Extra debt payments come off the top of that.
 *   5. The rest is shared out across goals.
 *   6. Goal balances earn their return, then the month's contribution lands.
 */

import {
  Cents,
  addCents,
  clampCents,
  maxZero,
  roundCents,
  scaleCents,
  splitCents,
  sumCents,
} from './money';
import {
  MonthKey,
  currentMonthKey,
  formatMonthKey,
  monthIndex,
  monthKeyFromIndex,
  monthKeyOf,
} from './dates';
import { MAX_HORIZON_MONTHS, monthlyRate, paymentForTarget } from './finance';
import type {
  AccountKind,
  AllocationStrategy,
  AppData,
  Debt,
  DebtStrategy,
  ExpenseItem,
  Frequency,
  Goal,
  IncomeSource,
  Settings,
} from './types';

export const DEFAULT_HORIZON_MONTHS = 720; // 60 years

/** Deadline months on/after this day still count as a contributing month. */
const DEADLINE_INCLUSIVE_DAY = 28;

// ---------------------------------------------------------------------------
// Frequency normalisation
// ---------------------------------------------------------------------------

const MONTHS_PER_YEAR = 12;
const WEEKS_PER_YEAR = 52;
const FORTNIGHTS_PER_YEAR = 26;

export function toMonthlyCents(amountCents: Cents, frequency: Frequency): Cents {
  switch (frequency) {
    case 'weekly':
      return roundCents((amountCents * WEEKS_PER_YEAR) / MONTHS_PER_YEAR);
    case 'biweekly':
      return roundCents((amountCents * FORTNIGHTS_PER_YEAR) / MONTHS_PER_YEAR);
    case 'monthly':
      return amountCents;
    case 'quarterly':
      return roundCents(amountCents / 3);
    case 'yearly':
      return roundCents(amountCents / MONTHS_PER_YEAR);
    default:
      return amountCents;
  }
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface CashFlowSummary {
  incomeCents: Cents;
  debitExpenseCents: Cents;
  creditExpenseCents: Cents;
  /** Credit spending with nowhere to charge it — treated as cash out. */
  unlinkedCreditExpenseCents: Cents;
  minDebtPaymentCents: Cents;
  bufferCents: Cents;
  /** Income less cash expenses, minimums and buffer. Can be negative. */
  surplusCents: Cents;
  /** Surplus actually earmarked for the plan, after the savings factor. */
  savableCents: Cents;
  /** Slice of savable money aimed at debt above the minimums. */
  extraDebtCents: Cents;
  /** Slice of savable money aimed at goals. */
  toGoalsCents: Cents;
  /** Surplus deliberately left unallocated by the savings factor. */
  lifestyleCents: Cents;
}

export interface MonthSnapshot {
  month: MonthKey;
  index: number;
  goalBalanceCents: Cents;
  debtBalanceCents: Cents;
  contributedCents: Cents;
  debtPaidCents: Cents;
  debtInterestCents: Cents;
  growthCents: Cents;
  /** Money that had nowhere useful to go — every goal already funded. */
  unallocatedCents: Cents;
  /** Per-goal balances, keyed by goal id. */
  perGoalCents: Record<string, Cents>;
}

export interface GoalProjection {
  goalId: string;
  name: string;
  color: string;
  emoji: string;
  targetCents: Cents;
  startingSavedCents: Cents;
  /** Month the goal is fully funded, or null if never within the horizon. */
  completionMonth: MonthKey | null;
  monthsToComplete: number | null;
  /** What this goal is given in the first month of the plan. */
  plannedMonthlyCents: Cents;
  /** What the deadline demands per month right now. 0 when open-ended. */
  requiredMonthlyCents: Cents;
  /** Positive when the plan gives it less than the deadline demands. */
  shortfallMonthlyCents: Cents;
  /** Null when the goal has no deadline. */
  meetsDeadline: boolean | null;
  deadlineMonth: MonthKey | null;
  progressRatio: number;
  /** Months to finish if this were the only goal taking the whole pool. */
  soloMonths: number | null;
  /**
   * Monthly spending that stops once this goal is funded — a loan EMI you are
   * saving to preclose, say. That money returns to the pool from the following
   * month and speeds up everything else.
   */
  freesMonthlyCents: Cents;
  totalContributedCents: Cents;
  totalGrowthCents: Cents;
}

export interface DebtProjection {
  debtId: string;
  name: string;
  startingBalanceCents: Cents;
  clearedMonth: MonthKey | null;
  monthsToClear: number | null;
  totalInterestCents: Cents;
  totalPaidCents: Cents;
  /** True when interest plus new spending outruns the payments. */
  growing: boolean;
  firstMonthPaymentCents: Cents;
}

export type WarningSeverity = 'critical' | 'warning' | 'info';

export interface PlanWarning {
  id: string;
  severity: WarningSeverity;
  title: string;
  detail: string;
}

export interface Projection {
  startMonth: MonthKey;
  horizonMonths: number;
  cashFlow: CashFlowSummary;
  months: MonthSnapshot[];
  goals: GoalProjection[];
  debts: DebtProjection[];
  /** Month the last outstanding goal lands. Null if any goal never does. */
  allGoalsCompleteMonth: MonthKey | null;
  monthsToAllGoals: number | null;
  debtFreeMonth: MonthKey | null;
  totalInterestPaidCents: Cents;
  totalGrowthEarnedCents: Cents;
  totalContributedCents: Cents;
  warnings: PlanWarning[];
  /** Every goal lands inside the horizon and no deadline is missed. */
  feasible: boolean;
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export function activeGoals(goals: readonly Goal[]): Goal[] {
  return goals.filter((g) => !g.archived);
}

export function monthlyIncomeCents(income: readonly IncomeSource[]): Cents {
  return sumCents(income.filter((i) => i.active).map((i) => toMonthlyCents(i.amountCents, i.frequency)));
}

export function monthlyExpenseCents(
  expenses: readonly ExpenseItem[],
  account?: 'debit' | 'credit',
): Cents {
  return sumCents(
    expenses
      .filter((e) => e.active && (account === undefined || e.account === account))
      .map((e) => toMonthlyCents(e.amountCents, e.frequency)),
  );
}

/**
 * One recurring expense, resolved down to what the simulation actually needs:
 * a monthly amount, where it lands, and what (if anything) ends it.
 */
interface ExpenseLine {
  monthlyCents: Cents;
  /** The card it is charged to, or undefined when it leaves cash directly. */
  debtId: string | undefined;
  account: AccountKind;
  endsWithGoalId: string | undefined;
}

export function buildExpenseLines(data: AppData): ExpenseLine[] {
  const revolving = data.debts.filter((d) => d.active && d.revolving);
  const fallbackId = revolving[0]?.id;
  const validCards = new Set(revolving.map((d) => d.id));
  const liveGoals = new Set(activeGoals(data.goals).map((g) => g.id));

  const out: ExpenseLine[] = [];
  for (const e of data.expenses) {
    if (!e.active) continue;
    const monthlyCents = toMonthlyCents(e.amountCents, e.frequency);
    // Card spending with no card to carry it has to come out of cash instead.
    const debtId =
      e.account === 'credit' ? (e.debtId && validCards.has(e.debtId) ? e.debtId : fallbackId) : undefined;
    out.push({
      monthlyCents,
      debtId,
      account: e.account,
      // A link to a goal that is gone or archived would end the expense on a
      // date that never arrives, so it is dropped rather than trusted.
      endsWithGoalId:
        e.endsWithGoalId && liveGoals.has(e.endsWithGoalId) ? e.endsWithGoalId : undefined,
    });
  }
  return out;
}

interface ExpenseTotals {
  /** Leaves the bank account this month. */
  cashCents: Cents;
  /** Lands on a card this month, keyed by card id. */
  byDebt: Map<string, Cents>;
  /** Card spending that had no card and so was counted as cash. */
  unlinkedCents: Cents;
  creditCents: Cents;
  debitCents: Cents;
}

function totalExpenses(lines: readonly ExpenseLine[], ended: ReadonlySet<string>): ExpenseTotals {
  const byDebt = new Map<string, Cents>();
  let cashCents = 0;
  let unlinkedCents = 0;
  let creditCents = 0;
  let debitCents = 0;

  for (const line of lines) {
    if (line.endsWithGoalId && ended.has(line.endsWithGoalId)) continue;
    if (line.account === 'credit') {
      creditCents = addCents(creditCents, line.monthlyCents);
      if (line.debtId) {
        byDebt.set(line.debtId, addCents(byDebt.get(line.debtId) ?? 0, line.monthlyCents));
        continue;
      }
      unlinkedCents = addCents(unlinkedCents, line.monthlyCents);
      cashCents = addCents(cashCents, line.monthlyCents);
      continue;
    }
    debitCents = addCents(debitCents, line.monthlyCents);
    cashCents = addCents(cashCents, line.monthlyCents);
  }

  return { cashCents, byDebt, unlinkedCents, creditCents, debitCents };
}

/**
 * Goals that are already fully funded before the plan even starts — their
 * linked expenses have already stopped.
 */
function alreadyFundedGoalIds(data: AppData): Set<string> {
  return new Set(
    activeGoals(data.goals)
      .filter((g) => g.savedCents >= g.targetCents)
      .map((g) => g.id),
  );
}

export function computeCashFlow(data: AppData): CashFlowSummary {
  const settings = data.settings;
  const incomeCents = monthlyIncomeCents(data.income);

  const lines = buildExpenseLines(data);
  const totals = totalExpenses(lines, alreadyFundedGoalIds(data));
  const debitExpenseCents = totals.debitCents;
  const creditExpenseCents = totals.creditCents;
  const byDebt = totals.byDebt;
  const unlinked = totals.unlinkedCents;

  // Mirror exactly what the simulation does to each card in its first month —
  // interest lands, this month's card spending lands, and only then is the
  // minimum due worked out. Any other definition would make the headline
  // "spare each month" disagree with the projection underneath it.
  let minDebtPaymentCents = 0;
  let debtCapacityCents = 0;
  for (const d of data.debts) {
    if (!d.active) continue;
    const charges = d.revolving ? byDebt.get(d.id) ?? 0 : 0;
    const grossed = addCents(
      maxZero(d.balanceCents),
      roundCents(maxZero(d.balanceCents) * monthlyRate(d.aprRate)),
      charges,
    );
    const due = clampCents(d.minPaymentCents, 0, grossed);
    minDebtPaymentCents = addCents(minDebtPaymentCents, due);
    debtCapacityCents = addCents(debtCapacityCents, maxZero(grossed - due));
  }

  const bufferCents = maxZero(settings.bufferCents);
  const surplusCents =
    incomeCents - debitExpenseCents - unlinked - minDebtPaymentCents - bufferCents;

  const factor = clampFactor(settings.savingsFactor);
  const savableCents = maxZero(scaleCents(maxZero(surplusCents), factor));
  const lifestyleCents = maxZero(surplusCents) - savableCents;

  const debtShare = clamp01(settings.debtExtraShare);
  const wantedExtraDebt = scaleCents(savableCents, debtShare);
  const extraDebtCents = Math.min(wantedExtraDebt, debtCapacityCents);
  const toGoalsCents = maxZero(savableCents - extraDebtCents);

  return {
    incomeCents,
    debitExpenseCents,
    creditExpenseCents,
    unlinkedCreditExpenseCents: unlinked,
    minDebtPaymentCents,
    bufferCents,
    surplusCents,
    savableCents,
    extraDebtCents,
    toGoalsCents,
    lifestyleCents,
  };
}

/**
 * Plain-words summary of the debt side of a plan.
 *
 * "Nothing owed" and "never clears" are genuinely different from a date, and
 * `debtFreeMonth` reports the start month when there was never anything to
 * clear — so the three cases are named here once rather than re-derived, and
 * mis-ordered, on every screen that shows them.
 */
export function debtHint(projection: Projection): string {
  const owed = projection.debts.some((d) => d.startingBalanceCents > 0);
  if (!owed) return 'nothing owed';
  if (projection.debtFreeMonth === null) return 'never clears';
  return `clear by ${formatMonthKey(projection.debtFreeMonth, 'short')}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/** The savings factor may exceed 1 in what-if mode ("save 120% — dip in"). */
function clampFactor(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(value, 0), 2);
}

// ---------------------------------------------------------------------------
// Deadline maths
// ---------------------------------------------------------------------------

/**
 * Contribution opportunities left before a goal's deadline, counted from
 * month `fromIndex`. The deadline month itself only counts when the date sits
 * at the very end of it — otherwise the money has to be ready the month before.
 */
export function periodsUntilDeadline(targetDate: string, fromIndex: number): number {
  const deadlineIdx = monthIndex(monthKeyOf(targetDate));
  const day = Number(targetDate.slice(8, 10));
  const inclusive = Number.isFinite(day) && day >= DEADLINE_INCLUSIVE_DAY ? 1 : 0;
  return deadlineIdx - fromIndex + inclusive;
}

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

interface GoalState {
  goal: Goal;
  rate: number;
  balance: Cents;
  /** Funded before the plan even starts — worth zero months, not one. */
  startedComplete: boolean;
  completedIndex: number | null;
  contributed: Cents;
  growth: Cents;
  firstMonthAllocation: Cents;
  firstMonthRequirement: Cents;
}

/**
 * Shares `pool` across goals for one month.
 *
 * `need[i]` is the most a goal can usefully take this month (its remaining
 * shortfall after growth) — allocating past it would strand money that another
 * goal could use, so every step is capped by it.
 */
function allocateMonth(
  states: readonly GoalState[],
  need: readonly Cents[],
  required: readonly Cents[],
  pool: Cents,
  strategy: AllocationStrategy,
): { allocation: Cents[]; leftover: Cents } {
  const n = states.length;
  const allocation = new Array<Cents>(n).fill(0);
  let remaining = pool;

  const openIndexes: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if ((need[i] ?? 0) > 0) openIndexes.push(i);
  }
  if (remaining <= 0 || openIndexes.length === 0) {
    return { allocation, leftover: maxZero(remaining) };
  }

  const capacity = (i: number): Cents => maxZero((need[i] ?? 0) - (allocation[i] ?? 0));

  const give = (i: number, amount: Cents): void => {
    const give_ = clampCents(amount, 0, Math.min(capacity(i), remaining));
    if (give_ <= 0) return;
    allocation[i] = addCents(allocation[i] ?? 0, give_);
    remaining -= give_;
  };

  const deadlineIndexOf = (i: number): number => {
    const date = states[i]?.goal.targetDate;
    return date ? monthIndex(monthKeyOf(date)) : Number.POSITIVE_INFINITY;
  };
  const priorityOf = (i: number): number => states[i]?.goal.priority ?? 99;

  // 1. Pinned amounts the user set by hand, most important goal first.
  const pinned = openIndexes
    .filter((i) => (states[i]?.goal.manualMonthlyCents ?? 0) > 0)
    .sort((a, b) => priorityOf(a) - priorityOf(b) || deadlineIndexOf(a) - deadlineIndexOf(b));
  for (const i of pinned) {
    if (remaining <= 0) break;
    give(i, states[i]?.goal.manualMonthlyCents ?? 0);
  }

  // 2. Whatever deadlines demand, soonest deadline first.
  const dated = openIndexes
    .filter((i) => (required[i] ?? 0) > 0)
    .sort((a, b) => deadlineIndexOf(a) - deadlineIndexOf(b) || priorityOf(a) - priorityOf(b));
  for (const i of dated) {
    if (remaining <= 0) break;
    give(i, maxZero((required[i] ?? 0) - (allocation[i] ?? 0)));
  }

  // 3. Everything still spare, shared by the chosen strategy.
  if (remaining > 0) {
    if (strategy === 'balanced') {
      // Proportional to priority weight, re-running so that money freed by a
      // goal hitting its cap lands on the others instead of being dropped.
      for (let pass = 0; pass < n + 1 && remaining > 0; pass += 1) {
        const live = openIndexes.filter((i) => capacity(i) > 0);
        if (live.length === 0) break;
        const weights = live.map((i) => 1 / Math.max(1, priorityOf(i)));
        const shares = splitCents(remaining, weights);
        let moved = 0;
        for (let k = 0; k < live.length; k += 1) {
          const idx = live[k];
          if (idx === undefined) continue;
          const before = remaining;
          give(idx, shares[k] ?? 0);
          moved += before - remaining;
        }
        if (moved === 0) break;
      }
    } else {
      const order = openIndexes.slice();
      if (strategy === 'fastestFirst') {
        // Smallest remaining gap first: goals close the line fastest, which is
        // what keeps people going.
        order.sort(
          (a, b) =>
            capacity(a) - capacity(b) ||
            priorityOf(a) - priorityOf(b) ||
            deadlineIndexOf(a) - deadlineIndexOf(b),
        );
      } else {
        order.sort(
          (a, b) =>
            priorityOf(a) - priorityOf(b) ||
            deadlineIndexOf(a) - deadlineIndexOf(b) ||
            (states[a]?.goal.createdAt ?? '').localeCompare(states[b]?.goal.createdAt ?? ''),
        );
      }
      for (const i of order) {
        if (remaining <= 0) break;
        give(i, capacity(i));
      }
    }
  }

  return { allocation, leftover: maxZero(remaining) };
}

// ---------------------------------------------------------------------------
// Debt payments
// ---------------------------------------------------------------------------

interface DebtState {
  debt: Debt;
  balance: Cents;
  charges: Cents;
  rate: number;
  clearedIndex: number | null;
  interestPaid: Cents;
  totalPaid: Cents;
  firstMonthPayment: Cents;
  everGrew: boolean;
}

function applyExtraToDebts(
  states: readonly DebtState[],
  pool: Cents,
  strategy: DebtStrategy,
): { payments: Cents[]; leftover: Cents } {
  const payments = new Array<Cents>(states.length).fill(0);
  let remaining = pool;
  if (remaining <= 0) return { payments, leftover: 0 };

  const live: number[] = [];
  for (let i = 0; i < states.length; i += 1) {
    const s = states[i];
    if (s && s.balance > 0) live.push(i);
  }
  if (live.length === 0) return { payments, leftover: remaining };

  const capacity = (i: number): Cents =>
    maxZero((states[i]?.balance ?? 0) - (payments[i] ?? 0));

  const give = (i: number, amount: Cents): void => {
    const value = clampCents(amount, 0, Math.min(capacity(i), remaining));
    if (value <= 0) return;
    payments[i] = addCents(payments[i] ?? 0, value);
    remaining -= value;
  };

  if (strategy === 'proportional') {
    for (let pass = 0; pass < live.length + 1 && remaining > 0; pass += 1) {
      const open = live.filter((i) => capacity(i) > 0);
      if (open.length === 0) break;
      const shares = splitCents(remaining, open.map((i) => states[i]?.balance ?? 0));
      let moved = 0;
      for (let k = 0; k < open.length; k += 1) {
        const idx = open[k];
        if (idx === undefined) continue;
        const before = remaining;
        give(idx, shares[k] ?? 0);
        moved += before - remaining;
      }
      if (moved === 0) break;
    }
  } else {
    const order = live.slice().sort((a, b) => {
      const da = states[a];
      const db = states[b];
      if (!da || !db) return 0;
      // Avalanche kills the most expensive interest first; snowball kills the
      // smallest balance first for the psychological win.
      return strategy === 'avalanche'
        ? db.debt.aprRate - da.debt.aprRate || da.balance - db.balance
        : da.balance - db.balance || db.debt.aprRate - da.debt.aprRate;
    });
    for (const i of order) {
      if (remaining <= 0) break;
      give(i, capacity(i));
    }
  }

  return { payments, leftover: maxZero(remaining) };
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

export interface ProjectOptions {
  horizonMonths?: number;
  startMonth?: MonthKey;
}

export function project(data: AppData, options: ProjectOptions = {}): Projection {
  const settings: Settings = data.settings;
  const startMonth = options.startMonth ?? settings.startMonth ?? currentMonthKey();
  const startIndex = monthIndex(startMonth);
  const horizon = Math.min(
    Math.max(1, options.horizonMonths ?? DEFAULT_HORIZON_MONTHS),
    MAX_HORIZON_MONTHS,
  );

  const cashFlow = computeCashFlow(data);

  // Expenses are re-totalled whenever a goal that ends one lands, so the money
  // an EMI was eating becomes spare from the following month.
  const expenseLines = buildExpenseLines(data);
  const endedGoalIds = alreadyFundedGoalIds(data);
  let expenses = totalExpenses(expenseLines, endedGoalIds);

  const goalStates: GoalState[] = activeGoals(data.goals)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
    .map((goal) => ({
      goal,
      rate: monthlyRate(goal.annualReturnRate),
      balance: clampCents(goal.savedCents, 0, Number.MAX_SAFE_INTEGER),
      startedComplete: goal.savedCents >= goal.targetCents,
      completedIndex: goal.savedCents >= goal.targetCents ? startIndex : null,
      contributed: 0,
      growth: 0,
      firstMonthAllocation: 0,
      firstMonthRequirement: 0,
    }));

  const debtStates: DebtState[] = data.debts
    .filter((d) => d.active)
    .map((debt) => ({
      debt,
      balance: maxZero(debt.balanceCents),
      charges: debt.revolving ? expenses.byDebt.get(debt.id) ?? 0 : 0,
      rate: monthlyRate(debt.aprRate),
      clearedIndex: debt.balanceCents <= 0 ? startIndex : null,
      interestPaid: 0,
      totalPaid: 0,
      firstMonthPayment: 0,
      everGrew: false,
    }));

  const primaryCard = debtStates.findIndex((d) => d.debt.revolving);

  const months: MonthSnapshot[] = [];
  const factor = clampFactor(settings.savingsFactor);
  const debtShare = clamp01(settings.debtExtraShare);
  const bufferCents = maxZero(settings.bufferCents);

  const incomeCents = cashFlow.incomeCents;

  /**
   * Applies any goal that finished in an earlier month: its linked expenses
   * stop, and the money they were taking joins the pool from here on.
   * Deliberately a month behind — the month a goal completes, that month's
   * payment has already gone out.
   */
  const releaseFinishedExpenses = (index: number): void => {
    let changed = false;
    for (const g of goalStates) {
      if (g.completedIndex === null || endedGoalIds.has(g.goal.id)) continue;
      if (g.startedComplete || g.completedIndex < index) {
        endedGoalIds.add(g.goal.id);
        changed = true;
      }
    }
    if (!changed) return;
    expenses = totalExpenses(expenseLines, endedGoalIds);
    for (const d of debtStates) {
      d.charges = d.debt.revolving ? expenses.byDebt.get(d.debt.id) ?? 0 : 0;
    }
  };

  let totalInterest = 0;
  let totalGrowth = 0;
  let totalContributed = 0;
  let unfundedDeficit = 0;
  let sawDeficit = false;

  const allGoalsDone = (): boolean => goalStates.every((g) => g.completedIndex !== null);

  for (let step = 0; step < horizon; step += 1) {
    const index = startIndex + step;
    releaseFinishedExpenses(index);

    // --- 1. Cards accrue interest and absorb this month's card spending -----
    let monthInterest = 0;
    for (const d of debtStates) {
      if (d.balance <= 0 && d.charges <= 0) continue;
      const interest = roundCents(d.balance * d.rate);
      const before = d.balance;
      d.balance = addCents(d.balance, interest, d.charges);
      d.interestPaid = addCents(d.interestPaid, interest);
      monthInterest = addCents(monthInterest, interest);
      if (d.balance > before && before > 0) d.everGrew = true;
    }
    totalInterest = addCents(totalInterest, monthInterest);

    // --- 2. Minimums and cash expenses leave the account -------------------
    let monthDebtPaid = 0;
    let minimumsDue = 0;
    const minimums = debtStates.map((d) => {
      const due = clampCents(d.debt.minPaymentCents, 0, d.balance);
      minimumsDue = addCents(minimumsDue, due);
      return due;
    });

    let cash = incomeCents - expenses.cashCents - minimumsDue - bufferCents;

    if (cash < 0) {
      // The month does not balance. Real people put the gap on a card; if
      // there is no card, it is simply unfunded and the plan is broken.
      sawDeficit = true;
      const gap = -cash;
      const card = primaryCard >= 0 ? debtStates[primaryCard] : undefined;
      if (card) {
        card.balance = addCents(card.balance, gap);
      } else {
        unfundedDeficit = addCents(unfundedDeficit, gap);
      }
      cash = 0;
    }

    for (let i = 0; i < debtStates.length; i += 1) {
      const d = debtStates[i];
      const due = minimums[i] ?? 0;
      if (!d || due <= 0) continue;
      d.balance = maxZero(d.balance - due);
      d.totalPaid = addCents(d.totalPaid, due);
      monthDebtPaid = addCents(monthDebtPaid, due);
    }

    // --- 3 & 4. Savings factor, then extra debt payments -------------------
    const savable = maxZero(scaleCents(cash, factor));
    const wantedExtra = scaleCents(savable, debtShare);
    const { payments: extraPayments, leftover: unusedExtra } = applyExtraToDebts(
      debtStates,
      wantedExtra,
      settings.debtStrategy,
    );

    for (let i = 0; i < debtStates.length; i += 1) {
      const d = debtStates[i];
      const pay = extraPayments[i] ?? 0;
      if (!d || pay <= 0) continue;
      d.balance = maxZero(d.balance - pay);
      d.totalPaid = addCents(d.totalPaid, pay);
      monthDebtPaid = addCents(monthDebtPaid, pay);
    }

    for (const d of debtStates) {
      // "Cleared" means the balance actually reached zero at a month end. A
      // card that gets paid in full each month counts, even though next
      // month's spending lands on it again.
      if (d.clearedIndex === null && d.balance <= 0) d.clearedIndex = index;
      if (step === 0) d.firstMonthPayment = d.totalPaid;
    }

    // Money earmarked for debt that the debts could not absorb still belongs
    // to the plan, so it rolls into goals rather than evaporating.
    const toGoals = maxZero(savable - (wantedExtra - unusedExtra));

    // --- 5 & 6. Goal requirements, growth, then contributions --------------
    const required = goalStates.map((g) => {
      if (g.completedIndex !== null) return 0;
      if (!g.goal.targetDate) return 0;
      const periods = periodsUntilDeadline(g.goal.targetDate, index);
      return paymentForTarget(g.goal.targetCents, g.balance, g.rate, periods);
    });

    let monthGrowth = 0;
    const need = goalStates.map((g) => {
      if (g.completedIndex !== null) return 0;
      const growth = roundCents(g.balance * g.rate);
      g.balance = addCents(g.balance, growth);
      g.growth = addCents(g.growth, growth);
      monthGrowth = addCents(monthGrowth, growth);
      return maxZero(g.goal.targetCents - g.balance);
    });
    totalGrowth = addCents(totalGrowth, monthGrowth);

    const { allocation, leftover } = allocateMonth(
      goalStates,
      need,
      required,
      toGoals,
      settings.allocationStrategy,
    );

    let monthContributed = 0;
    for (let i = 0; i < goalStates.length; i += 1) {
      const g = goalStates[i];
      if (!g) continue;
      if (step === 0) {
        g.firstMonthAllocation = allocation[i] ?? 0;
        g.firstMonthRequirement = required[i] ?? 0;
      }
      const amount = allocation[i] ?? 0;
      if (amount > 0) {
        g.balance = addCents(g.balance, amount);
        g.contributed = addCents(g.contributed, amount);
        monthContributed = addCents(monthContributed, amount);
      }
      if (g.completedIndex === null && g.balance >= g.goal.targetCents) {
        g.completedIndex = index;
      }
    }
    totalContributed = addCents(totalContributed, monthContributed);

    const perGoalCents: Record<string, Cents> = {};
    for (const g of goalStates) perGoalCents[g.goal.id] = g.balance;

    months.push({
      month: monthKeyFromIndex(index),
      index,
      goalBalanceCents: sumCents(goalStates.map((g) => g.balance)),
      debtBalanceCents: sumCents(debtStates.map((d) => d.balance)),
      contributedCents: monthContributed,
      debtPaidCents: monthDebtPaid,
      debtInterestCents: monthInterest,
      growthCents: monthGrowth,
      unallocatedCents: leftover,
      perGoalCents,
    });

    // Stop once everything the user is tracking has landed. Keep a couple of
    // trailing months so charts do not end abruptly on the finish line.
    if (allGoalsDone() && debtStates.every((d) => d.balance <= 0)) break;
  }

  // -------------------------------------------------------------------------
  // Assemble results
  // -------------------------------------------------------------------------

  const goalResults: GoalProjection[] = goalStates.map((g) => {
    const deadlineMonth = g.goal.targetDate ? monthKeyOf(g.goal.targetDate) : null;
    const completionMonth =
      g.completedIndex === null ? null : monthKeyFromIndex(g.completedIndex);
    const monthsToComplete =
      g.completedIndex === null
        ? null
        : g.startedComplete
          ? 0
          : Math.max(0, g.completedIndex - startIndex + 1);

    const meetsDeadline =
      g.goal.targetDate === undefined
        ? null
        : g.completedIndex !== null &&
          g.completedIndex <= monthIndex(monthKeyOf(g.goal.targetDate));

    const soloMonths = soloMonthsFor(g, cashFlow.toGoalsCents, horizon);
    const progressRatio =
      g.goal.targetCents > 0
        ? clamp01(g.goal.savedCents / g.goal.targetCents)
        : g.goal.savedCents > 0
          ? 1
          : 0;

    return {
      goalId: g.goal.id,
      name: g.goal.name,
      color: g.goal.color,
      emoji: g.goal.emoji,
      targetCents: g.goal.targetCents,
      startingSavedCents: g.goal.savedCents,
      completionMonth,
      monthsToComplete,
      plannedMonthlyCents: g.firstMonthAllocation,
      requiredMonthlyCents: g.firstMonthRequirement,
      shortfallMonthlyCents: maxZero(g.firstMonthRequirement - g.firstMonthAllocation),
      meetsDeadline,
      deadlineMonth,
      progressRatio,
      soloMonths,
      freesMonthlyCents: sumCents(
        expenseLines
          .filter((line) => line.endsWithGoalId === g.goal.id)
          .map((line) => line.monthlyCents),
      ),
      totalContributedCents: g.contributed,
      totalGrowthCents: g.growth,
    };
  });

  const debtResults: DebtProjection[] = debtStates.map((d) => ({
    debtId: d.debt.id,
    name: d.debt.name,
    startingBalanceCents: d.debt.balanceCents,
    clearedMonth: d.clearedIndex === null ? null : monthKeyFromIndex(d.clearedIndex),
    monthsToClear:
      d.clearedIndex === null ? null : Math.max(0, d.clearedIndex - startIndex + 1),
    totalInterestCents: d.interestPaid,
    totalPaidCents: d.totalPaid,
    growing: d.clearedIndex === null && d.balance > 0,
    firstMonthPaymentCents: d.firstMonthPayment,
  }));

  const completionIndexes = goalStates.map((g) => g.completedIndex);
  const anyNever = completionIndexes.some((i) => i === null);
  const allGoalsCompleteMonth =
    goalStates.length === 0
      ? startMonth
      : anyNever
        ? null
        : monthKeyFromIndex(Math.max(...completionIndexes.map((i) => i ?? 0)));
  const monthsToAllGoals =
    allGoalsCompleteMonth === null
      ? null
      : Math.max(0, monthIndex(allGoalsCompleteMonth) - startIndex + 1);

  const debtClearIndexes = debtStates
    .filter((d) => d.debt.balanceCents > 0)
    .map((d) => d.clearedIndex);
  const debtFreeMonth =
    debtClearIndexes.length === 0
      ? startMonth
      : debtClearIndexes.some((i) => i === null)
        ? null
        : monthKeyFromIndex(Math.max(...debtClearIndexes.map((i) => i ?? 0)));

  const warnings = buildWarnings({
    data,
    cashFlow,
    goalResults,
    debtResults,
    sawDeficit,
    unfundedDeficit,
    anyNever,
  });

  const feasible =
    !anyNever && goalResults.every((g) => g.meetsDeadline !== false) && cashFlow.surplusCents > 0;

  return {
    startMonth,
    horizonMonths: horizon,
    cashFlow,
    months,
    goals: goalResults,
    debts: debtResults,
    allGoalsCompleteMonth,
    monthsToAllGoals,
    debtFreeMonth,
    totalInterestPaidCents: totalInterest,
    totalGrowthEarnedCents: totalGrowth,
    totalContributedCents: totalContributed,
    warnings,
    feasible,
  };
}

/** "If this were your only goal" — the whole goal pool aimed at one target. */
function soloMonthsFor(state: GoalState, pool: Cents, horizon: number): number | null {
  const goal = state.goal;
  if (goal.savedCents >= goal.targetCents) return 0;
  let balance = goal.savedCents;
  for (let m = 1; m <= horizon; m += 1) {
    balance = addCents(balance, roundCents(balance * state.rate), pool);
    if (balance >= goal.targetCents) return m;
    if (pool <= 0 && state.rate <= 0) return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

function buildWarnings(input: {
  data: AppData;
  cashFlow: CashFlowSummary;
  goalResults: GoalProjection[];
  debtResults: DebtProjection[];
  sawDeficit: boolean;
  unfundedDeficit: Cents;
  anyNever: boolean;
}): PlanWarning[] {
  const { data, cashFlow, goalResults, debtResults, sawDeficit, anyNever } = input;
  const out: PlanWarning[] = [];

  if (cashFlow.incomeCents <= 0) {
    out.push({
      id: 'no-income',
      severity: 'critical',
      title: 'No income added yet',
      detail: 'Add what you earn each month so the plan has something to work with.',
    });
  } else if (cashFlow.surplusCents < 0) {
    out.push({
      id: 'deficit',
      severity: 'critical',
      title: 'You are spending more than you earn',
      detail:
        'Cash expenses, minimum repayments and your buffer come to more than your income. ' +
        'The shortfall lands on your card every month, so nothing can be saved until this is closed.',
    });
  } else if (cashFlow.savableCents <= 0) {
    out.push({
      id: 'nothing-to-save',
      severity: 'warning',
      title: 'Nothing left to save',
      detail:
        'Income covers your outgoings but leaves nothing spare. Trim an expense or lower your ' +
        'buffer to get the plan moving.',
    });
  }

  if (sawDeficit && cashFlow.surplusCents >= 0) {
    out.push({
      id: 'deficit-later',
      severity: 'warning',
      title: 'A future month does not balance',
      detail: 'Rising card interest pushes a later month into deficit.',
    });
  }

  if (cashFlow.unlinkedCreditExpenseCents > 0) {
    out.push({
      id: 'unlinked-credit',
      severity: 'info',
      title: 'Card spending is not linked to a card',
      detail:
        'Some expenses are marked as credit but there is no card to charge them to, so they are ' +
        'counted as cash spending. Add the card under Money to model its interest.',
    });
  }

  for (const d of debtResults) {
    if (d.growing) {
      out.push({
        id: `debt-growing-${d.debtId}`,
        severity: 'critical',
        title: `${d.name} never gets paid off`,
        detail:
          'Interest plus new spending on this card outruns what you pay into it. Raise the ' +
          'repayment or move spending off the card.',
      });
    }
  }

  const missed = goalResults.filter((g) => g.meetsDeadline === false);
  for (const g of missed) {
    out.push({
      id: `deadline-${g.goalId}`,
      severity: 'warning',
      title: `${g.name} misses its target date`,
      detail:
        g.completionMonth === null
          ? 'On the current plan this goal never gets funded.'
          : `On the current plan it lands later than you asked for.`,
    });
  }

  if (anyNever && cashFlow.savableCents > 0) {
    out.push({
      id: 'goal-never',
      severity: 'warning',
      title: 'Some goals never complete',
      detail:
        'The money going into goals is not enough to reach every target. Raise your savings, ' +
        'archive a goal, or push a target date out.',
    });
  }

  const worstApr = Math.max(0, ...data.debts.filter((d) => d.active).map((d) => d.aprRate));
  const bestReturn = Math.max(
    0,
    ...activeGoals(data.goals).map((g) => g.annualReturnRate),
  );
  if (worstApr > bestReturn && worstApr > 0 && data.settings.debtExtraShare < 1) {
    const liveDebt = debtResults.some((d) => d.clearedMonth === null || d.startingBalanceCents > 0);
    if (liveDebt) {
      out.push({
        id: 'apr-vs-return',
        severity: 'info',
        title: 'Your debt costs more than your savings earn',
        detail:
          `Debt at ${(worstApr * 100).toFixed(1)}% outpaces a ${(bestReturn * 100).toFixed(1)}% ` +
          'return. Sending more spare cash at the debt first gets you to your goals sooner.',
      });
    }
  }

  const totalRequired = sumCents(goalResults.map((g) => g.requiredMonthlyCents));
  if (totalRequired > cashFlow.toGoalsCents && totalRequired > 0) {
    out.push({
      id: 'over-committed',
      severity: 'warning',
      title: 'Your target dates need more than you have',
      detail:
        'Together your dated goals ask for more each month than the plan can give them. ' +
        'The soonest deadlines are funded first.',
    });
  }

  const severityRank: Record<WarningSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}
