import { formatTimePattern } from './format.js';
import { palette } from './theme.js';
import {
  clean,
  fail,
  finite,
  isEpochMillis,
  isIsoDate,
  labelize,
  safeColor,
  xNumber,
} from './util.js';

const TYPES = new Set([
  'line', 'area', 'bar', 'pie', 'donut', 'scatter',
  'radialBar', 'heatmap', 'candlestick', 'boxPlot', 'radar',
  'polarArea', 'rangeBar', 'rangeArea', 'treemap',
]);
const RANGE_TYPES = new Set(['candlestick', 'boxPlot', 'rangeBar', 'rangeArea']);

/**
 * Turn the short public config into one model the geometry code can trust.
 * Series may be a number list, a name→values map, `{ name, data }[]`, or rows.
 */
export function normalize(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    fail('config must be an object');
  }

  let type = config.type || 'line';
  let horizontal = !!config.horizontal;
  if (type === 'horizontalBar' || type === 'hbar') {
    type = 'bar';
    horizontal = true;
  }
  if (type === 'column') type = 'bar';
  if (type === 'spline') type = 'line';
  if (type === 'radialbar') type = 'radialBar';
  if (type === 'boxplot') type = 'boxPlot';
  if (type === 'rangebar') type = 'rangeBar';
  if (type === 'rangearea') type = 'rangeArea';
  if (type === 'polararea') type = 'polarArea';
  if (!TYPES.has(type)) fail(`unknown chart type "${type}"`);

  const pie = type === 'pie' || type === 'donut';
  const slice = pie || type === 'polarArea' || type === 'radialBar';
  const parsed = parseData(config, type, slice);
  const colors = Array.isArray(config.colors) ? config.colors : [];

  const series = parsed.series.map((seriesItem, index) => {
    const meta = seriesMeta(seriesItem);
    return {
      name: seriesItem.name,
      values: seriesItem.values,
      points: seriesItem.points,
      extras: seriesItem.extras || meta.extras,
      color: safeColor(seriesItem.color || colors[index], palette[index % palette.length]),
      hidden: !!seriesItem.hidden,
      hiddenSet: seriesItem.hidden != null,
      seriesType: meta.seriesType,
      yIndex: meta.yIndex,
      strokeWidth: meta.strokeWidth == null ? null : clampNum(meta.strokeWidth, 2, 0, 16),
      dash: dashFor(seriesItem, config, index),
      curve: meta.curve,
      fillOpacity: meta.fillOpacity == null ? null : clampNum(meta.fillOpacity, 0.38, 0, 1),
      markerSize: meta.markerSize == null ? null : clampNum(meta.markerSize, 3.5, 0, 14),
    };
  });

  const axisless = slice || type === 'treemap';
  const model = {
    type,
    horizontal: horizontal && (type === 'bar' || type === 'rangeBar'),
    stacked: !!config.stacked && !slice && !RANGE_TYPES.has(type) && type !== 'scatter' && type !== 'heatmap' && type !== 'treemap' && type !== 'radar',
    stackType: config.stackType === '100%' ? '100%' : 'normal',
    curve: config.curve === 'straight' || config.curve === 'stepline' ? config.curve : 'smooth',
    strokeWidth: clampNum(config.strokeWidth, 2.25, 0, 16),
    fillOpacity: clampNum(config.fillOpacity, 0.2, 0, 1),
    solidFill: !!config.solidFill,
    markers: config.markers == null ? 'auto' : config.markers,
    markerSize: clampNum(config.markerSize, 3.5, 0, 14),
    legend: parseLegend(config.legend, series.length > 1 || slice),
    grid: parseGrid(config.grid),
    tooltip: config.tooltip !== false,
    axes: config.axes !== false && !axisless,
    animate: config.animate !== false,
    title: config.title ? String(config.title) : '',
    subtitle: config.subtitle ? String(config.subtitle) : '',
    titleAlign: config.titleAlign === 'center' || config.titleAlign === 'right' ? config.titleAlign : 'left',
    background: config.background ? safeColor(config.background, null) : null,
    theme: config.theme || 'auto',
    fontFamily: sanitizeFont(config.fontFamily),
    height: parseSize(config.height, 320),
    width: config.width == null ? null : parseSize(config.width, 0),
    inner: pie || type === 'radialBar'
      ? clampNum(
        config.inner,
        type === 'donut' ? 0.62 : (type === 'radialBar' ? 0.42 : 0),
        0,
        type === 'radialBar' ? 0.92 : 0.86,
      )
      : 0,
    barRadius: clampNum(config.barRadius, 5, 0, 24),
    band: config.band == null ? null : clampNum(config.band, 0.7, 0.05, 1),
    showValues: config.showValues == null ? slice : !!config.showValues,
    center: config.center === undefined ? null : config.center,
    gap: clampNum(config.gap, 0, 0, 24),
    start: config.start == null ? null : clampNum(config.start, 0, -1080, 1080),
    end: config.end == null ? null : clampNum(config.end, 360, -1080, 1080),
    id: config.id ? String(config.id).slice(0, 80) : '',
    zoom: config.zoom === true || config.zoom === 'x',
    brush: parseBrush(config.brush),
    hoverSize: config.hoverSize == null ? null : clampNum(config.hoverSize, 5, 0, 18),
    x: parseAxis(config.x, true),
    y: parseAxis(config.y),
    yAxes: Array.isArray(config.yAxes) ? config.yAxes.map((axis) => parseAxis(axis)) : null,
    categories: parsed.categories,
    series,
    colors: colors.map((color, index) => safeColor(color, palette[index % palette.length])),
    distributed: !!config.distributed,
    pointMode: parsed.pointMode,
    emptyText: config.emptyText ? String(config.emptyText).slice(0, 80) : 'No data',
    candleUp: safeColor(config.candleUp, '#00B746'),
    candleDown: safeColor(config.candleDown, '#FF4560'),
    annotations: parseAnnotations(config.annotations),
    tooltipFormat: typeof config.tooltipFormat === 'function' ? config.tooltipFormat : null,
    onPoint: typeof config.onPoint === 'function' ? config.onPoint : null,
    onLegend: typeof config.onLegend === 'function' ? config.onLegend : null,
    sparkline: !!config.sparkline,
  };

  if (model.y.zero == null) model.y.zero = type === 'bar' || type === 'area';
  if (model.stackType === '100%') {
    model.y.zero = true;
    if (model.y.min == null) model.y.min = 0;
    if (model.y.max == null) model.y.max = 100;
    if (!model.y.format) model.y.format = (value) => `${Math.round(value)}%`;
  }
  if (config.sparkline) {
    if (config.axes == null) model.axes = false;
    if (config.legend == null) model.legend = { show: false, position: 'bottom' };
    if (config.grid == null) model.grid = { x: false, y: false };
    model.tooltip = config.tooltip !== false;
  }
  return model;
}

