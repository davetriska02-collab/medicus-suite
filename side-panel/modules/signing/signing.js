// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Signing Queue module v1.0
//
// Monitoring context for the repeat-prescription signing pile: every open
// prescription-request task, shown with the requesting patient's recorded
// drug-monitoring currency, so the 6pm pile can be worked riskiest-first
// without opening each record blind.
//
// INTENDED-PURPOSE FRAMING (docs/INTENDED-PURPOSE.md — read before editing
// copy): this surface DISPLAYS recorded monitoring next to each request. It
// never says "safe", never authorises, never writes. The honest-state line
// ("No flag ≠ safe to sign…") is a fixed part of the header, not a dismissable
// notice. Hazard log: H-038.
//
// Data path (all proven elsewhere in the suite):
//   task-list (open pile, no date filter — completed requests leave the
//   table, which is exactly right here)                    → rows
//   /tasks/data/{slug}/overview/{taskUuid}                 → patient UUID
//     (SentinelApiClient.resolveTaskToPatient, 5-min cache)
//   SentinelApiClient.fetchAll → normaliseAll → evaluatePatient  → chips
//     (identical pipeline to Sweep; sequential, 250ms gap, abortable)
//   signing-core.monitoringVerdict / requestedDrugFlags    → row verdict
//
// PHI: nothing persisted — results live in module memory only. UI prefs
// (task-type toggles) go through shared ui-state.

'use strict';

import { loadUiState, saveUiState } from '../shared/ui-state.js';
import { freshnessHtml, attachFreshnessTicker } from '../shared/freshness.js';
import { extractTaskArray } from '../submissions/submissions-core.js';
import {
  monitoringVerdict,
  requestedDrugFlags,
  combinationVerdict,
  requestedComboFlags,
  sortSigningRows,
  requestAgeDays,
  renalContext,
  formatObsAge,
  locationBuckets,
  rowMatchesLocationFilter,
  filterHiddenSummary,
  isDispensaryLocation,
  emptyStateKind,
  RENAL_STALE_DAYS,
  ROW_STATE,
  CHIP_STATUS_TEXT,
} from './signing-core.js';

// F8: same practice-code guard as every other fetching module.
const _SITE_CODE_RE = /^[a-f0-9]{4,8}$/i;

// Relative task-overview path validation — identical to the queue bridge's
// _OVERVIEW_URL_RE in content-scripts/triage-lens/content.js.
const _OVERVIEW_URL_RE = /^\/tasks\/data\/[A-Za-z0-9_-]+\/overview\/[0-9a-f-]+$/;

const TASK_TYPES = [
  { key: 'routine', slug: 'prescription_request_task_routine', label: 'Routine' },
  { key: 'nonRoutine', slug: 'prescription_request_task_non_routine', label: 'Non-routine' },
];

const BATCH_SIZE = 30; // unique-patient record evaluations per pass; "Check next" continues
const PER_PATIENT_DELAY_MS = 250; // same pacing as Sweep

let container = null;
let _abort = false;
let _running = false;
let _currentRun = null; // in-flight pass promise — refresh awaits it (never silently no-ops)
let _stopFresh = null;

// Verdicts already computed this session, keyed by PATIENT UUID — the only
// identity ever trusted for sharing a verdict between rows (wrong-patient
// guard: see signing-core.js note). Cleared on every fresh fetch.
let _verdictByUuid = new Map();

let state = {
  types: { routine: true, nonRoutine: false },
  rows: [], // [{ taskId, slug, patientName, dateOfBirth, summary, priorityDisplay, createdAt, assignedTo, state, verdict, requestedHits, error }]
  // Location filter: Set of bucket keys (empty = show all). SESSION-ONLY and
  // deliberately never persisted — a filter remembered across days could
  // silently hide rows from a user who forgot they set it.
  locationFilter: new Set(),
  lastFetched: null,
  error: null,
  noCode: false,
};

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _abort = false;

  const saved = await loadUiState('signing');
  if (saved && saved.types && typeof saved.types === 'object') {
    state.types = { routine: saved.types.routine !== false, nonRoutine: saved.types.nonRoutine === true };
  }

  renderShell();
  _stopFresh = attachFreshnessTicker(container);
  await fetchAndRun();

  return () => {
    _abort = true;
    if (_stopFresh) _stopFresh();
    container = null;
  };
}

// ── Fetch + monitoring pass ───────────────────────────────────────────────────

