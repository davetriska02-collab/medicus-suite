// Auto-rota solver: optimises session-type assignment over a fixed presence
// matrix using greedy initialisation followed by simulated annealing.
// Returns a change-set and diagnostics; the UI previews and the user applies.
// Pure module: no DOM, no chrome.*, no fetch.

import { dayKey, mondayOf, addDays, templateWeekIndex } from '../shared/time.js';
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
function allowedTypes(originalType, person, isEligible, revertType) {
  if (person.employmentType === 'registrar' && person.vtsDay) {
    // VTS forced-fix slots are handled before this function is called
  }
  const types = new Set([originalType]);
  // duty can be assigned when eligible and original type is surgery/triage/duty
  if (isEligible && (originalType === 'surgery' || originalType === 'triage' || originalType === 'duty')) {
    types.add('duty');
  }
  // an original-duty entry may also revert to the pattern type (to shed excess duty)
  if (originalType === 'duty') {
    types.add(revertType);
  }
  return [...types];
}

export function solveRota({ dates, entries, staff, leaveList, settings, historyEntries = [], options = {} }) {
  const { maxDutyPerWeek = 2, iterations = 8000, seed = 1, weights: weightOverrides = {} } = options;

  const W = { ...DEFAULT_WEIGHTS, ...weightOverrides };
  const rng = mulberry32(seed);

  // --- Pre-compute lookups ---

  const bankHolidays = new Set(settings.bankHolidays || []);
  const openDays = new Set(settings.openDays || []);
  const sites = (settings.sites || []).filter(Boolean);
  const dutyRequired = settings.dutyRequired || { am: 1, pm: 1 };
  const anchor = settings.templateAnchorMonday || dates[0];

  // horizon: only entries falling within the supplied dates
  const dateSet = new Set(dates);
  const horizonEntries = entries.filter((e) => dateSet.has(e.date));

  const staffById = Object.fromEntries(staff.map((s) => [s.id, s]));

  // Open slots: (date, period) pairs where duty may be required
  const openSlots = [];
  for (const date of dates) {
    if (!openDays.has(dayKey(date))) continue;
    if (bankHolidays.has(date)) continue;
    for (const period of ['am', 'pm']) {
      openSlots.push({ date, period });
    }
  }

  // Mon–Sun week boundaries for weeklyCap
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

  // Classify entries once
  // Each entry gets: locked (bool), originalType, revertType, allowedTypes[]
  const entryMeta = new Map(); // entryId -> { locked, originalType, revertType, allowed, isVtsForced }
  for (const entry of horizonEntries) {
    const person = staffById[entry.staffId];
    const locked = isLocked(entry);
    const originalType = entry.typeId;
    const rt = revertTypeFor(entry);

    // Duty eligibility at this slot: GP + dutyEligible + no leave + present (has an entry)
    // We check leave dynamically; presence is implied by having an entry in the horizon.
    let eligible = false;
    let isVtsForced = false;

    if (person) {
      const onLeave = approvedLeaveFor(leaveList, person.id, entry.date);
      eligible = person.role === 'gp' && Boolean(person.dutyEligible) && !onLeave;

      // VTS forced: registrar clinical on their VTS slot -> must become 'tutorial'
      if (
        person.employmentType === 'registrar' &&
        person.vtsDay &&
        person.vtsDay === `${dayKey(entry.date)}-${entry.period}` &&
        originalType !== 'tutorial'
      ) {
        const SESSION_TYPES_CLINICAL = new Set(['surgery', 'triage', 'duty', 'visits', 'enhanced']);
        if (SESSION_TYPES_CLINICAL.has(originalType)) {
          isVtsForced = true;
        }
      }
    }

    const allowed = isVtsForced ? ['tutorial'] : allowedTypes(originalType, person || {}, eligible, rt);

    entryMeta.set(entry.id, { locked, originalType, revertType: rt, allowed, isVtsForced, eligible });
  }

  // Flexible entries: not locked, inside horizon
  const flexEntries = horizonEntries.filter((e) => !entryMeta.get(e.id).locked);

  // Flexible GP entries for fairness/duty moves
  const flexGpEntries = flexEntries.filter((e) => {
    const p = staffById[e.staffId];
    return p && p.role === 'gp';
  });

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

  // --- Score function ---
  // Takes currentTypes: Map<entryId -> typeId> and returns numeric score.
  // O(entries) per evaluation.
  function score(currentTypes) {
    // Build per-slot/site duty counts and per-person duty counts
    // We need: dutyGap, vts, fairness, sameDay, weeklyCap, locumDuty, preference, churn

    let dutyGapScore = 0;
    let vtsScore = 0;
    let sameDayScore = 0;
    let weeklyCapScore = 0;
    let locumDutyScore = 0;
    let preferenceScore = 0;
    let churnScore = 0;

    // Count duty per person (for fairness, sameDay, weeklyCap)
    // duty per person per date (for sameDay), per week (for weeklyCap)
    const personDutyTotal = {}; // staffId -> total duty sessions in horizon
    const personDutyDate = {}; // staffId|date -> count
    const personDutyWeek = {}; // staffId|mondayISO -> count

    // Per-slot duty coverage (date|period[|site] -> count)
    const slotDuty = {};

    // iterate all horizon entries (locked + flexible) with their effective type
    for (const entry of horizonEntries) {
      const t = currentTypes.get(entry.id) || entry.typeId;
      const person = staffById[entry.staffId];
      if (!person) continue;

      if (t === 'duty') {
        // count for locumDuty, sameDay, weeklyCap, fairness
        personDutyTotal[person.id] = (personDutyTotal[person.id] || 0) + 1;
        const dk = `${person.id}|${entry.date}`;
        personDutyDate[dk] = (personDutyDate[dk] || 0) + 1;
        const wk = `${person.id}|${mondayOf(entry.date)}`;
        personDutyWeek[wk] = (personDutyWeek[wk] || 0) + 1;

        // slot duty count — only count duty-eligible GPs toward coverage
        if (person.role === 'gp' && person.dutyEligible) {
          const onLeave = approvedLeaveFor(leaveList, person.id, entry.date);
          if (!onLeave) {
            if (sites.length > 1) {
              const site = person.site || sites[0];
              const sk = `${entry.date}|${entry.period}|${site}`;
              slotDuty[sk] = (slotDuty[sk] || 0) + 1;
            } else {
              const sk = `${entry.date}|${entry.period}`;
              slotDuty[sk] = (slotDuty[sk] || 0) + 1;
            }
          }
        }

        // locumDuty
        if (person.employmentType === 'locum') {
          locumDutyScore += W.locumDuty;
        }

        // preference: avoidDuty check
        const avoidDuty = person.avoidDuty || [];
        if (avoidDuty.includes(`${dayKey(entry.date)}-${entry.period}`)) {
          preferenceScore += W.preference;
        }
      }

      // VTS penalty: registrar clinical on VTS slot
      if (person.employmentType === 'registrar' && person.vtsDay) {
        const SESSION_TYPES_CLINICAL = new Set(['surgery', 'triage', 'duty', 'visits', 'enhanced']);
        if (SESSION_TYPES_CLINICAL.has(t) && person.vtsDay === `${dayKey(entry.date)}-${entry.period}`) {
          vtsScore += W.vts;
        }
      }

      // churn: final type != original type (only for entries with a meta record)
      const meta = entryMeta.get(entry.id);
      if (meta && t !== meta.originalType) {
        churnScore += W.churn;
      }
    }

    // dutyGap: per open slot/site
    for (const { date, period } of openSlots) {
      const required = dutyRequired[period] ?? 1;
      if (sites.length > 1) {
        for (const site of sites) {
          const sk = `${date}|${period}|${site}`;
          const count = slotDuty[sk] || 0;
          dutyGapScore += W.dutyGap * Math.max(0, required - count);
        }
      } else {
        const sk = `${date}|${period}`;
        const count = slotDuty[sk] || 0;
        dutyGapScore += W.dutyGap * Math.max(0, required - count);
      }
    }

    // sameDay: per person with duty both AM and PM on the same date
    for (const [key, count] of Object.entries(personDutyDate)) {
      if (count >= 2) {
        sameDayScore += W.sameDay * (count - 1);
      }
    }

    // weeklyCap: per excess duty over maxDutyPerWeek per person per week
    for (const [key, count] of Object.entries(personDutyWeek)) {
      if (count > maxDutyPerWeek) {
        weeklyCapScore += W.weeklyCap * (count - maxDutyPerWeek);
      }
    }

    // fairness: Σ(share_i - mean)² × W.fairness
    // Locums (contracted 0) excluded; only eligible GPs with contractedSessions > 0
    const shares = eligibleGPs.map((person) => {
      const hist = histDutyCount[person.id] || 0;
      const planned = personDutyTotal[person.id] || 0;
      return (hist + planned) / person.contractedSessions;
    });
    let fairnessScore = 0;
    if (shares.length > 0) {
      const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
      for (const s of shares) fairnessScore += (s - mean) * (s - mean);
      fairnessScore *= W.fairness;
    }

    return (
      dutyGapScore +
      vtsScore +
      fairnessScore +
      sameDayScore +
      weeklyCapScore +
      locumDutyScore +
      preferenceScore +
      churnScore
    );
  }

  // Score breakdown for final reporting
  function scoreBreakdown(currentTypes) {
    let dutyGap = 0,
      vts = 0,
      fairness = 0,
      sameDay = 0,
      weeklyCap = 0,
      locumDuty = 0,
      preference = 0,
      churn = 0;

    const personDutyTotal = {};
    const personDutyDate = {};
    const personDutyWeek = {};
    const slotDuty = {};

    for (const entry of horizonEntries) {
      const t = currentTypes.get(entry.id) || entry.typeId;
      const person = staffById[entry.staffId];
      if (!person) continue;

      if (t === 'duty') {
        personDutyTotal[person.id] = (personDutyTotal[person.id] || 0) + 1;
        const dk = `${person.id}|${entry.date}`;
        personDutyDate[dk] = (personDutyDate[dk] || 0) + 1;
        const wk = `${person.id}|${mondayOf(entry.date)}`;
        personDutyWeek[wk] = (personDutyWeek[wk] || 0) + 1;

        if (person.role === 'gp' && person.dutyEligible) {
          const onLeave = approvedLeaveFor(leaveList, person.id, entry.date);
          if (!onLeave) {
            if (sites.length > 1) {
              const site = person.site || sites[0];
              const sk = `${entry.date}|${entry.period}|${site}`;
              slotDuty[sk] = (slotDuty[sk] || 0) + 1;
            } else {
              const sk = `${entry.date}|${entry.period}`;
              slotDuty[sk] = (slotDuty[sk] || 0) + 1;
            }
          }
        }
        if (person.employmentType === 'locum') locumDuty += W.locumDuty;
        const avoidDuty = person.avoidDuty || [];
        if (avoidDuty.includes(`${dayKey(entry.date)}-${entry.period}`)) preference += W.preference;
      }

      if (person.employmentType === 'registrar' && person.vtsDay) {
        const SESSION_TYPES_CLINICAL = new Set(['surgery', 'triage', 'duty', 'visits', 'enhanced']);
        if (SESSION_TYPES_CLINICAL.has(t) && person.vtsDay === `${dayKey(entry.date)}-${entry.period}`) {
          vts += W.vts;
        }
      }

      const meta = entryMeta.get(entry.id);
      if (meta && t !== meta.originalType) churn += W.churn;
    }

    for (const { date, period } of openSlots) {
      const required = dutyRequired[period] ?? 1;
      if (sites.length > 1) {
        for (const site of sites) {
          const sk = `${date}|${period}|${site}`;
          dutyGap += W.dutyGap * Math.max(0, required - (slotDuty[sk] || 0));
        }
      } else {
        const sk = `${date}|${period}`;
        dutyGap += W.dutyGap * Math.max(0, required - (slotDuty[sk] || 0));
      }
    }

    for (const [, count] of Object.entries(personDutyDate)) {
      if (count >= 2) sameDay += W.sameDay * (count - 1);
    }
    for (const [, count] of Object.entries(personDutyWeek)) {
      if (count > maxDutyPerWeek) weeklyCap += W.weeklyCap * (count - maxDutyPerWeek);
    }

    const shares = eligibleGPs.map((person) => {
      const hist = histDutyCount[person.id] || 0;
      const planned = personDutyTotal[person.id] || 0;
      return (hist + planned) / person.contractedSessions;
    });
    if (shares.length > 0) {
      const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
      let sq = 0;
      for (const s of shares) sq += (s - mean) * (s - mean);
      fairness = sq * W.fairness;
    }

    return { dutyGap, vts, fairness, sameDay, weeklyCap, locumDuty, preference, churn };
  }

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
  // with the lowest duty share (history + current). Deterministic tie-break by name.
  // We track duty counts incrementally during greedy fill.
  const greedyDutyCount = Object.fromEntries(eligibleGPs.map((p) => [p.id, histDutyCount[p.id] || 0]));

  // Also track current duty for sameDay / weeklyCap awareness during greedy
  // (greedy just fills gaps; it doesn't try to rebalance excess)

  for (const { date, period } of openSlots) {
    const required = dutyRequired[period] ?? 1;

    // Count current duty on this slot (locked + flexible already set)
    const siteGroups = sites.length > 1 ? sites : [null];
    for (const site of siteGroups) {
      let dutyCount = 0;
      const candidates = [];

      for (const entry of horizonEntries) {
        if (entry.date !== date || entry.period !== period) continue;
        const person = staffById[entry.staffId];
        if (!person) continue;
        if (site && (person.site || sites[0]) !== site) continue;

        const t = currentTypes.get(entry.id);
        if (t === 'duty' && person.role === 'gp' && person.dutyEligible) {
          const onLeave = approvedLeaveFor(leaveList, person.id, date);
          if (!onLeave) dutyCount++;
        }

        // Candidate: flexible, eligible GP, allowed to take duty
        const meta = entryMeta.get(entry.id);
        if (!meta || meta.locked) continue;
        if (!meta.eligible) continue;
        if (!meta.allowed.includes('duty')) continue;
        if (t === 'duty') continue; // already duty
        // duty eligibility re-check (leave checked in eligible flag at build time, which is static)
        // meta.eligible already accounts for leave at build time; we trust it
        candidates.push({ entry, person });
      }

      while (dutyCount < required && candidates.length > 0) {
        // Sort by duty share, tie-break by name
        candidates.sort((a, b) => {
          const sa = greedyDutyCount[a.person.id] / a.person.contractedSessions;
          const sb = greedyDutyCount[b.person.id] / b.person.contractedSessions;
          if (sa !== sb) return sa - sb;
          return (a.person.name || '').localeCompare(b.person.name || '');
        });

        const pick = candidates.shift();
        currentTypes.set(pick.entry.id, 'duty');
        greedyDutyCount[pick.person.id] = (greedyDutyCount[pick.person.id] || 0) + 1;
        dutyCount++;
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

  // flexGpDutyEligible: entries for GPs who are duty-eligible and flexible
  const flexEligibleGpEntries = flexEntries.filter((e) => {
    const meta = entryMeta.get(e.id);
    return meta && meta.eligible && meta.allowed.includes('duty');
  });

  for (let i = 0; i < iterations; i++) {
    // Temperature: T = 25 × (0.02)^(i/iterations)  (≈25 → 0.5)
    const T = 25 * Math.pow(0.02, i / iterations);

    const move = rng();
    let changed = null; // { entryId, newType } or { entryId, newType, entryId2, newType2 }

    if (move < 0.4) {
      // fix-gap: random gap slot → random eligible flexible entry → duty
      // Pick a random open slot that has a gap
      const gappedSlots = [];
      for (const { date, period } of openSlots) {
        const required = dutyRequired[period] ?? 1;
        if (sites.length > 1) {
          for (const site of sites) {
            let cnt = 0;
            for (const entry of horizonEntries) {
              if (entry.date !== date || entry.period !== period) continue;
              const p = staffById[entry.staffId];
              if (!p || !p.dutyEligible || p.role !== 'gp') continue;
              if (site && (p.site || sites[0]) !== site) continue;
              const onLeave = approvedLeaveFor(leaveList, p.id, date);
              if (!onLeave && (currentTypes.get(entry.id) || entry.typeId) === 'duty') cnt++;
            }
            if (cnt < required) gappedSlots.push({ date, period, site });
          }
        } else {
          let cnt = 0;
          for (const entry of horizonEntries) {
            if (entry.date !== date || entry.period !== period) continue;
            const p = staffById[entry.staffId];
            if (!p || !p.dutyEligible || p.role !== 'gp') continue;
            const onLeave = approvedLeaveFor(leaveList, p.id, date);
            if (!onLeave && (currentTypes.get(entry.id) || entry.typeId) === 'duty') cnt++;
          }
          if (cnt < required) gappedSlots.push({ date, period, site: null });
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
            if (!p || (p.site || sites[0]) !== slot.site) return false;
          }
          return (currentTypes.get(e.id) || e.typeId) !== 'duty';
        });
        if (pool.length > 0) {
          const entry = pool[Math.floor(rng() * pool.length)];
          changed = { entryId: entry.id, newType: 'duty' };
        }
      }
    } else if (move < 0.65) {
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
    } else if (move < 0.85) {
      // transfer: within one slot, swap types of a duty entry and a non-duty eligible entry
      if (openSlots.length > 0) {
        const slot = openSlots[Math.floor(rng() * openSlots.length)];
        const slotEntries = slotFlex[`${slot.date}|${slot.period}`] || [];
        const dutyOnes = slotEntries.filter((e) => (currentTypes.get(e.id) || e.typeId) === 'duty');
        const nonDutyElig = slotEntries.filter((e) => {
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

    const bd = scoreBreakdownWith(finalTypes);
    const after = Object.values(bd).reduce((a, b) => a + b, 0);

    // Diagnostics: remaining duty gaps + supervision pass-through
    const unresolved = [];

    // Duty gaps that couldn't be filled
    for (const { date, period } of openSlots) {
      const required = dutyRequired[period] ?? 1;
      if (sites.length > 1) {
        for (const site of sites) {
          let cnt = 0;
          for (const entry of horizonEntries) {
            if (entry.date !== date || entry.period !== period) continue;
            const p = staffById[entry.staffId];
            if (!p || !p.dutyEligible || p.role !== 'gp') continue;
            if ((p.site || sites[0]) !== site) continue;
            const onLeave = approvedLeaveFor(leaveList, p.id, date);
            if (!onLeave && (finalTypes.get(entry.id) || entry.typeId) === 'duty') cnt++;
          }
          if (cnt < required) {
            unresolved.push({
              kind: 'duty',
              message: `${date} ${period.toUpperCase()}${site ? ` (${site})` : ''}: no eligible GP present for duty (${cnt}/${required} filled)`,
            });
          }
        }
      } else {
        let cnt = 0;
        for (const entry of horizonEntries) {
          if (entry.date !== date || entry.period !== period) continue;
          const p = staffById[entry.staffId];
          if (!p || !p.dutyEligible || p.role !== 'gp') continue;
          const onLeave = approvedLeaveFor(leaveList, p.id, date);
          if (!onLeave && (finalTypes.get(entry.id) || entry.typeId) === 'duty') cnt++;
        }
        if (cnt < required) {
          unresolved.push({
            kind: 'duty',
            message: `${date} ${period.toUpperCase()}: no eligible GP present for duty (${cnt}/${required} filled)`,
          });
        }
      }
    }

    // Supervision pass-through: run checkWeek per week and forward supervision warnings
    // Build final entries with solved types for checkWeek
    const finalEntries = horizonEntries.map((e) => ({
      ...e,
      typeId: finalTypes.get(e.id) || e.typeId,
    }));
    const weeksSeen = new Set();
    for (const date of dates) {
      const mon = mondayOf(date);
      if (weeksSeen.has(mon)) continue;
      weeksSeen.add(mon);
      const weekDates = [];
      for (let d = 0; d < 7; d++) weekDates.push(addDays(mon, d));
      const warnings = checkWeek({ dates: weekDates, entries: finalEntries, staff, leaveList, settings });
      for (const w of warnings) {
        if (w.kind === 'supervision') {
          unresolved.push({ kind: 'supervision', message: w.message });
        }
      }
    }

    return {
      changes,
      score: { before, after },
      breakdown: bd,
      unresolved,
      iterations: iters,
    };
  }

  function scoreBreakdownWith(types) {
    let dutyGap = 0,
      vts = 0,
      fairness = 0,
      sameDay = 0,
      weeklyCap = 0,
      locumDuty = 0,
      preference = 0,
      churn = 0;

    const personDutyTotal = {};
    const personDutyDate = {};
    const personDutyWeek = {};
    const slotDuty = {};

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

        if (person.role === 'gp' && person.dutyEligible) {
          const onLeave = approvedLeaveFor(leaveList, person.id, entry.date);
          if (!onLeave) {
            if (sites.length > 1) {
              const site = person.site || sites[0];
              const sk = `${entry.date}|${entry.period}|${site}`;
              slotDuty[sk] = (slotDuty[sk] || 0) + 1;
            } else {
              const sk = `${entry.date}|${entry.period}`;
              slotDuty[sk] = (slotDuty[sk] || 0) + 1;
            }
          }
        }
        if (person.employmentType === 'locum') locumDuty += W.locumDuty;
        const avoidDuty = person.avoidDuty || [];
        if (avoidDuty.includes(`${dayKey(entry.date)}-${entry.period}`)) preference += W.preference;
      }

      if (person.employmentType === 'registrar' && person.vtsDay) {
        const SESSION_TYPES_CLINICAL = new Set(['surgery', 'triage', 'duty', 'visits', 'enhanced']);
        if (SESSION_TYPES_CLINICAL.has(t) && person.vtsDay === `${dayKey(entry.date)}-${entry.period}`) {
          vts += W.vts;
        }
      }

      const meta = entryMeta.get(entry.id);
      if (meta && t !== meta.originalType) churn += W.churn;
    }

    for (const { date, period } of openSlots) {
      const required = dutyRequired[period] ?? 1;
      if (sites.length > 1) {
        for (const site of sites) {
          const sk = `${date}|${period}|${site}`;
          dutyGap += W.dutyGap * Math.max(0, required - (slotDuty[sk] || 0));
        }
      } else {
        const sk = `${date}|${period}`;
        dutyGap += W.dutyGap * Math.max(0, required - (slotDuty[sk] || 0));
      }
    }

    for (const [, count] of Object.entries(personDutyDate)) {
      if (count >= 2) sameDay += W.sameDay * (count - 1);
    }
    for (const [, count] of Object.entries(personDutyWeek)) {
      if (count > maxDutyPerWeek) weeklyCap += W.weeklyCap * (count - maxDutyPerWeek);
    }

    const shares = eligibleGPs.map((person) => {
      const hist = histDutyCount[person.id] || 0;
      const planned = personDutyTotal[person.id] || 0;
      return (hist + planned) / person.contractedSessions;
    });
    if (shares.length > 0) {
      const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
      let sq = 0;
      for (const s of shares) sq += (s - mean) * (s - mean);
      fairness = sq * W.fairness;
    }

    return { dutyGap, vts, fairness, sameDay, weeklyCap, locumDuty, preference, churn };
  }
}
