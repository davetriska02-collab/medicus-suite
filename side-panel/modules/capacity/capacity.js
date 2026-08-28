// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Capacity Forecast module
// Calendar view of available appointment capacity vs user-defined daily minimums.

'use strict';

import { loadUiState, saveUiState } from '../shared/ui-state.js';
import { downloadCsv } from '../shared/export-util.js';
import {
  WEEKDAYS,
  defaultMinimumByDay,
  presetSummary,
  validatePreset,
  normaliseLookahead,
  validateLookahead,
  effectiveMinimumForDate,
  evaluateDay,
  scanHorizon,
  scanTone,
  lookAheadSentence,
  horizonDateList,
  STATUS_TEXT,
} from './capacity-core.js';

import {
  fetchManyDates,
  fetchAppointmentTypes,
  aggregateSlots,
  computeStatus,
  invalidateCache,
  todayISO,
  nextWorkingDayISO,
  addDays,
  startOfWeek,
  startOfMonth,
  daysInMonth,
  formatDateShort,
  formatDateLong,
  isWeekend,
  pad,
} from '../../../shared/medicus-api.js';

let container = null;
// Practice code resolved from chrome.storage.local['suite.practiceCode'].
// No hardcoded default — null means user has not configured one yet.
let SITE_ID = null;
// Set to true while savePreset/deletePreset is writing to storage, so that
// onStorageChange does not trigger a redundant loadVisibleDates() call.
let selfWriteInProgress = false;
let availableTypes = []; // cached from API
let state = {
  presets: [],
  activePresetId: null,
  viewMode: 'week',
  showWeekends: false,
  focusDate: todayISO(),
  monthAnchor: todayISO(),
  data: {},
  loading: new Set(),
  error: null,
  lookahead: normaliseLookahead(null),
  scan: null,
  uiMode: 'view', // 'view' | 'edit' | 'new' | 'lookahead'
  editingPresetId: null,
};

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;

  const stored = await chrome.storage.local.get([
    'suite.practiceCode',
    'capacity.presets',
    'capacity.activePresetId',
    'capacity.viewMode',
    'capacity.showWeekends',
    'capacity.lookahead',
  ]);
  if (stored['suite.practiceCode']) SITE_ID = stored['suite.practiceCode'];
  state.presets = stored['capacity.presets'] || [];
  state.activePresetId = stored['capacity.activePresetId'] || state.presets[0]?.id || null;
  state.viewMode = stored['capacity.viewMode'] || 'week';
  state.showWeekends = !!stored['capacity.showWeekends'];
  state.lookahead = normaliseLookahead(stored['capacity.lookahead']);

  // Restore persisted focusDate / monthAnchor (per-machine view position)
  const savedUi = await loadUiState('capacity');
  if (savedUi) {
    const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (typeof savedUi.focusDate === 'string' && ISO_RE.test(savedUi.focusDate)) state.focusDate = savedUi.focusDate;
    if (typeof savedUi.monthAnchor === 'string' && ISO_RE.test(savedUi.monthAnchor))
      state.monthAnchor = savedUi.monthAnchor;
  }

  // First-load: if no presets, prompt onboarding
  render();

  // Listen for Pusher refresh
  document.addEventListener('suite:slots:refresh', onSlotsRefresh);
  chrome.storage.onChanged.addListener(onStorageChange);

  // Fetch initial data
  await loadVisibleDates();

  return () => {
    document.removeEventListener('suite:slots:refresh', onSlotsRefresh);
    chrome.storage.onChanged.removeListener(onStorageChange);
    container = null;
  };
}

function onSlotsRefresh() {
  // Invalidate today and re-fetch
  invalidateCache(todayISO());
  delete state.data[todayISO()];
  if (visibleDates().includes(todayISO())) loadVisibleDates();
}

function onStorageChange(changes) {
  if (selfWriteInProgress) return;
  let changed = false;
  if (changes['capacity.presets']) {
    state.presets = changes['capacity.presets'].newValue || [];
    changed = true;
  }
  if (changes['capacity.activePresetId']) {
    state.activePresetId = changes['capacity.activePresetId'].newValue;
    changed = true;
  }
  if (changes['capacity.lookahead']) {
    state.lookahead = normaliseLookahead(changes['capacity.lookahead'].newValue);
    changed = true;
  }
  if (changes['suite.practiceCode']) {
    SITE_ID = changes['suite.practiceCode'].newValue || null;
    // Force refresh of cached data when practice changes
    Object.keys(state.data).forEach((d) => delete state.data[d]);
    // Also invalidate the cached appointment-type list so the preset editor
    // re-fetches fresh types for the new practice instead of reusing the
    // previous practice's types (see openNewPreset/openEditPreset guards).
    availableTypes = [];
    changed = true;
  }
  if (changed) {
    render();
    loadVisibleDates();
  }
}

// ── Data loading ──────────────────────────────────────────────────────────────

