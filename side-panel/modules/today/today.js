// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Today module (morning command centre)
//
// Four data cards + one action card give a single-glance answer to
// "what does today look like?" before clinic starts.
//
//  1. Waiting Room  — arrived patients, max wait (amber ≥10, red ≥20). Poll 30s.
//  2. Triage Load   — RequestMonitor bucket counts as pills. Poll 60s.
//  3. Demand Today  — medical + admin submission counts with threshold washes. Poll 60s.
//  4. Slots Today   — available slots for today (lean local fetch). Poll 60s.
//  5. Morning Sweep — reads sweep.lastRun (TTL 2h); shows status + Open Sweep button.
//
// No new chrome.storage keys — read-only consumers of keys owned by other modules.

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const WR_POLL_MS = 30 * 1000;
const DEMAND_POLL_MS = 60 * 1000;
const SWEEP_LAST_RUN_TTL_MS = 2 * 60 * 60 * 1000;

const DEFAULT_SUB_THRESHOLDS = {
  medical: { amber: 30, red: 60, enabled: false },
  admin: { amber: 20, red: 40, enabled: false },
};

// ── Module state ──────────────────────────────────────────────────────────────

let container = null;
let _timers = [];

// Card-level data state
let _wrData = null; // { patients: [], error: null }
let _rmData = null; // { buckets: {}, configured: bool, error: null }
let _demandData = null; // { medical: n, admin: n, thresholds: {}, error: null }
let _slotsData = null; // { count: n, error: null }
let _sweepData = null; // { lastRun: obj|null }
let _alertsData = null; // [{ ts, channel, level, label }, ...]

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function navTo(module) {
  document.querySelector(`.nav-tab[data-module="${module}"]`)?.click();
}

function openSetup() {
  if (document.getElementById('setupHost')) {
    document.dispatchEvent(new CustomEvent('suite:open-setup'));
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sect-suite') });
  }
}

// Decision F: human-readable error copy, raw message preserved in title attr
function errMsg(raw) {
  const human = 'Couldn’t reach Medicus — retrying automatically';
  const glyph = `<svg class="today-error-glyph" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="3" x2="5" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="7.2" r="0.7" fill="currentColor"/></svg>`;
  return `<span class="today-card-error" title="${esc(raw)}">${glyph}<span class="today-card-error-copy">${esc(human)}</span></span>`;
}

function errMsgInline(raw) {
  const human = 'Couldn’t reach Medicus — retrying automatically';
  const glyph = `<svg class="today-error-glyph" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="3" x2="5" y2="5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="7.2" r="0.7" fill="currentColor"/></svg>`;
  return `<span class="today-card-error today-card-error--inline" title="${esc(raw)}">${glyph}<span class="today-card-error-copy">${esc(human)}</span></span>`;
}

// ── Fetch: Waiting Room ────────────────────────────────────────────────────────

async function fetchWr() {
  if (document.visibilityState !== 'visible') return;
  try {
    const { code, source } = await window.PracticeCode.resolve();
    if (!code) {
      _wrData = { patients: [], error: null, noCode: true };
      renderCard('wr');
      return;
    }
    const url = `https://${code}.api.england.medicus.health/scheduling/data/homepage/my-appointments`;
    const r = await window.ApiDiag.fetch({ module: 'today-wr', url, code, codeSource: source });
    const raw = await r.json();
    const now = Date.now();
    const patients = (raw?.schedule?.schedule ?? [])
      .flatMap((d) => d.entries ?? [])
      .filter((e) => e?.diaryEntryType?.value === 'appointment' && e?.displayStatus?.value === 'arrived')
      .map((e) => {
        const ms = e.startDateTime ? new Date(e.startDateTime).getTime() : null;
        const mins = ms && !isNaN(ms) ? Math.max(0, Math.round((now - ms) / 60000)) : null;
        return { name: e.patient?.name ?? 'Unknown', mins };
      })
      .sort((a, b) => (b.mins ?? 0) - (a.mins ?? 0));
    _wrData = { patients, error: null };
  } catch (e) {
    _wrData = { patients: [], error: e.message || 'Fetch failed' };
  }
  renderCard('wr');
}

// ── Fetch: Triage / Request Monitor ───────────────────────────────────────────

