// Auto-rota solver (v2): optimises session-type assignment over a fixed presence
// matrix using greedy initialisation followed by simulated annealing.
// Returns a change-set and diagnostics; the UI previews and the user applies.
//
// v2 adds three dimensions on top of v1's duty/VTS/fairness core:
//   - enhanced-access allocation against the EA DES target (extraPeriods only),
//   - avoid-duty as an explicit last-resort with reporting, not a silent penalty,
//   - room awareness: type moves are scored against room clashes and the proposal
//     carries room reassignments where a free room exists.
// Every dimension is a weighted term — the solver proposes, the rules warn; nothing
// here hard-blocks.
// Pure module: no DOM, no chrome.*, no fetch.

import { dayKey, mondayOf, addDays, templateWeekIndex } from '../shared/time.js';
import { typeById, roleById, PERIOD_INFO } from '../shared/model.js';
import { approvedLeaveFor } from './leave.js';
import { checkWeek } from './rules.js';

export const DEFAULT_WEIGHTS = {
  dutyGap: 1000, // per missing duty doctor per slot(/site)
  vts: 400, // per registrar clinical session on their VTS half-day
  fairness: 2000, // × sum of squared deviations of duty share from the mean
  sameDay: 60, // per person with duty AM and PM on the same date
  weeklyCap: 80, // per duty session over options.maxDutyPerWeek, per person per week
  locumDuty: 40, // per duty session given to a locum (prefer employed GPs)
  preference: 30, // per duty session on a slot in that person's staff.avoidDuty
  churn: 1, // per entry whose final type differs from its original type
  eaGap: 300, // per HOUR of enhanced-access shortfall vs the DES target, per week
  roomClash: 150, // per surplus session sharing one room in one slot
};

// Types that occupy a consulting room, and types that count as clinical.
// Kept as explicit sets so the scoring never drifts with the model's cosmetics.
const SESSION_TYPES_CLINICAL = new Set(['surgery', 'triage', 'duty', 'visits', 'enhanced']);
const ACTIVE_STATUS = new Set(['planned', 'confirmed', 'covered']);
const isActive = (entry) => ACTIVE_STATUS.has(entry.status);

// A session occupies a physical room when it is clinical AND builds a clinic
// (home visits do not; admin/CPD/tutorial/meeting do not) — same rule as
// engine/room-infer.js's fillRooms.
function occupiesRoom(typeId) {
  const t = typeById(typeId);
  return Boolean(t && t.clinical && t.buildsClinic);
}

// Enhanced-access reporting labels for the score breakdown.
const EXPLAIN_ORDER = [
  'dutyGap',
  'ea',
  'fairness',
  'vts',
  'preference',
  'rooms',
  'sameDay',
  'weeklyCap',
  'locumDuty',
  'churn',
];
const EXPLAIN_META = {
  dutyGap: { label: 'Duty cover', weightKey: 'dutyGap', unit: 'duty slot(s) uncovered' },
  ea: { label: 'Enhanced access', weightKey: 'eaGap', unit: 'minute(s) short of the EA target' },
  fairness: { label: 'Duty fairness', weightKey: 'fairness', unit: 'duty-share variance' },
  vts: { label: 'VTS protection', weightKey: 'vts', unit: 'registrar clinical session(s) on a VTS half-day' },
  preference: { label: 'Avoid-duty', weightKey: 'preference', unit: 'duty session(s) on an avoided slot' },
  rooms: { label: 'Room clashes', weightKey: 'roomClash', unit: 'session(s) sharing a room' },
  sameDay: { label: 'Same-day double duty', weightKey: 'sameDay', unit: 'extra duty session(s) on one day' },
  weeklyCap: { label: 'Weekly duty cap', weightKey: 'weeklyCap', unit: 'duty session(s) over the cap' },
  locumDuty: { label: 'Locum duty', weightKey: 'locumDuty', unit: 'duty session(s) given to a locum' },
  churn: { label: 'Churn', weightKey: 'churn', unit: 'session(s) changed' },
};

// --- mulberry32: a fast, deterministic 32-bit PRNG ---
// Produces floats in [0,1). Seed must be a non-negative integer.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Locked entries: status ∈ {vacancy, covered, cancelled}, source === 'manual',
// or status === 'confirmed'. These are never modified by the solver.
function isLocked(entry) {
  return (
    entry.status === 'vacancy' ||
    entry.status === 'covered' ||
    entry.status === 'cancelled' ||
    entry.source === 'manual' ||
    entry.status === 'confirmed'
  );
}

// Allowed session types for a flexible entry given the entry's original type,
// the person's eligibility, and the pattern revert type for duty→non-duty moves.
// revertType: the type the person would have had (from pattern/template), fallback 'surgery'.
// eaCapable: the entry sits in an enabled extended-hours period and the person may
// deliver a clinical EA session — it may take (or give up) 'enhanced'.
// isCore: the entry is in a core AM/PM period — duty only ever exists in core hours.
function allowedTypes(originalType, isEligible, revertType, { eaCapable = false, isCore = true } = {}) {
  const types = new Set([originalType]);
  // duty can be assigned when eligible, in core hours, and original type is surgery/triage/duty
  if (isEligible && isCore && (originalType === 'surgery' || originalType === 'triage' || originalType === 'duty')) {
    types.add('duty');
  }
  // an original-duty entry may also revert to the pattern type (to shed excess duty)
  if (originalType === 'duty') {
    types.add(revertType);
  }
  // extended-hours entries may be turned into (or out of) enhanced access
  if (eaCapable) {
    types.add('enhanced');
    if (originalType === 'enhanced') types.add(revertType);
  }
  return [...types];
}

