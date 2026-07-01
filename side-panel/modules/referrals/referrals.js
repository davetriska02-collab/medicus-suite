// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Referrals Tracker v1.0

'use strict';

import { loadUiState, saveUiState } from '../shared/ui-state.js';
import { applyReferralFilters, collectClinicians, filtersActive, describeFilters } from './referrals-filter-core.js';

function ApiNs() {
  return typeof window !== 'undefined' ? window.ReferralsApi : null;
}

// Fallback date window when the user has not chosen a range and the API
// provides no default — month-to-date (1st of the current month → today),
// which is what a secretary means by "this month's referrals". A rolling
// last-30-days window opened on a confusing cross-month span (e.g. 18 May
// → 16 June) that nobody had asked for.
const DEFAULT_PRESET = 'thisMonth';
const TOP_N = 15;
const STALE_MS = 30 * 60 * 1000;
const DISCOVERY_KEY = 'referrals.discovery';
const CONFIG_KEY = 'referrals.config';

let container = null;
let stalenessTimer = null;
let _inFlight = false;

let state = {
  discoveryUrl: null,
  configUrl: null,
  configPriorities: [],
  configStatuses: [],
  startDate: null,
  endDate: null,
  rawReferrals: null,
  totalCount: 0,
  aggregated: null,
  loading: false,
  loadingProgress: null,
  error: null,
  chartView: 'clinician',
  chartExpanded: false,
  clinicianSearch: '',
  // Patient-name search + clinician-dropdown filter — apply across BOTH the
  // main referral list/chart and the 2WW safety-net worklist (item 5). These
  // are independent of clinicianSearch above, which only scopes the "By
  // clinician"/"Rate" chart tabs' bar list, not the underlying data.
  patientNameFilter: '',
  clinicianDropdownFilter: '',
  activePriorities: new Set(['Routine', 'Urgent', 'TwoWeekWait']),
  activeStatuses: new Set(['Completed', 'Incomplete', 'Cancelled']),
  lastFetched: null,
  lastAttemptedUrl: null,
  showDiagnostics: false,
  _staleDiscovery: false,
  activityData: null,
  activityError: null,
  activityLoading: false,
};

function resolveStored(stored) {
  const cfgData = stored[CONFIG_KEY]?.data || {};
  return {
    // Audit M1: discovery stores URL only — no .sample/.data rows are persisted.
    discoveryUrl: stored[DISCOVERY_KEY]?.url || null,
    configUrl: stored[CONFIG_KEY]?.url || null,
    priorities: (cfgData.priorityOptions || []).map((o) => o.value).filter(Boolean),
    statuses: (cfgData.statusOptions || []).map((o) => o.value).filter(Boolean),
  };
}

// Raw referrals narrowed by the patient-name search + clinician dropdown
// (item 5) — the two filters that apply everywhere: the main list/chart, the
// 2WW safety-net worklist, and the CSV export. Independent of the priority/
// status chips (see getFilteredAggregated) and of clinicianSearch (which only
// scopes the "By clinician"/"Rate" chart bar list).
function getSearchFilteredRawRows() {
  if (!Array.isArray(state.rawReferrals)) return state.rawReferrals;
  return applyReferralFilters(state.rawReferrals, {
    patientName: state.patientNameFilter,
    clinician: state.clinicianDropdownFilter,
  });
}

// Re-aggregate raw referrals using the active priority/status chips AND the
// patient-name/clinician filters. Returns full aggregation unchanged when
// every chip is active and no search/clinician filter is set.
function getFilteredAggregated() {
  const api = ApiNs();
  if (!api || !state.rawReferrals) return state.aggregated;
  const allP = ['Routine', 'Urgent', 'TwoWeekWait'];
  const allS = ['Completed', 'Incomplete', 'Cancelled'];
  const chipsAllActive = state.activePriorities.size === allP.length && state.activeStatuses.size === allS.length;
  const searchActive = filtersActive({
    patientName: state.patientNameFilter,
    clinician: state.clinicianDropdownFilter,
  });
  if (chipsAllActive && !searchActive) return state.aggregated;
  const searchFiltered = getSearchFilteredRawRows();
  const filtered = searchFiltered.filter(
    (r) =>
      state.activePriorities.has(api.normalisePriority(r.priority || '')) &&
      state.activeStatuses.has(r.displayStatus || '')
  );
  return api.aggregate(filtered);
}

// Builds rate rows: referrals ÷ consultations per clinician.
// Returns sorted array of { name, referrals, consultations, rate } or null.
function buildRateRows() {
  if (!state.activityData || !state.aggregated) return null;

  const consultMap = new Map();
  for (const row of state.activityData) {
    const key = (row.name || '').toLowerCase().trim();
    consultMap.set(key, (consultMap.get(key) || 0) + (Number(row.consultations) || 0));
  }

  const a = getFilteredAggregated() || state.aggregated;
  let rows = [];
  for (const c of a.byClinician) {
    const key = c.name.toLowerCase().trim();
    const consultations = consultMap.get(key);
    if (consultations == null || consultations === 0) continue;
    rows.push({ name: c.name, referrals: c.count, consultations, rate: c.count / consultations });
  }

  if (state.clinicianSearch) {
    const q = state.clinicianSearch.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  }

  return rows.sort((a, b) => b.rate - a.rate);
}

