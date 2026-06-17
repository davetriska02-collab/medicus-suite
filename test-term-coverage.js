// test-term-coverage.js — class-term / brand-list completeness detector
// Run with: node test-term-coverage.js
//
// CI-runnable, OFFLINE, deterministic guard for the hand-maintained term tables
// in engine/stopp-start.js and engine/acb-scores.js.
//
// Complements test-drug-brand-coverage.js (which guards rules/drug-rules.json
// drug.match via the real drugMatchesRule()). This test guards the OTHER
// hand-maintained class-term lists — see rules/term-coverage-snapshot.json for
// the pinned baseline.
//
// Design:
//   1. ACB engine coverage — every score-3/score-2 drug expected by the
//      snapshot is present in engine/acb-scores.js and scores correctly via
//      the real computeACB(). EXIT 1 on any failure.
//   2. STOPP NSAID coverage — every NSAID in the snapshot fires stopp_nsaid_ckd
//      via the real computeStoppStart(). EXIT 1 on any failure.
//   3/4. STOPP aspirin coverage — every low-dose form/brand in the snapshot
//      fires stopp_aspirin_primary_prev. (Any residual knownGaps still print as
//      a KNOWN-GAP warning without failing the build; Wave C emptied them.)
//   5. ACB single-scorer delegation — content.js must NOT carry its own ACB
//      table and MUST call the canonical engine (window.ACBScores.computeACB).
//   6. Resolved divergences — every drug that used to differ between the queue
//      HUD and the engine/record view is now scored identically by the ONE
//      scorer; the deliberately-dropped non-Boustani terms score 0.
//
// Updating this test:
//   When you extend a term list in product code, add the new term to
//   rules/term-coverage-snapshot.json mustMatchAll (or remove a knownGap entry
//   once fixed). This test will then verify it.

'use strict';

const path = require('path');
const fs = require('fs');

// ── Load engines ──────────────────────────────────────────────────────────────
const { computeACB } = require(path.join(__dirname, 'engine', 'acb-scores.js'));
const { computeStoppStart } = require(path.join(__dirname, 'engine', 'stopp-start.js'));

// ── Load snapshot ─────────────────────────────────────────────────────────────
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'term-coverage-snapshot.json'), 'utf8'));

// As of Wave C (3.114) content.js no longer carries its own ANTICHOLINERGIC
// table — it delegates to the single canonical scorer engine/acb-scores.js.
// §5/§6 below assert that delegation and that the one scorer covers every drug
// that used to differ between the queue HUD and the record/engine view.

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let knownGapsReported = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`  OK   ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL ${msg}`);
    failed++;
  }
}

function knownGap(cond, msg, detail) {
  // A known gap: condition is expected to be FALSE today (the gap exists).
  // We WARN loudly if the gap unexpectedly disappears (fixed — update snapshot)
  // but we do NOT fail the build when it's still present.
  if (cond) {
    console.log(`  FIXED(update snapshot)  ${msg}`);
    // Not a failure — just a reminder to remove from knownGaps in snapshot
  } else {
    console.warn(`  KNOWN-GAP  ${msg}`);
    if (detail) console.warn(`             ${detail}`);
    knownGapsReported++;
  }
}

// ── SECTION 1: ACB engine — score-3 drugs ─────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('§1  engine/acb-scores.js — score-3 drug coverage');
console.log('═══════════════════════════════════════════════════════════════');

const score3Expected = snapshot.classes.acb_scores_score3.mustMatchAll;
score3Expected.forEach(({ term, expectedScore, note }) => {
  const r = computeACB([term]);
  const actualScore = r.perDrug.length > 0 ? r.perDrug[0].score : 0;
  check(
    actualScore === expectedScore,
    `${term}: score=${actualScore} (expected ${expectedScore})${note ? ' [' + note + ']' : ''}`
  );
});

// ── SECTION 2: ACB engine — score-2 drugs ─────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('§2  engine/acb-scores.js — score-2 drug coverage');
console.log('═══════════════════════════════════════════════════════════════');

const score2Expected = snapshot.classes.acb_scores_score2.mustMatchAll;
score2Expected.forEach(({ term, expectedScore, note }) => {
  const r = computeACB([term]);
  const actualScore = r.perDrug.length > 0 ? r.perDrug[0].score : 0;
  check(
    actualScore === expectedScore,
    `${term}: score=${actualScore} (expected ${expectedScore})${note ? ' [' + note + ']' : ''}`
  );
});

// ── SECTION 3: STOPP NSAID coverage ───────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('§3  engine/stopp-start.js NSAID_TERMS — core NSAID drug coverage');
console.log('    Probe: computeStoppStart with eGFR 40 (should fire stopp_nsaid_ckd)');
console.log('═══════════════════════════════════════════════════════════════');

const nsaidExpected = snapshot.classes.stopp_nsaid.mustMatchAll;
nsaidExpected.forEach(({ term, note }) => {
  const flags = computeStoppStart({ drugs: [term], problems: [], ageYears: 70, egfr: 40 });
  const fired = flags.some((f) => f.id === 'stopp_nsaid_ckd');
  check(fired, `"${term}" fires stopp_nsaid_ckd${note ? ' [' + note + ']' : ''}`);
});

// Known-gaps: NSAIDs present in alert-library but absent from stopp-start
console.log('\n  -- NSAID known gaps (present in alert-library, missing from stopp-start NSAID_TERMS):');
snapshot.classes.stopp_nsaid.knownGaps
  .filter((g) => g.missingFrom && g.missingFrom.includes('stopp-start'))
  .forEach(({ term, clinicalRisk }) => {
    if (term === 'Nu-seals 75mg tablets') return; // that's an aspirin brand, not NSAID
    const flags = computeStoppStart({ drugs: [term], problems: [], ageYears: 70, egfr: 40 });
    const fired = flags.some((f) => f.id === 'stopp_nsaid_ckd');
    knownGap(fired, `"${term}" does NOT fire stopp_nsaid_ckd (gap)`, clinicalRisk);
  });

