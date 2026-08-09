/**
 * Fixture builders shared by the domain tests. Everything defaults to a plain,
 * boring plan so each test only has to state the one thing it cares about.
 */

import type {
  AppData,
  Debt,
  ExpenseItem,
  Goal,
  IncomeSource,
  Settings,
} from './types';
import { CURRENT_DATA_VERSION } from './types';

export const TEST_START_MONTH = '2026-01';

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: over.id ?? nextId('goal'),
    name: 'Goal',
    emoji: '🎯',
    color: '#6366f1',
    targetCents: 1_000_000,
    savedCents: 0,
    priority: 1,
    annualReturnRate: 0,
    archived: false,
    createdAt: '2026-01-01',
    ...over,
  };
}

export function makeIncome(over: Partial<IncomeSource> = {}): IncomeSource {
  return {
    id: over.id ?? nextId('income'),
    name: 'Salary',
    amountCents: 10_000_000,
    frequency: 'monthly',
    active: true,
    ...over,
  };
}

export function makeExpense(over: Partial<ExpenseItem> = {}): ExpenseItem {
  return {
    id: over.id ?? nextId('expense'),
    name: 'Rent',
    amountCents: 5_000_000,
    frequency: 'monthly',
    category: 'Housing',
    account: 'debit',
    essential: true,
    active: true,
    ...over,
  };
}

export function makeDebt(over: Partial<Debt> = {}): Debt {
  return {
    id: over.id ?? nextId('debt'),
    name: 'Credit card',
    balanceCents: 1_000_000,
    aprRate: 0.24,
    minPaymentCents: 100_000,
    revolving: true,
    active: true,
    ...over,
  };
}

export function makeSettings(over: Partial<Settings> = {}): Settings {
  return {
    currency: 'INR',
    locale: 'en-IN',
    savingsFactor: 1,
    bufferCents: 0,
    allocationStrategy: 'priority',
    debtStrategy: 'avalanche',
    debtExtraShare: 0,
    viewMode: 'month',
    theme: 'system',
    startMonth: TEST_START_MONTH,
    onboarded: true,
    ...over,
  };
}

export type DataOverrides = Partial<Omit<AppData, 'settings'>> & {
  settings?: Partial<Settings>;
};

export function makeData(over: DataOverrides = {}): AppData {
  const { settings, ...rest } = over;
  return {
    version: CURRENT_DATA_VERSION,
    goals: [],
    income: [],
    expenses: [],
    debts: [],
    contributions: [],
    spendLogs: [],
    ...rest,
    settings: makeSettings(settings),
  };
}
