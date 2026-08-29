// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sweep module (pre-clinic monitoring sweep)
//
// Runs the Sentinel rules engine across today's booked patients from the
// practice appointment book (optionally filtered to one clinician), producing
// a morning-huddle worklist so overdue monitoring can be arranged BEFORE
// clinic rather than discovered during consultation.
//
// v3.40.2: switched from /homepage/my-appointments (per-clinician diary —
// silently empty for users without a booked clinic) to the practice-wide
// appointment book.
// v3.40.3: fixed clinician dropdown (pre-populated on init before first run);
// fixed clinician column (was never propagated to rendered rows); added
// sequential sweep — patients are processed in batches of BATCH_SIZE (40)
// with a "Check next N patients" button so large lists can be fully covered.
//
// Design decisions:
//  - Manual trigger ONLY (no auto-run, no polling) — polite to the API.
//  - Sequential per-patient fetches with ~250 ms gap, BATCH_SIZE (40) per run.
//  - Clinician dropdown pre-populated on module load via a background fetch.
//  - Sequential sweep: _allPatients holds the full sorted list; _sweepOffset
//    tracks progress. Continue picks up where the last batch finished without
//    re-fetching the appointment book.
//  - Does NOT apply sentinel.hiddenRules suppression (a recall worklist must
//    not inherit per-workstation dismissals), but flags when hidden rules
//    would cover action chips so the clinician is not confused.
//  - Results are ephemeral (in-memory only). The single exception is the
//    transient 'sweep.handout' key: the printable reception handout payload,
//    written on "Print reception handout" and read once by handout.html in a
//    new tab (overwritten on each print; allowlisted in test-backup-coverage).
//  - Evaluation path: SentinelApiClient.fetchAll → SentinelNormalisers.normaliseAll
//    → SentinelRules.evaluatePatient — identical to sentinel.js / content-scripts.
//  - Transactional feed (shared/panel-txn-feed.js): before the session fetch,
//    each patient is offered the official Transactional API bundle via
//    getTxnBundleIfEnabled(). It returns null in every case except a practice
//    explicitly on integrationMode 'transactional' with a healthy feed, so
//    non-transactional practices take the session path exactly as before.
//    Per-row provenance ('API' vs 'session') is badged in the UI and rolled
//    up in the run summary.
//  - Rule loading: SentinelRulesetIo.mergeRules with canonical JSON + overrides,
//    identical to the loadRules() path in sentinel.js.

'use strict';

import { fetchSchedulingOverview, todayISO } from '../../../shared/medicus-api.js';
import {
  extractBookedPatients,
  summariseSweep,
  summariseQofPointsAtRisk,
  qofPoundsValue,
  summariseWorklistByAction,
  buildWorklist,
  buildRecallDescription,
  isActionNeeded,
  buildHandout,
  MAX_SWEEP_PATIENTS,
} from './sweep-core.js';
import { buildBatchPack } from '../shared/action-packs.js';
import { fetchTaskCreateForm, createGeneralTask } from '../../../shared/task-api.js';
import { getTxnBundleIfEnabled, feedSourceLabel } from '../../../shared/panel-txn-feed.js';

// Canonical "no alert ≠ monitoring complete" caveat (shared/provenance.js,
// loaded as a classic script in panel.html / pop-out.html). Fall back to the
// canonical literal if the global is somehow absent — a clinical-safety caveat
// must never silently drop.
const NO_ALERT_CAVEAT =
  (typeof window !== 'undefined' && window.Provenance && window.Provenance.CAVEATS.NO_ALERT_NOT_ALL_CLEAR) ||
  'No alert ≠ monitoring complete.';

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = MAX_SWEEP_PATIENTS; // patients evaluated per batch (40)

// sweep.lastRun — transient session state, PHI-bearing, TTL 2 h.
// Never backed up (allowlisted in test-backup-coverage.js).
const LAST_RUN_KEY = 'sweep.lastRun';
const LAST_RUN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── Module state ──────────────────────────────────────────────────────────────

let container = null;
let _abortFlag = false; // set to true to stop the in-progress sweep loop
let _selectedClinicians = []; // array of clinician names; [] = all clinicians
let _clinicianList = []; // clinicians booked for the current day (for the picker)
let _selectedDate = todayISO(); // YYYY-MM-DD — day being swept (defaults to today)
let _running = false; // true while a batch is in progress

// Sequential sweep state — preserved across "Continue" clicks within one session
let _allPatients = []; // full sorted patient list from last appointment-book fetch
let _sweepOffset = 0; // index into _allPatients: next unprocessed patient
let _cumulativeResults = []; // per-patient results accumulated across batches
let _sweepRules = null; // rules loaded at sweep start (cached for continue)
let _sweepHiddenRules = {}; // hidden rules snapshot for current sweep session
let _sweepApiBase = ''; // API base URL for current sweep session
let _sweepMeta = null; // { missingUuidCount, skippedEntries, runAt }
let _lastActionRows = []; // action rows from the last render — source for the printable handout

// Batch selection state — ephemeral, lives in module memory only.
// Cleared on regenerate (renderResults) and cleanup().
let _selectedUuids = new Set(); // UUIDs of currently-checked action rows

// Cached rules (invalidated on storage change, same as sentinel.js)
let _mergedRulesCache = null;
let _canonicalRulesCache = null;

// Create-recall-task state. The assignee/priority options are practice-wide, so
// the form is fetched once per run and reused across rows. _recallApiBase is the
// API host for the current results render (set in renderResults).
let _taskFormCache = null;
let _recallApiBase = '';
let _storageListener = null;

// QOF £-per-point config (item: manager £ projection) — { poundsPerPoint } | null.
// Loaded from 'sweep.qofConfig' on init, kept in sync via chrome.storage.onChanged
// (same pattern as condor.js's _indexConfig). No default value is ever assumed:
// there is deliberately no national £/point figure in this repo (see sweep-core.js
// qofPoundsValue doc) — unset means "points only" everywhere it is displayed.
let _qofConfig = null;
let _qofEditorOpen = false; // inline editor open state (condor cog precedent)

