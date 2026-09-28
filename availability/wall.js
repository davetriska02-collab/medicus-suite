// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Availability wall. Read-only. One leader tab polls, and only while it is
// visible, inside 07:00–19:00 Europe/London.
//
// Today is fetched on the practice interval (default 5 minutes, floor 2).
// The other six days are fetched every 30 minutes. A 429 or 5xx aborts the
// burst and backs off up to 8×. A 401 or 403 stops until someone signs in.

import { fetchSchedulingOverview } from '../shared/medicus-api.js';
import {
  FETCH_TIMEOUT_MS,
  STALE_MS,
  TICK_MS,
  backoffMs,
  blankTile,
  bookPayload,
  clockLabel,
  clockProblem,
  dayCardCount,
  dayCardSubtitle,
  dayCardTone,
  dayHeading,
  defaultTiles,
  dropPastSlots,
  extractFreeSlots,
  horizonSlots,
  isNotCurrent,
  isoFromDate,
  mergeSnapshots,
  msUntilOpen,
  normaliseConfig,
  planRefresh,
  pollMsFromConfig,
  practiceOpen,
  roleIndex,
  shortDateLabel,
  shouldFetch,
  tileFace,
  todayViews,
  weekDates,
  weekView,
} from '../shared/availability-board-core.js';
import {
  placeItem,
  popUndo,
  pushUndo,
  reasonText,
  removeFromPot,
  setupView,
} from '../shared/availability-setup-core.js';
import { renderSetup } from './setup-canvas.js';

const LOCK_NAME = 'medicus-suite-availability-wall';
const main = document.getElementById('avMain');
const weekEl = document.getElementById('avWeek');
const banner = document.getElementById('avBanner');
const noteEl = document.getElementById('avNote');
const dateEl = document.getElementById('avDate');
const clockEl = document.getElementById('avClock');
const siteEl = document.getElementById('avSite');
const editor = document.getElementById('avEditor');
const editorBody = document.getElementById('avEditorBody');
const editorStatus = document.getElementById('avEditorStatus');
const setupBtn = document.getElementById('avSetup');
const stage = document.getElementById('avStage');
const head = document.getElementById('avHead');

let config = normaliseConfig(null);
let roleMap = {};
let division = 'england-and-wales';
let practiceLabel = '';
let snapshot = { days: {}, fetchedAt: null, stale: false, error: false, ready: false, staleDates: [] };
let observed = { slotTypes: [], sessions: [], clinicians: [], sites: [] };
let reduceMotion = false;
let stopFlash = false;
let pollTimer = null;
let tickTimer = null;
let clockTimer = null;
let quietTimer = null;
let authTimer = null;
let fetching = false;
let leader = false;
let failures = 0;
let authHold = false;
let lastWeekAt = null;
let pinnedCode = '';
let draft = null;
let undoStack = [];
let setupQuery = '';
let setupKind = 'all';
let openDetails = [];
let draggingId = '';
let lastBanner = '';
let lastMessage = '';
let holdTimer = null;
let opener = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function packOn() {
  const packs = window.PracticePacks;
  if (!packs || !packs.KEYS) return false;
  return packs.peek(packs.KEYS.availabilityWall) === true;
}

function visible() {
  return document.visibilityState === 'visible' && !document.hidden;
}

function contextDead(err) {
  return /Extension context invalidated|context invalidated/i.test(String(err && (err.message || err)));
}

function readMotion() {
  reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  try {
    stopFlash = sessionStorage.getItem('av-stop-flash') === '1';
  } catch {
    stopFlash = false;
  }
}

function steadyFace() {
  return reduceMotion || stopFlash;
}

function setBanner(text) {
  if (text === lastBanner) return;
  lastBanner = text;
  banner.hidden = !text;
  banner.textContent = text || '';
}

function paintMessage(message) {
  if (message !== lastMessage) lastMessage = message;
  main.innerHTML = `<p class="av-message" role="status" aria-live="polite">${esc(message)}</p>`;
}

function showReload() {
  document.body.innerHTML = `<main class="av-stage"><p class="av-message">Suite updated, reload this tab.</p><p><button type="button" id="avReload">Reload</button></p></main>`;
  const btn = document.getElementById('avReload');
  if (btn) btn.addEventListener('click', () => location.reload());
}

function paintClock() {
  const now = Date.now();
  if (clockEl) clockEl.textContent = clockLabel(now);
  if (dateEl) dateEl.textContent = shortDateLabel(now);
}

