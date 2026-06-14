// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — First-run setup checklist
//
// Renders a dismissible "Get set up" card above the module content area.
// Shows when setup is incomplete and not dismissed. Auto-hides once
// the user has enough steps done and dismisses.
//
// Storage key: suite.setup  { dismissedAt: ISO string | null, skippedNotifications: bool }
// (Per-machine onboarding state — not backed up, mirrors suite.tour.seenVersion rationale.)
//
// Auto-show logic:
//   - NEVER show if dismissed (suite.setup.dismissedAt is set)
//   - SHOW  if no practice code resolved
//   - SHOW  if code exists but setup never dismissed and <2 mandatory steps done
//
// Exported:
//   initSetup(hostEl)  — wire host, evaluate on boot; called by panel.js
//   openSetup()        — force-show (called by palette command / CustomEvent)

'use strict';

const STORAGE_KEY = 'suite.setup';
const PRACTICE_CODE_KEY = 'suite.practiceCode';

// Mandatory steps: practiceCode, connection, notifications
const MANDATORY_STEPS = 3;
// Card auto-suppresses once this many mandatory steps are done
const AUTO_HIDE_THRESHOLD = 2;

let _host = null;
let _setupState = { dismissedAt: null, skippedNotifications: false };
let _tourActive = false;
let _stepStatus = {
  practiceCode: { done: false, detected: null },
  connection: { done: false, result: null }, // result: 'ok'|'fail'|null
  notifications: { done: false, permission: 'default' },
  tabs: { done: false, visible: 0, total: 0, optional: true },
  triage: { done: false, optional: true },
};
let _visible = false;
// Session-only: once the mandatory practice code is detected the card collapses
// to a thin strip; the user can Expand it for the rest of this session. Never
// persisted — a fresh panel load starts collapsed again if the code is present.
let _expanded = false;

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadSetupState() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  const saved = r[STORAGE_KEY] || {};
  _setupState.dismissedAt = saved.dismissedAt || null;
  _setupState.skippedNotifications = !!saved.skippedNotifications;
}

async function saveSetupState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: { ..._setupState } });
}

// ── Step evaluation ───────────────────────────────────────────────────────────

async function evaluateSteps() {
  // Step 1: practice code — use PracticeCode.resolve() (same as rest of panel)
  const { code } = await window.PracticeCode.resolve();
  _stepStatus.practiceCode.done = !!code;
  _stepStatus.practiceCode.detected = code || null;

  // Step 2: connection — persisted by the test action; re-evaluate via done flag only
  // (done stays true once set until a new session; no re-probe on visibility)

  // Step 3: notifications
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
  _stepStatus.notifications.permission = perm;
  _stepStatus.notifications.done = perm === 'granted' || _setupState.skippedNotifications;

  // Step 4: tabs chosen (recommended) — done once the user has made any
  // conscious choice (the chooser's Done always writes suite.hiddenTabs, even
  // when the answer is "everything"). User-owned key; never profile-pushed.
  try {
    const [{ TAB_CATALOG }, rt] = await Promise.all([
      import('../tab-catalog.js'),
      chrome.storage.local.get('suite.hiddenTabs'),
    ]);
    const hidden = Array.isArray(rt['suite.hiddenTabs']) ? rt['suite.hiddenTabs'].length : 0;
    _stepStatus.tabs.total = TAB_CATALOG.length;
    _stepStatus.tabs.visible = TAB_CATALOG.length - hidden;
    _stepStatus.tabs.done = rt['suite.hiddenTabs'] !== undefined;
  } catch (_) {
    _stepStatus.tabs.done = false;
  }

  // Step 5: triage (optional)
  if (window.RequestMonitor && typeof window.RequestMonitor.getConfig === 'function') {
    try {
      const cfg = await window.RequestMonitor.getConfig();
      _stepStatus.triage.done = !!(cfg && cfg.enabled && cfg.assigneeId);
    } catch (_) {
      _stepStatus.triage.done = false;
    }
  } else {
    _stepStatus.triage.done = false;
  }
}

function mandatoryDoneCount() {
  return [_stepStatus.practiceCode.done, _stepStatus.connection.done, _stepStatus.notifications.done].filter(Boolean)
    .length;
}

// Count the remaining (not-yet-done) non-practice-code steps to advertise on the
// collapsed strip — connection, notifications, tabs, triage.
function remainingStepCount() {
  return [
    _stepStatus.connection.done,
    _stepStatus.notifications.done,
    _stepStatus.tabs.done,
    _stepStatus.triage.done,
  ].filter((d) => !d).length;
}

// ── Auto-show decision ────────────────────────────────────────────────────────