// ── SECTION 4: STOPP aspirin low-dose coverage ────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('§4  engine/stopp-start.js ASPIRIN_TERMS — low-dose aspirin coverage');
console.log('    Probe: computeStoppStart with no CV disease (should fire stopp_aspirin_primary_prev)');
console.log('═══════════════════════════════════════════════════════════════');

const aspirinExpected = snapshot.classes.stopp_aspirin_lowdose.mustMatchAll;
aspirinExpected.forEach(({ term, note }) => {
  const flags = computeStoppStart({ drugs: [term], problems: [], ageYears: 70, egfr: 70 });
  const fired = flags.some((f) => f.id === 'stopp_aspirin_primary_prev');
  check(fired, `"${term}" fires stopp_aspirin_primary_prev${note ? ' [' + note + ']' : ''}`);
});

// Known-gaps: brand forms and word-order variants that currently DON'T fire
console.log('\n  -- Aspirin known gaps (brand names / word-order variants not covered by ASPIRIN_TERMS):');
snapshot.classes.stopp_aspirin_lowdose.knownGaps.forEach(({ term, clinicalRisk, status, note }) => {
  const flags = computeStoppStart({ drugs: [term], problems: [], ageYears: 70, egfr: 70 });
  const fired = flags.some((f) => f.id === 'stopp_aspirin_primary_prev');
  const detail = clinicalRisk || note;
  // knownGap() expects cond=true when it IS fixed; here fired===true means fixed
  knownGap(fired, `"${term}" does NOT fire stopp_aspirin_primary_prev (gap)`, detail);
});

// ── SECTION 5: content.js ACB scoring delegates to the single engine ──────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('§5  content-scripts/triage-lens/content.js — ACB single-scorer delegation');
console.log('    content.js must NOT carry its own ACB table; it must call the');
console.log('    canonical engine (window.ACBScores.computeACB).');
console.log('═══════════════════════════════════════════════════════════════');

const contentJsSrc = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');
const del = snapshot.classes.content_js_anticholinergic.delegationAssertions;
check(
  !contentJsSrc.includes(del.contentJsMustNotDefineTable),
  `content.js no longer defines a separate ACB table ("${del.contentJsMustNotDefineTable}")`
);
check(
  contentJsSrc.includes(del.contentJsMustReference),
  `content.js references the canonical scorer ("${del.contentJsMustReference}")`
);

// ── SECTION 6: every formerly-divergent drug is now scored by the ONE scorer ───
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('§6  Resolved divergences — the single scorer covers every drug that');
console.log('    used to differ between the queue HUD and the engine/record view.');
console.log('═══════════════════════════════════════════════════════════════');

(snapshot.classes.content_js_anticholinergic.resolvedDivergences || []).forEach(({ term, nowEngineScore, note }) => {
  const r = computeACB([term]);
  const actual = r.perDrug.length > 0 ? r.perDrug[0].score : 0;
  check(
    actual === nowEngineScore,
    `computeACB("${term}")=${actual} (single scorer, expected ${nowEngineScore})${note ? ' [' + note + ']' : ''}`
  );
});

// Drugs content.js used to score but that are NOT on the Boustani/ACBcalc scale:
// the single scorer must return 0 for them (deliberate drop, recorded for audit).
const dropped = snapshot.classes.content_js_anticholinergic._droppedFromContentJs;
(dropped ? dropped.terms : []).forEach((term) => {
  const r = computeACB([term + ' 10mg tablets']);
  const actual = r.perDrug.length > 0 ? r.perDrug[0].score : 0;
  check(actual === 0, `dropped non-Boustani term "${term}" scores 0 in the single scorer`);
});

// ── SECTION 7: Snapshot integrity — no term appears in mustMatchAll AND knownGaps ─
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('§7  Snapshot self-consistency check');
console.log('═══════════════════════════════════════════════════════════════');

function checkSnapshotConsistency(className) {
  const cls = snapshot.classes[className];
  if (!cls) return;
  const mustTerms = new Set((cls.mustMatchAll || []).map((e) => e.term.toLowerCase()));
  (cls.knownGaps || []).forEach(({ term }) => {
    check(
      !mustTerms.has(term.toLowerCase()),
      `snapshot: "${term}" not in both mustMatchAll and knownGaps of ${className}`
    );
  });
}
checkSnapshotConsistency('stopp_nsaid');
checkSnapshotConsistency('stopp_aspirin_lowdose');
checkSnapshotConsistency('acb_scores_score3');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(63)}`);
console.log(
  `Tests: ${passed + failed} assertions  ·  ${passed} passed  ·  ${failed} failed  ·  ${knownGapsReported} known-gap(s) reported`
);
if (knownGapsReported > 0) {
  console.warn(`\nKNOWN GAPS (${knownGapsReported}) — these are REAL clinical risks documented above.`);
  console.warn(
    `Wave C term canonicalisation will fix them; at that point remove from snapshot knownGaps\n` +
      `and add to mustMatchAll so this test locks them in.`
  );
}
if (failed > 0) {
  console.error(`\nFAIL — ${failed} assertion(s) failed. Fix before shipping.`);
  process.exit(1);
} else {
  console.log('\nAll assertions passed. Known gaps printed above for visibility.');
}
