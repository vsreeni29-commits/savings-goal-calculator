import { useMemo, useState } from 'react';
import type { Projection } from '../domain/engine';
import {
  buildForecast,
  describeEvent,
  fullReportCsv,
  monthlyReportCsv,
  yearlyReportCsv,
} from '../domain/forecast';
import { useStore } from '../store/useStore';
import { saveTextFile } from '../store/exportFile';
import { formatMoney } from '../domain/format';
import { currentMonthKey, formatMonthKey, humanizeMonths } from '../domain/dates';
import { Card, Chip, EmptyState, Metric, Money, Segmented, Toast, useToast } from '../components/ui';
import { CapacityChart } from '../components/charts';

type Grain = 'month' | 'year';

/** Months shown in the table before it is cut off. Exports carry everything. */
const TABLE_LIMIT = 120;

export default function ForecastScreen({ projection }: { projection: Projection }) {
  const settings = useStore((s) => s.settings);
  const goals = useStore((s) => s.goals);
  const [grain, setGrain] = useState<Grain>('month');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);

  const { currency, locale } = settings;
  const forecast = useMemo(() => buildForecast(projection), [projection]);

  const liveGoals = goals.filter((g) => !g.archived);

  if (liveGoals.length === 0 || forecast.rows.length === 0) {
    return (
      <div className="screen">
        <Header />
        <Card>
          <EmptyState
            glyph="📈"
            title="Nothing to forecast yet"
            text="Add a goal and your income, and this becomes a month-by-month picture of what you will have put aside, and when each payment you are clearing frees itself up."
          />
        </Card>
      </div>
    );
  }

  const download = async (kind: 'month' | 'year' | 'full') => {
    setBusy(true);
    const stamp = currentMonthKey();
    const file =
      kind === 'month'
        ? { name: `goalvault-monthly-${stamp}.csv`, body: monthlyReportCsv(forecast, projection, currency) }
        : kind === 'year'
          ? { name: `goalvault-yearly-${stamp}.csv`, body: yearlyReportCsv(forecast, currency) }
          : {
              name: `goalvault-forecast-${stamp}.csv`,
              body: fullReportCsv(forecast, projection, currency, locale),
            };

    const result = await saveTextFile(file.name, file.body, { title: 'GoalVault forecast' });
    setBusy(false);
    if (result.ok) showToast(result.how === 'share' ? 'Choose where to save it' : 'Report downloaded');
    else if (result.error !== 'cancelled') showToast(result.error);
  };

  const growth = forecast.peakPoolCents - forecast.startingPoolCents;
  const shownRows = forecast.rows.slice(0, TABLE_LIMIT);

  return (
    <div className="screen">
      <Header />

      <section className="hero">
        <div className="hero__label">Money going into goals each month</div>
        <div className="hero__value hero__value--sm">
          <Money cents={forecast.startingPoolCents} currency={currency} locale={locale} />
          {growth > 0 && (
            <>
              <span className="dim" style={{ fontWeight: 500 }}> → </span>
              <span className="good">
                {formatMoney(forecast.peakPoolCents, currency, locale)}
              </span>
            </>
          )}
        </div>
        <div className="hero__note">
          {growth > 0 ? (
            <>
              Your monthly saving grows by{' '}
              <strong className="num good">{formatMoney(growth, currency, locale)}</strong> as goals
              land and the payments tied to them stop.
            </>
          ) : (
            'Your monthly saving stays flat across this plan — no expense is tied to a goal yet.'
          )}
        </div>
      </section>

      <div className="grid-2">
        <Metric
          label="Saved in total"
          value={
            <Money cents={forecast.totalContributedCents} currency={currency} locale={locale} compact />
          }
          hint={forecast.lastMonth ? `by ${formatMonthKey(forecast.lastMonth, 'short')}` : undefined}
        />
        <Metric
          label="Payments freed"
          value={<Money cents={forecast.totalFreedCents} currency={currency} locale={locale} compact />}
          hint="a month, by the end"
          tone={forecast.totalFreedCents > 0 ? 'good' : undefined}
        />
        <Metric
          label="Growth earned"
          value={<Money cents={forecast.totalGrowthCents} currency={currency} locale={locale} compact />}
          hint="interest and returns"
        />
        <Metric
          label="Plan length"
          value={humanizeMonths(forecast.rows.length)}
          hint={`${forecast.events.length} goal${forecast.events.length === 1 ? '' : 's'} land`}
        />
      </div>

      <Card title="Monthly saving over time">
        <CapacityChart forecast={forecast} currency={currency} locale={locale} />
        <div className="tiny faint" style={{ marginTop: 10 }}>
          Each step up is a goal landing and its payments stopping. The line is what goes into
          goals, not what you earn.
        </div>
      </Card>

      {forecast.events.length > 0 && (
        <Card title="What changes, and when">
          <div className="stack" style={{ gap: 0 }}>
            {forecast.events.map((event) => (
              <div key={`${event.goalId}-${event.month}`} className="milestone">
                <span
                  className="milestone__glyph"
                  style={{ background: `${event.color}22`, color: event.color }}
                  aria-hidden="true"
                >
                  {event.emoji}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row row--between" style={{ gap: 8 }}>
                    <span className="strong small truncate">{event.goalName}</span>
                    <Chip tone="accent">{formatMonthKey(event.month, 'short')}</Chip>
                  </div>
                  <div className="tiny dim" style={{ marginTop: 4, lineHeight: 1.55 }}>
                    {describeEvent(event, currency, locale)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card
        title="The schedule"
        action={
          <Segmented
            label="Grain"
            options={[
              { id: 'month' as const, label: 'Monthly' },
              { id: 'year' as const, label: 'Yearly' },
            ]}
            value={grain}
            onChange={setGrain}
          />
        }
      >
        <div className="chart-scroll">
          {grain === 'year' ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="right">Saved</th>
                  <th className="right">Monthly at year end</th>
                  <th className="right">Total saved</th>
                  <th>Goals reached</th>
                </tr>
              </thead>
              <tbody>
                {forecast.years.map((y) => (
                  <tr key={y.year}>
                    <td className="strong">{y.year}</td>
                    <td className="right num">
                      {formatMoney(y.savedCents, currency, locale, { compact: true })}
                    </td>
                    <td className="right num">
                      {formatMoney(y.endingPoolCents, currency, locale, { compact: true })}
                    </td>
                    <td className="right num strong">
                      {formatMoney(y.totalSavedCents, currency, locale, { compact: true })}
                    </td>
                    <td className="dim">{y.goalsLanded.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="right">To goals</th>
                  <th className="right">Saved</th>
                  <th className="right">Freed</th>
                  <th className="right">Total saved</th>
                  <th>Reached</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r) => (
                  <tr key={r.month} className={r.completedGoalNames.length > 0 ? 'row-landmark' : undefined}>
                    <td>{formatMonthKey(r.month, 'short')}</td>
                    <td className="right num">
                      {formatMoney(r.poolCents, currency, locale, { compact: true })}
                    </td>
                    <td className="right num">
                      {formatMoney(r.contributedCents, currency, locale, { compact: true })}
                    </td>
                    <td className="right num good">
                      {r.freedExpenseCents > 0
                        ? formatMoney(r.freedExpenseCents, currency, locale, { compact: true })
                        : '—'}
                    </td>
                    <td className="right num strong">
                      {formatMoney(r.totalSavedCents, currency, locale, { compact: true })}
                    </td>
                    <td className="dim">{r.completedGoalNames.join(', ') || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {grain === 'month' && forecast.rows.length > TABLE_LIMIT && (
          <div className="tiny faint" style={{ marginTop: 10 }}>
            Showing the first {TABLE_LIMIT} months of {forecast.rows.length}. The downloaded report
            has every one.
          </div>
        )}
      </Card>

      <Card title="Download the report">
        <p className="small dim" style={{ marginBottom: 14, lineHeight: 1.55 }}>
          CSV files, ready for Excel or Google Sheets. The monthly report includes a column per goal
          so you can see exactly where each rupee goes.
        </p>
        <div className="stack" style={{ gap: 10 }}>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={busy}
            onClick={() => void download('full')}
          >
            ⬇ Everything in one file
          </button>
          <div className="row" style={{ gap: 10 }}>
            <button
              type="button"
              className="btn"
              style={{ flex: 1 }}
              disabled={busy}
              onClick={() => void download('month')}
            >
              Month by month
            </button>
            <button
              type="button"
              className="btn"
              style={{ flex: 1 }}
              disabled={busy}
              onClick={() => void download('year')}
            >
              Year by year
            </button>
          </div>
        </div>
      </Card>

      <p className="tiny faint center" style={{ padding: '0 12px 8px' }}>
        A projection, not a promise. It assumes your income, spending and rates stay as you have
        entered them.
      </p>

      <Toast message={toast} />
    </div>
  );
}

function Header() {
  return (
    <div className="screen__head">
      <div>
        <h1 className="screen__title">Forecast</h1>
        <p className="screen__sub">
          What you will have saved, month by month, as goals land and free money up.
        </p>
      </div>
    </div>
  );
}
