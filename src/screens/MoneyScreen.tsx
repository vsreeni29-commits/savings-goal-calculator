import { useMemo, useState } from 'react';
import type { Projection } from '../domain/engine';
import { debtHint, monthlyExpenseCents, toMonthlyCents } from '../domain/engine';
import type { AccountKind, Debt, ExpenseItem, Frequency, IncomeSource } from '../domain/types';
import { EXPENSE_CATEGORIES } from '../domain/types';
import { useStore } from '../store/useStore';
import { formatMoney, formatRate } from '../domain/format';
import { formatMonthKey, humanizeMonths } from '../domain/dates';
import { paymentToClearDebt, monthlyRate } from '../domain/finance';
import {
  AmountInput,
  Card,
  Chip,
  ConfirmButton,
  EmptyState,
  Field,
  Metric,
  Money,
  Segmented,
  Select,
  Sheet,
  TextInput,
  Toast,
  Toggle,
  useToast,
} from '../components/ui';

type Section = 'income' | 'spending' | 'debt';

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every fortnight' },
  { value: 'monthly', label: 'Every month' },
  { value: 'quarterly', label: 'Every quarter' },
  { value: 'yearly', label: 'Every year' },
];

const FREQUENCY_SHORT: Record<Frequency, string> = {
  weekly: 'weekly',
  biweekly: 'fortnightly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  yearly: 'yearly',
};

export default function MoneyScreen({ projection }: { projection: Projection }) {
  const settings = useStore((s) => s.settings);
  const [section, setSection] = useState<Section>('income');
  const [toast, showToast] = useToast();

  const { currency, locale } = settings;
  const cash = projection.cashFlow;

  return (
    <div className="screen">
      <div className="screen__head">
        <div>
          <h1 className="screen__title">Money</h1>
          <p className="screen__sub">
            The honest version. What comes in, what goes out, and what you still owe.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <Metric
          label="In"
          value={<Money cents={cash.incomeCents} currency={currency} locale={locale} compact />}
          hint="a month"
          tone="good"
        />
        <Metric
          label="Out"
          value={
            <Money
              cents={cash.debitExpenseCents + cash.creditExpenseCents}
              currency={currency}
              locale={locale}
              compact
            />
          }
          hint="cash plus card spending"
        />
        <Metric
          label="Owed"
          value={
            <Money
              cents={projection.debts.reduce((sum, d) => sum + d.startingBalanceCents, 0)}
              currency={currency}
              locale={locale}
              compact
            />
          }
          hint={debtHint(projection)}
          tone={projection.debts.some((d) => d.growing) ? 'bad' : undefined}
        />
        <Metric
          label="Spare"
          value={
            <Money cents={cash.surplusCents} currency={currency} locale={locale} compact signed />
          }
          hint="left to work with"
          tone={cash.surplusCents > 0 ? 'good' : 'bad'}
        />
      </div>

      <Segmented
        label="Section"
        options={[
          { id: 'income' as const, label: 'Income' },
          { id: 'spending' as const, label: 'Spending' },
          { id: 'debt' as const, label: 'Debt' },
        ]}
        value={section}
        onChange={setSection}
      />

      {section === 'income' && <IncomeSection onToast={showToast} />}
      {section === 'spending' && <SpendingSection onToast={showToast} />}
      {section === 'debt' && <DebtSection projection={projection} onToast={showToast} />}

      <Toast message={toast} />
    </div>
  );
}

// --------------------------------------------------------------- income ----

