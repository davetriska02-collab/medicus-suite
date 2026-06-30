// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sentinel side panel module
// Polls the Sentinel content script for its chip snapshot and renders it here.

'use strict';

import { STATUS_RANK, buildAdminSummaryText, isChipActionNeeded } from './sentinel-core.js';
import { buildChipActions, buildPatientActions } from '../shared/action-packs.js';
import { downloadCsv } from '../shared/export-util.js';
import { buildBrief } from './brief-core.js';
import { buildPassport } from './passport-core.js';
import { startTour } from '../../tour/tour.js';

// Canonical clinical-safety caveats (shared/provenance.js, loaded as a classic
// script in panel.html / pop-out.html). Sentinel is the primary monitoring
// surface, so it now consumes the SAME wording every other surface uses instead
// of re-hand-writing it — the whole reason the canon exists. Fall back to the
// canonical literal if the global is somehow absent: a clinical-safety caveat
// must never silently drop.
const NO_ALERT_CAVEAT =
  (typeof window !== 'undefined' && window.Provenance && window.Provenance.CAVEATS.NO_ALERT_NOT_ALL_CLEAR) ||
  'No alert ≠ monitoring complete.';
const LIVE_SNAPSHOT_CAVEAT =
  (typeof window !== 'undefined' && window.Provenance && window.Provenance.CAVEATS.LIVE_SNAPSHOT_NOT_COMPLETE) ||
  'Live snapshot, not a complete record. Verify against the patient record before acting.';

const STATUS_COLOUR = {
  overdue: 'red',
  not_met: 'red',
  alert: 'red',
  stale: 'amber',
  due_soon: 'amber',
  caution: 'amber',
  no_data: 'neutral',
  noted: 'neutral',
  recently_initiated: 'neutral',
  achieved: 'green',
  in_date: 'green',
};
const STATUS_LABEL = {
  overdue: 'OVERDUE',
  not_met: 'NOT MET',
  alert: 'ALERT',
  stale: 'SEVERELY OVERDUE',
  due_soon: 'DUE SOON',
  caution: 'CAUTION',
  no_data: 'NO DATA',
  noted: 'NOTED',
  recently_initiated: 'NEW',
  achieved: 'MET',
  in_date: 'IN DATE',
};

// Colour → severity rank for dismissal escalation. Red=3, amber=2, neutral=1, green=0.
// Unknown colours (or statuses not in STATUS_COLOUR) rank as red (fail-safe: resurface).
// keep in sync with shared/chip-renderer.js STATUS_COLOUR
const COLOUR_RANK = { red: 3, amber: 2, neutral: 1, green: 0 };

// Returns the numeric severity rank for a status string.
// Unknown statuses rank as red (3) — fail-safe, resurfaces the chip.
function statusSeverityRank(status) {
  const colour = STATUS_COLOUR[status];
  return colour !== undefined ? (COLOUR_RANK[colour] ?? 3) : 3;
}

// Modals live in #sentModalHost — a persistent node OUTSIDE the re-rendered
// #sentDynamic section, so the periodic snapshot re-render can never destroy an
// open modal mid-interaction (this was the "popup flicker" bug).
function modalHost() {
  if (!container) return null;
  return container.querySelector('#sentModalHost') || container.querySelector('.sent-module');
}

function closeModals(host) {
  host.querySelector('.sent-appt-modal')?.remove();
  host.querySelector('.sent-act-modal')?.remove();
}

// Keep Tab cycling INSIDE an open modal — aria-modal alone doesn't trap focus,
// so without this Tab walks out into the (inert-looking) panel behind the scrim.
function trapModalTab(modal, e) {
  if (e.key !== 'Tab') return;
  const focusables = Array.from(
    modal.querySelectorAll('button, textarea, input, select, a[href], [tabindex]:not([tabindex="-1"])')
  ).filter((el) => !el.disabled && el.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !modal.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

function showAdminSummaryModal(text) {
  const host = modalHost();
  if (!host) return;
  closeModals(host);

  const opener = document.activeElement;
  const modal = document.createElement('div');
  modal.className = 'sent-appt-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'sentApptModalTitle');
  modal.innerHTML = `
    <div class="sent-appt-modal-inner">
      <div class="sent-appt-modal-head">
        <span class="sent-appt-modal-title" id="sentApptModalTitle">Appointments needed</span>
        <button class="sent-appt-modal-close" id="sentApptModalClose" aria-label="Close">&#x2715;</button>
      </div>
      <textarea class="sent-appt-modal-text" id="sentApptModalText" readonly spellcheck="false">${escHtml(text)}</textarea>
      <div class="sent-appt-modal-foot">
        <button class="sent-appt-modal-copy" id="sentApptModalCopy">Copy to clipboard</button>
      </div>
    </div>`;

  host.appendChild(modal);

  // Close + restore focus to the button that opened the modal (K-7).
  const closeModal = () => {
    modal.remove();
    if (opener && typeof opener.focus === 'function') opener.focus();
  };
  modal.querySelector('#sentApptModalClose').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    trapModalTab(modal, e);
  });

  const copyBtn = modal.querySelector('#sentApptModalCopy');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        if (copyBtn.isConnected) copyBtn.textContent = 'Copy to clipboard';
      }, 2000);
    } catch (_) {
      modal.querySelector('#sentApptModalText')?.select();
    }
  });

  modal.querySelector('#sentApptModalText')?.focus();
}

