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

const NOW = '2026-06-01T12:00:00Z';
const baseCheck = { kind: 'medication-present', medicationMatch: ['atorvastatin'] };
function indFires(rule, data) {
  return (
    engine.evaluateQofIndicatorRule(
      { type: 'qof-indicator', enabled: true, indicatorCode: 'TEST', check: baseCheck, ...rule },
      { medications: [], observations: [], problems: [], patientContext: {}, _registerLookup: {}, ...data },
      NOW
    ).length > 0
  );
}

// ── F2: age fail-open ────────────────────────────────────────────────────────
console.log('\n--- F2: qof-indicator age filter fails OPEN ---');
check(
  indFires({ ageRange: { min: 18 } }, { patientContext: { ageYears: null } }),
  'min-age indicator FIRES when age is unknown (was suppressed)'
);
check(
  !indFires({ ageRange: { min: 18 } }, { patientContext: { ageYears: 10 } }),
  'min-age indicator suppressed when positively under-age'
);
check(
  indFires({ ageRange: { min: 18 } }, { patientContext: { ageYears: 25 } }),
  'min-age indicator fires for in-range age'
);
check(
  indFires({ ageRange: { min: 40, max: 70 } }, { patientContext: { ageYears: null } }),
  'min+max indicator fires when age unknown'
);
check(
  !indFires({ ageRange: { min: 40, max: 70 } }, { patientContext: { ageYears: 80 } }),
  'min+max indicator suppressed when positively over-age'
);

// ── F3: requiresProblem (all-of) ─────────────────────────────────────────────
console.log('\n--- F3: requiresProblem (conjunctive) ---');
const bothReq = { requiresProblem: ['heart failure', 'reduced ejection fraction'] };
check(
  indFires(bothReq, { problems: [{ label: 'Heart failure' }, { label: 'Reduced ejection fraction' }] }),
  'fires when ALL required problems present'
);
check(
  !indFires(bothReq, { problems: [{ label: 'Heart failure' }] }),
  'suppressed when only one required problem present'
);
check(!indFires(bothReq, { problems: [] }), 'suppressed when no problems present');

// ── F3: requiresAnyProblem (any-of) — the DM021/DM035 fix ────────────────────
console.log('\n--- F3: requiresAnyProblem (disjunctive) ---');
const anyReq = { requiresAnyProblem: ['coronary heart disease', 'stroke'] };
check(indFires(anyReq, { problems: [{ label: 'Old stroke' }] }), 'fires when ANY one required problem present');
check(!indFires(anyReq, { problems: [{ label: 'Asthma' }] }), 'suppressed when none of the required problems present');
check(
  !indFires(anyReq, { problems: [{ label: 'Family history of stroke' }] }),
  'negation-aware: "family history of stroke" does NOT satisfy requiresAnyProblem'
);

// DM021 now uses requiresAnyProblem for frailty levels (was requiresProblem).
const dm021 = qof.rules.find((r) => r.indicatorCode === 'DM021');
check(
  Array.isArray(dm021.requiresAnyProblem) && !dm021.requiresProblem,
  'DM021 migrated to requiresAnyProblem (moderate OR severe frailty)'
);
check(
  indFires({ requiresAnyProblem: dm021.requiresAnyProblem }, { problems: [{ label: 'Moderate frailty' }] }),
  'DM021 cohort fires for moderate frailty alone'
);
check(
  !indFires({ requiresAnyProblem: dm021.requiresAnyProblem }, { problems: [{ label: 'Type 2 diabetes' }] }),
  'DM021 cohort suppressed for a non-frail diabetic (no longer over-triggers)'
);

// ── F6: excludeIfProblem negation-aware ──────────────────────────────────────
console.log('\n--- F6: excludeIfProblem is negation-aware ---');
const excl = { excludeIfProblem: ['moderate frailty'] };
check(!indFires(excl, { problems: [{ label: 'Moderate frailty' }] }), 'excluded when the problem is genuinely present');
check(
  indFires(excl, { problems: [{ label: 'No evidence of moderate frailty' }] }),
  'NOT excluded by a negated "no evidence of moderate frailty"'
);
check(indFires(excl, { problems: [] }), 'not excluded when problem absent');

// ── F4: STIA register matches TIA abbreviations ──────────────────────────────
console.log('\n--- F4: STIA register TIA matching ---');
const stia = qof.rules.find((r) => r.registerCode === 'STIA');
const onStia = (label) => engine.patientOnRegister([{ label }], stia).matched === true;
check(onStia('TIA'), 'matches bare "TIA"');
check(onStia('Post TIA 2024'), 'matches "Post TIA 2024" (no trailing space)');
check(onStia('History of TIA'), 'matches "History of TIA"');
check(onStia('Transient ischaemic attack'), 'still matches full term');
check(!onStia('Patient to initiate statin therapy'), 'does NOT false-match "tia" inside "iniTIAte"');

// ── F5: DM register excludes hyphenated pre-diabetic ─────────────────────────
console.log('\n--- F5: DM register pre-diabetic exclusion ---');
const dm = qof.rules.find((r) => r.registerCode === 'DM');
const onDm = (label) => engine.patientOnRegister([{ label }], dm).matched === true;
check(!onDm('Pre-diabetic retinopathy'), 'excludes hyphenated "pre-diabetic"');
check(!onDm('Non-diabetic hyperglycaemia'), 'still excludes "non-diabetic"');
check(onDm('Type 2 diabetes mellitus'), 'still matches genuine diabetes');

// ── OB register (NEW 26/27) substring membership ─────────────────────────────
console.log('\n--- OB register (Obesity, new 26/27) ---');
const ob = qof.rules.find((r) => r.registerCode === 'OB');
const onOb = (label) => engine.patientOnRegister([{ label }], ob).matched === true;
check(!!ob, 'OB register exists in qof-rules.json');
check(onOb('Obesity'), 'matches bare "Obesity"');
check(onOb('Morbid obesity'), 'matches "Morbid obesity"');
check(onOb('Obese (clinical finding)'), 'matches "Obese..."');
check(!onOb('Family history of obesity'), 'excludes "Family history of obesity"');
check(!onOb('No obesity'), 'excludes "No obesity"');

// ── F10: HRT review chip gated on co-prescribed oestrogen ────────────────────
console.log('\n--- F10: HRT chip requires systemic oestrogen ---');
const hrt = drug.rules.find((r) => r.id === 'hrt-systemic');
const hrtChips = (meds) =>
  engine.evaluateDrugRule(hrt, { medications: meds, observations: [], problems: [], patientContext: {} }, NOW);
check(
  hrtChips([{ name: 'Mirena 52mg intrauterine device' }]).length === 0,
  'standalone Mirena (contraception) raises NO HRT chip'
);
check(
  hrtChips([{ name: 'Norethisterone 5mg tablets' }]).length === 0,
  'standalone norethisterone (POP) raises NO HRT chip'
);
check(hrtChips([{ name: 'Estradiol 1mg tablets' }]).length === 1, 'systemic oestrogen raises one HRT chip');
check(hrtChips([{ name: 'Tibolone 2.5mg tablets' }]).length === 1, 'tibolone (HRT agent) raises one HRT chip');
check(
  hrtChips([{ name: 'Oestrogel pump' }, { name: 'Mirena 52mg IUS' }]).length === 1,
  'oestrogen + Mirena raises a single HRT chip (no duplicate)'
);

// ── F11: problem-coded IUS only counts as cover within its 5y licensed life ───
console.log('\n--- F11: HRT progestogen context honours IUS 5-year validity ---');
const hrtCtx = (meds, problems) =>
  engine.evaluateDrugRule(
    hrt,
    { medications: meds, observations: [], problems: problems || [], patientContext: {} },
    NOW
  )[0].hrtContext;

