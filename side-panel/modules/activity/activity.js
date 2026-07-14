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
import { fetchManyDates, aggregateSlots, addDays } from '../../../shared/medicus-api.js';

// Ranges longer than this are not eligible for the "Per session" adjustment (FEATURE 2) —
// fetching one scheduling-overview request per day gets expensive/slow past about a month,
// and the toggle is disabled with an honest title rather than silently degrading.
const MAX_SESSION_RANGE_DAYS = 31;

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
  // FEATURE 1b: "vs previous period" comparison toggle.
  compareOn: false,
  compareRange: null, // [prevStart, prevEnd] actually used for the last comparison fetch
  compareAggregated: null,
  compareError: null,
  // FEATURE 2: session-adjusted per-clinician activity.
  perSessionOn: false,
  sessionData: null, // { byName: Map(normalisedName -> {sessions, displayName}), errors, days }
  sessionLoading: false,
  sessionError: null,
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
    if (typeof saved.compareOn === 'boolean') state.compareOn = saved.compareOn;
    if (typeof saved.perSessionOn === 'boolean') state.perSessionOn = saved.perSessionOn;
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

// Persist the fields of `state` that make up the module's view — one call site instead
// of re-listing the same field set at every mutation point (simplification: the original
// four call sites each repeated { startDate, endDate, showMode } verbatim).
function persistUi() {
  saveUiState('activity', {
    startDate: state.startDate,
    endDate: state.endDate,
    showMode: state.showMode,
    compareOn: state.compareOn,
    perSessionOn: state.perSessionOn,
  });
}

// Normalise a clinician name for matching across data sources (Activity Report vs
// scheduling overview) — case and incidental whitespace should not cause a false
// "no session data" (FEATURE 2's manager-trust rule: never guess, but don't miss a
// real match over trivial formatting differences either).
function normaliseName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// The value a user row displays/compares for the active `showMode` — 'stacked'/'total'
// use the row total, a single metric key uses that metric's count. Shared by renderBars,
// the compare inline text, and the CSV export so the three never quietly disagree.
function metricValueFor(user, mode) {
  if (!user) return 0;
  return mode === 'stacked' || mode === 'total' ? user.total : user.metrics[mode] || 0;
}

function rangeDaysInclusive() {
  const api = ApiNs();
  return api ? api.daysBetweenInclusive(state.startDate, state.endDate) : 0;
}

function sessionRangeTooLong() {
  const days = rangeDaysInclusive();
  return days === 0 || days > MAX_SESSION_RANGE_DAYS;
}