function visibleDates() {
  if (state.viewMode === 'day') return [state.focusDate];
  if (state.viewMode === 'week') {
    const start = startOfWeek(state.focusDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }
  // month
  const start = startOfMonth(state.monthAnchor);
  const n = daysInMonth(state.monthAnchor);
  return Array.from({ length: n }, (_, i) => addDays(start, i));
}

/** Visible calendar range plus look-ahead horizon (deduped). */
function datesToFetch() {
  const visible = visibleDates();
  if (!activePreset() || state.presets.length === 0) return visible;
  const horizon = horizonDateList(todayISO(), state.lookahead.horizonDays);
  return [...new Set([...visible, ...horizon])];
}

function computeScan() {
  const preset = activePreset();
  if (!preset || state.presets.length === 0) {
    state.scan = null;
    return;
  }
  try {
    state.scan = scanHorizon({
      preset,
      dataByDate: state.data,
      loadingDates: state.loading,
      fromISO: todayISO(),
      lookahead: state.lookahead,
      computeStatus,
    });
  } catch (err) {
    console.error('[Capacity] scan failed', err);
    state.scan = { summary: null, atRisk: [], error: true };
  }
}

async function loadVisibleDates() {
  // Re-resolve practice code (auto-detect from tab if available)
  if (window.PracticeCode) {
    const { code } = await window.PracticeCode.resolve();
    if (code) SITE_ID = code;
  }
  if (!SITE_ID) {
    state.error = 'No practice code — open a Medicus tab or set it in Options.';
    render();
    return;
  }
  const dates = datesToFetch();
  const toFetch = dates.filter((d) => !state.data[d] && !state.loading.has(d));
  if (toFetch.length === 0) {
    computeScan();
    render();
    return;
  }

  toFetch.forEach((d) => state.loading.add(d));
  computeScan();
  render();

  await fetchManyDates(SITE_ID, toFetch, {
    concurrency: 5,
    onProgress: (done, total, date, raw) => {
      state.loading.delete(date);
      if (raw && !raw.error) {
        state.error = null;
        const preset = activePreset();
        state.data[date] = aggregateSlots(raw, {
          allowedTypes: preset?.slotTypes || null,
          filterPastTimes: date === todayISO(),
        });
      } else {
        state.error = raw?.error || null;
      }
      computeScan();
      render();
    },
  });
}

function activePreset() {
  return state.presets.find((p) => p.id === state.activePresetId) || null;
}

function dayEval(date) {
  const preset = activePreset();
  if (!preset) {
    const status = state.loading.has(date) ? 'loading' : 'empty';
    return {
      dateISO: date,
      status,
      total: state.data[date]?.total ?? null,
      minInfo: { effective: 0, base: 0, uplift: 1, upliftApplied: false, isBankHoliday: false },
      reason: '',
      weekday: '',
    };
  }
  return evaluateDay({
    preset,
    dateISO: date,
    agg: state.data[date],
    lookahead: state.lookahead,
    loading: state.loading.has(date),
    computeStatus,
  });
}

function minimumVsLabel(ev) {
  const minInfo = ev.minInfo || {};
  if (!minInfo.effective) return 'No minimum set';
  let label = `vs ${minInfo.effective} min`;
  if (minInfo.upliftApplied) label += ` · ×${minInfo.uplift.toFixed(2)} post-BH`;
  return label;
}

function bhBadgesHtml(minInfo) {
  if (!minInfo) return '';
  const parts = [];
  if (minInfo.isBankHoliday) {
    parts.push(
      '<span class="cap-bh-badge" aria-label="Bank holiday" title="Bank holiday">BH</span>'
    );
  }
  if (minInfo.upliftApplied) {
    parts.push(
      '<span class="cap-postbh-badge" aria-label="Day after a bank holiday" title="Day after a bank holiday">post-BH</span>'
    );
  }
  return parts.join('');
}

/** Compact month-cell marker (dot + tooltip) — avoids stacking tiny badges. */
function bhMonthMarkerHtml(minInfo) {
  if (!minInfo) return '';
  const labels = [];
  if (minInfo.isBankHoliday) labels.push('Bank holiday');
  if (minInfo.upliftApplied) labels.push('Day after a bank holiday');
  if (labels.length === 0) return '';
  const title = labels.join(' · ');
  const kind = minInfo.isBankHoliday ? 'bh' : 'postbh';
  return `<span class="cap-month-marker cap-month-marker-${kind}" aria-label="${escAttr(title)}" title="${escAttr(title)}"></span>`;
}

// minimumForDate / defaultMinimumByDay / presetSummary / WEEKDAYS live in capacity-core.js

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (!container) return;
  const preset = activePreset();

  // Editor / look-ahead settings take over the whole view when active
  if (state.uiMode === 'edit' || state.uiMode === 'new') {
    container.innerHTML = renderEditor();
    bindEditor();
    return;
  }
  if (state.uiMode === 'lookahead') {
    container.innerHTML = renderLookaheadSettings();
    bindLookaheadSettings();
    return;
  }

  if (state.presets.length === 0) {
    container.innerHTML = onboardingHtml();
    bindOnboarding();
    return;
  }

  container.innerHTML = `
    <div class="module-wrap cap-module">
      ${renderControls(preset)}
      ${renderLookaheadBanner(preset)}
      ${renderView(preset)}
    </div>
  `;
  bindControls();
  bindLookaheadBanner();
  if (state.viewMode === 'day') bindDayView();
  if (state.viewMode === 'week') bindWeekView();
  if (state.viewMode === 'month') bindMonthView();
}

function onboardingHtml() {
  return `
    <div class="module-wrap cap-module">
      <div class="mod-header">
        <div>
          <div class="mod-eyebrow">Capacity Forecast</div>
          <div class="mod-title">Welcome</div>
        </div>
      </div>
      <div class="cap-setup-note">
        Presets are a one-time practice setup (a permanent staff member configures these once). As a locum there's nothing you need to do.
      </div>
      <div class="cap-onboard">
        <p>Capacity Forecast tells you which days have enough free appointment capacity for the services you care about.</p>
        <p>To get started, define a preset. A preset is a set of slot types and a daily minimum — for example, "GP Routine" might include GP morning slots, GP afternoon slots, and follow-up slots, with a minimum of 25 per day.</p>
        <button class="primary-btn" id="capOpenSettings">Create your first preset</button>
      </div>
    </div>
  `;
}

function bindOnboarding() {
  container.querySelector('#capOpenSettings')?.addEventListener('click', () => openNewPreset());
}

function renderControls(preset) {
  return `
    <div class="cap-controls">
      <div class="cap-preset-row">
        <label class="cap-preset-label">Preset</label>
        <select class="cap-preset-select" id="capPresetSelect">
          ${state.presets.map((p) => `<option value="${escAttr(p.id)}" ${p.id === state.activePresetId ? 'selected' : ''}>${escHtml(p.name)} · ${presetSummary(p)}</option>`).join('')}
        </select>
        <button class="ghost-btn" id="capEditPreset" title="Edit this preset">✎</button>
        <button class="ghost-btn" id="capNewPreset" title="New preset">+</button>
        <button class="ghost-btn" id="capExportPresets" title="Export presets">⬆</button>
        <button class="ghost-btn" id="capImportPresets" title="Import presets">⬇</button>
        <input type="file" id="capImportFile" accept=".json" style="display:none" />
      </div>

      <div class="cap-mode-bar">
        <button class="cap-mode-btn${state.viewMode === 'day' ? ' active' : ''}"   data-mode="day">Day</button>
        <button class="cap-mode-btn${state.viewMode === 'week' ? ' active' : ''}"  data-mode="week">Week</button>
        <button class="cap-mode-btn${state.viewMode === 'month' ? ' active' : ''}" data-mode="month">Month</button>
        <button class="icon-btn" id="capRefresh" title="Refresh" style="margin-left:auto">↻</button>
      </div>
    </div>
  `;
}