async function fetchAndRun() {
  if (!container) return;
  // A pass may be mid-flight (refresh/toggle sets _abort then calls us):
  // await its wind-down instead of silently no-oping and leaving a stale pile.
  if (_running) {
    _abort = true;
    try {
      await _currentRun;
    } catch (_) {
      /* the old pass's failure is not this run's problem */
    }
    if (!container) return;
  }
  _running = true;
  _abort = false;
  try {
    state.error = null;
    state.noCode = false;

    const { code } = await window.PracticeCode.resolve();
    if (!code || !_SITE_CODE_RE.test(code)) {
      state.noCode = true;
      state.rows = [];
      renderAll();
      return;
    }
    const apiBase = `https://${code}.api.england.medicus.health`;

    // 1. The pile: open prescription-request tasks. Deliberately NO createdAt
    // filter — the endpoint's default view is exactly the outstanding tasks,
    // and completed requests leaving the table is the behaviour we want here.
    const selected = TASK_TYPES.filter((tt) => state.types[tt.key]);
    const rows = [];
    for (const tt of selected) {
      const r = await fetch(`${apiBase}/tasks/data/${tt.slug}/task-list`, { credentials: 'include' });
      if (!r.ok) throw new Error(`${tt.label} requests HTTP ${r.status}`);
      const tasks = extractTaskArray(await r.json());
      for (const t of tasks) {
        if (!t || t.id == null) continue;
        rows.push({
          taskId: String(t.id),
          slug: tt.slug,
          typeLabel: tt.label,
          patientName: t.patientName || '(unknown patient)',
          dateOfBirth: t.dateOfBirth || '',
          summary: t.summary || t.summaryLabel || '',
          priorityDisplay: t.priorityDisplay || '',
          createdAt: t.createdAt || '',
          assignedTo: t.assignedTo || '',
          // The row's own overview pointer — the PROVEN live path to the
          // patient (the queue bridge fetches exactly this field). Preferred
          // over constructing /tasks/data/{list-slug}/overview/{id}: on live
          // Medicus the overview endpoint's slug can differ from the
          // task-list slug (v3.156.1 field fix — every prescription task was
          // coming back "patient not resolvable" via the constructed path).
          overviewURL: typeof t.overviewURL === 'string' && _OVERVIEW_URL_RE.test(t.overviewURL) ? t.overviewURL : '',
          // Collection location straight off the task row (verbatim recorded
          // fact, zero extra fetches) — for a dispensing practice this is the
          // dispensing-patient flag at signing time: it says where the script
          // goes after signing (e.g. "Dispensary").
          collectionLocation:
            typeof t.collectionLocationName === 'string' ? t.collectionLocationName.trim().slice(0, 40) : '',
          state: ROW_STATE.PENDING,
          verdict: null,
          requestedHits: [],
          error: null,
        });
      }
    }
    state.rows = rows;
    _verdictByUuid = new Map();
    state.lastFetched = new Date();
    renderAll();

    _currentRun = runMonitoringPass(apiBase);
    await _currentRun;
  } catch (err) {
    state.error = err.message || 'Failed to load';
    renderAll();
  } finally {
    _running = false;
    renderAll();
  }
}

// One pass over the still-pending rows. WRONG-PATIENT GUARD: every task is
// resolved to its own patient UUID via the task-overview endpoint — no
// name/DOB shortcut exists anywhere in this module. Record evaluations are
// deduped strictly on the resolved UUID (api-client additionally caches the
// overview resolution per task), and the pass stops after BATCH_SIZE unique
// record evaluations; rows whose patient was already evaluated this pass
// complete for free.
async function runMonitoringPass(apiBase) {
  const api = window.SentinelApiClient;
  const norm = window.SentinelNormalisers;
  const engine = window.SentinelRules;
  if (!api || !norm || !engine) {
    for (const row of state.rows) {
      row.state = ROW_STATE.ERROR;
      row.error = 'engine not loaded';
    }
    return;
  }

  const rules = await loadRules();
  let evaluations = 0;

  for (const row of state.rows) {
    if (_abort || !container) return;
    if (row.state !== ROW_STATE.PENDING) continue;

    row.state = ROW_STATE.CHECKING;
    renderList();

    try {
      const patientUuid = await resolvePatientForRow(api, apiBase, row);
      if (!patientUuid) throw new Error('patient not resolvable from this task');

      let entry = _verdictByUuid.get(patientUuid);
      if (!entry) {
        if (evaluations >= BATCH_SIZE) {
          // Batch budget spent — leave for "Check next".
          row.state = ROW_STATE.PENDING;
          renderList();
          return;
        }
        const { chips, renal } = await evaluatePatient(apiBase, patientUuid, rules);
        entry = { verdict: monitoringVerdict(chips), combo: combinationVerdict(chips), renal };
        _verdictByUuid.set(patientUuid, entry);
        evaluations++;
        await new Promise((r) => setTimeout(r, PER_PATIENT_DELAY_MS));
      }
      row.state = ROW_STATE.DONE;
      row.verdict = entry.verdict;
      row.comboVerdict = entry.combo || { level: null, items: [] };
      row.renal = entry.renal;
      row.requestedHits = requestedDrugFlags(row.summary, entry.verdict.items);
      row.requestedComboHits = requestedComboFlags(row.summary, row.comboVerdict.items);
    } catch (e) {
      row.state = ROW_STATE.ERROR;
      row.error = e.message || 'record not read';
    }
    renderList();
  }
}

