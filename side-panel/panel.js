// Medicus Suite — Side Panel Controller

'use strict';

import { createModuleLoader } from './module-loader.js';
import { initTour, maybeAutoStartTour } from './tour/tour.js';
import { initPalette } from './palette/palette.js';
import { initQuickLeaflet } from './quick-leaflet/quick-leaflet.js';
import { sanitiseHiddenTabs, TAB_CATALOG, isLoadableModule, gChordMap, aboutEntries } from './tab-catalog.js';
import { initSetup } from './setup/setup.js';
import { openRotaTab } from './modules/rota/rota-open.js';
import { TAB_HELP } from '../shared/tab-help.js';
import { initPanelStrips } from './strips/index.js';
import { fmtHHMM } from './strips/helpers.js';

const SuiteMessages = globalThis.SuiteMessages;
if (!SuiteMessages) {
  throw new Error('[panel] SuiteMessages missing — load shared/messages.js before panel.js');
}

const content = document.getElementById('suiteContent');
const settingsBtn = document.getElementById('settingsBtn');
let activeModule = 'slots';
let moduleCleanup = null;
let switchSeq = 0;

let panelDisplayPrefs = { theme: 'light', size: 'medium', colorblind: false };
let displayOpen = false;
let _dpCloseHandler = null;

function buildDisplayPopoverHTML() {
  const p = panelDisplayPrefs;
  const themeOpts = [
    ['light', 'Light'],
    ['dark', 'Dark'],
  ]
    .map(
      ([v, l]) =>
        `<button class="dp-seg${p.theme === v ? ' active' : ''}" data-dp-key="theme" data-dp-val="${v}">${l}</button>`
    )
    .join('');
  const sizeOpts = [
    ['small', 'S'],
    ['medium', 'M'],
    ['large', 'L'],
  ]
    .map(
      ([v, l]) =>
        `<button class="dp-seg${p.size === v ? ' active' : ''}" data-dp-key="size" data-dp-val="${v}">${l}</button>`
    )
    .join('');
  return `<div class="dp-popover" id="dpPopover">
    <div class="dp-title">Display</div>
    <div class="dp-row">
      <span class="dp-lbl">Theme</span>
      <div class="dp-segs">${themeOpts}</div>
    </div>
    <div class="dp-row">
      <span class="dp-lbl">Text size</span>
      <div class="dp-segs">${sizeOpts}</div>
    </div>
    <div class="dp-row">
      <span class="dp-lbl">Colour-blind</span>
      <label class="dp-toggle">
        <input type="checkbox" id="dpColorblind" ${p.colorblind ? 'checked' : ''} />
        <span class="dp-track"><span class="dp-thumb"></span></span>
      </label>
    </div>
  </div>`;
}

// Merge the popover's three prefs over the stored object so sibling keys we
// don't manage here (e.g. zen, written by ZenMode) survive a theme/size change.
async function persistDisplayPrefs() {
  const r = await chrome.storage.local.get('suite.display');
  await chrome.storage.local.set({ 'suite.display': { ...(r['suite.display'] || {}), ...panelDisplayPrefs } });
}

function renderDisplayPopover() {
  const host = document.getElementById('displayPopoverHost');
  if (!host) return;
  host.innerHTML = displayOpen ? buildDisplayPopoverHTML() : '';
  if (!displayOpen) return;

  host.querySelectorAll('[data-dp-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      panelDisplayPrefs[btn.dataset.dpKey] = btn.dataset.dpVal;
      persistDisplayPrefs();
      renderDisplayPopover();
    });
  });
  host.querySelector('#dpColorblind')?.addEventListener('change', (e) => {
    panelDisplayPrefs.colorblind = e.target.checked;
    persistDisplayPrefs();
    renderDisplayPopover();
  });

  // Re-rendering the popover (e.g. on each in-popover click) must not stack
  // duplicate document listeners — remove any previous one before adding.
  if (_dpCloseHandler) document.removeEventListener('click', _dpCloseHandler);
  _dpCloseHandler = (e) => {
    if (!e.target.closest('#displayPopoverHost') && !e.target.closest('#displayBtn')) {
      displayOpen = false;
      document.removeEventListener('click', _dpCloseHandler);
      _dpCloseHandler = null;
      renderDisplayPopover();
    }
  };
  document.addEventListener('click', _dpCloseHandler);
}

// ── Module registry (derived from tab-catalog.js — do not hand-edit) ──────────
// Dynamic import() from the catalog path is required: a static map here would
// re-introduce the duplicated list Phase 1 exists to retire. Chrome MV3
// extension pages resolve specifier strings against the extension origin.

function modulesFromCatalog(shell, prefix) {
  const out = {};
  for (const t of TAB_CATALOG) {
    if (!isLoadableModule(t, shell)) continue;
    const entry = prefix + t.entry;
    const css = prefix + t.css;
    out[t.id] = { js: () => import(entry), css };
  }
  if (shell === 'panel') out.about = null;
  return out;
}

const MODULES = modulesFromCatalog('panel', './modules/');
// NOTE: 'rota-app' / 'visualiser' / 'duplicate-checker' are fulltab kind and
// stay out of MODULES so the boot guard (`m in MODULES`) cannot restore into
// them. The nav click handler opens those as full browser tabs.

// ── Help popover (per-tab "what is this?" affordance) ──────────────────────────
// TAB_HELP content lives in shared/tab-help.js — ONE source consumed by both
// this file and pop-out.js (see CLAUDE.md backup-convention-adjacent rule:
// shared content lives in one place, not duplicated per shell).
let helpOpen = false;
let _helpCloseHandler = null;

