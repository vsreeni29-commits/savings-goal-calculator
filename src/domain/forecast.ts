/**
 * The forward view.
 *
 * The projection already simulates every month; this turns that into the shape
 * a person actually wants to read: how much is going into goals at each point
 * in time, what changes when a goal lands, and what the years add up to.
 *
 * The idea it exists to make visible: when a goal completes, two different
 * things happen to your money, and they are easy to confuse.
 *
 *   1. Any spending tied to that goal stops — a precleared loan's EMI. That is
 *      genuinely new money, and the monthly pool grows by it.
 *   2. Whatever the goal was absorbing each month is no longer earmarked. That
 *      is *not* new money — it was already in the pool — but it is newly
 *      available to your other goals.
 *
 * Reporting them as one number would double count. Every figure here keeps
 * them apart and says which is which.
 */

import type { GoalProjection, MonthSnapshot, Projection } from './engine';
import { type Cents, sumCents } from './money';
import { type MonthKey, formatMonthKey } from './dates';
import { formatMoney } from './format';

export interface ForecastRow {
  month: MonthKey;
  /** 1 for the first month of the plan. */
  monthNumber: number;
  year: number;
  incomeCents: Cents;
  cashExpenseCents: Cents;
  debtPaidCents: Cents;
  /** Money available to goals this month. */
  poolCents: Cents;
  contributedCents: Cents;
  growthCents: Cents;
  /** Spare money once every goal is fully funded. */
  unallocatedCents: Cents;
  /** Monthly outgoings that have stopped since the plan began. */
  freedExpenseCents: Cents;
  /** Total put aside across all goals at the end of this month. */
  totalSavedCents: Cents;
  debtBalanceCents: Cents;
  completedGoalNames: string[];
  perGoalContributionCents: Record<string, Cents>;
}

export interface ForecastYear {
  year: number;
  months: number;
  /** Contributions made during the year. */
  savedCents: Cents;
  growthCents: Cents;
  /** Money going into goals in the last month of the year. */
  endingPoolCents: Cents;
  /** Outgoings stopped by the end of the year. */
  freedExpenseCents: Cents;
  /** Total put aside by the end of the year. */
  totalSavedCents: Cents;
  debtBalanceCents: Cents;
  goalsLanded: string[];
}

/** A goal landing, and what it changes about every month after it. */
export interface ForecastEvent {
  month: MonthKey;
  monthNumber: number;
  goalId: string;
  goalName: string;
  emoji: string;
  color: string;
  targetCents: Cents;
  /** Spending that stops because of this goal. Genuinely new money. */
  expenseFreedCents: Cents;
  /** What this goal was absorbing in its last full month of funding. */
  wasAbsorbingCents: Cents;
  /** Money going into goals the month before this one landed. */
  poolBeforeCents: Cents;
  /** Money going into the remaining goals the month after. */
  poolAfterCents: Cents;
  /** Goals still unfunded once this one has landed. */
  remainingGoals: number;
}

export interface Forecast {
  rows: ForecastRow[];
  years: ForecastYear[];
  events: ForecastEvent[];
  /** Money going to goals in the first month of the plan. */
  startingPoolCents: Cents;
  /** The largest monthly pool the plan ever reaches. */
  peakPoolCents: Cents;
  /** Everything contributed across the whole forecast. */
  totalContributedCents: Cents;
  totalGrowthCents: Cents;
  /** Total monthly outgoings freed by the end. */
  totalFreedCents: Cents;
  lastMonth: MonthKey | null;
}

function yearOf(month: MonthKey): number {
  return Number(month.slice(0, 4));
}

