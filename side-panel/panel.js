// Medicus Suite — Side Panel Controller

'use strict';

import { createModuleLoader } from './module-loader.js';
import { DEFAULT_SUB_THRESHOLDS, ragLevel } from './modules/submissions/submissions-core.js';
import { initTour, maybeAutoStartTour } from './tour/tour.js';
import { initPalette } from './palette/palette.js';
import { sanitiseHiddenTabs } from './tab-catalog.js';
import { initSetup } from './setup/setup.js';

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

// ── Module registry ───────────────────────────────────────────────────────────

const MODULES = {
  today: { js: () => import('./modules/today/today.js'), css: './modules/today/today.css' },
  slots: { js: () => import('./modules/slots/slots.js'), css: './modules/slots/slots.css' },
  capacity: { js: () => import('./modules/capacity/capacity.js'), css: './modules/capacity/capacity.css' },
  submissions: {
    js: () => import('./modules/submissions/submissions.js'),
    css: './modules/submissions/submissions.css',
  },
  sentinel: { js: () => import('./modules/sentinel/sentinel.js'), css: './modules/sentinel/sentinel.css' },
  activity: { js: () => import('./modules/activity/activity.js'), css: './modules/activity/activity.css' },
  referrals: { js: () => import('./modules/referrals/referrals.js'), css: './modules/referrals/referrals.css' },
  condor: { js: () => import('./modules/condor/condor.js'), css: './modules/condor/condor.css' },
  trends: { js: () => import('./modules/trends/trends.js'), css: './modules/trends/trends.css' },
  reception: { js: () => import('./modules/reception/reception.js'), css: './modules/reception/reception.css' },
  sweep: { js: () => import('./modules/sweep/sweep.js'), css: './modules/sweep/sweep.css' },
  knowledge: { js: () => import('./modules/knowledge/knowledge.js'), css: './modules/knowledge/knowledge.css' },
  about: null,
};

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

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'popout:closed') updatePopoutBtn();
});

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

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Today</span>
          <span class="module-card-version">v1.0</span>
        </div>
        <div class="module-card-desc">
          Morning command centre: waiting room, triage load, demand counts, available slots and
          the pre-clinic sweep — one screen answers "what does today look like?" before clinic starts.
        </div>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Slot Counter</span>
          <span class="module-card-version">v2.2</span>
        </div>
        <div class="module-card-desc">
          Available appointment slots by type for any date. API-based; no scheduling page required.
          Updates live via Pusher when a Medicus tab is open.
        </div>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Submissions Tracker</span>
          <span class="module-card-version">v1.0</span>
        </div>
        <div class="module-card-desc">
          Daily inbound task counts across medical, admin, investigation and prescription categories.
          Today view, date range, day-vs-day comparison.
        </div>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Triage Lens</span>
          <span class="module-card-version">v0.5.0</span>
        </div>
        <div class="module-card-desc">
          In-page overlay on Medicus patient records and triage queues.
          User-defined keyword rules with severity chips. Runs as a content script.
        </div>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Monitoring (Sentinel)</span>
          <span class="module-card-version">v0.5.1</span>
        </div>
        <div class="module-card-desc">
          Clinical context sidebar on patient records. Drug monitoring and QOF 25/26 indicators.
          Runs as a content script; requires a patient page to be open.
        </div>
        <div class="purpose-box">
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
        <a class="disclaimer-link" href="../docs/sentinel-DISCLAIMER.txt" target="_blank">View DISCLAIMER ↗</a>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Activity Report</span>
          <span class="module-card-version">v1.0</span>
        </div>
        <div class="module-card-desc">
          Practice activity per staff member across a configurable date range. Shows period totals
          and a stacked horizontal bar chart broken down by consultations, prescription requests,
          medication reviews, document tasks, and investigation results. API-based.
        </div>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Referrals Tracker</span>
          <span class="module-card-version">v1.0</span>
        </div>
        <div class="module-card-desc">
          Referral audit data across a configurable date range. Shows total referral count with
          priority (Routine / Urgent / 2WW) and status breakdowns, plus horizontal bar charts
          by referring clinician, specialty, and hospital. Fetches from the Medicus
          clinical-audit-report endpoint. API-based.
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

chrome.runtime.onMessage.addListener((msg, sender) => {
  // F5: Only accept messages from this extension's own contexts.
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'slots:refresh' && activeModule === 'slots') {
    document.dispatchEvent(new CustomEvent('suite:slots:refresh'));
  }
});