// Keyboard-shortcuts reference appended to every "?" help popover (see
// wireKeyboardNav below) — one copy, not duplicated per tab. The "g" row's
// title carries the full chord map so it's discoverable on hover without
// cluttering the fixed-width popover with 14 lines.
function buildKeyboardHelpSectionHTML() {
  const chordList = Object.entries(G_CHORD_MAP)
    .map(([key, mod]) => `${key}=${TAB_HELP[mod]?.title || mod}`)
    .join(', ');
  return `<div class="help-popover-row">
    <span class="help-popover-lbl">Keyboard shortcuts</span>
    <div class="help-popover-kbd-list">
      <span><kbd class="help-popover-kbd">ctrl</kbd>+<kbd class="help-popover-kbd">k</kbd> command palette</span>
      <span><kbd class="help-popover-kbd">ctrl</kbd>+<kbd class="help-popover-kbd">alt</kbd>+<kbd class="help-popover-kbd">←/→</kbd> cycle tabs</span>
      <span><kbd class="help-popover-kbd">1</kbd>–<kbd class="help-popover-kbd">9</kbd> jump to tab</span>
      <span title="${escStrip(chordList)}"><kbd class="help-popover-kbd">g</kbd> then a letter — jump to tab</span>
      <span><kbd class="help-popover-kbd">/</kbd> focus search</span>
      <span><kbd class="help-popover-kbd">?</kbd> this help</span>
      <span><kbd class="help-popover-kbd">esc</kbd> close popovers</span>
    </div>
  </div>`;
}

function buildHelpPopoverHTML() {
  const h = TAB_HELP[activeModule];
  const kbdSection = buildKeyboardHelpSectionHTML();
  if (!h) {
    return `<div class="help-popover" id="helpPopover" role="dialog" aria-label="Tab help">
      <div class="help-popover-title">Help</div>
      <div class="help-popover-row"><span class="help-popover-text">No help is available for this tab yet.</span></div>
      ${kbdSection}
    </div>`;
  }
  return `<div class="help-popover" id="helpPopover" role="dialog" aria-label="Help: ${escStrip(h.title)}">
    <div class="help-popover-title">${escStrip(h.title)}</div>
    <div class="help-popover-row">
      <span class="help-popover-lbl">What this is</span>
      <span class="help-popover-text">${escStrip(h.what)}</span>
    </div>
    <div class="help-popover-row">
      <span class="help-popover-lbl">Do this first</span>
      <span class="help-popover-text">${escStrip(h.firstStep)}</span>
    </div>
    ${kbdSection}
  </div>`;
}

function renderHelpPopover() {
  const host = document.getElementById('helpPopoverHost');
  const btn = document.getElementById('helpBtn');
  if (!host) return;
  host.innerHTML = helpOpen ? buildHelpPopoverHTML() : '';
  btn?.setAttribute('aria-expanded', String(helpOpen));
  btn?.classList.toggle('active', helpOpen);
  if (!helpOpen) return;

  if (_helpCloseHandler) document.removeEventListener('click', _helpCloseHandler);
  _helpCloseHandler = (e) => {
    if (!e.target.closest('#helpPopoverHost') && !e.target.closest('#helpBtn')) {
      helpOpen = false;
      document.removeEventListener('click', _helpCloseHandler);
      _helpCloseHandler = null;
      renderHelpPopover();
    }
  };
  document.addEventListener('click', _helpCloseHandler);
}

function wireHelpButton() {
  const btn = document.getElementById('helpBtn');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    helpOpen = !helpOpen;
    renderHelpPopover();
  });
  // Esc closes the popover and returns focus to the trigger (keyboard reachable).
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Escape' || e.key === 'Esc') && helpOpen) {
      helpOpen = false;
      if (_helpCloseHandler) {
        document.removeEventListener('click', _helpCloseHandler);
        _helpCloseHandler = null;
      }
      renderHelpPopover();
      btn.focus();
    }
  });
}

// ── "All tabs" menu ───────────────────────────────────────────────────────────
// At the 360-420px panel width the tab strip can only show the active tab; the
// rest scroll off (appraisal G1). This menu lists every visible tab by its full
// name so any tab is reachable in one click without horizontal scrolling. Built
// live from the nav DOM on each open, so it reflects current visibility/order.

let allTabsOpen = false;
let _allTabsCloseHandler = null;

function buildAllTabsPopoverHTML() {
  const tabs = Array.from(document.querySelectorAll('.nav-tab')).filter((t) => !t.classList.contains('nav-tab-hidden'));
  const rows = tabs
    .map((t) => {
      const mod = t.dataset.module || '';
      const icon = t.querySelector('svg')?.outerHTML || '';
      const label = t.querySelector('span:not(.nav-badge)')?.textContent || t.getAttribute('aria-label') || mod;
      const isActive = t.classList.contains('active');
      return `<button class="alltabs-item${isActive ? ' active' : ''}" role="menuitem" data-module="${escStrip(mod)}">
        <span class="alltabs-item-icon" aria-hidden="true">${icon}</span>
        <span class="alltabs-item-label">${escStrip(label)}</span>
      </button>`;
    })
    .join('');
  return `<div class="alltabs-popover" id="allTabsPopover" role="menu" aria-label="All tabs">
    <div class="alltabs-title">Jump to a tab</div>
    <div class="alltabs-list">${rows}</div>
    <div class="alltabs-hint">Ctrl+Alt+← / → switches tabs</div>
  </div>`;
}

