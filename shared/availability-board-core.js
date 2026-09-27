// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — availability wall (pure). No DOM, no chrome, no fetch.
//
// One day's free slots come from
// GET /scheduling/data/appointment-book/embedded-overview?date=YYYY-MM-DD&filterByUsualLocation=false
// The wall page polls today on the practice interval and the other six days
// every 30 minutes, and only between 07:00 and 19:00 Europe/London.

'use strict';

import { bankHolidayTitle, isBankHoliday } from './uk-calendar.js';

export const DEFAULT_POLL_MS = 5 * 60 * 1000;
export const MIN_POLL_MS = 2 * 60 * 1000;
export const MAX_POLL_MS = 30 * 60 * 1000;
export const WEEK_POLL_MS = 30 * 60 * 1000;
export const STALE_MS = 10 * 60 * 1000;
export const TICK_MS = 20 * 1000;
export const FETCH_TIMEOUT_MS = 20 * 1000;
export const WEEK_DAYS = 7;
export const REQUESTS_PER_REFRESH = WEEK_DAYS;
export const QUIET_FROM_HOUR = 19;
export const QUIET_UNTIL_HOUR = 7;
export const LONDON = 'Europe/London';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REMOTE_WORD = /^(telephone|phone|remote|video)$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

export function londonParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

function londonOffsetMs(ms) {
  const p = londonParts(ms);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - ms;
}

function londonWallToMs(y, mo, d, h, mi, s) {
  let ms = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  for (let i = 0; i < 3; i++) {
    const next = Date.UTC(y, mo - 1, d, h, mi, s || 0) - londonOffsetMs(ms);
    if (next === ms) break;
    ms = next;
  }
  return ms;
}

export function hostIsLondon() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone === LONDON;
  } catch {
    return false;
  }
}

/** 'zone' or 'skew' means the wall must not show a countdown. */
export function clockProblem(nowMs, serverMs) {
  if (!hostIsLondon()) return 'zone';
  if (typeof serverMs === 'number' && Math.abs(serverMs - nowMs) > 2 * 60 * 1000) return 'skew';
  return null;
}