function parseSize(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(32, number);
}

function clampNum(value, fallback, min, max) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function parseAxis(axis, time = false) {
  const empty = {
    title: '', min: null, max: null, format: null, zero: null, type: null,
    opposite: false, show: true, color: null, utc: false, refit: true,
  };
  if (!axis || typeof axis !== 'object' || Array.isArray(axis)) return empty;
  const minFn = typeof axis.min === 'function' ? axis.min : null;
  const maxFn = typeof axis.max === 'function' ? axis.max : null;
  const utc = !!axis.utc;
  let format = typeof axis.format === 'function' ? axis.format : null;
  if (!format && time && typeof axis.format === 'string' && axis.format.trim()) {
    const pattern = axis.format.trim().slice(0, 64);
    format = (value) => formatTimePattern(value, pattern, utc);
  }
  return {
    title: axis.title ? String(axis.title) : '',
    min: minFn ? null : finite(axis.min),
    max: maxFn ? null : finite(axis.max),
    minFn,
    maxFn,
    format,
    zero: axis.zero == null ? null : !!axis.zero,
    type: axis.type === 'time' || axis.type === 'linear' || axis.type === 'category' ? axis.type : null,
    opposite: !!axis.opposite,
    show: axis.show !== false,
    color: axis.color ? safeColor(axis.color, null) : null,
    utc,
    refit: axis.refit !== false,
  };
}

function parseBrush(brush) {
  if (!brush || typeof brush !== 'object' || Array.isArray(brush)) return null;
  return {
    target: brush.target ? String(brush.target).slice(0, 80) : '',
    min: finite(brush.min),
    max: finite(brush.max),
  };
}

