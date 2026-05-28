// Medicus Suite — Referrals Tracker v1.0

'use strict';

function ApiNs() { return (typeof window !== 'undefined') ? window.ReferralsApi : null; }

const DEFAULT_PRESET = 'last12m';
const TOP_N          = 15;
const STALE_MS       = 30 * 60 * 1000;
const DISCOVERY_KEY  = 'referrals.discovery';
const CONFIG_KEY     = 'referrals.config';

let container      = null;
let stalenessTimer = null;
let _inFlight      = false;

let state = {
  discoveryUrl:     null,
  configUrl:        null,
  configPriorities: [],
  configStatuses:   [],
  startDate:        null,
  endDate:          null,
  rawReferrals:     null,
  totalCount:       0,
  aggregated:       null,
  loading:          false,
  loadingProgress:  null,
  error:            null,
  chartView:        'clinician',
  chartExpanded:    false,
  clinicianSearch:  '',
  activePriorities: new Set(['Routine', 'Urgent', 'TwoWeekWait']),
  activeStatuses:   new Set(['Completed', 'Incomplete', 'Cancelled']),
  lastFetched:      null,
  lastAttemptedUrl: null,
  showDiagnostics:  false,
  activityData:     null,
  activityError:    null,
  activityLoading:  false,
};

function resolveStored(stored) {
  const cfgData = stored[CONFIG_KEY]?.data || {};
  return {
    discoveryUrl: stored[DISCOVERY_KEY]?.url || null,
    configUrl:    stored[CONFIG_KEY]?.url    || null,
    priorities:   (cfgData.priorityOptions || []).map(o => o.value).filter(Boolean),
    statuses:     (cfgData.statusOptions   || []).map(o => o.value).filter(Boolean),
  };
}

// Re-aggregate raw referrals using only the active priority/status chips.
// Returns full aggregation unchanged when all chips are active.
function getFilteredAggregated() {
  const api = ApiNs();
  if (!api || !state.rawReferrals) return state.aggregated;
  const allP = ['Routine', 'Urgent', 'TwoWeekWait'];
  const allS = ['Completed', 'Incomplete', 'Cancelled'];
  if (state.activePriorities.size === allP.length && state.activeStatuses.size === allS.length)
    return state.aggregated;
  const filtered = state.rawReferrals.filter(r =>
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
    const key          = c.name.toLowerCase().trim();
    const consultations = consultMap.get(key);
    if (consultations == null || consultations === 0) continue;
    rows.push({ name: c.name, referrals: c.count, consultations, rate: c.count / consultations });
  }

  if (state.clinicianSearch) {
    const q = state.clinicianSearch.toLowerCase();
    rows = rows.filter(r => r.name.toLowerCase().includes(q));
  }

  return rows.sort((a, b) => b.rate - a.rate);
}

