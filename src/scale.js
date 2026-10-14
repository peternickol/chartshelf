import { clean } from './util.js';

/** Nice round step for an axis range. `round` picks a step; otherwise a ceiling. */
export function niceNum(range, round) {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / 10 ** exp;
  let nice;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * 10 ** exp;
}

/** Expand a data extent to evenly spaced ticks. */
export function niceDomain(min, max, tickCount = 5) {
  const count = Math.max(2, tickCount);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1, ticks: [0, 0.5, 1] };
  }
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad / 2;
    max += pad / 2;
  }
  if (min > max) [min, max] = [max, min];
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  if (!(step > 0) || !Number.isFinite(step)) return { min, max, ticks: [clean(min), clean(max)] };

  const niceMin = Math.floor(min / step + 1e-10) * step;
  const niceMax = Math.ceil(max / step - 1e-10) * step;
  const ticks = [];
  const limit = count + 6;
  for (let value = niceMin, i = 0; value <= niceMax + step * 0.5 && i < limit; value += step, i += 1) {
    ticks.push(clean(value));
  }
  if (ticks.length < 2) {
    const lo = clean(niceMin);
    const hi = clean(niceMax === niceMin ? niceMin + step : niceMax);
    return { min: lo, max: hi, ticks: [lo, hi] };
  }
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks };
}

/**
 * Step on the 1-2-5 sequence.
 * A rough step just above 5 stays on 5, so a cloud of points is not
 * stretched onto a step of 10.
 */
function axisStep(span, intervals) {
  const rough = Math.abs(span) / Math.max(1, intervals);
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = 10 ** exp;
  const frac = rough / base;
  let nice = 10;
  if (frac < 1.5) nice = 1;
  else if (frac < 3) nice = 2;
  else if (frac < 7.5) nice = 5;
  return nice * base;
}

function ticksBetween(min, max, step) {
  const count = Math.max(1, Math.min(24, Math.round((max - min) / step) || 1));
  const ticks = [];
  for (let i = 0; i <= count; i += 1) {
    ticks.push(clean(i === count ? max : min + step * i));
  }
  return ticks;
}

/** Both ends are fixed, so the ticks have to land on them. */
function pinnedDomain(min, max, intervals) {
  const span = max - min;
  const target = Math.max(4, intervals);
  const rough = span / target;
  const exp = Math.floor(Math.log10(Math.abs(rough) || 1));
  let best = null;
  for (let mag = exp - 1; mag <= exp + 1; mag += 1) {
    for (const mult of [1, 2, 2.5, 5]) {
      const step = mult * 10 ** mag;
      if (!(step > 0)) continue;
      const count = span / step;
      const rounded = Math.round(count);
      if (rounded < 3 || rounded > 8) continue;
      if (Math.abs(count - rounded) > 1e-6) continue;
      const score = Math.abs(rounded - target);
      if (!best || score < best.score || (score === best.score && step < best.step)) {
        best = { step, score };
      }
    }
  }
  if (best) return { min: clean(min), max: clean(max), ticks: ticksBetween(min, max, best.step) };
  const ticks = [];
  for (let i = 0; i <= target; i += 1) ticks.push(clean(min + (span * i) / target));
  return { min: clean(min), max: clean(max), ticks };
}

/**
 * Data extent → axis domain.
 * `zero` pulls 0 into view. Explicit `min` / `max` stay locked and the
 * ticks include those ends. `headroom` adds one step when a bar would
 * otherwise stop on the top grid line.
 */
