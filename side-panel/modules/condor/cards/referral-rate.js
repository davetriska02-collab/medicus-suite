// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

let cssInjected = false;

function ensureStyles() {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.condor-rr-unavail { font-size:11px; color:var(--text-3); line-height:1.5; padding:4px 0; }
.condor-rr-row { display:flex; align-items:center; gap:5px; margin-bottom:4px; }
.condor-rr-name { font-size:10px; color:var(--t4); width:80px; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.condor-rr-bar-wrap { flex:1; height:8px; border-radius:4px; background:rgba(127,127,127,.1); overflow:hidden; }
.condor-rr-bar { height:100%; background:var(--accent); border-radius:4px; }
.condor-rr-pct { font-size:10px; color:var(--t4); width:32px; text-align:right; flex-shrink:0; }
.condor-rr-flag { color:var(--amber); font-size:11px; }
.condor-rr-avg { font-size:10px; color:var(--text-3); margin-top:4px; border-top:1px solid var(--border); padding-top:4px; }
`.trim();
  document.head.appendChild(style);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Render the Referral Rate per Clinician card.
 * @param {{ referrals: { available: boolean, rows: Array<{ clinician: string, count: number, consultations: number, rate: number }>, practiceAvgRate: number } | null }} data
 * @returns {string} HTML string
 */
export function renderReferralRate(data) {
  const referrals = data && data.referrals;

  // State 1 — referrals null or not available
  if (!referrals || !referrals.available) {
    ensureStyles();
    return `<div class="condor-card condor-rr">
  <div class="condor-card-title">Referral Rate</div>
  <div class="condor-rr-unavail">
    Visit the <strong>Referrals</strong> tab to enable referral data,
    then return here for per-clinician referral rate analysis.
  </div>
</div>`;
  }

  const rows = referrals.rows || [];

  // State 2 — available but no rows
  if (rows.length === 0) {
    ensureStyles();
    return `<div class="condor-card condor-rr">
  <div class="condor-card-title">Referral Rate</div>
  <div class="condor-rr-unavail">No referral data for this period.</div>
</div>`;
  }

  ensureStyles();

  const practiceAvgRate = Number(referrals.practiceAvgRate) || 0;

  // Sort descending by rate
  const sorted = rows.slice().sort((a, b) => b.rate - a.rate);

  const maxRate = sorted.reduce((m, r) => Math.max(m, r.rate), 0.001);

  const rowsHtml = sorted.map(r => {
    const barWidth = Math.min(100, Math.max(0, isFinite(r.rate) ? r.rate / maxRate * 100 : 0)).toFixed(1);
    const pct = (r.rate * 100).toFixed(1);
    const showFlag = practiceAvgRate > 0 && r.rate > practiceAvgRate * 1.5;
    const flag = showFlag ? '<span class="condor-rr-flag">&#x26A0;</span>' : '';
    return `<div class="condor-rr-row">
      <div class="condor-rr-name">${esc(r.clinician)}</div>
      <div class="condor-rr-bar-wrap">
        <div class="condor-rr-bar" style="width:${barWidth}%"></div>
      </div>
      <span class="condor-rr-pct">${pct}%</span>
      ${flag}
    </div>`;
  }).join('');

  // State 3 — data available with rows
  return `<div class="condor-card condor-rr">
  <div class="condor-card-title">Referral Rate &middot; ${sorted.length} clinicians</div>
  ${rowsHtml}
  <div class="condor-rr-avg">Practice avg: ${(practiceAvgRate * 100).toFixed(1)}%</div>
</div>`;
}