// ── Alert roll-up (groups elevated demand strips into one summary bar) ────────
// Three strips (#wrStrip, #rmStrip, #subRagStrip) each render independently below
// the nav. When two or more are in an ELEVATED (amber/red) state they stack and
// compete for the same scarce vertical space, so a single severity-ordered roll-up
// bar replaces the stack: one line at max severity with a pill per elevated channel,
// expandable (chevron) to the full strips for detail. Each strip's own poller is
// untouched — it still renders its own DOM; it just reports its resulting level here
// via reportAlert(), and the roll-up reads that shared bus. Red auto-expands.
//
// CLINICAL SAFETY: grouping only collapses the *presentation* of strips that are
// already showing; nothing is hidden that wasn't on screen, and the roll-up itself
// carries the max severity. Green/calm states are never "elevated", so the roll-up
// only ever appears when there is genuinely more than one elevated signal.
const alertRollupEl = document.getElementById('alertRollup');
const alertStackEl = document.getElementById('alertStack');
const alertBus = { waiting: null, triage: null, demand: null };
let _rollupExpanded = null; // null = use default (red→open, amber→closed); else user choice

const ALERT_CHANNELS = ['waiting', 'triage', 'demand'];

function reportAlert(channel, state) {
  // state = { level: 'green'|'amber'|'red', label, count } or null when inactive.
  alertBus[channel] = state;
  renderRollup();
}

function renderRollup() {
  if (!alertRollupEl || !alertStackEl) return;
  const elevated = ALERT_CHANNELS.map((k) => alertBus[k]).filter(
    (a) => a && (a.level === 'amber' || a.level === 'red')
  );

  if (elevated.length < 2) {
    // Nothing to group — restore the normal stacked strips, roll-up hidden.
    alertRollupEl.className = 'alert-rollup alert-rollup-hidden';
    alertRollupEl.innerHTML = '';
    alertStackEl.style.display = '';
    _rollupExpanded = null;
    return;
  }

  const hasRed = elevated.some((a) => a.level === 'red');
  const maxLevel = hasRed ? 'red' : 'amber';
  if (_rollupExpanded === null) _rollupExpanded = hasRed; // red opens by default

  const pills = elevated
    .map(
      (a) =>
        `<span class="pill pill--${a.level}"><span class="pill-dot"></span><span class="pill-name">${escStrip(
          a.label
        )}</span>${a.count != null ? `<span class="pill-count">${a.count}</span>` : ''}${
          a.meta ? `<span class="pill-meta">${escStrip(a.meta)}</span>` : ''
        }</span>`
    )
    .join('');

  alertRollupEl.className = `alert-rollup alert-rollup--${maxLevel}`;
  alertRollupEl.setAttribute('aria-expanded', String(_rollupExpanded));
  alertRollupEl.innerHTML = `
    <span class="alert-rollup-icon">${maxLevel === 'red' ? '🔴' : '⚠'}</span>
    <span class="alert-rollup-count">${elevated.length} alerts</span>
    <span class="alert-rollup-pills">${pills}</span>
    <button class="alert-rollup-toggle">${_rollupExpanded ? 'Hide' : 'Details'}<span class="alert-rollup-chev">${
      _rollupExpanded ? '▾' : '▸'
    }</span></button>
  `;
  alertStackEl.style.display = _rollupExpanded ? '' : 'none';
}

// Toggle expand/collapse on click anywhere in the roll-up bar.
alertRollupEl?.addEventListener('click', () => {
  _rollupExpanded = !_rollupExpanded;
  renderRollup();
});

// ── Waiting Room strip (global — visible on every module) ─────────────────────

let SITE_ID_WR = null;
let WR_API = null;
const WR_POLL_MS = 30 * 1000;
const wrStripEl = document.getElementById('wrStrip');

let wrPoller = null;