function parseDash(value) {
  if (value == null || value === false) return null;
  if (Array.isArray(value)) {
    const parts = value.map((part) => Number(part)).filter((part) => Number.isFinite(part) && part >= 0).slice(0, 4);
    if (!parts.length || parts.every((part) => part === 0)) return null;
    return parts.join(' ');
  }
  if (typeof value === 'string') {
    const parts = value.trim().split(/[\s,]+/).map(Number);
    if (parts.length && parts.every((part) => Number.isFinite(part))) return parseDash(parts);
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return `${number} ${number}`;
}

function dashFor(seriesItem, config, index) {
  if (seriesItem && Object.prototype.hasOwnProperty.call(seriesItem, 'dash')) return parseDash(seriesItem.dash);
  if (Array.isArray(config.dash)) return parseDash(config.dash[index]);
  return parseDash(config.dash);
}

/** Merge a partial config. `x`, `y`, `legend`, and `grid` merge one level deep. */
export function mergeConfig(base, partial) {
  const next = { ...(base || {}), ...(partial || {}) };
  for (const key of ['x', 'y', 'legend', 'grid']) {
    if (partial?.[key] && typeof partial[key] === 'object' && !Array.isArray(partial[key])) {
      const previous = base?.[key] && typeof base[key] === 'object' && !Array.isArray(base[key]) ? base[key] : {};
      next[key] = { ...previous, ...partial[key] };
    }
  }
  return next;
}

/** Apply every responsive rule whose `maxWidth` is at least the host width. Narrower rules win. */
export function applyResponsive(config, width) {
  if (!config || !Array.isArray(config.responsive) || !(Number(width) > 0)) return config;
  const rules = config.responsive
    .filter((rule) => rule && typeof rule === 'object' && Number(width) <= Number(rule.maxWidth))
    .sort((a, b) => Number(b.maxWidth) - Number(a.maxWidth));
  let next = config;
  for (const rule of rules) {
    const source = rule.patch && typeof rule.patch === 'object' ? rule.patch : rule;
    const patch = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === 'maxWidth' || key === 'patch') continue;
      patch[key] = value;
    }
    next = mergeConfig(next, patch);
  }
  return next;
}

function parseLegend(legend, defaultShow) {
  if (legend === false) return { show: false, position: 'bottom' };
  if (legend === true || legend == null) return { show: defaultShow, position: 'bottom' };
  const position = legend.position === 'top' || legend.position === 'right' || legend.position === 'left'
    ? legend.position
    : 'bottom';
  return { show: legend.show !== false, position };
}

function parseGrid(grid) {
  if (grid === false) return { x: false, y: false };
  if (grid === true || grid == null) return { x: false, y: true };
  return { x: !!grid.x, y: grid.y !== false };
}

function categoriesOf(config) {
  const source = config.categories ?? config.labels;
  if (!Array.isArray(source)) return null;
  return source.map((item) => (item == null ? '' : String(item)));
}

function parseData(config, type, pie) {
  if (type === 'treemap') return fromTreemap(config);
  if (RANGE_TYPES.has(type)) return fromRange(config);
  if (Array.isArray(config.data)) return fromRows(config, type, pie);
  if (config.series == null) fail('pass series or data');
  return fromSeries(config, type, pie);
}

function fromSeries(config, type, pie) {
  const raw = config.series;

  if (Array.isArray(raw) && (raw.length === 0 || isScalar(raw[0]))) {
    return scalarsToModel(raw, categoriesOf(config), pie, config.name);
  }

  if (!Array.isArray(raw) && typeof raw === 'object') {
    const entries = Object.entries(raw);
    if (entries.every(([, value]) => isScalar(value))) {
      const labels = entries.map(([key]) => String(key));
      const values = entries.map(([, value]) => finite(value));
      return scalarsToModel(values, labels, pie, config.name);
    }
    const series = entries.map(([name, data]) => ({
      ...seriesFromData(String(name), data),
      color: null,
      hidden: null,
    }));
    return finishCartesian(series, config, type);
  }

  if (Array.isArray(raw)) {
    if (pie && raw.every((item) => item && (typeof item === 'number' || typeof item.data === 'number'))) {
      return {
        pointMode: 'pie',
        categories: null,
        series: raw.map((item, index) => ({
          name: item.name != null ? String(item.name) : (categoriesOf(config)?.[index] ?? `Slice ${index + 1}`),
          values: [finite(typeof item === 'number' ? item : item.data)],
          points: null,
          color: item.color,
          hidden: item.hidden,
        })),
      };
    }

    const series = raw.map((item, index) => {
      if (isScalar(item)) {
        return {
          name: categoriesOf(config)?.[index] || `Series ${index + 1}`,
          values: [finite(item)],
          points: null,
          color: null,
          hidden: null,
        };
      }
      const built = seriesFromData(item.name != null ? String(item.name) : `Series ${index + 1}`, item.data);
      built.color = item.color;
      built.hidden = item.hidden;
      Object.assign(built, seriesMeta(item));
      return built;
    });

    if (pie) return pieFromCartesian(series, config);
    return finishCartesian(series, config, type);
  }

  fail('series must be a list, a map, or a list of numbers');
}

