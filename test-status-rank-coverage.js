// Medicus Suite — STATUS_RANK coverage tests
// Run with: node test-status-rank-coverage.js
//
// Guards a LATENT, high-blast-radius failure mode in the rules engine.
// Chip sort order (engine/rules-engine.js) reads `STATUS_RANK[status] ?? 99`
// at the two consumer sites (worst-of among a rule's tests, and the final
// cross-chip sort). An unknown status therefore defaults to rank 99 — the
// *least* urgent slot — so a status the code can emit but that nobody added to
// STATUS_RANK would sort a genuine red alert to the BOTTOM of the chip list,
// where a clinician scrolls past it in a short appointment. There is no error;
// the alert just hides. (This is the v3.69.0-class silent-miss pattern.)
//
// Every status string the engine can EMIT must therefore be a key in
// STATUS_RANK. This test converts "a dev adds a new status months from now and
// forgets the rank table" into "CI fails on the PR" — exactly the philosophy
// CLAUDE.md already mandates for drug-brand coverage.
//
// If you add a new emittable status: add it to STATUS_RANK (with the correct
// urgency rank) AND to EMITTABLE_STATUSES below. If you add a non-status
// snake_case literal on a line that also assigns `status` (e.g. an evt.type
// comparison value), add it to NON_STATUS_LITERALS so the source scan ignores it.

'use strict';

const fs = require('fs');
const path = require('path');
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const RANK = engine.STATUS_RANK;
const rankKeys = new Set(Object.keys(RANK));

// The complete set of statuses the engine is intended to emit onto a chip.
// Kept in lock-step with the `status:` / `status =` assignments in
// engine/rules-engine.js (incl. the vaccine ternary and severityToStatus()).
const EMITTABLE_STATUSES = [
  'overdue',
  'not_met',
  'alert',
  'stale',
  'due_soon',
  'caution',
  'no_data',
  'noted',
  'recently_initiated',
  'achieved',
  'in_date',
  'vax_given',
  'vax_declined',
  'vax_due',
];

// snake_case single-quoted literals that appear on a line which also assigns
// `status` but are NOT themselves statuses (comparison RHS values etc.).
const NON_STATUS_LITERALS = new Set(['given']); // evt.type === 'given' on line ~2011

// ── 1. Every intended emittable status has a rank ──────────────────────────
console.log('\n--- Every emittable status is ranked ---');
for (const s of EMITTABLE_STATUSES) {
  check(rankKeys.has(s), `STATUS_RANK has a rank for '${s}' (else it sorts to 99 = least urgent)`);
}

// ── 2. STATUS_RANK has no dead/extra keys ──────────────────────────────────
// Drift the other way: a rank-table entry no status ever emits is dead config
// and usually signals a renamed-but-not-removed status.
console.log('\n--- STATUS_RANK has no unexpected keys ---');
const expected = new Set(EMITTABLE_STATUSES);
for (const k of rankKeys) {
  check(expected.has(k), `STATUS_RANK key '${k}' is a known emittable status (no dead entries)`);
}

// ── 3. Source scan: the engine emits no UNRANKED status ────────────────────
// This is the real regression guard. Scan every line of rules-engine.js that
// assigns `status` and collect the snake_case string literals on it; assert
// each is ranked (or explicitly allow-listed as a non-status literal). Adding a
// new `status: 'foo'` without ranking 'foo' fails here.
console.log('\n--- Source scan: no unranked status literal ---');
const src = fs.readFileSync(path.join(__dirname, 'engine', 'rules-engine.js'), 'utf8');
const emittedInSource = new Set();
for (const line of src.split('\n')) {
  if (!/\bstatus\s*[:=]/.test(line)) continue;
  for (const m of line.matchAll(/'([a-z][a-z_]*)'/g)) {
    const tok = m[1];
    if (NON_STATUS_LITERALS.has(tok)) continue;
    emittedInSource.add(tok);
  }
}
check(emittedInSource.size > 0, `source scan found status literals (sanity: found ${emittedInSource.size})`);
for (const s of emittedInSource) {
  check(
    rankKeys.has(s),
    `status '${s}' emitted in rules-engine.js source is ranked in STATUS_RANK` +
      ` (add it to STATUS_RANK + EMITTABLE_STATUSES, or to NON_STATUS_LITERALS if it isn't a status)`
  );
}
// Cross-check: the source-discovered statuses match the maintained list, so the
// maintained list can't silently rot.
for (const s of emittedInSource) {
  check(expected.has(s), `status '${s}' found in source is declared in EMITTABLE_STATUSES (keep the list in sync)`);
}

console.log(`\nStatus-rank coverage: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