export async function init(el) {
  container = el;

  const api = ApiNs();
  if (api) {
    const range = api.preset(DEFAULT_PRESET);
    if (range) {
      state.startDate = range[0];
      state.endDate = range[1];
    }
  }

  const stored = await chrome.storage.local.get([DISCOVERY_KEY, CONFIG_KEY]);
  const r = resolveStored(stored);
  state.discoveryUrl = r.discoveryUrl;
  state.configUrl = r.configUrl;
  state.configPriorities = r.priorities;
  state.configStatuses = r.statuses;

  // Restore persisted view state (filters, chart view, search)
  const savedUi = await loadUiState('referrals');
  if (savedUi) {
    const VALID_PRIORITIES = ['Routine', 'Urgent', 'TwoWeekWait'];
    const VALID_STATUSES = ['Completed', 'Incomplete', 'Cancelled'];
    const VALID_VIEWS = ['clinician', 'specialty', 'hospital', 'rate'];
    if (Array.isArray(savedUi.activePriorities)) {
      const ps = savedUi.activePriorities.filter((p) => VALID_PRIORITIES.includes(p));
      if (ps.length > 0) state.activePriorities = new Set(ps);
    }
    if (Array.isArray(savedUi.activeStatuses)) {
      const ss = savedUi.activeStatuses.filter((s) => VALID_STATUSES.includes(s));
      if (ss.length > 0) state.activeStatuses = new Set(ss);
    }
    if (typeof savedUi.chartView === 'string' && VALID_VIEWS.includes(savedUi.chartView))
      state.chartView = savedUi.chartView;
    if (typeof savedUi.clinicianSearch === 'string') state.clinicianSearch = savedUi.clinicianSearch;
    if (typeof savedUi.patientNameFilter === 'string') state.patientNameFilter = savedUi.patientNameFilter;
    if (typeof savedUi.clinicianDropdownFilter === 'string')
      state.clinicianDropdownFilter = savedUi.clinicianDropdownFilter;
  }

  render();
  if (state.discoveryUrl || state.configUrl) {
    fetchAndRender();
  } else {
    // Headless discovery: if no captured URL exists yet but we can resolve a
    // practice code, attempt to derive the data-template URL directly — the user
    // does not need to open the report page first.  This runs at most once per
    // init (one-shot, lazy, no poller).  On success the storage.onChanged
    // listener (below) fires and re-renders automatically.  On failure we fall
    // through to the existing renderDiscoveryPrompt path, same as today.
    (async () => {
      const api = ApiNs();
      if (!api || !api.ensureReferralsDiscovery) return;
      let practiceCode = null;
      try {
        const resolved = await window.PracticeCode.resolve();
        practiceCode = resolved && resolved.code ? resolved.code : null;
      } catch (_) {
        // PracticeCode not available or not yet resolved — fall through to prompt
        return;
      }
      if (!practiceCode) return;

      // Show a brief "Connecting…" hint without disrupting the skeleton/prompt
      // decision — just update the subtitle so the user knows work is happening.
      const subtitleEl = container && container.querySelector('.module-subtitle');
      if (subtitleEl) subtitleEl.textContent = 'Connecting to referrals…';

      const templateUrl = await api.ensureReferralsDiscovery(practiceCode);

      if (!container) return; // module cleaned up while we were waiting

      if (templateUrl) {
        // Discovery succeeded — update in-memory state and fetch.
        // The storage.onChanged listener will also fire (it is idempotent).
        state.discoveryUrl = templateUrl;
        fetchAndRender();
      } else {
        // Discovery could not derive a valid URL — restore subtitle and let
        // render() show the existing discovery prompt as the fallback.
        const subtitleEl2 = container.querySelector('.module-subtitle');
        if (subtitleEl2) subtitleEl2.textContent = 'Referral audit data from Medicus';
      }
    })();
  }

  // Live "X min ago" label — only updates the timestamp node, no full re-render
  stalenessTimer = setInterval(() => {
    if (!container) return;
    const tsEl = container.querySelector('.ref-ts');
    if (!tsEl) return;
    tsEl.innerHTML = renderTimestampContent();
    // Re-attach the click handler for the "Refresh?" button that re-renders
    // when the timestamp transitions to a stale state.
    tsEl.querySelector('#refTsRefresh')?.addEventListener('click', fetchAndRender);
  }, 60_000);

  const onChange = (ch) => {
    if (ch['suite.practiceCode']) {
      fetchAndRender();
      return;
    }
    if (ch[DISCOVERY_KEY] || ch[CONFIG_KEY]) {
      chrome.storage.local.get([DISCOVERY_KEY, CONFIG_KEY]).then((s) => {
        const r = resolveStored(s);
        const changed = r.discoveryUrl !== state.discoveryUrl || r.configUrl !== state.configUrl;
        state.discoveryUrl = r.discoveryUrl;
        state.configUrl = r.configUrl;
        state.configPriorities = r.priorities;
        state.configStatuses = r.statuses;
        if (changed || (!state.aggregated && !state.loading)) fetchAndRender();
      });
    }
  };
  chrome.storage.onChanged.addListener(onChange);

  return () => {
    clearInterval(stalenessTimer);
    stalenessTimer = null;
    chrome.storage.onChanged.removeListener(onChange);
    container = null;
  };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchAndRender() {
  if (!container) return;
  if (_inFlight) return;
  _inFlight = true;
  const refreshBtn = container.querySelector('#refRefresh');
  if (refreshBtn) refreshBtn.disabled = true;
  try {
    const api = ApiNs();
    if (!api) {
      state.error = 'Referrals API module not loaded';
      render();
      return;
    }
    if (!state.discoveryUrl) {
      render();
      return;
    }

    const { code, source } = await window.PracticeCode.resolve();

    state.loading = true;
    state.error = null;
    state.loadingProgress = null;
    state.activityLoading = true;
    state.activityError = null;
    state.lastAttemptedUrl = api.buildUrlFromTemplate(state.discoveryUrl, state.startDate, state.endDate, 0, 2000);
    render();

    const actFetch = window.ActivityApi
      ? window.ActivityApi.fetchActivityReport(code, state.startDate, state.endDate, {
          fetch: (url, init) =>
            window.ApiDiag.fetch({
              module: 'referrals-rate',
              url,
              code: code || '(auto)',
              codeSource: source || 'tab',
              init,
            }),
        })
      : Promise.reject(new Error('Activity module not loaded'));

    const [refResult, actResult] = await Promise.allSettled([
      api.fetchReferrals(code, state.startDate, state.endDate, {
        templateUrl: state.discoveryUrl,
        onProgress: (loaded, total) => {
          state.loadingProgress = { loaded, total };
          render();
        },
        fetch: (url, init) =>
          window.ApiDiag.fetch({
            module: 'referrals',
            url,
            code: code || '(auto)',
            codeSource: source || 'tab',
            init,
          }),
      }),
      actFetch,
    ]);

    if (refResult.status === 'fulfilled') {
      const result = refResult.value;
      state.rawReferrals = result.referrals;
      state.totalCount = result.totalCount;
      state.aggregated = api.aggregate(result.referrals);
      state.lastFetched = new Date();
      state.error = null;
      state._staleDiscovery = false;
      if (result.url) state.lastAttemptedUrl = result.url;
    } else {
      const err = refResult.reason;
      if (err?.url) state.lastAttemptedUrl = err.url;

      if (api.isStaleTemplateError && api.isStaleTemplateError(err)) {
        // The stored discovery URL is stale (404 or returned config instead of
        // data).  Clear it and attempt headless re-discovery before prompting.
        await chrome.storage.local.remove(DISCOVERY_KEY);
        state.discoveryUrl = null;

        let reDiscovered = false;
        try {
          const resolved = await window.PracticeCode.resolve();
          const pCode = resolved && resolved.code ? resolved.code : null;
          if (pCode && api.ensureReferralsDiscovery) {
            const newUrl = await api.ensureReferralsDiscovery(pCode);
            if (newUrl) {
              state.discoveryUrl = newUrl;
              reDiscovered = true;
            }
          }
        } catch (_) {
          // Ignore — fall through to the discovery prompt
        }

        if (reDiscovered) {
          // Re-discovery succeeded — finish the current call cleanly, then
          // schedule a fresh fetchAndRender() after the finally block resets
          // _inFlight (using setTimeout so the guard is definitely clear).
          state.loading = false;
          state.loadingProgress = null;
          state.activityLoading = false;
          state.error = null;
          render();
          setTimeout(fetchAndRender, 0);
          return; // finally block still runs; _inFlight reset before the timer fires
        }

        // Re-discovery failed — show the friendly prompt with an explanation.
        // Deliberately clear error so renderDiscoveryPrompt() is shown, not renderError().
        state._staleDiscovery = true;
        state.error = null;
      } else {
        state.error = err?.message || String(err);
      }
    }

    if (actResult.status === 'fulfilled') {
      state.activityData = actResult.value?.rowData || [];
      state.activityError = null;
    } else {
      state.activityData = null;
      state.activityError = actResult.reason?.message || String(actResult.reason);
    }

    state.loading = false;
    state.loadingProgress = null;
    state.activityLoading = false;
    render();
  } finally {
    _inFlight = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (!container) return;
  container.innerHTML = `
    <div class="ref-v1-module module-wrap">
      <div class="module-header">
        <div class="module-title-row">
          <h2 class="module-title">Referrals</h2>
          <span class="module-ver">v1.0</span>
        </div>
        <div class="module-subtitle">Referral audit data from Medicus</div>
      </div>
      ${renderControls()}
      ${
        state.loading
          ? renderSkeleton()
          : state.error
            ? renderError()
            : !state.discoveryUrl
              ? renderDiscoveryPrompt()
              : state.aggregated
                ? renderData()
                : ''
      }
      ${renderDiagnostics()}
    </div>
  `;
  wireControls();
}

function renderTimestampContent() {
  if (!state.lastFetched) return '';
  const stale = Date.now() - state.lastFetched.getTime() > STALE_MS;
  const label = relativeTime(state.lastFetched);
  return stale
    ? `<span class="ref-ts-stale">⚠ Updated ${label}</span> — <button class="ref-ts-refresh" id="refTsRefresh">Refresh?</button>`
    : `Updated ${label}`;
}

function renderControls() {
  const hasData = !!state.rawReferrals?.length;
  return `
    <div class="ref-controls">
      <div class="ref-date-row">
        <label class="ref-label">From</label>
        <input type="date" id="refStart" class="ref-date-input" value="${state.startDate || ''}" max="${todayISO()}" />
        <label class="ref-label">To</label>
        <input type="date" id="refEnd" class="ref-date-input" value="${state.endDate || ''}" max="${todayISO()}" />
      </div>
      <div class="ref-preset-row">
        <button class="ref-preset" data-preset="last7">7d</button>
        <button class="ref-preset" data-preset="last30">30d</button>
        <button class="ref-preset" data-preset="last90">90d</button>
        <button class="ref-preset" data-preset="thisMonth">Month</button>
        <button class="ref-preset" data-preset="last3m">3m</button>
        <button class="ref-preset" data-preset="last6m">6m</button>
        <button class="ref-preset" data-preset="last12m">12m</button>
        <span class="ref-spacer"></span>
        ${hasData ? `<button class="ref-csv" id="refCsvBtn">↓ CSV</button>` : ''}
        <button class="ref-refresh" id="refRefresh">Refresh</button>
      </div>
      ${state.lastFetched ? `<div class="ref-ts">${renderTimestampContent()}</div>` : ''}
      ${renderFilterChips()}
      ${hasData ? renderPatientClinicianFilters() : ''}
    </div>
  `;
}

// Patient-name search + clinician dropdown (item 5). Independent of the
// priority/status chips above and of the chart-tab clinicianSearch — these two
// narrow the main list/chart AND the 2WW safety-net worklist together (AND
// combined with each other, and with the chips for the main list/chart only —
// see getFilteredAggregated / renderSafetyNet).
function renderPatientClinicianFilters() {
  const api = ApiNs();
  const clinicians = api ? collectClinicians(state.rawReferrals) : [];
  const active = filtersActive({
    patientName: state.patientNameFilter,
    clinician: state.clinicianDropdownFilter,
  });
  const optionsHtml = clinicians
    .map(
      (c) =>
        `<option value="${escAttr(c)}"${state.clinicianDropdownFilter === c ? ' selected' : ''}>${escHtml(c)}</option>`
    )
    .join('');
  return `
    <div class="ref-pc-filter-row">
      <div class="ref-pc-search-wrap">
        <input type="text" id="refPatientSearch" class="ref-search-input"
          placeholder="Search patient name…" value="${escAttr(state.patientNameFilter)}" />
        ${state.patientNameFilter ? `<button class="ref-search-clear" id="refPatientSearchClear" title="Clear">×</button>` : ''}
      </div>
      <select id="refClinicianDropdown" class="ref-clinician-select">
        <option value="">All clinicians</option>
        ${optionsHtml}
      </select>
      ${active ? `<span class="ref-pc-filter-active" title="Filters apply to the list, chart and 2WW safety-net below">Filtered</span>` : ''}
    </div>
  `;
}

function renderSkeleton() {
  const p = state.loadingProgress;
  const progressLine = p?.total
    ? `<div class="ref-progress">Loaded ${p.loaded.toLocaleString('en-GB')} of ${p.total.toLocaleString('en-GB')} referrals…</div>`
    : '';
  return `
    ${progressLine}
    <div class="ref-skeleton">
      <div class="ref-skel-line ref-skel-w80"></div>
      <div class="ref-skel-line ref-skel-w60"></div>
      <div class="ref-skel-line ref-skel-w70"></div>
      <div class="ref-skel-line ref-skel-w50"></div>
      <div class="ref-skel-line ref-skel-w65"></div>
    </div>
  `;
}

function renderDiscoveryPrompt() {
  const staleNote = state._staleDiscovery
    ? `<p class="ref-discovery-stale-note">
        The referrals report location appears to have changed. Opening it once below
        will reconnect this panel automatically.
      </p>`
    : '';
  const headText = state._staleDiscovery
    ? 'Reconnect — just open the report once'
    : 'Ready — just open the report once';
  return `
    <div class="ref-discovery-prompt">
      <svg class="ref-discovery-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <p class="ref-discovery-head">${escHtml(headText)}</p>
      ${staleNote}
      <p class="ref-discovery-body">
        Nothing is broken and there is nothing to set up. This panel fills in by itself
        the first time you open the referrals report in Medicus, then keeps itself up to date.
      </p>
      <ol class="ref-discovery-steps">
        <li>Open a Medicus tab.</li>
        <li>Go to <strong>Referrals → Clinical Audit Report</strong>.</li>
        <li>Come back here — the charts appear automatically.</li>
      </ol>
      <button class="ref-discovery-cta" id="refDiscoveryOpen">
        Open Referrals → Clinical Audit Report
      </button>
      <p class="ref-discovery-note">
        Your date range and the Priority filters (Routine, Urgent, 2WW) above are ready to
        use — they will apply as soon as the data lands.
      </p>
    </div>
  `;
}

function renderError() {
  return `
    <div class="ref-error">
      <div class="ref-error-msg">${escHtml(state.error)}</div>
      ${state.lastAttemptedUrl ? `<div class="ref-error-url"><span class="ref-error-url-label">URL:</span> ${escHtml(state.lastAttemptedUrl)}</div>` : ''}
    </div>
  `;
}

function renderDiagnostics() {
  const o = state.showDiagnostics;
  const lines = [
    `Discovery URL: ${state.discoveryUrl || '(none)'}`,
    `Config URL:    ${state.configUrl || '(none)'}`,
    `Priorities (from config.priorityOptions[*].value): ${state.configPriorities.length ? state.configPriorities.join(', ') : '(none)'}`,
    `Statuses   (from config.statusOptions[*].value):  ${state.configStatuses.length ? state.configStatuses.join(', ') : '(none)'}`,
    `Last attempted URL: ${state.lastAttemptedUrl || '(none yet)'}`,
  ];
  return `
    <div class="ref-diag">
      <button class="ref-diag-toggle" id="refDiagToggle">${o ? '▾' : '▸'} Diagnostics</button>
      ${
        o
          ? `<pre class="ref-diag-body">${escHtml(lines.join('\n'))}</pre>
            <div class="ref-diag-actions">
              <button class="ref-btn-secondary" id="refDiagClear">Clear stored discovery</button>
            </div>`
          : ''
      }
    </div>
  `;
}

// 2WW / Faster-Diagnosis safety-net worklist: suspected-cancer referrals still
// showing Incomplete, oldest-first, with calendar-day ages. Reads raw referrals
// (the module already fetched them) — no new endpoint, no patient UUID needed.
//
// Deliberately reads the PATIENT-NAME/CLINICIAN-filtered rows (item 5 — "find
// this one patient's/clinician's open loops"), but NEVER the priority/status
// chip-filtered view: a clinician unticking "Incomplete" from the chips must
// never make an open 2WW loop disappear from this card. Narrowing by who
// (name/clinician) cannot hide a clinical status the way narrowing by status
// can, so it is safe to apply here.
function renderSafetyNet() {
  const api = ApiNs();
  if (!api || !api.buildSafetyNet || !Array.isArray(state.rawReferrals)) return '';
  const sn = api.buildSafetyNet(getSearchFilteredRawRows(), {});
  if (!sn.rows.length) return '';

  const rowsHtml = sn.rows
    .map((r) => {
      const name = [r.patientGivenName, r.patientFamilyName].filter(Boolean).join(' ') || 'Patient';
      const age = r.ageDays == null ? '—' : `${r.ageDays}d`;
      const sevClass =
        r.severity === 'overdue' ? 'ref-sn-overdue' : r.severity === 'watch' ? 'ref-sn-watch' : 'ref-sn-open';
      const svc = r.referralService ? `<span class="ref-sn-svc">${escHtml(r.referralService)}</span>` : '';
      const clin = r.referringClinician ? `<span class="ref-sn-clin">${escHtml(r.referringClinician)}</span>` : '';
      return `<div class="ref-sn-row ${sevClass}">
        <span class="ref-sn-age" title="calendar days since referral">${escHtml(age)}</span>
        <span class="ref-sn-name">${escHtml(name)}</span>
        ${svc}${clin}
      </div>`;
    })
    .join('');

  const overdueBadge = sn.counts.overdue
    ? `<span class="ref-sn-badge ref-sn-badge-overdue">${sn.counts.overdue} &ge; ${sn.overdueDays}d</span>`
    : '';
  const watchBadge = sn.counts.watch
    ? `<span class="ref-sn-badge ref-sn-badge-watch">${sn.counts.watch} &ge; ${sn.watchDays}d</span>`
    : '';

  return `
    <div class="ref-sn-card">
      <div class="ref-sn-head">
        <span class="ref-sn-title">&#9888; Open 2WW safety-net (${sn.counts.total})</span>
        ${overdueBadge}${watchBadge}
      </div>
      <p class="ref-sn-note">Suspected-cancer (2WW) referrals still showing <strong>Incomplete</strong> — no confirmed outcome yet. Check each has been received and an appointment booked; absent safety-netting/follow-up is the top root cause of cancer-delay claims. Ages are calendar days since referral; thresholds are a guide, not a clinical standard.</p>
      <div class="ref-sn-rows">${rowsHtml}</div>
    </div>`;
}

function renderData() {
  // The 2WW safety-net reads the patient-name/clinician-filtered rows but NOT
  // the chip-filtered view — a clinician filtering to e.g. "Completed" can
  // never hide an open 2WW loop (see renderSafetyNet).
  const safetyNet = renderSafetyNet();
  const a = getFilteredAggregated() || state.aggregated;
  if (!a || a.total === 0) return safetyNet + `<div class="ref-empty">No referrals in this date range.</div>`;

  const total = a.total;
  const dbTotal = state.totalCount;
  const shown = state.rawReferrals?.length || total;

  const periodLabel =
    state.startDate === state.endDate
      ? formatDateLabel(state.startDate)
      : `${formatDateLabel(state.startDate)} → ${formatDateLabel(state.endDate)}`;

  return `
    ${safetyNet}

    ${dbTotal > shown ? renderPageNotice(shown, dbTotal) : ''}

    <div class="ref-summary-card">
      <div class="ref-summary-head">
        <div class="ref-summary-label">Total referrals</div>
        <div class="ref-summary-period">${escHtml(periodLabel)}</div>
      </div>
      <div class="ref-summary-number">${total.toLocaleString('en-GB')}</div>
      <div class="ref-breakdown-grid">${renderPriorityTiles(a.byPriority, total)}</div>
    </div>

    <div class="ref-status-card">
      <div class="ref-card-label">Status breakdown</div>
      <div class="ref-status-tiles">${renderStatusTiles(a.byStatus, total)}</div>
    </div>

    <div class="ref-chart-card">
      <div class="ref-chart-head">
        <div class="ref-card-label">Breakdown</div>
        <div class="ref-chart-tabs">
          <button class="ref-chart-tab ${state.chartView === 'clinician' ? 'active' : ''}" data-view="clinician">By clinician</button>
          <button class="ref-chart-tab ${state.chartView === 'specialty' ? 'active' : ''}" data-view="specialty">By specialty</button>
          <button class="ref-chart-tab ${state.chartView === 'hospital' ? 'active' : ''}" data-view="hospital">By hospital</button>
          <button class="ref-chart-tab ${state.chartView === 'rate' ? 'active' : ''}" data-view="rate">Rate</button>
        </div>
      </div>
      ${state.chartView === 'clinician' || state.chartView === 'rate' ? renderClinicianSearch() : ''}
      <div class="ref-bars">${state.chartView === 'rate' ? renderRateChart() : renderBars(a)}</div>
    </div>
  `;
}

function renderFilterChips() {
  const api = ApiNs();
  const pDefs = [
    { key: 'Routine', label: 'Routine', colour: api.PRIORITY_COLOURS['Routine'] },
    { key: 'Urgent', label: 'Urgent', colour: api.PRIORITY_COLOURS['Urgent'] },
    { key: 'TwoWeekWait', label: '2WW', colour: api.PRIORITY_COLOURS['TwoWeekWait'] },
  ];
  const sDefs = [
    { key: 'Completed', label: 'Completed', colour: api.STATUS_COLOURS['Completed'] },
    { key: 'Incomplete', label: 'Incomplete', colour: api.STATUS_COLOURS['Incomplete'] },
    { key: 'Cancelled', label: 'Cancelled', colour: api.STATUS_COLOURS['Cancelled'] },
  ];

  const chipHtml = (defs, attr) =>
    defs
      .map((d) => {
        const on = attr === 'priority' ? state.activePriorities.has(d.key) : state.activeStatuses.has(d.key);
        return `<button class="ref-chip${on ? ' active' : ''}" data-chip-${attr}="${escAttr(d.key)}"
              ${on ? `style="--chip-colour:${d.colour}"` : ''}>
              ${on ? `<span class="ref-chip-dot" style="background:${d.colour}"></span>` : ''}
              ${escHtml(d.label)}
            </button>`;
      })
      .join('');

  return `
    <div class="ref-chips-row">
      <span class="ref-chips-label">Priority</span>
      ${chipHtml(pDefs, 'priority')}
      <span class="ref-chips-sep"></span>
      <span class="ref-chips-label">Status</span>
      ${chipHtml(sDefs, 'status')}
    </div>
  `;
}

function renderClinicianSearch() {
  return `
    <div class="ref-search-row">
      <input type="text" id="refClinicianSearch" class="ref-search-input"
        placeholder="Search clinician…" value="${escAttr(state.clinicianSearch)}" />
      ${state.clinicianSearch ? `<button class="ref-search-clear" id="refSearchClear" title="Clear">×</button>` : ''}
    </div>
  `;
}

function renderPageNotice(shown, total) {
  return `
    <div class="ref-page-notice">
      Showing ${shown.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} referrals
      — hit max page count. Narrow the date range to see the remainder.
    </div>
  `;
}

function renderPriorityTiles(byPriority, total) {
  const api = ApiNs();
  return [
    { key: 'Routine', label: 'Routine', colour: api.PRIORITY_COLOURS['Routine'] },
    { key: 'Urgent', label: 'Urgent', colour: api.PRIORITY_COLOURS['Urgent'] },
    { key: 'TwoWeekWait', label: '2WW', colour: api.PRIORITY_COLOURS['TwoWeekWait'] },
  ]
    .map((p) => {
      const n = byPriority[p.key] || 0;
      const pct = total > 0 ? Math.round((n / total) * 100) : 0;
      return `
      <div class="ref-priority-tile">
        <div class="ref-priority-swatch" style="background:${p.colour}"></div>
        <div class="ref-priority-info">
          <div class="ref-priority-label">${escHtml(p.label)}</div>
          <div class="ref-priority-count">${n.toLocaleString('en-GB')}</div>
          <div class="ref-priority-pct">${pct}%</div>
        </div>
      </div>
    `;
    })
    .join('');
}

function renderStatusTiles(byStatus, total) {
  const api = ApiNs();
  return Object.entries(byStatus)
    .map(([key, n]) => {
      const colour = api.STATUS_COLOURS[key] || '#94a3b8';
      const pct = total > 0 ? Math.round((n / total) * 100) : 0;
      return `
      <div class="ref-status-tile">
        <div class="ref-status-dot" style="background:${colour}"></div>
        <div class="ref-status-info">
          <div class="ref-status-lbl">${escHtml(key)}</div>
          <div class="ref-status-cnt">${n.toLocaleString('en-GB')} <span class="ref-status-pct">${pct}%</span></div>
        </div>
      </div>
    `;
    })
    .join('');
}

function renderBars(a) {
  if (!a) a = state.aggregated;
  const api = ApiNs();

  let allRows;
  if (state.chartView === 'clinician') {
    allRows = a.byClinician;
    if (state.clinicianSearch) {
      const q = state.clinicianSearch.toLowerCase();
      allRows = allRows.filter((r) => r.name.toLowerCase().includes(q));
    }
  } else if (state.chartView === 'specialty') {
    allRows = a.bySpecialty;
  } else {
    allRows = a.byHospital;
  }

  const totalRows = allRows.length;
  const rows = state.chartExpanded ? allRows : allRows.slice(0, TOP_N);
  if (rows.length === 0) return '<div class="ref-empty">No data.</div>';

  const maxCount = rows[0].count;

  let barsHtml;
  if (state.chartView === 'clinician') {
    barsHtml = rows
      .map((r) => {
        const barPct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
        const segs = [
          { key: 'Routine', colour: api.PRIORITY_COLOURS['Routine'] },
          { key: 'Urgent', colour: api.PRIORITY_COLOURS['Urgent'] },
          { key: 'TwoWeekWait', colour: api.PRIORITY_COLOURS['TwoWeekWait'] },
        ]
          .map((p) => {
            const v = r.priorities[p.key] || 0;
            if (!v) return '';
            const segPct = r.count > 0 ? (v / r.count) * barPct : 0;
            return `<div class="ref-bar-seg" style="width:${segPct.toFixed(2)}%;background:${p.colour}" title="${escAttr(p.key)}: ${v}"></div>`;
          })
          .join('');
        return `
        <div class="ref-bar-row">
          <div class="ref-bar-name" title="${escAttr(r.name)}">${escHtml(r.name)}</div>
          <div class="ref-bar-track">${segs}</div>
          <div class="ref-bar-total">${r.count.toLocaleString('en-GB')}</div>
        </div>`;
      })
      .join('');
  } else {
    const colour = state.chartView === 'specialty' ? '#3b82f6' : '#a78bfa';
    barsHtml = rows
      .map((r) => {
        const barPct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
        return `
        <div class="ref-bar-row">
          <div class="ref-bar-name" title="${escAttr(r.name)}">${escHtml(r.name)}</div>
          <div class="ref-bar-track">
            <div class="ref-bar-seg" style="width:${barPct.toFixed(2)}%;background:${colour}" title="${escAttr(r.name)}: ${r.count}"></div>
          </div>
          <div class="ref-bar-total">${r.count.toLocaleString('en-GB')}</div>
        </div>`;
      })
      .join('');
  }

  const viewLabel =
    state.chartView === 'clinician' ? 'clinicians' : state.chartView === 'specialty' ? 'specialties' : 'hospitals';
  const showAllBtn =
    totalRows > TOP_N
      ? `
    <button class="ref-show-all" id="refShowAll">
      ${state.chartExpanded ? `▴ Show top ${TOP_N}` : `▾ Show all ${totalRows} ${viewLabel}`}
    </button>`
      : '';

  return barsHtml + showAllBtn;
}

function renderRateChart() {
  if (state.activityLoading) {
    return '<div class="ref-rate-loading">Loading activity data…</div>';
  }
  if (state.activityError) {
    return `
      <div class="ref-rate-unavailable">
        <div class="ref-rate-unavail-head">Activity data unavailable</div>
        <div class="ref-rate-unavail-body">Check that you are signed in to Medicus and the Activity module has been used in this session.</div>
        <div class="ref-rate-unavail-detail">${escHtml(state.activityError)}</div>
      </div>`;
  }
  if (!state.activityData || !state.aggregated) {
    return '<div class="ref-empty">No data for rate calculation.</div>';
  }

  const allRows = buildRateRows();
  if (!allRows || allRows.length === 0) {
    return '<div class="ref-empty">No clinicians with matching activity data for this period.</div>';
  }

  // Count clinicians excluded due to missing activity data
  const a = getFilteredAggregated() || state.aggregated;
  const actNames = new Set(state.activityData.map((r) => (r.name || '').toLowerCase().trim()));
  const excluded = a.byClinician.filter((c) => !actNames.has(c.name.toLowerCase().trim())).length;

  const totalRows = allRows.length;
  const rows = state.chartExpanded ? allRows : allRows.slice(0, TOP_N);
  const maxRate = rows[0].rate || 1;

  const barsHtml = rows
    .map((r) => {
      const barPct = (r.rate / maxRate) * 100;
      const pctDisp = (r.rate * 100).toFixed(1);
      return `
      <div class="ref-bar-row ref-bar-row--rate">
        <div class="ref-bar-name" title="${escAttr(r.name)}">${escHtml(r.name)}</div>
        <div class="ref-bar-track">
          <div class="ref-bar-seg" style="width:${barPct.toFixed(2)}%;background:#22d3ee"
               title="${escAttr(r.name)}: ${pctDisp}% (${r.referrals} ref / ${r.consultations} consult)"></div>
        </div>
        <div class="ref-bar-rate-label">
          <span class="ref-rate-pct">${pctDisp}%</span>
          <span class="ref-rate-counts">${r.referrals}/${r.consultations}</span>
        </div>
      </div>`;
    })
    .join('');

  const missingNote =
    excluded > 0
      ? `<div class="ref-rate-missing-note">${excluded} clinician${excluded > 1 ? 's' : ''} excluded — no matching activity data</div>`
      : '';

  const showAllBtn =
    totalRows > TOP_N
      ? `
    <button class="ref-show-all" id="refShowAll">
      ${state.chartExpanded ? `▴ Show top ${TOP_N}` : `▾ Show all ${totalRows} clinicians`}
    </button>`
      : '';

  return missingNote + barsHtml + showAllBtn;
}

// ── Wiring ────────────────────────────────────────────────────────────────────

// Single source of truth for what gets persisted to suite.uiState — every
// call site was duplicating this shape; item 5 adds two more fields to it.
function persistUiState() {
  saveUiState('referrals', {
    activePriorities: [...state.activePriorities],
    activeStatuses: [...state.activeStatuses],
    chartView: state.chartView,
    clinicianSearch: state.clinicianSearch,
    patientNameFilter: state.patientNameFilter,
    clinicianDropdownFilter: state.clinicianDropdownFilter,
  });
}

function wireControls() {
  const startEl = container.querySelector('#refStart');
  const endEl = container.querySelector('#refEnd');
  if (startEl)
    startEl.addEventListener('change', () => {
      state.startDate = startEl.value;
      fetchAndRender();
    });
  if (endEl)
    endEl.addEventListener('change', () => {
      state.endDate = endEl.value;
      fetchAndRender();
    });

  container.querySelectorAll('.ref-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const api = ApiNs();
      if (!api) return;
      const range = api.preset(btn.dataset.preset);
      if (range) {
        state.startDate = range[0];
        state.endDate = range[1];
        fetchAndRender();
      }
    });
  });

  container.querySelector('#refRefresh')?.addEventListener('click', fetchAndRender);
  container.querySelector('#refTsRefresh')?.addEventListener('click', fetchAndRender);
  container.querySelector('#refCsvBtn')?.addEventListener('click', downloadCSV);

  container.querySelectorAll('.ref-chart-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.chartView = btn.dataset.view;
      state.chartExpanded = false;
      state.clinicianSearch = '';
      persistUiState();
      render();
    });
  });

  container.querySelectorAll('[data-chip-priority]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.chipPriority;
      if (state.activePriorities.has(key)) {
        if (state.activePriorities.size > 1) state.activePriorities.delete(key);
      } else {
        state.activePriorities.add(key);
      }
      persistUiState();
      render();
    });
  });

  container.querySelectorAll('[data-chip-status]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.chipStatus;
      if (state.activeStatuses.has(key)) {
        if (state.activeStatuses.size > 1) state.activeStatuses.delete(key);
      } else {
        state.activeStatuses.add(key);
      }
      persistUiState();
      render();
    });
  });

  container.querySelector('#refShowAll')?.addEventListener('click', () => {
    state.chartExpanded = !state.chartExpanded;
    render();
  });

  const searchEl = container.querySelector('#refClinicianSearch');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      state.clinicianSearch = searchEl.value;
      state.chartExpanded = false;
      persistUiState();
      render();
    });
  }
  container.querySelector('#refSearchClear')?.addEventListener('click', () => {
    state.clinicianSearch = '';
    persistUiState();
    render();
  });

  // Patient-name search + clinician dropdown (item 5) — filter the main list/
  // chart AND the 2WW safety-net worklist together.
  const patientSearchEl = container.querySelector('#refPatientSearch');
  if (patientSearchEl) {
    patientSearchEl.addEventListener('input', () => {
      state.patientNameFilter = patientSearchEl.value;
      persistUiState();
      render();
    });
  }
  container.querySelector('#refPatientSearchClear')?.addEventListener('click', () => {
    state.patientNameFilter = '';
    persistUiState();
    render();
  });
  container.querySelector('#refClinicianDropdown')?.addEventListener('change', (e) => {
    state.clinicianDropdownFilter = e.target.value;
    persistUiState();
    render();
  });

  container.querySelector('#refDiscoveryOpen')?.addEventListener('click', focusMedicusReferrals);

  container.querySelector('#refDiagToggle')?.addEventListener('click', () => {
    state.showDiagnostics = !state.showDiagnostics;
    render();
  });

  container.querySelector('#refDiagClear')?.addEventListener('click', async () => {
    await chrome.storage.local.remove([DISCOVERY_KEY, CONFIG_KEY]);
    Object.assign(state, {
      discoveryUrl: null,
      configUrl: null,
      configPriorities: [],
      configStatuses: [],
      aggregated: null,
      rawReferrals: null,
      error: null,
      lastAttemptedUrl: null,
      _staleDiscovery: false,
    });
    render();
  });
}