async function fetchAndRenderStrip(bypassCache = false) {
  if (document.visibilityState !== 'visible') return true;
  // Resolve practice code on every call so user changes take effect immediately
  const { code, source } = await window.PracticeCode.resolve();
  SITE_ID_WR = code;
  if (!SITE_ID_WR) {
    // No practice code set — hide strip silently. User will see the prompt in Options.
    if (wrStripEl) {
      wrStripEl.className = 'wr-strip wr-strip-hidden';
      wrStripEl.innerHTML = '';
    }
    return true;
  }
  WR_API = `https://${SITE_ID_WR}.api.england.medicus.health/scheduling/data/homepage/my-appointments`;
  try {
    const r = await window.ApiDiag.fetch({
      module: 'panel-wr-strip',
      url: WR_API,
      code: SITE_ID_WR,
      codeSource: source,
    });
    const raw = await r.json();
    const arrived = (raw?.schedule?.schedule ?? [])
      .flatMap((d) => d.entries ?? [])
      .filter((e) => e?.diaryEntryType?.value === 'appointment' && e?.displayStatus?.value === 'arrived')
      .map((e) => ({
        name: e.patient?.name ?? 'Unknown',
        start: e.start ?? '',
        startDateTime: e.startDateTime ?? null,
        minutesWaiting: calcStripWait(e.startDateTime),
      }))
      .sort((a, b) => (a.start < b.start ? -1 : 1));

    renderStrip(arrived);
    updateStripBadge(arrived.length);
    return true;
  } catch (_) {
    // Network error or no Medicus session — keep strip hidden, don't spam console
    return false;
  }
}

function calcStripWait(dt) {
  if (!dt) return null;
  const ms = new Date(dt).getTime();
  if (isNaN(ms)) return null;
  const m = Math.round((Date.now() - ms) / 60000);
  return m > 0 ? m : 0;
}

function renderStrip(patients) {
  if (!wrStripEl) return;
  if (patients.length === 0) {
    wrStripEl.className = 'wr-strip wr-strip-hidden';
    wrStripEl.innerHTML = '';
    reportAlert('waiting', null);
    return;
  }

  const maxWait = Math.max(...patients.map((p) => p.minutesWaiting ?? 0));
  const urgency = maxWait >= 20 ? 'red' : maxWait >= 10 ? 'amber' : 'green';

  // Build name chips — show up to 3, then "+N more"
  const shown = patients.slice(0, 3);
  const extra = patients.length - shown.length;
  const chips = shown
    .map((p) => {
      const mins = p.minutesWaiting;
      const cls =
        mins != null && mins >= 20 ? 'wr-chip-red' : mins != null && mins >= 10 ? 'wr-chip-amber' : 'wr-chip-ok';
      const wait = mins != null ? ` · ${mins}m` : '';
      return `<span class="wr-chip ${cls}">${escStrip(p.name)}${wait}</span>`;
    })
    .join('');
  const extraChip = extra > 0 ? `<span class="wr-chip wr-chip-more">+${extra} more</span>` : '';

  wrStripEl.className = `wr-strip wr-strip-${urgency}`;
  wrStripEl.innerHTML = `
    <span class="wr-strip-icon">🚶</span>
    <span class="wr-strip-count">${patients.length} waiting</span>
    <span class="wr-strip-chips">${chips}${extraChip}</span>
    <button class="wr-strip-goto" title="Go to Monitoring">Monitoring →</button>
  `;

  wrStripEl.querySelector('.wr-strip-goto')?.addEventListener('click', () => {
    switchModule('sentinel');
    document.querySelector('[data-module="sentinel"]')?.scrollIntoView({ behavior: 'smooth', inline: 'nearest' });
  });

  reportAlert('waiting', {
    level: urgency,
    label: 'Waiting',
    count: patients.length,
    // F4: surface the worst single wait on the collapsed pill so proximity-to-breach
    // isn't hidden behind DETAILS (a 12m and a 55m wait must not look identical).
    meta: maxWait > 0 ? maxWait + 'm' : null,
  });
}

// ── Badge-enabled cache ───────────────────────────────────────────────────────
// Cached to avoid a storage round-trip on every WR poll. Seeded on load,
// kept current via onChanged. Default true (safe: badge shows if pref unknown).
let _badgeEnabled = true;
chrome.storage.local.get('suite.notifications').then((r) => {
  const prefs = r['suite.notifications'] || {};
  _badgeEnabled = prefs.badgeEnabled !== false;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes['suite.notifications']) {
    const prefs = changes['suite.notifications'].newValue || {};
    _badgeEnabled = prefs.badgeEnabled !== false;
    // Clear a stale count immediately on disable rather than waiting for the
    // next waiting-room poll (≤30s) to notice.
    if (!_badgeEnabled) chrome.action.setBadgeText({ text: '' });
  }
});