function renderView(preset) {
  if (state.error && state.error.startsWith('No practice code')) {
    return `<div class="cap-empty">${escHtml(state.error)} <button class="ghost-btn setup-now-btn">Set up now</button></div>`;
  }
  if (!preset) {
    return `<div class="cap-empty">No preset selected. Open settings to create one.</div>`;
  }
  if (state.viewMode === 'day') return renderDayView(preset);
  if (state.viewMode === 'week') return renderWeekView(preset);
  return renderMonthView(preset);
}

// ── Day view ──────────────────────────────────────────────────────────────────

function renderDayView(preset) {
  const date = state.focusDate;
  const agg = state.data[date];
  const ev = dayEval(date);
  const status = ev.status;
  const isToday = date === todayISO();
  const minInfo = ev.minInfo || effectiveMinimumForDate(preset, date, state.lookahead);

  let hero = '';
  if (state.loading.has(date)) {
    hero = `<div class="cap-day-hero loading"><div class="cap-day-skel"></div></div>`;
  } else if (!agg) {
    hero = `<div class="cap-day-hero"><div class="cap-day-count">—</div></div>`;
  } else {
    const remaining = isToday ? 'remaining today' : 'available';
    const vsLabel = minimumVsLabel(ev);
    hero = `
      <div class="cap-day-hero">
        <div class="cap-day-count cap-status-${status}">${agg.total}</div>
        <div class="cap-day-meta">
          <span class="cap-day-vs">${escHtml(vsLabel)}</span>
          ${bhBadgesHtml(minInfo)}
          <span class="cap-status-pill cap-status-${status}">${STATUS_TEXT[status] || status}</span>
        </div>
        <div class="cap-day-sub">${remaining} · ${agg.sessionsCount} session${agg.sessionsCount !== 1 ? 's' : ''}</div>
      </div>
    `;
  }

  // Per-type breakdown — show all preset slot types, even those at zero
  let breakdown = '';
  if (agg) {
    const typeRows = preset.slotTypes
      .map((type) => {
        const count = agg.byType[type] || 0;
        const isFull = count === 0;
        return `
        <div class="cap-type-row${isFull ? ' cap-type-full' : ''}">
          <span class="cap-type-name">${escHtml(type)}</span>
          <span class="cap-type-count">${isFull ? 'FULL' : count}</span>
        </div>
      `;
      })
      .join('');
    breakdown = `
      <section class="cap-section">
        <div class="section-label">Slot types in preset</div>
        <div class="cap-type-list">${typeRows}</div>
      </section>
    `;
  }

  // Staff breakdown
  let staff = '';
  if (agg && agg.byStaff.length > 0) {
    staff = `
      <section class="cap-section">
        <div class="section-label">By clinician</div>
        <div class="cap-staff-list">
          ${agg.byStaff
            .map(
              (s) => `
            <div class="cap-staff-row">
              <span class="cap-staff-name">${escHtml(s.name)}</span>
              <span class="cap-staff-count">${s.total}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </section>
    `;
  }

  return `
    <div class="cap-day-header">
      <button class="cap-nav-btn" id="capDayPrev" title="Previous day">◀</button>
      <div class="cap-day-title">${escHtml(formatDateLong(date))}</div>
      <button class="cap-nav-btn" id="capDayNext" title="Next day">▶</button>
    </div>
    <div class="cap-date-presets">
      <button class="preset-btn${date === todayISO() ? ' active' : ''}" data-date="${todayISO()}">Today</button>
      <button class="preset-btn${date === nextWorkingDayISO() ? ' active' : ''}" data-date="${nextWorkingDayISO()}">Next working day</button>
    </div>
    ${hero}
    ${breakdown}
    ${staff}
  `;
}

function bindDayView() {
  container.querySelector('#capDayPrev')?.addEventListener('click', () => {
    state.focusDate = addDays(state.focusDate, -1);
    saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
    loadVisibleDates();
  });
  container.querySelector('#capDayNext')?.addEventListener('click', () => {
    state.focusDate = addDays(state.focusDate, 1);
    saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
    loadVisibleDates();
  });
  container.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.focusDate = btn.dataset.date;
      saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
      loadVisibleDates();
    });
  });
}

// ── Week view ─────────────────────────────────────────────────────────────────

function renderWeekView(preset) {
  const start = startOfWeek(state.focusDate);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i)).filter(
    (d) => state.showWeekends || !isWeekend(d)
  );

  const weekTotal = dates.reduce((sum, d) => sum + (state.data[d]?.total || 0), 0);
  const weekMin = dates.reduce((sum, d) => sum + dayEval(d).minInfo.effective, 0);
  const weekStatus =
    weekMin > 0 ? computeStatus(weekTotal, weekMin, preset.thresholds || { tight: 75, low: 50 }) : 'sufficient';

  const pills = dates
    .map((date) => {
      const agg = state.data[date];
      const ev = dayEval(date);
      const status = ev.status;
      const minimum = ev.minInfo.effective;
      const closed = minimum === 0 || (agg && agg.sessionsCount === 0);
      const count = agg ? agg.total : '…';
      const label = formatDateShort(date);
      return `
      <div class="cap-day-pill cap-status-${status}${date === todayISO() ? ' cap-today' : ''}" data-date="${date}">
        <div class="cap-day-pill-label">${escHtml(label)}</div>
        <div class="cap-day-pill-badges">${bhBadgesHtml(ev.minInfo)}</div>
        <div class="cap-day-pill-count">${closed && !agg ? '—' : count}</div>
        <div class="cap-day-pill-min">${closed ? STATUS_TEXT[status] || status : `/ ${minimum}`}</div>
      </div>
    `;
    })
    .join('');

  return `
    <div class="cap-week-header">
      <button class="cap-nav-btn" id="capWeekPrev" title="Previous week">◀</button>
      <div class="cap-week-title">Week of ${escHtml(formatDateLong(start))}</div>
      <button class="cap-nav-btn" id="capWeekNext" title="Next week">▶</button>
    </div>
    <div class="cap-week-meta">
      <button class="ghost-btn" id="capThisWeek">This week</button>
      <label class="cap-weekend-toggle">
        <input type="checkbox" id="capWeekendToggle" ${state.showWeekends ? 'checked' : ''} />
        Show weekends
      </label>
    </div>

    <div class="cap-week-summary cap-status-${weekStatus}">
      <span class="cap-summary-label">Week total</span>
      <span class="cap-summary-num">${weekTotal}</span>
      <span class="cap-summary-vs">/ ${weekMin} target</span>
    </div>

    <div class="cap-week-grid">${pills}</div>
    <div class="section-hint">Click a day for detail.</div>
  `;
}

function bindWeekView() {
  container.querySelector('#capWeekPrev')?.addEventListener('click', () => {
    state.focusDate = addDays(state.focusDate, -7);
    saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
    loadVisibleDates();
  });
  container.querySelector('#capWeekNext')?.addEventListener('click', () => {
    state.focusDate = addDays(state.focusDate, 7);
    saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
    loadVisibleDates();
  });
  container.querySelector('#capThisWeek')?.addEventListener('click', () => {
    state.focusDate = todayISO();
    saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
    loadVisibleDates();
  });
  container.querySelector('#capWeekendToggle')?.addEventListener('change', (e) => {
    state.showWeekends = e.target.checked;
    chrome.storage.local.set({ 'capacity.showWeekends': state.showWeekends });
    render();
  });
  container.querySelectorAll('.cap-day-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      state.focusDate = pill.dataset.date;
      saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
      state.viewMode = 'day';
      chrome.storage.local.set({ 'capacity.viewMode': 'day' });
      render();
      loadVisibleDates();
    });
  });
}

// ── Month view ────────────────────────────────────────────────────────────────

function renderMonthView(preset) {
  const start = startOfMonth(state.monthAnchor);
  const n = daysInMonth(state.monthAnchor);
  const monthLabel = new Date(start + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Leading blanks for first-of-month positioning (Monday = 0)
  const firstDow = new Date(start + 'T12:00:00').getDay();
  const leading = firstDow === 0 ? 6 : firstDow - 1;

  const cells = [];
  for (let i = 0; i < leading; i++) cells.push(`<div class="cap-month-cell cap-month-blank"></div>`);

  for (let i = 0; i < n; i++) {
    const date = addDays(start, i);
    const dayNum = i + 1;
    const ev = dayEval(date);
    const status = ev.status;
    const agg = state.data[date];
    const isCurr = date === todayISO();

    cells.push(`
      <div class="cap-month-cell cap-status-${status}${isCurr ? ' cap-today' : ''}${isWeekend(date) ? ' cap-weekend' : ''}" data-date="${date}">
        <div class="cap-month-dow">${dayNum}</div>
        <div class="cap-month-badges">${bhMonthMarkerHtml(ev.minInfo)}</div>
        <div class="cap-month-count">${agg ? agg.total : state.loading.has(date) ? '·' : ''}</div>
      </div>
    `);
  }

  return `
    <div class="cap-month-header">
      <button class="cap-nav-btn" id="capMonthPrev" title="Previous month">◀</button>
      <div class="cap-month-title">${escHtml(monthLabel)}</div>
      <button class="cap-nav-btn" id="capMonthNext" title="Next month">▶</button>
    </div>
    <div class="cap-month-meta">
      <button class="ghost-btn" id="capThisMonth">This month</button>
    </div>
    <div class="cap-month-dow-row">
      <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
    </div>
    <div class="cap-month-grid">${cells.join('')}</div>
    <div class="cap-month-legend">
      <span class="cap-legend-item"><span class="cap-legend-dot cap-status-sufficient"></span>Sufficient</span>
      <span class="cap-legend-item"><span class="cap-legend-dot cap-status-tight"></span>Tight</span>
      <span class="cap-legend-item"><span class="cap-legend-dot cap-status-low"></span>Low</span>
      <span class="cap-legend-item"><span class="cap-legend-dot cap-status-critical"></span>Critical</span>
      <span class="cap-legend-item"><span class="cap-month-marker cap-month-marker-bh cap-legend-marker" aria-hidden="true"></span>Bank holiday</span>
      <span class="cap-legend-item"><span class="cap-month-marker cap-month-marker-postbh cap-legend-marker" aria-hidden="true"></span>After bank holiday</span>
    </div>
    <div class="section-hint">Click a day for detail.</div>
  `;
}

function bindMonthView() {
  container.querySelector('#capMonthPrev')?.addEventListener('click', () => {
    const d = new Date(state.monthAnchor + 'T12:00:00');
    d.setMonth(d.getMonth() - 1);
    state.monthAnchor = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
    loadVisibleDates();
  });
  container.querySelector('#capMonthNext')?.addEventListener('click', () => {
    const d = new Date(state.monthAnchor + 'T12:00:00');
    d.setMonth(d.getMonth() + 1);
    state.monthAnchor = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
    saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
    loadVisibleDates();
  });
  container.querySelector('#capThisMonth')?.addEventListener('click', () => {
    state.monthAnchor = todayISO();
    saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
    loadVisibleDates();
  });
  container.querySelectorAll('.cap-month-cell:not(.cap-month-blank)').forEach((cell) => {
    cell.addEventListener('click', () => {
      state.focusDate = cell.dataset.date;
      saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
      state.viewMode = 'day';
      chrome.storage.local.set({ 'capacity.viewMode': 'day' });
      render();
      loadVisibleDates();
    });
  });
}

// ── Common control binding ────────────────────────────────────────────────────

function bindControls() {
  container.querySelector('.setup-now-btn')?.addEventListener('click', () => {
    if (document.getElementById('setupHost')) {
      document.dispatchEvent(new CustomEvent('suite:open-setup'));
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sect-suite') });
    }
  });

  container.querySelector('#capPresetSelect')?.addEventListener('change', async (e) => {
    state.activePresetId = e.target.value;
    await chrome.storage.local.set({ 'capacity.activePresetId': state.activePresetId });
    Object.keys(state.data).forEach((d) => delete state.data[d]);
    render();
    loadVisibleDates();
  });
  container.querySelector('#capEditPreset')?.addEventListener('click', () => openEditPreset(state.activePresetId));
  container.querySelector('#capNewPreset')?.addEventListener('click', () => openNewPreset());
  container.querySelectorAll('.cap-mode-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      state.viewMode = btn.dataset.mode;
      await chrome.storage.local.set({ 'capacity.viewMode': state.viewMode });
      render();
      loadVisibleDates();
    });
  });
  container.querySelector('#capRefresh')?.addEventListener('click', () => {
    datesToFetch().forEach((d) => {
      invalidateCache(d);
      delete state.data[d];
    });
    loadVisibleDates();
  });

  // Phase 3: Preset export
  container.querySelector('#capExportPresets')?.addEventListener('click', async () => {
    const r = await chrome.storage.local.get([
      'capacity.presets',
      'capacity.activePresetId',
      'capacity.viewMode',
      'capacity.showWeekends',
    ]);
    const env = {
      format: 'medicus-suite-backup',
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      extensionVersion: '1.1.0',
      scope: 'capacity',
      modules: {
        capacity: {
          presets: r['capacity.presets'] || [],
          activePresetId: r['capacity.activePresetId'] || null,
          viewMode: r['capacity.viewMode'] || 'week',
          showWeekends: r['capacity.showWeekends'] || false,
        },
      },
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(env, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `capacity-presets-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });

  // Phase 3: Preset import — open file picker
  container.querySelector('#capImportPresets')?.addEventListener('click', () => {
    container.querySelector('#capImportFile')?.click();
  });

  container.querySelector('#capImportFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const raw = JSON.parse(text);
      if (raw.format !== 'medicus-suite-backup') {
        alert('Not a Medicus Suite backup file.');
        return;
      }
      const incoming = raw.modules?.capacity?.presets || [];
      if (!Array.isArray(incoming) || incoming.length === 0) {
        alert('No presets found in this file.');
        return;
      }
      const mode = await showImportModeDialog(incoming.length);
      if (!mode) return; // user cancelled

      const existing = await chrome.storage.local.get('capacity.presets');
      const existingPresets = existing['capacity.presets'] || [];

      if (mode === 'replace') {
        await chrome.storage.local.set({ 'capacity.presets': incoming });
        state.presets = incoming;
        state.activePresetId = incoming[0]?.id || null;
        await chrome.storage.local.set({ 'capacity.activePresetId': state.activePresetId });
        render();
        loadVisibleDates();
        return;
      }

      // Merge mode: find conflicts
      const existingMap = new Map(existingPresets.map((p) => [p.id, p]));
      const conflicts = incoming.filter((p) => existingMap.has(p.id));
      const noConflict = incoming.filter((p) => !existingMap.has(p.id));

      if (conflicts.length === 0) {
        const merged = [...existingPresets, ...noConflict];
        await chrome.storage.local.set({ 'capacity.presets': merged });
        state.presets = merged;
        render();
        loadVisibleDates();
        return;
      }

      // Resolve conflicts one by one
      const resolvedPresets = [...existingPresets, ...noConflict];
      for (const incoming_p of conflicts) {
        const resolution = await showConflictDialog(existingMap.get(incoming_p.id), incoming_p);
        if (resolution === 'mine') {
          // keep existing — already in resolvedPresets
        } else if (resolution === 'theirs') {
          const idx = resolvedPresets.findIndex((p) => p.id === incoming_p.id);
          if (idx >= 0) resolvedPresets[idx] = incoming_p;
          else resolvedPresets.push(incoming_p);
        } else if (resolution === 'copy') {
          const copyId = incoming_p.id + '-copy-' + Math.floor(Date.now() / 1000);
          resolvedPresets.push({ ...incoming_p, id: copyId, name: incoming_p.name + ' (imported)' });
        }
      }
      await chrome.storage.local.set({ 'capacity.presets': resolvedPresets });
      state.presets = resolvedPresets;
      render();
      loadVisibleDates();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  });
}