// Show a per-chip action pack modal with labelled sections and individual copy buttons.
// `title` — chip name shown in the modal header.
// `pack`  — result of buildChipActions(chip, patient).
function showActionPackModal(title, pack) {
  const host = modalHost();
  if (!host) return;
  closeModals(host);

  const sections = [
    { key: 'bloodForm', label: 'Blood form' },
    { key: 'sms', label: 'Recall SMS' },
    { key: 'smsEscalation', label: 'Escalation SMS' },
    { key: 'letter', label: 'Letter' },
    { key: 'task', label: 'Task' },
  ];

  const visibleSections = sections.filter((s) => pack[s.key]);

  const sectionsHtml = visibleSections
    .map(
      (s, i) => `
      <div class="sent-act-section">
        <div class="sent-act-section-head">
          <span class="sent-act-section-label">${escHtml(s.label)}</span>
          <button class="sent-act-copy-btn" data-section-idx="${i}" aria-label="Copy ${escHtml(s.label)}">Copy</button>
        </div>
        <textarea class="sent-act-textarea" data-section-idx="${i}" readonly spellcheck="false">${escHtml(pack[s.key])}</textarea>
      </div>`
    )
    .join('');

  const opener = document.activeElement;
  const modal = document.createElement('div');
  modal.className = 'sent-act-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="sent-act-modal-inner">
      <div class="sent-appt-modal-head">
        <span class="sent-appt-modal-title">${escHtml(title)} — Actions</span>
        <button class="sent-appt-modal-close" aria-label="Close">&#x2715;</button>
      </div>
      <div class="sent-act-sections">${sectionsHtml}</div>
    </div>`;

  host.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    if (opener && typeof opener.focus === 'function') opener.focus();
  };
  modal.querySelector('.sent-appt-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    trapModalTab(modal, e);
  });
  modal.querySelector('.sent-appt-modal-close')?.focus();

  // Per-section copy buttons
  modal.querySelectorAll('.sent-act-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.sectionIdx, 10);
      const text = pack[visibleSections[idx].key];
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied ✓';
        setTimeout(() => {
          if (btn.isConnected) btn.textContent = 'Copy';
        }, 2000);
      } catch (_) {
        modal.querySelector(`.sent-act-textarea[data-section-idx="${idx}"]`)?.select();
      }
    });
  });
}

// Show a "Copy all actions" modal with the aggregated patient pack.
function showAllActionsModal(chips, patient) {
  const pack = buildPatientActions(chips, patient, { letterhead: _letterhead });
  if (!pack) return;

  const host = modalHost();
  if (!host) return;
  closeModals(host);

  const sections = [
    { key: 'bloodForm', label: 'Blood forms' },
    { key: 'sms', label: 'Combined recall SMS' },
    { key: 'task', label: 'Combined task' },
  ];

  const visibleSections = sections.filter((s) => pack[s.key]);

  const sectionsHtml = visibleSections
    .map(
      (s, i) => `
      <div class="sent-act-section">
        <div class="sent-act-section-head">
          <span class="sent-act-section-label">${escHtml(s.label)}</span>
          <button class="sent-act-copy-btn" data-section-idx="${i}" aria-label="Copy ${escHtml(s.label)}">Copy</button>
        </div>
        <textarea class="sent-act-textarea" data-section-idx="${i}" readonly spellcheck="false">${escHtml(pack[s.key])}</textarea>
      </div>`
    )
    .join('');

  const opener = document.activeElement;
  const modal = document.createElement('div');
  modal.className = 'sent-act-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `
    <div class="sent-act-modal-inner">
      <div class="sent-appt-modal-head">
        <span class="sent-appt-modal-title">All patient actions</span>
        <button class="sent-appt-modal-close" aria-label="Close">&#x2715;</button>
      </div>
      <div class="sent-act-sections">${sectionsHtml}</div>
    </div>`;

  host.appendChild(modal);

  const closeModal = () => {
    modal.remove();
    if (opener && typeof opener.focus === 'function') opener.focus();
  };
  modal.querySelector('.sent-appt-modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    trapModalTab(modal, e);
  });
  modal.querySelector('.sent-appt-modal-close')?.focus();

  modal.querySelectorAll('.sent-act-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.sectionIdx, 10);
      const text = pack[visibleSections[idx].key];
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied ✓';
        setTimeout(() => {
          if (btn.isConnected) btn.textContent = 'Copy';
        }, 2000);
      } catch (_) {
        modal.querySelector(`.sent-act-textarea[data-section-idx="${idx}"]`)?.select();
      }
    });
  });
}

let container = null;
let pollTimer = null;
let currentFilter = 'all'; // all | action | clear
let _refreshBtnHandler = null;

// Re-render minimisation: render() writes only #sentDynamic (and the brief
// slot), and skips each DOM write entirely when the freshly generated HTML
// matches the last one. This is the anti-flicker contract — open modals, the
// overflow menu, evidence panels and <details> state all survive the 10s poll
// untouched.
let _lastDynamicHtml = null;
let _lastBriefHtml = null;

// Data context behind the header toolbar. Toolbar buttons are wired ONCE in
// init() and read this at click time, so they never need re-wiring per render.
// null until the first successful 'data' render.
let _renderCtx = null; // { chips, patient, actionCount, trace }

// Overflow ("⋯") menu handlers — document-level, removed in cleanup().
let _menuCloseHandler = null;
let _menuKeyHandler = null;

// Pre-consultation brief state: collapse preference persisted in storage.
let _briefCollapsed = false;
let _lastTrendData = null; // cached from last refresh so render() can use it

// Tab ID of the Medicus source tab for the last successful snapshot fetch.
// Stored here so the "Verify in Medicus" affordance can focus the right tab
// even if the active tab changed since the snapshot was taken (H-007 mitigation).
let _snapshotTabId = null;
let _snapshotTabWindowId = null;

// Rule currency footer: computed once per init from bundled files.
let _ruleCurrencyFooter = null; // null = not loaded yet

// Per-rule hide/snooze (sentinel.hiddenRules). Cached at init + refreshed on
// storage change.
let _hiddenRules = {};
let _letterhead = {};
let _dismissHandler = null;
let _hiddenStorageListener = null;
let _actionsHandler = null; // delegated click handler for per-chip Actions buttons

// Map of action key → { chip, pack, chipName } for per-chip Actions modal.
// Rebuilt on every render so the delegated click handler can find the pack.
let _chipActionsMap = new Map();

// Pure suppression check. Exported so node tests can import it without chrome APIs.
// Returns { hidden: bool, resurfaced: bool }.
//   - Snoozed (until is a future date): hidden regardless of current status.
//   - Permanent (until null) WITH statusAtDismissal: hidden only while current
//     severity is NOT worse than the recorded severity. If current rank > recorded
//     rank the chip shows again (resurfaced: true).
//   - Legacy permanent entries WITHOUT statusAtDismissal: always hidden (backward
//     compatible — avoids flooding existing users whose entries have no status).
//   - A past until (snooze expired): resurfaces normally (hidden: false).
export function chipSuppressionResult(entry, currentStatus, todayIso) {
  if (!entry) return { hidden: false, resurfaced: false };
  if (entry.until != null) {
    // Snoozed: hidden only while the snooze is still active
    return { hidden: entry.until > todayIso, resurfaced: false };
  }
  // Permanent hide
  if (entry.statusAtDismissal == null) {
    // Legacy entry (no statusAtDismissal recorded) — keep old behaviour: always hidden.
    // Existing users dismissed under the old scheme; don't flood them on upgrade.
    return { hidden: true, resurfaced: false };
  }
  const recordedRank = statusSeverityRank(entry.statusAtDismissal);
  const currentRank = statusSeverityRank(currentStatus);
  if (currentRank > recordedRank) {
    // Status has worsened since dismissal — resurface the chip
    return { hidden: false, resurfaced: true };
  }
  return { hidden: true, resurfaced: false };
}

function isRuleHiddenResult(ruleId, currentStatus) {
  if (!ruleId) return { hidden: false, resurfaced: false };
  const entry = _hiddenRules[ruleId];
  if (!entry) return { hidden: false, resurfaced: false };
  const today = new Date().toISOString().slice(0, 10);
  return chipSuppressionResult(entry, currentStatus, today);
}

async function loadHiddenRules() {
  const r = await chrome.storage.local.get('sentinel.hiddenRules');
  _hiddenRules = r['sentinel.hiddenRules'] || {};
}

// Practice letterhead ({ practiceName, clinicianName }) used to auto-fill the
// sign-off in action-pack letters and SMS. Loaded once on init and kept fresh via
// the storage onChanged listener; passed to buildChipActions/buildPatientActions.
async function loadLetterhead() {
  const r = await chrome.storage.local.get('suite.letterhead');
  _letterhead = r['suite.letterhead'] || {};
}

// Evidence-panel state: track which chip is open by its data-evidence-key so
// the 10s poll re-render can restore the panel. _evidenceByKey caches the chip
// objects from the latest snapshot for lookup on click.
let _openEvidenceKey = null;
let _evidenceByKey = new Map();
// Trace entry lookup: ruleId → trace entry (for the "Why?" block). Populated
// from snapshot.trace.entries alongside _evidenceByKey. Keyed by ruleId; for
// multi-med drug-monitoring rules also keyed by ruleId|drugName (chipRef).
// In-memory only; cleared in cleanup().
let _traceByKey = new Map();
let _currentSnapshot = null; // reference to last rendered snapshot for export
let _evidenceKeydownHandler = null;
let _evidenceHandlersAttached = false;

// ── Waiting room state ────────────────────────────────────────────────────────
// Practice code resolved at fetch time from PracticeCode helper. No default.
let WR_SITE_ID = null;
let WR_API_URL = null;
const WR_POLL_MS = 30 * 1000;

let wrPatients = null; // null = not loaded yet, [] = loaded (empty), [...] = loaded
let wrError = null;
let wrLastFetch = null;
let wrPollTimer = null;

export async function init(el) {
  container = el;
  _lastDynamicHtml = null;
  _lastBriefHtml = null;
  _renderCtx = null;

  // Persistent scaffold: header + toolbar, waiting-room slot, dynamic content
  // area, passive footer, modal host. Built exactly once per module life;
  // render() only ever touches #sentDynamic and the footer slots.
  container.innerHTML = scaffoldHtml();
  wireToolbar();
  attachEvidenceHandlers();
  render({ state: 'loading' });

  // Start waiting room fetch in parallel with sentinel chip poll
  fetchWaitingRoom();
  wrPollTimer = setInterval(fetchWaitingRoom, WR_POLL_MS);

  // Load rule currency footer once — non-blocking; re-renders will pick it up.
  loadRuleCurrencyFooter();

  await loadHiddenRules();
  await loadLetterhead();
  // Load brief collapse preference (non-blocking — defaults to expanded).
  chrome.storage.local.get('sentinel.briefCollapsed', (r) => {
    _briefCollapsed = !!r['sentinel.briefCollapsed'];
  });
  await refresh();
  pollTimer = setInterval(refresh, 10000);
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onUpdated.addListener(onUpdated);

  // Listen for refresh signals: waiting-room polls (Pusher) + sentinel snapshot
  // updates pushed by the content script when the patient context changes.
  const onMsg = (msg, sender) => {
    if (!sender || sender.id !== chrome.runtime.id) return;
    if (msg?.type === 'waiting:refresh') fetchWaitingRoom(true);
    if (msg?.type === 'sentinel:snapshot-updated') refresh();
  };
  chrome.runtime.onMessage.addListener(onMsg);

  _refreshBtnHandler = (e) => {
    if (e.target?.id === 'sentRefreshBtn') refresh();
  };
  document.addEventListener('click', _refreshBtnHandler);

  // Delegated dismiss handler: clicks on a chip's × button add the rule to
  // sentinel.hiddenRules and re-render. stopPropagation prevents the chip's
  // own click handler from also toggling its evidence panel.
  _dismissHandler = async (e) => {
    const btn = e.target.closest?.('[data-dismiss-rule]');
    if (!btn || !container || !container.contains(btn)) return;
    e.stopPropagation();
    e.preventDefault();
    const ruleId = btn.dataset.dismissRule;
    if (!ruleId) return;
    const untilRaw = btn.dataset.dismissUntil;
    const until = untilRaw ? untilRaw : null;
    // Record the chip's current status so a later status-escalation can resurface it.
    const statusAtDismissal = btn.dataset.dismissStatus || null;
    const dismissedAt = new Date().toISOString().slice(0, 10);
    const r = await chrome.storage.local.get('sentinel.hiddenRules');
    const hidden = r['sentinel.hiddenRules'] || {};
    hidden[ruleId] = { until, statusAtDismissal, dismissedAt };
    await chrome.storage.local.set({ 'sentinel.hiddenRules': hidden });
    _hiddenRules = hidden;
    refresh();
  };
  document.addEventListener('click', _dismissHandler, true);

  // Delegated Actions handler: clicks on a chip's "Actions" button open the
  // per-chip action pack modal. Uses capture so it can stopPropagation before
  // the evidence panel toggle handler sees the click.
  _actionsHandler = (e) => {
    const btn = e.target.closest?.('[data-act-key]');
    if (!btn || !container || !container.contains(btn)) return;
    e.stopPropagation();
    e.preventDefault();
    const key = btn.dataset.actKey;
    if (!key) return;
    const entry = _chipActionsMap.get(key);
    if (!entry) return;
    showActionPackModal(entry.chipName, entry.pack);
  };
  document.addEventListener('click', _actionsHandler, true);

  // Re-render when hidden rules change (e.g. re-enabled from settings).
  _hiddenStorageListener = (changes, area) => {
    if (area !== 'local') return;
    if (changes['sentinel.hiddenRules']) {
      _hiddenRules = changes['sentinel.hiddenRules'].newValue || {};
      refresh();
    }
    if (changes['suite.letterhead']) {
      _letterhead = changes['suite.letterhead'].newValue || {};
      refresh();
    }
  };
  chrome.storage.onChanged.addListener(_hiddenStorageListener);

  return () => {
    cleanup();
    clearInterval(wrPollTimer);
    chrome.runtime.onMessage.removeListener(onMsg);
  };
}

function onUpdated(tabId, info) {
  if (info.status === 'complete') refresh();
}

async function cleanup() {
  clearInterval(pollTimer);
  clearInterval(wrPollTimer);
  chrome.tabs.onActivated.removeListener(refresh);
  chrome.tabs.onUpdated.removeListener(onUpdated);
  // NB: the suite tour is shell-owned and switches modules itself — do NOT
  // stop it here, or the walkthrough would die the moment it left this tab.
  if (_refreshBtnHandler) {
    document.removeEventListener('click', _refreshBtnHandler);
    _refreshBtnHandler = null;
  }
  if (_menuCloseHandler) {
    document.removeEventListener('click', _menuCloseHandler);
    _menuCloseHandler = null;
  }
  if (_menuKeyHandler) {
    document.removeEventListener('keydown', _menuKeyHandler);
    _menuKeyHandler = null;
  }
  if (_dismissHandler) {
    document.removeEventListener('click', _dismissHandler, true);
    _dismissHandler = null;
  }
  if (_actionsHandler) {
    document.removeEventListener('click', _actionsHandler, true);
    _actionsHandler = null;
  }
  _chipActionsMap.clear();
  if (_hiddenStorageListener) {
    chrome.storage.onChanged.removeListener(_hiddenStorageListener);
    _hiddenStorageListener = null;
  }
  if (_evidenceKeydownHandler) {
    document.removeEventListener('keydown', _evidenceKeydownHandler);
    _evidenceKeydownHandler = null;
  }
  // The shell reuses the same container element across module switches —
  // without these removals the listeners stack on re-init and every chip
  // click would toggle its evidence panel twice (open-then-shut).
  if (container && _evidenceHandlersAttached) {
    container.removeEventListener('click', onEvidenceClick);
    container.removeEventListener('keydown', onEvidenceKeydown);
  }
  _evidenceHandlersAttached = false;
  _openEvidenceKey = null;
  _evidenceByKey.clear();
  _traceByKey.clear();
  _currentSnapshot = null;
  _snapshotTabId = null;
  _snapshotTabWindowId = null;
  _ruleCurrencyFooter = null;
  _lastTrendData = null;
  _lastDynamicHtml = null;
  _lastBriefHtml = null;
  _renderCtx = null;
  container = null;
}

// ── Rule currency footer ──────────────────────────────────────────────────────
// Loaded once per module init. Renders a one-line footer beneath the chip area.
// Neutral (green) when all rules are current; amber with the first warning when any
// rule file is stale or has a version mismatch. Uses chrome.runtime.getURL so the
// fetch works identically in the side-panel and the pop-out window.

async function loadRuleCurrencyFooter() {
  if (!chrome.runtime?.getURL) return;
  try {
    const base = chrome.runtime.getURL('rules/');
    const [drug, qof, vax, alert] = await Promise.all([
      fetch(base + 'drug-rules.json').then((r) => r.json()),
      fetch(base + 'qof-rules.json').then((r) => r.json()),
      fetch(base + 'vaccine-rules.json').then((r) => r.json()),
      fetch(base + 'alert-library.json').then((r) => r.json()),
    ]);

    const files = [
      { id: 'drug', lastUpdated: drug.lastUpdated, specVersion: drug.specVersion },
      { id: 'qof', lastUpdated: qof.lastUpdated, specVersion: qof.specVersion },
      { id: 'vaccine', lastUpdated: vax.lastUpdated, specVersion: vax.specVersion },
      { id: 'alert', lastUpdated: alert.lastUpdated, specVersion: alert.specVersion },
    ];

    const today = new Date().toISOString().slice(0, 10);

    // RuleCurrency is loaded as a classic script by the panel/pop-out shells.
    // If it's not available (e.g. test env), show nothing.
    const RC = typeof window !== 'undefined' ? window.RuleCurrency : null;
    if (!RC) return;

    const result = RC.assessRuleCurrency(files, today);

    // Build a compact one-line summary
    const qofSpec = qof.specVersion || '';
    // Extract "QOF YYYY/YY" from specVersion for the compact label
    const qofMatch = qofSpec.match(/QOF\s+\d{4}\/\d{2,4}/i);
    const qofLabel = qofMatch ? qofMatch[0] : qofSpec.slice(0, 20);
    const drugDateLabel = drug.lastUpdated ? `updated ${drug.lastUpdated}` : '';

    // Scope disclosure: a date stamp tells you the rules are maintained, but not
    // how much they cover. Surface the counts so a clinician can calibrate the
    // safety net at a glance (absence of a chip never means "monitoring complete").
    const drugCount = Array.isArray(drug.rules) ? drug.rules.length : 0;
    const qofCount = Array.isArray(qof.rules) ? qof.rules.length : 0;
    const scopeLabel = drugCount && qofCount ? `${drugCount} drug rules · ${qofCount} QOF indicators` : '';

    const summaryText = [qofLabel, drugDateLabel ? `drug rules ${drugDateLabel}` : '', scopeLabel]
      .filter(Boolean)
      .join(' · ');

    if (result.overall === 'red') {
      _ruleCurrencyFooter =
        `<div class="sent-rules-footer sent-rules-footer-red" title="${escAttr(result.warnings.join(' | '))}">` +
        `<span class="sent-rules-footer-icon">&#9888;</span> ` +
        `Rules: ${escHtml(summaryText)} — ${escHtml(result.warnings[0] || 'urgent review needed')}` +
        `</div>`;
    } else if (result.overall === 'amber') {
      _ruleCurrencyFooter =
        `<div class="sent-rules-footer sent-rules-footer-amber" title="${escAttr(result.warnings.join(' | '))}">` +
        `<span class="sent-rules-footer-icon">&#9888;</span> ` +
        `Rules: ${escHtml(summaryText)} — ${escHtml(result.warnings[0] || 'review needed')}` +
        `</div>`;
    } else {
      _ruleCurrencyFooter =
        `<div class="sent-rules-footer sent-rules-footer-green">` + `Rules: ${escHtml(summaryText)}` + `</div>`;
    }
  } catch (_) {
    // Non-critical: suppress errors in currency footer silently
    _ruleCurrencyFooter = '';
  }
  updateRulesSlot();
}