async function loadConfig() {
  const exp = await window.availabilityExport();
  config = normaliseConfig(exp && exp.config);
  let staff = [];
  try {
    const r = await chrome.storage.local.get(['rota.staff', 'capacity.lookahead', 'suite.letterhead']);
    staff = Array.isArray(r['rota.staff']) ? r['rota.staff'] : [];
    const lh = r['suite.letterhead'];
    practiceLabel = lh && typeof lh.practiceName === 'string' ? lh.practiceName.trim() : '';
    const look = r['capacity.lookahead'];
    if (look && typeof look.division === 'string') division = look.division;
  } catch (err) {
    if (contextDead(err)) showReload();
    staff = [];
  }
  roleMap = roleIndex(staff);
}

function colsFor(n) {
  const w = window.innerWidth || 1920;
  const fit = Math.max(1, Math.floor((w - 64) / 196));
  if (n <= fit) return Math.max(1, n);
  return Math.max(1, Math.ceil(n / 2));
}

const GLYPHS = {
  'otd-gp': '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.5c1.2-3.2 3.6-4.8 6.5-4.8s5.3 1.6 6.5 4.8"/>',
  anp: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.5c1.2-3.2 3.6-4.8 6.5-4.8s5.3 1.6 6.5 4.8"/><path d="M18 3.5v3.5M16.2 5.2h3.6"/>',
  nursing:
    '<rect x="8" y="3" width="8" height="5" rx="1.5"/><path d="M9 8v2.2a3 3 0 0 0 6 0V8"/><path d="M12 13.2V20M9.2 16.6h5.6"/>',
  visits:
    '<path d="M3 13.2 5.4 8.2A1.6 1.6 0 0 1 6.8 7.2h8.6a1.6 1.6 0 0 1 1.4 1L19.2 13.2"/><path d="M3 13.2h18V17H3z"/><circle cx="7.2" cy="17" r="1.3"/><circle cx="16.8" cy="17" r="1.3"/>',
  registrar:
    '<path d="M2.5 10 12 5l9.5 5L12 15z"/><path d="M7 12.2V16c0 1.4 2.2 2.8 5 2.8s5-1.4 5-2.8v-3.8"/><path d="M21.5 10v6"/>',
  'routine-gp': '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16"/>',
  'embargo-gp':
    '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3.5v4M16 3.5v4M4 10h16M12 13v3.2l2.1 1.2"/>',
  extended: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>',
};

