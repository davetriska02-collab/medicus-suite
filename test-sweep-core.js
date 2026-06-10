// Medicus Suite — Sweep core logic tests
// Run with: node test-sweep-core.js
//
// Imports sweep-core.js as an ES module (same technique as
// test-sentinel-panel-state.js uses vm; here we use --input-type=module
// via a dynamic import wrapper because sweep-core uses named exports).
//
// Coverage:
//   - extractBookedPatients: normal, missing-uuid, dedupe, cap, no-schedule field
//   - summariseSweep: sorting, zero-action split, error rows, hidden-rule marking

'use strict';

const { createRequire } = require('module');
const path = require('path');

// We need dynamic import for ES modules. Wrap in an async IIFE.
(async () => {
  let passed = 0, failed = 0;

  function check(cond, msg) {
    if (cond) { console.log(`  OK  ${msg}`); passed++; }
    else { console.error(`  FAIL  ${msg}`); failed++; process.exitCode = 1; }
  }

  // Dynamic import of the ES module
  const sweepCorePath = new URL(
    'side-panel/modules/sweep/sweep-core.js',
    `file://${path.resolve(__dirname)}/`
  ).href;

  let extractBookedPatients, summariseSweep, isActionNeeded, MAX_SWEEP_PATIENTS, ACTION_COLOURS;
  try {
    const mod = await import(sweepCorePath);
    extractBookedPatients = mod.extractBookedPatients;
    summariseSweep        = mod.summariseSweep;
    isActionNeeded        = mod.isActionNeeded;
    MAX_SWEEP_PATIENTS    = mod.MAX_SWEEP_PATIENTS;
    ACTION_COLOURS        = mod.ACTION_COLOURS;
  } catch (e) {
    console.error('FATAL: could not import sweep-core.js:', e.message);
    process.exit(1);
  }

  check(typeof extractBookedPatients === 'function', 'extractBookedPatients is a function');
  check(typeof summariseSweep === 'function', 'summariseSweep is a function');
  check(typeof isActionNeeded === 'function', 'isActionNeeded is a function');
  check(typeof MAX_SWEEP_PATIENTS === 'number' && MAX_SWEEP_PATIENTS > 0, `MAX_SWEEP_PATIENTS is a positive number (${MAX_SWEEP_PATIENTS})`);

  // ── isActionNeeded ────────────────────────────────────────────────────────────
  console.log('\n--- isActionNeeded ---');
  check(isActionNeeded('overdue')           === true,  'overdue → action needed');
  check(isActionNeeded('not_met')           === true,  'not_met → action needed');
  check(isActionNeeded('alert')             === true,  'alert → action needed');
  check(isActionNeeded('stale')             === true,  'stale → action needed (amber)');
  check(isActionNeeded('due_soon')          === true,  'due_soon → action needed (amber)');
  check(isActionNeeded('caution')           === true,  'caution → action needed (amber)');
  check(isActionNeeded('vax_due')           === true,  'vax_due → action needed (amber)');
  check(isActionNeeded('in_date')           === false, 'in_date → no action');
  check(isActionNeeded('achieved')          === false, 'achieved → no action');
  check(isActionNeeded('no_data')           === false, 'no_data → no action (neutral)');
  check(isActionNeeded('recently_initiated') === false, 'recently_initiated → no action');
  check(isActionNeeded('vax_given')         === false, 'vax_given → no action');

  // ── extractBookedPatients — normal payload ────────────────────────────────────
  console.log('\n--- extractBookedPatients: normal payload ---');
  const normalRaw = {
    schedule: {
      schedule: [{
        entries: [
          { diaryEntryType: { value: 'appointment' }, patient: { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Smith, Alice' }, start: '09:00' },
          { diaryEntryType: { value: 'appointment' }, patient: { id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Jones, Bob'   }, start: '09:30' },
          { diaryEntryType: { value: 'slot'        }, patient: { id: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Slot'         }, start: '10:00' },
        ]
      }]
    }
  };

  const normalResult = extractBookedPatients(normalRaw);
  check(normalResult.patients.length === 2, 'Two appointment entries → 2 patients');
  check(normalResult.patients[0].name === 'Smith, Alice', 'First patient name correct');
  check(normalResult.patients[1].name === 'Jones, Bob',   'Second patient name correct');
  check(normalResult.patients[0].uuid === 'aaaaaaaa-0000-0000-0000-000000000001', 'UUID extracted from patient.id');
  check(normalResult.missingUuidCount === 0, 'No missing UUIDs');
  check(normalResult.cappedAt === null, 'No cap applied');
  check(normalResult.diagnosticMessage === null, 'No diagnostic message');

  // ── extractBookedPatients — uuid fallback strategies ─────────────────────────
  console.log('\n--- extractBookedPatients: UUID fallback strategies ---');
  const uuidFallbackRaw = {
    schedule: {
      schedule: [{
        entries: [
          // Strategy: patient.uuid field
          { diaryEntryType: { value: 'appointment' }, patient: { uuid: 'bbbbbbbb-0000-0000-0000-000000000001', name: 'A' }, start: '08:00' },
          // Strategy: UUID in a string value on entry.patient
          { diaryEntryType: { value: 'appointment' }, patient: { name: 'B', someLink: '/patient/cccccccc-0000-0000-0000-000000000001/care-record' }, start: '08:10' },
        ]
      }]
    }
  };
  const fbResult = extractBookedPatients(uuidFallbackRaw);
  check(fbResult.patients.length === 2, 'Both UUID fallback strategies produce patients');
  check(fbResult.patients[0].uuid === 'bbbbbbbb-0000-0000-0000-000000000001', 'patient.uuid strategy works');
  check(fbResult.patients[1].uuid === 'cccccccc-0000-0000-0000-000000000001', 'UUID scan strategy works');

  // ── extractBookedPatients — missing UUID ──────────────────────────────────────
  console.log('\n--- extractBookedPatients: missing UUID ---');
  const missingUuidRaw = {
    schedule: {
      schedule: [{
        entries: [
          { diaryEntryType: { value: 'appointment' }, patient: { name: 'No UUID here'    }, start: '09:00' },
          { diaryEntryType: { value: 'appointment' }, patient: { id: 'dddddddd-0000-0000-0000-000000000001', name: 'Has UUID' }, start: '09:30' },
        ]
      }]
    }
  };
  const missingResult = extractBookedPatients(missingUuidRaw);
  check(missingResult.patients.length === 1,       '1 patient extracted (1 with UUID)');
  check(missingResult.missingUuidCount === 1,       'missingUuidCount = 1');
  check(missingResult.diagnosticMessage === null,   'No diagnostic message when at least one UUID found');

  // ── extractBookedPatients — ALL UUIDs missing (diagnostic) ───────────────────
  console.log('\n--- extractBookedPatients: all UUIDs missing → diagnostic ---');
  const allMissingRaw = {
    schedule: {
      schedule: [{
        entries: [
          { diaryEntryType: { value: 'appointment' }, patient: { name: 'No UUID A' }, start: '09:00' },
          { diaryEntryType: { value: 'appointment' }, patient: { name: 'No UUID B' }, start: '09:30' },
        ]
      }]
    }
  };
  const allMissingResult = extractBookedPatients(allMissingRaw);
  check(allMissingResult.patients.length === 0,     'No patients when all UUIDs missing');
  check(allMissingResult.missingUuidCount === 2,     'missingUuidCount = 2');
  check(typeof allMissingResult.diagnosticMessage === 'string', 'Diagnostic message present');
  check(allMissingResult.diagnosticMessage.includes('sweep unavailable'), 'Diagnostic includes "sweep unavailable"');

  // ── extractBookedPatients — no schedule field ─────────────────────────────────
  console.log('\n--- extractBookedPatients: no schedule field ---');
  const noScheduleResult = extractBookedPatients({});
  check(noScheduleResult.patients.length === 0, 'No patients from empty payload');
  check(typeof noScheduleResult.diagnosticMessage === 'string', 'Diagnostic message present for empty payload');

  const nullResult = extractBookedPatients(null);
  check(nullResult.patients.length === 0, 'No crash on null');

  // ── extractBookedPatients — deduplication ─────────────────────────────────────
  console.log('\n--- extractBookedPatients: deduplication ---');
  const dupeRaw = {
    schedule: {
      schedule: [{
        entries: [
          { diaryEntryType: { value: 'appointment' }, patient: { id: 'eeeeeeee-0000-0000-0000-000000000001', name: 'Same Patient' }, start: '09:00' },
          { diaryEntryType: { value: 'appointment' }, patient: { id: 'eeeeeeee-0000-0000-0000-000000000001', name: 'Same Patient' }, start: '10:00' },
          { diaryEntryType: { value: 'appointment' }, patient: { id: 'ffffffff-0000-0000-0000-000000000001', name: 'Other' }, start: '11:00' },
        ]
      }]
    }
  };
  const dupeResult = extractBookedPatients(dupeRaw);
  check(dupeResult.patients.length === 2, 'Duplicate patient (same UUID) deduped → 2 unique patients');

  // ── extractBookedPatients — cap ────────────────────────────────────────────────
  console.log('\n--- extractBookedPatients: cap at MAX_SWEEP_PATIENTS ---');
  const manyEntries = [];
  const totalPatients = MAX_SWEEP_PATIENTS + 5;
  for (let i = 0; i < totalPatients; i++) {
    // Build a valid, unique UUID: vary the 4th group using the index
    const idxHex = String(i).padStart(4, '0');
    const uuid = `aaaabbbb-cccc-dddd-${idxHex}-000000000001`;
    manyEntries.push({
      diaryEntryType: { value: 'appointment' },
      patient: { id: uuid, name: `Patient${i + 1}` },
      start: `${String(Math.floor(i / 2 + 8)).padStart(2,'0')}:${i % 2 === 0 ? '00' : '30'}`
    });
  }
  const capRaw = { schedule: { schedule: [{ entries: manyEntries }] } };
  const capResult = extractBookedPatients(capRaw);
  check(capResult.patients.length === MAX_SWEEP_PATIENTS, `Cap: exactly ${MAX_SWEEP_PATIENTS} patients returned`);
  check(capResult.cappedAt === totalPatients,              `cappedAt = ${totalPatients}`);

  // ── extractBookedPatients — time sorting ──────────────────────────────────────
  console.log('\n--- extractBookedPatients: time sorting ---');
  const sortRaw = {
    schedule: {
      schedule: [{
        entries: [
          { diaryEntryType: { value: 'appointment' }, patient: { id: 'aabbccdd-0000-0000-0003-000000000003', name: 'Third'  }, start: '11:00' },
          { diaryEntryType: { value: 'appointment' }, patient: { id: 'aabbccdd-0000-0000-0001-000000000001', name: 'First'  }, start: '09:00' },
          { diaryEntryType: { value: 'appointment' }, patient: { id: 'aabbccdd-0000-0000-0002-000000000002', name: 'Second' }, start: '10:00' },
        ]
      }]
    }
  };
  const sortResult = extractBookedPatients(sortRaw);
  check(sortResult.patients[0].name === 'First',  'Time sorting: first slot first');
  check(sortResult.patients[1].name === 'Second', 'Time sorting: second slot second');
  check(sortResult.patients[2].name === 'Third',  'Time sorting: third slot third');

  // ── summariseSweep — basic sorting ────────────────────────────────────────────
  console.log('\n--- summariseSweep: sorting ---');
  const sweepInput = [
    { uuid: 'uuid-1', name: 'AAmber', time: '09:00', chips: [
        { status: 'due_soon', ruleId: 'r1' }, { status: 'due_soon', ruleId: 'r2' }
      ], error: null, hiddenRuleIds: new Set()
    },
    { uuid: 'uuid-2', name: 'BRedAmber', time: '09:30', chips: [
        { status: 'overdue', ruleId: 'r3' }, { status: 'due_soon', ruleId: 'r4' }
      ], error: null, hiddenRuleIds: new Set()
    },
    { uuid: 'uuid-3', name: 'CRedRed', time: '10:00', chips: [
        { status: 'overdue', ruleId: 'r5' }, { status: 'not_met', ruleId: 'r6' }
      ], error: null, hiddenRuleIds: new Set()
    },
    { uuid: 'uuid-4', name: 'DClear', time: '10:30', chips: [
        { status: 'in_date', ruleId: 'r7' }
      ], error: null, hiddenRuleIds: new Set()
    },
  ];
  const summary = summariseSweep(sweepInput);
  check(summary.actionRows.length === 3, '3 action rows');
  check(summary.clearRows.length  === 1, '1 clear row');
  check(summary.errorRows.length  === 0, '0 error rows');
  // Most red first
  check(summary.actionRows[0].name === 'CRedRed',  'Most-red first: CRedRed first');
  check(summary.actionRows[1].name === 'BRedAmber', 'BRedAmber second (1 red, 1 amber)');
  check(summary.actionRows[2].name === 'AAmber',   'AAmber last (0 red, 2 amber)');
  check(summary.actionRows[0].redCount   === 2, 'redCount correct (2)');
  check(summary.actionRows[0].amberCount === 0, 'amberCount correct (0)');

  // ── summariseSweep — zero-action split ────────────────────────────────────────
  console.log('\n--- summariseSweep: zero-action split ---');
  const clearInput = [
    { uuid: 'uuid-x1', name: 'Xavier', time: '09:00', chips: [{ status: 'achieved', ruleId: 'r1' }], error: null, hiddenRuleIds: new Set() },
    { uuid: 'uuid-y1', name: 'Yvette', time: '09:30', chips: [],                                       error: null, hiddenRuleIds: new Set() },
  ];
  const clearSummary = summariseSweep(clearInput);
  check(clearSummary.actionRows.length === 0, 'No action rows for all-clear patients');
  check(clearSummary.clearRows.length  === 2, '2 clear rows');
  check(clearSummary.clearRows[0].name === 'Xavier', 'Clear rows sorted alphabetically');
  check(clearSummary.clearRows[1].name === 'Yvette', 'Clear rows sorted alphabetically (2)');

  // ── summariseSweep — error rows preserved ─────────────────────────────────────
  console.log('\n--- summariseSweep: error rows preserved ---');
  const errorInput = [
    { uuid: 'uuid-e1', name: 'Errored', time: '09:00', chips: null, error: 'HTTP 403', hiddenRuleIds: new Set() },
    { uuid: 'uuid-e2', name: 'Fine',    time: '09:30', chips: [{ status: 'overdue', ruleId: 'r1' }], error: null, hiddenRuleIds: new Set() },
  ];
  const errorSummary = summariseSweep(errorInput);
  check(errorSummary.errorRows.length  === 1,        '1 error row');
  check(errorSummary.actionRows.length === 1,        '1 action row');
  check(errorSummary.errorRows[0].name === 'Errored', 'Error row has correct name');
  check(errorSummary.errorRows[0].error === 'HTTP 403', 'Error message preserved');

  // ── summariseSweep — hidden-rule marking ──────────────────────────────────────
  console.log('\n--- summariseSweep: hidden-rule marking ---');
  const hiddenInput = [
    {
      uuid: 'uuid-h1',
      name: 'HiddenPatient',
      time: '09:00',
      chips: [
        { status: 'overdue', ruleId: 'drug-mtx' },  // this one is hidden
        { status: 'in_date', ruleId: 'drug-ramipril' },
      ],
      error: null,
      hiddenRuleIds: new Set(['drug-mtx']),
    },
  ];
  const hiddenSummary = summariseSweep(hiddenInput);
  // Hidden rules are NOT applied as suppression (CLINICAL-SAFETY-NOTICE limitation
  // 26): the hidden overdue chip still counts, so the patient stays on the worklist.
  check(hiddenSummary.actionRows.length === 1, 'Patient with hidden action chip stays an action row');
  check(hiddenSummary.clearRows.length  === 0, 'Hidden action chip does not demote patient to clear');
  check(hiddenSummary.actionRows[0].redCount === 1, 'Hidden overdue chip still counted as red');
  check(hiddenSummary.actionRows[0].hasHiddenActionChips === true, 'hasHiddenActionChips flagged on action row');

  // ── summariseSweep — empty / null input ───────────────────────────────────────
  console.log('\n--- summariseSweep: empty/null ---');
  const emptyS = summariseSweep([]);
  check(emptyS.actionRows.length === 0, 'Empty input → empty actionRows');
  check(emptyS.clearRows.length  === 0, 'Empty input → empty clearRows');
  check(emptyS.errorRows.length  === 0, 'Empty input → empty errorRows');

  const nullS = summariseSweep(null);
  check(nullS.actionRows.length === 0, 'null input → no crash');

  // ── hiddenRuleIds: array fallback (non-Set) ───────────────────────────────────
  console.log('\n--- summariseSweep: hiddenRuleIds array fallback ---');
  const arrayHiddenInput = [
    {
      uuid: 'uuid-z1', name: 'ArrayFallback', time: '09:00',
      chips: [{ status: 'overdue', ruleId: 'rx1' }],
      error: null,
      hiddenRuleIds: ['rx1'],  // array, not Set
    },
  ];
  const arrayS = summariseSweep(arrayHiddenInput);
  check(arrayS.actionRows.length === 1,               'Array hiddenRuleIds treated as Set → patient stays in action');
  check(arrayS.actionRows[0].hasHiddenActionChips === true, 'hasHiddenActionChips set via array path');

  // ── Final results ─────────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);

})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
