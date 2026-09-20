// Medicus Suite — Lab Result Catalogue: golden corpus (real report structure) against the shipped seed.
// Run with: node test-lab-catalogue-corpus.js
//
// fixtures/lab-catalogue/*.json are STRUCTURE-ONLY extracts of eight real investigation-report tasks from one lab
// (RJ700 / General Pathology, Sept 2026): headings, result names, SNOMED codes, units, result types and the request
// names on the card. Every value is a placeholder; there are no dates, comments, reference ranges or patient/staff
// fields (asserted below). rules/lab-catalogue.json is the Phase-A seed.
//
// These pin the behaviours the rework exists for — including the reported alp/calprotectin false match, urine ACR
// wrongly selecting serum profiles, the TSH/eGFR lab messages, the previously "not recognised" requests — and the
// deliberate "a partial group clears its request" semantics.

'use strict';
const fs = require('fs');
const path = require('path');
const LC = require('./shared/lab-catalogue-core.js');

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

const SEED_PATH = path.join(__dirname, 'rules', 'lab-catalogue.json');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'lab-catalogue');
const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

console.log('--- the shipped seed ---');
const validation = LC.validateCatalogue(seed);
check(
  validation.errors.length === 0,
  'rules/lab-catalogue.json validates with no errors (' + validation.errors.slice(0, 3).join('; ') + ')'
);
check(
  validation.warnings.every((w) => /short lab-neutral alias/.test(w)),
  'the only warnings are the expected "short alias" hints (standard abbreviations, whole-token only)'
);
const idx = LC.buildIndex(seed);
check(
  seed.results.length >= 45 && seed.investigations.length >= 26,
  `seed size is plausible (${seed.results.length} results, ${seed.investigations.length} investigations)`
);
check(
  seed.investigations.every((i) => i.kind === 'imaging' || i.members.some((m) => m.role === 'core')),
  'every non-imaging investigation has a core member'
);

const codedResults = seed.results.filter((r) => r.codes.length);
check(
  codedResults.every((r) => r.codes.every((c) => Array.isArray(c.refsets))),
  'every coded result carries refsets (possibly empty)'
);
check(
  !JSON.stringify(seed).includes('GDPPR2YR_COD'),
  'the COVID-planning cluster GDPPR2YR_COD is not carried (it is not a clinical purpose set)'
);

// HbA1c: a code FAMILY, QOF status derivable from refsets
const hba1c = seed.results.find((r) => r.id === 'hba1c');
const byCode = (c) => hba1c.codes.find((x) => x.conceptId === c);
check(
  hba1c.codes.length === 4 && byCode('999791000000106').role === 'primary',
  'HbA1c has four codes, IFCC 999791000000106 primary'
);
check(
  byCode('999791000000106').refsets.includes('IFCCHBAM_COD') &&
    byCode('1049301000000100').refsets.includes('IFCCHBAM_COD') &&
    byCode('1049321000000109').refsets.includes('IFCCHBAM_COD'),
  'the three IFCC concepts are in IFCCHBAM_COD (QOF Diabetes / Mental health / NDH)'
);
check(
  byCode('1019431000000105').refsets.includes('DCCTHBA1C_COD') &&
    !byCode('1019431000000105').refsets.includes('IFCCHBAM_COD'),
  'the DCCT (%) concept is in DCCTHBA1C_COD and NOT in IFCCHBAM_COD (does not count for QOF)'
);
check(
  byCode('999791000000106').unit === 'mmol/mol' && byCode('1019431000000105').unit === '%',
  'units are per code (mmol/mol vs %)'
);

// ── fixtures ────────────────────────────────────────────────────────────────────
const fixtures = {};
for (const f of fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'))) {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8');
  const fx = JSON.parse(raw);
  fixtures[fx.source.replace('corpus-', '')] = { fx, raw, file: f };
}
console.log('\n--- fixtures are structure-only ---');
check(Object.keys(fixtures).length === 8, 'eight report fixtures (135–142)');
for (const [n, { fx, file }] of Object.entries(fixtures)) {
  const raw = JSON.stringify({ ...fx, _comment: undefined }); // the file's own explanatory _comment is not data
  const dates =
    raw.match(
      /\b(19|20)\d\d[-/]\d\d[-/]\d\d\b|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b/g
    ) || [];
  const titles = raw.match(/\b(Dr|Mrs|Mr|Ms|Miss)\.? [A-Z][a-z]+/g) || [];
  check(
    dates.length === 0 &&
      titles.length === 0 &&
      !/nhsNumber|dateOfBirth|performerComments|referenceRanges|patient/i.test(raw),
    `${file}: no dates, staff titles or patient fields`
  );
}