// Recent coil insertion (within 5y) → valid in-situ cover.
{
  const ctx = hrtCtx(
    [{ name: 'Oestrogel pump' }],
    [{ label: 'Insertion of hormone releasing intrauterine system', codedDate: '2024-03-01' }]
  );
  check(ctx.iusMed && !ctx.iusExpired, 'IUS coded 2024 (within 5y) counts as cover');
}
// Old coil insertion (>5y, 2017) with NO progestogen → expired, cover not confirmed.
{
  const ctx = hrtCtx(
    [{ name: 'Oestrogel pump' }],
    [{ label: 'Insertion of hormone releasing intrauterine system', codedDate: '2017-05-01' }]
  );
  check(!ctx.iusMed && ctx.iusExpired, '2017 IUS (>5y) does NOT count as cover (expired)');
}
// The reported case: 2017 IUS still active AS A PROBLEM but patient is on
// micronised progesterone → progestogen must win, not the stale coil.
{
  const ctx = hrtCtx(
    [{ name: 'Oestrogel pump' }, { name: 'Utrogestan 100mg capsules' }],
    [{ label: 'Insertion of hormone releasing intrauterine system', codedDate: '2017-05-01' }]
  );
  check(
    !ctx.iusMed && ctx.iusExpired && /utrogestan/i.test(ctx.progestogenMed || ''),
    'expired 2017 IUS does not trump co-prescribed micronised progesterone'
  );
}
// A live LNG-IUS on the medication list is current cover regardless of date.
{
  const ctx = hrtCtx([{ name: 'Oestrogel pump' }, { name: 'Mirena 52mg IUS' }], []);
  check(ctx.iusMed && !ctx.iusExpired, 'LNG-IUS on the medication list counts as cover');
}
// A newly-issued LNG-IUS shown under its generic VTM name "Levonorgestrel
// (Intrauterine device)" — the bracket must not defeat the iusTerm match, even
// when a stale >5y coil problem is still on the record (the reported case).
{
  const ctx = hrtCtx(
    [{ name: 'Estradiol 0.06% transdermal gel' }, { name: 'Levonorgestrel (Intrauterine device)' }],
    [{ label: 'Insertion of hormone releasing intrauterine system', codedDate: '2017-05-01' }]
  );
  check(
    ctx.iusMed && !ctx.iusExpired,
    'new "Levonorgestrel (Intrauterine device)" on med list counts as cover despite a stale 2017 coil problem'
  );
}
// Undated coil problem → cannot confirm currency → treated as expired (safe).
{
  const ctx = hrtCtx(
    [{ name: 'Oestrogel pump' }],
    [{ label: 'Insertion of hormone releasing intrauterine system', codedDate: null }]
  );
  check(!ctx.iusMed && ctx.iusExpired, 'undated IUS problem is treated conservatively as expired');
}

// ── F9: same-date observation tiebreak prefers earlier-listed term (LDL) ──────
console.log('\n--- F9: LDL takes priority over non-HDL on the same date ---');
const cholRule = {
  type: 'qof-indicator',
  enabled: true,
  indicatorCode: 'CHOLTEST',
  check: {
    kind: 'observation-threshold',
    observation: ['ldl', 'ldl cholesterol', 'non-hdl', 'non hdl'],
    operator: '<=',
    threshold: 2.6,
    unit: 'mmol/L',
    withinDays: 365,
  },
};
const cholChip = (obs) =>
  engine.evaluateQofIndicatorRule(
    cholRule,
    { medications: [], observations: obs, problems: [], patientContext: {}, _registerLookup: {} },
    NOW
  )[0];
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
  type: 'qof-indicator',
  enabled: true,
  indicatorCode: 'MEDTEST',
  check: { kind: 'medication-present', medicationMatch: ['insulin'], medicationExclude: ['insulin glargine'] },
};
const medStatus = (meds) =>
  engine.evaluateQofIndicatorRule(
    medRule,
    { medications: meds, observations: [], problems: [], patientContext: {}, _registerLookup: {} },
    NOW
  )[0]?.status;
check(medStatus([{ name: 'Insulin aspart 100units/ml' }]) === 'achieved', 'matched med (insulin aspart) → achieved');
check(
  medStatus([{ name: 'Insulin glargine 100units/ml' }]) === 'not_met',
  'excluded med (insulin glargine) → not_met (medicationExclude now applied, was ignored)'
);

// ── validator accepts the newly-reachable qof cohort fields, rejects malformed ─
console.log('\n--- validateCustomRule: qof cohort fields ---');
const { validateCustomRule } = require('./shared/io/sentinel-io.js');
const baseQof = (extra) => ({
  id: 'custom-x',
  type: 'qof-indicator',
  indicatorCode: 'X',
  indicatorName: 'X',
  check: { kind: 'medication-present', medicationMatch: ['statin'] },
  ...extra,
});
const valid = (rule) => {
  try {
    validateCustomRule(rule);
    return true;
  } catch (_) {
    return false;
  }
};
check(
  valid(
    baseQof({
      requiresAnyProblem: ['coronary heart disease', 'stroke'],
      requiresProblem: ['x'],
      excludeIfProblem: ['y'],
      sex: 'F',
    })
  ),
  'accepts requiresProblem / requiresAnyProblem / excludeIfProblem / sex'
);
check(!valid(baseQof({ requiresAnyProblem: 'stroke' })), 'rejects requiresAnyProblem that is not an array');
check(!valid(baseQof({ sex: 'X' })), 'rejects invalid sex');
check(
  !valid(baseQof({ check: { kind: 'medication-present', medicationMatch: ['s'], medicationExclude: 'topical' } })),
  'rejects non-array medicationExclude'
);
check(
  valid({
    id: 'custom-dm',
    type: 'drug-monitoring',
    drug: { match: ['x'] },
    tests: [{ name: 'BP', match: ['bp'], intervalDays: 365, snomed: ['75367002'] }],
    sex: 'M',
    ageRange: { min: 18 },
    requiresProblem: ['ra'],
  }),
  'drug-monitoring accepts snomed / sex / ageRange / requiresProblem'
);

// ── category passthrough: non-QOF surveillance rules surface as Safety Monitoring ──
console.log('\n--- category: safety-monitoring passes through to the chip ---');
const safetyChips = engine.evaluateQofIndicatorRule(
  { type: 'qof-indicator', category: 'safety-monitoring', enabled: true, indicatorCode: 'TEST', check: baseCheck },
  { medications: [{ name: 'atorvastatin 20mg' }], observations: [], problems: [], patientContext: {}, _registerLookup: {} },
  NOW
);
check(safetyChips.length > 0 && safetyChips[0].category === 'safety-monitoring', 'chip carries category from the rule');
const plainChips = engine.evaluateQofIndicatorRule(
  { type: 'qof-indicator', enabled: true, indicatorCode: 'TEST', check: baseCheck },
  { medications: [{ name: 'atorvastatin 20mg' }], observations: [], problems: [], patientContext: {}, _registerLookup: {} },
  NOW
);
check(plainChips.length > 0 && plainChips[0].category === null, 'chip category defaults to null when the rule has none');
// The three shipped non-QOF surveillance rules are tagged so the UI groups them apart from QOF.
const safetyRuleIds = ['trend-egfr-falling', 'trend-hba1c-rising', 'alert-hyperkalaemia'];
safetyRuleIds.forEach((id) => {
  const r = qof.rules.find((x) => x.id === id);
  check(r && r.category === 'safety-monitoring', `${id} is tagged category: safety-monitoring`);
});

