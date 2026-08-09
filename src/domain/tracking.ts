/**
 * Everything derived from what the user has actually logged, as opposed to
 * what the plan says should happen: real contributions, real spending,
 * streaks, and the milestones that fall out of both.
 *
 * A deliberate honesty rule runs through this file: nothing is counted before
 * the user's first log. An empty history is empty, not a perfect record.
 */

import { Cents, addCents, roundCents, sumCents } from './money';
import {
  ISODate,
  MonthKey,
  addMonths,
  currentMonthKey,
  daysInMonth,
  monthIndex,
  monthKeyOf,
  pad2,
  todayISO,
} from './dates';
import type { AppData, Contribution, SpendLog } from './types';

export interface MonthProgress {
  month: MonthKey;
  plannedCents: Cents;
  actualCents: Cents;
  /** actual / planned, capped at 2 so one huge month cannot skew a chart. */
  ratio: number;
  met: boolean;
  contributions: number;
}

export interface StreakSummary {
  /** Consecutive met months ending at the most recent complete month. */
  current: number;
  best: number;
  /** Months met out of months tracked. */
  metCount: number;
  trackedCount: number;
  months: MonthProgress[];
}

export interface DaySpend {
  date: ISODate;
  spentCents: Cents;
  /** True when the day had no logged spending at all. */
  noSpend: boolean;
  /** True when the day came in at or under the daily allowance. */
  underBudget: boolean;
}

export interface SpendSummary {
  month: MonthKey;
  totalCents: Cents;
  budgetCents: Cents;
  dailyAllowanceCents: Cents;
  byCategory: { category: string; spentCents: Cents; budgetCents: Cents }[];
  days: DaySpend[];
  noSpendStreak: number;
  bestNoSpendStreak: number;
  underBudgetDays: number;
  trackedDays: number;
}