export function londonISO(ms) {
  const p = londonParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

export function isoFromDate(d) {
  const ms = d instanceof Date ? d.getTime() : Number(d);
  return londonISO(ms);
}

export function addDaysISO(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function weekDates(todayISO) {
  const out = [];
  for (let i = 0; i < WEEK_DAYS; i++) out.push(i === 0 ? todayISO : addDaysISO(todayISO, i));
  return out;
}

export function isWeekendISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return [0, 6].includes(new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay());
}

export function dayLabel(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${WEEKDAY[dt.getUTCDay()]} ${d}`;
}

export function dayHeading(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return `${WEEKDAY[dt.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

export function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T12:00:00Z`);
  const b = Date.parse(`${toISO}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function clockLabel(ms) {
  const p = londonParts(ms);
  return `${p.hour}:${p.minute}`;
}

export function shortDateLabel(ms) {
  const p = londonParts(ms);
  const month = MONTHS[+p.month - 1];
  return `${p.weekday} ${Number(p.day)} ${month}`;
}

export function practiceOpen(ms) {
  const h = Number(londonParts(ms).hour);
  return h >= QUIET_UNTIL_HOUR && h < QUIET_FROM_HOUR;
}

export function msUntilOpen(now) {
  if (practiceOpen(now)) return 0;
  const p = londonParts(now);
  const iso = `${p.year}-${p.month}-${p.day}`;
  const target = Number(p.hour) >= QUIET_FROM_HOUR ? addDaysISO(iso, 1) : iso;
  const [y, m, d] = target.split('-').map(Number);
  return Math.max(0, londonWallToMs(y, m, d, QUIET_UNTIL_HOUR, 0, 0) - now);
}

/**
 * Today on every poll. The other six days when they have never been read
 * this session, or the last week read is 30 minutes old. Nothing overnight.
 */
export function planRefresh({ now, lastWeekAt, todayISO, dates }) {
  if (!practiceOpen(now)) return { dates: [], quiet: true };
  const today = todayISO || londonISO(now);
  const all = dates && dates.length ? dates : weekDates(today);
  const out = [all[0]];
  if (lastWeekAt == null || now - lastWeekAt >= WEEK_POLL_MS) out.push(...all.slice(1));
  return { dates: out, quiet: false };
}

export function backoffMs(pollMs, failures) {
  const steps = Math.min(3, Math.max(0, failures | 0));
  return pollMs * 2 ** steps;
}

export function isNotCurrent(fetchedAt, now, staleMs) {
  if (fetchedAt == null) return false;
  return now - fetchedAt >= (staleMs || STALE_MS);
}

/** Wall-clock digits are Europe/London. A Z or numeric offset is that instant. */
export function parseLocalDateTime(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s.includes(' ') ? s.replace(' ', 'T') : s);
    return Number.isNaN(t) ? null : t;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  return londonWallToMs(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
}

export function overviewPath(dateISO) {
  return `/scheduling/data/appointment-book/embedded-overview?date=${dateISO}&filterByUsualLocation=false`;
}

function clip(s, n) {
  return String(s || '')
    .trim()
    .slice(0, n);
}

/** Fold punctuation to spaces, then join single-letter runs (H.C.A. → hca). */
export function foldText(s) {
  let t = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/\b(?:[a-z] )+[a-z]\b/g, (m) => m.replace(/ /g, ''));
  return t;
}

function tokensOf(s) {
  const f = foldText(s);
  return f ? f.split(' ') : [];
}

function needleOk(needle) {
  const n = foldText(needle);
  if (!n || n.replace(/ /g, '').length < 3 || n.length > 60) return false;
  return true;
}

/** Whole tokens, in order. "non" in front of the phrase does not count. */
function needleHits(hay, needle) {
  const n = foldText(needle);
  if (!needleOk(n)) return false;
  const ht = tokensOf(hay);
  const nt = n.split(' ');
  if (!ht.length) return false;
  if (nt.length === 1 && nt[0] === 'phlebotom') return ht.some((t) => t.startsWith('phlebotom'));
  for (let i = 0; i + nt.length <= ht.length; i++) {
    let ok = true;
    for (let j = 0; j < nt.length; j++) {
      if (ht[i + j] !== nt[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (ht[i - 1] === 'non') continue;
    return true;
  }
  return false;
}

function haystackHits(hay, needles) {
  return (needles || []).some((n) => n && needleHits(hay, n));
}

function textOf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object') {
    if (typeof node.name === 'string') return node.name;
    if (typeof node.value === 'string' && node.value) return node.value;
    if (typeof node.label === 'string') return node.label;
  }
  return '';
}

function normName(s) {
  return foldText(s)
    .replace(/\b(dr|doctor|mr|mrs|ms|miss)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function roleIndex(staff) {
  const map = {};
  for (const person of Array.isArray(staff) ? staff : []) {
    if (!person || typeof person !== 'object') continue;
    const hints = [];
    for (const key of ['role', 'employmentType']) {
      const v = foldText(person[key]);
      if (v) hints.push(v);
    }
    if (!hints.length) continue;
    for (const raw of [person.name, person.medicusName]) {
      const key = normName(raw);
      if (key && !map[key]) map[key] = hints.slice();
    }
  }
  return map;
}

/**
 * Exact normalised name, or every token of the rota name as a whole token
 * of the diary name. The longest match wins. A tie matches nobody.
 * Smith does not match Smithson. Anna does not match Annabelle.
 */
function hintsFor(name, index) {
  if (!index || !name) return [];
  const key = normName(name);
  if (!key) return [];
  if (index[key]) return index[key].slice();
  const diaryTokens = key.split(' ').filter(Boolean);
  let best = null;
  let bestLen = 0;
  let tie = false;
  for (const [k, hints] of Object.entries(index)) {
    const kt = k.split(' ').filter(Boolean);
    if (!kt.length || kt.length >= diaryTokens.length) continue;
    const pool = diaryTokens.slice();
    let ok = true;
    for (const t of kt) {
      const at = pool.indexOf(t);
      if (at < 0) {
        ok = false;
        break;
      }
      pool.splice(at, 1);
    }
    if (!ok) continue;
    if (kt.length > bestLen) {
      best = hints;
      bestLen = kt.length;
      tie = false;
    } else if (kt.length === bestLen) tie = true;
  }
  if (tie || !best) return [];
  return best.slice();
}

function payloadRoleHints(staff) {
  const out = [];
  if (!staff || typeof staff !== 'object') return out;
  for (const key of ['jobRole', 'jobRoleName', 'roleName']) {
    const v = textOf(staff[key]) || (typeof staff[key] === 'string' ? staff[key] : '');
    const n = foldText(v);
    if (n) out.push(n);
  }
  return out;
}

function deliveryOf(entry, summary) {
  const raw =
    textOf(entry && entry.deliveryMode) ||
    textOf(entry && entry.defaultDeliveryMode) ||
    textOf(summary && summary.defaultDeliveryMode);
  return foldText(raw);
}

function siteOf(entry, summary) {
  return clip(textOf(summary && summary.site) || textOf(entry && entry.site), 80);
}

function sessionBits(session) {
  const summary = (session && session.summary) || {};
  const service = textOf(summary.service);
  const defType = textOf(summary.defaultAppointmentType);
  return {
    sessionName: clip(service, 80),
    service,
    defaultType: clip(defType, 80),
    site: siteOf(null, summary),
    delivery: deliveryOf(null, summary),
  };
}

function patientIdOf(entry) {
  const p = entry && entry.patient;
  if (!p || typeof p !== 'object') return '';
  return String(p.id || p.patientId || p.uuid || '');
}

function endMsOf(entry, startMs) {
  const parsed = parseLocalDateTime(entry && entry.endDateTime);
  if (parsed != null && parsed > startMs) return parsed;
  const dur = Number(entry && entry.duration);
  if (Number.isFinite(dur) && dur > 0) return startMs + dur * 60 * 1000;
  return startMs + 60 * 1000;
}

export function bookPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Array.isArray(raw.staffSchedules)) return raw;
  if (raw.data && typeof raw.data === 'object' && Array.isArray(raw.data.staffSchedules)) return raw.data;
  return null;
}

function sessionUnexpanded(session) {
  const entries = session && session.entries;
  if (Array.isArray(entries) && entries.length > 0) return false;
  const summary = (session && session.summary) || {};
  const start = (session && session.startDateTime) || summary.startDateTime;
  const end = (session && session.endDateTime) || summary.endDateTime;
  const dur = Number(summary.usualAppointmentDuration) || Number(session && session.usualAppointmentDuration) || 0;
  return !!(start && end && dur > 0);
}

/**
 * Free slots only. A row counts when diaryEntryType.value is exactly 'slot',
 * it is not a break, a hold, or a patient booking, and it has not ended.
 * summary.name, summary.title and session.name are not kept.
 */
export function extractFreeSlots(raw, opts) {
  const book = bookPayload(raw);
  if (!book) return { ok: false, slots: null, observed: emptyObserved(), sessionCount: 0, unexpanded: false };
  const options = opts || {};
  const nowMs = (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).getTime();
  const dropPast = options.dropPast !== false;
  const index = options.roleIndex || {};
  const slots = [];
  const seen = { types: new Set(), sessions: new Set(), clinicians: new Set(), sites: new Set() };
  const seenIds = new Set();
  let sessionCount = 0;
  let unexpanded = false;

  function walk(staffName, staff, sessions) {
    const clinician = clip(staffName || 'Unassigned', 80) || 'Unassigned';
    const roleHints = payloadRoleHints(staff).concat(hintsFor(clinician, index));
    (sessions || []).forEach((session) => {
      if (!session || session.scheduleType === 'unavailability-period') return;
      if (session.summary && session.summary.status && session.summary.status.isCancelled) return;
      sessionCount += 1;
      if (sessionUnexpanded(session)) unexpanded = true;
      const bits = sessionBits(session);
      if (bits.sessionName) seen.sessions.add(bits.sessionName);
      if (clinician) seen.clinicians.add(clinician);
      if (bits.site) seen.sites.add(bits.site);
      (session.entries || []).forEach((entry) => {
        if (!entry) return;
        const kind = entry.diaryEntryType || {};
        if (kind.value !== 'slot') return;
        if (entry.isStaffBreakAssignment) return;
        if (patientIdOf(entry) || entry.slotReservationId) return;
        const id = entry.id != null ? String(entry.id) : entry.entryId != null ? String(entry.entryId) : '';
        if (id) {
          if (seenIds.has(id)) return;
          seenIds.add(id);
        }
        const slotType = clip(textOf(entry.appointmentType) || bits.defaultType, 80);
        if (slotType) seen.types.add(slotType);
        const startMs = parseLocalDateTime(entry.startDateTime);
        if (startMs == null) return;
        const endMs = endMsOf(entry, startMs);
        if (dropPast && endMs <= nowMs) return;
        const delivery = deliveryOf(entry, session.summary) || bits.delivery;
        const site = siteOf(entry, session.summary) || bits.site;
        if (site) seen.sites.add(site);
        const sessionHaystack = [bits.service, bits.defaultType, clinician].filter(Boolean).join(' ');
        slots.push({
          id,
          startMs,
          endMs,
          dateISO: londonISO(startMs),
          slotType,
          sessionName: bits.sessionName,
          sessionHaystack,
          clinician,
          roleHints: [...new Set(roleHints)],
          site,
          delivery,
        });
      });
    });
  }

  (book.staffSchedules || []).forEach((staff) => {
    walk(staff && staff.name, staff, staff && staff.schedule);
  });
  if (Array.isArray(book.unassignedDiaries) && book.unassignedDiaries.length) {
    walk('Unassigned', null, book.unassignedDiaries);
  }

  slots.sort((a, b) => a.startMs - b.startMs || a.clinician.localeCompare(b.clinician));
  return {
    ok: true,
    slots,
    observed: {
      slotTypes: [...seen.types].sort((a, b) => a.localeCompare(b)),
      sessions: [...seen.sessions].sort((a, b) => a.localeCompare(b)),
      clinicians: [...seen.clinicians].sort((a, b) => a.localeCompare(b)),
      sites: [...seen.sites].sort((a, b) => a.localeCompare(b)),
    },
    sessionCount,
    unexpanded,
    noClinic: sessionCount === 0,
  };
}

function emptyObserved() {
  return { slotTypes: [], sessions: [], clinicians: [], sites: [] };
}

export function dropPastSlots(slots, now) {
  const nowMs = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  return (slots || []).filter((s) => s && typeof s.endMs === 'number' && s.endMs > nowMs);
}

/** Slots the today tiles can show, including a later day in the seven-day window. */
export function horizonSlots(days, today, now, freeze) {
  const out = [];
  for (const date of weekDates(today)) {
    const row = days && days[date];
    if (!row || !Array.isArray(row.slots)) continue;
    if (row.stale && date !== today) continue;
    if (date === today && !freeze) out.push(...dropPastSlots(row.slots, now));
    else out.push(...row.slots);
  }
  return out;
}

function blankRule() {
  return { types: [], sessions: [], roles: [] };
}

function listOf(raw, max) {
  const src = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of src) {
    const v = foldText(item);
    if (!needleOk(v)) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function ruleFrom(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    types: listOf(src.types, 16),
    sessions: listOf(src.sessions, 16),
    roles: listOf(src.roles, 16),
  };
}

let _customSeq = 0;
function newCustomId() {
  _customSeq += 1;
  return `custom-${_customSeq}`;
}

const EMBARGO_WORDS = ['embargo', '3-day', '3 day', '3 days', 'three day', 'three days'];
const EXTENDED_WORDS = ['extended access', 'enhanced access', 'extended hours', 'enhanced hours', 'hub'];
const OTD_WORDS = [
  'on the day',
  'on-the-day',
  'same day',
  'same-day',
  'duty',
  'triage',
  'acute',
  'urgent',
  'book on day',
];

function tile(id, label, displayOrder, match, extra) {
  const more = extra || {};
  return {
    id,
    label,
    subtitle: more.subtitle || '',
    hidden: false,
    showOnToday: more.showOnToday !== false,
    weekLane: more.weekLane || null,
    displayOrder,
    matchOrder: 0,
    immediate: more.immediate !== false,
    match,
    exclude: more.exclude || blankRule(),
  };
}

export function defaultTiles() {
  const rows = [
    tile(
      'visits',
      'Visits',
      3,
      { types: ['visit', 'home visit'], sessions: ['visit', 'home visit'], roles: ['visit'] },
      { subtitle: 'Home visits' }
    ),
    tile(
      'embargo-gp',
      '3-day embargo GP',
      7,
      { types: EMBARGO_WORDS, sessions: EMBARGO_WORDS, roles: EMBARGO_WORDS },
      { subtitle: 'Booked ahead', immediate: false }
    ),
    tile(
      'extended',
      'Extended access',
      8,
      { types: EXTENDED_WORDS, sessions: EXTENDED_WORDS, roles: EXTENDED_WORDS },
      { subtitle: 'Outside the weekday list', showOnToday: false, weekLane: 'extended' }
    ),
    tile(
      'anp',
      'ANP',
      5,
      {
        types: ['anp', 'nurse practitioner', 'advanced nurse'],
        sessions: ['anp', 'nurse practitioner', 'advanced nurse'],
        roles: ['anp', 'nurse practitioner', 'advanced nurse'],
      },
      { subtitle: 'Nurse practitioner' }
    ),
    tile(
      'nursing',
      'Nursing / HCA',
      2,
      {
        types: ['nurse', 'nursing', 'hca', 'health care assistant', 'healthcare assistant', 'phlebotom'],
        sessions: ['nurse', 'nursing', 'hca', 'health care assistant', 'healthcare assistant', 'phlebotom'],
        roles: ['nurse', 'nursing', 'hca', 'phlebotomist'],
      },
      {
        subtitle: 'Nurse and HCA',
        exclude: {
          types: ['nurse practitioner', 'anp', 'advanced nurse'],
          sessions: ['nurse practitioner', 'anp', 'advanced nurse'],
          roles: ['anp', 'nurse practitioner', 'advanced nurse'],
        },
      }
    ),
    tile(
      'otd-gp',
      'On-the-day GP',
      1,
      { types: OTD_WORDS, sessions: OTD_WORDS, roles: ['duty'] },
      { subtitle: 'On the day' }
    ),
    tile(
      'registrar',
      'Registrar / additional GP',
      4,
      {
        types: ['registrar', 'trainee', 'gpst', 'additional gp', 'extra gp'],
        sessions: ['registrar', 'trainee', 'gpst', 'additional gp', 'extra gp'],
        roles: ['registrar', 'gpst', 'trainee'],
      },
      {
        subtitle: 'Registrar list',
        weekLane: 'routine',
        exclude: {
          types: OTD_WORDS,
          sessions: OTD_WORDS,
          roles: [],
        },
      }
    ),
    tile(
      'routine-gp',
      'Pre-bookable routine GP',
      6,
      {
        types: ['routine', 'pre-book', 'prebook', 'pre book'],
        sessions: ['routine', 'pre-book', 'prebook', 'pre book'],
        roles: [],
      },
      {
        subtitle: 'Pre-bookable',
        weekLane: 'routine',
        exclude: {
          types: [...OTD_WORDS, ...EMBARGO_WORDS, ...EXTENDED_WORDS, 'visit', 'telephone'],
          sessions: [...OTD_WORDS, ...EMBARGO_WORDS, ...EXTENDED_WORDS, 'visit', 'telephone'],
          roles: ['registrar', 'anp', 'nurse', 'nursing', 'hca', ...EMBARGO_WORDS, ...EXTENDED_WORDS],
        },
      }
    ),
  ];
  rows.forEach((row, i) => {
    row.matchOrder = i;
  });
  return rows;
}

const ID_RE = /^[a-z0-9-]{1,40}$/;

function takeId(id, seen) {
  let next = id;
  let guard = 0;
  while (!ID_RE.test(next) || seen.has(next)) {
    next = newCustomId();
    guard += 1;
    if (guard > 1000) {
      next = `custom-${Math.random().toString(36).slice(2, 10)}`;
      if (!seen.has(next)) break;
    }
  }
  seen.add(next);
  return next;
}

export function normaliseConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const pollMinutes = clampPoll(src.pollMinutes);
  const incoming = Array.isArray(src.tiles) ? src.tiles : null;
  const confirmed = src.confirmed === true || (!!(incoming && incoming.length) && src.confirmed !== false);
  const tiles = [];
  const seen = new Set();
  const source = incoming && incoming.length ? incoming : defaultTiles();
  source.forEach((row, index) => {
    if (!row || typeof row !== 'object' || tiles.length >= 12) return;
    const id = takeId(typeof row.id === 'string' ? row.id.trim().toLowerCase() : '', seen);
    const weekLane = row.weekLane === 'routine' || row.weekLane === 'extended' ? row.weekLane : null;
    tiles.push({
      id,
      label: clip(row.label, 40) || 'Tile',
      subtitle: clip(row.subtitle, 40),
      hidden: !!row.hidden,
      showOnToday: row.showOnToday !== false,
      weekLane,
      displayOrder: Number.isFinite(Number(row.displayOrder)) ? Number(row.displayOrder) : index + 1,
      matchOrder: Number.isFinite(Number(row.matchOrder)) ? Number(row.matchOrder) : index,
      immediate: row.immediate !== false,
      match: ruleFrom(row.match),
      exclude: ruleFrom(row.exclude),
    });
  });
  if (!tiles.length) return normaliseConfig({ pollMinutes, confirmed, tiles: defaultTiles() });
  return { pollMinutes, confirmed, tiles };
}

function clampPoll(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return DEFAULT_POLL_MS / 60000;
  return Math.min(MAX_POLL_MS / 60000, Math.max(MIN_POLL_MS / 60000, Math.round(n)));
}

export function pollMsFromConfig(config) {
  return normaliseConfig(config).pollMinutes * 60 * 1000;
}

function slotHay(slot, kind) {
  if (kind === 'types') return slot.slotType || '';
  if (kind === 'sessions') return slot.sessionHaystack || slot.sessionName || '';
  return [slot.clinician || '', ...(slot.roleHints || [])].join(' ');
}

function ruleHits(slot, rule) {
  const r = rule || blankRule();
  return (
    haystackHits(slotHay(slot, 'types'), r.types) ||
    haystackHits(slotHay(slot, 'sessions'), r.sessions) ||
    haystackHits(slotHay(slot, 'roles'), r.roles)
  );
}

function isRemote(slot) {
  return tokensOf(slot && slot.delivery).some((t) => REMOTE_WORD.test(t));
}

function tileAllowsRemote(t) {
  const needles = [...(t.match.types || []), ...(t.match.sessions || []), ...(t.match.roles || [])];
  return needles.some((n) => tokensOf(n).some((t) => REMOTE_WORD.test(t)));
}

/** First match in match-priority order. A hidden tile still consumes the slot. */
export function tileForSlot(slot, tiles) {
  const ordered = (tiles || []).slice().sort((a, b) => a.matchOrder - b.matchOrder || a.displayOrder - b.displayOrder);
  for (const t of ordered) {
    if (isRemote(slot) && !tileAllowsRemote(t)) continue;
    if (ruleHits(slot, t.exclude)) continue;
    if (ruleHits(slot, t.match)) return t;
  }
  return null;
}

export function assignSlots(slots, tiles) {
  const byId = {};
  const unmapped = [];
  for (const t of tiles || []) byId[t.id] = [];
  for (const slot of slots || []) {
    const t = tileForSlot(slot, tiles);
    if (!t) unmapped.push(slot);
    else (byId[t.id] || (byId[t.id] = [])).push(slot);
  }
  return { byId, unmapped };
}

export function urgencyForMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return 'none';
  if (minutes < 30) return 'red';
  if (minutes <= 60) return 'amber';
  return 'green';
}

export function countdownLabel(minutes) {
  const n = Number(minutes);
  if (n > 0 && n < 1) return '<1 min';
  const m = Math.max(0, Math.floor(n || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (!rem) return `${h} hr`;
  return `${h} hr ${rem} min`;
}

export function bandLabel(tone) {
  if (tone === 'red') return 'Under 30 min';
  if (tone === 'amber') return '30–60 min';
  if (tone === 'green') return 'Over 1 hr';
  return '';
}

export function attention(tone, reduceMotion) {
  if (tone !== 'red') return { tone: tone || 'none', flash: false, icon: false };
  if (reduceMotion) return { tone: 'red', flash: false, icon: true };
  return { tone: 'red', flash: true, icon: false };
}

export function tileView(tileDef, slots, now, reduceMotion) {
  const nowMs = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  const today = londonISO(nowMs);
  const open = (slots || []).filter((s) => s && typeof s.endMs === 'number' && s.endMs > nowMs);
  open.sort((a, b) => a.startMs - b.startMs);
  const next = open[0] || null;
  const inProgress = !!(next && next.startMs <= nowMs);
  const minutes = !next ? null : inProgress ? 0 : (next.startMs - nowMs) / 60000;
  const tone = next ? urgencyForMinutes(minutes) : 'empty';
  const steady = reduceMotion || tileDef.immediate === false;
  const motion = attention(tone, steady);
  const dateISO = next ? next.dateISO || londonISO(next.startMs) : null;
  const later = !!(dateISO && dateISO !== today);
  const onThatDay = dateISO ? open.filter((s) => (s.dateISO || londonISO(s.startMs)) === dateISO) : [];
  return {
    id: tileDef.id,
    label: tileDef.label,
    subtitle: tileDef.subtitle || '',
    remaining: onThatDay.length,
    minutes,
    inProgress,
    later,
    dateISO,
    dayHeading: dateISO ? dayHeading(dateISO) : '',
    dayGap: dateISO ? Math.max(0, daysBetween(today, dateISO)) : 0,
    nextLabel: next ? clockLabel(next.startMs) : null,
    site: next && next.site ? next.site : '',
    countdown: tone === 'red' && !inProgress && !later ? countdownLabel(minutes) : null,
    tone: motion.tone,
    flash: motion.flash,
    icon: motion.icon,
    band: bandLabel(motion.tone),
    track: minutes == null ? 0 : minutes >= 60 ? 100 : Math.max(4, Math.round((Math.max(0, minutes) / 60) * 100)),
  };
}

export function tileFace(view) {
  if (!view) return null;
  let primary = '—';
  let cue = '';
  if (!view.remaining) primary = 'None left';
  else if (view.inProgress) {
    primary = 'Now';
    cue = 'Now';
  } else if (view.later) {
    primary = view.dayHeading || '—';
    const n = view.dayGap || 0;
    cue = `First available in ${n} day${n === 1 ? '' : 's'}`;
  } else if (view.tone === 'red' && view.countdown) {
    primary = view.countdown;
    cue = `Next slot in ${view.countdown}`;
  } else if (view.nextLabel) {
    primary = view.nextLabel;
    cue = view.minutes != null ? `Next slot in ${countdownLabel(view.minutes)}` : '';
  }
  const detail =
    !view.later && view.tone === 'red' && view.nextLabel && !view.inProgress ? `Next ${view.nextLabel}` : '';
  const secondary = view.remaining == null ? 'No reading' : `${view.remaining} left`;
  return {
    label: view.label,
    subtitle: view.subtitle || '',
    primary,
    cue,
    detail,
    secondary,
    band: view.band || '',
    site: view.site || '',
    tone: view.tone,
    flash: !!view.flash,
    icon: !!view.icon,
    track: view.track || 0,
  };
}

export function todayViews(slots, config, now, reduceMotion) {
  const cfg = normaliseConfig(config);
  const list = slots || [];
  if (!cfg.confirmed) {
    return { tiles: [], unmapped: list.length, offScreen: 0, offScreenNames: [], unconfirmed: true, multiSite: false };
  }
  const { byId, unmapped } = assignSlots(list, cfg.tiles);
  const sites = new Set(list.map((s) => s && s.site).filter(Boolean));
  const multiSite = sites.size > 1;
  const shown = cfg.tiles
    .filter((t) => t.showOnToday && !t.hidden)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label));
  const shownIds = new Set(shown.map((t) => t.id));
  const off = [];
  const offNames = [];
  for (const t of cfg.tiles) {
    if (shownIds.has(t.id)) continue;
    const n = (byId[t.id] || []).length;
    if (!n) continue;
    off.push(n);
    offNames.push(t.label);
  }
  return {
    tiles: shown.map((t) => {
      const view = tileView(t, byId[t.id] || [], now, reduceMotion);
      if (!multiSite) view.site = '';
      return view;
    }),
    unmapped: unmapped.length,
    offScreen: off.reduce((a, b) => a + b, 0),
    offScreenNames: offNames,
    unconfirmed: false,
    multiSite,
  };
}

function barTone(routine, weekend, holiday) {
  if (routine == null) return 'unread';
  if (routine === 0 && (weekend || holiday)) return 'none';
  if (routine <= 3) return 'red';
  if (routine <= 5) return 'amber';
  return 'green';
}

export function weekView(dayRows, config, opts) {
  const cfg = normaliseConfig(config);
  const division = (opts && opts.division) || 'england-and-wales';
  const routineIds = new Set(cfg.tiles.filter((t) => t.weekLane === 'routine' && !t.hidden).map((t) => t.id));
  const extendedIds = new Set(cfg.tiles.filter((t) => t.weekLane === 'extended' && !t.hidden).map((t) => t.id));
  let totalRoutine = 0;
  let totalExtended = 0;
  let incomplete = !cfg.confirmed;
  const days = (dayRows || []).map((row, index) => {
    const weekend = isWeekendISO(row.date);
    const holiday = isBankHoliday(row.date, division);
    const holidayName = holiday ? bankHolidayTitle(row.date, division) : '';
    const base = {
      date: row.date,
      label: index === 0 ? 'Today' : dayLabel(row.date),
      weekend,
      holiday,
      holidayName,
      stale: !!row.stale,
      noClinic: !!row.noClinic,
    };
    if (!cfg.confirmed || !row || row.slots == null) {
      incomplete = true;
      return { ...base, routine: null, extended: null, tone: 'unread' };
    }
    const { byId } = assignSlots(row.slots, cfg.tiles);
    let routine = 0;
    let extended = 0;
    for (const id of routineIds) routine += (byId[id] || []).length;
    for (const id of extendedIds) extended += (byId[id] || []).length;
    if (row.stale || row.partial) {
      incomplete = true;
      return { ...base, routine, extended, tone: 'unread', stale: true };
    }
    totalRoutine += routine;
    totalExtended += extended;
    return { ...base, routine, extended, tone: barTone(routine, weekend, holiday) };
  });
  return { days, totalRoutine, totalExtended, incomplete, unconfirmed: !cfg.confirmed };
}

/**
 * A failed day keeps the previous slots and its own read time.
 * The header stamp moves only when today's read succeeds.
 * Days outside `keep` are dropped.
 */
export function mergeSnapshots(prev, incoming, opts) {
  const options = opts || {};
  const days = {};
  const previous = (prev && prev.days) || {};
  for (const [date, row] of Object.entries(previous)) {
    if (!row) continue;
    days[date] = {
      slots: row.slots,
      fetchedAt: row.fetchedAt || null,
      stale: !!row.stale,
      noClinic: !!row.noClinic,
      partial: !!row.partial,
    };
  }
  const staleDates = [];
  let anyFail = false;
  const inc = (incoming && incoming.days) || {};
  const today = options.today || incoming.today || null;
  for (const [date, row] of Object.entries(inc)) {
    if (row && row.ok && Array.isArray(row.slots)) {
      days[date] = {
        slots: row.slots,
        fetchedAt: incoming.fetchedAt,
        stale: false,
        noClinic: !!row.noClinic,
        partial: !!row.partial,
      };
    } else {
      anyFail = true;
      staleDates.push(date);
      if (days[date] && Array.isArray(days[date].slots)) {
        days[date] = { ...days[date], stale: true };
      } else {
        days[date] = { slots: null, fetchedAt: null, stale: true, noClinic: false, partial: false };
      }
    }
  }
  if (Array.isArray(options.keep)) {
    const allow = new Set(options.keep);
    for (const date of Object.keys(days)) {
      if (!allow.has(date)) delete days[date];
    }
  }
  const todayRow = today ? inc[today] : null;
  const todayOk = !!(todayRow && todayRow.ok && Array.isArray(todayRow.slots));
  let fetchedAt = prev && prev.fetchedAt ? prev.fetchedAt : null;
  if (today) {
    if (todayOk) fetchedAt = incoming.fetchedAt;
  } else if (!anyFail && incoming && incoming.fetchedAt && Object.keys(inc).length) {
    fetchedAt = incoming.fetchedAt;
  }
  const hadPrev = !!(prev && (prev.fetchedAt || Object.values(previous).some((row) => row && row.slots)));
  if (!Object.values(days).some((row) => row && (row.slots || row.stale)) && !hadPrev && anyFail) {
    return { days, fetchedAt: null, stale: false, error: true, ready: false, staleDates };
  }
  const ready = Object.values(days).some((row) => row && Array.isArray(row.slots));
  return {
    days,
    fetchedAt,
    stale: anyFail,
    error: anyFail && !ready,
    ready,
    staleDates,
  };
}

export function shouldFetch(state) {
  return !!(state && state.packOn === true && state.visible === true);
}

export function blankTile() {
  return {
    id: newCustomId(),
    label: 'New tile',
    subtitle: '',
    hidden: false,
    showOnToday: true,
    weekLane: null,
    displayOrder: 50,
    matchOrder: 50,
    immediate: true,
    match: blankRule(),
    exclude: blankRule(),
  };
}
