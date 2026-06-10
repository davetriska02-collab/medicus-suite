// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Sweep module (pre-clinic monitoring sweep)
//
// Runs the Sentinel rules engine across the logged-in user's booked patients
// for today, producing a morning-huddle worklist so overdue monitoring can be
// arranged BEFORE clinic rather than discovered during consultation.
//
// Design decisions:
//  - Manual trigger ONLY (no auto-run, no polling) — polite to the API.
//  - Sequential per-patient fetches with ~250 ms gap, hard cap of 40 patients.
//  - Does NOT apply sentinel.hiddenRules suppression (a recall worklist must
//    not inherit per-workstation dismissals), but flags when hidden rules
//    would cover action chips so the clinician is not confused.
//  - No new chrome.storage keys — results are ephemeral (in-memory only).
//  - Evaluation path: SentinelApiClient.fetchAll → SentinelNormalisers.normaliseAll
//    → SentinelRules.evaluatePatient — identical to sentinel.js / content-scripts.
//  - Rule loading: SentinelRulesetIo.mergeRules with canonical JSON + overrides,
//    identical to the loadRules() path in sentinel.js.

'use strict';

import {
  extractBookedPatients,
  summariseSweep,
  isActionNeeded,
  MAX_SWEEP_PATIENTS,
} from './sweep-core.js';

// ── Module state ──────────────────────────────────────────────────────────────

let container  = null;
let _abortFlag = false;   // set to true to stop the in-progress sweep loop
let _running   = false;   // true while a sweep is in progress

// Cached rules (same TTL/invalidation as sentinel.js — cleared on storage change)
let _mergedRulesCache     = null;
let _canonicalRulesCache  = null;

// Canonical rules are JSON from the extension bundle — fetched once per session.
// chrome.storage listeners invalidate _mergedRulesCache on rule edits.
let _storageListener = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatTime(t) {
  if (!t) return '';
  return esc(t);
}

