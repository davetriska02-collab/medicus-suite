// Medicus Suite — Document Coder letter-extraction engine tests
// Run with: node test-letter-extract.js
//
// Guards engine/letter-extract.js. The fixtures below are the panel's
// war-story register (docs/appraisal/PANEL-document-coder-2026-08-01.md)
// rendered as synthetic letters — every one of them is an incident that
// actually happens in GP document workflows, and each MUST keep the
// documented behaviour. All patient details are invented; no NHS numbers
// appear anywhere in this file (deliberately — the patient-data CI guard).
//
// Cardinal safety properties under test:
//   1. Only status==='active' candidates are offered; ruled-out, historical,
//      resolved, family-history, suspected and unparseable lines are NEVER
//      offered (fail-closed classification).
//   2. Unreadable input is 'could-not-read', never an empty "assessed".
//   3. Unanchored prose never produces diagnosis candidates — but action
//      flags DO fire there (whole-text, escalate-only).
//   4. Coverage always accounts for unassessed lines.
//   5. No output field or source string can express "fully coded"/"all clear".

'use strict';

const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, 'engine', 'letter-extract.js'));

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
function byTerm(res, frag) {
  return res.candidates.find((c) => c.term.toLowerCase().includes(frag.toLowerCase()));
}

// ── Fixture 1: the canonical nine-diagnosis discharge summary ──────────────
// New AF mid-list must be offered; ?PE-excluded, previous-MI, resolved-AKI,
// known-asthma must all be mentioned-not-offered; the "GP to arrange" line
// buried in prose BELOW the list must still raise a gp-action flag.
const NINE_DX = `
Discharge summary

Diagnoses:
1. Community acquired pneumonia
2. AKI on CKD stage 3a - resolved
3. ?Pulmonary embolism - excluded on CTPA
4. Previous myocardial infarction (2019)
5. New atrial fibrillation, rate controlled on ward
6. Known asthma, currently no wheeze
7. Hyponatraemia
8. Type 2 diabetes mellitus
9. Falls

Medications on discharge:
1. Apixaban 5 mg twice daily - started
2. Aspirin 75 mg once daily - stopped
3. Ramipril 2.5 mg once daily

We noted new atrial fibrillation on the post-operative ECG. For GP to arrange
anticoagulation review and repeat U&E in 2 weeks.

Yours sincerely
`;

console.log('--- Fixture 1: nine-diagnosis discharge summary ---');
{
  const r = L.assessLetterText(NINE_DX);
  check(r.state === 'assessed', `state is assessed (got ${r.state})`);
  check(
    r.sections.some((s) => s.kind === 'diagnosis'),
    'diagnosis section anchored'
  );
  check(
    r.sections.some((s) => s.kind === 'meds'),
    'meds section anchored'
  );

  const af = byTerm(r, 'atrial fibrillation');
  check(!!af && af.status === 'active' && af.offered === true, 'NEW AF (item 5, mid-list) is offered as active');
  check(!!af && /new atrial/i.test(af.sourceSentence), 'AF candidate carries its source sentence');

  const pe = byTerm(r, 'pulmonary embolism');
  check(
    !!pe && pe.status !== 'active' && pe.offered === false,
    `?PE-excluded is NOT offered (status ${pe && pe.status})`
  );
  const mi = byTerm(r, 'myocardial infarction');
  check(
    !!mi && mi.status === 'historical' && mi.offered === false,
    'previous MI (2019) classified historical, not offered'
  );
  const aki = byTerm(r, 'aki');
  check(!!aki && aki.status === 'resolved' && aki.offered === false, 'resolved AKI not offered');
  const asthma = byTerm(r, 'asthma');
  check(!!asthma && asthma.offered === false, `known asthma not offered (status ${asthma && asthma.status})`);
  const pneumonia = byTerm(r, 'pneumonia');
  check(!!pneumonia && pneumonia.offered === true, 'community acquired pneumonia offered');
  const dm = byTerm(r, 'diabetes');
  check(!!dm && dm.offered === true, 'T2DM offered (delta engine decides already-coded, not this module)');

  const apix = r.meds.find((m) => m.name && /apixaban/i.test(m.name));
  check(!!apix && apix.change === 'started', 'apixaban parsed as started');
  const asp = r.meds.find((m) => m.name && /aspirin/i.test(m.name));
  check(!!asp && asp.change === 'stopped', 'aspirin parsed as stopped');
  const rami = r.meds.find((m) => m.name && /ramipril/i.test(m.name));
  check(!!rami && rami.change === 'listed', 'ramipril (no change word) is listed, not guessed');

  const gpAction = r.actions.find((a) => a.kind === 'gp-action');
  check(!!gpAction && /for gp to/i.test(gpAction.phrase), 'GP-action flag fires on prose BELOW the anchored sections');
  const fu = r.actions.find((a) => a.kind === 'follow-up');
  check(!!fu, 'repeat-in-2-weeks raises a follow-up flag');
  check(r.coverage.unanchoredLines > 0, 'coverage reports the unanchored prose lines');
}