function updateStripBadge(count) {
  // Respect suite.notifications.badgeEnabled — if disabled, always clear the badge.
  if (!_badgeEnabled || count <= 0) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  }
}

// ── Alert log helper ──────────────────────────────────────────────────────────
// Prepend entry to suite.alertLog (capped at 50). Never stores patient names —
// counts/labels only. Safe to call from any panel context.
async function appendAlertLog(entry) {
  try {
    const r = await chrome.storage.local.get('suite.alertLog');
    const log = Array.isArray(r['suite.alertLog']) ? r['suite.alertLog'] : [];
    log.unshift(entry);
    if (log.length > 50) log.length = 50;
    await chrome.storage.local.set({ 'suite.alertLog': log });
  } catch (_) {}
}

// ── Quiet pill ────────────────────────────────────────────────────────────────
// Shows an amber pill in the nav when clinic (quiet) mode is active.
// Polls every 30s and reacts to storage changes. Click clears quiet mode.

const _quietPillEl = document.getElementById('quietPill');

function _fmtHHMM(epochMs) {
  const d = new Date(epochMs);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

async function _updateQuietPill() {
  if (!_quietPillEl) return;
  try {
    const r = await chrome.storage.local.get('suite.quietUntil');
    const until = r['suite.quietUntil'];
    const isActive = until && typeof until === 'number' && until > Date.now();
    if (isActive) {
      const hhmm = _fmtHHMM(until);
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

// Poll every 30s for expiry
setInterval(_updateQuietPill, 30 * 1000);

// React immediately to storage changes
chrome.storage.onChanged.addListener((changes) => {
  if ('suite.quietUntil' in changes) _updateQuietPill();
});

// Initial render
_updateQuietPill();

function escStrip(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Failure-backoff poller ────────────────────────────────────────────────────
// makePoller(fn, baseMs, label) → { start(overrideMs?), stop() }
//
// Runs fn() on a self-scheduling setTimeout chain.  fn() should return true
// (or any truthy value) on success and false on a network/API failure.
// Consecutive failures double the interval (capped at 8× base); a single
// success resets to base.  console.warn fires once per new escalation level.
//
// start(overrideMs) can be called while a tick is in progress (e.g. the RM
// strip restarts itself on config change) — a _scheduledByStart flag prevents
// the in-progress tick from stacking a second setTimeout on top.

function makePoller(fn, baseMs, label) {
  let _timer = null;
  let _failCount = 0;
  let _currentBaseMs = baseMs;
  let _startedDuring = false; // set if start() called while tick is running

  function _schedule(delayMs) {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(_tick, delayMs);
  }

  async function _tick() {
    _timer = null;
    _startedDuring = false;
    const ok = await fn();
    if (_startedDuring) return; // start() rescheduled us already — don't double-schedule
    if (ok === false) {
      _failCount++;
      const level = Math.min(_failCount, 3); // 2^3 = 8 → cap at 8×
      const delay = _currentBaseMs * Math.pow(2, level);
      console.warn(`[${label}] poll failure #${_failCount}, backing off to ${delay}ms`);
      _schedule(delay);
    } else {
      _failCount = 0;
      _schedule(_currentBaseMs);
    }
  }

  return {
    start(overrideMs) {
      _startedDuring = true; // suppress any in-progress tick's post-schedule
      if (overrideMs != null) _currentBaseMs = overrideMs;
      _failCount = 0;
      _schedule(0); // fire first tick immediately
      return this;
    },
    stop() {
      _startedDuring = true;
      if (_timer) {
        clearTimeout(_timer);
        _timer = null;
      }
    },
  };
}

// Listen for Pusher-triggered refresh from service worker
// F5: Sender guard — only accept messages from intra-extension contexts.
// Light coalescing: fetchAndRenderStrip / fetchAndRenderRmStrip are already
// guarded by document.visibilityState and their own fetch-in-flight logic,
// so duplicate refreshes within the same tick are absorbed naturally.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'waiting:refresh') fetchAndRenderStrip(true);
  if (msg?.type === 'requestMonitor:refresh') fetchAndRenderRmStrip();
});

// Boot the strip — initial fetch + self-scheduling poll with failure backoff
wrPoller = makePoller(fetchAndRenderStrip, WR_POLL_MS, 'wr-strip').start();

// ── Request Monitor strip (v1.3) ─────────────────────────────────────────────
// Sits below the waiting room strip. Hidden entirely unless toggled on in
// Options AND a team UUID is configured. Pills show counts for the four
// buckets; clicking a pill opens the filtered task list in a new tab.

const rmStripEl = document.getElementById('rmStrip');
let rmPoller = null;
let rmPollSeconds = 60;

async function fetchAndRenderRmStrip() {
  if (document.visibilityState !== 'visible') return true;
  if (!rmStripEl || !window.RequestMonitor) return true;

  const cfg = await window.RequestMonitor.getConfig();
  if (!cfg.enabled || !cfg.assigneeId) {
    rmStripEl.className = 'rm-strip rm-strip-hidden';
    rmStripEl.innerHTML = '';
    reportAlert('triage', null);
    return true;
  }
  // Adjust poll interval if config changed — restart the poller at the new interval
  if (cfg.pollSeconds && cfg.pollSeconds * 1000 !== rmPollSeconds * 1000) {
    rmPollSeconds = cfg.pollSeconds;
    if (rmPoller) rmPoller.start(rmPollSeconds * 1000);
  }

  const { code, source } = await window.PracticeCode.resolve();
  if (!code) {
    rmStripEl.className = 'rm-strip';
    rmStripEl.innerHTML = `<span class="rm-strip-icon">⚠</span><span class="rm-strip-label">Triage:</span><span class="rm-strip-error">No practice code</span>`;
    reportAlert('triage', null);
    return true;
  }

  // Direct fetch via API diag so failures show up in the Debug panel
  let result;
  try {
    result = await window.RequestMonitor.pollAll(code, cfg.assigneeId, {
      fetch: (url, init) => window.ApiDiag.fetch({ module: 'request-monitor', url, code, codeSource: source, init }),
    });
  } catch (e) {
    rmStripEl.className = 'rm-strip';
    rmStripEl.innerHTML = `<span class="rm-strip-icon">⚠</span><span class="rm-strip-label">Triage:</span><span class="rm-strip-error">${escStrip(e.message)}</span>`;
    reportAlert('triage', null);
    return false;
  }

  renderRmStrip(result, code, cfg.assigneeId);
  applyTriageAlerts(result.buckets);
  return true;
}

function renderRmStrip(result, practiceCode, assigneeId) {
  if (!rmStripEl) return;
  const buckets = window.RequestMonitor.BUCKETS;
  const pills = buckets
    .map((b) => {
      const data = result.buckets?.[b.key];
      const count = data?.count ?? 0;
      const isReply = b.status === 'reply-received';
      const cls = ['rm-pill', isReply ? 'rm-pill-reply' : 'rm-pill-new', count > 0 ? 'rm-pill-active' : '']
        .filter(Boolean)
        .join(' ');
      const clickUrl = window.RequestMonitor.buildClickUrl(practiceCode, b.taskType, b.status, assigneeId);
      return `<span class="${cls}" data-rm-url="${escStrip(clickUrl)}" title="${escStrip(b.label)}">
      <span class="rm-pill-label">${escStrip(b.short)}</span>
      <span class="rm-pill-count">${count}</span>
    </span>`;
    })
    .join('');

  const errorBlock = result.error ? `<span class="rm-strip-error">${escStrip(result.error)}</span>` : '';

  rmStripEl.className = 'rm-strip';
  rmStripEl.innerHTML = `
    <span class="rm-strip-icon">📋</span>
    <span class="rm-strip-label">Triage:</span>
    ${pills}
    ${errorBlock}
  `;

  // Wire click handlers
  rmStripEl.querySelectorAll('.rm-pill[data-rm-url]').forEach((el) => {
    el.addEventListener('click', () => {
      const url = el.dataset.rmUrl;
      if (url) chrome.tabs.create({ url });
    });
  });
}

// ── Triage capacity alerts ────────────────────────────────────────────────────

const _triageAlertedBuckets = new Map(); // key → last alerted count (session memory)

async function applyTriageAlerts(buckets) {
  if (!rmStripEl || !window.TriageAlertEngine || !window.TriageAlertIO) return;
  const rules = await window.TriageAlertIO.getRules();
  const { triggered, maxLevel } = window.TriageAlertEngine.evaluate(buckets, rules);

  // Update strip class
  rmStripEl.classList.remove('rm-strip-alerted-amber', 'rm-strip-alerted-red');
  if (maxLevel) rmStripEl.classList.add(`rm-strip-alerted-${maxLevel}`);

  // Feed the alert roll-up: triage counts as elevated only when a threshold is
  // crossed (calm pill counts aren't an alert). Count = buckets over threshold.
  // F1: report the total flagged TASK count (sum across over-threshold buckets),
  // not the bucket count — so the collapsed pill reconciles with the expanded strip.
  const triageTasks = triggered.reduce((sum, t) => sum + (t.count || 0), 0);
  reportAlert('triage', maxLevel ? { level: maxLevel, label: 'Triage', count: triageTasks } : null);

  // Desktop notifications — once per threshold crossing per session
  const quietNow = (await window.QuietMode?.isQuiet?.()) ?? false;
  for (const t of triggered) {
    const prev = _triageAlertedBuckets.get(t.key);
    const crossed = prev === undefined || (prev < t.threshold && t.count >= t.threshold);
    if (crossed) {
      _triageAlertedBuckets.set(t.key, t.count);
      // Always append to alert log (even when quiet) — counts/labels only, no patient names.
      appendAlertLog({
        ts: Date.now(),
        channel: 'triage',
        level: t.level || 'amber',
        label: t.label + ': ' + t.count + ' tasks',
      });
      // Skip desktop notification if clinic mode (quiet) is active.
      if (!quietNow && Notification.permission === 'granted') {
        new Notification('Medicus Suite — Triage alert', {
          body: `${t.label}: ${t.count} tasks (threshold ${t.threshold})`,
          silent: true,
        });
      }
    } else {
      _triageAlertedBuckets.set(t.key, t.count);
    }
  }
  // Clear alerted state for buckets that dropped back below threshold
  for (const [key, _] of _triageAlertedBuckets) {
    if (!triggered.find((t) => t.key === key)) _triageAlertedBuckets.delete(key);
  }
}

// React to config changes — re-render immediately.
// CONFIG keys only, never the prefix: pollAll writes suite.requestMonitor.state
// on every cycle, so a startsWith() match re-triggers the poll it came from —
// an infinite self-sustaining poll loop hammering the API (same hazard the
// service worker guards with its own RM_CONFIG_KEYS allowlist).
const RM_STRIP_CONFIG_KEYS = [
  'suite.requestMonitor.enabled',
  'suite.requestMonitor.assigneeId',
  'suite.requestMonitor.pollSeconds',
  'suite.requestMonitor.notifyEnabled',
  'suite.requestMonitor.notifySound',
];
chrome.storage.onChanged.addListener((changes) => {
  if (RM_STRIP_CONFIG_KEYS.some((k) => k in changes)) {
    fetchAndRenderRmStrip();
  }
  if (Object.keys(changes).some((k) => k.startsWith('suite.triageAlert.'))) {
    fetchAndRenderRmStrip();
  }
  if (changes['submissions.thresholds']) {
    fetchAndRenderSubRagStrip();
  }
});

// Boot the rm strip — initial fetch + self-scheduling poll with failure backoff
// Initial poll interval — will adjust to cfg.pollSeconds on first fetch
rmPoller = makePoller(fetchAndRenderRmStrip, rmPollSeconds * 1000, 'rm-strip').start();

// ── Submissions demand strip (global — visible on every module) ───────────────
// Shows amber/red when medical or admin request counts hit configured thresholds.
// Polls every 60s, but only makes API calls when at least one threshold is enabled.

const subRagStripEl = document.getElementById('subRagStrip');
let _subRagPrevLevel = null;
const SUB_RAG_POLL_MS = 60 * 1000;

const SUB_RAG_TYPES = [
  { key: 'medical', label: 'Medical', apiType: 'medical_patient_request_task' },
  { key: 'admin', label: 'Admin', apiType: 'admin_patient_request_task' },
];

// DEFAULT_SUB_THRESHOLDS + ragLevel are imported from submissions-core.js so the
// strip and the Submissions module share one threshold definition.
function _subRagLevel(key, value, thresholds) {
  return ragLevel(value, { ...DEFAULT_SUB_THRESHOLDS[key], ...(thresholds[key] || {}) });
}

async function fetchAndRenderSubRagStrip() {
  if (document.visibilityState !== 'visible') return true;
  if (!subRagStripEl) return true;

  const stored = await chrome.storage.local.get('submissions.thresholds');
  const thresholds = { ...DEFAULT_SUB_THRESHOLDS, ...(stored['submissions.thresholds'] || {}) };

  const anyEnabled = SUB_RAG_TYPES.some((t) => thresholds[t.key]?.enabled);
  if (!anyEnabled) {
    subRagStripEl.className = 'sub-rag-strip sub-rag-strip-hidden';
    subRagStripEl.innerHTML = '';
    reportAlert('demand', null);
    return true;
  }

  const { code, source } = await window.PracticeCode.resolve();
  if (!code) {
    reportAlert('demand', null);
    return true;
  }

  const today = new Date().toISOString().slice(0, 10);
  const results = await Promise.allSettled(
    SUB_RAG_TYPES.map(async (tt) => {
      const url = `https://${code}.api.england.medicus.health/tasks/data/${tt.apiType}/task-list?createdAt_startDate=${today}&createdAt_endDate=${today}`;
      // Route through ApiDiag so SubRag errors/latency show in the Debug panel,
      // consistent with the WR and Request-Monitor strips.
      const r = await window.ApiDiag.fetch({ module: 'panel-sub-rag-strip', url, code, codeSource: source });
      if (!r.ok) throw new Error(`${tt.label} HTTP ${r.status}`);
      const d = await r.json();
      return { key: tt.key, label: tt.label, count: (d.tasks || []).length };
    })
  );

  // A failure in any sub-request counts as a polling failure for backoff purposes
  const anyFailed = results.some((r) => r.status === 'rejected');

  const triggered = [];
  let maxLevel = null;
  for (let i = 0; i < SUB_RAG_TYPES.length; i++) {
    const res = results[i];
    if (res.status !== 'fulfilled') continue;
    const { key, label, count } = res.value;
    const level = _subRagLevel(key, count, thresholds);
    if (!level) continue;
    triggered.push({ label, count, level });
    if (level === 'red' || maxLevel === null) maxLevel = level;
    else if (level === 'amber' && maxLevel !== 'red') maxLevel = level;
  }

  if (triggered.length === 0) {
    subRagStripEl.className = 'sub-rag-strip sub-rag-strip-hidden';
    subRagStripEl.innerHTML = '';
    _subRagPrevLevel = null;
    reportAlert('demand', null);
    return !anyFailed;
  }

  // Log on level transition only (null→level or level change), counts/labels only.
  if (maxLevel !== null && maxLevel !== _subRagPrevLevel) {
    appendAlertLog({
      ts: Date.now(),
      channel: 'sub-rag',
      level: maxLevel,
      label: 'Demand: ' + triggered.map((t) => t.label + ' ' + t.count).join(', '),
    });
  }
  _subRagPrevLevel = maxLevel;

  const pills = triggered
    .map((t) => `<span class="sub-rag-pill sub-rag-pill--${t.level}">${t.label}: ${t.count}</span>`)
    .join('');

  subRagStripEl.className = `sub-rag-strip sub-rag-strip--${maxLevel}`;
  subRagStripEl.innerHTML = `
    <span class="sub-rag-icon">📊</span>
    <span class="sub-rag-label">Demand:</span>
    ${pills}
    <button class="sub-rag-goto" title="Go to Submissions">Submissions →</button>
  `;
  subRagStripEl.querySelector('.sub-rag-goto')?.addEventListener('click', () => switchModule('submissions'));
  // F1: report total demand TASKS (Medical + Admin sum), not the category count,
  // so "Demand N" reconciles with the expanded "Medical X / Admin Y" detail.
  const demandTasks = triggered.reduce((sum, t) => sum + (t.count || 0), 0);
  reportAlert('demand', { level: maxLevel, label: 'Demand', count: demandTasks });
  return !anyFailed;
}

let subRagPoller = makePoller(fetchAndRenderSubRagStrip, SUB_RAG_POLL_MS, 'sub-rag-strip').start();

// Refresh all three strips immediately when the panel becomes visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    fetchAndRenderStrip();
    fetchAndRenderRmStrip();
    fetchAndRenderSubRagStrip();
  }
});

// Tear down all strip pollers when the panel document goes away. The side
// panel is normally permanent, but if Chrome re-creates the document (e.g. an
// extension reload without a browser restart) the old timers would otherwise
// keep running and a fresh set would stack on top.
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

window.addEventListener('pagehide', () => {
  if (wrPoller) wrPoller.stop();
  if (rmPoller) rmPoller.stop();
  if (subRagPoller) subRagPoller.stop();
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