// ── 2026-07-11 Keeper: LD register ───────────────────────────────────────────
console.log('\n--- LD register (Learning Disability, new 2026-07-11) ---');
const ld = qof.rules.find((r) => r.registerCode === 'LD');
const onLd = (label) => engine.patientOnRegister([{ label }], ld).matched === true;
check(!!ld, 'LD register exists in qof-rules.json');
check(onLd('Learning disability'), 'matches "Learning disability"');
check(onLd('Intellectual disability'), 'matches "Intellectual disability"');
check(onLd('Downs syndrome'), 'matches "Downs syndrome"');
check(onLd('Down syndrome'), 'matches "Down syndrome"');
check(onLd('Severe learning disability'), 'matches "Severe learning disability"');
check(!onLd('No learning disability'), 'excludes negated "No learning disability"');
check(!onLd('Family history of learning disability'), 'excludes "Family history of learning disability"');

// ── 2026-07-11 Keeper: DEM004 indicator ──────────────────────────────────────
console.log('\n--- DEM004 indicator (annual dementia review, new 2026-07-11) ---');
const dem004 = qof.rules.find((r) => r.indicatorCode === 'DEM004');
check(!!dem004, 'DEM004 indicator exists in qof-rules.json');
check(dem004.enabled === true, 'DEM004 is enabled');
check(dem004.registerCode === 'DEM' || (dem004.requiresRegister && dem004.requiresRegister.includes('DEM')), 'DEM004 scoped to DEM register');
// ── 2026-07-25 Keeper: DEM004 threshold correction ─────────────────────────
// Previous Keeper run (2026-07-11) encoded wrong values (30pts/60-90%) due to primary PDF 403.
// Correct 2026/27 QOF values (PRN02356): 14 points, 35-70% payment range.
check(dem004 && dem004.points === 14, 'DEM004 points corrected to 14 (was wrongly 30 in 2026-07-11 run)');
check(dem004 && dem004.thresholds && dem004.thresholds.lower === 35, 'DEM004 lower threshold corrected to 35% (was wrongly 60)');
check(dem004 && dem004.thresholds && dem004.thresholds.upper === 70, 'DEM004 upper threshold corrected to 70% (was wrongly 90)');

// ── 2026-08-28 Keeper: CKD-BP / CKD-RASI relabelled off fake QOF codes ───────
// CKD002/CKD003 were added 2026-07-11 on a 403'd primary source, never
// independently confirmed. The full current QOF 2026/27 guidance (fetched and
// read in full this run) has no CKD domain, register, or indicator chapter at
// all — CKD002/CKD003 never existed. Relabelled to non-QOF safety-monitoring
// codes (CKD-BP / CKD-RASI, matching TREND-EGFR/K-HIGH/TREND-HBA1C) so nobody
// mistakes these for something that counts toward QOF payment. The underlying
// checks (NICE NG203 BP/RAS-inhibition prompts) still fire unchanged.
console.log('\n--- CKD-BP indicator (BP ≤140/90 in CKD, relabelled off fake QOF code 2026-08-28) ---');
const ckdBp = qof.rules.find((r) => r.id === 'qof-ckd002');
check(!!ckdBp, 'CKD-BP rule exists in qof-rules.json (id: qof-ckd002)');
check(ckdBp.enabled === true, 'CKD-BP is enabled');
check(ckdBp.indicatorCode === 'CKD-BP', 'CKD-BP no longer carries the fake QOF code CKD002');
check(ckdBp.category === 'safety-monitoring', 'CKD-BP is tagged category: safety-monitoring, not a QOF claim');
check(ckdBp.points === undefined && ckdBp.thresholds === undefined, 'CKD-BP carries no points/thresholds (nothing to claim against)');
check(!qof.rules.some((r) => r.indicatorCode === 'CKD002'), 'the fake code CKD002 no longer appears anywhere in qof-rules.json');

console.log('\n--- CKD-RASI indicator (ACEi/ARB in hypertensive CKD, relabelled off fake QOF code 2026-08-28) ---');
const ckdRasi = qof.rules.find((r) => r.id === 'qof-ckd003');
check(!!ckdRasi, 'CKD-RASI rule exists in qof-rules.json (id: qof-ckd003)');
check(ckdRasi.enabled === true, 'CKD-RASI is enabled');
check(ckdRasi.indicatorCode === 'CKD-RASI', 'CKD-RASI no longer carries the fake QOF code CKD003');
check(ckdRasi.category === 'safety-monitoring', 'CKD-RASI is tagged category: safety-monitoring, not a QOF claim');
check(!qof.rules.some((r) => r.indicatorCode === 'CKD003'), 'the fake code CKD003 no longer appears anywhere in qof-rules.json');

// ── 2026-07-11 Keeper: CHOL003/CHOL004 multi-register expansion ──────────────
console.log('\n--- CHOL003/CHOL004 multi-register clones (PAD/STIA/CKD, new 2026-07-11) ---');
const chol003Pad = qof.rules.find((r) => r.id === 'qof-chol003-pad');
const chol003Stia = qof.rules.find((r) => r.id === 'qof-chol003-stia');
const chol003Ckd = qof.rules.find((r) => r.id === 'qof-chol003-ckd');
const chol004Pad = qof.rules.find((r) => r.id === 'qof-chol004-pad');
const chol004Stia = qof.rules.find((r) => r.id === 'qof-chol004-stia');
const chol004Ckd = qof.rules.find((r) => r.id === 'qof-chol004-ckd');
check(!!chol003Pad, 'qof-chol003-pad exists (CHOL003 / PAD register)');
check(!!chol003Stia, 'qof-chol003-stia exists (CHOL003 / STIA register)');
check(!!chol003Ckd, 'qof-chol003-ckd exists (CHOL003 / CKD register)');
check(!!chol004Pad, 'qof-chol004-pad exists (CHOL004 / PAD register)');
check(!!chol004Stia, 'qof-chol004-stia exists (CHOL004 / STIA register)');
check(!chol004Ckd, 'qof-chol004-ckd does NOT exist (CKD excluded from CHOL004 per PRN02356)');
// Verify indicator codes
check(chol003Pad && chol003Pad.indicatorCode === 'CHOL003', 'qof-chol003-pad has indicatorCode CHOL003');
check(chol004Pad && chol004Pad.indicatorCode === 'CHOL004', 'qof-chol004-pad has indicatorCode CHOL004');
check(chol003Ckd && chol003Ckd.indicatorCode === 'CHOL003', 'qof-chol003-ckd has indicatorCode CHOL003');

// ── 2026-08-22 Keeper: SMI physical-health suite (MH002/003/006/007/012) ─────
console.log('\n--- SMI physical-health suite (MH002/MH003/MH006/MH007/MH012, new 2026-08-22) ---');
const smiReg = qof.rules.find((r) => r.registerCode === 'SMI');
const smiSuite = {
  MH002: { points: 5, lower: 40 },
  MH003: { points: 3, lower: 50 },
  MH006: { points: 3, lower: 50 },
  MH007: { points: 3, lower: 50 },
  MH012: { points: 7, lower: 50 },
};
Object.entries(smiSuite).forEach(([code, exp]) => {
  const r = qof.rules.find((x) => x.indicatorCode === code);
  check(!!r && r.enabled === true, `${code} exists and is enabled`);
  check(r && r.requiresRegister === 'SMI', `${code} scoped to SMI register`);
  check(r && r.check && r.check.kind === 'observation-recent', `${code} uses observation-recent`);
  check(
    r && r.check && r.check.withinDays === 365,
    `${code} has a flat 12-month window (withinDays 365, no MH011-style split)`
  );
  check(r && r.points === exp.points, `${code} points = ${exp.points}`);
  check(
    r && r.thresholds && r.thresholds.lower === exp.lower && r.thresholds.upper === 90,
    `${code} thresholds ${exp.lower}-90%`
  );
});

