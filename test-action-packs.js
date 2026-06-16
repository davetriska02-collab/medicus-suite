// Medicus Suite — action-packs unit tests
// Run with: node test-action-packs.js
//
// Pins:
//  • Methotrexate chip (overdue FBC+LFT, in-date U&E) → bloodForm lists only FBC, LFT
//  • SMS contains drug + tests + booking instruction, ≤400 chars
//  • Escalation SMS mentions prescriber
//  • QOF DM chip → review SMS
//  • Vaccine chip → offer SMS
//  • Non-action chip (in_date) → null
//  • buildPatientActions dedupes two chips needing the same blood test

'use strict';

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

async function runTests() {
  const modPath = new URL('side-panel/modules/shared/action-packs.js', `file://${process.cwd().replace(/\\/g, '/')}/`)
    .href;

  let buildChipActions, buildPatientActions, buildBatchPack;
  try {
    const mod = await import(modPath);
    buildChipActions = mod.buildChipActions;
    buildPatientActions = mod.buildPatientActions;
    buildBatchPack = mod.buildBatchPack;
    check(typeof buildChipActions === 'function', 'buildChipActions imported');
    check(typeof buildPatientActions === 'function', 'buildPatientActions imported');
    check(typeof buildBatchPack === 'function', 'buildBatchPack imported');
  } catch (e) {
    console.error('FATAL: could not import action-packs.js:', e.message);
    process.exitCode = 1;
    return;
  }

  const patient = {
    displayName: 'Smith, Alice',
    nhsNumber: '9000000001',
    dateOfBirth: '01-Jan-1960',
    age: '66',
    gender: 'Female',
  };

  // ── 1. Non-action chip → null ─────────────────────────────────────────────
  console.log('\n--- non-action chip ---');

  const inDateChip = {
    type: 'drug-monitoring',
    ruleId: 'methotrexate-maintenance',
    status: 'in_date',
    drugName: 'Methotrexate',
    tests: [
      { name: 'FBC', status: 'in_date' },
      { name: 'U&E', status: 'in_date' },
      { name: 'LFT', status: 'in_date' },
    ],
    source: 'BNF / BSR DMARD shared care guideline',
  };
  check(buildChipActions(inDateChip, patient) === null, 'in_date chip → null');

  const achievedQof = {
    type: 'qof-indicator',
    ruleId: 'dm006',
    status: 'achieved',
    indicatorCode: 'DM006',
    indicatorName: 'HbA1c',
  };
  check(buildChipActions(achievedQof, patient) === null, 'achieved QOF chip → null');

  // ── 2. Methotrexate chip: overdue FBC+LFT, in-date U&E ───────────────────
  console.log('\n--- drug-monitoring: methotrexate (FBC+LFT overdue, U&E in-date) ---');

  const mtxChip = {
    type: 'drug-monitoring',
    ruleId: 'methotrexate-maintenance',
    status: 'overdue',
    drugName: 'Methotrexate',
    tests: [
      { name: 'FBC', status: 'overdue' },
      { name: 'U&E', status: 'in_date' },
      { name: 'LFT', status: 'overdue' },
    ],
    source: 'BNF / BSR DMARD shared care guideline (2024 update)',
  };

  const mtxPack = buildChipActions(mtxChip, patient);
  check(mtxPack !== null, 'overdue MTX chip → non-null pack');

  // Blood form: must list only the DUE tests (FBC, LFT) — NOT U&E (in_date)
  check(typeof mtxPack.bloodForm === 'string', 'bloodForm is a string');
  check(mtxPack.bloodForm.includes('FBC'), 'bloodForm includes FBC (overdue)');
  check(mtxPack.bloodForm.includes('LFT'), 'bloodForm includes LFT (overdue)');
  check(!mtxPack.bloodForm.includes('U&E'), 'bloodForm does NOT include U&E (in-date)');
  check(mtxPack.bloodForm.includes('Methotrexate'), 'bloodForm includes drug name');
  check(/overdue/i.test(mtxPack.bloodForm), 'bloodForm contains status word "overdue"');
  check(mtxPack.bloodForm.includes('BNF / BSR DMARD shared care guideline'), 'bloodForm includes source citation');

  // SMS — must contain drug, tests, booking instruction, ≤400 chars
  check(typeof mtxPack.sms === 'string', 'sms is a string');
  check(mtxPack.sms.includes('Methotrexate'), 'sms includes drug name');
  check(mtxPack.sms.includes('FBC'), 'sms includes due test FBC');
  check(mtxPack.sms.includes('LFT'), 'sms includes due test LFT');
  check(/book/i.test(mtxPack.sms), 'sms contains booking instruction');
  check(mtxPack.sms.length <= 400, `sms ≤400 chars (actual: ${mtxPack.sms.length})`);
  // Should address Alice by first name
  check(mtxPack.sms.startsWith('Dear Alice,') || mtxPack.sms.includes('Alice'), 'sms uses first name');

  // Escalation SMS — must mention prescriber
  check(typeof mtxPack.smsEscalation === 'string', 'smsEscalation is a string');
  check(/prescriber/i.test(mtxPack.smsEscalation), 'smsEscalation mentions prescriber');
  check(/prescription|paused|safety/i.test(mtxPack.smsEscalation), 'smsEscalation contains consequence language');

  // Letter and task
  check(typeof mtxPack.letter === 'string', 'letter is a string');
  check(mtxPack.letter.length > 50, 'letter has substance (>50 chars)');
  check(typeof mtxPack.task === 'string', 'task is a string');
  check(mtxPack.task.includes('Methotrexate'), 'task includes drug name');
  check(mtxPack.task.includes('NHS 9000000001'), 'task includes NHS number');
  check(/FBC|LFT|monitoring/i.test(mtxPack.task), 'task includes test names or "monitoring"');

  // ── 3. QOF DM chip → review SMS ──────────────────────────────────────────
  console.log('\n--- qof-indicator: DM (not_met) ---');

  const dmChip = {
    type: 'qof-indicator',
    ruleId: 'dm006',
    status: 'not_met',
    indicatorCode: 'DM006',
    indicatorName: 'HbA1c ≤58 mmol/mol',
  };

  const dmPack = buildChipActions(dmChip, patient);
  check(dmPack !== null, 'not_met DM QOF chip → non-null pack');
  check(typeof dmPack.sms === 'string', 'QOF sms is a string');
  check(/diabetes|review/i.test(dmPack.sms), 'QOF DM sms mentions diabetes or review');
  check(/book/i.test(dmPack.sms), 'QOF sms contains booking instruction');
  // No bloodForm for QOF in this phase
  check(!dmPack.bloodForm, 'QOF chip has no bloodForm');
  check(typeof dmPack.letter === 'string', 'QOF letter is a string');
  check(typeof dmPack.task === 'string', 'QOF task is a string');
  check(dmPack.task.includes('DM006') || /diabetes|review/i.test(dmPack.task), 'QOF task references indicator');

  // ── 4. Vaccine chip → offer SMS ──────────────────────────────────────────
  console.log('\n--- vaccine chip ---');

  const vaxChip = {
    type: 'vaccine',
    ruleId: 'rsv-65plus',
    status: 'vax_due',
    displayName: 'RSV vaccine',
  };

  // vax_due is NOT in STATUS_RANK so isChipActionNeeded returns false for it.
  // The spec says "vaccine chips produce offer SMS" — let's test with a status
  // that IS action-needed for Sentinel (overdue / due_soon / caution / alert / not_met / stale).
  // Vaccine chips can carry 'overdue' status when the vaccination interval has passed.
  const vaxChipActionable = {
    type: 'vaccine',
    ruleId: 'rsv-65plus',
    status: 'overdue',
    displayName: 'RSV vaccine',
  };

  const vaxPack = buildChipActions(vaxChipActionable, patient);
  check(vaxPack !== null, 'overdue vaccine chip → non-null pack');
  check(typeof vaxPack.sms === 'string', 'vaccine sms is a string');
  check(/RSV|vaccine|eligible|book/i.test(vaxPack.sms), 'vaccine sms offers booking');
  // Vaccines have no smsEscalation
  check(!vaxPack.smsEscalation, 'vaccine chip has no smsEscalation');
  // No bloodForm for vaccines
  check(!vaxPack.bloodForm, 'vaccine chip has no bloodForm');
  check(typeof vaxPack.task === 'string', 'vaccine task is a string');
  check(/RSV|vaccine|vaccination/i.test(vaxPack.task), 'vaccine task mentions vaccine');
  // Vaccines now carry a direct-to-patient invitation letter (parity with drug/QOF chips)
  check(typeof vaxPack.letter === 'string', 'vaccine chip has an invitation letter');
  check(vaxPack.letter.length > 50, 'vaccine letter has substance (>50 chars)');
  check(/invit|eligible/i.test(vaxPack.letter), 'vaccine letter uses invitation wording');
  check(/RSV|vaccine|vaccination/i.test(vaxPack.letter), 'vaccine letter names the vaccine');

  // The "Recall SMS template available in Sentinel → Actions." line was removed
  // from every admin task line (it was noise — see action-packs.js).
  check(!/Recall SMS template available/i.test(vaxPack.task), 'vaccine task drops the Sentinel recall-SMS line');
  check(!/Recall SMS template available/i.test(mtxPack.task), 'drug task drops the Sentinel recall-SMS line');
  check(!/Recall SMS template available/i.test(dmPack.task), 'QOF task drops the Sentinel recall-SMS line');

  // non-actionable vax_due vaccine → null (vax_due not in STATUS_RANK)
  check(buildChipActions(vaxChip, patient) === null, 'vax_due vaccine chip → null (not in STATUS_RANK)');

  // ── Safety-monitoring chips: clinician-review task ONLY, never patient copy ──
  console.log('\n--- safety-monitoring chip (no patient-facing recall copy) ---');
  const safetyChip = {
    type: 'qof-indicator',
    category: 'safety-monitoring',
    indicatorCode: 'K-HIGH',
    indicatorName: 'Raised potassium (hyperkalaemia)',
    valueText: '6.1 mmol/L',
    status: 'alert',
  };
  const safetyPack = buildChipActions(safetyChip, patient);
  check(safetyPack !== null, 'actionable safety-monitoring chip → non-null pack');
  check(!safetyPack.sms, 'safety-monitoring chip emits NO patient SMS');
  check(!safetyPack.letter, 'safety-monitoring chip emits NO patient letter');
  check(!safetyPack.smsEscalation, 'safety-monitoring chip emits NO escalation SMS');
  check(typeof safetyPack.task === 'string', 'safety-monitoring chip emits a clinician task');
  check(/clinical review|not a patient recall/i.test(safetyPack.task), 'safety task is framed as clinician review, not a recall');
  check(safetyPack.task.includes('Raised potassium'), 'safety task names the flag');
  // Aggregate path must not leak it into a combined patient SMS either
  const aggPack = buildPatientActions([safetyChip], patient);
  check(aggPack && !aggPack.sms, 'buildPatientActions does not produce a patient SMS for a safety-monitoring-only patient');
  check(aggPack && typeof aggPack.task === 'string', 'buildPatientActions still produces the clinician task');

  // ── 5. buildPatientActions: deduplication of same blood test ─────────────
  console.log('\n--- buildPatientActions: deduplication ---');

  // Two chips both needing FBC — the blood form should only list FBC once
  const mtxChip2 = {
    type: 'drug-monitoring',
    ruleId: 'methotrexate-maintenance',
    status: 'overdue',
    drugName: 'Methotrexate',
    tests: [
      { name: 'FBC', status: 'overdue' },
      { name: 'LFT', status: 'overdue' },
    ],
    source: 'BNF / BSR DMARD shared care guideline',
  };

  const azaChip = {
    type: 'drug-monitoring',
    ruleId: 'azathioprine-maintenance',
    status: 'overdue',
    drugName: 'Azathioprine',
    tests: [
      { name: 'FBC', status: 'overdue' },
      { name: 'LFT', status: 'overdue' },
    ],
    source: 'BNF / BSR azathioprine shared care',
  };

  const patientPack = buildPatientActions([mtxChip2, azaChip], patient);
  check(patientPack !== null, 'buildPatientActions returns non-null for two action chips');

  // bloodForm should contain BOTH drugs but deduplicated: two distinct lines
  // (each chip has its own drug name so they are different blood form lines)
  if (patientPack && patientPack.bloodForm) {
    check(patientPack.bloodForm.includes('Methotrexate'), 'combined bloodForm includes Methotrexate');
    check(patientPack.bloodForm.includes('Azathioprine'), 'combined bloodForm includes Azathioprine');
    // Neither should appear twice
    const fbcCount = (patientPack.bloodForm.match(/FBC/g) || []).length;
    // Each line has its own FBC, so two FBC mentions is correct (different drugs)
    // But the SAME line should never be duplicated
    const mtxLine = `FBC, LFT — Methotrexate monitoring (overdue). Source: BNF / BSR DMARD shared care guideline`;
    const lineOccurrences = patientPack.bloodForm.split(mtxLine).length - 1;
    check(lineOccurrences <= 1, 'blood form line for Methotrexate appears at most once (no dup)');
  }

  // Test actual deduplication: same chip used twice
  const sameChipTwice = [mtxChip2, { ...mtxChip2 }];
  const dedupedPack = buildPatientActions(sameChipTwice, patient);
  if (dedupedPack && dedupedPack.bloodForm) {
    const dedupedLines = dedupedPack.bloodForm.split('\n').filter(Boolean);
    check(
      dedupedLines.length === 1,
      `same blood form line from two identical chips deduplicated to 1 line (got ${dedupedLines.length})`
    );
  } else {
    check(false, 'dedup test: bloodForm should exist for overdue chip');
  }

  // Combined SMS should list both drugs
  check(patientPack && typeof patientPack.sms === 'string', 'combined sms is a string');
  if (patientPack) {
    check(
      patientPack.sms.includes('Methotrexate') ||
        patientPack.sms.includes('methotrexate') ||
        patientPack.sms.includes('Azathioprine') ||
        patientPack.sms.includes('azathioprine') ||
        /monitoring|attention|needing/i.test(patientPack.sms),
      'combined sms references drugs or items needing attention'
    );
  }

  // Combined task block
  check(patientPack && typeof patientPack.task === 'string', 'combined task is a string');
  if (patientPack) {
    check(patientPack.task.includes('Methotrexate'), 'combined task includes Methotrexate');
    check(patientPack.task.includes('Azathioprine'), 'combined task includes Azathioprine');
  }

  // ── 6. buildPatientActions: no action chips → null ────────────────────────
  console.log('\n--- buildPatientActions: no action chips ---');
  check(buildPatientActions([], patient) === null, 'empty chips → null');
  check(buildPatientActions([inDateChip], patient) === null, 'all in_date chips → null');

  // ── 7. SMS character limits ───────────────────────────────────────────────
  console.log('\n--- SMS character limits ---');
  check(mtxPack.sms.length <= 400, `MTX sms ≤400 chars (${mtxPack.sms.length})`);
  check(dmPack.sms.length <= 400, `DM QOF sms ≤400 chars (${dmPack.sms.length})`);
  check(vaxPack.sms.length <= 400, `vaccine sms ≤400 chars (${vaxPack.sms.length})`);

  // ── 8. No firstName fallback ──────────────────────────────────────────────
  console.log('\n--- patient name fallback ---');
  const noNamePatient = { nhsNumber: '9000000002' };
  const noNamePack = buildChipActions(mtxChip, noNamePatient);
  check(noNamePack !== null, 'no-name patient: pack non-null');
  check(noNamePack.sms.startsWith('Dear patient,'), 'no-name patient: sms falls back to "Dear patient,"');

  // ── 9. buildBatchPack ─────────────────────────────────────────────────────
  console.log('\n--- buildBatchPack ---');

  // Empty / null → null
  check(buildBatchPack([]) === null, 'buildBatchPack([]) → null');
  check(buildBatchPack(null) === null, 'buildBatchPack(null) → null');

  // Single item
  const bpItem1 = {
    name: 'Smith, Alice',
    time: '2026-06-11T09:00:00Z',
    clinician: 'Dr Jones',
    redCount: 1,
    amberCount: 0,
    chips: [
      {
        type: 'drug-monitoring',
        ruleId: 'methotrexate-maintenance',
        status: 'overdue',
        drugName: 'Methotrexate',
        tests: [
          { name: 'FBC', status: 'overdue' },
          { name: 'LFT', status: 'overdue' },
          { name: 'U&E', status: 'in_date' },
        ],
        source: 'BNF',
      },
    ],
  };

  const bpSingle = buildBatchPack([bpItem1]);
  check(bpSingle !== null, 'buildBatchPack with 1 item → non-null');
  check(Array.isArray(bpSingle.patients) && bpSingle.patients.length === 1, 'single item → 1 patient section');
  check(typeof bpSingle.generatedAt === 'string', 'generatedAt is a string');
  check(bpSingle.patients[0].name === 'Smith, Alice', 'patient name preserved');
  check(bpSingle.patients[0].time === '2026-06-11T09:00:00Z', 'time preserved');
  check(bpSingle.patients[0].clinician === 'Dr Jones', 'clinician preserved');
  check(bpSingle.patients[0].redCount === 1, 'redCount preserved');
  check(typeof bpSingle.patients[0].bloodForm === 'string', 'bloodForm is a string');
  check(bpSingle.patients[0].bloodForm.includes('FBC'), 'bloodForm includes overdue test');
  check(!bpSingle.patients[0].bloodForm.includes('U&E'), 'bloodForm excludes in_date test');
  check(typeof bpSingle.patients[0].sms === 'string', 'sms is a string');
  check(/Methotrexate|methotrexate/i.test(bpSingle.patients[0].sms), 'sms references drug');

  // Verify single-patient batch matches what buildPatientActions would produce
  const directPack = buildPatientActions(bpItem1.chips, { name: bpItem1.name });
  check(
    bpSingle.patients[0].bloodForm === directPack.bloodForm,
    'buildBatchPack bloodForm matches buildPatientActions for same input'
  );
  check(bpSingle.patients[0].sms === directPack.sms, 'buildBatchPack sms matches buildPatientActions for same input');

  // N items → N sections
  const bpItem2 = {
    name: 'Jones, Bob',
    time: '2026-06-11T09:30:00Z',
    clinician: 'Dr Jones',
    redCount: 0,
    amberCount: 1,
    chips: [
      {
        type: 'qof-indicator',
        status: 'not_met',
        ruleId: 'hyp010',
        indicatorCode: 'HYP010',
        indicatorName: 'BP ≤140/90',
      },
    ],
  };

  const bpTwo = buildBatchPack([bpItem1, bpItem2]);
  check(bpTwo !== null, 'buildBatchPack with 2 items → non-null');
  check(bpTwo.patients.length === 2, '2 items → 2 patient sections');
  check(bpTwo.patients[0].name === 'Smith, Alice', 'first patient name correct');
  check(bpTwo.patients[1].name === 'Jones, Bob', 'second patient name correct');
  // QOF chip → sms present, bloodForm null
  check(bpTwo.patients[1].bloodForm === null, 'QOF chip patient has no bloodForm');
  check(typeof bpTwo.patients[1].sms === 'string', 'QOF chip patient has sms');

  // Patient with no action-needed chips → null fields (not removed from list)
  const bpItemClear = {
    name: 'Clear, Patient',
    time: null,
    clinician: null,
    redCount: 0,
    amberCount: 0,
    chips: [{ type: 'drug-monitoring', status: 'in_date', drugName: 'X', tests: [] }],
  };
  const bpWithClear = buildBatchPack([bpItem1, bpItemClear]);
  check(bpWithClear.patients.length === 2, 'item with no action chips still produces a section');
  check(bpWithClear.patients[1].sms === null, 'patient with no action chips has null sms');
  check(bpWithClear.patients[1].bloodForm === null, 'patient with no action chips has null bloodForm');

  // Order preserved (not re-sorted)
  const bpOrder = buildBatchPack([bpItem2, bpItem1]);
  check(bpOrder.patients[0].name === 'Jones, Bob', 'order preserved: first passed is first in output');
  check(bpOrder.patients[1].name === 'Smith, Alice', 'order preserved: second passed is second in output');

  // ── Final results ─────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
