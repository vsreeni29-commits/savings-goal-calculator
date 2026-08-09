/**
 * Turns untrusted JSON into a valid `AppData`.
 *
 * Two things feed this: data restored from device storage (which may have been
 * written by an older version of the app) and files the user imports. Neither
 * can be trusted, and a single bad field must never take the app down — so
 * every value is coerced into range and anything unsalvageable is dropped.
 */

import { CURRENT_DATA_VERSION, EXPENSE_CATEGORIES, GOAL_COLORS, GOAL_EMOJIS } from './types';
import type {
  AccountKind,
  AllocationStrategy,
  AppData,
  Contribution,
  Debt,
  DebtStrategy,
  ExpenseItem,
  Frequency,
  Goal,
  IncomeSource,
  Settings,
  SpendLog,
  ViewMode,
} from './types';
import { isValidISODate, isValidMonthKey, todayISO } from './dates';
import type { Cents } from './money';

const FREQUENCIES: Frequency[] = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const ACCOUNTS: AccountKind[] = ['debit', 'credit'];
const ALLOCATIONS: AllocationStrategy[] = ['priority', 'balanced', 'fastestFirst'];
const DEBT_STRATEGIES: DebtStrategy[] = ['avalanche', 'snowball', 'proportional'];
const VIEW_MODES: ViewMode[] = ['day', 'week', 'month', 'year'];
const THEMES: Settings['theme'][] = ['system', 'dark', 'light'];

/** Guards against absurd inputs that would break the month simulation. */
const MAX_CENTS = 1e15;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string, maxLength = 120): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

function cents(value: unknown, fallback: Cents = 0): Cents {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < -MAX_CENTS) return -MAX_CENTS;
  if (rounded > MAX_CENTS) return MAX_CENTS;
  return rounded;
}

function positiveCents(value: unknown, fallback: Cents = 0): Cents {
  const result = cents(value, fallback);
  return result < 0 ? 0 : result;
}

function rate(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  // Stored as a decimal. Anything past 100% a year is far more likely to be a
  // percentage that was never divided down, so it is clamped rather than
  // allowed to blow the projection up.
  return Math.min(Math.max(value, 0), 1);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function intInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), min), max);
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function isoDate(value: unknown, fallback: string): string {
  return isValidISODate(value) ? value : fallback;
}

function optionalISODate(value: unknown): string | undefined {
  return isValidISODate(value) ? value : undefined;
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

function id(value: unknown, prefix: string): string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
    ? value
    : newId(prefix);
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export function parseGoal(input: unknown, index = 0): Goal | null {
  if (!isRecord(input)) return null;
  const today = todayISO();
  return {
    id: id(input.id, 'goal'),
    name: str(input.name, 'Untitled goal', 60),
    emoji: str(input.emoji, GOAL_EMOJIS[index % GOAL_EMOJIS.length] ?? '🎯', 8),
    color: str(input.color, GOAL_COLORS[index % GOAL_COLORS.length] ?? '#6366f1', 24),
    targetCents: positiveCents(input.targetCents),
    savedCents: positiveCents(input.savedCents),
    targetDate: optionalISODate(input.targetDate),
    priority: intInRange(input.priority, 1, 99, 1),
    annualReturnRate: rate(input.annualReturnRate),
    manualMonthlyCents:
      typeof input.manualMonthlyCents === 'number' && input.manualMonthlyCents > 0
        ? positiveCents(input.manualMonthlyCents)
        : undefined,
    notes: typeof input.notes === 'string' ? input.notes.slice(0, 500) : undefined,
    archived: bool(input.archived, false),
    createdAt: isoDate(input.createdAt, today),
    completedOn: optionalISODate(input.completedOn),
  };
}

export function parseIncome(input: unknown): IncomeSource | null {
  if (!isRecord(input)) return null;
  return {
    id: id(input.id, 'income'),
    name: str(input.name, 'Income', 60),
    amountCents: positiveCents(input.amountCents),
    frequency: oneOf(input.frequency, FREQUENCIES, 'monthly'),
    active: bool(input.active, true),
  };
}

export function parseExpense(input: unknown): ExpenseItem | null {
  if (!isRecord(input)) return null;
  return {
    id: id(input.id, 'expense'),
    name: str(input.name, 'Expense', 60),
    amountCents: positiveCents(input.amountCents),
    frequency: oneOf(input.frequency, FREQUENCIES, 'monthly'),
    category: str(input.category, EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1] ?? 'Other', 40),
    account: oneOf(input.account, ACCOUNTS, 'debit'),
    debtId: typeof input.debtId === 'string' && input.debtId ? input.debtId.slice(0, 64) : undefined,
    essential: bool(input.essential, false),
    active: bool(input.active, true),
  };
}

