// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — availability wall (pure). No DOM, no chrome, no fetch.
//
// One day's free slots come from
// GET /scheduling/data/appointment-book/embedded-overview?date=YYYY-MM-DD&filterByUsualLocation=false
// (the same book Slot Counter and Capacity already read). There is no captured
// range parameter on that GET, and available-appointment-places-between-range
// is one appointment type at a time. A 7-day wall is seven of those GETs.
//
// The load cut (v3.264.15) removed the Today tab and the Note TV board because
// they polled in the background. This core does not poll. The wall page owns
// one loop, and only while that tab is open and visible.

'use strict';

export const DEFAULT_POLL_MS = 5 * 60 * 1000;
export const MIN_POLL_MS = 2 * 60 * 1000;
export const MAX_POLL_MS = 30 * 60 * 1000;
export const TICK_MS = 20 * 1000;
export const WEEK_DAYS = 7;
export const REQUESTS_PER_REFRESH = WEEK_DAYS;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n) {
  return String(n).padStart(2, '0');
}

export function isoFromDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysISO(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return isoFromDate(dt);
}

export function weekDates(todayISO) {
  const out = [];
  for (let i = 0; i < WEEK_DAYS; i++) out.push(i === 0 ? todayISO : addDaysISO(todayISO, i));
  return out;
}

export function isWeekendISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day === 0 || day === 6;
}

