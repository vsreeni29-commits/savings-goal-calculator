import { useMemo, useState } from 'react';
import type { Projection } from '../domain/engine';
import { monthlyExpenseCents } from '../domain/engine';
import { useAppData } from '../store/hooks';
import { useStore } from '../store/useStore';
import {
  type ScenarioKnobs,
  isUntouched,
  knobsFrom,
  projectScenario,
  solveForDate,
} from '../domain/scenario';
import { VIEW_MODES, formatMoney, perView, viewLabel } from '../domain/format';
import {
  addMonths,
  currentMonthKey,
  formatMonthKey,
  humanizeMonths,
  monthsBetween,
} from '../domain/dates';
import {
  AmountInput,
  Card,
  Chip,
  Field,
  Money,
  Segmented,
  Toast,
  useToast,
} from '../components/ui';
import { ProjectionChart } from '../components/charts';

export default function PlanScreen({ projection }: { projection: Projection }) {
  const data = useAppData();
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const [toast, showToast] = useToast();

  const [knobs, setKnobs] = useState<ScenarioKnobs>(() => knobsFrom(data));
  const [targetMonth, setTargetMonth] = useState(() =>
    addMonths(currentMonthKey(), 24),
  );

  const { currency, locale, viewMode } = settings;

  // How much spending the trim lever can actually reach. Without this the
  // slider looks broken when every expense is marked must-pay.
  const trimmableCents = useMemo(
    () => monthlyExpenseCents(data.expenses.filter((e) => !e.essential)),
    [data.expenses],
  );

  const scenario = useMemo(() => projectScenario(data, knobs), [data, knobs]);
  const solved = useMemo(
    () => solveForDate(data, knobs, targetMonth),
    [data, knobs, targetMonth],
  );

  const set = <K extends keyof ScenarioKnobs>(key: K, value: ScenarioKnobs[K]) =>
    setKnobs((current) => ({ ...current, [key]: value }));

  const unchanged = isUntouched(knobs, data);

  const baseMonth = projection.allGoalsCompleteMonth;
  const scenarioMonth = scenario.allGoalsCompleteMonth;
  const monthsSaved =
    baseMonth && scenarioMonth ? monthsBetween(scenarioMonth, baseMonth) : null;

  const apply = () => {
    // Only the settings knobs can be committed — extra income and a spending
    // cut are hypotheticals, and writing them into the plan as fact would be
    // a lie about the user's actual finances.
    updateSettings({
      savingsFactor: knobs.savingsFactor,
      bufferCents: knobs.bufferCents,
      debtExtraShare: knobs.debtExtraShare,
      allocationStrategy: knobs.allocationStrategy,
    });
    showToast('Settings applied to your plan');
  };

  return (
    <div className="screen">
      <div className="screen__head">
        <div>
          <h1 className="screen__title">What if</h1>
          <p className="screen__sub">
            Move the sliders and watch the finish date move. Nothing here changes your plan until
            you say so.
          </p>
        </div>
      </div>

      <section className="hero">
        <div className="hero__label">On this scenario, everything is funded by</div>
        <div className={scenarioMonth ? 'hero__value' : 'hero__value hero__value--sm'}>
          {scenarioMonth ? formatMonthKey(scenarioMonth) : 'Still out of reach'}
        </div>
        <div className="hero__note">
          {baseMonth && scenarioMonth && monthsSaved !== null && monthsSaved !== 0 ? (
            <>
              {monthsSaved > 0 ? (
                <span className="good strong">{humanizeMonths(monthsSaved)} sooner</span>
              ) : (
                <span className="bad strong">{humanizeMonths(-monthsSaved)} later</span>
              )}{' '}
              than your plan today ({formatMonthKey(baseMonth, 'short')}).
            </>
          ) : baseMonth && scenarioMonth ? (
            'Same as your plan today.'
          ) : (
            'Add more to the plan, or cut something, to bring every goal into reach.'
          )}
        </div>
        <div className="row" style={{ marginTop: 14, gap: 10 }}>
          <Chip tone="accent">
            {formatMoney(perView(scenario.cashFlow.toGoalsCents, viewMode), currency, locale)}{' '}
            {viewLabel(viewMode)}
          </Chip>
          {!unchanged && (
            <button type="button" className="btn btn--sm" onClick={() => setKnobs(knobsFrom(data))}>
              Reset
            </button>
          )}
        </div>
      </section>

      <Segmented
        label="Timescale"
        options={VIEW_MODES.map((v) => ({ id: v.id, label: v.short }))}
        value={viewMode}
        onChange={(next) => updateSettings({ viewMode: next })}
      />

      <Card title="Work backwards from a date">
        <Field
          label="I want everything done by"
          hint="The app works out what it would take to get there."
        >
          <input
            className="input"
            type="month"
            value={targetMonth}
            min={currentMonthKey()}
            onChange={(e) => {
              if (e.target.value) setTargetMonth(e.target.value);
            }}
          />
        </Field>

        <div style={{ height: 12 }} />

        {solved === null ? (
          <div className="notice notice--warning">
            <span className="notice__glyph" aria-hidden="true">
              ⚠️
            </span>
            <div>
              <div className="notice__title">That date cannot be reached</div>
              <div className="notice__detail">
                Even with unlimited income the goals cannot all land by then — a target date on one
                of your goals is probably in the way. Try a later month.
              </div>
            </div>
          </div>
        ) : solved.extraIncomeCents === 0 ? (
          <div className="notice notice--info">
            <span className="notice__glyph" aria-hidden="true">
              ✅
            </span>
            <div>
              <div className="notice__title">Already there</div>
              <div className="notice__detail">
                This scenario reaches every goal by {formatMonthKey(targetMonth)} with nothing extra.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="hero__label">To hit {formatMonthKey(targetMonth)} you need</div>
            <div className="hero__value hero__value--sm" style={{ marginTop: 4 }}>
              <Money
                cents={perView(solved.toGoalsCents, viewMode)}
                currency={currency}
                locale={locale}
              />
              <span className="small dim" style={{ fontWeight: 500 }}>
                {' '}
                {viewLabel(viewMode)}
              </span>
            </div>
            <div className="small dim" style={{ marginTop: 6 }}>
              That is{' '}
              <strong className="num">
                {formatMoney(perView(solved.additionalToGoalsCents, viewMode), currency, locale)}
              </strong>{' '}
              more than this scenario manages — about{' '}
              <strong className="num">
                {formatMoney(solved.extraIncomeCents, currency, locale)}
              </strong>{' '}
              a month of extra income, or the same again cut from spending.
            </div>
            <button
              type="button"
              className="btn btn--sm"
              style={{ marginTop: 12 }}
              onClick={() => set('extraIncomeCents', solved.extraIncomeCents)}
            >
              Try it in the sliders
            </button>
          </>
        )}
      </Card>

      <Card title="Turn the knobs">
        <div className="stack" style={{ gap: 20 }}>
          <Knob
            label="Save this much of what is spare"
            value={`${Math.round(knobs.savingsFactor * 100)}%`}
            hint="The rest is yours to spend without guilt."
          >
            <input
              className="slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(knobs.savingsFactor * 100)}
              aria-label="Savings factor"
              onChange={(e) => set('savingsFactor', Number(e.target.value) / 100)}
            />
          </Knob>

          <Knob
            label="Trim spending you could live without"
            value={`${Math.round(knobs.expenseCutShare * 100)}%`}
            hint={
              trimmableCents > 0
                ? `Applies to ${formatMoney(trimmableCents, currency, locale)} a month of spending you have not marked as must-pay.`
                : 'Every expense is marked must-pay, so this lever has nothing to work with. Untick "Cannot be cut" on something under Money.'
            }
          >
            <input
              className="slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(knobs.expenseCutShare * 100)}
              aria-label="Spending cut"
              disabled={trimmableCents <= 0}
              onChange={(e) => set('expenseCutShare', Number(e.target.value) / 100)}
            />
          </Knob>

          <Knob
            label="Spare cash going at debt"
            value={`${Math.round(knobs.debtExtraShare * 100)}%`}
            hint="Above the minimum payments."
          >
            <input
              className="slider"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(knobs.debtExtraShare * 100)}
              aria-label="Debt share"
              onChange={(e) => set('debtExtraShare', Number(e.target.value) / 100)}
            />
          </Knob>

          <Field label="Extra income each month" hint="A raise, a side project, a lodger.">
            <AmountInput
              cents={knobs.extraIncomeCents}
              onChange={(value) => set('extraIncomeCents', value)}
              currency={currency}
            />
          </Field>

          <Field
            label="Untouchable buffer"
            hint="Cash held back every month before anything is allocated."
          >
            <AmountInput
              cents={knobs.bufferCents}
              onChange={(value) => set('bufferCents', value)}
              currency={currency}
            />
          </Field>

          <Field
            label="How to share money between goals"
            hint="Deadlines are always funded first. This decides what happens to whatever is left."
          >
            <Segmented
              label="Allocation"
              options={[
                { id: 'priority' as const, label: 'Top first' },
                { id: 'balanced' as const, label: 'Split' },
                { id: 'fastestFirst' as const, label: 'Quick wins' },
              ]}
              value={knobs.allocationStrategy}
              onChange={(next) => set('allocationStrategy', next)}
            />
          </Field>
        </div>
      </Card>

      <Card title="Goals under this scenario">
        <div className="stack" style={{ gap: 10 }}>
          {scenario.goals.map((g) => {
            const baseline = projection.goals.find((b) => b.goalId === g.goalId);
            const shift =
              baseline?.monthsToComplete != null && g.monthsToComplete != null
                ? baseline.monthsToComplete - g.monthsToComplete
                : null;
            return (
              <div key={g.goalId} className="row row--between">
                <span className="truncate" style={{ maxWidth: '52%' }}>
                  {g.emoji} {g.name}
                </span>
                <span className="row" style={{ gap: 8 }}>
                  <span className="small dim">
                    {g.completionMonth ? formatMonthKey(g.completionMonth, 'short') : 'never'}
                  </span>
                  {shift !== null && shift !== 0 && (
                    <Chip tone={shift > 0 ? 'good' : 'bad'}>
                      {shift > 0 ? `−${shift}` : `+${-shift}`} mo
                    </Chip>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Savings over time in this scenario">
        <ProjectionChart months={scenario.months} currency={currency} locale={locale} />
      </Card>

      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={apply}
        disabled={unchanged}
      >
        Apply these settings to my plan
      </button>
      <p className="tiny faint center" style={{ padding: '0 12px 8px' }}>
        Saves the savings factor, buffer, debt share and sharing rule. Extra income and the
        spending cut stay hypothetical — change them under Money when they are real.
      </p>

      <Toast message={toast} />
    </div>
  );
}

function Knob({
  label,
  value,
  hint,
  children,
}: {
  label: string;
  value: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="row row--between" style={{ marginBottom: 2 }}>
        <span className="field__label">{label}</span>
        <span className="num strong">{value}</span>
      </div>
      {children}
      <div className="field__hint">{hint}</div>
    </div>
  );
}