export function buildForecast(projection: Projection): Forecast {
  const goalsById = new Map<string, GoalProjection>(
    projection.goals.map((g) => [g.goalId, g]),
  );

  const rows: ForecastRow[] = projection.months.map((m, i) => ({
    month: m.month,
    monthNumber: i + 1,
    year: yearOf(m.month),
    incomeCents: m.incomeCents,
    cashExpenseCents: m.cashExpenseCents,
    debtPaidCents: m.debtPaidCents,
    poolCents: m.poolCents,
    contributedCents: m.contributedCents,
    growthCents: m.growthCents,
    unallocatedCents: m.unallocatedCents,
    freedExpenseCents: m.freedExpenseCents,
    totalSavedCents: m.goalBalanceCents,
    debtBalanceCents: m.debtBalanceCents,
    completedGoalNames: m.completedGoalIds.map(
      (id) => goalsById.get(id)?.name ?? 'Goal',
    ),
    perGoalContributionCents: m.perGoalContributionCents,
  }));

  const events = buildEvents(projection.months, goalsById);
  const years = buildYears(rows);

  return {
    rows,
    years,
    events,
    startingPoolCents: rows[0]?.poolCents ?? 0,
    peakPoolCents: rows.reduce((max, r) => Math.max(max, r.poolCents), 0),
    totalContributedCents: projection.totalContributedCents,
    totalGrowthCents: projection.totalGrowthEarnedCents,
    totalFreedCents: rows[rows.length - 1]?.freedExpenseCents ?? 0,
    lastMonth: rows[rows.length - 1]?.month ?? null,
  };
}

function buildEvents(
  months: readonly MonthSnapshot[],
  goalsById: ReadonlyMap<string, GoalProjection>,
): ForecastEvent[] {
  const events: ForecastEvent[] = [];
  const totalGoals = goalsById.size;
  let landed = 0;

  for (let i = 0; i < months.length; i += 1) {
    const m = months[i];
    if (!m || m.completedGoalIds.length === 0) continue;

    const previous = months[i - 1];
    const next = months[i + 1];

    for (const goalId of m.completedGoalIds) {
      const goal = goalsById.get(goalId);
      if (!goal) continue;

      // The final month usually funds only the remainder, so the month before
      // is a truer picture of what this goal was taking each month.
      const lastFullMonth = previous?.perGoalContributionCents[goalId] ?? 0;
      const finalMonth = m.perGoalContributionCents[goalId] ?? 0;

      landed += 1;
      events.push({
        month: m.month,
        monthNumber: i + 1,
        goalId,
        goalName: goal.name,
        emoji: goal.emoji,
        color: goal.color,
        targetCents: goal.targetCents,
        expenseFreedCents: goal.freesMonthlyCents,
        wasAbsorbingCents: Math.max(lastFullMonth, finalMonth),
        poolBeforeCents: previous?.poolCents ?? m.poolCents,
        poolAfterCents: next?.poolCents ?? m.poolCents,
        remainingGoals: Math.max(0, totalGoals - landed),
      });
    }
  }

  return events;
}

function buildYears(rows: readonly ForecastRow[]): ForecastYear[] {
  const byYear = new Map<number, ForecastRow[]>();
  for (const row of rows) {
    const list = byYear.get(row.year);
    if (list) list.push(row);
    else byYear.set(row.year, [row]);
  }

  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, list]) => {
      const last = list[list.length - 1];
      return {
        year,
        months: list.length,
        savedCents: sumCents(list.map((r) => r.contributedCents)),
        growthCents: sumCents(list.map((r) => r.growthCents)),
        endingPoolCents: last?.poolCents ?? 0,
        freedExpenseCents: last?.freedExpenseCents ?? 0,
        totalSavedCents: last?.totalSavedCents ?? 0,
        debtBalanceCents: last?.debtBalanceCents ?? 0,
        goalsLanded: list.flatMap((r) => r.completedGoalNames),
      };
    });
}

/**
 * Plain-words summary of what a goal landing changes. Kept here rather than in
 * the screen so the wording is identical on screen and in the exported report.
 */
