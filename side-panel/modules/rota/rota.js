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
// Data source: chrome.storage.local for everything planned, plus ONE read-only
// Medicus call for the live drift check (below). The stored half runs the PURE
// engine over the eight rota.* keys:
//   rota/engine/rules.js  (checkWeek, capacitySummary)
//   rota/engine/leave.js  (approvedLeaveFor)
// Those modules have no DOM/chrome/fetch dependencies, so importing them here
// is safe and keeps the rules in exactly one place.
//
// It deliberately does NOT import rota/shared/store.js: that file is the full
// app's persistence layer (with a localStorage dev fallback and its own
// standalone export envelope). Reading the literal keys here also keeps them
// visible to test-backup-coverage.js's scanner.
//
// ── Live drift check ────────────────────────────────────────────────────────
// The full app's Live sync page (rota/app/views/sync.js) reconciles the planned
// rota against the real Medicus appointment book — but only when someone opens
// it and presses a button. A rota that drifted at 08:15 is only useful if you
// find out at 08:15, so this module runs the same diff for TODAY ONLY on the
// panel's existing poll: one cheap embedded-overview fetch per poll interval,
// read-only, riding the user's logged-in Medicus session (credentials:
// 'include'), exactly as rota/shared/medicus-api.js does for the full app.
//
// PHI: the appointment-book payload contains patient rows. parseOverview()
// reduces them to per-clinician AM/PM counts before anything is kept, the
// result lives in module memory only (never chrome.storage), and nothing
// patient-identifying is rendered — clinician names and session-level findings
// only. cleanup() drops the cache with the module.

'use strict';

import { openRotaTab } from './rota-open.js';
import { driftBadgeState } from './drift-state.js';
import { checkWeek, capacitySummary } from '../../../rota/engine/rules.js';
import { approvedLeaveFor } from '../../../rota/engine/leave.js';
import { parseOverview, diffDay, summariseFindings } from '../../../rota/engine/reconcile.js';
import { isValidPracticeCode, fetchOverviewRange } from '../../../rota/shared/medicus-api.js';
import { notify } from '../../../rota/shared/notify.js';
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
  'rota.access',
];

// The subset of those keys that changes the answer to "does the book match the
// rota?". A change to one of these re-runs the live check immediately instead
// of waiting for the next poll.
const DRIFT_INPUT_KEYS = ['rota.entries', 'rota.settings', 'rota.staff', 'rota.leave'];

// Local storage reads are cheap, and chrome.storage.onChanged is the primary
// refresh signal. The poll is a safety net for the date rolling over past
// midnight on a panel left open overnight — and the heartbeat for the live
// drift check, which is throttled to at most one fetch per interval.
const POLL_MS = 60000;

let container = null;
let pollTimer = null;
let onStorageChange = null;
let onClick = null;

// ── Live-drift state (module memory only — never persisted) ──────────────────
// driftResult: the last check outcome, shaped for drift-state.js:
//   { state: 'checked'|'error'|'skipped', date, counts?, checkedAt?, reason?,
//     lines?: string[], redKey?: string }
let driftResult = null;
let driftKey = ''; // JSON of driftResult — cheap "did anything change?" test
let driftFetchAt = 0; // ms timestamp of the last network attempt (throttle)
let driftInFlight = false;
let lastRedKey = null; // notification de-dupe: only fire on NEW red drift
// Bumped by cleanup() so an in-flight fetch resolving after unmount (or after a
// remount) is discarded instead of painting into someone else's DOM.
let mountId = 0;

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
    // The drift card's button deep-links straight to Live sync — checked first
    // because it also carries .rota-open-btn.
    if (e.target.closest('.rota-drift-open')) openRotaTab('sync');
    else if (e.target.closest('.rota-open-btn')) openRotaTab();
  };
  container.addEventListener('click', onClick);

  onStorageChange = (changes, area) => {
    if (area && area !== 'local') return;
    const keys = Object.keys(changes).filter((k) => k.startsWith('rota.'));
    if (!keys.length) return;
    // Edited the rota or the practice code? Re-check against the book now
    // rather than showing a verdict that is known to be about the old plan.
    refresh({ force: keys.some((k) => DRIFT_INPUT_KEYS.includes(k)) });
  };
  chrome.storage.onChanged.addListener(onStorageChange);

  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, POLL_MS);

  await refresh({ force: true });
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
  // Drop the transient appointment-book derivative with the module, and
  // invalidate any fetch still in flight.
  mountId += 1;
  driftResult = null;
  driftKey = '';
  driftFetchAt = 0;
  driftInFlight = false;
  lastRedKey = null;
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
    access: got['rota.access'] || null,
  };
}

