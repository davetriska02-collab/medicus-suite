// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Signing queue: pure-logic core (no chrome APIs, no DOM)
//
// Monitoring context for the repeat-prescription signing pile. INTENDED-
// PURPOSE FRAMING (docs/INTENDED-PURPOSE.md): this module DISPLAYS the
// monitoring currency already recorded in Medicus next to each open
// prescription-request task. It never produces a "safe to sign" verdict —
// the frozen statement excludes prescribing decisions — and the UI copy must
// always carry the honest state: "no flag ≠ safe to sign; monitoring shown
// is what is recorded, not what is true."
//
// Verdict vocabulary mirrors the queue monitoring chip's reducer
// (content-scripts/triage-lens/content.js selectMonitoringDue) so the same
// patient reads the same on the Medicus queue and in this panel:
//   red   — any drug-monitoring chip with status overdue / stale / no_data
//   amber — only due_soon chips
//   null  — no drug-monitoring flags among the evaluated chips

'use strict';

// Chip statuses that constitute a monitoring flag, and their band.
export const RED_CHIP_STATUSES = ['overdue', 'stale', 'no_data'];
export const AMBER_CHIP_STATUSES = ['due_soon'];

export const CHIP_STATUS_TEXT = {
  overdue: 'overdue',
  stale: 'stale',
  no_data: 'no data',
  due_soon: 'due soon',
};

// Reduce a patient's engine chips (SentinelRules.evaluatePatient output) to a
// signing-row verdict: { level: 'red'|'amber'|null, items: [{ name, status,
// matchedTerm, detail }] }. Only type === 'drug-monitoring' chips count —
// QOF/vaccine chips are out of scope for a signing decision context.
export function monitoringVerdict(chips) {
  const items = [];
  let red = false;
  let amber = false;
  for (const chip of Array.isArray(chips) ? chips : []) {
    if (!chip || chip.type !== 'drug-monitoring') continue;
    const status = chip.status;
    const isRed = RED_CHIP_STATUSES.includes(status);
    const isAmber = AMBER_CHIP_STATUSES.includes(status);
    if (!isRed && !isAmber) continue;
    if (isRed) red = true;
    else amber = true;
    items.push({
      name: chip.drugName || chip.ruleId || 'monitored drug',
      status,
      matchedTerm: chip.matchedTerm || '',
      detail: _flaggedTests(chip),
    });
  }
  return { level: red ? 'red' : amber ? 'amber' : null, items };
}

// Short "which tests" detail from a chip, e.g. "FBC, U&E overdue" — capped so
// a many-test rule can't flood the row.
function _flaggedTests(chip) {
  const tests = Array.isArray(chip.tests) ? chip.tests : [];
  const flagged = tests
    .filter((t) => t && (RED_CHIP_STATUSES.includes(t.status) || AMBER_CHIP_STATUSES.includes(t.status)))
    .map((t) => t.name)
    .filter(Boolean);
  if (flagged.length === 0) return '';
  const shown = flagged.slice(0, 3).join(', ');
  return flagged.length > 3 ? `${shown} +${flagged.length - 3}` : shown;
}

const _norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ');

// The loudest signal on the queue: the REQUESTED drug is itself the flagged
// one (a lithium request while the lithium level is overdue). Matches the
// task's request summary text against each verdict item's drug name and
// matched term, case-insensitive substring — same matching philosophy as
// drugMatchesRule in the rules engine.
//
// BEST-EFFORT SALIENCE ONLY — do not harden this into anything load-bearing.
// The tag can only ADD attention to an already-flagged red/amber item; a
// missed or spurious match never hides, suppresses or downranks a chip
// (H-038 control (f)). Substring matching against free request text is the
// right cost/benefit for that job and no more.
export function requestedDrugFlags(summary, verdictItems) {
  const text = _norm(summary);
  if (!text) return [];
  return (Array.isArray(verdictItems) ? verdictItems : []).filter((it) => {
    const name = _norm(it.name);
    const term = _norm(it.matchedTerm);
    return (name && text.includes(name)) || (term && text.includes(term));
  });
}

// ── Prescribing-safety combinations at signing (Gauntlet B1, slice 1) ────────
// The engine ALREADY evaluates the practice's drug-combination rules (the
// CSO-reviewed alert library + practice-authored combos) in every signing
// evaluation — their chips were simply filtered out by monitoringVerdict.
// Surfacing them adds NO new clinical rule content: it re-displays an already-
// evaluated fact at the decision moment. Hazard log: H-038 controls (k)/(l).
//
// Scope decision (H-038 (l)): only the alert (red) and caution (amber) tiers
// are surfaced at signing. The 'noted' awareness tier stays in Monitoring —
// salience at the point of authorisation is reserved for act-on-it-now
// combinations, so alarm dilution never erodes the red tier here.
export const COMBO_STATUS_LEVEL = { alert: 'red', caution: 'amber' };