function glyph(id) {
  const paths = GLYPHS[id] || GLYPHS['routine-gp'];
  return `<svg class="av-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function attentionIcon() {
  return '<svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" role="img" aria-label="Under 30 minutes"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5h.01"/></svg>';
}

function faceHtml(view, opts) {
  const face = tileFace(view);
  if (!face) return '';
  const dead = opts && opts.notCurrent;
  const zone = !!(opts && opts.clockBad);
  const tone = dead || zone ? 'none' : face.tone;
  const flash = !dead && !zone && face.flash && view.flash;
  const icon = !dead && !zone && face.icon ? attentionIcon() : '';
  const primary = dead ? 'Not current' : zone ? view.nextLabel || face.primary : face.primary;
  const cue = dead || zone ? '' : face.cue;
  const cls = `av-tile tone-${esc(tone)}${flash ? ' flash' : ''}${dead ? ' not-current' : ''}`;
  return `<article class="${cls}">
    <p class="av-kicker">${glyph(view.id)}<span class="av-name">${esc(face.label)}</span></p>
    ${face.subtitle ? `<p class="av-sub">${esc(face.subtitle)}</p>` : ''}
    <p class="av-primary">${icon}${esc(primary)}</p>
    ${face.site && !dead && !zone ? `<p class="av-sub">${esc(face.site)}</p>` : ''}
    <p class="av-secondary">${esc(face.secondary)}</p>
    <div class="av-track" aria-hidden="true"><span style="width:${dead || zone ? 0 : face.track}%"></span></div>
    ${cue ? `<p class="av-cue">${esc(cue)}</p>` : ''}
  </article>`;
}

function render() {
  paintClock();
  if (!packOn()) {
    paintMessage('The availability wall is switched off. Turn it on under Settings, Practice features.');
    weekEl.hidden = true;
    noteEl.textContent = '';
    setBanner('');
    return;
  }
  if (authHold && !snapshot.ready) {
    paintMessage('Sign in to Medicus in this Chrome. The board is not reading the book.');
    setBanner('Sign in to Medicus in this Chrome.');
    return;
  }
  const nowMs = Date.now();
  const serverMs = fetchSchedulingOverview.lastServerMs;
  const clockBad = clockProblem(nowMs, serverMs);
  const today = isoFromDate(nowMs);
  const todayRow = snapshot.days[today];
  const todayStamp = todayRow && todayRow.fetchedAt ? todayRow.fetchedAt : snapshot.fetchedAt;
  const todayFailed = !!(todayRow && todayRow.stale);
  const notCurrent = snapshot.ready && isNotCurrent(todayStamp, nowMs, STALE_MS);
  const freeze = todayFailed || notCurrent || !!clockBad;
  const viewNow = freeze && todayStamp ? new Date(todayStamp) : new Date(nowMs);

  if (!snapshot.ready) {
    paintMessage(
      authHold
        ? 'Sign in to Medicus in this Chrome. The board is not reading the book.'
        : snapshot.error
          ? 'The book could not be read. Nothing is shown as zero.'
          : 'Reading the appointment book…'
    );
    noteEl.textContent = '';
    weekEl.hidden = true;
    return;
  }

  const todaySlots = todayRow && todayRow.slots;
  const ahead = todaySlots == null ? [] : horizonSlots(snapshot.days, today, new Date(nowMs), freeze);
  let capacityLine = '';
  if (todaySlots == null) {
    paintMessage('Today’s book has not been read. Slots are not shown as zero.');
  } else if (todayRow && todayRow.noClinic && todaySlots.length === 0 && ahead.length === 0) {
    paintMessage('No clinic on today’s book.');
  } else {
    const footerSlots = freeze ? todaySlots : dropPastSlots(todaySlots, new Date(nowMs));
    const views = todayViews(footerSlots, config, viewNow, steadyFace() || freeze);
    const horizon = todayViews(ahead, config, viewNow, steadyFace() || freeze);
    if (views.unconfirmed) {
      const n = views.unmapped;
      capacityLine = n
        ? `${n} free slot${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} not on a tile yet. Press and hold Set up tiles, drag each name onto one tile, then save. Nothing is shown as None left from a guess.`
        : 'Set up tiles before this wall shows a clinic. Guesses are not shown as None left.';
      paintMessage(capacityLine);
    } else {
      const cols = colsFor(horizon.tiles.length || 1);
      main.innerHTML = `<div class="av-grid" style="--av-cols:${cols}">${horizon.tiles
        .map((view) => faceHtml(view, { notCurrent, clockBad: !!clockBad }))
        .join('')}</div>`;
      const parts = [];
      if (views.unmapped) {
        parts.push(
          `${views.unmapped} free slot${views.unmapped === 1 ? '' : 's'} today ${views.unmapped === 1 ? 'is' : 'are'} not on a tile.`
        );
      }
      if (views.offScreen) {
        const names = views.offScreenNames.length ? ` (${views.offScreenNames.join(', ')})` : '';
        parts.push(
          `${views.offScreen} free slot${views.offScreen === 1 ? '' : 's'} ${views.offScreen === 1 ? 'is' : 'are'} not on this screen${names}.`
        );
      }
      if (!parts.length) parts.push('Slots, times and counts only. A slot can be taken between refreshes.');
      noteEl.textContent = parts.join(' ');
      if (views.unmapped || views.offScreen) capacityLine = parts.filter((p) => /not on/.test(p)).join(' ');
    }
  }

  const dates = weekDates(today);
  const rows = dates.map((date) => {
    const row = snapshot.days[date];
    return {
      date,
      slots: row ? row.slots : null,
      stale: !!(row && row.stale),
      noClinic: !!(row && row.noClinic),
      partial: !!(row && row.partial),
    };
  });
  const week = weekView(rows, config, { division });
  const peak = Math.max(1, ...week.days.map((d) => dayCardCount(d) || 0));
  const bars = week.days
    .map((d) => {
      const count = dayCardCount(d);
      const routine = count == null ? '—' : String(count);
      const h = count ? Math.round((count / peak) * 100) : 0;
      const todayCard = d.label === 'Today';
      const title = todayCard ? 'Today' : dayHeading(d.date);
      const dateLine = todayCard ? dayHeading(d.date) : '';
      return `<div class="av-bar tone-${esc(dayCardTone(d))}${todayCard ? ' is-today' : ''}">
        <div class="av-bar-label">${esc(title)}</div>
        <div class="av-bar-date">${esc(dateLine)}</div>
        <div class="av-bar-ext">${esc(dayCardSubtitle(d))}</div>
        <div class="av-bar-count">${esc(routine)}</div>
        <div class="av-col" aria-hidden="true"><span style="--h:${h}%"></span></div>
      </div>`;
    })
    .join('');
  const total = week.incomplete ? `${week.totalRoutine}+` : String(week.totalRoutine);
  const extTotal = week.incomplete ? `${week.totalExtended}+` : String(week.totalExtended);
  const extBit =
    week.totalExtended || week.incomplete ? `<span class="av-week-ext">${esc(extTotal)} extended</span>` : '';
  weekEl.hidden = false;
  weekEl.innerHTML = `<div class="av-week-head">
      <div>
        <h2>Routine GP availability – next 7 days</h2>
        <p class="av-week-include">Including registrar lists</p>
      </div>
      <p class="av-week-total">Total routine GP appointments: <strong>${esc(total)}</strong>${extBit}</p>
    </div>
    <div class="av-bars">${bars}</div>`;

  const noteBits = [];
  if (todayStamp && !todayFailed && !notCurrent) noteBits.push(`Last updated ${clockLabel(todayStamp)}`);
  if (todayFailed || notCurrent) noteBits.push(`Today last read ${todayStamp ? clockLabel(todayStamp) : '—'}`);
  if (noteEl.textContent) noteBits.push(noteEl.textContent);
  noteEl.textContent = noteBits.join(' · ');

  const staleNames = (snapshot.staleDates || []).map((date) => (date === today ? 'Today' : date));
  const alerts = [];
  if (notCurrent) alerts.push('Not current. The last reading of today is too old to count down from.');
  if (clockBad === 'zone') alerts.push('This PC is not set to UK time. The countdown is hidden.');
  else if (clockBad === 'skew') alerts.push("This PC's clock looks wrong. The countdown is hidden.");
  if (authHold) alerts.push('Sign in to Medicus in this Chrome.');
  if (staleNames.length) {
    alerts.push(
      `${staleNames.join(', ')} ${staleNames.length === 1 ? 'is' : 'are'} still the previous reading, not zeros.`
    );
  }
  if (capacityLine) alerts.push(capacityLine);
  setBanner(alerts.join(' '));
}

async function resolveCode() {
  if (pinnedCode && window.PracticeCode.isValidPracticeCode(pinnedCode)) return pinnedCode;
  let fromTab = null;
  try {
    fromTab = await window.PracticeCode.detectFromTab();
  } catch (err) {
    if (contextDead(err)) showReload();
    return '';
  }
  if (fromTab && window.PracticeCode.isValidPracticeCode(fromTab)) {
    pinnedCode = fromTab;
    return pinnedCode;
  }
  try {
    const stored = await chrome.storage.local.get('suite.practiceCode');
    const code = stored['suite.practiceCode'] || '';
    if (window.PracticeCode.isValidPracticeCode(code)) {
      pinnedCode = code;
      return pinnedCode;
    }
  } catch (err) {
    if (contextDead(err)) showReload();
  }
  return '';
}

function statusOf(err) {
  if (err && typeof err.status === 'number') return err.status;
  const m = /API error (\d+)/.exec(String(err && err.message));
  if (m) return Number(m[1]);
  if (err && /Not signed in/.test(err.message)) return 401;
  return 0;
}

async function refresh() {
  if (fetching || !leader) return;
  if (!shouldFetch({ packOn: packOn(), visible: visible() })) return;
  const now = Date.now();
  if (!practiceOpen(now)) {
    armQuiet();
    return;
  }
  fetching = true;
  let burstAbort = false;
  try {
    const code = await resolveCode();
    if (siteEl) {
      const bits = [];
      if (practiceLabel) bits.push(practiceLabel);
      if (code) bits.push(`Site ${code}`);
      siteEl.textContent = bits.join(' · ');
    }
    if (!code || !window.PracticeCode.isValidPracticeCode(code)) {
      if (!snapshot.ready) paintMessage('No practice code yet. Open Medicus, or set the code in Settings.');
      return;
    }
    const today = isoFromDate(now);
    const dates = weekDates(today);
    const plan = planRefresh({ now, lastWeekAt, todayISO: today, dates });
    if (!plan.dates.length) return;
    const incoming = { fetchedAt: now, today, days: {} };
    const observedSets = { slotTypes: new Set(), sessions: new Set(), clinicians: new Set(), sites: new Set() };
    let cursor = 0;
    let sawAuth = false;
    let sawBackoff = false;
    async function worker() {
      for (;;) {
        if (burstAbort) return;
        const i = cursor++;
        if (i >= plan.dates.length) return;
        const date = plan.dates[i];
        try {
          const raw = await fetchSchedulingOverview(code, date, {
            bypassCache: true,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          const book = bookPayload(raw);
          if (!book) {
            incoming.days[date] = { ok: false, status: 200 };
            continue;
          }
          const extracted = extractFreeSlots(book, {
            now: new Date(),
            roleIndex: roleMap,
            dropPast: date === today,
          });
          if (!extracted.ok) {
            incoming.days[date] = { ok: false, status: 200 };
            continue;
          }
          if (extracted.unexpanded && extracted.slots.length === 0) {
            incoming.days[date] = { ok: false, unexpanded: true };
            continue;
          }
          incoming.days[date] = {
            ok: true,
            slots: extracted.slots,
            noClinic: extracted.noClinic,
            partial: extracted.unexpanded,
          };
          extracted.observed.slotTypes.forEach((n) => observedSets.slotTypes.add(n));
          extracted.observed.sessions.forEach((n) => observedSets.sessions.add(n));
          extracted.observed.clinicians.forEach((n) => observedSets.clinicians.add(n));
          extracted.observed.sites.forEach((n) => observedSets.sites.add(n));
        } catch (err) {
          if (contextDead(err)) {
            showReload();
            burstAbort = true;
            return;
          }
          const status = statusOf(err);
          incoming.days[date] = { ok: false, status };
          if (status === 401 || status === 403) {
            sawAuth = true;
            burstAbort = true;
          } else if (status === 429 || status >= 500) {
            sawBackoff = true;
            burstAbort = true;
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, plan.dates.length) }, () => worker()));
    if (plan.dates.length > 1 && plan.dates.every((date) => incoming.days[date] && incoming.days[date].ok)) {
      lastWeekAt = now;
    }
    snapshot = mergeSnapshots(snapshot, incoming, { today, keep: dates });
    if (sawAuth) {
      authHold = true;
      failures = 0;
      holdAuth();
    } else if (sawBackoff) {
      authHold = false;
      failures = Math.min(3, failures + 1);
    } else if (incoming.days[today] && incoming.days[today].ok) {
      authHold = false;
      failures = 0;
    }
    observed = {
      slotTypes: [...observedSets.slotTypes].sort(),
      sessions: [...observedSets.sessions].sort(),
      clinicians: [...observedSets.clinicians].sort(),
      sites: [...observedSets.sites].sort(),
    };
    if (draft) {
      const active = document.activeElement;
      const typing =
        active &&
        editorBody.contains(active) &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
      if (!typing) paintEditor();
    }
    render();
  } catch (err) {
    if (contextDead(err)) showReload();
  } finally {
    fetching = false;
  }
}

function localTick() {
  if (!visible() || !snapshot.ready) return;
  const today = isoFromDate(Date.now());
  const row = snapshot.days[today];
  if (row && Array.isArray(row.slots) && !row.stale && !isNotCurrent(row.fetchedAt, Date.now(), STALE_MS)) {
    snapshot.days[today] = { ...row, slots: dropPastSlots(row.slots, new Date()) };
  }
  render();
}

function armQuiet() {
  if (quietTimer) clearTimeout(quietTimer);
  const wait = msUntilOpen(Date.now());
  quietTimer = setTimeout(
    () => {
      refresh();
      arm();
    },
    Math.max(1000, wait)
  );
}

function holdAuth() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (authTimer) clearTimeout(authTimer);
  authTimer = setTimeout(
    () => {
      authHold = false;
      refresh();
      arm();
    },
    30 * 60 * 1000
  );
  render();
}

function arm() {
  if (pollTimer) clearTimeout(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  if (clockTimer) clearInterval(clockTimer);
  pollTimer = null;
  tickTimer = null;
  clockTimer = null;
  if (!packOn() || !leader) return;
  tickTimer = setInterval(localTick, TICK_MS);
  clockTimer = setInterval(() => {
    paintClock();
    const today = isoFromDate(Date.now());
    const row = snapshot.days[today];
    const stamp = row && row.fetchedAt;
    if (snapshot.ready && isNotCurrent(stamp, Date.now(), STALE_MS)) render();
  }, 1000);
  const schedule = () => {
    pollTimer = setTimeout(
      async () => {
        if (!authHold && shouldFetch({ packOn: packOn(), visible: visible() })) await refresh();
        if (!authHold) schedule();
      },
      backoffMs(pollMsFromConfig(config), failures)
    );
  };
  if (!practiceOpen(Date.now())) armQuiet();
  else schedule();
}

function onVisibility() {
  if (!visible()) return;
  if (authHold) {
    authHold = false;
    if (authTimer) clearTimeout(authTimer);
  }
  refresh();
}

function editorSlots() {
  const nowMs = Date.now();
  const today = isoFromDate(nowMs);
  if (!snapshot.ready) return [];
  return horizonSlots(snapshot.days, today, new Date(nowMs), false);
}

function catalogItem(id) {
  if (!draft || !id) return null;
  const view = setupView(draft, observed, editorSlots(), { query: '', kind: 'all' });
  const chip = view.palette.concat(view.pots.flatMap((pot) => pot.chips)).find((row) => row.id === id);
  if (chip) return { kind: chip.kind, name: chip.name };
  const colon = id.indexOf(':');
  if (colon < 1) return null;
  return { kind: id.slice(0, colon), name: id.slice(colon + 1) };
}

function setEditorStatus(text) {
  if (editorStatus) editorStatus.textContent = text || '';
}

function readPollInto(next) {
  const pollEl = document.getElementById('avPoll');
  if (!pollEl || !next) return next;
  return normaliseConfig({ ...next, pollMinutes: pollEl.value });
}

function paintEditor() {
  if (!draft) return;
  draft = readPollInto(draft);
  const active = document.activeElement;
  const focusId = active && editorBody.contains(active) ? active.id : '';
  const selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const view = setupView(draft, observed, editorSlots(), { query: setupQuery, kind: setupKind });
  editorBody.innerHTML = renderSetup({ ...view, draggingId, dragOver: '', openDetails });
  const undoBtn = document.getElementById('avUndo');
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (selStart != null && el.setSelectionRange) {
        try {
          el.setSelectionRange(selStart, selStart);
        } catch {
          /* number inputs */
        }
      }
    }
  }
}

function applyDraft(next, status) {
  const before = JSON.stringify(draft);
  const normalised = normaliseConfig(next);
  if (JSON.stringify(normalised) === before) {
    if (status) setEditorStatus(status);
    return;
  }
  undoStack = pushUndo(undoStack, draft);
  draft = normalised;
  paintEditor();
  setEditorStatus(status || '');
}

function applyPlace(result, okText) {
  if (!result.ok) {
    setEditorStatus(reasonText(result.reason));
    return;
  }
  const note = result.notice ? ` ${result.notice}` : '';
  applyDraft(result.config, `${okText}${note}`.trim());
}

function inertBehind(on) {
  for (const el of [head, banner, stage]) {
    if (!el) continue;
    if (on) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }
}

function focusables() {
  return [...editor.querySelectorAll('button, input, select, textarea')].filter(
    (el) => !el.disabled && el.offsetParent !== null
  );
}

function draftDirty() {
  if (!draft) return false;
  return JSON.stringify(normaliseConfig(readPollInto(draft))) !== JSON.stringify(normaliseConfig(config));
}

function openEditor() {
  opener = setupBtn;
  draft = normaliseConfig(JSON.parse(JSON.stringify(config)));
  undoStack = [];
  setupQuery = '';
  setupKind = 'all';
  openDetails = [];
  draggingId = '';
  paintEditor();
  editor.hidden = false;
  inertBehind(true);
  const search = document.getElementById('avSetupSearch');
  if (search) search.focus();
  else {
    const first = editor.querySelector('input, button, select');
    if (first) first.focus();
  }
}

function closeEditor() {
  if (draftDirty() && !window.confirm('Close without saving the tile mapping?')) return;
  editor.hidden = true;
  editorBody.innerHTML = '';
  draft = null;
  undoStack = [];
  draggingId = '';
  if (editorStatus) editorStatus.textContent = '';
  inertBehind(false);
  if (opener && typeof opener.focus === 'function') opener.focus();
}

function onSetupPointerDown() {
  holdTimer = setTimeout(() => {
    holdTimer = null;
    openEditor();
  }, 700);
}

function onSetupPointerUp(event) {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
    if (window.confirm('Open tile setup on this TV?')) openEditor();
  }
  event.preventDefault();
}

setupBtn.addEventListener('pointerdown', onSetupPointerDown);
setupBtn.addEventListener('pointerup', onSetupPointerUp);
setupBtn.addEventListener('pointerleave', () => {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = null;
});
setupBtn.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (window.confirm('Open tile setup on this TV?')) openEditor();
  }
});

document.getElementById('avCloseEditor').addEventListener('click', closeEditor);
document.getElementById('avUndo').addEventListener('click', () => {
  if (!draft) return;
  const popped = popUndo(undoStack);
  undoStack = popped.stack;
  if (!popped.config) return;
  draft = popped.config;
  paintEditor();
  setEditorStatus('Undone. Not saved until you press Save.');
});
document.getElementById('avAddTile').addEventListener('click', () => {
  if (!draft) return;
  const tile = blankTile();
  tile.matchOrder = draft.tiles.length;
  tile.displayOrder = draft.tiles.length + 1;
  const next = normaliseConfig(readPollInto(draft));
  next.tiles.push(tile);
  applyDraft(normaliseConfig(next), 'Added a tile. Not saved until you press Save.');
});
document.getElementById('avResetTiles').addEventListener('click', () => {
  if (!draft) return;
  if (!window.confirm('Replace the current mapping with the suggested names? Nothing is saved until you press Save.'))
    return;
  const poll = readPollInto(draft).pollMinutes;
  applyDraft(
    normaliseConfig({ pollMinutes: poll, confirmed: false, tiles: defaultTiles() }),
    'Suggested names are on the canvas. Not saved until you press Save.'
  );
});
document.getElementById('avSaveTiles').addEventListener('click', async () => {
  if (!draft) return;
  const next = normaliseConfig({ ...readPollInto(draft), confirmed: true });
  try {
    await window.availabilityImport({ config: next });
  } catch (err) {
    if (contextDead(err)) showReload();
    setEditorStatus('The mapping was not saved. Try Save again.');
    return;
  }
  config = next;
  undoStack = [];
  editor.hidden = true;
  editorBody.innerHTML = '';
  draft = null;
  draggingId = '';
  if (editorStatus) editorStatus.textContent = '';
  inertBehind(false);
  if (opener && typeof opener.focus === 'function') opener.focus();
  arm();
  render();
});

editor.addEventListener('keydown', (event) => {
  if (editor.hidden) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeEditor();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusables();
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

editorBody.addEventListener('input', (event) => {
  if (event.target.id !== 'avSetupSearch') return;
  setupQuery = event.target.value;
  paintEditor();
});

editorBody.addEventListener('toggle', (event) => {
  const details = event.target.closest('[data-details]');
  if (!details) return;
  const key = details.dataset.details;
  if (details.open) {
    if (!openDetails.includes(key)) openDetails = openDetails.concat(key);
  } else {
    openDetails = openDetails.filter((item) => item !== key);
  }
});

editorBody.addEventListener('change', (event) => {
  if (!draft) return;
  const map = event.target.closest('[data-map-item]');
  if (map) {
    const item = catalogItem(map.dataset.mapItem);
    if (!item) return;
    const tileId = map.value || null;
    const tile = tileId && draft.tiles.find((row) => row.id === tileId);
    const result = placeItem(readPollInto(draft), item, tileId);
    const name = item.name;
    const where = tile ? tile.label : 'Not on a tile';
    applyPlace(result, result.ok ? `${name} is on ${where}. Not saved until you press Save.` : '');
    return;
  }
  const rule = event.target.closest('[data-rule]');
  if (rule) {
    const pot = rule.closest('[data-drop]');
    if (!pot || pot.dataset.drop === 'palette') return;
    const [bucket, kind] = rule.dataset.rule.split('.');
    const values = String(rule.value || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const next = normaliseConfig(readPollInto(draft));
    next.tiles = next.tiles.map((tile) => {
      if (tile.id !== pot.dataset.drop) return tile;
      return { ...tile, [bucket]: { ...tile[bucket], [kind]: values } };
    });
    applyDraft(next, 'Pattern rule updated. Not saved until you press Save.');
    return;
  }
  const label = event.target.closest('[data-tile-label]');
  if (label) {
    const next = normaliseConfig(readPollInto(draft));
    next.tiles = next.tiles.map((tile) =>
      tile.id === label.dataset.tileLabel ? { ...tile, label: label.value } : tile
    );
    applyDraft(next, 'Tile name updated. Not saved until you press Save.');
    return;
  }
  const field = event.target.closest('[data-tile-field]');
  if (field) {
    const next = normaliseConfig(readPollInto(draft));
    const value = field.dataset.tileField === 'weekLane' ? field.value || null : field.value;
    next.tiles = next.tiles.map((tile) =>
      tile.id === field.dataset.tile ? { ...tile, [field.dataset.tileField]: value } : tile
    );
    applyDraft(next, 'Tile settings updated. Not saved until you press Save.');
    return;
  }
  const flag = event.target.closest('[data-tile-flag]');
  if (flag) {
    const next = normaliseConfig(readPollInto(draft));
    next.tiles = next.tiles.map((tile) =>
      tile.id === flag.dataset.tile ? { ...tile, [flag.dataset.tileFlag]: flag.checked } : tile
    );
    applyDraft(next, 'Tile settings updated. Not saved until you press Save.');
    return;
  }
  if (event.target.id === 'avPoll') {
    applyDraft(readPollInto(draft), 'Refresh interval updated. Not saved until you press Save.');
  }
});

editorBody.addEventListener('dragstart', (event) => {
  const handle = event.target.closest('[data-drag-item]');
  if (!handle || !event.dataTransfer) return;
  draggingId = handle.dataset.dragItem;
  event.dataTransfer.setData('text/plain', draggingId);
  event.dataTransfer.effectAllowed = 'move';
  handle.classList.add('is-dragging');
});

editorBody.addEventListener('dragend', () => {
  draggingId = '';
  editorBody.querySelectorAll('.is-over, .is-dragging').forEach((el) => {
    el.classList.remove('is-over', 'is-dragging');
  });
});

editorBody.addEventListener('dragover', (event) => {
  const zone = event.target.closest('[data-drop]');
  if (!zone || !draggingId) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  editorBody.querySelectorAll('[data-drop].is-over').forEach((el) => el.classList.remove('is-over'));
  zone.classList.add('is-over');
});

editorBody.addEventListener('drop', (event) => {
  const zone = event.target.closest('[data-drop]');
  if (!zone || !draft) return;
  event.preventDefault();
  const id = (event.dataTransfer && event.dataTransfer.getData('text/plain')) || draggingId;
  draggingId = '';
  const item = catalogItem(id);
  if (!item) return;
  const dest = zone.dataset.drop === 'palette' ? null : zone.dataset.drop;
  const tile = dest && draft.tiles.find((row) => row.id === dest);
  const result = placeItem(readPollInto(draft), item, dest);
  const where = tile ? tile.label : 'Not on a tile';
  applyPlace(result, result.ok ? `${item.name} is on ${where}. Not saved until you press Save.` : '');
});

editorBody.addEventListener('click', (event) => {
  if (!draft) return;
  const kindBtn = event.target.closest('[data-kind]');
  if (kindBtn) {
    setupKind = kindBtn.dataset.kind || 'all';
    paintEditor();
    return;
  }
  const move = event.target.closest('[data-move]');
  if (move) {
    const tileId = move.dataset.tile;
    const next = normaliseConfig(JSON.parse(JSON.stringify(readPollInto(draft))));
    const ordered = next.tiles.slice().sort((a, b) => a.matchOrder - b.matchOrder);
    const index = ordered.findIndex((tile) => tile.id === tileId);
    const nextIndex = index + Number(move.dataset.move);
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const [row] = ordered.splice(index, 1);
    ordered.splice(nextIndex, 0, row);
    ordered.forEach((tile, i) => {
      tile.matchOrder = i;
    });
    next.tiles = ordered;
    applyDraft(next, 'Match order updated. Not saved until you press Save.');
    return;
  }
  const pin = event.target.closest('[data-pin-item]');
  if (pin) {
    const item = catalogItem(pin.dataset.pinItem);
    if (!item) return;
    const result = placeItem(readPollInto(draft), item, pin.dataset.pinPot);
    const tile = draft.tiles.find((row) => row.id === pin.dataset.pinPot);
    applyPlace(result, result.ok ? `${item.name} is pinned to ${tile ? tile.label : 'that tile'}. Not saved until you press Save.` : '');
    return;
  }
  const remove = event.target.closest('[data-remove-item]');
  if (!remove) return;
  const item = catalogItem(remove.dataset.removeItem);
  if (!item) return;
  const result = removeFromPot(readPollInto(draft), item, remove.dataset.removePot);
  applyPlace(result, result.ok ? `${item.name} removed. Not saved until you press Save.` : '');
});

document.getElementById('avStopFlash').addEventListener('click', () => {
  stopFlash = !stopFlash;
  try {
    sessionStorage.setItem('av-stop-flash', stopFlash ? '1' : '0');
  } catch {
    /* this tab only */
  }
  document.getElementById('avStopFlash').textContent = stopFlash ? 'Flashing is off' : 'Stop flashing';
  render();
});

document.getElementById('avCopy').addEventListener('click', async () => {
  try {
    const url = chrome.runtime.getURL('availability/wall.html');
    if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(url);
    noteEl.textContent = 'TV link copied.';
  } catch (err) {
    if (contextDead(err)) showReload();
  }
});

document.getElementById('avFull').addEventListener('click', () => {
  const root = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen();
  else if (root.requestFullscreen) root.requestFullscreen();
});

readMotion();
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq.addEventListener) {
    mq.addEventListener('change', () => {
      readMotion();
      render();
    });
  }
}

document.addEventListener('visibilitychange', onVisibility);

if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (!tab || !tab.url || !/medicus\.health/i.test(tab.url)) return;
    if (info.status !== 'complete') return;
    if (!pinnedCode) refresh();
  });
}

function claimLock() {
  const start = () => {
    leader = true;
    arm();
    refresh();
  };
  if (!navigator.locks || !navigator.locks.request) {
    start();
    return;
  }
  navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
    if (!lock) {
      leader = false;
      paintMessage('Another availability tab is reading the book. This screen will take over if that tab closes.');
      setTimeout(claimLock, 30000);
      return undefined;
    }
    start();
    return new Promise(() => {});
  });
}

window.PracticePacks.read(window.PracticePacks.KEYS.availabilityWall).then(async () => {
  try {
    await loadConfig();
  } catch (err) {
    if (contextDead(err)) showReload();
    return;
  }
  if (!packOn()) {
    paintMessage('The availability wall is switched off. Turn it on under Settings, Practice features.');
    return;
  }
  claimLock();
});

window.PracticePacks.watch(window.PracticePacks.KEYS.availabilityWall, async (on) => {
  if (!on) {
    if (pollTimer) clearTimeout(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
    if (clockTimer) clearInterval(clockTimer);
    paintMessage('The availability wall is switched off. Turn it on under Settings, Practice features.');
    return;
  }
  await loadConfig();
  if (!leader) claimLock();
  else {
    arm();
    refresh();
  }
});
