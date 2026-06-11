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
//  - Rule loading: SentinelRulesetIo.mergeRules with canonical JSON + overrides,
//    identical to the loadRules() path in sentinel.js.

'use strict';

import { fetchSchedulingOverview, todayISO } from '../../../shared/medicus-api.js';
import {
  extractBookedPatients,
  summariseSweep,
  isActionNeeded,
  buildHandout,
  MAX_SWEEP_PATIENTS,
} from './sweep-core.js';
import { buildBatchPack } from '../shared/action-packs.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = MAX_SWEEP_PATIENTS; // patients evaluated per batch (40)

// ── Module state ──────────────────────────────────────────────────────────────

let container = null;
let _abortFlag = false; // set to true to stop the in-progress sweep loop
let _selectedClinician = ''; // '' = all clinicians
let _running = false; // true while a batch is in progress

// Sequential sweep state — preserved across "Continue" clicks within one session
let _allPatients = []; // full sorted patient list from last appointment-book fetch
let _sweepOffset = 0; // index into _allPatients: next unprocessed patient
let _cumulativeResults = []; // per-patient results accumulated across batches
let _sweepRules = null; // rules loaded at sweep start (cached for continue)
let _sweepHiddenRules = {}; // hidden rules snapshot for current sweep session
let _sweepApiBase = ''; // API base URL for current sweep session
let _sweepMeta = null; // { missingUuidCount, runAt }
let _lastActionRows = []; // action rows from the last render — source for the printable handout

// Batch selection state — ephemeral, lives in module memory only.
// Cleared on regenerate (renderResults) and cleanup().
let _selectedUuids = new Set(); // UUIDs of currently-checked action rows