// Push the rule-currency line into its persistent footer slot. Safe to call
// any time; no-ops until the scaffold exists / the footer has loaded.
function updateRulesSlot() {
  const slot = container?.querySelector('#sentRulesSlot');
  if (slot) slot.innerHTML = _ruleCurrencyFooter || '';
}

// ── Waiting room ─────────────────────────────────────────────────────────────

async function fetchWaitingRoom(bypassCache = false) {
  if (!bypassCache && wrLastFetch && Date.now() - wrLastFetch < WR_POLL_MS) return;
  // Resolve practice code on every fetch so user changes take effect immediately.
  const { code, source } = await window.PracticeCode.resolve();
  WR_SITE_ID = code;
  if (!WR_SITE_ID) {
    wrError = 'No practice code — open a Medicus tab or set it in Options.';
    wrPatients = [];
    // Update just the pinned waiting-room block (same as the success path).
    // Previously this called render({state:'loaded'}) — an unhandled state that
    // fell through to destructuring an undefined snapshot and threw (swallowed),
    // so the "no practice code" message never showed.
    if (container) {
      const wrEl = container.querySelector('.wr-pinned');
      if (wrEl) updateWrPinned(wrEl);
    }
    return;
  }
  WR_API_URL = `https://${WR_SITE_ID}.api.england.medicus.health/scheduling/data/homepage/my-appointments`;
  try {
    const r = await window.ApiDiag.fetch({
      module: 'sentinel-wr',
      url: WR_API_URL,
      code: WR_SITE_ID,
      codeSource: source,
    });
    const raw = await r.json();
    const entries = (raw?.schedule?.schedule ?? [])
      .flatMap((d) => d.entries ?? [])
      .filter((e) => e?.diaryEntryType?.value === 'appointment' && e?.displayStatus?.value === 'arrived');
    wrPatients = entries
      .map((e) => ({
        name: e.patient?.name ?? 'Unknown',
        start: e.start ?? '',
        startDateTime: e.startDateTime ?? null,
        reason: (e.compiledReasonForAppointment ?? '').replace(/^GP Appointment\s*/i, '').trim(),
        deliveryMode: e.deliveryMode?.value ?? '',
        minutesWaiting: calcWrWait(e.startDateTime),
      }))
      .sort((a, b) => (a.start < b.start ? -1 : 1));
    wrError = null;
    wrLastFetch = Date.now();
    // NB: the toolbar action badge is owned solely by panel.js's waiting-room
    // strip (updateStripBadge), which polls globally. This module used to set it
    // too, so the two writers raced and clobbered each other's count whenever the
    // Sentinel tab was active. Leave the badge to panel.js.
  } catch (e) {
    console.warn('[Sentinel WR] fetch error:', e.message);
    wrError = 'Waiting room unavailable — check your Medicus connection.';
    wrPatients = wrPatients ?? []; // retain last good state on transient error
  }
  // Re-render the sentinel module to update the pinned block
  if (container) {
    const wrEl = container.querySelector('.wr-pinned');
    if (wrEl) updateWrPinned(wrEl);
  }
}

function calcWrWait(startDateTime) {
  if (!startDateTime) return null;
  const ms = new Date(startDateTime).getTime();
  if (isNaN(ms)) return null;
  const mins = Math.round((Date.now() - ms) / 60000);
  return mins > 0 ? mins : 0;
}

// Feather stroke SVG icons for the waiting-room block (14px, currentColor, aria-hidden).
// Emoji removed per design crit — these are chrome glyphs, not content.
const WR_ICONS = {
  // users (two-person)
  users: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  // clock
  clock: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  // alert-triangle
  alertTriangle: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  // check
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
};

function renderWaitingRoomBlock() {
  const patients = wrPatients;
  if (patients === null) {
    // Still loading — show a slim skeleton
    return `<div class="wr-pinned wr-loading">
      <div class="wr-pin-row">
        <span class="wr-pin-icon">${WR_ICONS.clock}</span>
        <span class="wr-pin-label">Waiting room loading…</span>
      </div>
    </div>`;
  }

  if (wrError && patients.length === 0) {
    return `<div class="wr-pinned wr-error">
      <div class="wr-pin-row">
        <span class="wr-pin-icon">${WR_ICONS.alertTriangle}</span>
        <span class="wr-pin-label">${escHtml(wrError)}</span>
      </div>
    </div>`;
  }

  if (patients.length === 0) {
    return `<div class="wr-pinned wr-clear">
      <div class="wr-pin-row">
        <span class="wr-pin-icon">${WR_ICONS.check}</span>
        <span class="wr-pin-label">Waiting room clear</span>
        <span class="wr-pin-ts">${wrLastFetch ? new Date(wrLastFetch).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
    </div>`;
  }

  const urgent = patients.filter((p) => (p.minutesWaiting ?? 0) >= 15);
  const rows = patients
    .map((p) => {
      const mins = p.minutesWaiting;
      const waitClass = mins == null ? '' : mins >= 20 ? 'wr-row-red' : mins >= 10 ? 'wr-row-amber' : '';
      const waitStr = mins != null ? `${mins}m` : '';
      return `<div class="wr-row ${waitClass}">
      <span class="wr-row-time">${escHtml(p.start)}</span>
      <span class="wr-row-name">${escHtml(p.name)}</span>
      ${waitStr ? `<span class="wr-row-wait">${waitStr}</span>` : ''}
    </div>`;
    })
    .join('');

  const urgentNote = urgent.length > 0 ? ` · ${urgent.length} &gt;15m` : '';

  return `<div class="wr-pinned wr-waiting">
    <div class="wr-pin-row wr-pin-head">
      <span class="wr-pin-icon">${WR_ICONS.users}</span>
      <span class="wr-pin-label"><strong>${patients.length}</strong> waiting${urgentNote}</span>
      <span class="wr-pin-ts">${wrLastFetch ? new Date(wrLastFetch).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
    </div>
    <div class="wr-pin-caption">Waiting room only · times are how long they have waited. Sentinel checks the record you open, not this list.</div>
    <div class="wr-rows">${rows}</div>
  </div>`;
}

function updateWrPinned(el) {
  // Surgical update — swap just the waiting room block without re-rendering the whole module
  const next = document.createElement('div');
  next.innerHTML = renderWaitingRoomBlock();
  const newEl = next.firstElementChild;
  if (newEl) el.replaceWith(newEl);
}

// Pure: decide how a Sentinel snapshot should be surfaced. Kept separate and
// unit-tested (test-sentinel-panel-state.js) because getting this wrong is the
// H-005 failure mode — a degraded extraction or a stale/invalidated snapshot
// must NEVER read as a benign "no chips for this patient" all-clear.
//   degraded    → extraction succeeded but produced nothing on a patient view
//   unavailable → snapshot was invalidated (navigating / failed extraction)
//   no-chips    → no snapshot yet
//   data        → real chips to render (may legitimately be an empty array)
function classifySnapshot(snapshot) {
  if (!snapshot) return 'no-chips';
  if (snapshot.unavailable) return 'unavailable';
  if (snapshot.degraded) return 'degraded';
  if (!snapshot.chips) return 'no-chips';
  return 'data';
}