// FEATURE 2: sum non-cancelled sessions per clinician across every day in [startISO,endISO],
// using the same fetchManyDates(concurrency:5)/aggregateSlots pattern report-data.js's
// fetchCapacityRange uses for month-scale capacity fetches (see CLAUDE.md). Matching is by
// normalised name — aggregateSlots' byStaff only lists clinicians who had at least one
// non-cancelled session that day, so summing across days gives an accurate range total.
async function fetchSessionCounts(siteId, startISO, endISO) {
  const dates = [];
  for (let cur = startISO; cur <= endISO; cur = addDays(cur, 1)) dates.push(cur);

  const raw = await fetchManyDates(siteId, dates, { concurrency: 5 });
  const byName = new Map();
  const errors = [];
  dates.forEach((date) => {
    const dayRaw = raw[date];
    if (!dayRaw || dayRaw.error) {
      errors.push(`${date}: ${dayRaw?.error || 'no data'}`);
      return;
    }
    const agg = aggregateSlots(dayRaw, { allowedTypes: null, filterPastTimes: false });
    (agg.byStaff || []).forEach((s) => {
      const norm = normaliseName(s.name);
      const entry = byName.get(norm) || { sessions: 0, displayName: s.name };
      entry.sessions += s.sessions || 0;
      byName.set(norm, entry);
    });
  });
  return { byName, errors, days: dates.length };
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
    state.compareError = null;
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

      // FEATURE 1b: comparison fetch is independent of the primary fetch's try/catch so a
      // comparison-only failure (e.g. transient network blip) never blanks out the primary
      // data the manager actually asked for.
      state.compareAggregated = null;
      state.compareRange = null;
      if (state.compareOn) {
        try {
          const [prevStart, prevEnd] = api.previousRange(state.startDate, state.endDate);
          state.compareRange = [prevStart, prevEnd];
          const prevData = await api.fetchActivityReport(code, prevStart, prevEnd, {
            fetch: (url, init) => window.ApiDiag.fetch({ module: 'activity', url, code, codeSource: source, init }),
          });
          state.compareAggregated = api.aggregate(prevData?.rowData || []);
        } catch (e) {
          state.compareError = e.message || String(e);
        }
      }
    } catch (e) {
      state.error = e.message || String(e);
    } finally {
      state.loading = false;
      render();
    }

    // FEATURE 2: per-session fetch runs after the main render so the manager sees primary
    // (and comparison) data immediately — it can be slow (up to ~31 requests) and is purely
    // additive, so there's no reason to gate the rest of the panel behind it.
    if (state.perSessionOn && !sessionRangeTooLong() && !state.error) {
      state.sessionLoading = true;
      state.sessionError = null;
      render();
      try {
        state.sessionData = await fetchSessionCounts(code, state.startDate, state.endDate);
      } catch (e) {
        state.sessionError = e.message || String(e);
        state.sessionData = null;
      } finally {
        state.sessionLoading = false;
        render();
      }
    } else {
      state.sessionData = null;
      state.sessionError = null;
      state.sessionLoading = false;
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

  const sessionDisabled = sessionRangeTooLong();
  const sessionTitle = sessionDisabled
    ? 'Session adjustment available for ranges up to a month'
    : 'Show activity per clinical session';

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
      <div class="act-preset-row act-toggle-row">
        <button class="act-preset act-toggle${state.compareOn ? ' active' : ''}" id="actCompareToggle" type="button" aria-pressed="${state.compareOn}">Compare: vs previous period</button>
        <button class="act-preset act-toggle${state.perSessionOn ? ' active' : ''}" id="actPerSessionToggle" type="button" aria-pressed="${state.perSessionOn}" ${sessionDisabled ? 'disabled' : ''} title="${escAttr(sessionTitle)}">Per session</button>
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
      ${renderTotalDelta()}
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

// FEATURE 1b: period-total delta line under the hero number. Direction is stated in
// plain text/sign, not coloured red/green — a rise or fall in inbound activity isn't
// inherently good or bad, matching the neutral-delta convention used elsewhere in the
// suite (e.g. submissions.js's renderDelta).
function renderTotalDelta() {
  if (!state.compareOn) return '';
  const api = ApiNs();
  if (state.compareError) {
    return `<div class="act-compare-note act-compare-note--error">Comparison unavailable: ${escHtml(state.compareError)}</div>`;
  }
  if (!state.compareAggregated || !state.compareRange) return '';
  const a = state.aggregated;
  const [ps, pe] = state.compareRange;
  const label = ps === pe ? formatDateLabel(ps) : `${formatDateLabel(ps)} → ${formatDateLabel(pe)}`;
  const diff = a.totals.all - state.compareAggregated.totals.all;
  const cmp = api.comparePct(a.totals.all, state.compareAggregated.totals.all);
  const sign = diff > 0 ? '+' : '';
  const pctText = cmp.pct == null ? '' : ` (${cmp.pct > 0 ? '+' : ''}${cmp.pct}%)`;
  return `<div class="act-compare-note act-compare-note--${cmp.direction}">${sign}${diff}${pctText} vs ${escHtml(label)}</div>`;
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
      const userTotalOrMetric = metricValueFor(user, mode);
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

      const metaLine = renderBarMeta(user, mode, userTotalOrMetric);

      return `
      <div class="act-bar-row-wrap">
        <div class="act-bar-row" role="listitem" aria-label="${escAttr(ariaLabel)}">
          <div class="act-bar-name" title="${escAttr(user.name)}">${escHtml(user.name)}</div>
          <div class="act-bar-track">${segments}</div>
          <div class="act-bar-total">${userTotalOrMetric.toLocaleString('en-GB')}</div>
        </div>
        ${metaLine}
      </div>
    `;
    })
    .join('');
}

// Combines the FEATURE 1b comparison delta and the FEATURE 2 per-session figure into one
// meta line under each staff bar row — both are "decomposable" per the manager's-trust rule
// (the raw prior total / session count is always visible alongside the derived number, never
// just the percentage or the ratio on its own).
function renderBarMeta(user, mode, curVal) {
  const parts = [renderCompareInline(user, mode, curVal), renderSessionInline(user, curVal)].filter(Boolean);
  if (!parts.length) return '';
  return `<div class="act-bar-meta">${parts.join('<span class="act-bar-meta-sep">·</span>')}</div>`;
}

