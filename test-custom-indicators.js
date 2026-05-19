// Medicus Suite v1.2 — Custom Indicator Tests
// Run with: node test-custom-indicators.js

'use strict';

const engine = require('./engine/rules-engine.js');
const { validateCustomRule } = require('./shared/io/sentinel-io.js');
const chipRenderer = require('./shared/chip-renderer.js');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  OK  ${msg}`); passed++; }
  else { console.error(`  FAIL  ${msg}`); failed++; }
}

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function makeObs(name, dateISO, value) {
  return { name, code: null, date: dateISO, value: value || '12.5' };
}

// ── observation-threshold (single threshold) ──────────────────────────────────

console.log('\n--- observation-threshold (single) ---');
{
  const rule = {
    id: 'custom-hba1c-1',
    type: 'qof-indicator',
    enabled: true,
    indicatorCode: 'LOCAL-HBA1C',
    indicatorName: 'HbA1c ≤ 58',
    check: { kind: 'observation-threshold', observation: ['hba1c'], threshold: 58, operator: '<=', withinDays: 365 },
    useQofYearFloor: false,
    requiresRegister: null,
  };
  const data = { medications: [], observations: [makeObs('HbA1c', daysAgo(30), '52')], problems: [], patientContext: null };
  const chips = engine.evaluateQofIndicatorRule(rule, data, today());
  assert(chips.length === 1, 'threshold: chip produced when no register required');
  assert(chips[0].status === 'achieved', 'threshold: 52 <= 58 → achieved');
}
{
  const rule = {
    id: 'custom-hba1c-2', type: 'qof-indicator', enabled: true,
    indicatorCode: 'LOCAL-HBA1C', indicatorName: 'HbA1c',
    check: { kind: 'observation-threshold', observation: ['hba1c'], threshold: 58, operator: '<=', withinDays: 365 },
    useQofYearFloor: false, requiresRegister: null,
  };
  const data = { medications: [], observations: [makeObs('HbA1c', daysAgo(30), '70')], problems: [], patientContext: null };
  const chips = engine.evaluateQofIndicatorRule(rule, data, today());
  assert(chips[0].status === 'not_met', 'threshold: 70 > 58 → not_met');
}

// ── observation-threshold (dual / BP) ─────────────────────────────────────────

console.log('\n--- observation-threshold (dual / BP) ---');
{
  const rule = {
    id: 'custom-bp-1', type: 'qof-indicator', enabled: true,
    indicatorCode: 'LOCAL-BP', indicatorName: 'BP ≤ 140/90',
    check: { kind: 'observation-threshold', observation: ['blood pressure','bp'], thresholdSystolic: 140, thresholdDiastolic: 90, withinDays: 365 },
    useQofYearFloor: false, requiresRegister: null,
  };
  const dataMet = { medications: [], observations: [makeObs('Blood pressure', daysAgo(30), '128/78')], problems: [], patientContext: null };
  const chipsMet = engine.evaluateQofIndicatorRule(rule, dataMet, today());
  assert(chipsMet[0].status === 'achieved', 'dual threshold: 128/78 ≤ 140/90 → achieved');

  const dataMiss = { ...dataMet, observations: [makeObs('Blood pressure', daysAgo(30), '156/96')] };
  const chipsMiss = engine.evaluateQofIndicatorRule(rule, dataMiss, today());
  assert(chipsMiss[0].status === 'not_met', 'dual threshold: 156/96 > 140/90 → not_met');
}

// ── medication-present ────────────────────────────────────────────────────────

console.log('\n--- medication-present ---');
{
  const rule = {
    id: 'custom-statin-1', type: 'qof-indicator', enabled: true,
    indicatorCode: 'LOCAL-STATIN', indicatorName: 'On a statin',
    check: { kind: 'medication-present', medicationMatch: ['atorvastatin','simvastatin','rosuvastatin'] },
    requiresRegister: null,
  };
  const data = { medications: [{ name: 'Atorvastatin 40mg', startDate: null }], observations: [], problems: [], patientContext: null };
  const chips = engine.evaluateQofIndicatorRule(rule, data, today());
  assert(chips[0].status === 'achieved', 'medication-present: atorvastatin matched → achieved');

  const noMed = { ...data, medications: [{ name: 'Aspirin 75mg' }] };
  const chips2 = engine.evaluateQofIndicatorRule(rule, noMed, today());
  assert(chips2[0].status === 'not_met', 'medication-present: no match → not_met');
}

// ── observation-recent ───────────────────────────────────────────────

console.log('\n--- observation-recent ---');
{
  const rule = {
    id: 'custom-frailty-1', type: 'qof-indicator', enabled: true,
    indicatorCode: 'LOCAL-FRAIL', indicatorName: 'Frailty review within 12m',
    check: { kind: 'observation-recent', observation: ['frailty review'], withinDays: 365 },
    useQofYearFloor: false,
    requiresRegister: null,
  };
  const dataRecent = { medications: [], observations: [makeObs('Frailty review', daysAgo(30))], problems: [], patientContext: null };
  const chipsR = engine.evaluateQofIndicatorRule(rule, dataRecent, today());
  assert(chipsR[0].status === 'achieved', 'obs-within: recorded within window → achieved');

  const dataOld = { medications: [], observations: [makeObs('Frailty review', daysAgo(500))], problems: [], patientContext: null };
  const chipsO = engine.evaluateQofIndicatorRule(rule, dataOld, today());
  assert(chipsO[0].status === 'overdue', 'obs-within: outside window → overdue');
}

// ── Register linkage ──────────────────────────────────────────────────────────

console.log('\n--- register linkage ---');
{
  const rule = {
    id: 'custom-bp-reg', type: 'qof-indicator', enabled: true,
    indicatorCode: 'LOCAL-BP-DM', indicatorName: 'BP for DM',
    check: { kind: 'observation-threshold', observation: ['bp'], thresholdSystolic: 140, thresholdDiastolic: 90 },
    useQofYearFloor: false, requiresRegister: 'DM',
  };
  // Mock a DM register rule that recognises "diabetes" problems
  const dmRegisterRule = { id: 'qof-dm-reg', registerCode: 'DM', problemMatch: ['diabetes'] };
  const onRegister = {
    medications: [], observations: [makeObs('BP', daysAgo(30), '128/78')],
    problems: [{ label: 'Type 2 diabetes mellitus' }],
    patientContext: null, _registerLookup: { DM: dmRegisterRule },
  };
  const offRegister = { ...onRegister, problems: [{ label: 'Hypertension' }] };
  assert(engine.evaluateQofIndicatorRule(rule, onRegister, today()).length === 1, 'register: fires when patient is on required register');
  assert(engine.evaluateQofIndicatorRule(rule, offRegister, today()).length === 0, 'register: silent when patient not on required register');
}

// ── QOF year floor opt-out ────────────────────────────────────────────────────

console.log('\n--- useQofYearFloor opt-out ---');
{
  // Pick a date that's been recorded just before the most recent 1 April.
  // With floor on: overdue. With floor off (rolling 365d): achieved.
  function mostRecent1Apr(now = new Date()) {
    const y = now.getUTCFullYear();
    const apr = new Date(Date.UTC(y, 3, 1));
    return now >= apr ? apr : new Date(Date.UTC(y - 1, 3, 1));
  }
  const apr = mostRecent1Apr();
  const justBefore = new Date(apr.getTime() - 5 * 86400000).toISOString().slice(0, 10);

  const baseRule = {
    type: 'qof-indicator', enabled: true,
    indicatorCode: 'TEST-FLOOR', indicatorName: 'Floor test',
    check: { kind: 'observation-threshold', observation: ['hba1c'], threshold: 58, operator: '<=', withinDays: 365 },
    requiresRegister: null,
  };
  const data = { medications: [], observations: [makeObs('HbA1c', justBefore, '52')], problems: [], patientContext: null };

  const withFloor = { ...baseRule, id: 'custom-floor-on', useQofYearFloor: true };
  const ch1 = engine.evaluateQofIndicatorRule(withFloor, data, today());
  assert(ch1[0].status === 'overdue', 'floor on: observation before 1 Apr → overdue');

  const withoutFloor = { ...baseRule, id: 'custom-floor-off', useQofYearFloor: false };
  const ch2 = engine.evaluateQofIndicatorRule(withoutFloor, data, today());
  assert(ch2[0].status === 'achieved', 'floor off: same observation within rolling 365d → achieved');
}

// ── Chip renderer for custom indicators ───────────────────────────────────────

console.log('\n--- chip renderer (custom indicator) ---');
{
  const rule = {
    id: 'custom-hba1c-r', type: 'qof-indicator',
    indicatorCode: 'LOCAL-HBA1C', indicatorName: 'HbA1c ≤ 58',
    check: { kind: 'observation-threshold', observation: ['hba1c'], threshold: 58, operator: '<=' },
    notes: 'Local agreement', source: 'https://example.com/protocol',
  };
  for (const s of ['achieved','not_met','overdue','no_data']) {
    const chip = chipRenderer.buildQofPreviewChip(rule, s);
    const html = chipRenderer.renderQofIndicatorChip(chip);
    assert(html.includes('sent-chip'), `renderQofIndicatorChip: HTML for ${s}`);
    assert(html.includes('Custom'), `renderQofIndicatorChip: Custom tag for ${s}`);
    assert(!html.includes('QOF '), `renderQofIndicatorChip: no QOF year tag for ${s}`);
    assert(html.includes('title='), `renderQofIndicatorChip: tooltip surfaces notes/source for ${s}`);
  }
}
{
  // Points: hidden if not set on custom chip
  const ruleNoPoints = {
    id: 'custom-no-pts', type: 'qof-indicator',
    indicatorCode: 'X', indicatorName: 'X',
    check: { kind: 'observation-threshold', observation: ['x'] },
  };
  const chip = chipRenderer.buildQofPreviewChip(ruleNoPoints, 'achieved');
  const html = chipRenderer.renderQofIndicatorChip(chip);
  assert(!html.includes('pt</span>'), 'custom chip: points hidden when not set');

  const rulePoints = { ...ruleNoPoints, points: 5 };
  const chipP = chipRenderer.buildQofPreviewChip(rulePoints, 'achieved');
  const htmlP = chipRenderer.renderQofIndicatorChip(chipP);
  assert(htmlP.includes('5pt'), 'custom chip: points shown when set');
}
{
  // Bundled (non-custom) chip should show QOF year tag, not Custom tag
  const chip = {
    type: 'qof-indicator', ruleId: 'qof-hyp-008',
    indicatorCode: 'HYP008', indicatorName: 'BP control',
    status: 'achieved', qofYear: '2025/26', qofYearStart: '2025-04-01',
    points: 38, dateText: '2025-09-10',
  };
  const html = chipRenderer.renderQofIndicatorChip(chip);
  assert(html.includes('QOF 2025/26'), 'bundled chip: shows QOF year tag');
  assert(!html.includes('sent-custom-tag'), 'bundled chip: no Custom tag');
}

// ── Validation ────────────────────────────────────────────────────────────────

console.log('\n--- validation ---');
function tryValidate(rule) {
  try { validateCustomRule(rule); return null; } catch (e) { return e.message; }
}
{
  const base = { id: 'custom-x', type: 'qof-indicator', indicatorCode: 'X', indicatorName: 'X',
    check: { kind: 'observation-threshold', observation: ['x'], threshold: 5, operator: '<=' } };
  assert(tryValidate(base) === null, 'valid threshold rule passes');
  assert(tryValidate({ ...base, indicatorCode: '' })?.includes('indicatorCode'), 'rejects empty indicatorCode');
  assert(tryValidate({ ...base, indicatorName: '' })?.includes('indicatorName'), 'rejects empty indicatorName');
  assert(tryValidate({ ...base, check: { kind: 'bogus' } })?.includes('kind'), 'rejects invalid check.kind');
  assert(tryValidate({ ...base, check: { kind: 'observation-threshold', observation: [] } })?.includes('non-empty'), 'rejects empty observation match');
  assert(tryValidate({ ...base, check: { kind: 'observation-threshold', observation: ['x'] } })?.includes('threshold'), 'rejects missing threshold + operator');
  assert(tryValidate({ ...base, check: { kind: 'observation-threshold', observation: ['x'], threshold: 5, operator: 'bad' } })?.includes('operator'), 'rejects invalid operator');
  assert(tryValidate({ ...base, requiresRegister: 'BOGUS' })?.includes('requiresRegister'), 'rejects unknown register');
  assert(tryValidate({ ...base, requiresRegister: 'DM' }) === null, 'accepts known register');
  assert(tryValidate({ ...base, points: -5 })?.includes('points'), 'rejects negative points');
  assert(tryValidate({ ...base, useQofYearFloor: 'yes' })?.includes('useQofYearFloor'), 'rejects non-boolean useQofYearFloor');
}
{
  const medRule = { id: 'custom-m', type: 'qof-indicator', indicatorCode: 'M', indicatorName: 'M',
    check: { kind: 'medication-present', medicationMatch: ['statin'] } };
  assert(tryValidate(medRule) === null, 'valid medication-present rule passes');
  assert(tryValidate({ ...medRule, check: { kind: 'medication-present', medicationMatch: [] } })?.includes('medicationMatch'), 'rejects empty medicationMatch');
}
{
  const withinRule = { id: 'custom-w', type: 'qof-indicator', indicatorCode: 'W', indicatorName: 'W',
    check: { kind: 'observation-recent', observation: ['frailty'], withinDays: 365 } };
  assert(tryValidate(withinRule) === null, 'valid observation-recent rule passes');
  assert(tryValidate({ ...withinRule, check: { kind: 'observation-recent', observation: ['x'], withinDays: 0 } })?.includes('withinDays'), 'rejects withinDays <= 0');
}

// ── Mixed customRules array (drug + indicator round-trips through validator) ──

console.log('\n--- mixed customRules array ---');
{
  const drugRule = {
    id: 'custom-leflunomide-1', type: 'drug-monitoring',
    drug: { match: ['leflunomide'] },
    tests: [{ name: 'FBC', match: ['fbc'], intervalDays: 84 }],
  };
  const indicatorRule = {
    id: 'custom-hba1c-1', type: 'qof-indicator',
    indicatorCode: 'X', indicatorName: 'X',
    check: { kind: 'observation-threshold', observation: ['hba1c'], threshold: 58, operator: '<=' },
  };
  let threw = false;
  try { validateCustomRule(drugRule); validateCustomRule(indicatorRule); }
  catch { threw = true; }
  assert(!threw, 'mixed customRules: both types validate independently');
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