// ── Fixture 2: laterality + certainty stay bound to their sentence ─────────
// Right breast ?malignant vs left breast benign: the suspected side is
// suspected (not offered), and no candidate mixes the sides up.
const BREAST = `
Impression:
1. Right breast lump - ?malignant, awaiting histology
2. Left breast - benign cyst, no action required
`;

console.log('--- Fixture 2: laterality/certainty binding ---');
{
  const r = L.assessLetterText(BREAST);
  const right = r.candidates.find((c) => c.laterality === 'right');
  const left = r.candidates.find((c) => c.laterality === 'left');
  check(
    !!right && right.status === 'suspected' && right.offered === false,
    'right breast ?malignant is suspected, NOT offered'
  );
  check(!right || /right/i.test(right.sourceSentence), 'right-sided candidate cites the right-sided sentence');
  // The left "benign cyst" line IS a true codeable diagnosis — offering it is
  // correct (the original test wrongly blessed over-suppression via a
  // mid-sentence "no"). The actual safety property: no OFFERED candidate on
  // this letter may carry the malignancy language, on either side.
  check(
    !left || !/malignan/i.test(left.term + ' ' + left.sourceSentence) || left.offered === false,
    'no left-sided candidate is offered with malignancy language'
  );
  check(
    r.candidates.every((c) => !c.offered || !/malignan/i.test(c.term)),
    'no offered candidate on this letter mentions malignancy'
  );
}

// ── Fixture 3: family history is never the patient's diagnosis ─────────────
const FAMILY = `
Problems:
1. Family history of breast cancer (mother, age 52)
2. Hypertension
`;

console.log('--- Fixture 3: experiencer (family history) ---');
{
  const r = L.assessLetterText(FAMILY);
  const ca = byTerm(r, 'breast cancer');
  check(!!ca && ca.status === 'family' && ca.offered === false, 'FH breast cancer classified family, not offered');
  const htn = byTerm(r, 'hypertension');
  check(!!htn && htn.offered === true, 'the patient’s own hypertension is still offered');
}

// ── Fixture 4: pseudo-negation must not negate ──────────────────────────────
const PSEUDO = `
Impression:
1. Malignancy cannot be excluded, further imaging arranged
`;

console.log('--- Fixture 4: pseudo-negation ---');
{
  const r = L.assessLetterText(PSEUDO);
  const c = r.candidates[0];
  check(!!c && c.status !== 'negated', `"cannot be excluded" is NOT treated as negation (got ${c && c.status})`);
  check(!!c && c.offered === false, 'and it is still not offered (fail-closed: suspected/unclassifiable)');
}

// ── Fixture 5: scanned-image debris → could-not-read, loudly ────────────────
console.log('--- Fixture 5: unreadable input ---');
{
  check(L.assessLetterText('').state === 'could-not-read', 'empty text is could-not-read');
  check(L.assessLetterText(null).state === 'could-not-read', 'null is could-not-read');
  check(
    L.assessLetterText('%PDF-1.7    stream 9 0 obj 44 0000017').state === 'could-not-read',
    'binary/PDF debris is could-not-read'
  );
  const garbled = 'Dxagnos�s: p�e�m�n�a '.repeat(40);
  check(
    L.assessLetterText(garbled).state === 'could-not-read',
    'high replacement-char ratio is could-not-read (garbled OCR)'
  );
}

// ── Fixture 6: prose-only letter → nothing-anchored, with action flag ───────
// The 2WW outcome buried in paragraph four (reception lead's war story):
// no anchored sections, so NO candidates — but the 2WW flag still fires,
// and the state says the letter was not assessed.
const PROSE_2WW = `
Dear Doctor

Thank you for referring this pleasant patient who attended the breast clinic
today. We had a long discussion about her symptoms and family circumstances.

Examination and imaging were reassuring on this occasion.

I am pleased to confirm that she has been discharged from the two week wait
pathway with no evidence of malignancy. Please arrange routine mammography
recall as per protocol.

Kind regards
`;

