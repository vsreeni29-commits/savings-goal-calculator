/**
 * Charts, drawn as inline SVG.
 *
 * Hand-rolled rather than pulled from a library: the shapes needed here are
 * simple, and an inline SVG inherits the theme tokens directly, stays crisp on
 * a phone screen, and adds nothing to the bundle.
 *
 * Every chart scales through `viewBox` with `width: 100%`, so none of them can
 * push the page sideways.
 */

import { useId, useMemo } from 'react';
import type { MonthSnapshot, Projection } from '../domain/engine';
import { formatMonthKey } from '../domain/dates';
import { formatMoney } from '../domain/format';
import type { MonthProgress, DaySpend } from '../domain/tracking';

const W = 320;

function pathFrom(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');
}

/** Keeps long horizons cheap to render without changing the shape of the line. */
function sample<T>(items: readonly T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return [...items];
  const step = (items.length - 1) / (maxPoints - 1);
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const item = items[Math.round(i * step)];
    if (item !== undefined) out.push(item);
  }
  return out;
}

// -------------------------------------------------------- projection line --

export function ProjectionChart({
  months,
  currency,
  locale,
  height = 150,
}: {
  months: readonly MonthSnapshot[];
  currency: string;
  locale: string;
  height?: number;
}) {
  const gradientId = useId();
  const points = useMemo(() => sample(months, 90), [months]);

  if (points.length < 2) {
    return (
      <div className="empty" style={{ padding: 24 }}>
        <div className="empty__text" style={{ marginBottom: 0 }}>
          The projection appears once there is money going into a goal.
        </div>
      </div>
    );
  }

  const max = Math.max(...points.map((m) => m.goalBalanceCents), 1);
  const padTop = 8;
  const padBottom = 20;
  const plotHeight = height - padTop - padBottom;

  const coords = points.map((m, i) => ({
    x: (i / (points.length - 1)) * W,
    y: padTop + plotHeight - (m.goalBalanceCents / max) * plotHeight,
  }));

  const line = pathFrom(coords);
  const area = `${line} L${W} ${padTop + plotHeight} L0 ${padTop + plotHeight} Z`;

  const firstMonth = points[0]?.month;
  const lastMonth = points[points.length - 1]?.month;

  return (
    <div>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${height}`}
        height={height}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Projected savings reaching ${formatMoney(max, currency, locale, {
          compact: true,
        })}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.42" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={padTop + plotHeight * f}
            y2={padTop + plotHeight * f}
            stroke="var(--border)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="row row--between tiny faint" style={{ marginTop: 4 }}>
        <span>{firstMonth ? formatMonthKey(firstMonth, 'short') : ''}</span>
        <span>{formatMoney(max, currency, locale, { compact: true })}</span>
        <span>{lastMonth ? formatMonthKey(lastMonth, 'short') : ''}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- goal timeline --

export function GoalTimeline({
  projection,
  height = 26,
}: {
  projection: Projection;
  height?: number;
}) {
  const goals = projection.goals;
  const horizon = useMemo(() => {
    const finishes = goals.map((g) => g.monthsToComplete ?? 0);
    return Math.max(1, ...finishes);
  }, [goals]);

  if (goals.length === 0) return null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      {goals.map((g) => {
        const months = g.monthsToComplete;
        const ratio = months === null ? 1 : Math.min(months / horizon, 1);
        return (
          <div key={g.goalId}>
            <div className="row row--between tiny" style={{ marginBottom: 5 }}>
              <span className="truncate" style={{ maxWidth: '60%' }}>
                {g.emoji} {g.name}
              </span>
              <span className={months === null ? 'bad' : 'dim'}>
                {months === null ? 'not on this plan' : formatMonthKey(g.completionMonth ?? '', 'short')}
              </span>
            </div>
            <svg
              className="chart"
              viewBox={`0 0 ${W} ${height}`}
              height={height}
              preserveAspectRatio="none"
              role="presentation"
            >
              <rect x="0" y={height / 2 - 5} width={W} height="10" rx="5" fill="var(--surface-2)" />
              <rect
                x="0"
                y={height / 2 - 5}
                width={Math.max(6, ratio * W)}
                height="10"
                rx="5"
                fill={months === null ? 'var(--bad)' : g.color}
                opacity={months === null ? 0.5 : 1}
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- cash flow ----

export function CashFlowBar({
  segments,
  currency,
  locale,
}: {
  segments: { label: string; cents: number; color: string }[];
  currency: string;
  locale: string;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.cents), 0);
  if (total <= 0) {
    return <div className="small faint">Add your income to see where it goes.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', gap: 2 }}>
        {segments
          .filter((s) => s.cents > 0)
          .map((s) => (
            <div
              key={s.label}
              style={{ width: `${(s.cents / total) * 100}%`, background: s.color }}
              title={s.label}
            />
          ))}
      </div>
      <div className="legend">
        {segments
          .filter((s) => s.cents > 0)
          .map((s) => (
            <span key={s.label} className="legend__item">
              <span className="legend__dot" style={{ background: s.color }} />
              {s.label}
              <span className="num strong" style={{ color: 'var(--text)' }}>
                {formatMoney(s.cents, currency, locale, { compact: true })}
              </span>
            </span>
          ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------- month bars ----

export function MonthBars({
  months,
  currency,
  locale,
  height = 110,
}: {
  months: readonly MonthProgress[];
  currency: string;
  locale: string;
  height?: number;
}) {
  const shown = useMemo(() => months.slice(-12), [months]);
  if (shown.length === 0) {
    return (
      <div className="small faint">
        Log a deposit and your month-by-month record starts here.
      </div>
    );
  }

  const max = Math.max(...shown.map((m) => Math.max(m.actualCents, m.plannedCents)), 1);
  const gap = 6;
  const barWidth = Math.max(6, (W - gap * (shown.length - 1)) / shown.length);
  const padBottom = 16;
  const plotHeight = height - padBottom;
  const targetY = plotHeight - (Math.min(shown[0]?.plannedCents ?? 0, max) / max) * plotHeight;

  return (
    <div>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${height}`}
        height={height}
        role="img"
        aria-label="Saved each month against the monthly target"
      >
        {(shown[0]?.plannedCents ?? 0) > 0 && (
          <line
            x1="0"
            x2={W}
            y1={targetY}
            y2={targetY}
            stroke="var(--accent)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.7"
          />
        )}
        {shown.map((m, i) => {
          const barHeight = Math.max(2, (m.actualCents / max) * plotHeight);
          const x = i * (barWidth + gap);
          return (
            <g key={m.month}>
              <rect
                x={x}
                y={plotHeight - barHeight}
                width={barWidth}
                height={barHeight}
                rx={Math.min(4, barWidth / 2)}
                fill={m.met ? 'var(--good)' : 'var(--warn)'}
                opacity={m.met ? 1 : 0.8}
              />
              <text
                x={x + barWidth / 2}
                y={height - 4}
                textAnchor="middle"
                fontSize="8"
                fill="var(--text-faint)"
              >
                {m.month.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="tiny faint" style={{ marginTop: 2 }}>
        Dashed line is your {formatMoney(shown[0]?.plannedCents ?? 0, currency, locale, {
          compact: true,
        })}{' '}
        monthly target.
      </div>
    </div>
  );
}

// -------------------------------------------------------------- heatmap ----

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function SpendHeatmap({
  days,
  month,
  today,
}: {
  days: readonly DaySpend[];
  month: string;
  today: string;
}) {
  const cells = useMemo(() => {
    const year = Number(month.slice(0, 4));
    const monthNo = Number(month.slice(5, 7));
    const totalDays = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
    const leading = new Date(Date.UTC(year, monthNo - 1, 1)).getUTCDay();

    const byDate = new Map(days.map((d) => [d.date, d]));
    const out: ({ day: number; date: string; entry: DaySpend | undefined } | null)[] = [];
    for (let i = 0; i < leading; i += 1) out.push(null);
    for (let day = 1; day <= totalDays; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      out.push({ day, date, entry: byDate.get(date) });
    }
    return out;
  }, [days, month]);

  return (
    <div>
      <div className="heatmap__labels" aria-hidden="true">
        {WEEKDAYS.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </div>
      <div className="heatmap">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} />;
          const { entry, date, day } = cell;
          const state = !entry
            ? date > today
              ? 'future'
              : 'none'
            : entry.noSpend
              ? 'quiet'
              : entry.underBudget
                ? 'under'
                : 'over';
          return (
            <div
              key={date}
              className={`heatmap__day heatmap__day--${state}${date === today ? ' heatmap__day--today' : ''}`}
              title={date}
            >
              {day}
            </div>
          );
        })}
      </div>
      <div className="legend">
        <span className="legend__item">
          <span className="legend__dot" style={{ background: 'var(--good-soft)' }} /> quiet day
        </span>
        <span className="legend__item">
          <span className="legend__dot" style={{ background: 'color-mix(in srgb, var(--good) 26%, transparent)' }} />{' '}
          under allowance
        </span>
        <span className="legend__item">
          <span className="legend__dot" style={{ background: 'color-mix(in srgb, var(--bad) 34%, transparent)' }} />{' '}
          over
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ progress ring --

export function ProgressRing({
  ratio,
  size = 56,
  stroke = 6,
  color = 'var(--accent)',
  label,
}: {
  ratio: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
}) {
  const safe = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label ?? `${Math.round(safe * 100)} percent`}
      style={{ flex: 'none' }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--surface-2)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - safe)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.2,0.8,0.3,1)' }}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size * 0.26}
        fontWeight="700"
        fill="var(--text)"
      >
        {Math.round(safe * 100)}
      </text>
    </svg>
  );
}