async function fetchRm() {
  if (document.visibilityState !== 'visible') return;
  try {
    if (!window.RequestMonitor) {
      _rmData = { configured: false, error: null };
      renderCard('rm');
      return;
    }
    const cfg = await window.RequestMonitor.getConfig();
    if (!cfg.enabled || !cfg.assigneeId) {
      _rmData = { configured: false, error: null };
      renderCard('rm');
      return;
    }
    const { code, source } = await window.PracticeCode.resolve();
    if (!code) {
      _rmData = { configured: true, buckets: {}, error: 'No practice code' };
      renderCard('rm');
      return;
    }
    const result = await window.RequestMonitor.pollAll(code, cfg.assigneeId, {
      fetch: (url, init) => window.ApiDiag.fetch({ module: 'today-rm', url, code, codeSource: source, init }),
    });
    _rmData = { configured: true, buckets: result.buckets || {}, error: result.error || null };
  } catch (e) {
    _rmData = { configured: true, buckets: {}, error: e.message || 'Fetch failed' };
  }
  renderCard('rm');
}

// ── Fetch: Demand Today ────────────────────────────────────────────────────────

async function fetchDemand() {
  if (document.visibilityState !== 'visible') return;
  try {
    const stored = await chrome.storage.local.get('submissions.thresholds');
    const thresholds = { ...DEFAULT_SUB_THRESHOLDS, ...(stored['submissions.thresholds'] || {}) };
    const { code, source } = await window.PracticeCode.resolve();
    if (!code) {
      _demandData = { medical: null, admin: null, thresholds, error: null, noCode: true };
      renderCard('demand');
      return;
    }
    const today = todayISO();
    const [medRes, admRes] = await Promise.allSettled([
      window.ApiDiag.fetch({
        module: 'today-demand',
        url: `https://${code}.api.england.medicus.health/tasks/data/medical_patient_request_task/task-list?createdAt_startDate=${today}&createdAt_endDate=${today}`,
        code,
        codeSource: source,
      }).then((r) => r.json()),
      window.ApiDiag.fetch({
        module: 'today-demand',
        url: `https://${code}.api.england.medicus.health/tasks/data/admin_patient_request_task/task-list?createdAt_startDate=${today}&createdAt_endDate=${today}`,
        code,
        codeSource: source,
      }).then((r) => r.json()),
    ]);
    const medical = medRes.status === 'fulfilled' ? (medRes.value.tasks || []).length : null;
    const admin = admRes.status === 'fulfilled' ? (admRes.value.tasks || []).length : null;
    const error =
      medRes.status === 'rejected' || admRes.status === 'rejected'
        ? medRes.reason?.message || admRes.reason?.message || 'Fetch failed'
        : null;
    _demandData = { medical, admin, thresholds, error };
  } catch (e) {
    _demandData = {
      medical: null,
      admin: null,
      thresholds: DEFAULT_SUB_THRESHOLDS,
      error: e.message || 'Fetch failed',
    };
  }
  renderCard('demand');
}

// ── Fetch: Slots ──────────────────────────────────────────────────────────────
// Lean local implementation against the same embedded-overview endpoint as slots.js.
// Counts entries where diaryEntryType.value === 'slot' and start is not in the past.

async function fetchSlots() {
  if (document.visibilityState !== 'visible') return;
  try {
    const { code, source } = await window.PracticeCode.resolve();
    if (!code) {
      _slotsData = { count: null, error: null, noCode: true };
      renderCard('slots');
      return;
    }
    const today = todayISO();
    const url = `https://${code}.api.england.medicus.health/scheduling/data/appointment-book/embedded-overview?date=${today}&filterByUsualLocation=false`;
    const r = await window.ApiDiag.fetch({ module: 'today-slots', url, code, codeSource: source });
    const raw = await r.json();
    const now = new Date();
    let count = 0;
    for (const staff of raw.staffSchedules || []) {
      for (const session of staff.schedule || []) {
        for (const entry of session.entries || []) {
          if (entry.diaryEntryType?.value !== 'slot') continue;
          if (entry.startDateTime && new Date(entry.startDateTime) < now) continue;
          count++;
        }
      }
    }
    _slotsData = { count, error: null };
  } catch (e) {
    _slotsData = { count: null, error: e.message || 'Fetch failed' };
  }
  renderCard('slots');
}

// ── Fetch: Sweep last run ─────────────────────────────────────────────────────

async function fetchSweep() {
  try {
    const r = await chrome.storage.local.get('sweep.lastRun');
    const d = r['sweep.lastRun'];
    if (!d || typeof d !== 'object') {
      _sweepData = { lastRun: null };
    } else {
      const runAt = typeof d.runAt === 'string' ? new Date(d.runAt).getTime() : d.runAt;
      if (!runAt || Date.now() - runAt > SWEEP_LAST_RUN_TTL_MS) {
        _sweepData = { lastRun: null };
      } else {
        _sweepData = { lastRun: d };
      }
    }
  } catch (_) {
    _sweepData = { lastRun: null };
  }
  renderCard('sweep');
}