function renderAllTabsPopover() {
  const host = document.getElementById('allTabsPopoverHost');
  const btn = document.getElementById('allTabsBtn');
  if (!host) return;
  host.innerHTML = allTabsOpen ? buildAllTabsPopoverHTML() : '';
  btn?.setAttribute('aria-expanded', String(allTabsOpen));
  btn?.classList.toggle('active', allTabsOpen);
  if (!allTabsOpen) return;

  // Clicking a row drives the real nav tab (reuses its switch + active logic).
  host.querySelectorAll('.alltabs-item').forEach((item) => {
    item.addEventListener('click', () => {
      const mod = item.dataset.module;
      const tab = document.querySelector(`.nav-tab[data-module="${mod}"]`);
      allTabsOpen = false;
      if (_allTabsCloseHandler) {
        document.removeEventListener('click', _allTabsCloseHandler);
        _allTabsCloseHandler = null;
      }
      renderAllTabsPopover();
      tab?.click();
    });
  });

  if (_allTabsCloseHandler) document.removeEventListener('click', _allTabsCloseHandler);
  _allTabsCloseHandler = (e) => {
    if (!e.target.closest('#allTabsPopoverHost') && !e.target.closest('#allTabsBtn')) {
      allTabsOpen = false;
      document.removeEventListener('click', _allTabsCloseHandler);
      _allTabsCloseHandler = null;
      renderAllTabsPopover();
    }
  };
  document.addEventListener('click', _allTabsCloseHandler);
}

function wireAllTabsButton() {
  const btn = document.getElementById('allTabsBtn');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    allTabsOpen = !allTabsOpen;
    renderAllTabsPopover();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Escape' || e.key === 'Esc') && allTabsOpen) {
      allTabsOpen = false;
      if (_allTabsCloseHandler) {
        document.removeEventListener('click', _allTabsCloseHandler);
        _allTabsCloseHandler = null;
      }
      renderAllTabsPopover();
      btn.focus();
    }
  });
}

// Shared typing-guard predicate — single source used by wireTabNavShortcuts
// below AND by wireKeyboardNav's single-key bindings, so the two never drift
// out of step on what counts as "the user is typing".
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

// Visible, jumpable nav tabs in current DOM order — shared by the Ctrl/Cmd+Alt
// cycler below and by wireKeyboardNav's digit-jump / "g" chord (item 6.1/6.2):
// hidden tabs (suite.hiddenTabs) and the Visualiser special-case (it opens a
// full browser tab, not an in-panel switch) are excluded from all three.
function jumpableTabs() {
  return Array.from(document.querySelectorAll('.nav-tab')).filter(
    (t) =>
      !t.classList.contains('nav-tab-hidden') && t.dataset.module !== 'visualiser' && t.dataset.module !== 'rota-app'
  );
}

// Keyboard tab navigation (power-user finding R4): Ctrl/Cmd+Alt+Left/Right cycle
// the visible in-panel tabs without the mouse. Skipped while typing in a field,
// and skips Visualiser and Rota manager (both open a full browser tab, not an
// in-panel switch — the compact 'rota' module stays in the cycle).
function wireTabNavShortcuts() {
  document.addEventListener(
    'keydown',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (isTypingTarget(document.activeElement)) return;
      const tabs = jumpableTabs();
      if (!tabs.length) return;
      e.preventDefault();
      const activeIdx = tabs.findIndex((t) => t.classList.contains('active'));
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const start = activeIdx === -1 ? 0 : activeIdx;
      const next = (start + dir + tabs.length) % tabs.length;
      tabs[next].click();
    },
    true
  );
}

// ── Keyboard-first panel navigation (power-user partner ask: jump tabs, focus
// search, no mouse trips) ────────────────────────────────────────────────────
// A single global keydown layer, thin and additive — it never claims a key
// already owned elsewhere: Ctrl/Cmd+K (command palette, palette.js), Ctrl/Cmd+
// Alt+←/→ (tab cycling, wireTabNavShortcuts above) or Esc (popover dismissal,
// wireHelpButton/wireAllTabsButton). What it adds:
//   1. Digits 1-9        → jump to the Nth visible tab (jumpableTabs()).
//   2. "g" then a letter  → chord-jump to a specific tab (G_CHORD_MAP).
//   3. "/"                → focus the active module's search/filter input.
//   4. "?" (shift+/)      → open the per-tab help popover (now carrying a
//                           keyboard-shortcuts section, see buildHelpPopoverHTML).
// Reduced-attention rule (item 6): none of this fires while typing in a field,
// or while any shell-level overlay (command palette, tour, tab chooser, or this
// panel's own help/all-tabs/display popovers) is open — see isOverlayOpen().

// Second key of a "g" chord → module to jump to. Preference is the module's
// own data-module first letter; where two or more modules share a first
// letter, one keeps it and the rest are reassigned a letter from elsewhere in
// their name so every entry stays mnemonic. Collisions and their resolutions:
//   s* → slots keeps 's'; sentinel → 'm' (Monitoring), submissions → 'u',
//        sweep → 'w'
//   c* → condor keeps 'c'; capacity → 'p'
//   r* → referrals keeps 'r'; record → 'd', reception → 'e'
//   t* → today keeps 't'; trends → 'n'
const G_CHORD_MAP = gChordMap();

const G_CHORD_TIMEOUT_MS = 1500;
let _gChordArmed = false;
let _gChordTimer = null;
let _gChordIndicatorEl = null;

// Transient "g …" indicator — the chord has no other visible cue, so this is
// the discoverability affordance the panel ask calls for. Styled to emulate
// the existing kbd-token + floating-popover patterns (suite-palette-kbd,
// help-popover) rather than inventing a new visual language.
function showGChordIndicator() {
  if (!_gChordIndicatorEl) {
    _gChordIndicatorEl = document.createElement('div');
    _gChordIndicatorEl.className = 'kbdnav-chord-indicator';
    _gChordIndicatorEl.setAttribute('aria-live', 'polite');
    _gChordIndicatorEl.innerHTML = '<kbd>g</kbd> …';
    document.body.appendChild(_gChordIndicatorEl);
  }
  _gChordIndicatorEl.classList.add('kbdnav-chord-indicator-visible');
}