// Cached rules (invalidated on storage change, same as sentinel.js)
let _mergedRulesCache = null;
let _canonicalRulesCache = null;
let _storageListener = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_) {
    return String(d);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setProgress(msg) {
  const el = container?.querySelector('.sweep-progress');
  if (el) el.textContent = msg;
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

async function evaluatePatient(apiBase, patientUuid, rules) {
  const apiClient = window.SentinelApiClient;
  const normalisers = window.SentinelNormalisers;
  const rulesEngine = window.SentinelRules;

  if (!apiClient || !normalisers || !rulesEngine) {
    throw new Error('Engine globals not loaded (SentinelApiClient / SentinelNormalisers / SentinelRules)');
  }

  const raw = await apiClient.fetchAll(apiBase, patientUuid, { useCache: false });

  const failedEndpoints = Object.keys(raw.errors || {});
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

  const data = normalisers.normaliseAll(raw, urlContext);

  const chips = rulesEngine.evaluatePatient(data.medications || [], data.observations || [], rules, {
    now: new Date().toISOString(),
    problems: data.problems || [],
    patientContext: data.patientContext,
    observationHistory: data.observationHistory || [],
  });

  return chips;
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
    const raw = await fetchSchedulingOverview(code, todayISO(), {});
    const { clinicians } = extractBookedPatients(raw, { limit: null });
    populateClinicianSelect(clinicians);
  } catch (_) {}
}

// ── Sweep runner ──────────────────────────────────────────────────────────────

async function runSweep(apiBase, hiddenRules) {
  setProgress('Fetching the appointment book…');

  const code = apiBase.match(/^https:\/\/([^.]+)\./)?.[1] ?? '';
  let raw;
  try {
    raw = await fetchSchedulingOverview(code, todayISO(), { bypassCache: true });
  } catch (e) {
    renderError(`Could not fetch the appointment book: ${esc(e.message)}`);
    return;
  }

  // limit: null — fetch the full list; sweep.js handles batching
  const { patients, clinicians, missingUuidCount, diagnosticMessage } = extractBookedPatients(raw, {
    clinician: _selectedClinician || null,
    limit: null,
  });

  populateClinicianSelect(clinicians);

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

  // Store session state for sequential batching
  _allPatients = patients;
  _sweepOffset = 0;
  _cumulativeResults = [];
  _sweepRules = rules;
  _sweepHiddenRules = hiddenRules;
  _sweepApiBase = apiBase;
  // ISO string, not a Date: chrome.storage.local serialises Date objects to {},
  // which would break the printable handout (it reads runAt back from storage).
  _sweepMeta = { missingUuidCount, runAt: new Date().toISOString() };

  await runNextBatch();
}

// Process the next BATCH_SIZE patients from _allPatients[_sweepOffset…].
// Appends to _cumulativeResults and renders cumulative results when done.
async function runNextBatch() {
  const runArea = container?.querySelector('.sweep-run-area');
  if (runArea) {
    runArea.innerHTML = `<div class="sweep-progress-wrap"><div class="sweep-progress">Starting…</div></div>`;
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
    try {
      chips = await evaluatePatient(_sweepApiBase, patient.uuid, _sweepRules);
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
    });
    processedThisBatch++;

    if (i < batch.length - 1 && !_abortFlag) await delay(250);
  }

  const aborted = _abortFlag;
  _abortFlag = false;
  _sweepOffset = batchStart + processedThisBatch;

  const { actionRows, clearRows, errorRows } = summariseSweep(_cumulativeResults);
  renderResults({
    actionRows,
    clearRows,
    errorRows,
    processedCount: _sweepOffset,
    totalCount: total,
    missingUuidCount: _sweepMeta.missingUuidCount,
    runAt: _sweepMeta.runAt,
    aborted,
  });
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

function patientRowHtml(row, apiBase, siteId, selectable) {
  const name = esc(row.name);
  const timeStr = row.time ? `<span class="sweep-row-time">${formatTime(row.time)}</span>` : '';
  const clinStr = row.clinician ? `<span class="sweep-row-clin">${esc(row.clinician)}</span>` : '';
  const recUrl = `https://england.medicus.health/${esc(siteId)}/patient/${esc(row.uuid)}/`;

  if (row.error) {
    return `<div class="sweep-row sweep-row-error">
      <div class="sweep-row-head">
        ${timeStr}<span class="sweep-row-name">${name}</span>${clinStr}
        <span class="sweep-row-badge sweep-badge-error">ERROR</span>
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
           ${_selectedUuids.has(row.uuid) ? 'checked' : ''}>
       </label>`
    : '';

  return `<div class="sweep-row${_selectedUuids.has(row.uuid) ? ' sweep-row-selected' : ''}">
    <div class="sweep-row-head">
      ${checkboxHtml}${timeStr}<span class="sweep-row-name">${name}</span>${clinStr}
      <span class="sweep-row-badges">${badgeParts.join('')}</span>
      <a class="sweep-open-record" href="${recUrl}" target="_blank" rel="noopener noreferrer" title="Open record">Open record &#8599;</a>
    </div>
    ${chipHtml ? `<div class="sweep-row-chips">${chipHtml}</div>` : ''}
    ${hiddenNote}
  </div>`;
}

function renderResults({
  actionRows,
  clearRows,
  errorRows,
  processedCount,
  totalCount,
  missingUuidCount,
  runAt,
  aborted,
}) {
  if (!container) return;

  // Clear batch selection on every fresh render (new results supersede old picks)
  _selectedUuids = new Set();

  const siteIdMatch =
    (window.PracticeCode?.getPracticeCodeSync ? window.PracticeCode.getPracticeCodeSync() : null) || '';
  const apiBase = siteIdMatch ? `https://${siteIdMatch}.api.england.medicus.health` : '';

  const actionCount = actionRows.length;
  const clearCount = clearRows.length;
  const errorCount = errorRows.length;

  const missingNote =
    missingUuidCount > 0
      ? `<div class="sweep-notice sweep-notice-warn">${missingUuidCount} appointment entr${missingUuidCount === 1 ? 'y' : 'ies'} could not be identified (no patient UUID found) and were skipped.</div>`
      : '';

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

  const actionHtml = actionRows.map((r) => patientRowHtml(r, apiBase, siteIdMatch, true)).join('');
  const errorHtml = errorRows.map((r) => patientRowHtml(r, apiBase, siteIdMatch, false)).join('');

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
                 ${timeStr}<span class="sweep-row-name">${name}</span>${clinStr}
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

  const printBtn =
    actionCount > 0
      ? `<button class="sweep-print-btn" type="button" title="Open a printable to-do list for reception">Print reception handout</button>`
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
        <div class="sweep-summary-line">${summaryLine}</div>
        <div class="sweep-timestamp">Run at ${esc(fmtTs(runAt))}</div>
        ${printBtn}
      </div>

      <div class="sweep-disclaimer">
        <strong>Supplementary tool only.</strong>
        Verify every alert in the source record before acting.
        No alert &#8800; monitoring complete &mdash; this is a point-in-time snapshot.
        Results are not stored; re-run to refresh.
      </div>

      ${missingNote}${batchNote}

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
    // Batch selection wiring
    wireBatchSelection(runArea, actionRows);
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
  });

  // Generate batch
  batchBtn.addEventListener('click', onGenerateBatch);
}