// Pure helper: derive the per-patient audit headline counts from the already-
// computed render values. Reuses the existing fields rather than recomputing —
// `modules.medications` (extraction count), the drug-monitoring chips, and
// `unmatchedMeds` — so the headline can never disagree with the sections below it.
//
// The point of this headline (pharmacist + nurse finding): on a clean screen a
// clinician must be able to tell "drug was checked and is in date" from "drug
// never matched a rule and silently fell through". A bare empty panel reads as
// the latter; these counts make "verified clear" explicit. It does NOT replace
// the "no alert is not an all-clear" caveat — it is purely additive.
//
// Returns null when there is nothing to summarise (no meds extracted AND no
// monitoring chips AND no unmatched meds) so the headline simply doesn't render.
function buildAuditHeadline({ chips, modules, unmatchedMeds }) {
  const list = Array.isArray(chips) ? chips : [];
  const monitoringChips = list.filter((c) => c && c.type === 'drug-monitoring');
  const medsChecked = modules && Number.isFinite(modules.medications) ? modules.medications : null;
  const matched = monitoringChips.length;
  // "Overdue" here = monitoring chips at action-needed severity (rank <= 2:
  // overdue / severely overdue / due soon) — the silent-failure counterpoint.
  const overdue = monitoringChips.filter((c) => (STATUS_RANK[c.status] ?? 99) <= 2).length;
  const unmatched = Array.isArray(unmatchedMeds) ? unmatchedMeds.length : 0;

  if (medsChecked === null && matched === 0 && unmatched === 0) return null;
  return { medsChecked, matched, overdue, unmatched };
}

let _refreshInFlight = false;
let _refreshPending = false;
async function refresh() {
  if (!container) return;
  // Coalesce concurrent refreshes. refresh() is driven by the 10s poll,
  // tabs.onActivated, tabs.onUpdated, the sentinel:snapshot-updated message and
  // the refresh button — several can fire at once. Without this guard their
  // executeScript/sendMessage round-trips race and each render() replaces the DOM
  // the others just built (flicker + wasted IPC). If a trigger arrives mid-flight
  // we run exactly one more refresh afterwards.
  if (_refreshInFlight) {
    _refreshPending = true;
    return;
  }
  _refreshInFlight = true;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !tab?.url || !/medicus\.health/.test(tab.url)) {
      render({ state: 'no-medicus' });
      return;
    }
    const mountCheck = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!window.__sentinelMounted,
    });
    if (!mountCheck?.[0]?.result) {
      render({ state: 'not-mounted' });
      return;
    }
    // Store snapshot tab identity for the "Verify in Medicus" affordance.
    _snapshotTabId = tab.id;
    _snapshotTabWindowId = tab.windowId;
    const snapshot = await chrome.tabs.sendMessage(tab.id, { action: 'getSentinelSnapshot' });
    // Also fetch trend data for the brief card. Failure here must never block
    // or fail the Sentinel render — trends are supplementary, not critical.
    let trendData = null;
    try {
      trendData = await new Promise((res, rej) => {
        chrome.tabs.sendMessage(tab.id, { action: 'getTrendData' }, (r) => {
          if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
          else res(r || null);
        });
      });
    } catch (_) {
      trendData = null;
    }
    _lastTrendData = trendData;
    switch (classifySnapshot(snapshot)) {
      case 'degraded':
        render({ state: 'degraded', snapshot });
        return;
      case 'unavailable':
        render({ state: 'no-chips' });
        return;
      case 'no-chips':
        render({ state: 'no-chips' });
        return;
      default:
        render({ state: 'data', snapshot });
        return;
    }
  } catch (err) {
    render({ state: 'error', message: err.message });
  } finally {
    _refreshInFlight = false;
    if (_refreshPending) {
      _refreshPending = false;
      refresh();
    }
  }
}

// Replace #sentDynamic's content — but only when it actually changed.
// Returns true when the DOM was rewritten (callers must then re-wire per-render
// handlers); false when the existing DOM was left untouched.
function setDynamic(html) {
  const dyn = container?.querySelector('#sentDynamic');
  if (!dyn) return false;
  if (html === _lastDynamicHtml) return false;
  dyn.innerHTML = html;
  _lastDynamicHtml = html;
  return true;
}

// The pre-consultation brief lives in its own persistent slot (the action bar
// is anchored directly beneath it), updated with the same changed-check.
function setBriefSlot(html) {
  const slot = container?.querySelector('#sentBriefSlot');
  if (!slot) return;
  if (html === _lastBriefHtml) return;
  slot.innerHTML = html;
  _lastBriefHtml = html;
  if (html) attachBriefToggle();
}

function updateFooterTs(ts) {
  const el = container?.querySelector('#sentFooterTs');
  if (el) el.textContent = ts ? `Data at ${ts}` : '';
}

