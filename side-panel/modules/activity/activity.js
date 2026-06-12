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

let container = null;
let _inFlight = false;
let state = {
  startDate: null,
  endDate: null,
  rawResponse: null,
  aggregated: null,
  loading: false,
  error: null,
  showMode: 'stacked', // 'stacked' or single metric key
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
    const VALID_MODES = ['stacked', 'total', 'medical', 'admin', 'investigation', 'rxRoutine', 'rxNonRoutine'];
    if (typeof saved.showMode === 'string' && VALID_MODES.includes(saved.showMode)) state.showMode = saved.showMode;
  }

  render();
  fetchAndRender();

  // Listen for practice code changes (auto-detection updates) and refetch
  const onChange = (ch) => {
    if (ch['suite.practiceCode']) fetchAndRender();
  };
  chrome.storage.onChanged.addListener(onChange);

  return () => {
    chrome.storage.onChanged.removeListener(onChange);
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
      ${state.loading ? renderSkeleton() : state.error ? renderError() : state.aggregated ? renderData() : ''}
    </div>
  `;

  wireControls();
}

function renderControls() {
  return `
    <div class="act-controls">
      <div class="act-date-row">
        <label class="act-date-label">From</label>
        <input type="date" id="actStart" class="act-date-input" value="${state.startDate || ''}" max="${todayISO()}" />
        <label class="act-date-label">To</label>
        <input type="date" id="actEnd" class="act-date-input" value="${state.endDate || ''}" max="${todayISO()}" />
      </div>
      <div class="act-preset-row">
        <button class="act-preset" data-preset="today">Today</button>
        <button class="act-preset" data-preset="yesterday">Yesterday</button>
        <button class="act-preset" data-preset="last7">Last 7d</button>
        <button class="act-preset" data-preset="last30">Last 30d</button>
        <button class="act-preset" data-preset="thisMonth">This month</button>
        <button class="act-preset" data-preset="lastMonth">Last month</button>
        <span class="act-spacer"></span>
        <button class="act-refresh" id="actRefresh">Refresh</button>
      </div>
      ${state.lastFetched ? `<div class="act-ts">Updated ${state.lastFetched.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>` : ''}
    </div>
  `;
}

function renderSkeleton() {
  return `
    <div class="act-skeleton">
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
  return `<div class="act-error">${escHtml(state.error)}${cta}</div>`;
}

function renderData() {
  const api = ApiNs();
  const a = state.aggregated;
  if (!a || a.users.length === 0) {
    return `<div class="act-empty">No activity in this date range.</div>`;
  }

  const periodLabel =
    state.startDate === state.endDate
      ? formatDateLabel(state.startDate)
      : `${formatDateLabel(state.startDate)} → ${formatDateLabel(state.endDate)}`;

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
      <div class="act-bars">${renderBars()}</div>
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
      if (mode === 'stacked') {
        // Each segment width proportional to (metric / user.total) * barWidthPct
        segments = api.METRICS.map((m) => {
          const v = user.metrics[m.key] || 0;
          if (v === 0) return '';
          const segWidthPct = user.total > 0 ? (v / user.total) * barWidthPct : 0;
          return `<div class="act-bar-seg" style="width:${segWidthPct}%; background:${m.colour}" title="${escAttr(m.short)}: ${v}"></div>`;
        }).join('');
      } else if (mode === 'total') {
        segments = `<div class="act-bar-seg" style="width:${barWidthPct}%; background:#64748b" title="Total: ${user.total}"></div>`;
      } else {
        const metricDef = api.METRICS.find((m) => m.key === mode);
        const colour = metricDef ? metricDef.colour : '#64748b';
        segments = `<div class="act-bar-seg" style="width:${barWidthPct}%; background:${colour}" title="${escAttr(metricDef?.short || mode)}: ${userTotalOrMetric}"></div>`;
      }

      return `
      <div class="act-bar-row">
        <div class="act-bar-name" title="${escAttr(user.name)}">${escHtml(user.name)}</div>
        <div class="act-bar-track">${segments}</div>
        <div class="act-bar-total">${userTotalOrMetric.toLocaleString('en-GB')}</div>
      </div>
    `;
    })
    .join('');
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
