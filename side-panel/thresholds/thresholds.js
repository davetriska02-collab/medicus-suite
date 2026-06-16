// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Alert-threshold editor overlay
//
// In-panel editor for the SIMPLE NUMERIC alert thresholds, reachable from the
// command palette ("Edit alert thresholds…") so a clinician can tune when the
// strips turn amber/red without hunting through Options:
//   • Waiting room — minutes a patient has waited (suite.waitingRoom.thresholds)
//   • Demand — new medical/admin requests per day (submissions.thresholds)
// Triage uses a rules engine (not a numeric pair), so it links out to its own
// Options editor rather than being half-reimplemented here.
//
// Changes apply LIVE: each valid edit writes storage and the panel's strips
// re-render via their onChanged listeners. Scaffolding styles are shared with
// the tab chooser (suite-tabs-*); form styles are thresh-* in panel.css.

'use strict';

import { DEFAULT_SUB_THRESHOLDS } from '../modules/submissions/submissions-core.js';

// Mirrors DEFAULT_WR_THRESHOLDS in panel.js (the sanitiser there is the authority;
// these are only the initial field values when nothing is stored yet).
const DEFAULT_WR = { amber: 10, red: 20 };
const WR_KEY = 'suite.waitingRoom.thresholds';
const SUB_KEY = 'submissions.thresholds';

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

function flashHint(msg) {
  const el = _layer?.querySelector('#threshHint');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('flash');
  setTimeout(() => el?.classList.remove('flash'), 1400);
}

// A reusable amber/red numeric pair. unit is "min" or "/day".
function pairRow(scope, label, amber, red, unit, enabled) {
  const toggle =
    enabled === undefined
      ? ''
      : `<label class="thresh-enable"><input type="checkbox" data-thresh-enable="${scope}" ${
          enabled ? 'checked' : ''
        } /> Alert on this</label>`;
  return `
    <div class="thresh-section">
      <div class="thresh-section-head"><span class="thresh-section-name">${esc(label)}</span>${toggle}</div>
      <div class="thresh-fields">
        <label class="thresh-field thresh-field--amber">
          <span>Amber at</span>
          <input type="number" min="1" inputmode="numeric" data-thresh="${scope}" data-level="amber" value="${amber}" />
          <span class="thresh-unit">${unit}</span>
        </label>
        <label class="thresh-field thresh-field--red">
          <span>Red at</span>
          <input type="number" min="1" inputmode="numeric" data-thresh="${scope}" data-level="red" value="${red}" />
          <span class="thresh-unit">${unit}</span>
        </label>
      </div>
    </div>`;
}

function renderSheet() {
  if (!_layer) return;
  const med = _sub.medical;
  const adm = _sub.admin;
  _layer.querySelector('.suite-tabs-sheet').innerHTML = `
    <div class="suite-tabs-header">
      <div>
        <div class="suite-tabs-title">Alert thresholds</div>
        <div class="suite-tabs-sub">When the strips turn amber, then red. Changes apply straight away.</div>
      </div>
    </div>
    ${pairRow('wr', 'Waiting room', _wr.amber, _wr.red, 'min')}
    ${pairRow('medical', 'Demand — medical requests', med.amber, med.red, '/day', !!med.enabled)}
    ${pairRow('admin', 'Demand — admin requests', adm.amber, adm.red, '/day', !!adm.enabled)}
    <a class="thresh-link" href="#" data-thresh-triage>Edit triage rules in Options →</a>
    <div class="suite-tabs-footer">
      <span class="suite-tabs-hint" id="threshHint">Red has to be at least amber. Your choice is yours alone.</span>
      <button class="suite-tabs-done" data-thresh-done>Done</button>
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
    flashHint('Thresholds must be whole numbers above zero.');
    renderSheet();
    return;
  }
  if (red < amber) {
    flashHint('Red has to be at least amber.');
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
    });
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
  // Merge stored demand thresholds over the shipped defaults (preserve enabled).
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