// ── Look-ahead banner & settings ─────────────────────────────────────────────

function renderLookaheadBanner(preset) {
  if (!preset) return '';
  const scan = state.scan;
  if (!scan) return '';

  const summary = scan.summary;
  if (!summary || scan.error) {
    return `
    <section class="cap-lookahead cap-lookahead-unknown" aria-label="Capacity look-ahead">
      <div class="cap-lookahead-row">
        <p class="cap-lookahead-text">Capacity look-ahead unavailable.</p>
        <span class="cap-lookahead-pill" aria-label="Capacity not fully checked">—</span>
      </div>
      <div class="cap-lookahead-actions">
        <button type="button" class="ghost-btn" id="capLookaheadSettings">Settings</button>
      </div>
    </section>
  `;
  }

  const sentence = lookAheadSentence(summary, preset.name);
  const atRisk = summary.atRiskCount || 0;
  const isChecking = state.loading.size > 0 || summary.uncheckedDays > 0;
  let toneKey = scanTone(summary);
  if (isChecking) toneKey = 'unknown';

  const toneClass = {
    red: 'cap-lookahead-critical',
    amber: 'cap-lookahead-warn',
    green: 'cap-lookahead-ok',
    unknown: 'cap-lookahead-unknown',
  }[toneKey];

  const pillContent = toneKey === 'unknown' ? '—' : atRisk;
  const pillAria =
    toneKey === 'unknown'
      ? 'Capacity not fully checked'
      : `${atRisk} day${atRisk === 1 ? '' : 's'} at risk in the next ${summary.horizonDays} days`;

  const checkingHtml = isChecking
    ? '<span class="cap-lookahead-checking">Checking…</span>'
    : '';

  const chips = (scan.atRisk || [])
    .slice(0, 5)
    .map((d) => {
      const statusLabel = STATUS_TEXT[d.status] || d.status;
      const chipAria = `${formatDateLong(d.dateISO)}: ${statusLabel}. ${d.reason}`;
      return `
      <button type="button" class="cap-risk-chip cap-status-${d.status}" data-date="${d.dateISO}" title="${escAttr(d.reason)}" aria-label="${escAttr(chipAria)}">
        ${escHtml(formatDateShort(d.dateISO))} · ${escHtml(statusLabel)}
      </button>`;
    })
    .join('');

  return `
    <section class="cap-lookahead ${toneClass}" aria-label="Capacity look-ahead">
      <div class="cap-lookahead-row">
        <p class="cap-lookahead-text">${escHtml(sentence)}${checkingHtml}</p>
        <span class="cap-lookahead-pill" aria-label="${escAttr(pillAria)}">${pillContent}</span>
      </div>
      <div class="cap-lookahead-actions">
        <button type="button" class="ghost-btn" id="capPrintPack">Print pack</button>
        <button type="button" class="ghost-btn" id="capExportCsv">CSV</button>
        <button type="button" class="ghost-btn" id="capLookaheadSettings">Settings</button>
      </div>
      ${chips ? `<div class="cap-lookahead-chips">${chips}</div>` : ''}
    </section>
  `;
}

