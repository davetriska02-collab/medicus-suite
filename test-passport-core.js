// Medicus Suite — passport-core.js unit tests
// Run with: node test-passport-core.js
//
// Pins:
//   • methotrexate chip → due entry lists only due tests; why-sentence contains drug name
//   • QOF DM chip → patient-voiced review entry
//   • no action chips → nothingDue true
//   • eGFR 54 → meaning contains "54" and "90", status soon
//   • BP 150/80 → status action
//   • BP 128/76 → status good
//   • cholesterol → status none, no invented target in meaning
//   • trend sentence appears for BP +12 systolic, not for +4
//   • sentences in due/numbers contain no "BP" abbreviation in patient text
//   • null snapshot → null
//   • no patient in snapshot → null
//   • nothingDue true when no action chips
//   • vaccine chip → due entry with vaccine name
//   • unknown chip type → generic fallback entry
//   • eGFR < 30 → status action; eGFR >= 60 → status good

'use strict';

let passed = 0;
let failed = 0;

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
  const modPath = new URL(
    'side-panel/modules/sentinel/passport-core.js',
    `file://${process.cwd().replace(/\\/g, '/')}/`
  ).href;

  let buildPassport;
  try {
    const mod = await import(modPath);
    buildPassport = mod.buildPassport;
    check(typeof buildPassport === 'function', 'buildPassport imported');
  } catch (e) {
    console.error('FATAL: could not import passport-core.js:', e.message);
    process.exitCode = 1;
    return;
  }

  // ── Fixtures ──────────────────────────────────────────────────────────────

  const patient = {
    displayName: 'Smith, Margaret',
    dateOfBirth: '01/01/1952',
    nhsNumber: '9000000001',
    age: 73,
    gender: 'F',
  };

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
  };

  const dm006Chip = {
    type: 'qof-indicator',
    ruleId: 'dm006',
    status: 'not_met',
    indicatorCode: 'DM006',
    indicatorName: 'HbA1c target not met',
  };

  const fluChip = {
    type: 'vaccine',
    ruleId: 'flu-vaccine',
    status: 'due_soon',
    displayName: 'flu',
  };

  const alertChip = {
    type: 'drug-combo',
    ruleId: 'warfarin-nsaid',
    status: 'alert',
    displayName: 'Warfarin + NSAID risk',
  };

  const inDateChip = {
    type: 'drug-monitoring',
    ruleId: 'lithium-main',
    status: 'in_date',
    drugName: 'Lithium',
    tests: [{ name: 'Lithium level', status: 'in_date' }],
  };

  function makeSnapshot(chips, pat = patient) {
    return { chips, patientContext: pat };
  }

  function makeTrendData(obs) {
    return { observationHistory: obs };
  }

  // ── 1. Null / no-patient guard ─────────────────────────────────────────────
  console.log('\n--- null / no-patient guard ---');
  check(buildPassport(null, null) === null, 'null snapshot → null');
  check(buildPassport(undefined, null) === null, 'undefined snapshot → null');
  check(buildPassport({ chips: [] }, null) === null, 'no patientContext → null');
  check(buildPassport({ chips: [], patientContext: null }, null) === null, 'patientContext: null → null');

  // ── 2. Basic structure with patient ───────────────────────────────────────
  console.log('\n--- basic structure ---');
  const basic = buildPassport(makeSnapshot([mtxChip, inDateChip]), null);
  check(basic !== null, 'valid snapshot → non-null passport');
  check(basic.patient.name === 'Smith, Margaret', `patient.name correct (got: "${basic.patient.name}")`);
  check(basic.patient.dob === '01/01/1952', `patient.dob present (got: "${basic.patient.dob}")`);
  check(basic.patient.nhsNumber === '9000000001', `patient.nhsNumber present (got: "${basic.patient.nhsNumber}")`);
  check(typeof basic.generatedAt === 'string', 'generatedAt is a string');
  check(basic.generatedAt.includes('T'), 'generatedAt is an ISO timestamp');
  check(Array.isArray(basic.due), 'due is an array');
  check(Array.isArray(basic.numbers), 'numbers is an array');
  check(typeof basic.nothingDue === 'boolean', 'nothingDue is boolean');

  // ── 3. Methotrexate chip → due entry with only due tests ──────────────────
  console.log('\n--- drug-monitoring chip: methotrexate ---');
  const mtxPass = buildPassport(makeSnapshot([mtxChip]), null);
  check(mtxPass.due.length >= 1, 'due has at least one entry');
  const mtxEntry = mtxPass.due[0];
  check(mtxEntry.title.includes('FBC'), `title includes due test FBC (got: "${mtxEntry.title}")`);
  check(mtxEntry.title.includes('LFT'), `title includes due test LFT (got: "${mtxEntry.title}")`);
  check(!mtxEntry.title.includes('U&E'), `title does NOT include in-date U&E (got: "${mtxEntry.title}")`);
  check(
    mtxEntry.why.toLowerCase().includes('methotrexate'),
    `why-sentence contains drug name (got: "${mtxEntry.why}")`
  );
  // Patient-friendly text should not use bare "BP" abbreviation
  check(
    !mtxEntry.title.includes(' BP') && !mtxEntry.why.includes(' BP'),
    'drug entry does not use bare "BP" abbreviation'
  );

  // ── 4. QOF DM chip → patient-voiced review entry ─────────────────────────
  console.log('\n--- QOF DM chip ---');
  const dmPass = buildPassport(makeSnapshot([dm006Chip]), null);
  check(dmPass.due.length >= 1, 'DM chip → at least one due entry');
  const dmEntry = dmPass.due[0];
  check(dmEntry.title.toLowerCase().includes('diabetes'), `QOF DM entry mentions diabetes (got: "${dmEntry.title}")`);
  check(dmEntry.why.toLowerCase().includes('diabetes'), `QOF DM why mentions diabetes (got: "${dmEntry.why}")`);
  // Should not contain admin-style wording like "Book a"
  check(
    !dmEntry.title.toLowerCase().startsWith('book'),
    `QOF DM title is patient-voiced not admin (got: "${dmEntry.title}")`
  );

  // ── 5. No action chips → nothingDue: true ─────────────────────────────────
  console.log('\n--- nothingDue ---');
  const clearPass = buildPassport(makeSnapshot([inDateChip]), null);
  check(clearPass !== null, 'clear snapshot (no action chips) → non-null passport');
  check(clearPass.nothingDue === true, 'nothingDue true when no action chips');
  check(clearPass.due.length === 0, 'due is empty array when no action chips');

  // ── 6. Vaccine chip → due entry ───────────────────────────────────────────
  console.log('\n--- vaccine chip ---');
  const vacPass = buildPassport(makeSnapshot([fluChip]), null);
  check(vacPass.due.length >= 1, 'vaccine chip → due entry present');
  const vacEntry = vacPass.due[0];
  check(vacEntry.title.toLowerCase().includes('flu'), `vaccine title includes vaccine name (got: "${vacEntry.title}")`);

  // ── 7. Unknown chip type → generic fallback entry ─────────────────────────
  console.log('\n--- unknown chip type (drug-combo/alert) ---');
  const alertPass = buildPassport(makeSnapshot([alertChip]), null);
  check(alertPass.due.length === 1, 'drug-combo/alert → one generic due entry');
  const alertEntry = alertPass.due[0];
  check(
    alertEntry.title.toLowerCase().includes('doctor') || alertEntry.title.toLowerCase().includes('review'),
    `generic entry is patient-friendly (got: "${alertEntry.title}")`
  );

  // ── 8. eGFR numbers ───────────────────────────────────────────────────────
  console.log('\n--- eGFR numbers ---');

  // eGFR 54 → status 'soon', meaning contains "54" and "90"
  const egfr54Trend = makeTrendData([{ name: 'eGFR', history: [{ date: '2026-06-01', value: 54 }] }]);
  const egfr54Pass = buildPassport(makeSnapshot([inDateChip]), egfr54Trend);
  const egfr54Entry = egfr54Pass.numbers.find((n) => n.label.toLowerCase().includes('kidney'));
  check(egfr54Entry !== undefined, 'eGFR 54 → numbers entry present');
  check(egfr54Entry?.status === 'soon', `eGFR 54 → status soon (got: "${egfr54Entry?.status}")`);
  check(egfr54Entry?.meaning.includes('54'), `eGFR 54 meaning contains "54" (got: "${egfr54Entry?.meaning}")`);
  check(egfr54Entry?.meaning.includes('90'), `eGFR 54 meaning contains "90" (got: "${egfr54Entry?.meaning}")`);
  check(
    egfr54Entry?.statusLabel === 'Needs a check soon',
    `eGFR 54 statusLabel correct (got: "${egfr54Entry?.statusLabel}")`
  );

  // eGFR >= 60 → status good
  const egfr65Trend = makeTrendData([{ name: 'eGFR', history: [{ date: '2026-06-01', value: 65 }] }]);
  const egfr65Pass = buildPassport(makeSnapshot([inDateChip]), egfr65Trend);
  const egfr65Entry = egfr65Pass.numbers.find((n) => n.label.toLowerCase().includes('kidney'));
  check(egfr65Entry?.status === 'good', `eGFR 65 → status good (got: "${egfr65Entry?.status}")`);

  // eGFR < 30 → status action
  const egfr25Trend = makeTrendData([{ name: 'eGFR', history: [{ date: '2026-06-01', value: 25 }] }]);
  const egfr25Pass = buildPassport(makeSnapshot([inDateChip]), egfr25Trend);
  const egfr25Entry = egfr25Pass.numbers.find((n) => n.label.toLowerCase().includes('kidney'));
  check(egfr25Entry?.status === 'action', `eGFR 25 → status action (got: "${egfr25Entry?.status}")`);

  // ── 9. BP numbers ─────────────────────────────────────────────────────────
  console.log('\n--- BP numbers ---');

  // BP 150/80 → status action
  const bp150Trend = makeTrendData([{ name: 'blood pressure', history: [{ date: '2026-06-01', rawValue: '150/80' }] }]);
  const bp150Pass = buildPassport(makeSnapshot([inDateChip]), bp150Trend);
  const bp150Entry = bp150Pass.numbers.find((n) => n.label.toLowerCase().includes('blood pressure'));
  check(bp150Entry !== undefined, 'BP 150/80 → numbers entry present');
  check(bp150Entry?.status === 'action', `BP 150/80 → status action (got: "${bp150Entry?.status}")`);
  check(
    bp150Entry?.statusLabel === 'Action needed',
    `BP 150/80 statusLabel correct (got: "${bp150Entry?.statusLabel}")`
  );
  // Patient-facing label/meaning must not use bare "BP"
  check(
    !bp150Entry?.label.includes(' BP') && !bp150Entry?.meaning.includes(' BP'),
    'BP entry does not use bare "BP" abbreviation in label or meaning'
  );

  // BP 128/76 → status good
  const bp128Trend = makeTrendData([{ name: 'blood pressure', history: [{ date: '2026-06-01', rawValue: '128/76' }] }]);
  const bp128Pass = buildPassport(makeSnapshot([inDateChip]), bp128Trend);
  const bp128Entry = bp128Pass.numbers.find((n) => n.label.toLowerCase().includes('blood pressure'));
  check(bp128Entry?.status === 'good', `BP 128/76 → status good (got: "${bp128Entry?.status}")`);
  check(bp128Entry?.statusLabel === 'On track', `BP 128/76 statusLabel correct (got: "${bp128Entry?.statusLabel}")`);

  // BP exactly 140/85 → action (systolic threshold)
  const bp140Trend = makeTrendData([{ name: 'blood pressure', history: [{ date: '2026-06-01', rawValue: '140/85' }] }]);
  const bp140Pass = buildPassport(makeSnapshot([inDateChip]), bp140Trend);
  const bp140Entry = bp140Pass.numbers.find((n) => n.label.toLowerCase().includes('blood pressure'));
  check(bp140Entry?.status === 'action', `BP 140/85 → status action (boundary) (got: "${bp140Entry?.status}")`);

  // ── 10. Cholesterol → status none, no invented target ─────────────────────
  console.log('\n--- cholesterol numbers ---');
  const cholTrend = makeTrendData([{ name: 'cholesterol', history: [{ date: '2026-06-01', value: 5.2 }] }]);
  const cholPass = buildPassport(makeSnapshot([inDateChip]), cholTrend);
  const cholEntry = cholPass.numbers.find((n) => n.label.toLowerCase().includes('cholesterol'));
  check(cholEntry !== undefined, 'cholesterol → numbers entry present');
  check(cholEntry?.status === 'none', `cholesterol → status none (got: "${cholEntry?.status}")`);
  check(cholEntry?.statusLabel === '', `cholesterol → statusLabel empty (got: "${cholEntry?.statusLabel}")`);
  // Should not contain an invented target like "below 5" or "above 5" or "target"
  check(
    !cholEntry?.meaning.toLowerCase().includes('target'),
    `cholesterol meaning has no invented target (got: "${cholEntry?.meaning}")`
  );

  // ── 11. Trend sentence: BP +12 → appears; +4 → does not ───────────────────
  console.log('\n--- BP trend sentence ---');

  const bpUp12Trend = makeTrendData([
    {
      name: 'blood pressure',
      history: [
        { date: '2026-06-01', rawValue: '165/92' }, // newest (newest-first)
        { date: '2026-03-01', rawValue: '153/88' }, // prev
      ],
    },
  ]);
  const bpUp12Pass = buildPassport(makeSnapshot([inDateChip]), bpUp12Trend);
  const bpUp12Entry = bpUp12Pass.numbers.find((n) => n.label.toLowerCase().includes('blood pressure'));
  check(
    bpUp12Entry?.meaning.toLowerCase().includes('gone up'),
    `BP +12 trend → meaning contains "gone up" (got: "${bpUp12Entry?.meaning}")`
  );

  const bpUp4Trend = makeTrendData([
    {
      name: 'blood pressure',
      history: [
        { date: '2026-06-01', rawValue: '157/88' },
        { date: '2026-03-01', rawValue: '153/88' },
      ],
    },
  ]);
  const bpUp4Pass = buildPassport(makeSnapshot([inDateChip]), bpUp4Trend);
  const bpUp4Entry = bpUp4Pass.numbers.find((n) => n.label.toLowerCase().includes('blood pressure'));
  check(
    !bpUp4Entry?.meaning.toLowerCase().includes('gone up') && !bpUp4Entry?.meaning.toLowerCase().includes('come down'),
    `BP +4 trend → no trend sentence (got: "${bpUp4Entry?.meaning}")`
  );

  // BP come down trend sentence
  const bpDown12Trend = makeTrendData([
    {
      name: 'blood pressure',
      history: [
        { date: '2026-06-01', rawValue: '140/88' },
        { date: '2026-03-01', rawValue: '155/90' },
      ],
    },
  ]);
  const bpDown12Pass = buildPassport(makeSnapshot([inDateChip]), bpDown12Trend);
  const bpDown12Entry = bpDown12Pass.numbers.find((n) => n.label.toLowerCase().includes('blood pressure'));
  check(
    bpDown12Entry?.meaning.toLowerCase().includes('come down'),
    `BP -15 trend → meaning contains "come down" (got: "${bpDown12Entry?.meaning}")`
  );

  // ── 12. No "BP" abbreviation in patient-facing text of any number entries ──
  console.log('\n--- no bare "BP" abbreviation in patient text ---');
  const combinedTrend = makeTrendData([
    {
      name: 'blood pressure',
      history: [{ date: '2026-06-01', rawValue: '130/85' }],
    },
  ]);
  const combinedPass = buildPassport(makeSnapshot([mtxChip, dm006Chip]), combinedTrend);
  const bpNum = combinedPass.numbers.find((n) => n.label.toLowerCase().includes('blood pressure'));
  if (bpNum) {
    const allText = bpNum.label + ' ' + bpNum.meaning + ' ' + bpNum.statusLabel;
    // "BP" should not appear as a standalone clinical abbreviation in patient text
    // (the label itself says "Blood pressure")
    check(!allText.match(/\bBP\b/), `no bare "BP" abbreviation in blood pressure entry text (got: "${allText}")`);
  }
  // Due entries from drug chip should not use BP abbreviation
  const dueText = combinedPass.due.map((d) => d.title + ' ' + d.why).join(' ');
  check(!dueText.match(/\bBP\b/), `no bare "BP" abbreviation in due entries (got: "${dueText}")`);

  // ── 13. HbA1c status zones ─────────────────────────────────────────────────
  console.log('\n--- HbA1c status zones ---');

  const hba1c50Trend = makeTrendData([{ name: 'HbA1c', history: [{ date: '2026-06-01', value: 50 }] }]);
  const hba1c50Pass = buildPassport(makeSnapshot([inDateChip]), hba1c50Trend);
  const hba1c50Entry = hba1c50Pass.numbers.find((n) => n.label.toLowerCase().includes('hba1c'));
  check(hba1c50Entry?.status === 'good', `HbA1c 50 → status good (got: "${hba1c50Entry?.status}")`);

  const hba1c60Trend = makeTrendData([{ name: 'HbA1c', history: [{ date: '2026-06-01', value: 60 }] }]);
  const hba1c60Pass = buildPassport(makeSnapshot([inDateChip]), hba1c60Trend);
  const hba1c60Entry = hba1c60Pass.numbers.find((n) => n.label.toLowerCase().includes('hba1c'));
  check(hba1c60Entry?.status === 'soon', `HbA1c 60 → status soon (got: "${hba1c60Entry?.status}")`);

  const hba1c80Trend = makeTrendData([{ name: 'HbA1c', history: [{ date: '2026-06-01', value: 80 }] }]);
  const hba1c80Pass = buildPassport(makeSnapshot([inDateChip]), hba1c80Trend);
  const hba1c80Entry = hba1c80Pass.numbers.find((n) => n.label.toLowerCase().includes('hba1c'));
  check(hba1c80Entry?.status === 'action', `HbA1c 80 → status action (got: "${hba1c80Entry?.status}")`);

  // HbA1c 53 exactly → status soon (boundary)
  const hba1c53Trend = makeTrendData([{ name: 'HbA1c', history: [{ date: '2026-06-01', value: 53 }] }]);
  const hba1c53Pass = buildPassport(makeSnapshot([inDateChip]), hba1c53Trend);
  const hba1c53Entry = hba1c53Pass.numbers.find((n) => n.label.toLowerCase().includes('hba1c'));
  check(hba1c53Entry?.status === 'soon', `HbA1c 53 (boundary) → status soon (got: "${hba1c53Entry?.status}")`);

  // ── 14. Numbers empty when no trendData ───────────────────────────────────
  console.log('\n--- no trendData → no numbers ---');
  const noTrendPass = buildPassport(makeSnapshot([mtxChip]), null);
  check(noTrendPass.numbers.length === 0, 'no trendData → numbers empty');

  // ── 15. Weight entry has no invented target ────────────────────────────────
  console.log('\n--- weight entry ---');
  const weightTrend = makeTrendData([{ name: 'weight', history: [{ date: '2026-06-01', value: 82.5 }] }]);
  const weightPass = buildPassport(makeSnapshot([inDateChip]), weightTrend);
  const weightEntry = weightPass.numbers.find((n) => n.label.toLowerCase().includes('weight'));
  check(weightEntry !== undefined, 'weight → numbers entry present');
  check(weightEntry?.status === 'none', `weight → status none (got: "${weightEntry?.status}")`);
  check(
    !weightEntry?.meaning.toLowerCase().includes('target'),
    `weight meaning has no invented target (got: "${weightEntry?.meaning}")`
  );

  // ── Results ───────────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