export async function init(el) {
  container = el;

  const api = ApiNs();
  if (api) {
    const range = api.preset(DEFAULT_PRESET);
    if (range) { state.startDate = range[0]; state.endDate = range[1]; }
  }

  const stored = await chrome.storage.local.get([DISCOVERY_KEY, CONFIG_KEY]);
  const r = resolveStored(stored);
  state.discoveryUrl     = r.discoveryUrl;
  state.configUrl        = r.configUrl;
  state.configPriorities = r.priorities;
  state.configStatuses   = r.statuses;

  render();
  if (state.discoveryUrl || state.configUrl) fetchAndRender();

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

  const onChange = ch => {
    if (ch['suite.practiceCode']) { fetchAndRender(); return; }
    if (ch[DISCOVERY_KEY] || ch[CONFIG_KEY]) {
      chrome.storage.local.get([DISCOVERY_KEY, CONFIG_KEY]).then(s => {
        const r = resolveStored(s);
        const changed = r.discoveryUrl !== state.discoveryUrl || r.configUrl !== state.configUrl;
        state.discoveryUrl     = r.discoveryUrl;
        state.configUrl        = r.configUrl;
        state.configPriorities = r.priorities;
        state.configStatuses   = r.statuses;
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
    if (!api) { state.error = 'Referrals API module not loaded'; render(); return; }
    if (!state.discoveryUrl) { render(); return; }

    const { code, source } = await window.PracticeCode.resolve();

    state.loading        = true;
    state.error          = null;
    state.loadingProgress  = null;
    state.activityLoading  = true;
    state.activityError    = null;
    state.lastAttemptedUrl = api.buildUrlFromTemplate(state.discoveryUrl, state.startDate, state.endDate, 0, 2000);
    render();

    const actFetch = window.ActivityApi
      ? window.ActivityApi.fetchActivityReport(code, state.startDate, state.endDate, {
          fetch: (url, init) => window.ApiDiag.fetch({
            module: 'referrals-rate', url, code: code || '(auto)', codeSource: source || 'tab', init,
          }),
        })
      : Promise.reject(new Error('Activity module not loaded'));

    const [refResult, actResult] = await Promise.allSettled([
      api.fetchReferrals(code, state.startDate, state.endDate, {
        templateUrl: state.discoveryUrl,
        onProgress: (loaded, total) => { state.loadingProgress = { loaded, total }; render(); },
        fetch: (url, init) => window.ApiDiag.fetch({
          module: 'referrals', url, code: code || '(auto)', codeSource: source || 'tab', init,
        }),
      }),
      actFetch,
    ]);

    if (refResult.status === 'fulfilled') {
      const result = refResult.value;
      state.rawReferrals = result.referrals;
      state.totalCount   = result.totalCount;
      state.aggregated   = api.aggregate(result.referrals);
      state.lastFetched  = new Date();
      state.error        = null;
      if (result.url) state.lastAttemptedUrl = result.url;
    } else {
      state.error = refResult.reason?.message || String(refResult.reason);
      if (refResult.reason?.url) state.lastAttemptedUrl = refResult.reason.url;
    }

    if (actResult.status === 'fulfilled') {
      state.activityData  = actResult.value?.rowData || [];
      state.activityError = null;
    } else {
      state.activityData  = null;
      state.activityError = actResult.reason?.message || String(actResult.reason);
    }

    state.loading         = false;
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
      ${state.loading        ? renderSkeleton()         :
        state.error          ? renderError()            :
        !state.discoveryUrl  ? renderDiscoveryPrompt()  :
        state.aggregated     ? renderData()             : ''}
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
  return `
    <div class="ref-discovery-prompt">
      <svg class="ref-discovery-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <p class="ref-discovery-head">Navigate to the referrals page</p>
      <p class="ref-discovery-body">
        Open <strong>Referrals → Clinical Audit Report</strong> in any Medicus tab.
        The extension will detect the API endpoint automatically and load the charts here.
      </p>
      <div class="ref-discovery-path">Referrals → Clinical Audit Report</div>
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
    `Config URL:    ${state.configUrl    || '(none)'}`,
    `Priorities (from config.priorityOptions[*].value): ${state.configPriorities.length ? state.configPriorities.join(', ') : '(none)'}`,
    `Statuses   (from config.statusOptions[*].value):  ${state.configStatuses.length   ? state.configStatuses.join(', ')   : '(none)'}`,
    `Last attempted URL: ${state.lastAttemptedUrl || '(none yet)'}`,
  ];
  return `
    <div class="ref-diag">
      <button class="ref-diag-toggle" id="refDiagToggle">${o ? '▾' : '▸'} Diagnostics</button>
      ${o ? `<pre class="ref-diag-body">${escHtml(lines.join('\n'))}</pre>
            <div class="ref-diag-actions">
              <button class="ref-btn-secondary" id="refDiagClear">Clear stored discovery</button>
            </div>` : ''}
    </div>
  `;
}

function renderData() {
  const a = getFilteredAggregated() || state.aggregated;
  if (!a || a.total === 0) return `<div class="ref-empty">No referrals in this date range.</div>`;

  const total   = a.total;
  const dbTotal = state.totalCount;
  const shown   = state.rawReferrals?.length || total;

  const periodLabel = state.startDate === state.endDate
    ? formatDateLabel(state.startDate)
    : `${formatDateLabel(state.startDate)} → ${formatDateLabel(state.endDate)}`;

  return `
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

    ${renderFilterChips()}

    <div class="ref-chart-card">
      <div class="ref-chart-head">
        <div class="ref-card-label">Breakdown</div>
        <div class="ref-chart-tabs">
          <button class="ref-chart-tab ${state.chartView === 'clinician' ? 'active' : ''}" data-view="clinician">By clinician</button>
          <button class="ref-chart-tab ${state.chartView === 'specialty' ? 'active' : ''}" data-view="specialty">By specialty</button>
          <button class="ref-chart-tab ${state.chartView === 'hospital'  ? 'active' : ''}" data-view="hospital">By hospital</button>
          <button class="ref-chart-tab ${state.chartView === 'rate'      ? 'active' : ''}" data-view="rate">Rate</button>
        </div>
      </div>
      ${(state.chartView === 'clinician' || state.chartView === 'rate') ? renderClinicianSearch() : ''}
      <div class="ref-bars">${state.chartView === 'rate' ? renderRateChart() : renderBars(a)}</div>
    </div>
  `;
}

function renderFilterChips() {
  const api = ApiNs();
  const pDefs = [
    { key: 'Routine',     label: 'Routine', colour: api.PRIORITY_COLOURS['Routine'] },
    { key: 'Urgent',      label: 'Urgent',  colour: api.PRIORITY_COLOURS['Urgent'] },
    { key: 'TwoWeekWait', label: '2WW',     colour: api.PRIORITY_COLOURS['TwoWeekWait'] },
  ];
  const sDefs = [
    { key: 'Completed',  label: 'Completed',  colour: api.STATUS_COLOURS['Completed'] },
    { key: 'Incomplete', label: 'Incomplete', colour: api.STATUS_COLOURS['Incomplete'] },
    { key: 'Cancelled',  label: 'Cancelled',  colour: api.STATUS_COLOURS['Cancelled'] },
  ];

  const chipHtml = (defs, attr) => defs.map(d => {
    const on = attr === 'priority' ? state.activePriorities.has(d.key) : state.activeStatuses.has(d.key);
    return `<button class="ref-chip${on ? ' active' : ''}" data-chip-${attr}="${escAttr(d.key)}"
              ${on ? `style="--chip-colour:${d.colour}"` : ''}>
              ${on ? `<span class="ref-chip-dot" style="background:${d.colour}"></span>` : ''}
              ${escHtml(d.label)}
            </button>`;
  }).join('');

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
    { key: 'Routine',     label: 'Routine', colour: api.PRIORITY_COLOURS['Routine'] },
    { key: 'Urgent',      label: 'Urgent',  colour: api.PRIORITY_COLOURS['Urgent'] },
    { key: 'TwoWeekWait', label: '2WW',     colour: api.PRIORITY_COLOURS['TwoWeekWait'] },
  ].map(p => {
    const n   = byPriority[p.key] || 0;
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
  }).join('');
}

function renderStatusTiles(byStatus, total) {
  const api = ApiNs();
  return Object.entries(byStatus).map(([key, n]) => {
    const colour = api.STATUS_COLOURS[key] || '#94a3b8';
    const pct    = total > 0 ? Math.round((n / total) * 100) : 0;
    return `
      <div class="ref-status-tile">
        <div class="ref-status-dot" style="background:${colour}"></div>
        <div class="ref-status-info">
          <div class="ref-status-lbl">${escHtml(key)}</div>
          <div class="ref-status-cnt">${n.toLocaleString('en-GB')} <span class="ref-status-pct">${pct}%</span></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderBars(a) {
  if (!a) a = state.aggregated;
  const api = ApiNs();

  let allRows;
  if (state.chartView === 'clinician') {
    allRows = a.byClinician;
    if (state.clinicianSearch) {
      const q = state.clinicianSearch.toLowerCase();
      allRows = allRows.filter(r => r.name.toLowerCase().includes(q));
    }
  } else if (state.chartView === 'specialty') {
    allRows = a.bySpecialty;
  } else {
    allRows = a.byHospital;
  }

  const totalRows = allRows.length;
  const rows      = state.chartExpanded ? allRows : allRows.slice(0, TOP_N);
  if (rows.length === 0) return '<div class="ref-empty">No data.</div>';

  const maxCount = rows[0].count;

  let barsHtml;
  if (state.chartView === 'clinician') {
    barsHtml = rows.map(r => {
      const barPct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
      const segs = [
        { key: 'Routine',     colour: api.PRIORITY_COLOURS['Routine'] },
        { key: 'Urgent',      colour: api.PRIORITY_COLOURS['Urgent'] },
        { key: 'TwoWeekWait', colour: api.PRIORITY_COLOURS['TwoWeekWait'] },
      ].map(p => {
        const v = r.priorities[p.key] || 0;
        if (!v) return '';
        const segPct = r.count > 0 ? (v / r.count) * barPct : 0;
        return `<div class="ref-bar-seg" style="width:${segPct.toFixed(2)}%;background:${p.colour}" title="${escAttr(p.key)}: ${v}"></div>`;
      }).join('');
      return `
        <div class="ref-bar-row">
          <div class="ref-bar-name" title="${escAttr(r.name)}">${escHtml(r.name)}</div>
          <div class="ref-bar-track">${segs}</div>
          <div class="ref-bar-total">${r.count.toLocaleString('en-GB')}</div>
        </div>`;
    }).join('');
  } else {
    const colour = state.chartView === 'specialty' ? '#3b82f6' : '#a78bfa';
    barsHtml = rows.map(r => {
      const barPct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
      return `
        <div class="ref-bar-row">
          <div class="ref-bar-name" title="${escAttr(r.name)}">${escHtml(r.name)}</div>
          <div class="ref-bar-track">
            <div class="ref-bar-seg" style="width:${barPct.toFixed(2)}%;background:${colour}" title="${escAttr(r.name)}: ${r.count}"></div>
          </div>
          <div class="ref-bar-total">${r.count.toLocaleString('en-GB')}</div>
        </div>`;
    }).join('');
  }

  const viewLabel = state.chartView === 'clinician' ? 'clinicians'
                  : state.chartView === 'specialty' ? 'specialties' : 'hospitals';
  const showAllBtn = totalRows > TOP_N ? `
    <button class="ref-show-all" id="refShowAll">
      ${state.chartExpanded ? `▴ Show top ${TOP_N}` : `▾ Show all ${totalRows} ${viewLabel}`}
    </button>` : '';

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
  const a        = getFilteredAggregated() || state.aggregated;
  const actNames = new Set(state.activityData.map(r => (r.name || '').toLowerCase().trim()));
  const excluded = a.byClinician.filter(c => !actNames.has(c.name.toLowerCase().trim())).length;

  const totalRows = allRows.length;
  const rows      = state.chartExpanded ? allRows : allRows.slice(0, TOP_N);
  const maxRate   = rows[0].rate || 1;

  const barsHtml = rows.map(r => {
    const barPct  = (r.rate / maxRate) * 100;
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
  }).join('');

  const missingNote = excluded > 0
    ? `<div class="ref-rate-missing-note">${excluded} clinician${excluded > 1 ? 's' : ''} excluded — no matching activity data</div>`
    : '';

  const showAllBtn = totalRows > TOP_N ? `
    <button class="ref-show-all" id="refShowAll">
      ${state.chartExpanded ? `▴ Show top ${TOP_N}` : `▾ Show all ${totalRows} clinicians`}
    </button>` : '';

  return missingNote + barsHtml + showAllBtn;
}

// ── Wiring ────────────────────────────────────────────────────────────────────

function wireControls() {
  const startEl = container.querySelector('#refStart');
  const endEl   = container.querySelector('#refEnd');
  if (startEl) startEl.addEventListener('change', () => { state.startDate = startEl.value; fetchAndRender(); });
  if (endEl)   endEl.addEventListener('change',   () => { state.endDate   = endEl.value;   fetchAndRender(); });

  container.querySelectorAll('.ref-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const api = ApiNs();
      if (!api) return;
      const range = api.preset(btn.dataset.preset);
      if (range) { state.startDate = range[0]; state.endDate = range[1]; fetchAndRender(); }
    });
  });

  container.querySelector('#refRefresh')?.addEventListener('click', fetchAndRender);
  container.querySelector('#refTsRefresh')?.addEventListener('click', fetchAndRender);
  container.querySelector('#refCsvBtn')?.addEventListener('click', downloadCSV);

  container.querySelectorAll('.ref-chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.chartView       = btn.dataset.view;
      state.chartExpanded   = false;
      state.clinicianSearch = '';
      render();
    });
  });

  container.querySelectorAll('[data-chip-priority]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.chipPriority;
      if (state.activePriorities.has(key)) {
        if (state.activePriorities.size > 1) state.activePriorities.delete(key);
      } else {
        state.activePriorities.add(key);
      }
      render();
    });
  });

  container.querySelectorAll('[data-chip-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.chipStatus;
      if (state.activeStatuses.has(key)) {
        if (state.activeStatuses.size > 1) state.activeStatuses.delete(key);
      } else {
        state.activeStatuses.add(key);
      }
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
      state.chartExpanded   = false;
      render();
    });
  }
  container.querySelector('#refSearchClear')?.addEventListener('click', () => {
    state.clinicianSearch = '';
    render();
  });

  container.querySelector('#refDiagToggle')?.addEventListener('click', () => {
    state.showDiagnostics = !state.showDiagnostics;
    render();
  });

  container.querySelector('#refDiagClear')?.addEventListener('click', async () => {
    await chrome.storage.local.remove([DISCOVERY_KEY, CONFIG_KEY]);
    Object.assign(state, {
      discoveryUrl: null, configUrl: null, configPriorities: [], configStatuses: [],
      aggregated: null, rawReferrals: null, error: null, lastAttemptedUrl: null,
    });
    render();
  });
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function downloadCSV() {
  const api  = ApiNs();
  const rows = state.rawReferrals;
  if (!api || !rows?.length) return;

  const header = ['Date','Patient First Name','Patient Last Name','Clinician','Specialty','Hospital','Priority','Status','e-Referral','Manual'];
  const lines  = [header.join(',')];

  for (const r of rows) {
    const { specialty, hospital } = api.parseReferralService(r.referralService);
    lines.push([
      csvCell(r.referralDate      || ''),
      csvCell(r.patientGivenName  || ''),
      csvCell(r.patientFamilyName || ''),
      csvCell(r.referringClinician || ''),
      csvCell(specialty),
      csvCell(hospital),
      csvCell(r.priority      || ''),
      csvCell(r.displayStatus || ''),
      r.isNhsEReferral   ? 'Y' : 'N',
      r.isManualReferral ? 'Y' : 'N',
    ].join(','));
  }

  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `referrals-${state.startDate}-to-${state.endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d))
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }
