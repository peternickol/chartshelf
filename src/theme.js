export const palette = [
  '#3d6bf5',
  '#1aa37a',
  '#e39b12',
  '#e2547a',
  '#7a5af8',
  '#1693b8',
  '#e06a2f',
  '#5b8def',
];

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const themes = {
  light: {
    name: 'light',
    fg: '#1c2430',
    muted: '#667085',
    grid: '#e4e9f1',
    track: '#f1f3f7',
    axis: '#d5dbe6',
    zero: '#c5cedb',
    tipBg: '#151922',
    tipFg: '#f8fafc',
    empty: '#98a2b3',
    ring: '#ffffff',
  },
  dark: {
    name: 'dark',
    fg: '#e7ebf3',
    muted: '#9aa3b2',
    grid: '#2c3444',
    track: '#232b38',
    axis: '#3c4658',
    zero: '#566178',
    tipBg: '#f4f7fb',
    tipFg: '#141820',
    empty: '#8b95a7',
    ring: '#141820',
  },
};

/** @param {'light' | 'dark' | 'auto' | string | undefined} name @param {boolean} systemDark */
export function resolveTheme(name, systemDark) {
  const key = !name || name === 'auto' ? (systemDark ? 'dark' : 'light') : name;
  return themes[key] || themes.light;
}
