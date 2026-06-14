// Medicus Suite v1.1 — Custom Rule Tests
// Run with: node test-custom-rules.js
// Tests: custom rule evaluation, ID generation, merge into loadRules output,
//        QOF year logic isolation, chip renderer preview builder.

'use strict';

const engine = require('./engine/rules-engine.js');
const { validateCustomRule, generateCustomRuleId, defaultDueSoonDays, customRuleSchemaPrompt } = require('./shared/io/sentinel-io.js');
const chipRenderer = require('./shared/chip-renderer.js');

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCustomRule(overrides = {}) {
  return {
    id: 'custom-leflunomide-1716033600',
    type: 'drug-monitoring',
    enabled: true,
    drug: { match: ['leflunomide', 'arava'] },
    drugClass: 'DMARD',
    sharedCare: true,
    tests: [
      { name: 'FBC', match: ['fbc', 'full blood count'], intervalDays: 84, dueSoonDays: 28 },
      { name: 'LFT', match: ['lft', 'liver function'], intervalDays: 84, dueSoonDays: 28 },
    ],
    source: 'Custom rule (user-authored)',
    ...overrides,
  };
}

function makeMed(name, startDate) {
  return { name, startDate: startDate || null };
}

function makeObs(name, dateISO) {
  return { name, code: null, date: dateISO, value: '12.5' };
}

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Custom rule evaluation ────────────────────────────────────────────────────

console.log('\n--- Custom rule evaluation ---');

{
  const rule = makeCustomRule();
  const data = {
    medications: [makeMed('Leflunomide 10mg')],
    observations: [
      makeObs('FBC', daysAgo(30)),
      makeObs('LFT', daysAgo(30)),
    ],
    problems: [],
    patientContext: null,
  };
  const chips = engine.evaluateDrugRule(rule, data, today());
  assert(chips.length === 1, 'evaluateDrugRule: single chip for single matching med');
  assert(chips[0].type === 'drug-monitoring', 'evaluateDrugRule: chip type is drug-monitoring');
  assert(chips[0].status === 'in_date', 'evaluateDrugRule: in_date when both tests within interval');
  assert(chips[0].tests.length === 2, 'evaluateDrugRule: two test evaluations');
}

{
  const rule = makeCustomRule();
  const data = {
    medications: [makeMed('Leflunomide 10mg')],
    observations: [
      makeObs('FBC', daysAgo(100)),
      makeObs('LFT', daysAgo(30)),
    ],
    problems: [],
    patientContext: null,
  };
  const chips = engine.evaluateDrugRule(rule, data, today());
  assert(chips[0].status === 'overdue', 'evaluateDrugRule: overdue when FBC exceeds interval');
}

{
  const rule = makeCustomRule();
  const data = {
    medications: [makeMed('Leflunomide 10mg')],
    observations: [
      makeObs('FBC', daysAgo(60)),
      makeObs('LFT', daysAgo(60)),
    ],
    problems: [],
    patientContext: null,
  };
  const chips = engine.evaluateDrugRule(rule, data, today());
  assert(chips[0].status === 'due_soon', 'evaluateDrugRule: due_soon when within dueSoon window');
}

{
  const rule = makeCustomRule();
  const data = {
    medications: [makeMed('Leflunomide 10mg')],
    observations: [],
    problems: [],
    patientContext: null,
  };
  const chips = engine.evaluateDrugRule(rule, data, today());
  assert(chips[0].status === 'no_data', 'evaluateDrugRule: no_data when no observations');
}

{
  const rule = makeCustomRule();
  const data = {
    medications: [makeMed('Leflunomide 10mg'), makeMed('Arava 20mg')],
    observations: [makeObs('FBC', daysAgo(30)), makeObs('LFT', daysAgo(30))],
    problems: [],
    patientContext: null,
  };
  const chips = engine.evaluateDrugRule(rule, data, today());
  assert(chips.length === 2, 'evaluateDrugRule: two chips for two matching medications');
}

{
  // Exclude terms
  const rule = makeCustomRule({ drug: { match: ['leflunomide'], exclude: ['cream'] } });
  const data = {
    medications: [makeMed('Leflunomide cream 5%'), makeMed('Leflunomide 10mg tablets')],
    observations: [makeObs('FBC', daysAgo(30)), makeObs('LFT', daysAgo(30))],
    problems: [],
    patientContext: null,
  };
  const chips = engine.evaluateDrugRule(rule, data, today());
  assert(chips.length === 1, 'evaluateDrugRule: exclude terms filter out cream formulation');
  assert(chips[0].drugName.toLowerCase().includes('tablet'), 'evaluateDrugRule: only tablet retained');
}