export function resolveDomain(dataMin, dataMax, options = {}) {
  let min = Number.isFinite(dataMin) ? dataMin : 0;
  let max = Number.isFinite(dataMax) ? dataMax : 1;
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad / 2;
    max += pad / 2;
  }
  if (min > max) [min, max] = [max, min];
  const rawLo = min;
  const rawHi = max;
  if (options.zero) {
    if (min > 0) min = 0;
    if (max < 0) max = 0;
  }
  const pinMin = options.min != null;
  const pinMax = options.max != null;
  if (pinMin) min = options.min;
  if (pinMax) max = options.max;
  if (min > max) [min, max] = [max, min];

  const intervals = Math.max(3, (options.ticks ?? 5) - 1);
  if (pinMin && pinMax) return pinnedDomain(min, max, Math.max(intervals, 5));

  const step = axisStep(max - min || Math.abs(max) || 1, intervals);
  const holdMin = pinMin || (options.zero && rawLo >= 0 && min === 0);
  const holdMax = pinMax || (options.zero && rawHi <= 0 && max === 0);
  let lo = holdMin ? min : Math.floor(min / step + 1e-9) * step;
  let hi = holdMax ? max : Math.ceil(max / step - 1e-9) * step;
  if (options.headroom && !pinMax && Math.abs(hi - rawHi) <= step * 1e-6) hi += step;
  if (options.headroom && !pinMin && !(options.zero && lo === 0) && Math.abs(lo - rawLo) <= step * 1e-6) lo -= step;
  if (options.zero && rawLo >= 0 && lo < 0) lo = 0;
  if (options.zero && rawHi <= 0 && hi > 0) hi = 0;
  if (!(hi > lo)) hi = lo + step;
  lo = clean(lo);
  hi = clean(hi);
  return { min: lo, max: hi, ticks: ticksBetween(lo, hi, step) };
}

/** Map a domain onto a pixel range. Invert the range for y axes. */
export function scaleLinear(domainMin, domainMax, rangeMin, rangeMax) {
  const span = domainMax - domainMin || 1;
  const slope = (rangeMax - rangeMin) / span;
  return (value) => rangeMin + (value - domainMin) * slope;
}

/**
 * Category indexes sit on -0.5 … count-0.5, so each category is one unit wide.
 * A line or area passes `edges` and instead runs 0 … count-1, so the first and
 * last samples sit on the sides of the plot. `min` and `max` narrow that window.
 * Tick indexes are the categories inside it.
 */
export function categoryWindow(count, min, max, edges = false) {
  const fullMin = edges ? 0 : -0.5;
  const fullMax = edges
    ? Math.max((count || 1) - 1, 1)
    : Math.max((count || 0) - 0.5, fullMin + 1);
  let lo = min == null ? fullMin : min;
  let hi = max == null ? fullMax : max;
  if (!(hi > lo)) {
    lo = fullMin;
    hi = fullMax;
  }
  const ticks = [];
  for (let index = 0; index < count; index += 1) {
    if (index >= lo && index <= hi) ticks.push(index);
  }
  if (!ticks.length && count > 0) {
    ticks.push(Math.max(0, Math.min(count - 1, Math.round((lo + hi) / 2))));
  }
  return {
    min: lo,
    max: hi,
    ticks,
    windowed: min != null || max != null,
  };
}