// MH012 diabetes exclusion must never be bare "diabetes" (would catch insipidus/gestational).
const mh012 = qof.rules.find((r) => r.indicatorCode === 'MH012');
check(
  Array.isArray(mh012.excludeIfProblem) && mh012.excludeIfProblem.length > 0,
  'MH012 carries an excludeIfProblem diabetes exclusion'
);
check(
  mh012.excludeIfProblem.every((t) => t !== 'diabetes'),
  'MH012 exclusion terms never include bare "diabetes"'
);

// End-to-end through evaluateQofIndicatorRule with the REAL rules + SMI register.
// NOW is Feb so a 6-month-old observation sits inside the current QOF year
// (started 1 Apr 2026) — the default useQofYearFloor applies to these rules.
const SMI_NOW = '2027-02-01T12:00:00Z';
const smiEval = (rule, data) =>
  engine.evaluateQofIndicatorRule(
    rule,
    {
      medications: [],
      observations: [],
      problems: [{ label: 'Schizophrenia' }],
      patientContext: {},
      _registerLookup: { SMI: smiReg },
      ...data,
    },
    SMI_NOW
  );
const mh003 = qof.rules.find((r) => r.indicatorCode === 'MH003');
{
  // BP recorded 6 months ago (2026-08-01) → achieved
  const chips = smiEval(mh003, { observations: [{ name: 'Blood pressure', value: '128/82', date: '2026-08-01' }] });
  check(chips.length === 1 && chips[0].status === 'achieved', 'MH003: SMI patient with BP 6 months old → achieved');
}
{
  // BP recorded 18 months ago (2025-08-01) → overdue
  const chips = smiEval(mh003, { observations: [{ name: 'Blood pressure', value: '128/82', date: '2025-08-01' }] });
  check(chips.length === 1 && chips[0].status === 'overdue', 'MH003: SMI patient with BP 18 months old → overdue');
}
{
  // Not on the SMI register → no chip at all
  const chips = smiEval(mh003, { problems: [{ label: 'Asthma' }] });
  check(chips.length === 0, 'MH003: non-SMI patient raises no chip (register precondition)');
}
{
  // SMI patient with coded type 2 diabetes → MH012 excluded (no chip)
  const chips = smiEval(mh012, {
    problems: [{ label: 'Schizophrenia' }, { label: 'Type 2 diabetes mellitus' }],
    observations: [{ name: 'HbA1c', value: '52', date: '2026-08-01' }],
  });
  check(chips.length === 0, 'MH012: SMI patient with coded type 2 diabetes → excluded (no chip)');
}
{
  // Diabetes insipidus is NOT diabetes mellitus → MH012 must still fire
  const chips = smiEval(mh012, {
    problems: [{ label: 'Schizophrenia' }, { label: 'Diabetes insipidus' }],
    observations: [{ name: 'HbA1c', value: '38', date: '2026-08-01' }],
  });
  check(
    chips.length === 1 && chips[0].status === 'achieved',
    'MH012: diabetes insipidus does NOT exclude (bare-"diabetes" trap avoided)'
  );
}

// ── 2026-08-27: AST014 gated to new asthma diagnoses (post-Apr 2025) ────────
console.log('\n--- AST014: gated on requiresRegisterCodedFrom (new asthma diagnosis) ---');
const ast014 = qof.rules.find((r) => r.indicatorCode === 'AST014');
const astReg = qof.rules.find((r) => r.registerCode === 'ASTHMA');
check(!!ast014, 'AST014 indicator exists in qof-rules.json');
check(ast014.requiresRegisterCodedFrom === '2025-04-01', 'AST014 requires register-coded date on/after 2025-04-01');
const ast014Eval = (problems, observations) =>
  engine.evaluateQofIndicatorRule(
    ast014,
    { medications: [], observations: observations || [], problems, patientContext: {}, _registerLookup: { ASTHMA: astReg } },
    NOW
  );
check(
  ast014Eval([{ label: 'Asthma', codedDate: '2018-01-01' }]).length === 0,
  'AST014 raises NO chip for asthma diagnosed years ago (2018), even with no recent objective test'
);
check(
  ast014Eval([{ label: 'Asthma', codedDate: null }]).length === 0,
  'AST014 raises NO chip when the asthma problem has no coded date (cannot confirm new diagnosis)'
);
check(
  ast014Eval([{ label: 'Asthma', codedDate: '2025-03-31' }]).length === 0,
  'AST014 raises NO chip for asthma coded the day before the 1 Apr 2025 cutoff'
);
check(
  ast014Eval([{ label: 'Asthma', codedDate: '2025-04-01' }]).length === 1,
  'AST014 still evaluates (fires a chip) for asthma coded exactly on the 1 Apr 2025 cutoff'
);
// 2026-08-28 follow-up: a diagnosis old enough that the QOF window has
// definitively closed on it, with NO objective test ever recorded, must show
// overdue (red) — not neutral no_data. no_data was originally correct-by-
// omission for a routine periodic-review indicator (nothing to compare
// against), but AST014 already has a known diagnosis date the moment it
// fires at all; if that date sits outside the check's own window, no test
// could still land inside it, so "never recorded" is unambiguous, not merely
// unknown. Reported live: a genuinely-overdue new-diagnosis patient showed
// as neutral "NO DATA" instead of red.
check(
  ast014Eval([{ label: 'Asthma', codedDate: '2025-04-01' }])[0].status === 'overdue',
  'AST014: new-diagnosis asthma patient with NO objective test ever, diagnosed long enough ago that the window has closed → overdue (red), not no_data'
);
check(
  ast014Eval(
    [{ label: 'Asthma', codedDate: '2025-04-01' }],
    [{ name: 'Spirometry', value: 'obstructive', date: '2024-01-01' }]
  )[0].status === 'overdue',
  'AST014: new-diagnosis asthma patient whose only objective test is outside the window → overdue (legitimately red)'
);
check(
  ast014Eval(
    [{ label: 'Asthma', codedDate: '2026-01-01' }],
    [{ name: 'Spirometry', value: 'obstructive', date: '2026-05-01' }]
  )[0].status === 'achieved',
  'AST014: new-diagnosis asthma patient WITH a recent objective test shows achieved'
);
// The other side of the fix: a patient diagnosed RECENTLY (still inside the
// current QOF year / window) with no test YET must stay no_data — there's a
// legitimate grace period, and flagging them red the day after diagnosis
// would be a false alarm, not a genuine miss.
check(
  ast014Eval([{ label: 'Asthma', codedDate: '2026-05-01' }])[0].status === 'no_data',
  'AST014: new-diagnosis asthma patient diagnosed recently (still inside the window), no test yet → stays no_data (not prematurely overdue)'
);

// ── 2026-08-27 follow-up: register match must not be poisoned by a stray
// "Family history of asthma" entry (was silently on-register, and could
// supply a spuriously old codedDate that blocked AST014 for a genuine new
// diagnosis coded later — reported live as several missing chips) ─────────
console.log('\n--- AST014 follow-up: family-history exclusion + earliest-of-all-matches ---');
const onAsthma = (label) => engine.patientOnRegister([{ label }], astReg).matched === true;
check(!onAsthma('Family history of asthma'), 'ASTHMA register excludes "Family history of asthma"');
check(!onAsthma('Suspected asthma'), 'ASTHMA register excludes "Suspected asthma"');
check(!onAsthma('Query asthma'), 'ASTHMA register excludes "Query asthma"');
check(onAsthma('Asthma'), 'ASTHMA register still matches a genuine "Asthma" diagnosis');

