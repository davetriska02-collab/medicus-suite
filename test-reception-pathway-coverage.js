// Medicus Suite — reception pathway ↔ match-term coverage guard
// Run with: node test-reception-pathway-coverage.js
//
// The SILENT failure mode this file exists for (same class as
// test-drug-brand-coverage.js): a pathway that is shipped in
// rules/reception-pathways.json but absent from engine/reception-match.js's
// SYNONYM_TERMS gets a panel tile and is NEVER offered by the free-text matcher.
// No error, no warning — the pathway simply never fires for a caller who used
// the obvious lay words for it. Likewise a red-flag id missing from
// RED_FLAG_TOPIC_TERMS: safe (its topic always reads as an un-asked gap) but
// noisier than it should be, and unreviewed.
//
// It also PINS the GU tie-break. "uti" / "waterworks" / "urine infection"
// legitimately belong to BOTH `urinary` (women 16–64, Pharmacy First eligible)
// and `gu-male` (men, explicitly EXCLUDED from Pharmacy First). matchPathways
// returning both — offer both, never auto-pick — is the intended behaviour, and
// the reason the assertion below exists is so nobody "optimises" it into
// first-match-wins and silently routes a man down the women's UTI pathway.

'use strict';

const fs = require('fs');
const path = require('path');
const { matchPathways, SYNONYM_TERMS, RED_FLAG_TOPIC_TERMS } = require('./engine/reception-match.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'reception-pathways.json'), 'utf8'));
const PATHWAYS = doc.pathways || [];

// ── Every shipped pathway id has a non-empty SYNONYM_TERMS entry ──────────────
console.log('--- SYNONYM_TERMS coverage (every shipped pathway is matchable) ---');
check(PATHWAYS.length > 0, `reception-pathways.json ships pathways (found ${PATHWAYS.length})`);
for (const p of PATHWAYS) {
  const terms = SYNONYM_TERMS[p.id];
  check(
    Array.isArray(terms) && terms.length > 0 && terms.every((t) => typeof t === 'string' && t.trim().length > 0),
    `SYNONYM_TERMS["${p.id}"] is a non-empty list of non-empty terms`
  );
}

// No stale keys — a synonym list for a pathway that no longer ships is dead
// clinical content nobody is reviewing.
const shippedIds = new Set(PATHWAYS.map((p) => p.id));
for (const key of Object.keys(SYNONYM_TERMS)) {
  check(shippedIds.has(key), `SYNONYM_TERMS key "${key}" corresponds to a shipped pathway id`);
}

// Each pathway's own terms must actually match — a term list that cannot fire
// (e.g. every entry mistyped) passes the "non-empty" check above but is useless.
console.log('\n--- SYNONYM_TERMS are live (first term of each list matches its own pathway) ---');
for (const p of PATHWAYS) {
  const terms = SYNONYM_TERMS[p.id] || [];
  if (terms.length === 0) continue;
  const hits = matchPathways(`Caller mentions ${terms[0]} today.`, PATHWAYS).map((x) => x.id);
  check(hits.includes(p.id), `matchPathways offers "${p.id}" for its own first synonym ("${terms[0]}")`);
}

// ── Every shipped red-flag id has a non-empty RED_FLAG_TOPIC_TERMS entry ──────
console.log('\n--- RED_FLAG_TOPIC_TERMS coverage (every shipped red flag has topic terms) ---');
const allFlagIds = new Set();
for (const p of PATHWAYS) {
  for (const rf of p.redFlags || []) allFlagIds.add(rf.id);
}
for (const id of allFlagIds) {
  const terms = RED_FLAG_TOPIC_TERMS[id];
  check(
    Array.isArray(terms) && terms.length > 0 && terms.every((t) => typeof t === 'string' && t.trim().length > 0),
    `RED_FLAG_TOPIC_TERMS["${id}"] is a non-empty list of non-empty terms`
  );
}
for (const key of Object.keys(RED_FLAG_TOPIC_TERMS)) {
  check(allFlagIds.has(key), `RED_FLAG_TOPIC_TERMS key "${key}" corresponds to a shipped red-flag id`);
}

// ── The GU tie-break pin ──────────────────────────────────────────────────────
// matchPathways returns an ARRAY of pathway objects — a candidate list, not a
// decision. Both urinary and gu-male must appear for generic UTI wording, and
// the call must never collapse to a single auto-picked pathway.
console.log('\n--- GU tie-break: generic UTI wording offers BOTH urinary and gu-male ---');
{
  const text = 'burning when passing urine uti';
  const hits = matchPathways(text, PATHWAYS);
  check(Array.isArray(hits), 'matchPathways returns an array of candidates (not a single auto-picked pathway)');
  const ids = hits.map((p) => p.id);
  check(ids.includes('urinary'), `"${text}" offers the "urinary" pathway`);
  check(ids.includes('gu-male'), `"${text}" ALSO offers the "gu-male" pathway (male UTI is NOT Pharmacy First)`);
  check(hits.length >= 2, 'both candidates are returned together — never narrowed to first-match-wins');
  check(
    hits.every((p) => p && typeof p === 'object' && typeof p.id === 'string'),
    'candidates are the full pathway objects, so the caller can offer them by title'
  );
}
{
  // The same tie-break holds for the other shared lay terms named in the plan.
  for (const text of ['problem with the waterworks', 'thinks he has a urine infection']) {
    const ids = matchPathways(text, PATHWAYS).map((p) => p.id);
    check(ids.includes('urinary') && ids.includes('gu-male'), `"${text}" offers both urinary and gu-male`);
  }
}
{
  // Guard the other direction: a male-specific term must NOT drag in the
  // women's UTI pathway, or the tie-break becomes noise.
  const ids = matchPathways('swelling in the scrotum since yesterday', PATHWAYS).map((p) => p.id);
  check(ids.includes('gu-male'), 'male-specific wording ("scrotum") offers gu-male');
  check(!ids.includes('urinary'), 'male-specific wording does NOT offer the women 16–64 urinary pathway');
}
{
  // Mental health matches deliberately broadly — the fail-safe direction here is
  // over-offering, not missing a distressed caller.
  for (const text of [
    'caller says they are struggling with anxiety',
    'feeling suicidal',
    'mental health crisis',
    'low mood for months',
  ]) {
    const ids = matchPathways(text, PATHWAYS).map((p) => p.id);
    check(ids.includes('mental-health'), `"${text}" offers the mental-health pathway`);
  }
}
{
  const ids = matchPathways('bleeding after sex and pelvic pain', PATHWAYS).map((p) => p.id);
  check(ids.includes('gyn-female'), 'gynae wording offers the gyn-female pathway');
}
{
  const ids = matchPathways('cystitis again', PATHWAYS).map((p) => p.id);
  check(ids.includes('urinary') && ids.includes('gu-male'), '"cystitis" offers both urinary and gu-male');
}
{
  const ids = matchPathways('car breakdown on the M25 need a sick note', PATHWAYS).map((p) => p.id);
  check(!ids.includes('mental-health'), 'bare "breakdown" (car) does not offer mental-health');
}
{
  const ids = matchPathways('nervous breakdown after bereavement', PATHWAYS).map((p) => p.id);
  check(ids.includes('mental-health'), '"nervous breakdown" still offers mental-health');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
