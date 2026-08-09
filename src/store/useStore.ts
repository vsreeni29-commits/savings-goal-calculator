import { create } from 'zustand';
import type {
  AppData,
  Contribution,
  Debt,
  ExpenseItem,
  Goal,
  IncomeSource,
  Settings,
  SpendLog,
} from '../domain/types';
import { emptyData, newId, parseAppData, serializeAppData } from '../domain/schema';
import { todayISO } from '../domain/dates';
import { maxZero } from '../domain/money';
import { clearRaw, readRaw, writeRaw } from './storage';

/** An entity being created: everything except the id, which the store mints. */
type Draft<T extends { id: string }> = Omit<T, 'id'> & { id?: string };

/** A logged entry, where leaving the date out means "today". */
type DatedDraft<T extends { id: string; date: string }> = Omit<T, 'id' | 'date'> & {
  id?: string;
  date?: string;
};

export interface StoreState extends AppData {
  hydrated: boolean;
}

interface Actions {
  hydrate: () => Promise<void>;

  addGoal: (draft: Draft<Goal>) => string;
  updateGoal: (id: string, patch: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
  reorderGoals: (orderedIds: string[]) => void;

  addIncome: (draft: Draft<IncomeSource>) => string;
  updateIncome: (id: string, patch: Partial<IncomeSource>) => void;
  removeIncome: (id: string) => void;

  addExpense: (draft: Draft<ExpenseItem>) => string;
  updateExpense: (id: string, patch: Partial<ExpenseItem>) => void;
  removeExpense: (id: string) => void;

  addDebt: (draft: Draft<Debt>) => string;
  updateDebt: (id: string, patch: Partial<Debt>) => void;
  removeDebt: (id: string) => void;

  addContribution: (draft: DatedDraft<Contribution>) => string;
  removeContribution: (id: string) => void;

  addSpendLog: (draft: DatedDraft<SpendLog>) => string;
  removeSpendLog: (id: string) => void;

  updateSettings: (patch: Partial<Settings>) => void;

  exportJson: () => string;
  importJson: (json: string) => { ok: true } | { ok: false; error: string };
  resetAll: () => Promise<void>;
}

export type Store = StoreState & Actions;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function dataOf(state: StoreState): AppData {
  return {
    version: state.version,
    goals: state.goals,
    income: state.income,
    expenses: state.expenses,
    debts: state.debts,
    contributions: state.contributions,
    spendLogs: state.spendLogs,
    settings: state.settings,
  };
}

/**
 * Writes are debounced: dragging a slider changes state on every frame, and a
 * phone should not touch disk for each one.
 */
function scheduleSave(state: StoreState): void {
  if (!state.hydrated) return;
  const snapshot = serializeAppData(dataOf(state));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeRaw(snapshot);
  }, 250);
}

function patchById<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export const useStore = create<Store>()((set, get) => {
  /** Every mutation goes through here, so nothing can forget to persist. */
  const commit = (updater: (state: Store) => Partial<StoreState>): void => {
    set(updater);
    scheduleSave(get());
  };

  return {
    ...emptyData(),
    hydrated: false,

    hydrate: async () => {
      const raw = await readRaw();
      if (!raw) {
        set({ hydrated: true });
        return;
      }
      try {
        set({ ...parseAppData(JSON.parse(raw)), hydrated: true });
      } catch {
        // Corrupt storage: open clean rather than refusing to open at all.
        set({ ...emptyData(), hydrated: true });
      }
    },

    addGoal: (draft) => {
      const id = draft.id ?? newId('goal');
      commit((state) => ({ goals: [...state.goals, { ...draft, id }] }));
      return id;
    },
    updateGoal: (id, patch) => commit((state) => ({ goals: patchById(state.goals, id, patch) })),
    removeGoal: (id) =>
      commit((state) => ({
        goals: state.goals.filter((g) => g.id !== id),
        // Deposits into a deleted goal have nothing left to point at.
        contributions: state.contributions.filter((c) => c.goalId !== id),
      })),
    reorderGoals: (orderedIds) =>
      commit((state) => {
        const rank = new Map(orderedIds.map((id, index) => [id, index + 1]));
        return { goals: state.goals.map((g) => ({ ...g, priority: rank.get(g.id) ?? g.priority })) };
      }),

    addIncome: (draft) => {
      const id = draft.id ?? newId('income');
      commit((state) => ({ income: [...state.income, { ...draft, id }] }));
      return id;
    },
    updateIncome: (id, patch) => commit((state) => ({ income: patchById(state.income, id, patch) })),
    removeIncome: (id) => commit((state) => ({ income: state.income.filter((i) => i.id !== id) })),

    addExpense: (draft) => {
      const id = draft.id ?? newId('expense');
      commit((state) => ({ expenses: [...state.expenses, { ...draft, id }] }));
      return id;
    },
    updateExpense: (id, patch) =>
      commit((state) => ({ expenses: patchById(state.expenses, id, patch) })),
    removeExpense: (id) =>
      commit((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) })),

    addDebt: (draft) => {
      const id = draft.id ?? newId('debt');
      commit((state) => ({ debts: [...state.debts, { ...draft, id }] }));
      return id;
    },
    updateDebt: (id, patch) => commit((state) => ({ debts: patchById(state.debts, id, patch) })),
    removeDebt: (id) =>
      commit((state) => ({
        debts: state.debts.filter((d) => d.id !== id),
        // Spending charged to a card that is gone falls back to cash.
        expenses: state.expenses.map((e) => (e.debtId === id ? { ...e, debtId: undefined } : e)),
      })),

    addContribution: (draft) => {
      const id = draft.id ?? newId('contribution');
      commit((state) => ({
        contributions: [...state.contributions, { ...draft, date: draft.date ?? todayISO(), id }],
      }));
      return id;
    },
    removeContribution: (id) =>
      commit((state) => {
        const removed = state.contributions.find((c) => c.id === id);
        if (!removed) return {};
        // Logging a deposit moved the goal's balance, so deleting one has to
        // move it back — otherwise a mistyped amount is stuck in the plan for
        // good with no way to correct it.
        return {
          contributions: state.contributions.filter((c) => c.id !== id),
          goals: state.goals.map((g) =>
            g.id === removed.goalId
              ? { ...g, savedCents: maxZero(g.savedCents - removed.amountCents) }
              : g,
          ),
        };
      }),

    addSpendLog: (draft) => {
      const id = draft.id ?? newId('spend');
      commit((state) => ({
        spendLogs: [...state.spendLogs, { ...draft, date: draft.date ?? todayISO(), id }],
      }));
      return id;
    },
    removeSpendLog: (id) =>
      commit((state) => ({ spendLogs: state.spendLogs.filter((l) => l.id !== id) })),

    updateSettings: (patch) => commit((state) => ({ settings: { ...state.settings, ...patch } })),

    exportJson: () => serializeAppData(dataOf(get())),

    importJson: (json) => {
      let raw: unknown;
      try {
        raw = JSON.parse(json);
      } catch {
        return { ok: false, error: 'That file is not valid JSON.' };
      }
      if (typeof raw !== 'object' || raw === null) {
        return { ok: false, error: 'That file does not contain a saved plan.' };
      }
      commit(() => ({ ...parseAppData(raw) }));
      return { ok: true };
    },

    resetAll: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await clearRaw();
      set({ ...emptyData(), hydrated: true });
    },
  };
});