// The reported case: an old family-history mention sits BEFORE the genuine new
// diagnosis in problem-list order. Under the old first-match-only logic this
// would have picked the family-history entry (excluded now, so skipped
// entirely) and, before that exclusion existed, could have used its old date
// to wrongly block the chip. With the fix, only the genuine "Asthma" entry
// counts, and its own coded date decides eligibility.
check(
  ast014Eval([
    { label: 'Family history of asthma', codedDate: '2010-01-01' },
    { label: 'Asthma', codedDate: '2025-09-01' },
  ]).length === 1,
  'AST014 fires for a new diagnosis even when an old family-history entry precedes it in the problem list'
);

// A patient with TWO genuine (non-excluded) asthma-matching problems — e.g. a
// re-coded/duplicate diagnosis — must be judged on the EARLIEST of the two,
// not whichever happens to appear first in array order (order-independence).
check(
  ast014Eval([
    { label: 'Asthma', codedDate: '2026-02-01' }, // newer duplicate listed FIRST
    { label: 'Childhood asthma', codedDate: '2015-06-01' }, // true original diagnosis
  ]).length === 0,
  'AST014: earliest matching date wins regardless of array order — genuinely old diagnosis still suppressed even when a newer duplicate entry is listed first'
);
check(
  ast014Eval([
    { label: 'Asthma', codedDate: '2015-06-01' }, // true original diagnosis listed FIRST
    { label: 'Asthma reviewed', codedDate: '2026-02-01' }, // later duplicate/re-code
  ]).length === 0,
  'AST014: earliest matching date wins regardless of array order — same result when the old entry is listed first instead'
);

// ── 2026-08-27: patientRegisters (Medicus's own computed register membership,
// from the clinical-summary endpoint) preferred over text-matching for the 7
// registers with a confirmed medicusRegisterTypes mapping ───────────────────
console.log('\n--- patientOnRegister: authoritative patientRegisters (Medicus clinical-summary) ---');

const dmReg = qof.rules.find((r) => r.registerCode === 'DM');
const afReg = qof.rules.find((r) => r.registerCode === 'AF');
const copdReg = qof.rules.find((r) => r.registerCode === 'COPD');
const stiaReg = qof.rules.find((r) => r.registerCode === 'STIA');

// The 8 registers verified against a real HAR capture (7 from the first
// capture + ASTHMA confirmed 2026-08-27 from a second, genuinely-on-the-
// register patient: registerType "medicus-health/register-asthma") carry
// medicusRegisterTypes; the rest do not.
['DM', 'DEM', 'HYP', 'AF', 'CHD', 'COPD', 'OB', 'ASTHMA'].forEach((code) => {
  const r = qof.rules.find((x) => x.registerCode === code);
  check(
    Array.isArray(r.medicusRegisterTypes) && r.medicusRegisterTypes.length > 0,
    `${code} register carries a confirmed medicusRegisterTypes mapping`
  );
});
check(
  astReg.medicusRegisterTypes[0] === 'medicus-health/register-asthma',
  'ASTHMA medicusRegisterTypes matches the confirmed HAR value exactly'
);
['STIA', 'CKD', 'PAD', 'SMI', 'LD', 'HF'].forEach((code) => {
  const r = qof.rules.find((x) => x.registerCode === code);
  check(!r.medicusRegisterTypes, `${code} register has NO medicusRegisterTypes (unconfirmed — text-match only)`);
});

// Authoritative hit: patient has zero matching problem-list text, but Medicus's
// own patientRegisters says they're on the diabetes register — must still match.
{
  const res = engine.patientOnRegister([{ label: 'Asthma' }], dmReg, [
    { registerType: 'medicus-health/diabetes-register', registerLabel: 'Diabetes' },
  ]);
  check(res.matched === true, 'authoritative patientRegisters match fires even with no text-matching problem at all');
  check(res.problem === null, 'authoritative match carries no underlying problem entry (problem: null)');
  check(res.source === 'medicus-register', 'authoritative match is tagged source: medicus-register');
}

// Authoritative MISS overrides a text match that would otherwise have fired —
// this is the core fix: Medicus's own computation is trusted over our proxy,
// not OR'd with it (proves it truly replaces text-matching, not supplements).
{
  const res = engine.patientOnRegister(
    [{ label: 'Type 2 diabetes mellitus', codedDate: '2020-01-01' }],
    dmReg,
    [{ registerType: 'medicus-health/hypertension-register', registerLabel: 'Hypertension' }] // no diabetes entry
  );
  check(
    res.matched === false,
    'authoritative patientRegisters (fetched, no diabetes entry) overrides a would-be text match — not on register'
  );
}

// patientRegisters === null (not fetched / endpoint failed) → falls back to
// text-matching exactly as before this feature existed.
{
  const res = engine.patientOnRegister([{ label: 'Type 2 diabetes mellitus', codedDate: '2020-01-01' }], dmReg, null);
  check(res.matched === true && res.source === 'problem-text-match', 'patientRegisters null falls back to text-matching');
}

// A register with NO medicusRegisterTypes (STIA — still unconfirmed) always
// uses text-matching, even when patientRegisters was fetched successfully for
// OTHER registers.
{
  const res = engine.patientOnRegister([{ label: 'Stroke', codedDate: '2020-01-01' }], stiaReg, [
    { registerType: 'medicus-health/diabetes-register', registerLabel: 'Diabetes' },
  ]);
  check(
    res.matched === true && res.source === 'problem-text-match',
    'STIA (no confirmed medicusRegisterTypes) still uses text-matching regardless of patientRegisters being present'
  );
}

// ASTHMA now HAS a confirmed medicusRegisterTypes (2026-08-27) — authoritative
// match works for it too, the same as DM/AF/COPD etc.
{
  const res = engine.patientOnRegister([], astReg, [
    { registerType: 'medicus-health/register-asthma', registerLabel: 'Asthma' },
  ]);
  check(res.matched === true && res.source === 'medicus-register', 'ASTHMA authoritative match now works via patientRegisters');
}

// Fetched successfully with genuinely zero registers ([] not null) is still
// trusted (not treated as "unavailable, fall back") for a register that HAS a
// medicusRegisterTypes mapping.
{
  const res = engine.patientOnRegister([{ label: 'Type 2 diabetes mellitus', codedDate: '2020-01-01' }], dmReg, []);
  check(res.matched === false, 'an empty (but fetched) patientRegisters array is trusted, not treated as unavailable');
}

// End-to-end through evaluateQofRegisterRule + evaluateQofIndicatorRule with
// the real AF/COPD register rules, proving the chip pipeline (not just the
// matcher) picks up the authoritative source.
{
  const chips = engine.evaluateQofRegisterRule(afReg, {
    problems: [],
    patientContext: {},
    patientRegisters: [{ registerType: 'medicus-health/register-atrial-fibrillation', registerLabel: 'Atrial Fibrillation' }],
  });
  check(chips.length === 1 && chips[0].status === 'achieved', 'evaluateQofRegisterRule fires AF via patientRegisters alone');
}
{
  const copd010 = qof.rules.find((r) => r.indicatorCode === 'COPD010');
  const chips = engine.evaluateQofIndicatorRule(
    copd010,
    {
      medications: [],
      observations: [{ name: 'COPD review', value: 'done', date: '2026-05-01' }],
      problems: [],
      patientContext: {},
      _registerLookup: { COPD: copdReg },
      patientRegisters: [{ registerType: 'medicus-health/copd-register', registerLabel: 'COPD' }],
    },
    NOW
  );
  check(
    chips.length === 1 && chips[0].status === 'achieved',
    'COPD010 fires via patientRegisters register membership with zero COPD-text problems'
  );
}