function bindLookaheadBanner() {
  container.querySelector('#capPrintPack')?.addEventListener('click', () => onPrintRiskPack());
  container.querySelector('#capExportCsv')?.addEventListener('click', () => onExportRiskCsv());
  container.querySelector('#capLookaheadSettings')?.addEventListener('click', () => openLookaheadSettings());

  container.querySelectorAll('.cap-risk-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.focusDate = chip.dataset.date;
      saveUiState('capacity', { focusDate: state.focusDate, monthAnchor: state.monthAnchor });
      state.viewMode = 'day';
      chrome.storage.local.set({ 'capacity.viewMode': 'day' });
      render();
      loadVisibleDates();
    });
  });
}

function openLookaheadSettings() {
  state.uiMode = 'lookahead';
  render();
}

function closeLookaheadSettings() {
  state.uiMode = 'view';
  render();
  loadVisibleDates();
}

function renderLookaheadSettings() {
  const la = state.lookahead;
  return `
    <div class="module-wrap cap-module cap-editor-page">
      <div class="cap-editor-header">
        <button class="cap-nav-btn" id="capLookaheadBack" title="Back">◀</button>
        <div class="cap-editor-title">Look-ahead settings</div>
        <span style="width:30px"></span>
      </div>

      <div class="cap-form cap-lookahead-form">
        <div class="cap-field">
          <label class="cap-field-label" for="capLHHorizon">How many days ahead to check</label>
          <input type="number" class="cap-input cap-input-num" id="capLHHorizon" value="${la.horizonDays}" min="7" max="84" />
          <div class="cap-field-hint">Scan the next 7–84 calendar days from today.</div>
        </div>

        <div class="cap-field">
          <label class="cap-lookahead-check">
            <input type="checkbox" id="capLHIncludeTight" ${la.includeTight ? 'checked' : ''} />
            Include &ldquo;Tight&rdquo; days as at-risk
          </label>
        </div>

        <div class="cap-field">
          <label class="cap-lookahead-check">
            <input type="checkbox" id="capLHUpliftEnabled" ${la.upliftEnabled ? 'checked' : ''} />
            Raise the target after bank holidays
          </label>
        </div>

        <div class="cap-field" id="capLHUpliftFields">
          <label class="cap-field-label">Extra demand after bank holidays (estimates)</label>
          <div class="cap-uplift-grid">
            <label class="cap-uplift-row">
              <span>Single bank holiday</span>
              <input type="number" class="cap-input cap-input-tiny" id="capLHSingle" value="${la.singleBhUplift}" min="1" max="2.5" step="0.05" ${la.upliftEnabled ? '' : 'disabled'} />
            </label>
            <label class="cap-uplift-row">
              <span>Easter / long weekend</span>
              <input type="number" class="cap-input cap-input-tiny" id="capLHEaster" value="${la.easterBlockUplift}" min="1" max="2.5" step="0.05" ${la.upliftEnabled ? '' : 'disabled'} />
            </label>
            <label class="cap-uplift-row">
              <span>Christmas / New Year</span>
              <input type="number" class="cap-input cap-input-tiny" id="capLHXmas" value="${la.xmasBlockUplift}" min="1" max="2.5" step="0.05" ${la.upliftEnabled ? '' : 'disabled'} />
            </label>
          </div>
          <div class="cap-field-hint cap-lookahead-note">
            Uplifts are editable estimates for post&ndash;bank-holiday rebound, not published F2F figures.
          </div>
        </div>

        <div class="cap-editor-actions">
          <button class="primary-btn" id="capLHSave">Save</button>
          <button class="ghost-btn" id="capLHCancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function bindLookaheadSettings() {
  const upliftEnabled = container.querySelector('#capLHUpliftEnabled');
  const upliftFields = container.querySelector('#capLHUpliftFields');
  const multiplierInputs = () =>
    ['#capLHSingle', '#capLHEaster', '#capLHXmas'].map((sel) => container.querySelector(sel));
  const syncUpliftFields = () => {
    const enabled = !!upliftEnabled?.checked;
    if (upliftFields) upliftFields.style.opacity = enabled ? '1' : '0.45';
    multiplierInputs().forEach((el) => {
      if (el) el.disabled = !enabled;
    });
  };
  syncUpliftFields();
  upliftEnabled?.addEventListener('change', syncUpliftFields);

  container.querySelector('#capLookaheadBack')?.addEventListener('click', closeLookaheadSettings);
  container.querySelector('#capLHCancel')?.addEventListener('click', closeLookaheadSettings);
  container.querySelector('#capLHSave')?.addEventListener('click', saveLookaheadSettings);
}

async function saveLookaheadSettings() {
  const form = {
    horizonDays: parseInt(container.querySelector('#capLHHorizon')?.value, 10),
    includeTight: container.querySelector('#capLHIncludeTight')?.checked,
    upliftEnabled: container.querySelector('#capLHUpliftEnabled')?.checked,
    singleBhUplift: parseFloat(container.querySelector('#capLHSingle')?.value),
    easterBlockUplift: parseFloat(container.querySelector('#capLHEaster')?.value),
    xmasBlockUplift: parseFloat(container.querySelector('#capLHXmas')?.value),
  };
  const check = validateLookahead(form);
  if (!check.valid) {
    alert(check.error);
    return;
  }
  state.lookahead = check.value;
  selfWriteInProgress = true;
  try {
    await chrome.storage.local.set({ 'capacity.lookahead': state.lookahead });
  } finally {
    selfWriteInProgress = false;
  }
  Object.keys(state.data).forEach((d) => delete state.data[d]);
  closeLookaheadSettings();
}

async function onPrintRiskPack() {
  const preset = activePreset();
  if (!preset || !state.scan) return;

  const stored = await chrome.storage.local.get(['suite.letterhead']);
  const lh = stored['suite.letterhead'] || {};
  const practiceLabel =
    (typeof lh.practiceName === 'string' && lh.practiceName.trim()) || SITE_ID || 'Practice';

  const model = {
    generatedAt: new Date().toISOString(),
    practiceLabel,
    preset: {
      id: preset.id,
      name: preset.name,
      thresholds: preset.thresholds || { tight: 75, low: 50 },
    },
    lookahead: state.lookahead,
    scan: state.scan,
  };

  await chrome.storage.local.set({ 'capacity.riskPack': model });
  setTimeout(() => {
    chrome.storage.local.remove('capacity.riskPack');
  }, 60000);
  chrome.tabs.create({ url: chrome.runtime.getURL('side-panel/modules/capacity/at-risk-pack.html') });
}

function onExportRiskCsv() {
  const scan = state.scan;
  if (!scan) return;

  const header = ['Date', 'Weekday', 'Free', 'Your target', 'Adjusted target', 'Uplift', 'Status', 'Reason'];
  const atRisk = scan.atRisk || [];
  let rows;
  if (atRisk.length === 0) {
    rows = [['—', '—', '—', '—', '—', '—', '—', 'No days at risk in this horizon']];
  } else {
    rows = atRisk.map((d) => [
      d.dateISO,
      d.weekday,
      d.total ?? '',
      d.minInfo.base,
      d.minInfo.effective,
      d.minInfo.upliftApplied ? d.minInfo.uplift : '',
      STATUS_TEXT[d.status] || d.status,
      d.reason,
    ]);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(`capacity-at-risk-${stamp}.csv`, header, rows);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

// Show a dialog asking the user to choose Replace or Merge for preset import.
// Returns 'replace' | 'merge' | null (cancelled).
function showImportModeDialog(count) {
  return new Promise((resolve) => {
    const msg = `This file contains ${count} preset(s).\n\nReplace all — removes your existing presets and installs the imported ones.\nMerge — adds imported presets alongside your existing ones (conflicts resolved individually).\n\nChoose:\n  OK = Replace all\n  Cancel = Merge`;
    const result = confirm(msg);
    resolve(result ? 'replace' : 'merge');
  });
}

// Show a conflict resolution dialog for a single preset.
// Returns 'mine' | 'theirs' | 'copy'.
function showConflictDialog(existing, incoming) {
  return new Promise((resolve) => {
    const msg = `Conflict: "${existing.name}" (ID: ${existing.id}) already exists.\n\nChoose:\n  1 = Keep mine\n  2 = Use imported\n  3 = Add imported as a copy\n\nEnter 1, 2, or 3:`;
    const answer = prompt(msg, '1');
    if (answer === '2') resolve('theirs');
    else if (answer === '3') resolve('copy');
    else resolve('mine');
  });
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

// ── Preset editor (inline) ────────────────────────────────────────────────────
// WEEKDAYS / defaultMinimumByDay / presetSummary live in capacity-core.js

async function openNewPreset() {
  state.uiMode = 'new';
  state.editingPresetId = null;
  render();
  if (availableTypes.length === 0) {
    availableTypes = await fetchAppointmentTypes(SITE_ID).catch(() => []);
    if (state.uiMode === 'new') render();
  }
}

async function openEditPreset(presetId) {
  if (!presetId) return openNewPreset();
  state.uiMode = 'edit';
  state.editingPresetId = presetId;
  render();
  if (availableTypes.length === 0) {
    availableTypes = await fetchAppointmentTypes(SITE_ID).catch(() => []);
    if (state.uiMode === 'edit') render();
  }
}

function closeEditor() {
  state.uiMode = 'view';
  state.editingPresetId = null;
  render();
  loadVisibleDates();
}

function renderEditor() {
  const editing = state.uiMode === 'edit' ? state.presets.find((p) => p.id === state.editingPresetId) : null;
  const blank = {
    name: '',
    slotTypes: [],
    minimumByDay: { mon: 20, tue: 20, wed: 20, thu: 20, fri: 20, sat: 0, sun: 0 },
    thresholds: { tight: 75, low: 50 },
  };
  const p = editing
    ? { ...editing, minimumByDay: editing.minimumByDay || defaultMinimumByDay(editing.minimumPerDay) }
    : blank;
  const isLoadingTypes = availableTypes.length === 0;

  const allTypeNames = new Set([...availableTypes.map((t) => t.name), ...p.slotTypes]);
  const sortedTypes = Array.from(allTypeNames).sort();

  const weekdayInputs = WEEKDAYS.map(
    (d) => `
    <div class="cap-day-min">
      <label class="cap-day-min-label">${d.label}</label>
      <input type="number" class="cap-input cap-input-tiny" data-day="${d.key}" value="${p.minimumByDay[d.key] ?? 0}" min="0" max="999" />
    </div>
  `
  ).join('');

  return `
    <div class="module-wrap cap-module cap-editor-page">
      <div class="cap-editor-header">
        <button class="cap-nav-btn" id="capEditorBack" title="Back">◀</button>
        <div class="cap-editor-title">${editing ? 'Edit preset' : 'New preset'}</div>
        ${editing ? `<button class="cap-nav-btn cap-danger" id="capEditorDelete" title="Delete preset">✕</button>` : '<span style="width:30px"></span>'}
      </div>

      <div class="cap-form">
        <div class="cap-field">
          <label class="cap-field-label">Name</label>
          <input type="text" class="cap-input" id="capFName" value="${escAttr(p.name)}" placeholder="e.g. GP Routine" autofocus />
        </div>

        <div class="cap-field">
          <div class="cap-field-label-row">
            <label class="cap-field-label">Minimum free slots per weekday</label>
            <button class="cap-link-btn" id="capCopyMon" type="button">Copy Mon to all weekdays</button>
          </div>
          <div class="cap-day-mins-row">${weekdayInputs}</div>
          <div class="cap-field-hint">Set 0 for days when no minimum applies (e.g. weekends, half-day clinics).</div>
        </div>

        <div class="cap-field">
          <label class="cap-field-label">Thresholds</label>
          <div class="cap-threshold-row">
            <span class="cap-threshold-text">Tight at</span>
            <input type="number" class="cap-input cap-input-tiny" id="capFTight" value="${p.thresholds.tight}" min="1" max="99" />
            <span class="cap-threshold-text">%, Low at</span>
            <input type="number" class="cap-input cap-input-tiny" id="capFLow" value="${p.thresholds.low}" min="1" max="99" />
            <span class="cap-threshold-text">% of minimum</span>
          </div>
          <div class="cap-field-hint">Below minimum: "Tight" above the tight %, "Low" above the low %, "Critical" below.</div>
        </div>

        <div class="cap-field">
          <label class="cap-field-label">Slot types <span class="cap-count-inline" id="capTypeCount">(${p.slotTypes.length})</span></label>
          ${
            isLoadingTypes
              ? `
            <div class="cap-types-loading">Loading slot types from Medicus…</div>
          `
              : sortedTypes.length === 0
                ? `
            <div class="cap-types-empty">
              No slot types available. Make sure the practice code is set in the Suite tab and you're signed in to Medicus.
              <button class="cap-link-btn" id="capRetryTypes">Retry</button>
            </div>
          `
                : `
            <div class="cap-types-search">
              <input type="text" class="cap-input" id="capTypeSearch" placeholder="Filter types…" />
            </div>
            <div class="cap-types-list" id="capTypesList">
              ${sortedTypes
                .map(
                  (t) => `
                <label class="cap-type-check">
                  <input type="checkbox" value="${escAttr(t)}" ${p.slotTypes.includes(t) ? 'checked' : ''} />
                  <span>${escHtml(t)}</span>
                </label>
              `
                )
                .join('')}
            </div>
          `
          }
        </div>

        <div class="cap-editor-actions">
          <button class="primary-btn" id="capFSave">${editing ? 'Save changes' : 'Create preset'}</button>
          <button class="ghost-btn" id="capFCancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function bindEditor() {
  container.querySelector('#capEditorBack')?.addEventListener('click', closeEditor);
  container.querySelector('#capFCancel')?.addEventListener('click', closeEditor);
  container.querySelector('#capEditorDelete')?.addEventListener('click', deletePreset);
  container.querySelector('#capFSave')?.addEventListener('click', savePreset);
  container.querySelector('#capRetryTypes')?.addEventListener('click', async () => {
    availableTypes = await fetchAppointmentTypes(SITE_ID).catch(() => []);
    render();
  });

  // Copy Mon value to all weekdays
  container.querySelector('#capCopyMon')?.addEventListener('click', () => {
    const monVal = container.querySelector('input[data-day="mon"]')?.value;
    if (monVal == null) return;
    ['tue', 'wed', 'thu', 'fri'].forEach((d) => {
      const el = container.querySelector(`input[data-day="${d}"]`);
      if (el) el.value = monVal;
    });
  });

  const list = container.querySelector('#capTypesList');
  const countEl = container.querySelector('#capTypeCount');
  list?.addEventListener('change', () => {
    const n = list.querySelectorAll('input[type=checkbox]:checked').length;
    if (countEl) countEl.textContent = `(${n})`;
  });

  const search = container.querySelector('#capTypeSearch');
  search?.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    list.querySelectorAll('.cap-type-check').forEach((row) => {
      const t = row.querySelector('span').textContent.toLowerCase();
      row.style.display = t.includes(q) ? '' : 'none';
    });
  });
}

