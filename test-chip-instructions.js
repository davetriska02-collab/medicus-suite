// Medicus Suite — chip-instruction characterisation & drift-guard test
// Run with: node test-chip-instructions.js
//
// DUAL PURPOSE:
//   1. Pins the CURRENT behaviour of sweep-core chipInstruction() and
//      sentinel _chipInstruction() before refactoring — characterisation test.
//   2. After the refactor (ws4 C2), the sentinel half flips to import from
//      sentinel-core.js instead of vm-extracting from sentinel.js.
//      The expected values MUST NOT change — that is the behaviour-preservation proof.
//
// KEY INTENTIONAL DIFFERENCES between sweep and sentinel (do NOT unify):
//   - QOF wording table: sweep has BP/SMI; sentinel has DEP/EP/RA/OB/AF/MH
//   - Action strings:   sweep says "Book a blood test appointment: ..."
//                       sentinel says "Book a blood test: ..."
//   - Fallback:         sweep says "Flag to the duty clinician"
//                       sentinel says "Flag to duty clinician" (no "the")
//   - Status filter:    sweep admits {overdue,stale,due_soon}
//                       sentinel admits STATUS_RANK<=2 (also not_met,alert,caution)
//
// See also: test-sweep-core.js (the second half of the behaviour-preservation proof).

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

// ── PHASE 1: shared helpers (chip-instructions.js) ─────────────────────────
// After the refactor these are imported from the new shared module.
// For now they are either vm-extracted from sweep-core or tested here directly.

