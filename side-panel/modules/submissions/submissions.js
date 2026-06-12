// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Submissions Tracker module v1.0
// Lifted from standalone extension; MWChart re-implemented for side panel context.

'use strict';

import { loadUiState, saveUiState } from '../shared/ui-state.js';

// ── Task types ────────────────────────────────────────────────────────────────

// F8: Practice code format guard — same 4–8 hex-char pattern as practice-code.js.
// Validated before interpolating into fetch URLs to prevent requests to unexpected
// hosts. Definition mirrors practice-code.js (SITE_CODE_RE / isValidPracticeCode).
const _SITE_CODE_RE = /^[a-f0-9]{4,8}$/i;
function _isValidPracticeCode(code) {
  return typeof code === 'string' && _SITE_CODE_RE.test(code);
}

const TASK_TYPES = [
  { key: 'medical', label: 'Medical', shortLabel: 'Medical', type: 'medical_patient_request_task', color: '#ef4444' },
  { key: 'admin', label: 'Admin', shortLabel: 'Admin', type: 'admin_patient_request_task', color: '#3b82f6' },
  {
    key: 'investigation',
    label: 'Invest.',
    shortLabel: 'Invest.',
    type: 'review_investigation_results_task',
    color: '#14b8a6',
  },
  {
    key: 'rxRoutine',
    label: 'Routine Rx',
    shortLabel: 'Rx rtn',
    type: 'prescription_request_task_routine',
    color: '#10b981',
  },
  {
    key: 'rxNonRoutine',
    label: 'Non-rtn Rx',
    shortLabel: 'Rx non',
    type: 'prescription_request_task_non_routine',
    color: '#a855f7',
  },
];

const DEFAULTS = { practiceCode: '' };

const DEFAULT_THRESHOLDS = {
  medical: { amber: 30, red: 60, enabled: false },
  admin: { amber: 20, red: 40, enabled: false },
};

// ── State ─────────────────────────────────────────────────────────────────────

let state = {
  mode: 'today',
  primaryDate: todayISO(),
  rangeStart: addDays(todayISO(), -6),
  rangeEnd: todayISO(),
  compareDate: addDays(todayISO(), -1),
  data: { primary: null, compare: null },
  loading: false,
  config: { ...DEFAULTS },
  hiddenSeries: new Set(),
  lastFetched: null,
  thresholds: {},
};

let container = null;
let pollInterval = null;
let _lastMetricItems = null;
let _inFlight = false;
let _storageListener = null;

function getRagLevel(key, value, thresholds) {
  const t = thresholds[key];
  if (!t || !t.enabled) return null;
  if (value >= (t.red || Infinity)) return 'red';
  if (value >= (t.amber || Infinity)) return 'amber';
  return null;
}

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;

  const stored = await chrome.storage.local.get(['submissions.config', 'suite.practiceCode', 'submissions.thresholds']);
  const practiceCode = stored['suite.practiceCode'] || stored['submissions.config']?.practiceCode || '';
  state.config = { ...DEFAULTS, ...(stored['submissions.config'] || {}), practiceCode };
  state.thresholds = { ...DEFAULT_THRESHOLDS, ...(stored['submissions.thresholds'] || {}) };

  // Restore persisted view state (active mode, hidden chart series)
  const savedUi = await loadUiState('submissions');
  if (savedUi) {
    const VALID_MODES = ['today', 'range', 'compare'];
    if (typeof savedUi.mode === 'string' && VALID_MODES.includes(savedUi.mode)) state.mode = savedUi.mode;
    if (Array.isArray(savedUi.hiddenSeries))
      state.hiddenSeries = new Set(savedUi.hiddenSeries.filter((k) => typeof k === 'string'));
  }

  renderShell();
  await fetchAndRender();

  pollInterval = setInterval(() => {
    if (state.mode === 'today' && document.visibilityState === 'visible') fetchAndRender(false);
  }, 60000);

  _storageListener = (changes, area) => {
    if (area === 'local' && changes['submissions.thresholds'] && container) {
      state.thresholds = { ...DEFAULT_THRESHOLDS, ...(changes['submissions.thresholds'].newValue || {}) };
      renderAll();
    }
  };
  chrome.storage.onChanged.addListener(_storageListener);

  return () => {
    clearInterval(pollInterval);
    chrome.storage.onChanged.removeListener(_storageListener);
    _storageListener = null;
    container = null;
  };
}

