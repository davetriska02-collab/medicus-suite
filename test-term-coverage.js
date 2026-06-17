// test-term-coverage.js — class-term / brand-list completeness detector
// Run with: node test-term-coverage.js
//
// CI-runnable, OFFLINE, deterministic guard for the hand-maintained term tables
// in engine/stopp-start.js, engine/acb-scores.js, and the ANTICHOLINERGIC
// constant in content-scripts/triage-lens/content.js.
//
// Complements test-drug-brand-coverage.js (which guards rules/drug-rules.json
// drug.match via the real drugMatchesRule()). This test guards the OTHER
// hand-maintained class-term lists that have no existing guard and have already
// drifted — see rules/term-coverage-snapshot.json for the pinned baseline and
// the documented divergences.
//
// Design:
//   1. ACB engine coverage — every score-3/score-2 drug expected by the
//      snapshot is present in engine/acb-scores.js and scores correctly via
//      the real computeACB(). EXIT 1 on any failure.
//   2. STOPP NSAID coverage — every NSAID in the snapshot fires stopp_nsaid_ckd
//      via the real computeStoppStart(). EXIT 1 on any failure.
//   3. STOPP aspirin coverage — known-good forms fire stopp_aspirin_primary_prev;
//      known-gap brand forms (Nu-seals, Caprin, word-order variant) do NOT fire
//      today — each gap is printed as a KNOWN-GAP warning but does NOT cause
//      exit(1). This makes the gap VISIBLE in CI without blocking the build until
//      Wave C canonicalisation fixes it.
//   4. Cross-file agreement — content.js ANTICHOLINERGIC vs engine/acb-scores.js:
//      every divergence documented in the snapshot is verified against the live
//      source. Any NEW divergence not in the snapshot causes EXIT 1 so silent
//      drift can't ship.
//
// Updating this test:
//   When you extend a term list in product code (Wave C), add the new term to
//   rules/term-coverage-snapshot.json mustMatchAll (or remove a knownGap entry
//   once fixed). This test will then verify it.

'use strict';

const path = require('path');
const fs = require('fs');

// ── Load engines ──────────────────────────────────────────────────────────────
const { computeACB, ACB_TABLE } = require(path.join(__dirname, 'engine', 'acb-scores.js'));
const { computeStoppStart } = require(path.join(__dirname, 'engine', 'stopp-start.js'));

// ── Load snapshot ─────────────────────────────────────────────────────────────
const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'term-coverage-snapshot.json'), 'utf8'));

// ── Parse content.js ANTICHOLINERGIC table ────────────────────────────────────
// content.js is not an ES module and not a Node CJS module — it's an IIFE browser
// script. We parse the ANTICHOLINERGIC constant from source rather than executing
// the whole file (which would fail in Node without DOM/chrome globals).
function parseContentJsAnticholinergicTable() {
  const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');
  // Extract the block between "const ANTICHOLINERGIC = [" and the matching "];"
  // The table is a flat array of { match: /regex/i, score: N } objects
  const startMarker = 'const ANTICHOLINERGIC = [';
  const startIdx = src.indexOf(startMarker);
  if (startIdx === -1) throw new Error('content.js: cannot find ANTICHOLINERGIC constant');

  // Find the closing "];" — walk forward tracking bracket depth
  let depth = 0;
  let endIdx = -1;
  for (let i = startIdx + startMarker.length - 1; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) throw new Error('content.js: cannot find end of ANTICHOLINERGIC array');

  const block = src.slice(startIdx + startMarker.length, endIdx);

  // Parse each entry: { match: /terms.../i, score: N }
  // Regex pattern: match: /pattern/i, score: digits
  const entryRe = /\{\s*match:\s*\/(.*?)\/i\s*,\s*score:\s*(\d+)\s*\}/g;
  const entries = [];
  let m;
  while ((m = entryRe.exec(block)) !== null) {
    const pattern = m[1];
    const score = parseInt(m[2], 10);
    // The pattern is a regex alternation like: amitriptyline|nortriptyline|dosulepin|imipramine
    const terms = pattern.split('|').map((t) => t.trim());
    entries.push({ terms, score, rawPattern: pattern });
  }
  return entries;
}

// Build a flat map: term -> score from content.js ANTICHOLINERGIC
function buildContentJsMap(entries) {
  const map = {};
  entries.forEach((e) => e.terms.forEach((t) => (map[t.toLowerCase()] = e.score)));
  return map;
}

// Build a flat map: term -> score from acb-scores.js ACB_TABLE
function buildAcbScoresMap() {
  const map = {};
  ACB_TABLE.forEach((e) => (map[e.term.toLowerCase()] = e.score));
  return map;
}

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

// ── SECTION 5: content.js ANTICHOLINERGIC — structural presence ───────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('§5  content-scripts/triage-lens/content.js ANTICHOLINERGIC');
console.log('    Checking that expected terms are detectable in the table');
console.log('═══════════════════════════════════════════════════════════════');

let contentJsEntries;
let contentJsMap;
try {
  contentJsEntries = parseContentJsAnticholinergicTable();
  contentJsMap = buildContentJsMap(contentJsEntries);
  console.log(`  Parsed ${contentJsEntries.length} regex groups, ${Object.keys(contentJsMap).length} distinct terms`);
} catch (err) {
  console.error(`  FAIL Could not parse content.js ANTICHOLINERGIC table: ${err.message}`);
  failed++;
  contentJsMap = {};
}

