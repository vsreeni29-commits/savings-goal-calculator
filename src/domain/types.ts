import type { Cents } from './money';
import type { ISODate, MonthKey } from './dates';

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export type AccountKind = 'debit' | 'credit';

/** How spare money is shared between goals that are all still open. */
export type AllocationStrategy =
  /** Deadlines funded first, then everything spare piles onto the top goal. */
  | 'priority'
  /** Deadlines funded first, then the rest is split by priority weight. */
  | 'balanced'
  /** Whatever finishes soonest gets the money — fastest sense of progress. */
  | 'fastestFirst';

/** Extra money above the minimums goes to whichever debt this picks. */
export type DebtStrategy = 'avalanche' | 'snowball' | 'proportional';

/** The timescale every headline number is rendered in. */
export type ViewMode = 'day' | 'week' | 'month' | 'year';

export interface Goal {
  id: string;
  name: string;
  emoji: string;
  color: string;
  targetCents: Cents;
  /** Money already put aside for this goal. */
  savedCents: Cents;
  /** Deadline mode: hit the target by this date. Absent = "as soon as I can". */
  targetDate?: ISODate;
  /** 1 is the most important. Drives both funding order and split weight. */
  priority: number;
  /** Nominal annual return on money held for this goal, e.g. 0.06. */
  annualReturnRate: number;
  /** Fixed monthly amount the user has pinned for this goal, if any. */
  manualMonthlyCents?: Cents;
  notes?: string;
  archived: boolean;
  createdAt: ISODate;
  completedOn?: ISODate;
}

export interface IncomeSource {
  id: string;
  name: string;
  amountCents: Cents;
  frequency: Frequency;
  active: boolean;
}

export interface ExpenseItem {
  id: string;
  name: string;
  amountCents: Cents;
  frequency: Frequency;
  category: string;
  /** `credit` spending lands on a card balance instead of leaving cash now. */
  account: AccountKind;
  /** Which card credit spending is charged to. Falls back to the first debt. */
  debtId?: string;
  /**
   * The expense stops once this goal is fully funded.
   *
   * This is what makes a loan-preclosure goal work: the EMI is an expense, the
   * lump sum you are saving to clear it is a goal, and the month after that
   * goal lands the EMI stops and its money joins the pool for everything else.
   */
  endsWithGoalId?: string;
  /** Essential spending is protected from the "trim spending" what-if lever. */
  essential: boolean;
  active: boolean;
}

export interface Debt {
  id: string;
  name: string;
  balanceCents: Cents;
  /** Nominal annual rate, e.g. 0.36 for a 36% card. */
  aprRate: number;
  minPaymentCents: Cents;
  /** Cards keep absorbing new spending; loans do not. */
  revolving: boolean;
  active: boolean;
}

/** A real deposit the user made toward a goal. */
export interface Contribution {
  id: string;
  goalId: string;
  amountCents: Cents;
  date: ISODate;
  note?: string;
}

/** A real expense the user logged, for budget-vs-actual and no-spend streaks. */
export interface SpendLog {
  id: string;
  amountCents: Cents;
  category: string;
  account: AccountKind;
  date: ISODate;
  note?: string;
}

export interface Settings {
  currency: string;
  locale: string;
  /** Portion of spare cash actually saved. 1 = every spare rupee. */
  savingsFactor: number;
  /** Cash held back before anything is allocated — the "don't touch" float. */
  bufferCents: Cents;
  allocationStrategy: AllocationStrategy;
  debtStrategy: DebtStrategy;
  /** Share of spare cash thrown at debt above the minimums (0–1). */
  debtExtraShare: number;
  viewMode: ViewMode;
  theme: 'system' | 'dark' | 'light';
  /** Month the projection starts from. Normally the current month. */
  startMonth?: MonthKey;
  onboarded: boolean;
}

export interface AppData {
  version: number;
  goals: Goal[];
  income: IncomeSource[];
  expenses: ExpenseItem[];
  debts: Debt[];
  contributions: Contribution[];
  spendLogs: SpendLog[];
  settings: Settings;
}

export const CURRENT_DATA_VERSION = 1;

export const EXPENSE_CATEGORIES = [
  'Housing',
  'Food',
  'Groceries',
  'Transport',
  'Utilities',
  'Health',
  'Insurance',
  'Education',
  'Subscriptions',
  'Shopping',
  'Entertainment',
  'Travel',
  'Family',
  'Other',
] as const;

export const GOAL_COLORS = [
  '#6366f1',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
] as const;

export const GOAL_EMOJIS = [
  '🎯', '🏠', '🚗', '✈️', '🎓', '💍', '🏖️', '💻',
  '🛡️', '👶', '🏥', '📱', '🎸', '🐕', '🪴', '💰',
] as const;