// ── Fetch: Alert log ─────────────────────────────────────────────────────────

async function fetchAlerts() {
  try {
    const r = await chrome.storage.local.get('suite.alertLog');
    const log = Array.isArray(r['suite.alertLog']) ? r['suite.alertLog'] : [];
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayEntries = log.filter((e) => e && typeof e.ts === 'number' && e.ts >= startOfDay.getTime());
    _alertsData = todayEntries.slice(0, 8);
  } catch (_) {
    _alertsData = [];
  }
  renderCard('alerts');
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderCard(which) {
  if (!container) return;
  const el = container.querySelector(`.today-card[data-card="${which}"]`);
  if (!el) return;

  const body = el.querySelector('.today-card-body');
  if (!body) return;

  switch (which) {
    case 'wr':
      body.innerHTML = buildWrBody();
      break;
    case 'rm':
      body.innerHTML = buildRmBody();
      break;
    case 'demand':
      body.innerHTML = buildDemandBody();
      break;
    case 'slots':
      body.innerHTML = buildSlotsBody();
      break;
    case 'sweep':
      // Decision B: removed wireSwepButtons call — delegated handler is sufficient
      body.innerHTML = buildSweepBody();
      break;
    case 'alerts':
      body.innerHTML = buildAlertsBody();
      break;
  }
}

// ── Card body builders ────────────────────────────────────────────────────────

function buildWrBody() {
  if (!_wrData) return '<span class="today-loading">Loading…</span>';
  if (_wrData.noCode) return buildNoCodeMsg();
  if (_wrData.error) return errMsg(_wrData.error);

  const { patients } = _wrData;
  if (patients.length === 0) {
    return '<span class="today-empty today-empty--green">Waiting room clear ✓</span>';
  }

  const maxWait = Math.max(...patients.map((p) => p.mins ?? 0));
  const urgency = maxWait >= 20 ? 'red' : maxWait >= 10 ? 'amber' : 'green';

  // Decision G: aria-label on hero count
  const countEl = `<span class="today-hero-count today-hero-count--${urgency}" aria-label="${patients.length} patients waiting">${patients.length}</span>`;
  const waitEl = maxWait > 0 ? `<span class="today-wait today-wait--${urgency}">Max wait ${maxWait}m</span>` : '';

  const shown = patients.slice(0, 3);
  const extra = patients.length - shown.length;
  const nameChips = shown
    .map((p) => {
      const cls = (p.mins ?? 0) >= 20 ? 'today-name-chip--red' : (p.mins ?? 0) >= 10 ? 'today-name-chip--amber' : '';
      const wait = p.mins != null ? ` · ${p.mins}m` : '';
      return `<span class="today-name-chip ${cls}">${esc(p.name)}${wait}</span>`;
    })
    .join('');
  const extraChip = extra > 0 ? `<span class="today-name-chip today-name-chip--more">+${extra} more</span>` : '';

  return `
    <div class="today-hero-row">${countEl}<span class="today-hero-label">waiting</span>${waitEl}</div>
    <div class="today-name-chips">${nameChips}${extraChip}</div>
  `;
}

function buildRmBody() {
  if (!_rmData) return '<span class="today-loading">Loading…</span>';
  if (!_rmData.configured) {
    return `<span class="today-muted">Triage monitor not configured.</span>
      <a class="today-setup-link" href="#" data-action="open-setup">Set up in options →</a>`;
  }
  if (_rmData.error && !Object.keys(_rmData.buckets).length) {
    return errMsg(_rmData.error);
  }

  const buckets = window.RequestMonitor?.BUCKETS || [];
  const pills = buckets
    .map((b) => {
      const count = _rmData.buckets?.[b.key]?.count ?? 0;
      const isReply = b.status === 'reply-received';
      // Decision E: zero-state pill logic — count === 0 is always zero, else reply or new
      const cls = count === 0 ? 'today-rm-pill--zero' : isReply ? 'today-rm-pill--reply' : 'today-rm-pill--new';
      // Decision D: show b.label instead of b.short; aria-label with full context
      return `<span class="today-rm-pill ${cls}" title="${esc(b.label)}" aria-label="${esc(b.label)}: ${count}">
        <span class="today-rm-pill-label">${esc(b.label)}</span>
        <span class="today-rm-pill-count">${count}</span>
      </span>`;
    })
    .join('');

  const errLine = _rmData.error ? errMsgInline(_rmData.error) : '';

  return `<div class="today-rm-pills">${pills}</div>${errLine}`;
}

function buildDemandBody() {
  if (!_demandData) return '<span class="today-loading">Loading…</span>';
  if (_demandData.noCode) return buildNoCodeMsg();

  const { medical, admin, thresholds, error } = _demandData;

  if (error && medical == null && admin == null) {
    return errMsg(error);
  }

  function level(key, val) {
    if (val == null) return null;
    const t = { ...DEFAULT_SUB_THRESHOLDS[key], ...(thresholds[key] || {}) };
    if (!t.enabled) return null;
    if (val >= (t.red || Infinity)) return 'red';
    if (val >= (t.amber || Infinity)) return 'amber';
    return null;
  }

  const medLevel = level('medical', medical);
  const admLevel = level('admin', admin);

  const medCls = medLevel ? `today-demand-count--${medLevel}` : '';
  const admCls = admLevel ? `today-demand-count--${admLevel}` : '';

  const medVal = medical != null ? medical : '—';
  const admVal = admin != null ? admin : '—';

  // Decision J: threshold chip when level fires
  const medFlag = medLevel
    ? `<span class="today-demand-flag today-demand-flag--${medLevel}">over threshold</span>`
    : '';
  const admFlag = admLevel
    ? `<span class="today-demand-flag today-demand-flag--${admLevel}">over threshold</span>`
    : '';

  const errLine = error ? errMsgInline(error) : '';

  // Decision J: count leads, label after, chip at end
  return `
    <div class="today-demand-row">
      <span class="today-demand-count ${medCls}">${medVal}</span>
      <span class="today-demand-label">medical</span>
      ${medFlag}
    </div>
    <div class="today-demand-row">
      <span class="today-demand-count ${admCls}">${admVal}</span>
      <span class="today-demand-label">admin</span>
      ${admFlag}
    </div>
    ${errLine}
  `;
}

function buildSlotsBody() {
  if (!_slotsData) return '<span class="today-loading">Loading…</span>';
  if (_slotsData.noCode) return buildNoCodeMsg();
  if (_slotsData.error && _slotsData.count == null) {
    return errMsg(_slotsData.error);
  }

  const count = _slotsData.count ?? '—';
  const errLine = _slotsData.error ? errMsgInline(_slotsData.error) : '';

  return `
    <div class="today-hero-row">
      <span class="today-hero-count">${count}</span>
      <span class="today-hero-label">open today</span>
    </div>
    ${errLine}
  `;
}

function buildSweepBody() {
  if (!_sweepData) return '<span class="today-loading">Loading…</span>';

  const { lastRun } = _sweepData;

  if (!lastRun) {
    return `
      <span class="today-muted">No sweep run this session.</span>
      <div class="today-sweep-actions">
        <button class="today-ghost-btn" data-action="open-sweep">Run the pre-clinic sweep →</button>
      </div>
    `;
  }

  const runAtDate = new Date(lastRun.runAt);
  const timeStr = runAtDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const results = Array.isArray(lastRun.results) ? lastRun.results : [];
  const actionNeeded = results.filter(
    (r) => Array.isArray(r.chips) && r.chips.some((c) => ['overdue', 'not_met', 'alert'].includes(c.status))
  ).length;
  const selected = Array.isArray(lastRun.selectedUuids) ? lastRun.selectedUuids.length : 0;

  return `
    <div class="today-sweep-summary">
      <span class="today-sweep-time">Last sweep ${esc(timeStr)}</span>
      <span class="today-sweep-stats">${actionNeeded} action-needed · ${selected} selected</span>
    </div>
    <div class="today-sweep-actions">
      <button class="today-ghost-btn" data-action="open-sweep">Open Sweep →</button>
    </div>
  `;
}

function buildNoCodeMsg() {
  return `
    <span class="today-muted">No practice code configured.</span>
    <a class="today-setup-link" href="#" data-action="open-setup">Set up now →</a>
  `;
}

function buildAlertsBody() {
  if (!_alertsData) return '<span class="today-loading">Loading…</span>';
  if (_alertsData.length === 0) {
    return '<span class="today-empty today-empty--green">No alerts logged today</span>';
  }

  // Decision C: sub-rag returns '' so label doubling is avoided;
  // rm → 'Triage', triage → 'Triage alert' unchanged.
  function channelLabel(channel) {
    if (channel === 'rm') return 'Triage';
    if (channel === 'triage') return 'Triage alert';
    if (channel === 'sub-rag') return '';
    return channel;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const rows = _alertsData
    .map((e) => {
      const dotCls =
        e.level === 'red'
          ? 'today-alert-dot--red'
          : e.level === 'amber'
            ? 'today-alert-dot--amber'
            : 'today-alert-dot--green';
      // Decision C: omit separator when prefix is empty
      const prefix = channelLabel(e.channel);
      const labelText = prefix ? `${prefix}: ${esc(e.label)}` : esc(e.label);
      // Decision K: aria-label on dot
      return `
      <div class="today-alert-row">
        <span class="today-alert-time">${fmtTime(e.ts)}</span>
        <span class="today-alert-dot ${dotCls}" role="img" aria-label="${esc(e.level)}"></span>
        <span class="today-alert-label">${labelText}</span>
      </div>`;
    })
    .join('');

  return `<div class="today-alert-list">${rows}</div>`;
}

// ── Wire event handlers ────────────────────────────────────────────────────────

// Decision B: wireSweepButtons and wireSwepButtons alias removed entirely.
// The delegated handler in wireCardInteractions handles open-sweep.

function wireCardInteractions() {
  if (!container) return;

  // Delegated handler — works even after card bodies are re-rendered
  container.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    e.preventDefault();

    if (action === 'open-setup') openSetup();
    if (action === 'open-sweep') navTo('sweep');
  });

  // Decision A: use btn.dataset.nav (not btn.closest('.today-card')?.dataset.card)
  // Decision H: replace title with aria-label on .today-card-open
  container.querySelectorAll('.today-card-open').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mod = btn.dataset.nav;
      if (mod) navTo(mod);
    });
  });
}