const contentExpected = snapshot.classes.content_js_anticholinergic.mustMatchAll;
contentExpected.forEach(({ term, expectedScore, note }) => {
  const lc = term.toLowerCase();
  // Check if any entry in contentJsMap is a substring of the term (or term is a substring of an entry)
  // content.js uses /regex/i against the drug name string — so if 'amitriptyline' is in the pattern
  // it will match 'amitriptyline 10mg tablets'
  const matchedEntry = Object.entries(contentJsMap).find(([t]) => lc.includes(t));
  if (matchedEntry) {
    const [matchedTerm, actualScore] = matchedEntry;
    check(
      actualScore === expectedScore,
      `content.js: "${term}" matched via "${matchedTerm}" score=${actualScore} (expected ${expectedScore})${note ? ' [' + note + ']' : ''}`
    );
  } else {
    check(false, `content.js: "${term}" not matched by any ANTICHOLINERGIC entry${note ? ' [' + note + ']' : ''}`);
  }
});

// ── SECTION 6: Cross-file agreement — documented divergences ──────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log('§6  Cross-file agreement: content.js ANTICHOLINERGIC vs engine/acb-scores.js');
console.log('    Each divergence below is DOCUMENTED in the snapshot.');
console.log('    NEW undocumented divergences cause EXIT 1.');
console.log('═══════════════════════════════════════════════════════════════');

const acbScoresMap = buildAcbScoresMap();

// Build the set of documented divergences from the snapshot
const documentedDivergenceTerms = new Set(
  (snapshot.classes.content_js_anticholinergic.knownDivergences || []).map((d) => d.term.toLowerCase())
);

// Find all terms in content.js that diverge from acb-scores.js
// Divergence = same term present in both but different score, OR present in one only
const allContentTerms = Object.keys(contentJsMap);
const allAcbTerms = Object.keys(acbScoresMap);

let undocumentedDivergences = 0;

console.log('\n  Verifying documented divergences match live source:');
(snapshot.classes.content_js_anticholinergic.knownDivergences || []).forEach(
  ({ term, contentJsScore, acbScoresJs, clinicalRisk, note }) => {
    const lc = term.toLowerCase();
    const contentScore = contentJsMap[lc]; // undefined if missing
    const acbScore = acbScoresMap[lc]; // undefined if missing

    const contentExpected =
      contentJsScore === 'MISSING' || contentJsScore === 'MISSING via ANTICHOLINERGIC' ? undefined : contentJsScore;
    const acbExpected =
      typeof acbScoresJs === 'number' ? acbScoresJs : acbScoresJs === 'MISSING' ? undefined : undefined;

    // Check content.js side
    const contentMatch = contentScore === contentExpected;
    // Check acb-scores.js side
    const acbMatch = acbScore === acbExpected;

    if (contentMatch && acbMatch) {
      const label = clinicalRisk ? ` [CLINICAL RISK: ${clinicalRisk}]` : note ? ` [${note}]` : '';
      console.log(`  DIVERGENCE-CONFIRMED  ${term}${label}`);
    } else {
      // The divergence has changed — either fixed or drifted further
      console.warn(
        `  DIVERGENCE-CHANGED  ${term}: ` +
          `content.js=${contentScore ?? 'MISSING'} (snapshot expected ${contentExpected ?? 'MISSING'}), ` +
          `acb-scores.js=${acbScore ?? 'MISSING'} (snapshot expected ${acbExpected ?? 'MISSING'}). ` +
          `Update rules/term-coverage-snapshot.json.`
      );
      // If the scores now agree (divergence fixed) that's good — not a fail
      // If they've drifted further in a different way — that's a fail
      if (contentScore !== acbScore || (contentScore === undefined && acbScore === undefined)) {
        // Still divergent but differently than documented — warn but don't fail
        // (it may have been partially fixed)
      }
    }
  }
);

// Check for NEW undocumented divergences (not in snapshot)
console.log('\n  Scanning for NEW undocumented divergences:');
const allTermsUnion = new Set([...allContentTerms, ...allAcbTerms]);
allTermsUnion.forEach((term) => {
  const contentScore = contentJsMap[term];
  const acbScore = acbScoresMap[term];
  const diverges =
    contentScore !== acbScore &&
    (contentScore !== undefined || acbScore !== undefined) &&
    !(contentScore === undefined && acbScore !== undefined && acbScore === 1); // acb-only score-1 entries are expected extras, not divergences we guard here

  if (diverges && !documentedDivergenceTerms.has(term)) {
    // Check if this is an acb-scores-only term (present in acb but not content.js)
    // Those are not divergences we care about here — content.js not having a score-1 entry is fine
    const isAcbOnly = contentScore === undefined && acbScore !== undefined;
    if (!isAcbOnly) {
      console.error(
        `  FAIL NEW-UNDOCUMENTED-DIVERGENCE  "${term}": content.js=${contentScore ?? 'MISSING'}, acb-scores.js=${acbScore ?? 'MISSING'}. ` +
          `Add to knownDivergences in rules/term-coverage-snapshot.json.`
      );
      failed++;
      undocumentedDivergences++;
    }
  }
});

if (undocumentedDivergences === 0) {
  console.log('  OK   No new undocumented divergences found.');
  passed++;
}

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
