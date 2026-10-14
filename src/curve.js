import { round } from './util.js';

/** Share of the x gap used by each flat handle on a smooth stroke. */
const SMOOTH_HANDLE = 0.35;

/**
 * Smooth strokes keep a level tangent at every sample. Each cubic handle
 * stays at that sample's height, so the line shelves through the point and
 * stays between the two sample heights. Points are in pixel space.
 * @param {{x: number, y: number}[]} points
 * @param {'smooth' | 'straight' | 'stepline'} curve
 */
export function lineCommands(points, curve = 'smooth') {
  if (!points.length) return [];
  if (curve === 'stepline') return stepCommands(points);
  if (curve !== 'smooth' || points.length < 2) return polyCommands(points, 'L');
  return smoothCommands(points);
}

function polyCommands(points, op) {
  return points.map((point, index) => ({
    op: index === 0 ? 'M' : op,
    x: point.x,
    y: point.y,
  }));
}

/** Hold the value until the next sample, then jump. */
function stepCommands(points) {
  const commands = [{ op: 'M', x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length; i += 1) {
    commands.push({ op: 'H', x: points[i].x });
    commands.push({ op: 'V', y: points[i].y });
  }
  return commands;
}

function smoothCommands(points) {
  const commands = [{ op: 'M', x: points[0].x, y: points[0].y }];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    const handle = SMOOTH_HANDLE * (to.x - from.x);
    commands.push({
      op: 'C',
      x1: from.x + handle,
      y1: from.y,
      x2: to.x - handle,
      y2: to.y,
      x: to.x,
      y: to.y,
    });
  }
  return commands;
}

/**
 * Closed band between a top edge and a baseline.
 * The end cap is a straight drop to the last baseline sample, then the
 * baseline runs back. Stepline baselines return as straight lines.
 */
export function areaCommands(top, base, curve) {
  if (top.length < 2 || base.length !== top.length) return [];
  const forward = lineCommands(top, curve);
  const backCurve = curve === 'stepline' ? 'straight' : curve;
  const last = base[base.length - 1];
  const back = lineCommands([...base].reverse(), backCurve).slice(1);
  return [...forward, { op: 'L', x: last.x, y: last.y }, ...back, { op: 'Z' }];
}

export function toPath(commands) {
  let path = '';
  for (const command of commands) {
    if (command.op === 'M') path += `M${round(command.x)},${round(command.y)}`;
    else if (command.op === 'L') path += `L${round(command.x)},${round(command.y)}`;
    else if (command.op === 'H') path += `H${round(command.x)}`;
    else if (command.op === 'V') path += `V${round(command.y)}`;
    else if (command.op === 'C') {
      path += `C${round(command.x1)},${round(command.y1)},${round(command.x2)},${round(command.y2)},${round(command.x)},${round(command.y)}`;
    } else if (command.op === 'Z') path += 'Z';
  }
  return path;
}

/**
 * Same string as `toPath(lineCommands(points, curve))`, without a command object per sample.
 * @param {{x: number, y: number}[]} points
 */
export function linePath(points, curve = 'smooth') {
  const count = points.length;
  if (!count) return '';
  let path = `M${dec(points[0].x)},${dec(points[0].y)}`;
  if (count === 1) return path;
  if (curve === 'stepline') {
    for (let index = 1; index < count; index += 1) {
      path += `H${dec(points[index].x)}V${dec(points[index].y)}`;
    }
    return path;
  }
  if (curve !== 'smooth') {
    for (let index = 1; index < count; index += 1) {
      path += `L${dec(points[index].x)},${dec(points[index].y)}`;
    }
    return path;
  }
  for (let index = 0; index < count - 1; index += 1) {
    path += smoothSegment(points[index].x, points[index].y, points[index + 1].x, points[index + 1].y);
  }
  return path;
}