console.log('\n--- shared: isBloodTest ---');
async function runTests() {
  // chip-instructions.js — import after refactor has been done
  let isBloodTest, groupInstructionsByAction;
  try {
    const mod = await import('./side-panel/modules/shared/chip-instructions.js');
    isBloodTest = mod.isBloodTest;
    groupInstructionsByAction = mod.groupInstructionsByAction;
    check(typeof isBloodTest === 'function', 'isBloodTest imported from chip-instructions.js');
    check(
      typeof groupInstructionsByAction === 'function',
      'groupInstructionsByAction imported from chip-instructions.js'
    );
  } catch (e) {
    // Before refactor: vm-extract from sweep-core.js source
    const sweepSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'sweep', 'sweep-core.js'), 'utf8');
    const reM = sweepSrc.match(/const NON_BLOOD_TEST_RE = .*;\nfunction isBloodTest\([\s\S]*?\n\}/);
    check(!!reM, 'NON_BLOOD_TEST_RE + isBloodTest extracted from sweep-core.js (pre-refactor path)');
    if (reM) {
      const sb = {};
      vm.runInNewContext(reM[0] + '\nthis.isBloodTest = isBloodTest;', sb);
      isBloodTest = sb.isBloodTest;
    }
    // groupInstructionsByAction: stub for pre-refactor — tested via buildHandout in test-sweep-core.js
    groupInstructionsByAction = null;
  }

  // isBloodTest — canonical test cases (venous bloods vs HCA checks)
  check(isBloodTest && isBloodTest('FBC') === true, "isBloodTest('FBC')                   === true");
  check(isBloodTest && isBloodTest('U&E') === true, "isBloodTest('U&E')                   === true");
  check(isBloodTest && isBloodTest('Lithium level') === true, "isBloodTest('Lithium level')          === true");
  check(isBloodTest && isBloodTest('LFT') === true, "isBloodTest('LFT')                    === true");
  check(isBloodTest && isBloodTest('Blood pressure') === false, "isBloodTest('Blood pressure')         === false");
  check(isBloodTest && isBloodTest('BP') === false, "isBloodTest('BP')                     === false");
  check(isBloodTest && isBloodTest('ECG') === false, "isBloodTest('ECG')                    === false");
  check(isBloodTest && isBloodTest('Peak flow') === false, "isBloodTest('Peak flow')              === false");
  check(isBloodTest && isBloodTest('Weight') === false, "isBloodTest('Weight')                 === false");
  check(isBloodTest && isBloodTest('Pulse') === false, "isBloodTest('Pulse')                  === false");

  // groupInstructionsByAction — unit tests (only reachable after refactor)
  if (groupInstructionsByAction) {
    console.log('\n--- shared: groupInstructionsByAction ---');

    // Returns [{action, details:[...]}] in insertion order; deduplicates details
    const chips1 = [
      { type: 'qof-indicator', status: 'not_met', indicatorCode: 'DM006', indicatorName: 'HbA1c' },
      { type: 'qof-indicator', status: 'not_met', indicatorCode: 'DM012', indicatorName: 'BP in DM' },
      { type: 'qof-indicator', status: 'not_met', indicatorCode: 'DM006', indicatorName: 'HbA1c' }, // duplicate
    ];
    // Use a simple instructionFn that mirrors the sweep-core QOF logic (DM → diabetes review)
    const simpleInstr = (chip) => {
      if (!chip || chip.status === 'in_date') return null;
      if (chip.type === 'qof-indicator') {
        const code = String(chip.indicatorCode || '').toUpperCase();
        const action = code.startsWith('DM') ? 'Book a diabetes review' : 'Book a review appointment';
        return { action, detail: chip.indicatorCode };
      }
      return null;
    };
    const groups1 = groupInstructionsByAction(chips1, simpleInstr);
    check(Array.isArray(groups1), 'groupInstructionsByAction returns array');
    check(groups1.length === 1, 'three chips all resolving to "diabetes review" → one group');
    check(groups1[0].action === 'Book a diabetes review', 'group action correct');
    check(groups1[0].details.length === 2, 'deduplicated: DM006 appears once, DM012 once → 2 details');
    check(groups1[0].details.join('; ') === 'DM006; DM012', 'details joined with "; " in insertion order');

    // null-returning instructionFn filters chips out
    const groups2 = groupInstructionsByAction(
      [{ type: 'qof-register', status: 'achieved', registerName: 'HYP' }],
      () => null
    );
    check(groups2.length === 0, 'chips returning null from instructionFn are excluded');
  }

  // ── PHASE 2: sweep-core chipInstruction (reception handout wording) ────────
  console.log('\n--- sweep-core chipInstruction ---');
  const sweepCorePath = new URL('side-panel/modules/sweep/sweep-core.js', `file://${path.resolve(__dirname)}/`).href;
  const sweepMod = await import(sweepCorePath);
  const sweepChipInstruction = sweepMod.chipInstruction;
  check(typeof sweepChipInstruction === 'function', 'sweep chipInstruction imported');

  // drug-monitoring: overdue bloods only
  let si = sweepChipInstruction({
    type: 'drug-monitoring',
    status: 'overdue',
    drugName: 'Lithium',
    tests: [
      { name: 'FBC', status: 'overdue' },
      { name: 'Blood pressure', status: 'overdue' },
    ],
  });
  check(
    si && si.action === 'Book a blood test and check appointment: FBC, Blood pressure',
    'sweep: drug-monitoring mixed bloods+checks → "Book a blood test and check appointment: ..."'
  );
  check(si && /Lithium monitoring overdue/.test(si.detail), 'sweep: drug detail "Lithium monitoring overdue"');

  // drug-monitoring: test with status 'caution' is EXCLUDED in sweep (not in filter set)
  let siCaution = sweepChipInstruction({
    type: 'drug-monitoring',
    status: 'overdue',
    drugName: 'Amiodarone',
    tests: [{ name: 'TFT', status: 'caution' }],
  });
  // caution is not in sweep's filter {overdue,stale,due_soon} → no due tests → "Book a monitoring appointment"
  check(
    siCaution && siCaution.action === 'Book a monitoring appointment',
    'sweep: drug test with status=caution is excluded (not in sweep filter) → generic monitoring appt'
  );

  // qof CHD → sweep-specific wording
  let siChd = sweepChipInstruction({
    type: 'qof-indicator',
    status: 'not_met',
    indicatorCode: 'CHD001',
    indicatorName: 'BP in CHD',
  });
  check(
    siChd && siChd.action === 'Book a long-term condition review',
    'sweep: CHD indicator → "Book a long-term condition review"'
  );

  // qof BP prefix (sweep has it, sentinel does not)
  let siBp = sweepChipInstruction({
    type: 'qof-indicator',
    status: 'not_met',
    indicatorCode: 'BP002',
    indicatorName: 'BP measure',
  });
  check(siBp && siBp.action === 'Book a blood pressure check', 'sweep: BP prefix → "Book a blood pressure check"');

  // vaccine
  let siVax = sweepChipInstruction({ type: 'vaccine', status: 'vax_due', displayName: 'RSV' });
  check(siVax && siVax.action === 'Offer to book: RSV', 'sweep: vaccine → "Offer to book: ..."');

  // unknown type → flag to duty clinician (sweep uses "the")
  let siUnk = sweepChipInstruction({ type: 'event-count', status: 'alert', label: 'Polypharmacy' });
  check(siUnk && siUnk.action === 'Flag to the duty clinician', 'sweep: unknown type → "Flag to the duty clinician"');

  // ── PHASE 3: sentinel chipInstruction (admin copy wording) ─────────────────
  console.log('\n--- sentinel chipInstruction ---');

  // After refactor: import from sentinel-core.js
  let sentinelChipInstruction, sentinelBuildAdminSummaryText, sentinelIsChipActionNeeded;
  try {
    const scPath = new URL('side-panel/modules/sentinel/sentinel-core.js', `file://${path.resolve(__dirname)}/`).href;
    const scMod = await import(scPath);
    sentinelChipInstruction = scMod.chipInstruction;
    sentinelBuildAdminSummaryText = scMod.buildAdminSummaryText;
    sentinelIsChipActionNeeded = scMod.isChipActionNeeded;
    check(typeof sentinelChipInstruction === 'function', 'sentinel chipInstruction imported from sentinel-core.js');
    check(typeof sentinelBuildAdminSummaryText === 'function', 'buildAdminSummaryText imported from sentinel-core.js');
  } catch (e) {
    // Pre-refactor: vm-extract _chipInstruction, _isChipActionNeeded, and buildAdminSummaryText from sentinel.js
    const sentSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'sentinel', 'sentinel.js'), 'utf8');
    // Extract STATUS_RANK (needed by _isChipActionNeeded and _chipInstruction)
    const statusRankM = sentSrc.match(/const STATUS_RANK\s*=\s*\{[^}]+\};/);
    check(!!statusRankM, 'STATUS_RANK extracted from sentinel.js (pre-refactor path)');

    // Extract _isChipActionNeeded
    const isNeededM = sentSrc.match(/function _isChipActionNeeded\([^)]*\) \{[^}]+\}/);
    check(!!isNeededM, '_isChipActionNeeded extracted from sentinel.js (pre-refactor path)');

    // Extract _NON_BLOOD_TEST_RE
    const nbtM = sentSrc.match(/const _NON_BLOOD_TEST_RE = .*;/);
    check(!!nbtM, '_NON_BLOOD_TEST_RE extracted from sentinel.js (pre-refactor path)');

    // Extract _QOF_ACTION_BY_PREFIX
    const qofM = sentSrc.match(/const _QOF_ACTION_BY_PREFIX = \[[\s\S]*?\];/);
    check(!!qofM, '_QOF_ACTION_BY_PREFIX extracted from sentinel.js (pre-refactor path)');

    // Extract _chipInstruction
    const ciM = sentSrc.match(/function _chipInstruction\([\s\S]*?\n\}/);
    check(!!ciM, '_chipInstruction extracted from sentinel.js (pre-refactor path)');

    // Extract buildAdminSummaryText (ends at the next top-level function)
    const bastM = sentSrc.match(/function buildAdminSummaryText\([\s\S]*?\n\}\s*\nfunction /);
    let bastSrc = null;
    if (bastM) {
      // Trim off the trailing 'function ' that was used as the end anchor
      bastSrc = bastM[0].slice(0, bastM[0].lastIndexOf('\nfunction '));
    }
    check(!!bastSrc, 'buildAdminSummaryText extracted from sentinel.js (pre-refactor path)');

    if (statusRankM && isNeededM && nbtM && qofM && ciM && bastSrc) {
      const sb = {};
      vm.runInNewContext(
        statusRankM[0] +
          '\n' +
          isNeededM[0] +
          '\n' +
          nbtM[0] +
          '\n' +
          qofM[0] +
          '\n' +
          ciM[0] +
          '\n' +
          bastSrc +
          '\n' +
          'this._isChipActionNeeded = _isChipActionNeeded;\n' +
          'this.sentinelChipInstruction = _chipInstruction;\n' +
          'this.buildAdminSummaryText = buildAdminSummaryText;',
        sb
      );
      sentinelChipInstruction = sb.sentinelChipInstruction;
      sentinelBuildAdminSummaryText = sb.buildAdminSummaryText;
      sentinelIsChipActionNeeded = sb._isChipActionNeeded;
    }
  }

  // drug-monitoring: overdue bloods + check — sentinel uses shorter action strings
  let sci =
    sentinelChipInstruction &&
    sentinelChipInstruction({
      type: 'drug-monitoring',
      status: 'overdue',
      drugName: 'Lithium',
      tests: [
        { name: 'FBC', status: 'overdue' },
        { name: 'Blood pressure', status: 'overdue' },
      ],
    });
  check(
    sci && sci.action === 'Book a blood test and check: FBC, Blood pressure',
    'sentinel: drug-monitoring mixed → "Book a blood test and check: ..." (shorter than sweep)'
  );
  check(sci && /Lithium monitoring overdue/.test(sci.detail), 'sentinel: drug detail "Lithium monitoring overdue"');

  // drug-monitoring: test with status 'caution' IS included in sentinel (STATUS_RANK <= 2)
  let sciCaution =
    sentinelChipInstruction &&
    sentinelChipInstruction({
      type: 'drug-monitoring',
      status: 'overdue',
      drugName: 'Amiodarone',
      tests: [{ name: 'TFT', status: 'caution' }],
    });
  check(
    sciCaution && sciCaution.action === 'Book a blood test: TFT',
    'sentinel: drug test with status=caution IS included (STATUS_RANK[caution]=2 ≤ 2)'
  );

  // qof CHD → sentinel-specific wording (different from sweep)
  let sciChd =
    sentinelChipInstruction &&
    sentinelChipInstruction({
      type: 'qof-indicator',
      status: 'not_met',
      indicatorCode: 'CHD001',
      indicatorName: 'BP in CHD',
    });
  check(
    sciChd && sciChd.action === 'Book a heart disease review',
    'sentinel: CHD indicator → "Book a heart disease review" (different from sweep)'
  );

  // qof BP002 in sentinel — BP prefix NOT in sentinel's table → fallback 'Book a review appointment'
  let sciBp =
    sentinelChipInstruction &&
    sentinelChipInstruction({
      type: 'qof-indicator',
      status: 'not_met',
      indicatorCode: 'BP002',
      indicatorName: 'BP measure',
    });
  check(
    sciBp && sciBp.action === 'Book a review appointment',
    'sentinel: BP prefix NOT in sentinel QOF table → fallback "Book a review appointment"'
  );

  // vaccine — sentinel returns null for vax_due because STATUS_RANK doesn't include it
  // (sentinel focuses on monitoring/QOF chips; vaccine chips are rendered separately).
  let sciVax =
    sentinelChipInstruction &&
    sentinelChipInstruction({
      type: 'vaccine',
      status: 'vax_due',
      displayName: 'RSV',
    });
  check(
    sciVax === null,
    'sentinel: vaccine with status=vax_due → null (vax_due not in STATUS_RANK, fails isChipActionNeeded)'
  );

  // unknown type → flag (sentinel has no "the")
  let sciUnk =
    sentinelChipInstruction &&
    sentinelChipInstruction({
      type: 'event-count',
      status: 'alert',
      label: 'Polypharmacy',
    });
  check(
    sciUnk && sciUnk.action === 'Flag to duty clinician',
    'sentinel: unknown type → "Flag to duty clinician" (no "the" — different from sweep)'
  );

  // ── PHASE 4: buildAdminSummaryText ─────────────────────────────────────────
  console.log('\n--- buildAdminSummaryText ---');

  // No action chips → "No monitoring appointments needed" header
  const noActionResult =
    sentinelBuildAdminSummaryText &&
    sentinelBuildAdminSummaryText([{ type: 'qof-register', status: 'achieved', registerName: 'HYP' }], {
      name: 'Smith, John',
      nhsNumber: '1234567890',
      dateOfBirth: '01-Jan-1960',
      age: '64',
      gender: 'Male',
    });
  check(
    noActionResult && noActionResult.startsWith('No monitoring appointments needed'),
    'buildAdminSummaryText: no action chips → "No monitoring appointments needed"'
  );
  check(noActionResult && /Smith, John/.test(noActionResult), 'buildAdminSummaryText: patient name in header');

  // NHS number fallback when no name
  const nhsFallback = sentinelBuildAdminSummaryText && sentinelBuildAdminSummaryText([], { nhsNumber: '9876543210' });
  check(nhsFallback && /NHS 9876543210/.test(nhsFallback), 'buildAdminSummaryText: NHS number fallback when no name');

  // Unknown patient
  const unknownResult = sentinelBuildAdminSummaryText && sentinelBuildAdminSummaryText([], null);
  check(
    unknownResult && /Unknown patient/.test(unknownResult),
    'buildAdminSummaryText: "Unknown patient" when no patient object'
  );

  // With action chips → "Appointments needed" header
  const withActions =
    sentinelBuildAdminSummaryText &&
    sentinelBuildAdminSummaryText(
      [
        {
          type: 'drug-monitoring',
          status: 'overdue',
          drugName: 'Methotrexate',
          tests: [{ name: 'FBC', status: 'overdue' }],
        },
        { type: 'qof-indicator', status: 'not_met', indicatorCode: 'CHD001', indicatorName: 'BP in CHD' },
      ],
      { name: 'Jones, Alice', nhsNumber: '1111111111', dateOfBirth: '15-Mar-1955', age: '71', gender: 'Female' }
    );
  check(
    withActions && withActions.startsWith('Appointments needed — Jones, Alice'),
    'buildAdminSummaryText: with action chips → "Appointments needed — <name>"'
  );
  check(
    withActions && /Book a blood test: FBC/.test(withActions),
    'buildAdminSummaryText: drug chip produces blood test line'
  );
  check(
    withActions && /Book a heart disease review/.test(withActions),
    'buildAdminSummaryText: CHD chip produces heart disease review line'
  );

  // ── Final results ───────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
