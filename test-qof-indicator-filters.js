// Medicus Suite — QOF indicator filter + register-matching regression tests
// Run with: node test-qof-indicator-filters.js
//
// Covers the v3.20 clinical-correctness fixes:
//   F2 — evaluateQofIndicatorRule age filter is FAIL-OPEN (was fail-closed)
//   F3 — requiresProblem (all-of) and requiresAnyProblem (any-of) are honoured
//   F6 — problem requirements/exclusions are negation-aware
//   F4 — STIA register matches "TIA" abbreviations (word-boundary, not " tia ")
//   F5 — DM register excludes hyphenated "pre-diabetic"
//   F10 — HRT review chip fires only with a co-prescribed systemic oestrogen
//
// The qof-indicator tests use a `medication-present` check, which ALWAYS emits a
// chip (status achieved/not_met), so a length-0 result can only mean a filter
// suppressed the rule — isolating the filter behaviour under test.

'use strict';
const engine = require('./engine/rules-engine.js');
const qof = require('./rules/qof-rules.json');
const drug = require('./rules/drug-rules.json');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

const NOW = '2026-06-01T12:00:00Z';
const baseCheck = { kind: 'medication-present', medicationMatch: ['atorvastatin'] };
function indFires(rule, data) {
  return engine.evaluateQofIndicatorRule(
    { type: 'qof-indicator', enabled: true, indicatorCode: 'TEST', check: baseCheck, ...rule },
    { medications: [], observations: [], problems: [], patientContext: {}, _registerLookup: {}, ...data },
    NOW
  ).length > 0;
}

// ── F2: age fail-open ────────────────────────────────────────────────────────
console.log('\n--- F2: qof-indicator age filter fails OPEN ---');
check(indFires({ ageRange: { min: 18 } }, { patientContext: { ageYears: null } }),
  'min-age indicator FIRES when age is unknown (was suppressed)');
check(!indFires({ ageRange: { min: 18 } }, { patientContext: { ageYears: 10 } }),
  'min-age indicator suppressed when positively under-age');
check(indFires({ ageRange: { min: 18 } }, { patientContext: { ageYears: 25 } }),
  'min-age indicator fires for in-range age');
check(indFires({ ageRange: { min: 40, max: 70 } }, { patientContext: { ageYears: null } }),
  'min+max indicator fires when age unknown');
check(!indFires({ ageRange: { min: 40, max: 70 } }, { patientContext: { ageYears: 80 } }),
  'min+max indicator suppressed when positively over-age');

// ── F3: requiresProblem (all-of) ─────────────────────────────────────────────
console.log('\n--- F3: requiresProblem (conjunctive) ---');
const bothReq = { requiresProblem: ['heart failure', 'reduced ejection fraction'] };
check(indFires(bothReq, { problems: [{ label: 'Heart failure' }, { label: 'Reduced ejection fraction' }] }),
  'fires when ALL required problems present');
check(!indFires(bothReq, { problems: [{ label: 'Heart failure' }] }),
  'suppressed when only one required problem present');
check(!indFires(bothReq, { problems: [] }),
  'suppressed when no problems present');

// ── F3: requiresAnyProblem (any-of) — the DM021/DM035 fix ────────────────────
console.log('\n--- F3: requiresAnyProblem (disjunctive) ---');
const anyReq = { requiresAnyProblem: ['coronary heart disease', 'stroke'] };
check(indFires(anyReq, { problems: [{ label: 'Old stroke' }] }),
  'fires when ANY one required problem present');
check(!indFires(anyReq, { problems: [{ label: 'Asthma' }] }),
  'suppressed when none of the required problems present');
check(!indFires(anyReq, { problems: [{ label: 'Family history of stroke' }] }),
  'negation-aware: "family history of stroke" does NOT satisfy requiresAnyProblem');

