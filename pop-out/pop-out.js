// Medicus Suite — Pop-out window controller

'use strict';

import { createModuleLoader } from '../side-panel/module-loader.js';
import { initTour } from '../side-panel/tour/tour.js';
import { initPalette } from '../side-panel/palette/palette.js';
import { sanitiseHiddenTabs } from '../side-panel/tab-catalog.js';
import { TAB_HELP } from '../shared/tab-help.js';

const content = document.getElementById('popoutContent');
const settingsBtn = document.getElementById('popoutSettingsBtn');
let activeModule = null;
let moduleCleanup = null;
let switchSeq = 0;

// ── Module registry (mirrors panel.js; no WR/RM strips — they stay in the docked panel) ──

const MODULES = {
  today: { js: () => import('../side-panel/modules/today/today.js'), css: '../side-panel/modules/today/today.css' },
  slots: { js: () => import('../side-panel/modules/slots/slots.js'), css: '../side-panel/modules/slots/slots.css' },
  capacity: {
    js: () => import('../side-panel/modules/capacity/capacity.js'),
    css: '../side-panel/modules/capacity/capacity.css',
  },
  submissions: {
    js: () => import('../side-panel/modules/submissions/submissions.js'),
    css: '../side-panel/modules/submissions/submissions.css',
  },
  sentinel: {
    js: () => import('../side-panel/modules/sentinel/sentinel.js'),
    css: '../side-panel/modules/sentinel/sentinel.css',
  },
  activity: {
    js: () => import('../side-panel/modules/activity/activity.js'),
    css: '../side-panel/modules/activity/activity.css',
  },
  referrals: {
    js: () => import('../side-panel/modules/referrals/referrals.js'),
    css: '../side-panel/modules/referrals/referrals.css',
  },
  condor: {
    js: () => import('../side-panel/modules/condor/condor.js'),
    css: '../side-panel/modules/condor/condor.css',
  },
  trends: {
    js: () => import('../side-panel/modules/trends/trends.js'),
    css: '../side-panel/modules/trends/trends.css',
  },
  reception: {
    js: () => import('../side-panel/modules/reception/reception.js'),
    css: '../side-panel/modules/reception/reception.css',
  },
  sweep: { js: () => import('../side-panel/modules/sweep/sweep.js'), css: '../side-panel/modules/sweep/sweep.css' },
  knowledge: {
    js: () => import('../side-panel/modules/knowledge/knowledge.js'),
    css: '../side-panel/modules/knowledge/knowledge.css',
  },
  leaflets: {
    js: () => import('../side-panel/modules/leaflets/leaflets.js'),
    css: '../side-panel/modules/leaflets/leaflets.css',
  },
  record: {
    js: () => import('../side-panel/modules/record/record.js'),
    css: '../side-panel/modules/record/record.css',
  },
};

// ── Per-tab help registry ──────────────────────────────────────────────────────
// TAB_HELP content lives in shared/tab-help.js — ONE source consumed by both
// this file and panel.js (was previously duplicated per shell; converged so a
// tab description can't drift between panel and pop-out).

function _helpEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Help popover (per-tab "what is this?" affordance) ──────────────────────────
let helpOpen = false;
let _helpCloseHandler = null;

