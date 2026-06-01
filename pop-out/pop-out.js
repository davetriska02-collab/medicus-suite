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
    const mod = tab.dataset.module;
    if (mod === activeModule) return;
    switchModule(mod);
  });
});

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

chrome.runtime.onMessage.addListener(msg => {
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