function isScalar(value) {
  return value == null || ['number', 'string', 'boolean'].includes(typeof value);
}

/** An explicit label is kept, including `''`. A missing label becomes `Slice N`. */
function sliceName(labels, index) {
  if (!labels || labels[index] == null) return `Slice ${index + 1}`;
  return String(labels[index]);
}

function scalarsToModel(values, labels, pie, name) {
  if (pie) {
    return {
      pointMode: 'pie',
      categories: null,
      series: values.map((value, index) => ({
        name: sliceName(labels, index),
        values: [finite(value)],
        points: null,
        color: null,
        hidden: null,
      })),
    };
  }
  return {
    pointMode: 'index',
    categories: labels,
    series: [{
      name: name ? String(name) : 'Value',
      values: values.map((value) => finite(value)),
      points: null,
      color: null,
      hidden: null,
    }],
  };
}

function seriesFromData(name, data) {
  if (data == null) return { name, values: [], points: null, color: null, hidden: null };
  if (isScalar(data)) return { name, values: [finite(data)], points: null, color: null, hidden: null };
  if (!Array.isArray(data)) fail(`series "${name}" data must be an array or number`);
  if (!data.length) return { name, values: [], points: null, color: null, hidden: null };

  const sample = data.find((item) => item != null && typeof item === 'object');
  if (sample && Array.isArray(sample)) {
    return {
      name,
      values: null,
      points: data.map((item) => {
        if (item == null) return null;
        const x = xNumber(item[0]);
        const y = finite(item[1]);
        return x == null || y == null ? null : { x, y };
      }),
      color: null,
      hidden: null,
    };
  }
  if (sample && 'x' in sample && 'y' in sample) {
    return {
      name,
      values: null,
      points: data.map((item) => {
        if (item == null) return null;
        const x = xNumber(item.x);
        const y = finite(item.y);
        return x == null || y == null ? null : { x, y };
      }),
      color: null,
      hidden: null,
    };
  }
  return {
    name,
    values: data.map((item) => (item == null || item === '' ? null : finite(item))),
    points: null,
    color: null,
    hidden: null,
  };
}

/** One `{ name, data: number[] }` series on a pie becomes one slice per value. */
function pieFromCartesian(series, config) {
  if (series.length === 1 && series[0].values && series[0].values.length > 1 && !series[0].points) {
    const labels = categoriesOf(config);
    return {
      pointMode: 'pie',
      categories: null,
      series: series[0].values.map((value, index) => ({
        name: sliceName(labels, index),
        values: [value],
        points: null,
        color: null,
        hidden: null,
      })),
    };
  }
  return {
    pointMode: 'pie',
    categories: null,
    series: series.map((item) => ({
      ...item,
      values: [sliceValue(item)],
      points: null,
    })),
  };
}

function sliceValue(series) {
  if (series.values?.length) return series.values[series.values.length - 1];
  if (series.points?.length) {
    const last = [...series.points].reverse().find((point) => point);
    return last ? last.y : null;
  }
  return null;
}

function finishCartesian(series, config, type) {
  const categories = categoriesOf(config);
  const wantsPoints = type === 'scatter' || series.some((item) => item.points);
  if (!wantsPoints) {
    return { series, categories, pointMode: 'index' };
  }

  const pointMode = pointModeFor(series, config, type);
  const normalized = series.map((item) => {
    if (item.points) return item;
    const points = (item.values || []).map((y, index) => (y == null ? null : { x: index, y }));
    return { ...item, points, values: null };
  });
  return {
    series: normalized,
    categories: pointMode === 'index' ? categories : null,
    pointMode,
  };
}