function renderCompareInline(user, mode, curVal) {
  if (!state.compareOn) return '';
  const api = ApiNs();
  if (state.compareError) return `<span class="act-bar-delta act-bar-delta--error">comparison unavailable</span>`;
  if (!state.compareAggregated) return '';
  const prevUser = state.compareAggregated.users.find((u) => normaliseName(u.name) === normaliseName(user.name));
  const prevVal = metricValueFor(prevUser, mode);
  const cmp = api.comparePct(curVal, prevVal);
  const diff = curVal - prevVal;
  const sign = diff > 0 ? '+' : '';
  const pctText = cmp.pct == null ? '' : ` (${cmp.pct > 0 ? '+' : ''}${cmp.pct}%)`;
  return `<span class="act-bar-delta act-bar-delta--${cmp.direction}">${sign}${diff}${pctText} vs prior</span>`;
}

function renderSessionInline(user, curVal) {
  if (!state.perSessionOn) return '';
  if (state.sessionLoading) return `<span class="act-bar-session-inline">loading session data…</span>`;
  if (state.sessionError)
    return `<span class="act-bar-session-inline act-bar-session-inline--error">session data unavailable</span>`;
  if (!state.sessionData) return '';
  const entry = state.sessionData.byName.get(normaliseName(user.name));
  if (!entry) return `<span class="act-bar-session-inline act-bar-session-inline--unmatched">no session data</span>`;
  // Manager's trust rule: never divide by an assumed session count and never show
  // Infinity/NaN — a clinician with activity but zero recorded (non-cancelled) sessions
  // gets an explicit prompt to check the rota instead of a bogus ratio.
  if (!entry.sessions) return `<span class="act-bar-session-inline">0 sessions — check rota</span>`;
  const perSession = Math.round((curVal / entry.sessions) * 10) / 10;
  return `<span class="act-bar-session-inline">${perSession} per session (${entry.sessions} session${entry.sessions === 1 ? '' : 's'})</span>`;
}

// ── CSV export ───────────────────────────────────────────────────────────────

function downloadActCsv() {
  const api = ApiNs();
  const a = state.aggregated;
  if (!api || !a || a.users.length === 0) return;
  const metricLabels = api.METRICS.map((m) => m.short);
  // FEATURE 1b: comparison columns are only included when the toggle is on AND the
  // comparison actually succeeded — a failed comparison must not silently leave stale
  // or misleading numbers in the export.
  const compareOn = state.compareOn && state.compareAggregated && !state.compareError;
  const header = ['Staff', ...metricLabels, 'Total'];
  if (compareOn) header.push('Total (prior period)', 'Delta', 'Delta %');
  const rows = a.users.map((u) => {
    const row = [u.name, ...api.METRICS.map((m) => u.metrics[m.key] || 0), u.total];
    if (compareOn) {
      const prevUser = state.compareAggregated.users.find((pu) => normaliseName(pu.name) === normaliseName(u.name));
      const prevTotal = prevUser ? prevUser.total : 0;
      const cmp = api.comparePct(u.total, prevTotal);
      row.push(prevTotal, u.total - prevTotal, cmp.pct == null ? '' : cmp.pct);
    }
    return row;
  });
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
      persistUi();
      fetchAndRender();
    });
  if (endEl)
    endEl.addEventListener('change', () => {
      state.endDate = endEl.value;
      persistUi();
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
        persistUi();
        fetchAndRender();
      }
    });
  });

  const csvBtn = container.querySelector('#actCsvBtn');
  if (csvBtn) csvBtn.addEventListener('click', downloadActCsv);

  const refresh = container.querySelector('#actRefresh');
  if (refresh) refresh.addEventListener('click', fetchAndRender);

  const compareToggle = container.querySelector('#actCompareToggle');
  if (compareToggle)
    compareToggle.addEventListener('click', () => {
      state.compareOn = !state.compareOn;
      persistUi();
      fetchAndRender();
    });

  const perSessionToggle = container.querySelector('#actPerSessionToggle');
  if (perSessionToggle)
    perSessionToggle.addEventListener('click', () => {
      state.perSessionOn = !state.perSessionOn;
      persistUi();
      fetchAndRender();
    });

  const modeSel = container.querySelector('#actModeSelect');
  if (modeSel)
    modeSel.addEventListener('change', () => {
      state.showMode = modeSel.value;
      persistUi();
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