// Build the printable reception handout from the latest results and open it
// in a full tab. The model is handed over via the transient 'sweep.handout'
// key (overwritten on every print) because a fresh tab cannot receive an
// in-memory object — handout.html re-reads it on load, so refresh works.
async function onPrintHandout() {
  if (!_lastActionRows.length) return;
  const model = buildHandout(_lastActionRows, {
    runAt: _sweepMeta?.runAt || new Date().toISOString(),
    clinician: _selectedClinician || null,
    suiteVersion: chrome.runtime.getManifest().version,
  });
  await chrome.storage.local.set({ 'sweep.handout': model });
  chrome.tabs.create({ url: chrome.runtime.getURL('side-panel/modules/sweep/handout.html') });
}

// Build and open the batch print view for the currently-selected action rows.
// Uses the same transient-storage + new-tab pattern as onPrintHandout.
async function onGenerateBatch() {
  if (_selectedUuids.size === 0) return;

  const selectedRows = _lastActionRows.filter((r) => _selectedUuids.has(r.uuid));
  if (selectedRows.length === 0) return;

  const batchPack = buildBatchPack(selectedRows);
  if (!batchPack) return;

  // Annotate with meta for the renderer
  batchPack.runAt = _sweepMeta?.runAt || new Date().toISOString();
  batchPack.clinician = _selectedClinician || null;
  batchPack.suiteVersion = chrome.runtime.getManifest().version;

  await chrome.storage.local.set({ 'sweep.batchPack': batchPack });
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

// Fill the clinician filter dropdown.
// Preserves the current selection if that clinician is still in the list.
function populateClinicianSelect(clinicians) {
  const sel = container?.querySelector('#sweepClinician');
  if (!sel || !Array.isArray(clinicians)) return;
  const current = _selectedClinician;
  sel.innerHTML =
    `<option value="">All clinicians</option>` +
    clinicians.map((c) => `<option value="${esc(c)}"${c === current ? ' selected' : ''}>${esc(c)}</option>`).join('');
  if (current && !clinicians.includes(current)) {
    _selectedClinician = '';
    sel.value = '';
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

// ── Init ──────────────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _abortFlag = false;
  _running = false;
  _allPatients = [];
  _sweepOffset = 0;
  _cumulativeResults = [];
  _selectedUuids = new Set();

  container.innerHTML = `
    <div class="sweep-module">
      <div class="sweep-header">
        <h2 class="sweep-title">Pre-clinic Monitoring Sweep</h2>
        <div class="sweep-intro">
          Runs the Sentinel rules engine across today's booked patients from the
          practice appointment book to identify overdue or action-needed
          monitoring BEFORE clinic starts. Use the dropdown to sweep a single
          clinician's list.
        </div>
        <div class="sweep-disclaimer sweep-disclaimer-top">
          <strong>Supplementary tool only.</strong>
          Always verify in the source record.
          No alert &#8800; monitoring complete.
          Results are a point-in-time snapshot and are not stored.
        </div>
      </div>

      <div class="sweep-controls">
        <button class="sweep-run-btn" type="button">Run sweep</button>
        <label class="sweep-clin-label">for
          <select id="sweepClinician"><option value="">All clinicians</option></select>
        </label>
      </div>

      <div class="sweep-run-area">
        <!-- progress / results rendered here -->
      </div>
    </div>`;

  const btn = container.querySelector('.sweep-run-btn');
  btn.addEventListener('click', onRunClick);
  container.querySelector('#sweepClinician')?.addEventListener('change', (e) => {
    _selectedClinician = e.target.value || '';
  });

  // Invalidate merged rules cache when rules change (mirrors sentinel.js)
  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (changes['sentinel.rules'] || changes['sentinel.orgRules'] || changes['sentinel.customRules']) {
      _mergedRulesCache = null;
    }
  };
  chrome.storage.onChanged.addListener(_storageListener);

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
    runArea.innerHTML = `<div class="sweep-progress-wrap"><div class="sweep-progress">Resolving practice code…</div></div>`;
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
  if (_storageListener) {
    chrome.storage.onChanged.removeListener(_storageListener);
    _storageListener = null;
  }
  container = null;
}

export { cleanup };