// ── normalisePatientRegisters (engine/normalisers.js) ────────────────────────
console.log('\n--- normalisePatientRegisters ---');
const normalisers = require('./engine/normalisers.js');
check(normalisers.normalisePatientRegisters(null) === null, 'null clinicalSummary -> null (not fetched)');
check(normalisers.normalisePatientRegisters({}) === null, 'clinicalSummary with no patientRegisters array -> null');
check(
  Array.isArray(normalisers.normalisePatientRegisters({ patientRegisters: [] })),
  'clinicalSummary with an empty patientRegisters array -> [] (fetched, trusted)'
);
{
  const out = normalisers.normalisePatientRegisters({
    patientRegisters: [
      { id: 'x', registerType: 'medicus-health/copd-register', registerLabel: 'COPD', dashboardIdentifier: 'medicus-health/copd-register' },
      { id: 'y', registerLabel: 'Missing type' }, // no registerType -> dropped
    ],
  });
  check(out.length === 1, 'entries with no registerType are dropped');
  check(
    out[0].registerType === 'medicus-health/copd-register' && out[0].registerLabel === 'COPD',
    'surviving entry keeps registerType + registerLabel, drops id/dashboardIdentifier noise'
  );
}

// ── 2026-08-27 follow-up: onset-date confidence (hasOnsetDate) ──────────────
console.log('\n--- buildOnsetDateIndex / normaliseProblemsAll: hasOnsetDate join ---');
{
  const index = normalisers.buildOnsetDateIndex({
    problems: [
      { id: 'p1', hasOnsetDate: true, orderingDateString: '2025-06-01' },
      { id: 'p2', hasOnsetDate: false, orderingDateString: '1977-01-01' },
    ],
  });
  check(index.get('p1') === true, 'buildOnsetDateIndex: confirmed onset -> true');
  check(index.get('p2') === false, 'buildOnsetDateIndex: fallback date -> false');
  check(normalisers.buildOnsetDateIndex(null) === null, 'buildOnsetDateIndex(null clinicalSummary) -> null');
  check(
    normalisers.buildOnsetDateIndex({ problems: [] }) instanceof Map,
    'buildOnsetDateIndex with an empty problems array still returns a (empty) Map, not null'
  );

  const listing = {
    activeProblems: [
      { id: 'p1', problemCodeDescription: 'Asthma', dateToDisplay: '2025-06-01' },
      { id: 'p2', problemCodeDescription: 'Finger fracture', dateToDisplay: '1977-01-01' },
      { id: 'p3', problemCodeDescription: 'Headache', dateToDisplay: '2026-01-01' }, // not in index
    ],
  };
  const { active } = normalisers.normaliseProblemsAll(listing, index);
  check(active.find((p) => p.id === 'p1').hasOnsetDate === true, 'normaliseProblemsAll joins hasOnsetDate: true from the index');
  check(active.find((p) => p.id === 'p2').hasOnsetDate === false, 'normaliseProblemsAll joins hasOnsetDate: false from the index');
  check(active.find((p) => p.id === 'p3').hasOnsetDate === null, 'an id absent from the index -> hasOnsetDate: null (unknown, not false)');
  check(active.find((p) => p.id === 'p1').codedDate === '2025-06-01', 'codedDate itself is unchanged by the join (still dateToDisplay)');

  const { active: activeNoIndex } = normalisers.normaliseProblemsAll(listing, null);
  check(
    activeNoIndex.every((p) => p.hasOnsetDate === null),
    'no onsetIndex at all (clinical-summary unavailable) -> hasOnsetDate: null for every problem'
  );
}

// ── earliestRegisterCodedDate: prioritise a confirmed onset date over an
// unconfirmed (but chronologically earlier) fallback date ───────────────────
console.log('\n--- earliestRegisterCodedDate: onset-date prioritisation ---');
{
  // Two matching problems: an OLD unconfirmed fallback date (1977, GP2GP-style
  // migration artefact) and a NEWER but CONFIRMED onset date (2026). The
  // confirmed one must win — an unconfirmed earlier date must not be trusted
  // over a later but genuinely confirmed one.
  const res = engine.earliestRegisterCodedDate(
    [
      { label: 'Asthma', codedDate: '1977-01-01', hasOnsetDate: false },
      { label: 'Asthma', codedDate: '2026-01-01', hasOnsetDate: true },
    ],
    astReg
  );
  check(res.date.toISOString().slice(0, 10) === '2026-01-01', 'confirmed onset date wins even though it is chronologically LATER than the unconfirmed one');
  check(res.dateIsOnset === true, 'result flagged dateIsOnset: true when a confirmed match was used');
}
{
  // No confirmed onset anywhere among the matches -> falls back to earliest
  // of the unconfirmed dates, flagged accordingly.
  const res = engine.earliestRegisterCodedDate(
    [
      { label: 'Asthma', codedDate: '2026-03-01', hasOnsetDate: false },
      { label: 'Asthma', codedDate: '2026-01-01', hasOnsetDate: null }, // unknown treated same as unconfirmed
    ],
    astReg
  );
  check(res.date.toISOString().slice(0, 10) === '2026-01-01', 'earliest of the unconfirmed matches used when none are confirmed onset');
  check(res.dateIsOnset === false, 'result flagged dateIsOnset: false when no confirmed match exists but a fallback date was found');
}
{
  const res = engine.earliestRegisterCodedDate([], astReg);
  check(res.date === null && res.dateIsOnset === null, 'no matches at all -> { date: null, dateIsOnset: null }');
}

// AST014 end-to-end: dateIsOnset rides on the chip as registerDateIsOnset.
{
  const chips = ast014Eval([{ label: 'Asthma', codedDate: '2025-06-01', hasOnsetDate: true }]);
  check(chips.length === 1 && chips[0].registerDateIsOnset === true, 'AST014 chip carries registerDateIsOnset: true for a confirmed onset date');
}
{
  const chips = ast014Eval([{ label: 'Asthma', codedDate: '2025-06-01', hasOnsetDate: false }]);
  check(chips.length === 1 && chips[0].registerDateIsOnset === false, 'AST014 chip carries registerDateIsOnset: false for an unconfirmed fallback date (the common case)');
}
{
  // Existing tests never set hasOnsetDate at all (undefined) — must behave
  // identically to false/null, not crash or silently treat as confirmed.
  const chips = ast014Eval([{ label: 'Asthma', codedDate: '2025-06-01' }]);
  check(chips.length === 1 && chips[0].registerDateIsOnset === false, 'a problem with no hasOnsetDate field at all is treated as unconfirmed, not confirmed');
}