/** `linePath` for parallel coordinate lists. */
export function lineCoords(xs, ys, curve = 'smooth') {
  const count = xs.length;
  if (!count) return '';
  let path = `M${dec(xs[0])},${dec(ys[0])}`;
  if (count === 1) return path;
  if (curve === 'stepline') {
    for (let index = 1; index < count; index += 1) {
      path += `H${dec(xs[index])}V${dec(ys[index])}`;
    }
    return path;
  }
  if (curve !== 'smooth') {
    for (let index = 1; index < count; index += 1) {
      path += `L${dec(xs[index])},${dec(ys[index])}`;
    }
    return path;
  }
  for (let index = 0; index < count - 1; index += 1) {
    path += smoothSegment(xs[index], ys[index], xs[index + 1], ys[index + 1]);
  }
  return path;
}

/** Closed band. Drops to the last baseline sample, then returns along it. */
export function areaPath(top, base, curve = 'smooth') {
  if (top.length < 2 || base.length !== top.length) return '';
  const back = curve === 'stepline' ? 'straight' : curve;
  const last = base[base.length - 1];
  return linePath(top, curve) + `L${dec(last.x)},${dec(last.y)}` + backPath(base, back) + 'Z';
}

/**
 * Area whose baseline is one locked pixel.
 * `{ y }` keeps each sample x. `{ x }` keeps each sample y.
 */
export function areaBand(xs, ys, curve, baseline) {
  const count = xs.length;
  if (count < 2) return '';
  const back = curve === 'stepline' ? 'straight' : curve;
  const xLock = baseline.x == null ? null : baseline.x;
  const yLock = baseline.y == null ? null : baseline.y;
  const endX = xLock == null ? xs[count - 1] : xLock;
  const endY = yLock == null ? ys[count - 1] : yLock;
  return lineCoords(xs, ys, curve) + `L${dec(endX)},${dec(endY)}` + backCoords(xs, ys, back, xLock, yLock) + 'Z';
}

function smoothSegment(x1, y1, x2, y2) {
  const handle = SMOOTH_HANDLE * (x2 - x1);
  return `C${dec(x1 + handle)},${dec(y1)},${dec(x2 - handle)},${dec(y2)},${dec(x2)},${dec(y2)}`;
}

/**
 * One decimal, the same text as `String(round(value))`.
 * The general number conversion is the expensive part of a long stroke.
 */
function dec(value) {
  const scaled = Math.round(value * 10);
  if (!Number.isFinite(scaled) || scaled > 1e15 || scaled < -1e15) return String(round(value));
  const neg = scaled < 0;
  const abs = neg ? -scaled : scaled;
  const frac = abs % 10;
  const whole = (abs - frac) / 10;
  const digits = frac ? `${whole}.${frac}` : String(whole);
  return neg ? `-${digits}` : digits;
}

function backPath(points, curve) {
  const count = points.length;
  if (count < 2) return '';
  let path = '';
  if (curve !== 'smooth') {
    for (let index = count - 2; index >= 0; index -= 1) {
      path += `L${dec(points[index].x)},${dec(points[index].y)}`;
    }
    return path;
  }
  for (let index = count - 1; index > 0; index -= 1) {
    path += smoothSegment(points[index].x, points[index].y, points[index - 1].x, points[index - 1].y);
  }
  return path;
}

function backCoords(xs, ys, curve, xLock, yLock) {
  const count = xs.length;
  if (count < 2) return '';
  let path = '';
  if (curve !== 'smooth') {
    for (let index = count - 2; index >= 0; index -= 1) {
      const x = xLock == null ? xs[index] : xLock;
      const y = yLock == null ? ys[index] : yLock;
      path += `L${dec(x)},${dec(y)}`;
    }
    return path;
  }
  for (let index = count - 1; index > 0; index -= 1) {
    const x1 = xLock == null ? xs[index] : xLock;
    const y1 = yLock == null ? ys[index] : yLock;
    const x2 = xLock == null ? xs[index - 1] : xLock;
    const y2 = yLock == null ? ys[index - 1] : yLock;
    path += smoothSegment(x1, y1, x2, y2);
  }
  return path;
}

/** Split a series wherever a sample is missing so lines do not bridge gaps. */
export function segments(points) {
  const result = [];
  let current = [];
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (current.length) result.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length) result.push(current);
  return result;
}