// DM021 now uses requiresAnyProblem for frailty levels (was requiresProblem).
const dm021 = qof.rules.find(r => r.indicatorCode === 'DM021');
check(Array.isArray(dm021.requiresAnyProblem) && !dm021.requiresProblem,
  'DM021 migrated to requiresAnyProblem (moderate OR severe frailty)');
check(indFires({ requiresAnyProblem: dm021.requiresAnyProblem },
  { problems: [{ label: 'Moderate frailty' }] }),
  'DM021 cohort fires for moderate frailty alone');
check(!indFires({ requiresAnyProblem: dm021.requiresAnyProblem }, { problems: [{ label: 'Type 2 diabetes' }] }),
  'DM021 cohort suppressed for a non-frail diabetic (no longer over-triggers)');

// ── F6: excludeIfProblem negation-aware ──────────────────────────────────────
console.log('\n--- F6: excludeIfProblem is negation-aware ---');
const excl = { excludeIfProblem: ['moderate frailty'] };
check(!indFires(excl, { problems: [{ label: 'Moderate frailty' }] }),
  'excluded when the problem is genuinely present');
check(indFires(excl, { problems: [{ label: 'No evidence of moderate frailty' }] }),
  'NOT excluded by a negated "no evidence of moderate frailty"');
check(indFires(excl, { problems: [] }),
  'not excluded when problem absent');

// ── F4: STIA register matches TIA abbreviations ──────────────────────────────
console.log('\n--- F4: STIA register TIA matching ---');
const stia = qof.rules.find(r => r.registerCode === 'STIA');
const onStia = label => engine.patientOnRegister([{ label }], stia).matched === true;
check(onStia('TIA'), 'matches bare "TIA"');
check(onStia('Post TIA 2024'), 'matches "Post TIA 2024" (no trailing space)');
check(onStia('History of TIA'), 'matches "History of TIA"');
check(onStia('Transient ischaemic attack'), 'still matches full term');
check(!onStia('Patient to initiate statin therapy'),
  'does NOT false-match "tia" inside "iniTIAte"');

// ── F5: DM register excludes hyphenated pre-diabetic ─────────────────────────
console.log('\n--- F5: DM register pre-diabetic exclusion ---');
const dm = qof.rules.find(r => r.registerCode === 'DM');
const onDm = label => engine.patientOnRegister([{ label }], dm).matched === true;
check(!onDm('Pre-diabetic retinopathy'), 'excludes hyphenated "pre-diabetic"');
check(!onDm('Non-diabetic hyperglycaemia'), 'still excludes "non-diabetic"');
check(onDm('Type 2 diabetes mellitus'), 'still matches genuine diabetes');

// ── F10: HRT review chip gated on co-prescribed oestrogen ────────────────────
console.log('\n--- F10: HRT chip requires systemic oestrogen ---');
const hrt = drug.rules.find(r => r.id === 'hrt-systemic');
const hrtChips = meds => engine.evaluateDrugRule(hrt, { medications: meds, observations: [], problems: [], patientContext: {} }, NOW);
check(hrtChips([{ name: 'Mirena 52mg intrauterine device' }]).length === 0,
  'standalone Mirena (contraception) raises NO HRT chip');
check(hrtChips([{ name: 'Norethisterone 5mg tablets' }]).length === 0,
  'standalone norethisterone (POP) raises NO HRT chip');
check(hrtChips([{ name: 'Estradiol 1mg tablets' }]).length === 1,
  'systemic oestrogen raises one HRT chip');
check(hrtChips([{ name: 'Tibolone 2.5mg tablets' }]).length === 1,
  'tibolone (HRT agent) raises one HRT chip');
check(hrtChips([{ name: 'Oestrogel pump', }, { name: 'Mirena 52mg IUS' }]).length === 1,
  'oestrogen + Mirena raises a single HRT chip (no duplicate)');

