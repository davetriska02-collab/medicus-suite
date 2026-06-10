// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sentinel side panel module
// Polls the Sentinel content script for its chip snapshot and renders it here.

'use strict';

import { STATUS_RANK, buildAdminSummaryText } from './sentinel-core.js';

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

function showAdminSummaryModal(text) {
  const moduleEl = container.querySelector('.sent-module');
  if (!moduleEl) return;
  moduleEl.querySelector('.sent-appt-modal')?.remove();

  const modal = document.createElement('div');
  modal.className = 'sent-appt-modal';
  modal.innerHTML = `
    <div class="sent-appt-modal-inner">
      <div class="sent-appt-modal-head">
        <span class="sent-appt-modal-title">Appointments summary</span>
        <button class="sent-appt-modal-close" id="sentApptModalClose" aria-label="Close">&#x2715;</button>
      </div>
      <textarea class="sent-appt-modal-text" id="sentApptModalText" readonly spellcheck="false">${escHtml(text)}</textarea>
      <div class="sent-appt-modal-foot">
        <button class="sent-appt-modal-copy" id="sentApptModalCopy">Copy to clipboard</button>
      </div>
    </div>`;

  moduleEl.appendChild(modal);

  modal.querySelector('#sentApptModalClose').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
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

let container = null;
let pollTimer = null;
let currentFilter = 'all'; // all | action | clear
let _refreshBtnHandler = null;

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
let _dismissHandler = null;
let _hiddenStorageListener = null;

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
  render({ state: 'loading' });

  // Start waiting room fetch in parallel with sentinel chip poll
  fetchWaitingRoom();
  wrPollTimer = setInterval(fetchWaitingRoom, WR_POLL_MS);

  // Load rule currency footer once — non-blocking; re-renders will pick it up.
  loadRuleCurrencyFooter();

  await loadHiddenRules();
  await refresh();
  pollTimer = setInterval(refresh, 10000);
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onUpdated.addListener(onUpdated);

  // Listen for refresh signals: waiting-room polls (Pusher) + sentinel snapshot
  // updates pushed by the content script when the patient context changes.
  const onMsg = (msg) => {
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

  // Re-render when hidden rules change (e.g. re-enabled from settings).
  _hiddenStorageListener = (changes, area) => {
    if (area === 'local' && changes['sentinel.hiddenRules']) {
      _hiddenRules = changes['sentinel.hiddenRules'].newValue || {};
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
  if (_refreshBtnHandler) {
    document.removeEventListener('click', _refreshBtnHandler);
    _refreshBtnHandler = null;
  }
  if (_dismissHandler) {
    document.removeEventListener('click', _dismissHandler, true);
    _dismissHandler = null;
  }
  if (_hiddenStorageListener) {
    chrome.storage.onChanged.removeListener(_hiddenStorageListener);
    _hiddenStorageListener = null;
  }
  if (_evidenceKeydownHandler) {
    document.removeEventListener('keydown', _evidenceKeydownHandler);
    _evidenceKeydownHandler = null;
  }
  _evidenceHandlersAttached = false;
  _openEvidenceKey = null;
  _evidenceByKey.clear();
  _traceByKey.clear();
  _currentSnapshot = null;
  _snapshotTabId = null;
  _snapshotTabWindowId = null;
  _ruleCurrencyFooter = null;
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

    const summaryText = [qofLabel, drugDateLabel ? `drug rules ${drugDateLabel}` : ''].filter(Boolean).join(' · ');

    if (result.overall === 'red') {
      _ruleCurrencyFooter =
        `<div class="sent-rules-footer sent-rules-footer-red" title="${escHtml(result.warnings.join(' | '))}">` +
        `<span class="sent-rules-footer-icon">&#9888;</span> ` +
        `Rules: ${escHtml(summaryText)} — ${escHtml(result.warnings[0] || 'urgent review needed')}` +
        `</div>`;
    } else if (result.overall === 'amber') {
      _ruleCurrencyFooter =
        `<div class="sent-rules-footer sent-rules-footer-amber" title="${escHtml(result.warnings.join(' | '))}">` +
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
    wrError = e.message;
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

function renderWaitingRoomBlock() {
  const patients = wrPatients;
  if (patients === null) {
    // Still loading — show a slim skeleton
    return `<div class="wr-pinned wr-loading">
      <div class="wr-pin-row">
        <span class="wr-pin-icon">⏳</span>
        <span class="wr-pin-label">Waiting room loading…</span>
      </div>
    </div>`;
  }

  if (wrError && patients.length === 0) {
    return `<div class="wr-pinned wr-error">
      <div class="wr-pin-row">
        <span class="wr-pin-icon">⚠</span>
        <span class="wr-pin-label">${escHtml(wrError)}</span>
      </div>
    </div>`;
  }

  if (patients.length === 0) {
    return `<div class="wr-pinned wr-clear">
      <div class="wr-pin-row">
        <span class="wr-pin-icon">✓</span>
        <span class="wr-pin-label">Waiting room clear</span>
        <span class="wr-pin-ts">${wrLastFetch ? new Date(wrLastFetch).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
    </div>`;
  }

  const maxWait = Math.max(...patients.map((p) => p.minutesWaiting ?? 0));
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
      <span class="wr-pin-icon">🚶</span>
      <span class="wr-pin-label"><strong>${patients.length}</strong> waiting${urgentNote}</span>
      <span class="wr-pin-ts">${wrLastFetch ? new Date(wrLastFetch).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
    </div>
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

function render(payload) {
  if (!container) return;
  const { state, snapshot, message } = payload;

  if (state === 'loading') {
    container.innerHTML = shell(
      '',
      `<div class="sent-skeleton">${Array(4).fill('<div class="sent-skel-chip"></div>').join('')}</div>`
    );
    return;
  }
  if (state === 'no-medicus') {
    container.innerHTML = shell('', statusBlock('idle', 'No Medicus tab active', 'Open Medicus to use Sentinel.'));
    return;
  }
  if (state === 'not-mounted') {
    container.innerHTML = shell(
      '',
      statusBlock('idle', 'Navigate to a patient record', 'Sentinel activates on patient record and triage task pages.')
    );
    return;
  }
  if (state === 'no-chips') {
    container.innerHTML = shell(
      '',
      statusBlock('idle', 'Loading patient data…', 'This panel refreshes automatically.')
    );
    return;
  }
  if (state === 'error') {
    container.innerHTML = shell('', statusBlock('error', 'Could not connect to Sentinel', message || ''));
    return;
  }
  if (state === 'degraded') {
    // H-005: a patient was identified but nothing could be extracted. This must
    // be surfaced as a warning, never as a benign empty — see classifySnapshot.
    const reason =
      (snapshot && snapshot.reason) ||
      'A patient was identified, but no medications, problems, observations or demographics could be extracted from this page — Medicus may have changed its layout.';
    container.innerHTML = shell(
      '',
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
    trace,
    drift,
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

  // Group by type
  const groups = {};
  visibleChips.forEach((chip) => {
    const g = chip.type || 'other';
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
    <div class="sent-filter-bar">
      <button class="sent-filter-btn${currentFilter === 'all' ? ' active' : ''}" data-filter="all">All (${chips.length})</button>
      <button class="sent-filter-btn${currentFilter === 'action' ? ' active action' : ''}" data-filter="action">Needs action (${actionCount})</button>
      <button class="sent-filter-btn${currentFilter === 'clear' ? ' active clear' : ''}" data-filter="clear">In date (${clearCount})</button>
    </div>`;

  const typeOrder = [
    'drug-combo',
    'event-count',
    'composite',
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
    'drug-monitoring': 'Drug Monitoring',
    vaccine: 'Vaccinations',
    'qof-indicator': 'QOF Indicators',
    'qof-process-indicator': 'QOF Process',
    'qof-register': 'Registers',
  };

  const groupsHtml = typeOrder
    .filter((t) => groups[t]?.length)
    .map(
      (t) => `
      <section class="sent-group${t === 'qof-register' ? ' sent-group-dim' : ''}">
        <div class="sent-group-label">${typeLabelMap[t] || t}</div>
        <div class="sent-chip-list">${groups[t].map(renderChip).join('')}</div>
      </section>`
    )
    .join('');

  const ts = evaluatedAt
    ? new Date(evaluatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';
  const emptyMsg =
    visibleChips.length === 0
      ? `<div class="sent-empty">${currentFilter === 'action' ? 'No items needing action.' : currentFilter === 'clear' ? 'No items in date.' : 'No chips for this patient.'}</div>`
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

  // Rule currency footer (one line, neutral if green, amber with first warning if amber).
  const currencyFooterHtml = _ruleCurrencyFooter || '';

  container.innerHTML = shell(
    patientHtml + driftHtml + filterHtml,
    groupsHtml +
      emptyMsg +
      unmatchedHtml +
      extractionHtml +
      currencyFooterHtml +
      `
    <div class="sent-footer">
      <div class="sent-footer-left">
        <button class="ghost-btn" id="sentSettingsBtn">Settings →</button>
        <button class="ghost-btn" id="sentApptSummaryBtn" title="Generate a summary for admin to arrange monitoring appointments">Appts summary</button>
        <button class="ghost-btn" id="sentExportLogBtn" title="Contains patient-identifiable data — handle per your practice's IG policy." ${trace ? '' : 'disabled'}>Export evaluation log</button>
      </div>
      <span class="sent-ts">${ts ? `Data at ${ts}` : ''}</span>
    </div>`
  );

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

  container.querySelector('#sentSettingsBtn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  container
    .querySelector('#sentApptSummaryBtn')
    ?.addEventListener('click', () => showAdminSummaryModal(buildAdminSummaryText(chips, patient)));

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

  // Export evaluation log button: download the trace as a JSON file.
  const exportLogBtn = container.querySelector('#sentExportLogBtn');
  if (exportLogBtn) {
    if (trace) {
      exportLogBtn.disabled = false;
      exportLogBtn.addEventListener('click', () => {
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
      });
    } else {
      exportLogBtn.disabled = true;
    }
  }

  // "Verify in Medicus" banner button — focus the source tab (H-007 mitigation).
  container.querySelector('#sentVerifyBannerBtn')?.addEventListener('click', focusMedicusTab);

  // #sentRefreshBtn is handled by the persistent delegated click handler wired in
  // init() (_refreshBtnHandler); no per-render listener here (would double-fire).
  container.querySelectorAll('.sent-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      _openEvidenceKey = null; // filter change closes any open panel
      render(payload); // re-render with new filter
    });
  });

  attachEvidenceHandlers();

  // Restore the evidence panel that was open before this re-render, if its chip
  // still exists in the new snapshot.
  if (_openEvidenceKey && _evidenceByKey.has(_openEvidenceKey)) {
    const chipEl = container.querySelector(`.sent-chip[data-evidence-key="${cssEscape(_openEvidenceKey)}"]`);
    if (chipEl) openEvidenceFor(chipEl, _openEvidenceKey);
    else _openEvidenceKey = null;
  } else {
    _openEvidenceKey = null;
  }
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
        const dayStr = t.days != null ? ` · ${t.days}d` : '';
        return `<div class="sent-test-row">
        <span class="sent-test-name">${escHtml(t.testName || t.name || '')}</span>
        <span class="sent-test-status sent-test-${tCol}">${tLbl}${valStr}${dateStr ? ` · ${dateStr}${dayStr}` : ''}</span>
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

function shell(top, inner) {
  return `<div class="module-wrap sent-module">
    <div class="sent-header-row">
      <div class="mod-eyebrow">Clinical Monitoring</div>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="module-ver">v0.4.2</span>
        <button class="icon-btn" id="sentRefreshBtn" title="Refresh">↻</button>
      </div>
    </div>
    <div class="mod-title" style="margin-bottom:10px">Monitoring</div>
    ${renderWaitingRoomBlock()}
    ${top}${inner}
  </div>`;
}

function statusBlock(level, heading, body) {
  return `<div class="sentinel-status ${level}" style="margin-bottom:12px">
    <div class="status-dot"></div>
    <span class="status-text">${escHtml(heading)}</span>
  </div>
  <p style="font-size:12px;color:var(--text-3);line-height:1.6">${escHtml(body)}</p>`;
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
        <p class="sent-unmatched-note">Most medicines need no routine monitoring — this list exists to spot brand names that SHOULD have matched a monitoring rule but didn't.${mailtoLink}</p>
        <ul class="sent-unmatched-list">${items}</ul>
      </div>
    </details>`;
}