function render(payload) {
  if (!container) return;
  const { state, snapshot, message } = payload;

  if (state !== 'data') {
    // No usable data behind the action bar in these states.
    _renderCtx = null;
    updateToolbarState();
    updateFooterTs('');
    setBriefSlot('');
  }

  if (state === 'loading') {
    setDynamic(`<div class="sent-skeleton">${Array(4).fill('<div class="sent-skel-chip"></div>').join('')}</div>`);
    return;
  }
  if (state === 'no-medicus') {
    setDynamic(
      statusBlock(
        'idle',
        'Monitoring idle — no record open',
        'Open a patient in Medicus and Sentinel checks their drug and QOF monitoring here. The waiting room above is not a monitoring result.'
      )
    );
    return;
  }
  if (state === 'not-mounted') {
    setDynamic(
      statusBlock('idle', 'Navigate to a patient record', 'Sentinel activates on patient record and triage task pages.')
    );
    return;
  }
  if (state === 'no-chips') {
    setDynamic(statusBlock('idle', 'Loading patient data…', 'This panel refreshes automatically.'));
    return;
  }
  if (state === 'error') {
    setDynamic(statusBlock('error', 'Could not connect to Sentinel', message || ''));
    return;
  }
  if (state === 'degraded') {
    // H-005: a patient was identified but nothing could be extracted. This must
    // be surfaced as a warning, never as a benign empty — see classifySnapshot.
    const reason =
      (snapshot && snapshot.reason) ||
      'A patient was identified, but no medications, problems, observations or demographics could be extracted from this page — Medicus may have changed its layout.';
    setDynamic(
      statusBlock(
        'error',
        "⚠ Couldn't read this record",
        `${reason} This is NOT an "all clear" — verify the patient directly in Medicus, and the extension may need updating.`
      )
    );
    return;
  }

  const {
    chips: allChips,
    patientContext,
    evaluatedAt,
    modules,
    unmatchedMeds,
    unmatchedMedsDetailed,
    unmatchedHighRisk,
    trace,
    drift,
    journalAugmentFailed,
    journalAugmentError,
  } = snapshot;
  const patient = patientContext;
  _currentSnapshot = snapshot;

  // Drop chips for currently-suppressed rules (per-rule hide/snooze) before any
  // filtering or counting, so hidden alerts vanish entirely and don't skew the
  // filter-bar tallies. Resurfaced chips (status has worsened since dismissal) are
  // kept and annotated so they render with a visible RESURFACED badge.
  const chips = (allChips || [])
    .map((c) => {
      const { hidden, resurfaced } = isRuleHiddenResult(c.ruleId, c.status);
      if (hidden) return null;
      return resurfaced ? { ...c, _resurfaced: true } : c;
    })
    .filter(Boolean);

  // Filter chips
  let visibleChips = chips;
  if (currentFilter === 'action') visibleChips = chips.filter((c) => STATUS_RANK[c.status] <= 2);
  if (currentFilter === 'clear') visibleChips = chips.filter((c) => STATUS_RANK[c.status] >= 5);

  const actionCount = chips.filter((c) => STATUS_RANK[c.status] <= 2).length;
  const clearCount = chips.filter((c) => STATUS_RANK[c.status] >= 5).length;

  // Group by type. Non-QOF surveillance items (eGFR/HbA1c trends, electrolyte
  // alerts) carry category: 'safety-monitoring' on the rule — bucket those into
  // their own "Safety Monitoring" section so they don't read as QOF claim
  // indicators, even though they reuse the qof-indicator evaluation/chip shape.
  const groups = {};
  visibleChips.forEach((chip) => {
    const g = chip.category === 'safety-monitoring' ? 'safety-monitoring' : chip.type || 'other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(chip);
  });
  Object.values(groups).forEach((g) => g.sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3)));

  // "Verify in Medicus" button — focuses the source tab so the clinician can
  // check the live record before acting (H-007 anti-automation-bias mitigation).
  // Rendered next to the patient name banner and again inside each chip's evidence
  // panel. Only shown when we have a known snapshot tab.
  const verifyBtn =
    _snapshotTabId != null
      ? `<button class="sent-verify-btn" id="sentVerifyBannerBtn" title="Check the source record before acting on this alert">Verify in Medicus &#x2197;</button>`
      : '';

  const patientHtml = patient
    ? `
    <div class="sent-patient-banner">
      <span class="sent-patient-lead">Monitoring for</span>
      <div class="sent-patient-banner-row">
        <div class="sent-patient-name">${escHtml(patient.displayName || patient.name || '')}</div>
        ${verifyBtn}
      </div>
      <div class="sent-patient-meta">${[
        patient.nhsNumber ? `NHS ${escHtml(patient.nhsNumber)}` : '',
        patient.dateOfBirth ? `DOB ${escHtml(patient.dateOfBirth)}` : '',
        patient.age ? `Age ${patient.age}` : '',
        patient.gender ? escHtml(patient.gender) : '',
      ]
        .filter(Boolean)
        .join(' · ')}</div>
    </div>`
    : '';

  // Amber drift banner — shown when the content script detected a sustained
  // extraction quality drop on this view. Amber (not red) because degraded (total
  // blank) is already handled by classifySnapshot → 'degraded' state above.
  // Placed between patient header and filter bar so the clinician sees it
  // immediately without it blocking the chip list.
  const driftHtml =
    drift && drift.drifted
      ? `
     <div class="sent-drift-banner" role="alert">
       <div class="sent-drift-head"><span class="sent-drift-icon">&#9888;</span>
         <strong>Extraction quality has dropped</strong>
         <button class="sent-drift-dismiss" id="sentDriftDismiss" title="Hide this warning for 24 hours">Dismiss 24h</button>
       </div>
       <p class="sent-drift-body">${escHtml(drift.reason)} Alerts below may be incomplete — this is NOT an all-clear. Verify directly in Medicus; the extension may need updating.</p>
     </div>`
      : '';

  const filterHtml = `
    <div class="sent-filter-bar" role="group" aria-label="Filter alerts">
      <button class="sent-filter-btn${currentFilter === 'all' ? ' active' : ''}" data-filter="all" aria-pressed="${currentFilter === 'all'}">All (${chips.length})</button>
      <button class="sent-filter-btn${currentFilter === 'action' ? ' active action' : ''}" data-filter="action" aria-pressed="${currentFilter === 'action'}">Needs action (${actionCount})</button>
      <button class="sent-filter-btn${currentFilter === 'clear' ? ' active clear' : ''}" data-filter="clear" aria-pressed="${currentFilter === 'clear'}">In date (${clearCount})</button>
      <button class="sent-filter-btn sent-export-btn" id="sentExportCsv" title="Export this patient's monitoring to CSV (stays on your device)">&#8595; CSV</button>
    </div>`;

  const typeOrder = [
    // Ordered by urgency of action: alert clusters first, then safety
    // surveillance (act-today signals like a raised potassium), then routine
    // drug monitoring, vaccinations and QOF housekeeping last.
    'drug-combo',
    'event-count',
    'composite',
    'safety-monitoring',
    'drug-monitoring',
    'vaccine',
    'qof-indicator',
    'qof-process-indicator',
    'qof-register',
  ];
  const typeLabelMap = {
    'drug-combo': 'Drug Combinations',
    'event-count': 'Recurrent Events',
    composite: 'Composite Alerts',
    'safety-monitoring': 'Safety Monitoring',
    'drug-monitoring': 'Drug Monitoring',
    vaccine: 'Vaccinations',
    'qof-indicator': 'QOF Indicators',
    'qof-process-indicator': 'QOF Process',
    'qof-register': 'Registers',
  };
  // Optional one-line caption under a section header. Used to make clear that
  // Safety Monitoring items are clinical safety flags, not QOF payment items —
  // so moving them out of "QOF Indicators" can't read as "we've stopped chasing
  // QOF" (a concern raised across the staff-appraisal personas).
  const typeCaptionMap = {
    'safety-monitoring': 'Clinical safety flags — not QOF payment items',
  };

  const groupsHtml = typeOrder
    .filter((t) => groups[t]?.length)
    .map(
      (t) => `
      <section class="sent-group${t === 'qof-register' ? ' sent-group-dim' : ''}">
        <div class="sent-group-label">${typeLabelMap[t] || t}</div>
        ${typeCaptionMap[t] ? `<div class="sent-group-caption">${escHtml(typeCaptionMap[t])}</div>` : ''}
        <div class="sent-chip-list">${groups[t].map(renderChip).join('')}</div>
      </section>`
    )
    .join('');

  const ts = evaluatedAt
    ? new Date(evaluatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';

  // Headline audit count — one calm, factual line at the top of a loaded record
  // so a clean screen reads as "checked and clear", not "nothing happened to
  // fire". Reuses the counts already in scope (drug-monitoring chips,
  // modules.medications, unmatchedMeds) — see buildAuditHeadline. Only rendered
  // for a genuinely loaded, evaluated patient record; never weakens or precedes
  // the alert salience below (it sits between the patient banner and the chips,
  // and the "no alert is not an all-clear" caveat is preserved unchanged).
  const headline = patient ? buildAuditHeadline({ chips, modules, unmatchedMeds }) : null;
  const headlineHtml = headline
    ? `
    <div class="sent-audit-headline" role="status">
      <span class="sent-audit-counts">${[
        headline.medsChecked !== null
          ? `${headline.medsChecked} med${headline.medsChecked === 1 ? '' : 's'} checked`
          : '',
        `${headline.matched} matched a monitoring rule`,
        `${headline.overdue} overdue`,
        headline.unmatched > 0
          ? `<button type="button" class="sent-audit-unmatched-link" data-act="show-unmatched" title="Show which medicines have no monitoring rule">${headline.unmatched} unmatched</button>`
          : `${headline.unmatched} unmatched`,
      ]
        .filter(Boolean)
        .join(' · ')}</span>${ts ? `<span class="sent-audit-time">checked ${escHtml(ts)}</span>` : ''}
      <span class="sent-audit-caveat" title="${escAttr(LIVE_SNAPSHOT_CAVEAT)}">${escHtml(LIVE_SNAPSHOT_CAVEAT)}</span>
    </div>`
    : '';
  // Empty / all-clear states must never read as assurance. Carry the canonical
  // "no alert ≠ monitoring complete" caveat on the clear states so a clean screen
  // is not mistaken for a complete monitoring check (the green over-claim gap).
  const emptyMsg =
    visibleChips.length === 0
      ? `<div class="sent-empty">${
          currentFilter === 'action'
            ? 'No items needing action.'
            : currentFilter === 'clear'
              ? 'No items in date.'
              : 'No chips for this patient.'
        }<span class="sent-empty-caveat">${escHtml(NO_ALERT_CAVEAT)}</span></div>`
      : '';

  // Per-module extraction breakdown (informational, H-005 transparency). Shows
  // what the extension actually read from this record so a clinician can spot a
  // partial scraper failure (e.g. meds populated but observations silently empty)
  // that isn't blank enough to trip the degraded banner. A zero count is
  // amber-flagged to prompt verification — it is NOT an error on its own.
  const extractionHtml = modules
    ? `
    <div class="sent-extraction" title="What the extension read from this record. A zero count is flagged for you to verify directly in Medicus — a record can legitimately have none, so this is not necessarily an error.">
      <span class="sent-ext-label">Extracted</span>
      <span class="sent-ext-item${modules.medications === 0 ? ' sent-ext-zero' : ''}">${modules.medications} meds</span>
      <span class="sent-ext-item${modules.observations === 0 ? ' sent-ext-zero' : ''}">${modules.observations} obs</span>
      <span class="sent-ext-item${modules.problems === 0 ? ' sent-ext-zero' : ''}">${modules.problems} problems</span>
    </div>`
    : '';

  const unmatchedHtml = renderUnmatchedMedsSection(unmatchedMeds, unmatchedMedsDetailed);
  const _unmatchedWasOpen = container.querySelector('.sent-unmatched-section')?.open ?? false;

  // High-risk blind-spot banner — a drug that genuinely needs monitoring but
  // matched NO rule (odd brand / exclude / disabled rule), so no overdue chip
  // could ever fire for it. Rendered prominently near the top (with the other
  // warnings), not buried in the collapsible unmatched list below.
  const highRiskUnmatchedHtml = renderHighRiskUnmatchedBanner(unmatchedHighRisk);

  // Journal-augment failure indicator — shown when the content script's
  // fetchJournalObservations threw. QOF chips that rely on journal-coded
  // evidence (AST007, COPD010, HF007, etc.) may show no_data incorrectly.
  // Deliberately unobtrusive: a small muted line near the extraction health
  // block, not a banner (the chip list is still usable; this is advisory only).
  const journalAugmentHtml = journalAugmentFailed
    ? `<div class="sent-journal-warn" title="Journal fetch error: ${escAttr(journalAugmentError || 'unknown error')}">` +
      `&#9888; Journal data unavailable — QOF journal-coded indicators may show no data. Reload or check network.` +
      `</div>`
    : '';

  // Pre-consultation brief — rendered into its persistent slot (the action
  // bar sits directly beneath it).
  const brief = buildBrief(snapshot, _lastTrendData);
  setBriefSlot(brief ? renderBriefCard(brief) : '');

  // ── Data-derived state: always refreshed, even when the DOM write below is
  // skipped, so the one-time toolbar/delegated handlers act on current data. ──

  _renderCtx = { chips, patient, actionCount, trace };
  updateToolbarState();
  updateFooterTs(ts);
  updateRulesSlot();

  // Build evidence-key → chip lookup for this render so the click handler can
  // find the chip object without re-parsing DOM.
  _evidenceByKey = new Map();
  visibleChips.forEach((chip) => {
    if (!chip.evidence) return;
    const key = (chip.ruleId || '') + (chip.type === 'drug-monitoring' ? '|' + (chip.drugName || '') : '');
    _evidenceByKey.set(key, chip);
  });

  // Build trace-key → trace entry lookup. Drug-monitoring entries are keyed by
  // chipRef (ruleId|drugName); all other types are keyed by ruleId.
  _traceByKey = new Map();
  if (trace && Array.isArray(trace.entries)) {
    trace.entries.forEach((entry) => {
      if (!entry) return;
      if (entry.chipRef) _traceByKey.set(entry.chipRef, entry);
      if (entry.ruleId) _traceByKey.set(entry.ruleId, entry);
    });
  }

  // Rebuild the per-chip action-pack map (delegated click handler reads it).
  _chipActionsMap.clear();
  const actionNeededChips = visibleChips.filter((c) => isChipActionNeeded(c.status));
  actionNeededChips.forEach((chip) => {
    const key = (chip.ruleId || '') + (chip.type === 'drug-monitoring' ? '|' + (chip.drugName || '') : '');
    if (!key) return;
    const pack = buildChipActions(chip, patient, { letterhead: _letterhead });
    if (!pack) return;
    const chipName = chip.drugName || chip.indicatorCode || chip.displayName || chip.ruleName || chip.ruleId || 'chip';
    _chipActionsMap.set(key, { chip, pack, chipName });
  });

  // ── DOM write — skipped entirely when nothing visible changed, so open
  // modals, the overflow menu, evidence panels and scroll position survive
  // every poll tick that brings back the same data. ──

  const changed = setDynamic(
    patientHtml +
      headlineHtml +
      driftHtml +
      highRiskUnmatchedHtml +
      filterHtml +
      groupsHtml +
      emptyMsg +
      unmatchedHtml +
      extractionHtml +
      journalAugmentHtml
  );
  if (!changed) return;

  // Inject per-chip "Actions" buttons under each action-needed chip in the
  // fresh DOM. Chips with data-evidence-key are wired by ChipRenderer.
  container.querySelectorAll('.sent-chip[data-evidence-key]').forEach((chipEl) => {
    const key = chipEl.dataset.evidenceKey;
    if (!_chipActionsMap.has(key)) return; // not action-needed
    const nextSib = chipEl.nextElementSibling;
    if (nextSib && nextSib.classList.contains('sent-act-row')) nextSib.remove();
    const row = document.createElement('div');
    row.className = 'sent-act-row';
    row.dataset.actKey = key;
    row.innerHTML = `<button class="sent-act-btn" data-act-key="${escAttr(key)}" title="Copy-ready blood form, recall SMS, letter and task for this chip">Copy actions</button>`;
    chipEl.insertAdjacentElement('afterend', row);
  });

  // Drift banner dismiss: mute for 24h via shared storage key. The content
  // script's next publish reads mutedUntil and stops stamping drift, so the
  // 10s poll will not resurrect the banner once dismissed.
  container.querySelector('#sentDriftDismiss')?.addEventListener('click', async () => {
    const EH = window.ExtractionHealth;
    if (!EH) {
      container.querySelector('.sent-drift-banner')?.remove();
      return;
    }
    const r = await chrome.storage.local.get('sentinel.extractionBaseline');
    const muted = EH.muteBaseline(r['sentinel.extractionBaseline'] || null, new Date().toISOString());
    await chrome.storage.local.set({ 'sentinel.extractionBaseline': muted });
    container.querySelector('.sent-drift-banner')?.remove();
  });

  // "Verify in Medicus" banner button — focus the source tab (H-007 mitigation).
  container.querySelector('#sentVerifyBannerBtn')?.addEventListener('click', focusMedicusTab);

  // #sentRefreshBtn is handled by the persistent delegated click handler wired in
  // init() (_refreshBtnHandler); no per-render listener here (would double-fire).
  container.querySelectorAll('.sent-filter-btn[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      _openEvidenceKey = null; // filter change closes any open panel
      render(payload); // re-render with new filter
    });
  });

  // W7a: CSV export of the current patient's monitoring (parity with Referrals/
  // Trends). Client-side download only — no data leaves the browser.
  container.querySelector('#sentExportCsv')?.addEventListener('click', exportSentinelCsv);

  // Restore the evidence panel that was open before this re-render, if its chip
  // still exists in the new snapshot.
  if (_openEvidenceKey && _evidenceByKey.has(_openEvidenceKey)) {
    const chipEl = container.querySelector(`.sent-chip[data-evidence-key="${cssEscape(_openEvidenceKey)}"]`);
    if (chipEl) openEvidenceFor(chipEl, _openEvidenceKey);
    else _openEvidenceKey = null;
  } else {
    _openEvidenceKey = null;
  }

  // Restore the unmatched-meds <details> open state across re-renders.
  if (_unmatchedWasOpen) {
    const unmatchedEl = container.querySelector('.sent-unmatched-section');
    if (unmatchedEl) unmatchedEl.open = true;
  }

  // "N unmatched" in the audit headline is a live link into the existing
  // unmatched-meds section below — so the count is never a dead end (nurse +
  // pharmacist finding). Opens the <details> and scrolls it into view.
  container.querySelector('.sent-audit-unmatched-link')?.addEventListener('click', () => {
    const unmatchedEl = container.querySelector('.sent-unmatched-section');
    if (!unmatchedEl) return;
    unmatchedEl.open = true;
    unmatchedEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ── Patient Passport ──────────────────────────────────────────────────────────
// Builds the patient passport model, writes it to the transient
// 'sentinel.passport' key, then opens passport.html in a new tab.
// The key is left in place so a page-refresh of passport.html still works;
// it is overwritten on the next click.
// Mirror of sweep.js onPrintHandout — see that function for the pattern.
async function onPrintPassport(snapshot) {
  if (!snapshot) return;
  const model = buildPassport(snapshot, _lastTrendData);
  if (!model) return;
  await chrome.storage.local.set({ 'sentinel.passport': model });
  // best-effort PHI-at-rest backstop (audit L2) — primary clear is consume-on-read
  // in the print tab; this covers the case where the tab never renders.
  setTimeout(() => {
    chrome.storage.local.remove('sentinel.passport');
  }, 60000);
  chrome.tabs.create({ url: chrome.runtime.getURL('side-panel/modules/sentinel/passport.html') });
}

// ── Verify in Medicus ─────────────────────────────────────────────────────────
// Focuses the source Medicus tab without navigating it (H-007 mitigation).
// If the tab is gone, inserts a brief "not found" note instead of throwing.
async function focusMedicusTab() {
  if (_snapshotTabId == null) return;
  try {
    await chrome.tabs.update(_snapshotTabId, { active: true });
    if (_snapshotTabWindowId != null) {
      await chrome.windows.update(_snapshotTabWindowId, { focused: true });
    }
  } catch (_) {
    // Tab is gone — show a brief inline note near the banner verify button.
    // Both the panel and pop-out are extension pages where chrome.tabs/windows
    // APIs are always available; this path only fires when the tab was closed.
    const verifyBtn = container?.querySelector('#sentVerifyBannerBtn');
    if (verifyBtn) {
      verifyBtn.textContent = 'Medicus tab not found';
      verifyBtn.disabled = true;
      setTimeout(() => {
        if (verifyBtn.textContent === 'Medicus tab not found') {
          verifyBtn.textContent = 'Verify in Medicus ↗';
          verifyBtn.disabled = false;
        }
      }, 3000);
    }
    // Also handle any evidence-panel verify buttons that were clicked.
    const evVerifyBtns = container?.querySelectorAll('.sent-ev-verify-btn');
    evVerifyBtns?.forEach((btn) => {
      btn.textContent = 'Medicus tab not found';
      btn.disabled = true;
    });
  }
}

function cssEscape(s) {
  return String(s || '').replace(/(["\\\]])/g, '\\$1');
}

function attachEvidenceHandlers() {
  if (_evidenceHandlersAttached) return; // Idempotent; container persists across re-renders
  container.addEventListener('click', onEvidenceClick);
  container.addEventListener('keydown', onEvidenceKeydown);

  _evidenceKeydownHandler = (e) => {
    if (e.key === 'Escape' && _openEvidenceKey) closeOpenEvidence();
  };
  document.addEventListener('keydown', _evidenceKeydownHandler);
  _evidenceHandlersAttached = true;
}

function onEvidenceClick(e) {
  // Composite sub-rule drill-through: jump to that chip and open its panel.
  const refBtn = e.target.closest('.sent-ev-ref[data-ref-rule-id]');
  if (refBtn) {
    e.stopPropagation();
    const refId = refBtn.dataset.refRuleId;
    // Find a chip whose key starts with this ruleId (drug-monitoring keys also
    // include the drug name). Picks the first match — sufficient for v1.
    let targetKey = null;
    for (const k of _evidenceByKey.keys()) {
      if (k === refId || k.startsWith(refId + '|')) {
        targetKey = k;
        break;
      }
    }
    if (!targetKey) return;
    closeOpenEvidence();
    const targetEl = container.querySelector(`.sent-chip[data-evidence-key="${cssEscape(targetKey)}"]`);
    if (!targetEl) return;
    openEvidenceFor(targetEl, targetKey);
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // "Verify in Medicus" button inside the evidence panel
  if (e.target.closest('.sent-ev-verify-btn')) {
    e.stopPropagation();
    focusMedicusTab();
    return;
  }

  // Close button inside the panel
  if (e.target.closest('.sent-ev-close')) {
    e.stopPropagation();
    closeOpenEvidence();
    return;
  }

  // Click on a chip with evidence
  const chipEl = e.target.closest('.sent-chip[data-evidence-key]');
  if (!chipEl) return;
  const key = chipEl.dataset.evidenceKey;
  if (_openEvidenceKey === key) {
    closeOpenEvidence();
  } else {
    closeOpenEvidence();
    openEvidenceFor(chipEl, key);
  }
}

function onEvidenceKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const chipEl = e.target.closest('.sent-chip[data-evidence-key]');
  if (!chipEl || !container.contains(chipEl)) return;
  if (e.target !== chipEl) return; // only the chip itself, not inner buttons
  e.preventDefault();
  const key = chipEl.dataset.evidenceKey;
  if (_openEvidenceKey === key) closeOpenEvidence();
  else {
    closeOpenEvidence();
    openEvidenceFor(chipEl, key);
  }
}

function openEvidenceFor(chipEl, key) {
  const chip = _evidenceByKey.get(key);
  if (!chip || !chip.evidence) return;
  const CR = window.ChipRenderer;
  if (!CR || !CR.renderEvidencePanel) return;
  const panel = document.createElement('div');
  panel.className = 'sent-evidence-wrapper';
  panel.innerHTML = CR.renderEvidencePanel(chip.evidence);

  // Inject "Why?" block from trace entry before the footer.
  // Look up by chipRef (ruleId|drugName for drug-monitoring) first, then ruleId.
  if (CR.renderWhyBlock && _traceByKey.size > 0) {
    const traceEntry = _traceByKey.get(key) || _traceByKey.get(chip.ruleId);
    if (traceEntry) {
      const foot = panel.querySelector('.sent-ev-foot');
      if (foot) {
        const whyEl = document.createElement('div');
        whyEl.innerHTML = CR.renderWhyBlock(traceEntry);
        foot.insertAdjacentElement('beforebegin', whyEl);
      }
    }
  }

  // Inject "Verify in Medicus" button into the evidence panel footer.
  // This appears in addition to the banner button so the clinician can verify
  // directly from the expanded evidence view without scrolling up.
  if (_snapshotTabId != null) {
    const foot = panel.querySelector('.sent-ev-foot');
    if (foot) {
      const verifyEv = document.createElement('button');
      verifyEv.className = 'sent-ev-verify-btn';
      verifyEv.title = 'Check the source record before acting on this alert';
      verifyEv.textContent = 'Verify in Medicus ↗';
      verifyEv.addEventListener('click', (e) => {
        e.stopPropagation();
        focusMedicusTab();
      });
      foot.prepend(verifyEv);
    }
  }
  chipEl.insertAdjacentElement('afterend', panel);
  chipEl.setAttribute('aria-expanded', 'true');
  chipEl.classList.add('sent-chip-open');
  _openEvidenceKey = key;
}

function closeOpenEvidence() {
  if (!container) return;
  const open = container.querySelector('.sent-chip-open[data-evidence-key]');
  if (open) {
    open.setAttribute('aria-expanded', 'false');
    open.classList.remove('sent-chip-open');
    const next = open.nextElementSibling;
    if (next && next.classList.contains('sent-evidence-wrapper')) next.remove();
  }
  _openEvidenceKey = null;
}

// Inject a RESURFACED banner into a rendered chip HTML string. Inserted after
// the opening <div class="sent-chip ..."> tag so it appears at the top of the chip.
function injectResurfacedBanner(html) {
  return html.replace(
    /(<div\s[^>]*class="[^"]*sent-chip[^"]*"[^>]*>)/,
    `$1<div class="sent-chip-resurfaced" title="Status has worsened since this alert was dismissed">RESURFACED</div>`
  );
}

function renderChip(chip) {
  const col = STATUS_COLOUR[chip.status] || 'neutral';
  const lbl = STATUS_LABEL[chip.status] || (chip.status || '').toUpperCase();

  // Drug-monitoring, qof-indicator, and the v3 custom-alert chip types delegate
  // to the shared renderer to keep side-panel rendering in sync with previews.
  const CR = typeof window !== 'undefined' ? window.ChipRenderer : null;
  if (CR) {
    let html = null;
    if (chip.type === 'drug-monitoring') html = CR.renderDrugChip(chip);
    if (chip.type === 'qof-indicator') html = CR.renderQofIndicatorChip(chip);
    if (chip.type === 'drug-combo') html = CR.renderDrugComboChip(chip);
    if (chip.type === 'event-count') html = CR.renderEventCountChip(chip);
    if (chip.type === 'composite') html = CR.renderCompositeChip(chip);
    if (chip.type === 'vaccine') html = CR.renderVaccineChip(chip);
    if (html != null) return chip._resurfaced ? injectResurfacedBanner(html) : html;
  }

  // Resurfaced banner for fallback renderers
  const resurfacedHtml = chip._resurfaced
    ? `<div class="sent-chip-resurfaced" title="Status has worsened since this alert was dismissed">RESURFACED</div>`
    : '';

  if (chip.type === 'drug-monitoring') {
    const testLines = (chip.tests || [])
      .map((t) => {
        const tCol = STATUS_COLOUR[t.status] || 'neutral';
        const tLbl = STATUS_LABEL[t.status] || '';
        const dateStr = t.latestObs ? formatDate(t.latestObs.date) : '';
        const valStr =
          t.latestObs && t.latestObs.value != null
            ? ` · ${escHtml(String(t.latestObs.value).trim().slice(0, 30))}`
            : '';
        // E: Three-slot grid: name / status+value+date / days column
        const statusText = `${tLbl}${valStr}${dateStr ? ` · ${dateStr}` : ''}`;
        const daysText = t.days != null ? `${t.days}d` : '';
        return `<div class="sent-test-row">
        <span class="sent-test-name">${escHtml(t.testName || t.name || '')}</span>
        <span class="sent-test-status sent-test-${tCol}">${statusText}</span>
        <span class="sent-test-days sent-test-${tCol}">${daysText}</span>
      </div>`;
      })
      .join('');
    return `
      <div class="sent-chip sent-chip-${col}">
        ${resurfacedHtml}
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.drugName || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        ${chip.drugClass ? `<div class="sent-chip-cat">${escHtml(chip.drugClass)}</div>` : ''}
        ${testLines ? `<div class="sent-test-list">${testLines}</div>` : ''}
      </div>`;
  }

  if (chip.type === 'qof-indicator') {
    // Show the value + date. For overdue chips, flag that the result predates the QOF year start.
    const isOverdue = chip.status === 'overdue' || chip.status === 'not_met';
    const datePart = chip.dateText
      ? isOverdue && chip.qofYearStart && chip.dateText < chip.qofYearStart
        ? ` · ${escHtml(chip.dateText)} ⚠ before ${escHtml(chip.qofYearStart)}`
        : ` · ${escHtml(chip.dateText)}${chip.days != null ? ` (${chip.days}d ago)` : ''}`
      : '';
    const obs = chip.valueText
      ? `${escHtml(chip.valueText)}${datePart}`
      : chip.dateText
        ? datePart.replace(/^ · /, '')
        : '';
    const yearTag = chip.qofYear ? `<span class="sent-qof-year">QOF ${escHtml(chip.qofYear)}</span>` : '';
    return `
      <div class="sent-chip sent-chip-${col}">
        ${resurfacedHtml}
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.indicatorCode || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}${chip.points ? ` · ${chip.points}pt` : ''}</span>
        </div>
        ${chip.indicatorName ? `<div class="sent-chip-cat">${escHtml(chip.indicatorName)}${yearTag}</div>` : yearTag}
        ${obs ? `<div class="sent-chip-obs">${obs}</div>` : ''}
      </div>`;
  }

  if (chip.type === 'qof-register') {
    return `
      <div class="sent-chip sent-chip-${col}">
        ${resurfacedHtml}
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.registerName || chip.registerCode || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        ${chip.matchedProblem ? `<div class="sent-chip-cat">${escHtml(chip.matchedProblem)}</div>` : ''}
      </div>`;
  }

  return `
    <div class="sent-chip sent-chip-${col}">
      ${resurfacedHtml}
      <div class="sent-chip-head">
        <span class="sent-chip-name">${escHtml(chip.ruleName || chip.ruleId || '')}</span>
        <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
      </div>
    </div>`;
}

// ── Pre-consultation brief card ──────────────────────────────────────────────

// Render the brief card HTML from a brief object (output of buildBrief()).
// Returns an HTML string with CSS prefix sent-brief-*.
function renderBriefCard(brief) {
  const collapsed = _briefCollapsed;

  // Header: "Brief" label + patientLine + red/amber count badges
  const patPart = brief.patientLine
    ? ` <span class="sent-brief-patient" title="${escAttr(brief.patientLine)}">${escHtml(brief.patientLine)}</span>`
    : '';

  // Count badges — include text labels for colour-blind safety
  const redBadge =
    brief.counts.red > 0 ? `<span class="sent-brief-badge sent-brief-badge-red">${brief.counts.red} red</span>` : '';
  const amberBadge =
    brief.counts.amber > 0
      ? `<span class="sent-brief-badge sent-brief-badge-amber">${brief.counts.amber} amber</span>`
      : '';

  const chevron = collapsed ? '▶' : '▼';

  const headerHtml = `
    <div class="sent-brief-header" id="sentBriefHeader" role="button" tabindex="0" aria-expanded="${!collapsed}" aria-controls="sentBriefBody">
      <span class="sent-brief-label">Brief</span>
      ${patPart}
      <span class="sent-brief-badges">${redBadge}${amberBadge}</span>
      <span class="sent-brief-chevron" aria-hidden="true">${chevron}</span>
    </div>`;

  if (collapsed) {
    return `<div class="sent-brief-card sent-brief-collapsed">${headerHtml}</div>`;
  }

  // Signal lines: severity dot + text
  const signalLines = brief.signals
    .map(
      (sig) =>
        `<div class="sent-brief-signal sent-brief-signal-${escHtml(sig.severity)}">` +
        `<span class="sent-brief-dot" aria-hidden="true"></span>` +
        `<span class="sent-brief-signal-text">${escHtml(sig.text)}</span>` +
        `</div>`
    )
    .join('');

  // Trend notes: ↑/↓ arrows + text
  const trendLines = brief.trendNotes
    .map(
      (note) =>
        `<div class="sent-brief-trend">` +
        `<span class="sent-brief-trend-arrow" aria-hidden="true">${note.direction === 'up' ? '↑' : '↓'}</span>` +
        `<span class="sent-brief-trend-text">${escHtml(note.text)}</span>` +
        `</div>`
    )
    .join('');

  // "+N more below" text (plain, not a link). R6: when some of the hidden
  // chips are RED, annotate the count so a red item is never silently swallowed.
  const moreLine =
    brief.moreCount > 0
      ? `<div class="sent-brief-more">+${brief.moreCount} more${brief.moreRed > 0 ? ` (${brief.moreRed} red)` : ''} below</div>`
      : '';

  const bodyHtml = `
    <div class="sent-brief-body" id="sentBriefBody">
      ${signalLines}
      ${trendLines}
      ${moreLine}
    </div>`;

  return `<div class="sent-brief-card">${headerHtml}${bodyHtml}</div>`;
}

// Attach the brief card toggle handler after render. Idempotent — safe to call on every render.
function attachBriefToggle() {
  const header = container?.querySelector('#sentBriefHeader');
  if (!header) return;
  const toggle = async () => {
    _briefCollapsed = !_briefCollapsed;
    await chrome.storage.local.set({ 'sentinel.briefCollapsed': _briefCollapsed });
    // Re-render just the brief card (surgical update avoids full re-render).
    const card = container.querySelector('.sent-brief-card');
    if (card && _currentSnapshot) {
      const brief = buildBrief(_currentSnapshot, _lastTrendData);
      if (brief) {
        const newHtml = document.createElement('div');
        newHtml.innerHTML = renderBriefCard(brief);
        const newCard = newHtml.firstElementChild;
        if (newCard) {
          card.replaceWith(newCard);
          attachBriefToggle(); // re-attach to new DOM node
        }
      }
    }
  };
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
}

// ── Persistent scaffold ───────────────────────────────────────────────────────
// Rendered once per module life in init(). render() only ever rewrites
// #sentDynamic; the header/toolbar, waiting-room slot, footer and modal host
// survive every refresh untouched (anti-flicker contract).

function toolIcon(paths) {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

const TOOL_ICONS = {
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  calendar:
    '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  clipboard:
    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  printer:
    '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
};

function scaffoldHtml() {
  // Order: header → brief slot → action bar → wr slot → dynamic content → footer → modal host.
  // Brief comes first so the action bar is always anchored directly beneath the
  // pre-consultation summary. The waiting-room block sits below (still prominent,
  // now de-amberised so it doesn't compete with clinical chip salience).
  return `<div class="module-wrap sent-module">
    <div class="sent-header">
      <div class="sent-header-row">
        <div class="sent-header-id">
          <div class="mod-eyebrow">Clinical Monitoring</div>
          <div class="mod-title">Monitoring</div>
        </div>
        <div class="sent-header-meta">
          <button class="sent-tool-btn" id="sentRefreshBtn" title="Refresh now (the panel also refreshes itself every 10 seconds)" aria-label="Refresh">${toolIcon(TOOL_ICONS.refresh)}</button>
        </div>
      </div>
    </div>
    <div id="sentBriefSlot"></div>
    <div class="sent-actionbar" role="toolbar" aria-label="Patient actions">
      <button class="sent-action-btn" id="sentApptSummaryBtn" disabled title="Copyable list of the appointments this patient is due, for admin to book">${toolIcon(TOOL_ICONS.calendar)}<span>Appointments</span></button>
      <button class="sent-action-btn" id="sentCopyAllActionsBtn" disabled title="Copy-ready blood forms, recall SMS and tasks for every alert needing action">${toolIcon(TOOL_ICONS.clipboard)}<span>Copy actions</span></button>
      <button class="sent-action-btn" id="sentPrintPassportBtn" disabled title="Print a plain-English health summary to hand to the patient">${toolIcon(TOOL_ICONS.printer)}<span>Print summary</span></button>
      <div class="sent-overflow-wrap">
        <button class="sent-action-btn" id="sentOverflowBtn" title="More tools" aria-haspopup="menu" aria-expanded="false">${toolIcon(TOOL_ICONS.more)}<span>More</span></button>
        <div class="sent-overflow-menu" id="sentOverflowMenu" hidden role="menu" aria-label="More tools">
          <button class="sent-menu-item" id="sentSettingsBtn" role="menuitem" title="Open the extension's settings page">Monitoring settings</button>
          <button class="sent-menu-item" id="sentExportLogBtn" role="menuitem" disabled title="Download this patient's rule-evaluation trace as JSON. Contains patient-identifiable data — handle per your practice's IG policy">Export evaluation log</button>
          <div class="sent-menu-sep" role="separator"></div>
          <button class="sent-menu-item" id="sentTourBtn" role="menuitem" title="Step through the suite walkthrough again">Replay the guided tour</button>
        </div>
      </div>
    </div>
    <div id="sentWrSlot">${renderWaitingRoomBlock()}</div>
    <div id="sentDynamic" aria-live="polite"></div>
    <div class="sent-footer">
      <span class="sent-ts" id="sentFooterTs"></span>
      <span class="sent-rules-slot" id="sentRulesSlot"></span>
    </div>
    <div id="sentModalHost"></div>
  </div>`;
}

// Wire the toolbar exactly once per module life (scaffold is never re-rendered).
// Handlers read _renderCtx / _currentSnapshot at click time, so they stay
// current without any per-render re-wiring.
function wireToolbar() {
  const $ = (id) => container.querySelector('#' + id);

  $('sentApptSummaryBtn')?.addEventListener('click', () => {
    if (!_renderCtx) return;
    showAdminSummaryModal(buildAdminSummaryText(_renderCtx.chips, _renderCtx.patient));
  });
  $('sentCopyAllActionsBtn')?.addEventListener('click', () => {
    if (!_renderCtx) return;
    showAllActionsModal(_renderCtx.chips, _renderCtx.patient);
  });
  $('sentPrintPassportBtn')?.addEventListener('click', () => {
    if (_currentSnapshot) onPrintPassport(_currentSnapshot);
  });
  $('sentSettingsBtn')?.addEventListener('click', () => {
    closeOverflowMenu();
    // Deep-link straight to the Monitoring section (openOptionsPage always
    // lands on the default Suite tab) — options.js resolves #sect-sentinel.
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sect-sentinel') });
  });
  $('sentExportLogBtn')?.addEventListener('click', () => {
    closeOverflowMenu();
    exportEvaluationLog();
  });
  $('sentTourBtn')?.addEventListener('click', () => {
    closeOverflowMenu();
    startTour();
  });

  $('sentOverflowBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOverflowMenu();
  });
  _menuCloseHandler = (e) => {
    if (!e.target.closest?.('.sent-overflow-wrap')) closeOverflowMenu();
  };
  document.addEventListener('click', _menuCloseHandler);
  _menuKeyHandler = (e) => {
    if (e.key === 'Escape') closeOverflowMenu();
  };
  document.addEventListener('keydown', _menuKeyHandler);
}

function toggleOverflowMenu() {
  const menu = container?.querySelector('#sentOverflowMenu');
  const btn = container?.querySelector('#sentOverflowBtn');
  if (!menu || !btn) return;
  menu.hidden = !menu.hidden;
  btn.setAttribute('aria-expanded', String(!menu.hidden));
}

function closeOverflowMenu() {
  const menu = container?.querySelector('#sentOverflowMenu');
  const btn = container?.querySelector('#sentOverflowBtn');
  if (menu && !menu.hidden) {
    menu.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
  }
}

// Enable/disable toolbar actions to match the current data context.
// When there is no data context (_renderCtx is null) the action bar is hidden entirely
// via the .sent-actionbar-empty class — no point showing disabled buttons in non-data states.
function updateToolbarState() {
  if (!container) return;
  const ctx = _renderCtx;
  const set = (id, enabled) => {
    const b = container.querySelector('#' + id);
    if (b) b.disabled = !enabled;
  };
  set('sentApptSummaryBtn', !!ctx);
  set('sentCopyAllActionsBtn', !!ctx && ctx.actionCount > 0);
  set('sentPrintPassportBtn', !!ctx && !!ctx.patient);
  set('sentExportLogBtn', !!ctx && !!ctx.trace);

  // Hide the whole action bar when there is nothing to act on (no data context).
  const actionbar = container.querySelector('.sent-actionbar');
  if (actionbar) {
    if (!ctx) {
      actionbar.classList.add('sent-actionbar-empty');
    } else {
      actionbar.classList.remove('sent-actionbar-empty');
    }
  }
}

// Download the current snapshot's rule-evaluation trace as a JSON file.
function exportEvaluationLog() {
  const trace = _renderCtx?.trace;
  if (!trace) return;
  const pc = _currentSnapshot && _currentSnapshot.patientContext;
  const id = (pc && (pc.nhsNumber || pc.patientUuid || pc.uuid)) || 'unknown';
  const safeId = String(id).replace(/[^a-zA-Z0-9-]/g, '');
  const today = new Date().toISOString().slice(0, 10);
  const filename = `sentinel-evaluation-log-${safeId}-${today}.json`;
  const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function statusBlock(level, heading, body) {
  if (level === 'idle') {
    // J: Canon empty-state for idle states — centered, mono label, Feather monitor icon
    return `<div class="sent-idle-state">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      <div class="sent-idle-heading">${escHtml(heading)}</div>
      <div class="sent-idle-body">${escHtml(body)}</div>
    </div>`;
  }
  // J: Error/degraded — left-aligned banner format, byte-identical copy preserved, class-based (no inline style)
  return `<div class="sentinel-status ${level}">
    <div class="status-dot"></div>
    <span class="status-text">${escHtml(heading)}</span>
  </div>
  <p class="sent-status-body">${escHtml(body)}</p>`;
}

function formatDate(s) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return s;
  }
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

// Cached feedback email (suite.feedbackEmail) loaded at render time.
// Undefined = not yet attempted; null = loaded, not set; string = address.
let _feedbackEmail;
function ensureFeedbackEmailLoaded() {
  if (_feedbackEmail !== undefined) return;
  _feedbackEmail = null; // mark as load-attempted
  chrome.storage.local.get('suite.feedbackEmail', (r) => {
    const addr = (r['suite.feedbackEmail'] || '').trim();
    if (addr) {
      _feedbackEmail = addr;
      // Trigger a re-render if container is active so the link appears
      if (container) refresh();
    }
  });
}

// Render the collapsed-by-default "Meds without a monitoring rule" section in
// the side panel. Informational only — neutral, not red/amber.
// Surfaces the key silent-failure mode (unlisted brand → no alert) without noise.
// Most medicines need no monitoring — this list exists to spot brand names that
// SHOULD have matched a monitoring rule but didn't. A "Report a possible missing
// brand" mailto link is included when a feedback email address is configured.
// When unmatchedDetailed is provided, excluded meds are annotated in amber.
// Blind-spot guard: a prominent red banner for high-risk drugs that matched no
// monitoring rule, so no overdue-blood chip could ever fire for them. The list
// is a strict subset of the unmatched-meds section below; this just stops the
// dangerous ones from hiding inside a collapsed "N unmatched" list.
// W7a: flatten the current snapshot's chips into a CSV the clinician can keep
// (e.g. a weekly overdue-monitoring list). One row per drug-test, one per other
// chip. Client-side only — uses the shared downloadCsv helper, nothing leaves
// the browser. The patient name is included exactly as Referrals' CSV does, and
// only on the clinician's own explicit download.
function exportSentinelCsv() {
  const snap = _currentSnapshot;
  if (!snap || !Array.isArray(snap.chips) || snap.chips.length === 0) return;
  const pc = snap.patientContext || {};
  const patient =
    [pc.firstName || pc.givenName, pc.lastName || pc.familyName].filter(Boolean).join(' ') || pc.name || '';
  const header = ['Patient', 'Category', 'Item', 'Test', 'Status', 'Value', 'Last result', 'Due'];
  const rows = [];
  for (const c of snap.chips) {
    if (!c) continue;
    const category = c.type || '';
    const item = c.drugName || c.indicatorName || c.name || c.ruleId || '';
    if (c.type === 'drug-monitoring' && Array.isArray(c.tests) && c.tests.length) {
      for (const t of c.tests) {
        const last = t.latestObs && t.latestObs.date ? t.latestObs.date : '';
        let due = '';
        if (t.latestObs && t.latestObs.date && t.intervalDays) {
          const base = new Date(t.latestObs.date);
          if (!isNaN(base.getTime())) due = new Date(base.getTime() + t.intervalDays * 86400000).toISOString().slice(0, 10);
        }
        const value = t.latestObs && t.latestObs.value != null ? String(t.latestObs.value).trim() : '';
        rows.push([patient, category, item, t.testName || t.name || '', t.status || '', value, last, due]);
      }
    } else {
      rows.push([patient, category, item, '', c.status || '', '', c.dateText || '', '']);
    }
  }
  if (!rows.length) return;
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(`sentinel-${stamp}.csv`, header, rows);
}

function renderHighRiskUnmatchedBanner(highRisk) {
  if (!Array.isArray(highRisk) || highRisk.length === 0) return '';
  const items = highRisk
    .map((h) => {
      const why =
        h.reason === 'excluded' && h.excludedBy
          ? `excluded by &lsquo;${escHtml(h.excludedBy.term)}&rsquo; (rule ${escHtml(h.excludedBy.ruleId)})`
          : 'no monitoring rule matched';
      // W1: if a different, already-monitored med on this same patient shares
      // the risk stem, say so — most likely a brand/duplicate of a drug that IS
      // being tracked under another name, not a second unmonitored course.
      const dupHtml = h.possibleDuplicateOf
        ? ` <span class="sent-hrisk-dup">&mdash; possibly the same as <strong>${escHtml(
            h.possibleDuplicateOf
          )}</strong> monitored below; check for a duplicate repeat in Medicus</span>`
        : '';
      return (
        `<li><strong>${escHtml(h.name)}</strong> ` +
        `<span class="sent-hrisk-class">${escHtml(h.riskClass)}</span> ` +
        `<span class="sent-hrisk-why">&mdash; ${why}</span>${dupHtml}</li>`
      );
    })
    .join('');
  const n = highRisk.length;
  return `
    <div class="sent-hrisk-banner" role="alert">
      <div class="sent-hrisk-head">&#9888; ${n} high-risk medicine${n === 1 ? '' : 's'} with no monitoring rule</div>
      <ul class="sent-hrisk-list">${items}</ul>
      <p class="sent-hrisk-note">These drugs normally require monitoring but matched no active rule, so Sentinel cannot track their bloods &mdash; <strong>verify monitoring is in place in Medicus</strong> and consider adding the brand to the rule set. ${escHtml(NO_ALERT_CAVEAT)}</p>
    </div>`;
}

function renderUnmatchedMedsSection(meds, unmatchedDetailed) {
  ensureFeedbackEmailLoaded();
  if (!meds || meds.length === 0) return '';

  // Build item list. Use detailed data when available for exclude annotations.
  const detailedMap = new Map();
  if (unmatchedDetailed && unmatchedDetailed.length > 0) {
    unmatchedDetailed.forEach((u) => detailedMap.set(u.name, u));
  }

  const items = meds
    .map((n) => {
      const detail = detailedMap.get(n);
      if (detail && detail.reason === 'excluded' && detail.excludedBy) {
        const annotation = escHtml(`excluded by '${detail.excludedBy.term}' (rule ${detail.excludedBy.ruleId})`);
        return `<li>${escHtml(n)} <span class="sent-unmatched-excluded">${annotation}</span></li>`;
      }
      return `<li>${escHtml(n)}</li>`;
    })
    .join('');

  let mailtoLink = '';
  if (_feedbackEmail) {
    const subject = encodeURIComponent('Possible missing monitoring rule brand');
    const body = encodeURIComponent(
      'The following medication(s) appeared in a patient record without matching a monitoring rule. Please check whether a brand name should be added:\n\n' +
        meds.join('\n')
    );
    mailtoLink = ` <a class="sent-unmatched-report" href="mailto:${escHtml(_feedbackEmail)}?subject=${subject}&body=${body}">Report a possible missing brand</a>`;
  }
  return `
    <details class="sent-unmatched-section">
      <summary class="sent-unmatched-summary">Meds without a monitoring rule (${meds.length})</summary>
      <div class="sent-unmatched-body">
        <p class="sent-unmatched-note">These medicines were read from the record successfully — they simply did not map to a monitoring rule, which for most medicines is correct (they need no routine monitoring). The list exists so you can spot a brand name that SHOULD have matched a rule but didn't.${mailtoLink}</p>
        <ul class="sent-unmatched-list">${items}</ul>
      </div>
    </details>`;
}
