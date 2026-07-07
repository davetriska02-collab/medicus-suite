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

// Group open tasks by patient so one slow record fetch serves every request
// from that patient. Tasks without a task id are dropped (nothing to key on).
// Returns [{ key, tasks }] — key is the task id of the FIRST task for the
// patient until a patient UUID is resolved (the module rekeys after
// resolution); grouping input is (patientName + dateOfBirth) because the
// task-list row carries no patient UUID.
export function groupTasksByPatient(tasks) {
  const groups = new Map();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const id = t && (t.taskId ?? t.id);
    if (id == null) continue;
    const key = `${_norm(t.patientName)}|${_norm(t.dateOfBirth)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return [...groups.values()];
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