{
  // Stale: observations older than 2x interval
  const rule = makeCustomRule();
  const data = {
    medications: [makeMed('Leflunomide 10mg')],
    observations: [makeObs('FBC', daysAgo(200)), makeObs('LFT', daysAgo(30))],
    problems: [],
    patientContext: null,
  };
  const chips = engine.evaluateDrugRule(rule, data, today());
  assert(chips[0].status === 'stale', 'evaluateDrugRule: stale when FBC > 2x interval');
}

{
  // recently_initiated suppresses no_data
  const rule = makeCustomRule();
  const data = {
    medications: [makeMed('Leflunomide 10mg', daysAgo(10))],
    observations: [],
    problems: [],
    patientContext: null,
  };
  const chips = engine.evaluateDrugRule(rule, data, today());
  assert(chips[0].status === 'recently_initiated', 'evaluateDrugRule: recently_initiated suppresses no_data for new prescriptions');
}

// ── Custom rules do not inherit QOF year logic ────────────────────────────────

console.log('\n--- Custom rule / QOF isolation ---');

{
  const customRule = makeCustomRule();
  // QOF indicator rule for comparison
  const qofRule = {
    id: 'qof-test-bp',
    type: 'qof-indicator',
    enabled: true,
    indicatorCode: 'HYP008',
    indicatorName: 'Hypertension BP',
    check: { kind: 'observation-threshold', observation: ['blood pressure', 'bp'], thresholdSystolic: 140, thresholdDiastolic: 90, withinDays: 365 },
    points: 38,
  };

  // evaluateDrugRule should return chips for custom rule without error
  const data = { medications: [makeMed('Leflunomide 10mg')], observations: [makeObs('FBC', daysAgo(30)), makeObs('LFT', daysAgo(30))], problems: [], patientContext: null };
  const chips = engine.evaluateDrugRule(customRule, data, today());
  assert(chips.length > 0, 'QOF isolation: custom drug rule evaluates without touching QOF year logic');
  assert(chips[0].type === 'drug-monitoring', 'QOF isolation: custom rule chip type is drug-monitoring not qof-indicator');

  // evaluateQofIndicatorRule on a QOF rule should not be affected by presence of custom rules
  const qofChips = engine.evaluateQofIndicatorRule(qofRule, { ...data, _registerLookup: { 'HYP': true } }, today());
  assert(Array.isArray(qofChips), 'QOF isolation: QOF indicator rule evaluates independently');
}

// ── Chip renderer preview builder ─────────────────────────────────────────────

console.log('\n--- Chip renderer ---');

{
  const rule = makeCustomRule();
  const statuses = ['in_date', 'due_soon', 'overdue', 'stale', 'no_data', 'recently_initiated'];
  for (const s of statuses) {
    const chip = chipRenderer.buildPreviewChip(rule, s, 'Leflunomide');
    assert(chip.type === 'drug-monitoring', `buildPreviewChip: type=drug-monitoring for status ${s}`);
    assert(chip.status === s, `buildPreviewChip: chip status matches requested ${s}`);
    assert(chip.isCustom === true, `buildPreviewChip: isCustom flag set for ${s}`);
    const html = chipRenderer.renderDrugChip(chip);
    assert(html.includes('sent-chip'), `renderDrugChip: produces sent-chip HTML for ${s}`);
    assert(html.includes('Leflunomide'), `renderDrugChip: drug name present for ${s}`);
    assert(html.includes('Custom'), `renderDrugChip: Custom tag present for ${s}`);
  }
}

{
  const rule = makeCustomRule({ drug: { match: ['leflunomide'] }, tests: [] });
  const chip = chipRenderer.buildPreviewChip(rule, 'in_date', 'Leflunomide');
  const html = chipRenderer.renderDrugChip(chip);
  assert(html.includes('sent-chip'), 'renderDrugChip: renders with zero tests without error');
}

// ── ID uniqueness (unit check) ────────────────────────────────────────────────

console.log('\n--- ID generation ---');

{
  const ids = new Set();
  for (let i = 0; i < 20; i++) {
    ids.add(generateCustomRuleId('methotrexate'));
    // Simulate slight time difference
  }
  // All generated in same ms will be equal; that is expected and caught by save-time uniqueness check.
  // What we test is that they all start with the right prefix.
  const allPrefixed = Array.from(ids).every(id => id.startsWith('custom-methotrexate-'));
  assert(allPrefixed, 'generateCustomRuleId: all IDs start with custom-methotrexate-');
}

{
  const id = generateCustomRuleId('Hydroxychloroquine Sulphate');
  assert(id.startsWith('custom-'), 'generateCustomRuleId: complex drug name produces valid prefix');
  assert(!/[A-Z\s]/.test(id), 'generateCustomRuleId: no uppercase or spaces in ID');
}

