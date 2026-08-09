import { useState } from 'react';
import { useStore } from '../store/useStore';
import { CURRENCIES, formatMoney } from '../domain/format';
import { GOAL_COLORS, GOAL_EMOJIS } from '../domain/types';
import { addMonths, currentMonthKey, endOfMonthISO, todayISO } from '../domain/dates';
import { maxZero } from '../domain/money';
import { AmountInput, Field, Select, TextInput, Toggle } from '../components/ui';

type Step = 'welcome' | 'currency' | 'income' | 'spending' | 'goal';

const ORDER: Step[] = ['welcome', 'currency', 'income', 'spending', 'goal'];

/**
 * A short setup that gets the app to a real answer on the first run. Everything
 * asked for here can be changed later, and the last step is the one that makes
 * the dashboard mean something — so nothing else is allowed to creep in.
 */
export default function Onboarding() {
  const updateSettings = useStore((s) => s.updateSettings);
  const addIncome = useStore((s) => s.addIncome);
  const addExpense = useStore((s) => s.addExpense);
  const addDebt = useStore((s) => s.addDebt);
  const addGoal = useStore((s) => s.addGoal);
  const settings = useStore((s) => s.settings);

  const [step, setStep] = useState<Step>('welcome');

  const [currency, setCurrency] = useState(settings.currency);
  const [incomeCents, setIncomeCents] = useState(0);
  const [expenseCents, setExpenseCents] = useState(0);
  const [hasCard, setHasCard] = useState(false);
  const [cardBalanceCents, setCardBalanceCents] = useState(0);
  const [cardMinCents, setCardMinCents] = useState(0);
  const [goalName, setGoalName] = useState('');
  const [goalTargetCents, setGoalTargetCents] = useState(0);
  const [goalSavedCents, setGoalSavedCents] = useState(0);
  const [hasDeadline, setHasDeadline] = useState(false);
  const [goalDate, setGoalDate] = useState(endOfMonthISO(addMonths(currentMonthKey(), 24)));

  const index = ORDER.indexOf(step);
  const locale = CURRENCIES.find((c) => c.code === currency)?.locale ?? 'en-IN';

  const next = () => {
    const nextStep = ORDER[index + 1];
    if (nextStep) setStep(nextStep);
  };
  const back = () => {
    const previous = ORDER[index - 1];
    if (previous) setStep(previous);
  };

  const finish = () => {
    updateSettings({ currency, locale, onboarded: true });

    if (incomeCents > 0) {
      addIncome({ name: 'Take-home pay', amountCents: incomeCents, frequency: 'monthly', active: true });
    }
    if (expenseCents > 0) {
      addExpense({
        name: 'Monthly living costs',
        amountCents: expenseCents,
        frequency: 'monthly',
        category: 'Housing',
        account: 'debit',
        // A single blended figure is part rent and part discretionary, so it is
        // not marked must-pay. Splitting it up under Money is what makes the
        // trim-spending lever meaningful.
        essential: false,
        active: true,
      });
    }
    if (hasCard && cardBalanceCents > 0) {
      addDebt({
        name: 'Credit card',
        balanceCents: cardBalanceCents,
        aprRate: 0.36,
        minPaymentCents: cardMinCents,
        revolving: true,
        active: true,
      });
    }
    if (goalName.trim() && goalTargetCents > 0) {
      addGoal({
        name: goalName.trim(),
        emoji: GOAL_EMOJIS[0] ?? '🎯',
        color: GOAL_COLORS[0] ?? '#6366f1',
        targetCents: goalTargetCents,
        savedCents: maxZero(goalSavedCents),
        targetDate: hasDeadline ? goalDate : undefined,
        priority: 1,
        annualReturnRate: 0,
        archived: false,
        createdAt: todayISO(),
      });
    }
  };

  const spare = maxZero(incomeCents - expenseCents);

  return (
    <div className="app">
      <main className="app__main" style={{ paddingBottom: 32 }}>
        <div className="screen" style={{ minHeight: '78vh' }}>
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            {ORDER.map((s, i) => (
              <div
                key={s}
                style={{
                  height: 3,
                  flex: 1,
                  borderRadius: 999,
                  background: i <= index ? 'var(--accent)' : 'var(--surface-2)',
                  transition: 'background 0.3s ease',
                }}
              />
            ))}
          </div>

          {step === 'welcome' && (
            <div className="stack" style={{ gap: 18, marginTop: 24 }}>
              <div style={{ fontSize: 56 }}>🎯</div>
              <h1 className="screen__title" style={{ fontSize: 32 }}>
                Know the date, not just the dream.
              </h1>
              <p className="screen__sub" style={{ fontSize: 15 }}>
                Tell GoalVault what you earn, what you spend and what you owe. It works out exactly
                how much to put aside each day, month or year — and the date every goal actually
                lands.
              </p>
              <ul className="stack" style={{ gap: 10, listStyle: 'none', padding: 0, margin: 0 }}>
                {[
                  ['📅', 'A real finish date for every goal'],
                  ['💳', 'Card interest and repayments built in'],
                  ['🔥', 'Streaks that keep the habit going'],
                  ['🎛️', 'Sliders to see what changes what'],
                ].map(([glyph, text]) => (
                  <li key={text} className="row" style={{ gap: 12 }}>
                    <span className="avatar" style={{ background: 'var(--surface-2)' }}>
                      {glyph}
                    </span>
                    <span className="small">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 'currency' && (
            <Step title="Which currency?" subtitle="You can change this any time.">
              <Field label="Currency">
                <Select
                  value={currency}
                  onChange={setCurrency}
                  options={CURRENCIES.map((c) => ({
                    value: c.code,
                    label: `${c.symbol}  ${c.name}`,
                  }))}
                />
              </Field>
            </Step>
          )}

          {step === 'income' && (
            <Step
              title="What lands in your account each month?"
              subtitle="Take-home pay, after tax. Add other income later under Money."
            >
              <Field label="Monthly income">
                <AmountInput
                  cents={incomeCents}
                  onChange={setIncomeCents}
                  currency={currency}
                  autoFocus
                />
              </Field>
            </Step>
          )}

          {step === 'spending' && (
            <Step
              title="And what goes out?"
              subtitle="Rent, food, bills, transport — the things that leave your account every month. Be honest; the date depends on it."
            >
              <Field label="Monthly living costs">
                <AmountInput
                  cents={expenseCents}
                  onChange={setExpenseCents}
                  currency={currency}
                  autoFocus
                />
              </Field>

              {incomeCents > 0 && (
                <div className={spare > 0 ? 'notice notice--info' : 'notice notice--warning'}>
                  <span className="notice__glyph" aria-hidden="true">
                    {spare > 0 ? '💡' : '⚠️'}
                  </span>
                  <div>
                    <div className="notice__title">
                      {spare > 0
                        ? `${formatMoney(spare, currency, locale)} spare a month`
                        : 'Nothing spare yet'}
                    </div>
                    <div className="notice__detail">
                      {spare > 0
                        ? 'This is what the plan has to work with before debt repayments.'
                        : 'Your costs match or beat your income. Add your goal anyway — the app will show what needs to change.'}
                    </div>
                  </div>
                </div>
              )}

              <div className="divider" />

              <Toggle
                checked={hasCard}
                onChange={setHasCard}
                label="I have a credit card balance"
                hint="Interest gets worked into your finish dates."
              />

              {hasCard && (
                <>
                  <Field label="Balance owed">
                    <AmountInput
                      cents={cardBalanceCents}
                      onChange={setCardBalanceCents}
                      currency={currency}
                    />
                  </Field>
                  <Field label="Minimum payment a month">
                    <AmountInput
                      cents={cardMinCents}
                      onChange={setCardMinCents}
                      currency={currency}
                    />
                  </Field>
                </>
              )}
            </Step>
          )}

          {step === 'goal' && (
            <Step
              title="What are you saving for?"
              subtitle="Start with one. You can add as many as you like afterwards."
            >
              <Field label="Goal">
                <TextInput
                  value={goalName}
                  onChange={setGoalName}
                  placeholder="House deposit"
                  autoFocus
                  maxLength={60}
                />
              </Field>
              <Field label="How much do you need?">
                <AmountInput
                  cents={goalTargetCents}
                  onChange={setGoalTargetCents}
                  currency={currency}
                />
              </Field>
              <Field label="Already saved">
                <AmountInput
                  cents={goalSavedCents}
                  onChange={setGoalSavedCents}
                  currency={currency}
                />
              </Field>
              <Toggle
                checked={hasDeadline}
                onChange={setHasDeadline}
                label="I need it by a certain date"
                hint="Leave off and the app tells you the earliest you can get there."
              />
              {hasDeadline && (
                <Field label="By when">
                  <input
                    className="input"
                    type="date"
                    value={goalDate}
                    min={todayISO()}
                    onChange={(e) => setGoalDate(e.target.value)}
                  />
                </Field>
              )}
            </Step>
          )}

          <div className="spacer" />

          <div className="row" style={{ gap: 10, marginTop: 24 }}>
            {index > 0 && (
              <button type="button" className="btn btn--ghost" onClick={back}>
                Back
              </button>
            )}
            {step === 'goal' ? (
              <button
                type="button"
                className="btn btn--primary"
                style={{ flex: 1 }}
                onClick={finish}
                disabled={!goalName.trim() || goalTargetCents <= 0}
              >
                See my plan
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--primary"
                style={{ flex: 1 }}
                onClick={next}
                disabled={step === 'income' && incomeCents <= 0}
              >
                Continue
              </button>
            )}
          </div>

          {step === 'welcome' && (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => updateSettings({ onboarded: true })}
            >
              Skip setup
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function Step({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="stack" style={{ gap: 16, marginTop: 20 }}>
      <h1 className="screen__title" style={{ fontSize: 26 }}>
        {title}
      </h1>
      <p className="screen__sub" style={{ marginTop: -4 }}>
        {subtitle}
      </p>
      <div className="stack" style={{ gap: 16, marginTop: 4 }}>
        {children}
      </div>
    </div>
  );
}