export function describeEvent(
  event: ForecastEvent,
  currency: string,
  locale: string,
): string {
  const money = (cents: Cents) => formatMoney(cents, currency, locale);
  const parts: string[] = [];

  if (event.expenseFreedCents > 0) {
    parts.push(`${money(event.expenseFreedCents)} a month of payments stops`);
  }
  if (event.wasAbsorbingCents > 0) {
    parts.push(
      `the ${money(event.wasAbsorbingCents)} a month it was taking is freed up`,
    );
  }
  if (parts.length === 0) return `${event.goalName} is funded.`;

  const change = parts.join(', and ');

  // With nothing left to fund, "goes to your other goals" would be plainly
  // untrue — the money is simply yours again.
  if (event.remainingGoals === 0) {
    return `${change} — with every goal funded, that ${money(
      event.poolAfterCents,
    )} a month is yours to do anything with.`;
  }

  return `${change} — ${money(event.poolAfterCents)} a month now goes to your ${
    event.remainingGoals === 1 ? 'remaining goal' : `remaining ${event.remainingGoals} goals`
  }.`;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Wraps a CSV field so commas, quotes and newlines survive a spreadsheet. */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: (string | number)[][]): string {
  // A BOM makes Excel open a UTF-8 file with the ₹ sign intact.
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Money as a plain decimal number — spreadsheets should do their own maths. */
function units(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

export function monthlyReportCsv(
  forecast: Forecast,
  projection: Projection,
  currency: string,
): string {
  const goals = projection.goals;
  const header = [
    'Month',
    'Month #',
    `Income (${currency})`,
    `Living costs (${currency})`,
    `Debt paid (${currency})`,
    `Available to goals (${currency})`,
    `Saved this month (${currency})`,
    `Growth (${currency})`,
    `Payments freed so far (${currency})`,
    `Total saved (${currency})`,
    `Debt outstanding (${currency})`,
    'Goals reached',
    ...goals.map((g) => `${g.name} (${currency})`),
  ];

  const body = forecast.rows.map((r) => [
    formatMonthKey(r.month),
    r.monthNumber,
    units(r.incomeCents),
    units(r.cashExpenseCents),
    units(r.debtPaidCents),
    units(r.poolCents),
    units(r.contributedCents),
    units(r.growthCents),
    units(r.freedExpenseCents),
    units(r.totalSavedCents),
    units(r.debtBalanceCents),
    r.completedGoalNames.join(' | '),
    ...goals.map((g) => units(r.perGoalContributionCents[g.goalId] ?? 0)),
  ]);

  return csv([header, ...body]);
}

export function yearlyReportCsv(forecast: Forecast, currency: string): string {
  const header = [
    'Year',
    'Months in plan',
    `Saved during year (${currency})`,
    `Growth (${currency})`,
    `Monthly saving at year end (${currency})`,
    `Payments freed by year end (${currency})`,
    `Total saved by year end (${currency})`,
    `Debt outstanding (${currency})`,
    'Goals reached',
  ];

  const body = forecast.years.map((y) => [
    y.year,
    y.months,
    units(y.savedCents),
    units(y.growthCents),
    units(y.endingPoolCents),
    units(y.freedExpenseCents),
    units(y.totalSavedCents),
    units(y.debtBalanceCents),
    y.goalsLanded.join(' | '),
  ]);

  return csv([header, ...body]);
}

export function milestoneReportCsv(
  forecast: Forecast,
  currency: string,
  locale: string,
): string {
  const header = [
    'Month',
    'Month #',
    'Goal',
    `Target (${currency})`,
    `Payments freed (${currency})`,
    `Monthly amount released (${currency})`,
    `Monthly to goals before (${currency})`,
    `Monthly to goals after (${currency})`,
    'What changes',
  ];

  const body = forecast.events.map((e) => [
    formatMonthKey(e.month),
    e.monthNumber,
    e.goalName,
    units(e.targetCents),
    units(e.expenseFreedCents),
    units(e.wasAbsorbingCents),
    units(e.poolBeforeCents),
    units(e.poolAfterCents),
    describeEvent(e, currency, locale),
  ]);

  return csv([header, ...body]);
}

/** Everything in one file, as three labelled blocks. */
export function fullReportCsv(
  forecast: Forecast,
  projection: Projection,
  currency: string,
  locale: string,
): string {
  const gap = '\r\n\r\n';
  return [
    '﻿GOALVAULT FORECAST — MILESTONES',
    milestoneReportCsv(forecast, currency, locale).replace(/^﻿/, ''),
    'YEAR BY YEAR',
    yearlyReportCsv(forecast, currency).replace(/^﻿/, ''),
    'MONTH BY MONTH',
    monthlyReportCsv(forecast, projection, currency).replace(/^﻿/, ''),
  ].join(gap);
}
