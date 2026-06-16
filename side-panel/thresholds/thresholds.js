// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Alert-threshold editor overlay
//
// In-panel editor for the SIMPLE NUMERIC alert thresholds, reachable from the
// command palette ("Edit alert thresholds…") AND from Options › Notifications
// (a visible entry point for users who don't use the palette). It tunes when the
// top-of-panel strips turn amber, then red:
//   • Waiting room — minutes a patient has waited (suite.waitingRoom.thresholds)
//   • Demand — new medical/admin requests per day (submissions.thresholds)
// Triage uses a rules engine (not a numeric pair), so it links out to its own
// Options editor rather than being half-reimplemented here.
//
// Scope: these are PER-DEVICE settings (chrome.storage.local) — stated plainly in
// the UI so it is not mistaken for a practice-wide policy. Changes apply LIVE:
// each valid edit writes storage and the panel's strips re-render via onChanged.
// Strips are OPERATIONAL (workload), never clinical — so user-tunable thresholds
// and an "alert off" toggle are legitimate here. Styles: thresh-* in panel.css.

'use strict';

import { DEFAULT_SUB_THRESHOLDS } from '../modules/submissions/submissions-core.js';

// Mirrors DEFAULT_WR_THRESHOLDS in panel.js (the sanitiser there is the authority;
// these are the initial field values + the "reset to default" target).
const DEFAULT_WR = { amber: 10, red: 20 };
const WR_KEY = 'suite.waitingRoom.thresholds';
const SUB_KEY = 'submissions.thresholds';
// A red waiting threshold this high means the strip will essentially never fire —
// not blocked (practices differ), but flagged as a gentle sanity nudge (T7).
const WR_RARELY_FIRES_MIN = 60;

let _layer = null;
let _keyHandler = null;
let _wr = { ...DEFAULT_WR };
let _sub = null; // { medical:{amber,red,enabled}, admin:{...} }

