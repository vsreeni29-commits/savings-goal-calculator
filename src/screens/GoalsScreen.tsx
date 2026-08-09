import { useMemo, useState } from 'react';
import type { GoalProjection, Projection } from '../domain/engine';
import type { Goal, ViewMode } from '../domain/types';
import { GOAL_COLORS, GOAL_EMOJIS } from '../domain/types';
import { useStore } from '../store/useStore';
import {
  VIEW_MODES,
  formatMoney,
  formatRate,
  perView,
  viewLabel,
} from '../domain/format';
import {
  addMonths,
  currentMonthKey,
  endOfMonthISO,
  formatISODate,
  formatMonthKey,
  humanizeMonths,
  isValidISODate,
  todayISO,
} from '../domain/dates';
import { maxZero } from '../domain/money';
import {
  AmountInput,
  Bar,
  Card,
  Chip,
  ConfirmButton,
  EmptyState,
  Field,
  Metric,
  Money,
  Segmented,
  Sheet,
  TextInput,
  Toast,
  Toggle,
  useToast,
} from '../components/ui';
import { ProgressRing } from '../components/charts';

type EditorState = { mode: 'new' } | { mode: 'edit'; goal: Goal } | null;

export default function GoalsScreen({ projection }: { projection: Projection }) {
  const goals = useStore((s) => s.goals);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const reorderGoals = useStore((s) => s.reorderGoals);

  const [editor, setEditor] = useState<EditorState>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [toast, showToast] = useToast();

  const { currency, locale, viewMode } = settings;

  const live = useMemo(
    () => goals.filter((g) => !g.archived).sort((a, b) => a.priority - b.priority),
    [goals],
  );
  const archived = useMemo(() => goals.filter((g) => g.archived), [goals]);
  const byId = useMemo(
    () => new Map(projection.goals.map((g) => [g.goalId, g])),
    [projection.goals],
  );

  const move = (index: number, direction: -1 | 1) => {
    const next = [...live];
    const target = index + direction;
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    reorderGoals(next.map((g) => g.id));
  };

  const detailGoal = detailId ? goals.find((g) => g.id === detailId) ?? null : null;

  return (
    <div className="screen">
      <div className="screen__head">
        <div>
          <h1 className="screen__title">Goals</h1>
          <p className="screen__sub">
            The order here decides who gets funded first. Move a goal up and the plan follows.
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Add a goal"
          onClick={() => setEditor({ mode: 'new' })}
        >
          ＋
        </button>
      </div>

      <Segmented
        label="Timescale"
        options={VIEW_MODES.map((v) => ({ id: v.id, label: v.short }))}
        value={viewMode}
        onChange={(next) => updateSettings({ viewMode: next })}
      />

      {live.length === 0 ? (
        <Card>
          <EmptyState
            glyph="🎯"
            title="No goals yet"
            text="A house deposit, a trip, an emergency fund — add whatever you are actually saving for."
            action={
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setEditor({ mode: 'new' })}
              >
                Add a goal
              </button>
            }
          />
        </Card>
      ) : (
        <div className="stack">
          {live.map((goal, index) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              result={byId.get(goal.id)}
              currency={currency}
              locale={locale}
              viewMode={viewMode}
              isFirst={index === 0}
              isLast={index === live.length - 1}
              onOpen={() => setDetailId(goal.id)}
              onMove={(direction) => move(index, direction)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={() => setEditor({ mode: 'new' })}
      >
        ＋ Add a goal
      </button>

      {archived.length > 0 && (
        <Card>
          <button
            type="button"
            className="row row--between"
            style={{ width: '100%' }}
            onClick={() => setShowArchived((v) => !v)}
          >
            <span className="strong">Archived ({archived.length})</span>
            <span className="dim">{showArchived ? '▾' : '▸'}</span>
          </button>
          {showArchived && (
            <div className="list" style={{ marginTop: 10 }}>
              {archived.map((goal) => (
                <button
                  key={goal.id}
                  type="button"
                  className="list__item"
                  onClick={() => setDetailId(goal.id)}
                >
                  <span className="avatar" style={{ background: 'var(--surface-2)' }}>
                    {goal.emoji}
                  </span>
                  <div className="list__body">
                    <div className="list__name">{goal.name}</div>
                    <div className="list__meta">
                      {formatMoney(goal.targetCents, currency, locale, { compact: true })} target
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {editor && (
        <GoalEditor
          state={editor}
          currency={currency}
          existingCount={live.length}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null);
            showToast(message);
          }}
        />
      )}

      {detailGoal && (
        <GoalDetail
          goal={detailGoal}
          result={byId.get(detailGoal.id)}
          currency={currency}
          locale={locale}
          viewMode={viewMode}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setDetailId(null);
            setEditor({ mode: 'edit', goal: detailGoal });
          }}
          onToast={showToast}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}

// ---------------------------------------------------------------- goal row --

function GoalRow({
  goal,
  result,
  currency,
  locale,
  viewMode,
  isFirst,
  isLast,
  onOpen,
  onMove,
}: {
  goal: Goal;
  result: GoalProjection | undefined;
  currency: string;
  locale: string;
  viewMode: ViewMode;
  isFirst: boolean;
  isLast: boolean;
  onOpen: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const ratio = goal.targetCents > 0 ? goal.savedCents / goal.targetCents : 0;
  const planned = result?.plannedMonthlyCents ?? 0;
  const missed = result?.meetsDeadline === false;

  return (
    <div className="goal-card">
      <div className="goal-card__top">
        <button
          type="button"
          onClick={onOpen}
          className="row"
          style={{ flex: 1, minWidth: 0, textAlign: 'left' }}
        >
          <span className="avatar" style={{ background: `${goal.color}22`, color: goal.color }}>
            {goal.emoji}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="goal-card__name" style={{ display: 'block' }}>
              {goal.name}
            </span>
            <span className="goal-card__meta" style={{ display: 'block' }}>
              {formatMoney(goal.savedCents, currency, locale, { compact: true })} of{' '}
              {formatMoney(goal.targetCents, currency, locale, { compact: true })}
            </span>
          </span>
        </button>
        <ProgressRing ratio={ratio} size={44} stroke={5} color={goal.color} />
      </div>

      <Bar ratio={ratio} color={goal.color} />

      <div className="goal-card__foot">
        <span className="num">
          {formatMoney(perView(planned, viewMode), currency, locale)} {viewLabel(viewMode)}
        </span>
        {result?.completionMonth ? (
          missed ? (
            <Chip tone="warn">late — {formatMonthKey(result.completionMonth, 'short')}</Chip>
          ) : (
            <span>{formatMonthKey(result.completionMonth, 'short')}</span>
          )
        ) : (
          <Chip tone="bad">not funded</Chip>
        )}
      </div>

      <div className="row" style={{ marginTop: 10, gap: 8 }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={isFirst}
          onClick={() => onMove(-1)}
          aria-label={`Move ${goal.name} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          disabled={isLast}
          onClick={() => onMove(1)}
          aria-label={`Move ${goal.name} down`}
        >
          ↓
        </button>
        <span className="tiny faint">priority {goal.priority}</span>
        <div className="spacer" />
        <button type="button" className="btn btn--sm" onClick={onOpen}>
          Details
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- goal editor --

function GoalEditor({
  state,
  currency,
  existingCount,
  onClose,
  onSaved,
}: {
  state: NonNullable<EditorState>;
  currency: string;
  existingCount: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const addGoal = useStore((s) => s.addGoal);
  const updateGoal = useStore((s) => s.updateGoal);
  const editing = state.mode === 'edit' ? state.goal : null;

  const [name, setName] = useState(editing?.name ?? '');
  const [emoji, setEmoji] = useState(
    editing?.emoji ?? GOAL_EMOJIS[existingCount % GOAL_EMOJIS.length] ?? '🎯',
  );
  const [color, setColor] = useState(
    editing?.color ?? GOAL_COLORS[existingCount % GOAL_COLORS.length] ?? '#6366f1',
  );
  const [targetCents, setTargetCents] = useState(editing?.targetCents ?? 0);
  const [savedCents, setSavedCents] = useState(editing?.savedCents ?? 0);
  const [hasDeadline, setHasDeadline] = useState(Boolean(editing?.targetDate));
  const [targetDate, setTargetDate] = useState(
    editing?.targetDate ?? endOfMonthISO(addMonths(currentMonthKey(), 12)),
  );
  const [returnPct, setReturnPct] = useState(
    editing ? String(Math.round(editing.annualReturnRate * 1000) / 10) : '0',
  );
  const [pinned, setPinned] = useState(Boolean(editing?.manualMonthlyCents));
  const [pinnedCents, setPinnedCents] = useState(editing?.manualMonthlyCents ?? 0);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [touched, setTouched] = useState(false);

  const nameError = touched && !name.trim() ? 'Give the goal a name.' : undefined;
  const targetError =
    touched && targetCents <= 0 ? 'How much do you need in total?' : undefined;
  const dateError =
    touched && hasDeadline && (!isValidISODate(targetDate) || targetDate < todayISO())
      ? 'Pick a date in the future.'
      : undefined;

  const valid = name.trim().length > 0 && targetCents > 0 && !dateError;

  const save = () => {
    setTouched(true);
    if (!valid) return;

    const parsedRate = Number(returnPct);
    const annualReturnRate =
      Number.isFinite(parsedRate) && parsedRate > 0 ? Math.min(parsedRate / 100, 1) : 0;

    const fields = {
      name: name.trim(),
      emoji,
      color,
      targetCents,
      savedCents: maxZero(savedCents),
      targetDate: hasDeadline ? targetDate : undefined,
      annualReturnRate,
      manualMonthlyCents: pinned && pinnedCents > 0 ? pinnedCents : undefined,
      notes: notes.trim() || undefined,
    };

    if (editing) {
      updateGoal(editing.id, fields);
      onSaved('Goal updated');
    } else {
      addGoal({
        ...fields,
        priority: existingCount + 1,
        archived: false,
        createdAt: todayISO(),
      });
      onSaved('Goal added');
    }
  };

  return (
    <Sheet
      open
      title={editing ? 'Edit goal' : 'New goal'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={save}>
            {editing ? 'Save changes' : 'Add goal'}
          </button>
        </>
      }
    >
      <Field label="What are you saving for?" error={nameError}>
        <TextInput
          value={name}
          onChange={setName}
          placeholder="House deposit"
          maxLength={60}
          autoFocus={!editing}
          invalid={Boolean(nameError)}
        />
      </Field>

      <Field label="Icon">
        <div className="row row--wrap" style={{ gap: 6 }}>
          {GOAL_EMOJIS.map((option) => (
            <button
              key={option}
              type="button"
              className="icon-btn"
              style={{
                background: option === emoji ? 'var(--accent-soft)' : 'var(--surface-2)',
                borderColor: option === emoji ? 'var(--accent)' : 'var(--border)',
              }}
              onClick={() => setEmoji(option)}
              aria-label={`Icon ${option}`}
              aria-pressed={option === emoji}
            >
              {option}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Colour">
        <div className="row row--wrap" style={{ gap: 8 }}>
          {GOAL_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setColor(option)}
              aria-label={`Colour ${option}`}
              aria-pressed={option === color}
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: option,
                border: option === color ? '3px solid var(--text)' : '1px solid var(--border)',
              }}
            />
          ))}
        </div>
      </Field>

      <Field label="Total needed" error={targetError}>
        <AmountInput
          cents={targetCents}
          onChange={setTargetCents}
          currency={currency}
          invalid={Boolean(targetError)}
        />
      </Field>

      <Field label="Already saved" hint="Money you have put aside for this goal already.">
        <AmountInput cents={savedCents} onChange={setSavedCents} currency={currency} />
      </Field>

      <div className="divider" />

      <Toggle
        checked={hasDeadline}
        onChange={setHasDeadline}
        label="I need this by a certain date"
        hint="Off means the app tells you the earliest date you can get there."
      />

      {hasDeadline && (
        <Field
          label="Target date"
          error={dateError}
          hint="The plan aims to have the money ready by the end of the month before this date, unless you pick the last few days of a month."
        >
          <input
            className={dateError ? 'input input--invalid' : 'input'}
            type="date"
            value={targetDate}
            min={todayISO()}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </Field>
      )}

      <Field
        label="Expected return a year (%)"
        hint="Interest or growth on the money while it sits there. Leave at 0 for a plain savings account."
      >
        <TextInput value={returnPct} onChange={setReturnPct} inputMode="decimal" maxLength={6} />
      </Field>

      <div className="divider" />

      <Toggle
        checked={pinned}
        onChange={setPinned}
        label="Pin a fixed monthly amount"
        hint="Reserves this much for the goal every month, before anything else is shared out."
      />

      {pinned && (
        <Field label="Amount each month">
          <AmountInput cents={pinnedCents} onChange={setPinnedCents} currency={currency} />
        </Field>
      )}

      <Field label="Notes">
        <TextInput value={notes} onChange={setNotes} placeholder="Optional" maxLength={200} />
      </Field>
    </Sheet>
  );
}

// ------------------------------------------------------------- goal detail --

function GoalDetail({
  goal,
  result,
  currency,
  locale,
  viewMode,
  onClose,
  onEdit,
  onToast,
}: {
  goal: Goal;
  result: GoalProjection | undefined;
  currency: string;
  locale: string;
  viewMode: ViewMode;
  onClose: () => void;
  onEdit: () => void;
  onToast: (message: string) => void;
}) {
  const updateGoal = useStore((s) => s.updateGoal);
  const removeGoal = useStore((s) => s.removeGoal);
  const addContribution = useStore((s) => s.addContribution);
  const contributions = useStore((s) => s.contributions);

  const [depositCents, setDepositCents] = useState(0);
  const [depositDate, setDepositDate] = useState(todayISO());

  const history = useMemo(
    () =>
      contributions
        .filter((c) => c.goalId === goal.id)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 8),
    [contributions, goal.id],
  );

  const remaining = maxZero(goal.targetCents - goal.savedCents);
  const ratio = goal.targetCents > 0 ? goal.savedCents / goal.targetCents : 0;

  const deposit = () => {
    if (depositCents <= 0) return;
    addContribution({ goalId: goal.id, amountCents: depositCents, date: depositDate });
    // A deposit is real money moved, so the goal's balance moves with it.
    updateGoal(goal.id, { savedCents: goal.savedCents + depositCents });
    setDepositCents(0);
    onToast('Deposit logged');
  };

  return (
    <Sheet
      open
      title={`${goal.emoji} ${goal.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onEdit}>
            Edit
          </button>
          <button
            type="button"
            className="btn"
            style={{ flex: 1 }}
            onClick={() => {
              updateGoal(goal.id, { archived: !goal.archived });
              onToast(goal.archived ? 'Goal restored' : 'Goal archived');
              onClose();
            }}
          >
            {goal.archived ? 'Restore' : 'Archive'}
          </button>
          <ConfirmButton
            label="Delete"
            confirmLabel="Sure?"
            onConfirm={() => {
              removeGoal(goal.id);
              onToast('Goal deleted');
              onClose();
            }}
          />
        </>
      }
    >
      <div className="row" style={{ gap: 16 }}>
        <ProgressRing ratio={ratio} size={76} stroke={8} color={goal.color} />
        <div style={{ minWidth: 0 }}>
          <div className="hero__value hero__value--sm" style={{ margin: 0 }}>
            <Money cents={goal.savedCents} currency={currency} locale={locale} compact />
          </div>
          <div className="small dim">
            of {formatMoney(goal.targetCents, currency, locale)} —{' '}
            {formatMoney(remaining, currency, locale, { compact: true })} to go
          </div>
        </div>
      </div>

      <div className="grid-2">
        <Metric
          label="Lands in"
          value={
            result?.completionMonth ? formatMonthKey(result.completionMonth, 'short') : '—'
          }
          hint={
            result?.monthsToComplete != null
              ? humanizeMonths(result.monthsToComplete)
              : 'not funded on this plan'
          }
          tone={result?.meetsDeadline === false ? 'warn' : undefined}
        />
        <Metric
          label="Getting"
          value={formatMoney(perView(result?.plannedMonthlyCents ?? 0, viewMode), currency, locale)}
          hint={viewLabel(viewMode)}
        />
        {goal.targetDate && (
          <Metric
            label="Needs"
            value={formatMoney(
              perView(result?.requiredMonthlyCents ?? 0, viewMode),
              currency,
              locale,
            )}
            hint={`${viewLabel(viewMode)} to hit ${formatISODate(goal.targetDate, 'short')}`}
            tone={(result?.shortfallMonthlyCents ?? 0) > 0 ? 'bad' : 'good'}
          />
        )}
        <Metric
          label="On its own"
          value={
            result?.soloMonths != null ? humanizeMonths(result.soloMonths) : 'out of reach'
          }
          hint="if it had every spare rupee"
        />
      </div>

      {(result?.shortfallMonthlyCents ?? 0) > 0 && (
        <div className="notice notice--warning">
          <span className="notice__glyph" aria-hidden="true">
            ⚠️
          </span>
          <div>
            <div className="notice__title">
              Short by{' '}
              {formatMoney(
                perView(result?.shortfallMonthlyCents ?? 0, viewMode),
                currency,
                locale,
              )}{' '}
              {viewLabel(viewMode)}
            </div>
            <div className="notice__detail">
              Free up that much, move this goal up the list, or push the date back.
            </div>
          </div>
        </div>
      )}

      <div className="divider" />

      <div className="card__title">Log a deposit</div>
      <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
        <div style={{ flex: 1 }}>
          <AmountInput cents={depositCents} onChange={setDepositCents} currency={currency} />
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={deposit}
          disabled={depositCents <= 0}
        >
          Add
        </button>
      </div>
      <input
        className="input"
        type="date"
        value={depositDate}
        max={todayISO()}
        onChange={(e) => setDepositDate(e.target.value)}
      />

      {history.length > 0 && (
        <>
          <div className="card__title" style={{ marginTop: 6 }}>
            Recent deposits
          </div>
          <div className="list">
            {history.map((c) => (
              <div key={c.id} className="list__item">
                <div className="list__body">
                  <div className="list__name">{formatISODate(c.date)}</div>
                  {c.note && <div className="list__meta">{c.note}</div>}
                </div>
                <div className="list__amount">
                  <Money cents={c.amountCents} currency={currency} locale={locale} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {goal.annualReturnRate > 0 && (
        <div className="small dim">
          Assuming {formatRate(goal.annualReturnRate)} a year, compounded monthly.
        </div>
      )}
      {goal.notes && <div className="small dim">{goal.notes}</div>}
    </Sheet>
  );
}