// ── defaultDueSoonDays ────────────────────────────────────────────────────────

console.log('\n--- defaultDueSoonDays ---');

{
  assert(defaultDueSoonDays(84)  === 28, 'defaultDueSoonDays: 12 weeks -> 28');
  assert(defaultDueSoonDays(365) === 28, 'defaultDueSoonDays: 52 weeks -> 28');
  assert(defaultDueSoonDays(180) === 28, 'defaultDueSoonDays: 26 weeks -> 28');
  assert(defaultDueSoonDays(42)  === Math.min(Math.round(42/6), 30), 'defaultDueSoonDays: 6 weeks uses formula');
  assert(defaultDueSoonDays(30)  <= 30, 'defaultDueSoonDays: capped at 30');
  assert(defaultDueSoonDays(7)   <= 30, 'defaultDueSoonDays: 1 week is sane');
}

// ── severityToStatus: non-time-based alert statuses ──────────────────────────
// drug-combo / event-count / composite alerts fire on presence/count/threshold,
// not on a recall interval, so they must NOT show the time-based vocabulary
// (OVERDUE / DUE SOON / IN DATE). They map to alert / caution / noted instead.

console.log('\n--- severityToStatus (non-time-based alerts) ---');

{
  assert(engine.severityToStatus('red')   === 'alert',   'severityToStatus: red -> alert (not overdue)');
  assert(engine.severityToStatus('amber') === 'caution', 'severityToStatus: amber -> caution (not due_soon)');
  assert(engine.severityToStatus('info')  === 'noted',   'severityToStatus: info -> noted (not in_date)');
  assert(engine.severityToStatus(undefined) === 'noted', 'severityToStatus: default -> noted');

  // Labels read correctly and carry the right colour
  assert(chipRenderer.STATUS_LABEL.alert   === 'ALERT',   'STATUS_LABEL: alert -> ALERT');
  assert(chipRenderer.STATUS_LABEL.caution === 'CAUTION', 'STATUS_LABEL: caution -> CAUTION');
  assert(chipRenderer.STATUS_LABEL.noted   === 'NOTED',   'STATUS_LABEL: noted -> NOTED');
  assert(chipRenderer.STATUS_COLOUR.alert   === 'red',     'STATUS_COLOUR: alert -> red');
  assert(chipRenderer.STATUS_COLOUR.caution === 'amber',   'STATUS_COLOUR: caution -> amber');
  assert(chipRenderer.STATUS_COLOUR.noted   === 'neutral', 'STATUS_COLOUR: noted -> neutral');

  // Ranking keeps alerts sorting with their time-based colour-peers
  assert(engine.STATUS_RANK.alert   === engine.STATUS_RANK.overdue,  'STATUS_RANK: alert ranks with overdue');
  assert(engine.STATUS_RANK.caution === engine.STATUS_RANK.due_soon, 'STATUS_RANK: caution ranks with due_soon');
}

// ── Custom-rule validation: check.kind and observation-bundle (Task 4b) ──────
// Exercises the extended validateCustomRule guards added to sentinel-io.js.

console.log('\n--- validateCustomRule: check.kind and observation-bundle ---');

function assertThrows(fn, msgPart, label) {
  let threw = false, errMsg = '';
  try { fn(); } catch (e) { threw = true; errMsg = e.message || ''; }
  assert(threw, `${label} (expected throw)`);
  if (threw && msgPart) {
    assert(errMsg.toLowerCase().includes(msgPart.toLowerCase()), `${label} error mentions "${msgPart}" (got: "${errMsg}")`);
  }
}

{
  // Unknown check.kind must be rejected
  assertThrows(
    () => validateCustomRule({ id: 'custom-test-1', type: 'qof-indicator',
      indicatorCode: 'LOC001', indicatorName: 'Test',
      check: { kind: 'unknown-kind', observation: ['bp'], threshold: 140, operator: '<=' } }),
    'check.kind',
    'validateCustomRule: unknown check.kind rejected'
  );
}

{
  // observation-bundle with empty observations must be rejected
  assertThrows(
    () => validateCustomRule({ id: 'custom-test-2', type: 'qof-indicator',
      indicatorCode: 'LOC002', indicatorName: 'Bundle test',
      check: { kind: 'observation-bundle', observations: [], withinDays: 365 } }),
    'non-empty',
    'validateCustomRule: observation-bundle with empty observations rejected'
  );
}

