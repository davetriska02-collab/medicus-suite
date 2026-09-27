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
let selectedTile = 0;
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
    <p class="av-kicker">${glyph(view.id)}${esc(face.label)}</p>
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
        ? `${n} free slot${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} not on a tile yet. Press and hold Set up tiles, then save a mapping. Nothing is shown as None left from a guess.`
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

function chipList(title, names, field) {
  if (!names.length) return '';
  const chips = names
    .map((n) => {
      const tileName = (config.tiles[selectedTile] && config.tiles[selectedTile].label) || 'tile';
      return `<button type="button" data-add-field="${esc(field)}" data-add-value="${esc(n)}" aria-label="Add ${esc(n)} to ${esc(tileName)}">${esc(n)}</button>`;
    })
    .join('');
  return `<div><strong>${esc(title)}</strong><div class="av-observed">${chips}</div></div>`;
}

function renderEditor() {
  const tiles = config.tiles
    .slice()
    .sort((a, b) => a.matchOrder - b.matchOrder)
    .map((t, i) => {
      const m = t.match || { types: [], sessions: [], roles: [] };
      const x = t.exclude || { types: [], sessions: [], roles: [] };
      return `<fieldset class="av-tile-edit" data-index="${i}">
        <legend>${esc(t.label || 'Tile')}</legend>
        <div class="av-row">
          <label><input type="radio" name="avSel" ${i === selectedTile ? 'checked' : ''} data-sel="${i}" /> Selected tile ${esc(t.label || 'Tile')}</label>
          <label>Name <input type="text" data-k="label" value="${esc(t.label)}" /></label>
          <label>Subtitle <input type="text" data-k="subtitle" value="${esc(t.subtitle || '')}" /></label>
          <label><input type="checkbox" data-k="hidden" ${t.hidden ? 'checked' : ''} /> Hide</label>
          <label><input type="checkbox" data-k="showOnToday" ${t.showOnToday ? 'checked' : ''} /> Today</label>
          <label><input type="checkbox" data-k="immediate" ${t.immediate !== false ? 'checked' : ''} /> For immediate booking</label>
          <label>Week
            <select data-k="weekLane">
              <option value="" ${!t.weekLane ? 'selected' : ''}>Not in the 7-day view</option>
              <option value="routine" ${t.weekLane === 'routine' ? 'selected' : ''}>Routine GP</option>
              <option value="extended" ${t.weekLane === 'extended' ? 'selected' : ''}>Extended access</option>
            </select>
          </label>
          <button type="button" data-move="-1">Match sooner</button>
          <button type="button" data-move="1">Match later</button>
        </div>
        <div class="av-row"><label>Slot types <input type="text" data-k="match.types" value="${esc(m.types.join(', '))}" /></label></div>
        <div class="av-row"><label>Session or diary names <input type="text" data-k="match.sessions" value="${esc(m.sessions.join(', '))}" /></label></div>
        <div class="av-row"><label>Clinician roles <input type="text" data-k="match.roles" value="${esc(m.roles.join(', '))}" /></label></div>
        <div class="av-row"><label>Exclude types <input type="text" data-k="exclude.types" value="${esc(x.types.join(', '))}" /></label></div>
        <div class="av-row"><label>Exclude sessions <input type="text" data-k="exclude.sessions" value="${esc(x.sessions.join(', '))}" /></label></div>
        <div class="av-row"><label>Exclude roles <input type="text" data-k="exclude.roles" value="${esc(x.roles.join(', '))}" /></label></div>
      </fieldset>`;
    })
    .join('');
  editorBody.innerHTML = `
    <div class="av-row"><label>Refresh every
      <input type="number" id="avPoll" min="2" max="30" step="1" value="${esc(config.pollMinutes)}" /> minutes (2–30). Today uses this. Later days are every 30 minutes, and nothing runs from 19:00 to 07:00.
    </label></div>
    <p>Names seen on the last reading. Choose a tile, then add a name to it.</p>
    ${chipList('Slot types', observed.slotTypes, 'match.types')}
    ${chipList('Sessions', observed.sessions, 'match.sessions')}
    ${chipList('Diaries', observed.clinicians, 'match.roles')}
    ${tiles}`;
}