// ── Shell HTML ────────────────────────────────────────────────────────────────

function renderShell() {
  if (!container) return;
  container.innerHTML = `
    <div class="module-wrap sub-module">
      <div class="sub-header">
        <div>
          <div class="mod-eyebrow">Submissions Tracker</div>
          <h1 class="mod-title" id="subTitle">Today</h1>
          <div class="mod-subtitle" id="subSubtitle">Live count of inbound work</div>
        </div>
        <div class="header-right">
          <button id="subRefreshBtn" class="ghost-btn">↻ Refresh</button>
          <button id="subSettingsBtn" class="icon-btn" title="Settings">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9"/></svg>
          </button>
        </div>
      </div>

      <div class="mode-bar">
        <div class="mode-tabs">
          <button class="mode-tab${state.mode === 'today' ? ' mode-active' : ''}" data-mode="today">Today</button>
          <button class="mode-tab${state.mode === 'range' ? ' mode-active' : ''}" data-mode="range">Range</button>
          <button class="mode-tab${state.mode === 'compare' ? ' mode-active' : ''}" data-mode="compare">Compare</button>
        </div>
      </div>

      <div id="modeControls" class="mode-controls-row"></div>
      <div id="subBanner" class="banner hidden"></div>
      <div id="subAlertStrip" class="sub-alert-strip hidden"></div>

      <div id="subMetrics" class="sub-metrics"></div>

      <div class="chart-card">
        <div class="chart-hdr"><span id="chart1Title">Cumulative through the day</span></div>
        <div id="chart1" class="chart-area"></div>
        <div id="legend1" class="legend-row"></div>
      </div>

      <div class="chart-card">
        <div class="chart-hdr"><span id="chart2Title">Total by category</span></div>
        <div id="chart2" class="chart-area chart-small"></div>
      </div>

      <div class="foot" id="subFoot"></div>
    </div>
  `;

  bindShellEvents();
  renderModeControls();
}

function bindShellEvents() {
  container.querySelector('#subRefreshBtn')?.addEventListener('click', () => fetchAndRender(true));
  container.querySelector('#subSettingsBtn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  container.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => setMode(tab.dataset.mode));
  });
}

// ── Mode controls ─────────────────────────────────────────────────────────────

function setMode(mode) {
  state.mode = mode;
  saveUiState('submissions', { mode: state.mode, hiddenSeries: [...state.hiddenSeries] });
  container.querySelectorAll('.mode-tab').forEach((t) => t.classList.toggle('mode-active', t.dataset.mode === mode));
  renderModeControls();
  fetchAndRender();
}

