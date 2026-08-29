// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Note display board: pure config + snapshot math (no DOM/chrome)
//
// Note is a software Vestaboard-style board for TVs and monitors. It reuses
// the same live streams Condor already fetches (waiting room, submissions,
// request-monitor state, slots, activity) and REDUCES them to a snapshot the
// full-tab renderer may paint.
//
// HARD SAFETY RULE (H-067) — do not relax:
//   A public-audience profile (waiting-room TV, message board) must never be
//   able to show patient-identifiable data. buildSnapshot() copies counts,
//   wait BANDS, tempo, and demand totals only. It does not copy names,
//   initials, summaries, reasons, staff-by-patient rows, or the raw
//   appointment list. There is no "show names" flag. Widgets that only make
//   sense in a staff room (PPI, triage inbox, urgent, activity) are stripped
//   from public profiles by widgetsForProfile() even if a crafted backup
//   lists them.
//
// The renderer (board.js) prints snapshot fields and the practice-authored
// message. It must not reach back into the raw streams.

'use strict';

export const STORAGE_KEY = 'board.config';

export const MAX_MESSAGE_CHARS = 80;
export const FLAP_COLS = 22;
export const FLAP_ROWS = 2;
export const MIN_POLL_SECONDS = 10;
export const MAX_POLL_SECONDS = 120;
export const DEFAULT_POLL_SECONDS = 20;

// Characters the split-flap will show. Anything else becomes a blank tile.
export const FLAP_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?'-:/+&#";

export const PUBLIC_WIDGETS = ['flap', 'tempo', 'waiting', 'ticker', 'demand', 'clock'];
export const STAFF_ONLY_WIDGETS = ['pressure', 'triage', 'slots', 'urgent', 'activity'];
export const ALL_WIDGETS = [...PUBLIC_WIDGETS, ...STAFF_ONLY_WIDGETS];

export const WIDGET_META = {
  flap: { label: 'Message flaps', audience: 'public' },
  tempo: { label: 'How busy we are', audience: 'public' },
  waiting: { label: 'People waiting', audience: 'public' },
  ticker: { label: 'Ticker', audience: 'public' },
  demand: { label: 'Requests today', audience: 'public' },
  clock: { label: 'Clock', audience: 'public' },
  pressure: { label: 'Pressure index', audience: 'staff' },
  triage: { label: 'Triage inbox', audience: 'staff' },
  slots: { label: 'Slots remaining', audience: 'staff' },
  urgent: { label: 'Urgent unactioned', audience: 'staff' },
  activity: { label: 'Activity today', audience: 'staff' },
};

export const TEMPO_ORDER = ['quiet', 'steady', 'busy', 'very-busy'];

export const TEMPO_LABEL = {
  quiet: 'Quiet',
  steady: 'Steady',
  busy: 'Busy',
  'very-busy': 'Very busy',
};

// Public TVs say Normal, not Steady. Staff keeps Steady so the two
// formulas stay visibly different. Do not merge the words.
export const PUBLIC_TEMPO_LABEL = {
  quiet: 'Quiet',
  steady: 'Normal',
  busy: 'Busy',
  'very-busy': 'Very busy',
};

export function tempoLabelFor(tempo, audience) {
  const map = audience === 'public' ? PUBLIC_TEMPO_LABEL : TEMPO_LABEL;
  return map[tempo] || TEMPO_LABEL[tempo] || '';
}

// Defaults match the waiting-room strip (amber 10 / red 20 minutes) and the
// submissions demand defaults (medical amber 30 / red 60) so the board and
// the panel do not disagree about "busy".
export const DEFAULT_THRESHOLDS = {
  amberWaitMin: 10,
  redWaitMin: 20,
  busyWaiting: 5,
  veryBusyWaiting: 8,
  busyDemand: 30,
  veryBusyDemand: 60,
};

export const DEFAULT_PROFILES = [
  {
    id: 'waiting-room',
    name: 'Waiting room',
    audience: 'public',
    widgets: ['flap', 'tempo', 'waiting', 'ticker', 'clock'],
    message: 'Please take a seat. We will call you shortly.',
  },
  {
    id: 'ops',
    name: 'Ops overview',
    audience: 'staff',
    widgets: ['tempo', 'pressure', 'waiting', 'demand', 'triage', 'slots', 'clock'],
    message: '',
  },
  {
    id: 'message',
    name: 'Message',
    audience: 'public',
    widgets: ['flap', 'clock'],
    message: 'Welcome',
  },
];

