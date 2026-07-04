// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Condor — "Pulse" section: compact trend rows over the daily snapshot history
// (chrome.storage.local['practice.reportSnapshots']), built from the shared pure core
// (../pulse-core.js) so the panel and the Practice Report can never quietly diverge.
//
// Calm by design: only the WORSENING direction of a delta is coloured (amber/red per
// design tokens); an improving or flat delta stays neutral text. Sparse snapshot history
// is disclosed plainly, never hidden or smoothed.

'use strict';

import { buildPulseRows } from '../pulse-core.js';
import { sparkline } from '../report/report-render.js';

let cssInjected = false;
function ensureStyles() {
  if (cssInjected) return;
  if (typeof document === 'undefined') return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.condor-pulse-head { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; }
.condor-pulse-toggle { display:flex; gap:2px; }
.condor-pulse-toggle-btn {
  font-family:var(--mono); font-size:10px; font-weight:600; letter-spacing:0.04em;
  padding:2px 8px; border-radius:var(--r-pill); border:1px solid var(--border);
  background:transparent; color:var(--text-3); cursor:pointer;
}
.condor-pulse-toggle-btn.active { background:var(--bg-mid); color:var(--text-1); border-color:var(--text-3); }
.condor-pulse-rows { display:flex; flex-direction:column; gap:2px; }
.condor-pulse-row { display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid var(--border); }
.condor-pulse-row:last-child { border-bottom:none; }
.condor-pulse-label { flex:0 0 96px; font-size:11px; color:var(--text-2); }
.condor-pulse-spark { color:var(--text-3); flex:0 0 auto; }
.condor-pulse-figs { flex:1; display:flex; align-items:baseline; gap:6px; justify-content:flex-end; font-variant-numeric:tabular-nums; }
.condor-pulse-current { font-size:13px; font-weight:600; color:var(--text-1); }
.condor-pulse-unit { font-size:10px; color:var(--text-3); }
.condor-pulse-delta { font-size:11px; font-weight:600; }
.condor-pulse-delta.worsening { color:var(--red); }
.condor-pulse-delta.improving { color:var(--green); }
.condor-pulse-delta.flat, .condor-pulse-delta.unknown { color:var(--text-3); font-weight:400; }
.condor-pulse-empty { font-size:12px; color:var(--text-3); padding:6px 0; }
.condor-pulse-coverage { font-size:10px; color:var(--text-3); margin-top:6px; }
.condor-pulse-asof { font-size:10px; color:var(--text-3); }
  `;
  document.head.appendChild(s);
}

function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

function deltaText(m) {
  if (m.delta == null) return 'no prior-period data';
  const sign = m.delta > 0 ? '+' : '';
  const pctText = m.pct == null ? '' : ` (${sign}${m.pct}%)`;
  return `${sign}${m.delta}${pctText} vs prior period`;
}

// `period` is 7 or 30 (days). `data.pulseSnapshots` (full stored series) is passed by
// condor.js's poll() — this card does no I/O of its own, staying pure/testable-by-inspection
// like the other card renderers.
export function renderPulse(snapshots, period = 7) {
  ensureStyles();
  const safeSnapshots = Array.isArray(snapshots) ? snapshots : [];
  const built = buildPulseRows(safeSnapshots, period);

  if (!built.metrics.length) {
    return (
      `<div class="condor-card condor-pulse condor-quiet">` +
      `<div class="condor-card-title">Pulse</div>` +
      `<div class="condor-pulse-empty">No snapshot history yet — Pulse builds up one reading per day the panel is open.</div>` +
      `</div>`
    );
  }

  const toggle =
    `<div class="condor-pulse-toggle" role="group" aria-label="Pulse period">` +
    [7, 30]
      .map(
        (p) =>
          `<button type="button" class="condor-pulse-toggle-btn${p === built.period ? ' active' : ''}" data-pulse-period="${p}">${p}d</button>`
      )
      .join('') +
    `</div>`;

  const rows = built.metrics
    .map((m) => {
      const values = m.series.map((p) => p.value);
      const spark = values.filter((v) => v != null).length >= 2 ? sparkline(values.map((v) => v ?? 0)) : '';
      const currentText = m.current == null ? '—' : `${m.current}${m.unit || ''}`;
      const cls = m.sense || 'unknown';
      return (
        `<div class="condor-pulse-row">` +
        `<span class="condor-pulse-label">${esc(m.label)}</span>` +
        `<span class="condor-pulse-spark">${spark}</span>` +
        `<span class="condor-pulse-figs">` +
        `<span class="condor-pulse-current">${esc(currentText)}</span>` +
        `<span class="condor-pulse-delta ${cls}">${esc(deltaText(m))}</span>` +
        `</span>` +
        `</div>`
      );
    })
    .join('');

  // Coverage line uses the metric with the most readings (mirrors pulse-core's
  // coverageSummary logic) so a single line honestly represents the whole set.
  const best = built.metrics.reduce((a, b) => (b.coverage.recorded > a.coverage.recorded ? b : a));
  const asOfNote = safeSnapshots.length ? `as at ${esc(safeSnapshots[safeSnapshots.length - 1].date)}` : '';

  return (
    `<div class="condor-card condor-pulse">` +
    `<div class="condor-pulse-head">` +
    `<div class="condor-card-title">Pulse — ${esc(built.period)}d trend</div>` +
    toggle +
    `</div>` +
    `<div class="condor-pulse-rows">${rows}</div>` +
    `<div class="condor-pulse-coverage">${esc(best.coverage.text)}. Pressure-index figures are as-recorded on the day, not restated under today's settings. <span class="condor-pulse-asof">${asOfNote}</span></div>` +
    `</div>`
  );
}