function buildHelpPopoverHTML() {
  const h = TAB_HELP[activeModule];
  if (!h) {
    return `<div class="help-popover" id="helpPopover" role="dialog" aria-label="Tab help">
      <div class="help-popover-title">Help</div>
      <div class="help-popover-row"><span class="help-popover-text">No help is available for this tab yet.</span></div>
    </div>`;
  }
  return `<div class="help-popover" id="helpPopover" role="dialog" aria-label="Help: ${_helpEsc(h.title)}">
    <div class="help-popover-title">${_helpEsc(h.title)}</div>
    <div class="help-popover-row">
      <span class="help-popover-lbl">What this is</span>
      <span class="help-popover-text">${_helpEsc(h.what)}</span>
    </div>
    <div class="help-popover-row">
      <span class="help-popover-lbl">Do this first</span>
      <span class="help-popover-text">${_helpEsc(h.firstStep)}</span>
    </div>
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

// ── Slots badge ───────────────────────────────────────────────────────────────

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

// ── CSS loader ────────────────────────────────────────────────────────────────

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
    if (mod === activeModule) return;
    switchModule(mod);
  });
});

// ── Drag-and-drop tab reordering ──────────────────────────────────────────────
// Shares the global suite.tabOrder key with the panel; reconciled against the
// pop-out's own tab set (so panel-only tabs like visualiser are simply ignored).

(async () => {
  const { reconcileTabOrder, STORAGE_KEY } = await import('../side-panel/tab-order.js');
  const tabsEl = document.getElementById('popoutTabs');
  if (!tabsEl) return;

  const tabIds = () => [...tabsEl.querySelectorAll('.nav-tab')].map((t) => t.dataset.module);

  function applyOrder(stored) {
    const order = reconcileTabOrder(tabIds(), stored);
    order.forEach((id) => {
      const el = tabsEl.querySelector(`.nav-tab[data-module="${id}"]`);
      if (el) tabsEl.appendChild(el);
    });
  }

  const r = await chrome.storage.local.get(STORAGE_KEY);
  applyOrder(r[STORAGE_KEY]);

  chrome.storage.onChanged.addListener((changes) => {
    if (changes[STORAGE_KEY]) applyOrder(changes[STORAGE_KEY].newValue);
  });

  let dragSrc = null;

  tabsEl.querySelectorAll('.nav-tab').forEach(makeDraggable);

  function makeDraggable(tab) {
    tab.setAttribute('draggable', 'true');
    tab.title = tab.title || 'Drag to reorder';

    tab.addEventListener('dragstart', (e) => {
      dragSrc = tab;
      tab.classList.add('nav-tab-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', tab.dataset.module);
      } catch (_) {}
    });

    tab.addEventListener('dragend', () => {
      tab.dataset.dragged = '1';
      setTimeout(() => {
        delete tab.dataset.dragged;
      }, 0);
      tab.classList.remove('nav-tab-dragging');
      tabsEl
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
      tabsEl
        .querySelectorAll('.nav-tab-drop-before, .nav-tab-drop-after')
        .forEach((t) => t.classList.remove('nav-tab-drop-before', 'nav-tab-drop-after'));
      tab.classList.add(after ? 'nav-tab-drop-after' : 'nav-tab-drop-before');
    });

    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragSrc || dragSrc === tab) return;
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      tabsEl.insertBefore(dragSrc, after ? tab.nextSibling : tab);
      chrome.storage.local.set({ [STORAGE_KEY]: tabIds() });
    });
  }
})();

settingsBtn?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

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
  onPersist: (name) => {
    chrome.storage.local.set({ 'popout.activeModule': name });
  },
  errPrefix: 'Failed to load',
});

// Tab visibility — same user-owned suite.hiddenTabs set as the side panel.
function applyTabVisibility(raw) {
  const hidden = new Set(sanitiseHiddenTabs(raw));
  document.querySelectorAll('.nav-tab').forEach((t) => {
    t.classList.toggle('nav-tab-hidden', hidden.has(t.dataset.module));
  });
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes['suite.hiddenTabs']) applyTabVisibility(changes['suite.hiddenTabs'].newValue);
});

// Guided tour: replay-only in the pop-out (auto-start is the side panel's
// job). Module-scoped steps switch tabs via this window's loader; steps whose
// anchors don't exist here (e.g. panel-only tabs) skip silently.
initTour({ activateModule: (name) => switchModule(name), getActiveModule: () => activeModule });

// Command palette (Ctrl+K) — same engine as the side panel; nav commands are
// built from this window's own tabs.
initPalette();

// Per-tab help button (mirrors the side panel).
wireHelpButton();

// ── Service worker messages ───────────────────────────────────────────────────

// F5: Sender guard — only accept messages from intra-extension contexts.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender || sender.id !== chrome.runtime.id) return;
  // slots needs the relay because the slots module listens for a DOM CustomEvent
  // (not the chrome.runtime message). Other modules (e.g. sentinel) register their
  // own chrome.runtime.onMessage listener in init(), so they receive
  // waiting:refresh / sentinel:snapshot-updated directly in the pop-out too.
  if (msg?.type === 'slots:refresh' && activeModule === 'slots') {
    document.dispatchEvent(new CustomEvent('suite:slots:refresh'));
  }
});

// ── Quiet pill ────────────────────────────────────────────────────────────────
// Mirrors the panel's quiet pill: amber indicator + click-to-clear.

const _popoutQuietPillEl = document.getElementById('quietPill');

function _popoutFmtHHMM(epochMs) {
  const d = new Date(epochMs);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

async function _updatePopoutQuietPill() {
  if (!_popoutQuietPillEl) return;
  try {
    const r = await chrome.storage.local.get('suite.quietUntil');
    const until = r['suite.quietUntil'];
    const isActive = until && typeof until === 'number' && until > Date.now();
    if (isActive) {
      const hhmm = _popoutFmtHHMM(until);
      _popoutQuietPillEl.textContent = `🔕 ${hhmm}`;
      _popoutQuietPillEl.title = `Clinic mode — desktop pop-ups and sounds muted until ${hhmm}. Click to switch off.`;
      _popoutQuietPillEl.classList.remove('quiet-pill-hidden');
    } else {
      _popoutQuietPillEl.classList.add('quiet-pill-hidden');
      _popoutQuietPillEl.title = '';
    }
  } catch (_) {}
}

_popoutQuietPillEl?.addEventListener('click', () => {
  window.QuietMode?.clear();
});

setInterval(_updatePopoutQuietPill, 30 * 1000);

chrome.storage.onChanged.addListener((changes) => {
  if ('suite.quietUntil' in changes) _updatePopoutQuietPill();
});

_updatePopoutQuietPill();

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  // Display preferences are applied by shared/display-prefs.js (loaded before this script).
  const r = await chrome.storage.local.get('popout.activeModule');
  // Guard against a stale module name persisted by an older version (mirrors
  // the panel boot's validation) — an unknown name would blank the content area.
  const saved = r['popout.activeModule'];
  const rh = await chrome.storage.local.get('suite.hiddenTabs');
  applyTabVisibility(rh['suite.hiddenTabs']);
  const hiddenSet = new Set(sanitiseHiddenTabs(rh['suite.hiddenTabs']));
  const usable = (m) => m && m in MODULES && MODULES[m] && !hiddenSet.has(m);
  let startMod = usable(saved) ? saved : usable('today') ? 'today' : null;
  if (!startMod) {
    for (const t of document.querySelectorAll('.nav-tab')) {
      if (usable(t.dataset.module)) {
        startMod = t.dataset.module;
        break;
      }
    }
  }
  switchModule(startMod || 'today');
})();