// ── Full render (scaffold) ────────────────────────────────────────────────────

function renderScaffold() {
  if (!container) return;

  const cards = [
    {
      id: 'wr',
      label: 'Waiting Room',
      navModule: 'sentinel',
    },
    {
      id: 'rm',
      label: 'Triage Load',
      navModule: 'reception',
    },
    {
      id: 'demand',
      label: 'Demand Today',
      navModule: 'submissions',
    },
    {
      id: 'slots',
      label: 'Slots Remaining',
      navModule: 'slots',
    },
    {
      id: 'sweep',
      label: 'Morning Sweep',
      navModule: 'sweep',
    },
    {
      id: 'alerts',
      label: 'Recent Alerts',
      navModule: null,
    },
  ];

  container.innerHTML = `
    <div class="module-wrap today-module">
      <div class="today-cards">
        ${cards
          .map(
            (c) => `
          <div class="today-card" data-card="${c.id}">
            <div class="today-card-header">
              <span class="today-card-label">${esc(c.label)}</span>
              ${c.navModule ? `<button class="today-card-open" data-nav="${c.navModule}" aria-label="Open ${esc(c.label)}">Open →</button>` : ''}
            </div>
            <div class="today-card-body" aria-live="polite"><span class="today-loading">Loading…</span></div>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;

  wireCardInteractions();
}