function shouldShow() {
  if (_setupState.dismissedAt) return false;
  if (!_stepStatus.practiceCode.done) return true;
  return mandatoryDoneCount() < AUTO_HIDE_THRESHOLD;
}

// ── Escape helper ─────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Render ────────────────────────────────────────────────────────────────────

function stepIcon(done) {
  return done
    ? `<span class="setup-step-icon setup-step-icon--done" aria-label="Done">&#10003;</span>`
    : `<span class="setup-step-icon setup-step-icon--pending" aria-label="Pending">&#9675;</span>`;
}

function renderPracticeCodeStep() {
  const { done, detected } = _stepStatus.practiceCode;
  let detail = '';
  if (done && detected) {
    detail = `
      <span class="setup-step-detail">Detected: <code class="setup-code-chip">${esc(detected)}</code></span>
      <div class="setup-step-actions">
        <button class="ghost-btn setup-confirm-code" data-code="${esc(detected)}">Confirm</button>
      </div>`;
  } else {
    detail = `
      <span class="setup-step-detail">Open any Medicus tab then press Re-check, or enter it manually.</span>
      <div class="setup-step-actions">
        <button class="ghost-btn setup-recheck-code">Re-check</button>
        <a class="setup-link" href="#" data-open-options="sect-suite">Enter manually</a>
      </div>`;
  }
  return `
    <li class="setup-step${done ? ' setup-step--done' : ''}">
      ${stepIcon(done)}
      <div class="setup-step-body">
        <span class="setup-step-label">Practice code</span>
        ${detail}
      </div>
    </li>`;
}

function renderConnectionStep() {
  const { done, result } = _stepStatus.connection;
  const hasCode = _stepStatus.practiceCode.done;
  let statusEl = '';
  if (result === 'ok') {
    statusEl = `<span class="setup-result setup-result--ok">Connected &#10003;</span>`;
  } else if (result === 'fail') {
    statusEl = `<span class="setup-result setup-result--fail">Failed — check Medicus sign-in</span>`;
  }
  return `
    <li class="setup-step${done ? ' setup-step--done' : ''}${!hasCode ? ' setup-step--disabled' : ''}">
      ${stepIcon(done)}
      <div class="setup-step-body">
        <span class="setup-step-label">Connection test</span>
        <span class="setup-step-detail">Check the extension can reach Medicus.</span>
        ${!hasCode ? '<span class="setup-step-hint">Add a practice code first.</span>' : ''}
        <div class="setup-step-actions">
          <button class="ghost-btn setup-test-conn"${!hasCode ? ' disabled aria-disabled="true"' : ''}>Test connection</button>
          ${statusEl}
        </div>
      </div>
    </li>`;
}

function renderNotificationsStep() {
  const { done, permission } = _stepStatus.notifications;
  let detail = '';
  let actions = '';
  if (permission === 'granted') {
    detail = `<span class="setup-result setup-result--ok">Enabled &#10003;</span>`;
  } else if (permission === 'denied') {
    detail = `<span class="setup-step-detail">Blocked in browser settings — allow notifications for this extension to enable triage alerts.</span>`;
    actions = `<button class="ghost-btn setup-skip-notif">Skip</button>`;
  } else {
    detail = `<span class="setup-step-detail">Enables desktop alerts for triage thresholds.</span>`;
    actions = `<button class="ghost-btn setup-enable-notif">Enable notifications</button>
               <button class="ghost-btn setup-skip-notif">Skip</button>`;
  }
  return `
    <li class="setup-step${done ? ' setup-step--done' : ''}">
      ${stepIcon(done)}
      <div class="setup-step-body">
        <span class="setup-step-label">Desktop notifications</span>
        ${detail}
        ${actions ? `<div class="setup-step-actions">${actions}</div>` : ''}
      </div>
    </li>`;
}

function renderTabsStep() {
  const { done, visible, total } = _stepStatus.tabs;
  const detail = done
    ? `<span class="setup-step-meta">Showing ${visible} of ${total} tabs</span>`
    : `<span class="setup-step-detail">Pick the tabs you actually use — a GP rarely needs Reception; reception rarely needs Slots. Everything stays reachable via Ctrl+K, and your choice is never overwritten by practice-pushed config.</span>`;
  return `
    <li class="setup-step${done ? ' setup-step--done' : ''}">
      ${stepIcon(done)}
      <div class="setup-step-body">
        <span class="setup-step-label">Choose your tabs <span class="setup-recommended-badge">recommended</span></span>
        ${detail}
        <div class="setup-step-actions">
          <button class="ghost-btn setup-choose-tabs">${done ? 'Change tabs' : 'Choose tabs'}</button>
        </div>
      </div>
    </li>`;
}

