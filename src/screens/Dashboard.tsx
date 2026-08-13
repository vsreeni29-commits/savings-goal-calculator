import { useMemo } from 'react';
import type { Projection } from '../domain/engine';
import { debtHint } from '../domain/engine';
import type { Route } from '../App';
import { useStore } from '../store/useStore';
import { useTracking } from '../store/hooks';
import { VIEW_MODES, formatMoney, perView, viewLabel } from '../domain/format';
import { formatMonthKey, humanizeMonths } from '../domain/dates';
import { Bar, Card, Chip, EmptyState, Metric, Money, Segmented } from '../components/ui';
import { CashFlowBar, GoalTimeline, ProjectionChart } from '../components/charts';

export default function Dashboard({
  projection,
  onNavigate,
}: {
  projection: Projection;
  onNavigate: (route: Route) => void;
}) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const goals = useStore((s) => s.goals);
  const tracking = useTracking(projection);

  const { currency, locale, viewMode } = settings;
  const cash = projection.cashFlow;

  const liveGoals = useMemo(() => goals.filter((g) => !g.archived), [goals]);
  const sortedGoals = useMemo(
    () =>
      [...projection.goals].sort((a, b) => {
        // Soonest finish first; anything unreachable sinks to the bottom.
        const aMonths = a.monthsToComplete ?? Number.POSITIVE_INFINITY;
        const bMonths = b.monthsToComplete ?? Number.POSITIVE_INFINITY;
        return aMonths - bMonths;
      }),
    [projection.goals],
  );

  if (liveGoals.length === 0) {
    return (
      <div className="screen">
        <Header onNavigate={onNavigate} />
        <Card>
          <EmptyState
            glyph="🎯"
            title="Set your first goal"
            text="Tell the app what you are saving for and what you earn and spend. It works out the date you get there — and what it takes to get there sooner."
            action={
              <button type="button" className="btn btn--primary" onClick={() => onNavigate('goals')}>
                Add a goal
              </button>
            }
          />
        </Card>
      </div>
    );
  }

  const perViewAmount = perView(cash.toGoalsCents, viewMode);
  const finishMonth = projection.allGoalsCompleteMonth;
  const monthsAway = projection.monthsToAllGoals;

  return (
    <div className="screen">
      <Header onNavigate={onNavigate} />

      <section className="hero">
        <div className="hero__label">
          {finishMonth ? 'Every goal is funded by' : 'Not every goal lands on this plan'}
        </div>
        <div className={finishMonth ? 'hero__value' : 'hero__value hero__value--sm'}>
          {finishMonth ? formatMonthKey(finishMonth) : 'Needs a change'}
        </div>
        <div className="hero__note">
          {finishMonth && monthsAway !== null ? (
            <>
              That is {humanizeMonths(monthsAway)} away, saving{' '}
              <strong className="num">
                {formatMoney(perViewAmount, currency, locale)}
              </strong>{' '}
              {viewLabel(viewMode)}.
            </>
          ) : (
            'Some goals never get there with the money currently going into them. The warnings below say what to change.'
          )}
        </div>
      </section>

      <Segmented
        label="Timescale"
        options={VIEW_MODES.map((v) => ({ id: v.id, label: v.short }))}
        value={viewMode}
        onChange={(next) => updateSettings({ viewMode: next })}
      />

      {projection.warnings.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {projection.warnings.slice(0, 3).map((w) => (
            <div key={w.id} className={`notice notice--${w.severity}`}>
              <span className="notice__glyph" aria-hidden="true">
                {w.severity === 'critical' ? '⛔' : w.severity === 'warning' ? '⚠️' : '💡'}
              </span>
              <div>
                <div className="notice__title">{w.title}</div>
                <div className="notice__detail">{w.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid-2">
        <Metric
          label="Coming in"
          value={<Money cents={cash.incomeCents} currency={currency} locale={locale} compact />}
          hint="a month"
        />
        <Metric
          label="Spare"
          value={
            <Money
              cents={cash.surplusCents}
              currency={currency}
              locale={locale}
              compact
              signed
            />
          }
          hint="after bills and minimums"
          tone={cash.surplusCents > 0 ? 'good' : 'bad'}
        />
        <Metric
          label="To goals"
          value={<Money cents={cash.toGoalsCents} currency={currency} locale={locale} compact />}
          hint={`${formatMoney(perViewAmount, currency, locale)} ${viewLabel(viewMode)}`}
        />
        <Metric
          label="To debt"
          value={
            <Money
              cents={cash.minDebtPaymentCents + cash.extraDebtCents}
              currency={currency}
              locale={locale}
              compact
            />
          }
          hint={debtHint(projection)}
          tone={projection.debts.some((d) => d.growing) ? 'bad' : undefined}
        />
      </div>

      <Card title="Where your income goes">
        <CashFlowBar
          currency={currency}
          locale={locale}
          segments={[
            { label: 'Living costs', cents: cash.debitExpenseCents, color: 'var(--text-faint)' },
            {
              label: 'Debt',
              cents: cash.minDebtPaymentCents + cash.extraDebtCents,
              color: 'var(--bad)',
            },
            { label: 'Goals', cents: cash.toGoalsCents, color: 'var(--accent)' },
            { label: 'Buffer', cents: cash.bufferCents, color: 'var(--accent-2)' },
            { label: 'Unallocated', cents: cash.lifestyleCents, color: 'var(--warn)' },
          ]}
        />
      </Card>

      <Card
        title="Savings over time"
        action={
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => onNavigate('forecast')}
          >
            Full forecast
          </button>
        }
      >
        <ProjectionChart months={projection.months} currency={currency} locale={locale} />
      </Card>

      <Card title="When each goal lands">
        <GoalTimeline projection={projection} />
      </Card>

      <Card
        title="Your goals"
        action={
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onNavigate('goals')}>
            See all
          </button>
        }
      >
        <div className="stack" style={{ gap: 14 }}>
          {sortedGoals.slice(0, 3).map((g) => (
            <div key={g.goalId}>
              <div className="row row--between" style={{ marginBottom: 6 }}>
                <span className="truncate strong" style={{ fontSize: 14.5 }}>
                  {g.emoji} {g.name}
                </span>
                <span className="small dim num">
                  {formatMoney(g.startingSavedCents, currency, locale, { compact: true })} /{' '}
                  {formatMoney(g.targetCents, currency, locale, { compact: true })}
                </span>
              </div>
              <Bar ratio={g.progressRatio} color={g.color} />
              <div className="row row--between tiny dim" style={{ marginTop: 5 }}>
                <span>
                  {formatMoney(perView(g.plannedMonthlyCents, viewMode), currency, locale)}{' '}
                  {viewLabel(viewMode)}
                </span>
                <span>
                  {g.completionMonth ? formatMonthKey(g.completionMonth, 'short') : 'not funded'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Momentum"
        action={
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => onNavigate('track')}>
            Track
          </button>
        }
      >
        <div className="streak">
          <span className="streak__flame" aria-hidden="true">
            {tracking.streaks.current > 0 ? '🔥' : '🌱'}
          </span>
          <div>
            <div className="streak__count">
              {tracking.streaks.current}
              <span className="small dim unit">
                {tracking.streaks.current === 1 ? 'month' : 'months'}
              </span>
            </div>
            <div className="small dim" style={{ marginTop: 3 }}>
              {tracking.streaks.current > 0
                ? `Best run so far: ${tracking.streaks.best}`
                : 'Log a deposit to start your streak.'}
            </div>
          </div>
          <div className="spacer" />
          {projection.feasible ? (
            <Chip tone="good">on track</Chip>
          ) : (
            <Chip tone="warn">needs a tweak</Chip>
          )}
        </div>
      </Card>
    </div>
  );
}

function Header({ onNavigate }: { onNavigate: (route: Route) => void }) {
  return (
    <div className="screen__head">
      <div>
        <h1 className="screen__title">GoalVault</h1>
        <p className="screen__sub">Your money, pointed at what you actually want.</p>
      </div>
      <button
        type="button"
        className="icon-btn"
        aria-label="Settings"
        onClick={() => onNavigate('settings')}
      >
        ⚙️
      </button>
    </div>
  );
}
