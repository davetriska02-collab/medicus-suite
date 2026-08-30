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

export const PUBLIC_WIDGETS = ['flap', 'tempo', 'waiting', 'ticker', 'clock'];
export const STAFF_ONLY_WIDGETS = ['pressure', 'triage', 'slots', 'urgent', 'activity', 'demand'];
export const ALL_WIDGETS = [...PUBLIC_WIDGETS, ...STAFF_ONLY_WIDGETS];

export const WIDGET_META = {
  flap: { label: 'Message flaps', audience: 'public' },
  tempo: { label: 'How busy we are', audience: 'public' },
  waiting: { label: 'People waiting', audience: 'public' },
  ticker: { label: 'Ticker', audience: 'public' },
  demand: { label: 'Requests today', audience: 'staff' },
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

export const MAX_PROFILE_NAME = 32;
export const MAX_COPY_CHARS = 160;
export const MAX_CUSTOM_PROFILES = 6;
export const SHIPPED_PROFILE_IDS = ['waiting-room', 'ops', 'message'];

export const DEFAULT_COPY = {
  tempoPublicQuiet: 'Quiet',
  tempoPublicSteady: 'Normal',
  tempoPublicBusy: 'Busy',
  tempoPublicVery: 'Very busy',
  tempoStaffQuiet: 'Quiet',
  tempoStaffSteady: 'Steady',
  tempoStaffBusy: 'Busy',
  tempoStaffVery: 'Very busy',
  tempoSubQuiet: 'Few people in this room',
  tempoSubSteady: 'A normal amount of people',
  tempoSubBusy: 'This room is busy',
  tempoSubVery: 'This room is very busy',
  tempoSubStaff: "Includes today's requests",
  waitUnder: 'Most waits are under {n} minutes',
  waitOver: 'Some waits are over {n} minutes',
  waitEmpty: 'No one waiting',
  waitUnknown: 'People are waiting',
  waitingLabel: 'People waiting',
  tempoLabelPublic: 'This room',
  tempoLabelStaff: 'How busy we are',
  demandLabel: 'Requests today',
  pressureLabel: 'Pressure index',
  pressureSub: "Weighted index, not today's request count",
  triageLabel: 'Triage inbox',
  slotsLabel: 'Slots remaining',
  urgentLabel: 'Urgent unactioned',
  activityLabel: 'Consultations today',
  failTitle: 'This board is not updating',
  failAsk: 'Please ask reception',
  failBody: 'The numbers are not available right now. Do not use this screen to judge how busy we are.',
  failBanner: 'Live figures failed. Do not trust these counts',
  tickerRoomLead: 'This room is',
  tickerPracticeLead: 'The practice is',
  tickerWaitingOne: '1 person waiting',
  tickerWaitingMany: '{n} people waiting',
  emptyBoard: 'Nothing to show on this profile yet.',
};

const COPY_KEYS = Object.keys(DEFAULT_COPY);

export function isCustomProfileId(id) {
  return typeof id === 'string' && /^c-[a-z0-9]{4,16}$/.test(id);
}

export function isKnownProfileId(id, extraIds) {
  if (SHIPPED_PROFILE_IDS.includes(id)) return true;
  if (isCustomProfileId(id)) return true;
  if (Array.isArray(extraIds) && extraIds.includes(id)) return true;
  return false;
}

export function newCustomProfileId() {
  // A timestamp alone collides when two boards are created in the same
  // millisecond (a double-fired click, a scripted batch add); the random
  // suffix keeps ids unique without needing storage round-trips to check.
  const rand = Math.random().toString(36).slice(2, 6);
  return `c-${Date.now().toString(36)}${rand}`;
}

export function newCustomProfile(audience) {
  const staff = audience === 'staff';
  return {
    id: newCustomProfileId(),
    name: staff ? 'Staff board' : 'Public board',
    audience: staff ? 'staff' : 'public',
    widgets: staff
      ? ['tempo', 'pressure', 'waiting', 'demand', 'triage', 'slots', 'clock']
      : ['flap', 'tempo', 'waiting', 'ticker', 'clock'],
    message: staff ? '' : 'Please take a seat.',
  };
}

export function fillCopy(template, n) {
  return String(template == null ? '' : template).replace(/\{n\}/g, String(n));
}

function stripMarkup(raw) {
  let s = String(raw == null ? '' : raw);
  s = s.replace(/<[^>]*>/g, '');
  s = [...s]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c === 10 || c === 13 || (c >= 32 && c !== 127);
    })
    .join('');
  return s.replace(/\s+/g, ' ').trim();
}