export const DEFAULT_CONFIG = {
  version: 1,
  activeProfileId: 'waiting-room',
  pollSeconds: DEFAULT_POLL_SECONDS,
  profiles: DEFAULT_PROFILES.map((p) => ({ ...p, widgets: [...p.widgets] })),
};

const PROFILE_IDS = new Set(DEFAULT_PROFILES.map((p) => p.id));
const WIDGET_SET = new Set(ALL_WIDGETS);

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function clampInt(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// Practice-authored flap text. Strips markup and control characters so a
// crafted backup cannot smuggle HTML onto a waiting-room TV.
export function sanitiseMessage(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/<[^>]*>/g, '');
  s = [...s]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 10 || c === 13 || (c >= 32 && c !== 127);
    })
    .join('');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > MAX_MESSAGE_CHARS) s = s.slice(0, MAX_MESSAGE_CHARS).trim();
  return s;
}

export function sanitiseThresholds(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const d = DEFAULT_THRESHOLDS;
  let amberWaitMin = clampInt(r.amberWaitMin, 1, 180, d.amberWaitMin);
  let redWaitMin = clampInt(r.redWaitMin, 2, 240, d.redWaitMin);
  if (!(amberWaitMin < redWaitMin)) {
    amberWaitMin = d.amberWaitMin;
    redWaitMin = d.redWaitMin;
  }
  let busyWaiting = clampInt(r.busyWaiting, 1, 40, d.busyWaiting);
  let veryBusyWaiting = clampInt(r.veryBusyWaiting, 2, 80, d.veryBusyWaiting);
  if (!(busyWaiting < veryBusyWaiting)) {
    busyWaiting = d.busyWaiting;
    veryBusyWaiting = d.veryBusyWaiting;
  }
  let busyDemand = clampInt(r.busyDemand, 1, 200, d.busyDemand);
  let veryBusyDemand = clampInt(r.veryBusyDemand, 2, 400, d.veryBusyDemand);
  if (!(busyDemand < veryBusyDemand)) {
    busyDemand = d.busyDemand;
    veryBusyDemand = d.veryBusyDemand;
  }
  return { amberWaitMin, redWaitMin, busyWaiting, veryBusyWaiting, busyDemand, veryBusyDemand };
}