let _dpCallbacks = {};
function renderModeControls() {
  const ctr = container?.querySelector('#modeControls');
  if (!ctr) return;
  _dpCallbacks = {}; // reset per render; datePicker() repopulates synchronously
  if (state.mode === 'today') {
    ctr.innerHTML = datePicker('Date', state.primaryDate, (v) => {
      state.primaryDate = v;
      fetchAndRender();
    });
  } else if (state.mode === 'range') {
    ctr.innerHTML =
      datePicker('From', state.rangeStart, (v) => {
        state.rangeStart = v;
        fetchAndRender();
      }) +
      datePicker('To', state.rangeEnd, (v) => {
        state.rangeEnd = v;
        fetchAndRender();
      }) +
      `<div class="preset-row">
        <button class="ghost-btn" data-days="6">7d</button>
        <button class="ghost-btn" data-days="13">14d</button>
        <button class="ghost-btn" data-days="29">30d</button>
      </div>`;
    ctr.querySelectorAll('[data-days]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.rangeEnd = todayISO();
        state.rangeStart = addDays(todayISO(), -parseInt(btn.dataset.days));
        renderModeControls();
        fetchAndRender();
      });
    });
  } else {
    ctr.innerHTML =
      datePicker('Day A', state.primaryDate, (v) => {
        state.primaryDate = v;
        fetchAndRender();
      }) +
      datePicker('Day B', state.compareDate, (v) => {
        state.compareDate = v;
        fetchAndRender();
      }) +
      `<div class="preset-row">
        <button class="ghost-btn" data-preset="yesterday">vs yesterday</button>
        <button class="ghost-btn" data-preset="lastweek">vs last week</button>
      </div>`;
    ctr.querySelector('[data-preset="yesterday"]')?.addEventListener('click', () => {
      state.primaryDate = todayISO();
      state.compareDate = addDays(todayISO(), -1);
      renderModeControls();
      fetchAndRender();
    });
    ctr.querySelector('[data-preset="lastweek"]')?.addEventListener('click', () => {
      state.primaryDate = todayISO();
      state.compareDate = addDays(todayISO(), -7);
      renderModeControls();
      fetchAndRender();
    });
  }
  // Bind date pickers. Callbacks are looked up synchronously from _dpCallbacks
  // (populated by datePicker during the innerHTML build) — no setTimeout, so a
  // change fired immediately after render can't be dropped.
  ctr.querySelectorAll('input[type=date]').forEach((input) => {
    const cb = _dpCallbacks[input.id];
    if (cb) input.addEventListener('change', () => cb(input.value));
  });
}