// Resolve a task row to its patient UUID. The row's own validated
// overviewURL is authoritative (it is what live Medicus itself links, and the
// queue bridge fetches it directly); the constructed
// /tasks/data/{list-slug}/overview/{id} path is only a fallback because the
// overview slug is not guaranteed to equal the task-list slug.
const _overviewPatientCache = new Map(); // apiBase|overviewURL -> patientUuid (session)
async function resolvePatientForRow(api, apiBase, row) {
  if (row.overviewURL) {
    const cacheKey = String(apiBase || '') + '|' + row.overviewURL;
    if (_overviewPatientCache.has(cacheKey)) return _overviewPatientCache.get(cacheKey);
    try {
      const r = await fetch(`${apiBase}${row.overviewURL}`, { credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        const uuid = data?.data?.patient?.id || data?.data?.patientId || data?.patient?.id || data?.patientId || null;
        if (uuid) {
          _overviewPatientCache.set(cacheKey, uuid);
          return uuid;
        }
      }
    } catch (_) {
      // fall through to the constructed-path fallback
    }
  }
  return api.resolveTaskToPatient(apiBase, row.slug, row.taskId);
}

// Same pipeline (and the same fail-closed contract) as Sweep's evaluatePatient:
// a partially-read record throws — an incomplete read must surface as an error
// row, never as a false "no flags".
async function evaluatePatient(apiBase, patientUuid, rules) {
  const api = window.SentinelApiClient;
  const norm = window.SentinelNormalisers;
  const engine = window.SentinelRules;

  const raw = await api.fetchAll(apiBase, patientUuid, { useCache: false });
  const failed = Object.keys(raw.errors || {});
  if (!raw.banner) {
    throw new Error('record not read' + (failed.length ? ` (${failed.join(', ')} failed)` : ''));
  }
  if (failed.length > 0) {
    throw new Error(`incomplete record read — ${failed.join(', ')} failed`);
  }

  const site = apiBase.match(/^https:\/\/([^.]+)\./)?.[1] ?? 'unknown';
  const data = norm.normaliseAll(raw, {
    url: `https://england.medicus.health/${site}/patient/${patientUuid}/`,
    title: 'Signing',
    view: 'signing',
    patientUuid,
  });

  const chips = engine.evaluatePatient(data.medications || [], data.observations || [], rules, {
    now: new Date().toISOString(),
    problems: data.problems || [],
    patientContext: data.patientContext,
    observationHistory: data.observationHistory || [],
  });
  // Renal context rides along with the verdict — same fetch, zero extra cost.
  return { chips, renal: renalContext(data.observations || [], Date.now()) };
}

// Drug rules + practice/org/custom overlays — the same merge order Sweep uses,
// but drug-monitoring only (QOF/vaccine rules are irrelevant to a signing
// context and cost per-patient compute). Custom rules of other types are
// filtered out by monitoringVerdict anyway.
let _rulesCache = null;
async function loadRules() {
  if (_rulesCache) return _rulesCache;
  const drugDoc = await fetch(chrome.runtime.getURL('rules/drug-rules.json')).then((r) => r.json());
  const canonical = drugDoc.rules || [];
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
      merged.push(...customRules.filter((r) => r.enabled !== false));
      _rulesCache = merged;
      resolve(merged);
    });
  });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderShell() {
  if (!container) return;
  container.innerHTML = `
    <div class="module-wrap sg-module">
      <div class="mod-header">
        <div>
          <div class="mod-eyebrow">Signing Queue</div>
          <h1 class="mod-title" id="sgTitle">Repeat requests</h1>
          <div class="mod-subtitle">Open prescription requests with each patient's recorded monitoring alongside</div>
        </div>
        <div class="header-right">
          <button id="sgRefreshBtn" class="ghost-btn"><svg class="ghost-btn-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>Refresh</button>
        </div>
      </div>

      <div class="sg-honest" role="note">
        Monitoring shown is what is <strong>recorded</strong>, not what is true. Combination alerts are the
        practice's configured Monitoring rules, re-shown here. No flag &ne; safe to sign — verify in the record
        before authorising. This panel never writes to Medicus.
      </div>

      <div class="sg-controls">
        ${TASK_TYPES.map(
          (tt) =>
            `<label class="sg-type-toggle"><input type="checkbox" data-type="${tt.key}" ${state.types[tt.key] ? 'checked' : ''}/> ${tt.label}</label>`
        ).join('')}
      </div>

      <div id="sgLocPills" class="sg-loc-pills"></div>
      <div id="sgBanner" class="banner hidden"></div>
      <div id="sgFilterNote" class="sg-filter-note hidden" role="status"></div>
      <div id="sgList" class="sg-list"></div>
      <div id="sgMore"></div>
      <div class="foot" id="sgFoot"></div>
    </div>
  `;

  container.querySelector('#sgRefreshBtn')?.addEventListener('click', () => {
    _abort = true; // stop any in-flight pass; fetchAndRun resets it
    setTimeout(() => fetchAndRun(), 0);
  });
  container.querySelectorAll('.sg-type-toggle input').forEach((cb) => {
    cb.addEventListener('change', () => {
      state.types[cb.dataset.type] = cb.checked;
      saveUiState('signing', { types: state.types });
      _abort = true;
      setTimeout(() => fetchAndRun(), 0);
    });
  });
}