function renderTriageStep() {
  const { done } = _stepStatus.triage;
  return `
    <li class="setup-step setup-step--optional${done ? ' setup-step--done' : ''}">
      ${stepIcon(done)}
      <div class="setup-step-body">
        <span class="setup-step-label">Triage monitor <span class="setup-optional-badge">optional</span></span>
        <span class="setup-step-detail">Watching a triage inbox needs a team ID.</span>
        <div class="setup-step-actions">
          <a class="setup-link" href="#" data-open-options="sect-suite">Configure in settings</a>
        </div>
      </div>
    </li>`;
}

// Thin one-line strip shown once the practice code (the mandatory first step) is
// ready, instead of the full multi-step card dominating the module body.
function renderCollapsedStrip() {
  const remaining = remainingStepCount();
  const optionalLabel = remaining === 0 ? 'all steps done' : `${remaining} optional step${remaining === 1 ? '' : 's'}`;
  return `
    <div class="setup-card setup-card--collapsed" role="region" aria-label="Suite setup">
      <span class="setup-collapsed-icon setup-step-icon--done" aria-hidden="true">&#10003;</span>
      <span class="setup-collapsed-text">Setup: practice code ready &middot; ${esc(optionalLabel)}</span>
      <button class="ghost-btn setup-expand" aria-label="Expand setup checklist">Expand</button>
      <button class="ghost-btn setup-dismiss" aria-label="Dismiss setup checklist">Dismiss</button>
    </div>`;
}

function renderCard() {
  const done = mandatoryDoneCount();
  return `
    <div class="setup-card" role="region" aria-label="Suite setup checklist">
      <div class="setup-card-header">
        <span class="setup-card-title">Get set up</span>
        <span class="setup-card-progress">${done} of ${MANDATORY_STEPS} key steps</span>
        <button class="ghost-btn setup-dismiss" aria-label="Dismiss setup checklist">Dismiss</button>
      </div>
      <p class="setup-card-reassure">Nothing is broken — the suite works as soon as your practice code is set. The steps below the line are optional.</p>
      <ol class="setup-steps">
        ${renderPracticeCodeStep()}
        ${renderConnectionStep()}
        ${renderNotificationsStep()}
        ${renderTabsStep()}
        ${renderTriageStep()}
      </ol>
      <div class="setup-card-footer">
        Reopen anytime via <kbd class="setup-kbd">Ctrl+K</kbd> &rsaquo; Suite setup checklist
      </div>
    </div>`;
}

// ── Wire events ───────────────────────────────────────────────────────────────

function wireEvents() {
  if (!_host) return;

  // Dismiss
  _host.querySelector('.setup-dismiss')?.addEventListener('click', async () => {
    _setupState.dismissedAt = new Date().toISOString();
    await saveSetupState();
    hide();
  });

  // Expand the collapsed strip into the full checklist for this session
  _host.querySelector('.setup-expand')?.addEventListener('click', () => {
    _expanded = true;
    renderInto(_host);
    wireEvents();
  });

  // Confirm detected code (dual-write like options.js:138-151)
  _host.querySelector('.setup-confirm-code')?.addEventListener('click', async (e) => {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    const { 'submissions.config': existingSubConfig = {} } = await chrome.storage.local.get('submissions.config');
    await chrome.storage.local.set({
      [PRACTICE_CODE_KEY]: code,
      'submissions.config': { ...existingSubConfig, practiceCode: code },
    });
    await refresh();
  });

  // Re-check code from open Medicus tab
  _host.querySelector('.setup-recheck-code')?.addEventListener('click', async () => {
    const btn = _host.querySelector('.setup-recheck-code');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Checking…';
      btn.setAttribute('aria-busy', 'true');
    }
    await evaluateSteps();
    renderInto(_host);
    wireEvents();
  });

  // Test connection (mirror options.js testConnectionBtn handler ~lines 170-219)
  _host.querySelector('.setup-test-conn')?.addEventListener('click', async () => {
    const btn = _host.querySelector('.setup-test-conn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Testing…';
      btn.setAttribute('aria-busy', 'true');
    }
    await runConnectionTest();
    renderInto(_host);
    wireEvents();
  });

  // Enable notifications
  _host.querySelector('.setup-enable-notif')?.addEventListener('click', async () => {
    if (typeof Notification === 'undefined') return;
    // requestPermission can reject in some contexts — treat as denied so the
    // checklist always reflects an outcome rather than a stale button.
    let perm = 'denied';
    try {
      perm = await Notification.requestPermission();
    } catch (_) {
      perm = 'denied';
    }
    _stepStatus.notifications.permission = perm;
    _stepStatus.notifications.done = perm === 'granted';
    renderInto(_host);
    wireEvents();
  });

  // Skip notifications
  _host.querySelector('.setup-skip-notif')?.addEventListener('click', async () => {
    _setupState.skippedNotifications = true;
    _stepStatus.notifications.done = true;
    await saveSetupState();
    renderInto(_host);
    wireEvents();
  });

  // Choose tabs — opens the tab chooser overlay
  _host.querySelector('.setup-choose-tabs')?.addEventListener('click', () => {
    import('../tabs-chooser/tabs-chooser.js').then((m) => m.openTabsChooser());
  });

  // Options deep-links (manual entry + triage config)
  _host.querySelectorAll('[data-open-options]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const sect = el.dataset.openOptions;
      chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html#${sect}`) });
    });
  });
}