console.log('--- Fixture 6: prose letter, 2WW outcome in paragraph four ---');
{
  const r = L.assessLetterText(PROSE_2WW);
  check(r.state === 'nothing-anchored', `prose-only letter is nothing-anchored (got ${r.state})`);
  check(r.candidates.length === 0, 'no diagnosis candidates are mined from prose');
  check(
    r.actions.some((a) => a.kind === '2ww-mention'),
    '2WW mention flag fires from prose'
  );
  check(
    r.actions.some((a) => a.kind === 'gp-action'),
    '"Please arrange" raises a gp-action flag from prose'
  );
  check(r.coverage.unanchoredLines === r.coverage.totalContentLines, 'coverage says every line was unassessed');
}

// ── Fixture 7: inline "Diagnosis: X" single-line form ───────────────────────
console.log('--- Fixture 7: inline diagnosis line ---');
{
  const r = L.assessLetterText('Diagnosis: Polymyalgia rheumatica\n\nPlan:\nReducing steroid course.');
  check(r.state === 'assessed', 'inline Diagnosis: line anchors');
  const pmr = byTerm(r, 'polymyalgia');
  check(!!pmr && pmr.offered === true, 'inline diagnosis extracted and offered');
}

// ── Fixture 8: unparseable med line is surfaced, never guessed ──────────────
console.log('--- Fixture 8: unparseable medication line ---');
{
  const r = L.assessLetterText('Medications on discharge:\n1. 5 mg twice daily as per ward round');
  const m = r.meds[0];
  check(!!m && m.change === 'unparsed' && m.name === null, 'nameless med line returns unparsed with name null');
}

// ── Fixture 9: legacy prefixes and "new" are stripped from the term ─────────
console.log('--- Fixture 9: term cleanup ---');
{
  check(L.cleanTerm('[X]Heroin addiction') === 'Heroin addiction', 'legacy [X] prefix stripped');
  check(
    /^atrial fibrillation/i.test(L.cleanTerm('New atrial fibrillation, rate controlled')),
    '"New" prefix stripped, clause trimmed'
  );
}

// ── Red-team battery (2026-08-01): multi-specialty adversarial scenarios ───
// Every scenario below was run against the engine BEFORE the hardening pass
// and the failures are documented in the engine's comments (red-team #1–#10).
// PAD clears the could-not-read minimum-text floor, as any real letter does.
const PAD = 'Anytown District General Hospital\nDepartment of Medicine\n\n';

console.log('--- Red-team: wrapped list item (PDF line wrap) ---');
{
  // THE dangerous one: per-line extraction fabricated an OFFERED candidate
  // "controlled on ward" from the continuation line.
  const r = L.assessLetterText(
    PAD + 'Diagnoses:\n1. Community acquired pneumonia\n2. New atrial fibrillation, rate\ncontrolled on ward'
  );
  check(r.candidates.length === 2, `wrapped item merges — exactly 2 candidates (got ${r.candidates.length})`);
  const af = byTerm(r, 'atrial fibrillation');
  check(
    !!af && af.offered === true && af.term.toLowerCase() === 'atrial fibrillation',
    'merged AF candidate has the clean searchable term'
  );
  check(!byTerm(r, 'controlled on ward'), 'no fabricated candidate from the continuation line');
}

console.log('--- Red-team: prose resumes after a numbered list ---');
{
  // Prose after the list (no intervening heading) must neither merge into the
  // last item nor become candidates — and the action scan still reads it.
  const r = L.assessLetterText(
    PAD + 'Diagnoses:\n1. Cellulitis of left leg\nWe noted improving inflammatory markers. Please repeat FBC in 1 week.'
  );
  check(r.candidates.length === 1, 'prose line after list is not a candidate and not merged');
  check(
    r.actions.some((a) => a.kind === 'gp-action'),
    '"Please repeat" in that prose still raises a gp-action flag'
  );
}

console.log('--- Red-team: diabetes annual review (mid-sentence "not") ---');
{
  const r = L.assessLetterText(PAD + 'Problems:\n1. Type 2 diabetes mellitus, not well controlled');
  const dm = byTerm(r, 'diabetes');
  check(!!dm && dm.status === 'active' && dm.offered === true, '"not well controlled" does not negate an active T2DM');
}