function hideGChordIndicator() {
  _gChordIndicatorEl?.classList.remove('kbdnav-chord-indicator-visible');
}

function armGChord() {
  _gChordArmed = true;
  showGChordIndicator();
  if (_gChordTimer) clearTimeout(_gChordTimer);
  _gChordTimer = setTimeout(disarmGChord, G_CHORD_TIMEOUT_MS);
}

function disarmGChord() {
  _gChordArmed = false;
  if (_gChordTimer) {
    clearTimeout(_gChordTimer);
    _gChordTimer = null;
  }
  hideGChordIndicator();
}

// Any open shell-level overlay — a keyboard shortcut must never steal focus
// out from under one of these (reduced-attention rule, item 6). The command
// palette, tour and tab chooser render into the DOM rather than exposing an
// importable "is open" flag, so they're checked by their layer class; the
// panel's own help/all-tabs/display popovers are already tracked in local
// module state (helpOpen/allTabsOpen/displayOpen) declared above.
function isOverlayOpen() {
  return (
    helpOpen ||
    allTabsOpen ||
    displayOpen ||
    !!document.querySelector('.suite-palette-layer') ||
    !!document.querySelector('.suite-tour-layer') ||
    !!document.querySelector('.suite-tabs-layer')
  );
}

// "/" target: the active module's own search/filter input, checked in
// priority order (search-typed input, then anything explicitly marked
// data-search, then the first visible plain text input). No-op silently if
// the active module has none of these.
function isVisible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function focusModuleSearch() {
  if (!content) return;
  const tiers = ['input[type="search"]', '[data-search]', 'input[type="text"], input:not([type])'];
  for (const sel of tiers) {
    const target = Array.from(content.querySelectorAll(sel)).find(isVisible);
    if (target) {
      target.focus();
      if (typeof target.select === 'function') target.select();
      return;
    }
  }
}

function wireKeyboardNav() {
  document.addEventListener(
    'keydown',
    (e) => {
      if (isOverlayOpen()) return;
      if (isTypingTarget(document.activeElement)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // these are single-key/chord bindings only
      // A bare modifier keydown (e.g. Shift held down before typing "?") must not
      // itself count as the chord's second key or cancel an armed chord.
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'CapsLock') {
        return;
      }

      // Mid-chord: this keystroke completes or cancels the "g" chord — either
      // way it's consumed here, so it never also falls through to the "?"/
      // "/"/digit handlers below.
      if (_gChordArmed) {
        disarmGChord();
        const mod = e.key.length === 1 ? G_CHORD_MAP[e.key.toLowerCase()] : undefined;
        const tab = mod && jumpableTabs().find((t) => t.dataset.module === mod);
        if (tab) {
          e.preventDefault();
          tab.click();
        }
        return;
      }

      if (e.key.toLowerCase() === 'g') {
        e.preventDefault();
        armGChord();
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        if (!helpOpen) {
          helpOpen = true;
          renderHelpPopover();
        }
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        focusModuleSearch();
        return;
      }

      if (e.key >= '1' && e.key <= '9') {
        const tabs = jumpableTabs();
        const idx = Number(e.key) - 1;
        if (idx < tabs.length) {
          e.preventDefault();
          tabs[idx].click();
        }
      }
    },
    true
  );
}

// ── Nav overflow detection ────────────────────────────────────────────────────

const navEl = document.querySelector('.suite-nav');
const navTabsEl = document.querySelector('.nav-tabs');
const navIndicatorRight = document.querySelector('.nav-scroll-right');
const navIndicatorLeft = document.querySelector('.nav-scroll-left');

function updateNavOverflow() {
  if (!navTabsEl) return;
  const sl = navTabsEl.scrollLeft;
  const hasRight =
    navTabsEl.scrollWidth > navTabsEl.clientWidth + 4 && sl + navTabsEl.clientWidth < navTabsEl.scrollWidth - 4;
  const hasLeft = sl > 4;
  navEl.classList.toggle('has-overflow-right', hasRight);
  navEl.classList.toggle('has-overflow-left', hasLeft);
}

navTabsEl?.addEventListener('scroll', updateNavOverflow);
if (navTabsEl) new ResizeObserver(updateNavOverflow).observe(navTabsEl);
updateNavOverflow();

// Persistent discoverability: at 400px only a couple of tabs are visible at a
// time, so newcomers miss that the rest exist. The command palette reaches
// every tab (including ones scrolled off the rail or hidden via "choose your
// tabs"), so advertise the full count on its button permanently.
(function initPaletteHint() {
  const btn = document.getElementById('paletteBtn');
  if (!btn) return;
  const total = document.querySelectorAll('.nav-tab').length;
  if (!total) return;
  btn.title = `Jump to any of the ${total} tabs · Command palette (Ctrl+K)`;
  // The bare count badge ("15") read as a mystery number to the appraisal panel;
  // name it for assistive tech and tooltip so it can't be mistaken for an unread
  // count. (Practice appraisal U2, 2026-06-21.)
  btn.setAttribute('aria-label', `Command palette — jump to any of the ${total} tabs (Ctrl+K)`);
  let badge = btn.querySelector('.palette-count');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'palette-count';
    badge.setAttribute('aria-hidden', 'true');
    btn.appendChild(badge);
  }
  badge.textContent = String(total);
})();

[navIndicatorRight, navIndicatorLeft].forEach((el) => {
  if (!el) return;
  el.style.setProperty('pointer-events', 'auto');
  el.style.setProperty('cursor', 'pointer');
});
navIndicatorRight?.addEventListener('click', () => navTabsEl?.scrollBy({ left: 120, behavior: 'smooth' }));
navIndicatorLeft?.addEventListener('click', () => navTabsEl?.scrollBy({ left: -120, behavior: 'smooth' }));

