// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const CSS = `
.condor-wl-row { display:flex; align-items:center; gap:6px; margin-bottom:5px; }
.condor-wl-name { font-size:10px; color:var(--t4); width:80px; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.condor-wl-bars { flex:1; display:flex; align-items:center; gap:4px; min-width:0; }
.condor-wl-bar-wrap { flex:1; height:8px; border-radius:4px; display:flex; overflow:hidden; background:rgba(127,127,127,.08); }
.condor-wl-seg { height:100%; }
.condor-wl-consult { background:var(--accent); }
.condor-wl-rx      { background:var(--green);  }
.condor-wl-review  { background:var(--amber);  }
.condor-wl-admin   { background:var(--t4);     }
.condor-wl-ghost   { background:rgba(127,127,127,.2); }
.condor-wl-total   { font-size:10px; color:var(--t4); width:20px; text-align:right; flex-shrink:0; }
.condor-wl-legend  { display:flex; gap:8px; font-size:9px; flex-wrap:wrap; margin-top:4px; }
.condor-wl-lbl { display:flex; align-items:center; gap:3px; color:var(--text-3); }
.condor-wl-lbl::before { content:''; display:inline-block; width:8px; height:8px; border-radius:2px; }
.condor-wl-l-consult::before { background:var(--accent); }
.condor-wl-l-rx::before      { background:var(--green);  }
.condor-wl-l-review::before  { background:var(--amber);  }
.condor-wl-l-admin::before   { background:var(--t4);     }
.condor-wl-l-ghost::before   { background:rgba(127,127,127,.3); }
.condor-wl-totals { font-size:10px; color:var(--text-3); margin-top:4px; }
`;

let cssInjected = false;

function ensureStyles() {
  if (cssInjected) return;
  if (typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function renderWorkload(data) {
  if (data == null || !data.activity) {
    return '<div class="condor-card condor-placeholder">Activity data unavailable.</div>';
  }

  ensureStyles();

  const { rows: rawRows, totals } = data.activity;
  const rows = rawRows ?? [];
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const maxTotal = Math.max(...sorted.map(r => r.total), 1);

  const rowsHtml = sorted.map(row => {
    const slots = data.slots?.byStaff?.[row.name];
    const slotsRemaining = (slots?.amRemaining ?? 0) + (slots?.pmRemaining ?? 0);

    const clamp = v => Math.min(100, Math.max(0, v));
    const consultPct = clamp(row.consultations / maxTotal * 100).toFixed(1);
    const rxPct      = clamp((row.routineRx + row.nonRoutineRx) / maxTotal * 100).toFixed(1);
    const reviewPct  = clamp(row.reviews / maxTotal * 100).toFixed(1);
    // Final named segment: computed as remainder to prevent floating-point overflow
    const adminPct   = clamp(100 - +consultPct - +rxPct - +reviewPct).toFixed(1);

    let ghostSegHtml = '';
    if (slotsRemaining > 0) {
      // Cap: don't let the bar exceed 100% of maxTotal
      const cappedGhost = Math.min(slotsRemaining, Math.max(0, maxTotal - row.total));
      const ghostWidth = (cappedGhost / maxTotal * 100).toFixed(1);
      if (+ghostWidth > 0) {
        ghostSegHtml = `<div class="condor-wl-seg condor-wl-ghost" style="width:${ghostWidth}%"></div>`;
      }
    }

    return `
    <div class="condor-wl-row">
      <div class="condor-wl-name">${esc(row.name)}</div>
      <div class="condor-wl-bars">
        <div class="condor-wl-bar-wrap">
          <div class="condor-wl-seg condor-wl-consult" style="width:${consultPct}%"></div>
          <div class="condor-wl-seg condor-wl-rx"      style="width:${rxPct}%"></div>
          <div class="condor-wl-seg condor-wl-review"  style="width:${reviewPct}%"></div>
          <div class="condor-wl-seg condor-wl-admin"   style="width:${adminPct}%"></div>
          ${ghostSegHtml}
        </div>
        <span class="condor-wl-total">${esc(row.total)}</span>
      </div>
    </div>`;
  }).join('');

  return `<div class="condor-card condor-wl">
  <div class="condor-card-title">Clinician Workload · Today</div>
  ${rowsHtml}
  <div class="condor-wl-legend">
    <span class="condor-wl-lbl condor-wl-l-consult">Consults</span>
    <span class="condor-wl-lbl condor-wl-l-rx">Rx</span>
    <span class="condor-wl-lbl condor-wl-l-review">Reviews</span>
    <span class="condor-wl-lbl condor-wl-l-admin">Admin</span>
    <span class="condor-wl-lbl condor-wl-l-ghost">Remaining slots</span>
  </div>
  <div class="condor-wl-totals">Practice total: ${esc(totals.all)} · Consults: ${esc(totals.consultations)}</div>
</div>`;
}
