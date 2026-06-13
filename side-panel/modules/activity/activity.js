// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Activity Report module v1.0
//
// Fetches /reporting/data/activity/report for a configurable date range,
// renders period totals and a stacked horizontal bar chart broken down by
// staff member.

'use strict';

// Access the shared API surface attached to window by ../shared/activity-api.js
// (loaded as a regular script tag in panel.html). Importing as ES module would
// need a separate build; for module parity with other side-panel modules we
// just read off window.
function ApiNs() {
  return typeof window !== 'undefined' ? window.ActivityApi : null;
}

import { loadUiState, saveUiState } from '../shared/ui-state.js';
import { freshnessHtml, attachFreshnessTicker } from '../shared/freshness.js';
import { downloadCsv } from '../shared/export-util.js';

let container = null;
let _inFlight = false;
let state = {
  startDate: null,
  endDate: null,
  rawResponse: null,
  aggregated: null,
  loading: false,
  error: null,
  showMode: 'stacked', // 'stacked' | 'total' | single metric key
  lastFetched: null,
};

export async function init(el) {
  container = el;
  // Default range — today (may be overridden by persisted state below)
  const api = ApiNs();
  if (api) {
    const [s, e] = api.preset('today');
    state.startDate = s;
    state.endDate = e;
  }

  // Restore persisted view state (TTL 24 h — expired range resets to today naturally)
  const saved = await loadUiState('activity');
  if (saved) {
    // Validate each field before applying
    const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof saved.startDate === 'string' && ISO_RE.test(saved.startDate)) state.startDate = saved.startDate;
    if (typeof saved.endDate === 'string' && ISO_RE.test(saved.endDate)) state.endDate = saved.endDate;
    // Decision B: derive VALID_MODES from the real metric keys rather than hard-coding stale keys
    const VALID_MODES = ['stacked', 'total', ...(api ? api.METRICS.map((m) => m.key) : [])];
    if (typeof saved.showMode === 'string' && VALID_MODES.includes(saved.showMode)) state.showMode = saved.showMode;
  }

  render();
  fetchAndRender();
  const stopFresh = attachFreshnessTicker(container);

  // Listen for practice code changes (auto-detection updates) and refetch
  const onChange = (ch) => {
    if (ch['suite.practiceCode']) fetchAndRender();
  };
  chrome.storage.onChanged.addListener(onChange);

  return () => {
    chrome.storage.onChanged.removeListener(onChange);
    stopFresh();
    container = null;
  };
}

// ── Fetch ────────────────────────────────────────────────────────────────────