// ── Pollers ───────────────────────────────────────────────────────────────────

function addTimer(fn, ms) {
  const id = setInterval(() => {
    if (document.visibilityState === 'visible') fn();
  }, ms);
  _timers.push(id);
  return id;
}

// ── Storage listener ──────────────────────────────────────────────────────────

function onStorageChange(changes) {
  if (!container) return;
  if (changes['submissions.thresholds']) fetchDemand();
  if (changes['sweep.lastRun']) fetchSweep();
  if (changes['suite.alertLog']) fetchAlerts();
}

// ── Init / Cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _wrData = null;
  _rmData = null;
  _demandData = null;
  _slotsData = null;
  _sweepData = null;
  _alertsData = null;
  _timers = [];

  renderScaffold();

  // Initial fetches — all in parallel
  fetchWr();
  fetchRm();
  fetchDemand();
  fetchSlots();
  fetchSweep();
  fetchAlerts();

  // Pollers
  addTimer(fetchWr, WR_POLL_MS);
  addTimer(fetchRm, DEMAND_POLL_MS);
  addTimer(fetchDemand, DEMAND_POLL_MS);
  addTimer(fetchSlots, DEMAND_POLL_MS);
  addTimer(fetchAlerts, 30 * 1000);
  // Sweep is not polled on interval — re-reads on storage change only

  // Storage watcher
  chrome.storage.onChanged.addListener(onStorageChange);

  // Refresh on visibility restore
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      fetchWr();
      fetchRm();
      fetchDemand();
      fetchSlots();
      fetchSweep();
      fetchAlerts();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return function cleanup() {
    _timers.forEach(clearInterval);
    _timers = [];
    chrome.storage.onChanged.removeListener(onStorageChange);
    document.removeEventListener('visibilitychange', onVisible);
    container = null;
  };
}
