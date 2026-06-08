// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

let cssInjected = false;
function ensureStyles() {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .condor-ppi-svg { display:block; margin:0 auto; max-width:200px; }
    .condor-ppi-label { text-align:center; font-size:13px; font-weight:700; margin:4px 0; }
    .condor-ppi-green { color:var(--green); }
    .condor-ppi-amber { color:var(--amber); }
    .condor-ppi-red   { color:var(--red); }
    .condor-ppi-breakdown { display:flex; flex-wrap:wrap; gap:5px; justify-content:center; padding:4px 0; }
    .condor-ppi-chip { font-size:10px; background:rgba(127,127,127,0.1); padding:1px 7px; border-radius:8px; color:var(--text-3); }
  `;
  document.head.appendChild(s);
}

export function renderPpi(data) {
  ensureStyles();

  const allNull =
    data.waitingRoom === null &&
    data.submissions === null &&
    data.requestMonitor === null &&
    data.slots === null &&
    data.capacityPreset === null;

  if (allNull) {
    return '<div class="condor-card condor-placeholder">Practice code not configured. Open Settings.</div>';
  }

  const arrivedCount = data.waitingRoom?.arrivedCount ?? 0;
  const medical      = data.submissions?.totals?.medical ?? 0;
  const admin        = data.submissions?.totals?.admin ?? 0;
  const queueCount   = medical + admin;
  const urgentCount  = data.requestMonitor?.urgentCount ?? 0;
  const minimum      = data.capacityPreset?.minimum ?? 0;
  const remaining    = data.slots?.totalRemaining ?? 0;

  const scoreA = Math.min(arrivedCount / 10 * 100, 100);
  const scoreB = Math.min(queueCount / 40 * 100, 100);
  const scoreC = Math.min(urgentCount / 5 * 100, 100);
  let scoreD = 0;
  if (minimum !== 0) {
    const deficit = Math.max(0, minimum - remaining);
    scoreD = Math.min(deficit / minimum * 100, 100);
  }

  const ppi = Math.round(scoreA * 0.30 + scoreB * 0.25 + scoreC * 0.25 + scoreD * 0.20);

  let colorClass, colorLabel, strokeColor;
  if (ppi < 40) {
    colorClass  = 'condor-ppi-green';
    colorLabel  = 'GREEN';
    strokeColor = 'var(--green)';
  } else if (ppi < 70) {
    colorClass  = 'condor-ppi-amber';
    colorLabel  = 'AMBER';
    strokeColor = 'var(--amber)';
  } else {
    colorClass  = 'condor-ppi-red';
    colorLabel  = 'RED';
    strokeColor = 'var(--red)';
  }

  const total    = Math.PI * 80;
  // Clamp to 98% of arc at maximum so stroke-linecap="round" doesn't overshoot at PPI=100.
  const maxDash  = total - 2;
  const dashLen  = Math.min((ppi / 100) * total, maxDash);
  const dashRem  = total - dashLen;

  const arcPath = 'M 20 100 A 80 80 0 0 1 180 100';

  const svg =
    `<svg viewBox="0 0 200 110" class="condor-svg condor-ppi-svg" aria-label="Practice Pressure Index gauge">` +
      `<path d="${arcPath}" fill="none" stroke="var(--border)" stroke-width="12" stroke-linecap="round"/>` +
      `<path d="${arcPath}" fill="none" stroke="${strokeColor}" stroke-width="12" stroke-linecap="round"` +
        ` stroke-dasharray="${dashLen.toFixed(1)} ${dashRem.toFixed(1)}"/>` +
      `<text x="100" y="88" text-anchor="middle" font-size="28" font-weight="700" fill="var(--t1)" font-family="var(--sans)">${ppi}</text>` +
      `<text x="100" y="104" text-anchor="middle" font-size="9" fill="var(--text-3)" font-family="var(--sans)">CONDOR PPI</text>` +
    `</svg>`;

  return `<div class="condor-card condor-ppi">` +
    `<div class="condor-card-title">Practice Pressure</div>` +
    svg +
    `<div class="condor-ppi-label ${colorClass}">${colorLabel} · ${ppi}/100</div>` +
    `<div class="condor-ppi-breakdown">` +
      `<span class="condor-ppi-chip">WR: ${arrivedCount}</span>` +
      `<span class="condor-ppi-chip">Queue: ${queueCount}</span>` +
      `<span class="condor-ppi-chip">Urgent: ${urgentCount}</span>` +
      `<span class="condor-ppi-chip">Cap: ${remaining}/${minimum}</span>` +
    `</div>` +
  `</div>`;
}