console.log('--- Red-team: falls with negated complication ---');
{
  const r = L.assessLetterText(PAD + 'Diagnoses:\n1. Falls - no injury sustained');
  const falls = byTerm(r, 'falls');
  check(!!falls && falls.offered === true, 'mid-sentence "no injury" does not suppress the falls diagnosis');
}

console.log('--- Red-team: leading negation still negates ---');
{
  const r = L.assessLetterText(PAD + 'Impression:\n1. No evidence of recurrence\n2. Not infected');
  check(
    r.candidates.every((c) => c.offered === false),
    'clause-leading "No evidence of"/"Not" still negate'
  );
}

console.log('--- Red-team: geriatrics "78 year old" is not historical ---');
{
  const r = L.assessLetterText(PAD + 'Problems:\n1. Recurrent falls in this 78 year old patient');
  const c = r.candidates[0];
  check(!!c && c.status === 'active', `"year old" does not trigger historical (got ${c && c.status})`);
}

console.log('--- Red-team: paediatrics — "mother reports" is not family history ---');
{
  const r = L.assessLetterText(PAD + 'Impression:\n1. Acute otitis media - mother reports 3 days of fever');
  const om = byTerm(r, 'otitis');
  check(
    !!om && om.status === 'active' && om.offered === true,
    'the child’s otitis media is offered despite "mother" in the sentence'
  );
}

console.log('--- Red-team: genetics — attribution verbs DO make it family ---');
{
  const r = L.assessLetterText(
    PAD + 'Problems:\n1. Mother diagnosed with ovarian cancer at 60\n2. Family history of breast cancer'
  );
  check(
    r.candidates.every((c) => c.status === 'family' && c.offered === false),
    'both relative-attributed and FH lines are family, never offered'
  );
}

console.log('--- Red-team: PMH section is visible but never offered ---');
{
  const r = L.assessLetterText(
    PAD + 'Past medical history:\n1. Type 2 diabetes\n2. Hypertension\n\nDiagnoses:\n1. Acute cholecystitis'
  );
  const pmh = r.candidates.filter((c) => c.section === 'pmh');
  check(pmh.length === 2, 'PMH items are extracted (visible to the delta), not silently skipped');
  check(
    pmh.every((c) => c.status === 'historical' && c.offered === false),
    'every PMH item is historical, never offered'
  );
  const chole = byTerm(r, 'cholecystitis');
  check(!!chole && chole.offered === true, 'the genuinely new diagnosis after PMH is still offered');
}

console.log('--- Red-team: cardiology acronyms survive ---');
{
  const r = L.assessLetterText(PAD + 'Diagnoses:\n1. NSTEMI\n2. AF\n3. HF with preserved EF');
  check(r.candidates.length === 3, 'two-letter acronyms (AF) are candidates, not silent drops');
  check(!!byTerm(r, 'AF'), 'AF candidate exists');
}

console.log('--- Red-team: inline "Primary diagnosis:" ---');
{
  const r = L.assessLetterText(PAD + 'Primary diagnosis: Acute appendicitis');
  const c = byTerm(r, 'appendicitis');
  check(r.state === 'assessed' && !!c && c.offered === true, 'qualified inline diagnosis heading anchors');
}

console.log('--- Red-team: med titration syntax ---');
{
  const r = L.assessLetterText(PAD + 'Medications on discharge:\n1. Increased ramipril to 5 mg once daily');
  const m = r.meds[0];
  check(
    !!m && m.name === 'ramipril' && m.change === 'changed',
    `"Increased ramipril to" yields name "ramipril" (got "${m && m.name}")`
  );
}

console.log('--- Red-team: psychiatry — negated ideation does not leak onto the head ---');
{
  const r = L.assessLetterText(PAD + 'Impression:\n1. Moderate depressive episode. No suicidal ideation.');
  const dep = byTerm(r, 'depressive');
  check(!!dep && dep.offered === true, 'the depressive episode stays offered');
  check(!byTerm(r, 'suicidal'), 'the negated second sentence spawns no candidate');
}

console.log('--- Red-team: Word "o" bullets ---');
{
  const r = L.assessLetterText(PAD + 'Diagnoses:\no Gout, first presentation\no Stage 2 hypertension');
  check(
    r.candidates.length === 2 && r.candidates.every((c) => !/^o\s/i.test(c.term)),
    'Word bullets are stripped from terms'
  );
  check(!!byTerm(r, 'gout') && byTerm(r, 'gout').term === 'Gout', 'comma qualifier trimmed from the searchable term');
}