export function sanitiseCopy(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const out = {};
  for (const key of COPY_KEYS) {
    const fallback = DEFAULT_COPY[key];
    let next = stripMarkup(r[key] != null ? r[key] : fallback);
    if (!next) next = fallback;
    if (next.length > MAX_COPY_CHARS) next = next.slice(0, MAX_COPY_CHARS).trim() || fallback;
    out[key] = next;
  }
  return out;
}

export function tempoLabelFor(tempo, audience, copy) {
  const c = copy ? sanitiseCopy(copy) : DEFAULT_COPY;
  if (audience === 'public') {
    if (tempo === 'quiet') return c.tempoPublicQuiet;
    if (tempo === 'steady') return c.tempoPublicSteady;
    if (tempo === 'busy') return c.tempoPublicBusy;
    if (tempo === 'very-busy') return c.tempoPublicVery;
  } else {
    if (tempo === 'quiet') return c.tempoStaffQuiet;
    if (tempo === 'steady') return c.tempoStaffSteady;
    if (tempo === 'busy') return c.tempoStaffBusy;
    if (tempo === 'very-busy') return c.tempoStaffVery;
  }
  return TEMPO_LABEL[tempo] || '';
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

export const DEFAULT_STYLE_ID = 'standard';
export const DEFAULT_COLOUR_ID = 'flap';

// Ten structural styles. Standard keeps the split-flap chassis and then
// takes a colour option. The other nine change layout, type and chrome.
export const BOARD_STYLES = [
  {
    id: 'standard',
    name: 'Standard',
    blurb: 'Split-flap station board. Colour options below.',
  },
  {
    id: 'clear',
    name: 'Clear',
    blurb: 'Light, airy, large sans. Soft and spare, like a modern phone.',
  },
  {
    id: 'plain',
    name: 'Plain',
    blurb: 'Black on white. No decoration. The words do the work.',
  },
  {
    id: 'service',
    name: 'Service',
    blurb: 'Clinical notice. Blue bar, white page, the NHS service voice.',
  },
  {
    id: 'notice',
    name: 'Notice',
    blurb: 'Broadsheet masthead. Serif headline, thin rules, paper.',
  },
  {
    id: 'sign',
    name: 'Sign',
    blurb: 'Corridor wayfinding. Huge condensed type, numbers first.',
  },
  {
    id: 'timetable',
    name: 'Timetable',
    blurb: 'Departure board. Amber LED rows, one line per figure.',
  },
  {
    id: 'console',
    name: 'Console',
    blurb: 'Dense instrument panel. Small type, many rules, low glare.',
  },
  {
    id: 'lobby',
    name: 'Lobby',
    blurb: 'One large sentence. Quiet figures. A hotel desk, not a clinic.',
  },
  {
    id: 'plaque',
    name: 'Plaque',
    blurb: 'Museum caption. Small type on a large wall. Space is the material.',
  },
];

// Colour options apply only to Standard. Older configs stored one of these
// as styleId; sanitiseConfig migrates that to style=standard + colour=id.
export const BOARD_COLOURS = [
  {
    id: 'flap',
    name: 'Split-flap',
    blurb: 'Cream flaps on a black chassis.',
    swatches: ['#07080b', '#e7dcc8', '#fbbf24'],
  },
  {
    id: 'daylight',
    name: 'Daylight',
    blurb: 'Navy ink on warm off-white cards.',
    swatches: ['#f3efe6', '#1b2740', '#a8142b'],
  },
  {
    id: 'clinic',
    name: 'Clinic',
    blurb: 'Pale flaps on an NHS-blue sign.',
    swatches: ['#003087', '#f0f4f5', '#ffb81c'],
  },
  {
    id: 'wayfind',
    name: 'Wayfind',
    blurb: 'Safety-yellow plates on black.',
    swatches: ['#000000', '#ffd200', '#ffffff'],
  },
  {
    id: 'transit',
    name: 'Transit',
    blurb: 'Amber glyphs on a departure board.',
    swatches: ['#000000', '#17130c', '#ffb000'],
  },
  {
    id: 'instrument',
    name: 'Instrument',
    blurb: 'Cool slate, hairline borders.',
    swatches: ['#0e1725', '#1a2840', '#48d19b'],
  },
  {
    id: 'nightwatch',
    name: 'Night watch',
    blurb: 'Phosphor figures, low glare.',
    swatches: ['#05080a', '#9fe9bd', '#f5a33c'],
  },
  {
    id: 'ledger',
    name: 'Ledger',
    blurb: 'Warm paper and a serif message.',
    swatches: ['#f2ece0', '#1c1913', '#855510'],
  },
  {
    id: 'gallery',
    name: 'Gallery',
    blurb: 'Pale stone and charcoal plates.',
    swatches: ['#d6d3cc', '#2c2e2b', '#b08d4f'],
  },
  {
    id: 'harbour',
    name: 'Harbour',
    blurb: 'Harbour teal and brass edges.',
    swatches: ['#06201e', '#14403a', '#c8a45e'],
  },
];

const STYLE_ID_SET = new Set(BOARD_STYLES.map((s) => s.id));
const COLOUR_ID_SET = new Set(BOARD_COLOURS.map((c) => c.id));

export function isLegacyColourAsStyle(id) {
  return typeof id === 'string' && COLOUR_ID_SET.has(id) && !STYLE_ID_SET.has(id);
}

export function sanitiseStyleId(id) {
  if (isLegacyColourAsStyle(id)) return DEFAULT_STYLE_ID;
  return STYLE_ID_SET.has(id) ? id : DEFAULT_STYLE_ID;
}

export function sanitiseColourId(id) {
  return COLOUR_ID_SET.has(id) ? id : DEFAULT_COLOUR_ID;
}

export function resolveStyleAndColour(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (isLegacyColourAsStyle(r.styleId)) {
    return { styleId: DEFAULT_STYLE_ID, colourId: sanitiseColourId(r.styleId) };
  }
  return {
    styleId: sanitiseStyleId(r.styleId),
    colourId: sanitiseColourId(r.colourId),
  };
}

export const DEFAULT_CONFIG = {
  version: 2,
  activeProfileId: 'waiting-room',
  pollSeconds: DEFAULT_POLL_SECONDS,
  thresholds: { ...DEFAULT_THRESHOLDS },
  copy: { ...DEFAULT_COPY },
  publicCountsRequests: false,
  styleId: DEFAULT_STYLE_ID,
  colourId: DEFAULT_COLOUR_ID,
  profiles: DEFAULT_PROFILES.map((p) => ({ ...p, widgets: [...p.widgets] })),
};

const PROFILE_IDS = new Set(SHIPPED_PROFILE_IDS);
const WIDGET_SET = new Set(ALL_WIDGETS);

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function clampInt(n, lo, hi, fallback) {
  if (n == null || (typeof n === 'string' && n.trim() === '')) return fallback;
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

// Practice-authored flap text. Strips markup and control characters so a
// crafted backup cannot smuggle HTML onto a waiting-room TV.
export function sanitiseMessage(raw) {
  let s = stripMarkup(raw);
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

function sanitiseName(raw, fallback) {
  const s = sanitiseMessage(raw);
  if (!s) return fallback;
  return s.length > MAX_PROFILE_NAME ? s.slice(0, MAX_PROFILE_NAME).trim() : s;
}

function sanitiseProfile(raw, fallback) {
  const fb = fallback || DEFAULT_PROFILES[0];
  const r = isPlainObject(raw) ? raw : {};
  const shipped = typeof r.id === 'string' ? DEFAULT_PROFILES.find((p) => p.id === r.id) : null;
  const custom = typeof r.id === 'string' && isCustomProfileId(r.id);
  const id = shipped ? shipped.id : custom ? r.id : fb.id;
  // Shipped ids lock audience. Custom boards pick public or staff once,
  // then keep it — flipping waiting-room to staff is still impossible.
  const lockedAudience = shipped ? shipped.audience : r.audience === 'staff' ? 'staff' : 'public';
  const nameFallback = shipped ? shipped.name : fb.name;
  const widgetFallback = shipped ? shipped.widgets : fb.widgets;
  const messageFallback = shipped ? shipped.message : fb.message;
  return {
    id,
    name: sanitiseName(r.name != null ? r.name : nameFallback, nameFallback),
    audience: lockedAudience,
    widgets: sanitiseWidgets(r.widgets || widgetFallback, lockedAudience),
    message: sanitiseMessage(r.message != null ? r.message : messageFallback),
  };
}

export function sanitiseConfig(raw) {
  const r = isPlainObject(raw) ? raw : {};
  const incoming = Array.isArray(r.profiles) ? r.profiles : [];
  const profiles = DEFAULT_PROFILES.map((shipped) => {
    const found = incoming.find((p) => p && p.id === shipped.id);
    return sanitiseProfile(found || shipped, shipped);
  });
  // De-dupe by id BEFORE capping to MAX_CUSTOM_PROFILES — a duplicate id
  // in the incoming list must not eat one of the cap's real slots.
  const extraIds = new Set();
  const extras = [];
  for (const p of incoming) {
    if (!p || !isCustomProfileId(p.id) || extraIds.has(p.id)) continue;
    extraIds.add(p.id);
    extras.push(sanitiseProfile(p, newCustomProfile(p.audience)));
    if (extras.length >= MAX_CUSTOM_PROFILES) break;
  }
  const seen = new Set(profiles.map((p) => p.id));
  for (const extra of extras) {
    if (seen.has(extra.id)) continue;
    seen.add(extra.id);
    profiles.push(extra);
  }
  const known = new Set(profiles.map((p) => p.id));
  let activeProfileId = typeof r.activeProfileId === 'string' ? r.activeProfileId : DEFAULT_CONFIG.activeProfileId;
  if (!known.has(activeProfileId)) activeProfileId = DEFAULT_CONFIG.activeProfileId;
  return {
    version: 2,
    activeProfileId,
    pollSeconds: clampInt(r.pollSeconds, MIN_POLL_SECONDS, MAX_POLL_SECONDS, DEFAULT_POLL_SECONDS),
    thresholds: sanitiseThresholds(r.thresholds),
    copy: sanitiseCopy(r.copy),
    publicCountsRequests: r.publicCountsRequests === true,
    ...resolveStyleAndColour(r),
    profiles,
  };
}

export function resolveProfile(config, requestedId) {
  const cfg = sanitiseConfig(config);
  const known = new Set(cfg.profiles.map((p) => p.id));
  const id = typeof requestedId === 'string' && known.has(requestedId) ? requestedId : cfg.activeProfileId;
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

export function waitBand(count, maxWaitMinutes, thresholds, copy) {
  const t = sanitiseThresholds(thresholds);
  const c = sanitiseCopy(copy);
  const n = Number(count) || 0;
  if (n <= 0) return { label: c.waitEmpty, tone: 'quiet', maxWaitMinutes: null };
  if (maxWaitMinutes == null || !Number.isFinite(maxWaitMinutes)) {
    return { label: c.waitUnknown, tone: 'steady', maxWaitMinutes: null };
  }
  if (maxWaitMinutes < t.amberWaitMin) {
    return { label: fillCopy(c.waitUnder, t.amberWaitMin), tone: 'quiet', maxWaitMinutes };
  }
  if (maxWaitMinutes < t.redWaitMin) {
    return { label: fillCopy(c.waitUnder, t.redWaitMin), tone: 'steady', maxWaitMinutes };
  }
  return { label: fillCopy(c.waitOver, t.redWaitMin), tone: 'busy', maxWaitMinutes };
}

export function deriveTempo({ waitingCount, maxWaitMinutes, demandAll }, thresholds, mode) {
  const t = sanitiseThresholds(thresholds);
  const waiting = Number(waitingCount) || 0;
  const demand = Number(demandAll) || 0;
  const wait = Number.isFinite(maxWaitMinutes) ? maxWaitMinutes : 0;
  // Public TVs answer "how does the room feel?" unless the practice
  // explicitly turns on publicCountsRequests. Allow-list, not a
  // deny-list: an unrecognised mode must not fail open into counting
  // requests on what could be a public screen.
  const useDemand = mode === 'staff' || mode === 'public-demand';
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

export function buildTickerLines(snapshot, copy) {
  const s = snapshot || {};
  const c = sanitiseCopy(copy);
  const lines = [];
  const waiting = s.waiting && s.waiting.count;
  if (Number.isFinite(waiting)) {
    if (waiting <= 0) lines.push(c.waitEmpty);
    else lines.push(waiting === 1 ? c.tickerWaitingOne : fillCopy(c.tickerWaitingMany, waiting));
  }
  // Public ticker must not loop the wait-band minutes — those live
  // on the People waiting tile, which the practice can switch off.
  if (s.audience === 'staff' && s.waiting && s.waiting.band && s.waiting.count > 0) {
    lines.push(s.waiting.band);
  }
  if (s.tempo && TEMPO_LABEL[s.tempo]) {
    const lead = s.audience === 'staff' ? c.tickerPracticeLead : c.tickerRoomLead;
    lines.push(`${lead} ${tempoLabelFor(s.tempo, s.audience, c).toLowerCase()}`);
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
  const copy = sanitiseCopy(o.copy);
  const audience = o.audience === 'staff' ? 'staff' : 'public';
  const tempoMode = audience === 'public' && o.publicCountsRequests === true ? 'public-demand' : audience;
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
    tempoMode
  );
  const band = waitBand(wr.count, wr.maxWaitMinutes, thresholds, copy);

  const rm = d.requestMonitor && !d.requestMonitor.unavailable ? d.requestMonitor : null;
  const slotsIn = d.slots || {};
  const act = (d.activity && d.activity.totals) || {};
  const cap = d.capacityPreset || null;

  const snapshot = {
    audience,
    tempo,
    tempoLabel: tempoLabelFor(tempo, audience, copy),
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

  snapshot.ticker = buildTickerLines(snapshot, copy);
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