export function dayLabel(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAY[dt.getDay()]} ${d}`;
}

export function clockLabel(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local wall-clock. Medicus sends both "YYYY-MM-DD HH:mm:ss" and ISO. */
export function parseLocalDateTime(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(value || ''));
  if (!m) return null;
  const dt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), 0);
  return Number.isNaN(dt.getTime()) ? null : dt.getTime();
}

export function overviewPath(dateISO) {
  return `/scheduling/data/appointment-book/embedded-overview?date=${dateISO}&filterByUsualLocation=false`;
}

function clip(s, n) {
  return String(s || '')
    .trim()
    .slice(0, n);
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normName(s) {
  return norm(s)
    .replace(/\b(dr|doctor|mr|mrs|ms|miss)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function listOf(raw, max) {
  const src = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of src) {
    const v = norm(item);
    if (!v || v.length > 60) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function haystackHits(hay, needles) {
  if (!needles.length) return false;
  const h = norm(hay);
  if (!h) return false;
  return needles.some((n) => n && h.includes(n));
}

function textOf(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && typeof node.name === 'string') return node.name;
  return '';
}

/**
 * Rota staff (optional) → name key → role hint strings.
 * Medicus diaries do not carry a job-role on the schedule row we have captured.
 * This index is the practice's own rota register, matched by display name.
 */
export function roleIndex(staff) {
  const map = {};
  for (const person of Array.isArray(staff) ? staff : []) {
    if (!person || typeof person !== 'object') continue;
    const hints = [];
    for (const key of ['role', 'employmentType']) {
      const v = norm(person[key]);
      if (v) hints.push(v);
    }
    if (!hints.length) continue;
    for (const raw of [person.name, person.medicusName]) {
      const key = normName(raw);
      if (key) map[key] = hints.slice();
    }
  }
  return map;
}

function hintsFor(name, index) {
  if (!index || !name) return [];
  const key = normName(name);
  if (!key) return [];
  if (index[key]) return index[key].slice();
  for (const [k, hints] of Object.entries(index)) {
    if (k.length >= 4 && (key.includes(k) || k.includes(key))) return hints.slice();
  }
  return [];
}

function payloadRoleHints(staff) {
  const out = [];
  if (!staff || typeof staff !== 'object') return out;
  for (const key of ['jobRole', 'jobRoleName', 'roleName']) {
    const v = textOf(staff[key]) || (typeof staff[key] === 'string' ? staff[key] : '');
    const n = norm(v);
    if (n) out.push(n);
  }
  if (staff.jobRole && typeof staff.jobRole === 'object') {
    const n = norm(staff.jobRole.label || staff.jobRole.name || staff.jobRole.value || '');
    if (n) out.push(n);
  }
  return out;
}

function sessionBits(session) {
  const summary = (session && session.summary) || {};
  const service = textOf(summary.service);
  const bits = [service, textOf(summary.defaultAppointmentType), summary.name, summary.title, session && session.name]
    .map((s) => clip(s, 80))
    .filter(Boolean);
  return {
    sessionName: clip(service || bits[0] || '', 80),
    sessionHaystack: bits.join(' '),
    defaultType: clip(textOf(summary.defaultAppointmentType), 80),
  };
}

/**
 * Free slots only. Booked appointments are skipped, including any patient name
 * on them. Returned objects never carry patient, reason, or NHS-number fields.
 */
export function extractFreeSlots(raw, opts) {
  const options = opts || {};
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowMs = now.getTime();
  const today = options.dateISO || '';
  const index = options.roleIndex || {};
  const dropPast = options.dropPast !== false;
  const slots = [];
  const seen = { types: new Set(), sessions: new Set(), clinicians: new Set() };

  function walk(staffName, staff, sessions) {
    const clinician = clip(staffName || 'Unassigned', 80) || 'Unassigned';
    const roleHints = payloadRoleHints(staff).concat(hintsFor(clinician, index));
    (sessions || []).forEach((session) => {
      if (!session || session.scheduleType === 'unavailability-period') return;
      if (session.summary && session.summary.status && session.summary.status.isCancelled) return;
      const bits = sessionBits(session);
      if (bits.sessionName) seen.sessions.add(bits.sessionName);
      if (clinician) seen.clinicians.add(clinician);
      (session.entries || []).forEach((entry) => {
        if (!entry) return;
        const kind = entry.diaryEntryType || {};
        const isSlot = kind.value === 'slot' || kind.isSlot === true;
        if (!isSlot || kind.value === 'appointment') return;
        const slotType = clip(textOf(entry.appointmentType) || bits.defaultType, 80);
        if (slotType) seen.types.add(slotType);
        const startMs = parseLocalDateTime(entry.startDateTime);
        if (startMs == null) return;
        if (dropPast && today && startMs < nowMs) return;
        slots.push({
          startMs,
          slotType,
          sessionName: bits.sessionName,
          sessionHaystack: bits.sessionHaystack,
          clinician,
          roleHints: [...new Set(roleHints)],
        });
      });
    });
  }

  const schedules = raw && Array.isArray(raw.staffSchedules) ? raw.staffSchedules : [];
  schedules.forEach((staff) => {
    walk(staff && staff.name, staff, staff && staff.schedule);
  });
  const unassigned = raw && Array.isArray(raw.unassignedDiaries) ? raw.unassignedDiaries : [];
  if (unassigned.length) walk('Unassigned', null, unassigned);

  slots.sort((a, b) => a.startMs - b.startMs || a.clinician.localeCompare(b.clinician));
  return {
    slots,
    observed: {
      slotTypes: [...seen.types].sort((a, b) => a.localeCompare(b)),
      sessions: [...seen.sessions].sort((a, b) => a.localeCompare(b)),
      clinicians: [...seen.clinicians].sort((a, b) => a.localeCompare(b)),
    },
  };
}

export function dropPastSlots(slots, now) {
  const nowMs = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  return (slots || []).filter((s) => s && typeof s.startMs === 'number' && s.startMs >= nowMs);
}

function blankRule() {
  return { types: [], sessions: [], roles: [] };
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

export function defaultTiles() {
  return [
    tile('visits', 'Visits', 3, {
      types: ['visit', 'home visit'],
      sessions: ['visit', 'home visit'],
      roles: ['visit'],
    }),
    tile('embargo-gp', '3-day embargo GP', 7, {
      types: ['embargo', '3-day', '3 day', 'three day'],
      sessions: ['embargo', '3-day', '3 day', 'three day'],
      roles: ['embargo'],
    }),
    tile(
      'extended',
      'Extended access',
      8,
      {
        types: ['extended access', 'enhanced access', 'enhanced hours'],
        sessions: ['extended access', 'enhanced access', 'enhanced hours', 'hub'],
        roles: [],
      },
      { showOnToday: false, weekLane: 'extended' }
    ),
    tile('anp', 'ANP', 5, {
      types: ['anp', 'nurse practitioner', 'advanced nurse'],
      sessions: ['anp', 'nurse practitioner', 'advanced nurse'],
      roles: ['anp', 'nurse practitioner', 'advanced nurse'],
    }),
    tile(
      'nursing',
      'Nursing / HCA',
      2,
      {
        types: ['nurse', 'hca', 'health care assistant', 'healthcare assistant', 'phlebotom'],
        sessions: ['nurse', 'hca', 'health care assistant', 'healthcare assistant', 'phlebotom'],
        roles: ['nurse', 'hca', 'phlebotomist'],
      },
      {
        exclude: {
          types: ['nurse practitioner', 'anp', 'advanced nurse'],
          sessions: ['nurse practitioner', 'anp', 'advanced nurse'],
          roles: ['anp', 'nurse practitioner', 'advanced nurse'],
        },
      }
    ),
    tile('registrar', 'Registrar / additional GP', 4, {
      types: ['registrar', 'trainee', 'gpst', 'additional gp', 'extra gp'],
      sessions: ['registrar', 'trainee', 'gpst', 'additional gp', 'extra gp'],
      roles: ['registrar', 'gpst', 'trainee'],
    }),
    tile('otd-gp', 'On-the-day GP', 1, {
      types: ['on the day', 'on-the-day', 'same day', 'same-day', 'duty'],
      sessions: ['on the day', 'on-the-day', 'same day', 'same-day', 'duty'],
      roles: ['duty'],
    }),
    tile(
      'routine-gp',
      'Pre-bookable routine GP',
      6,
      {
        types: ['routine', 'pre-book', 'prebook', 'pre book', 'gp appointment', 'gp consult'],
        sessions: ['routine', 'pre-book', 'prebook', 'pre book'],
        roles: [],
      },
      {
        weekLane: 'routine',
        exclude: {
          types: ['on the day', 'on-the-day', 'same day', 'same-day', 'embargo', 'duty', 'visit'],
          sessions: ['on the day', 'on-the-day', 'same day', 'same-day', 'embargo', 'duty', 'visit'],
          roles: ['registrar', 'anp', 'nurse', 'hca'],
        },
      }
    ),
  ];
}

function tile(id, label, displayOrder, match, extra) {
  const more = extra || {};
  return {
    id,
    label,
    hidden: false,
    showOnToday: more.showOnToday !== false,
    weekLane: more.weekLane || null,
    displayOrder,
    match,
    exclude: more.exclude || blankRule(),
  };
}

const ID_RE = /^[a-z0-9-]{1,40}$/;

export function normaliseConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const pollMinutes = clampPoll(src.pollMinutes);
  const incoming = Array.isArray(src.tiles) ? src.tiles : null;
  const tiles = [];
  const seen = new Set();
  const source = incoming && incoming.length ? incoming : defaultTiles();
  for (const row of source) {
    if (!row || typeof row !== 'object') continue;
    let id = typeof row.id === 'string' ? row.id.trim().toLowerCase() : '';
    if (!ID_RE.test(id) || seen.has(id)) id = newCustomId();
    seen.add(id);
    const weekLane = row.weekLane === 'routine' || row.weekLane === 'extended' ? row.weekLane : null;
    tiles.push({
      id,
      label: clip(row.label, 40) || 'Tile',
      hidden: !!row.hidden,
      showOnToday: row.showOnToday !== false,
      weekLane,
      displayOrder: Number.isFinite(Number(row.displayOrder)) ? Number(row.displayOrder) : tiles.length + 1,
      match: ruleFrom(row.match),
      exclude: ruleFrom(row.exclude),
    });
    if (tiles.length >= 12) break;
  }
  if (!tiles.length) return normaliseConfig({ pollMinutes, tiles: defaultTiles() });
  return { pollMinutes, tiles };
}

function clampPoll(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return DEFAULT_POLL_MS / 60000;
  return Math.min(MAX_POLL_MS / 60000, Math.max(MIN_POLL_MS / 60000, Math.round(n)));
}

export function pollMsFromConfig(config) {
  const minutes = normaliseConfig(config).pollMinutes;
  return minutes * 60 * 1000;
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

function ruleExcludes(slot, rule) {
  const r = rule || blankRule();
  return (
    haystackHits(slotHay(slot, 'types'), r.types) ||
    haystackHits(slotHay(slot, 'sessions'), r.sessions) ||
    haystackHits(slotHay(slot, 'roles'), r.roles)
  );
}

/** First matching tile wins, including a hidden tile, so a hidden list does not leak into the next one. */
export function tileForSlot(slot, tiles) {
  for (const t of tiles || []) {
    if (ruleExcludes(slot, t.exclude)) continue;
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
    else byId[t.id].push(slot);
  }
  return { byId, unmapped };
}

/** green > 60 min, amber 30–60, red < 30. A missing time is not a colour. */
export function urgencyForMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return 'none';
  if (minutes < 30) return 'red';
  if (minutes <= 60) return 'amber';
  return 'green';
}

export function countdownLabel(minutes) {
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (!rem) return `${h} hr`;
  return `${h} hr ${rem} min`;
}

/** Flashing is the red state only. Reduced motion is a steady red plus an icon. */
export function attention(tone, reduceMotion) {
  if (tone !== 'red') return { tone: tone || 'none', flash: false, icon: false };
  if (reduceMotion) return { tone: 'red', flash: false, icon: true };
  return { tone: 'red', flash: true, icon: false };
}

export function tileView(tileDef, slots, now, reduceMotion) {
  const nowMs = (now instanceof Date ? now : new Date(now || Date.now())).getTime();
  const future = dropPastSlots(slots, new Date(nowMs));
  const next = future[0] || null;
  const minutes = next ? (next.startMs - nowMs) / 60000 : null;
  const tone = next ? urgencyForMinutes(minutes) : 'empty';
  const motion = attention(tone, !!reduceMotion);
  const nextLabel = next ? clockLabel(next.startMs) : null;
  return {
    id: tileDef.id,
    label: tileDef.label,
    remaining: future.length,
    minutes,
    nextLabel,
    countdown: tone === 'red' ? countdownLabel(minutes) : null,
    tone: motion.tone,
    flash: motion.flash,
    icon: motion.icon,
  };
}

export function tileFace(view) {
  if (!view) return null;
  let primary = '—';
  if (view.tone === 'red' && view.countdown) primary = view.countdown;
  else if (view.nextLabel) primary = view.nextLabel;
  else if (view.remaining === 0) primary = 'None left';
  const detail = view.tone === 'red' && view.nextLabel ? `Next ${view.nextLabel}` : '';
  const secondary = view.remaining == null ? 'No reading' : `${view.remaining} left`;
  return {
    label: view.label,
    primary,
    detail,
    secondary,
    tone: view.tone,
    flash: !!view.flash,
    icon: !!view.icon,
  };
}

export function todayViews(slots, config, now, reduceMotion) {
  const cfg = normaliseConfig(config);
  const { byId, unmapped } = assignSlots(slots, cfg.tiles);
  const tiles = cfg.tiles
    .filter((t) => t.showOnToday && !t.hidden)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label));
  return {
    tiles: tiles.map((t) => tileView(t, byId[t.id] || [], now, reduceMotion)),
    unmapped: unmapped.length,
  };
}

export function weekView(dayRows, config) {
  const cfg = normaliseConfig(config);
  const routineIds = new Set(cfg.tiles.filter((t) => t.weekLane === 'routine' && !t.hidden).map((t) => t.id));
  const extendedIds = new Set(cfg.tiles.filter((t) => t.weekLane === 'extended' && !t.hidden).map((t) => t.id));
  let totalRoutine = 0;
  let totalExtended = 0;
  let incomplete = false;
  const days = (dayRows || []).map((row) => {
    const weekend = isWeekendISO(row.date);
    if (!row || row.slots == null) {
      incomplete = true;
      return { date: row.date, label: dayLabel(row.date), weekend, routine: null, extended: null };
    }
    const { byId } = assignSlots(row.slots, cfg.tiles);
    let routine = 0;
    let extended = 0;
    for (const id of routineIds) routine += (byId[id] || []).length;
    for (const id of extendedIds) extended += (byId[id] || []).length;
    totalRoutine += routine;
    totalExtended += extended;
    return { date: row.date, label: dayLabel(row.date), weekend, routine, extended };
  });
  return { days, totalRoutine, totalExtended, incomplete };
}

/**
 * A failed day keeps the previous slots. It is never written as an empty list.
 * A day that has never succeeded stays null so the wall can show "no reading"
 * rather than zero.
 */
export function mergeSnapshots(prev, incoming) {
  const days = {};
  const previous = (prev && prev.days) || {};
  for (const [date, row] of Object.entries(previous)) {
    if (row && row.slots) days[date] = { slots: row.slots };
  }
  let anyOk = false;
  let anyFail = false;
  const inc = (incoming && incoming.days) || {};
  for (const [date, row] of Object.entries(inc)) {
    if (row && row.ok && Array.isArray(row.slots)) {
      days[date] = { slots: row.slots };
      anyOk = true;
    } else {
      anyFail = true;
      if (!days[date]) days[date] = { slots: null };
    }
  }
  const hadPrev = !!(prev && prev.fetchedAt);
  if (!anyOk && !hadPrev) {
    return { days, fetchedAt: null, stale: false, error: true, ready: false };
  }
  return {
    days,
    fetchedAt: anyOk && incoming.fetchedAt ? incoming.fetchedAt : prev.fetchedAt,
    stale: anyFail,
    error: anyFail,
    ready: true,
  };
}

/** The wall fetches only while the pack is on and the tab is visible. */
export function shouldFetch(state) {
  return !!(state && state.packOn === true && state.visible === true);
}

export function blankTile() {
  return {
    id: newCustomId(),
    label: 'New tile',
    hidden: false,
    showOnToday: true,
    weekLane: null,
    displayOrder: 50,
    match: blankRule(),
    exclude: blankRule(),
  };
}
