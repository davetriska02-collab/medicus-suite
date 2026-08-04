// Medicus Suite — Urgency bracket pattern coverage guard
// Run with: node test-urgency-bracket-coverage.js
//
// Practice-defined urgency brackets (Phase 1 — detail page only,
// docs/plans/TRIAGE-NORTHSTAR-2026-07-22.md) are named, advisory CATEGORY
// tags matched against the patient's free-text request. Modelled directly on
// test-triage-rule-patterns.js: this test loads REAL defaults.json and
// requires the REAL shared matcher (content-scripts/triage-lens/rule-match.js,
// window.TriageLensMatch) rather than reimplementing compile/match — a local
// mirror here could silently diverge from what content.js actually does on
// the page while this test kept passing.

'use strict';

const path = require('path');
const cfg = require(path.join(__dirname, 'defaults.json'));
const M = require(path.join(__dirname, 'content-scripts', 'triage-lens', 'rule-match.js'));

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ---- Real engine compile step (content-scripts/triage-lens/rule-match.js) ----
// compileRule is shape-agnostic (it only reads enabled/patterns/regex), so a
// bracket entry compiles through the EXACT same code path as a rule; that's
// the whole point of reusing rule-match.js unchanged for brackets (pinned
// design decision 3).
function compileBracket(bracket) {
  const compiled = M.compileRule(bracket);
  if (!compiled) return [];
  if (Array.isArray(compiled._errors) && compiled._errors.length) {
    throw new Error(compiled._errors.join('; '));
  }
  return compiled._compiled;
}

check(Array.isArray(cfg.urgencyBrackets), 'defaults.json has a top-level urgencyBrackets array');

// ---- 1. Schema invariants + every shipped pattern compiles ----
const VALID_KINDS = new Set(['red', 'amber', 'green', 'info']);
const seenIds = new Set();
const compiledById = new Map();

for (const bracket of cfg.urgencyBrackets) {
  check(!seenIds.has(bracket.id), `duplicate bracket id: ${bracket.id}`);
  seenIds.add(bracket.id);
  check(VALID_KINDS.has(bracket.kind), `${bracket.id}: invalid kind "${bracket.kind}"`);
  check(typeof bracket.label === 'string' && bracket.label.trim().length > 0, `${bracket.id}: empty label`);
  check(bracket.enabled === true, `${bracket.id}: shipped bracket must be enabled:true`);
  check(bracket.builtin === true, `${bracket.id}: shipped bracket must be builtin:true`);
  check(bracket.regex === true, `${bracket.id}: shipped bracket must be regex:true`);
  try {
    const compiled = compileBracket(bracket);
    check(compiled.length > 0, `${bracket.id}: no usable patterns`);
    compiledById.set(bracket.id, compiled);
  } catch (e) {
    check(false, `${bracket.id}: pattern failed to compile — ${e.message}`);
    compiledById.set(bracket.id, []);
  }
}
console.log(`  OK  ${cfg.urgencyBrackets.length} urgency brackets, all patterns compile, schema invariants hold`);

// The three Phase-1 shipped brackets must all be present (pinned design decision 2).
for (const id of ['bracket-mental-health', 'bracket-home-visit', 'bracket-acute-illness']) {
  check(seenIds.has(id), `shipped bracket "${id}" is present in defaults.json`);
}

// ---- 2. Bracket must not duplicate mh-crisis's crisis patterns verbatim ----
// Pinned design decision 2: bracket-mental-health may cover ideation-adjacent
// phrasing but must not literally re-list mh-crisis's (red) crisis patterns.
{
  const mhCrisis = cfg.rules.find((r) => r.id === 'mh-crisis');
  const bracketMh = cfg.urgencyBrackets.find((b) => b.id === 'bracket-mental-health');
  check(!!mhCrisis && !!bracketMh, 'mh-crisis rule and bracket-mental-health bracket both exist');
  if (mhCrisis && bracketMh) {
    const crisisSet = new Set(mhCrisis.patterns);
    const overlap = bracketMh.patterns.filter((p) => crisisSet.has(p));
    check(
      overlap.length === 0,
      `bracket-mental-health must not duplicate mh-crisis patterns verbatim (overlap: ${overlap.join(', ')})`
    );
  }
}

