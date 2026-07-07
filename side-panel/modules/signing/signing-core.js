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

// Row states a task can be in while the pass runs.
export const ROW_STATE = {
  PENDING: 'pending', // not yet checked this pass
  CHECKING: 'checking',
  DONE: 'done', // verdict present (level may be null = no flags recorded)
  ERROR: 'error', // record could not be read — explicitly NOT an all-clear
};

// Sort for the rendered pile — the eye should land on the riskiest first:
//   1. red with the requested drug itself flagged
//   2. red
//   3. amber
//   4. error / unchecked (unknown is riskier than a recorded all-clear)
//   5. no flags recorded
// Ties: oldest request first (the pile is worked oldest-up).
export function sortSigningRows(rows) {
  const bandOf = (r) => {
    if (r.state === ROW_STATE.DONE && r.verdict) {
      if (r.verdict.level === 'red') return r.requestedHits && r.requestedHits.length ? 0 : 1;
      if (r.verdict.level === 'amber') return 2;
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

// Age of a request in whole days from its createdAt to `now` (ms). null when
// unparseable — the renderer shows nothing rather than "0d".
export function requestAgeDays(createdAt, nowMs) {
  if (!createdAt) return null;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((nowMs - t) / 86400000);
  return days >= 0 ? days : null;
}