function fmtTs(d) {
  try {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch (_) {
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Rule loading (mirrors sentinel.js loadRules exactly) ──────────────────────

async function loadRules() {
  if (_mergedRulesCache) return _mergedRulesCache;

  if (!_canonicalRulesCache) {
    const drugUrl    = chrome.runtime.getURL('rules/drug-rules.json');
    const qofUrl     = chrome.runtime.getURL('rules/qof-rules.json');
    const vaccineUrl = chrome.runtime.getURL('rules/vaccine-rules.json');
    const [drugDoc, qofDoc, vaccineDoc] = await Promise.all([
      fetch(drugUrl).then(r => r.json()),
      fetch(qofUrl).then(r => r.json()),
      fetch(vaccineUrl).then(r => r.json()),
    ]);
    _canonicalRulesCache = [
      ...(drugDoc.rules   || []),
      ...(qofDoc.rules    || []),
      ...(vaccineDoc.rules || []),
    ];
  }

  const canonical = _canonicalRulesCache;
  return new Promise(resolve => {
    chrome.storage.local.get(
      ['sentinel.rules', 'sentinel.orgRules', 'sentinel.customRules'],
      res => {
        const individual  = res['sentinel.rules']       || {};
        const org         = res['sentinel.orgRules']    || null;
        const customRules = res['sentinel.customRules'] || [];
        const RIO = window.SentinelRulesetIo;
        let merged;
        if (RIO) {
          merged = RIO.mergeRules(canonical, org, individual);
        } else {
          merged = canonical.map(rule =>
            individual[rule.id] ? Object.assign({}, rule, individual[rule.id]) : rule
          );
        }
        const enabledCustom = customRules.filter(r => r.enabled !== false);
        merged.push(...enabledCustom);
        _mergedRulesCache = merged;
        resolve(merged);
      }
    );
  });
}

// ── Per-patient evaluation ────────────────────────────────────────────────────
// Mirrors the evaluation path in sentinel.js evaluateAndPublish:
//   fetchAll → normaliseAll → evaluatePatient
// urlContext: synthetic object that satisfies normalisers.js expectations.
// normalisers.js only uses urlContext.url / .title / .view for the banner
// patientContext shape (display only, no clinical logic depends on it).

async function evaluatePatient(apiBase, patientUuid, rules) {
  const apiClient  = window.SentinelApiClient;
  const normalisers = window.SentinelNormalisers;
  const rulesEngine = window.SentinelRules;

  if (!apiClient || !normalisers || !rulesEngine) {
    throw new Error('Engine globals not loaded (SentinelApiClient / SentinelNormalisers / SentinelRules)');
  }

  const raw = await apiClient.fetchAll(apiBase, patientUuid, { useCache: false });

  // Synthetic URL context — normalisers.js uses this only for banner.url/title/view;
  // no clinical rule logic branches on these fields.
  const urlContext = {
    url:         `https://england.medicus.health/${apiBase.match(/^https:\/\/([^.]+)\./)?.[1] ?? 'unknown'}/patient/${patientUuid}/`,
    title:       'Sweep',
    view:        'sweep',
    patientUuid: patientUuid,
  };

  const data = normalisers.normaliseAll(raw, urlContext);

  const chips = rulesEngine.evaluatePatient(
    data.medications        || [],
    data.observations       || [],
    rules,
    {
      now:                new Date().toISOString(),
      problems:           data.problems            || [],
      patientContext:     data.patientContext,
      observationHistory: data.observationHistory  || [],
    }
  );

  return chips;
}

// ── Sweep runner ──────────────────────────────────────────────────────────────

async function runSweep(apiBase, hiddenRules) {
  const setProgress = (msg) => {
    const el = container?.querySelector('.sweep-progress');
    if (el) el.textContent = msg;
  };

  setProgress('Fetching appointment list…');

  // Fetch today's appointments
  const apptUrl = `${apiBase}/scheduling/data/homepage/my-appointments`;
  let raw;
  try {
    const r = await window.ApiDiag.fetch({
      module:     'sweep',
      url:        apptUrl,
      code:       apiBase.match(/^https:\/\/([^.]+)\./)?.[1] ?? '',
      codeSource: 'tab',
    });
    raw = await r.json();
  } catch (e) {
    renderError(`Could not fetch appointment list: ${esc(e.message)}`);
    return;
  }

  const { patients, missingUuidCount, cappedAt, diagnosticMessage } =
    extractBookedPatients(raw);

  if (diagnosticMessage && patients.length === 0) {
    renderError(esc(diagnosticMessage));
    return;
  }

  const total = patients.length;
  setProgress(`Loading rules…`);

  let rules;
  try {
    rules = await loadRules();
  } catch (e) {
    renderError(`Could not load rules: ${esc(e.message)}`);
    return;
  }

  const runAt = new Date();
  const perPatientResults = [];

  for (let i = 0; i < total; i++) {
    if (_abortFlag) break;

    const patient = patients[i];
    setProgress(`Checking ${i + 1}/${total} — ${esc(patient.name)}…`);

    let chips = null;
    let error = null;
    try {
      chips = await evaluatePatient(apiBase, patient.uuid, rules);
    } catch (e) {
      error = e.message || String(e);
    }

    // Determine which of this patient's chips are in sentinel.hiddenRules
    const hiddenRuleIds = new Set();
    if (chips && hiddenRules) {
      for (const chip of chips) {
        if (chip.ruleId && hiddenRules[chip.ruleId] != null) {
          hiddenRuleIds.add(chip.ruleId);
        }
      }
    }

    perPatientResults.push({
      uuid:         patient.uuid,
      name:         patient.name,
      time:         patient.time,
      chips,
      error,
      hiddenRuleIds,
    });

    // Polite delay between patients (~250 ms)
    if (i < total - 1 && !_abortFlag) await delay(250);
  }

  const aborted = _abortFlag;
  _abortFlag = false;

  const { actionRows, clearRows, errorRows } = summariseSweep(perPatientResults);
  renderResults({
    actionRows,
    clearRows,
    errorRows,
    total,
    cappedAt,
    missingUuidCount,
    runAt,
    aborted,
  });
}

// ── Render helpers ────────────────────────────────────────────────────────────

function chipSummaryHtml(chips) {
  // Compact text: action-needed chips only, grouped by colour
  const actionChips = (chips || []).filter(c => isActionNeeded(c.status));
  if (actionChips.length === 0) return '';
  return actionChips.map(c => {
    const label = esc(c.drugName || c.indicatorCode || c.label || c.displayName || c.ruleId || '');
    const statusLabel = esc(
      { overdue:'OVERDUE', not_met:'NOT MET', alert:'ALERT', stale:'SEV.OVERDUE',
        due_soon:'DUE SOON', caution:'CAUTION', vax_due:'VAX DUE' }[c.status]
      || String(c.status || '').toUpperCase()
    );
    const colour = (c.status === 'overdue' || c.status === 'not_met' || c.status === 'alert') ? 'red'
                 : 'amber';
    return `<span class="sweep-chip sweep-chip-${colour}">${label} <em>${statusLabel}</em></span>`;
  }).join('');
}

function patientRowHtml(row, apiBase, siteId) {
  const name    = esc(row.name);
  const timeStr = row.time ? `<span class="sweep-row-time">${formatTime(row.time)}</span>` : '';
  const recUrl  = `https://england.medicus.health/${esc(siteId)}/patient/${esc(row.uuid)}/`;

  if (row.error) {
    return `<div class="sweep-row sweep-row-error">
      <div class="sweep-row-head">
        ${timeStr}<span class="sweep-row-name">${name}</span>
        <span class="sweep-row-badge sweep-badge-error">ERROR</span>
      </div>
      <div class="sweep-row-detail sweep-row-errtext">Could not read record: ${esc(row.error)}</div>
    </div>`;
  }

  const actionChips = (row.chips || []).filter(c => isActionNeeded(c.status));
  const redCount    = row.redCount   ?? 0;
  const amberCount  = row.amberCount ?? 0;

  const badgeParts = [];
  if (redCount   > 0) badgeParts.push(`<span class="sweep-badge sweep-badge-red">${redCount} red</span>`);
  if (amberCount > 0) badgeParts.push(`<span class="sweep-badge sweep-badge-amber">${amberCount} amber</span>`);

  const hiddenNote = row.hasHiddenActionChips
    ? `<div class="sweep-row-hidden-note">Includes alerts you have hidden in the Sentinel panel.</div>`
    : '';

  const chipHtml = chipSummaryHtml(row.chips);

  return `<div class="sweep-row">
    <div class="sweep-row-head">
      ${timeStr}<span class="sweep-row-name">${name}</span>
      <span class="sweep-row-badges">${badgeParts.join('')}</span>
      <a class="sweep-open-record" href="${recUrl}" target="_blank" rel="noopener noreferrer" title="Open record">Open record &#8599;</a>
    </div>
    ${chipHtml ? `<div class="sweep-row-chips">${chipHtml}</div>` : ''}
    ${hiddenNote}
  </div>`;
}

function renderResults({ actionRows, clearRows, errorRows, total, cappedAt, missingUuidCount, runAt, aborted }) {
  if (!container) return;

  const siteIdMatch = (window.PracticeCode?.getPracticeCodeSync
    ? window.PracticeCode.getPracticeCodeSync()
    : null) || '';
  const apiBase = siteIdMatch ? `https://${siteIdMatch}.api.england.medicus.health` : '';

  const actionCount = actionRows.length;
  const clearCount  = clearRows.length;
  const errorCount  = errorRows.length;
  const processedCount = actionCount + clearCount + errorCount;
  const abortNote   = aborted ? `<div class="sweep-notice sweep-notice-warn">Sweep was cancelled early — not all patients were checked.</div>` : '';

  const capNote = cappedAt != null
    ? `<div class="sweep-notice sweep-notice-warn">More than ${MAX_SWEEP_PATIENTS} booked patients (${cappedAt} found) — only the first ${MAX_SWEEP_PATIENTS} by appointment time were checked.</div>`
    : '';

  const missingNote = missingUuidCount > 0
    ? `<div class="sweep-notice sweep-notice-warn">${missingUuidCount} appointment entr${missingUuidCount === 1 ? 'y' : 'ies'} could not be identified (no patient UUID found) and were skipped.</div>`
    : '';

  const actionHtml = actionRows.map(r => patientRowHtml(r, apiBase, siteIdMatch)).join('');
  const errorHtml  = errorRows.map(r => patientRowHtml(r, apiBase, siteIdMatch)).join('');

  const clearSection = clearRows.length > 0
    ? `<details class="sweep-clear-section">
         <summary class="sweep-clear-summary">No action-needed alerts (${clearRows.length})</summary>
         <div class="sweep-clear-body">
           ${clearRows.map(r => {
             const name = esc(r.name);
             const timeStr = r.time ? `<span class="sweep-row-time">${formatTime(r.time)}</span>` : '';
             const recUrl = `https://england.medicus.health/${esc(siteIdMatch)}/patient/${esc(r.uuid)}/`;
             return `<div class="sweep-row sweep-row-clear">
               <div class="sweep-row-head">
                 ${timeStr}<span class="sweep-row-name">${name}</span>
                 <a class="sweep-open-record" href="${recUrl}" target="_blank" rel="noopener noreferrer" title="Open record">Open &#8599;</a>
               </div>
             </div>`;
           }).join('')}
         </div>
       </details>`
    : '';

  const summaryLine = actionCount > 0
    ? `<strong>${actionCount} of ${processedCount}</strong> patients have action-needed monitoring alerts.`
    : `<strong>No action-needed alerts</strong> found across ${processedCount} patients.`;

  const resultsHtml = `
    <div class="sweep-results" id="sweepResults">
      <div class="sweep-results-header">
        <div class="sweep-summary-line">${summaryLine}</div>
        <div class="sweep-timestamp">Run at ${esc(fmtTs(runAt))}</div>
      </div>

      <div class="sweep-disclaimer">
        <strong>Supplementary tool only.</strong>
        Verify every alert in the source record before acting.
        No alert &#8800; monitoring complete &mdash; this is a point-in-time snapshot.
        Results are not stored; re-run to refresh.
      </div>

      ${capNote}${missingNote}${abortNote}

      ${errorRows.length > 0 ? `<div class="sweep-section-head sweep-section-head-error">Errors (${errorCount})</div>${errorHtml}` : ''}
      ${actionRows.length > 0 ? `<div class="sweep-section-head">Action needed (${actionCount})</div>${actionHtml}` : ''}
      ${clearSection}
    </div>`;

  // Replace progress/running area with results
  const runArea = container.querySelector('.sweep-run-area');
  if (runArea) runArea.innerHTML = resultsHtml;

  // Reset button state
  const btn = container.querySelector('.sweep-run-btn');
  if (btn) {
    btn.textContent = 'Run sweep';
    btn.disabled = false;
  }
  _running = false;
}

function renderError(message) {
  if (!container) return;
  const runArea = container.querySelector('.sweep-run-area');
  if (runArea) {
    runArea.innerHTML = `<div class="sweep-error-box">
      <strong>Sweep failed:</strong> ${message}
    </div>`;
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
  container  = el;
  _abortFlag = false;
  _running   = false;

  // Render the shell
  container.innerHTML = `
    <div class="sweep-module">
      <div class="sweep-header">
        <h2 class="sweep-title">Pre-clinic Monitoring Sweep</h2>
        <div class="sweep-intro">
          Runs the Sentinel rules engine across your booked patients for today to
          identify overdue or action-needed monitoring BEFORE clinic starts.
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
      </div>

      <div class="sweep-run-area">
        <!-- progress / results rendered here -->
      </div>
    </div>`;

  const btn = container.querySelector('.sweep-run-btn');
  btn.addEventListener('click', onRunClick);

  // Invalidate merged rules cache when rules change (mirrors sentinel.js)
  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (changes['sentinel.rules'] || changes['sentinel.orgRules'] || changes['sentinel.customRules']) {
      _mergedRulesCache = null;
    }
  };
  chrome.storage.onChanged.addListener(_storageListener);

  return cleanup;
}

async function onRunClick() {
  if (_running) {
    // Cancel button pressed
    _abortFlag = true;
    const btn = container?.querySelector('.sweep-run-btn');
    if (btn) btn.textContent = 'Cancelling…';
    return;
  }

  _running   = true;
  _abortFlag = false;

  const btn = container?.querySelector('.sweep-run-btn');
  if (btn) {
    btn.textContent = 'Cancel';
    btn.disabled    = false;
  }

  // Show progress area
  const runArea = container?.querySelector('.sweep-run-area');
  if (runArea) {
    runArea.innerHTML = `<div class="sweep-progress-wrap">
      <div class="sweep-progress">Resolving practice code…</div>
    </div>`;
  }

  // Resolve practice code
  let code = null;
  try {
    const res = await window.PracticeCode.resolve();
    code = res.code;
  } catch (_) {}

  if (!code) {
    renderError('No Medicus practice code found. Open a Medicus tab or set the code in Options.');
    return;
  }

  // Load hidden rules (do NOT apply them as a suppression filter, but flag them)
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

function cleanup() {
  _abortFlag = true;
  _running   = false;
  if (_storageListener) {
    chrome.storage.onChanged.removeListener(_storageListener);
    _storageListener = null;
  }
  container = null;
}

export { cleanup };
