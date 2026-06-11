// Medicus Suite — Pop-out window controller

'use strict';

const content    = document.getElementById('popoutContent');
const settingsBtn = document.getElementById('popoutSettingsBtn');
let activeModule  = null;
let moduleCleanup = null;
let switchSeq     = 0;

// ── Module registry (mirrors panel.js; no WR/RM strips — they stay in the docked panel) ──

const MODULES = {
  slots:       { js: () => import('../side-panel/modules/slots/slots.js'),           css: '../side-panel/modules/slots/slots.css' },
  capacity:    { js: () => import('../side-panel/modules/capacity/capacity.js'),      css: '../side-panel/modules/capacity/capacity.css' },
  submissions: { js: () => import('../side-panel/modules/submissions/submissions.js'), css: '../side-panel/modules/submissions/submissions.css' },
  sentinel:    { js: () => import('../side-panel/modules/sentinel/sentinel.js'),      css: '../side-panel/modules/sentinel/sentinel.css' },
  activity:    { js: () => import('../side-panel/modules/activity/activity.js'),     css: '../side-panel/modules/activity/activity.css' },
  referrals:   { js: () => import('../side-panel/modules/referrals/referrals.js'),   css: '../side-panel/modules/referrals/referrals.css' },
  condor:      { js: () => import('../side-panel/modules/condor/condor.js'),         css: '../side-panel/modules/condor/condor.css' },
  trends:      { js: () => import('../side-panel/modules/trends/trends.js'),         css: '../side-panel/modules/trends/trends.css' },
  reception:   { js: () => import('../side-panel/modules/reception/reception.js'),   css: '../side-panel/modules/reception/reception.css' },
  sweep:       { js: () => import('../side-panel/modules/sweep/sweep.js'),           css: '../side-panel/modules/sweep/sweep.css' },
  knowledge:   { js: () => import('../side-panel/modules/knowledge/knowledge.js'),   css: '../side-panel/modules/knowledge/knowledge.css' },
};

// ── Slots badge ───────────────────────────────────────────────────────────────

document.addEventListener('suite:slots:count', e => {
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
  badge.style.display = (n != null && n >= 0) ? '' : 'none';
});

// ── CSS loader ────────────────────────────────────────────────────────────────

const loadedCss = new Set();
function ensureModuleCss(cssPath) {
  if (!cssPath || loadedCss.has(cssPath)) return;
  loadedCss.add(cssPath);
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = cssPath;
  document.head.appendChild(link);
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // A drag that ends on the same tab still fires a click; suppress it so a
    // reorder doesn't also switch module.
    if (tab.dataset.dragged === '1') { delete tab.dataset.dragged; return; }
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

  const tabIds = () =>
    [...tabsEl.querySelectorAll('.nav-tab')].map(t => t.dataset.module);

  function applyOrder(stored) {
    const order = reconcileTabOrder(tabIds(), stored);
    order.forEach(id => {
      const el = tabsEl.querySelector(`.nav-tab[data-module="${id}"]`);
      if (el) tabsEl.appendChild(el);
    });
  }

  const r = await chrome.storage.local.get(STORAGE_KEY);
  applyOrder(r[STORAGE_KEY]);

  chrome.storage.onChanged.addListener(changes => {
    if (changes[STORAGE_KEY]) applyOrder(changes[STORAGE_KEY].newValue);
  });

  let dragSrc = null;

  tabsEl.querySelectorAll('.nav-tab').forEach(makeDraggable);

  function makeDraggable(tab) {
    tab.setAttribute('draggable', 'true');
    tab.title = tab.title || 'Drag to reorder';

    tab.addEventListener('dragstart', e => {
      dragSrc = tab;
      tab.classList.add('nav-tab-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', tab.dataset.module); } catch (_) {}
    });

    tab.addEventListener('dragend', () => {
      tab.dataset.dragged = '1';
      setTimeout(() => { delete tab.dataset.dragged; }, 0);
      tab.classList.remove('nav-tab-dragging');
      tabsEl.querySelectorAll('.nav-tab-drop-before, .nav-tab-drop-after')
        .forEach(t => t.classList.remove('nav-tab-drop-before', 'nav-tab-drop-after'));
      dragSrc = null;
    });

    tab.addEventListener('dragover', e => {
      if (!dragSrc || dragSrc === tab) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = tab.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      tabsEl.querySelectorAll('.nav-tab-drop-before, .nav-tab-drop-after')
        .forEach(t => t.classList.remove('nav-tab-drop-before', 'nav-tab-drop-after'));
      tab.classList.add(after ? 'nav-tab-drop-after' : 'nav-tab-drop-before');
    });

    tab.addEventListener('drop', e => {
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

async function switchModule(name) {
  // Sequence guard (mirrors panel.js): if the user switches tabs again before an
  // earlier init() finishes, the stale chain must not leak its timers/listeners
  // or overwrite the newer module's cleanup. Each switch claims a sequence number
  // and bails (cleaning up) if a newer switch has superseded it.
  const mySeq = ++switchSeq;

  const prevCleanup = moduleCleanup;
  moduleCleanup = null;
  if (prevCleanup) { try { prevCleanup(); } catch (_) {} }

  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.module === name)
  );
  activeModule = name;
  content.innerHTML = '';

  // Persist active module for this popout
  chrome.storage.local.set({ 'popout.activeModule': name });

  const entry = MODULES[name];
  if (!entry) return;

  ensureModuleCss(entry.css);

  try {
    const mod = await entry.js();
    if (mySeq !== switchSeq) return;
    if (mod.init) {
      const cleanup = await mod.init(content);
      if (mySeq !== switchSeq) {
        if (typeof cleanup === 'function') try { cleanup(); } catch (_) {}
        return;
      }
      moduleCleanup = cleanup;
    }
  } catch (err) {
    if (mySeq !== switchSeq) return;
    content.innerHTML = `<div class="module-wrap"><div class="banner">Failed to load: ${err.message}</div></div>`;
  }
}

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

// ── Boot ──────────────────────────────────────────────────────────────────────

(async () => {
  // Apply display preferences so pop-out matches the main panel's theme/size
  function applyDisplayPrefs(prefs) {
    prefs = prefs || {};
    document.documentElement.setAttribute('data-theme',      prefs.theme      || 'light');
    document.documentElement.setAttribute('data-size',       prefs.size       || 'medium');
    document.documentElement.setAttribute('data-colorblind', String(!!prefs.colorblind));
  }
  const dp = await chrome.storage.local.get('suite.display');
  applyDisplayPrefs(dp['suite.display'] || {});
  chrome.storage.onChanged.addListener(changes => {
    if (changes['suite.display']) applyDisplayPrefs(changes['suite.display'].newValue || {});
  });

  const r = await chrome.storage.local.get('popout.activeModule');
  const startMod = r['popout.activeModule'] || 'slots';
  switchModule(startMod);
})();