console.log('--- Red-team: unmarked Impression followed by prose paragraph ---');
{
  const r = L.assessLetterText(
    PAD + 'Impression:\nLikely viral illness\n\nWe will review in clinic if symptoms persist beyond two weeks.'
  );
  check(r.candidates.length === 1, 'the prose paragraph after the blank line is not fabricated into candidates');
  check(r.candidates[0].status === 'suspected', '"Likely viral illness" is suspected, not offered');
}

// ── Red-team battery 2 (2026-08-01): the action-flag scanner ────────────────
// Action flags are escalate-only, so MISSES are the costly failure — but the
// pre-hardening scanner missed the most common UK letter phrasings AND fired
// on "No action required". 21 probes; every one failed or passed exactly as
// documented in the engine's ACTION_DEFS comment before/after the fix.
console.log('--- Red-team: action-flag phrasings (misses) ---');
{
  const mustFire = [
    ['We would be grateful if you could arrange a medication review.', 'gp-action'],
    ['I would be grateful if you would monitor renal function.', 'gp-action'],
    ['Please could you arrange repeat thyroid function tests.', 'gp-action'],
    ['Kindly organise repeat bloods in primary care.', 'gp-action'],
    ['The practice is asked to arrange annual review.', 'gp-action'],
    ['We have asked the practice to repeat the ECG.', 'gp-action'],
    ['Suggest GP checks blood pressure at next attendance.', 'gp-action'],
    ['This requires GP follow-up.', 'gp-action'],
    ['FAO GP: medication change needs monitoring.', 'gp-action'],
    ['Repeat U&E in 2/52.', 'follow-up'],
    ['Review bloods in 6 weeks.', 'follow-up'],
    ['F/U 6/52 with repeat imaging.', 'follow-up'],
    ['Bloods in 3 months to check HbA1c.', 'follow-up'],
    ['Discharged from the two week rule pathway.', '2ww-mention'],
    ['Remains on the 62-day pathway pending MDT.', '2ww-mention'],
    ['Referred on the urgent suspected cancer (USC) pathway.', '2ww-mention'],
  ];
  for (const [line, kind] of mustFire) {
    const kinds = L.scanActions([line]).map((f) => f.kind);
    check(kinds.includes(kind), `fires ${kind}: "${line}"`);
  }
}

console.log('--- Red-team: action-flag false positives ---');
{
  const mustNotFire = [
    'No action required.',
    'No further action required from the practice.',
    'Please refer to the enclosed patient information leaflet.',
    'Please do not hesitate to contact us.',
  ];
  for (const line of mustNotFire) {
    check(L.scanActions([line]).length === 0, `silent on: "${line}"`);
  }
}

console.log('--- Red-team: multi-kind line keeps the 2WW flag visible ---');
{
  const kinds = L.scanActions(['Discharged from the two week wait pathway; please arrange routine recall.']).map(
    (f) => f.kind
  );
  check(
    kinds.includes('2ww-mention') && kinds.includes('gp-action'),
    'a line carrying both a 2WW mention and a GP action raises BOTH flags'
  );
}

// ── Property: nothing in the engine can claim completion ────────────────────
console.log('--- Source guard: no completion language ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'engine', 'letter-extract.js'), 'utf8');
  const banned = /fully coded|all clear|letter reviewed|nothing to code|complete[d]? coding/i;
  // strip comments before grepping — the doctrine text mentions the banned
  // phrases in order to ban them.
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check(!banned.test(code), 'no completion/all-clear language in engine code or its string outputs');
}

// ── Property: offered ⇒ status is active, on every fixture ──────────────────
console.log('--- Property: offered implies active ---');
{
  const all = [NINE_DX, BREAST, FAMILY, PSEUDO, PROSE_2WW].flatMap((t) => L.assessLetterText(t).candidates);
  check(all.length > 0, 'candidates were produced across fixtures');
  check(
    all.every((c) => !c.offered || c.status === 'active'),
    'every offered candidate has status active'
  );
  check(
    all.every((c) => typeof c.sourceSentence === 'string' && c.sourceSentence.length > 0),
    'every candidate carries a non-empty source sentence (provenance)'
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
process.exit(failed ? 1 : 0);