function pointModeFor(series, config, type) {
  if (config.x?.type === 'category') return 'index';
  if (config.x?.type === 'time') return 'time';
  if (config.x?.type === 'linear') return 'linear';
  if (type !== 'scatter' && categoriesOf(config) && series.every((item) => !item.points)) return 'index';
  const xs = [];
  for (const item of series) {
    for (const point of item.points || []) {
      if (point) xs.push(point.x);
    }
  }
  if (xs.length && xs.every((value) => isEpochMillis(value))) return 'time';
  return type === 'scatter' || series.some((item) => item.points) ? 'linear' : 'index';
}

function fromRows(config, type, pie) {
  const rows = config.data.filter((row) => row && typeof row === 'object');
  if (!rows.length) {
    return { series: [], categories: [], pointMode: pie ? 'pie' : 'index' };
  }

  const keys = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) keys.push(key);
    }
  }

  const groupKey = config.groupKey || null;
  const xKey = config.xKey || keys.find((key) => rows.some((row) => isCategoryLike(row[key]))) || keys[0];
  let yKeys = config.yKeys == null ? null : (Array.isArray(config.yKeys) ? config.yKeys.map(String) : [String(config.yKeys)]);
  if (!yKeys) {
    yKeys = keys.filter((key) => key !== xKey && key !== groupKey && rows.some((row) => typeof row[key] === 'number'));
  }
  if (!yKeys.length) fail('could not find numeric columns in data');

  if (pie && !groupKey) {
    const yKey = yKeys[0];
    return {
      pointMode: 'pie',
      categories: null,
      series: rows.map((row, index) => ({
        name: row[xKey] == null ? `Slice ${index + 1}` : String(row[xKey]),
        values: [finite(row[yKey])],
        points: null,
        color: null,
        hidden: null,
      })),
    };
  }

  const xKind = columnKind(rows, xKey);
  const asPoints = type === 'scatter' || (type !== 'bar' && (xKind === 'time' || (xKind === 'number' && config.x?.type !== 'category')));

  if (groupKey && asPoints) {
    return groupedPoints(rows, xKey, yKeys[0], groupKey, xKind, config);
  }
  if (groupKey) return groupedCategories(rows, xKey, yKeys[0], groupKey);
  if (asPoints) return pointRows(rows, xKey, yKeys, xKind, config);

  return {
    pointMode: 'index',
    categories: rows.map((row) => cellLabel(row[xKey])),
    series: yKeys.map((key) => ({
      name: labelize(key),
      values: rows.map((row) => finite(row[key])),
      points: null,
      color: null,
      hidden: null,
    })),
  };
}

function cellLabel(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (value == null) return '';
  return String(value);
}

function isCategoryLike(value) {
  if (value instanceof Date) return true;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isFinite(Number(value))) return true;
  return isIsoDate(value);
}

function columnKind(rows, key) {
  let kind = 'empty';
  for (const row of rows) {
    const value = row[key];
    if (value == null || value === '') continue;
    if (value instanceof Date || isIsoDate(value) || isEpochMillis(typeof value === 'number' ? value : NaN)) return 'time';
    if (typeof value === 'number' || (typeof value === 'string' && Number.isFinite(Number(value)))) {
      kind = 'number';
      continue;
    }
    return 'category';
  }
  return kind;
}

function groupedCategories(rows, xKey, yKey, groupKey) {
  const categories = [];
  const seen = new Set();
  const groups = new Map();
  for (const row of rows) {
    const category = cellLabel(row[xKey]);
    if (!seen.has(category)) {
      seen.add(category);
      categories.push(category);
    }
    const group = String(row[groupKey] ?? 'Series');
    if (!groups.has(group)) groups.set(group, new Map());
    groups.get(group).set(category, finite(row[yKey]));
  }
  return {
    pointMode: 'index',
    categories,
    series: [...groups].map(([name, values]) => ({
      name: labelize(name),
      values: categories.map((category) => (values.has(category) ? values.get(category) : null)),
      points: null,
      color: null,
      hidden: null,
    })),
  };
}

function groupedPoints(rows, xKey, yKey, groupKey, xKind, config) {
  const groups = new Map();
  for (const row of rows) {
    const x = xNumber(row[xKey]);
    const y = finite(row[yKey]);
    if (x == null || y == null) continue;
    const group = String(row[groupKey] ?? 'Series');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ x, y });
  }
  return {
    pointMode: resolvePointMode(xKind, config),
    categories: null,
    series: [...groups].map(([name, points]) => ({
      name: labelize(name),
      values: null,
      points,
      color: null,
      hidden: null,
    })),
  };
}