// ── F9: same-date observation tiebreak prefers earlier-listed term (LDL) ──────
console.log('\n--- F9: LDL takes priority over non-HDL on the same date ---');
const cholRule = {
  type: 'qof-indicator', enabled: true, indicatorCode: 'CHOLTEST',
  check: { kind: 'observation-threshold', observation: ['ldl', 'ldl cholesterol', 'non-hdl', 'non hdl'],
           operator: '<=', threshold: 2.6, unit: 'mmol/L', withinDays: 365 },
};
const cholChip = (obs) => engine.evaluateQofIndicatorRule(cholRule,
  { medications: [], observations: obs, problems: [], patientContext: {}, _registerLookup: {} }, NOW)[0];
{
  // LDL 1.8 (meets) + non-HDL 3.1 (fails) on the SAME date → LDL must win → achieved.
  const c = cholChip([
    { name: 'Non-HDL cholesterol', value: '3.1', date: '2026-05-01' },
    { name: 'LDL cholesterol', value: '1.8', date: '2026-05-01' },
  ]);
  check(c && c.status === 'achieved', 'same-date LDL preferred over non-HDL (achieved, not not_met)');
}
{
  // A more recent non-HDL still wins by date (tiebreak only applies on equal dates).
  const c = cholChip([
    { name: 'LDL cholesterol', value: '1.8', date: '2026-01-01' },
    { name: 'Non-HDL cholesterol', value: '3.1', date: '2026-05-01' },
  ]);
  check(c && c.status === 'not_met', 'more recent non-HDL still wins by date (date beats term priority)');
}

// ── medication-present check now honours medicationExclude (builder gap fix) ──
console.log('\n--- qof medication-present honours medicationExclude ---');
const medRule = {
  type: 'qof-indicator', enabled: true, indicatorCode: 'MEDTEST',
  check: { kind: 'medication-present', medicationMatch: ['insulin'], medicationExclude: ['insulin glargine'] },
};
const medStatus = (meds) => engine.evaluateQofIndicatorRule(medRule,
  { medications: meds, observations: [], problems: [], patientContext: {}, _registerLookup: {} }, NOW)[0]?.status;
check(medStatus([{ name: 'Insulin aspart 100units/ml' }]) === 'achieved',
  'matched med (insulin aspart) → achieved');
check(medStatus([{ name: 'Insulin glargine 100units/ml' }]) === 'not_met',
  'excluded med (insulin glargine) → not_met (medicationExclude now applied, was ignored)');

// ── validator accepts the newly-reachable qof cohort fields, rejects malformed ─
console.log('\n--- validateCustomRule: qof cohort fields ---');
const { validateCustomRule } = require('./shared/io/sentinel-io.js');
const baseQof = (extra) => ({ id: 'custom-x', type: 'qof-indicator', indicatorCode: 'X', indicatorName: 'X',
  check: { kind: 'medication-present', medicationMatch: ['statin'] }, ...extra });
const valid = (rule) => { try { validateCustomRule(rule); return true; } catch (_) { return false; } };
check(valid(baseQof({ requiresAnyProblem: ['coronary heart disease', 'stroke'], requiresProblem: ['x'], excludeIfProblem: ['y'], sex: 'F' })),
  'accepts requiresProblem / requiresAnyProblem / excludeIfProblem / sex');
check(!valid(baseQof({ requiresAnyProblem: 'stroke' })), 'rejects requiresAnyProblem that is not an array');
check(!valid(baseQof({ sex: 'X' })), 'rejects invalid sex');
check(!valid(baseQof({ check: { kind: 'medication-present', medicationMatch: ['s'], medicationExclude: 'topical' } })),
  'rejects non-array medicationExclude');
check(valid({ id: 'custom-dm', type: 'drug-monitoring', drug: { match: ['x'] },
  tests: [{ name: 'BP', match: ['bp'], intervalDays: 365, snomed: ['75367002'] }], sex: 'M', ageRange: { min: 18 }, requiresProblem: ['ra'] }),
  'drug-monitoring accepts snomed / sex / ageRange / requiresProblem');

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
