// test-reception-match.js — unit tests for engine/reception-match.js
// Run with: node test-reception-match.js
'use strict';

const fs = require('fs');
const path = require('path');
const {
  matchPathways,
  pharmacyFirstEligibility,
  redFlagGaps,
  buildAskBackText,
  SYNONYM_TERMS,
  RED_FLAG_TOPIC_TERMS,
} = require('./engine/reception-match.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

// ── Fixture: the REAL shipped rules/reception-pathways.json ──────────────────────────────────
const PATHWAYS_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules', 'reception-pathways.json'), 'utf8'));
const PATHWAYS = PATHWAYS_JSON.pathways;
const CLOSING_QUESTIONS = PATHWAYS_JSON.closingQuestions;

function byId(id) {
  return PATHWAYS.find((p) => p.id === id);
}

// ── Fixture sanity: the module's own tail is untouched by any accidental edit ────────────────
console.log('\n--- fixture sanity ---');
{
  assert(Array.isArray(PATHWAYS) && PATHWAYS.length > 0, 'reception-pathways.json has pathways');
  assert(
    Array.isArray(CLOSING_QUESTIONS) && CLOSING_QUESTIONS.length > 0,
    'reception-pathways.json has closingQuestions'
  );
}

// ── matchPathways: coverage — every shipped pathway has SYNONYM_TERMS ────────────────────────
console.log('\n--- matchPathways: SYNONYM_TERMS coverage (CSO-reviewable content) ---');
{
  for (const p of PATHWAYS) {
    assert(
      Array.isArray(SYNONYM_TERMS[p.id]) && SYNONYM_TERMS[p.id].length > 0,
      `SYNONYM_TERMS has a non-empty entry for shipped pathway "${p.id}"`
    );
  }
  // No stale keys pointing at pathways that no longer exist.
  const shippedIds = new Set(PATHWAYS.map((p) => p.id));
  for (const key of Object.keys(SYNONYM_TERMS)) {
    assert(shippedIds.has(key), `SYNONYM_TERMS key "${key}" corresponds to a shipped pathway id`);
  }
}

// ── redFlagGaps: coverage — every shipped red-flag id has RED_FLAG_TOPIC_TERMS ───────────────
console.log('\n--- redFlagGaps: RED_FLAG_TOPIC_TERMS coverage (CSO-reviewable content) ---');
{
  const allFlagIds = new Set();
  for (const p of PATHWAYS) {
    for (const rf of p.redFlags) allFlagIds.add(rf.id);
  }
  for (const id of allFlagIds) {
    assert(
      Array.isArray(RED_FLAG_TOPIC_TERMS[id]) && RED_FLAG_TOPIC_TERMS[id].length > 0,
      `RED_FLAG_TOPIC_TERMS has a non-empty entry for shipped red-flag id "${id}"`
    );
  }
}

// ── matchPathways: misses / empty input ───────────────────────────────────────────────────────
console.log('\n--- matchPathways: misses and empty input ---');
{
  assert(Array.isArray(matchPathways('')), 'empty string returns an array');
  assert(matchPathways('').length === 0, 'empty string → no matches');
  assert(matchPathways('   ').length === 0, 'whitespace-only string → no matches');
  assert(matchPathways(null).length === 0, 'null input → no matches (defensive)');
  assert(matchPathways(undefined).length === 0, 'undefined input → no matches (defensive)');
  assert(matchPathways(42).length === 0, 'non-string input → no matches (defensive)');
  assert(
    matchPathways('patient wants a new pair of reading glasses fitted').length === 0,
    'unrelated text → no matches'
  );
}

// ── matchPathways: single-pathway hits, covering every shipped pathway ───────────────────────
console.log('\n--- matchPathways: hits (one representative synonym per shipped pathway) ---');
{
  const sample = {
    'sore-throat': 'Patient reports a sore throat for 3 days.',
    earache: 'Child has had earache since yesterday.',
    cough: 'Adult with a chesty cough and green phlegm.',
    urinary: 'Suspected UTI — burning when weeing for two days.',
    headache: 'Patient has had a headache since this morning.',
    backpain: 'Sudden onset lower back pain after gardening.',
    'feverish-child': 'Mum calling about her feverish child, temperature 38.5.',
    rash: 'New skin rash on the arms, itchy.',
    general: 'Caller says it is something else, not covered by usual reasons.',
  };
  for (const [id, text] of Object.entries(sample)) {
    const hits = matchPathways(text);
    assert(
      hits.some((p) => p.id === id),
      `matchPathways finds "${id}" from representative text: "${text}"`
    );
  }
}

// ── matchPathways: synonym matching (not just the literal pathway title) ─────────────────────
console.log('\n--- matchPathways: synonym matching ---');
{
  assert(
    matchPathways('possible tonsillitis, very painful to swallow').some((p) => p.id === 'sore-throat'),
    '"tonsillitis" synonym matches sore-throat'
  );
  assert(
    matchPathways('sounds like otitis media in the left ear').some((p) => p.id === 'earache'),
    '"otitis media" synonym matches earache'
  );
  assert(
    matchPathways('recurrent cystitis, stinging when passing urine').some((p) => p.id === 'urinary'),
    '"cystitis" / "stinging when passing urine" synonyms match urinary'
  );
  assert(
    matchPathways('query shingles on the trunk').some((p) => p.id === 'rash'),
    '"shingles" synonym matches rash'
  );
  assert(
    matchPathways('SORE THROAT for a week').some((p) => p.id === 'sore-throat'),
    'matching is case-insensitive'
  );
}

// ── matchPathways: whole-word-ish boundary (no false substring hits) ─────────────────────────
console.log('\n--- matchPathways: word-boundary guards against false substring hits ---');
{
  assert(
    !matchPathways('problem paying the utility bill, nothing medical').some((p) => p.id === 'urinary'),
    '"utility" does not falsely match the "uti" urinary synonym'
  );
  assert(
    !matchPathways('generally feeling under the weather, no other detail').some((p) => p.id === 'general'),
    '"generally" does not falsely match the "general" catch-all pathway'
  );
}

// ── matchPathways: multiple pathways in one text ──────────────────────────────────────────────
console.log('\n--- matchPathways: multiple matches from one text ---');
{
  const hits = matchPathways('Sore throat and earache both started yesterday, plus a bit of a headache.');
  const ids = hits.map((p) => p.id);
  assert(ids.includes('sore-throat'), 'combined text matches sore-throat');
  assert(ids.includes('earache'), 'combined text matches earache');
  assert(ids.includes('headache'), 'combined text matches headache');
  assert(hits.length >= 3, 'combined text returns multiple distinct pathway matches');
}

// ── matchPathways: optional pathways override (for future integration / isolation) ───────────
console.log('\n--- matchPathways: optional pathways override ---');
{
  const custom = [{ id: 'sore-throat', title: 'Sore throat', redFlags: [], questions: [] }];
  assert(
    matchPathways('sore throat', custom).length === 1,
    'an explicit pathways array overrides the default shipped set'
  );
  assert(
    matchPathways('sore throat', []).length === 0,
    'an explicit empty pathways array yields no matches even for otherwise-matching text'
  );
}

// ── pharmacyFirstEligibility: eligible ────────────────────────────────────────────────────────
console.log('\n--- pharmacyFirstEligibility: eligible ---');
{
  const soreThroat = byId('sore-throat'); // ageMin 5
  const r = pharmacyFirstEligibility(soreThroat, 10);
  assert(r.eligible === true, 'age 10 vs sore-throat ageMin 5 → eligible');
  assert(typeof r.reason === 'string' && r.reason.length > 0, 'eligible result carries a non-empty reason');
  assert(
    r.ageNote === soreThroat.pharmacyFirst.note,
    'eligible result carries the pathway pharmacyFirst.note as ageNote'
  );
}
{
  // Boundary: ageYears === ageMin is eligible (inclusive lower bound).
  const soreThroat = byId('sore-throat');
  const r = pharmacyFirstEligibility(soreThroat, 5);
  assert(r.eligible === true, 'age exactly at ageMin (5) → eligible (inclusive)');
}
{
  // earache has both ageMin (1) and ageMax (17) — mid-band is eligible.
  const earache = byId('earache');
  const r = pharmacyFirstEligibility(earache, 8);
  assert(r.eligible === true, 'age 8 within earache 1–17 band → eligible');
}

// ── pharmacyFirstEligibility: under-age ───────────────────────────────────────────────────────
console.log('\n--- pharmacyFirstEligibility: under-age ---');
{
  const soreThroat = byId('sore-throat'); // ageMin 5
  const r = pharmacyFirstEligibility(soreThroat, 3);
  assert(r.eligible === false, 'age 3 vs sore-throat ageMin 5 → not eligible');
  assert(
    r.reason.toLowerCase().includes('minimum age') || r.reason.toLowerCase().includes('below'),
    'under-age reason explains the age shortfall'
  );
  assert(r.ageNote === soreThroat.pharmacyFirst.note, 'under-age result still carries the pathway ageNote');
}
{
  // earache has an ageMax too — above-band is also not eligible.
  const earache = byId('earache'); // ageMin 1, ageMax 17
  const r = pharmacyFirstEligibility(earache, 45);
  assert(r.eligible === false, 'age 45 vs earache ageMax 17 → not eligible (above band)');
  assert(
    r.reason.toLowerCase().includes('maximum age') || r.reason.toLowerCase().includes('above'),
    'above-band reason explains the age ceiling'
  );
}

// ── pharmacyFirstEligibility: age unknown — FAIL CLOSED ──────────────────────────────────────
console.log('\n--- pharmacyFirstEligibility: age unknown (fail-closed) ---');
{
  const soreThroat = byId('sore-throat');
  const r = pharmacyFirstEligibility(soreThroat, undefined);
  assert(r.eligible === false, 'age undefined vs an age-gated pathway → NOT eligible (fail closed)');
  assert(
    r.reason.toLowerCase().includes('age unknown'),
    'age-unknown reason explicitly says age is unknown, not just "not eligible"'
  );
  assert(r.ageNote === soreThroat.pharmacyFirst.note, 'age-unknown result still surfaces the pathway ageNote');
}
{
  const earache = byId('earache');
  assert(pharmacyFirstEligibility(earache, null).eligible === false, 'age null → fail closed');
  assert(
    pharmacyFirstEligibility(earache, NaN).eligible === false,
    'age NaN → fail closed (not treated as a real age)'
  );
  assert(pharmacyFirstEligibility(earache, 'ten').eligible === false, 'non-numeric age → fail closed');
}

// ── pharmacyFirstEligibility: no pharmacyFirst block on the pathway ──────────────────────────
console.log('\n--- pharmacyFirstEligibility: pathway has no pharmacyFirst block ---');
{
  const backpain = byId('backpain'); // no pharmacyFirst in the shipped file
  assert(backpain.pharmacyFirst === undefined, 'fixture check: backpain genuinely has no pharmacyFirst block');
  const r = pharmacyFirstEligibility(backpain, 40);
  assert(r.eligible === false, 'pathway with no pharmacyFirst block → never eligible, regardless of age');
  assert(r.ageNote === null, 'no pharmacyFirst block → ageNote is null');
  assert(r.reason.toLowerCase().includes('no pharmacy first'), 'reason explains there is no Pharmacy First pathway');
}
{
  // Defensive: a null/undefined pathway must not throw.
  assert(pharmacyFirstEligibility(null, 30).eligible === false, 'null pathway → not eligible, no throw');
  assert(pharmacyFirstEligibility(undefined, 30).eligible === false, 'undefined pathway → not eligible, no throw');
}

// ── redFlagGaps: gap vs mentioned ─────────────────────────────────────────────────────────────
console.log('\n--- redFlagGaps: gap vs mentioned ---');
{
  const soreThroat = byId('sore-throat');
  const { gaps, flaggedInText } = redFlagGaps(soreThroat, 'Patient has a sore throat and is drooling, cannot swallow.');
  const gapIds = gaps.map((g) => g.id);
  const flaggedIds = flaggedInText.map((g) => g.id);
  assert(flaggedIds.includes('rf-drooling'), 'drooling is mentioned in text → surfaced in flaggedInText, not a gap');
  assert(!gapIds.includes('rf-drooling'), 'a mentioned red flag is excluded from gaps');
  assert(gapIds.includes('rf-breathing'), 'breathing difficulty was NOT mentioned → remains a gap');
  assert(gapIds.includes('rf-rash'), 'rash was NOT mentioned → remains a gap');
  assert(
    gapIds.length + flaggedIds.length === soreThroat.redFlags.length,
    'every red flag is accounted for exactly once between gaps and flaggedInText-or-silently-covered'
  );
}

// ── redFlagGaps: conservative over-inclusion when unsure ─────────────────────────────────────
console.log('\n--- redFlagGaps: over-include when unsure ---');
{
  const soreThroat = byId('sore-throat');
  const { gaps, flaggedInText } = redFlagGaps(soreThroat, 'Patient just says their throat hurts.');
  assert(
    gaps.length === soreThroat.redFlags.length,
    'vague text with no red-flag topics mentioned → every red flag is a gap'
  );
  assert(flaggedInText.length === 0, 'vague text → nothing surfaced as already-flagged');
}
{
  // Empty / missing request text is the maximally-unsure case — still all gaps, never a throw.
  const soreThroat = byId('sore-throat');
  const { gaps } = redFlagGaps(soreThroat, '');
  assert(
    gaps.length === soreThroat.redFlags.length,
    'empty request text → every red flag is a gap (maximally conservative)'
  );
  const gaps2 = redFlagGaps(soreThroat, undefined).gaps;
  assert(gaps2.length === soreThroat.redFlags.length, 'undefined request text → every red flag is a gap, no throw');
}

// ── redFlagGaps: flaggedInText escalation surfacing ───────────────────────────────────────────
console.log('\n--- redFlagGaps: flaggedInText escalation surfacing ---');
{
  const general = byId('general');
  const { flaggedInText, gaps } = redFlagGaps(
    general,
    'Caller is having severe difficulty breathing right now and chest pain.'
  );
  const flaggedIds = flaggedInText.map((g) => g.id);
  assert(flaggedIds.includes('rf-breathing'), 'volunteered breathing difficulty is surfaced in flaggedInText');
  assert(flaggedIds.includes('rf-chestpain'), 'volunteered chest pain is surfaced in flaggedInText');
  assert(
    flaggedInText.every((g) => g.escalate === '999' || g.escalate === 'duty'),
    'every flaggedInText entry carries a 999/duty escalate level'
  );
  assert(
    flaggedInText.find((g) => g.id === 'rf-breathing').escalate === '999',
    'the volunteered breathing red flag keeps its correct escalate level (999)'
  );
  assert(!gaps.map((g) => g.id).includes('rf-breathing'), 'a flaggedInText entry is never also listed as a gap');
}

// ── redFlagGaps: defensive / edge inputs ──────────────────────────────────────────────────────
console.log('\n--- redFlagGaps: defensive inputs ---');
{
  const r1 = redFlagGaps(null, 'some text');
  assert(Array.isArray(r1.gaps) && r1.gaps.length === 0, 'null pathway → empty gaps, no throw');
  assert(
    Array.isArray(r1.flaggedInText) && r1.flaggedInText.length === 0,
    'null pathway → empty flaggedInText, no throw'
  );

  const noFlagsPathway = { id: 'x', title: 'X', redFlags: [] };
  const r2 = redFlagGaps(noFlagsPathway, 'anything');
  assert(r2.gaps.length === 0 && r2.flaggedInText.length === 0, 'pathway with no redFlags → both lists empty');
}

// ── buildAskBackText: shape ───────────────────────────────────────────────────────────────────
console.log('\n--- buildAskBackText: shape ---');
{
  const soreThroat = byId('sore-throat');
  const { gaps } = redFlagGaps(soreThroat, 'Sore throat for two days.');
  const text = buildAskBackText(soreThroat, gaps, CLOSING_QUESTIONS);
  assert(typeof text === 'string', 'buildAskBackText returns a string');
  assert(text.includes(soreThroat.title), 'ask-back text includes the pathway title');
  assert(
    text.toLowerCase().includes('review') || text.toLowerCase().includes('prepare'),
    'ask-back text signals it is a prepared/review draft, not an auto-sent message'
  );
  for (const g of gaps) {
    assert(text.includes(g.ask), `ask-back text includes the gap question text for "${g.id}"`);
  }
  // Closing questions included.
  assert(
    CLOSING_QUESTIONS.some((q) => text.includes(q.ask)),
    'ask-back text includes at least one closing question'
  );
  // Reasonably short — GP-review-ready, not a wall of text.
  assert(text.length < 4000, 'ask-back text stays reasonably short (GP-review-ready)');
  assert(text.endsWith('\n'), 'ask-back text ends with a trailing newline');
}
{
  // No gaps at all → still returns a sensible, non-empty string (not "undefined" / crash).
  const soreThroat = byId('sore-throat');
  const text = buildAskBackText(soreThroat, [], CLOSING_QUESTIONS);
  assert(typeof text === 'string' && text.length > 0, 'buildAskBackText with zero gaps still returns readable text');
  assert(!text.includes('undefined'), 'zero-gap ask-back text never leaks the literal string "undefined"');
}
{
  // No closingQuestions supplied → still works.
  const soreThroat = byId('sore-throat');
  const { gaps } = redFlagGaps(soreThroat, 'Sore throat.');
  const text = buildAskBackText(soreThroat, gaps, undefined);
  assert(typeof text === 'string' && text.length > 0, 'buildAskBackText without closingQuestions still returns text');
}
{
  // Defensive: null pathway must not throw.
  const text = buildAskBackText(null, [], []);
  assert(typeof text === 'string', 'buildAskBackText with a null pathway still returns a string, no throw');
}

// ── Hyphen normalisation (CSO review 2026-07-28) ──────────────────────────────
// The terms lists carry SPACED forms ('self harm', 'post coital bleeding',
// 'shoulder tip pain'). Before this review, normalise() stripped apostrophes but
// not hyphens, and `\b` anchoring meant the STANDARD written spellings
// ("self-harm", "post-coital", "shoulder-tip") matched nothing at all — the
// silent failure class this engine's header warns about, live on the three new
// pathways. Fixed in normalise(); pinned here so it cannot regress.
console.log('\n--- hyphen normalisation ---');
{
  const hyphenated = [
    ['patient rang about self-harm last night', 'mental-health'],
    ['she reports post-coital bleeding', 'gyn-female'],
    ['worsening low-mood for weeks', 'mental-health'],
  ];
  for (const [text, wantId] of hyphenated) {
    const ids = matchPathways(text, PATHWAYS).map((p) => p.id);
    assert(ids.includes(wantId), `hyphenated wording "${text}" still offers ${wantId}`);
  }
  // The spaced spelling must keep working too — this is an addition, not a swap.
  assert(
    matchPathways('patient rang about self harm last night', PATHWAYS)
      .map((p) => p.id)
      .includes('mental-health'),
    'the spaced spelling "self harm" still offers mental-health'
  );
  // And a hyphenated red-flag topic is recognised as ALREADY covered rather than
  // being re-asked as a gap.
  {
    const gyn = byId('gyn-female');
    const { gaps } = redFlagGaps(gyn, 'Possible pregnancy, describes shoulder-tip pain.');
    assert(
      !gaps.some((g) => g.id === 'rf-ectopic-shoulder'),
      'a hyphenated topic word ("shoulder-tip") marks its red flag as covered, not as an un-asked gap'
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('\nFAIL — fix the above before shipping.');
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
