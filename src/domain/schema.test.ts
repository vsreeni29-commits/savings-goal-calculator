import { describe, expect, it } from 'vitest';
import { emptyData, newId, parseAppData, parseGoal, parseSettings, serializeAppData } from './schema';
import { makeData, makeGoal } from './testFactories';

describe('parseAppData', () => {
  it('returns a usable shape for anything that is not an object', () => {
    for (const junk of [null, undefined, 42, 'nope', [], true]) {
      const data = parseAppData(junk);
      expect(data.goals).toEqual([]);
      expect(data.settings.currency).toBe('INR');
    }
  });

  it('survives a round trip through JSON', () => {
    const original = makeData({
      goals: [makeGoal({ id: 'g1', targetCents: 500_000, targetDate: '2027-01-31' })],
    });
    const restored = parseAppData(JSON.parse(serializeAppData(original)));
    expect(restored.goals[0]).toEqual(original.goals[0]);
    expect(restored.settings).toEqual(original.settings);
  });

  it('drops entries it cannot make sense of instead of throwing', () => {
    const data = parseAppData({
      goals: [null, 'x', { name: 'Real' }],
      income: [{ amountCents: 'lots' }],
      spendLogs: [{ amountCents: 500, date: 'not-a-date' }],
    });
    expect(data.goals).toHaveLength(1);
    expect(data.goals[0]?.name).toBe('Real');
    expect(data.income[0]?.amountCents).toBe(0);
    expect(data.spendLogs).toEqual([]);
  });

  it('removes duplicate ids so edits stay unambiguous', () => {
    const data = parseAppData({
      goals: [
        { id: 'same', name: 'First' },
        { id: 'same', name: 'Second' },
      ],
    });
    expect(data.goals).toHaveLength(1);
    expect(data.goals[0]?.name).toBe('First');
  });

  it('unlinks expenses pointing at a card that is gone', () => {
    const data = parseAppData({
      debts: [{ id: 'card', name: 'Card' }],
      expenses: [
        { name: 'Groceries', account: 'credit', debtId: 'card' },
        { name: 'Fuel', account: 'credit', debtId: 'ghost' },
      ],
    });
    expect(data.expenses[0]?.debtId).toBe('card');
    expect(data.expenses[1]?.debtId).toBeUndefined();
  });

  it('drops contributions to goals that no longer exist', () => {
    const data = parseAppData({
      goals: [{ id: 'g1', name: 'Goal' }],
      contributions: [
        { goalId: 'g1', amountCents: 100, date: '2026-01-01' },
        { goalId: 'gone', amountCents: 100, date: '2026-01-01' },
      ],
    });
    expect(data.contributions).toHaveLength(1);
    expect(data.contributions[0]?.goalId).toBe('g1');
  });
});

describe('field coercion', () => {
  it('keeps money as whole non-negative cents', () => {
    const goal = parseGoal({ targetCents: -50.7, savedCents: 12.4 });
    expect(goal?.targetCents).toBe(0);
    expect(goal?.savedCents).toBe(12);
  });

  it('refuses non-finite money', () => {
    const goal = parseGoal({ targetCents: Number.POSITIVE_INFINITY, savedCents: Number.NaN });
    expect(goal?.targetCents).toBe(0);
    expect(goal?.savedCents).toBe(0);
  });

  it('clamps a rate that was stored as a percentage by mistake', () => {
    expect(parseGoal({ annualReturnRate: 7 })?.annualReturnRate).toBe(1);
    expect(parseGoal({ annualReturnRate: -0.5 })?.annualReturnRate).toBe(0);
    expect(parseGoal({ annualReturnRate: 0.065 })?.annualReturnRate).toBe(0.065);
  });

  it('rejects impossible target dates but keeps real ones', () => {
    expect(parseGoal({ targetDate: '2026-02-30' })?.targetDate).toBeUndefined();
    expect(parseGoal({ targetDate: '2026-02-28' })?.targetDate).toBe('2026-02-28');
  });

  it('falls back to safe values for unknown enum members', () => {
    const settings = parseSettings({
      allocationStrategy: 'whatever',
      debtStrategy: 'nope',
      viewMode: 'century',
      theme: 'neon',
    });
    expect(settings.allocationStrategy).toBe('priority');
    expect(settings.debtStrategy).toBe('avalanche');
    expect(settings.viewMode).toBe('month');
    expect(settings.theme).toBe('system');
  });

  it('keeps the savings factor and debt share inside their sliders', () => {
    expect(parseSettings({ savingsFactor: 99 }).savingsFactor).toBe(2);
    expect(parseSettings({ savingsFactor: -1 }).savingsFactor).toBe(0);
    expect(parseSettings({ debtExtraShare: 5 }).debtExtraShare).toBe(1);
  });

  it('trims runaway strings rather than storing them', () => {
    const goal = parseGoal({ name: 'x'.repeat(500) });
    expect(goal?.name.length).toBe(60);
  });

  it('gives an unnamed goal a usable name', () => {
    expect(parseGoal({ name: '   ' })?.name).toBe('Untitled goal');
  });
});

describe('ids', () => {
  it('mints unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId('goal')));
    expect(ids.size).toBe(500);
  });

  it('invents an id when one is missing', () => {
    expect(parseGoal({ name: 'No id' })?.id).toMatch(/^goal_/);
  });
});

describe('emptyData', () => {
  it('is itself valid input', () => {
    expect(parseAppData(emptyData())).toEqual(emptyData());
  });
});
