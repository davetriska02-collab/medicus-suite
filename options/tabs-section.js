// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Options page "Tabs" section
//
// Renders role presets + per-tab toggle cards in the options page, writing the
// SAME user-owned key the side-panel chooser uses ('suite.hiddenTabs'). Both
// shells (side panel + pop-out) live-apply via their storage listeners, so a
// change here updates the nav immediately wherever it's open.
//
// Why this exists separately from side-panel/tabs-chooser/tabs-chooser.js: that
// overlay is a side-panel modal coupled to the panel DOM (it reads the live
// .nav-tab icons). New users in a practice-deployed install rarely reach it — a
// pushed practice code collapses the setup checklist before they see the tabs
// step — and it had no home in options at all. This is that home: a stable,
// discoverable surface a practice can point new staff to.
//
// Loaded as <script type="module"> from options.html. Data + pure logic come
// from the single source of truth in side-panel/tab-catalog.js.

'use strict';

import {
  TAB_CATALOG,
  ROLE_PRESETS,
  hiddenFromPreset,
  sanitiseHiddenTabs,
  toggleTabVisibility,
} from '../side-panel/tab-catalog.js';

const KEY = 'suite.hiddenTabs';

let _hidden = new Set();
let _grid = null;
let _count = null;
let _hint = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function visibleCount() {
  return TAB_CATALOG.length - _hidden.size;
}

async function persist() {
  await chrome.storage.local.set({ [KEY]: [...(_hidden || [])] });
}

function flashHint(msg) {
  if (!_hint) return;
  const prev = _hint.textContent;
  _hint.textContent = msg;
  _hint.classList.add('flash');
  setTimeout(() => {
    if (!_hint) return;
    _hint.classList.remove('flash');
    _hint.textContent = prev;
  }, 1600);
}

function renderPresets(host) {
  host.innerHTML = ROLE_PRESETS.map(
    (p) => `<button class="opt-tabs-preset" type="button" data-preset="${esc(p.id)}">${esc(p.label)}</button>`
  ).join('');
  host.querySelectorAll('.opt-tabs-preset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      _hidden = new Set(hiddenFromPreset(btn.dataset.preset));
      await persist();
      renderGrid();
    });
  });
}

function renderGrid() {
  if (!_grid) return;
  _grid.innerHTML = TAB_CATALOG.map((t) => {
    const on = !_hidden.has(t.id);
    return `
      <button class="opt-tabs-card${on ? ' on' : ''}" type="button" data-tab="${esc(t.id)}" aria-pressed="${on}">
        <span class="opt-tabs-card-head">
          <span class="opt-tabs-card-name">${esc(t.name)}</span>
          <span class="opt-tabs-card-state" aria-hidden="true">${on ? '&#10003;' : ''}</span>
        </span>
        <span class="opt-tabs-card-blurb">${esc(t.blurb)}</span>
      </button>`;
  }).join('');

  if (_count) _count.textContent = `${visibleCount()} of ${TAB_CATALOG.length} tabs shown`;

  _grid.querySelectorAll('.opt-tabs-card').forEach((card) => {
    card.addEventListener('click', async () => {
      const { hidden, blocked } = toggleTabVisibility([..._hidden], card.dataset.tab);
      if (blocked) {
        flashHint('At least one tab has to stay visible.');
        return;
      }
      _hidden = new Set(hidden);
      await persist();
      renderGrid();
    });
  });
}

async function load() {
  const r = await chrome.storage.local.get(KEY);
  _hidden = new Set(sanitiseHiddenTabs(r[KEY]));
}

async function init() {
  const presetHost = document.getElementById('optTabsPresets');
  _grid = document.getElementById('optTabsGrid');
  _count = document.getElementById('optTabsCount');
  _hint = document.getElementById('optTabsHint');
  if (!_grid || !presetHost) return; // section not present — nothing to do

  await load();
  renderPresets(presetHost);
  renderGrid();

  // Live sync: if the side-panel chooser (or another options tab) changes the
  // set, reflect it here without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[KEY]) return;
    _hidden = new Set(sanitiseHiddenTabs(changes[KEY].newValue));
    renderGrid();
  });
}

// Modules are deferred, so the DOM is parsed by the time this runs.
init();
