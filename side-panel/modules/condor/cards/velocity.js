// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

const W = 480, H = 120, PL = 30, PR = 8, PT = 8, PB = 24;
const CHART_W = W - PL - PR;   // 442
const CHART_H = H - PT - PB;   // 88
const HOUR_START = 6, HOUR_END = 20, BAR_COUNT = 15; // hours 6–20 inclusive
const BAR_W = Math.floor(CHART_W / BAR_COUNT);        // 29
const GAP = 2;

const X_LABEL_HOURS = [6, 9, 12, 15, 18];

let cssInjected = false;

function ensureStyles() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.condor-vel-legend { display:flex; flex-wrap:wrap; gap:8px; padding:4px 0 0; font-size:10px; align-items:center; }
.condor-vel-med::before,.condor-vel-adm::before,.condor-vel-rxr::before,.condor-vel-rxn::before,.condor-vel-inv::before {
  content:''; display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:3px; vertical-align:middle;
}
.condor-vel-med::before  { background:var(--red);    opacity:.8; }
.condor-vel-adm::before  { background:var(--amber);  opacity:.8; }
.condor-vel-rxr::before  { background:var(--accent); opacity:.8; }
.condor-vel-rxn::before  { background:var(--accent); opacity:.5; }
.condor-vel-inv::before  { background:var(--t4);     opacity:.8; }
.condor-vel-total { margin-left:auto; font-weight:600; color:var(--t1); }
`.trim();
  document.head.appendChild(style);
}

function barX(hourIndex) {
  return PL + hourIndex * BAR_W;
}

function buildSvg(byHour) {
  // Extract the 15 hours (6–20) we care about
  const hours = [];
  for (let h = HOUR_START; h <= HOUR_END; h++) {
    const entry = byHour.find(e => e.hour === h) ||
      { hour: h, medical: 0, admin: 0, rxRoutine: 0, rxNonRoutine: 0, investigation: 0 };
    hours.push({
      hour: h,
      medical:       Number(entry.medical)       || 0,
      admin:         Number(entry.admin)         || 0,
      rxRoutine:     Number(entry.rxRoutine)     || 0,
      rxNonRoutine:  Number(entry.rxNonRoutine)  || 0,
      investigation: Number(entry.investigation) || 0,
    });
  }

  const totals = hours.map(h =>
    h.medical + h.admin + h.rxRoutine + h.rxNonRoutine + h.investigation
  );
  const maxTotal = Math.max(...totals, 0);

  if (maxTotal === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;">` +
      `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" ` +
      `font-size="11" fill="var(--t3)">No submissions recorded today</text>` +
      '</svg>';
  }

  const yScale = v => PT + CHART_H - (v / maxTotal) * CHART_H;

  // Y-axis grid lines at 0, max/2, max
  const yTicks = [0, maxTotal / 2, maxTotal];
  const gridLines = yTicks.map(v => {
    const y = yScale(v).toFixed(1);
    const label = Math.round(v);
    // Clamp label above x-axis: for the 0-line (y = H-PB) place text above, not below
    const labelY = Math.min(+y + 3.5, H - PB - 1).toFixed(1);
    return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" ` +
      `stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3 2"/>` +
      `<text x="${PL - 3}" y="${labelY}" ` +
      `font-size="8" fill="var(--t3)" text-anchor="end">${label}</text>`;
  }).join('');

  // Axes
  const axes =
    `<line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" stroke="var(--border)" stroke-width="1"/>` +
    `<line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="var(--border)" stroke-width="1"/>`;

  // Bars — segments bottom-to-top: medical, admin, rxRoutine, rxNonRoutine, investigation
  const segments = [
    { key: 'medical',       fill: 'var(--red)',    opacity: '0.8' },
    { key: 'admin',         fill: 'var(--amber)',  opacity: '0.8' },
    { key: 'rxRoutine',     fill: 'var(--accent)', opacity: '0.8' },
    { key: 'rxNonRoutine',  fill: 'var(--accent)', opacity: '0.5' },
    { key: 'investigation', fill: 'var(--t4)',     opacity: '0.8' },
  ];

  const bars = hours.map((h, i) => {
    const x = barX(i) + GAP / 2;
    const w = BAR_W - GAP;
    let stackBottom = H - PB; // pixel y of current stack base (grows upward)
    const rects = segments.map(seg => {
      const val = h[seg.key];
      if (!val) return '';
      const pixH = (val / maxTotal) * CHART_H;
      const y = (stackBottom - pixH).toFixed(1);
      stackBottom -= pixH;
      const label = `${h.hour}:00 – ${seg.key}: ${val}`;
      return `<rect x="${x.toFixed(1)}" y="${y}" width="${w}" height="${pixH.toFixed(1)}" ` +
        `fill="${seg.fill}" fill-opacity="${seg.opacity}">` +
        `<title>${label}</title>` +
        `</rect>`;
    }).join('');
    return rects;
  }).join('');

  // X-axis hour labels
  const xLabels = X_LABEL_HOURS.map(hr => {
    const i = hr - HOUR_START;
    const x = (barX(i) + BAR_W / 2).toFixed(1);
    return `<text x="${x}" y="${H - PB + 10}" font-size="8" fill="var(--t3)" text-anchor="middle">${String(hr).padStart(2, '0')}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img" aria-label="Submission velocity histogram">` +
    gridLines + axes + bars + xLabels +
    '</svg>';
}

/**
 * Render the Submission Velocity stacked bar chart card.
 * @param {object} data  - condor data object with `submissions` field
 * @returns {string}     - HTML string
 */
export function renderVelocity(data) {
  if (!data || !data.submissions) {
    return '<div class="condor-card condor-placeholder">Submission data unavailable.</div>';
  }

  ensureStyles();

  const { byHour = [], totals = {} } = data.submissions;
  const all = Number(totals.all) || 0;

  const svg = buildSvg(byHour);

  return `<div class="condor-card condor-vel">` +
    `<div class="condor-card-title">Submission Velocity — Today</div>` +
    svg +
    `<div class="condor-vel-legend">` +
    `<span class="condor-vel-med">Medical</span>` +
    `<span class="condor-vel-adm">Admin</span>` +
    `<span class="condor-vel-rxr">Rx routine</span>` +
    `<span class="condor-vel-rxn">Rx non-routine</span>` +
    `<span class="condor-vel-inv">Results</span>` +
    `<span class="condor-vel-total">Total today: ${all}</span>` +
    `</div>` +
    `</div>`;
}
