// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Slot Counter module v2.2
// API-based replacement for the DOM-scraping slot counter.
// Endpoint: GET https://{siteId}.api.england.medicus.health/scheduling/data/appointment-book/embedded-overview
// Available slots: entries where diaryEntryType.value === 'slot'

'use strict';

import { loadUiState, saveUiState } from '../shared/ui-state.js';
import { freshnessHtml, attachFreshnessTicker } from '../shared/freshness.js';
import { downloadCsv } from '../shared/export-util.js';
import { SWATCH_KEYS, sanitisePillPrefs, applyPillOrder } from '../shared/pill-prefs.js';
import {
  detectMedicusTab,
  detectPatientId,
  fetchAppointmentFinder,
  fetchAvailableSlots,
  reserveSlot,
  fetchCreateForm,
  createAppointment,
  releaseReservation,
} from './booking-api.js';

// Practice code resolved from chrome.storage.local['suite.practiceCode'].
// No hardcoded default — null means the user has not configured a code yet.
let SITE_ID = null;
let API_BASE = null;

// ── State ─────────────────────────────────────────────────────────────────────

let state = {
  date: todayISO(),
  data: null,
  loading: false,
  error: null,
  hiddenTypes: new Set(),
  expanded: new Set(),
  showExcluded: false,
  lastFetched: null,
  alertRules: [],
  // Pill preferences — USER CONFIG (order + colour per type), persisted to
  // 'slots.pillPrefs' and included in suite backups via slot-counter-io.js.
  pillPrefs: { order: [], colours: {} },
  organisePills: false, // ephemeral: reorder/colour mode
  openColourFor: null, // type whose colour palette is open, or null
  typesOpen: false, // whether the by-type details panel is open
  bk: {
    open: false,
    initLoading: false,
    initError: null,
    tabId: null,
    appOrigin: null,
    patientId: null,
    providerId: null,
    types: [],
    selectedTypeId: '',
    date: null, // set to todayISO() on first open
    slots: null, // null = no search yet; [] = searched, no results
    hasSearched: false,
    slotsLoading: false,
    slotsError: null,
    step: 'browse', // 'browse' | 'confirm' | 'booked'
    selectedSlot: null,
    reservationId: null,
    formData: null,
    confirming: false,
    confirmError: null,
    reason: '',
    bookedId: null,
  },
};

// The pill colour palette, prefs validation and ordering rule are shared with
// any other categorical-pill surface (see ../shared/pill-prefs.js). Status
// amber/red from alert rules ALWAYS overrides a custom colour at render time —
// safety salience is never user-configurable away.

function savePillPrefs() {
  chrome.storage.local.set({ 'slots.pillPrefs': { order: state.pillPrefs.order, colours: state.pillPrefs.colours } });
}

let container = null;
let _inFlight = false;

// ── Init ──────────────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;

  // Load persisted hidden types, alert rules, and practice code
  const stored = await chrome.storage.local.get([
    'slots.hiddenTypes',
    'slots.alertRules',
    'slots.pillPrefs',
    'suite.practiceCode',
  ]);
  if (stored['slots.hiddenTypes']) state.hiddenTypes = new Set(stored['slots.hiddenTypes']);
  if (stored['slots.alertRules']) state.alertRules = stored['slots.alertRules'];
  state.pillPrefs = sanitisePillPrefs(stored['slots.pillPrefs']);
  if (stored['suite.practiceCode']) {
    SITE_ID = stored['suite.practiceCode'];
    API_BASE = `https://${SITE_ID}.api.england.medicus.health`;
  }

  // Restore persisted view state (expanded staff rows, showExcluded flag)
  // hiddenTypes is already covered by slots.hiddenTypes in chrome.storage;
  // expanded and showExcluded are lightweight ephemeral UI state.
  const savedUi = await loadUiState('slots');
  if (savedUi) {
    if (Array.isArray(savedUi.hiddenTypes))
      state.hiddenTypes = new Set(savedUi.hiddenTypes.filter((t) => typeof t === 'string'));
    if (typeof savedUi.showExcluded === 'boolean') state.showExcluded = savedUi.showExcluded;
    if (Array.isArray(savedUi.expanded))
      state.expanded = new Set(savedUi.expanded.filter((t) => typeof t === 'string'));
    if (typeof savedUi.typesOpen === 'boolean') state.typesOpen = savedUi.typesOpen;
  }

  render();
  fetchAndRender();
  const stopFresh = attachFreshnessTicker(container);

  // Listen for Pusher-triggered refresh from service worker
  document.addEventListener('suite:slots:refresh', onRefresh);

  // Listen for storage changes (hidden types toggled)
  chrome.storage.onChanged.addListener(onStorageChange);

  // Return cleanup
  return () => {
    document.removeEventListener('suite:slots:refresh', onRefresh);
    chrome.storage.onChanged.removeListener(onStorageChange);
    stopFresh();
    if (state.bk.reservationId && state.bk.appOrigin) {
      releaseReservation(state.bk.tabId, state.bk.appOrigin, state.bk.reservationId).catch(() => {});
    }
    container = null;
  };
}

function onRefresh() {
  if (!container) return;
  fetchAndRender();
}