// The actual date used must be visible in the evidence panel (where a
// clinician checks it) — a distinct "Diagnosis date used" fact, not just the
// confidence flag on the chip with no date attached anywhere.
{
  const chips = ast014Eval([{ label: 'Asthma', codedDate: '2025-06-01', hasOnsetDate: false }]);
  const fact = chips[0].evidence.facts.find((f) => f.label === 'Diagnosis date used');
  check(!!fact, 'AST014 evidence carries a "Diagnosis date used" fact');
  check(fact && fact.date === '2025-06-01', 'the fact carries the EXACT date earliestRegisterCodedDate computed, visible for the clinician to check');
  check(fact && /unconfirmed/i.test(fact.value), 'the fact\'s value says unconfirmed when registerDateIsOnset is false');
}
{
  const chips = ast014Eval([{ label: 'Asthma', codedDate: '2025-06-01', hasOnsetDate: true }]);
  const fact = chips[0].evidence.facts.find((f) => f.label === 'Diagnosis date used');
  check(fact && /confirmed onset/i.test(fact.value) && !/unconfirmed/i.test(fact.value), 'the fact says confirmed onset date when registerDateIsOnset is true');
}
// Authoritative-only register match (no underlying problem at all, e.g. via
// patientRegisters with zero matching problem text) still exposes the
// eligibility date correctly, distinct from the (necessarily null)
// Register precondition fact's own date.
{
  const chips = engine.evaluateQofIndicatorRule(
    ast014,
    {
      medications: [],
      observations: [],
      problems: [{ label: 'Asthma', codedDate: '2025-06-01', hasOnsetDate: false }],
      patientContext: {},
      _registerLookup: { ASTHMA: astReg },
      patientRegisters: [{ registerType: 'medicus-health/register-asthma', registerLabel: 'Asthma' }],
    },
    NOW
  );
  const regFact = chips[0].evidence.facts.find((f) => f.label === 'Register precondition');
  const dateFact = chips[0].evidence.facts.find((f) => f.label === 'Diagnosis date used');
  check(regFact && regFact.date == null, 'Register precondition fact has no date when the register match itself was authoritative (no problem entry)');
  check(dateFact && dateFact.date === '2025-06-01', 'Diagnosis date used fact still shows the real date even when register membership came via patientRegisters, not text-matching');
}

// ── noMatchingProblemCode: on-register per Medicus, but no corresponding
// problem code on the patient's own record — flagged as a warning, not
// silently trusted or silently dropped ───────────────────────────────────────
console.log('\n--- noMatchingProblemCode warning ---');
{
  const res = engine.patientOnRegister([], dmReg, [
    { registerType: 'medicus-health/diabetes-register', registerLabel: 'Diabetes' },
  ]);
  check(res.matched === true && res.noMatchingProblemCode === true, 'authoritative match with zero matching problems -> noMatchingProblemCode: true');
}
{
  const res = engine.patientOnRegister([{ label: 'Type 2 diabetes mellitus' }], dmReg, [
    { registerType: 'medicus-health/diabetes-register', registerLabel: 'Diabetes' },
  ]);
  check(res.matched === true && res.noMatchingProblemCode === false, 'authoritative match WITH a matching problem -> noMatchingProblemCode: false, no warning');
}
{
  // Text-match-only path (no medicusRegisterTypes, or patientRegisters
  // unavailable) never sets the flag — by definition a problem was found.
  const res = engine.patientOnRegister([{ label: 'Stroke' }], stiaReg, null);
  check(res.matched === true && !res.noMatchingProblemCode, 'text-match path never carries noMatchingProblemCode (a matching problem is required to match at all)');
}
// Propagates onto the plain register-membership chip (evaluateQofRegisterRule).
{
  const chips = engine.evaluateQofRegisterRule(dmReg, {
    problems: [],
    patientContext: {},
    patientRegisters: [{ registerType: 'medicus-health/diabetes-register', registerLabel: 'Diabetes' }],
  });
  check(chips.length === 1 && chips[0].noMatchingProblemCode === true, 'evaluateQofRegisterRule chip carries noMatchingProblemCode: true');
  check(
    chips[0].evidence.facts.some((f) => f.label === 'Warning'),
    'evaluateQofRegisterRule evidence carries an explicit Warning fact when noMatchingProblemCode'
  );
}
{
  const chips = engine.evaluateQofRegisterRule(dmReg, {
    problems: [{ label: 'Type 2 diabetes mellitus' }],
    patientContext: {},
    patientRegisters: [{ registerType: 'medicus-health/diabetes-register', registerLabel: 'Diabetes' }],
  });
  check(chips.length === 1 && chips[0].noMatchingProblemCode === false, 'no warning when a matching problem exists');
}
// Propagates onto a qof-indicator chip too (AST014, via requiresRegister).
{
  const chips = engine.evaluateQofIndicatorRule(
    ast014,
    {
      medications: [],
      observations: [],
      problems: [],
      patientContext: {},
      _registerLookup: { ASTHMA: astReg },
      patientRegisters: [{ registerType: 'medicus-health/register-asthma', registerLabel: 'Asthma' }],
    },
    NOW
  );
  // No matching problem at all means earliestRegisterCodedDate finds nothing,
  // so the requiresRegisterCodedFrom gate itself suppresses the chip — the
  // warning is subsumed by the date gate for THIS particular indicator. Confirms
  // the two mechanisms don't conflict (no crash, sensible no-chip outcome).
  check(chips.length === 0, 'AST014 with an authoritative-only match and no problem code at all raises no chip (date gate fails closed, as intended)');
}

// ── 2026-08-28: AST015 (asthma review) — same "never recorded is overdue,
// not no_data" fix as AST014, via the treatNeverRecordedAsOverdue opt-in
// (AST015 has no requiresRegisterCodedFrom — it must keep firing for
// long-standing register members regardless of how old their diagnosis is;
// only the STATUS, never the eligibility, is affected) ──────────────────────
console.log('\n--- AST015: treatNeverRecordedAsOverdue (never-recorded review) ---');
const ast015 = qof.rules.find((r) => r.indicatorCode === 'AST015');
check(!!ast015, 'AST015 indicator exists in qof-rules.json');
check(ast015.treatNeverRecordedAsOverdue === true, 'AST015 has treatNeverRecordedAsOverdue set');
check(!ast015.requiresRegisterCodedFrom, 'AST015 has NO requiresRegisterCodedFrom (unlike AST014 — eligibility must not be date-gated)');
const ast015Eval = (problems, observations) =>
  engine.evaluateQofIndicatorRule(
    ast015,
    { medications: [], observations: observations || [], problems, patientContext: {}, _registerLookup: { ASTHMA: astReg } },
    NOW
  );
check(
  ast015Eval([{ label: 'Asthma', codedDate: '2018-01-01', hasOnsetDate: true }]).length === 1,
  'AST015 still fires for a long-standing (2018) asthma diagnosis — eligibility is NOT date-gated'
);
check(
  ast015Eval([{ label: 'Asthma', codedDate: '2018-01-01', hasOnsetDate: true }])[0].status === 'overdue',
  'AST015: long-standing register member with NO review ever recorded → overdue (red), not no_data'
);
check(
  ast015Eval([{ label: 'Asthma', codedDate: '2026-05-01', hasOnsetDate: true }])[0].status === 'no_data',
  'AST015: recently-registered patient (still inside the window), no review yet → stays no_data (legitimate grace period)'
);
check(
  ast015Eval(
    [{ label: 'Asthma', codedDate: '2018-01-01', hasOnsetDate: true }],
    [{ name: 'Asthma review', value: 'done', date: '2024-01-01' }]
  )[0].status === 'overdue',
  'AST015: a stale (out-of-window) review still shows overdue as before (unaffected by the fix)'
);
check(
  ast015Eval(
    [{ label: 'Asthma', codedDate: '2018-01-01', hasOnsetDate: true }],
    [{ name: 'Asthma review', value: 'done', date: '2026-05-01' }]
  )[0].status === 'achieved',
  'AST015: an in-window review still shows achieved as before (unaffected by the fix)'
);
check(
  ast015Eval([{ label: 'Asthma', codedDate: null }]).length === 1 &&
    ast015Eval([{ label: 'Asthma', codedDate: null }])[0].status === 'no_data',
  'AST015: no usable register-coded date at all (undated problem) → falls back to no_data, not a crash or false overdue'
);
// Other observation-recent indicators without the opt-in are unaffected —
// same long-standing-register-member-with-no-observation scenario for a plain
// indicator must stay no_data (proves the flag is genuinely opt-in, not a
// global behaviour change).
{
  const plainRule = {
    type: 'qof-indicator',
    enabled: true,
    indicatorCode: 'PLAINTEST',
    requiresRegister: 'ASTHMA',
    check: { kind: 'observation-recent', observation: ['some review'], withinDays: 365 },
  };
  const chips = engine.evaluateQofIndicatorRule(
    plainRule,
    {
      medications: [],
      observations: [],
      problems: [{ label: 'Asthma', codedDate: '2018-01-01', hasOnsetDate: true }],
      patientContext: {},
      _registerLookup: { ASTHMA: astReg },
    },
    NOW
  );
  check(
    chips.length === 1 && chips[0].status === 'no_data',
    'a plain observation-recent indicator WITHOUT treatNeverRecordedAsOverdue stays no_data even for a long-standing register member — opt-in confirmed, not a blanket change'
  );
}

