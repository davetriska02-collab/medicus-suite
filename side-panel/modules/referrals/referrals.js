// Medicus Suite — Referrals Tracker v1.0
//
// Fetches referral audit data from the Medicus clinical-audit-report endpoint
// and renders charts: by clinician, by specialty, by hospital, with priority
// and status breakdowns.

'use strict';

function ApiNs() { return (typeof window !== 'undefined') ? window.ReferralsApi : null; }

const DEFAULT_PRESET   = 'last12m';
const TOP_N            = 15;
const DISCOVERY_KEY    = 'referrals.discovery';
const CONFIG_KEY       = 'referrals.config';

let container = null;
let state = {
  discoveredBaseUrl:  null,  // extracted from referrals.config / referrals.discovery storage
  configPriorities:   [],    // actual priority values from config.data.priorityOptions[*].value
  configStatuses:     [],    // actual status values from config.data.statusOptions[*].value
  startDate:          null,
  endDate:            null,
  rawReferrals:       null,
  totalCount:         0,
  aggregated:         null,
  loading:            false,
  error:              null,
  chartView:          'clinician',  // 'clinician' | 'specialty' | 'hospital'
  lastFetched:        null,
};

function resolveBaseUrl(stored) {
  const api = ApiNs();
  if (!api) return null;
  // Prefer the discovery data URL (already confirmed to return referral rows),
  // fall back to the config URL (same endpoint, different params).
  const raw = stored[DISCOVERY_KEY]?.url || stored[CONFIG_KEY]?.url || null;
  return raw ? api.extractBaseUrl(raw) : null;
}

function resolveConfigParams(stored) {
  const data = stored[CONFIG_KEY]?.data || {};
  return {
    priorities: (data.priorityOptions || []).map(o => o.value).filter(Boolean),
    statuses:   (data.statusOptions   || []).map(o => o.value).filter(Boolean),
  };
}