function pointRows(rows, xKey, yKeys, xKind, config) {
  const series = yKeys.map((key) => ({
    name: labelize(key),
    values: null,
    points: rows.map((row) => {
      const x = xNumber(row[xKey]);
      const y = finite(row[key]);
      return x == null || y == null ? null : { x, y };
    }),
    color: null,
    hidden: null,
  }));
  return { pointMode: resolvePointMode(xKind, config), categories: null, series };
}

function resolvePointMode(xKind, config) {
  if (config.x?.type === 'time' || xKind === 'time') return 'time';
  return 'linear';
}

/**
 * Stack positive and negative values separately.
 * `outer` marks the segment that should keep the rounded cap.
 * @param {{ hidden?: boolean, values: (number | null)[] | null }[]} series
 */
export function stackSeries(series) {
  const count = series.reduce((max, item) => Math.max(max, item.values?.length || 0), 0);
  const base = series.map(() => Array(count).fill(null));
  const top = series.map(() => Array(count).fill(null));
  const outer = series.map(() => Array(count).fill(false));
  const positive = Array(count).fill(0);
  const negative = Array(count).fill(0);
  const positiveOwner = Array(count).fill(-1);
  const negativeOwner = Array(count).fill(-1);

  for (let index = 0; index < count; index += 1) {
    for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
      if (series[seriesIndex].hidden) continue;
      const value = series[seriesIndex].values?.[index];
      if (value == null || !Number.isFinite(value)) continue;
      if (value >= 0) {
        base[seriesIndex][index] = positive[index];
        positive[index] = clean(positive[index] + value);
        top[seriesIndex][index] = positive[index];
        positiveOwner[index] = seriesIndex;
      } else {
        base[seriesIndex][index] = negative[index];
        negative[index] = clean(negative[index] + value);
        top[seriesIndex][index] = negative[index];
        negativeOwner[index] = seriesIndex;
      }
    }
    if (positiveOwner[index] >= 0) outer[positiveOwner[index]][index] = true;
    if (negativeOwner[index] >= 0) outer[negativeOwner[index]][index] = true;
  }

  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < count; index += 1) {
    if (positiveOwner[index] >= 0 || negativeOwner[index] >= 0) {
      min = Math.min(min, negative[index]);
      max = Math.max(max, positive[index]);
    }
  }
  return {
    base,
    top,
    outer,
    min: min === Infinity ? 0 : min,
    max: max === -Infinity ? 1 : max,
  };
}

function seriesMeta(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { seriesType: null, yIndex: 0, strokeWidth: null, curve: null, fillOpacity: null, markerSize: null, extras: null };
  }
  const curve = item.curve === 'straight' || item.curve === 'stepline' || item.curve === 'smooth' ? item.curve : null;
  const meta = {
    seriesType: seriesKind(item.seriesType || item.type),
    yIndex: Number.isInteger(item.yIndex) ? item.yIndex : 0,
    strokeWidth: item.strokeWidth == null ? null : item.strokeWidth,
    curve,
    fillOpacity: item.fillOpacity == null ? null : item.fillOpacity,
    markerSize: item.markerSize == null ? null : item.markerSize,
    extras: item.extras || null,
  };
  if (Object.prototype.hasOwnProperty.call(item, 'dash')) meta.dash = item.dash;
  return meta;
}

function seriesKind(value) {
  if (value === 'column' || value === 'bar') return 'bar';
  if (value === 'area') return 'area';
  if (value === 'line' || value === 'spline') return 'line';
  if (value === 'scatter') return 'scatter';
  return null;
}

