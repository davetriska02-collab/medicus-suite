// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

let cssInjected = false;

function ensureStyles() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.condor-dg-status { font-size:15px; font-weight:700; text-align:center; padding:4px 0 2px; letter-spacing:0.02em; }
.condor-dg-counts { font-size:11px; text-align:center; color:var(--text-3); padding-bottom:6px; }
.condor-dg-green { color:var(--green); }
.condor-dg-amber { color:var(--amber); }
.condor-dg-red   { color:var(--red);   }
.condor-dg-breakdown { display:flex; flex-wrap:wrap; gap:8px; font-size:10px; color:var(--t4); justify-content:center; border-top:1px solid var(--border); padding-top:6px; margin-top:2px; }
`.trim();
  document.head.appendChild(style);
}

/**
 * Render the Demand / Capacity Gap card.
 * @param {{ submissions: { totals: { medical: number, admin: number, rxRoutine: number, rxNonRoutine: number, investigation: number, all: number } } | null, slots: { totalRemaining: number, amRemaining: number, pmRemaining: number } | null }} data
 * @returns {string} HTML string
 */
export function renderDemandGap(data) {
  if (data == null || data.submissions == null && data.slots == null) {
    return '<div class="condor-card condor-placeholder">Demand data unavailable.</div>';
  }

  ensureStyles();

  const medical       = data.submissions?.totals?.medical ?? 0;
  const admin         = data.submissions?.totals?.admin ?? 0;
  const requestsToday = medical + admin;
  const slotsRemaining = data.slots?.totalRemaining ?? 0;
  const amRemaining   = data.slots?.amRemaining ?? 0;
  const pmRemaining   = data.slots?.pmRemaining ?? 0;

  let statusLabel, colorClass;
  if (requestsToday === 0 && slotsRemaining === 0) {
    statusLabel = 'No data yet';
    colorClass  = 'condor-dg-green';
  } else if (slotsRemaining === 0 && requestsToday > 0) {
    statusLabel = 'No slots left';
    colorClass  = 'condor-dg-red';
  } else if (requestsToday === 0) {
    statusLabel = 'No requests yet';
    colorClass  = 'condor-dg-green';
  } else {
    const ratio = requestsToday / slotsRemaining;
    if (ratio >= 1.5)      { statusLabel = 'Over capacity';       colorClass = 'condor-dg-red';   }
    else if (ratio >= 1.0) { statusLabel = 'At capacity';         colorClass = 'condor-dg-amber'; }
    else                   { statusLabel = 'Capacity sufficient';  colorClass = 'condor-dg-green'; }
  }

  return `<div class="condor-card condor-dg">
  <div class="condor-card-title">Demand / Capacity</div>
  <div class="condor-dg-status ${colorClass}">${statusLabel}</div>
  <div class="condor-dg-counts">${requestsToday} requests today &middot; ${slotsRemaining} slots free</div>
  <div class="condor-dg-breakdown">
    <span>Medical: ${medical}</span>
    <span>Admin: ${admin}</span>
    <span>AM slots: ${amRemaining}</span>
    <span>PM slots: ${pmRemaining}</span>
  </div>
</div>`;
}