export function parseDebt(input: unknown): Debt | null {
  if (!isRecord(input)) return null;
  return {
    id: id(input.id, 'debt'),
    name: str(input.name, 'Debt', 60),
    balanceCents: positiveCents(input.balanceCents),
    aprRate: rate(input.aprRate),
    minPaymentCents: positiveCents(input.minPaymentCents),
    revolving: bool(input.revolving, true),
    active: bool(input.active, true),
  };
}

export function parseContribution(input: unknown): Contribution | null {
  if (!isRecord(input)) return null;
  if (!isValidISODate(input.date)) return null;
  const amountCents = cents(input.amountCents);
  if (amountCents === 0) return null;
  return {
    id: id(input.id, 'contribution'),
    goalId: typeof input.goalId === 'string' ? input.goalId.slice(0, 64) : '',
    amountCents,
    date: input.date,
    note: typeof input.note === 'string' ? input.note.slice(0, 200) : undefined,
  };
}

export function parseSpendLog(input: unknown): SpendLog | null {
  if (!isRecord(input)) return null;
  if (!isValidISODate(input.date)) return null;
  const amountCents = positiveCents(input.amountCents);
  if (amountCents === 0) return null;
  return {
    id: id(input.id, 'spend'),
    amountCents,
    category: str(input.category, 'Other', 40),
    account: oneOf(input.account, ACCOUNTS, 'debit'),
    date: input.date,
    note: typeof input.note === 'string' ? input.note.slice(0, 200) : undefined,
  };
}

export function defaultSettings(): Settings {
  return {
    currency: 'INR',
    locale: 'en-IN',
    savingsFactor: 1,
    bufferCents: 0,
    allocationStrategy: 'priority',
    debtStrategy: 'avalanche',
    debtExtraShare: 0.5,
    viewMode: 'month',
    theme: 'system',
    onboarded: false,
  };
}

export function parseSettings(input: unknown): Settings {
  const base = defaultSettings();
  if (!isRecord(input)) return base;
  return {
    currency: str(input.currency, base.currency, 8),
    locale: str(input.locale, base.locale, 16),
    savingsFactor: numberInRange(input.savingsFactor, 0, 2, base.savingsFactor),
    bufferCents: positiveCents(input.bufferCents),
    allocationStrategy: oneOf(input.allocationStrategy, ALLOCATIONS, base.allocationStrategy),
    debtStrategy: oneOf(input.debtStrategy, DEBT_STRATEGIES, base.debtStrategy),
    debtExtraShare: numberInRange(input.debtExtraShare, 0, 1, base.debtExtraShare),
    viewMode: oneOf(input.viewMode, VIEW_MODES, base.viewMode),
    theme: oneOf(input.theme, THEMES, base.theme),
    startMonth: isValidMonthKey(input.startMonth) ? input.startMonth : undefined,
    onboarded: bool(input.onboarded, base.onboarded),
  };
}

export function emptyData(): AppData {
  return {
    version: CURRENT_DATA_VERSION,
    goals: [],
    income: [],
    expenses: [],
    debts: [],
    contributions: [],
    spendLogs: [],
    settings: defaultSettings(),
  };
}

function parseList<T>(input: unknown, parse: (item: unknown, index: number) => T | null): T[] {
  if (!Array.isArray(input)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < input.length; i += 1) {
    const parsed = parse(input[i], i);
    if (!parsed) continue;
    // Duplicate ids would make edits and deletes ambiguous.
    const entityId = (parsed as { id?: string }).id;
    if (entityId) {
      if (seen.has(entityId)) continue;
      seen.add(entityId);
    }
    out.push(parsed);
  }
  return out;
}

/**
 * The one entry point for untrusted data. Always returns something usable.
 */
export function parseAppData(input: unknown): AppData {
  if (!isRecord(input)) return emptyData();

  const goals = parseList(input.goals, parseGoal);
  const debts = parseList(input.debts, parseDebt);
  const expenses = parseList(input.expenses, parseExpense);

  const debtIds = new Set(debts.map((d) => d.id));
  const goalIds = new Set(goals.map((g) => g.id));

  return {
    version: CURRENT_DATA_VERSION,
    goals,
    income: parseList(input.income, parseIncome),
    // A card that no longer exists would silently swallow the expense, so the
    // link is cleared and the engine falls back to the primary card.
    expenses: expenses.map((e) =>
      e.debtId && !debtIds.has(e.debtId) ? { ...e, debtId: undefined } : e,
    ),
    debts,
    // Contributions to a deleted goal cannot be attributed to anything.
    contributions: parseList(input.contributions, parseContribution).filter((c) =>
      goalIds.has(c.goalId),
    ),
    spendLogs: parseList(input.spendLogs, parseSpendLog),
    settings: parseSettings(input.settings),
  };
}

export function serializeAppData(data: AppData): string {
  return JSON.stringify(
    {
      ...data,
      version: CURRENT_DATA_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'GoalVault',
    },
    null,
    2,
  );
}