export interface Milestone {
  id: string;
  title: string;
  detail: string;
  emoji: string;
  achieved: boolean;
  /** 0–1 for milestones that are part-way done. */
  progress: number;
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

export function contributionsByMonth(
  contributions: readonly Contribution[],
): Map<MonthKey, Contribution[]> {
  const map = new Map<MonthKey, Contribution[]>();
  for (const c of contributions) {
    const key = monthKeyOf(c.date);
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  }
  return map;
}

export function contributedTotalForGoal(
  contributions: readonly Contribution[],
  goalId: string,
): Cents {
  return sumCents(contributions.filter((c) => c.goalId === goalId).map((c) => c.amountCents));
}

/**
 * Month-by-month record of planned versus actual saving.
 *
 * `plannedCents` is today's plan applied backwards — the app does not keep a
 * history of past plans, so this is "would this month have hit the target I am
 * working to now". Good enough to build a streak on, and stated plainly in the
 * UI so nobody reads more into it.
 */
export function buildMonthProgress(
  data: AppData,
  plannedMonthlyCents: Cents,
  now: Date = new Date(),
): MonthProgress[] {
  const byMonth = contributionsByMonth(data.contributions);
  if (byMonth.size === 0) return [];

  const keys = [...byMonth.keys()].sort();
  const firstKey = keys[0];
  if (!firstKey) return [];

  const start = monthIndex(firstKey);
  const end = monthIndex(currentMonthKey(now));
  const out: MonthProgress[] = [];

  for (let i = start; i <= end; i += 1) {
    const month = addMonths(firstKey, i - start);
    const items = byMonth.get(month) ?? [];
    const actualCents = sumCents(items.map((c) => c.amountCents));
    const ratio =
      plannedMonthlyCents > 0 ? Math.min(actualCents / plannedMonthlyCents, 2) : actualCents > 0 ? 1 : 0;
    out.push({
      month,
      plannedCents: plannedMonthlyCents,
      actualCents,
      ratio,
      met: plannedMonthlyCents > 0 ? actualCents >= plannedMonthlyCents : actualCents > 0,
      contributions: items.length,
    });
  }
  return out;
}

/**
 * Streaks count complete months only. The month in progress is shown but never
 * breaks a streak — you have not failed a month you are still living in.
 */
export function buildStreaks(months: readonly MonthProgress[], now: Date = new Date()): StreakSummary {
  const thisMonth = currentMonthKey(now);
  const complete = months.filter((m) => m.month < thisMonth);

  let best = 0;
  let running = 0;
  for (const m of complete) {
    if (m.met) {
      running += 1;
      if (running > best) best = running;
    } else {
      running = 0;
    }
  }

  let current = 0;
  for (let i = complete.length - 1; i >= 0; i -= 1) {
    if (complete[i]?.met) current += 1;
    else break;
  }

  // A met month-in-progress extends the live streak without being able to end it.
  const inProgress = months.find((m) => m.month === thisMonth);
  if (inProgress?.met) {
    current += 1;
    if (current > best) best = current;
  }

  return {
    current,
    best,
    metCount: complete.filter((m) => m.met).length,
    trackedCount: complete.length,
    months: [...months],
  };
}

// ---------------------------------------------------------------------------
// Spending
// ---------------------------------------------------------------------------

export function spendInMonth(logs: readonly SpendLog[], month: MonthKey): SpendLog[] {
  return logs.filter((l) => monthKeyOf(l.date) === month);
}

/**
 * Budget-versus-actual for one month, plus the day grid the heatmap and the
 * no-spend streak are built from.
 */
export function buildSpendSummary(
  data: AppData,
  month: MonthKey,
  monthlyBudgetCents: Cents,
  categoryBudgets: Map<string, Cents>,
  now: Date = new Date(),
): SpendSummary {
  const logs = spendInMonth(data.spendLogs, month);
  const totalCents = sumCents(logs.map((l) => l.amountCents));

  const year = Number(month.slice(0, 4));
  const monthNo = Number(month.slice(5, 7));
  const totalDays = daysInMonth(year, monthNo);

  const today = todayISO(now);
  const isCurrentMonth = month === currentMonthKey(now);
  const lastDay = isCurrentMonth ? Math.min(Number(today.slice(8, 10)), totalDays) : totalDays;

  const dailyAllowanceCents =
    monthlyBudgetCents > 0 ? roundCents(monthlyBudgetCents / totalDays) : 0;

  const perDay = new Map<ISODate, Cents>();
  for (const l of logs) perDay.set(l.date, addCents(perDay.get(l.date) ?? 0, l.amountCents));

  // Only days from the user's first-ever log onwards are judged — before that
  // there is no data, and "no data" is not "no spending".
  const firstLog = data.spendLogs.reduce<ISODate | null>(
    (min, l) => (min === null || l.date < min ? l.date : min),
    null,
  );

  const days: DaySpend[] = [];
  // With nothing logged at all there is no record to judge — an empty month
  // must not read as a flawless one.
  for (let d = 1; firstLog !== null && d <= lastDay; d += 1) {
    const date = `${month}-${pad2(d)}`;
    if (date < firstLog) continue;
    const spentCents = perDay.get(date) ?? 0;
    days.push({
      date,
      spentCents,
      noSpend: spentCents === 0,
      underBudget: dailyAllowanceCents > 0 ? spentCents <= dailyAllowanceCents : spentCents === 0,
    });
  }

  let bestNoSpendStreak = 0;
  let run = 0;
  for (const d of days) {
    if (d.noSpend) {
      run += 1;
      if (run > bestNoSpendStreak) bestNoSpendStreak = run;
    } else {
      run = 0;
    }
  }

  let noSpendStreak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    if (days[i]?.noSpend) noSpendStreak += 1;
    else break;
  }

  const categories = new Set<string>([
    ...logs.map((l) => l.category),
    ...categoryBudgets.keys(),
  ]);
  const byCategory = [...categories]
    .map((category) => ({
      category,
      spentCents: sumCents(logs.filter((l) => l.category === category).map((l) => l.amountCents)),
      budgetCents: categoryBudgets.get(category) ?? 0,
    }))
    .sort((a, b) => b.spentCents - a.spentCents || a.category.localeCompare(b.category));

  return {
    month,
    totalCents,
    budgetCents: monthlyBudgetCents,
    dailyAllowanceCents,
    byCategory,
    days,
    noSpendStreak,
    bestNoSpendStreak,
    underBudgetDays: days.filter((d) => d.underBudget).length,
    trackedDays: days.length,
  };
}

