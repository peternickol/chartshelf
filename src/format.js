import { FONT } from './theme.js';

const compact = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const standard = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

/** Axis-friendly number. Compact only once values get wide. */
export function formatNumber(value) {
  if (value == null || !Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 1e15)) return value.toExponential(1);
  if (abs >= 10000) return compact.format(value);
  if (abs >= 100) return integer.format(value);
  return standard.format(value);
}

const timeFormatters = new Map();

/** One formatter per calendar shape. A pan frame asks for the same shape again. */
function cachedTimeFormat(options, utc) {
  const key = `${utc ? 'u' : 'l'}|${options.month || ''}|${options.day || ''}|${options.year || ''}`;
  let formatter = timeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, utc ? { ...options, timeZone: 'UTC' } : options);
    timeFormatters.set(key, formatter);
  }
  return formatter;
}

/** Pick a clock or calendar format from how wide the domain is. */
export function formatTime(value, span, utc = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (span <= 36 * 60 * 60 * 1000) {
    return formatTimePattern(value, 'HH:mm', utc);
  }
  if (span <= 120 * 24 * 60 * 60 * 1000) {
    return cachedTimeFormat({ month: 'short', day: 'numeric' }, utc).format(date);
  }
  if (span <= 800 * 24 * 60 * 60 * 1000) {
    return cachedTimeFormat({ month: 'short', year: 'numeric' }, utc).format(date);
  }
  return cachedTimeFormat({ year: 'numeric' }, utc).format(date);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Calendar pattern for a timestamp.
 * Tokens: yyyy, yy, MMMM, MMM, MM, M, dd, d, HH, H, hh, h, mm, ss, a, A.
 */
export function formatTimePattern(value, pattern, utc = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = utc ? date.getUTCMonth() : date.getMonth();
  const day = utc ? date.getUTCDate() : date.getDate();
  const hour = utc ? date.getUTCHours() : date.getHours();
  const minute = utc ? date.getUTCMinutes() : date.getMinutes();
  const second = utc ? date.getUTCSeconds() : date.getSeconds();
  const pad = (number) => String(number).padStart(2, '0');
  const hour12 = hour % 12 || 12;
  const tokens = {
    yyyy: String(year),
    YYYY: String(year),
    yy: String(year).slice(-2),
    YY: String(year).slice(-2),
    MMMM: MONTHS_LONG[month],
    MMM: MONTHS[month],
    MM: pad(month + 1),
    M: String(month + 1),
    dd: pad(day),
    DD: pad(day),
    HH: pad(hour),
    hh: pad(hour12),
    mm: pad(minute),
    ss: pad(second),
    H: String(hour),
    h: String(hour12),
    d: String(day),
    D: String(day),
    a: hour < 12 ? 'am' : 'pm',
    A: hour < 12 ? 'AM' : 'PM',
  };
  return String(pattern).replace(
    /yyyy|YYYY|MMMM|MMM|MM|dd|DD|HH|hh|mm|ss|yy|YY|[HhMdaA]/g,
    (token) => tokens[token] ?? token,
  );
}

let measureCtx;
const widthCache = new Map();
const WIDTH_CACHE_MAX = 400;

/** Width of a label in CSS pixels. Falls back to a monospace estimate in Node. */
export function measureText(text, size, weight = 400) {
  const value = String(text ?? '');
  if (!value) return 0;
  if (typeof document === 'undefined') return value.length * size * 0.56;
  const key = `${weight}\0${size}\0${FONT}\0${value}`;
  const cached = widthCache.get(key);
  if (cached != null) return cached;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  const width = measureCtx.measureText(value).width;
  if (widthCache.size >= WIDTH_CACHE_MAX) widthCache.delete(widthCache.keys().next().value);
  widthCache.set(key, width);
  return width;
}