function posInt(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function persistWr() {
  await chrome.storage.local.set({ [WR_KEY]: { amber: _wr.amber, red: _wr.red } });
}
async function persistSub() {
  await chrome.storage.local.set({ [SUB_KEY]: _sub });
}

// Section definitions: scope, label, unit, the default pair, and whether the
// section is always-on (waiting room) or has an enable toggle (demand).
function sections() {
  return [
    {
      scope: 'wr',
      label: 'Waiting room',
      unit: 'min',
      unitTitle: 'Minutes a patient has waited (resets when they are seen)',
      def: DEFAULT_WR,
      cur: _wr,
      alwaysOn: true,
    },
    {
      scope: 'medical',
      label: 'Demand — medical requests',
      unit: '/day',
      unitTitle: 'New requests received today (resets at midnight)',
      def: DEFAULT_SUB_THRESHOLDS.medical,
      cur: _sub.medical,
      enabled: !!_sub.medical.enabled,
    },
    {
      scope: 'admin',
      label: 'Demand — admin requests',
      unit: '/day',
      unitTitle: 'New requests received today (resets at midnight)',
      def: DEFAULT_SUB_THRESHOLDS.admin,
      cur: _sub.admin,
      enabled: !!_sub.admin.enabled,
    },
  ];
}

function flash(msg, kind) {
  const el = _layer?.querySelector('#threshHint');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('flash', 'ok');
  void el.offsetWidth; // restart the animation
  el.classList.add('flash');
  if (kind === 'ok') el.classList.add('ok');
  setTimeout(() => el?.classList.remove('flash', 'ok'), 1600);
}

function sectionHtml(s) {
  const off = s.alwaysOn ? false : !s.enabled;
  const headRight = s.alwaysOn
    ? '<span class="thresh-always" title="The waiting-room strip is always on — it reflects the live waiting room">always on</span>'
    : `<label class="thresh-enable"><input type="checkbox" data-thresh-enable="${s.scope}" ${
        s.enabled ? 'checked' : ''
      } /> Alert on this</label>`;
  const offNote = off ? '<div class="thresh-off-note">Off — no alerts for this strip.</div>' : '';
  return `
    <div class="thresh-section${off ? ' thresh-section--off' : ''}">
      <div class="thresh-section-head"><span class="thresh-section-name">${esc(s.label)}</span>${headRight}</div>
      ${offNote}
      <div class="thresh-fields">
        <label class="thresh-field thresh-field--amber">
          <span>Amber at</span>
          <input type="number" min="1" inputmode="numeric" data-thresh="${s.scope}" data-level="amber" value="${s.cur.amber}" />
          <span class="thresh-unit" title="${esc(s.unitTitle)}">${s.unit}</span>
        </label>
        <label class="thresh-field thresh-field--red">
          <span>Red at</span>
          <input type="number" min="1" inputmode="numeric" data-thresh="${s.scope}" data-level="red" value="${s.cur.red}" />
          <span class="thresh-unit" title="${esc(s.unitTitle)}">${s.unit}</span>
        </label>
      </div>
      <div class="thresh-section-foot">
        <span class="thresh-default">default ${s.def.amber}/${s.def.red}</span>
        <button class="thresh-reset" type="button" data-thresh-reset="${s.scope}">Reset</button>
      </div>
    </div>`;
}

function renderSheet() {
  if (!_layer) return;
  _layer.querySelector('.suite-tabs-sheet').innerHTML = `
    <div class="suite-tabs-header">
      <div>
        <div class="suite-tabs-title">Alert thresholds</div>
        <div class="suite-tabs-sub">When the top strips turn amber, then red. The strips change colour (no pop-up is sent). Saved on this device, applied straight away.</div>
      </div>
    </div>
    ${sections().map(sectionHtml).join('')}
    <a class="thresh-link" href="#" data-thresh-triage>Edit triage rules in Options →</a>
    <div class="suite-tabs-footer">
      <span class="suite-tabs-hint" id="threshHint">Red must be at least amber.</span>
      <button class="suite-tabs-done" data-thresh-done>Close</button>
    </div>`;
  wire();
}

// Read both inputs for a scope; commit only a valid pair (red >= amber), else revert.
function commitPair(scope) {
  const ai = _layer.querySelector(`input[data-thresh="${scope}"][data-level="amber"]`);
  const ri = _layer.querySelector(`input[data-thresh="${scope}"][data-level="red"]`);
  const amber = posInt(ai.value);
  const red = posInt(ri.value);
  if (amber == null || red == null) {
    flash('Thresholds must be whole numbers above zero.');
    renderSheet();
    return;
  }
  if (red < amber) {
    flash('Red must be at least amber.');
    renderSheet();
    return;
  }
  if (scope === 'wr') {
    _wr = { amber, red };
    persistWr();
  } else {
    _sub[scope] = { ..._sub[scope], amber, red };
    persistSub();
  }
  // T7: gentle nudge if a waiting threshold is set so high it will rarely fire.
  if (scope === 'wr' && red > WR_RARELY_FIRES_MIN) {
    flash(`Saved — note: red at ${red} min will rarely fire.`, 'ok');
  } else {
    flash('Saved.', 'ok');
  }
}

function resetScope(scope) {
  if (scope === 'wr') {
    _wr = { ...DEFAULT_WR };
    persistWr();
  } else {
    const d = DEFAULT_SUB_THRESHOLDS[scope];
    _sub[scope] = { ..._sub[scope], amber: d.amber, red: d.red };
    persistSub();
  }
  renderSheet();
  flash('Reset to default.', 'ok');
}

function wire() {
  _layer.querySelectorAll('input[data-thresh]').forEach((input) => {
    input.addEventListener('change', () => commitPair(input.dataset.thresh));
  });
  _layer.querySelectorAll('input[data-thresh-enable]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const scope = cb.dataset.threshEnable;
      _sub[scope] = { ..._sub[scope], enabled: cb.checked };
      persistSub();
      renderSheet(); // re-render so the row greys / un-greys (T4)
      flash(cb.checked ? 'Alert on.' : 'Alert off — this strip will not show.', 'ok');
    });
  });
  _layer.querySelectorAll('[data-thresh-reset]').forEach((btn) => {
    btn.addEventListener('click', () => resetScope(btn.dataset.threshReset));
  });
  _layer.querySelector('[data-thresh-triage]')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sect-triage') });
  });
  _layer.querySelector('[data-thresh-done]')?.addEventListener('click', closeThresholds);
}

export async function openThresholds() {
  if (_layer) return;
  const r = await chrome.storage.local.get([WR_KEY, SUB_KEY]);
  const wr = r[WR_KEY] || {};
  _wr = { amber: posInt(wr.amber) || DEFAULT_WR.amber, red: posInt(wr.red) || DEFAULT_WR.red };
  const sub = r[SUB_KEY] || {};
  _sub = {
    medical: { ...DEFAULT_SUB_THRESHOLDS.medical, ...(sub.medical || {}) },
    admin: { ...DEFAULT_SUB_THRESHOLDS.admin, ...(sub.admin || {}) },
  };

  _layer = document.createElement('div');
  _layer.className = 'suite-tabs-layer';
  _layer.setAttribute('role', 'dialog');
  _layer.setAttribute('aria-modal', 'true');
  _layer.setAttribute('aria-label', 'Alert thresholds');
  _layer.innerHTML = `<div class="suite-tabs-sheet"></div>`;
  document.body.appendChild(_layer);

  _layer.addEventListener('click', (e) => {
    if (e.target === _layer) closeThresholds();
  });
  _keyHandler = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeThresholds();
    }
  };
  document.addEventListener('keydown', _keyHandler, true);

  renderSheet();
}

export function closeThresholds() {
  if (_keyHandler) {
    document.removeEventListener('keydown', _keyHandler, true);
    _keyHandler = null;
  }
  _layer?.remove();
  _layer = null;
}
