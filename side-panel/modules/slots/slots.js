// Medicus Suite — Slot Counter module v2.2
// API-based replacement for the DOM-scraping slot counter.
// Endpoint: GET https://{siteId}.api.england.medicus.health/scheduling/data/appointment-book/embedded-overview
// Available slots: entries where diaryEntryType.value === 'slot'

'use strict';

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
};

let container = null;

// ── Init ──────────────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;

  // Load persisted hidden types and practice code
  const stored = await chrome.storage.local.get(['slots.hiddenTypes', 'suite.practiceCode']);
  if (stored['slots.hiddenTypes']) state.hiddenTypes = new Set(stored['slots.hiddenTypes']);
  if (stored['suite.practiceCode']) {
    SITE_ID = stored['suite.practiceCode'];
    API_BASE = `https://${SITE_ID}.api.england.medicus.health`;
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
      if (resp.status === 401 || resp.status === 403) throw new Error('Not signed in to Medicus. Open Medicus in a tab and sign in.');
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
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function aggregate(raw, forDate) {
  const byType = {};
  const byStaff = [];
  let total = 0;

  // For today, filter to slots that haven't started yet
  const isToday = forDate === todayISO();
  const now = new Date();

  (raw.staffSchedules || []).forEach(staff => {
    let staffTotal = 0;
    const staffByType = {};

    (staff.schedule || []).forEach(session => {
      (session.entries || []).forEach(entry => {
        if (entry.diaryEntryType?.value !== 'slot') return;

        // Time filter for today: skip slots whose start is in the past
        if (isToday && entry.startDateTime) {
          const slotTime = new Date(entry.startDateTime);
          if (slotTime < now) return;
        }

        const type = entry.appointmentType?.name || 'Unknown';
        byType[type] = (byType[type] || 0) + 1;
        staffByType[type] = (staffByType[type] || 0) + 1;
        staffTotal++;
        total++;
      });
    });

    if (staffTotal > 0) {
      byStaff.push({ name: staff.name || 'Unknown', total: staffTotal, byType: staffByType });
    }
  });

  byStaff.sort((a, b) => a.name.localeCompare(b.name));
  return { total, byType, byStaff, isToday };
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

function pad(n) { return String(n).padStart(2, '0'); }

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === nextWorkingDayISO()) return 'Next working day';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function visibleTotal(byType, hiddenTypes) {
  return Object.entries(byType).reduce((sum, [type, n]) => hiddenTypes.has(type) ? sum : sum + n, 0);
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (!container) return;

  const d = state.data;
  const visible = d ? visibleTotal(d.byType, state.hiddenTypes) : 0;

  // Dispatch count for nav badge
  const _visible = state.data ? visibleTotal(state.data.byType, state.hiddenTypes) : 0;
  document.dispatchEvent(new CustomEvent('suite:slots:count', { detail: { count: state.loading ? null : _visible } }));

  container.innerHTML = `
    <div class="module-wrap slots-module">
      ${renderHeader(visible)}
      <div id="slotsBanner" class="banner${state.error ? '' : ' hidden'}">
        ${escHtml(state.error || '')}
      </div>
      ${state.loading ? renderSkeleton() : (d ? renderData(d, visible) : '')}
      <div class="foot">${state.lastFetched ? `Updated ${state.lastFetched.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</div>
    </div>
  `;

  bindEvents();
}

function renderHeader(visible) {
  const isToday = state.data?.isToday;
  return `
    <div class="mod-header">
      <div>
        <div class="mod-eyebrow">Appointment Book · ${escHtml(formatDate(state.date))}</div>
        ${!state.loading ? `
          <div class="slots-count-hero">${visible}</div>
          <div class="slots-count-label${visible===0?' zero':''}">
            ${isToday ? 'slots remaining today' : 'available slots'}
          </div>` : `<div class="mod-title" style="margin:6px 0 10px">Loading…</div>`}
      </div>
      <div class="header-actions" style="align-self:flex-start;margin-top:2px">
        <input type="date" id="slotsDate" value="${state.date}" max="2099-12-31" class="date-input" />
        <button class="ghost-btn" id="refreshSlots" title="Refresh">↻</button>
      </div>
    </div>
    <div class="date-presets">
      <button class="preset-btn${state.date === todayISO() ? ' active' : ''}" data-date="${todayISO()}">Today</button>
      <button class="preset-btn${state.date === nextWorkingDayISO() ? ' active' : ''}" data-date="${nextWorkingDayISO()}">Next working day</button>
    </div>
  `;
}

function renderSkeleton() {
  return `<div class="skeleton-list">${Array(5).fill('<div class="skel-row"></div>').join('')}</div>`;
}

function renderData(d, visible) {
  if (!d.byType || Object.keys(d.byType).length === 0) {
    return `<div class="empty-state">No sessions found for ${escHtml(formatDate(state.date))}.</div>`;
  }

  const entries = Object.entries(d.byType).sort((a, b) => b[1] - a[1]);
  const ticked   = entries.filter(([t]) => !state.hiddenTypes.has(t));
  const unticked = entries.filter(([t]) =>  state.hiddenTypes.has(t));
  const showExcluded = state.showExcluded || false;

  const row = (type, count, hidden) => `
    <div class="slot-row${hidden ? ' row-hidden' : ''}">
      <label class="slot-label">
        <input type="checkbox" class="type-toggle" data-type="${escHtml(type)}" ${hidden ? '' : 'checked'} />
        <span class="slot-type">${escHtml(type)}</span>
      </label>
      <span class="slot-count${count === 0 ? ' zero' : ''}">${count}</span>
    </div>
  `;

  const excludedSection = unticked.length === 0 ? '' : `
    <div class="excluded-toggle" id="excludedToggle">
      <span>${showExcluded ? '▾' : '▸'}</span>
      <span>${unticked.length} excluded type${unticked.length !== 1 ? 's' : ''}</span>
    </div>
    ${showExcluded ? `<div class="excluded-list">${unticked.map(([t,n]) => row(t, n, true)).join('')}</div>` : ''}
  `;

  const staffRows = d.byStaff.map(s => {
    const isExpanded = state.expanded.has(s.name);
    const staffVisible = visibleTotal(s.byType, state.hiddenTypes);
    return `
      <div class="staff-row">
        <button class="staff-toggle" data-staff="${escHtml(s.name)}">
          <span class="staff-chevron">${isExpanded ? '▾' : '▸'}</span>
          <span class="staff-name">${escHtml(s.name)}</span>
          <span class="staff-count">${staffVisible}</span>
        </button>
        ${isExpanded ? `<div class="staff-detail">
          ${Object.entries(s.byType)
            .filter(([t]) => !state.hiddenTypes.has(t))
            .sort((a,b) => b[1]-a[1])
            .map(([t,n]) => `<div class="staff-type-row"><span>${escHtml(t)}</span><span>${n}</span></div>`)
            .join('')}
        </div>` : ''}
      </div>
    `;
  }).join('');

  return `
    <section class="slots-section">
      <div class="section-label">By type</div>
      <div class="slot-list">
        ${ticked.map(([t,n]) => row(t, n, false)).join('')}
        ${excludedSection}
      </div>
      <div class="section-hint">Untick a type to exclude it from the total.</div>
    </section>

    ${d.byStaff.length > 0 ? `
    <section class="slots-section">
      <div class="section-label">By clinician</div>
      <div class="staff-list">${staffRows}</div>
    </section>` : ''}
  `;
}

// ── Event binding ─────────────────────────────────────────────────────────────

function bindEvents() {
  if (!container) return;

  container.querySelector('#refreshSlots')?.addEventListener('click', () => fetchAndRender());

  container.querySelector('#slotsDate')?.addEventListener('change', e => {
    state.date = e.target.value;
    fetchAndRender();
  });

  container.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.date = btn.dataset.date;
      fetchAndRender();
    });
  });

  container.querySelector('#excludedToggle')?.addEventListener('click', () => {
    state.showExcluded = !state.showExcluded;
    render();
  });

  container.querySelectorAll('.type-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      const type = cb.dataset.type;
      if (cb.checked) state.hiddenTypes.delete(type);
      else state.hiddenTypes.add(type);
      chrome.storage.local.set({ 'slots.hiddenTypes': [...state.hiddenTypes] });
      render();
    });
  });

  container.querySelectorAll('.staff-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.staff;
      if (state.expanded.has(name)) state.expanded.delete(name);
      else state.expanded.add(name);
      render();
    });
  });
}