const run = (n, mutate) => {
  const fx = JSON.parse(JSON.stringify(fixtures[n].fx));
  if (mutate) mutate(fx);
  const rep = LC.fromInvestigationReportPayload({ investigationReport: fx });
  return { fx, resolution: LC.resolveReport(idx, rep) };
};
const cov = (r, id) => r.resolution.coverage[id];
const reqMap = (n) => {
  const out = {};
  for (const q of new Set(fixtures[n].fx.requests)) {
    const m = LC.resolveRequest(idx, q);
    out[q] = m.length ? m[0].investigationId : null;
  }
  return out;
};

console.log('\n--- every real result resolves by CODE ---');
for (const n of Object.keys(fixtures).sort()) {
  const r = run(n);
  check(
    r.resolution.lab === 'rj700-general-pathology',
    `${n}: the lab is identified from performer (RJ700 / General Pathology)`
  );
  check(
    r.resolution.results.length > 0 && r.resolution.results.every((x) => x.confidence === 'coded'),
    `${n}: all ${r.resolution.results.length} results resolve by code (none unresolved, none by text)`
  );
  check(r.resolution.unresolved.length === 0, `${n}: nothing unresolved`);
}

console.log('\n--- 135: bone + LFT + TSH + renal + FT4 + magnesium (ungrouped) ---');
{
  const r = run('135');
  for (const id of ['bone-profile', 'lft', 'tft', 'ue', 'free-t4', 'magnesium'])
    check(cov(r, id) && cov(r, id).confidence === 'confident', `135: ${id} covered (confident)`);
  const alp = r.resolution.results.find((x) => x.resultId === 'alp');
  check(
    alp.attributedTo.length === 1 && alp.attributedTo[0] === 'bone-profile',
    '135: ALP (under "Bone profile") is attributed to the bone profile only'
  );
  check(
    cov(r, 'lft').via === 'heading',
    '135: the LFT group (bilirubin + ALT, NO ALP) still clears LFT — a partial group clears its request'
  );
  const tsh = r.resolution.results.find((x) => x.resultId === 'tsh');
  check(
    tsh.hasValue === false && tsh.labMessage === true && tsh.labMessageKind === 'already-done',
    '135: TSH is a lab MESSAGE ("already performed recently"), not a value'
  );
  check(
    cov(r, 'tft').labMessageOnly === true,
    '135: the TSH request still clears (decided) but is flagged labMessageOnly'
  );
  const egfr = r.resolution.results.find((x) => x.resultId === 'egfr');
  check(
    egfr.labMessage === true && egfr.labMessageKind === 'not-applicable',
    '135: eGFR "not applicable in children" is a lab message'
  );
  check(
    !r.resolution.resolvedResultIds.includes('tsh') && !r.resolution.resolvedResultIds.includes('egfr'),
    '135: lab messages are excluded from resolvedResultIds'
  );
  const g = r.resolution.groups.find((x) => x.heading === 'FREE T4');
  check(
    g.candidates.includes('free-t4') && g.candidates.includes('tft'),
    '135: the FREE T4 group is a candidate for both free-t4 and thyroid function (group <-> request many-to-many)'
  );
  check(cov(r, 'free-t4').via === 'heading', '135: free T4 is covered as its own investigation');
  const q = reqMap('135');
  check(
    q['Bone Profile (Calcium Studies)'] === 'bone-profile' &&
      q['Liver Function'] === 'lft' &&
      q['Thyroid Stimulating Hormone'] === 'tft' &&
      q['Urea and Electrolytes WITH Potassium'] === 'ue',
    '135: the four panel requests resolve'
  );
  check(
    q['Magnesium Blood'] === 'magnesium',
    '135: "Magnesium Blood" is now RECOGNISED (today: "request test not recognised")'
  );
  check(
    q['HFE Gene Testing'] === null,
    '135: "HFE Gene Testing" is not in the seed -> unrecognised, stays outstanding'
  );
  check(
    [
      'Bone Profile (Calcium Studies)',
      'Liver Function',
      'Thyroid Stimulating Hormone',
      'Urea and Electrolytes WITH Potassium',
      'Magnesium Blood',
    ].every((name) => cov(r, q[name])),
    '135: every recognised request on the card is covered by the report'
  );
}

console.log('\n--- 136: U&E WITHOUT potassium + vitamin D (ungrouped, different lab name) ---');
{
  const r = run('136');
  check(cov(r, 'ue') && cov(r, 'ue').via === 'heading', '136: the "U&Es" heading covers U&E');
  check(
    !r.resolution.results.find((x) => x.resultId === 'potassium'),
    '136: no potassium in this report — and U&E still clears (a partial group clears)'
  );
  check(
    cov(r, 'vitamin-d') && cov(r, 'vitamin-d').confidence === 'confident',
    '136: the ungrouped "Serum 25-HO vit D3 level" covers vitamin D'
  );
  const q = reqMap('136');
  check(
    q['Vitamin D (25-hydroxy)'] === 'vitamin-d' && cov(r, q['Vitamin D (25-hydroxy)']),
    '136: the "Vitamin D (25-hydroxy)" request is matched (today: "report does not cover this test")'
  );
  check(
    q['Urea and Electrolytes WITHOUT Potassium'] === 'ue' && cov(r, 'ue'),
    '136: "…WITHOUT Potassium" resolves to U&E and is covered'
  );
}