export async function init(el) {
  container = el;

  const api = ApiNs();
  if (api) {
    const range = api.preset(DEFAULT_PRESET);
    if (range) { state.startDate = range[0]; state.endDate = range[1]; }
  }

  // Load discovered URL + config params from storage (written by referrals-discovery content script)
  const stored = await chrome.storage.local.get([DISCOVERY_KEY, CONFIG_KEY]);
  state.discoveredBaseUrl = resolveBaseUrl(stored);
  const cfg = resolveConfigParams(stored);
  state.configPriorities = cfg.priorities;
  state.configStatuses   = cfg.statuses;

  render();
  if (state.discoveredBaseUrl) fetchAndRender();

  const onChange = ch => {
    if (ch['suite.practiceCode']) {
      fetchAndRender();
      return;
    }
    if (ch[DISCOVERY_KEY] || ch[CONFIG_KEY]) {
      // Discovery just ran — refresh stored URL and config params, then fetch
      chrome.storage.local.get([DISCOVERY_KEY, CONFIG_KEY]).then(s => {
        const url = resolveBaseUrl(s);
        const cfg = resolveConfigParams(s);
        state.configPriorities = cfg.priorities;
        state.configStatuses   = cfg.statuses;
        if (url && url !== state.discoveredBaseUrl) {
          state.discoveredBaseUrl = url;
          fetchAndRender();
        } else if (url && !state.aggregated && !state.loading) {
          fetchAndRender();
        }
      });
    }
  };
  chrome.storage.onChanged.addListener(onChange);

  return () => {
    chrome.storage.onChanged.removeListener(onChange);
    container = null;
  };
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchAndRender() {
  if (!container) return;
  const api = ApiNs();
  if (!api) {
    state.error = 'Referrals API module not loaded';
    render();
    return;
  }

  if (!state.discoveredBaseUrl) {
    // No URL yet — show the discovery prompt rather than erroring
    render();
    return;
  }

  const { code, source } = await window.PracticeCode.resolve();

  state.loading = true;
  state.error = null;
  render();

  try {
    const result = await api.fetchReferrals(code, state.startDate, state.endDate, {
      baseUrl:    state.discoveredBaseUrl,
      priorities: state.configPriorities.length ? state.configPriorities : undefined,
      statuses:   state.configStatuses.length   ? state.configStatuses   : undefined,
      fetch: (url, init) => window.ApiDiag.fetch({
        module: 'referrals', url, code: code || '(auto)', codeSource: source || 'tab', init,
      }),
    });
    state.rawReferrals = result.referrals;
    state.totalCount   = result.totalCount;
    state.aggregated   = api.aggregate(result.referrals);
    state.lastFetched  = new Date();
    state.error        = null;
  } catch (e) {
    state.error = e.message || String(e);
  } finally {
    state.loading = false;
    render();
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
      ${state.loading        ? renderSkeleton()  :
        state.error          ? renderError()     :
        !state.discoveredBaseUrl ? renderDiscoveryPrompt() :
        state.aggregated     ? renderData()      : ''}
    </div>
  `;
  wireControls();
}

function renderControls() {
  const api = ApiNs();
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
        <button class="ref-refresh" id="refRefresh">Refresh</button>
      </div>
      ${state.lastFetched ? `<div class="ref-ts">Updated ${state.lastFetched.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', second:'2-digit'})}</div>` : ''}
    </div>
  `;
}

function renderSkeleton() {
  return `
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
  return `<div class="ref-error">${escHtml(state.error)}</div>`;
}

function renderData() {
  const a = state.aggregated;
  if (!a || a.total === 0) {
    return `<div class="ref-empty">No referrals in this date range.</div>`;
  }

  const api      = ApiNs();
  const total    = a.total;
  const shown    = total;
  const dbTotal  = state.totalCount;

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
      <div class="ref-summary-number">${shown.toLocaleString('en-GB')}</div>
      <div class="ref-breakdown-grid">
        ${renderPriorityTiles(a.byPriority, total)}
      </div>
    </div>

    <div class="ref-status-card">
      <div class="ref-card-label">Status breakdown</div>
      <div class="ref-status-tiles">
        ${renderStatusTiles(a.byStatus, total)}
      </div>
    </div>

    <div class="ref-chart-card">
      <div class="ref-chart-head">
        <div class="ref-card-label">Breakdown</div>
        <div class="ref-chart-tabs">
          <button class="ref-chart-tab ${state.chartView === 'clinician' ? 'active' : ''}" data-view="clinician">By clinician</button>
          <button class="ref-chart-tab ${state.chartView === 'specialty' ? 'active' : ''}" data-view="specialty">By specialty</button>
          <button class="ref-chart-tab ${state.chartView === 'hospital'  ? 'active' : ''}" data-view="hospital">By hospital</button>
        </div>
      </div>
      <div class="ref-bars">${renderBars()}</div>
    </div>
  `;
}

function renderPageNotice(shown, total) {
  return `
    <div class="ref-page-notice">
      Showing ${shown.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} referrals
      (API page limit). Adjust the date range to narrow results.
    </div>
  `;
}

function renderPriorityTiles(byPriority, total) {
  const api = ApiNs();
  const priorities = [
    { key: 'Routine',     label: 'Routine',  colour: api.PRIORITY_COLOURS['Routine'] },
    { key: 'Urgent',      label: 'Urgent',   colour: api.PRIORITY_COLOURS['Urgent'] },
    { key: 'TwoWeekWait', label: '2WW',      colour: api.PRIORITY_COLOURS['TwoWeekWait'] },
  ];
  return priorities.map(p => {
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

function renderBars() {
  const a   = state.aggregated;
  const api = ApiNs();

  let rows;
  if (state.chartView === 'clinician') {
    rows = a.byClinician.slice(0, TOP_N);
  } else if (state.chartView === 'specialty') {
    rows = a.bySpecialty.slice(0, TOP_N);
  } else {
    rows = a.byHospital.slice(0, TOP_N);
  }

  if (rows.length === 0) return '<div class="ref-empty">No data.</div>';

  const maxCount = rows[0].count;

  if (state.chartView === 'clinician') {
    // Stacked bars showing priority breakdown per clinician
    return rows.map(r => {
      const barPct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
      const segs = [
        { key: 'Routine',     colour: api.PRIORITY_COLOURS['Routine'] },
        { key: 'Urgent',      colour: api.PRIORITY_COLOURS['Urgent'] },
        { key: 'TwoWeekWait', colour: api.PRIORITY_COLOURS['TwoWeekWait'] },
      ].map(p => {
        const v = r.priorities[p.key] || 0;
        if (v === 0) return '';
        const segPct = r.count > 0 ? (v / r.count) * barPct : 0;
        return `<div class="ref-bar-seg" style="width:${segPct.toFixed(2)}%;background:${p.colour}" title="${escAttr(p.key)}: ${v}"></div>`;
      }).join('');
      return `
        <div class="ref-bar-row">
          <div class="ref-bar-name" title="${escAttr(r.name)}">${escHtml(r.name)}</div>
          <div class="ref-bar-track">${segs}</div>
          <div class="ref-bar-total">${r.count.toLocaleString('en-GB')}</div>
        </div>
      `;
    }).join('');
  }

  // Simple single-colour bars for specialty / hospital
  const colour = state.chartView === 'specialty' ? '#3b82f6' : '#a78bfa';
  return rows.map(r => {
    const barPct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
    return `
      <div class="ref-bar-row">
        <div class="ref-bar-name" title="${escAttr(r.name)}">${escHtml(r.name)}</div>
        <div class="ref-bar-track">
          <div class="ref-bar-seg" style="width:${barPct.toFixed(2)}%;background:${colour}" title="${escAttr(r.name)}: ${r.count}"></div>
        </div>
        <div class="ref-bar-total">${r.count.toLocaleString('en-GB')}</div>
      </div>
    `;
  }).join('');
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

  container.querySelectorAll('.ref-chart-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.chartView = btn.dataset.view;
      render();
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
