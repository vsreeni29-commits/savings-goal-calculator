/**
 * Derived views over the store.
 *
 * Each hook selects the individual slices it needs (so a component re-renders
 * only when those change) and memoises the derived result. The projection in
 * particular runs a multi-year simulation, so it must never be recomputed on
 * an unrelated render.
 */

import { useMemo } from 'react';
import { useStore, dataOf } from './useStore';
import type { AppData } from '../domain/types';
import { type Projection, monthlyExpenseCents, project } from '../domain/engine';
import {
  type Milestone,
  type SpendSummary,
  type StreakSummary,
  buildMilestones,
  buildMonthProgress,
  buildSpendSummary,
  buildStreaks,
  categoryBudgetsFrom,
} from '../domain/tracking';
import { currentMonthKey } from '../domain/dates';
import { sumCents } from '../domain/money';

export function useAppData(): AppData {
  const version = useStore((s) => s.version);
  const goals = useStore((s) => s.goals);
  const income = useStore((s) => s.income);
  const expenses = useStore((s) => s.expenses);
  const debts = useStore((s) => s.debts);
  const contributions = useStore((s) => s.contributions);
  const spendLogs = useStore((s) => s.spendLogs);
  const settings = useStore((s) => s.settings);

  return useMemo(
    () => dataOf({
      version,
      goals,
      income,
      expenses,
      debts,
      contributions,
      spendLogs,
      settings,
      hydrated: true,
    }),
    [version, goals, income, expenses, debts, contributions, spendLogs, settings],
  );
}

export function useProjection(): Projection {
  const data = useAppData();
  return useMemo(() => project(data), [data]);
}


export interface TrackingView {
  streaks: StreakSummary;
  spend: SpendSummary;
  milestones: Milestone[];
  month: string;
}

export function useTracking(projection: Projection, month?: string): TrackingView {
  const data = useAppData();
  return useMemo(() => {
    const key = month ?? currentMonthKey();
    const months = buildMonthProgress(data, projection.cashFlow.toGoalsCents);
    const streaks = buildStreaks(months);
    const budget = monthlyExpenseCents(data.expenses);
    const spend = buildSpendSummary(data, key, budget, categoryBudgetsFrom(data));

    const live = data.goals.filter((g) => !g.archived);
    const target = sumCents(live.map((g) => g.targetCents));
    const saved = sumCents(live.map((g) => g.savedCents));
    const totalProgress = target > 0 ? Math.min(saved / target, 1) : 0;
    const debtFree = data.debts.filter((d) => d.active).every((d) => d.balanceCents <= 0);

    return {
      streaks,
      spend,
      milestones: buildMilestones(data, streaks, spend, totalProgress, debtFree),
      month: key,
    };
  }, [data, projection.cashFlow.toGoalsCents, month]);
}

export function useCurrency(): { currency: string; locale: string } {
  const settings = useStore((s) => s.settings);
  return { currency: settings.currency, locale: settings.locale };
}