function IncomeSection({ onToast }: { onToast: (message: string) => void }) {
  const income = useStore((s) => s.income);
  const addIncome = useStore((s) => s.addIncome);
  const updateIncome = useStore((s) => s.updateIncome);
  const removeIncome = useStore((s) => s.removeIncome);
  const { currency, locale } = useStore((s) => s.settings);

  const [editing, setEditing] = useState<IncomeSource | 'new' | null>(null);

  return (
    <>
      <Card
        title="What you earn"
        action={
          <button type="button" className="btn btn--sm" onClick={() => setEditing('new')}>
            ＋ Add
          </button>
        }
      >
        {income.length === 0 ? (
          <EmptyState
            glyph="💰"
            title="No income yet"
            text="Add your salary and anything else that arrives regularly."
            action={
              <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
                Add income
              </button>
            }
          />
        ) : (
          <div className="list">
            {income.map((item) => (
              <button
                key={item.id}
                type="button"
                className="list__item"
                onClick={() => setEditing(item)}
                style={{ opacity: item.active ? 1 : 0.5 }}
              >
                <span className="avatar" style={{ background: 'var(--good-soft)' }}>
                  💰
                </span>
                <div className="list__body">
                  <div className="list__name">{item.name}</div>
                  <div className="list__meta">
                    {formatMoney(item.amountCents, currency, locale)}{' '}
                    {FREQUENCY_SHORT[item.frequency]}
                    {!item.active && ' — paused'}
                  </div>
                </div>
                <div className="list__amount good">
                  {formatMoney(toMonthlyCents(item.amountCents, item.frequency), currency, locale, {
                    compact: true,
                  })}
                  <div className="tiny faint" style={{ fontWeight: 500 }}>
                    /mo
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <IncomeEditor
          source={editing === 'new' ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSave={(fields) => {
            if (editing === 'new') {
              addIncome(fields);
              onToast('Income added');
            } else {
              updateIncome(editing.id, fields);
              onToast('Income updated');
            }
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : () => {
                  removeIncome(editing.id);
                  onToast('Income removed');
                  setEditing(null);
                }
          }
        />
      )}
    </>
  );
}

function IncomeEditor({
  source,
  currency,
  onClose,
  onSave,
  onDelete,
}: {
  source: IncomeSource | null;
  currency: string;
  onClose: () => void;
  onSave: (fields: Omit<IncomeSource, 'id'>) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(source?.name ?? '');
  const [amountCents, setAmountCents] = useState(source?.amountCents ?? 0);
  const [frequency, setFrequency] = useState<Frequency>(source?.frequency ?? 'monthly');
  const [active, setActive] = useState(source?.active ?? true);
  const [touched, setTouched] = useState(false);

  const valid = name.trim().length > 0 && amountCents > 0;

  return (
    <Sheet
      open
      title={source ? 'Edit income' : 'Add income'}
      onClose={onClose}
      footer={
        <>
          {onDelete && <ConfirmButton label="Delete" confirmLabel="Sure?" onConfirm={onDelete} />}
          <button
            type="button"
            className="btn btn--primary"
            style={{ flex: 1 }}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSave({ name: name.trim(), amountCents, frequency, active });
            }}
          >
            Save
          </button>
        </>
      }
    >
      <Field
        label="Name"
        error={touched && !name.trim() ? 'Give it a name.' : undefined}
      >
        <TextInput
          value={name}
          onChange={setName}
          placeholder="Salary"
          autoFocus={!source}
          invalid={touched && !name.trim()}
        />
      </Field>
      <Field
        label="Amount"
        error={touched && amountCents <= 0 ? 'Enter how much you receive.' : undefined}
      >
        <AmountInput
          cents={amountCents}
          onChange={setAmountCents}
          currency={currency}
          invalid={touched && amountCents <= 0}
        />
      </Field>
      <Field label="How often">
        <Select value={frequency} onChange={setFrequency} options={FREQUENCIES} />
      </Field>
      <Toggle
        checked={active}
        onChange={setActive}
        label="Counting this"
        hint="Turn off to keep the entry but leave it out of the plan."
      />
    </Sheet>
  );
}

// -------------------------------------------------------------- spending ----

function SpendingSection({ onToast }: { onToast: (message: string) => void }) {
  const expenses = useStore((s) => s.expenses);
  const debts = useStore((s) => s.debts);
  const addExpense = useStore((s) => s.addExpense);
  const updateExpense = useStore((s) => s.updateExpense);
  const removeExpense = useStore((s) => s.removeExpense);
  const { currency, locale } = useStore((s) => s.settings);

  const [editing, setEditing] = useState<ExpenseItem | 'new' | null>(null);

  const debitTotal = monthlyExpenseCents(expenses, 'debit');
  const creditTotal = monthlyExpenseCents(expenses, 'credit');

  const grouped = useMemo(() => {
    const map = new Map<string, ExpenseItem[]>();
    for (const e of expenses) {
      const list = map.get(e.category);
      if (list) list.push(e);
      else map.set(e.category, [e]);
    }
    return [...map.entries()].sort(
      (a, b) =>
        monthlyExpenseCents(b[1]) - monthlyExpenseCents(a[1]) || a[0].localeCompare(b[0]),
    );
  }, [expenses]);

  return (
    <>
      <div className="grid-2">
        <Metric
          label="From your account"
          value={<Money cents={debitTotal} currency={currency} locale={locale} compact />}
          hint="leaves cash this month"
        />
        <Metric
          label="On a card"
          value={<Money cents={creditTotal} currency={currency} locale={locale} compact />}
          hint="added to a balance you repay"
        />
      </div>

      <Card
        title="What you spend"
        action={
          <button type="button" className="btn btn--sm" onClick={() => setEditing('new')}>
            ＋ Add
          </button>
        }
      >
        {expenses.length === 0 ? (
          <EmptyState
            glyph="🧾"
            title="No expenses yet"
            text="Rent, food, transport, subscriptions. The more honest this is, the more honest your finish date."
            action={
              <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
                Add an expense
              </button>
            }
          />
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            {grouped.map(([category, items]) => (
              <div key={category}>
                <div className="row row--between" style={{ marginBottom: 6 }}>
                  <span className="small strong">{category}</span>
                  <span className="small dim num">
                    {formatMoney(monthlyExpenseCents(items), currency, locale, { compact: true })}
                    /mo
                  </span>
                </div>
                <div className="list">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="list__item"
                      onClick={() => setEditing(item)}
                      style={{ opacity: item.active ? 1 : 0.5 }}
                    >
                      <div className="list__body">
                        <div className="list__name">
                          {item.name}{' '}
                          {item.account === 'credit' && <Chip>card</Chip>}
                          {item.essential && <Chip tone="accent">must pay</Chip>}
                        </div>
                        <div className="list__meta">
                          {formatMoney(item.amountCents, currency, locale)}{' '}
                          {FREQUENCY_SHORT[item.frequency]}
                          {!item.active && ' — paused'}
                        </div>
                      </div>
                      <div className="list__amount">
                        {formatMoney(
                          toMonthlyCents(item.amountCents, item.frequency),
                          currency,
                          locale,
                          { compact: true },
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {editing && (
        <ExpenseEditor
          expense={editing === 'new' ? null : editing}
          debts={debts}
          currency={currency}
          onClose={() => setEditing(null)}
          onSave={(fields) => {
            if (editing === 'new') {
              addExpense(fields);
              onToast('Expense added');
            } else {
              updateExpense(editing.id, fields);
              onToast('Expense updated');
            }
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : () => {
                  removeExpense(editing.id);
                  onToast('Expense removed');
                  setEditing(null);
                }
          }
        />
      )}
    </>
  );
}

function ExpenseEditor({
  expense,
  debts,
  currency,
  onClose,
  onSave,
  onDelete,
}: {
  expense: ExpenseItem | null;
  debts: Debt[];
  currency: string;
  onClose: () => void;
  onSave: (fields: Omit<ExpenseItem, 'id'>) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(expense?.name ?? '');
  const [amountCents, setAmountCents] = useState(expense?.amountCents ?? 0);
  const [frequency, setFrequency] = useState<Frequency>(expense?.frequency ?? 'monthly');
  const [category, setCategory] = useState(expense?.category ?? 'Housing');
  const [account, setAccount] = useState<AccountKind>(expense?.account ?? 'debit');
  const [debtId, setDebtId] = useState(expense?.debtId ?? '');
  const [essential, setEssential] = useState(expense?.essential ?? false);
  const [active, setActive] = useState(expense?.active ?? true);
  const [touched, setTouched] = useState(false);

  const cards = debts.filter((d) => d.active && d.revolving);
  const valid = name.trim().length > 0 && amountCents > 0;

  return (
    <Sheet
      open
      title={expense ? 'Edit expense' : 'Add expense'}
      onClose={onClose}
      footer={
        <>
          {onDelete && <ConfirmButton label="Delete" confirmLabel="Sure?" onConfirm={onDelete} />}
          <button
            type="button"
            className="btn btn--primary"
            style={{ flex: 1 }}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSave({
                name: name.trim(),
                amountCents,
                frequency,
                category,
                account,
                debtId: account === 'credit' && debtId ? debtId : undefined,
                essential,
                active,
              });
            }}
          >
            Save
          </button>
        </>
      }
    >
      <Field label="Name" error={touched && !name.trim() ? 'Give it a name.' : undefined}>
        <TextInput
          value={name}
          onChange={setName}
          placeholder="Rent"
          autoFocus={!expense}
          invalid={touched && !name.trim()}
        />
      </Field>
      <Field label="Amount" error={touched && amountCents <= 0 ? 'Enter an amount.' : undefined}>
        <AmountInput
          cents={amountCents}
          onChange={setAmountCents}
          currency={currency}
          invalid={touched && amountCents <= 0}
        />
      </Field>
      <Field label="How often">
        <Select value={frequency} onChange={setFrequency} options={FREQUENCIES} />
      </Field>
      <Field label="Category">
        <Select
          value={category}
          onChange={setCategory}
          options={EXPENSE_CATEGORIES.map((c) => ({ value: c as string, label: c }))}
        />
      </Field>
      <Field
        label="Paid how?"
        hint="Card spending does not leave your account this month — it lands on the balance you repay, and picks up interest if you carry it."
      >
        <Segmented
          label="Account"
          options={[
            { id: 'debit' as const, label: 'Bank account' },
            { id: 'credit' as const, label: 'Credit card' },
          ]}
          value={account}
          onChange={setAccount}
        />
      </Field>
      {account === 'credit' && cards.length > 0 && (
        <Field label="Which card">
          <Select
            value={debtId}
            onChange={setDebtId}
            options={[
              { value: '', label: 'First card on the list' },
              ...cards.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </Field>
      )}
      {account === 'credit' && cards.length === 0 && (
        <div className="notice notice--info">
          <span className="notice__glyph" aria-hidden="true">
            💡
          </span>
          <div>
            <div className="notice__title">No card set up</div>
            <div className="notice__detail">
              Add one under Debt and this spending will start building its balance properly.
              Until then it is counted as cash going out.
            </div>
          </div>
        </div>
      )}
      <Toggle
        checked={essential}
        onChange={setEssential}
        label="Cannot be cut"
        hint="Protects it from the trim-spending slider on the What-if screen."
      />
      <Toggle checked={active} onChange={setActive} label="Counting this" />
    </Sheet>
  );
}

// ------------------------------------------------------------------ debt ----

function DebtSection({
  projection,
  onToast,
}: {
  projection: Projection;
  onToast: (message: string) => void;
}) {
  const debts = useStore((s) => s.debts);
  const addDebt = useStore((s) => s.addDebt);
  const updateDebt = useStore((s) => s.updateDebt);
  const removeDebt = useStore((s) => s.removeDebt);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const [editing, setEditing] = useState<Debt | 'new' | null>(null);
  const { currency, locale } = settings;

  const byId = useMemo(
    () => new Map(projection.debts.map((d) => [d.debtId, d])),
    [projection.debts],
  );

  return (
    <>
      <Card
        title="What you owe"
        action={
          <button type="button" className="btn btn--sm" onClick={() => setEditing('new')}>
            ＋ Add
          </button>
        }
      >
        {debts.length === 0 ? (
          <EmptyState
            glyph="🕊️"
            title="Nothing owed"
            text="Add a credit card or loan and the plan will work its repayment into your finish dates."
            action={
              <button type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
                Add a debt
              </button>
            }
          />
        ) : (
          <div className="list">
            {debts.map((debt) => {
              const result = byId.get(debt.id);
              return (
                <button
                  key={debt.id}
                  type="button"
                  className="list__item"
                  onClick={() => setEditing(debt)}
                  style={{ opacity: debt.active ? 1 : 0.5 }}
                >
                  <span className="avatar" style={{ background: 'var(--bad-soft)' }}>
                    {debt.revolving ? '💳' : '🏦'}
                  </span>
                  <div className="list__body">
                    <div className="list__name">{debt.name}</div>
                    <div className="list__meta">
                      {formatRate(debt.aprRate)} a year ·{' '}
                      {result?.clearedMonth
                        ? `clear by ${formatMonthKey(result.clearedMonth, 'short')}`
                        : result?.growing
                          ? 'growing'
                          : '—'}
                    </div>
                  </div>
                  <div className={result?.growing ? 'list__amount bad' : 'list__amount'}>
                    {formatMoney(debt.balanceCents, currency, locale, { compact: true })}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {debts.some((d) => d.active && d.balanceCents > 0) && (
        <Card title="How to attack it">
          <Field
            label="Order to pay them off"
            hint="Avalanche saves the most interest. Snowball clears the smallest balance first, which is easier to stick to."
          >
            <Segmented
              label="Debt strategy"
              options={[
                { id: 'avalanche' as const, label: 'Avalanche' },
                { id: 'snowball' as const, label: 'Snowball' },
                { id: 'proportional' as const, label: 'Split' },
              ]}
              value={settings.debtStrategy}
              onChange={(next) => updateSettings({ debtStrategy: next })}
            />
          </Field>

          <div style={{ height: 14 }} />

          <Field
            label={`Spare cash going at the debt: ${Math.round(settings.debtExtraShare * 100)}%`}
            hint="The rest goes to your goals. When the debt costs more than your savings earn, more here gets you everywhere faster."
          >
            <input
              className="slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(settings.debtExtraShare * 100)}
              aria-label="Share of spare cash going to debt"
              onChange={(e) => updateSettings({ debtExtraShare: Number(e.target.value) / 100 })}
            />
          </Field>

          <div className="row row--between small dim">
            <span>
              Debt:{' '}
              <span className="num strong" style={{ color: 'var(--text)' }}>
                {formatMoney(
                  projection.cashFlow.minDebtPaymentCents + projection.cashFlow.extraDebtCents,
                  currency,
                  locale,
                )}
              </span>
            </span>
            <span>
              Goals:{' '}
              <span className="num strong" style={{ color: 'var(--text)' }}>
                {formatMoney(projection.cashFlow.toGoalsCents, currency, locale)}
              </span>
            </span>
          </div>

          {projection.totalInterestPaidCents > 0 && (
            <div className="small dim" style={{ marginTop: 10 }}>
              You will hand over{' '}
              <strong className="num">
                {formatMoney(projection.totalInterestPaidCents, currency, locale)}
              </strong>{' '}
              in interest on the way.
            </div>
          )}
        </Card>
      )}

      {editing && (
        <DebtEditor
          debt={editing === 'new' ? null : editing}
          currency={currency}
          locale={locale}
          onClose={() => setEditing(null)}
          onSave={(fields) => {
            if (editing === 'new') {
              addDebt(fields);
              onToast('Debt added');
            } else {
              updateDebt(editing.id, fields);
              onToast('Debt updated');
            }
            setEditing(null);
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : () => {
                  removeDebt(editing.id);
                  onToast('Debt removed');
                  setEditing(null);
                }
          }
        />
      )}
    </>
  );
}

function DebtEditor({
  debt,
  currency,
  locale,
  onClose,
  onSave,
  onDelete,
}: {
  debt: Debt | null;
  currency: string;
  locale: string;
  onClose: () => void;
  onSave: (fields: Omit<Debt, 'id'>) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(debt?.name ?? '');
  const [balanceCents, setBalanceCents] = useState(debt?.balanceCents ?? 0);
  const [aprPct, setAprPct] = useState(
    debt ? String(Math.round(debt.aprRate * 1000) / 10) : '36',
  );
  const [minPaymentCents, setMinPaymentCents] = useState(debt?.minPaymentCents ?? 0);
  const [revolving, setRevolving] = useState(debt?.revolving ?? true);
  const [active, setActive] = useState(debt?.active ?? true);
  const [touched, setTouched] = useState(false);

  const parsedApr = Number(aprPct);
  const aprRate = Number.isFinite(parsedApr) && parsedApr > 0 ? Math.min(parsedApr / 100, 1) : 0;
  const valid = name.trim().length > 0 && balanceCents >= 0;

  // A quick reality check while they type: what does it take to be done in a year?
  const oneYearPayment = useMemo(
    () => (balanceCents > 0 ? paymentToClearDebt(balanceCents, monthlyRate(aprRate), 12) : 0),
    [balanceCents, aprRate],
  );
  const monthlyInterest = Math.round(balanceCents * monthlyRate(aprRate));
  const minimumTooLow = minPaymentCents > 0 && minPaymentCents <= monthlyInterest;

  return (
    <Sheet
      open
      title={debt ? 'Edit debt' : 'Add debt'}
      onClose={onClose}
      footer={
        <>
          {onDelete && <ConfirmButton label="Delete" confirmLabel="Sure?" onConfirm={onDelete} />}
          <button
            type="button"
            className="btn btn--primary"
            style={{ flex: 1 }}
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSave({ name: name.trim(), balanceCents, aprRate, minPaymentCents, revolving, active });
            }}
          >
            Save
          </button>
        </>
      }
    >
      <Field label="Name" error={touched && !name.trim() ? 'Give it a name.' : undefined}>
        <TextInput
          value={name}
          onChange={setName}
          placeholder="Credit card"
          autoFocus={!debt}
          invalid={touched && !name.trim()}
        />
      </Field>
      <Field label="Balance owed">
        <AmountInput cents={balanceCents} onChange={setBalanceCents} currency={currency} />
      </Field>
      <Field label="Interest rate a year (%)" hint="Cards in India often sit near 36–42%.">
        <TextInput value={aprPct} onChange={setAprPct} inputMode="decimal" maxLength={6} />
      </Field>
      <Field
        label="Minimum payment a month"
        hint={
          minimumTooLow
            ? undefined
            : 'What you have to pay each month, whatever else happens.'
        }
        error={
          minimumTooLow
            ? `That barely covers the ${formatMoney(monthlyInterest, currency, locale)} of monthly interest — the balance will grow.`
            : undefined
        }
      >
        <AmountInput
          cents={minPaymentCents}
          onChange={setMinPaymentCents}
          currency={currency}
          invalid={minimumTooLow}
        />
      </Field>

      {balanceCents > 0 && (
        <div className="notice notice--info">
          <span className="notice__glyph" aria-hidden="true">
            💡
          </span>
          <div>
            <div className="notice__title">
              {formatMoney(oneYearPayment, currency, locale)} a month clears this in a year
            </div>
            <div className="notice__detail">
              At {formatRate(aprRate)}, this balance costs you{' '}
              {formatMoney(monthlyInterest, currency, locale)} every month you carry it.
            </div>
          </div>
        </div>
      )}

      <Toggle
        checked={revolving}
        onChange={setRevolving}
        label="This is a credit card"
        hint="Cards keep absorbing new spending. A loan just gets paid down."
      />
      <Toggle checked={active} onChange={setActive} label="Counting this" />
    </Sheet>
  );
}

/** Exported so the What-if screen can describe a debt payoff in plain words. */
export function describePayoff(months: number | null): string {
  return months === null ? 'never on this plan' : humanizeMonths(months);
}
