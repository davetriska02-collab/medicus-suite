// Medicus Suite — Evaluation trace tests
// Run with: node test-evaluation-trace.js
//
// Exercises evaluatePatient({ trace:true }) in engine/rules-engine.js.
// Tests the trace envelope, per-evaluator emission, and buildPlainExplanation.

'use strict';
const engine = require('./engine/rules-engine.js');
const CR = require('./shared/chip-renderer.js');
const { evaluatePatient, listUnmatchedMedicationsDetailed } = engine;

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function med(name, startDate) {
  return { name, startDate: startDate || null };
}

function obs(name, date, value) {
  return { name, date, value: value != null ? value : null };
}

function drugRule(id, matchTerms, excludeTerms, tests, enabled) {
  return {
    id,
    type: 'drug-monitoring',
    drug: { match: matchTerms, exclude: excludeTerms || [] },
    tests: tests || [],
    source: `Test source for ${id}`,
    sharedCare: true,
    enabled: enabled !== false ? undefined : false,
  };
}

function testSpec(name, intervalDays, dueSoonDays) {
  return {
    name,
    testName: name,
    match: [name.toLowerCase()],
    intervalDays: intervalDays || 90,
    dueSoonDays: dueSoonDays || 14,
  };
}

function registerRule(id, registerCode, registerName, problemMatch) {
  return {
    id,
    type: 'qof-register',
    registerCode,
    registerName,
    problemMatch: problemMatch || [registerName.toLowerCase()],
    source: `Register source ${id}`,
  };
}