// ---- 3. Cross-bracket example matching ----
// matches(text) → array of bracket ids whose patterns hit (request-text style,
// the only field brackets match against — pinned design decision 3).
const matches = (text) =>
  cfg.urgencyBrackets.filter((b) => (compiledById.get(b.id) || []).some((re) => re.test(text))).map((b) => b.id);

function expectMatch(text, mustInclude, mustExclude = []) {
  const hit = new Set(matches(text));
  for (const id of mustInclude)
    check(hit.has(id), `"${text}" should fire ${id} (fired: ${[...hit].join(', ') || 'none'})`);
  for (const id of mustExclude) check(!hit.has(id), `"${text}" must NOT fire ${id} (fired: ${[...hit].join(', ')})`);
}

// ---- bracket-mental-health: must-match (>= 4) ----
expectMatch("I've been feeling really low and can't cope with things", ['bracket-mental-health']);
expectMatch('having panic attacks most days', ['bracket-mental-health']);
expectMatch('constantly anxious about everything', ['bracket-mental-health']);
expectMatch('struggling mentally since the divorce', ['bracket-mental-health']);
expectMatch("I think I'm depressed and need some help", ['bracket-mental-health']);

// ---- bracket-mental-health: must-NOT-match (>= 3, negation-adjacent + benign lookalikes) ----
// Negation-adjacent: mentions the TOPIC with a negation, but the specific
// patterns require a suffix the text doesn't have (no negation-suppression in
// the matcher itself — this pins that the patterns are scoped, not bare stems).
expectMatch('No mental health concerns, just wanted a repeat prescription.', [], ['bracket-mental-health']);
// Negation-adjacent: explicitly the opposite of "can't cope"/"not coping".
expectMatch(
  "I've been under a bit of stress at work but coping fine, nothing to worry about.",
  [],
  ['bracket-mental-health']
);
// Benign lookalike: "worried" about something non-medical, no bracket terms present.
expectMatch("I'm a bit worried about my mortgage renewal, nothing medical.", [], ['bracket-mental-health']);

// ---- bracket-home-visit: must-match (>= 4) ----
expectMatch('Mum is housebound and needs a home visit', ['bracket-home-visit']);
expectMatch("He's bedbound and can't get to the surgery", ['bracket-home-visit']);
expectMatch("Carer says she's end of life and needs review", ['bracket-home-visit']);
expectMatch('Dad is palliative and too unwell to leave the house', ['bracket-home-visit']);
expectMatch('She is dying at home and the family need support', ['bracket-home-visit']);

// ---- bracket-home-visit: must-NOT-match (>= 3) ----
// Negation-adjacent: explicitly declines a home visit; "need for a home visit"
// (with "for" between) does not match the "needs? a home visit" pattern.
expectMatch('No need for a home visit, I can drive to the surgery.', [], ['bracket-home-visit']);
// Benign lookalike: frail but independent — no bracket terms present.
expectMatch(
  'My elderly mother is quite frail but still gets out to her local shops most days.',
  [],
  ['bracket-home-visit']
);
// Benign lookalike: about a third party, uses "bedridden" (not "bedbound").
expectMatch(
  'The district nurse mentioned my neighbour is bedridden after her hip replacement.',
  [],
  ['bracket-home-visit']
);

// ---- bracket-acute-illness: must-match (>= 4) ----
expectMatch('Started this morning with a high fever, feels dreadful', ['bracket-acute-illness']);
expectMatch("Been vomiting all day and can't keep anything down", ['bracket-acute-illness']);
expectMatch('Symptoms came on very suddenly yesterday evening', ['bracket-acute-illness']);
expectMatch("It's getting worse since yesterday, much worse than this morning", ['bracket-acute-illness']);
expectMatch('New really bad pain in his tummy since last night', ['bracket-acute-illness']);

// ---- bracket-acute-illness: must-NOT-match (>= 3) ----
// Negation-adjacent: explicitly denies the acute-onset symptoms and pins them
// to a stable chronic baseline ("since last review", not "since yesterday").
expectMatch(
  'No vomiting, no fever, symptoms have been stable for months and nothing has changed since last review.',
  [],
  ['bracket-acute-illness']
);
// Benign lookalike: chronic, explicitly non-acute.
expectMatch('Ongoing mild cough for the past three weeks, nothing acute.', [], ['bracket-acute-illness']);
// Benign lookalike: gradual chronic worsening, not "getting worse"/"sudden(ly) worse".
expectMatch('Chronic back pain, gradually worse over several years, no acute change.', [], ['bracket-acute-illness']);

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
