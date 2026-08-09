import { useMemo, useState } from 'react';
import type { Projection } from '../domain/engine';
import { EXPENSE_CATEGORIES } from '../domain/types';
import type { AccountKind } from '../domain/types';
import { useStore } from '../store/useStore';
import { useTracking } from '../store/hooks';
import { formatMoney } from '../domain/format';
import { currentMonthKey, formatISODate, formatMonthKey, todayISO } from '../domain/dates';
import { maxZero } from '../domain/money';
import {
  AmountInput,
  Bar,
  Card,
  Chip,
  EmptyState,
  Field,
  Metric,
  Money,
  Segmented,
  Select,
  Sheet,
  TextInput,
  Toast,
  useToast,
} from '../components/ui';
import { MonthBars, SpendHeatmap } from '../components/charts';

export default function TrackScreen({ projection }: { projection: Projection }) {
  const settings = useStore((s) => s.settings);
  const goals = useStore((s) => s.goals);
  const spendLogs = useStore((s) => s.spendLogs);
  const removeSpendLog = useStore((s) => s.removeSpendLog);
  const tracking = useTracking(projection);

  const [sheet, setSheet] = useState<'spend' | 'deposit' | null>(null);
  const [toast, showToast] = useToast();

  const { currency, locale } = settings;
  const today = todayISO();
  const month = currentMonthKey();

  const recentSpend = useMemo(
    () =>
      [...spendLogs]
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
        .slice(0, 10),
    [spendLogs],
  );

  const monthTarget = projection.cashFlow.toGoalsCents;
  const monthSoFar =
    tracking.streaks.months.find((m) => m.month === month)?.actualCents ?? 0;

  const liveGoals = goals.filter((g) => !g.archived);

  return (
    <div className="screen">
      <div className="screen__head">
        <div>
          <h1 className="screen__title">Track</h1>
          <p className="screen__sub">
            What you actually did, next to what the plan asked for.
          </p>
        </div>
      </div>

      <section className="hero">
        <div className="streak">
          <span className="streak__flame" aria-hidden="true">
            {tracking.streaks.current > 0 ? '🔥' : '🌱'}
          </span>
          <div style={{ flex: 1 }}>
            <div className="streak__count">
              {tracking.streaks.current}
              <span className="small dim" style={{ fontWeight: 500 }}>
                {' '}
                month{tracking.streaks.current === 1 ? '' : 's'} in a row
              </span>
            </div>
            <div className="small dim" style={{ marginTop: 4 }}>
              {tracking.streaks.trackedCount > 0
                ? `${tracking.streaks.metCount} of ${tracking.streaks.trackedCount} months hit — best run ${tracking.streaks.best}`
                : 'Log your first deposit to get going.'}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="row row--between small" style={{ marginBottom: 6 }}>
            <span className="dim">{formatMonthKey(month)} so far</span>
            <span className="num strong">
              {formatMoney(monthSoFar, currency, locale, { compact: true })} /{' '}
              {formatMoney(monthTarget, currency, locale, { compact: true })}
            </span>
          </div>
          <Bar ratio={monthTarget > 0 ? monthSoFar / monthTarget : 0} />
          <div className="tiny dim" style={{ marginTop: 6 }}>
            {monthTarget > 0 && monthSoFar < monthTarget ? (
              <>
                <strong className="num">
                  {formatMoney(maxZero(monthTarget - monthSoFar), currency, locale)}
                </strong>{' '}
                to go this month.
              </>
            ) : monthTarget > 0 ? (
              'Target met for this month. Nice.'
            ) : (
              'Set your income and expenses to get a monthly target.'
            )}
          </div>
        </div>
      </section>

      <div className="row" style={{ gap: 10 }}>
        <button
          type="button"
          className="btn btn--primary"
          style={{ flex: 1 }}
          onClick={() => setSheet('deposit')}
          disabled={liveGoals.length === 0}
        >
          ＋ Deposit
        </button>
        <button
          type="button"
          className="btn"
          style={{ flex: 1 }}
          onClick={() => setSheet('spend')}
        >
          ＋ Spending
        </button>
      </div>

      <Card title="Month by month">
        <MonthBars months={tracking.streaks.months} currency={currency} locale={locale} />
        <div className="tiny faint" style={{ marginTop: 8 }}>
          Past months are measured against the target you are working to now — the app does not
          keep a history of old plans.
        </div>
      </Card>

      <Card title={`Spending in ${formatMonthKey(month)}`}>
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <Metric
            label="Logged"
            value={<Money cents={tracking.spend.totalCents} currency={currency} locale={locale} compact />}
            hint={`budget ${formatMoney(tracking.spend.budgetCents, currency, locale, { compact: true })}`}
            tone={
              tracking.spend.budgetCents > 0 && tracking.spend.totalCents > tracking.spend.budgetCents
                ? 'bad'
                : undefined
            }
          />
          <Metric
            label="Quiet days"
            value={`${tracking.spend.noSpendStreak}`}
            hint={`best run ${tracking.spend.bestNoSpendStreak}`}
            tone={tracking.spend.noSpendStreak >= 3 ? 'good' : undefined}
          />
        </div>

        {tracking.spend.trackedDays === 0 ? (
          <EmptyState
            glyph="📓"
            title="Nothing logged yet"
            text="Log what you spend and the calendar fills in. Days you spend nothing at all count as a quiet day."
            action={
              <button type="button" className="btn btn--primary" onClick={() => setSheet('spend')}>
                Log spending
              </button>
            }
          />
        ) : (
          <SpendHeatmap days={tracking.spend.days} month={month} today={today} />
        )}
      </Card>

      {tracking.spend.byCategory.length > 0 && (
        <Card title="Budget vs actual">
          <div className="stack" style={{ gap: 14 }}>
            {tracking.spend.byCategory.slice(0, 8).map((row) => {
              const over = row.budgetCents > 0 && row.spentCents > row.budgetCents;
              return (
                <div key={row.category}>
                  <div className="row row--between small" style={{ marginBottom: 5 }}>
                    <span className="strong">{row.category}</span>
                    <span className={over ? 'bad num' : 'dim num'}>
                      {formatMoney(row.spentCents, currency, locale, { compact: true })}
                      {row.budgetCents > 0 && (
                        <> / {formatMoney(row.budgetCents, currency, locale, { compact: true })}</>
                      )}
                    </span>
                  </div>
                  <Bar
                    ratio={row.budgetCents > 0 ? row.spentCents / row.budgetCents : 1}
                    color={over ? 'var(--bad)' : 'var(--accent-2)'}
                    thin
                  />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title="Milestones">
        <div>
          {tracking.milestones.map((m) => (
            <div
              key={m.id}
              className={m.achieved ? 'milestone milestone--done' : 'milestone milestone--locked'}
            >
              <span className="milestone__glyph" aria-hidden="true">
                {m.achieved ? m.emoji : '🔒'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row row--between">
                  <span className="strong small">{m.title}</span>
                  {m.achieved && <Chip tone="good">done</Chip>}
                </div>
                <div className="tiny dim" style={{ margin: '3px 0 6px' }}>
                  {m.detail}
                </div>
                {!m.achieved && <Bar ratio={m.progress} thin />}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {recentSpend.length > 0 && (
        <Card title="Recent spending">
          <div className="list">
            {recentSpend.map((log) => (
              <div key={log.id} className="list__item">
                <div className="list__body">
                  <div className="list__name">
                    {log.category} {log.account === 'credit' && <Chip>card</Chip>}
                  </div>
                  <div className="list__meta">
                    {formatISODate(log.date)}
                    {log.note ? ` — ${log.note}` : ''}
                  </div>
                </div>
                <div className="list__amount">
                  <Money cents={log.amountCents} currency={currency} locale={locale} />
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Delete entry"
                  onClick={() => {
                    removeSpendLog(log.id);
                    showToast('Entry removed');
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {sheet === 'spend' && (
        <SpendSheet
          currency={currency}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            showToast('Spending logged');
          }}
        />
      )}

      {sheet === 'deposit' && (
        <DepositSheet
          currency={currency}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            showToast('Deposit logged');
          }}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}

// -------------------------------------------------------------- log spend --

function SpendSheet({
  currency,
  onClose,
  onSaved,
}: {
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const addSpendLog = useStore((s) => s.addSpendLog);
  const [amountCents, setAmountCents] = useState(0);
  const [category, setCategory] = useState<string>('Food');
  const [account, setAccount] = useState<AccountKind>('debit');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  return (
    <Sheet
      open
      title="Log spending"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            style={{ flex: 1 }}
            disabled={amountCents <= 0}
            onClick={() => {
              if (amountCents <= 0) return;
              addSpendLog({
                amountCents,
                category,
                account,
                date,
                note: note.trim() || undefined,
              });
              onSaved();
            }}
          >
            Log it
          </button>
        </>
      }
    >
      <Field label="How much">
        <AmountInput cents={amountCents} onChange={setAmountCents} currency={currency} autoFocus />
      </Field>
      <Field label="Category">
        <Select
          value={category}
          onChange={setCategory}
          options={EXPENSE_CATEGORIES.map((c) => ({ value: c as string, label: c }))}
        />
      </Field>
      <Field label="Paid with">
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
      <Field label="When">
        <input
          className="input"
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label="Note">
        <TextInput value={note} onChange={setNote} placeholder="Optional" maxLength={100} />
      </Field>
    </Sheet>
  );
}

// ------------------------------------------------------------ log deposit --

function DepositSheet({
  currency,
  onClose,
  onSaved,
}: {
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const goals = useStore((s) => s.goals);
  const addContribution = useStore((s) => s.addContribution);
  const updateGoal = useStore((s) => s.updateGoal);

  const live = goals.filter((g) => !g.archived);
  const [goalId, setGoalId] = useState(live[0]?.id ?? '');
  const [amountCents, setAmountCents] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  const goal = live.find((g) => g.id === goalId);

  return (
    <Sheet
      open
      title="Log a deposit"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            style={{ flex: 1 }}
            disabled={amountCents <= 0 || !goal}
            onClick={() => {
              if (amountCents <= 0 || !goal) return;
              addContribution({ goalId: goal.id, amountCents, date, note: note.trim() || undefined });
              // The deposit is real money moved, so the goal balance moves too.
              updateGoal(goal.id, { savedCents: goal.savedCents + amountCents });
              onSaved();
            }}
          >
            Log it
          </button>
        </>
      }
    >
      <Field label="Which goal">
        <Select
          value={goalId}
          onChange={setGoalId}
          options={live.map((g) => ({ value: g.id, label: `${g.emoji} ${g.name}` }))}
        />
      </Field>
      <Field label="How much">
        <AmountInput cents={amountCents} onChange={setAmountCents} currency={currency} autoFocus />
      </Field>
      <Field label="When">
        <input
          className="input"
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => setDate(e.target.value)}
        />
      </Field>
      <Field label="Note">
        <TextInput value={note} onChange={setNote} placeholder="Optional" maxLength={100} />
      </Field>
    </Sheet>
  );
}