/** Equal slots along an axis. `inner` is the fraction used by the bar group. */
export function bands(count, start, size, inner = 0.74) {
  if (count <= 0 || !(size > 0)) return [];
  const step = size / count;
  const width = step * inner;
  const pad = (step - width) / 2;
  const slots = [];
  for (let i = 0; i < count; i += 1) {
    slots.push({
      i,
      x: start + i * step + pad,
      w: width,
      mid: start + i * step + step / 2,
      step,
    });
  }
  return slots;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Nominal durations. `days` and `months` advance on the calendar so a
 * daylight-saving shift does not walk the label off midnight.
 */
const TIME_STEPS = [
  { ms: SECOND },
  { ms: 5 * SECOND },
  { ms: 15 * SECOND },
  { ms: 30 * SECOND },
  { ms: MINUTE },
  { ms: 2 * MINUTE },
  { ms: 5 * MINUTE },
  { ms: 10 * MINUTE },
  { ms: 15 * MINUTE },
  { ms: 30 * MINUTE },
  { ms: HOUR },
  { ms: 2 * HOUR },
  { ms: 3 * HOUR },
  { ms: 4 * HOUR },
  { ms: 6 * HOUR },
  { ms: 12 * HOUR },
  { ms: DAY, days: 1 },
  { ms: 2 * DAY, days: 2 },
  { ms: 7 * DAY, days: 7 },
  { ms: 14 * DAY, days: 14 },
  { ms: 30 * DAY, months: 1 },
  { ms: 90 * DAY, months: 3 },
  { ms: 365 * DAY, months: 12 },
];

function pickTimeStep(span, tickCount) {
  const count = Math.max(2, tickCount || 6);
  const minCount = Math.max(3, count - 1);
  const maxCount = Math.max(minCount + 2, 9);
  let chosen = 0;
  for (let index = 0; index < TIME_STEPS.length; index += 1) {
    if (span / TIME_STEPS[index].ms >= minCount) chosen = index;
    else break;
  }
  if (span / TIME_STEPS[chosen].ms > maxCount) {
    for (let index = chosen + 1; index < TIME_STEPS.length; index += 1) {
      if (span / TIME_STEPS[index].ms >= minCount) chosen = index;
      else break;
    }
  }
  return TIME_STEPS[chosen];
}

function startOfDay(ms, utc) {
  const date = new Date(ms);
  if (utc) date.setUTCHours(0, 0, 0, 0);
  else date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Monday 5 Jan 1970, so week and fortnight ticks keep a stable weekday. */
function mondayOrigin(utc) {
  if (utc) return Date.UTC(1970, 0, 5);
  const date = new Date(1970, 0, 5);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDays(value, days, utc) {
  const date = new Date(value);
  if (utc) date.setUTCDate(date.getUTCDate() + days);
  else date.setDate(date.getDate() + days);
  return date.getTime();
}

function advanceTime(value, step, utc) {
  if (step.months) {
    const date = new Date(value);
    if (utc) date.setUTCMonth(date.getUTCMonth() + step.months);
    else date.setMonth(date.getMonth() + step.months);
    return date.getTime();
  }
  if (step.days) return addDays(value, step.days, utc);
  return value + step.ms;
}

function firstTick(min, step, utc) {
  if (step.months) {
    const date = new Date(min);
    if (utc) {
      date.setUTCDate(1);
      date.setUTCHours(0, 0, 0, 0);
      const month = step.months >= 12 ? 0 : date.getUTCMonth() - (date.getUTCMonth() % step.months);
      date.setUTCMonth(month);
    } else {
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      const month = step.months >= 12 ? 0 : date.getMonth() - (date.getMonth() % step.months);
      date.setMonth(month);
    }
    let start = date.getTime();
    let guard = 0;
    while (start < min && guard < 8) {
      const next = advanceTime(start, step, utc);
      if (!(next > start)) break;
      start = next;
      guard += 1;
    }
    return start;
  }
  if (step.days > 1) {
    let start = mondayOrigin(utc);
    if (start < min) {
      const jumps = Math.max(0, Math.floor((min - start) / DAY / step.days) - 1);
      if (jumps) start = addDays(start, jumps * step.days, utc);
    }
    let guard = 0;
    while (start < min && guard < 8) {
      start = addDays(start, step.days, utc);
      guard += 1;
    }
    const previous = addDays(start, -step.days, utc);
    return previous >= min ? previous : start;
  }
  if (step.days === 1) {
    const start = startOfDay(min, utc);
    return start < min ? addDays(start, 1, utc) : start;
  }
  const origin = startOfDay(min, utc);
  if (origin >= min) return origin;
  const jumps = Math.ceil((min - origin) / step.ms - 1e-6);
  return origin + jumps * step.ms;
}

/**
 * Calendar-aligned ticks for a time axis.
 * Sub-day ticks sit on the local clock unless `options.utc` is set.
 * The step is chosen so a window of an hour, a work day, or a day
 * still has several labels.
 */
export function timeTicks(min, max, tickCount = 6, options = {}) {
  if (!(max > min)) return { min, max: min + 1, ticks: [min], step: 1 };
  const utc = !!options.utc;
  const step = pickTimeStep(max - min, tickCount);
  let value = firstTick(min, step, utc);
  const ticks = [];
  for (let guard = 0; guard < 16 && value <= max; guard += 1) {
    if (value >= min) ticks.push(value);
    const next = advanceTime(value, step, utc);
    if (!(next > value)) break;
    value = next;
  }
  if (!ticks.length) ticks.push(min, max);
  return { min, max, ticks, step: step.ms };
}