// ── Slots nav badge ───────────────────────────────────────────────────────────
document.addEventListener('suite:slots:count', (e) => {
  const tab = document.querySelector('[data-module="slots"]');
  if (!tab) return;
  let badge = tab.querySelector('.nav-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    tab.appendChild(badge);
  }
  const n = e.detail.count;
  badge.textContent = n != null ? String(n) : '';
  badge.style.display = n != null && n >= 0 ? '' : 'none';
});

// CSS dedup set for module stylesheets — passed to createModuleLoader
const loadedCss = new Set();

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    // A drag that ends on the same tab still fires a click; suppress it so a
    // reorder doesn't also switch module.
    if (tab.dataset.dragged === '1') {
      delete tab.dataset.dragged;
      return;
    }
    const mod = tab.dataset.module;
    if (mod === 'visualiser') {
      chrome.tabs.create({ url: chrome.runtime.getURL('visualiser-core.html') });
      return;
    }
    if (mod === 'duplicate-checker') {
      chrome.tabs.create({ url: chrome.runtime.getURL('duplicate-checker.html') });
      return;
    }
    if (mod === 'rota-app') {
      openRotaTab();
      return;
    }
    if (mod === activeModule) return;
    switchModule(mod);
  });
});

// ── Drag-and-drop tab reordering ──────────────────────────────────────────────
// Persists a global preferred order in suite.tabOrder (see side-panel/tab-order.js).
// Panel and pop-out share the key and each reconciles against its own tab set.

(async () => {
  const { reconcileTabOrder, STORAGE_KEY } = await import('./tab-order.js');
  if (!navTabsEl) return;

  const tabIds = () => [...navTabsEl.querySelectorAll('.nav-tab')].map((t) => t.dataset.module);

  // Apply a stored order by reordering existing nodes (listeners survive).
  function applyOrder(stored) {
    const order = reconcileTabOrder(tabIds(), stored);
    order.forEach((id) => {
      const el = navTabsEl.querySelector(`.nav-tab[data-module="${id}"]`);
      if (el) navTabsEl.appendChild(el);
    });
    updateNavOverflow();
  }

  // Initial apply from storage.
  const r = await chrome.storage.local.get(STORAGE_KEY);
  applyOrder(r[STORAGE_KEY]);

  // Live sync: re-apply when another context changes the order.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY]) applyOrder(changes[STORAGE_KEY].newValue);
  });

  let dragSrc = null;

  navTabsEl.querySelectorAll('.nav-tab').forEach(makeDraggable);

  function makeDraggable(tab) {
    tab.setAttribute('draggable', 'true');
    tab.title = tab.title || 'Drag to reorder';

    tab.addEventListener('dragstart', (e) => {
      dragSrc = tab;
      tab.classList.add('nav-tab-dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers require data to be set for the drag to start.
      try {
        e.dataTransfer.setData('text/plain', tab.dataset.module);
      } catch (_) {}
    });

    tab.addEventListener('dragend', () => {
      tab.classList.add('nav-tab-just-dragged');
      // Mark so the synthesised click after a drag is swallowed, then clear.
      tab.dataset.dragged = '1';
      setTimeout(() => {
        delete tab.dataset.dragged;
      }, 0);
      tab.classList.remove('nav-tab-dragging', 'nav-tab-just-dragged');
      navTabsEl
        .querySelectorAll('.nav-tab-drop-before, .nav-tab-drop-after')
        .forEach((t) => t.classList.remove('nav-tab-drop-before', 'nav-tab-drop-after'));
      dragSrc = null;
    });

    tab.addEventListener('dragover', (e) => {
      if (!dragSrc || dragSrc === tab) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      navTabsEl
        .querySelectorAll('.nav-tab-drop-before, .nav-tab-drop-after')
        .forEach((t) => t.classList.remove('nav-tab-drop-before', 'nav-tab-drop-after'));
      tab.classList.add(after ? 'nav-tab-drop-after' : 'nav-tab-drop-before');
    });

    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragSrc || dragSrc === tab) return;
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      navTabsEl.insertBefore(dragSrc, after ? tab.nextSibling : tab);
      chrome.storage.local.set({ [STORAGE_KEY]: tabIds() });
      updateNavOverflow();
    });
  }
})();

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Popout button ─────────────────────────────────────────────────────────────

const popoutBtn = document.getElementById('popoutBtn');

async function updatePopoutBtn() {
  if (!popoutBtn || !window.PopoutManager) return;
  const isOpen = await window.PopoutManager.isOpen();
  popoutBtn.title = isOpen ? 'Focus floating window' : 'Pop out to floating window';
  popoutBtn.classList.toggle('active', isOpen);
}

popoutBtn?.addEventListener('click', async () => {
  if (!window.PopoutManager) return;
  await window.PopoutManager.open();
  await updatePopoutBtn();
});

chrome.runtime.onMessage.addListener(
  SuiteMessages.gatedListener((msg) => {
    if (msg?.type === 'popout:closed') updatePopoutBtn();
  })
);

updatePopoutBtn();

const switchModule = createModuleLoader({
  modules: MODULES,
  container: content,
  loadedCss,
  getSwitchSeq: () => switchSeq,
  incSwitchSeq: () => ++switchSeq,
  getCleanup: () => moduleCleanup,
  setCleanup: (fn) => {
    moduleCleanup = fn;
  },
  setActive: (name) => {
    activeModule = name;
    // Keep an open help popover in step with the tab the user just switched to.
    if (helpOpen) renderHelpPopover();
  },
  onSpecial: (name) => {
    if (name === 'about') {
      renderAbout();
      return true;
    }
    return false;
  },
  onPersist: (name) => {
    // Don't persist 'about' as a boot target — it's a static info page,
    // not a real module, so restoring it on next open is useless.
    if (name === 'about') return;
    chrome.storage.local.set({ 'panel.activeModule': name });
  },
  escFn: escStrip,
});