function sanitizeFont(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 140 || !/^[\w\s,"'-]+$/.test(text)) return null;
  return text;
}

function parseAnnotations(input) {
  if (!input || typeof input !== 'object') return null;
  const y = Array.isArray(input.yaxis) ? input.yaxis.map((item) => {
    const value = finite(item?.y);
    if (value == null) return null;
    return { y: value, color: item.borderColor || item.color || null, text: item.label?.text || '' };
  }).filter(Boolean) : [];
  const x = Array.isArray(input.xaxis) ? input.xaxis.map((item) => {
    if (item?.x == null) return null;
    return { x: item.x, color: item.borderColor || item.color || null, text: item.label?.text || '' };
  }).filter(Boolean) : [];
  const points = Array.isArray(input.points) ? input.points.map((item) => {
    const value = finite(item?.y);
    if (value == null || item?.x == null) return null;
    return { x: item.x, y: value, color: item.marker?.fillColor || item.color || null, text: item.label?.text || '' };
  }).filter(Boolean) : [];
  if (!y.length && !x.length && !points.length) return null;
  return { y, x, points };
}

function fromTreemap(config) {
  const raw = config.series;
  if (!Array.isArray(raw)) {
    if (raw && typeof raw === 'object') {
      return scalarsToModel(Object.values(raw).map((value) => finite(value)), Object.keys(raw), true, config.name);
    }
    fail('pass series or data');
  }
  if (raw.every((item) => isScalar(item))) return scalarsToModel(raw, categoriesOf(config), true, config.name);

  const series = [];
  raw.forEach((item) => {
    const data = Array.isArray(item?.data) ? item.data : [];
    if (data.length && data.every((entry) => entry && typeof entry === 'object' && 'x' in entry)) {
      data.forEach((entry) => {
        series.push({
          name: entry.x == null ? `Slice ${series.length + 1}` : String(entry.x),
          values: [finite(entry.y)],
          points: null,
          color: entry.fillColor || item.color || null,
          hidden: item.hidden,
          ...seriesMeta(item),
        });
      });
      return;
    }
    data.forEach((value, index) => {
      if (!isScalar(value)) return;
      const labels = categoriesOf(config);
      series.push({
        name: labels ? sliceName(labels, index) : (item?.name || `Slice ${series.length + 1}`),
        values: [finite(value)],
        points: null,
        color: item?.color || null,
        hidden: item?.hidden,
        ...seriesMeta(item),
      });
    });
  });
  return { pointMode: 'pie', categories: null, series };
}

function fromRange(config) {
  const raw = Array.isArray(config.series) ? config.series : null;
  if (!raw) fail('pass series or data');
  const built = raw.map((item, index) => {
    const name = item?.name != null ? String(item.name) : `Series ${index + 1}`;
    const data = Array.isArray(item?.data) ? item.data : [];
    return {
      name,
      values: null,
      points: data.map((entry) => parseRangeEntry(entry)),
      color: item?.color ?? null,
      hidden: item?.hidden ?? null,
      ...seriesMeta(item),
    };
  });
  const numeric = built.every((series) => series.points.every((point) => !point || typeof point.x === 'number'));
  if (!numeric || config.x?.type === 'category') {
    const labels = [];
    for (const series of built) {
      for (const point of series.points) {
        if (point?.label && !labels.includes(point.label)) labels.push(point.label);
      }
    }
    const categories = categoriesOf(config) || labels;
    const series = built.map((series) => {
      const values = categories.map(() => null);
      const extras = categories.map(() => null);
      series.points.forEach((point, index) => {
        if (!point) return;
        let at = point.label != null ? categories.indexOf(point.label) : index;
        if (at < 0) at = index;
        if (at < 0 || at >= categories.length) return;
        values[at] = point.y;
        extras[at] = point.extra;
      });
      return { ...series, values, extras, points: null };
    });
    return { pointMode: 'index', categories, series };
  }
  const xs = built.flatMap((series) => series.points.filter(Boolean).map((point) => point.x));
  const pointMode = config.x?.type === 'time' || (xs.length && xs.every((value) => isEpochMillis(value))) ? 'time' : 'linear';
  return { pointMode, categories: null, series: built };
}

function parseRangeEntry(entry) {
  if (entry == null) return null;
  if (Array.isArray(entry)) {
    const nums = entry.slice(1).map((value) => finite(value)).filter((value) => value != null);
    if (!nums.length) return null;
    const x = xNumber(entry[0]);
    if (x == null) {
      if (entry[0] == null) return null;
      return { x: entry[0], y: nums[nums.length - 1], extra: entry.slice(1).map((value) => finite(value)), label: String(entry[0]) };
    }
    return { x, y: nums[nums.length - 1], extra: entry.slice(1).map((value) => finite(value)), label: String(entry[0]) };
  }
  if (typeof entry === 'object' && Array.isArray(entry.y)) {
    const extra = entry.y.map((value) => finite(value));
    const nums = extra.filter((value) => value != null);
    if (!nums.length) return null;
    const x = xNumber(entry.x);
    const y = nums[nums.length - 1];
    if (x == null) {
      return { x: entry.x, y, extra, label: entry.x == null ? '' : String(entry.x) };
    }
    return { x, y, extra, label: entry.x == null ? '' : String(entry.x) };
  }
  return null;
}
