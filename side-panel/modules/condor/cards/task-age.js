// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.

'use strict';

let cssInjected = false;

function ensureStyles() {
  if (cssInjected) return;
  if (typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.condor-ta-bar { display:flex; height:12px; border-radius:6px; overflow:hidden; margin:6px 0; background:var(--border); }
.condor-ta-seg { height:100%; transition:width .3s; }
.condor-ta-lt1h  { background:var(--green); }
.condor-ta-h1to4 { background:var(--amber); opacity:.6; }
.condor-ta-h4to8 { background:var(--amber); }
.condor-ta-gt8h  { background:var(--red); }
.condor-ta-legend { display:flex; gap:10px; font-size:10px; flex-wrap:wrap; }
.condor-ta-lbl { color:var(--text-3); }
.condor-ta-lt1h-lbl  { color:var(--green); }
.condor-ta-h1to4-lbl { color:var(--amber); opacity:.6; }
.condor-ta-h4to8-lbl { color:var(--amber); }
.condor-ta-gt8h-lbl  { color:var(--red); font-weight:600; }
.condor-ta-warn { font-size:11px; color:var(--red); font-weight:600; margin-top:4px; }
.condor-ta-empty { font-size:12px; color:var(--text-3); padding:4px 0; }
`;
  document.head.appendChild(style);
}

function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}

/**
 * Render the Task Age Distribution card.
 * @param {{ requestMonitor: { items: Array, urgentCount: number, totalCount: number, byAgeBucket: { lt1h: number, h1to4: number, h4to8: number, gt8h: number } } | null | undefined }} data
 * @returns {string} HTML string
 */
export function renderTaskAge(data) {
  if (data == null || data.requestMonitor == null) {
    return '<div class="condor-card condor-placeholder">Task inbox not configured. Enable Request Monitor in Settings.</div>';
  }

  // Configured but the cached poll state is missing or errored — a fetch/auth
  // problem must never be presented as "not configured" (it sends the user to
  // re-check settings that are fine).
  if (data.requestMonitor.unavailable) {
    const reason = data.requestMonitor.reason || 'unknown';
    // A benign "warming up" (no poll has completed yet) must not read at the
    // same loudness as an auth error, nor carry the "check sign-in" alarm — it
    // resolves itself on the next background poll. Render it quiet. (Vogue map.)
    if (/no poll data/i.test(reason)) {
      return `<div class="condor-card condor-placeholder condor-quiet">Task inbox: warming up — ${esc(reason)}.</div>`;
    }
    return `<div class="condor-card condor-placeholder">Task inbox unavailable: ${esc(reason)} — check Medicus sign-in.</div>`;
  }

  ensureStyles();

  const { totalCount = 0, urgentCount = 0, byAgeBucket } = data.requestMonitor;

  if (totalCount === 0 || !byAgeBucket) {
    return `<div class="condor-card condor-ta">
  <div class="condor-card-title">Task Age</div>
  <div class="condor-ta-empty">No open tasks.</div>
</div>`;
  }

  const lt1h = Number(byAgeBucket.lt1h) || 0;
  const h1to4 = Number(byAgeBucket.h1to4) || 0;
  const h4to8 = Number(byAgeBucket.h4to8) || 0;
  const gt8h = Number(byAgeBucket.gt8h) || 0;
  const total = lt1h + h1to4 + h4to8 + gt8h;

  // Guard against division-by-zero if bucket data is inconsistent
  const pctLt1h = total > 0 ? ((lt1h / total) * 100).toFixed(1) : '0.0';
  const pctH1to4 = total > 0 ? ((h1to4 / total) * 100).toFixed(1) : '0.0';
  const pctH4to8 = total > 0 ? ((h4to8 / total) * 100).toFixed(1) : '0.0';
  const pctGt8h = total > 0 ? ((gt8h / total) * 100).toFixed(1) : '0.0';

  const titleSuffix = urgentCount > 0 ? ` · ${esc(urgentCount)} urgent` : '';
  const warnHtml =
    gt8h > 0
      ? `\n  <div class="condor-ta-warn">&#x26A0; ${esc(gt8h)} task${gt8h !== 1 ? 's' : ''} older than 8 hours</div>`
      : '';

  return `<div class="condor-card condor-ta">
  <div class="condor-card-title">Task Age · ${esc(totalCount)} open${titleSuffix}</div>
  <div class="condor-ta-bar">
    <div class="condor-ta-seg condor-ta-lt1h" style="width:${pctLt1h}%"></div>
    <div class="condor-ta-seg condor-ta-h1to4" style="width:${pctH1to4}%"></div>
    <div class="condor-ta-seg condor-ta-h4to8" style="width:${pctH4to8}%"></div>
    <div class="condor-ta-seg condor-ta-gt8h"  style="width:${pctGt8h}%"></div>
  </div>
  <div class="condor-ta-legend">
    <span class="condor-ta-lbl condor-ta-lt1h-lbl">&lt;1h: ${esc(lt1h)}</span>
    <span class="condor-ta-lbl condor-ta-h1to4-lbl">1&#x2013;4h: ${esc(h1to4)}</span>
    <span class="condor-ta-lbl condor-ta-h4to8-lbl">4&#x2013;8h: ${esc(h4to8)}</span>
    <span class="condor-ta-lbl condor-ta-gt8h-lbl">&gt;8h: ${esc(gt8h)}</span>
  </div>${warnHtml}
</div>`;
}