function renderAll() {
  if (!container) return;
  const banner = container.querySelector('#sgBanner');
  if (banner) {
    if (state.noCode) {
      banner.className = 'banner info';
      banner.textContent = 'No practice code — open a Medicus tab or set it in Options.';
    } else if (state.error) {
      banner.className = 'banner';
      banner.textContent = `Failed to load: ${state.error}. Check you're signed into Medicus.`;
    } else {
      banner.className = 'banner hidden';
      banner.textContent = '';
    }
  }
  const title = container.querySelector('#sgTitle');
  if (title) {
    const n = state.rows.length;
    title.textContent =
      state.noCode || state.error ? 'Repeat requests' : `${n} open repeat request${n === 1 ? '' : 's'}`;
  }
  renderLocPills();
  renderList();
  const foot = container.querySelector('#sgFoot');
  if (foot) foot.innerHTML = state.lastFetched ? freshnessHtml(state.lastFetched) : '';
}

function verdictHtml(row) {
  if (row.state === ROW_STATE.PENDING) return '<span class="sg-status sg-status--pending">queued…</span>';
  if (row.state === ROW_STATE.CHECKING) return '<span class="sg-status sg-status--pending">checking record…</span>';
  if (row.state === ROW_STATE.ERROR) {
    return `<span class="sg-status sg-status--error">record not read — check manually (${esc(row.error || 'error')})</span>`;
  }
  const v = row.verdict;
  const cv = row.comboVerdict;
  const monItems = (v && v.items) || [];
  const comboItems = (cv && cv.items) || [];
  if (!monItems.length && !comboItems.length) {
    return (
      '<span class="sg-status sg-status--clear">no monitoring flags recorded <span class="sg-clear-caveat">&ne; all clear</span></span>' +
      renalHtml(row)
    );
  }
  const hitNames = new Set((row.requestedHits || []).map((h) => h.name));
  const comboHitIds = new Set((row.requestedComboHits || []).map((h) => h.ruleId));
  const monHtml = monItems
    .map((it) => {
      const band = ['overdue', 'stale', 'no_data'].includes(it.status) ? 'red' : 'amber';
      const isRequested = hitNames.has(it.name);
      return `<span class="sg-chip sg-chip--${band}${isRequested ? ' sg-chip--requested' : ''}">
        ${isRequested ? '<span class="sg-chip-req" title="This flagged drug appears in the request itself">requested</span>' : ''}
        ${esc(it.name)} — ${esc(CHIP_STATUS_TEXT[it.status] || it.status)}${it.detail ? `: ${esc(it.detail)}` : ''}
      </span>`;
    })
    .join('');
  // Combination chips: the engine's existing drug-combination evaluations
  // (H-038 k), dashed border = combination family; tooltip carries the
  // matched drugs verbatim. "in request" = a drug in THIS request is one leg
  // of the combination (e.g. acute NSAID completing the AKI cluster).
  const comboHtml = comboItems
    .map((it) => {
      const isRequested = comboHitIds.has(it.ruleId);
      return `<span class="sg-chip sg-chip--${it.level} sg-chip--combo${isRequested ? ' sg-chip--requested' : ''}" title="${esc(
        (it.drugs || []).join(' + ')
      )}">
        ${isRequested ? '<span class="sg-chip-req" title="A drug in this request is one leg of this combination">in request</span>' : ''}
        ${esc(it.label)}
      </span>`;
    })
    .join('');
  return monHtml + comboHtml + renalHtml(row);
}

