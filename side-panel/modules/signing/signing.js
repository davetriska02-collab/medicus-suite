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
  sortSigningRows,
  groupTasksByPatient,
  requestAgeDays,
  ROW_STATE,
  CHIP_STATUS_TEXT,
} from './signing-core.js';

// F8: same practice-code guard as every other fetching module.
const _SITE_CODE_RE = /^[a-f0-9]{4,8}$/i;

const TASK_TYPES = [
  { key: 'routine', slug: 'prescription_request_task_routine', label: 'Routine' },
  { key: 'nonRoutine', slug: 'prescription_request_task_non_routine', label: 'Non-routine' },
];

const BATCH_SIZE = 30; // patient-groups checked per pass; "Check next" continues
const PER_PATIENT_DELAY_MS = 250; // same pacing as Sweep

let container = null;
let _abort = false;
let _running = false;
let _stopFresh = null;

let state = {
  types: { routine: true, nonRoutine: false },
  rows: [], // [{ taskId, slug, patientName, dateOfBirth, summary, priorityDisplay, createdAt, assignedTo, state, verdict, requestedHits, error }]
  groups: [], // patient groups of task rows (see signing-core.groupTasksByPatient)
  groupOffset: 0, // how many groups have been checked
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
  if (!container || _running) return;
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
          state: ROW_STATE.PENDING,
          verdict: null,
          requestedHits: [],
          error: null,
        });
      }
    }
    state.rows = rows;
    state.groups = groupTasksByPatient(rows);
    state.groupOffset = 0;
    state.lastFetched = new Date();
    renderAll();

    await runMonitoringPass(apiBase);
  } catch (err) {
    state.error = err.message || 'Failed to load';
    renderAll();
  } finally {
    _running = false;
    renderAll();
  }
}

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
  const batch = state.groups.slice(state.groupOffset, state.groupOffset + BATCH_SIZE);

  for (const group of batch) {
    if (_abort || !container) return;
    for (const row of group) row.state = ROW_STATE.CHECKING;
    renderList();

    try {
      const first = group[0];
      const patientUuid = await api.resolveTaskToPatient(apiBase, first.slug, first.taskId);
      if (!patientUuid) throw new Error('patient not resolvable from this task');

      const chips = await evaluatePatient(apiBase, patientUuid, rules);
      const verdict = monitoringVerdict(chips);
      for (const row of group) {
        row.state = ROW_STATE.DONE;
        row.verdict = verdict;
        row.requestedHits = requestedDrugFlags(row.summary, verdict.items);
      }
    } catch (e) {
      for (const row of group) {
        row.state = ROW_STATE.ERROR;
        row.error = e.message || 'record not read';
      }
    }
    state.groupOffset++;
    renderList();
    await new Promise((r) => setTimeout(r, PER_PATIENT_DELAY_MS));
  }
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

  return engine.evaluatePatient(data.medications || [], data.observations || [], rules, {
    now: new Date().toISOString(),
    problems: data.problems || [],
    patientContext: data.patientContext,
    observationHistory: data.observationHistory || [],
  });
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
        Monitoring shown is what is <strong>recorded</strong>, not what is true. No flag &ne; safe to sign —
        verify in the record before authorising. This panel never writes to Medicus.
      </div>

      <div class="sg-controls">
        ${TASK_TYPES.map(
          (tt) =>
            `<label class="sg-type-toggle"><input type="checkbox" data-type="${tt.key}" ${state.types[tt.key] ? 'checked' : ''}/> ${tt.label}</label>`
        ).join('')}
      </div>

      <div id="sgBanner" class="banner hidden"></div>
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
  if (!v || v.level === null) {
    return '<span class="sg-status sg-status--clear">no monitoring flags recorded <span class="sg-clear-caveat">&ne; all clear</span></span>';
  }
  const hitNames = new Set(row.requestedHits.map((h) => h.name));
  return v.items
    .map((it) => {
      const band = ['overdue', 'stale', 'no_data'].includes(it.status) ? 'red' : 'amber';
      const isRequested = hitNames.has(it.name);
      return `<span class="sg-chip sg-chip--${band}${isRequested ? ' sg-chip--requested' : ''}">
        ${isRequested ? '<span class="sg-chip-req" title="This flagged drug appears in the request itself">requested</span>' : ''}
        ${esc(it.name)} — ${esc(CHIP_STATUS_TEXT[it.status] || it.status)}${it.detail ? `: ${esc(it.detail)}` : ''}
      </span>`;
    })
    .join('');
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
    list.innerHTML = '<div class="sg-empty">No open repeat requests for the selected types.</div>';
    renderMore(0);
    return;
  }

  const now = Date.now();
  const sorted = sortSigningRows(state.rows);
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
        </div>
        ${row.summary ? `<div class="sg-summary">${esc(row.summary)}</div>` : ''}
        <div class="sg-verdicts">${verdictHtml(row)}</div>
        ${meta ? `<div class="sg-meta">${meta}</div>` : ''}
      </div>`;
    })
    .join('');

  renderMore(state.groups.length - state.groupOffset);
}

function renderMore(remainingGroups) {
  const more = container?.querySelector('#sgMore');
  if (!more) return;
  if (_running || remainingGroups <= 0) {
    more.innerHTML = '';
    return;
  }
  more.innerHTML = `<button class="ghost-btn sg-more-btn">Check next ${Math.min(remainingGroups, BATCH_SIZE)} patients (${remainingGroups} unchecked)</button>`;
  more.querySelector('.sg-more-btn')?.addEventListener('click', async () => {
    if (_running) return;
    _running = true;
    _abort = false;
    try {
      const { code } = await window.PracticeCode.resolve();
      if (code && _SITE_CODE_RE.test(code)) {
        await runMonitoringPass(`https://${code}.api.england.medicus.health`);
      }
    } finally {
      _running = false;
      renderAll();
    }
  });
}
