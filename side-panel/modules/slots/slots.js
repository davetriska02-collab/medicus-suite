// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Slot Counter module v2.2
// API-based replacement for the DOM-scraping slot counter.
// Endpoint: GET https://{siteId}.api.england.medicus.health/scheduling/data/appointment-book/embedded-overview
// Available slots: entries where diaryEntryType.value === 'slot'

'use strict';

import { loadUiState, saveUiState } from '../shared/ui-state.js';

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
};

let container = null;
let _inFlight = false;

// ── Init ──────────────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;

  // Load persisted hidden types, alert rules, and practice code
  const stored = await chrome.storage.local.get(['slots.hiddenTypes', 'slots.alertRules', 'suite.practiceCode']);
  if (stored['slots.hiddenTypes']) state.hiddenTypes = new Set(stored['slots.hiddenTypes']);
  if (stored['slots.alertRules']) state.alertRules = stored['slots.alertRules'];
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
  }

  render();
  fetchAndRender();

  // Listen for Pusher-triggered refresh from service worker
  document.addEventListener('suite:slots:refresh', onRefresh);

  // Listen for storage changes (hidden types toggled)
  chrome.storage.onChanged.addListener(onStorageChange);

  // Return cleanup
  return () => {
    document.removeEventListener('suite:slots:refresh', onRefresh);
    chrome.storage.onChanged.removeListener(onStorageChange);
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
      ${renderHeader(visible, visibleSum)}
      <div id="slotsBanner" class="banner${state.error ? '' : ' hidden'}">
        ${escHtml(state.error || '')}
        ${state.error && state.error.startsWith('No practice code') ? ' <button class="ghost-btn setup-now-btn">Set up now</button>' : ''}
      </div>
      ${!state.loading && d ? renderAlertRibbon(d.byType) : ''}
      ${state.loading ? renderSkeleton() : d ? renderData(d, visible, visibleSum) : ''}
      <div class="foot">${state.lastFetched ? `Updated ${state.lastFetched.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
    </div>
  `;

  bindEvents();
}

function renderHeader(visible, visibleSum) {
  return `
    <div class="mod-header">
      <div>
        <div class="mod-eyebrow">Appointment Book · ${escHtml(formatDate(state.date))}</div>
        ${state.loading ? `<div class="mod-title" style="margin:6px 0 10px">Loading…</div>` : ''}
      </div>
      <div class="header-actions" style="align-self:flex-start;margin-top:2px">
        <input type="date" id="slotsDate" value="${state.date}" max="2099-12-31" class="date-input" />
        <button class="ghost-btn" id="refreshSlots" title="Refresh">↻</button>
      </div>
    </div>
    ${!state.loading && state.data ? renderHeroCard(visible, visibleSum) : ''}
    <div class="date-presets">
      <button class="preset-btn${state.date === todayISO() ? ' active' : ''}" data-date="${todayISO()}">Today</button>
      <button class="preset-btn${state.date === nextWorkingDayISO() ? ' active' : ''}" data-date="${nextWorkingDayISO()}">Next working day</button>
    </div>
  `;
}

// Hero card: headline total, AM/PM chips, a proportional AM|PM split bar, and
// the per-type pill row. The label inherits the alert state (green when calm,
// amber/red when any slot-alert rule has tripped) so the headline is a signal,
// not a decoration.
function renderHeroCard(visible, visibleSum) {
  const d = state.data;
  const isToday = d.isToday;
  const level = overallAlertLevel(d.byType);
  const labelCls = visibleSum === 0 ? ' zero' : level ? ` ${level}` : '';

  const amPct = visibleSum > 0 ? Math.round((visible.am / visibleSum) * 100) : 0;
  const splitBar =
    visibleSum > 0
      ? `<div class="slots-split-bar" title="AM ${visible.am} · PM ${visible.pm}" aria-hidden="true">
           <span class="split-am" style="width:${amPct}%"></span><span class="split-pm" style="width:${100 - amPct}%"></span>
         </div>`
      : '';

  return `
    <div class="slots-hero-card">
      <div class="slots-hero-main">
        <div class="slots-count-hero">${visibleSum.toLocaleString('en-GB')}</div>
        <div class="slots-hero-right">
          <div class="slots-count-label${labelCls}">${isToday ? 'slots remaining today' : 'available slots'}</div>
          <div class="slots-ampm-split">
            <span class="ampm-chip ampm-am"><span class="ampm-tag">AM</span><span class="ampm-num">${visible.am.toLocaleString('en-GB')}</span></span>
            <span class="ampm-chip ampm-pm"><span class="ampm-tag">PM</span><span class="ampm-num">${visible.pm.toLocaleString('en-GB')}</span></span>
          </div>
        </div>
      </div>
      ${splitBar}
      ${renderTypePills(d.byType, visibleSum)}
    </div>
  `;
}

// One pill per included type, biggest first: dot + name + count. The dot is
// slate when calm and goes amber/red when that type is at/below its configured
// alert threshold — colour carries signal, never decoration.
function renderTypePills(byType, visibleSum) {
  const entries = Object.entries(byType)
    .filter(([t]) => !state.hiddenTypes.has(t))
    .sort((a, b) => sumAmPm(b[1]) - sumAmPm(a[1]));
  if (entries.length === 0 || visibleSum === 0) return '';

  const pills = entries
    .map(([type, n]) => {
      const total = sumAmPm(n);
      const level = typeAlertLevel(type, total);
      const cls = level ? ` pill-${level}` : total === 0 ? ' pill-zero' : '';
      const title = `${escHtml(type)} — ${n.am} am · ${n.pm} pm${level ? ' · below alert threshold' : ''}`;
      return `<span class="slot-pill${cls}" title="${title}">
        <span class="slot-pill-dot" aria-hidden="true"></span>
        <span class="slot-pill-name">${escHtml(type)}</span>
        <span class="slot-pill-num">${total.toLocaleString('en-GB')}</span>
      </span>`;
    })
    .join('');

  return `<div class="slots-pill-row">${pills}</div>`;
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
  const icon = topLevel === 'red' ? '⛔' : '⚠';
  const items = triggered
    .map((t) => {
      const msg =
        t.count === 0
          ? `No ${escHtml(t.typeName)} slots`
          : `${escHtml(t.typeName)}: <span class="slots-alert-count">${t.count.toLocaleString('en-GB')}</span> slot${t.count !== 1 ? 's' : ''} remaining`;
      return `<div class="slots-alert-item">${msg}</div>`;
    })
    .join('');
  return `
    <div class="slots-alert-ribbon slots-alert-ribbon-${topLevel}">
      <span class="slots-alert-icon">${icon}</span>
      <div class="slots-alert-items">${items}</div>
    </div>
  `;
}

function renderSkeleton() {
  return `<div class="skeleton-list">${Array(5).fill('<div class="skel-row"></div>').join('')}</div>`;
}

function renderData(d, visible, visibleSum) {
  if (!d.byType || Object.keys(d.byType).length === 0) {
    return `<div class="empty-state">No sessions found for ${escHtml(formatDate(state.date))}.</div>`;
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
        <span class="slot-count slot-count-total">${total}</span>
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
    <div class="excluded-toggle" id="excludedToggle">
      <span>${showExcluded ? '▾' : '▸'}</span>
      <span>${unticked.length} excluded type${unticked.length !== 1 ? 's' : ''}</span>
    </div>
    ${showExcluded ? `<div class="excluded-list">${unticked.map(([t, n]) => row(t, n, true)).join('')}</div>` : ''}
  `;

  const staffRows = d.byStaff
    .map((s) => {
      const isExpanded = state.expanded.has(s.name);
      const staffVisible = visibleTotal(s.byType, state.hiddenTypes);
      const staffSum = sumAmPm(staffVisible);
      return `
      <div class="staff-row">
        <button class="staff-toggle" data-staff="${escHtml(s.name)}">
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
      <div class="section-label">By type</div>
      <div class="slot-list">
        ${ticked.map(([t, n]) => row(t, n, false)).join('')}
        ${excludedSection}
      </div>
      <div class="section-hint">Untick a type to exclude it from the total.</div>
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

  container.querySelector('#excludedToggle')?.addEventListener('click', () => {
    state.showExcluded = !state.showExcluded;
    saveUiState('slots', {
      hiddenTypes: [...state.hiddenTypes],
      showExcluded: state.showExcluded,
      expanded: [...state.expanded],
    });
    render();
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
      });
      render();
    });
  });

  container.querySelectorAll('.staff-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.staff;
      if (state.expanded.has(name)) state.expanded.delete(name);
      else state.expanded.add(name);
      saveUiState('slots', {
        hiddenTypes: [...state.hiddenTypes],
        showExcluded: state.showExcluded,
        expanded: [...state.expanded],
      });
      render();
    });
  });
}