// Strict passcode mode means "nothing opens without the passcode" — and this
// module is part of that nothing. Non-strict (staff view) is unaffected: the
// module is read-only by nature, which IS what staff view grants.
function strictLocked(state) {
  const a = state.access;
  return Boolean(a && a.enabled && a.strict);
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

// ── Live drift check (the only network I/O in this module) ───────────────────

function hhmm(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Turn a raw fetch failure into something a practice manager can act on. The
// reason is always shown — an unexplained amber is nearly as useless as a
// false green.
function friendlyFetchError(msg) {
  const text = String(msg == null ? '' : msg).trim();
  const m = /HTTP (\d{3})/.exec(text);
  if (m) {
    const code = Number(m[1]);
    if (code === 401 || code === 403) return 'not signed in to Medicus in this browser profile';
    if (code === 404) return 'appointment book not found — check the practice code in the rota settings';
    if (code >= 500) return `Medicus is not responding (HTTP ${code})`;
    return `Medicus returned HTTP ${code}`;
  }
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) {
    return 'no connection to Medicus';
  }
  return text || 'reason unknown';
}

// Stable identity for a red verdict, so a notification fires on NEW drift
// rather than on every poll that still finds yesterday's unfixed problem.
function redSignature(findings) {
  return findings
    .filter((f) => f.severity === 'high')
    .map((f) => `${f.kind}|${f.period || ''}|${f.staffName || ''}`)
    .sort()
    .join(';');
}

// Returns a fresh drift result, or null to mean "keep the cached one".
async function runDriftCheck(state, today, force) {
  const code = String(state.settings.practiceCode || '').trim();

  // Preconditions absent → neutral "not checked". These are cheap and are
  // re-evaluated every refresh, so setting a practice code takes effect at once.
  if (!isValidPracticeCode(code)) {
    return { state: 'skipped', date: today, reason: 'no practice code set in the rota settings' };
  }
  if (!state.entries.some((e) => e.date === today)) {
    return { state: 'skipped', date: today, reason: 'nothing rostered for today' };
  }
  if (typeof fetch !== 'function') {
    // Smoke-tested outside the extension: say so in amber, never green.
    return { state: 'error', date: today, reason: 'this context cannot reach the Medicus API' };
  }

  // Throttle: at most one appointment-book fetch per poll interval, unless the
  // rota itself changed underneath us.
  const cached = driftResult && driftResult.date === today && driftResult.state !== 'skipped';
  if (!force && cached && Date.now() - driftFetchAt < POLL_MS - 2000) return null;
  if (driftInFlight) return null;

  driftInFlight = true;
  driftFetchAt = Date.now();
  try {
    // One day only — cheap, and the panel is a "right now" surface. The full
    // app still does the whole week.
    const { byDate, errors } = await fetchOverviewRange(code, [today]);
    const payload = byDate[today];
    if (!payload) {
      return { state: 'error', date: today, reason: friendlyFetchError(errors && errors[0]) };
    }
    const findings = diffDay({
      date: today,
      medicusRows: parseOverview(payload),
      rotaEntries: state.entries.filter((e) => e.date === today),
      staff: state.staff,
      leaveList: state.leave,
    });
    const drift = findings.filter((f) => f.kind !== 'ok');
    return {
      state: 'checked',
      date: today,
      counts: summariseFindings(findings),
      checkedAt: hhmm(new Date()),
      // Engine messages are clinician/session-level ("Dr A AM: no clinic
      // built", "2 booked patient(s) to rebook") — counts, never identities.
      lines: drift.slice(0, 3).map((f) => f.message),
      redKey: redSignature(drift),
    };
  } catch (e) {
    // A thrown parse/network error is still an answer: amber, with the reason.
    return { state: 'error', date: today, reason: friendlyFetchError(e && e.message ? e.message : e) };
  } finally {
    driftInFlight = false;
  }
}

// Opt-in, and only when the verdict newly turns red. Notifications for amber
// drift would train people to ignore them.
function maybeNotifyDrift(state, badge, result) {
  if (badge.level !== 'red' || !state.settings.notifications) {
    lastRedKey = null;
    return;
  }
  const key = result.redKey || badge.detail;
  if (key === lastRedKey) return;
  lastRedKey = key;
  notify('Rota drift today', `${badge.detail} — open the rota manager and run Live sync.`);
}

async function updateDrift(state, today, force) {
  const mount = mountId;
  const next = await runDriftCheck(state, today, force);
  // Unmounted (or remounted) while the fetch was in flight — discard.
  if (mount !== mountId || !container) return;
  if (!next) return;

  const key = JSON.stringify(next);
  const changed = key !== driftKey;
  driftResult = next;
  driftKey = key;

  const badge = driftBadgeState(next);
  maybeNotifyDrift(state, badge, next);
  if (changed) paintDrift();
}

// Swap just the drift card in place — a full refresh() here would re-enter the
// check on every completion.
function paintDrift() {
  if (!container) return;
  const node = container.querySelector('.rota-drift');
  if (!node) return;
  const holder = document.createElement('div');
  holder.innerHTML = renderDrift(driftResult);
  const fresh = holder.firstElementChild;
  if (fresh) node.replaceWith(fresh);
}

// ── Render ───────────────────────────────────────────────────────────────────

async function refresh(opts) {
  if (!container) return;
  const force = !!(opts && opts.force);
  let state;
  try {
    state = await loadState();
  } catch (e) {
    container.innerHTML = `<div class="rota-module"><div class="rota-empty"><p>Could not read the stored rota: ${esc(e.message || e)}</p></div></div>`;
    return;
  }
  if (!container) return; // unmounted while awaiting

  // Strict lock: render the locked card and stop BEFORE summarise() and before
  // updateDrift(). No engine run, no appointment-book fetch — a passcode-locked
  // rota must not keep quietly reporting on itself in the side panel.
  if (strictLocked(state)) {
    driftResult = null;
    driftKey = '';
    lastRedKey = null;
    container.innerHTML = renderLocked();
    return;
  }

  if (!state.staff.length) {
    container.innerHTML = renderEmpty();
    return;
  }
  const s = summarise(state);
  // A cached verdict about a previous day is not a verdict about today.
  if (driftResult && driftResult.date !== s.today) {
    driftResult = null;
    driftKey = '';
    lastRedKey = null;
  }
  container.innerHTML = renderStatus(s);
  void updateDrift(state, s.today, force);
}

function openBtn(label, extraClass) {
  return `<button class="ghost-btn rota-open-btn${extraClass ? ` ${esc(extraClass)}` : ''}" type="button">${esc(label)}</button>`;
}

function renderLocked() {
  return `
    <div class="rota-module">
      <div class="rota-empty">
        <h3>Rota</h3>
        <p>This practice's rota is passcode-protected — open the full app to unlock it.</p>
        <p class="rota-empty-note">
          Duty cover, leave and drift checks stay hidden here until it is unlocked there.
        </p>
        ${openBtn('Open the rota manager')}
        <p class="rota-hint">Opens in a new tab</p>
      </div>
    </div>
  `;
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
      ${renderDrift(driftResult)}
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

// Colour is never the only signal — every state carries its own word, and the
// three non-green states each say WHY (drift kinds, or the failure reason).
const DRIFT_UI = {
  ok: { card: '', pill: 'rota-pill-green', word: 'In step', line: 'rota-line-good' },
  amber: { card: 'rota-card-degraded', pill: 'rota-pill-amber', word: 'Drift', line: 'rota-line-warn' },
  red: { card: 'rota-card-alert', pill: 'rota-pill-red', word: 'Drift', line: 'rota-line-bad' },
  unavailable: {
    card: 'rota-card-degraded',
    pill: 'rota-pill-amber',
    word: 'Unavailable',
    line: 'rota-line-warn',
  },
  neutral: { card: '', pill: 'rota-pill-neutral', word: 'Not checked', line: 'rota-line-muted' },
};

const sentence = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function renderDrift(result) {
  const badge = driftBadgeState(result);
  const ui = DRIFT_UI[badge.level] || DRIFT_UI.neutral;
  const drifted = badge.level === 'red' || badge.level === 'amber';
  const lines = drifted ? (result && result.lines) || [] : [];
  // ok/red/amber: the label is the headline and the detail is the breakdown.
  // unavailable/neutral: the pill already says "Unavailable" / "Not checked",
  // so the headline is the REASON — an amber with no reason is nearly as
  // useless as a false green.
  const headline = drifted || badge.level === 'ok' ? badge.label : sentence(badge.detail);
  const sub = drifted ? badge.detail : '';
  return `
    <section class="rota-card rota-drift ${ui.card}">
      <h3 class="rota-card-title">
        Live drift — rota vs Medicus
        ${badge.count ? `<span class="rota-count ${badge.level === 'red' ? 'rota-count-red' : 'rota-count-amber'}">${esc(badge.count)}</span>` : ''}
      </h3>
      <div class="rota-drift-head">
        <span class="rota-pill ${ui.pill}">${esc(ui.word)}</span>
        <span class="rota-line ${ui.line}">${esc(headline)}</span>
      </div>
      ${sub ? `<p class="rota-sub rota-drift-detail">${esc(sub)}</p>` : ''}
      ${
        lines.length
          ? `<ul class="rota-list rota-drift-lines">${lines.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
          : ''
      }
      ${badge.checkedAt && badge.level !== 'ok' ? `<p class="rota-sub">Last checked ${esc(badge.checkedAt)}.</p>` : ''}
      ${openBtn('Open Live sync →', 'rota-drift-open')}
      <p class="rota-hint rota-drift-hint">Opens the rota manager's Live sync page in a new tab</p>
    </section>
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