function indicatorRule(id, requiresRegister, checkKind, extra) {
  return Object.assign(
    {
      id,
      type: 'qof-indicator',
      indicatorCode: id.toUpperCase(),
      indicatorName: `Indicator ${id}`,
      requiresRegister: requiresRegister || null,
      check: { kind: checkKind || 'observation-threshold', observation: ['hba1c'], threshold: 58, operator: '<=' },
      source: `Indicator source ${id}`,
    },
    extra || {}
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1: Flag off (back-compat) — without trace returns plain array
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- Section 1: flag off back-compat ---');

{
  const rules = [drugRule('aza-001', ['azathioprine'], [], [testSpec('FBC', 90, 14)])];
  const meds = [med('Azathioprine 50mg tablets')];
  const o = [obs('Full blood count', '2026-01-01', null)];
  const now = '2026-06-10T00:00:00Z';

  const withoutTrace = evaluatePatient(meds, o, rules, { now });
  const withTrace = evaluatePatient(meds, o, rules, { now, trace: true });

  check(Array.isArray(withoutTrace), 'without trace: returns plain array');
  check(!Array.isArray(withTrace) && typeof withTrace === 'object', 'with trace: returns object');
  check(Array.isArray(withTrace.chips), 'with trace: has chips array');
  check(typeof withTrace.trace === 'object' && withTrace.trace !== null, 'with trace: has trace object');
  // Chip content must be identical
  check(withoutTrace.length === withTrace.chips.length, 'chip count same with/without trace');
  if (withoutTrace.length > 0 && withTrace.chips.length > 0) {
    check(withoutTrace[0].ruleId === withTrace.chips[0].ruleId, 'chip ruleId matches with/without trace');
    check(withoutTrace[0].status === withTrace.chips[0].status, 'chip status matches with/without trace');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 2: Drug rule overdue
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- Section 2: drug rule overdue ---');

{
  // last FBC 100 days ago, interval 90 → overdue
  const now = '2026-06-10T00:00:00Z';
  const obsDate = '2026-03-02'; // 100 days before June 10
  const rules = [drugRule('aza-001', ['azathioprine'], [], [testSpec('FBC', 90, 14)])];
  const meds = [med('Azathioprine 50mg tablets')];
  const o = [obs('FBC', obsDate, null)];

  const { chips, trace } = evaluatePatient(meds, o, rules, { now, trace: true });
  const entry = (trace.entries || []).find((e) => e.ruleId === 'aza-001');

  check(!!entry, 'trace entry exists for aza-001');
  check(entry.fired === true, 'entry fired=true');
  check(entry.status === 'overdue', 'entry status=overdue');
  check(entry.drugMatch && entry.drugMatch.matchedTerm === 'azathioprine', 'drugMatch.matchedTerm=azathioprine');
  check(entry.drugMatch.medName === 'Azathioprine 50mg tablets', 'drugMatch.medName correct');
  check(Array.isArray(entry.arithmetic) && entry.arithmetic.length === 1, 'arithmetic has 1 row');
  const arith = entry.arithmetic[0];
  check(arith.test === 'FBC', 'arithmetic test name=FBC');
  check(arith.daysSince === 100, 'arithmetic daysSince=100');
  check(arith.dueDate === '2026-05-31', 'arithmetic dueDate=obsDate+90d (2026-05-31)');
  check(arith.status === 'overdue', 'arithmetic status=overdue');
  check(entry.source === 'Test source for aza-001', 'source copied through');
  // chipRef format: ruleId|drugName
  check(entry.chipRef === 'aza-001|Azathioprine 50mg tablets', 'chipRef format correct');
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 3: Due-soon arithmetic (worked example)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- Section 3: due-soon arithmetic (14 Mar 2026, interval 90, now 10 Jun 2026) ---');

{
  // Last FBC 14 Mar 2026, interval 90 days, dueSoon 14 days, now 10 Jun 2026
  // daysSince = days between 2026-03-14 and 2026-06-10 = 88 days
  // dueDate = 2026-03-14 + 90d = 2026-06-12
  // 88d < 90d, 88d > 90-14=76d → due_soon
  const now = '2026-06-10T00:00:00Z';
  const rules = [drugRule('aza-002', ['azathioprine'], [], [testSpec('FBC', 90, 14)])];
  const meds = [med('Azathioprine 50mg tablets')];
  const o = [obs('FBC', '2026-03-14', null)];

  const { trace } = evaluatePatient(meds, o, rules, { now, trace: true });
  const entry = (trace.entries || []).find((e) => e.ruleId === 'aza-002');

  check(!!entry, 'trace entry exists');
  check(entry.fired === true, 'fired=true');
  check(entry.status === 'due_soon', 'status=due_soon');
  const arith = entry.arithmetic && entry.arithmetic[0];
  check(arith && arith.daysSince === 88, `daysSince=88 (got ${arith && arith.daysSince})`);
  check(arith && arith.dueDate === '2026-06-12', `dueDate=2026-06-12 (got ${arith && arith.dueDate})`);
  check(arith && arith.status === 'due_soon', 'arith.status=due_soon');
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 4: QOF indicator achieved
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- Section 4: QOF indicator achieved ---');

{
  const now = '2026-06-10T00:00:00Z';
  // DM register + indicator requiresRegister
  const regRule = registerRule('dm-reg', 'DM', 'Diabetes mellitus', ['diabetes']);
  const indRule = indicatorRule('dm-hba1c', 'DM', 'observation-threshold', {
    check: { kind: 'observation-threshold', observation: ['hba1c'], threshold: 58, operator: '<=' },
  });
  const rules = [regRule, indRule];
  const problems = [{ label: 'Type 2 diabetes mellitus', codedDate: '2020-01-01' }];
  const o = [obs('HbA1c', '2026-05-01', '52')];

  const { trace } = evaluatePatient([], o, rules, { now, problems, trace: true });
  const entry = (trace.entries || []).find((e) => e.ruleId === 'dm-hba1c');

  check(!!entry, 'trace entry for dm-hba1c exists');
  check(entry.fired === true, 'indicator fired=true');
  check(entry.status === 'achieved', `indicator status=achieved (got ${entry.status})`);
  check(
    entry.matchedRegisterProblem && entry.matchedRegisterProblem.label.toLowerCase().includes('diabetes'),
    'matchedRegisterProblem.label contains diabetes'
  );
  check(entry.matchedObs && entry.matchedObs.name === 'HbA1c', 'matchedObs.name=HbA1c');
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 5: Negative cases
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- Section 5: negative cases ---');

{
  const now = '2026-06-10T00:00:00Z';

  // (a) No matching med → skipReason='no-drug-match'
  {
    const rules = [drugRule('aza-001', ['azathioprine'], [], [testSpec('FBC', 90, 14)])];
    const { trace } = evaluatePatient([], [], rules, { now, trace: true });
    const entry = (trace.entries || []).find((e) => e.ruleId === 'aza-001');
    check(entry && entry.skipReason === 'no-drug-match', '(a) no med → skipReason=no-drug-match');
    check(entry && entry.fired === false, '(a) fired=false');
  }

  // (b) Disabled rule → skipReason='disabled'
  {
    const rules = [drugRule('aza-dis', ['azathioprine'], [], [], false)];
    const meds = [med('Azathioprine 50mg tablets')];
    const { trace } = evaluatePatient(meds, [], rules, { now, trace: true });
    const entry = (trace.entries || []).find((e) => e.ruleId === 'aza-dis');
    check(entry && entry.skipReason === 'disabled', '(b) disabled → skipReason=disabled');
    check(entry && entry.fired === false, '(b) fired=false');
  }

  // (c) Age-filtered rule → skipReason='age-filter'
  {
    const rule = Object.assign(drugRule('aza-age', ['azathioprine'], [], [testSpec('FBC', 90, 14)]), {
      ageRange: { min: 0, max: 30 },
    });
    const meds = [med('Azathioprine 50mg tablets')];
    const { trace } = evaluatePatient(meds, [], [rule], {
      now,
      patientContext: { ageYears: 71, sex: 'F' },
      trace: true,
    });
    const entry = (trace.entries || []).find((e) => e.ruleId === 'aza-age');
    check(entry && entry.skipReason === 'age-filter', '(c) age-filtered → skipReason=age-filter');
  }

  // (d) Indicator whose register precondition fails → skipReason='register-precondition'
  {
    const regRule = registerRule('dm-reg2', 'DM', 'Diabetes mellitus', ['diabetes']);
    const indRule = indicatorRule('dm-ind2', 'DM', 'observation-threshold');
    const { trace } = evaluatePatient([], [], [regRule, indRule], {
      now,
      problems: [{ label: 'Hypertension', codedDate: '2020-01-01' }], // NOT diabetes
      trace: true,
    });
    const entry = (trace.entries || []).find((e) => e.ruleId === 'dm-ind2');
    check(
      entry && entry.skipReason === 'register-precondition',
      `(d) register precondition fail → skipReason=register-precondition (got ${entry && entry.skipReason})`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 6: Unmatched meds detailed
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- Section 6: unmatched meds detailed ---');

{
  const rules = [drugRule('mtx-001', ['methotrexate'], ['injection'], [])];
  const meds = [
    med('Aspirin 75mg tablets'), // no rule → reason='no-rule'
    med('methotrexate 50mg/2ml injection'), // excluded → reason='excluded'
    med('Methotrexate 2.5mg tablets'), // matched → not in unmatched list
  ];
  const detailed = listUnmatchedMedicationsDetailed(meds, rules);

  const aspirin = detailed.find((u) => u.name === 'Aspirin 75mg tablets');
  const injMtx = detailed.find((u) => u.name.toLowerCase().includes('injection'));
  const tabMtx = detailed.find((u) => u.name === 'Methotrexate 2.5mg tablets');

  check(!!aspirin, 'Aspirin appears in unmatched');
  check(aspirin && aspirin.reason === 'no-rule', 'Aspirin reason=no-rule');
  check(aspirin && aspirin.excludedBy === null, 'Aspirin excludedBy=null');

  check(!!injMtx, 'MTX injection appears in unmatched');
  check(injMtx && injMtx.reason === 'excluded', 'MTX injection reason=excluded');
  check(injMtx && injMtx.excludedBy && injMtx.excludedBy.ruleId === 'mtx-001', 'excludedBy.ruleId=mtx-001');
  check(injMtx && injMtx.excludedBy && injMtx.excludedBy.term === 'injection', 'excludedBy.term=injection');

  check(!tabMtx, 'Methotrexate tablets NOT in unmatched (matched by rule)');

  // Also in trace envelope's unmatchedMedications when using trace
  const now = '2026-06-10T00:00:00Z';
  const { trace } = evaluatePatient(meds, [], rules, { now, trace: true, unmatchedDetailed: detailed });
  check(Array.isArray(trace.unmatchedMedications), 'trace.unmatchedMedications is array');
  const envelopeAspirin = trace.unmatchedMedications.find((u) => u.name === 'Aspirin 75mg tablets');
  check(!!envelopeAspirin, 'Aspirin in trace.unmatchedMedications when passed as option');
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 7: Envelope shape
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- Section 7: envelope shape ---');

{
  const now = '2026-06-10T00:00:00Z';
  const rules = [
    drugRule('aza-001', ['azathioprine'], [], [testSpec('FBC', 90, 14)]),
    drugRule('mtx-001', ['methotrexate'], [], [testSpec('FBC', 90, 14)], false), // disabled
  ];
  const meds = [med('Azathioprine 50mg tablets')];
  const o = [obs('FBC', '2026-03-02', null)];
  const { chips, trace } = evaluatePatient(meds, o, rules, {
    now,
    trace: true,
    patientContext: {
      patientUuid: 'uuid-123',
      nhsNumber: '999 111 2222',
      displayName: 'Test Patient',
      ageYears: 55,
      sex: 'M',
    },
  });

  check(trace.traceSchemaVersion === 1, 'traceSchemaVersion=1');
  check(typeof trace.generatedAt === 'string' && trace.generatedAt.includes('T'), 'generatedAt is ISO string');
  check(trace.now === now, 'trace.now matches options.now');

  // Patient block
  check(trace.patient && trace.patient.uuid === 'uuid-123', 'patient.uuid correct');
  check(trace.patient && trace.patient.nhsNumber === '999 111 2222', 'patient.nhsNumber correct');
  check(trace.patient && trace.patient.displayName === 'Test Patient', 'patient.displayName correct');
  check(trace.patient && trace.patient.ageYears === 55, 'patient.ageYears=55');
  check(trace.patient && trace.patient.sex === 'M', 'patient.sex=M');

  // Ruleset counts
  const { rulesConsidered, rulesFired, rulesSkipped } = trace.ruleset;
  check(rulesConsidered === trace.entries.length, `rulesConsidered === entries.length (${rulesConsidered})`);
  check(rulesFired + rulesSkipped === rulesConsidered, 'fired + skipped === considered');
  check(rulesFired > 0, 'at least one rule fired');

  // Chips summary
  check(Array.isArray(trace.chips), 'trace.chips is array');
  check(trace.chips.length === chips.length, 'trace.chips length matches chips length');
  if (trace.chips.length > 0) {
    check(
      'ruleId' in trace.chips[0] && 'type' in trace.chips[0] && 'status' in trace.chips[0],
      'chips[0] has ruleId, type, status'
    );
  }

  // Extraction block
  check(trace.extraction && typeof trace.extraction === 'object', 'trace.extraction exists');
  check(trace.extraction.medications === meds.length, `extraction.medications=${meds.length}`);
  check(trace.extraction.observations === o.length, `extraction.observations=${o.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 8: buildPlainExplanation
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- Section 8: buildPlainExplanation ---');

check(typeof CR.buildPlainExplanation === 'function', 'CR.buildPlainExplanation is a function');

if (typeof CR.buildPlainExplanation === 'function') {
  // Overdue entry
  const overdueEntry = {
    ruleId: 'aza-001',
    ruleType: 'drug-monitoring',
    fired: true,
    status: 'overdue',
    source: 'BNF / BSR DMARD shared care guideline',
    drugMatch: { medName: 'Azathioprine 50mg tablets', matchedTerm: 'azathioprine', excludedBy: null },
    arithmetic: [
      {
        test: 'FBC',
        observation: { name: 'Full blood count', date: '2026-03-02', value: null },
        intervalDays: 90,
        dueSoonDays: 14,
        daysSince: 100,
        dueDate: '2026-05-31',
        status: 'overdue',
      },
    ],
  };
  const overdueExpl = CR.buildPlainExplanation(overdueEntry);
  check(
    typeof overdueExpl === 'string' && overdueExpl.length > 0,
    'buildPlainExplanation returns non-empty string for overdue'
  );
  check(overdueExpl.includes('Azathioprine 50mg tablets'), 'overdue explanation contains drug name');
  check(overdueExpl.toLowerCase().includes('azathioprine'), 'overdue explanation contains matched term');
  check(
    overdueExpl.toLowerCase().includes('overdue') || overdueExpl.toLowerCase().includes('due'),
    'overdue explanation contains status phrase'
  );

  // Due-soon entry
  const dueSoonEntry = {
    ruleId: 'aza-002',
    ruleType: 'drug-monitoring',
    fired: true,
    status: 'due_soon',
    source: null,
    drugMatch: { medName: 'Azathioprine 50mg tablets', matchedTerm: 'azathioprine', excludedBy: null },
    arithmetic: [
      {
        test: 'FBC',
        observation: { name: 'Full blood count', date: '2026-03-14', value: null },
        intervalDays: 90,
        dueSoonDays: 14,
        daysSince: 88,
        dueDate: '2026-06-12',
        status: 'due_soon',
      },
    ],
  };
  const dueSoonExpl = CR.buildPlainExplanation(dueSoonEntry);
  check(typeof dueSoonExpl === 'string' && dueSoonExpl.length > 0, 'buildPlainExplanation returns string for due_soon');
  check(
    dueSoonExpl.includes('2026-06-12') || dueSoonExpl.toLowerCase().includes('jun'),
    'due_soon explanation contains due date'
  );
  check(dueSoonExpl.toLowerCase().includes('due'), 'due_soon explanation contains "due"');

  // Negative (not fired) entry
  const negEntry = {
    ruleId: 'aza-003',
    ruleType: 'drug-monitoring',
    fired: false,
    status: null,
    skipReason: 'no-drug-match',
  };
  const negExpl = CR.buildPlainExplanation(negEntry);
  check(typeof negExpl === 'string', 'buildPlainExplanation returns string for unfired entry');
  check(
    negExpl.toLowerCase().includes('not') ||
      negExpl.toLowerCase().includes('no') ||
      negExpl.toLowerCase().includes('skip'),
    'negative explanation mentions non-fire'
  );

  // Disabled entry
  const disabledEntry = {
    ruleId: 'aza-dis',
    ruleType: 'drug-monitoring',
    fired: false,
    status: null,
    skipReason: 'disabled',
  };
  const disabledExpl = CR.buildPlainExplanation(disabledEntry);
  check(typeof disabledExpl === 'string', 'buildPlainExplanation returns string for disabled entry');
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────────────`);
console.log(`Tests: ${passed + failed} total · ${passed} passed · ${failed} failed`);
if (failed === 0) {
  console.log('All tests passed.');
} else {
  console.error(`${failed} test(s) FAILED.`);
  process.exit(1);
}