function sanitiseWidgets(raw, audience) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const w of list) {
    if (typeof w !== 'string' || !WIDGET_SET.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return widgetsForProfile({ audience, widgets: out });
}

export function widgetsForProfile(profile) {
  const audience = profile && profile.audience === 'staff' ? 'staff' : 'public';
  const list = Array.isArray(profile && profile.widgets) ? profile.widgets : [];
  const allowed = audience === 'staff' ? ALL_WIDGETS : PUBLIC_WIDGETS;
  const allow = new Set(allowed);
  const out = [];
  const seen = new Set();
  for (const w of list) {
    if (!allow.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  if (!out.length) {
    return audience === 'staff' ? ['tempo', 'waiting', 'clock'] : ['flap', 'tempo', 'waiting', 'clock'];
  }
  return out;
}

function sanitiseProfile(raw, fallback) {
  const fb = fallback || DEFAULT_PROFILES[0];
  const r = isPlainObject(raw) ? raw : {};
  const id = typeof r.id === 'string' && PROFILE_IDS.has(r.id) ? r.id : fb.id;
  const shipped = DEFAULT_PROFILES.find((p) => p.id === id) || fb;
  // Audience is owned by the shipped profile id — a backup cannot flip
  // waiting-room to staff (or ops to public) and thereby change the PII rule.
  const lockedAudience = shipped.audience;
  return {
    id,
    name: shipped.name,
    audience: lockedAudience,
    widgets: sanitiseWidgets(r.widgets || shipped.widgets, lockedAudience),
    message: sanitiseMessage(r.message != null ? r.message : shipped.message),
  };
}

export function sanitiseConfig(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const profiles = DEFAULT_PROFILES.map((shipped) => {
    const incoming = Array.isArray(r.profiles) ? r.profiles.find((p) => p && p.id === shipped.id) : null;
    return sanitiseProfile(incoming || shipped, shipped);
  });
  let activeProfileId = typeof r.activeProfileId === 'string' ? r.activeProfileId : DEFAULT_CONFIG.activeProfileId;
  if (!PROFILE_IDS.has(activeProfileId)) activeProfileId = DEFAULT_CONFIG.activeProfileId;
  return {
    version: 1,
    activeProfileId,
    pollSeconds: clampInt(r.pollSeconds, MIN_POLL_SECONDS, MAX_POLL_SECONDS, DEFAULT_POLL_SECONDS),
    thresholds: sanitiseThresholds(r.thresholds),
    profiles,
  };
}

export function resolveProfile(config, requestedId) {
  const cfg = sanitiseConfig(config);
  const id = typeof requestedId === 'string' && PROFILE_IDS.has(requestedId) ? requestedId : cfg.activeProfileId;
  return cfg.profiles.find((p) => p.id === id) || cfg.profiles[0];
}

export function waitMinutes(startDateTime, nowMs) {
  if (!startDateTime) return null;
  const ms = new Date(startDateTime).getTime();
  if (!Number.isFinite(ms)) return null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const m = Math.round((now - ms) / 60000);
  return m > 0 ? m : 0;
}

export function waitBand(count, maxWaitMinutes, thresholds) {
  const t = sanitiseThresholds(thresholds);
  const n = Number(count) || 0;
  if (n <= 0) return { label: 'No one waiting', tone: 'quiet', maxWaitMinutes: null };
  if (maxWaitMinutes == null || !Number.isFinite(maxWaitMinutes)) {
    return { label: 'People are waiting', tone: 'steady', maxWaitMinutes: null };
  }
  if (maxWaitMinutes < t.amberWaitMin) {
    return { label: `Most waits are under ${t.amberWaitMin} minutes`, tone: 'quiet', maxWaitMinutes };
  }
  if (maxWaitMinutes < t.redWaitMin) {
    return { label: `Most waits are under ${t.redWaitMin} minutes`, tone: 'steady', maxWaitMinutes };
  }
  return { label: `Some waits are over ${t.redWaitMin} minutes`, tone: 'busy', maxWaitMinutes };
}

export function deriveTempo({ waitingCount, maxWaitMinutes, demandAll }, thresholds, mode) {
  const t = sanitiseThresholds(thresholds);
  const waiting = Number(waitingCount) || 0;
  const demand = Number(demandAll) || 0;
  const wait = Number.isFinite(maxWaitMinutes) ? maxWaitMinutes : 0;
  // Public TVs answer "how does the room feel?" — today's request pile is
  // back-office work and must not paint BUSY over an empty waiting room.
  const useDemand = mode !== 'public';
  if (waiting >= t.veryBusyWaiting || wait >= t.redWaitMin || (useDemand && demand >= t.veryBusyDemand)) {
    return 'very-busy';
  }
  if (waiting >= t.busyWaiting || wait >= t.amberWaitMin || (useDemand && demand >= t.busyDemand)) {
    return 'busy';
  }
  if (waiting >= 1 || (useDemand && demand >= 10)) return 'steady';
  return 'quiet';
}

function flapChar(ch) {
  const up = String(ch || '').toUpperCase();
  return FLAP_CHARSET.includes(up) ? up : ' ';
}

// Vestaboard-style smart layout: wrap on word boundaries, centre each row
// in a fixed column grid. Empty rows stay blank tiles.
export function formatFlapRows(message, cols = FLAP_COLS, rows = FLAP_ROWS) {
  const c = clampInt(cols, 8, 32, FLAP_COLS);
  const r = clampInt(rows, 1, 4, FLAP_ROWS);
  const text = sanitiseMessage(message).toUpperCase().split('').map(flapChar).join('').replace(/\s+/g, ' ').trim();

  const grid = Array.from({ length: r }, () => Array(c).fill(' '));
  if (!text) return grid.map((row) => row.join(''));

  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const word of words) {
    if (!word) continue;
    if (word.length > c) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      for (let i = 0; i < word.length; i += c) lines.push(word.slice(i, i + c));
      continue;
    }
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= c) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);

  const shown = lines.slice(0, r);
  shown.forEach((line, i) => {
    const pad = Math.max(0, Math.floor((c - line.length) / 2));
    for (let k = 0; k < line.length && pad + k < c; k++) grid[i][pad + k] = flapChar(line[k]);
  });
  return grid.map((row) => row.join(''));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function arrivedWaitStats(waitingRoom, nowMs) {
  const list = Array.isArray(waitingRoom && waitingRoom.appointments) ? waitingRoom.appointments : [];
  const arrived = list.filter((a) => a && a.isArrived);
  const count = waitingRoom && Number.isFinite(waitingRoom.arrivedCount) ? waitingRoom.arrivedCount : arrived.length;
  let maxWait = null;
  for (const a of arrived) {
    const m = waitMinutes(a.start || a.startDateTime, nowMs);
    if (m == null) continue;
    if (maxWait == null || m > maxWait) maxWait = m;
  }
  return { count, maxWaitMinutes: maxWait };
}

export function feedIsDegraded(snapshot) {
  return Boolean(snapshot && Array.isArray(snapshot.errors) && snapshot.errors.length);
}

export function buildTickerLines(snapshot) {
  const s = snapshot || {};
  const lines = [];
  const waiting = s.waiting && s.waiting.count;
  if (Number.isFinite(waiting)) {
    if (waiting <= 0) lines.push('No one waiting');
    else lines.push(waiting === 1 ? '1 person waiting' : `${waiting} people waiting`);
  }
  // Public ticker must not loop the wait-band minutes without the
  // "not a promise" caveat that lives on the tile.
  if (s.audience === 'staff' && s.waiting && s.waiting.band && s.waiting.count > 0) {
    lines.push(s.waiting.band);
  }
  if (s.tempo && TEMPO_LABEL[s.tempo]) {
    const lead = s.audience === 'staff' ? 'The practice is' : 'This room is';
    lines.push(`${lead} ${tempoLabelFor(s.tempo, s.audience).toLowerCase()}`);
  }
  // Public TVs must not announce back-office request volume — patients
  // read "28 medical requests" as people ahead of them.
  if (s.audience === 'staff') {
    const med = s.demand && s.demand.medical;
    const admin = s.demand && s.demand.admin;
    if (Number.isFinite(med)) lines.push(`${med} medical request${med === 1 ? '' : 's'} today`);
    if (Number.isFinite(admin)) lines.push(`${admin} admin request${admin === 1 ? '' : 's'} today`);
    const triage = s.triage && s.triage.total;
    if (Number.isFinite(triage)) lines.push(`${triage} in the triage inbox`);
    const urgent = s.triage && s.triage.urgent;
    if (Number.isFinite(urgent) && urgent > 0) {
      lines.push(`${urgent} urgent unactioned`);
    }
    const slots = s.slots && s.slots.total;
    if (Number.isFinite(slots)) lines.push(`${slots} bookable slot${slots === 1 ? '' : 's'} remaining`);
  }
  return lines;
}

// Reduce Condor-shaped streams to the only object the renderer may paint.
// `opts.ppi` is an already-computed { ppi, band } from condor-index-core —
// board-core does not import that file, so the formula stays in one place.
export function buildSnapshot(streams, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now();
  const thresholds = sanitiseThresholds(o.thresholds);
  const audience = o.audience === 'staff' ? 'staff' : 'public';
  const d = streams && typeof streams === 'object' ? streams : {};

  const wr = arrivedWaitStats(d.waitingRoom, nowMs);
  const totals = (d.submissions && d.submissions.totals) || {};
  const demand = {
    medical: num(totals.medical),
    admin: num(totals.admin),
    investigation: num(totals.investigation),
    rxRoutine: num(totals.rxRoutine),
    rxNonRoutine: num(totals.rxNonRoutine),
    all: num(totals.all),
  };
  const tempo = deriveTempo(
    { waitingCount: wr.count, maxWaitMinutes: wr.maxWaitMinutes, demandAll: demand.medical + demand.admin },
    thresholds,
    audience
  );
  const band = waitBand(wr.count, wr.maxWaitMinutes, thresholds);

  const rm = d.requestMonitor && !d.requestMonitor.unavailable ? d.requestMonitor : null;
  const slotsIn = d.slots || {};
  const act = (d.activity && d.activity.totals) || {};
  const cap = d.capacityPreset || null;

  const snapshot = {
    audience,
    tempo,
    tempoLabel: tempoLabelFor(tempo, audience),
    waiting: {
      count: wr.count,
      band: band.label,
      tone: band.tone,
    },
    demand,
    fetchedAt: nowMs,
    stale: false,
    siteId: null,
    errors: Array.isArray(d.fetchErrors) ? d.fetchErrors.map((e) => String(e)).slice(0, 6) : [],
  };

  // Staff-only fields still live on the object so ops can render them, but
  // public snapshots omit them entirely — a public TV's JSON has no triage
  // inbox, no PPI, no slot remainder the waiting room doesn't need.
  if (audience === 'staff') {
    snapshot.triage = {
      total: rm ? num(rm.totalCount) : 0,
      urgent: rm ? num(rm.urgentCount) : 0,
      byAge: {
        lt1h: num(rm && rm.byAgeBucket && rm.byAgeBucket.lt1h),
        h1to4: num(rm && rm.byAgeBucket && rm.byAgeBucket.h1to4),
        h4to8: num(rm && rm.byAgeBucket && rm.byAgeBucket.h4to8),
        gt8h: num(rm && rm.byAgeBucket && rm.byAgeBucket.gt8h),
      },
      configured: Boolean(rm),
    };
    snapshot.slots = {
      am: num(slotsIn.amRemaining),
      pm: num(slotsIn.pmRemaining),
      total: num(slotsIn.totalRemaining),
      capacityStatus: cap && typeof cap.status === 'string' ? cap.status : null,
    };
    snapshot.activity = {
      consultations: num(act.consultations),
      all: num(act.all),
    };
    const ppi = o.ppi && typeof o.ppi === 'object' ? o.ppi : null;
    snapshot.pressure = {
      ppi: ppi && Number.isFinite(ppi.ppi) ? Math.round(ppi.ppi) : null,
      band: ppi && typeof ppi.band === 'string' ? ppi.band : null,
    };
  }

  snapshot.ticker = buildTickerLines(snapshot);
  return snapshot;
}

// Recursively collect keys + string values. Used by the PII tests and as a
// last-line guard the renderer can call in debug builds.
const FORBIDDEN_KEYS = new Set([
  'patientName',
  'patient',
  'name',
  'summary',
  'reason',
  'staffName',
  'items',
  'appointments',
  'byStaff',
  'rows',
]);

export function snapshotLeaves(obj, out, path) {
  const acc = out || [];
  const p = path || '';
  if (obj == null) return acc;
  if (typeof obj !== 'object') {
    acc.push({ path: p, key: p.split('.').pop(), value: obj });
    return acc;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => snapshotLeaves(v, acc, p ? `${p}[${i}]` : `[${i}]`));
    return acc;
  }
  for (const [k, v] of Object.entries(obj)) {
    const next = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') snapshotLeaves(v, acc, next);
    else acc.push({ path: next, key: k, value: v });
  }
  return acc;
}

