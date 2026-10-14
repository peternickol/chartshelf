export const CSS = `
.csh-host {
  --csh-fg: #1c2430;
  --csh-muted: #667085;
  --csh-tip-bg: #151922;
  --csh-tip-fg: #f8fafc;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  box-sizing: border-box;
  color: var(--csh-fg);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
  user-select: none;
  -webkit-user-select: none;
}
.csh-host * { box-sizing: border-box; }
.csh-head:empty { display: none; }
.csh-title {
  margin: 0;
  padding: 10px 12px 0;
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.02em;
}
.csh-sub {
  padding: 2px 12px 0;
  color: var(--csh-muted);
  font-size: 12px;
}
.csh-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.csh-body[data-legend="bottom"] { flex-direction: column; }
.csh-body[data-legend="top"] { flex-direction: column; }
.csh-body[data-legend="top"] .csh-legend { order: -1; }
.csh-body[data-legend="right"] { flex-direction: row; }
.csh-body[data-legend="left"] { flex-direction: row; }
.csh-body[data-legend="left"] .csh-legend { order: -1; }
.csh-body[data-legend="none"] .csh-legend { display: none; }
.csh-head[data-align="center"] { text-align: center; }
.csh-head[data-align="right"] { text-align: right; }
.csh-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 48px;
}
.csh-stage > svg {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  font-variant-numeric: tabular-nums;
}
.csh-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  padding: 2px 12px 8px;
}
.csh-body[data-legend="bottom"] .csh-legend,
.csh-body[data-legend="top"] .csh-legend {
  justify-content: center;
}
.csh-body[data-legend="right"] .csh-legend,
.csh-body[data-legend="left"] .csh-legend {
  flex-direction: column;
  flex-wrap: nowrap;
  justify-content: center;
  max-width: 180px;
  padding: 8px 12px 8px 4px;
  overflow: auto;
}
.csh-body[data-legend="left"] .csh-legend { padding: 8px 4px 8px 12px; }
.csh-legend button {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 2px 6px;
  margin: 0 -6px;
  cursor: pointer;
  border-radius: 6px;
}
.csh-legend button:hover {
  background: color-mix(in srgb, var(--csh-fg) 7%, transparent);
}
.csh-legend button:focus-visible {
  outline: 2px solid var(--csh-fg);
  outline-offset: 2px;
}
.csh-legend button[aria-pressed="false"] { opacity: 0.4; }
.csh-legend .csh-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.csh-swatch {
  width: 8px;
  height: 8px;
  flex: none;
  border-radius: 99px;
}
.csh-tip {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  min-width: 128px;
  max-width: 240px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--csh-tip-fg) 14%, transparent);
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.16), transparent 42%),
    var(--csh-tip-bg);
  color: var(--csh-tip-fg);
  box-shadow: 0 14px 36px rgba(15, 23, 42, 0.2);
  font-size: 12px;
  line-height: 1.35;
}
.csh-tip[hidden] { display: none; }
.csh-tip-title {
  margin-bottom: 4px;
  font-weight: 650;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  opacity: 0.72;
}
.csh-tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.csh-tip .csh-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.csh-tip-val {
  margin-left: auto;
  padding-left: 12px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}
.csh-tools {
  position: absolute;
  z-index: 4;
  top: 0;
  right: 3px;
  display: flex;
  align-items: center;
  max-width: 176px;
  padding: 0 6px 2px;
  border: 0;
  background: transparent;
}
.csh-tools button {
  appearance: none;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: #6e8192;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.csh-tools button[data-tool="reset"] { margin-left: 5px; }
.csh-tools button:hover { color: #333; }
.csh-tools button[aria-pressed="true"] { color: #008ffb; }
.csh-host[data-theme="dark"] .csh-tools button { color: #f3f4f5; }
.csh-host[data-theme="dark"] .csh-tools button:hover { color: #fff; }
.csh-host[data-theme="dark"] .csh-tools button[aria-pressed="true"] { color: #008ffb; }
.csh-tools button:focus-visible {
  outline: 2px solid #008ffb;
  outline-offset: 2px;
}
.csh-tools svg {
  width: 16px;
  height: 16px;
  display: block;
}
`.replace(/font-weight: 650/g, 'font-weight: 600');