console.log('\n--- 137: ALP under LFTs (no bone group), lipids, CA125, ungrouped CRP ---');
{
  const r = run('137');
  for (const id of ['ca-125', 'lft', 'tft', 'ue', 'lipids', 'crp'])
    check(cov(r, id) && cov(r, id).confidence === 'confident', `137: ${id} covered`);
  check(
    !cov(r, 'bone-profile'),
    '137: the bone profile is NOT covered — ALP and albumin (shared) under "LFTs" do not make it one'
  );
  const alp = r.resolution.results.find((x) => x.resultId === 'alp');
  check(
    alp.attributedTo.length === 1 && alp.attributedTo[0] === 'lft',
    '137: the same ALP is attributed to LFT here (and to the bone profile in 135)'
  );
  const chol = r.resolution.results.find((x) => x.name === 'Calculated LDL cholesterol lev');
  check(
    chol.resultId === 'ldl-cholesterol-calculated' && chol.confidence === 'coded',
    '137: the truncated "Calculated LDL cholesterol lev" resolves by CODE, not by its truncated text'
  );
  check(
    r.resolution.results.every((x) => !x.outOfScope),
    "137: no result sits outside its heading's candidate set"
  );
  const q = reqMap('137');
  check(
    q['US Abdomen'] === null && q['T.V. Pelvis'] === null,
    '137: imaging requests are not in the seed -> unrecognised, stay outstanding'
  );
}

console.log('\n--- 138: urine ACR must not select serum profiles ---');
{
  const r = run('138');
  check(cov(r, 'urine-acr') && cov(r, 'urine-acr').via === 'heading', '138: urine ACR covered by its heading');
  check(
    !cov(r, 'bone-profile') && !cov(r, 'ue') && !cov(r, 'lft'),
    '138: bone profile / U&E / LFT are NOT covered (today the starter Bone and U&E profiles both fire via "albumin" in microalbumin and "creatinine")'
  );
  const u = r.resolution.results.map((x) => x.resultId);
  check(
    u.includes('urine-creatinine') &&
      u.includes('urine-microalbumin') &&
      u.includes('urine-acr') &&
      !u.includes('creatinine') &&
      !u.includes('albumin'),
    '138: results are the URINE results, never serum creatinine / albumin'
  );
  const q = reqMap('138');
  check(
    q['Urine Albumin:Creatinine Ratio'] === 'urine-acr' && cov(r, 'urine-acr'),
    '138: the "Urine Albumin:Creatinine Ratio" request is now recognised and covered'
  );
  check(
    q['Bone Profile (Calcium Studies)'] === 'bone-profile' && !cov(r, 'bone-profile'),
    '138: the outstanding Bone / LFT / U&E requests correctly stay outstanding'
  );
  check(
    q['Immunoglobulins (includes Electrophoresis)'] === null,
    '138: immunoglobulins is not in the seed -> unrecognised'
  );
}

console.log('\n--- 139/140/142: FIT, FBC, HbA1c ---');
{
  const fit = run('139');
  check(cov(fit, 'fit') && Object.keys(fit.resolution.coverage).length === 1, '139: FIT covered, and nothing else is');
  const q139 = reqMap('139');
  check(q139['Faecal Immunochemical Test (Faeces)'] === 'fit' && cov(fit, 'fit'), '139: the FIT request matches');
  check(
    q139['Full Blood Count'] === 'fbc' &&
      !cov(fit, 'fbc') &&
      q139['C-Reactive Protein Blood'] === 'crp' &&
      !cov(fit, 'crp'),
    '139: unrelated requests on the card stay uncovered'
  );
  check(
    q139['Erythrocyte Sedimentation Rate'] === null && q139['Coeliac Disease Antibodies'] === null,
    '139: ESR / coeliac are not in the seed -> unrecognised'
  );
  const fbc = run('140');
  check(
    cov(fbc, 'fbc') && cov(fbc, 'fbc').via === 'heading' && Object.keys(fbc.resolution.coverage).length === 1,
    '140: FBC covered (15 coded results), and nothing else is'
  );
  check(!cov(fbc, 'hba1c'), '140: "haemoglobin" in an FBC does not cover HbA1c');
  const hb = run('142');
  check(
    cov(hb, 'hba1c') && cov(hb, 'hba1c').confidence === 'confident' && Object.keys(hb.resolution.coverage).length === 1,
    '142: HbA1c covered, nothing else'
  );
  const r = hb.resolution.results[0];
  check(
    r.resultId === 'hba1c' && r.code === '999791000000106' && r.confidence === 'coded',
    '142: the result resolves by the IFCC code'
  );
  const q = reqMap('142');
  check(
    q['HbA1C (Glycated Haemoglobin)'] === 'hba1c' &&
      q['Urine Albumin:Creatinine Ratio'] === 'urine-acr' &&
      q['Lipids Blood'] === 'lipids' &&
      q['Vitamin B12'] === null,
    '142: the request labels on the card resolve (incl. the duplicated stale lines); B12 is no longer a shipped test (each practice defines B12 / folate as it orders them)'
  );
  check(
    cov(hb, q['HbA1C (Glycated Haemoglobin)']) && !cov(hb, 'lft') && !cov(hb, 'urine-acr') && !cov(hb, 'lipids'),
    '142: only the HbA1c request is covered; Liver Function / Urine ACR / Lipids stay outstanding'
  );
}