async function fetchAndRender() {
  if (!container) return;
  if (_inFlight) return;
  _inFlight = true;
  const refreshBtn = container.querySelector('#actRefresh');
  if (refreshBtn) refreshBtn.disabled = true;
  try {
    const api = ApiNs();
    if (!api) {
      state.error = 'Activity API module not loaded';
      render();
      return;
    }

    const { code, source } = await window.PracticeCode.resolve();
    if (!code) {
      state.error = 'No practice code — open a Medicus tab or set it in Options.';
      state.loading = false;
      render();
      return;
    }

    state.loading = true;
    state.error = null;
    render();

    try {
      const data = await api.fetchActivityReport(code, state.startDate, state.endDate, {
        fetch: (url, init) =>
          window.ApiDiag.fetch({
            module: 'activity',
            url,
            code,
            codeSource: source,
            init,
          }),
      });
      state.rawResponse = data;
      state.aggregated = api.aggregate(data?.rowData || []);
      state.lastFetched = new Date();
      state.error = null;
    } catch (e) {
      state.error = e.message || String(e);
    } finally {
      state.loading = false;
      render();
    }
  } finally {
    _inFlight = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

// ── Render ───────────────────────────────────────────────────────────────────

function render() {
  if (!container) return;
  const api = ApiNs();
  if (!api) {
    container.innerHTML = '<div class="module-wrap"><div class="banner">Activity module failed to load.</div></div>';
    return;
  }

  container.innerHTML = `
    <div class="act-module module-wrap">
      <div class="module-header">
        <div class="module-title-row">
          <h2 class="module-title">Activity</h2>
          <span class="module-ver">v1.0</span>
        </div>
        <div class="module-subtitle">Practice activity per staff member</div>
      </div>

      ${renderControls()}
      <div class="act-results" aria-live="polite" aria-atomic="false">
        ${state.loading ? renderSkeleton() : state.error ? renderError() : state.aggregated ? renderData() : ''}
      </div>
    </div>
  `;

  wireControls();
}

function renderControls() {
  const api = ApiNs();
  // Decision H: compute which preset (if any) matches the current date range
  const PRESET_NAMES = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth'];
  const PRESET_LABELS = {
    today: 'Today',
    yesterday: 'Yesterday',
    last7: 'Last 7d',
    last30: 'Last 30d',
    thisMonth: 'This month',
    lastMonth: 'Last month',
  };
  let activePreset = null;
  if (api && state.startDate && state.endDate) {
    for (const name of PRESET_NAMES) {
      const range = api.preset(name);
      if (range && range[0] === state.startDate && range[1] === state.endDate) {
        activePreset = name;
        break;
      }
    }
  }

  return `
    <div class="act-controls">
      <div class="act-date-row">
        <label class="act-date-label">From</label>
        <input type="date" id="actStart" class="act-date-input" value="${state.startDate || ''}" max="${todayISO()}" />
        <label class="act-date-label">To</label>
        <input type="date" id="actEnd" class="act-date-input" value="${state.endDate || ''}" max="${todayISO()}" />
      </div>
      <div class="act-preset-row">
        ${PRESET_NAMES.map(
          (name) =>
            `<button class="act-preset${activePreset === name ? ' active' : ''}" data-preset="${name}">${escHtml(PRESET_LABELS[name])}</button>`
        ).join('')}
        <span class="act-spacer"></span>
        ${state.aggregated && state.aggregated.users.length > 0 ? `<button class="act-refresh" id="actCsvBtn">&#x2193; CSV</button>` : ''}
        <button class="act-refresh" id="actRefresh">Refresh</button>
      </div>
      ${state.lastFetched ? `<div class="act-ts">${freshnessHtml(state.lastFetched)}</div>` : ''}
    </div>
  `;
}

function renderSkeleton() {
  return `
    <div class="act-skeleton" role="status" aria-label="Loading activity data">
      <div class="act-skel-line act-skel-w60"></div>
      <div class="act-skel-line act-skel-w80"></div>
      <div class="act-skel-line act-skel-w70"></div>
      <div class="act-skel-line act-skel-w50"></div>
    </div>
  `;
}

function renderError() {
  const cta =
    state.error && state.error.startsWith('No practice code')
      ? ' <button class="ghost-btn setup-now-btn">Set up now</button>'
      : '';
  // Decision E: neutral/informational colour, not clinical-red
  return `<div class="act-error">${escHtml(state.error)}${cta}</div>`;
}

function renderData() {
  const api = ApiNs();
  const a = state.aggregated;
  if (!a || a.users.length === 0) {
    // Decision D: designed empty state
    return `
      <div class="act-empty">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="3" y1="9" x2="21" y2="9"></line>
          <line x1="9" y1="21" x2="9" y2="9"></line>
        </svg>
        <span>NO ACTIVITY IN THIS RANGE</span>
      </div>
    `;
  }

  const periodLabel =
    state.startDate === state.endDate
      ? formatDateLabel(state.startDate)
      : `${formatDateLabel(state.startDate)} → ${formatDateLabel(state.endDate)}`;

  // Decision C: legend rendering depends on mode
  let legendHtml = '';
  if (state.showMode === 'stacked') {
    legendHtml = `
      <div class="act-legend">
        ${api.METRICS.map(
          (m) => `
          <div class="act-legend-item">
            <div class="act-legend-swatch" style="background:${m.colour}"></div>
            <div class="act-legend-name">${escHtml(m.short)}</div>
          </div>
        `
        ).join('')}
      </div>
    `;
  } else if (state.showMode !== 'total') {
    // single metric — render only that metric's legend item
    const metricDef = api.METRICS.find((m) => m.key === state.showMode);
    if (metricDef) {
      legendHtml = `
        <div class="act-legend">
          <div class="act-legend-item">
            <div class="act-legend-swatch" style="background:${metricDef.colour}"></div>
            <div class="act-legend-name">${escHtml(metricDef.short)}</div>
          </div>
        </div>
      `;
    }
  }
  // total mode: no legend element at all

  return `
    <div class="act-totals-card">
      <div class="act-totals-head">
        <div class="act-totals-label">Period total</div>
        <div class="act-totals-period">${escHtml(periodLabel)}</div>
      </div>
      <div class="act-totals-number">${a.totals.all.toLocaleString('en-GB')}</div>
      <div class="act-totals-metrics">
        ${api.METRICS.map(
          (m) => `
          <div class="act-metric-tile">
            <div class="act-metric-swatch" style="background:${m.colour}"></div>
            <div class="act-metric-info">
              <div class="act-metric-name">${escHtml(m.short)}</div>
              <div class="act-metric-count">${(a.totals[m.key] || 0).toLocaleString('en-GB')}</div>
            </div>
          </div>
        `
        ).join('')}
      </div>
    </div>

    <div class="act-chart-card">
      <div class="act-chart-head">
        <div class="act-chart-label">By staff member</div>
        <select id="actModeSelect" class="act-mode-select">
          <option value="stacked" ${state.showMode === 'stacked' ? 'selected' : ''}>All metrics (stacked)</option>
          ${api.METRICS.map((m) => `<option value="${m.key}" ${state.showMode === m.key ? 'selected' : ''}>${escHtml(m.short)} only</option>`).join('')}
          <option value="total" ${state.showMode === 'total' ? 'selected' : ''}>Total only</option>
        </select>
      </div>
      ${legendHtml}
      <div class="act-bars" role="list">${renderBars()}</div>
    </div>
  `;
}

function renderBars() {
  const api = ApiNs();
  const a = state.aggregated;
  const mode = state.showMode;

  // Determine the scale denominator for bar widths.
  // - 'stacked' and 'total': scale to maxUserTotal
  // - single metric: scale to the max of that metric across users
  let scaleMax;
  if (mode === 'stacked' || mode === 'total') {
    scaleMax = a.maxUserTotal;
  } else {
    scaleMax = a.users.reduce((m, u) => Math.max(m, u.metrics[mode] || 0), 0);
  }
  if (scaleMax === 0) scaleMax = 1;

  return a.users
    .map((user) => {
      const userTotalOrMetric = mode === 'stacked' || mode === 'total' ? user.total : user.metrics[mode] || 0;
      const barWidthPct = (userTotalOrMetric / scaleMax) * 100;

      let segments;
      // Decision M: build aria-label for each row
      let ariaLabel;

      if (mode === 'stacked') {
        // Each segment width proportional to (metric / user.total) * barWidthPct
        const segParts = [];
        segments = api.METRICS.map((m) => {
          const v = user.metrics[m.key] || 0;
          if (v === 0) return '';
          const segWidthPct = user.total > 0 ? (v / user.total) * barWidthPct : 0;
          segParts.push(`${m.short}: ${v}`);
          return `<div class="act-bar-seg" style="width:${segWidthPct}%; background:${m.colour}" title="${escAttr(m.short)}: ${v}"></div>`;
        }).join('');
        ariaLabel = `${user.name}: ${user.total} total — ${segParts.join(', ')}`;
      } else if (mode === 'total') {
        // Decision A.4: use var(--text-4) instead of raw hex for total mode
        segments = `<div class="act-bar-seg" style="width:${barWidthPct}%; background:var(--text-4)" title="Total: ${user.total}"></div>`;
        ariaLabel = `${user.name}: ${user.total} total`;
      } else {
        const metricDef = api.METRICS.find((m) => m.key === mode);
        // Decision A.4: fallback uses var(--text-4) not a raw hex
        const colour = metricDef ? metricDef.colour : 'var(--text-4)';
        segments = `<div class="act-bar-seg" style="width:${barWidthPct}%; background:${colour}" title="${escAttr(metricDef?.short || mode)}: ${userTotalOrMetric}"></div>`;
        ariaLabel = `${user.name}: ${userTotalOrMetric} ${metricDef ? metricDef.short : mode}`;
      }

      return `
      <div class="act-bar-row" role="listitem" aria-label="${escAttr(ariaLabel)}">
        <div class="act-bar-name" title="${escAttr(user.name)}">${escHtml(user.name)}</div>
        <div class="act-bar-track">${segments}</div>
        <div class="act-bar-total">${userTotalOrMetric.toLocaleString('en-GB')}</div>
      </div>
    `;
    })
    .join('');
}

// ── CSV export ───────────────────────────────────────────────────────────────

function downloadActCsv() {
  const api = ApiNs();
  const a = state.aggregated;
  if (!api || !a || a.users.length === 0) return;
  const metricLabels = api.METRICS.map((m) => m.short);
  const header = ['Staff', ...metricLabels, 'Total'];
  const rows = a.users.map((u) => [u.name, ...api.METRICS.map((m) => u.metrics[m.key] || 0), u.total]);
  const start = state.startDate || '';
  const end = state.endDate || '';
  const datePart = start === end ? start : `${start}-to-${end}`;
  downloadCsv(`activity-${datePart}.csv`, header, rows);
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function wireControls() {
  container.querySelector('.setup-now-btn')?.addEventListener('click', () => {
    if (document.getElementById('setupHost')) {
      document.dispatchEvent(new CustomEvent('suite:open-setup'));
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sect-suite') });
    }
  });

  const startEl = container.querySelector('#actStart');
  const endEl = container.querySelector('#actEnd');
  if (startEl)
    startEl.addEventListener('change', () => {
      state.startDate = startEl.value;
      saveUiState('activity', { startDate: state.startDate, endDate: state.endDate, showMode: state.showMode });
      fetchAndRender();
    });
  if (endEl)
    endEl.addEventListener('change', () => {
      state.endDate = endEl.value;
      saveUiState('activity', { startDate: state.startDate, endDate: state.endDate, showMode: state.showMode });
      fetchAndRender();
    });

  container.querySelectorAll('.act-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const api = ApiNs();
      if (!api) return;
      const range = api.preset(btn.dataset.preset);
      if (range) {
        state.startDate = range[0];
        state.endDate = range[1];
        saveUiState('activity', { startDate: state.startDate, endDate: state.endDate, showMode: state.showMode });
        fetchAndRender();
      }
    });
  });

  const csvBtn = container.querySelector('#actCsvBtn');
  if (csvBtn) csvBtn.addEventListener('click', downloadActCsv);

  const refresh = container.querySelector('#actRefresh');
  if (refresh) refresh.addEventListener('click', fetchAndRender);

  const modeSel = container.querySelector('#actModeSelect');
  if (modeSel)
    modeSel.addEventListener('change', () => {
      state.showMode = modeSel.value;
      saveUiState('activity', { startDate: state.startDate, endDate: state.endDate, showMode: state.showMode });
      render();
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