// Renal fact — verbatim latest recorded eGFR, value NEVER shown without its
// age (out-of-context guard). Absence is only called out on rows that already
// carry a monitoring flag (that's where renal function is decision-adjacent);
// a quiet row's missing eGFR would be noise on every young healthy patient.
function renalHtml(row) {
  const r = row.renal;
  const flagged = !!((row.verdict && row.verdict.level) || (row.comboVerdict && row.comboVerdict.level));
  if (!r) {
    return flagged ? '<span class="sg-renal sg-renal--stale">no eGFR on record</span>' : '';
  }
  const age = formatObsAge(r.ageDays);
  const when = age || `recorded ${esc(String(r.date).slice(0, 10))}`;
  const stale = r.ageDays == null || r.ageDays > RENAL_STALE_DAYS;
  return `<span class="sg-renal${stale ? ' sg-renal--stale' : ''}" title="Latest recorded eGFR — display of the recorded value only; verify in the record">eGFR ${esc(r.value)} · ${when}</span>`;
}

function renderList() {
  const list = container?.querySelector('#sgList');
  if (!list) return;

  if (state.noCode || state.error) {
    list.innerHTML = '';
    renderMore(0);
    return;
  }
  if (state.rows.length === 0) {
    // Practice-panel "clear state" ruling (2026-07-07): one fixed line of warm,
    // static text — but ONLY when the pile is genuinely finished (every task
    // type selected, no filter). A narrowed view keeps the neutral wording:
    // warmth on a false all-clear is worse than no warmth at all.
    const allTypes = TASK_TYPES.every((tt) => state.types[tt.key]);
    const kind = emptyStateKind(0, allTypes, state.locationFilter.size > 0);
    list.innerHTML =
      kind === 'done'
        ? '<div class="sg-empty sg-empty--done"><span class="sg-empty-tick" aria-hidden="true">&#10003;</span> Pile&rsquo;s clear &mdash; nothing waiting on you.</div>'
        : '<div class="sg-empty">No open repeat requests for the selected types.</div>';
    renderMore(0);
    return;
  }

  const now = Date.now();
  const visible = state.rows.filter((r) => rowMatchesLocationFilter(r, state.locationFilter));
  renderFilterNote();
  const sorted = sortSigningRows(visible);
  list.innerHTML = sorted
    .map((row) => {
      const age = requestAgeDays(row.createdAt, now);
      const meta = [
        age != null ? `${age}d old` : '',
        row.priorityDisplay && /high/i.test(row.priorityDisplay)
          ? `<span class="sg-meta-high">${esc(row.priorityDisplay)}</span>`
          : '',
        row.typeLabel === 'Non-routine' ? 'non-routine' : '',
        row.assignedTo ? `assigned: ${esc(row.assignedTo)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `
      <div class="sg-row" data-task="${esc(row.taskId)}">
        <div class="sg-row-head">
          <span class="sg-patient">${esc(row.patientName)}</span>
          <span class="sg-dob">${esc(row.dateOfBirth)}</span>
          ${collectChip(row)}
        </div>
        ${row.summary ? `<div class="sg-summary">${esc(row.summary)}</div>` : ''}
        <div class="sg-verdicts">${verdictHtml(row)}</div>
        ${meta ? `<div class="sg-meta">${meta}</div>` : ''}
      </div>`;
    })
    .join('');

  renderMore(state.rows.filter((r) => r.state === ROW_STATE.PENDING).length);
}

// Collection chip — row head, after the name (real-user placement, Chris M.):
// the SYMBOL answers the phone-call question at a glance (house = our
// dispensary, Rx = the patient's usual chemist); the verbatim recorded name
// rides alongside so a stale or mis-coded location stays visible.
// Informational only — nothing to action; never red/amber.
function collectChip(row) {
  if (!row.collectionLocation) return '';
  const home = isDispensaryLocation(row.collectionLocation);
  const glyph = home ? '&#8962;' : '&#8478;'; // ⌂ dispensary | ℞ community pharmacy
  const kind = home ? 'home' : 'chemist';
  const what = home ? 'collected from the practice dispensary' : "collected from the patient's community pharmacy";
  return `<span class="sg-collect sg-collect--${kind}" title="Where this prescription is ${what} — recorded on the request; informational only, nothing to action here">${glyph} ${esc(row.collectionLocation)}</span>`;
}

// Location filter pills (Practice-panel ruling, 2026-07-07): counts derived
// from the values present in the current pile; "No location" is an explicit
// bucket; the whole row is invisible at practices that don't use the field.
// Display-only — the monitoring pass always checks EVERY row regardless of
// the active filter, so verdicts are complete even while the view is narrowed.
function renderLocPills() {
  const host = container?.querySelector('#sgLocPills');
  if (!host) return;
  const buckets = locationBuckets(state.rows);
  if (buckets.length === 0) {
    host.innerHTML = '';
    state.locationFilter.clear();
    return;
  }
  // Drop filter keys that no longer exist in the pile (e.g. after a refresh).
  const validKeys = new Set(buckets.map((b) => b.key));
  for (const k of [...state.locationFilter]) if (!validKeys.has(k)) state.locationFilter.delete(k);

  host.innerHTML = buckets
    .map(
      (b) => `
      <button class="sg-loc-pill${state.locationFilter.has(b.key) ? ' sg-loc-pill--active' : ''}"
              data-key="${esc(b.key)}" role="switch" aria-checked="${state.locationFilter.has(b.key)}"
              aria-label="Filter to ${esc(b.label)} (${b.count} request${b.count === 1 ? '' : 's'})">
        ${esc(b.label)} <span class="sg-loc-count">${b.count}</span>
      </button>`
    )
    .join('');
  host.querySelectorAll('.sg-loc-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (state.locationFilter.has(key)) state.locationFilter.delete(key);
      else state.locationFilter.add(key);
      renderLocPills();
      renderList();
    });
  });
}

// Active-filter note — narrowing the view must never be silent, and a hidden
// RED row is always called out by count (H-038 control (j)).
function renderFilterNote() {
  const note = container?.querySelector('#sgFilterNote');
  if (!note) return;
  const summary = filterHiddenSummary(state.rows, state.locationFilter);
  if (!summary || summary.hidden === 0) {
    note.className = 'sg-filter-note hidden';
    note.innerHTML = '';
    return;
  }
  const redBit = summary.hiddenRed > 0 ? ` — <strong>including ${summary.hiddenRed} red-flagged</strong>` : '';
  note.className = `sg-filter-note${summary.hiddenRed > 0 ? ' sg-filter-note--red' : ''}`;
  note.innerHTML = `${summary.hidden} request${summary.hidden === 1 ? '' : 's'} hidden by the location filter${redBit}. <button class="sg-filter-clear">Show all</button>`;
  note.querySelector('.sg-filter-clear')?.addEventListener('click', () => {
    state.locationFilter.clear();
    renderLocPills();
    renderList();
  });
}

function renderMore(remainingRows) {
  const more = container?.querySelector('#sgMore');
  if (!more) return;
  if (_running || remainingRows <= 0) {
    more.innerHTML = '';
    return;
  }
  more.innerHTML = `<button class="ghost-btn sg-more-btn">Check next batch (${remainingRows} request${remainingRows === 1 ? '' : 's'} unchecked)</button>`;
  more.querySelector('.sg-more-btn')?.addEventListener('click', async () => {
    if (_running) return;
    _running = true;
    _abort = false;
    try {
      const { code } = await window.PracticeCode.resolve();
      if (code && _SITE_CODE_RE.test(code)) {
        _currentRun = runMonitoringPass(`https://${code}.api.england.medicus.health`);
        await _currentRun;
      }
    } finally {
      _running = false;
      renderAll();
    }
  });
}