function readEditor() {
  const pollEl = document.getElementById('avPoll');
  const sections = [...editorBody.querySelectorAll('.av-tile-edit')];
  const ordered = config.tiles.slice().sort((a, b) => a.matchOrder - b.matchOrder);
  const tiles = sections.map((section, i) => {
    const val = (k) => section.querySelector(`[data-k="${k}"]`);
    const split = (k) =>
      String(val(k).value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const base = ordered[i] || blankTile();
    return {
      id: base.id,
      label: val('label').value,
      subtitle: val('subtitle').value,
      hidden: val('hidden').checked,
      showOnToday: val('showOnToday').checked,
      immediate: val('immediate').checked,
      weekLane: val('weekLane').value || null,
      displayOrder: base.displayOrder,
      matchOrder: i,
      match: { types: split('match.types'), sessions: split('match.sessions'), roles: split('match.roles') },
      exclude: { types: split('exclude.types'), sessions: split('exclude.sessions'), roles: split('exclude.roles') },
    };
  });
  config = normaliseConfig({
    pollMinutes: pollEl ? pollEl.value : config.pollMinutes,
    confirmed: config.confirmed,
    tiles,
  });
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

function openEditor() {
  opener = setupBtn;
  renderEditor();
  editor.hidden = false;
  inertBehind(true);
  const first = editor.querySelector('input, button, select');
  if (first) first.focus();
}

function closeEditor() {
  editor.hidden = true;
  editorBody.innerHTML = '';
  if (editorStatus) editorStatus.textContent = '';
  observed = { slotTypes: [], sessions: [], clinicians: [], sites: [] };
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
document.getElementById('avAddTile').addEventListener('click', () => {
  readEditor();
  const tile = blankTile();
  tile.matchOrder = config.tiles.length;
  config.tiles.push(tile);
  config = normaliseConfig(config);
  selectedTile = config.tiles.length - 1;
  renderEditor();
});
document.getElementById('avResetTiles').addEventListener('click', () => {
  if (!window.confirm('Replace the current mapping with the suggested names? Nothing is saved until you press Save.'))
    return;
  config = normaliseConfig({ pollMinutes: config.pollMinutes, confirmed: false, tiles: defaultTiles() });
  renderEditor();
});
document.getElementById('avSaveTiles').addEventListener('click', async () => {
  readEditor();
  config = normaliseConfig({ ...config, confirmed: true });
  try {
    await window.availabilityImport({ config });
  } catch (err) {
    if (contextDead(err)) showReload();
    return;
  }
  closeEditor();
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

editorBody.addEventListener('click', (event) => {
  const move = event.target.closest('[data-move]');
  if (move) {
    readEditor();
    const index = Number(move.closest('.av-tile-edit').dataset.index);
    const next = index + Number(move.dataset.move);
    if (next >= 0 && next < config.tiles.length) {
      const ordered = config.tiles.slice().sort((a, b) => a.matchOrder - b.matchOrder);
      const [row] = ordered.splice(index, 1);
      ordered.splice(next, 0, row);
      ordered.forEach((t, i) => {
        t.matchOrder = i;
      });
      config = normaliseConfig({ ...config, tiles: ordered });
      selectedTile = next;
      renderEditor();
    }
    return;
  }
  const sel = event.target.closest('[data-sel]');
  if (sel) selectedTile = Number(sel.dataset.sel);
  const add = event.target.closest('[data-add-value]');
  if (!add) return;
  const section = editorBody.querySelector(`.av-tile-edit[data-index="${selectedTile}"]`);
  const input = section && section.querySelector(`[data-k="${add.dataset.addField}"]`);
  if (!input) return;
  const cur = input.value.trim();
  input.value = cur ? `${cur}, ${add.dataset.addValue}` : add.dataset.addValue;
  const tileName = (config.tiles[selectedTile] && config.tiles[selectedTile].label) || 'tile';
  if (editorStatus) editorStatus.textContent = `Added ${add.dataset.addValue} to ${tileName}`;
  input.focus();
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