export function forbiddenSnapshotKeys(snapshot) {
  return snapshotLeaves(snapshot)
    .map((leaf) => leaf.key)
    .filter((k) => FORBIDDEN_KEYS.has(k));
}

// Demo streams — include deliberate PII so tests prove it is stripped.
export function demoStreams(nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const minsAgo = (m) => new Date(now - m * 60000).toISOString();
  return {
    siteId: 'demo',
    slots: {
      entries: [],
      amRemaining: 6,
      pmRemaining: 18,
      totalRemaining: 24,
      byStaff: { 'Dr Alice Example': { amRemaining: 3, pmRemaining: 6 } },
    },
    waitingRoom: {
      arrivedCount: 4,
      appointments: [
        {
          patientName: 'Alice Smith',
          staffName: 'Dr Example',
          start: minsAgo(8),
          reason: 'chest pain review',
          isArrived: true,
        },
        {
          patientName: 'Bob Jones',
          staffName: 'Dr Example',
          start: minsAgo(4),
          reason: 'earache',
          isArrived: true,
        },
        {
          patientName: 'Cara Patel',
          staffName: 'Nurse Example',
          start: minsAgo(2),
          reason: 'bloods',
          isArrived: true,
        },
        {
          patientName: 'Dee Walsh',
          staffName: 'Dr Example',
          start: minsAgo(1),
          reason: 'medication query',
          isArrived: true,
        },
        {
          patientName: 'Evan Cole',
          staffName: 'Dr Example',
          start: minsAgo(-30),
          reason: 'upcoming',
          isArrived: false,
        },
      ],
    },
    submissions: {
      tasks: [{ id: 't1', type: 'medical', createdAt: minsAgo(60), hourOfDay: 9 }],
      totals: { medical: 28, admin: 14, investigation: 6, rxRoutine: 11, rxNonRoutine: 3, all: 62 },
      byHour: [],
      filterIgnored: false,
    },
    requestMonitor: {
      items: [
        {
          id: 'r1',
          patient: 'AS',
          summary: 'Wants antibiotics for a cough',
          priority: 'urgent',
          createdAt: minsAgo(90),
          ageMs: 90 * 60000,
        },
      ],
      urgentCount: 1,
      totalCount: 9,
      byAgeBucket: { lt1h: 4, h1to4: 3, h4to8: 2, gt8h: 0 },
      lastPoll: now,
    },
    activity: {
      rows: [{ name: 'Dr Alice Example', consultations: 12, total: 20 }],
      totals: { consultations: 41, routineRx: 9, nonRoutineRx: 4, reviews: 3, documents: 18, results: 13, all: 88 },
    },
    capacityPreset: { minimum: 20, status: 'sufficient' },
    fetchErrors: [],
  };
}
