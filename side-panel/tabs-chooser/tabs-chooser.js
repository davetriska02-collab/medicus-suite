// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — tab chooser overlay ("Choose your tabs")
//
// Role presets + per-tab toggle cards, each with a one-line explainer from
// tab-catalog.js. Changes apply LIVE: every toggle writes 'suite.hiddenTabs'
// and both shells (panel + pop-out) re-apply via their storage listeners, so
// the nav updates behind the overlay as you tap. Hidden tabs stay reachable
// through the Ctrl+K palette — hiding is de-cluttering, never lock-out.
//
// Opened from: the setup checklist step, and the palette command
// "Choose tabs…". Styles: panel.css (suite-tabs-*).

'use strict';

import { TAB_CATALOG, ROLE_PRESETS, hiddenFromPreset, sanitiseHiddenTabs } from '../tab-catalog.js';

const KEY = 'suite.hiddenTabs';

let _layer = null;
let _hidden = new Set();
let _keyHandler = null;

const FALLBACK_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

// Reuse the real nav icon for each tab so the chooser teaches the iconography.
function iconFor(id) {
  return document.querySelector(`.nav-tab[data-module="${id}"] svg`)?.outerHTML || FALLBACK_ICON;
}

async function persist() {
  await chrome.storage.local.set({ [KEY]: [...(_hidden || [])] });
}

function visibleCount() {
  return TAB_CATALOG.length - _hidden.size;
}

function renderSheet() {
  if (!_layer) return;

  const presets = ROLE_PRESETS.map(
    (p) => `<button class="suite-tabs-preset" data-preset="${p.id}">${p.label}</button>`
  ).join('');

  const cards = TAB_CATALOG.map((t) => {
    const on = !_hidden.has(t.id);
    return `
      <button class="suite-tabs-card${on ? ' on' : ''}" data-tab="${t.id}" aria-pressed="${on}">
        <span class="suite-tabs-card-head">
          <span class="suite-tabs-card-icon">${iconFor(t.id)}</span>
          <span class="suite-tabs-card-name">${t.name}</span>
          <span class="suite-tabs-card-state" aria-hidden="true">${on ? '✓' : ''}</span>
        </span>
        <span class="suite-tabs-card-blurb">${t.blurb}</span>
      </button>`;
  }).join('');

  _layer.querySelector('.suite-tabs-sheet').innerHTML = `
    <div class="suite-tabs-header">
      <div>
        <div class="suite-tabs-title">Choose your tabs</div>
        <div class="suite-tabs-sub">Pick what you use — everything stays reachable from <kbd class="suite-palette-kbd">ctrl</kbd>+<kbd class="suite-palette-kbd">k</kbd>.</div>
      </div>
      <span class="suite-tabs-count">${visibleCount()} of ${TAB_CATALOG.length}</span>
    </div>
    <div class="suite-tabs-presets">
      <span class="suite-tabs-presets-label">Start from</span>
      ${presets}
    </div>
    <div class="suite-tabs-grid">${cards}</div>
    <div class="suite-tabs-footer">
      <span class="suite-tabs-hint" id="suiteTabsHint">Your choice is yours alone — practice-pushed config never changes it.</span>
      <button class="suite-tabs-done" data-tabs-done>Done</button>
    </div>`;

  wire();
}

function flashHint(msg) {
  const el = _layer?.querySelector('#suiteTabsHint');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('flash');
  setTimeout(() => el?.classList.remove('flash'), 1200);
}

function wire() {
  _layer.querySelectorAll('.suite-tabs-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const id = card.dataset.tab;
      if (_hidden.has(id)) {
        _hidden.delete(id);
      } else {
        if (visibleCount() <= 1) {
          flashHint('At least one tab has to stay visible.');
          return;
        }
        _hidden.add(id);
      }
      await persist(); // live-applies in the nav behind the overlay
      renderSheet();
    });
  });

  _layer.querySelectorAll('.suite-tabs-preset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      _hidden = new Set(hiddenFromPreset(btn.dataset.preset));
      await persist();
      renderSheet();
    });
  });

  _layer.querySelector('[data-tabs-done]')?.addEventListener('click', async () => {
    await persist(); // pressing Done counts as a conscious choice even if unchanged
    closeTabsChooser();
  });
}

export async function openTabsChooser() {
  if (_layer) return;
  const r = await chrome.storage.local.get(KEY);
  _hidden = new Set(sanitiseHiddenTabs(r[KEY]));

  _layer = document.createElement('div');
  _layer.className = 'suite-tabs-layer';
  _layer.setAttribute('role', 'dialog');
  _layer.setAttribute('aria-modal', 'true');
  _layer.setAttribute('aria-label', 'Choose your tabs');
  _layer.innerHTML = `<div class="suite-tabs-sheet"></div>`;
  document.body.appendChild(_layer);

  _layer.addEventListener('click', (e) => {
    // Scrim-close only when the click target IS the layer. A closest() check
    // would misfire here: toggles re-render the sheet mid-bubble, detaching
    // the clicked node from the sheet's ancestry and reading as a scrim click.
    if (e.target === _layer) closeTabsChooser();
  });
  _keyHandler = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeTabsChooser();
    }
  };
  document.addEventListener('keydown', _keyHandler, true);

  renderSheet();
}

export function closeTabsChooser() {
  if (_keyHandler) {
    document.removeEventListener('keydown', _keyHandler, true);
    _keyHandler = null;
  }
  _layer?.remove();
  _layer = null;
}