// Reduce engine chips to a signing-row combination verdict:
// { level: 'red'|'amber'|null, items: [{ label, level, drugs, ruleId }] }.
export function combinationVerdict(chips) {
  const items = [];
  let red = false;
  let amber = false;
  for (const chip of Array.isArray(chips) ? chips : []) {
    if (!chip || chip.type !== 'drug-combo') continue;
    const level = COMBO_STATUS_LEVEL[chip.status];
    if (!level) continue;
    if (level === 'red') red = true;
    else amber = true;
    const drugs = [];
    for (const set of Array.isArray(chip.matchSummary) ? chip.matchSummary : []) {
      for (const d of Array.isArray(set && set.drugs) ? set.drugs : []) {
        if (d) drugs.push(String(d));
      }
    }
    items.push({ label: chip.label || chip.ruleId || 'drug combination', level, drugs, ruleId: chip.ruleId || '' });
  }
  return { level: red ? 'red' : amber ? 'amber' : null, items };
}

// Loudest combination signal: a drug in the REQUEST is itself one leg of a
// flagged combination — the classic case is an acute NSAID request landing on
// top of ACEi + diuretic, where the request COMPLETES the AKI cluster. Same
// best-effort-salience doctrine as requestedDrugFlags (H-038 control (f)):
// a match can only ADD attention; a miss never hides or downranks the chip.
export function requestedComboFlags(summary, comboItems) {
  const text = _norm(summary);
  if (!text) return [];
  return (Array.isArray(comboItems) ? comboItems : []).filter((it) =>
    (it.drugs || []).some((d) => {
      const n = _norm(d);
      return n && text.includes(n);
    })
  );
}

// Row states a task can be in while the pass runs.
export const ROW_STATE = {
  PENDING: 'pending', // not yet checked this pass
  CHECKING: 'checking',
  DONE: 'done', // verdict present (level may be null = no flags recorded)
  ERROR: 'error', // record could not be read — explicitly NOT an all-clear
};

// Sort for the rendered pile — the eye should land on the riskiest first:
//   1. red with a requested drug itself flagged (monitoring OR combination)
//   2. red
//   3. amber
//   4. error / unchecked (unknown is riskier than a recorded all-clear)
//   5. no flags recorded
// Ties: oldest request first (the pile is worked oldest-up).
// Severity considers BOTH verdicts — monitoring (r.verdict) and combination
// (r.comboVerdict, optional) — a red combination must never sit below a
// quiet monitoring row.
export function sortSigningRows(rows) {
  const bandOf = (r) => {
    if (r.state === ROW_STATE.DONE && r.verdict) {
      const combo = (r.comboVerdict && r.comboVerdict.level) || null;
      const level = r.verdict.level === 'red' || combo === 'red' ? 'red' : r.verdict.level || combo;
      if (level === 'red') {
        const requested =
          (r.requestedHits && r.requestedHits.length) || (r.requestedComboHits && r.requestedComboHits.length);
        return requested ? 0 : 1;
      }
      if (level === 'amber') return 2;
      return 4;
    }
    if (r.state === ROW_STATE.ERROR) return 3;
    return 3; // pending / checking — unknown
  };
  return [...(rows || [])].sort((a, b) => {
    const d = bandOf(a) - bandOf(b);
    if (d !== 0) return d;
    const ca = a.createdAt || '';
    const cb = b.createdAt || '';
    return ca < cb ? -1 : ca > cb ? 1 : 0;
  });
}

// NOTE (wrong-patient guard, review 2026-07-07): there is deliberately NO
// name/DOB-based patient grouping here. Task rows carry no patient UUID, and
// demographic strings are not identity — two patients can share name+DOB, and
// rows with unreadable names must never collapse into one bucket. The module
// resolves EVERY task to its patient UUID via the task-overview endpoint and
// dedupes record fetches on the UUID alone (engine/api-client.js caches both
// the overview resolution and the record fetch, so this costs one extra
// lightweight overview call per task, not one record fetch per task).

// ── Renal context (display-only recorded fact) ────────────────────────────────
// Before signing a renally-cleared repeat the eye asks "what's the kidney
// function, and how old is that number?" The record fetch already returns the
// investigation dashboard; this surfaces the LATEST recorded eGFR verbatim,
// with its age always attached — the age IS the honest state. No threshold,
// band, or dose logic is ever computed here (intended-purpose: display only;
// out-of-context display risk is mitigated by never separating value from
// date — see H-038 control (i)).

const RENAL_MATCH = ['egfr', 'glomerular filtration'];
export const RENAL_STALE_DAYS = 365;