async function savePreset() {
  const name = container.querySelector('#capFName').value.trim();
  const minimumByDay = {};
  WEEKDAYS.forEach((d) => {
    const el = container.querySelector(`input[data-day="${d.key}"]`);
    minimumByDay[d.key] = parseInt(el?.value, 10) || 0;
  });
  const tight = parseInt(container.querySelector('#capFTight').value, 10) || 75;
  const low = parseInt(container.querySelector('#capFLow').value, 10) || 50;
  const slotTypes = Array.from(container.querySelectorAll('#capTypesList input:checked')).map((i) => i.value);

  const check = validatePreset({ name, slotTypes, tight, low });
  if (!check.valid) {
    alert(check.error);
    return;
  }

  const editing = state.uiMode === 'edit' ? state.presets.find((p) => p.id === state.editingPresetId) : null;
  const preset = editing
    ? { ...editing, name, slotTypes, minimumByDay, thresholds: { tight, low } }
    : {
        id: 'p_' + Math.random().toString(36).slice(2, 10),
        name,
        slotTypes,
        minimumByDay,
        thresholds: { tight, low },
        createdAt: new Date().toISOString(),
      };
  // Drop legacy field if present
  delete preset.minimumPerDay;

  state.presets = editing ? state.presets.map((p) => (p.id === editing.id ? preset : p)) : [...state.presets, preset];

  const setKeys = { 'capacity.presets': state.presets };
  if (!editing && state.presets.length === 1) {
    state.activePresetId = preset.id;
    setKeys['capacity.activePresetId'] = preset.id;
  } else if (!state.activePresetId) {
    state.activePresetId = preset.id;
    setKeys['capacity.activePresetId'] = preset.id;
  }
  selfWriteInProgress = true;
  try {
    await chrome.storage.local.set(setKeys);
  } finally {
    selfWriteInProgress = false;
  }
  Object.keys(state.data).forEach((d) => delete state.data[d]);
  closeEditor();
}

async function deletePreset() {
  if (!confirm('Delete this preset?')) return;
  const id = state.editingPresetId;
  state.presets = state.presets.filter((p) => p.id !== id);
  const newActive = state.activePresetId === id ? state.presets[0]?.id || null : state.activePresetId;
  state.activePresetId = newActive;
  selfWriteInProgress = true;
  try {
    await chrome.storage.local.set({
      'capacity.presets': state.presets,
      'capacity.activePresetId': newActive,
    });
  } finally {
    selfWriteInProgress = false;
  }
  Object.keys(state.data).forEach((d) => delete state.data[d]);
  closeEditor();
}