{
  // observation-bundle with non-empty observations must be accepted
  let threw = false;
  try {
    validateCustomRule({ id: 'custom-test-3', type: 'qof-indicator',
      indicatorCode: 'LOC003', indicatorName: 'Bundle valid',
      check: { kind: 'observation-bundle', observations: [['hba1c'], ['bmi']], withinDays: 365 } });
  } catch (e) { threw = true; }
  assert(!threw, 'validateCustomRule: valid observation-bundle accepted');
}

// ── customRuleSchemaPrompt: embedded examples validate ────────────────────────
// Extract EXAMPLE JSON blocks from the prompt using the stable markers and
// assert each example passes validateCustomRule. Guards schema-vs-validator drift.

console.log('\n--- customRuleSchemaPrompt: embedded example validation ---');

{
  const prompt = customRuleSchemaPrompt();
  assert(typeof prompt === 'string' && prompt.length > 200, 'customRuleSchemaPrompt: returns a non-trivial string');

  // Extract all example blocks between --- EXAMPLE JSON --- and --- END EXAMPLE ---
  const MARKER_START = '--- EXAMPLE JSON ---';
  const MARKER_END   = '--- END EXAMPLE ---';
  const examples = [];
  let searchFrom = 0;
  while (true) {
    const start = prompt.indexOf(MARKER_START, searchFrom);
    if (start === -1) break;
    const end = prompt.indexOf(MARKER_END, start + MARKER_START.length);
    if (end === -1) break;
    const jsonText = prompt.slice(start + MARKER_START.length, end).trim();
    examples.push(jsonText);
    searchFrom = end + MARKER_END.length;
  }

  assert(examples.length >= 2, `customRuleSchemaPrompt: at least 2 embedded examples found (got ${examples.length})`);

  examples.forEach((jsonText, i) => {
    let parsed;
    let parseErr = null;
    try { parsed = JSON.parse(jsonText); } catch (e) { parseErr = e.message; }
    assert(parseErr === null, `Example ${i + 1}: JSON.parse succeeds (${parseErr || 'ok'})`);
    if (parsed === null) return; // already failed

    // Accept single object or array
    const items = Array.isArray(parsed) ? parsed : [parsed];
    items.forEach((item, j) => {
      // Force enabled:false as the importer would, and ensure id starts with custom-
      const testItem = Object.assign({}, item);
      if (!testItem.id || !testItem.id.startsWith('custom-')) testItem.id = 'custom-test-' + i + '-' + j;
      testItem.enabled = false;
      let err = null;
      try { validateCustomRule(testItem, j); } catch (e) { err = e.message; }
      assert(err === null, `Example ${i + 1} item ${j + 1}: validateCustomRule passes (${err || 'ok'})`);
    });
  });
}

// ── alert-library: GLP-1 acute-pancreatitis awareness alert fires ────────────
// CSO-approved Keeper addition (2026-06-14): mhra-glp1-acute-pancreatitis is an
// awareness drug-combo alert modelled on the SGLT2 DKA entry. Assert the bundled
// library entry is well-formed and fires for a GLP-1/GIP patient via the real
// drug-combo evaluator (and does NOT fire for an unrelated med).

console.log('\n--- alert-library: GLP-1 acute-pancreatitis alert ---');

{
  const alertLib = require('./rules/alert-library.json');
  const glp1Entry = (alertLib.library || []).find(e => e.libId === 'mhra-glp1-acute-pancreatitis');
  assert(!!glp1Entry, 'alert-library contains mhra-glp1-acute-pancreatitis entry');
  assert(glp1Entry && glp1Entry.rule && glp1Entry.rule.type === 'drug-combo', 'GLP-1 alert is a drug-combo rule');
  assert(glp1Entry && glp1Entry.rule.enabled === true, 'GLP-1 alert is enabled');

  if (glp1Entry) {
    const rule = glp1Entry.rule;
    // Fires for a GLP-1 patient (brand and generic).
    for (const med of ['Ozempic 1mg', 'Semaglutide injection', 'Mounjaro 5mg', 'Trulicity 1.5mg']) {
      const data = { medications: [makeMed(med)], observations: [], problems: [], patientContext: null };
      const chips = engine.evaluateDrugComboRule(rule, data);
      assert(chips.length === 1, `GLP-1 alert fires for "${med}"`);
      if (chips.length) {
        assert(chips[0].type === 'drug-combo', `GLP-1 alert chip type is drug-combo for "${med}"`);
        assert(chips[0].status === 'caution', `GLP-1 alert status is caution (amber) for "${med}"`);
      }
    }
    // Does NOT fire for an unrelated med.
    const noMatch = engine.evaluateDrugComboRule(rule, { medications: [makeMed('Amlodipine 5mg')], observations: [], problems: [], patientContext: null });
    assert(noMatch.length === 0, 'GLP-1 alert does NOT fire for an unrelated med (amlodipine)');
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
