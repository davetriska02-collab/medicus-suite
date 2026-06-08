// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.

'use strict';

let cssInjected = false;

function ensureStyles() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.condor-act-footer { }
.condor-act-strip { display:flex; align-items:center; gap:0; flex-wrap:wrap; margin:6px 0 4px; }
.condor-act-metric { display:flex; flex-direction:column; align-items:center; padding:0 12px; flex:1; min-width:60px; }
.condor-act-num { font-size:20px; font-weight:700; color:var(--t1); line-height:1.1; }
.condor-act-lbl { font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:.04em; margin-top:1px; }
.condor-act-sep { width:1px; height:32px; background:var(--border); flex-shrink:0; }
.condor-act-total .condor-act-num { color:var(--accent); }
.condor-act-top { font-size:10px; color:var(--text-3); border-top:1px solid var(--border); padding-top:4px; }
`;
  document.head.appendChild(style);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Render the Activity Footer card.
 * @param {{ activity: { rows: Array, totals: { consultations: number, routineRx: number, nonRoutineRx: number, reviews: number, documents: number, results: number, all: number } } | null }} data
 * @returns {string} HTML string
 */
export function renderActivity(data) {
  if (data.activity === null) {
    return '<div class="condor-card condor-act-footer condor-placeholder">Activity data unavailable.</div>';
  }

  ensureStyles();

  const { rows = [], totals } = data.activity;

  const sortedRows = rows.slice().sort((a, b) => b.total - a.total);
  const topRow = sortedRows.length > 0 ? sortedRows[0] : null;
  const topHtml = topRow
    ? `\n  <div class="condor-act-top">Top: ${esc(topRow.name)} · ${topRow.total} tasks</div>`
    : '';

  const rx = (totals.routineRx || 0) + (totals.nonRoutineRx || 0);

  return `<div class="condor-card condor-act-footer">
  <div class="condor-card-title">Today's Activity</div>
  <div class="condor-act-strip">
    <div class="condor-act-metric">
      <span class="condor-act-num">${totals.consultations}</span>
      <span class="condor-act-lbl">Consults</span>
    </div>
    <div class="condor-act-sep"></div>
    <div class="condor-act-metric">
      <span class="condor-act-num">${rx}</span>
      <span class="condor-act-lbl">Rx</span>
    </div>
    <div class="condor-act-sep"></div>
    <div class="condor-act-metric">
      <span class="condor-act-num">${totals.reviews}</span>
      <span class="condor-act-lbl">Reviews</span>
    </div>
    <div class="condor-act-sep"></div>
    <div class="condor-act-metric">
      <span class="condor-act-num">${totals.documents}</span>
      <span class="condor-act-lbl">Documents</span>
    </div>
    <div class="condor-act-sep"></div>
    <div class="condor-act-metric">
      <span class="condor-act-num">${totals.results}</span>
      <span class="condor-act-lbl">Results</span>
    </div>
    <div class="condor-act-sep"></div>
    <div class="condor-act-metric condor-act-total">
      <span class="condor-act-num">${totals.all}</span>
      <span class="condor-act-lbl">Total</span>
    </div>
  </div>${topHtml}
</div>`;
}