function onStorageChange(changes) {
  if (changes['slots.hiddenTypes']) {
    state.hiddenTypes = new Set(changes['slots.hiddenTypes'].newValue || []);
    render();
  }
  if (changes['slots.alertRules']) {
    state.alertRules = changes['slots.alertRules'].newValue || [];
    render();
  }
  if (changes['slots.pillPrefs']) {
    state.pillPrefs = sanitisePillPrefs(changes['slots.pillPrefs'].newValue);
    render();
  }
  if (changes['suite.practiceCode']) {
    SITE_ID = changes['suite.practiceCode'].newValue || null;
    API_BASE = SITE_ID ? `https://${SITE_ID}.api.england.medicus.health` : null;
    state.data = null;
    fetchAndRender();
  }
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchAndRender() {
  if (!container) return;
  if (_inFlight) return;
  _inFlight = true;
  const refreshBtn = container.querySelector('#refreshSlots');
  if (refreshBtn) refreshBtn.disabled = true;
  try {
    // Re-resolve practice code on every fetch (auto-detect from tab if available)
    if (window.PracticeCode) {
      const { code } = await window.PracticeCode.resolve();
      if (code) {
        SITE_ID = code;
        API_BASE = `https://${SITE_ID}.api.england.medicus.health`;
      }
    }
    if (!SITE_ID || !API_BASE) {
      state.loading = false;
      state.error = 'No practice code — open a Medicus tab or set it in Options.';
      render();
      return;
    }
    state.loading = true;
    state.error = null;
    render();

    try {
      const url = `${API_BASE}/scheduling/data/appointment-book/embedded-overview?date=${state.date}&filterByUsualLocation=false`;
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403)
          throw new Error('Not signed in to Medicus. Open Medicus in a tab and sign in.');
        throw new Error(`API error ${resp.status}`);
      }
      const raw = await resp.json();
      state.data = aggregate(raw, state.date);
      state.lastFetched = new Date();
      state.error = null;
    } catch (err) {
      state.error = err.message;
    }

    state.loading = false;
    render();
  } finally {
    _inFlight = false;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

// Slots are bucketed as AM (start hour < 12) or PM (start hour >= 12).
// Slots with no startDateTime default to AM (rare; the API always provides one
// for real slots, this is just a defensive default).
function bucketOf(entry) {
  if (!entry.startDateTime) return 'am';
  const hour = new Date(entry.startDateTime).getHours();
  return hour < 12 ? 'am' : 'pm';
}

function emptyAmPm() {
  return { am: 0, pm: 0 };
}

function aggregate(raw, forDate) {
  const byType = {};
  const byStaff = [];
  const total = emptyAmPm();

  // For today, filter to slots that haven't started yet
  const isToday = forDate === todayISO();
  const now = new Date();

  (raw.staffSchedules || []).forEach((staff) => {
    const staffTotal = emptyAmPm();
    const staffByType = {};

    (staff.schedule || []).forEach((session) => {
      (session.entries || []).forEach((entry) => {
        if (entry.diaryEntryType?.value !== 'slot') return;

        // Time filter for today: skip slots whose start is in the past
        if (isToday && entry.startDateTime) {
          const slotTime = new Date(entry.startDateTime);
          if (slotTime < now) return;
        }

        const type = entry.appointmentType?.name || 'Unknown';
        const bucket = bucketOf(entry);
        if (!byType[type]) byType[type] = emptyAmPm();
        if (!staffByType[type]) staffByType[type] = emptyAmPm();
        byType[type][bucket]++;
        staffByType[type][bucket]++;
        staffTotal[bucket]++;
        total[bucket]++;
      });
    });

    if (staffTotal.am + staffTotal.pm > 0) {
      byStaff.push({ name: staff.name || 'Unknown', total: staffTotal, byType: staffByType });
    }
  });

  byStaff.sort((a, b) => a.name.localeCompare(b.name));
  return { total, byType, byStaff, isToday };
}

function sumAmPm(o) {
  return (o?.am || 0) + (o?.pm || 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nextWorkingDayISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === nextWorkingDayISO()) return 'Next working day';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Returns { am, pm } summed across all non-hidden types.
function visibleTotal(byType, hiddenTypes) {
  const out = emptyAmPm();
  for (const [type, n] of Object.entries(byType)) {
    if (hiddenTypes.has(type)) continue;
    out.am += n.am || 0;
    out.pm += n.pm || 0;
  }
  return out;
}

// ── Alert levels ──────────────────────────────────────────────────────────────
// One source of truth for "is this type running dry?" — consumed by the alert
// ribbon, the hero label, and the type pills, so they can never disagree.

// 'red' (zero left), 'amber' (at/below threshold), or null for a single type.
function typeAlertLevel(typeName, count) {
  for (const rule of state.alertRules || []) {
    if (!rule.enabled || rule.typeName !== typeName) continue;
    if (count <= rule.threshold) return count === 0 ? 'red' : 'amber';
  }
  return null;
}

// Highest triggered level across all enabled rules, or null when all calm.
function overallAlertLevel(byType) {
  let level = null;
  for (const rule of state.alertRules || []) {
    if (!rule.enabled) continue;
    const l = typeAlertLevel(rule.typeName, sumAmPm(byType[rule.typeName]));
    if (l === 'red') return 'red';
    if (l === 'amber') level = 'amber';
  }
  return level;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

// Feather-style stroke SVGs at 14px currentColor for use in chrome.
// stroke-linecap/linejoin round, stroke-width 2, fill none.

const SVG_ALERT_OCTAGON = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

const SVG_ALERT_TRIANGLE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const SVG_REFRESH = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;

const SVG_SLIDERS = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;

const SVG_CALENDAR_X = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="10" y1="14" x2="14" y2="18"/><line x1="14" y1="14" x2="10" y2="18"/></svg>`;

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (!container) return;

  const d = state.data;
  const visible = d ? visibleTotal(d.byType, state.hiddenTypes) : emptyAmPm();
  const visibleSum = sumAmPm(visible);

  // Dispatch count for nav badge — sum AM+PM so badge shows day total
  document.dispatchEvent(
    new CustomEvent('suite:slots:count', { detail: { count: state.loading ? null : visibleSum } })
  );

  container.innerHTML = `
    <div class="module-wrap slots-module">
      ${renderHeader()}
      <div id="slotsBanner" class="banner${state.error ? '' : ' hidden'}">
        ${escHtml(state.error || '')}
        ${state.error && state.error.startsWith('No practice code') ? ' <button class="ghost-btn setup-now-btn">Set up now</button>' : ''}
      </div>
      ${!state.loading && d ? renderAlertRibbon(d.byType) : ''}
      ${!state.loading && d ? renderHeroCard(visible, visibleSum) : ''}
      ${state.loading ? renderSkeleton() : d ? renderData(d, visible, visibleSum) : ''}
      ${renderBookingSection()}
      <div class="foot">${state.lastFetched ? freshnessHtml(state.lastFetched) : ''}</div>
    </div>
  `;

  bindEvents();
}

function renderHeader() {
  return `
    <div class="mod-header">
      <div>
        <div class="mod-eyebrow">Appointment Book · ${escHtml(formatDate(state.date))}</div>
        ${state.loading ? `<div class="mod-title" style="margin:6px 0 10px">Loading…</div>` : ''}
      </div>
    </div>
    <div class="date-presets">
      <button class="preset-btn${state.date === todayISO() ? ' active' : ''}" data-date="${todayISO()}">Today</button>
      <button class="preset-btn${state.date === nextWorkingDayISO() ? ' active' : ''}" data-date="${nextWorkingDayISO()}">Next working day</button>
      <input type="date" id="slotsDate" value="${state.date}" max="2099-12-31" class="date-input" />
      <button class="ghost-btn date-refresh-btn" id="refreshSlots" title="Refresh">${SVG_REFRESH}</button>
      ${state.data && Object.keys(state.data.byType).length > 0 ? `<button class="ghost-btn" id="slotsCsvBtn">&#x2193; CSV</button>` : ''}
    </div>
  `;
}

// Hero card: headline total and AM/PM chips. When an alert level is active the
// card itself wears the wash. The split bar has been removed (Decision A).
// Returns '' when there are no session types at all (empty-state path, Decision F).
function renderHeroCard(visible, visibleSum) {
  const d = state.data;
  // Suppress hero card when there are no sessions at all (empty state, Decision F)
  if (!d || Object.keys(d.byType).length === 0) return '';

  const isToday = d.isToday;
  const level = overallAlertLevel(d.byType);
  const labelCls = visibleSum === 0 ? ' zero' : level ? ` ${level}` : '';
  const cardCls = level ? ` slots-hero-card--${level}` : '';

  return `
    <div class="slots-hero-card${cardCls}">
      <div class="slots-hero-main">
        <div class="slots-count-hero">${visibleSum.toLocaleString('en-GB')}</div>
        <div class="slots-hero-right">
          <div class="slots-count-label${labelCls}">${isToday ? 'Free slots remaining today' : 'Free slots available'}</div>
          <div class="slots-ampm-split">
            <span class="ampm-chip ampm-am"><span class="ampm-tag">AM</span><span class="ampm-num">${visible.am.toLocaleString('en-GB')}</span></span>
            <span class="ampm-chip ampm-pm"><span class="ampm-tag">PM</span><span class="ampm-num">${visible.pm.toLocaleString('en-GB')}</span></span>
          </div>
          ${isToday && state.lastFetched ? `<div class="slots-hero-asat">practice-wide · as at ${state.lastFetched.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
        </div>
      </div>
      ${renderTypePills(d.byType, visibleSum)}
    </div>
  `;
}

// One pill per included type: dot + name + count. Order and outline colour
// are user-configurable (drag to reorder, click to colour, in organise mode);
// default order is biggest first. The dot/outline is slate (or the user's
// chosen colour) when calm and ALWAYS goes amber/red when that type is
// at/below its configured alert threshold — status overrides custom colour.
function orderedPillEntries(byType) {
  const byCount = Object.entries(byType)
    .filter(([t]) => !state.hiddenTypes.has(t))
    .sort((a, b) => sumAmPm(b[1]) - sumAmPm(a[1]));
  return applyPillOrder(byCount, state.pillPrefs.order || []);
}

function renderTypePills(byType, visibleSum) {
  const entries = orderedPillEntries(byType);
  if (entries.length === 0 || visibleSum === 0) return '';
  const organising = state.organisePills;

  const pills = entries
    .map(([type, n]) => {
      const total = sumAmPm(n);
      const level = typeAlertLevel(type, total);
      const colourKey = state.pillPrefs.colours[type];
      const customCls = !level && colourKey ? ` pill-c-${colourKey}` : '';
      const cls =
        (level ? ` pill-${level}` : total === 0 ? ' pill-zero' : '') +
        customCls +
        (organising ? ' pill-organising' : '');
      const title = organising
        ? 'Drag to reorder · click to set colour'
        : `${escHtml(type)} — ${n.am} am · ${n.pm} pm${level ? ' · below alert threshold' : ''}`;
      const ariaLabel = organising
        ? `${escHtml(type)}, ${total} slots — Enter to colour, arrow keys to move`
        : `${escHtml(type)}, ${total} slots`;
      return `<span class="slot-pill${cls}" data-pill-type="${escHtml(type)}"${organising ? ' draggable="true" tabindex="0" role="button"' : ''} title="${title}" aria-label="${ariaLabel}">
        <span class="slot-pill-dot" aria-hidden="true"></span>
        <span class="slot-pill-name">${escHtml(type)}</span>
        <span class="slot-pill-num">${total.toLocaleString('en-GB')}</span>
      </span>`;
    })
    .join('');

  const palette =
    organising && state.openColourFor
      ? `<div class="pill-palette">
          <span class="pill-palette-label">Colour — ${escHtml(state.openColourFor)}</span>
          <span class="pill-swatches">${SWATCH_KEYS.map(
            (k) =>
              `<button class="pill-swatch pill-c-${k}${(state.pillPrefs.colours[state.openColourFor] || 'default') === k ? ' active' : ''}" data-swatch="${k}" title="${k === 'default' ? 'No colour' : k}"></button>`
          ).join('')}</span>
        </div>`
      : '';

  const organiseBtn = `<button class="pill-organise-btn${organising ? ' active' : ''}" id="pillOrganiseBtn" title="${organising ? 'Finish organising' : 'Organise pills — drag to reorder, click a pill to colour it'}" aria-pressed="${organising}">${organising ? 'Done' : SVG_SLIDERS}</button>`;

  return `<div class="slots-pill-row${organising ? ' organising' : ''}" id="pillRow" aria-live="polite">
      ${pills}
      ${organiseBtn}
    </div>
    ${palette}
    ${organising ? '<div class="pill-organise-hint">Drag to reorder · click a pill to colour it · alert amber/red always overrides colour</div>' : ''}`;
}

function renderAlertRibbon(byType) {
  if (!state.alertRules || state.alertRules.length === 0) return '';
  const triggered = [];
  for (const rule of state.alertRules) {
    if (!rule.enabled) continue;
    const count = sumAmPm(byType[rule.typeName]);
    if (count <= rule.threshold) {
      triggered.push({ ...rule, count, level: count === 0 ? 'red' : 'amber' });
    }
  }
  if (triggered.length === 0) return '';
  const topLevel = triggered.some((t) => t.level === 'red') ? 'red' : 'amber';
  const iconSvg =
    topLevel === 'red'
      ? `<span aria-label="Critical alert">${SVG_ALERT_OCTAGON}</span>`
      : `<span aria-label="Warning">${SVG_ALERT_TRIANGLE}</span>`;
  const items = triggered
    .map((t) => {
      const msg =
        t.count === 0
          ? `No ${escHtml(t.typeName)} slots`
          : `${escHtml(t.typeName)}: <span class="slots-alert-count">${t.count.toLocaleString('en-GB')}</span> slot${t.count !== 1 ? 's' : ''} remaining`;
      return `<div class="slots-alert-item">${msg}</div>`;
    })
    .join('');
  const editBtn = `<button class="slots-ribbon-link" id="slotsRibbonEdit">Edit thresholds</button>`;
  return `
    <div class="slots-alert-ribbon slots-alert-ribbon-${topLevel}">
      <span class="slots-alert-icon">${iconSvg}</span>
      <div class="slots-alert-items">${items}</div>
      ${editBtn}
    </div>
  `;
}

function renderSkeleton() {
  return `<div class="skeleton-list">${Array(5).fill('<div class="skel-row"></div>').join('')}</div>`;
}

function renderData(d, visible, visibleSum) {
  if (!d.byType || Object.keys(d.byType).length === 0) {
    // Designed empty state (Decision F) — hero is already suppressed by renderHeroCard
    return `
      <div class="slots-empty-state">
        <span class="slots-empty-icon">${SVG_CALENDAR_X}</span>
        <span class="slots-empty-label">NO SESSIONS — ${escHtml(formatDate(state.date))}</span>
        <span class="slots-empty-sub">Try another day above.</span>
      </div>
    `;
  }

  const entries = Object.entries(d.byType).sort((a, b) => sumAmPm(b[1]) - sumAmPm(a[1]));
  const ticked = entries.filter(([t]) => !state.hiddenTypes.has(t));
  const unticked = entries.filter(([t]) => state.hiddenTypes.has(t));
  const showExcluded = state.showExcluded || false;

  // Count cell: muted am/pm breakdown, then the bold total at the right edge —
  // totals form a scannable column. Share-of-total moved off the line into the
  // row's micro-bar (and the tooltip), so the count is the first read.
  const countCell = (n, pct) => {
    const total = sumAmPm(n);
    return `
      <span class="slot-count-group${total === 0 ? ' zero' : ''}"${pct != null ? ` title="${pct}% of visible total"` : ''}>
        <span class="slot-count-ampm" title="Morning">${n.am}<span class="ampm-tag-inline">am</span></span>
        <span class="slot-count-sep">·</span>
        <span class="slot-count-ampm" title="Afternoon">${n.pm}<span class="ampm-tag-inline">pm</span></span>
        <span class="slot-count-total">${total}</span>
      </span>
    `;
  };

  const row = (type, n, hidden) => {
    const pct = !hidden && visibleSum > 0 ? Math.round((sumAmPm(n) / visibleSum) * 100) : null;
    const share =
      pct != null && pct > 0 ? `<span class="slot-share" style="width:${pct}%" aria-hidden="true"></span>` : '';
    return `
      <div class="slot-row${hidden ? ' row-hidden' : ''}">
        ${share}
        <label class="slot-label">
          <input type="checkbox" class="type-toggle" data-type="${escHtml(type)}" ${hidden ? '' : 'checked'} />
          <span class="slot-type">${escHtml(type)}</span>
        </label>
        ${countCell(n, pct)}
      </div>
    `;
  };

  const excludedSection =
    unticked.length === 0
      ? ''
      : `
    <button class="excluded-toggle" id="excludedToggle">
      <span>${showExcluded ? '▾' : '▸'}</span>
      <span>${unticked.length} excluded type${unticked.length !== 1 ? 's' : ''}</span>
    </button>
    ${showExcluded ? `<div class="excluded-list">${unticked.map(([t, n]) => row(t, n, true)).join('')}</div>` : ''}
  `;

  const staffRows = d.byStaff
    .map((s) => {
      const isExpanded = state.expanded.has(s.name);
      const staffVisible = visibleTotal(s.byType, state.hiddenTypes);
      const staffSum = sumAmPm(staffVisible);
      const staffPct = visibleSum > 0 ? Math.round((staffSum / visibleSum) * 100) : 0;
      const staffAmPct = staffSum > 0 ? Math.round((staffVisible.am / staffSum) * 100) : 0;
      return `
      <div class="staff-row">
        <button class="staff-toggle" data-staff="${escHtml(s.name)}" title="${staffPct}% of visible total · AM ${staffVisible.am} · PM ${staffVisible.pm}" aria-label="${escHtml(s.name)} — ${staffPct}% of visible total">
          ${staffPct > 0 ? `<span class="staff-share" style="width:${staffPct}%" aria-hidden="true"></span>` : ''}
          ${staffSum > 0 ? `<span class="staff-split" aria-hidden="true"><span class="split-am" style="width:${staffAmPct}%"></span><span class="split-pm" style="width:${100 - staffAmPct}%"></span></span>` : ''}
          <span class="staff-chevron">${isExpanded ? '▾' : '▸'}</span>
          <span class="staff-name">${escHtml(s.name)}</span>
          <span class="staff-count-mini">
            <span title="Morning">${staffVisible.am}<span class="ampm-tag-inline">am</span></span>
            <span class="slot-count-sep">·</span>
            <span title="Afternoon">${staffVisible.pm}<span class="ampm-tag-inline">pm</span></span>
            <span class="slot-count-sep">·</span>
            <span class="staff-count">${staffSum}</span>
          </span>
        </button>
        ${
          isExpanded
            ? `<div class="staff-detail">
          ${Object.entries(s.byType)
            .filter(([t]) => !state.hiddenTypes.has(t))
            .sort((a, b) => sumAmPm(b[1]) - sumAmPm(a[1]))
            .map(
              ([t, n]) => `<div class="staff-type-row">
              <span>${escHtml(t)}</span>
              <span class="staff-type-counts">
                <span>${n.am}<span class="ampm-tag-inline">am</span></span>
                <span class="slot-count-sep">·</span>
                <span>${n.pm}<span class="ampm-tag-inline">pm</span></span>
                <span class="slot-count-sep">·</span>
                <span class="staff-type-total">${sumAmPm(n)}</span>
              </span>
            </div>`
            )
            .join('')}
        </div>`
            : ''
        }
      </div>
    `;
    })
    .join('');

  return `
    <section class="slots-section">
      <details class="slot-types-details"${state.typesOpen ? ' open' : ''}>
        <summary class="slot-types-summary section-label"><span>By type — include/exclude &amp; am/pm detail</span></summary>
        <div class="slot-list">
          ${ticked.map(([t, n]) => row(t, n, false)).join('')}
          ${excludedSection}
        </div>
        <div class="section-hint">Untick a type to exclude it from the total.</div>
      </details>
    </section>

    ${
      d.byStaff.length > 0
        ? `
    <section class="slots-section">
      <div class="section-label">By clinician</div>
      <div class="staff-list">${staffRows}</div>
    </section>`
        : ''
    }
  `;
}

// ── Booking section ───────────────────────────────────────────────────────────

function renderBookingSection() {
  const { bk } = state;
  const headerLabel = 'Book appointment for patient';
  return `
    <section class="slots-section bk-section">
      <button class="bk-toggle-row" id="bkToggle" aria-expanded="${bk.open}">
        <span class="bk-toggle-chevron" aria-hidden="true">${bk.open ? '▾' : '▸'}</span>
        <span class="bk-toggle-text">${headerLabel}</span>
        ${bk.open && bk.patientId ? `<span class="bk-pt-badge">patient</span>` : ''}
      </button>
      ${bk.open ? renderBookingContent() : ''}
    </section>
  `;
}

function renderBookingContent() {
  const { bk } = state;
  if (bk.initLoading) return `<div class="bk-loading">Loading appointment types…</div>`;
  if (bk.initError)
    return `<div class="bk-error">${escHtml(bk.initError)}</div>`;
  if (bk.step === 'booked') return renderBookingSuccess();
  if (bk.step === 'confirm') return renderBookingConfirm();
  return renderBookingBrowse();
}

function renderBookingBrowse() {
  const { bk } = state;
  const typesHtml =
    bk.types.length === 0
      ? '<option value="" disabled>No appointment types found</option>'
      : bk.types
          .map(
            (t) =>
              `<option value="${escHtml(t.value)}"${bk.selectedTypeId === t.value ? ' selected' : ''}>${escHtml(t.label)}</option>`
          )
          .join('');

  let slotsHtml = '';
  if (bk.slotsLoading) {
    slotsHtml = `<div class="bk-loading">Searching for slots…</div>`;
  } else if (bk.slotsError) {
    slotsHtml = `<div class="bk-error">${escHtml(bk.slotsError)}</div>`;
  } else if (bk.hasSearched && bk.slots && bk.slots.length > 0) {
    slotsHtml = `<div class="bk-slot-list">${bk.slots.map((s, i) => renderSlotRow(s, i)).join('')}</div>`;
  } else if (bk.hasSearched) {
    slotsHtml = `<div class="bk-no-slots">No available slots on this date.</div>`;
  }

  const canSearch = bk.selectedTypeId && bk.date && !bk.slotsLoading && bk.appOrigin;
  const bkDate = bk.date || todayISO();

  return `
    <div class="bk-browse">
      ${!bk.appOrigin && !bk.initLoading ? `<div class="bk-warn">Could not detect Medicus — open a Medicus tab and sign in.</div>` : ''}
      ${!bk.patientId && !bk.initLoading ? `<div class="bk-warn">No patient record open — navigate to a patient in Medicus first.</div>` : ''}
      <div class="bk-row">
        <label class="bk-label" for="bkType">Type</label>
        <select class="bk-select" id="bkType"${bk.types.length === 0 ? ' disabled' : ''}>
          <option value="">— pick type —</option>
          ${typesHtml}
        </select>
      </div>
      <div class="bk-row">
        <label class="bk-label" for="bkDate">Date</label>
        <input type="date" class="date-input bk-date-input" id="bkDate" value="${escHtml(bkDate)}" max="2099-12-31" />
      </div>
      <button class="bk-action-btn" id="bkSearch"${canSearch ? '' : ' disabled'}>Find slots</button>
      ${slotsHtml}
    </div>
  `;
}

function renderSlotRow(slot, idx) {
  const time = escHtml(slot.start || slot.startDateTime?.substring(11, 16) || '');
  const end = escHtml(slot.end || slot.endDateTime?.substring(11, 16) || '');
  const duration = escHtml(slot.formattedDuration || `${slot.duration} mins`);
  const site = escHtml(slot.siteName || '');
  const type = escHtml(slot.appointmentType?.name || '');
  return `
    <button class="bk-slot-row" data-slot-idx="${idx}">
      <span class="bk-slot-time">${time}${end ? `–${end}` : ''}</span>
      <span class="bk-slot-meta">
        ${site ? `<span class="bk-slot-site">${site}</span>` : ''}
        ${type ? `<span class="bk-slot-type">${type}</span>` : ''}
      </span>
      <span class="bk-slot-dur">${duration}</span>
    </button>
  `;
}

function renderBookingConfirm() {
  const { bk } = state;
  const slot = bk.selectedSlot;
  if (!slot) return '';
  const time = escHtml(slot.start || slot.startDateTime?.substring(11, 16) || '');
  const end = escHtml(slot.end || slot.endDateTime?.substring(11, 16) || '');
  const duration = escHtml(slot.formattedDuration || `${slot.duration} mins`);
  const site = escHtml(slot.siteName || '');
  const type = escHtml(slot.appointmentType?.name || '');
  const dateStr = escHtml(formatDate(bk.date || todayISO()));
  return `
    <div class="bk-confirm">
      <div class="bk-confirm-summary">
        <div class="bk-confirm-row"><span class="bk-confirm-label">Date</span><span>${dateStr}</span></div>
        <div class="bk-confirm-row"><span class="bk-confirm-label">Time</span><span>${time}${end ? `–${end}` : ''} (${duration})</span></div>
        ${site ? `<div class="bk-confirm-row"><span class="bk-confirm-label">Site</span><span>${site}</span></div>` : ''}
        ${type ? `<div class="bk-confirm-row"><span class="bk-confirm-label">Type</span><span>${type}</span></div>` : ''}
      </div>
      <div class="bk-row">
        <label class="bk-label" for="bkReason">Reason <span class="bk-optional">(opt.)</span></label>
        <input type="text" class="bk-text-input" id="bkReason" value="${escHtml(bk.reason)}" placeholder="Reason for appointment" maxlength="255" />
      </div>
      ${bk.confirmError ? `<div class="bk-error">${escHtml(bk.confirmError)}</div>` : ''}
      <div class="bk-confirm-actions">
        <button class="ghost-btn" id="bkBack"${bk.confirming ? ' disabled' : ''}>Back</button>
        <button class="bk-action-btn bk-confirm-btn" id="bkConfirm"${bk.confirming ? ' disabled' : ''}>${bk.confirming ? 'Booking…' : 'Confirm booking'}</button>
      </div>
    </div>
  `;
}

function renderBookingSuccess() {
  const { bk } = state;
  const slot = bk.selectedSlot;
  const time = slot ? escHtml(slot.start || slot.startDateTime?.substring(11, 16) || '') : '';
  const dateStr = escHtml(formatDate(bk.date || todayISO()));
  return `
    <div class="bk-success">
      <div class="bk-success-icon" aria-hidden="true">✓</div>
      <div class="bk-success-msg">Appointment booked</div>
      <div class="bk-success-detail">${dateStr}${time ? ` at ${time}` : ''}</div>
      <button class="ghost-btn bk-again-btn" id="bkAgain">Book another</button>
    </div>
  `;
}

// ── Booking actions ───────────────────────────────────────────────────────────

async function doInitBooking() {
  const { bk } = state;
  bk.initLoading = true;
  bk.initError = null;
  if (!bk.date) bk.date = todayISO();
  render();
  try {
    const detected = await detectMedicusTab();
    bk.tabId = detected?.tabId ?? null;
    bk.appOrigin = detected?.origin ?? null;
    bk.patientId = await detectPatientId(detected?.tab ?? null);
    if (!detected) {
      bk.initError = 'Could not detect Medicus — open a Medicus tab and sign in.';
      return;
    }
    const finder = await fetchAppointmentFinder(bk.tabId, bk.appOrigin);
    bk.providerId = finder.localOrganisationDetails?.id || null;
    const types = [];
    for (const svc of finder.localOrganisationDetails?.services || []) {
      for (const t of svc.appointmentTypes || []) {
        if (!types.some((e) => e.value === t.value)) types.push({ value: t.value, label: t.label });
      }
    }
    bk.types = types;
    if (types.length === 1) bk.selectedTypeId = types[0].value;
  } catch (err) {
    bk.initError = err.message || 'Failed to load appointment types.';
  } finally {
    bk.initLoading = false;
    render();
  }
}

async function doSearchSlots() {
  const { bk } = state;
  if (!bk.appOrigin || !bk.providerId || !bk.selectedTypeId || !bk.date) return;
  bk.slotsLoading = true;
  bk.slotsError = null;
  bk.slots = null;
  bk.hasSearched = false;
  render();
  try {
    bk.slots = await fetchAvailableSlots(bk.tabId, bk.appOrigin, {
      providerId: bk.providerId,
      appointmentTypeId: bk.selectedTypeId,
      date: bk.date,
    });
  } catch (err) {
    bk.slotsError = err.message || 'Failed to fetch available slots.';
    bk.slots = null;
  } finally {
    bk.hasSearched = true;
    bk.slotsLoading = false;
    render();
  }
}

async function doSelectSlot(slot) {
  const { bk } = state;
  if (!bk.appOrigin || !slot) return;
  bk.slotsLoading = true;
  bk.slotsError = null;
  render();
  try {
    const result = await reserveSlot(bk.tabId, bk.appOrigin, {
      diaryId: slot.diaryId,
      startDateTime: slot.startDateTime,
      duration: slot.duration,
      appointmentTypeId: slot.appointmentType?.id,
    });
    bk.reservationId = result.slotReservationId;
    bk.selectedSlot = slot;
    bk.step = 'confirm';
    bk.confirmError = null;
    bk.reason = '';
  } catch (err) {
    bk.slotsError = err.message || 'Could not reserve slot — it may have just been taken.';
  } finally {
    bk.slotsLoading = false;
    render();
  }
}

function doCancelBooking() {
  const { bk } = state;
  if (bk.reservationId && bk.appOrigin) {
    releaseReservation(bk.tabId, bk.appOrigin, bk.reservationId).catch(() => {});
  }
  bk.reservationId = null;
  bk.selectedSlot = null;
  bk.step = 'browse';
  bk.confirmError = null;
  bk.formData = null;
  render();
}

async function doConfirmBooking() {
  const { bk } = state;
  if (bk.confirming || !bk.reservationId || !bk.patientId || !bk.selectedSlot) return;
  bk.confirming = true;
  bk.confirmError = null;
  render();
  try {
    const formData = await fetchCreateForm(bk.tabId, bk.appOrigin, {
      slotReservationId: bk.reservationId,
      patientId: bk.patientId,
    });
    bk.formData = formData;
    const slot = bk.selectedSlot;
    const payload = {
      context: 'create-booked-appointment',
      appointmentTemporalType: 'timed',
      appointmentTypeId: slot.appointmentType?.id,
      patientId: bk.patientId,
      deliveryMode: formData.deliveryMode || slot.defaultDeliveryMode?.value || 'face-to-face',
      intendedDuration: slot.duration,
      diaryId: slot.diaryId,
      isHighPriority: false,
      isHiddenFromPatientFacingServices: false,
      intendedStartDateTime: slot.startDateTime,
      reasonForAppointment: bk.reason || null,
      additionalInformation: null,
      embargoOverrideReason: null,
      slotReservationId: bk.reservationId,
      nhsNationalSlotTypeCategory:
        formData.nhsNationalSlotTypeCategory ||
        slot.nhsNationalSlotTypeCategoryDefault?.value ||
        '10127',
      allowOverlappingAppointments: 'allow',
      gpadReportingExceptionReasons: [],
      clinicalCaseId: null,
      bookingConfirmationRecipients: (formData.bookingConfirmationRecipientOptions || []).map(
        (o) => o.value
      ),
      rescheduledAppointmentVersionId: null,
    };
    const result = await createAppointment(bk.tabId, bk.appOrigin, payload);
    bk.bookedId = result.appointmentId;
    bk.reservationId = null; // server releases on create
    bk.step = 'booked';
  } catch (err) {
    bk.confirmError = err.message || 'Booking failed — please try again.';
  } finally {
    bk.confirming = false;
    render();
  }
}

function resetBookingToSlots() {
  const { bk } = state;
  bk.step = 'browse';
  bk.selectedSlot = null;
  bk.reservationId = null;
  bk.formData = null;
  bk.bookedId = null;
  bk.confirmError = null;
  bk.hasSearched = false;
  bk.slots = null;
  bk.slotsError = null;
  render();
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindEvents() {
  if (!container) return;

  container.querySelector('.setup-now-btn')?.addEventListener('click', () => {
    if (document.getElementById('setupHost')) {
      document.dispatchEvent(new CustomEvent('suite:open-setup'));
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sect-suite') });
    }
  });

  container.querySelector('#refreshSlots')?.addEventListener('click', () => fetchAndRender());

  container.querySelector('#slotsCsvBtn')?.addEventListener('click', () => {
    const d = state.data;
    if (!d) return;
    const header = ['Clinician', 'Appointment type', 'Slots'];
    const rows = [];
    for (const s of d.byStaff) {
      for (const [type, n] of Object.entries(s.byType)) {
        rows.push([s.name, type, sumAmPm(n)]);
      }
    }
    for (const [type, n] of Object.entries(d.byType)) {
      rows.push(['All clinicians', type, sumAmPm(n)]);
    }
    downloadCsv(`slots-${state.date}.csv`, header, rows);
  });

  container.querySelector('#slotsDate')?.addEventListener('change', (e) => {
    state.date = e.target.value;
    fetchAndRender();
  });

  container.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.date = btn.dataset.date;
      fetchAndRender();
    });
  });

  // Edit thresholds deep-link button in alert ribbon
  container.querySelector('#slotsRibbonEdit')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sect-slots') });
  });

  container.querySelector('#excludedToggle')?.addEventListener('click', () => {
    state.showExcluded = !state.showExcluded;
    saveUiState('slots', {
      hiddenTypes: [...state.hiddenTypes],
      showExcluded: state.showExcluded,
      expanded: [...state.expanded],
      typesOpen: state.typesOpen,
    });
    render();
  });

  // Persist the by-type details open/closed state
  container.querySelector('.slot-types-details')?.addEventListener('toggle', (e) => {
    state.typesOpen = e.target.open;
    saveUiState('slots', {
      hiddenTypes: [...state.hiddenTypes],
      showExcluded: state.showExcluded,
      expanded: [...state.expanded],
      typesOpen: state.typesOpen,
    });
  });

  container.querySelectorAll('.type-toggle').forEach((cb) => {
    cb.addEventListener('change', () => {
      const type = cb.dataset.type;
      if (cb.checked) state.hiddenTypes.delete(type);
      else state.hiddenTypes.add(type);
      chrome.storage.local.set({ 'slots.hiddenTypes': [...state.hiddenTypes] });
      saveUiState('slots', {
        hiddenTypes: [...state.hiddenTypes],
        showExcluded: state.showExcluded,
        expanded: [...state.expanded],
        typesOpen: state.typesOpen,
      });
      render();
    });
  });

  // Pill organise mode: toggle, drag-to-reorder, colour palette
  container.querySelector('#pillOrganiseBtn')?.addEventListener('click', () => {
    state.organisePills = !state.organisePills;
    state.openColourFor = null;
    render();
  });

  if (state.organisePills) {
    const pillRow = container.querySelector('#pillRow');
    let dragSrc = null;

    const persistOrderFromDom = () => {
      if (!pillRow) return;
      state.pillPrefs = {
        ...state.pillPrefs,
        order: [...pillRow.querySelectorAll('.slot-pill[data-pill-type]')].map((p) => p.dataset.pillType),
      };
      savePillPrefs(); // storage echo re-renders via onStorageChange
    };

    container.querySelectorAll('.slot-pill[data-pill-type]').forEach((pill) => {
      pill.addEventListener('click', () => {
        if (dragSrc) return; // a drag that ends on the source still fires click
        const t = pill.dataset.pillType;
        state.openColourFor = state.openColourFor === t ? null : t;
        render();
      });

      // Keyboard: Enter/Space toggles colour palette; ArrowLeft/Right reorders
      pill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const t = pill.dataset.pillType;
          state.openColourFor = state.openColourFor === t ? null : t;
          render();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const pillType = pill.dataset.pillType;
          const sibling = e.key === 'ArrowLeft' ? pill.previousElementSibling : pill.nextElementSibling;
          if (sibling && sibling.classList.contains('slot-pill')) {
            if (e.key === 'ArrowLeft') {
              pillRow.insertBefore(pill, sibling);
            } else {
              pillRow.insertBefore(sibling, pill);
            }
            persistOrderFromDom();
            // Re-query after re-render (triggered by persistOrderFromDom) and restore focus
            requestAnimationFrame(() => {
              const refocused = container.querySelector(`.slot-pill[data-pill-type="${CSS.escape(pillType)}"]`);
              refocused?.focus();
            });
          }
        }
      });

      pill.addEventListener('dragstart', (e) => {
        dragSrc = pill;
        pill.classList.add('pill-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', pill.dataset.pillType);
        } catch (_) {
          /* some browsers require setData for the drag to start */
        }
      });
      pill.addEventListener('dragend', () => {
        pill.classList.remove('pill-dragging');
        setTimeout(() => {
          dragSrc = null;
        }, 0);
      });
      pill.addEventListener('dragover', (e) => {
        if (!dragSrc || dragSrc === pill) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = pill.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        pillRow.insertBefore(dragSrc, after ? pill.nextSibling : pill);
      });
      pill.addEventListener('drop', (e) => {
        e.preventDefault();
        persistOrderFromDom();
      });
    });
    pillRow?.addEventListener('dragover', (e) => e.preventDefault());
    pillRow?.addEventListener('drop', (e) => {
      e.preventDefault();
      persistOrderFromDom();
    });

    container.querySelectorAll('.pill-swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        if (!state.openColourFor) return;
        const k = sw.dataset.swatch;
        const colours = { ...state.pillPrefs.colours };
        if (k === 'default') delete colours[state.openColourFor];
        else colours[state.openColourFor] = k;
        state.pillPrefs = { ...state.pillPrefs, colours };
        savePillPrefs();
        render();
      });
    });
  }

  container.querySelectorAll('.staff-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.staff;
      if (state.expanded.has(name)) state.expanded.delete(name);
      else state.expanded.add(name);
      saveUiState('slots', {
        hiddenTypes: [...state.hiddenTypes],
        showExcluded: state.showExcluded,
        expanded: [...state.expanded],
        typesOpen: state.typesOpen,
      });
      render();
    });
  });

  // ── Booking panel events ──────────────────────────────────────────────────

  container.querySelector('#bkToggle')?.addEventListener('click', () => {
    const { bk } = state;
    if (bk.open) {
      // Closing — release any held reservation
      if (bk.reservationId && bk.appOrigin) {
        releaseReservation(bk.tabId, bk.appOrigin, bk.reservationId).catch(() => {});
        bk.reservationId = null;
      }
      if (bk.step === 'confirm') {
        bk.step = 'browse';
        bk.selectedSlot = null;
      }
    }
    bk.open = !bk.open;
    if (bk.open && !bk.appOrigin && !bk.initLoading) {
      doInitBooking();
    } else {
      render();
    }
  });

  container.querySelector('#bkType')?.addEventListener('change', (e) => {
    state.bk.selectedTypeId = e.target.value;
    state.bk.hasSearched = false;
    state.bk.slots = null;
    state.bk.slotsError = null;
    render();
  });

  container.querySelector('#bkDate')?.addEventListener('change', (e) => {
    state.bk.date = e.target.value;
    state.bk.hasSearched = false;
    state.bk.slots = null;
    state.bk.slotsError = null;
    render();
  });

  container.querySelector('#bkSearch')?.addEventListener('click', () => doSearchSlots());

  container.querySelectorAll('.bk-slot-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.slotIdx, 10);
      const slot = state.bk.slots?.[idx];
      if (slot) doSelectSlot(slot);
    });
  });

  container.querySelector('#bkBack')?.addEventListener('click', () => doCancelBooking());

  container.querySelector('#bkReason')?.addEventListener('input', (e) => {
    state.bk.reason = e.target.value;
  });

  container.querySelector('#bkConfirm')?.addEventListener('click', () => doConfirmBooking());

  container.querySelector('#bkAgain')?.addEventListener('click', () => resetBookingToSlots());
}
