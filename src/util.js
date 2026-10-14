/** @param {string} message */
export function fail(message) {
  throw new Error(`ChartShelf: ${message}`);
}

/** @param {number} value @param {number} min @param {number} max */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Finite number, or null when the value cannot be plotted. */
export function finite(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Donut or radial center.
 * A string is one line. `{ label, value }` draws the caption above the value.
 * A function may return either.
 */
export function centerContent(center, total) {
  if (center == null || center === false || center === '') return null;
  let value = center;
  if (typeof center === 'function') {
    try {
      value = center(total);
    } catch {
      value = '';
    }
  }
  if (value && typeof value === 'object') {
    const label = value.label == null ? '' : String(value.label);
    let raw = value.value;
    if (typeof raw === 'function') {
      try {
        raw = raw(total);
      } catch {
        raw = '';
      }
    }
    return { label, text: raw == null ? '' : String(raw) };
  }
  const text = String(value ?? '');
  const split = text.split('\n');
  if (split.length > 1) return { label: split[0], text: split.slice(1).join('\n') };
  return { label: '', text };
}

/**
 * Min and max of the finite numbers in `values`.
 * A long list stays off the call stack. Non-finite values are skipped.
 */
export function finiteExtent(values) {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/** Trim binary floating-point noise from tick math. */
export function clean(value) {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** One decimal is enough for SVG geometry and keeps paths short. */
export function round(value) {
  return Math.round(value * 10) / 10;
}

/** @param {unknown} value */
export function isIsoDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/.test(value)
    && Number.isFinite(Date.parse(value));
}

/** Epoch milliseconds, not seconds and not a plain quantity like 2026. */
export function isEpochMillis(value) {
  return typeof value === 'number' && value > 1e11 && value < 1e14;
}

/** Coerce a category, timestamp, or number into an x position. */
export function xNumber(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (isIsoDate(value)) return Date.parse(value);
  return finite(value);
}

/** `new_users` → `New users` for series taken from column names. */
export function labelize(key) {
  const text = String(key).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 'Series';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const NAMED = /^[a-zA-Z]{1,32}$/;
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC = /^(?:rgb|hsl)a?\([0-9.%\s,/+-]+\)$/;

/** Reject colors that could escape into CSS or SVG markup. */
export function safeColor(color, fallback) {
  if (typeof color !== 'string') return fallback;
  const value = color.trim();
  if (HEX.test(value) || NAMED.test(value) || FUNC.test(value)) return value;
  return fallback;
}

/** Ink that stays readable on a saturated slice or bar. */
export function inkOn(color) {
  const hex = String(color).replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}/.test(full)) return '#ffffff';
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.64 ? '#1c2430' : '#ffffff';
}
