// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Condor — "Pulse" section: compact trend rows over the daily snapshot history
// (chrome.storage.local['practice.reportSnapshots']), built from the shared pure core
// (../pulse-core.js) so the panel and the Practice Report can never quietly diverge.
//
// Calm by design: only the WORSENING direction of a delta is coloured (amber/red per
// design tokens); an improving or flat delta stays neutral text. Sparse snapshot history
// is disclosed plainly, never hidden or smoothed.

'use strict';

import { buildPulseRows, buildMonthlyPulseRows } from '../pulse-core.js';
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
.condor-pulse-month { margin-top:8px; padding-top:8px; border-top:1px solid var(--border); }
.condor-pulse-month-title { font-family:var(--mono); font-size:10px; font-weight:600; letter-spacing:0.04em; color:var(--text-3); margin-bottom:4px; text-transform:uppercase; }
.condor-pulse-month-row { display:flex; align-items:center; gap:8px; padding:3px 0; border-bottom:1px solid var(--border); }
.condor-pulse-month-row:last-of-type { border-bottom:none; }
.condor-pulse-month-empty { flex:1; text-align:right; font-size:11px; color:var(--text-4); }
.condor-pulse-month-coverage { font-size:10px; color:var(--text-4); margin:2px 0 6px; }
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

// Short "1–4 Jul" style label for a calendar span (used by the Month view section).
function formatSpanLabel(startISO, endISO) {
  const s = new Date(startISO + 'T12:00:00');
  const e = new Date(endISO + 'T12:00:00');
  const dayOnly = { day: 'numeric' };
  const dayMonth = { day: 'numeric', month: 'short' };
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.toLocaleDateString('en-GB', dayOnly)}–${e.toLocaleDateString('en-GB', dayMonth)}`;
  }
  return `${s.toLocaleDateString('en-GB', dayMonth)}–${e.toLocaleDateString('en-GB', dayMonth)}`;
}

function monthMetricRow(m) {
  const curCov = m.coverage.current;
  const prevCov = m.coverage.previous;
  if (curCov.have === 0 || prevCov.have === 0) {
    // Never fake a 0 — an uncovered window gets an honest "not enough snapshots" line,
    // matching the day-based Pulse rows' sparse-coverage discipline.
    return (
      `<div class="condor-pulse-month-row">` +
      `<span class="condor-pulse-label">${esc(m.label)}</span>` +
      `<span class="condor-pulse-month-empty">Not enough snapshots yet (${curCov.have} of ${curCov.possible} this month, ${prevCov.have} of ${prevCov.possible} last month)</span>` +
      `</div>`
    );
  }
  const currentText = `${m.current}${m.unit || ''}`;
  const cls = m.sense || 'unknown';
  return (
    `<div class="condor-pulse-month-row">` +
    `<span class="condor-pulse-label">${esc(m.label)}</span>` +
    `<span class="condor-pulse-figs">` +
    `<span class="condor-pulse-current">${esc(currentText)}</span>` +
    `<span class="condor-pulse-delta ${cls}">${esc(deltaText(m))}</span>` +
    `</span>` +
    `</div>` +
    `<div class="condor-pulse-month-coverage">${curCov.have} of ${curCov.possible} possible snapshots this month · ${prevCov.have} of ${prevCov.possible} last month</div>`
  );
}

// Compact month-on-month section (manager-pack FEATURE 1c) — PPI + demand only, per the
// brief; other metrics stay in the 7d/30d rolling view above. Returns '' when the
// underlying series has never recorded either metric (same "don't show a permanently-
// empty row" rule as the day-based rows), so an unconfigured practice sees nothing extra.
function renderMonthView(snapshots, now) {
  const built = buildMonthlyPulseRows(snapshots, now);
  const wanted = ['ppi', 'demand'];
  const rows = wanted
    .map((key) => built.metrics.find((m) => m.key === key))
    .filter(Boolean)
    .map(monthMetricRow)
    .join('');
  if (!rows) return '';
  const curLabel = formatSpanLabel(built.current.start, built.current.end);
  const prevLabel = formatSpanLabel(built.previous.start, built.previous.end);
  return (
    `<div class="condor-pulse-month">` +
    `<div class="condor-pulse-month-title">Month view — ${esc(curLabel)} vs ${esc(prevLabel)}</div>` +
    rows +
    `</div>`
  );
}

// `period` is 7 or 30 (days). `data.pulseSnapshots` (full stored series) is passed by
// condor.js's poll() — this card does no I/O of its own, staying pure/testable-by-inspection
// like the other card renderers. `now` pins "today" for the Month view section below
// (manager-pack FEATURE 1c) — defaults to `new Date()` for the live panel; condor.js's
// caller passes only 2 args, so this always resolves live in production.
export function renderPulse(snapshots, period = 7, now = new Date()) {
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
    renderMonthView(safeSnapshots, now) +
    `</div>`
  );
}