// ── 2026-08-28 Keeper: NDH register + NDH003 (new to Sentinel this run) ──────
// Confirmed against the full current QOF 2026/27 guidance (fetched and read in
// full) — was a held item (qof-ndh) pending exactly this confirmation.
console.log('\n--- NDH register + NDH003 (new 2026-08-28, non-diabetic hyperglycaemia / prior GDM) ---');
const ndhReg = qof.rules.find((r) => r.registerCode === 'NDH');
const ndh003 = qof.rules.find((r) => r.indicatorCode === 'NDH003');
check(!!ndhReg, 'NDH register exists in qof-rules.json');
check(ndhReg.ageMin === 18, 'NDH register enforces ageMin:18 per the QOF register definition');
check(!!ndh003, 'NDH003 indicator exists in qof-rules.json');
check(ndh003.points === 20 && ndh003.thresholds.lower === 50 && ndh003.thresholds.upper === 90, 'NDH003 is 20pts, 50-90% (confirmed against PRN02356)');
const onNdh = (label) => engine.patientOnRegister([{ label }], ndhReg).matched === true;
check(onNdh('Non-diabetic hyperglycaemia'), 'NDH register matches "Non-diabetic hyperglycaemia"');
check(onNdh('Prediabetes') && onNdh('Pre-diabetes'), 'NDH register matches prediabetes variants');
check(onNdh('Impaired glucose tolerance') && onNdh('Impaired fasting glycaemia'), 'NDH register matches IGT/IFG');
check(onNdh('Gestational diabetes'), 'NDH register matches gestational diabetes (the 26/27 cohort addition)');
check(
  onNdh('Gestational diabetes mellitus'),
  'NDH register matches "Gestational diabetes mellitus" — the "mellitus" suffix must not defeat the match'
);
check(
  !onNdh('Type 1 diabetes mellitus') && !onNdh('Type 2 diabetes mellitus'),
  'NDH register excludes genuine type 1/2 diabetes (superseded per the QOF register definition)'
);
check(
  !onNdh('Diabetes insipidus') && !onNdh('Family history of diabetes'),
  'NDH register excludes diabetes insipidus and negation-aware family-history mentions'
);
{
  const NOW = '2026-06-01T12:00:00Z';
  const ndh003Eval = (problems, observations) =>
    engine.evaluateQofIndicatorRule(
      ndh003,
      { medications: [], observations: observations || [], problems, patientContext: { ageYears: 45 }, _registerLookup: { NDH: ndhReg } },
      NOW
    );
  check(
    ndh003Eval([{ label: 'Prediabetes', codedDate: '2020-01-01' }], [{ name: 'HbA1c', value: '44', date: '2026-05-01' }])[0]
      .status === 'achieved',
    'NDH003 achieved with an in-window HbA1c'
  );
  check(
    ndh003Eval([{ label: 'Gestational diabetes', codedDate: '2020-01-01' }], [{ name: 'HbA1c', value: '44', date: '2024-01-01' }])[0]
      .status === 'overdue',
    'NDH003 overdue with a stale HbA1c, for a prior-GDM patient'
  );
  check(ndh003Eval([{ label: 'Asthma' }]).length === 0, 'NDH003 raises no chip for a patient not on the NDH register');
  // ageMin:18 was JSON-only until the registerAgeRange alias — a 16-year-old
  // with Prediabetes still raised NDH003. Runtime, not just the field.
  check(
    engine.evaluateQofRegisterRule(ndhReg, {
      problems: [{ label: 'Prediabetes' }],
      patientContext: { ageYears: 16 },
    }).length === 0,
    'NDH register chip suppressed for a 16-year-old (ageMin:18 enforced)'
  );
  check(
    engine.evaluateQofIndicatorRule(
      ndh003,
      {
        medications: [],
        observations: [{ name: 'HbA1c', value: '44', date: '2026-05-01' }],
        problems: [{ label: 'Prediabetes' }],
        patientContext: { ageYears: 16 },
        _registerLookup: { NDH: ndhReg },
      },
      NOW
    ).length === 0,
    'NDH003 raises no chip for a 16-year-old on the NDH problem list'
  );
  check(
    engine.evaluateQofIndicatorRule(
      ndh003,
      {
        medications: [],
        observations: [{ name: 'HbA1c', value: '44', date: '2026-05-01' }],
        problems: [{ label: 'Prediabetes' }],
        patientContext: { ageYears: 18 },
        _registerLookup: { NDH: ndhReg },
      },
      NOW
    ).length === 1,
    'NDH003 still fires at age 18 (inclusive bound)'
  );
  check(
    engine.evaluateQofIndicatorRule(
      ndh003,
      {
        medications: [],
        observations: [{ name: 'HbA1c', value: '44', date: '2026-05-01' }],
        problems: [{ label: 'Prediabetes' }],
        patientContext: {},
        _registerLookup: { NDH: ndhReg },
      },
      NOW
    ).length === 1,
    'NDH003 fail-open when age is unknown (same as every other age filter)'
  );
}

// ── 2026-08-28 Keeper: OB004/OB005 enabled (points/thresholds now confirmed) ─
console.log('\n--- OB004/OB005 enabled 2026-08-28 (points/thresholds confirmed against PRN02356) ---');
const ob004 = qof.rules.find((r) => r.indicatorCode === 'OB004');
const ob005 = qof.rules.find((r) => r.indicatorCode === 'OB005');
check(!!ob004 && ob004.enabled === true, 'OB004 is now enabled');
check(!/DRAFT/.test(ob004.indicatorName), 'OB004 indicatorName no longer carries the [DRAFT ... PENDING CONFIRMATION] marker');
check(!!ob005 && ob005.enabled === true, 'OB005 is now enabled');
check(!/DRAFT/.test(ob005.indicatorName), 'OB005 indicatorName no longer carries the [DRAFT ... PENDING CONFIRMATION] marker');
check(ob005.requiresRegister === 'OBES2', 'OB005 denominator is OBES2 (TA1026 / OBES2_REG), not the general OB register');
check(ob005.check.kind === 'pathway-bundle', 'OB005 achievement is pathway-bundle (coded, not drug brand names)');
check(ob005.points === 13 && ob005.thresholds.lower === 50 && ob005.thresholds.upper === 80, 'OB005 still 13pts / 50–80%');
check(!ob005.check.medicationMatch, 'OB005 no longer treats listed drug brand names as achievement');
{
  const obReg = qof.rules.find((r) => r.registerCode === 'OB');
  check(!!obReg && obReg.ageMin === 18, 'OB register still declares ageMin:18');
  check(
    engine.evaluateQofRegisterRule(obReg, {
      problems: [{ label: 'Obesity' }],
      patientContext: { ageYears: 16 },
    }).length === 0,
    'OB register chip suppressed for a 16-year-old (ageMin:18 now actually enforced)'
  );
  check(
    engine.evaluateQofRegisterRule(obReg, {
      problems: [{ label: 'Obesity' }],
      patientContext: { ageYears: 18 },
    }).length === 1,
    'OB register chip still fires at age 18'
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
