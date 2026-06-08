// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function anonymise(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] + '.' : '';
  return esc(first + (last ? ' ' + last : ''));
}

function modeIcon(deliveryMode) {
  const m = String(deliveryMode == null ? '' : deliveryMode);
  if (/face.to.face|in.person|f2f/i.test(m)) return 'F2F';
  if (/telephone|phone/i.test(m)) return 'Tel';
  if (/video/i.test(m)) return 'Vid';
  // Return raw (un-escaped) truncated string; the call site applies esc().
  return m.slice(0, 4);
}

function waitMins(start) {
  if (start == null) return '?';
  const t = new Date(start).getTime();
  if (isNaN(t)) return '?';
  const mins = Math.round((Date.now() - t) / 60000);
  return String(mins);
}

let cssInjected = false;

function ensureStyles() {
  if (cssInjected) return;
  const style = document.createElement('style');
  style.textContent = `
.condor-wr-count { display:flex; align-items:baseline; gap:6px; padding:4px 0 8px; }
.condor-wr-lbl { font-size:11px; color:var(--text-3); }
.condor-wr-row { display:flex; align-items:center; gap:6px; font-size:11px; padding:2px 0; border-bottom:1px solid var(--border); }
.condor-wr-name { flex:1; color:var(--t1); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.condor-wr-mode { font-size:9px; background:var(--border); padding:1px 5px; border-radius:4px; color:var(--t4); flex-shrink:0; }
.condor-wr-wait { font-size:10px; color:var(--text-3); width:28px; text-align:right; flex-shrink:0; }
.condor-wr-more { font-size:10px; color:var(--text-3); padding:4px 0; }
.condor-wr-empty { font-size:12px; color:var(--text-3); padding:4px 0; }
.condor-num-lg { font-size:24px; font-weight:700; color:var(--t1); }
  `.trim();
  document.head.appendChild(style);
  cssInjected = true;
}

export function renderWaitingRoom(data) {
  if (typeof document !== 'undefined') ensureStyles();

  if (!data || !data.waitingRoom) {
    return `<div class="condor-card condor-wr">
  <div class="condor-card-title">Waiting Room</div>
  <div class="condor-wr-empty">No waiting room data.</div>
</div>`;
  }

  const { appointments = [], arrivedCount = 0 } = data.waitingRoom;

  const arrivedAppts = appointments
    .filter(a => a.isArrived)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const pendingCount = appointments.filter(a => !a.isArrived).length;

  const rows = arrivedAppts.slice(0, 6).map(a => `
    <div class="condor-wr-row">
      <span class="condor-wr-name">${anonymise(a.patientName)}</span>
      <span class="condor-wr-mode">${esc(modeIcon(a.deliveryMode))}</span>
      <span class="condor-wr-wait">${waitMins(a.start)}m</span>
    </div>`).join('');

  const more = arrivedAppts.length > 6
    ? `<div class="condor-wr-more">+${arrivedAppts.length - 6} more</div>`
    : '';

  return `<div class="condor-card condor-wr">
  <div class="condor-card-title">Waiting Room</div>
  <div class="condor-wr-count">
    <span class="condor-num-lg">${esc(arrivedCount)}</span>
    <span class="condor-wr-lbl"> arrived · ${esc(pendingCount)} booked pending</span>
  </div>${rows}${more}
</div>`;
}