// The last object passed to renderResults(), so a display-only change (QOF
// editor open/close, £/point saved) can re-render from module state alone —
// no re-fetch, no re-evaluation. Re-renders triggered this way always force
// isResume: true so they never wipe the live batch-selection checkboxes
// (only a genuinely new run/continue should reset that).
let _lastRenderArgs = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Normalise a persisted/restored clinician selection (which may be an array,
// a single legacy string, or null) into an array of names. [] = all clinicians.
function normaliseClinicianSelection(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string' && val) return [val];
  return [];
}

// Human-readable label for a clinician selection (array of names; [] = all).
// 0 → "All clinicians"; 1 → "<name>'s patients"; ≥2 → "<a>, <b>… (N clinicians)".
function clinicianSelectionLabel(names) {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  if (list.length === 0) return 'All clinicians';
  if (list.length === 1) return `${list[0]}'s patients`;
  return `${list.join(', ')} (${list.length} clinicians)`;
}

function formatTime(t) {
  if (!t) return '';
  const m = String(t).match(/T(\d{2}:\d{2})/);
  return esc(m ? m[1] : t);
}

function fmtTs(d) {
  // Accept either a Date or an ISO string (runAt is now an ISO string).
  const date = d instanceof Date ? d : new Date(d);
  try {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return String(d);
  }
}

// Format a YYYY-MM-DD clinic date for display (en-GB). Falls back to the raw
// string if it isn't a parseable date.
function fmtClinicDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch (_) {
    return String(iso);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setProgress(msg) {
  const el = container?.querySelector('.sweep-progress');
  if (el) el.textContent = msg;
}

// ── Last-run persistence ──────────────────────────────────────────────────────

// Serialise _cumulativeResults for storage: convert hiddenRuleIds Set → array.
function serialiseResults(results) {
  return results.map((r) => ({
    uuid: r.uuid,
    name: r.name,
    time: r.time,
    clinician: r.clinician,
    chips: r.chips,
    error: r.error,
    hiddenRuleIds: r.hiddenRuleIds ? Array.from(r.hiddenRuleIds) : [],
    source: r.source || null,
  }));
}

// Deserialise stored results: restore hiddenRuleIds array → Set.
function deserialiseResults(results) {
  if (!Array.isArray(results)) return [];
  return results.map((r) => ({
    uuid: r.uuid,
    name: r.name,
    time: r.time,
    clinician: r.clinician,
    chips: r.chips,
    error: r.error,
    hiddenRuleIds: new Set(Array.isArray(r.hiddenRuleIds) ? r.hiddenRuleIds : []),
    source: r.source || null,
  }));
}

async function persistLastRun() {
  try {
    const existing = await chrome.storage.local.get(LAST_RUN_KEY);
    const prev = existing[LAST_RUN_KEY];
    const selectedUuids = prev && prev.selectedUuids ? prev.selectedUuids : [];
    await chrome.storage.local.set({
      [LAST_RUN_KEY]: {
        runAt: _sweepMeta?.runAt || new Date().toISOString(),
        clinicDate: _sweepMeta?.clinicDate || _selectedDate,
        clinicians: _selectedClinicians.slice(),
        clinician: _selectedClinicians.length === 1 ? _selectedClinicians[0] : null,
        results: serialiseResults(_cumulativeResults),
        missingUuidCount: _sweepMeta?.missingUuidCount ?? 0,
        skippedEntries: _sweepMeta?.skippedEntries ?? [],
        totalCount: _allPatients.length,
        processedCount: _sweepOffset,
        selectedUuids,
      },
    });
  } catch (_) {}
}

async function persistSelectedUuids() {
  try {
    const existing = await chrome.storage.local.get(LAST_RUN_KEY);
    const prev = existing[LAST_RUN_KEY];
    if (!prev || typeof prev !== 'object') return;
    prev.selectedUuids = Array.from(_selectedUuids);
    await chrome.storage.local.set({ [LAST_RUN_KEY]: prev });
  } catch (_) {}
}

async function loadLastRun() {
  try {
    const r = await chrome.storage.local.get(LAST_RUN_KEY);
    const d = r[LAST_RUN_KEY];
    if (!d || typeof d !== 'object') return null;
    const runAt = typeof d.runAt === 'string' ? new Date(d.runAt).getTime() : d.runAt;
    if (!runAt || Date.now() - runAt > LAST_RUN_TTL_MS) {
      chrome.storage.local.remove(LAST_RUN_KEY);
      return null;
    }
    return d;
  } catch (_) {
    return null;
  }
}

function clearLastRun() {
  try {
    chrome.storage.local.remove(LAST_RUN_KEY);
  } catch (_) {}
}

// ── Rule loading (mirrors sentinel.js loadRules exactly) ──────────────────────

async function loadRules() {
  if (_mergedRulesCache) return _mergedRulesCache;

  if (!_canonicalRulesCache) {
    const drugUrl = chrome.runtime.getURL('rules/drug-rules.json');
    const qofUrl = chrome.runtime.getURL('rules/qof-rules.json');
    const vaccineUrl = chrome.runtime.getURL('rules/vaccine-rules.json');
    const [drugDoc, qofDoc, vaccineDoc] = await Promise.all([
      fetch(drugUrl).then((r) => r.json()),
      fetch(qofUrl).then((r) => r.json()),
      fetch(vaccineUrl).then((r) => r.json()),
    ]);
    _canonicalRulesCache = [...(drugDoc.rules || []), ...(qofDoc.rules || []), ...(vaccineDoc.rules || [])];
  }

  const canonical = _canonicalRulesCache;
  return new Promise((resolve) => {
    chrome.storage.local.get(['sentinel.rules', 'sentinel.orgRules', 'sentinel.customRules'], (res) => {
      const individual = res['sentinel.rules'] || {};
      const org = res['sentinel.orgRules'] || null;
      const customRules = res['sentinel.customRules'] || [];
      const RIO = window.SentinelRulesetIo;
      let merged;
      if (RIO) {
        merged = RIO.mergeRules(canonical, org, individual);
      } else {
        merged = canonical.map((rule) => (individual[rule.id] ? Object.assign({}, rule, individual[rule.id]) : rule));
      }
      const enabledCustom = customRules.filter((r) => r.enabled !== false);
      merged.push(...enabledCustom);
      _mergedRulesCache = merged;
      resolve(merged);
    });
  });
}

// ── Per-patient evaluation ────────────────────────────────────────────────────

// evaluatePatient(apiBase, patientUuid, rules) -> { chips, source: 'API' | 'session' }
//
// Sources the normalised engine bundle from the Transactional API feed when
// (and only when) getTxnBundleIfEnabled() offers one — that only happens for
// a practice explicitly on integrationMode 'transactional' with a healthy
// feed; every other case (session/hybrid mode, feed failure, missing uuid)
// returns null and this falls back to the existing session fetch/normalise
// path unchanged. Both bundle shapes are evaluated with the SAME rules and
// the SAME evaluatePatient options (including allergies — see
// content-scripts/sentinel.js, which threads allergies the same way).
async function evaluatePatient(apiBase, patientUuid, rules) {
  const rulesEngine = window.SentinelRules;
  if (!rulesEngine) {
    throw new Error('Engine globals not loaded (SentinelRules)');
  }

  const txnBundle = await getTxnBundleIfEnabled(patientUuid);

  let data;
  if (txnBundle) {
    data = txnBundle;
  } else {
    const apiClient = window.SentinelApiClient;
    const normalisers = window.SentinelNormalisers;
    if (!apiClient || !normalisers) {
      throw new Error('Engine globals not loaded (SentinelApiClient / SentinelNormalisers)');
    }

    const raw = await apiClient.fetchAll(apiBase, patientUuid, { useCache: false });

    // clinicalSummary (patientRegisters) and medicationHistory (true
    // clinical start dates) are best-effort, same treatment as
    // data-fetcher.js's fetchLive() / api-client.js fetchAll(): their own
    // failure must not abort a sweep that would otherwise have succeeded
    // on the four endpoints this fail-closed contract actually depends
    // on — register matching falls back to text-matching problems, and
    // start-date derivation falls back to the batch-scoped regimen date.
    const failedEndpoints = Object.keys(raw.errors || {}).filter(
      (k) => k !== 'clinicalSummary' && k !== 'medicationHistory'
    );
    if (!raw.banner) {
      throw new Error(
        'patient banner unavailable — record not read' +
          (failedEndpoints.length ? ` (${failedEndpoints.join(', ')} failed)` : '')
      );
    }
    if (failedEndpoints.length > 0) {
      throw new Error(`incomplete record read — ${failedEndpoints.join(', ')} failed`);
    }

    const urlContext = {
      url: `https://england.medicus.health/${apiBase.match(/^https:\/\/([^.]+)\./)?.[1] ?? 'unknown'}/patient/${patientUuid}/`,
      title: 'Sweep',
      view: 'sweep',
      patientUuid: patientUuid,
    };

    data = normalisers.normaliseAll(raw, urlContext);
  }

  const chips = rulesEngine.evaluatePatient(data.medications || [], data.observations || [], rules, {
    now: new Date().toISOString(),
    problems: data.problems || [],
    patientContext: data.patientContext,
    observationHistory: data.observationHistory || [],
    allergies: data.allergies || [],
    patientRegisters: data.patientRegisters != null ? data.patientRegisters : null,
  });

  return { chips, source: feedSourceLabel(data) };
}

// ── Clinician pre-population ──────────────────────────────────────────────────
// Called non-blocking from init() so the dropdown is ready before the first run.

async function preloadClinicians() {
  let code = null;
  try {
    const res = await window.PracticeCode.resolve();
    code = res.code;
  } catch (_) {
    return;
  }
  if (!code) return;

  try {
    const raw = await fetchSchedulingOverview(code, _selectedDate || todayISO(), {});
    const { clinicians } = extractBookedPatients(raw, { limit: null });
    renderClinicianPicker(clinicians);
  } catch (_) {}
}

// ── Day selector ──────────────────────────────────────────────────────────────
// When the user picks a different day: reset any displayed/persisted results
// (they're for the old day), re-fetch that day's appointment book to repopulate
// the clinician dropdown, and drop a clinician selection that day doesn't have.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function onDateChange(e) {
  const val = (e.target.value || '').trim();
  const dateInput = container?.querySelector('#sweepDate');

  // Guard: never fetch with a blank/invalid value — fall back to today.
  if (!ISO_DATE_RE.test(val) || isNaN(new Date(val + 'T12:00:00').getTime())) {
    _selectedDate = todayISO();
    if (dateInput) dateInput.value = _selectedDate;
  } else {
    _selectedDate = val;
  }

  // The previously-shown results belong to the OLD day — clear them so they
  // can't be mistaken for the newly-selected day's sweep.
  clearLastRun();
  _allPatients = [];
  _sweepOffset = 0;
  _cumulativeResults = [];
  _selectedUuids = new Set();
  _lastActionRows = [];
  _sweepMeta = null;
  const runArea = container?.querySelector('.sweep-run-area');
  if (runArea) runArea.innerHTML = '';

  // Re-fetch the chosen day's overview so the clinician dropdown reflects that
  // day. Mirrors the init pre-populate pattern.
  let code = null;
  try {
    const res = await window.PracticeCode.resolve();
    code = res.code;
  } catch (_) {
    return;
  }
  if (!code) return;

  try {
    const raw = await fetchSchedulingOverview(code, _selectedDate, {});
    const { clinicians } = extractBookedPatients(raw, { limit: null });
    // Preserve the selection by intersecting it with the new day's clinicians;
    // drop any selected clinician not booked that day. renderClinicianPicker
    // applies the intersect-preserve logic (and falls back to All if emptied).
    renderClinicianPicker(clinicians);
  } catch (_) {}
}

// ── Sweep runner ──────────────────────────────────────────────────────────────

async function runSweep(apiBase, hiddenRules) {
  setProgress('Fetching the appointment book…');

  const code = apiBase.match(/^https:\/\/([^.]+)\./)?.[1] ?? '';
  let raw;
  try {
    raw = await fetchSchedulingOverview(code, _selectedDate || todayISO(), { bypassCache: true });
  } catch (e) {
    renderError(`Could not fetch the appointment book: ${esc(e.message)}`);
    return;
  }

  // limit: null — fetch the full list; sweep.js handles batching.
  // Empty _selectedClinicians → all clinicians (per the core normalisation).
  const { patients, clinicians, missingUuidCount, skippedEntries, diagnosticMessage } = extractBookedPatients(raw, {
    clinicians: _selectedClinicians,
    limit: null,
  });

  renderClinicianPicker(clinicians);

  if (diagnosticMessage && patients.length === 0) {
    if (/^No booked appointments/.test(diagnosticMessage)) renderNotice(esc(diagnosticMessage));
    else renderError(esc(diagnosticMessage));
    return;
  }

  setProgress('Loading rules…');

  let rules;
  try {
    rules = await loadRules();
  } catch (e) {
    renderError(`Could not load rules: ${esc(e.message)}`);
    return;
  }

  // Store session state for sequential batching.
  // Clear any persisted last-run first — a new sweep supersedes the old one.
  clearLastRun();
  _selectedUuids = new Set();
  _allPatients = patients;
  _sweepOffset = 0;
  _cumulativeResults = [];
  _sweepRules = rules;
  _sweepHiddenRules = hiddenRules;
  _sweepApiBase = apiBase;
  // ISO string, not a Date: chrome.storage.local serialises Date objects to {},
  // which would break the printable handout (it reads runAt back from storage).
  _sweepMeta = { missingUuidCount, skippedEntries, runAt: new Date().toISOString(), clinicDate: _selectedDate };

  await runNextBatch();
}

// Process the next BATCH_SIZE patients from _allPatients[_sweepOffset…].
// Appends to _cumulativeResults and renders cumulative results when done.
async function runNextBatch() {
  const runArea = container?.querySelector('.sweep-run-area');
  if (runArea) {
    runArea.innerHTML = `<div class="sweep-progress-wrap" aria-live="polite"><div class="sweep-progress">Starting…</div></div>`;
  }

  const batchStart = _sweepOffset;
  const batch = _allPatients.slice(batchStart, batchStart + BATCH_SIZE);
  const total = _allPatients.length;
  let processedThisBatch = 0;

  for (let i = 0; i < batch.length; i++) {
    if (_abortFlag) break;

    const patient = batch[i];
    const overallPos = batchStart + i + 1;
    setProgress(`Checking ${overallPos}/${total} — ${patient.name}…`);

    let chips = null;
    let error = null;
    let source = null; // 'API' | 'session' — null when the row errored before a source was known
    try {
      const evaluated = await evaluatePatient(_sweepApiBase, patient.uuid, _sweepRules);
      chips = evaluated.chips;
      source = evaluated.source;
    } catch (e) {
      error = e.message || String(e);
    }

    const hiddenRuleIds = new Set();
    if (chips && _sweepHiddenRules) {
      for (const chip of chips) {
        if (chip.ruleId && _sweepHiddenRules[chip.ruleId] != null) {
          hiddenRuleIds.add(chip.ruleId);
        }
      }
    }

    _cumulativeResults.push({
      uuid: patient.uuid,
      name: patient.name,
      time: patient.time,
      clinician: patient.clinician,
      chips,
      error,
      hiddenRuleIds,
      source,
    });
    processedThisBatch++;

    if (i < batch.length - 1 && !_abortFlag) await delay(250);
  }

  const aborted = _abortFlag;
  _abortFlag = false;

  // If the module was torn down mid-batch (cleanup() sets _abortFlag and wipes
  // _cumulativeResults/container), do not persist or render — that would
  // overwrite the last-known-good sweep.lastRun with emptied/invalidated state
  // while still recording the pre-abort processedCount/totalCount.
  if (aborted && !container) return;

  _sweepOffset = batchStart + processedThisBatch;

  // Persist the run before rendering so the resume card is available after a
  // module switch. Preserve any existing selection from before the render.
  await persistLastRun();

  const { actionRows, clearRows, errorRows } = summariseSweep(_cumulativeResults);
  renderResults({
    actionRows,
    clearRows,
    errorRows,
    processedCount: _sweepOffset,
    totalCount: total,
    missingUuidCount: _sweepMeta.missingUuidCount,
    skippedEntries: _sweepMeta.skippedEntries,
    runAt: _sweepMeta.runAt,
    aborted,
    isResume: false,
  });

  // F2 Clinical Event Ledger — one summary event per completed (or cancelled)
  // sweep run: counts + clinician scope ONLY, never per-patient rows (a patient
  // is only ledgered individually when a recall task is actually created).
  // Fire-and-forget: the ledger swallows its own failures.
  if ((aborted || _sweepOffset >= total) && window.EventLedger) {
    window.EventLedger.record({
      source: 'sweep',
      patientRef: null,
      severity: null,
      ruleId: null,
      label:
        `${actionRows.length} of ${_sweepOffset} checked need action` +
        ` · clinicians: ${_selectedClinicians.length ? _selectedClinicians.join('; ') : 'all'}` +
        (aborted ? ' · cancelled early' : ''),
      action: 'sweep-run',
    });
  }
}

// ── Render helpers ────────────────────────────────────────────────────────────

function chipSummaryHtml(chips) {
  const actionChips = (chips || []).filter((c) => isActionNeeded(c.status));
  if (actionChips.length === 0) return '';
  return actionChips
    .map((c) => {
      const label = esc(c.drugName || c.indicatorCode || c.label || c.displayName || c.ruleId || '');
      const statusLabel = esc(
        {
          overdue: 'OVERDUE',
          not_met: 'NOT MET',
          alert: 'ALERT',
          stale: 'SEV.OVERDUE',
          due_soon: 'DUE SOON',
          caution: 'CAUTION',
          vax_due: 'VAX DUE',
        }[c.status] || String(c.status || '').toUpperCase()
      );
      const colour = c.status === 'overdue' || c.status === 'not_met' || c.status === 'alert' ? 'red' : 'amber';
      return `<span class="sweep-chip sweep-chip-${colour}">${label} <em>${statusLabel}</em></span>`;
    })
    .join('');
}

// Small, subtle per-row provenance badge — 'API' (transactional feed) or
// 'session' (existing per-patient fetch). null (error rows: no bundle was
// ever successfully sourced) renders nothing.
function sourceBadgeHtml(source) {
  if (!source) return '';
  const cls = source === 'API' ? 'sweep-badge-source-api' : 'sweep-badge-source-session';
  return `<span class="sweep-badge sweep-badge-source ${cls}" title="Data source for this check">${esc(source)}</span>`;
}

function patientRowHtml(row, apiBase, siteId, selectable, source) {
  const name = esc(row.name);
  const timeStr = row.time ? `<span class="sweep-row-time">${formatTime(row.time)}</span>` : '';
  const clinStr = row.clinician ? `<span class="sweep-row-clin">${esc(row.clinician)}</span>` : '';
  const recUrl = `https://england.medicus.health/${esc(siteId)}/patient/${esc(row.uuid)}/`;

  if (row.error) {
    return `<div class="sweep-row sweep-row-error">
      <div class="sweep-row-head">
        ${timeStr}<span class="sweep-row-name">${name}</span>
        <span class="sweep-badge sweep-badge-error">ERROR</span>
      </div>
      <div class="sweep-row-detail sweep-row-errtext">Could not read record: ${esc(row.error)}</div>
    </div>`;
  }

  const redCount = row.redCount ?? 0;
  const amberCount = row.amberCount ?? 0;

  const badgeParts = [];
  if (redCount > 0) badgeParts.push(`<span class="sweep-badge sweep-badge-red">${redCount} red</span>`);
  if (amberCount > 0) badgeParts.push(`<span class="sweep-badge sweep-badge-amber">${amberCount} amber</span>`);

  const hiddenNote = row.hasHiddenActionChips
    ? `<div class="sweep-row-hidden-note">Includes alerts you have hidden in the Sentinel panel.</div>`
    : '';

  const chipHtml = chipSummaryHtml(row.chips);

  // Checkbox for batch selection — only on action rows
  const checkboxHtml = selectable
    ? `<label class="sweep-row-check" title="Select for batch">
         <input type="checkbox" class="sweep-batch-cb" data-uuid="${esc(row.uuid)}"
           aria-label="Select ${name} for batch"
           ${_selectedUuids.has(row.uuid) ? 'checked' : ''}>
       </label>`
    : '';

  // Close-the-loop: a per-row "Create recall task" control that drives Medicus's
  // own general-task endpoint. Only offered on selectable (action-needed) rows
  // when we have an API base (practice code set), and only when there is at least
  // one bookable instruction to recall.
  const recallable = selectable && apiBase && buildRecallDescription(row.chips || []) !== '';
  const recallHtml = recallable
    ? `<div class="sweep-recall">
         <button class="sweep-recall-btn" type="button" data-uuid="${esc(row.uuid)}" data-name="${esc(row.name)}" title="Create a recall task for this patient in Medicus">+ Create recall task</button>
         <div class="sweep-recall-slot" data-uuid="${esc(row.uuid)}"></div>
       </div>`
    : '';

  return `<div class="sweep-row${_selectedUuids.has(row.uuid) ? ' sweep-row-selected' : ''}">
    <div class="sweep-row-head">
      ${checkboxHtml}${timeStr}<span class="sweep-row-name">${name}</span>
      <span class="sweep-row-badges">${badgeParts.join('')}</span>
    </div>
    <div class="sweep-row-meta">${clinStr}${sourceBadgeHtml(source)}<a class="sweep-open-record" href="${recUrl}" target="_blank" rel="noopener noreferrer" title="Open record">Open record &#8599;</a></div>
    ${chipHtml ? `<div class="sweep-row-chips">${chipHtml}</div>` : ''}
    ${hiddenNote}
    ${recallHtml}
  </div>`;
}

// Build an indicatorCode → points map from the rules in memory, so the QOF
// prioritiser is robust even if a chip didn't carry its own points. Falls back
// to the chip's own `points` when a code is absent (handled in sweep-core).
function buildQofPointsByCode(rules) {
  const map = {};
  for (const r of rules || []) {
    if (r && r.type === 'qof-indicator' && r.indicatorCode != null && r.points != null) {
      map[String(r.indicatorCode).toUpperCase()] = Number(r.points) || 0;
    }
  }
  return map;
}

// Small cog icon (condor.js's SVG_COG — an independent copy, same doctrine as
// condor.js: this module has no shared-icon dependency to reuse). Opens the
// £-per-point editor on the QOF panel header.
const SVG_COG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

// True when the practice has entered a usable (finite, positive) £/point figure.
function hasQofRate(qofConfig) {
  const rate = Number(qofConfig && qofConfig.poundsPerPoint);
  return Number.isFinite(rate) && rate > 0;
}

function gbp(n) {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}

// Inline £-per-point editor — condor.js renderIndexEditor precedent (a cog on
// the panel header opens a small form; Save normalises + persists, Reset
// clears the override). Deliberately ONE field: there is no default to fall
// back to (see sweep-core.js qofPoundsValue), so "reset" means "unset", not
// "back to a shipped figure".
function renderQofPoundsEditor(qofConfig) {
  const current = hasQofRate(qofConfig) ? qofConfig.poundsPerPoint : '';
  return `
    <div class="sweep-qof-editor" id="sweepQofEditor">
      <div class="sweep-qof-editor-head">
        <span class="sweep-qof-editor-title">£ per QOF point</span>
        <button class="ghost-btn sweep-qof-editor-close" id="sweepQofEditorClose" type="button" aria-label="Close editor">&#10005;</button>
      </div>
      <p class="sweep-qof-editor-note">
        Your practice's own adjusted figure — there is no national default here because actual income depends on your list size and prevalence; entering your figure absorbs that.
      </p>
      <div class="sweep-qof-editor-row">
        <label class="sweep-qof-editor-label" for="sweepQofRate">£ per point (your practice's adjusted figure)</label>
        <input type="number" id="sweepQofRate" class="sweep-qof-editor-input" value="${esc(current)}" min="0" step="0.01" placeholder="e.g. 220" />
      </div>
      <div class="sweep-qof-editor-actions">
        <button class="ghost-btn" id="sweepQofReset" type="button"${current === '' ? ' disabled' : ''}>Reset</button>
        <button class="ghost-btn sweep-qof-editor-save" id="sweepQofSave" type="button">Save</button>
      </div>
    </div>`;
}

// Cohort-level QOF income lens: ranks the QOF gaps Sweep already found by the
// indicator's own points, so a practice works the highest-value patients first
// and protects the redirected CVD-prevention domain. Pure read of existing chips.
// qofConfig/editorOpen drive the £-per-point cog + inline editor (manager £
// projection): when a usable rate is set, "≈ £X at risk" is shown next to the
// total and the CVD subtotal; when unset, points only, plus a one-line hint.
function renderQofPointsPanel(summary, siteId, qofConfig, editorOpen) {
  if (!summary || summary.patientCount === 0 || summary.totalPoints === 0) return '';

  const pounds = qofPoundsValue(summary, qofConfig && qofConfig.poundsPerPoint);
  const gbpBadge = pounds
    ? `<span class="sweep-qof-gbp" title="Your practice's £/point figure — not a national constant">&#8776; ${gbp(pounds.totalPounds)} at risk</span>`
    : '';

  const cog = `<button class="sweep-qof-cog${hasQofRate(qofConfig) ? ' sweep-qof-cog--custom' : ''}" id="sweepQofCog" type="button"
    aria-expanded="${!!editorOpen}" aria-label="Set your practice's £ per QOF point"
    title="${hasQofRate(qofConfig) ? '£/point set — click to edit' : "Set your practice's £ per QOF point"}">${SVG_COG}</button>`;

  const cvdBadge =
    summary.cvdPoints > 0
      ? `<span class="sweep-qof-cvd" title="BP control, lipid/statin and antithrombotic indicators">CVD-prevention ${summary.cvdPoints}${pounds ? ` (&#8776; ${gbp(pounds.cvdPounds)})` : ''}</span>`
      : '';

  const topPatients = summary.byPatient.slice(0, 10);
  const patientList = topPatients
    .map((p) => {
      const timeStr = p.time ? `<span class="sweep-row-time">${formatTime(p.time)}</span>` : '';
      const recUrl = `https://england.medicus.health/${esc(siteId)}/patient/${esc(p.uuid)}/`;
      const cvd =
        p.cvdPoints > 0
          ? `<span class="sweep-qof-cvd-dot" title="${p.cvdPoints} CVD-prevention points">CVD ${p.cvdPoints}</span>`
          : '';
      // Bare codes ("DM037, HYP010…") are unreadable to a clinician without the
      // rulebook to hand (synthetic-panel feedback) — pair each code with its
      // indicator description, mirroring the by-indicator column's own
      // code/name classes. `title` carries the full pairing too, but never as
      // the ONLY place it appears — the name is always in the visible text.
      const codes = p.indicators
        .map((i) => {
          const code = esc(i.code);
          const name = esc(i.name || '');
          const full = name ? `${code} — ${name}` : code;
          return `<span class="sweep-qof-pind" title="${full}"><span class="sweep-qof-picode">${code}</span>${
            name ? `<span class="sweep-qof-piname">${name}</span>` : ''
          }</span>`;
        })
        .join('');
      return `<li class="sweep-qof-prow">
        <span class="sweep-qof-pts">${p.points}</span>
        <span class="sweep-qof-pname">${timeStr}${esc(p.name)}</span>
        ${cvd}
        <a class="sweep-open-record" href="${recUrl}" target="_blank" rel="noopener noreferrer" title="Open record">Open &#8599;</a>
        <span class="sweep-qof-pcodes">${codes}</span>
      </li>`;
    })
    .join('');

  const indicatorList = summary.byIndicator
    .map((i) => {
      const cvd = i.isCvd ? `<span class="sweep-qof-itag">CVD</span>` : '';
      return `<li class="sweep-qof-irow">
        <span class="sweep-qof-icode">${esc(i.code)}</span>${cvd}
        <span class="sweep-qof-iname">${esc(i.name)}</span>
        <span class="sweep-qof-itotal">${i.totalPoints} pts · ${i.patientCount} pt${i.patientCount === 1 ? '' : 's'}</span>
      </li>`;
    })
    .join('');

  // One-line hint when no rate is set yet — never silent, always points to the cog.
  const gbpHint = !pounds
    ? `<p class="sweep-qof-gbp-hint">Enter your practice's £ per point (the &#9881; icon above) to see this at-risk figure in pounds.</p>`
    : '';

  return `
    <details class="sweep-qof-panel" open>
      <summary class="sweep-qof-summary">
        QOF points at risk: <strong>${summary.totalPoints}</strong>
        ${gbpBadge}
        ${cvdBadge}
        <span class="sweep-qof-sub">${summary.patientCount} patient${summary.patientCount === 1 ? '' : 's'} with gaps</span>
        ${cog}
      </summary>
      ${editorOpen ? renderQofPoundsEditor(qofConfig) : ''}
      <div class="sweep-qof-body">
        <p class="sweep-qof-note">QOF indicator gaps in the patients checked, weighted by each indicator's points — work the highest-value first. Points are the national indicator weights; actual income depends on your list size and prevalence. This is explicitly non-clinical arithmetic — it does not change any clinical priority.</p>
        ${gbpHint}
        <div class="sweep-qof-cols">
          <div class="sweep-qof-col">
            <div class="sweep-qof-col-head">Patients by points at risk</div>
            <ol class="sweep-qof-plist">${patientList}</ol>
          </div>
          <div class="sweep-qof-col">
            <div class="sweep-qof-col-head">By indicator</div>
            <ul class="sweep-qof-ilist">${indicatorList}</ul>
          </div>
        </div>
      </div>
    </details>`;
}

// One column of the clinic-prep worklist (bloods/checks/vaccines/reviews) —
// time-ordered patient lines, each with its own item list. Empty columns say
// so explicitly rather than rendering nothing, so an empty bloods column
// reads as "checked, none due" rather than "did this load?".
function worklistColHtml(rows, siteId) {
  if (!rows.length) return `<div class="sweep-worklist-empty">None due among patients checked so far.</div>`;
  return `<ul class="sweep-worklist-list">${rows
    .map((r) => {
      const timeStr = r.time ? `<span class="sweep-row-time">${formatTime(r.time)}</span>` : '';
      const recUrl = `https://england.medicus.health/${esc(siteId)}/patient/${esc(r.uuid)}/`;
      const items = r.items.map((i) => `<li class="sweep-worklist-item">${esc(i)}</li>`).join('');
      return `<li class="sweep-worklist-prow">
        <div class="sweep-worklist-phead">
          ${timeStr}<span class="sweep-worklist-pname">${esc(r.name)}</span>
          <a class="sweep-open-record" href="${recUrl}" target="_blank" rel="noopener noreferrer" title="Open record">Open &#8599;</a>
        </div>
        <ul class="sweep-worklist-items">${items}</ul>
      </li>`;
    })
    .join('')}</ul>`;
}

// Nurse clinic-prep worklist: "everyone booked today due a jab, blood test or
// review, with what and when, so I prep the tray in advance." Re-reads the
// SAME action-needed chips already evaluated by this sweep run, grouped by
// WHAT kind of prep is needed rather than by patient — a different axis over
// the action-needed rows above, not a new fetch. Pure read of _cumulativeResults
// via sweep-core.js's summariseWorklistByAction.
function renderWorklistPanel(worklist, siteId) {
  if (!worklist) return '';
  const total = worklist.bloods.length + worklist.checks.length + worklist.vaccines.length + worklist.reviews.length;
  if (total === 0) return '';

  return `
    <details class="sweep-worklist-panel" open>
      <summary class="sweep-worklist-summary">
        Clinic prep worklist
        <span class="sweep-worklist-sub">${total} patient line${total === 1 ? '' : 's'} across bloods, checks, jabs and reviews</span>
      </summary>
      <div class="sweep-worklist-body">
        <p class="sweep-worklist-note">
          <strong>Prep aid only, not a checklist to rely on alone.</strong> Verify against the source record before prepping the tray. ${NO_ALERT_CAVEAT} A patient not listed in a column below may still have something due — absence from this list is not an all-clear.
        </p>
        <div class="sweep-worklist-cols">
          <div class="sweep-worklist-col">
            <div class="sweep-worklist-col-head">Bloods (${worklist.bloods.length})</div>
            ${worklistColHtml(worklist.bloods, siteId)}
          </div>
          <div class="sweep-worklist-col">
            <div class="sweep-worklist-col-head">Checks (${worklist.checks.length})</div>
            ${worklistColHtml(worklist.checks, siteId)}
          </div>
          <div class="sweep-worklist-col">
            <div class="sweep-worklist-col-head">Vaccines (${worklist.vaccines.length})</div>
            ${worklistColHtml(worklist.vaccines, siteId)}
          </div>
          <div class="sweep-worklist-col">
            <div class="sweep-worklist-col-head">Reviews (${worklist.reviews.length})</div>
            ${worklistColHtml(worklist.reviews, siteId)}
          </div>
        </div>
      </div>
    </details>`;
}

// Collapsible, amber-toned notice naming every skipped appointment entry (no
// patient UUID found → NEVER evaluated against the Sentinel rules). A bare
// count invites "probably fine" thinking (nurse/pharmacist panel feedback:
// "name every skipped patient, never just a count") — and the clinical-safety
// stance is the opposite: an entry that was never checked must never read as
// clear just because it doesn't appear as a red/amber row above.
function skippedEntriesHtml(missingUuidCount, skippedEntries) {
  const rows = Array.isArray(skippedEntries) ? skippedEntries : [];
  const rowsHtml = rows
    .map((s) => {
      const timeStr = s.time ? formatTime(s.time) : '—';
      const clinician = esc(s.clinician || 'Unknown clinician');
      const rawName = esc(s.rawName || 'Unknown name');
      return `<li class="sweep-skipped-row">${timeStr} &middot; ${clinician} &middot; ${rawName}</li>`;
    })
    .join('');
  return `<details class="sweep-skipped-section">
    <summary class="sweep-skipped-summary">${missingUuidCount} appointment entr${missingUuidCount === 1 ? 'y' : 'ies'} could not be identified (no patient UUID found) and were NOT checked</summary>
    <div class="sweep-skipped-body">
      <p class="sweep-skipped-caveat">These entries were never evaluated against the Sentinel rules — their absence from the results above is not an all-clear.</p>
      <ul class="sweep-skipped-list">${rowsHtml}</ul>
    </div>
  </details>`;
}

function renderResults(args) {
  const {
    actionRows,
    clearRows,
    errorRows,
    processedCount,
    totalCount,
    missingUuidCount,
    skippedEntries,
    runAt,
    aborted,
    isResume,
  } = args;
  if (!container) return;

  // Remember the call so a display-only re-render (QOF £/point editor
  // open/close/save) can replay this exact render from module state, with no
  // re-fetch — see rerenderResults().
  _lastRenderArgs = args;

  // On a fresh run or new batch, clear selection so stale UUIDs don't persist
  // across result sets. On resume (re-render of a stored run), preserve the
  // restored selection that was loaded before this call.
  if (!isResume) {
    _selectedUuids = new Set();
  }

  const siteIdMatch =
    (window.PracticeCode?.getPracticeCodeSync ? window.PracticeCode.getPracticeCodeSync() : null) || '';
  const apiBase = siteIdMatch ? `https://${siteIdMatch}.api.england.medicus.health` : '';

  const actionCount = actionRows.length;
  const clearCount = clearRows.length;
  const errorCount = errorRows.length;

  const missingNote = missingUuidCount > 0 ? skippedEntriesHtml(missingUuidCount, skippedEntries) : '';

  // Progress across batches
  const remaining = totalCount - processedCount;
  const nextBatch = Math.min(BATCH_SIZE, remaining);
  let batchNote = '';
  if (aborted && remaining > 0) {
    batchNote = `<div class="sweep-notice sweep-notice-warn">Sweep was cancelled — ${remaining} patient${remaining === 1 ? '' : 's'} not checked. Click "Run sweep" to restart.</div>`;
  } else if (remaining > 0) {
    batchNote = `<div class="sweep-continue-section">
      <div class="sweep-notice sweep-notice-warn">Checked ${processedCount} of ${totalCount} booked patients — ${remaining} remaining.</div>
      <button class="sweep-continue-btn" type="button">Check next ${nextBatch} patient${nextBatch === 1 ? '' : 's'}</button>
    </div>`;
  } else if (totalCount > BATCH_SIZE) {
    batchNote = `<div class="sweep-notice sweep-notice-ok">All ${totalCount} booked patients checked.</div>`;
  }

  // Reset the cached assignee/priority options if the practice (API base) changed.
  if (_recallApiBase !== apiBase) _taskFormCache = null;
  _recallApiBase = apiBase;

  // Per-patient provenance ('API' feed vs 'session' fetch) — sourced from
  // _cumulativeResults (summariseSweep's rows don't carry it) and looked up
  // by uuid for each rendered row's badge.
  const sourceByUuid = new Map((_cumulativeResults || []).map((r) => [r.uuid, r.source || null]));

  const actionHtml = actionRows
    .map((r) => patientRowHtml(r, apiBase, siteIdMatch, true, sourceByUuid.get(r.uuid)))
    .join('');
  const errorHtml = errorRows
    .map((r) => patientRowHtml(r, apiBase, siteIdMatch, false, sourceByUuid.get(r.uuid)))
    .join('');

  // QOF points-at-risk prioritiser — cohort income lens over the same chips.
  const qofPoints = summariseQofPointsAtRisk(
    _cumulativeResults,
    buildQofPointsByCode(_sweepRules || _canonicalRulesCache || [])
  );
  const qofPanelHtml = renderQofPointsPanel(qofPoints, siteIdMatch, _qofConfig, _qofEditorOpen);

  // Nurse clinic-prep worklist — same chips, grouped by what kind of prep is
  // needed rather than by patient severity.
  const worklist = summariseWorklistByAction(_cumulativeResults);
  const worklistPanelHtml = renderWorklistPanel(worklist, siteIdMatch);
  const worklistHasItems =
    worklist.bloods.length > 0 ||
    worklist.checks.length > 0 ||
    worklist.vaccines.length > 0 ||
    worklist.reviews.length > 0;

  const clearSection =
    clearRows.length > 0
      ? `<details class="sweep-clear-section">
         <summary class="sweep-clear-summary">No action-needed alerts (${clearRows.length})</summary>
         <div class="sweep-clear-body">
           ${clearRows
             .map((r) => {
               const name = esc(r.name);
               const timeStr = r.time ? `<span class="sweep-row-time">${formatTime(r.time)}</span>` : '';
               const clinStr = r.clinician ? `<span class="sweep-row-clin">${esc(r.clinician)}</span>` : '';
               const recUrl = `https://england.medicus.health/${esc(siteIdMatch)}/patient/${esc(r.uuid)}/`;
               return `<div class="sweep-row sweep-row-clear">
               <div class="sweep-row-head">
                 ${timeStr}<span class="sweep-row-name">${name}</span>${clinStr}${sourceBadgeHtml(sourceByUuid.get(r.uuid))}
                 <a class="sweep-open-record" href="${recUrl}" target="_blank" rel="noopener noreferrer" title="Open record">Open &#8599;</a>
               </div>
             </div>`;
             })
             .join('')}
         </div>
       </details>`
      : '';

  const summaryLine =
    actionCount > 0
      ? `<strong>${actionCount} of ${processedCount}</strong> patients checked so far have action-needed alerts.`
      : `<strong>No action-needed alerts</strong> found across ${processedCount} patient${processedCount === 1 ? '' : 's'} checked.`;

  // Feed-provenance rollup: only shown once at least one patient was actually
  // sourced from the Transactional API feed — non-transactional practices
  // (the overwhelming majority) never see this line (zero visual change).
  let apiFeedCount = 0;
  let sessionFeedCount = 0;
  for (const r of _cumulativeResults || []) {
    if (r.error) continue;
    if (r.source === 'API') apiFeedCount++;
    else if (r.source === 'session') sessionFeedCount++;
  }
  const feedSummaryHtml =
    apiFeedCount > 0
      ? ` <span class="sweep-feed-summary">via API feed: ${apiFeedCount} &middot; via session: ${sessionFeedCount}</span>`
      : '';

  const printBtn =
    actionCount > 0
      ? `<button class="sweep-print-btn" type="button" title="Open a printable to-do list for reception">Print reception handout</button>`
      : '';

  const printWorklistBtn = worklistHasItems
    ? `<button class="sweep-print-worklist-btn" type="button" title="Open a printable clinic-prep list — bloods, checks, jabs and reviews due today">Print prep list</button>`
    : '';

  // Batch toolbar — only shown when there are action rows to select
  const batchToolbar =
    actionCount > 0
      ? `<div class="sweep-batch-toolbar" id="sweepBatchToolbar">
         <label class="sweep-select-all-label">
           <input type="checkbox" id="sweepSelectAll" title="Select / deselect all">
           <span class="sweep-select-all-text">Select all</span>
         </label>
         <span class="sweep-batch-count" id="sweepBatchCount">0 selected</span>
         <button class="sweep-batch-btn" id="sweepBatchBtn" type="button" disabled>Generate batch</button>
       </div>`
      : '';

  const resultsHtml = `
    <div class="sweep-results" id="sweepResults">
      <div class="sweep-results-header">
        <div class="sweep-summary-line">${summaryLine}${feedSummaryHtml}</div>
        <div class="sweep-timestamp">Run at ${esc(fmtTs(runAt))}</div>
        ${printBtn}${printWorklistBtn}
      </div>

      ${missingNote}${batchNote}

      ${worklistPanelHtml}

      ${qofPanelHtml}

      ${errorRows.length > 0 ? `<div class="sweep-section-head sweep-section-head-error">Errors (${errorCount})</div>${errorHtml}` : ''}
      ${
        actionRows.length > 0
          ? `<div class="sweep-section-head sweep-section-head-action-wrap">${`<span>Action needed (${actionCount})</span>${batchToolbar}`}</div>${actionHtml}`
          : ''
      }
      ${clearSection}
    </div>`;

  _lastActionRows = actionRows;

  const runArea = container.querySelector('.sweep-run-area');
  if (runArea) {
    runArea.innerHTML = resultsHtml;
    // Attach Continue handler if the button was rendered
    const continueBtn = runArea.querySelector('.sweep-continue-btn');
    if (continueBtn) continueBtn.addEventListener('click', onContinueClick);
    const handoutBtn = runArea.querySelector('.sweep-print-btn');
    if (handoutBtn) handoutBtn.addEventListener('click', onPrintHandout);
    const worklistBtn = runArea.querySelector('.sweep-print-worklist-btn');
    if (worklistBtn) worklistBtn.addEventListener('click', onPrintWorklist);
    // Batch selection wiring
    wireBatchSelection(runArea, actionRows);
    // Create-recall-task wiring
    wireRecallButtons(runArea);
    // QOF £-per-point cog + inline editor wiring
    wireQofEditor(runArea);
  }

  // Reset Run sweep button
  const btn = container.querySelector('.sweep-run-btn');
  if (btn) {
    btn.textContent = 'Run sweep';
    btn.disabled = false;
  }
  _running = false;
}

// ── Batch selection wiring ────────────────────────────────────────────────────

function wireBatchSelection(runArea, actionRows) {
  const selectAllCb = runArea.querySelector('#sweepSelectAll');
  const batchCountEl = runArea.querySelector('#sweepBatchCount');
  const batchBtn = runArea.querySelector('#sweepBatchBtn');

  if (!selectAllCb || !batchCountEl || !batchBtn) return;

  function updateBatchBar() {
    const count = _selectedUuids.size;
    batchCountEl.textContent = count === 1 ? '1 selected' : `${count} selected`;
    batchBtn.disabled = count === 0;
    // Update select-all indeterminate state
    const total = actionRows.length;
    if (count === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    } else if (count === total) {
      selectAllCb.checked = true;
      selectAllCb.indeterminate = false;
    } else {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = true;
    }
  }

  // Individual row checkboxes
  runArea.querySelectorAll('.sweep-batch-cb').forEach((cb) => {
    cb.addEventListener('change', () => {
      const uuid = cb.dataset.uuid;
      if (cb.checked) {
        _selectedUuids.add(uuid);
        cb.closest('.sweep-row')?.classList.add('sweep-row-selected');
      } else {
        _selectedUuids.delete(uuid);
        cb.closest('.sweep-row')?.classList.remove('sweep-row-selected');
      }
      updateBatchBar();
      persistSelectedUuids();
    });
  });

  // Select-all
  selectAllCb.addEventListener('change', () => {
    const checking = selectAllCb.checked;
    runArea.querySelectorAll('.sweep-batch-cb').forEach((cb) => {
      cb.checked = checking;
      const uuid = cb.dataset.uuid;
      if (checking) {
        _selectedUuids.add(uuid);
        cb.closest('.sweep-row')?.classList.add('sweep-row-selected');
      } else {
        _selectedUuids.delete(uuid);
        cb.closest('.sweep-row')?.classList.remove('sweep-row-selected');
      }
    });
    updateBatchBar();
    persistSelectedUuids();
  });

  // Generate batch
  batchBtn.addEventListener('click', onGenerateBatch);

  // Initialise bar state — needed after resume so restored _selectedUuids are reflected
  updateBatchBar();
}

// ── Create-recall-task wiring ──────────────────────────────────────────────────
//
// One careful, explicit task per click — there is deliberately NO bulk "create
// all". Each row's button opens an inline confirm form (assignee + an editable
// description prefilled from that patient's gaps); only the Create button writes,
// via Medicus's own general-task endpoint (shared/task-api.js). Mirrors the
// proven task-inline.js flow, so Medicus's validation/access/audit fire as normal.

function wireRecallButtons(runArea) {
  runArea.querySelectorAll('.sweep-recall-btn').forEach((btn) => {
    btn.addEventListener('click', () => openRecallForm(btn));
  });
}

async function ensureTaskForm(patientId) {
  // Assignee/priority options are practice-wide, so fetch once per run and reuse.
  if (_taskFormCache) return _taskFormCache;
  _taskFormCache = await fetchTaskCreateForm(_recallApiBase, patientId);
  return _taskFormCache;
}

function recallAssigneeOptionsHtml(form) {
  const opt = (o) => `<option value="${esc(`${o.type}|${o.value}`)}">${esc(o.label)}</option>`;
  let html = '<option value="">— select —</option>';
  if (form.teams && form.teams.length) html += `<optgroup label="Teams">${form.teams.map(opt).join('')}</optgroup>`;
  if (form.staff && form.staff.length) html += `<optgroup label="Staff">${form.staff.map(opt).join('')}</optgroup>`;
  return html;
}

async function openRecallForm(btn) {
  const uuid = btn.dataset.uuid;
  const row = _lastActionRows.find((r) => r.uuid === uuid);
  const slot = btn.parentElement?.querySelector('.sweep-recall-slot');
  if (!row || !slot) return;

  // Toggle closed if already open (and not already submitted).
  if (slot.dataset.open === '1') {
    slot.innerHTML = '';
    slot.dataset.open = '';
    return;
  }
  slot.dataset.open = '1';
  slot.innerHTML = `<div class="sweep-recall-loading">Loading task form…</div>`;

  let form;
  try {
    form = await ensureTaskForm(uuid);
  } catch (e) {
    slot.innerHTML = `<div class="sweep-recall-error">${esc(e.message || 'Could not load the task form.')}</div>`;
    slot.dataset.open = '';
    return;
  }

  const desc = buildRecallDescription(row.chips || []);
  const priorityHtml =
    form.priorities && form.priorities.length > 1
      ? `<label class="sweep-recall-lbl">Priority
           <select class="sweep-recall-priority">${form.priorities
             .map((p) => `<option value="${esc(p.value)}">${esc(p.label)}</option>`)
             .join('')}</select>
         </label>`
      : '';
  slot.innerHTML = `
    <div class="sweep-recall-form">
      <label class="sweep-recall-lbl">Assign to
        <select class="sweep-recall-assignee">${recallAssigneeOptionsHtml(form)}</select>
      </label>
      <label class="sweep-recall-lbl">Details
        <textarea class="sweep-recall-desc" rows="3" maxlength="2000">${esc(desc)}</textarea>
      </label>
      ${priorityHtml}
      <div class="sweep-recall-actions">
        <button class="sweep-recall-create" type="button" disabled>Create task</button>
        <button class="sweep-recall-cancel" type="button">Cancel</button>
      </div>
      <div class="sweep-recall-status" role="status"></div>
    </div>`;

  const assigneeSel = slot.querySelector('.sweep-recall-assignee');
  const descEl = slot.querySelector('.sweep-recall-desc');
  const createBtn = slot.querySelector('.sweep-recall-create');
  const updateEnabled = () => {
    createBtn.disabled = !(assigneeSel.value && descEl.value.trim());
  };
  assigneeSel.addEventListener('change', updateEnabled);
  descEl.addEventListener('input', updateEnabled);
  slot.querySelector('.sweep-recall-cancel').addEventListener('click', () => {
    slot.innerHTML = '';
    slot.dataset.open = '';
  });
  createBtn.addEventListener('click', () => submitRecall(slot));
}

async function submitRecall(slot) {
  const btn = slot.closest('.sweep-recall')?.querySelector('.sweep-recall-btn');
  const patientId = btn?.dataset.uuid;
  const assigneeSel = slot.querySelector('.sweep-recall-assignee');
  const assignee = assigneeSel?.value || '';
  const description = slot.querySelector('.sweep-recall-desc')?.value || '';
  const priority = slot.querySelector('.sweep-recall-priority')?.value ?? 0;
  const createBtn = slot.querySelector('.sweep-recall-create');
  const statusEl = slot.querySelector('.sweep-recall-status');
  if (!patientId || !assignee || !description.trim()) return;

  // Capture the assignee label before we tear the form down on success.
  const assigneeLabel = assigneeSel.selectedOptions?.[0]?.textContent?.trim() || '';
  createBtn.disabled = true;
  createBtn.textContent = 'Creating…';
  if (statusEl) statusEl.textContent = '';
  try {
    await createGeneralTask(_recallApiBase, { patientId, assignee, description, priority });
    // F2 Clinical Event Ledger — a recall task was actually created for this
    // patient (fire-and-forget; can never break the recall flow).
    if (window.EventLedger) {
      window.EventLedger.record({
        source: 'sweep',
        patientRef: patientId,
        severity: null,
        ruleId: null,
        label: 'recall task created' + (assigneeLabel ? ` — ${assigneeLabel}` : ''),
        action: 'recall-created',
      });
    }
    slot.innerHTML = `<div class="sweep-recall-done">&#10003; Recall task created${
      assigneeLabel ? ` — assigned to ${esc(assigneeLabel)}` : ''
    }.</div>`;
    slot.dataset.open = 'done';
  } catch (e) {
    if (statusEl)
      statusEl.innerHTML = `<span class="sweep-recall-error">${esc(e.message || 'Failed to create the task.')}</span>`;
    createBtn.disabled = false;
    createBtn.textContent = 'Create task';
  }
}

// ── QOF £-per-point editor wiring (condor.js bindIndexEditor precedent) ───────
//
// The cog sits INSIDE the <summary> (unlike condor's, which floats over a
// plain div, not a <details>), so its click must not also trigger the
// browser's native details-toggle. preventDefault() on the click event
// suppresses that default action regardless of which element in the bubble
// path calls it, so calling it here (before it reaches <summary>) is enough;
// stopPropagation() is added for the same belt-and-braces reason condor uses
// explicit listeners rather than relying on ambient delegation.
function rerenderResults() {
  if (!_lastRenderArgs) return;
  // Always isResume: true — this is a display-only refresh (editor state,
  // saved rate), never a new run/continue, so it must never wipe the live
  // batch-selection checkboxes the way a fresh sweep legitimately does.
  renderResults({ ..._lastRenderArgs, isResume: true });
}

function wireQofEditor(runArea) {
  const cog = runArea.querySelector('#sweepQofCog');
  const closeBtn = runArea.querySelector('#sweepQofEditorClose');
  const saveBtn = runArea.querySelector('#sweepQofSave');
  const resetBtn = runArea.querySelector('#sweepQofReset');

  if (cog) {
    cog.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _qofEditorOpen = !_qofEditorOpen;
      rerenderResults();
    });
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _qofEditorOpen = false;
      rerenderResults();
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = runArea.querySelector('#sweepQofRate');
      const raw = input ? input.value : '';
      const rate = Number(raw);
      // Normalise-on-save: an unusable figure saves as unset (null), never a
      // stray NaN/negative landing in storage. qofPoundsValue re-validates
      // this again on every read regardless (defence in depth).
      const poundsPerPoint = Number.isFinite(rate) && rate > 0 ? rate : null;
      _qofConfig = { poundsPerPoint };
      await chrome.storage.local.set({ 'sweep.qofConfig': _qofConfig });
      _qofEditorOpen = false;
      rerenderResults();
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      _qofConfig = null;
      await chrome.storage.local.remove('sweep.qofConfig');
      _qofEditorOpen = false;
      rerenderResults();
    });
  }
}

// Build the printable reception handout from the latest results and open it
// in a full tab. The model is handed over via the transient 'sweep.handout'
// key (overwritten on every print) because a fresh tab cannot receive an
// in-memory object — handout.html re-reads it on load, so refresh works.
async function onPrintHandout() {
  if (!_lastActionRows.length) return;
  const model = buildHandout(_lastActionRows, {
    runAt: _sweepMeta?.runAt || new Date().toISOString(),
    clinicDate: _sweepMeta?.clinicDate || _selectedDate,
    clinicians: _selectedClinicians.slice(),
    suiteVersion: chrome.runtime.getManifest().version,
  });
  await chrome.storage.local.set({ 'sweep.handout': model });
  // best-effort PHI-at-rest backstop (audit L2) — primary clear is consume-on-read
  // in the print tab; this covers the case where the tab never renders.
  setTimeout(() => {
    chrome.storage.local.remove('sweep.handout');
  }, 60000);
  chrome.tabs.create({ url: chrome.runtime.getURL('side-panel/modules/sweep/handout.html') });
}

// Build the printable clinic-prep worklist from the latest cumulative results
// and open it in a full tab. Mirrors onPrintHandout's transient-key + new-tab
// convention exactly: 'sweep.worklist' is written just before the tab opens,
// consumed on read by worklist.html/worklist.js, and backstopped by a 60s
// removal in case the tab never renders.
async function onPrintWorklist() {
  const worklist = summariseWorklistByAction(_cumulativeResults);
  const hasItems =
    worklist.bloods.length > 0 ||
    worklist.checks.length > 0 ||
    worklist.vaccines.length > 0 ||
    worklist.reviews.length > 0;
  if (!hasItems) return;

  const model = buildWorklist(_cumulativeResults, {
    runAt: _sweepMeta?.runAt || new Date().toISOString(),
    clinicDate: _sweepMeta?.clinicDate || _selectedDate,
    clinicians: _selectedClinicians.slice(),
    suiteVersion: chrome.runtime.getManifest().version,
  });
  await chrome.storage.local.set({ 'sweep.worklist': model });
  // best-effort PHI-at-rest backstop (audit L2) — primary clear is consume-on-read
  // in the print tab; this covers the case where the tab never renders.
  setTimeout(() => {
    chrome.storage.local.remove('sweep.worklist');
  }, 60000);
  chrome.tabs.create({ url: chrome.runtime.getURL('side-panel/modules/sweep/worklist.html') });
}

// Build and open the batch print view for the currently-selected action rows.
// Uses the same transient-storage + new-tab pattern as onPrintHandout.
async function onGenerateBatch() {
  if (_selectedUuids.size === 0) return;

  const selectedRows = _lastActionRows.filter((r) => _selectedUuids.has(r.uuid));
  if (selectedRows.length === 0) return;

  // Practice letterhead auto-fills the sign-off in the batch recall SMS.
  const lhr = await chrome.storage.local.get('suite.letterhead');
  const batchPack = buildBatchPack(selectedRows, { letterhead: lhr['suite.letterhead'] || {} });
  if (!batchPack) return;

  // Annotate with meta for the renderer
  batchPack.runAt = _sweepMeta?.runAt || new Date().toISOString();
  batchPack.clinicDate = _sweepMeta?.clinicDate || _selectedDate;
  batchPack.clinicians = _selectedClinicians.slice();
  batchPack.clinician = _selectedClinicians.length === 1 ? _selectedClinicians[0] : null;
  batchPack.suiteVersion = chrome.runtime.getManifest().version;

  await chrome.storage.local.set({ 'sweep.batchPack': batchPack });
  // best-effort PHI-at-rest backstop (audit L2) — primary clear is consume-on-read
  // in the print tab; this covers the case where the tab never renders.
  setTimeout(() => {
    chrome.storage.local.remove('sweep.batchPack');
  }, 60000);
  chrome.tabs.create({ url: chrome.runtime.getURL('side-panel/modules/sweep/batch-handout.html') });
}

// Neutral notice (e.g. genuinely empty appointment book) — not a failure.
function renderNotice(message) {
  if (!container) return;
  const runArea = container.querySelector('.sweep-run-area');
  if (runArea) runArea.innerHTML = `<div class="sweep-notice">${message}</div>`;
  const btn = container.querySelector('.sweep-run-btn');
  if (btn) {
    btn.textContent = 'Run sweep';
    btn.disabled = false;
  }
  _running = false;
}

// Build the per-clinician checkbox picker for the current day.
// Preserves the current selection by intersecting _selectedClinicians with the
// new day's clinician list (any selected clinician not booked that day is
// dropped). If that empties the selection, falls back to "All clinicians".
function renderClinicianPicker(clinicians) {
  const listEl = container?.querySelector('#sweepClinList');
  const allCb = container?.querySelector('#sweepClinAll');
  if (!listEl || !Array.isArray(clinicians)) return;

  _clinicianList = clinicians.slice();

  // Intersect-preserve: keep only selected names that are booked this day.
  _selectedClinicians = _selectedClinicians.filter((c) => clinicians.includes(c));

  const allChecked = _selectedClinicians.length === 0;
  if (allCb) allCb.checked = allChecked;

  listEl.innerHTML = clinicians
    .map((c, i) => {
      const id = `sweepClin_${i}`;
      const checked = _selectedClinicians.includes(c) ? ' checked' : '';
      return `<label class="sweep-clin-chip">
        <input type="checkbox" class="sweep-clin-cb" id="${id}" value="${esc(c)}"${checked}>
        <span>${esc(c)}</span>
      </label>`;
    })
    .join('');

  // Wire individual checkboxes
  listEl.querySelectorAll('.sweep-clin-cb').forEach((cb) => {
    cb.addEventListener('change', onClinicianToggle);
  });
}

// Re-tick the existing picker checkboxes from _selectedClinicians without
// rebuilding the list (used when restoring a persisted run).
function syncClinicianPickerChecks() {
  const listEl = container?.querySelector('#sweepClinList');
  const allCb = container?.querySelector('#sweepClinAll');
  if (listEl) {
    listEl.querySelectorAll('.sweep-clin-cb').forEach((cb) => {
      cb.checked = _selectedClinicians.includes(cb.value);
    });
  }
  if (allCb) allCb.checked = _selectedClinicians.length === 0;
}

// Recompute _selectedClinicians from the ticked individual checkboxes.
// Empty selection = all clinicians; ticking any individual unchecks "All".
function onClinicianToggle() {
  const listEl = container?.querySelector('#sweepClinList');
  const allCb = container?.querySelector('#sweepClinAll');
  if (!listEl) return;
  const ticked = Array.from(listEl.querySelectorAll('.sweep-clin-cb:checked')).map((cb) => cb.value);
  _selectedClinicians = ticked;
  if (allCb) allCb.checked = ticked.length === 0;
}

// "All clinicians" toggle: checking it clears every individual selection;
// unchecking it with nothing else ticked is a no-op (empty = all anyway).
function onAllCliniciansToggle(e) {
  const listEl = container?.querySelector('#sweepClinList');
  if (e.target.checked) {
    _selectedClinicians = [];
    if (listEl) listEl.querySelectorAll('.sweep-clin-cb').forEach((cb) => (cb.checked = false));
  } else {
    // Re-tick "All" — an empty individual selection is treated as all, so we
    // never leave a state that silently sweeps zero clinicians.
    e.target.checked = true;
  }
}

function renderError(message) {
  if (!container) return;
  const runArea = container.querySelector('.sweep-run-area');
  if (runArea) {
    runArea.innerHTML = `<div class="sweep-error-box"><strong>Sweep failed:</strong> ${message}</div>`;
  }
  const btn = container.querySelector('.sweep-run-btn');
  if (btn) {
    btn.textContent = 'Run sweep';
    btn.disabled = false;
  }
  _running = false;
}

// ── Resume-last-run card ──────────────────────────────────────────────────────

function renderResumeCard(stored) {
  const runArea = container?.querySelector('.sweep-run-area');
  if (!runArea) return;

  const runAtTs = typeof stored.runAt === 'string' ? new Date(stored.runAt).getTime() : stored.runAt;
  const timeStr = fmtTs(stored.runAt);
  const clinLabel = clinicianSelectionLabel(
    normaliseClinicianSelection(stored.clinicians !== undefined ? stored.clinicians : stored.clinician)
  );
  const dayLabel = stored.clinicDate ? fmtClinicDate(stored.clinicDate) : '';

  const deserialisedResults = deserialiseResults(stored.results || []);
  const { actionRows } = summariseSweep(deserialisedResults);
  const actionCount = actionRows.length;
  const selectedCount = Array.isArray(stored.selectedUuids) ? stored.selectedUuids.length : 0;

  runArea.innerHTML = `
    <div class="sweep-resume-card" id="sweepResumeCard">
      <div class="sweep-resume-line">
        Last sweep ${esc(timeStr)}${dayLabel ? ` · ${esc(dayLabel)}` : ''} · ${esc(clinLabel)} · <strong>${actionCount} action-needed</strong> · ${selectedCount} selected
      </div>
      <div class="sweep-resume-actions">
        <button class="sweep-continue-btn" type="button" id="sweepResumeBtn">Resume</button>
        <button class="sweep-resume-discard" type="button" id="sweepResumeDiscard">Discard</button>
      </div>
    </div>`;

  runArea.querySelector('#sweepResumeBtn')?.addEventListener('click', () => {
    onResumeClick(stored);
  });
  runArea.querySelector('#sweepResumeDiscard')?.addEventListener('click', () => {
    clearLastRun();
    runArea.innerHTML = '';
  });
}

function onResumeClick(stored) {
  const deserialisedResults = deserialiseResults(stored.results || []);

  // Restore in-memory session state so "Continue" and batch actions work
  _cumulativeResults = deserialisedResults;
  _sweepOffset = stored.processedCount ?? deserialisedResults.length;
  _allPatients = []; // can't restore full list — Continue is unavailable after resume
  _sweepMeta = {
    runAt: stored.runAt,
    clinicDate: stored.clinicDate || null,
    missingUuidCount: stored.missingUuidCount ?? 0,
    skippedEntries: Array.isArray(stored.skippedEntries) ? stored.skippedEntries : [],
  };
  // Restore the clinician selection (accept the new array form or an old
  // single-string `clinician`) and re-tick the picker checkboxes.
  _selectedClinicians = normaliseClinicianSelection(
    stored.clinicians !== undefined ? stored.clinicians : stored.clinician
  );
  syncClinicianPickerChecks();
  // Restore the swept day so the date input, fetches and printed handouts all
  // reflect the resumed run rather than today.
  if (stored.clinicDate) {
    _selectedDate = stored.clinicDate;
    const dateInput = container?.querySelector('#sweepDate');
    if (dateInput) dateInput.value = _selectedDate;
  }

  // Restore selection
  _selectedUuids = new Set(Array.isArray(stored.selectedUuids) ? stored.selectedUuids : []);

  const { actionRows, clearRows, errorRows } = summariseSweep(deserialisedResults);
  renderResults({
    actionRows,
    clearRows,
    errorRows,
    processedCount: _sweepOffset,
    totalCount: stored.totalCount ?? _sweepOffset,
    missingUuidCount: _sweepMeta.missingUuidCount,
    skippedEntries: _sweepMeta.skippedEntries,
    runAt: _sweepMeta.runAt,
    aborted: false,
    isResume: true,
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _abortFlag = false;
  _running = false;
  _selectedDate = todayISO();
  _selectedClinicians = [];
  _clinicianList = [];
  _allPatients = [];
  _sweepOffset = 0;
  _cumulativeResults = [];
  _selectedUuids = new Set();
  _qofEditorOpen = false;
  _lastRenderArgs = null;

  container.innerHTML = `
    <div class="sweep-module">
      <div class="sweep-header">
        <h2 class="sweep-title">Pre-clinic Monitoring Sweep</h2>
        <div class="sweep-intro">
          Checks the selected day's booked patients against the Sentinel rules engine before clinic starts, so overdue monitoring is visible up front. Pick a day and tick one or more clinicians, or leave All.
        </div>
        <div class="sweep-disclaimer-top">
          <strong>Supplementary tool only.</strong> Verify every alert in the source record before acting. ${NO_ALERT_CAVEAT} Results are a point-in-time snapshot, kept for 2 hours so you can resume; re-run to refresh.
        </div>
      </div>

      <div class="sweep-controls">
        <div class="sweep-controls-row">
          <button class="sweep-run-btn" type="button">Run sweep</button>
          <label class="sweep-ctl-label">Day
            <input type="date" id="sweepDate" value="${esc(_selectedDate)}">
          </label>
        </div>
        <div class="sweep-clin-picker" role="group" aria-label="Clinicians to sweep">
          <label class="sweep-clin-chip sweep-clin-all">
            <input type="checkbox" id="sweepClinAll" checked>
            <span>All clinicians</span>
          </label>
          <div class="sweep-clin-list" id="sweepClinList">
            <!-- per-clinician checkboxes for the selected day rendered here -->
          </div>
        </div>
      </div>

      <div class="sweep-run-area">
        <!-- progress / results rendered here -->
      </div>
    </div>`;

  const btn = container.querySelector('.sweep-run-btn');
  btn.addEventListener('click', onRunClick);
  container.querySelector('#sweepClinAll')?.addEventListener('change', onAllCliniciansToggle);
  container.querySelector('#sweepDate')?.addEventListener('change', onDateChange);

  // Load the practice's £-per-QOF-point figure (if set) before the first
  // render, so the very first sweep result already reflects it.
  try {
    const stored = await chrome.storage.local.get('sweep.qofConfig');
    _qofConfig = stored['sweep.qofConfig'] ?? null;
  } catch (_) {
    _qofConfig = null;
  }

  // Invalidate merged rules cache when rules change (mirrors sentinel.js).
  // Also keep _qofConfig in sync with storage (e.g. changed via a restored
  // backup, or Options) and re-render so the £ figure never goes stale.
  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (changes['sentinel.rules'] || changes['sentinel.orgRules'] || changes['sentinel.customRules']) {
      _mergedRulesCache = null;
    }
    if (changes['sweep.qofConfig']) {
      _qofConfig = changes['sweep.qofConfig'].newValue ?? null;
      rerenderResults();
    }
  };
  chrome.storage.onChanged.addListener(_storageListener);

  // Check for a recent persisted run — show resume card if found.
  loadLastRun().then((stored) => {
    if (stored && container) renderResumeCard(stored);
  });

  // Pre-populate clinician dropdown in the background so the user can filter
  // before running their first sweep. Errors are silently swallowed here —
  // the dropdown merely stays as "All clinicians" until the first full run.
  preloadClinicians().catch(() => {});

  return cleanup;
}

async function onRunClick() {
  if (_running) {
    _abortFlag = true;
    const btn = container?.querySelector('.sweep-run-btn');
    if (btn) btn.textContent = 'Cancelling…';
    return;
  }

  _running = true;
  _abortFlag = false;

  const btn = container?.querySelector('.sweep-run-btn');
  if (btn) {
    btn.textContent = 'Cancel';
    btn.disabled = false;
  }

  const runArea = container?.querySelector('.sweep-run-area');
  if (runArea) {
    runArea.innerHTML = `<div class="sweep-progress-wrap" aria-live="polite"><div class="sweep-progress">Resolving practice code…</div></div>`;
  }

  let code = null;
  try {
    const res = await window.PracticeCode.resolve();
    code = res.code;
  } catch (_) {}

  if (!code) {
    renderError('No Medicus practice code found. Open a Medicus tab or set the code in Options.');
    return;
  }

  let hiddenRules = {};
  try {
    const r = await chrome.storage.local.get('sentinel.hiddenRules');
    hiddenRules = r['sentinel.hiddenRules'] || {};
  } catch (_) {}

  const apiBase = `https://${code}.api.england.medicus.health`;

  try {
    await runSweep(apiBase, hiddenRules);
  } catch (e) {
    renderError(`Unexpected error: ${esc(e.message)}`);
  }
}

async function onContinueClick() {
  if (_running || _sweepOffset >= _allPatients.length) return;

  _running = true;
  _abortFlag = false;

  const btn = container?.querySelector('.sweep-run-btn');
  if (btn) {
    btn.textContent = 'Cancel';
    btn.disabled = false;
  }

  try {
    await runNextBatch();
  } catch (e) {
    renderError(`Unexpected error: ${esc(e.message)}`);
  }
}

function cleanup() {
  _abortFlag = true;
  _running = false;
  _allPatients = [];
  _cumulativeResults = [];
  _selectedUuids = new Set(); // clear batch selection (ephemeral — must not survive module switch)
  _qofEditorOpen = false;
  _lastRenderArgs = null;
  if (_storageListener) {
    chrome.storage.onChanged.removeListener(_storageListener);
    _storageListener = null;
  }
  container = null;
}

export { cleanup };