// ── About module (inline) ─────────────────────────────────────────────────────

function renderAbout() {
  content.innerHTML = `
    <div class="about-module">
      <div class="about-brand">
        <img class="about-brand-logo" src="../brand/app-icon.png" alt="Medicus Suite" width="40" height="40" />
        <div class="about-brand-text">
          <div class="about-brand-name">Medicus Suite</div>
          <div class="about-brand-tagline">The clinical intelligence layer for Medicus</div>
        </div>
      </div>

      <div class="feature-list-link">
        <a href="https://github.com/davetriska02-collab/medicus-suite/raw/main/docs/feature-list.docx" target="_blank" rel="noopener noreferrer">
          📄 Download the latest feature list (.docx)
        </a>
        <div class="feature-list-link-sub">Regenerated weekly. Source: <a href="https://github.com/davetriska02-collab/medicus-suite/blob/main/docs/feature-list.md" target="_blank" rel="noopener noreferrer">view on GitHub</a></div>
      </div>

      <h2>Modules</h2>
      ${aboutEntries()
        .map((t) => {
          const name = escStrip(t.aboutName || t.name);
          const ver = escStrip(t.aboutVersion || '');
          const desc = escStrip(t.aboutDesc);
          const purpose = t.aboutPurpose
            ? `<div class="purpose-box">
          Software that displays, against the patient's active medication list, active problem list,
          and recent observations as already recorded in the Medicus electronic patient record,
          the most recent recorded values relevant to published drug-monitoring guidance and to QOF
          2025/26 indicator criteria, and indicates whether those values fall within the recommended
          interval or whether the relevant QOF indicator is achieved. The software does not recommend
          clinical actions, does not order investigations, does not write to the patient record, does
          not modify QOF claims data, does not transmit any data outside the user's browser, does
          not analyse images, does not generate synthetic data, and does not constitute clinical
          decision support. It is a passive display tool for use by the clinician as a memory aid.
          All clinical decisions, including verification of any displayed value against the source
          record, remain the responsibility of the clinician.
        </div>
        <a class="disclaimer-link" href="../docs/sentinel-DISCLAIMER.txt" target="_blank">View DISCLAIMER ↗</a>`
            : '';
          return `<div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">${name}</span>
          <span class="module-card-version">${ver}</span>
        </div>
        <div class="module-card-desc">${desc}</div>
        ${purpose}
      </div>`;
        })
        .join('\n')}

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Triage Lens</span>
          <span class="module-card-version">v0.5.0</span>
        </div>
        <div class="module-card-desc">
          In-page overlay on Medicus patient records and triage queues.
          User-defined keyword rules with severity chips. Runs as a content script — not a side-panel tab.
        </div>
      </div>

      <h2>Suite</h2>
      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Medicus Suite</span>
          <span class="module-card-version">v${chrome.runtime.getManifest().version}</span>
        </div>
        <div class="module-card-desc">
          This extension is a runtime container. It provides a side panel and shared infrastructure.
          Each module above retains its own purpose, scope, and regulatory positioning.
          The suite itself makes no clinical claims and provides no decision support.
        </div>
        <div style="margin-top:10px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <button id="checkUpdateBtn" style="font-size:11px; font-family:var(--mono); font-weight:600; color:var(--accent); background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.25); border-radius:5px; padding:4px 10px; cursor:pointer;">Check for updates</button>
          <span id="updateStatus" style="font-size:11px; font-family:var(--mono); color:var(--text-3);"></span>
        </div>
      </div>

      <h2>Feedback</h2>
      <div class="module-card">
        <div class="module-card-desc" style="margin-bottom:10px;">
          Found a bug, want a new feature, or have general feedback? Send it straight to the developer.
          Your email client opens pre-filled — review and hit send.
        </div>
        <div class="fb-types" role="group" aria-label="Feedback type">
          <button type="button" class="fb-type-btn active" data-fb-type="Feedback">Feedback</button>
          <button type="button" class="fb-type-btn" data-fb-type="Feature request">Feature request</button>
          <button type="button" class="fb-type-btn" data-fb-type="Bug report">Bug report</button>
        </div>
        <div class="fb-field">
          <label for="fbSubject">Subject</label>
          <input id="fbSubject" type="text" maxlength="120" placeholder="Short summary" />
        </div>
        <div class="fb-field">
          <label for="fbDetails">Details</label>
          <textarea id="fbDetails" rows="5" placeholder="What happened, what you expected, steps to reproduce…"></textarea>
        </div>
        <div class="fb-warn" role="note">⚠ Do not include patient-identifiable information (names, NHS numbers, dates of birth). Suite version and browser details are attached automatically.</div>
        <div class="fb-actions">
          <button id="fbSendBtn" type="button" class="fb-send-btn">Open email</button>
          <span id="fbStatus" class="fb-status"></span>
        </div>
      </div>
    </div>
  `;

  document.getElementById('checkUpdateBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('checkUpdateBtn');
    const status = document.getElementById('updateStatus');
    if (!btn || !status) return;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    status.textContent = '';
    try {
      const result = await window.UpdateChecker.checkForUpdate({ force: true });
      const installed = window.UpdateChecker.getInstalledVersion();
      if (!result.ok) {
        status.style.color = 'var(--red)';
        status.textContent = result.error || 'Check failed';
      } else if (window.UpdateChecker.isNewer(result.latestVersion, installed)) {
        status.style.color = 'var(--amber)';
        // Validate releaseUrl is a github.com https URL before injecting (defends against
        // a spoofed/poisoned GitHub API response that could deliver a javascript: URL).
        const safeUrl = /^https:\/\/github\.com\//.test(result.releaseUrl || '') ? result.releaseUrl : '#';
        status.innerHTML = `v${escStrip(result.latestVersion)} available — <a href="${escStrip(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">view release ↗</a>`;
      } else {
        status.style.color = 'var(--green)';
        status.textContent = `v${installed} is up to date`;
      }
    } catch (e) {
      status.style.color = 'var(--red)';
      status.textContent = e.message || 'Unknown error';
    }
    btn.disabled = false;
    btn.textContent = 'Check for updates';
  });

  // ── Feedback / feature request / bug report (mailto) ──────────────────────────
  // Recipient is configurable in Options › Suite (suite.feedbackEmail); falls back
  // to the default below when unset.
  const FEEDBACK_EMAIL_DEFAULT = 'davetriska02@gmail.com';
  const fbTypeBtns = document.querySelectorAll('.fb-type-btn');
  fbTypeBtns.forEach((b) =>
    b.addEventListener('click', () => {
      fbTypeBtns.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    })
  );

  document.getElementById('fbSendBtn')?.addEventListener('click', async () => {
    const status = document.getElementById('fbStatus');
    const subjectEl = document.getElementById('fbSubject');
    const detailsEl = document.getElementById('fbDetails');
    const type = document.querySelector('.fb-type-btn.active')?.dataset.fbType || 'Feedback';
    const subject = (subjectEl?.value || '').trim();
    const details = (detailsEl?.value || '').trim();

    if (!subject && !details) {
      if (status) {
        status.style.color = 'var(--red)';
        status.textContent = 'Add a subject or details first';
      }
      subjectEl?.focus();
      return;
    }

    const version = chrome.runtime.getManifest().version;
    const diag = [
      '',
      '──────────',
      '(Diagnostics — please keep)',
      `Type: ${type}`,
      `Suite version: v${version}`,
      `Browser: ${navigator.userAgent}`,
      `Date: ${new Date().toISOString()}`,
    ].join('\n');
    const mailSubject = `[Medicus Suite] ${type}${subject ? ': ' + subject : ''}`;
    const mailBody = `${details}\n${diag}`;
    const stored = await chrome.storage.local.get('suite.feedbackEmail');
    const recipient = (stored['suite.feedbackEmail'] || '').trim() || FEEDBACK_EMAIL_DEFAULT;
    const url = `mailto:${recipient}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;

    // Use a transient anchor click rather than navigating the panel away.
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();

    if (status) {
      status.style.color = 'var(--green)';
      status.textContent = 'Opening your email client…';
    }
  });
}

// ── Service worker messages ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  SuiteMessages.gatedListener((msg) => {
    // Dispatched UNCONDITIONALLY (v3.173.2): the Capacity tab listens for this
    // same DOM event as its ONLY live-update path, so the old
    // `activeModule === 'slots'` gate silently froze Capacity (the classic
    // symptom: "slots no longer auto refresh"). Unconditional dispatch cannot
    // double-fire — module switching runs the outgoing module's cleanup(), which
    // removes its listener, so at any instant only the active module listens.
    if (msg?.type === 'slots:refresh') {
      document.dispatchEvent(new CustomEvent('suite:slots:refresh'));
    }
  })
);


// ── Quiet pill ────────────────────────────────────────────────────────────────
// Shows an amber pill in the nav when clinic (quiet) mode is active.
// Polls every 30s and reacts to storage changes. Click clears quiet mode.

const _quietPillEl = document.getElementById('quietPill');

async function _updateQuietPill() {
  if (!_quietPillEl) return;
  try {
    const r = await chrome.storage.local.get('suite.quietUntil');
    const until = r['suite.quietUntil'];
    const isActive = until && typeof until === 'number' && until > Date.now();
    if (isActive) {
      const hhmm = fmtHHMM(until);
      _quietPillEl.textContent = `🔕 ${hhmm}`;
      _quietPillEl.title = `Clinic mode — desktop pop-ups and sounds muted until ${hhmm}. Click to switch off.`;
      _quietPillEl.classList.remove('quiet-pill-hidden');
    } else {
      _quietPillEl.classList.add('quiet-pill-hidden');
      _quietPillEl.title = '';
    }
  } catch (_) {}
}

_quietPillEl?.addEventListener('click', () => {
  window.QuietMode?.clear();
});

setInterval(_updateQuietPill, 30 * 1000);

chrome.storage.onChanged.addListener((changes) => {
  if ('suite.quietUntil' in changes) _updateQuietPill();
});

_updateQuietPill();

// ── Global demand / alert strips (panel-only) ────────────────────────────────
// Extracted to side-panel/strips/ (architecture plan Phase 4.1). Each strip is
// an ES module with initStrip(el, bus) → cleanup. The shell keeps orchestration.
initPanelStrips({ switchModule, SuiteMessages });

// ── Tab visibility (suite.hiddenTabs — USER-OWNED, never profile-pushed) ─────
// Hidden tabs disappear from the nav but stay reachable via the Ctrl+K palette.
function applyTabVisibility(raw) {
  const hidden = new Set(sanitiseHiddenTabs(raw));
  document.querySelectorAll('.nav-tab').forEach((t) => {
    t.classList.toggle('nav-tab-hidden', hidden.has(t.dataset.module));
  });
  updateNavOverflow();
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes['suite.hiddenTabs']) applyTabVisibility(changes['suite.hiddenTabs'].newValue);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

// Sync panelDisplayPrefs from storage so the display popover reflects current settings.
// HTML attributes (data-theme etc.) are applied by shared/display-prefs.js.
function _syncPanelDisplayPrefs(p) {
  p = p || {};
  panelDisplayPrefs.theme = p.theme || 'light';
  panelDisplayPrefs.size = p.size || 'medium';
  panelDisplayPrefs.colorblind = !!p.colorblind;
}
chrome.storage.local.get('suite.display').then((r) => {
  _syncPanelDisplayPrefs(r['suite.display'] || {});
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes['suite.display']) _syncPanelDisplayPrefs(changes['suite.display'].newValue || {});
});

// Wire display button
document.getElementById('displayBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  displayOpen = !displayOpen;
  renderDisplayPopover();
});

// Wire quick-leaflet popover (leaflet search from any tab — panel only)
initQuickLeaflet({ switchModule });

// Wire per-tab help button
wireHelpButton();
wireAllTabsButton();
wireTabNavShortcuts();
wireKeyboardNav();

// ── Boot — restore last active module ────────────────────────────────────────
// Read the persisted module name and switch to it, falling back to 'slots' if
// absent, invalid, or not a real module key.
(async () => {
  const r = await chrome.storage.local.get(['panel.activeModule', 'suite.hiddenTabs']);
  const saved = r['panel.activeModule'];
  applyTabVisibility(r['suite.hiddenTabs']);
  // Guard: must be a non-'about' key present in MODULES, and not a hidden tab.
  const hiddenSet = new Set(sanitiseHiddenTabs(r['suite.hiddenTabs']));
  const usable = (m) => m && m !== 'about' && m in MODULES && MODULES[m] !== null && !hiddenSet.has(m);
  let startMod = usable(saved) ? saved : usable('today') ? 'today' : null;
  if (!startMod) {
    // Every preferred candidate hidden — first visible nav tab wins.
    for (const t of document.querySelectorAll('.nav-tab')) {
      if (usable(t.dataset.module)) {
        startMod = t.dataset.module;
        break;
      }
    }
  }
  switchModule(startMod || 'today');

  // ── Guided tour (first-run suite walkthrough) ───────────────────────────────
  // The tour can switch tabs as it walks the suite; give it the module loader.
  // Auto-start is deferred so the boot module's first paint settles first; the
  // engine no-ops when localStorage says the current TOUR_VERSION has been seen.
  initTour({ activateModule: (name) => switchModule(name), getActiveModule: () => activeModule });
  setTimeout(maybeAutoStartTour, 900);

  // First-run setup checklist (panel-only; setupHost exists only in panel.html)
  const setupHostEl = document.getElementById('setupHost');
  if (setupHostEl) initSetup(setupHostEl);
})();

// ── Command palette (Ctrl+K) ─────────────────────────────────────────────────
initPalette();

// ── Cleanup Code Preferences: silent practice-pool contribution ─────────────
// Fire-and-forget on every panel open — never blocks anything above, never
// prompts. See shared/io/pdc-contribute.js for what this does and why it's
// safe to run without the machine ever completing the full "Publish to
// shared folder" flow in Options (that flow's own enable toggle + connect
// button live there; this just supplies the periodic trigger that doesn't
// depend on anyone opening Options). A machine that has never enabled
// contribution (suite.pdcContribute.enabled !== true) is a same-cycle no-op —
// except an established pre-v3.226.0 auto-publisher, which is migrated to
// enabled:true on first run so retiring maybeAutoPublish() doesn't silently
// stop its daily tally circulation (see migrateLegacyAutoPublisher).
(async () => {
  try {
    if (!window.PdcContribute || !window.FsHandleStore) return;

    async function resolveHandle() {
      return (
        (await window.FsHandleStore.loadFileHandle('pdcContribFile')) ||
        (await window.FsHandleStore.loadFileHandle('profileFile'))
      );
    }

    // Minimal standalone read of practice-profile.json — deliberately NOT
    // shared/io/practice-profile.js (59 KB, and pulls in every module's IO
    // file via _io() lookups this surface never needs); this is the same
    // ~10-line fetch that file's own fetchProfile() does.
    async function fetchProfile() {
      try {
        const resp = await fetch(chrome.runtime.getURL('practice-profile.json'), { cache: 'no-store' });
        if (!resp.ok) return null;
        const profile = await resp.json();
        if (profile.format !== 'medicus-suite-practice-profile') return null;
        if (!profile.profileVersion || !profile.envelope) return null;
        return profile;
      } catch (_) {
        return null;
      }
    }

    await window.PdcContribute.runPdcContribution({
      getState: async () => {
        const r = await chrome.storage.local.get(window.PdcContribute.PDC_CONTRIBUTE_STATE_KEY);
        return r[window.PdcContribute.PDC_CONTRIBUTE_STATE_KEY] || null;
      },
      setState: async (patch) => {
        const key = window.PdcContribute.PDC_CONTRIBUTE_STATE_KEY;
        const r = await chrome.storage.local.get(key);
        await chrome.storage.local.set({ [key]: Object.assign({}, r[key] || {}, patch) });
      },
      getPublisherState: async () => {
        const r = await chrome.storage.local.get('suite.practiceProfile.publisher');
        return r['suite.practiceProfile.publisher'] || null;
      },
      loadHandle: resolveHandle,
      readHandleText: async (h) => (await h.getFile()).text(),
      writeHandleText: async (h, text) => {
        const w = await h.createWritable();
        await w.write(text);
        await w.close();
      },
      fetchProfile,
      getLocalPdc: () => problemDescriptionCleanupExport(),
      mergePdc: problemDescriptionCleanupMergeForPublish,
    });
  } catch (_) {
    // Silent by contract — see pdc-contribute.js's runPdcContribution header.
  }
})();