/** Category budgets taken from the planned expenses. */
export function categoryBudgetsFrom(data: AppData): Map<string, Cents> {
  const map = new Map<string, Cents>();
  for (const e of data.expenses) {
    if (!e.active) continue;
    const monthly =
      e.frequency === 'monthly'
        ? e.amountCents
        : e.frequency === 'weekly'
          ? roundCents((e.amountCents * 52) / 12)
          : e.frequency === 'biweekly'
            ? roundCents((e.amountCents * 26) / 12)
            : e.frequency === 'quarterly'
              ? roundCents(e.amountCents / 3)
              : roundCents(e.amountCents / 12);
    map.set(e.category, addCents(map.get(e.category) ?? 0, monthly));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export function buildMilestones(
  data: AppData,
  streaks: StreakSummary,
  spend: SpendSummary,
  totalProgressRatio: number,
  debtFree: boolean,
): Milestone[] {
  const ratio = (value: number): number =>
    Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;

  const loggedDays = new Set(data.spendLogs.map((l) => l.date)).size;
  const goalsDone = data.goals.filter((g) => !g.archived && g.savedCents >= g.targetCents).length;

  const list: Milestone[] = [
    {
      id: 'first-contribution',
      emoji: '🌱',
      title: 'First deposit',
      detail: 'Log your first contribution to a goal.',
      achieved: data.contributions.length > 0,
      progress: ratio(data.contributions.length > 0 ? 1 : 0),
    },
    {
      id: 'quarter-way',
      emoji: '🧭',
      title: 'A quarter of the way',
      detail: 'Reach 25% across all of your goals combined.',
      achieved: totalProgressRatio >= 0.25,
      progress: ratio(Math.min(totalProgressRatio / 0.25, 1)),
    },
    {
      id: 'half-way',
      emoji: '⛰️',
      title: 'Halfway there',
      detail: 'Reach 50% across all of your goals combined.',
      achieved: totalProgressRatio >= 0.5,
      progress: ratio(Math.min(totalProgressRatio / 0.5, 1)),
    },
    {
      id: 'three-quarters',
      emoji: '🚀',
      title: 'Three quarters',
      detail: 'Reach 75% across all of your goals combined.',
      achieved: totalProgressRatio >= 0.75,
      progress: ratio(Math.min(totalProgressRatio / 0.75, 1)),
    },
    {
      id: 'streak-3',
      emoji: '🔥',
      title: 'Three months running',
      detail: 'Hit your monthly savings target three months in a row.',
      achieved: streaks.best >= 3,
      progress: ratio(Math.min(streaks.best / 3, 1)),
    },
    {
      id: 'streak-6',
      emoji: '💫',
      title: 'Half a year of habit',
      detail: 'Hit your monthly savings target six months in a row.',
      achieved: streaks.best >= 6,
      progress: ratio(Math.min(streaks.best / 6, 1)),
    },
    {
      id: 'streak-12',
      emoji: '👑',
      title: 'A full year',
      detail: 'Hit your monthly savings target twelve months in a row.',
      achieved: streaks.best >= 12,
      progress: ratio(Math.min(streaks.best / 12, 1)),
    },
    {
      id: 'no-spend-5',
      emoji: '🧘',
      title: 'Five quiet days',
      detail: 'Go five days in a row without logging any spending.',
      achieved: spend.bestNoSpendStreak >= 5,
      progress: ratio(Math.min(spend.bestNoSpendStreak / 5, 1)),
    },
    {
      id: 'logger',
      emoji: '📓',
      title: 'Kept the books',
      detail: 'Log spending on 30 separate days.',
      achieved: loggedDays >= 30,
      progress: ratio(Math.min(loggedDays / 30, 1)),
    },
    {
      id: 'debt-free',
      emoji: '🕊️',
      title: 'Debt free',
      detail: 'Clear every balance you owe.',
      achieved: debtFree,
      progress: ratio(debtFree ? 1 : 0),
    },
    {
      id: 'first-goal',
      emoji: '🏆',
      title: 'First goal reached',
      detail: 'Fully fund one of your goals.',
      achieved: goalsDone >= 1,
      progress: ratio(goalsDone >= 1 ? 1 : totalProgressRatio),
    },
    {
      id: 'all-goals',
      emoji: '🎉',
      title: 'Every goal reached',
      detail: 'Fully fund every goal you are tracking.',
      achieved:
        data.goals.filter((g) => !g.archived).length > 0 &&
        goalsDone === data.goals.filter((g) => !g.archived).length,
      progress: ratio(totalProgressRatio),
    },
  ];

  return list;
}