export function solveRota({
  dates,
  entries,
  staff,
  leaveList,
  settings,
  rooms = [],
  historyEntries = [],
  options = {},
}) {
  const { maxDutyPerWeek = 2, iterations = 8000, seed = 1, weights: weightOverrides = {} } = options;

  const W = { ...DEFAULT_WEIGHTS, ...weightOverrides };
  const rng = mulberry32(seed);

  // --- Pre-compute lookups ---

  const bankHolidays = new Set(settings.bankHolidays || []);
  const openDays = new Set(settings.openDays || []);
  const sites = (settings.sites || []).filter(Boolean);
  const dutyRequired = settings.dutyRequired || { am: 1, pm: 1 };
  const anchor = settings.templateAnchorMonday || dates[0];
  const roomList = (rooms || []).filter((r) => r && r.id);

  // Extended-access (enhanced access) periods the practice actually runs.
  const extraPeriods = settings.extraPeriods || {};
  const eaPeriods = new Set(['early', 'eve'].filter((p) => extraPeriods[p]));
  // EA DES: 60 minutes of appointments per 1,000 patients per week (mirrors
  // rules.js eaSummary — same definition of "enough EA").
  const eaTargetMinutes = Math.round(((settings.listSize || 0) / 1000) * 60);

  // horizon: only entries falling within the supplied dates
  const dateSet = new Set(dates);
  const horizonEntries = entries.filter((e) => dateSet.has(e.date));

  const staffById = Object.fromEntries(staff.map((s) => [s.id, s]));

  // Leave is static across the solve — memoise it once.
  const leaveMemo = new Map();
  function onLeave(staffId, date) {
    const key = `${staffId}|${date}`;
    let v = leaveMemo.get(key);
    if (v === undefined) {
      v = Boolean(approvedLeaveFor(leaveList, staffId, date));
      leaveMemo.set(key, v);
    }
    return v;
  }

  // Open slots: (date, period) pairs where duty may be required
  const openSlots = [];
  const eaSlots = [];
  for (const date of dates) {
    if (!openDays.has(dayKey(date))) continue;
    if (bankHolidays.has(date)) continue;
    for (const period of ['am', 'pm']) {
      openSlots.push({ date, period });
    }
    for (const period of eaPeriods) {
      eaSlots.push({ date, period });
    }
  }

  // Mon–Sun week boundaries for weeklyCap and the weekly EA target
  const weekMondays = [...new Set(dates.map((d) => mondayOf(d)))];

  // For each flexible entry, compute its original type and revert type.
  // revertType comes from the person's pattern via templateWeekIndex, fallback 'surgery'.
  function revertTypeFor(entry) {
    const person = staffById[entry.staffId];
    if (!person) return 'surgery';
    const pattern = person.pattern || [];
    if (!pattern.length) return 'surgery';
    const weekIdx = templateWeekIndex(anchor, entry.date, pattern.length);
    const week = pattern[weekIdx];
    if (!week) return 'surgery';
    const daySlot = week[dayKey(entry.date)];
    if (!daySlot) return 'surgery';
    return daySlot[entry.period] || 'surgery';
  }

  // Someone who can deliver a clinical enhanced-access session: a clinician
  // (never a nonclinical role, never a directory lane).
  function canDeliverEA(person) {
    if (!person || person.notAPerson) return false;
    const role = roleById(person.role);
    return Boolean(role && role.group !== 'nonclinical');
  }

  // Classify entries once
  // Each entry gets: locked (bool), originalType, revertType, allowedTypes[]
  const entryMeta = new Map(); // entryId -> { locked, originalType, revertType, allowed, isVtsForced, eligible, eaCapable }
  for (const entry of horizonEntries) {
    const person = staffById[entry.staffId];
    const locked = isLocked(entry);
    const originalType = entry.typeId;
    const rt = revertTypeFor(entry);
    const isCore = entry.period === 'am' || entry.period === 'pm';

    // Duty eligibility at this slot: GP + dutyEligible + no leave + present (has an entry)
    // We check leave dynamically; presence is implied by having an entry in the horizon.
    let eligible = false;
    let isVtsForced = false;
    let eaCapable = false;

    if (person) {
      eligible = person.role === 'gp' && Boolean(person.dutyEligible) && !onLeave(person.id, entry.date);
      eaCapable = eaPeriods.has(entry.period) && canDeliverEA(person) && !onLeave(person.id, entry.date);

      // VTS forced: registrar clinical on their VTS slot -> must become 'tutorial'
      if (
        person.employmentType === 'registrar' &&
        person.vtsDay &&
        person.vtsDay === `${dayKey(entry.date)}-${entry.period}` &&
        originalType !== 'tutorial'
      ) {
        if (SESSION_TYPES_CLINICAL.has(originalType)) {
          isVtsForced = true;
        }
      }
    }

    const allowed = isVtsForced ? ['tutorial'] : allowedTypes(originalType, eligible, rt, { eaCapable, isCore });

    entryMeta.set(entry.id, { locked, originalType, revertType: rt, allowed, isVtsForced, eligible, eaCapable });
  }

  // Flexible entries: not locked, inside horizon
  const flexEntries = horizonEntries.filter((e) => !entryMeta.get(e.id).locked);

  // Flexible GP entries for fairness/duty moves
  const flexGpEntries = flexEntries.filter((e) => {
    const p = staffById[e.staffId];
    return p && p.role === 'gp';
  });

  // Flexible entries that can carry an enhanced-access session
  const flexEaEntries = flexEntries.filter((e) => {
    const meta = entryMeta.get(e.id);
    return meta && meta.eaCapable && meta.allowed.includes('enhanced');
  });

  // EA is only a live dimension when the practice runs extended periods and has
  // a list size to size the DES target against. When it is not, the move ladder
  // and the score are byte-for-byte the v1 ones.
  const eaActive = eaPeriods.size > 0 && eaTargetMinutes > 0;

  // History duty counts per eligible GP (status not vacancy/cancelled)
  const histDutyCount = {};
  for (const person of staff) {
    if (!person.dutyEligible || person.role !== 'gp' || !(person.contractedSessions > 0)) continue;
    histDutyCount[person.id] = historyEntries.filter(
      (e) => e.staffId === person.id && e.typeId === 'duty' && e.status !== 'cancelled' && e.status !== 'vacancy'
    ).length;
  }

  // Eligible GPs for fairness (contractedSessions > 0)
  const eligibleGPs = staff.filter(
    (s) => s.role === 'gp' && Boolean(s.dutyEligible) && (s.contractedSessions || 0) > 0
  );

  // Entries indexed by slot, preserving horizon order (used by greedy fill,
  // gap detection and the transfer move).
  const slotEntries = new Map(); // `${date}|${period}` -> Entry[]
  for (const entry of horizonEntries) {
    const key = `${entry.date}|${entry.period}`;
    const list = slotEntries.get(key);
    if (list) list.push(entry);
    else slotEntries.set(key, [entry]);
  }
  const entriesAt = (date, period) => slotEntries.get(`${date}|${period}`) || [];

  // Does this person's avoidDuty list cover this slot?
  function avoidsDuty(person, date, period) {
    return Boolean(person && (person.avoidDuty || []).includes(`${dayKey(date)}-${period}`));
  }

  const siteOf = (person) => person.site || sites[0];

  // Duty cover on a slot for the given assignment (optionally per site).
  function dutyCoverAt(types, date, period, site) {
    let count = 0;
    for (const entry of entriesAt(date, period)) {
      const p = staffById[entry.staffId];
      if (!p || p.role !== 'gp' || !p.dutyEligible) continue;
      if (site && siteOf(p) !== site) continue;
      if (onLeave(p.id, date)) continue;
      if ((types.get(entry.id) || entry.typeId) === 'duty') count++;
    }
    return count;
  }

  // --- Score ---
  // One evaluation function feeds both the annealing loop and the reported
  // breakdown, so the two can never drift. O(entries) per call.
  // roomOf: optional Map(entryId -> roomId) overriding the entries' own rooms
  // (the post-solve room repair proposes new ones).
  function evaluate(types, roomOf) {
    const m = {
      dutyGap: 0,
      vts: 0,
      fairness: 0,
      sameDay: 0,
      weeklyCap: 0,
      locumDuty: 0,
      preference: 0,
      churn: 0,
      ea: 0,
      rooms: 0,
    };

    const personDutyTotal = {}; // staffId -> total duty sessions in horizon
    const personDutyDate = {}; // staffId|date -> count
    const personDutyWeek = {}; // staffId|mondayISO -> count
    const slotDuty = {}; // date|period[|site] -> count
    const eaMinutes = {}; // mondayISO -> minutes of clinical EA rostered
    const roomUse = {}; // date|period|roomId -> room-occupying sessions

    for (const entry of horizonEntries) {
      const t = types.get(entry.id) || entry.typeId;
      const person = staffById[entry.staffId];
      if (!person) continue;

      if (t === 'duty') {
        personDutyTotal[person.id] = (personDutyTotal[person.id] || 0) + 1;
        const dk = `${person.id}|${entry.date}`;
        personDutyDate[dk] = (personDutyDate[dk] || 0) + 1;
        const wk = `${person.id}|${mondayOf(entry.date)}`;
        personDutyWeek[wk] = (personDutyWeek[wk] || 0) + 1;

        // slot duty count — only count duty-eligible GPs toward coverage
        if (person.role === 'gp' && person.dutyEligible && !onLeave(person.id, entry.date)) {
          const sk =
            sites.length > 1 ? `${entry.date}|${entry.period}|${siteOf(person)}` : `${entry.date}|${entry.period}`;
          slotDuty[sk] = (slotDuty[sk] || 0) + 1;
        }

        if (person.employmentType === 'locum') m.locumDuty += 1;
        if (avoidsDuty(person, entry.date, entry.period)) m.preference += 1;
      }

      // VTS penalty: registrar clinical on VTS slot
      if (person.employmentType === 'registrar' && person.vtsDay) {
        if (SESSION_TYPES_CLINICAL.has(t) && person.vtsDay === `${dayKey(entry.date)}-${entry.period}`) {
          m.vts += 1;
        }
      }

      // Enhanced access: clinical minutes actually rostered in the extended
      // periods (mirrors rules.js eaSummary).
      if (eaActive && eaPeriods.has(entry.period) && isActive(entry) && !onLeave(person.id, entry.date)) {
        if (SESSION_TYPES_CLINICAL.has(t)) {
          const mon = mondayOf(entry.date);
          eaMinutes[mon] = (eaMinutes[mon] || 0) + ((PERIOD_INFO[entry.period] || {}).minutes || 0);
        }
      }

      // Rooms: two room-occupying sessions in one room in one slot clash.
      const roomId = (roomOf && roomOf.get(entry.id)) || entry.roomId;
      if (roomId && isActive(entry) && occupiesRoom(t)) {
        const rk = `${entry.date}|${entry.period}|${roomId}`;
        roomUse[rk] = (roomUse[rk] || 0) + 1;
      }

      // churn: final type != original type (only for entries with a meta record)
      const meta = entryMeta.get(entry.id);
      if (meta && t !== meta.originalType) m.churn += 1;
    }

    // dutyGap: per open slot/site
    for (const { date, period } of openSlots) {
      const required = dutyRequired[period] ?? 1;
      const siteGroups = sites.length > 1 ? sites : [null];
      for (const site of siteGroups) {
        const sk = site ? `${date}|${period}|${site}` : `${date}|${period}`;
        m.dutyGap += Math.max(0, required - (slotDuty[sk] || 0));
      }
    }

    // sameDay: per person with duty both AM and PM on the same date
    for (const count of Object.values(personDutyDate)) {
      if (count >= 2) m.sameDay += count - 1;
    }

    // weeklyCap: per excess duty over maxDutyPerWeek per person per week
    for (const count of Object.values(personDutyWeek)) {
      if (count > maxDutyPerWeek) m.weeklyCap += count - maxDutyPerWeek;
    }

    // fairness: Σ(share_i - mean)²
    // Locums (contracted 0) excluded; only eligible GPs with contractedSessions > 0
    const shares = eligibleGPs.map((person) => {
      const hist = histDutyCount[person.id] || 0;
      const planned = personDutyTotal[person.id] || 0;
      return (hist + planned) / person.contractedSessions;
    });
    if (shares.length > 0) {
      const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
      for (const s of shares) m.fairness += (s - mean) * (s - mean);
    }

    // EA shortfall in minutes, per Mon–Sun week in the horizon
    if (eaActive) {
      for (const mon of weekMondays) {
        m.ea += Math.max(0, eaTargetMinutes - (eaMinutes[mon] || 0));
      }
    }

    // Room clashes: surplus sessions sharing a room
    for (const count of Object.values(roomUse)) {
      if (count > 1) m.rooms += count - 1;
    }

    const breakdown = {
      dutyGap: W.dutyGap * m.dutyGap,
      vts: W.vts * m.vts,
      fairness: W.fairness * m.fairness,
      sameDay: W.sameDay * m.sameDay,
      weeklyCap: W.weeklyCap * m.weeklyCap,
      locumDuty: W.locumDuty * m.locumDuty,
      preference: W.preference * m.preference,
      churn: W.churn * m.churn,
      ea: W.eaGap * (m.ea / 60),
      rooms: W.roomClash * m.rooms,
    };

    const total =
      breakdown.dutyGap +
      breakdown.vts +
      breakdown.fairness +
      breakdown.sameDay +
      breakdown.weeklyCap +
      breakdown.locumDuty +
      breakdown.preference +
      breakdown.churn +
      breakdown.ea +
      breakdown.rooms;

    return { total, breakdown, measures: m };
  }

  const score = (types) => evaluate(types).total;

  // --- Initial solution: original types ---
  // currentTypes maps entryId -> current typeId (only for entries we track)
  const currentTypes = new Map();
  for (const entry of horizonEntries) {
    currentTypes.set(entry.id, entry.typeId);
  }

  // score.before: score of the raw original types (before greedy / VTS fixes)
  const scoreBefore = score(currentTypes);

  // Step 1a: Apply forced VTS fixes (registrar clinical on their VTS slot -> 'tutorial')
  for (const entry of flexEntries) {
    const meta = entryMeta.get(entry.id);
    if (meta && meta.isVtsForced) {
      currentTypes.set(entry.id, 'tutorial');
    }
  }

  // Step 1b: Greedy duty fill
  // For each open slot with a gap, assign the present, eligible, flexible GP
  // with the lowest duty share (history + current). Ties break toward someone
  // who has NOT asked to avoid duty on that slot, then by name.
  const greedyDutyCount = Object.fromEntries(eligibleGPs.map((p) => [p.id, histDutyCount[p.id] || 0]));

  for (const { date, period } of openSlots) {
    const required = dutyRequired[period] ?? 1;

    const siteGroups = sites.length > 1 ? sites : [null];
    for (const site of siteGroups) {
      let dutyCount = 0;
      const candidates = [];

      for (const entry of entriesAt(date, period)) {
        const person = staffById[entry.staffId];
        if (!person) continue;
        if (site && siteOf(person) !== site) continue;

        const t = currentTypes.get(entry.id);
        if (t === 'duty' && person.role === 'gp' && person.dutyEligible && !onLeave(person.id, date)) {
          dutyCount++;
        }

        // Candidate: flexible, eligible GP, allowed to take duty
        const meta = entryMeta.get(entry.id);
        if (!meta || meta.locked) continue;
        if (!meta.eligible) continue;
        if (!meta.allowed.includes('duty')) continue;
        if (t === 'duty') continue; // already duty
        candidates.push({ entry, person, avoids: avoidsDuty(person, date, period) ? 1 : 0 });
      }

      while (dutyCount < required && candidates.length > 0) {
        // Sort by duty share, then avoid-duty preference, then name
        candidates.sort((a, b) => {
          const sa = greedyDutyCount[a.person.id] / a.person.contractedSessions;
          const sb = greedyDutyCount[b.person.id] / b.person.contractedSessions;
          if (sa !== sb) return sa - sb;
          if (a.avoids !== b.avoids) return a.avoids - b.avoids;
          return (a.person.name || '').localeCompare(b.person.name || '');
        });

        const pick = candidates.shift();
        currentTypes.set(pick.entry.id, 'duty');
        greedyDutyCount[pick.person.id] = (greedyDutyCount[pick.person.id] || 0) + 1;
        dutyCount++;
      }
    }
  }

  // Step 1c: Greedy enhanced-access fill (only when the practice runs extended
  // periods). Each week short of the EA DES target takes flexible extended-hours
  // sessions, GPs first (the DES needs a GP physically present), until the target
  // is met or nobody is left. Deterministic order: date, period, GP-first, name, id.
  if (eaActive && flexEaEntries.length) {
    const eaByWeek = new Map(); // monday -> { minutes, candidates[] }
    for (const mon of weekMondays) eaByWeek.set(mon, { minutes: 0, candidates: [] });
    for (const entry of horizonEntries) {
      if (!eaPeriods.has(entry.period)) continue;
      const person = staffById[entry.staffId];
      if (!person) continue;
      const bucket = eaByWeek.get(mondayOf(entry.date));
      if (!bucket) continue;
      const t = currentTypes.get(entry.id) || entry.typeId;
      if (isActive(entry) && !onLeave(person.id, entry.date) && SESSION_TYPES_CLINICAL.has(t)) {
        bucket.minutes += (PERIOD_INFO[entry.period] || {}).minutes || 0;
      }
    }
    for (const entry of flexEaEntries) {
      const bucket = eaByWeek.get(mondayOf(entry.date));
      if (!bucket) continue;
      if (SESSION_TYPES_CLINICAL.has(currentTypes.get(entry.id) || entry.typeId)) continue;
      bucket.candidates.push(entry);
    }
    for (const mon of weekMondays) {
      const bucket = eaByWeek.get(mon);
      if (!bucket || bucket.minutes >= eaTargetMinutes) continue;
      bucket.candidates.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.period !== b.period) return a.period < b.period ? -1 : 1;
        const pa = staffById[a.staffId] || {};
        const pb = staffById[b.staffId] || {};
        const ga = pa.role === 'gp' ? 0 : 1;
        const gb = pb.role === 'gp' ? 0 : 1;
        if (ga !== gb) return ga - gb;
        return (pa.name || '').localeCompare(pb.name || '') || String(a.id).localeCompare(String(b.id));
      });
      for (const entry of bucket.candidates) {
        if (bucket.minutes >= eaTargetMinutes) break;
        currentTypes.set(entry.id, 'enhanced');
        bucket.minutes += (PERIOD_INFO[entry.period] || {}).minutes || 0;
      }
    }
  }

  // --- Simulated annealing ---
  let bestTypes = new Map(currentTypes);
  let bestScore = score(currentTypes);
  let currentScore = bestScore;

  // Short-circuit if already perfect
  if (bestScore === 0) {
    return buildResult(bestTypes, scoreBefore, 0);
  }

  // Build per-slot index of flexible entries for fast move lookup
  // slotFlex: `${date}|${period}` -> Entry[]
  const slotFlex = {};
  for (const entry of flexEntries) {
    const key = `${entry.date}|${entry.period}`;
    (slotFlex[key] ||= []).push(entry);
  }

  // Move ladder. When EA is not in play the bands are v1's exactly (the EA band
  // is empty), so the same seed reproduces v1's search verbatim.
  const BANDS = eaActive
    ? { gap: 0.34, toggle: 0.55, transfer: 0.72, ea: 0.87 }
    : { gap: 0.4, toggle: 0.65, transfer: 0.85, ea: 0.85 };

  for (let i = 0; i < iterations; i++) {
    // Temperature: T = 25 × (0.02)^(i/iterations)  (≈25 → 0.5)
    const T = 25 * Math.pow(0.02, i / iterations);

    const move = rng();
    let changed = null; // { entryId, newType } or { entryId, newType, entryId2, newType2 }

    if (move < BANDS.gap) {
      // fix-gap: random gap slot → random eligible flexible entry → duty
      const gappedSlots = [];
      for (const { date, period } of openSlots) {
        const required = dutyRequired[period] ?? 1;
        const siteGroups = sites.length > 1 ? sites : [null];
        for (const site of siteGroups) {
          if (dutyCoverAt(currentTypes, date, period, site) < required) gappedSlots.push({ date, period, site });
        }
      }
      if (gappedSlots.length > 0) {
        const slot = gappedSlots[Math.floor(rng() * gappedSlots.length)];
        // Random eligible flexible entry in this slot that is not already duty
        const pool = (slotFlex[`${slot.date}|${slot.period}`] || []).filter((e) => {
          const meta = entryMeta.get(e.id);
          if (!meta || !meta.eligible || !meta.allowed.includes('duty')) return false;
          if (slot.site) {
            const p = staffById[e.staffId];
            if (!p || siteOf(p) !== slot.site) return false;
          }
          return (currentTypes.get(e.id) || e.typeId) !== 'duty';
        });
        if (pool.length > 0) {
          const entry = pool[Math.floor(rng() * pool.length)];
          changed = { entryId: entry.id, newType: 'duty' };
        }
      }
    } else if (move < BANDS.toggle) {
      // toggle: random flexible GP entry: duty⇄revert
      if (flexGpEntries.length > 0) {
        const entry = flexGpEntries[Math.floor(rng() * flexGpEntries.length)];
        const meta = entryMeta.get(entry.id);
        if (meta) {
          const cur = currentTypes.get(entry.id) || entry.typeId;
          if (cur === 'duty') {
            // revert to revertType if allowed, else originalType
            const target = meta.allowed.includes(meta.revertType) ? meta.revertType : meta.originalType;
            if (target !== 'duty') changed = { entryId: entry.id, newType: target };
          } else if (meta.eligible && meta.allowed.includes('duty')) {
            changed = { entryId: entry.id, newType: 'duty' };
          }
        }
      }
    } else if (move < BANDS.transfer) {
      // transfer: within one slot, swap types of a duty entry and a non-duty eligible entry
      if (openSlots.length > 0) {
        const slot = openSlots[Math.floor(rng() * openSlots.length)];
        const slotList = slotFlex[`${slot.date}|${slot.period}`] || [];
        const dutyOnes = slotList.filter((e) => (currentTypes.get(e.id) || e.typeId) === 'duty');
        const nonDutyElig = slotList.filter((e) => {
          const meta = entryMeta.get(e.id);
          return (
            meta && meta.eligible && meta.allowed.includes('duty') && (currentTypes.get(e.id) || e.typeId) !== 'duty'
          );
        });
        if (dutyOnes.length > 0 && nonDutyElig.length > 0) {
          const fromEntry = dutyOnes[Math.floor(rng() * dutyOnes.length)];
          const toEntry = nonDutyElig[Math.floor(rng() * nonDutyElig.length)];
          const fromMeta = entryMeta.get(fromEntry.id);
          // revert the duty entry back to its revert/original type
          const revertTo =
            fromMeta && fromMeta.allowed.includes(fromMeta.revertType)
              ? fromMeta.revertType
              : fromMeta
                ? fromMeta.originalType
                : 'surgery';
          changed = {
            entryId: fromEntry.id,
            newType: revertTo,
            entryId2: toEntry.id,
            newType2: 'duty',
          };
        }
      }
    } else if (move < BANDS.ea) {
      // enhanced access: random flexible extended-hours entry → enhanced ⇄ revert
      if (flexEaEntries.length > 0) {
        const entry = flexEaEntries[Math.floor(rng() * flexEaEntries.length)];
        const meta = entryMeta.get(entry.id);
        if (meta) {
          const cur = currentTypes.get(entry.id) || entry.typeId;
          if (cur === 'enhanced') {
            const target = meta.allowed.includes(meta.revertType) ? meta.revertType : meta.originalType;
            if (target !== 'enhanced') changed = { entryId: entry.id, newType: target };
          } else {
            changed = { entryId: entry.id, newType: 'enhanced' };
          }
        }
      }
    } else {
      // random: random flexible entry → random allowed type
      if (flexEntries.length > 0) {
        const entry = flexEntries[Math.floor(rng() * flexEntries.length)];
        const meta = entryMeta.get(entry.id);
        if (meta && meta.allowed.length > 1) {
          const target = meta.allowed[Math.floor(rng() * meta.allowed.length)];
          const cur = currentTypes.get(entry.id) || entry.typeId;
          if (target !== cur) changed = { entryId: entry.id, newType: target };
        }
      }
    }

    if (!changed) continue;

    // Apply move tentatively
    const prevType1 = currentTypes.get(changed.entryId);
    currentTypes.set(changed.entryId, changed.newType);
    let prevType2, entry2id;
    if (changed.entryId2) {
      entry2id = changed.entryId2;
      prevType2 = currentTypes.get(entry2id);
      currentTypes.set(entry2id, changed.newType2);
    }

    const newScore = score(currentTypes);
    const delta = newScore - currentScore;

    if (delta <= 0 || rng() < Math.exp(-delta / T)) {
      // Accept
      currentScore = newScore;
      if (currentScore < bestScore) {
        bestScore = currentScore;
        bestTypes = new Map(currentTypes);
        if (bestScore === 0) break; // perfect
      }
    } else {
      // Reject: revert
      currentTypes.set(changed.entryId, prevType1);
      if (changed.entryId2) {
        currentTypes.set(changed.entryId2, prevType2);
      }
    }
  }

  return buildResult(bestTypes, scoreBefore, iterations);

  // --- Room repair ---
  // Type moves can leave two room-occupying sessions in one room. Where a free
  // room exists in that slot we propose moving the later occupant into it
  // (its owner's usual room first, else the lowest free room — the same
  // preference order as engine/room-infer.js fillRooms). Locked entries are
  // never moved. Deterministic: slots and rooms in sorted order.
  function repairRooms(finalTypes) {
    const roomChanges = [];
    const roomOf = new Map();
    for (const e of horizonEntries) if (e.roomId) roomOf.set(e.id, e.roomId);
    if (!roomList.length) return { roomChanges, roomOf };

    const slots = new Map(); // `${date}|${period}` -> Map(roomId -> Entry[])
    for (const e of horizonEntries) {
      const roomId = roomOf.get(e.id);
      if (!roomId || !isActive(e)) continue;
      if (!occupiesRoom(finalTypes.get(e.id) || e.typeId)) continue;
      const key = `${e.date}|${e.period}`;
      let byRoom = slots.get(key);
      if (!byRoom) slots.set(key, (byRoom = new Map()));
      const list = byRoom.get(roomId);
      if (list) list.push(e);
      else byRoom.set(roomId, [e]);
    }

    for (const key of [...slots.keys()].sort()) {
      const byRoom = slots.get(key);
      const occupied = new Set(byRoom.keys());
      for (const roomId of [...byRoom.keys()].sort()) {
        const list = byRoom.get(roomId);
        if (list.length < 2) continue;
        // Keep: a locked session first (it cannot move), then whoever calls this
        // room home, then the lowest entry id. Everyone else looks for a room.
        const rank = (e) => {
          if ((entryMeta.get(e.id) || {}).locked) return 0;
          const p = staffById[e.staffId];
          return p && p.usualRoomId === roomId ? 1 : 2;
        };
        const ordered = [...list].sort((a, b) => rank(a) - rank(b) || String(a.id).localeCompare(String(b.id)));
        for (const e of ordered.slice(1)) {
          if ((entryMeta.get(e.id) || {}).locked) continue;
          const person = staffById[e.staffId];
          let target = null;
          if (
            person &&
            person.usualRoomId &&
            !occupied.has(person.usualRoomId) &&
            roomList.some((r) => r.id === person.usualRoomId)
          ) {
            target = person.usualRoomId;
          } else {
            const free = roomList.find((r) => !occupied.has(r.id));
            if (free) target = free.id;
          }
          if (!target) continue;
          occupied.add(target);
          roomOf.set(e.id, target);
          roomChanges.push({
            entryId: e.id,
            staffId: e.staffId,
            date: e.date,
            period: e.period,
            from: roomId,
            to: target,
          });
        }
      }
    }
    return { roomChanges, roomOf };
  }

  // --- Build the result object ---
  function buildResult(finalTypes, before, iters) {
    // changes[]: entries whose FINAL type differs from their ORIGINAL type
    const changes = [];
    for (const entry of horizonEntries) {
      const meta = entryMeta.get(entry.id);
      if (!meta) continue;
      const finalType = finalTypes.get(entry.id) || entry.typeId;
      if (finalType !== meta.originalType) {
        changes.push({
          entryId: entry.id,
          staffId: entry.staffId,
          date: entry.date,
          period: entry.period,
          from: meta.originalType,
          to: finalType,
        });
      }
    }

    // Room reassignments proposed alongside the type changes
    const { roomChanges, roomOf } = repairRooms(finalTypes);

    const ev = evaluate(finalTypes, roomOf);
    const bd = ev.breakdown;
    const after = Object.values(bd).reduce((a, b) => a + b, 0);

    // Diagnostics: what the proposal could not fix
    const unresolved = [];

    // 1. Duty gaps that couldn't be filled
    for (const { date, period } of openSlots) {
      const required = dutyRequired[period] ?? 1;
      const siteGroups = sites.length > 1 ? sites : [null];
      for (const site of siteGroups) {
        const cnt = dutyCoverAt(finalTypes, date, period, site);
        if (cnt < required) {
          unresolved.push({
            kind: 'duty',
            message: `${date} ${period.toUpperCase()}${site ? ` (${site})` : ''}: no eligible GP present for duty (${cnt}/${required} filled)`,
          });
        }
      }
    }

    // 2. Enhanced-access shortfall per week (warn-level — the DES target is a
    // commissioning expectation, not a rostering hard stop)
    if (eaActive) {
      for (const mon of weekMondays) {
        let minutes = 0;
        for (const entry of horizonEntries) {
          if (!eaPeriods.has(entry.period) || mondayOf(entry.date) !== mon) continue;
          const person = staffById[entry.staffId];
          if (!person || !isActive(entry) || onLeave(person.id, entry.date)) continue;
          if (SESSION_TYPES_CLINICAL.has(finalTypes.get(entry.id) || entry.typeId)) {
            minutes += (PERIOD_INFO[entry.period] || {}).minutes || 0;
          }
        }
        if (minutes < eaTargetMinutes) {
          unresolved.push({
            kind: 'ea',
            message: `Week of ${mon}: enhanced access ${minutes}/${eaTargetMinutes} min rostered — ${eaTargetMinutes - minutes} min short of the DES target and no further extended-hours session could be allocated`,
          });
        }
      }
    }

    // 3. Avoid-duty assignments that survived — duty on an avoided slot is a
    // last resort, so say so rather than let the penalty vanish into the score.
    for (const entry of horizonEntries) {
      if ((finalTypes.get(entry.id) || entry.typeId) !== 'duty') continue;
      const person = staffById[entry.staffId];
      if (!person || !avoidsDuty(person, entry.date, entry.period)) continue;
      const site = sites.length > 1 ? siteOf(person) : null;
      const alternatives = entriesAt(entry.date, entry.period).filter((other) => {
        if (other.id === entry.id) return false;
        const meta = entryMeta.get(other.id);
        if (!meta || meta.locked || !meta.eligible || !meta.allowed.includes('duty')) return false;
        const p = staffById[other.staffId];
        if (!p || p.id === person.id) return false;
        if (site && siteOf(p) !== site) return false;
        if (avoidsDuty(p, other.date, other.period)) return false;
        return (finalTypes.get(other.id) || other.typeId) !== 'duty';
      }).length;
      unresolved.push({
        kind: 'preference',
        message: `${entry.date} ${entry.period.toUpperCase()}: ${person.name} is on duty on a slot they asked to avoid — ${
          alternatives
            ? `taken as a last resort to keep cover/fairness (${alternatives} other eligible GP${alternatives > 1 ? 's' : ''} present)`
            : 'no other eligible GP was available'
        }`,
      });
    }

    // 4. Room clashes the repair could not resolve
    const clashes = new Map(); // `${date}|${period}|${roomId}` -> Entry[]
    for (const entry of horizonEntries) {
      const roomId = roomOf.get(entry.id);
      if (!roomId || !isActive(entry)) continue;
      if (!occupiesRoom(finalTypes.get(entry.id) || entry.typeId)) continue;
      const key = `${entry.date}|${entry.period}|${roomId}`;
      const list = clashes.get(key);
      if (list) list.push(entry);
      else clashes.set(key, [entry]);
    }
    for (const key of [...clashes.keys()].sort()) {
      const list = clashes.get(key);
      if (list.length < 2) continue;
      const [date, period, roomId] = key.split('|');
      const room = roomList.find((r) => r.id === roomId);
      const names = list.map((e) => (staffById[e.staffId] || {}).name).filter(Boolean);
      unresolved.push({
        kind: 'room',
        message: `${date} ${period.toUpperCase()}: ${room ? room.name : 'room'} double-booked (${names.join(', ')}) — ${
          roomList.length ? 'no free room in that slot' : 'no rooms configured'
        }`,
      });
    }

    // 5. Rules pass-through: gaps that depend on PRESENCE, which the solver
    // cannot change — supervision and enhanced-access GP presence.
    const finalEntries = horizonEntries.map((e) => ({
      ...e,
      typeId: finalTypes.get(e.id) || e.typeId,
      ...(roomOf.has(e.id) ? { roomId: roomOf.get(e.id) } : {}),
    }));
    const weeksSeen = new Set();
    for (const date of dates) {
      const mon = mondayOf(date);
      if (weeksSeen.has(mon)) continue;
      weeksSeen.add(mon);
      const weekDates = [];
      for (let d = 0; d < 7; d++) weekDates.push(addDays(mon, d));
      const warnings = checkWeek({
        dates: weekDates,
        entries: finalEntries,
        staff,
        leaveList,
        settings,
        rooms: roomList,
      });
      for (const w of warnings) {
        if (w.kind === 'supervision' || w.kind === 'enhanced') {
          unresolved.push({ kind: w.kind, message: w.message });
        }
      }
    }

    // Per-dimension explanation for the UI ("why this proposal")
    const explain = EXPLAIN_ORDER.map((key) => {
      const meta = EXPLAIN_META[key];
      return {
        key,
        label: meta.label,
        weight: W[meta.weightKey],
        measure: ev.measures[key],
        unit: meta.unit,
        score: bd[key],
      };
    });

    return {
      changes,
      score: { before, after },
      breakdown: bd,
      unresolved,
      iterations: iters,
      roomChanges,
      explain,
    };
  }
}