// ── Connection probe ──────────────────────────────────────────────────────────

async function runConnectionTest() {
  const { code } = await window.PracticeCode.resolve();
  if (!code) {
    _stepStatus.connection.result = 'fail';
    _stepStatus.connection.done = false;
    return;
  }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const url =
      `https://${code}.api.england.medicus.health` +
      `/scheduling/data/appointment-book/embedded-overview?date=${today}&filterByUsualLocation=false`;
    const r = await window.ApiDiag.fetch({ module: 'setup-checklist', url, code, codeSource: 'storage' });
    if (r.ok) {
      _stepStatus.connection.done = true;
      _stepStatus.connection.result = 'ok';
    } else {
      _stepStatus.connection.done = false;
      _stepStatus.connection.result = 'fail';
    }
  } catch (_) {
    _stepStatus.connection.done = false;
    _stepStatus.connection.result = 'fail';
  }
}

// ── Render into host ──────────────────────────────────────────────────────────

function renderInto(host) {
  if (!host) return;
  // Once the mandatory practice code is detected, collapse to a thin strip
  // (unless the user has expanded it for this session).
  if (_stepStatus.practiceCode.done && !_setupState.dismissedAt && !_expanded) {
    host.innerHTML = renderCollapsedStrip();
  } else {
    host.innerHTML = renderCard();
  }
}

function show() {
  if (!_host) return;
  if (_tourActive) return;
  _visible = true;
  _host.style.display = '';
  renderInto(_host);
  wireEvents();
}

function hide() {
  if (!_host) return;
  _visible = false;
  _host.style.display = 'none';
  _host.innerHTML = '';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Force-show the setup card (called by palette command and suite:open-setup event).
 * Clears dismissed state for the session so the card is visible.
 */
export function openSetup() {
  if (!_host) return;
  // Temporarily clear dismissedAt so shouldShow() returns true, but do not
  // persist — the user can re-dismiss if they want
  _setupState.dismissedAt = null;
  show();
}

/**
 * Full re-evaluate: re-read step statuses then show or hide as appropriate.
 */
export async function refresh() {
  await evaluateSteps();
  if (!_host) return;
  if (shouldShow() || _visible) {
    show();
  } else {
    hide();
  }
}

/**
 * Boot entry point called by panel.js at startup.
 * @param {HTMLElement} hostEl  The #setupHost div injected into panel.html.
 */
export async function initSetup(hostEl) {
  _host = hostEl;

  // Hide while the guided tour is active; re-evaluate when it ends. Registered
  // FIRST, before any await below, so a tour that auto-starts during this
  // function's async boot can never fire suite:tour-started before we are
  // listening — otherwise the missed event leaves _tourActive false and the
  // checklist paints over the running tour.
  document.addEventListener('suite:tour-started', () => {
    _tourActive = true;
    hide();
  });
  document.addEventListener('suite:tour-ended', () => {
    _tourActive = false;
    refresh();
  });

  await loadSetupState();
  await evaluateSteps();

  // Initial render decision (guarded by _tourActive inside show())
  if (shouldShow()) show();

  // Re-evaluate when panel regains visibility
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  // Re-evaluate when practice code or setup state changes in storage
  chrome.storage.onChanged.addListener((changes) => {
    if (changes[PRACTICE_CODE_KEY]) refresh();
    if (changes['suite.hiddenTabs']) refresh();
    if (changes[STORAGE_KEY]) {
      const v = changes[STORAGE_KEY].newValue || {};
      _setupState.dismissedAt = v.dismissedAt || null;
      _setupState.skippedNotifications = !!v.skippedNotifications;
      refresh();
    }
  });

  // Listen for dispatch from module CTAs
  document.addEventListener('suite:open-setup', () => openSetup());
}
