// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Rota module (compact side-panel companion).
//
// The at-a-glance half of the ported Rota Manager: today's duty cover, who is
// on leave, sessions still needing cover and this week's high-priority safe-
// staffing warnings. Everything beyond glancing — editing patterns, approving
// leave, running the solver — happens in the full app (rota/app/app.html),
// reachable from the "Rota manager" nav tab (which opens a new browser tab) or
// the button at the foot of this module.
//
// Data source: chrome.storage.local only. The rota product persists no
// patient-identifiable data, and this module performs no network I/O — it
// reads the eight rota.* keys and runs the PURE engine over them:
//   rota/engine/rules.js  (checkWeek, capacitySummary)
//   rota/engine/leave.js  (approvedLeaveFor)
// Those modules have no DOM/chrome/fetch dependencies, so importing them here
// is safe and keeps the rules in exactly one place.
//
// It deliberately does NOT import rota/shared/store.js: that file is the full
// app's persistence layer (with a localStorage dev fallback and its own
// standalone export envelope). Reading the literal keys here also keeps them
// visible to test-backup-coverage.js's scanner.

'use strict';

import { openRotaTab } from './rota-open.js';
import { checkWeek, capacitySummary } from '../../../rota/engine/rules.js';
import { approvedLeaveFor } from '../../../rota/engine/leave.js';
import { todayISO, mondayOf, weekDates, fmtDay, fmtRange } from '../../../rota/shared/time.js';
import { DEFAULT_SETTINGS, typeById } from '../../../rota/shared/model.js';

const STORAGE_KEYS = [
  'rota.staff',
  'rota.entries',
  'rota.leave',
  'rota.rooms',
  'rota.swaps',
  'rota.audit',
  'rota.demand',
  'rota.settings',
];

// Local storage reads are cheap, and chrome.storage.onChanged is the primary
// refresh signal. The poll is a safety net for the date rolling over past
// midnight on a panel left open overnight.
const POLL_MS = 60000;

let container = null;
let pollTimer = null;
let onStorageChange = null;
let onClick = null;

// Escapes quotes AND apostrophes: the rota subtree's own esc() does not escape
// apostrophes, and single-quoted HTML attributes are banned suite-wide.
const esc = (s) =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const arr = (v) => (Array.isArray(v) ? v : []);

// ── Lifecycle ────────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  container.innerHTML = '<div class="rota-loading">Loading rota…</div>';

  // Delegated, wired once — refresh() replaces innerHTML wholesale.
  onClick = (e) => {
    if (e.target.closest('.rota-open-btn')) openRotaTab();
  };
  container.addEventListener('click', onClick);

  onStorageChange = (changes, area) => {
    if (area && area !== 'local') return;
    if (Object.keys(changes).some((k) => k.startsWith('rota.'))) refresh();
  };
  chrome.storage.onChanged.addListener(onStorageChange);

  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, POLL_MS);

  await refresh();
  return cleanup;
}

export function cleanup() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (onStorageChange) {
    chrome.storage.onChanged.removeListener(onStorageChange);
    onStorageChange = null;
  }
  if (container && onClick) container.removeEventListener('click', onClick);
  onClick = null;
  container = null;
}

// ── Data ─────────────────────────────────────────────────────────────────────

async function loadState() {
  const got = await chrome.storage.local.get(STORAGE_KEYS);
  return {
    staff: arr(got['rota.staff']),
    entries: arr(got['rota.entries']),
    leave: arr(got['rota.leave']),
    rooms: arr(got['rota.rooms']),
    settings: { ...DEFAULT_SETTINGS, ...(got['rota.settings'] || {}) },
  };
}

