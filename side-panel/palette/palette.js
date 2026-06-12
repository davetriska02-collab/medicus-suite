// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — command palette (Ctrl+K) engine
//
// One keystroke to anywhere: jump to any tab, change display settings, open
// a specific Options section, replay the tour. Shell-owned (panel.js and
// pop-out.js both call initPalette); styles live in panel.css
// (suite-palette-*). Pure scoring/ranking logic is in palette-core.js.
//
// Commands are built fresh on every open:
//   - navigation commands are read from the live .nav-tab DOM, so they
//     automatically respect the context (panel vs pop-out), custom tab order
//     and any future tabs — running one simply clicks the real tab, reusing
//     all existing nav behaviour (visualiser special-case included);
//   - everything else is a small static registry below.
//
// Recents ('suite.palette.recents', localStorage) hold command ids only —
// never patient data.

'use strict';

import { rankCommands, pushRecent } from './palette-core.js';
import { startTour } from '../tour/tour.js';

const RECENTS_KEY = 'suite.palette.recents';

let _layer = null;
let _commands = [];
let _filtered = [];
let _selected = 0;
let _hotkeyHandler = null;

function loadRecents() {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY));
    return Array.isArray(v) ? v : [];
  } catch (_) {
    return [];
  }
}

function saveRecents(rec) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(rec));
  } catch (_) {
    /* storage unavailable — recents are a nicety, not state */
  }
}

// Merge a partial display-pref change into suite.display; display-prefs.js
// listens for the storage change and re-applies on every extension page.
async function setDisplay(patch) {
  const r = await chrome.storage.local.get('suite.display');
  const cur = r['suite.display'] || {};
  await chrome.storage.local.set({ 'suite.display': { ...cur, ...patch } });
}

function optionsSectionUrl(section) {
  return chrome.runtime.getURL(`options/options.html#sect-${section}`);
}

const SEARCH_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const GENERIC_ICONS = {
  display:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  settings:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/></svg>',
  help: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  window:
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
  doc: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
};

// Options sections (ids match options.html sect-* / options.js deep-linking).
const OPTIONS_SECTIONS = [
  ['suite', 'Suite', 'practice code feedback email global'],
  ['notifications', 'Notifications', 'alerts sounds desktop quiet clinic mode mute'],
  ['slots', 'Slot Counter', 'appointments'],
  ['capacity', 'Capacity Forecast', 'forecast'],
  ['submissions', 'Submissions', 'demand thresholds'],
  ['sentinel', 'Monitoring', 'sentinel drug rules qof chips'],
  ['triage', 'Triage Lens', 'red flags keywords hud'],
  ['reception', 'Reception', 'pathways'],
  ['knowledge', 'Knowledge', 'reference'],
  ['safety', 'Clinical Safety', 'hazard disclaimer'],
  ['backup', 'Backup & Restore', 'export import suite backup'],
  ['debug', 'Debug', 'api diagnostics log'],
];