function datePicker(label, value, onChange) {
  const id = 'dp_' + Math.random().toString(36).slice(2);
  // innerHTML can't preserve function refs, so register the callback in a map
  // keyed by id; renderModeControls binds it after the DOM is in place.
  _dpCallbacks[id] = onChange;
  return `<div class="dp-wrap"><span class="dp-label">${label}</span><input id="${id}" type="date" value="${value}" max="${todayISO()}" /></div>`;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchAndRender(force = false) {
  if (!container) return;
  if (_inFlight) return;
  _inFlight = true;
  const refreshBtn = container.querySelector('#subRefreshBtn');
  if (refreshBtn) refreshBtn.disabled = true;
  try {
    // Re-resolve practice code (auto-detect from tab, fall back to storage)
    if (window.PracticeCode) {
      const { code } = await window.PracticeCode.resolve();
      if (code) state.config.practiceCode = code;
    }
    if (!state.config.practiceCode) {
      setBanner('No practice code — open a Medicus tab or set it in Options.', 'info');
      showSkeleton();
      return;
    }
    state.loading = true;
    showSkeleton();
    setBanner(null);
    updateTitles();
    try {
      if (state.mode === 'today') {
        state.data = { primary: await fetchDay(state.primaryDate), compare: null };
      } else if (state.mode === 'compare') {
        const [p, c] = await Promise.all([fetchDay(state.primaryDate), fetchDay(state.compareDate)]);
        state.data = { primary: p, compare: c };
      } else {
        state.data = { primary: await fetchRange(state.rangeStart, state.rangeEnd), compare: null };
      }
      state.lastFetched = new Date();
      state.loading = false;
      renderAll();
    } catch (err) {
      state.loading = false;
      setBanner(`Failed to load: ${err.message}. Check you're signed into Medicus.`);
    }
  } finally {
    _inFlight = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

async function fetchDay(dateISO) {
  // F8: Validate practice code before interpolating into the fetch URL.
  if (!_isValidPracticeCode(state.config.practiceCode)) {
    throw new Error('Invalid practice code format — cannot fetch');
  }
  const result = {};
  await Promise.all(
    TASK_TYPES.map(async (tt) => {
      const url = `https://${state.config.practiceCode}.api.england.medicus.health/tasks/data/${tt.type}/task-list?createdAt_startDate=${dateISO}&createdAt_endDate=${dateISO}`;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) throw new Error(`${tt.label} HTTP ${r.status}`);
      const d = await r.json();
      result[tt.key] = d.tasks || [];
    })
  );
  return result;
}

async function fetchRange(startISO, endISO) {
  // F8: Validate practice code before interpolating into the fetch URL.
  if (!_isValidPracticeCode(state.config.practiceCode)) {
    throw new Error('Invalid practice code format — cannot fetch');
  }
  const result = {};
  await Promise.all(
    TASK_TYPES.map(async (tt) => {
      const url = `https://${state.config.practiceCode}.api.england.medicus.health/tasks/data/${tt.type}/task-list?createdAt_startDate=${startISO}&createdAt_endDate=${endISO}`;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) throw new Error(`${tt.label} HTTP ${r.status}`);
      const d = await r.json();
      result[tt.key] = d.tasks || [];
    })
  );
  return result;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function buildHourlyCumulative(dayData) {
  const series = {};
  for (const tt of TASK_TYPES) {
    const hourly = new Array(24).fill(0);
    (dayData[tt.key] || []).forEach((task) => {
      const t = parseTime(task.createdAt);
      if (t !== null) hourly[t]++;
    });
    let acc = 0;
    const cum = hourly.map((n) => (acc += n));
    series[tt.key] = { total: acc, hourly, cumulative: cum };
  }
  return series;
}

function buildDailyTotals(rangeData, startISO, endISO) {
  const days = [];
  let cur = startISO;
  while (cur <= endISO) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  const byDay = {};
  for (const day of days) {
    byDay[day] = {};
    for (const tt of TASK_TYPES) byDay[day][tt.key] = 0;
  }
  for (const tt of TASK_TYPES) {
    (rangeData[tt.key] || []).forEach((task) => {
      const day = parseDate(task.createdAt);
      if (day && byDay[day]) byDay[day][tt.key]++;
    });
  }
  return { days, byDay };
}

// ── Render all ────────────────────────────────────────────────────────────────

function renderAll() {
  if (!container) return;
  updateTitles();
  if (state.mode === 'today') renderToday();
  else if (state.mode === 'compare') renderCompare();
  else renderRange();
  const foot = container.querySelector('#subFoot');
  if (foot)
    foot.textContent = state.lastFetched
      ? `Updated ${state.lastFetched.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : '';
}

function updateTitles() {
  const t = container?.querySelector('#subTitle');
  const s = container?.querySelector('#subSubtitle');
  if (!t || !s) return;
  if (state.mode === 'today') {
    t.textContent = state.primaryDate === todayISO() ? 'Today' : formatDate(state.primaryDate);
    s.textContent = state.primaryDate === todayISO() ? 'Live count of inbound work' : 'Submissions through that day';
  } else if (state.mode === 'compare') {
    t.textContent = 'Day vs day';
    s.textContent = `${formatDateShort(state.primaryDate)} vs ${formatDateShort(state.compareDate)}`;
  } else {
    t.textContent = 'Range';
    const days = daysBetween(state.rangeStart, state.rangeEnd) + 1;
    s.textContent = `${formatDateShort(state.rangeStart)} → ${formatDateShort(state.rangeEnd)} · ${days}d`;
  }
}

function renderToday() {
  const day = state.data.primary;
  if (!day) return;
  const series = buildHourlyCumulative(day);
  renderMetrics(
    TASK_TYPES.map((tt) => ({ key: tt.key, label: tt.shortLabel, value: series[tt.key].total, color: tt.color }))
  );
  const t = container.querySelector('#chart1Title');
  if (t) t.textContent = 'Cumulative through the day';
  MWChart.line({
    container: container.querySelector('#chart1'),
    xLabels: hourLabels(),
    series: TASK_TYPES.filter((tt) => !state.hiddenSeries.has(tt.key)).map((tt) => ({
      key: tt.key,
      color: tt.color,
      label: tt.shortLabel,
      values: series[tt.key].cumulative,
    })),
  });
  renderLegend(
    'legend1',
    TASK_TYPES.map((tt) => ({ key: tt.key, label: tt.shortLabel, color: tt.color })),
    { toggleable: true }
  );
  const t2 = container.querySelector('#chart2Title');
  if (t2) t2.textContent = 'Total by category';
  MWChart.bar({
    container: container.querySelector('#chart2'),
    bars: TASK_TYPES.map((tt) => ({ key: tt.key, label: tt.label, value: series[tt.key].total, color: tt.color })),
  });
  renderAlertStrip();
}

function renderCompare() {
  const dayA = state.data.primary;
  const dayB = state.data.compare;
  if (!dayA || !dayB) return;
  const sA = buildHourlyCumulative(dayA);
  const sB = buildHourlyCumulative(dayB);
  renderMetrics(
    TASK_TYPES.map((tt) => ({
      key: tt.key,
      label: tt.shortLabel,
      value: sA[tt.key].total,
      compareValue: sB[tt.key].total,
      color: tt.color,
    }))
  );
  const t = container.querySelector('#chart1Title');
  if (t) t.textContent = 'Cumulative · day vs day';
  const lineSeries = [];
  TASK_TYPES.forEach((tt) => {
    if (state.hiddenSeries.has(tt.key)) return;
    lineSeries.push({
      key: tt.key + '_a',
      color: tt.color,
      label: tt.shortLabel + ' A',
      values: sA[tt.key].cumulative,
    });
    lineSeries.push({
      key: tt.key + '_b',
      color: tt.color,
      label: tt.shortLabel + ' B',
      values: sB[tt.key].cumulative,
      dashed: true,
    });
  });
  MWChart.line({ container: container.querySelector('#chart1'), xLabels: hourLabels(), series: lineSeries });
  renderLegend(
    'legend1',
    TASK_TYPES.map((tt) => ({ key: tt.key, label: tt.shortLabel, color: tt.color })),
    { toggleable: true, extraNote: 'Solid = A · Dashed = B' }
  );
  const t2 = container.querySelector('#chart2Title');
  if (t2) t2.textContent = `Totals · ${formatDateShort(state.primaryDate)} vs ${formatDateShort(state.compareDate)}`;
  MWChart.bar({
    container: container.querySelector('#chart2'),
    bars: TASK_TYPES.map((tt) => ({
      key: tt.key,
      label: tt.label,
      value: sA[tt.key].total,
      compareValue: sB[tt.key].total,
      color: tt.color,
    })),
  });
  renderAlertStrip();
}

function renderRange() {
  const data = state.data.primary;
  if (!data) return;
  const { days, byDay } = buildDailyTotals(data, state.rangeStart, state.rangeEnd);
  const totals = {};
  for (const tt of TASK_TYPES) totals[tt.key] = days.reduce((a, d) => a + (byDay[d][tt.key] || 0), 0);
  renderMetrics(
    TASK_TYPES.map((tt) => ({ key: tt.key, label: tt.shortLabel, value: totals[tt.key], color: tt.color }))
  );
  const t = container.querySelector('#chart1Title');
  if (t) t.textContent = 'Daily submissions';
  const stacks = days.map((day) => ({
    day,
    segments: TASK_TYPES.filter((tt) => !state.hiddenSeries.has(tt.key)).map((tt) => ({
      key: tt.key,
      value: byDay[day][tt.key] || 0,
      color: tt.color,
      label: tt.shortLabel,
    })),
  }));
  MWChart.stacked({ container: container.querySelector('#chart1'), xLabels: days.map(formatDateShort), stacks });
  renderLegend(
    'legend1',
    TASK_TYPES.map((tt) => ({ key: tt.key, label: tt.shortLabel, color: tt.color })),
    { toggleable: true }
  );
  const t2 = container.querySelector('#chart2Title');
  if (t2) t2.textContent = `Totals over ${days.length} days`;
  MWChart.bar({
    container: container.querySelector('#chart2'),
    bars: TASK_TYPES.map((tt) => ({ key: tt.key, label: tt.label, value: totals[tt.key], color: tt.color })),
  });
  renderAlertStrip();
}

// ── Metric tiles ──────────────────────────────────────────────────────────────

function renderMetrics(items) {
  _lastMetricItems = items;
  const ctr = container?.querySelector('#subMetrics');
  if (!ctr) return;
  ctr.innerHTML = items
    .map((m) => {
      const rag = getRagLevel(m.key, m.value, state.thresholds);
      const borderColor = rag === 'red' ? '#ef4444' : rag === 'amber' ? '#f59e0b' : m.color;
      return `
    <div class="sub-metric${rag ? ' sub-metric--alerted' : ''}" style="border-top: 2px solid ${borderColor}"${rag ? ` data-rag="${rag}"` : ''}>
      ${rag ? `<div class="sub-metric-rag-dot sub-metric-rag-dot--${rag}"></div>` : ''}
      <div class="metric-label">${m.label}</div>
      <div class="metric-num${m.value === 0 ? ' zero' : ''}">${m.value}</div>
      ${m.compareValue != null ? renderDelta(m.value, m.compareValue) : ''}
    </div>`;
    })
    .join('');
}

function renderAlertStrip() {
  const strip = container?.querySelector('#subAlertStrip');
  if (!strip) return;
  const redItems = [];
  for (const tt of TASK_TYPES) {
    const total = _lastMetricItems?.find((m) => m.key === tt.key)?.value ?? 0;
    if (getRagLevel(tt.key, total, state.thresholds) === 'red') {
      const t = state.thresholds[tt.key];
      redItems.push(`${tt.label}: ${total} (red ≥ ${t.red})`);
    }
  }
  if (redItems.length === 0) {
    strip.className = 'sub-alert-strip hidden';
    strip.textContent = '';
    return;
  }
  strip.className = 'sub-alert-strip sub-alert-strip--red';
  strip.textContent = `⚠ ${redItems.join(' · ')}`;
}

function renderDelta(a, b) {
  const diff = a - b;
  const pct = b === 0 ? null : Math.round((diff / b) * 100);
  let cls = 'flat',
    arrow = '→';
  if (diff > 0) {
    cls = 'up';
    arrow = '↑';
  } else if (diff < 0) {
    cls = 'dn';
    arrow = '↓';
  }
  const text =
    b === 0
      ? `${arrow} ${a > 0 ? `+${a} vs 0` : 'no change'}`
      : `${arrow} ${diff > 0 ? '+' : ''}${diff} (${pct > 0 ? '+' : ''}${pct}%)`;
  return `<div class="metric-delta ${cls}">${text}</div>`;
}

function renderLegend(elId, items, { toggleable = false, extraNote = null } = {}) {
  const el = container?.querySelector(`#${elId}`);
  if (!el) return;
  el.innerHTML =
    items
      .map(
        (it) => `
    <div class="legend-item${state.hiddenSeries.has(it.key) ? ' muted' : ''}" data-key="${it.key}" style="cursor:${toggleable ? 'pointer' : 'default'}">
      <span class="legend-swatch" style="background:${it.color}"></span>
      <span>${it.label}</span>
    </div>`
      )
      .join('') + (extraNote ? `<span class="legend-note">${extraNote}</span>` : '');
  if (toggleable) {
    el.querySelectorAll('.legend-item').forEach((li) => {
      li.addEventListener('click', () => {
        const k = li.dataset.key;
        if (state.hiddenSeries.has(k)) state.hiddenSeries.delete(k);
        else state.hiddenSeries.add(k);
        saveUiState('submissions', { mode: state.mode, hiddenSeries: [...state.hiddenSeries] });
        renderAll();
      });
    });
  }
}

function showSkeleton() {
  const m = container?.querySelector('#subMetrics');
  if (m)
    m.innerHTML = TASK_TYPES.map(
      (tt) =>
        `<div class="sub-metric loading-skel"><div class="metric-label">${tt.shortLabel}</div><div class="metric-num zero">—</div></div>`
    ).join('');
  const c1 = container?.querySelector('#chart1');
  if (c1) MWChart.showLoading(c1, 'Fetching submissions…');
  const c2 = container?.querySelector('#chart2');
  if (c2) MWChart.showLoading(c2, '');
  const l1 = container?.querySelector('#legend1');
  if (l1) l1.innerHTML = '';
}

function setBanner(msg, kind = 'error') {
  const b = container?.querySelector('#subBanner');
  if (!b) return;
  if (!msg) {
    b.classList.add('hidden');
    return;
  }
  b.textContent = msg;
  b.className = 'banner' + (kind === 'info' ? ' info' : '');
}

// ── MWChart — SVG chart renderer ──────────────────────────────────────────────

const MWChart = {
  showLoading(el, msg) {
    if (!el) return;
    el.innerHTML = `<div class="chart-loading">${msg || 'Loading…'}</div>`;
  },

  line({ container: el, xLabels, series }) {
    if (!el || !series.length) {
      MWChart.showLoading(el, 'No data');
      return;
    }
    const W = el.clientWidth || 300,
      H = 120;
    const pad = { t: 8, r: 8, b: 24, l: 28 };
    const cW = W - pad.l - pad.r,
      cH = H - pad.t - pad.b;
    const allVals = series.flatMap((s) => s.values);
    const maxVal = Math.max(1, ...allVals);
    const N = xLabels.length;
    const xStep = cW / Math.max(1, N - 1);
    const labelStep = Math.ceil(N / 6);

    const toX = (i) => pad.l + i * xStep;
    const toY = (v) => pad.t + cH - (v / maxVal) * cH;

    let paths = '';
    series.forEach((s) => {
      const pts = s.values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
      paths += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="${s.dashed ? 1.5 : 2}" stroke-dasharray="${s.dashed ? '4,3' : ''}" opacity="0.85"/>`;
    });

    let xTicks = '';
    for (let i = 0; i < N; i += labelStep) {
      xTicks += `<text x="${toX(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="#5d7a9d">${xLabels[i]}</text>`;
    }

    let yTicks = '';
    const steps = 3;
    for (let i = 0; i <= steps; i++) {
      const v = Math.round((maxVal / steps) * i);
      const y = toY(v).toFixed(1);
      yTicks += `<line x1="${pad.l}" y1="${y}" x2="${pad.l + cW}" y2="${y}" stroke="#142340" stroke-width="1"/>`;
      yTicks += `<text x="${pad.l - 3}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="8" fill="#5d7a9d">${v}</text>`;
    }

    el.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${yTicks}${paths}${xTicks}</svg>`;
  },

  bar({ container: el, bars }) {
    if (!el || !bars.length) {
      MWChart.showLoading(el, 'No data');
      return;
    }
    const W = el.clientWidth || 300,
      H = 80;
    const pad = { t: 4, r: 8, b: 20, l: 8 };
    const cW = W - pad.l - pad.r;
    const hasCompare = bars.some((b) => b.compareValue != null);
    const maxVal = Math.max(1, ...bars.map((b) => Math.max(b.value, b.compareValue ?? 0)));
    const groupW = cW / bars.length;
    const barW = hasCompare ? groupW * 0.35 : groupW * 0.6;
    const gap = hasCompare ? 2 : 0;
    const cH = H - pad.t - pad.b;

    let rects = '';
    bars.forEach((b, i) => {
      const gx = pad.l + i * groupW + (groupW - (hasCompare ? barW * 2 + gap : barW)) / 2;
      const h1 = (b.value / maxVal) * cH;
      rects += `<rect x="${gx.toFixed(1)}" y="${(pad.t + cH - h1).toFixed(1)}" width="${barW.toFixed(1)}" height="${h1.toFixed(1)}" fill="${b.color}" opacity="0.85" rx="2"/>`;
      if (hasCompare && b.compareValue != null) {
        const h2 = (b.compareValue / maxVal) * cH;
        rects += `<rect x="${(gx + barW + gap).toFixed(1)}" y="${(pad.t + cH - h2).toFixed(1)}" width="${barW.toFixed(1)}" height="${h2.toFixed(1)}" fill="${b.color}" opacity="0.35" rx="2"/>`;
      }
      rects += `<text x="${(gx + (hasCompare ? barW + gap / 2 : barW / 2)).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="#5d7a9d">${b.label}</text>`;
    });

    el.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  },

  stacked({ container: el, xLabels, stacks }) {
    if (!el || !stacks.length) {
      MWChart.showLoading(el, 'No data');
      return;
    }
    const W = el.clientWidth || 300,
      H = 110;
    const pad = { t: 4, r: 8, b: 20, l: 28 };
    const cW = W - pad.l - pad.r,
      cH = H - pad.t - pad.b;
    const totals = stacks.map((s) => s.segments.reduce((a, seg) => a + seg.value, 0));
    const maxVal = Math.max(1, ...totals);
    const barW = Math.max(4, (cW / stacks.length) * 0.7);
    const labelStep = Math.ceil(stacks.length / 6);

    let rects = '';
    stacks.forEach((stack, i) => {
      const x = pad.l + (i / stacks.length) * cW + (cW / stacks.length - barW) / 2;
      let yBase = pad.t + cH;
      stack.segments.forEach((seg) => {
        const h = (seg.value / maxVal) * cH;
        yBase -= h;
        if (h > 0)
          rects += `<rect x="${x.toFixed(1)}" y="${yBase.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${seg.color}" opacity="0.85"/>`;
      });
      if (i % labelStep === 0) {
        rects += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" fill="#5d7a9d">${xLabels[i]}</text>`;
      }
    });

    let yTicks = '';
    const steps = 3;
    for (let i = 0; i <= steps; i++) {
      const v = Math.round((maxVal / steps) * i);
      const y = (pad.t + cH - (v / maxVal) * cH).toFixed(1);
      yTicks += `<line x1="${pad.l}" y1="${y}" x2="${pad.l + cW}" y2="${y}" stroke="#142340" stroke-width="1"/>`;
      yTicks += `<text x="${pad.l - 3}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="8" fill="#5d7a9d">${v}</text>`;
    }

    el.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${yTicks}${rects}</svg>`;
  },
};

// ── Date utilities ────────────────────────────────────────────────────────────

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n) {
  return String(n).padStart(2, '0');
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function daysBetween(a, b) {
  if (!a || !b) return 0;
  const d = Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
  return Number.isFinite(d) ? d : 0;
}
function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function formatDateShort(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}
function hourLabels() {
  return Array.from({ length: 24 }, (_, h) => `${pad(h)}`);
}
function parseTime(str) {
  if (!str) return null;
  // ISO 8601: "2024-01-15T09:30:00Z" or "...+00:00" — pull hour after T
  const iso = str.match(/T(\d{2}):\d{2}/);
  if (iso) return parseInt(iso[1], 10);
  // Legacy "DD Mon YYYY HH:MM"
  const m = str.match(/(\d{2}):(\d{2})(?!.*\d)/);
  return m ? parseInt(m[1], 10) : null;
}
function parseDate(str) {
  if (!str) return null;
  // ISO 8601: "2024-01-15..." — first 10 chars are YYYY-MM-DD
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  // Legacy "DD Mon YYYY"
  const months = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };
  const m = str.match(/^(\d{2})\s(\w{3})\s(\d{4})/);
  return m ? `${m[3]}-${months[m[2]]}-${m[1]}` : null;
}