// Latest recorded eGFR from normalised observations ({name, date, value}).
// Returns { value, date, ageDays } or null when none recorded. Same substring
// match philosophy as the rules engine's findLatestObservation.
export function renalContext(observations, nowMs) {
  let best = null;
  for (const obs of Array.isArray(observations) ? observations : []) {
    if (!obs || !obs.name || !obs.date) continue;
    const n = String(obs.name).toLowerCase();
    if (!RENAL_MATCH.some((m) => n.includes(m))) continue;
    if (!best || String(obs.date) > String(best.date)) best = obs;
  }
  if (!best) return null;
  const t = new Date(best.date).getTime();
  const ageDays = Number.isFinite(t) && nowMs >= t ? Math.floor((nowMs - t) / 86400000) : null;
  return { value: best.value != null ? String(best.value) : '', date: best.date, ageDays };
}

// Compact age text for a recorded fact: "today", "Nd", "Nmo", "Ny". Empty
// string when unknown — the renderer must then show the raw date instead,
// never an ageless number.
export function formatObsAge(ageDays) {
  if (ageDays == null || !Number.isFinite(ageDays) || ageDays < 0) return '';
  if (ageDays === 0) return 'today';
  if (ageDays < 60) return `${ageDays}d ago`;
  if (ageDays < 365 * 2) return `${Math.round(ageDays / 30.44)}mo ago`;
  return `${Math.floor(ageDays / 365.25)}y ago`;
}

// ── Collection-location buckets (Practice-panel ruling, 2026-07-07) ──────────
// Filter pills with counts, derived from the location values present in the
// CURRENT pile — no hardcoded "dispensing" semantics, so this stays portable
// to any practice. "No location" is an explicit, countable bucket (a blank
// must never silently read as "not ours" — the panel's sharpest finding).
// When NO row carries a location the practice doesn't use the field: return
// [] and the whole pill row stays invisible.
export const NO_LOCATION_KEY = '\u0000none';

export function locationBuckets(rows) {
  const counts = new Map();
  let withLocation = 0;
  let without = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const loc = r && typeof r.collectionLocation === 'string' ? r.collectionLocation : '';
    if (loc) {
      withLocation++;
      counts.set(loc, (counts.get(loc) || 0) + 1);
    } else {
      without++;
    }
  }
  if (withLocation === 0) return [];
  const out = [...counts.entries()]
    .map(([label, count]) => ({ key: label, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (without > 0) out.push({ key: NO_LOCATION_KEY, label: 'No location', count: without });
  return out;
}

// In-house vs community glance category (real-user ask, Chris M. 2026-07-07:
// "so I can say your prescription will be with a quick glance — our dispenser
// or your usual chemist"). Heuristic on the recorded name only — the verbatim
// text is always shown alongside, so a mis-categorised name is visible, and
// the category changes ONLY the glyph/tint, never the data.
export function isDispensaryLocation(loc) {
  return /dispens/i.test(String(loc || ''));
}

// Apply an active location filter (Set of bucket keys; empty set = show all).
export function rowMatchesLocationFilter(row, filterKeys) {
  if (!filterKeys || filterKeys.size === 0) return true;
  const loc = row && typeof row.collectionLocation === 'string' ? row.collectionLocation : '';
  return filterKeys.has(loc || NO_LOCATION_KEY);
}

// Safety note for an active filter: how many rows are hidden, and — the part
// that must never be silent — how many of those carry a RED verdict. A filter
// may narrow the view, but a hidden red flag is always called out by count.
export function filterHiddenSummary(rows, filterKeys) {
  if (!filterKeys || filterKeys.size === 0) return null;
  let hidden = 0;
  let hiddenRed = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (rowMatchesLocationFilter(r, filterKeys)) continue;
    hidden++;
    if ((r.verdict && r.verdict.level === 'red') || (r.comboVerdict && r.comboVerdict.level === 'red')) hiddenRed++;
  }
  return { hidden, hiddenRed };
}

// ── Empty-state kind (Practice-panel "clear state" ruling, 2026-07-07) ───────
// One fixed line of warm, static text on the GENUINELY finished pile —
// acknowledgement, not celebration; no emoji, no animation, no rotation (the
// panel was unanimous, including the personas who like fun). Tom's guard is
// load-bearing: warmth must never appear when the emptiness is an artefact of
// narrowed view state (a type unticked, a location filter active) — warmth on
// a false all-clear is worse than no warmth at all.
//   'done'     — zero rows with every task type selected and no filter: the
//                pile is truly finished.
//   'narrowed' — zero rows but the view is narrowed: neutral wording only.
//   null       — rows exist; no empty state.
export function emptyStateKind(rowCount, allTypesSelected, filterActive) {
  if (rowCount > 0) return null;
  return allTypesSelected && !filterActive ? 'done' : 'narrowed';
}

// Age of a request in whole days from its createdAt to `now` (ms). null when
// unparseable — the renderer shows nothing rather than "0d".
export function requestAgeDays(createdAt, nowMs) {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((nowMs - t) / 86400000);
  return days >= 0 ? days : null;
}