// Build the command list from the live DOM + static registry.
function buildCommands() {
  const cmds = [];

  // Navigation — one command per nav tab in this context.
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const label = tab.getAttribute('aria-label') || tab.querySelector('span')?.textContent || tab.dataset.module;
    // Hidden tabs (suite.hiddenTabs) stay reachable here — the palette is the
    // escape hatch that makes hiding a tab de-cluttering, not lock-out.
    cmds.push({
      id: `nav:${tab.dataset.module}`,
      label: `Go to ${label}`,
      group: 'Tab',
      keywords: tab.dataset.module + (tab.classList.contains('nav-tab-hidden') ? ' hidden' : ''),
      icon: tab.querySelector('svg')?.outerHTML || GENERIC_ICONS.doc,
      run: () => tab.click(),
    });
  });

  // Visualiser opens as a full tab; the pop-out has no nav tab for it.
  if (!document.querySelector('.nav-tab[data-module="visualiser"]')) {
    cmds.push({
      id: 'open:visualiser',
      label: 'Open Patient Record Visualiser',
      group: 'Open',
      keywords: 'sar pdf record',
      icon: GENERIC_ICONS.doc,
      run: () => chrome.tabs.create({ url: chrome.runtime.getURL('visualiser-core.html') }),
    });
  }

  // Pop out — panel only (the button doesn't exist in the pop-out window).
  const popoutBtn = document.getElementById('popoutBtn');
  if (popoutBtn) {
    cmds.push({
      id: 'open:popout',
      label: 'Pop out to floating window',
      group: 'Open',
      keywords: 'window detach float',
      icon: GENERIC_ICONS.window,
      run: () => popoutBtn.click(),
    });
  }

  // Display preferences — applied live everywhere via display-prefs.js.
  const display = [
    ['display:light', 'Theme: light', 'day bright', { theme: 'light' }],
    ['display:dark', 'Theme: dark', 'night', { theme: 'dark' }],
    ['display:small', 'Text size: small', 'compact zoom', { size: 'small' }],
    ['display:medium', 'Text size: medium', 'default zoom', { size: 'medium' }],
    ['display:large', 'Text size: large', 'bigger zoom accessibility', { size: 'large' }],
  ];
  for (const [id, label, keywords, patch] of display) {
    cmds.push({ id, label, group: 'Display', keywords, icon: GENERIC_ICONS.display, run: () => setDisplay(patch) });
  }
  cmds.push({
    id: 'display:colorblind',
    label: 'Toggle colour-blind palette',
    group: 'Display',
    keywords: 'accessibility deuteranopia colorblind',
    icon: GENERIC_ICONS.display,
    run: async () => {
      const r = await chrome.storage.local.get('suite.display');
      await setDisplay({ colorblind: !(r['suite.display'] || {}).colorblind });
    },
  });

  // Tab chooser — role presets + per-tab show/hide (user-owned)
  cmds.push({
    id: 'tabs:choose',
    label: 'Choose tabs…',
    group: 'Display',
    keywords: 'customise tabs show hide nav role preset gp reception manager',
    icon: GENERIC_ICONS.window,
    run: () => import('../tabs-chooser/tabs-chooser.js').then((m) => m.openTabsChooser()),
  });

  // Quiet mode / clinic mode commands
  const quietIcon = GENERIC_ICONS.display; // reuse display icon
  cmds.push({
    id: 'quiet:30m',
    label: 'Clinic mode: 30 minutes',
    group: 'Quiet',
    keywords: 'mute silence notifications desktop 30 minutes clinic',
    icon: quietIcon,
    run: () => window.QuietMode?.set(Date.now() + 30 * 60 * 1000),
  });
  cmds.push({
    id: 'quiet:1h',
    label: 'Clinic mode: 1 hour',
    group: 'Quiet',
    keywords: 'mute silence notifications desktop hour clinic',
    icon: quietIcon,
    run: () => window.QuietMode?.set(Date.now() + 60 * 60 * 1000),
  });
  cmds.push({
    id: 'quiet:off',
    label: 'Clinic mode: off',
    group: 'Quiet',
    keywords: 'unmute resume notifications desktop clinic',
    icon: quietIcon,
    run: () => window.QuietMode?.clear(),
  });

  // Options sections — deep links straight to the right settings page.
  for (const [sect, label, keywords] of OPTIONS_SECTIONS) {
    cmds.push({
      id: `settings:${sect}`,
      label: `Settings: ${label}`,
      group: 'Settings',
      keywords: `options preferences configure ${keywords}`,
      icon: GENERIC_ICONS.settings,
      run: () => chrome.tabs.create({ url: optionsSectionUrl(sect) }),
    });
  }

  // Help
  cmds.push({
    id: 'help:tour',
    label: 'Replay the guided tour',
    group: 'Help',
    keywords: 'walkthrough onboarding help whats new',
    icon: GENERIC_ICONS.help,
    run: () => startTour(),
  });

  // Setup checklist — panel-only (setupHost does not exist in the pop-out)
  if (document.getElementById('setupHost')) {
    cmds.push({
      id: 'help:setup',
      label: 'Suite setup checklist',
      group: 'Help',
      keywords: 'first run practice code connection notifications onboarding health',
      icon: GENERIC_ICONS.help,
      run: () => import('../setup/setup.js').then((m) => m.openSetup()),
    });
  }

  return cmds;
}