console.log('\n--- 141: the REPORTED BUG — faecal calprotectin must not look like a bone profile ---');
{
  const r = run('141');
  check(cov(r, 'calprotectin') && cov(r, 'calprotectin').via === 'heading', '141: calprotectin covered');
  check(
    !cov(r, 'bone-profile') && !cov(r, 'lft') && Object.keys(r.resolution.coverage).length === 1,
    '141: NO other investigation is covered (today: the starter Bone profile fires on "c-ALP-rotectin")'
  );
  const noCodes = run('141', (fx) =>
    fx.investigationGroups.forEach((g) => g.results.forEach((x) => (x.resultCode.conceptId = null)))
  );
  check(
    noCodes.resolution.results[0].resultId === 'faecal-calprotectin' &&
      noCodes.resolution.results[0].confidence === 'alias-in-scope',
    '141 (codes removed): still resolves to calprotectin by scoped alias…'
  );
  check(!cov(noCodes, 'bone-profile'), '141 (codes removed): …and still never to a bone profile');
  const q = reqMap('141');
  check(
    q['Faecal Calprotectin'] === 'calprotectin' && q['CA 12-5'] === 'ca-125' && !cov(r, 'ca-125'),
    '141: "CA 12-5" is recognised as CA 125 and correctly NOT covered by a calprotectin report'
  );
}

console.log('\n--- robustness: another lab, and lab-neutral fallbacks ---');
{
  const unknown = run('135', (fx) => (fx.performer.organisationName = 'SOME-OTHER-LAB'));
  check(unknown.resolution.lab === null, 'an unrecognised performer -> no lab definition');
  check(
    unknown.resolution.results.every((x) => x.confidence === 'coded'),
    '…but every result STILL resolves by code'
  );
  for (const id of ['bone-profile', 'lft', 'ue', 'free-t4', 'magnesium'])
    check(cov(unknown, id), `…and ${id} is still covered (lab-neutral heading aliases / signature)`);
  const renal = unknown.resolution.groups.find((g) => g.heading === 'Renal function tests');
  check(
    renal.headingConfidence === 'inferred',
    '"Renal function tests" is unknown to the generic table, so at another lab it is INFERRED from its results — never treated as a confirmed heading'
  );
  const boneMissing = run('137', (fx) => (fx.performer.organisationName = 'SOME-OTHER-LAB'));
  check(
    !cov(boneMissing, 'bone-profile'),
    'even at an unknown lab, ALP/albumin under LFTs still do not cover the bone profile'
  );
  const degraded = run('135', (fx) => {
    const strip = (x) => {
      x.resultCode = { conceptId: null };
      x.hasUnresolvedDegradedTypeCode = true;
    };
    fx.investigationGroups.forEach((g) => g.results.forEach(strip));
    fx.ungroupedResults.forEach(strip);
  });
  check(
    degraded.resolution.results.every((x) => x.confidence !== 'coded'),
    'with every code stripped, none pretend to be "coded"'
  );
  const grouped = degraded.resolution.results.filter(
    (x) => !degraded.resolution.groups.find((g) => g.ungrouped).results.includes(x)
  );
  check(
    grouped.length > 0 && grouped.every((x) => x.confidence === 'alias-in-scope'),
    'the lab-tagged aliases still resolve every GROUPED result inside its heading scope'
  );
  const ung = degraded.resolution.groups.find((g) => g.ungrouped).results[0];
  check(
    ung.confidence === 'alias-unscoped',
    'an UNGROUPED uncoded result is only "alias-unscoped" (never enough to file)'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
