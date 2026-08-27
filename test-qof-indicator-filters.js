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
// The shipped non-QOF surveillance rules are tagged so the UI groups them apart from QOF.
const safetyRuleIds = [
  'trend-egfr-falling',
  'trend-hba1c-rising',
  'alert-hyperkalaemia',
  'trend-frailty-efi-rising',
  'trend-frailty-efi2-rising',
  'trend-frailty-cfs-rising',
  'alert-frailty-efi-uncoded',
  'alert-frailty-efi2-uncoded',
];
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

// ── 2026-07-11 Keeper: CKD002 indicator ──────────────────────────────────────
console.log('\n--- CKD002 indicator (BP ≤140/90 in CKD, new 2026-07-11) ---');
const ckd002 = qof.rules.find((r) => r.indicatorCode === 'CKD002');
check(!!ckd002, 'CKD002 indicator exists in qof-rules.json');
check(ckd002.enabled === true, 'CKD002 is enabled');

// ── 2026-07-11 Keeper: CKD003 indicator ──────────────────────────────────────
console.log('\n--- CKD003 indicator (ACEi/ARB in hypertensive CKD, new 2026-07-11) ---');
const ckd003 = qof.rules.find((r) => r.indicatorCode === 'CKD003');
check(!!ckd003, 'CKD003 indicator exists in qof-rules.json');
check(ckd003.enabled === true, 'CKD003 is enabled');

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

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