// Wire the global hotkey + launcher button. Call once per page.
export function initPalette() {
  const btn = document.getElementById('paletteBtn');
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePalette();
  });

  _hotkeyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      e.stopPropagation();
      togglePalette();
    }
  };
  document.addEventListener('keydown', _hotkeyHandler, true);
}

export function togglePalette() {
  if (_layer) closePalette();
  else openPalette();
}

export function openPalette() {
  if (_layer) return;
  _commands = buildCommands();
  _selected = 0;

  _layer = document.createElement('div');
  _layer.className = 'suite-palette-layer';
  _layer.setAttribute('role', 'dialog');
  _layer.setAttribute('aria-modal', 'true');
  _layer.setAttribute('aria-label', 'Command palette');
  _layer.innerHTML = `
    <div class="suite-palette">
      <div class="suite-palette-inputrow">
        ${SEARCH_ICON}
        <input class="suite-palette-input" type="text" placeholder="Type a tab, setting or action…"
               aria-label="Search commands" spellcheck="false" autocomplete="off" />
        <kbd class="suite-palette-kbd">esc</kbd>
      </div>
      <div class="suite-palette-list" role="listbox" aria-label="Commands"></div>
      <div class="suite-palette-hints">
        <span><kbd class="suite-palette-kbd">↑↓</kbd> select</span>
        <span><kbd class="suite-palette-kbd">↵</kbd> run</span>
        <span><kbd class="suite-palette-kbd">ctrl</kbd>+<kbd class="suite-palette-kbd">k</kbd> toggle</span>
      </div>
    </div>`;
  document.body.appendChild(_layer);

  const input = _layer.querySelector('.suite-palette-input');

  _layer.addEventListener('click', (e) => {
    if (!e.target.closest('.suite-palette')) {
      closePalette();
      return;
    }
    const row = e.target.closest('[data-cmd-idx]');
    if (row) runCommand(_filtered[parseInt(row.dataset.cmdIdx, 10)]);
  });

  _layer.addEventListener('mousemove', (e) => {
    const row = e.target.closest('[data-cmd-idx]');
    if (!row) return;
    const idx = parseInt(row.dataset.cmdIdx, 10);
    if (idx !== _selected) {
      _selected = idx;
      paintSelection();
    }
  });

  input.addEventListener('input', () => {
    _selected = 0;
    renderList(input.value);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      _selected = Math.min(_selected + 1, _filtered.length - 1);
      paintSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _selected = Math.max(_selected - 1, 0);
      paintSelection();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runCommand(_filtered[_selected]);
    }
  });

  renderList('');
  input.focus();
}

export function closePalette() {
  _layer?.remove();
  _layer = null;
  _filtered = [];
  _selected = 0;
}

function runCommand(cmd) {
  if (!cmd) return;
  saveRecents(pushRecent(loadRecents(), cmd.id));
  closePalette();
  try {
    cmd.run();
  } catch (e) {
    console.error('[palette]', cmd.id, e);
  }
}

function renderList(query) {
  if (!_layer) return;
  _filtered = rankCommands(_commands, query, loadRecents());
  const list = _layer.querySelector('.suite-palette-list');
  if (_filtered.length === 0) {
    list.innerHTML = `<div class="suite-palette-empty">No matching commands</div>`;
    return;
  }
  list.innerHTML = _filtered
    .map(
      (c, i) => `
      <div class="suite-palette-row${i === _selected ? ' selected' : ''}" data-cmd-idx="${i}"
           role="option" aria-selected="${i === _selected}">
        <span class="suite-palette-icon">${c.icon}</span>
        <span class="suite-palette-label">${c.label}</span>
        <span class="suite-palette-group">${c.group}</span>
      </div>`
    )
    .join('');
  paintSelection();
}

function paintSelection() {
  if (!_layer) return;
  _layer.querySelectorAll('.suite-palette-row').forEach((row, i) => {
    row.classList.toggle('selected', i === _selected);
    row.setAttribute('aria-selected', String(i === _selected));
  });
  _layer.querySelector('.suite-palette-row.selected')?.scrollIntoView({ block: 'nearest' });
}