// Mirrors rota/app/views/dashboard.js so the panel and the full app never
// disagree about who is on duty.
function summarise(state) {
  const today = todayISO();
  const monday = mondayOf(today);
  const dates = weekDates(monday);

  const duty = {};
  for (const period of ['am', 'pm']) {
    duty[period] = state.entries
      .filter(
        (e) =>
          e.date === today &&
          e.period === period &&
          e.typeId === 'duty' &&
          e.status !== 'vacancy' &&
          e.status !== 'cancelled'
      )
      .map((e) => state.staff.find((s) => s.id === e.staffId))
      .filter((p) => p && !approvedLeaveFor(state.leave, p.id, today))
      .map((p) => p.name);
  }

  const onLeave = state.staff.filter((p) => approvedLeaveFor(state.leave, p.id, today)).map((p) => p.name);

  const vacancies = state.entries
    .filter((e) => e.status === 'vacancy' && e.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let high = [];
  let cap = null;
  // Absence of a check must never render as absence of a problem. If the pure
  // engine throws on malformed stored data (e.g. a rota.settings with a null
  // openDays), we record that the checks did NOT run and say so in amber —
  // rendering a green "None" here would manufacture reassurance out of a crash.
  let engineFailed = false;
  try {
    high = checkWeek({
      dates,
      entries: state.entries,
      staff: state.staff,
      leaveList: state.leave,
      settings: state.settings,
      rooms: state.rooms,
    }).filter((w) => w.severity === 'high');
    cap = capacitySummary({
      dates,
      entries: state.entries,
      staff: state.staff,
      leaveList: state.leave,
      settings: state.settings,
    });
  } catch {
    // Malformed stored rota data must not take the whole side panel down; the
    // full app surfaces the real problem. But it must not look healthy either.
    engineFailed = true;
    high = [];
    cap = null;
  }

  return { today, dates, duty, onLeave, vacancies, high, cap, engineFailed };
}

// ── Render ───────────────────────────────────────────────────────────────────

async function refresh() {
  if (!container) return;
  let state;
  try {
    state = await loadState();
  } catch (e) {
    container.innerHTML = `<div class="rota-module"><div class="rota-empty"><p>Could not read the stored rota: ${esc(e.message || e)}</p></div></div>`;
    return;
  }
  if (!container) return; // unmounted while awaiting

  container.innerHTML = state.staff.length ? renderStatus(summarise(state)) : renderEmpty();
}

function openBtn(label) {
  return `<button class="ghost-btn rota-open-btn" type="button">${esc(label)}</button>`;
}

function renderEmpty() {
  return `
    <div class="rota-module">
      <div class="rota-empty">
        <h3>Rota</h3>
        <p>
          Build the practice rota once, then see duty cover, leave and gaps here every morning.
          It plans in sessions, keeps the leave year April–March, checks registrar supervision
          and shares duty pro-rata to contracted sessions.
        </p>
        <p class="rota-empty-note">Nothing is set up yet — no staff have been added.</p>
        ${openBtn('Open the rota manager to get started')}
        <p class="rota-hint">Opens in a new tab</p>
      </div>
    </div>
  `;
}

function renderStatus(s) {
  return `
    <div class="rota-module">
      <div class="rota-head">
        <span class="rota-head-day">${esc(fmtDay(s.today))}</span>
        <span class="rota-head-week">Week ${esc(fmtRange(s.dates[0], s.dates[s.dates.length - 1]))}</span>
      </div>
      ${renderDuty(s.duty, s.engineFailed)}
      ${renderLeave(s.onLeave)}
      ${renderVacancies(s.vacancies, s.today, s.engineFailed)}
      ${renderWarnings(s.high, s.engineFailed)}
      ${renderCapacity(s.cap)}
      <div class="rota-actions">${openBtn('Open full rota →')}</div>
      <p class="rota-hint">Opens in a new tab</p>
      <p class="rota-foot">
        Safe-staffing checks are guidance (BMA/CQC/NHSE), not regulation — they warn, never block.
      </p>
    </div>
  `;
}

// When the engine failed, the same stored data fed these rows, so a green "OK"
// would be an assertion we cannot stand behind: it degrades to a neutral
// "Unchecked". A gap is still shown in red — never hide a problem.
function renderDuty(duty, engineFailed) {
  const row = (period, names) => {
    const gap = names.length === 0;
    const cls = gap ? 'rota-pill-red' : engineFailed ? 'rota-pill-neutral' : 'rota-pill-green';
    const label = gap ? 'Gap' : engineFailed ? 'Unchecked' : 'OK';
    return `
      <div class="rota-duty-row">
        <span class="rota-period">${esc(period.toUpperCase())}</span>
        <span class="rota-pill ${cls}">${label}</span>
        <span class="rota-duty-names">${esc(names.join(', ') || 'nobody rostered')}</span>
      </div>
    `;
  };
  return `
    <section class="rota-card">
      <h3 class="rota-card-title">Duty today</h3>
      ${row('am', duty.am)}
      ${row('pm', duty.pm)}
    </section>
  `;
}

function renderLeave(names) {
  if (!names.length) return '';
  return `
    <section class="rota-card">
      <h3 class="rota-card-title">On leave today</h3>
      <p class="rota-line">${esc(names.join(', '))}</p>
    </section>
  `;
}

function renderVacancies(vacancies, today, engineFailed) {
  if (!vacancies.length) {
    return `
      <section class="rota-card">
        <h3 class="rota-card-title">Sessions needing cover</h3>
        ${
          engineFailed
            ? '<p class="rota-line rota-line-muted">Not verified — check the full rota.</p>'
            : '<p class="rota-line rota-line-good">None outstanding.</p>'
        }
      </section>
    `;
  }
  const next = vacancies.slice(0, 4);
  const more = vacancies.length - next.length;
  return `
    <section class="rota-card">
      <h3 class="rota-card-title">
        Sessions needing cover
        <span class="rota-count rota-count-red">${vacancies.length}</span>
      </h3>
      <ul class="rota-list">
        ${next
          .map((e) => {
            const t = typeById(e.typeId);
            const when = e.date === today ? 'Today' : fmtDay(e.date);
            return `<li><span class="rota-when">${esc(when)} ${esc(String(e.period || '').toUpperCase())}</span> ${esc(t ? t.name : e.typeId || 'session')}</li>`;
          })
          .join('')}
      </ul>
      ${more > 0 ? `<p class="rota-more">+${more} more in the full rota</p>` : ''}
    </section>
  `;
}

function renderWarnings(high, engineFailed) {
  // Checks did not run: say so, in amber. "None" here would be a lie of omission.
  if (engineFailed) {
    return `
      <section class="rota-card rota-card-degraded">
        <h3 class="rota-card-title">High-priority warnings this week</h3>
        <p class="rota-line rota-line-warn">
          Safe-staffing checks unavailable — open the full rota to investigate.
        </p>
        <p class="rota-sub">The stored rota could not be evaluated, so nothing here has been checked.</p>
      </section>
    `;
  }
  if (!high.length) {
    return `
      <section class="rota-card">
        <h3 class="rota-card-title">High-priority warnings this week</h3>
        <p class="rota-line rota-line-good">None.</p>
      </section>
    `;
  }
  const shown = high.slice(0, 4);
  const more = high.length - shown.length;
  return `
    <section class="rota-card rota-card-alert">
      <h3 class="rota-card-title">
        High-priority warnings this week
        <span class="rota-count rota-count-red">${high.length}</span>
      </h3>
      <ul class="rota-list rota-list-warn">
        ${shown.map((w) => `<li>${esc(w.message || w.kind || 'warning')}</li>`).join('')}
      </ul>
      ${more > 0 ? `<p class="rota-more">+${more} more in the full rota</p>` : ''}
    </section>
  `;
}

function renderCapacity(cap) {
  if (!cap || !cap.target) return '';
  const short = cap.estimated < cap.target;
  return `
    <section class="rota-card">
      <h3 class="rota-card-title">GP appointments this week</h3>
      <p class="rota-line">
        <span class="rota-figure ${short ? 'rota-figure-amber' : 'rota-figure-green'}">${esc(cap.estimated)}</span>
        <span class="rota-vs">of ${esc(cap.target)} benchmark</span>
      </p>
      <p class="rota-sub">Estimated from ${esc(cap.gpClinicalSessions)} weighted GP clinical sessions.</p>
    </section>
  `;
}
