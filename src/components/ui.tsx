/**
 * Shared interface primitives. Small, unopinionated, and styled entirely from
 * the tokens in global.css so a theme change never needs a component change.
 */

import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { parseAmountToCents } from '../domain/money';
import { currencySymbol, formatMoney } from '../domain/format';

// ---------------------------------------------------------------- money ----

export function Money({
  cents,
  currency,
  locale,
  compact,
  decimals,
  signed,
  className,
}: {
  cents: number;
  currency: string;
  locale: string;
  compact?: boolean;
  decimals?: boolean;
  signed?: boolean;
  className?: string;
}) {
  return (
    <span className={className ? `num ${className}` : 'num'}>
      {formatMoney(cents, currency, locale, { compact, decimals, signed })}
    </span>
  );
}

// ----------------------------------------------------------------- card ----

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `card ${className}` : 'card'}>
      {(title || action) && (
        <div className="row row--between" style={{ marginBottom: title ? 0 : 10 }}>
          {title && <div className="card__title" style={{ marginBottom: 0 }}>{title}</div>}
          {action}
        </div>
      )}
      {title && <div style={{ height: 10 }} />}
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className={tone ? `metric metric--${tone}` : 'metric'}>
      <div className="metric__label">{label}</div>
      <div className="metric__value">{value}</div>
      {hint !== undefined && hint !== null && <div className="metric__hint">{hint}</div>}
    </div>
  );
}

// ------------------------------------------------------------ segmented ----

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label ?? 'Options'}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          className="segmented__item"
          aria-selected={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- fields ----

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      {children}
      {error ? (
        <div className="field__error">{error}</div>
      ) : hint ? (
        <div className="field__hint">{hint}</div>
      ) : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
  inputMode,
  invalid,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'decimal';
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <input
      className={invalid ? 'input input--invalid' : 'input'}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength ?? 80}
      inputMode={inputMode}
      autoFocus={autoFocus}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

/**
 * Money entry.
 *
 * The field keeps the user's raw keystrokes while they type — reformatting mid
 * entry moves the caret and makes the input feel broken — and only reports a
 * parsed value upward. `1.2k` and `2 lakh` are accepted alongside plain digits.
 */
export function AmountInput({
  cents,
  onChange,
  currency,
  placeholder,
  autoFocus,
  invalid,
}: {
  cents: number;
  onChange: (cents: number) => void;
  currency: string;
  placeholder?: string;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const [text, setText] = useState(() => (cents ? String(cents / 100) : ''));
  const lastEmitted = useRef(cents);

  useEffect(() => {
    // Only follow an external change, never a change this field just caused.
    if (cents !== lastEmitted.current) {
      lastEmitted.current = cents;
      setText(cents ? String(cents / 100) : '');
    }
  }, [cents]);

  const handle = useCallback(
    (raw: string) => {
      setText(raw);
      const parsed = parseAmountToCents(raw);
      const next = parsed ?? 0;
      lastEmitted.current = next;
      onChange(next);
    },
    [onChange],
  );

  return (
    <div className="amount-input">
      <span className="amount-input__symbol">{currencySymbol(currency)}</span>
      <input
        className={invalid ? 'input input--invalid' : 'input'}
        value={text}
        placeholder={placeholder ?? '0'}
        inputMode="decimal"
        autoFocus={autoFocus}
        onChange={(e) => handle(e.target.value)}
      />
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <input
      className="slider"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span>
        <span style={{ fontSize: 14.5, fontWeight: 600, display: 'block' }}>{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
      </span>
      <span className="toggle__switch" data-on={checked}>
        <span className="toggle__knob" />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- sheet ----

/**
 * Bottom sheet. Closes on backdrop tap and on Escape, restores focus and
 * unlocks body scroll on the way out.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__grip" />
        <div className="sheet__head">
          <h2 className="sheet__title" id={titleId}>
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- misc -----

export function EmptyState({
  glyph,
  title,
  text,
  action,
}: {
  glyph: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__glyph">{glyph}</div>
      <div className="empty__title">{title}</div>
      <div className="empty__text">{text}</div>
      {action}
    </div>
  );
}

export function Bar({
  ratio,
  color,
  thin,
}: {
  ratio: number;
  color?: string;
  thin?: boolean;
}) {
  const safe = Number.isFinite(ratio) ? Math.min(Math.max(ratio, 0), 1) : 0;
  return (
    <div className={thin ? 'bar bar--thin' : 'bar'}>
      <div
        className="bar__fill"
        style={{
          width: `${safe * 100}%`,
          background: color ?? 'linear-gradient(90deg, var(--accent), var(--accent-3))',
        }}
      />
    </div>
  );
}

export function Chip({
  tone,
  children,
}: {
  tone?: 'good' | 'warn' | 'bad' | 'accent';
  children: ReactNode;
}) {
  return <span className={tone ? `chip chip--${tone}` : 'chip'}>{children}</span>;
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

/** Fires a toast that clears itself. */
export function useToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2400);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return [message, show];
}

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <button
      type="button"
      className={className ?? 'btn btn--danger'}
      onClick={() => {
        if (armed) onConfirm();
        else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
