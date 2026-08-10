/**
 * All monetary values in this app are integer minor units ("cents", "paise").
 * Nothing anywhere multiplies or divides floating-point currency directly —
 * every operation funnels through here so rounding is defined in exactly one
 * place and totals always reconcile.
 */

export type Cents = number;

export const ZERO: Cents = 0;

/** Rounds half away from zero, which is what people expect of money. */
export function roundCents(value: number): Cents {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Always rounds up in magnitude — used when a shortfall must be fully covered. */
export function ceilCents(value: number): Cents {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? -Math.ceil(-value) : Math.ceil(value);
}

export function addCents(...values: Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return roundCents(total);
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += v;
  return roundCents(total);
}

/** Multiply money by a plain ratio (e.g. a 0.65 savings factor). */
export function scaleCents(amount: Cents, factor: number): Cents {
  return roundCents(amount * factor);
}

export function clampCents(amount: Cents, min: Cents, max: Cents): Cents {
  if (max < min) return min;
  return Math.min(Math.max(amount, min), max);
}

export function maxZero(amount: Cents): Cents {
  return amount > 0 ? amount : 0;
}

/**
 * Splits an amount across weights without losing or inventing a single cent.
 * Remainder cents go to the largest fractional parts (largest-remainder
 * method), ties broken by original order so the result is deterministic.
 */
export function splitCents(amount: Cents, weights: readonly number[]): Cents[] {
  const n = weights.length;
  if (n === 0) return [];

  const safeWeights = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const totalWeight = safeWeights.reduce((a, b) => a + b, 0);

  if (totalWeight <= 0) {
    // No meaningful weights: give everything to the first slot rather than
    // silently dropping the money.
    const out = new Array<Cents>(n).fill(0);
    out[0] = amount;
    return out;
  }

  const exact = safeWeights.map((w) => (amount * w) / totalWeight);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = amount - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  const out = floors.slice();
  for (let i = 0; remainder > 0 && i < order.length; i += 1) {
    const slot = order[i];
    if (!slot) break;
    out[slot.index] = (out[slot.index] ?? 0) + 1;
    remainder -= 1;
  }
  return out;
}

/** Parses free-typed user input ("1,200.50", "₹1200", "1.2k") into cents. */
export function parseAmountToCents(input: string): Cents | null {
  if (typeof input !== 'string') return null;
  let text = input.trim().toLowerCase();
  if (!text) return null;

  let multiplier = 1;
  if (/[0-9]\s*k$/.test(text)) {
    multiplier = 1_000;
    text = text.replace(/k$/, '');
  } else if (/[0-9]\s*(m|l|lakh|lac)$/.test(text)) {
    multiplier = text.endsWith('m') ? 1_000_000 : 100_000;
    text = text.replace(/(m|l|lakh|lac)$/, '');
  } else if (/[0-9]\s*(cr|crore)$/.test(text)) {
    multiplier = 10_000_000;
    text = text.replace(/(cr|crore)$/, '');
  }

  const cleaned = text.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  return roundCents(value * multiplier * 100);
}

export function centsToUnits(amount: Cents): number {
  return amount / 100;
}

export function unitsToCents(units: number): Cents {
  return roundCents(units * 100);
}