// ── CSV Export ────────────────────────────────────────────────────────────────

// The patient-name search + clinician dropdown (item 5) are the "active
// filters" this export respects — the priority/status chips deliberately do
// NOT narrow the export (unchanged pre-existing behaviour: the CSV is always
// a full audit trail for the chosen date range regardless of chip state).
function downloadCSV() {
  const api = ApiNs();
  const rows = getSearchFilteredRawRows();
  if (!api || !rows?.length) return;

  const filterDesc = describeFilters({
    patientName: state.patientNameFilter,
    clinician: state.clinicianDropdownFilter,
  });

  const header = [
    'Date',
    'Patient First Name',
    'Patient Last Name',
    'Clinician',
    'Specialty',
    'Hospital',
    'Priority',
    'Status',
    'e-Referral',
    'Manual',
  ];
  // Header comment line discloses the active filters so a CSV opened later
  // (or forwarded) is never mistaken for the full unfiltered date range.
  // describeFilters() already strips CR/LF from the free-text patient-name
  // search before returning — see its doc comment (CSV row-injection guard).
  const lines = filterDesc ? [`# Filtered: ${filterDesc}`] : [];
  lines.push(header.join(','));

  for (const r of rows) {
    const { specialty, hospital } = api.parseReferralService(r.referralService);
    lines.push(
      [
        csvCell(r.referralDate || ''),
        csvCell(r.patientGivenName || ''),
        csvCell(r.patientFamilyName || ''),
        csvCell(r.referringClinician || ''),
        csvCell(specialty),
        csvCell(hospital),
        csvCell(r.priority || ''),
        csvCell(r.displayStatus || ''),
        r.isNhsEReferral ? 'Y' : 'N',
        r.isManualReferral ? 'Y' : 'N',
      ].join(',')
    );
  }

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const suffix = filterDesc ? '-filtered' : '';
  a.download = `referrals-${state.startDate}-to-${state.endDate}${suffix}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Empty-state deep link: bring an already-open Medicus tab to the front (the
// common case — the secretary has Medicus open) so she can open
// Referrals → Clinical Audit Report, or open a fresh Medicus tab if none.
async function focusMedicusReferrals() {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.medicus.health/*' });
    const tab = tabs.find((t) => t.active) || tabs[0];
    if (tab?.id != null) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch (_) {
    // fall through to opening a new tab
  }
  chrome.tabs.create({ url: 'https://england.medicus.health/' });
}

function relativeTime(date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}
