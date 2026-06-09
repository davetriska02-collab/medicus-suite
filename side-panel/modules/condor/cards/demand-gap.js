// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

let cssInjected = false;

function ensureStyles() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.condor-dg-ratio { font-size:28px; font-weight:700; text-align:center; padding:6px 0; }
.condor-dg-green { color:var(--green); }
.condor-dg-amber { color:var(--amber); }
.condor-dg-red   { color:var(--red);   }
.condor-dg-detail { font-size:11px; color:var(--text-3); text-align:center; padding-bottom:4px; }
.condor-dg-breakdown { display:flex; flex-wrap:wrap; gap:8px; font-size:10px; color:var(--t4); justify-content:center; }
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

  const ratio = slotsRemaining === 0
    ? (requestsToday > 0 ? Infinity : 0)
    : requestsToday / slotsRemaining;

  let colorClass;
  if (ratio >= 1.5) {
    colorClass = 'condor-dg-red';
  } else if (ratio >= 1.0) {
    colorClass = 'condor-dg-amber';
  } else {
    colorClass = 'condor-dg-green';
  }

  const ratioDisplay = ratio === Infinity ? '&#x221E;' : ratio.toFixed(1);

  return `<div class="condor-card condor-dg">
  <div class="condor-card-title">Demand / Capacity</div>
  <div class="condor-dg-ratio ${colorClass}">${ratioDisplay}&times;</div>
  <div class="condor-dg-detail">${requestsToday} requests today &middot; ${slotsRemaining} slots remaining</div>
  <div class="condor-dg-breakdown">
    <span>Medical: ${medical}</span>
    <span>Admin: ${admin}</span>
    <span>AM slots: ${amRemaining}</span>
    <span>PM slots: ${pmRemaining}</span>
  </div>
</div>`;
}
