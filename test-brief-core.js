// Medicus Suite — brief-core.js unit tests
// Run with: node test-brief-core.js
//
// Pins:
//   • signal ordering: red before amber, drug-monitoring before QOF
//   • max-4 cap + moreCount arithmetic
//   • per-group RAG (meds / qof / general): counts, status, signal.group
//   • all-clear chips → allClear brief (green card), NOT null
//   • drug signal text lists only the due (action-needed) tests
//   • BP delta ≥10 → trend note; delta <10 → no note
//   • HbA1c delta ≥5 → trend note; delta <5 → no note
//   • eGFR decline ≥15% → trend note; <15% → no note
//   • null snapshot → null
//   • missing trendData → empty trendNotes
//   • missing patient fields → no crash, graceful output

'use strict';

require('./shared/status-rank.js');

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
  const modPath = new URL('side-panel/modules/sentinel/brief-core.js', `file://${process.cwd().replace(/\\/g, '/')}/`)
    .href;

  let buildBrief;
  try {
    const mod = await import(modPath);
    buildBrief = mod.buildBrief;
    check(typeof buildBrief === 'function', 'buildBrief imported');
  } catch (e) {
    console.error('FATAL: could not import brief-core.js:', e.message);
    process.exitCode = 1;
    return;
  }

  // ── Fixtures ──────────────────────────────────────────────────────────────

  const patient = { displayName: 'Smith, Margaret', age: 73, gender: 'F', nhsNumber: '9000000001' };

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
    indicatorName: 'HbA1c ≤58 mmol/mol',
  };

  const dm007Chip = {
    type: 'qof-indicator',
    ruleId: 'dm007',
    status: 'overdue',
    indicatorCode: 'DM007',
    indicatorName: 'BP target',
  };

  const hyp001Chip = {
    type: 'qof-indicator',
    ruleId: 'hyp001',
    status: 'stale',
    indicatorCode: 'HYP001',
    indicatorName: 'BP severely overdue',
  };

  const azaChip = {
    type: 'drug-monitoring',
    ruleId: 'azathioprine-main',
    status: 'due_soon',
    drugName: 'Azathioprine',
    tests: [
      { name: 'FBC', status: 'due_soon' },
      { name: 'LFT', status: 'in_date' },
    ],
  };

  // chips with all-clear statuses (should not appear in signals)
  const inDateChip = {
    type: 'drug-monitoring',
    ruleId: 'lithium-main',
    status: 'in_date',
    drugName: 'Lithium',
    tests: [{ name: 'Lithium level', status: 'in_date' }],
  };

  const achievedChip = {
    type: 'qof-indicator',
    ruleId: 'dm006-ok',
    status: 'achieved',
    indicatorCode: 'DM006',
    indicatorName: 'HbA1c achieved',
  };

  function makeSnapshot(chips, pat = patient) {
    return { chips, patientContext: pat };
  }

  // ── 1. Null snapshot → null ────────────────────────────────────────────────
  console.log('\n--- null snapshot ---');
  check(buildBrief(null, null) === null, 'null snapshot → null');
  check(buildBrief(undefined, null) === null, 'undefined snapshot → null');
  check(buildBrief({}, null) === null, 'snapshot without chips → null');
  // Empty chips = patient open, nothing found → explicit green all-clear brief,
  // not a suppressed card.
  const emptyChips = buildBrief({ chips: [] }, null);
  check(emptyChips !== null, 'empty chips → brief non-null (all-clear card)');
  check(emptyChips.allClear === true, 'empty chips → allClear true');
  check(emptyChips.signals.length === 0, 'empty chips → no signals');
  check(emptyChips.groups.meds.status === 'clear', 'empty chips → meds group clear');
  check(emptyChips.groups.qof.status === 'clear', 'empty chips → qof group clear');
  check(emptyChips.groups.general.status === 'clear', 'empty chips → general group clear');

  // ── 2. Basic brief with one action chip ───────────────────────────────────
  console.log('\n--- basic brief ---');
  const basic = buildBrief(makeSnapshot([mtxChip, inDateChip, achievedChip]), null);
  check(basic !== null, 'action chip present → brief non-null');
  check(basic.patientLine === 'Smith, Margaret · 73 · F', `patientLine correct (got: ${basic.patientLine})`);
  check(basic.counts.red === 1, `counts.red = 1 (got ${basic.counts.red})`);
  check(basic.counts.amber === 0, `counts.amber = 0 (got ${basic.counts.amber})`);
  check(basic.signals.length === 1, `1 signal (got ${basic.signals.length})`);
  check(basic.signals[0].severity === 'red', `signal severity is red (got ${basic.signals[0].severity})`);
  check(basic.moreCount === 0, `moreCount = 0 (got ${basic.moreCount})`);
  check(Array.isArray(basic.trendNotes), 'trendNotes is array');
  check(basic.trendNotes.length === 0, 'trendNotes empty when no trendData');

  // ── 3. Signal text: drug chip lists only due tests ─────────────────────────
  console.log('\n--- drug signal text ---');
  const s = basic.signals[0].text;
  check(s.includes('Methotrexate'), `signal includes drug name (got: "${s}")`);
  check(s.includes('FBC'), `signal includes due test FBC (got: "${s}")`);
  check(s.includes('LFT'), `signal includes due test LFT (got: "${s}")`);
  check(!s.includes('U&E'), `signal does NOT include in-date U&E (got: "${s}")`);

  // ── 4. Ordering: red before amber, drug before QOF ─────────────────────────
  console.log('\n--- ordering: red before amber, drug before QOF ---');
  // mtxChip=overdue(red), dm006=not_met(red), azaChip=due_soon(amber), dm007=overdue(red)
  // Expected order: rank-0 chips first, then drug-monitoring before qof-indicator within same rank
  const mixedSnap = makeSnapshot([dm006Chip, azaChip, mtxChip, dm007Chip, inDateChip]);
  const mixed = buildBrief(mixedSnap, null);
  check(mixed !== null, 'mixed chips → brief non-null');
  // All action-needed: mtx(overdue=0), dm006(not_met=0), dm007(overdue=0), aza(due_soon=2)
  // Drug before QOF within same rank: mtx should come before dm006/dm007
  check(mixed.signals[0].severity === 'red', `first signal is red (got ${mixed.signals[0].severity})`);
  check(
    mixed.signals[0].text.includes('Methotrexate'),
    `first signal is Methotrexate (drug, rank0) — got "${mixed.signals[0].text}"`
  );
  // dm006 and dm007 are rank-0 QOF, should come after drug
  const signalTexts = mixed.signals.map((s) => s.text);
  const mtxIdx = signalTexts.findIndex((t) => t.includes('Methotrexate'));
  const dm006Idx = signalTexts.findIndex((t) => t.includes('DM006'));
  check(mtxIdx < dm006Idx, `Methotrexate (drug) before DM006 (QOF) (indices: ${mtxIdx} < ${dm006Idx})`);

  // amber chip should come after all red chips
  const azaIdx = signalTexts.findIndex((t) => t.includes('Azathioprine'));
  const redIndices = signalTexts
    .map((t, i) => ({ t, i }))
    .filter((x) => mixed.signals[x.i].severity === 'red')
    .map((x) => x.i);
  if (azaIdx !== -1 && redIndices.length > 0) {
    const maxRedIdx = Math.max(...redIndices);
    check(azaIdx > maxRedIdx, `amber Azathioprine after all red chips (azaIdx=${azaIdx}, maxRedIdx=${maxRedIdx})`);
  }

  // ── 5. Max-4 + moreCount ──────────────────────────────────────────────────
  console.log('\n--- max-4 signals + moreCount ---');
  // 5 action-needed chips: mtx, dm006, dm007, hyp001, aza
  const fiveChips = [mtxChip, dm006Chip, dm007Chip, hyp001Chip, azaChip, inDateChip];
  const five = buildBrief(makeSnapshot(fiveChips), null);
  check(five !== null, '5 action chips → brief non-null');
  check(five.signals.length === 4, `signals capped at 4 (got ${five.signals.length})`);
  check(five.moreCount === 1, `moreCount = 1 (got ${five.moreCount})`);

  // 3 action-needed chips → moreCount = 0
  const threeChips = [mtxChip, dm006Chip, azaChip];
  const three = buildBrief(makeSnapshot(threeChips), null);
  check(three.signals.length === 3, `3 chips → 3 signals (got ${three.signals.length})`);
  check(three.moreCount === 0, `3 chips → moreCount = 0 (got ${three.moreCount})`);

  // ── 6. QOF signal text ────────────────────────────────────────────────────
  console.log('\n--- QOF signal text ---');
  const qofOnly = buildBrief(makeSnapshot([dm006Chip]), null);
  check(qofOnly !== null, 'QOF chip → brief non-null');
  const qText = qofOnly.signals[0].text;
  check(qText.includes('DM006'), `QOF signal includes indicatorCode (got: "${qText}")`);
  check(qText.includes('HbA1c'), `QOF signal includes indicator name (got: "${qText}")`);

  // ── 7. Missing patient fields don't crash ─────────────────────────────────
  console.log('\n--- missing patient fields ---');
  const noName = buildBrief({ chips: [mtxChip], patientContext: {} }, null);
  check(noName !== null, 'empty patient → brief non-null');
  check(
    noName.patientLine == null || noName.patientLine === '',
    `empty patient → patientLine null/empty (got: "${noName.patientLine}")`
  );

  const partialPatient = buildBrief({ chips: [mtxChip], patientContext: { age: 55 } }, null);
  check(partialPatient !== null, 'patient with only age → brief non-null');
  check(partialPatient.patientLine.includes('55'), `patientLine includes age (got: "${partialPatient.patientLine}")`);

  const noPatient = buildBrief({ chips: [mtxChip], patientContext: null }, null);
  check(noPatient !== null, 'null patientContext → brief non-null (chips still shown)');

  // ── 8. Trend notes: BP delta ≥10 → note ──────────────────────────────────
  console.log('\n--- trend notes: BP ---');

  // BP delta +12 systolic → trend note (up)
  const trendDataBp12 = {
    observationHistory: [
      {
        name: 'blood pressure',
        history: [
          { date: '2026-06-01', rawValue: '165/92' }, // newest
          { date: '2026-03-01', rawValue: '153/88' }, // prev
        ],
      },
    ],
  };
  const bpUp12 = buildBrief(makeSnapshot([mtxChip]), trendDataBp12);
  check(bpUp12 !== null, 'BP trend snap non-null');
  const bpNote12 = bpUp12.trendNotes.find((n) => n.text.includes('BP'));
  check(bpNote12 !== undefined, 'BP delta 12 → trend note present');
  check(bpNote12?.direction === 'up', `BP delta +12 → direction up (got: ${bpNote12?.direction})`);
  check(bpNote12?.text.includes('165'), `BP trend note includes latest systolic 165 (got: "${bpNote12?.text}")`);

  // BP delta +6 systolic → no trend note
  const trendDataBp6 = {
    observationHistory: [
      {
        name: 'blood pressure',
        history: [
          { date: '2026-06-01', rawValue: '159/90' },
          { date: '2026-03-01', rawValue: '153/88' },
        ],
      },
    ],
  };
  const bpUp6 = buildBrief(makeSnapshot([mtxChip]), trendDataBp6);
  const bpNote6 = bpUp6.trendNotes.find((n) => n.text.includes('BP'));
  check(bpNote6 === undefined, 'BP delta 6 → no trend note');

  // BP delta -10 exactly → note (boundary)
  const trendDataBpDown10 = {
    observationHistory: [
      {
        name: 'blood pressure',
        history: [
          { date: '2026-06-01', rawValue: '140/88' },
          { date: '2026-03-01', rawValue: '150/90' },
        ],
      },
    ],
  };
  const bpDown10 = buildBrief(makeSnapshot([mtxChip]), trendDataBpDown10);
  const bpNoteDown = bpDown10.trendNotes.find((n) => n.text.includes('BP'));
  check(bpNoteDown !== undefined, 'BP delta -10 (exact threshold) → trend note present');
  check(bpNoteDown?.direction === 'down', `direction is down (got: ${bpNoteDown?.direction})`);

  // ── 9. Trend notes: HbA1c delta ≥5 → note ────────────────────────────────
  console.log('\n--- trend notes: HbA1c ---');

  const trendDataHba1c7 = {
    observationHistory: [
      {
        name: 'HbA1c',
        history: [
          { date: '2026-06-01', value: 65 }, // newest
          { date: '2026-01-01', value: 58 }, // prev
        ],
      },
    ],
  };
  const hba1cSnap = buildBrief(makeSnapshot([dm006Chip]), trendDataHba1c7);
  const hba1cNote = hba1cSnap.trendNotes.find((n) => n.text.includes('HbA1c'));
  check(hba1cNote !== undefined, 'HbA1c delta 7 → trend note');
  check(hba1cNote?.direction === 'up', `HbA1c rising → direction up (got: ${hba1cNote?.direction})`);
  check(hba1cNote?.text.includes('65'), `HbA1c note includes latest value 65 (got: "${hba1cNote?.text}")`);

  // HbA1c delta 3 → no note
  const trendDataHba1c3 = {
    observationHistory: [
      {
        name: 'HbA1c',
        history: [
          { date: '2026-06-01', value: 61 },
          { date: '2026-01-01', value: 58 },
        ],
      },
    ],
  };
  const hba1cSnap3 = buildBrief(makeSnapshot([dm006Chip]), trendDataHba1c3);
  const hba1cNote3 = hba1cSnap3.trendNotes.find((n) => n.text.includes('HbA1c'));
  check(hba1cNote3 === undefined, 'HbA1c delta 3 → no trend note');

  // HbA1c delta exactly 5 → note (boundary)
  const trendDataHba1c5 = {
    observationHistory: [
      {
        name: 'HbA1c',
        history: [
          { date: '2026-06-01', value: 63 },
          { date: '2026-01-01', value: 58 },
        ],
      },
    ],
  };
  const hba1cSnap5 = buildBrief(makeSnapshot([dm006Chip]), trendDataHba1c5);
  const hba1cNote5 = hba1cSnap5.trendNotes.find((n) => n.text.includes('HbA1c'));
  check(hba1cNote5 !== undefined, 'HbA1c delta 5 (exact threshold) → trend note');

  // ── 10. Trend notes: eGFR decline ≥15% → note ────────────────────────────
  console.log('\n--- trend notes: eGFR ---');

  // eGFR 50→40 = 20% decline → note
  const trendDataEgfr20 = {
    observationHistory: [
      {
        name: 'eGFR',
        history: [
          { date: '2026-06-01', value: 40 }, // newest
          { date: '2026-01-01', value: 50 }, // prev
        ],
      },
    ],
  };
  const egfrSnap20 = buildBrief(makeSnapshot([mtxChip]), trendDataEgfr20);
  const egfrNote20 = egfrSnap20.trendNotes.find((n) => n.text.toLowerCase().includes('egfr'));
  check(egfrNote20 !== undefined, 'eGFR decline 20% → trend note');
  check(egfrNote20?.direction === 'down', `eGFR decline direction is down (got: ${egfrNote20?.direction})`);
  check(egfrNote20?.text.includes('40'), `eGFR note includes latest value 40 (got: "${egfrNote20?.text}")`);

  // eGFR 50→46 = 8% decline → no note
  const trendDataEgfr8 = {
    observationHistory: [
      {
        name: 'eGFR',
        history: [
          { date: '2026-06-01', value: 46 },
          { date: '2026-01-01', value: 50 },
        ],
      },
    ],
  };
  const egfrSnap8 = buildBrief(makeSnapshot([mtxChip]), trendDataEgfr8);
  const egfrNote8 = egfrSnap8.trendNotes.find((n) => n.text.toLowerCase().includes('egfr'));
  check(egfrNote8 === undefined, 'eGFR decline 8% → no trend note');

  // eGFR exactly 15% decline → note (boundary: 50→42.5, use 50→42)
  const trendDataEgfr15 = {
    observationHistory: [
      {
        name: 'eGFR',
        history: [
          { date: '2026-06-01', value: 42.5 }, // exactly 15% below 50
          { date: '2026-01-01', value: 50 },
        ],
      },
    ],
  };
  const egfrSnap15 = buildBrief(makeSnapshot([mtxChip]), trendDataEgfr15);
  const egfrNote15 = egfrSnap15.trendNotes.find((n) => n.text.toLowerCase().includes('egfr'));
  check(egfrNote15 !== undefined, 'eGFR exactly 15% decline → trend note');

  // eGFR improvement (not a decline) → no note
  const trendDataEgfrUp = {
    observationHistory: [
      {
        name: 'eGFR',
        history: [
          { date: '2026-06-01', value: 60 },
          { date: '2026-01-01', value: 45 },
        ],
      },
    ],
  };
  const egfrSnapUp = buildBrief(makeSnapshot([mtxChip]), trendDataEgfrUp);
  const egfrNoteUp = egfrSnapUp.trendNotes.find((n) => n.text.toLowerCase().includes('egfr'));
  check(egfrNoteUp === undefined, 'eGFR improvement → no trend note (only declines flagged)');

  // ── 11. Missing trendData → empty trendNotes ──────────────────────────────
  console.log('\n--- missing trendData ---');
  const noTrend = buildBrief(makeSnapshot([mtxChip]), null);
  check(Array.isArray(noTrend.trendNotes), 'trendNotes is array when trendData null');
  check(noTrend.trendNotes.length === 0, 'trendNotes empty when trendData null');

  const undefTrend = buildBrief(makeSnapshot([mtxChip]), undefined);
  check(undefTrend.trendNotes.length === 0, 'trendNotes empty when trendData undefined');

  const emptyTrend = buildBrief(makeSnapshot([mtxChip]), {});
  check(emptyTrend.trendNotes.length === 0, 'trendNotes empty when trendData has no observationHistory');

  // ── 12. Counts: separate red and amber ───────────────────────────────────
  console.log('\n--- counts ---');
  // overdue=0(red), not_met=0(red), stale=1(amber), due_soon=2(amber), in_date=5(green)
  const countChips = [
    { type: 'drug-monitoring', ruleId: 'a', status: 'overdue', drugName: 'DrugA', tests: [] },
    { type: 'qof-indicator', ruleId: 'b', status: 'not_met', indicatorCode: 'X001', indicatorName: 'X' },
    { type: 'drug-monitoring', ruleId: 'c', status: 'stale', drugName: 'DrugC', tests: [] },
    { type: 'drug-monitoring', ruleId: 'd', status: 'due_soon', drugName: 'DrugD', tests: [] },
    { type: 'drug-monitoring', ruleId: 'e', status: 'in_date', drugName: 'DrugE', tests: [] },
  ];
  const countBrief = buildBrief(makeSnapshot(countChips), null);
  check(countBrief !== null, 'count test → brief non-null');
  check(countBrief.counts.red === 2, `counts.red = 2 (got ${countBrief.counts.red})`);
  check(countBrief.counts.amber === 2, `counts.amber = 2 (got ${countBrief.counts.amber})`);

  // ── 13. Only green/neutral chips → allClear brief (loud green card) ───────
  console.log('\n--- all-clear chips ---');
  const allClear = buildBrief(makeSnapshot([inDateChip, achievedChip]), null);
  check(allClear !== null, 'all-clear chips → brief non-null (green card, not suppressed)');
  check(allClear.allClear === true, 'all-clear chips → allClear true');
  check(allClear.signals.length === 0, 'all-clear chips → no signals');
  check(allClear.counts.red === 0 && allClear.counts.amber === 0, 'all-clear chips → zero counts');
  check(
    allClear.groups.meds.status === 'clear' &&
      allClear.groups.qof.status === 'clear' &&
      allClear.groups.general.status === 'clear',
    'all-clear chips → all three groups clear'
  );

  // allClear is false as soon as anything is action-needed
  check(buildBrief(makeSnapshot([mtxChip]), null).allClear === false, 'action chip present → allClear false');

  // ── 13b. Per-group RAG: meds / qof / general split ────────────────────────
  console.log('\n--- per-group RAG ---');
  const vaxChip = { type: 'vaccine', ruleId: 'pcv20', status: 'vax_due', displayName: 'Pneumococcal (PCV20)' };
  const comboChip = { type: 'drug-combo', ruleId: 'pincer-2', status: 'alert', label: 'Anticoagulant + NSAID' };
  const fallsChip = { type: 'event-count', ruleId: 'falls', status: 'alert', label: 'Recurrent falls' };

  // meds red (combo alert), qof amber only via... dm006 is not_met = red. Use stale hyp001 for amber qof.
  const grouped = buildBrief(makeSnapshot([comboChip, mtxChip, hyp001Chip, vaxChip, inDateChip, achievedChip]), null);
  check(grouped !== null, 'grouped snapshot → brief non-null');
  check(grouped.allClear === false, 'grouped snapshot → allClear false');
  check(grouped.groups.meds.red === 2, `meds group red = 2 (got ${grouped.groups.meds.red})`);
  check(grouped.groups.meds.status === 'red', `meds group status red (got ${grouped.groups.meds.status})`);
  check(grouped.groups.qof.red === 0, `qof group red = 0 (got ${grouped.groups.qof.red})`);
  check(grouped.groups.qof.amber === 1, `qof group amber = 1 (got ${grouped.groups.qof.amber})`);
  check(grouped.groups.qof.status === 'amber', `qof group status amber (got ${grouped.groups.qof.status})`);
  check(grouped.groups.general.amber === 1, `general group amber = 1 (vax_due) (got ${grouped.groups.general.amber})`);
  check(grouped.groups.general.status === 'amber', `general group status amber (got ${grouped.groups.general.status})`);
  // in_date + achieved chips must not count anywhere
  check(grouped.counts.red === 2 && grouped.counts.amber === 2, 'green chips excluded from counts');

  // The safe-to-prescribe glance: meds clear while QOF/general have work.
  const medsClear = buildBrief(makeSnapshot([inDateChip, hyp001Chip, vaxChip]), null);
  check(medsClear.groups.meds.status === 'clear', 'in-date drug chip → meds group clear');
  check(medsClear.groups.qof.status === 'amber', 'QOF stale → qof group amber while meds clear');
  check(medsClear.allClear === false, 'meds clear but QOF/general due → allClear false');

  // Signals carry their group; unknown types fall through to general.
  check(
    grouped.signals.every((s) => ['meds', 'qof', 'general'].includes(s.group)),
    'every signal has a valid group'
  );
  const medsSignal = grouped.signals.find((s) => s.text.includes('Methotrexate'));
  check(medsSignal?.group === 'meds', `Methotrexate signal grouped as meds (got ${medsSignal?.group})`);
  const qofSignal = grouped.signals.find((s) => s.text.includes('HYP001'));
  check(qofSignal?.group === 'qof', `HYP001 signal grouped as qof (got ${qofSignal?.group})`);
  const unknownType = buildBrief(
    makeSnapshot([{ type: 'future-thing', ruleId: 'x', status: 'alert', label: 'X' }]),
    null
  );
  check(unknownType.groups.general.red === 1, 'unknown chip type falls through to general group');
  check(unknownType.signals[0].group === 'general', 'unknown chip type signal grouped as general');
  check(
    fallsChip && buildBrief(makeSnapshot([fallsChip]), null).groups.general.red === 1,
    'event-count grouped as general'
  );

  // Safety-monitoring observation alerts carry type 'qof-indicator' but
  // category 'safety-monitoring' — they are prescribing-safety, NOT QOF, and
  // must land in the meds group (sentinel's own list buckets them "not QOF").
  const safetyChip = {
    type: 'qof-indicator',
    category: 'safety-monitoring',
    ruleId: 'trend-egfr',
    status: 'alert',
    indicatorCode: 'TREND-EGFR',
    indicatorName: 'Falling eGFR trend',
  };
  const safety = buildBrief(makeSnapshot([safetyChip]), null);
  check(safety.groups.meds.red === 1, `safety-monitoring alert counts in meds group (got ${safety.groups.meds.red})`);
  check(safety.groups.qof.status === 'clear', 'safety-monitoring alert does NOT count as QOF');
  check(
    safety.signals[0].group === 'meds',
    `safety-monitoring signal grouped as meds (got ${safety.signals[0].group})`
  );

  // ── 14. Snapshot using patient field (not patientContext) ─────────────────
  console.log('\n--- snapshot.patient fallback ---');
  const patField = buildBrief({ chips: [mtxChip], patient }, null);
  check(patField !== null, 'snapshot.patient → brief non-null');
  check(patField.patientLine.includes('Smith'), `patientLine from snapshot.patient (got: "${patField.patientLine}")`);

  // ── 15. Single-reading trend data → no trend note ─────────────────────────
  console.log('\n--- single reading → no trend note ---');
  const oneReading = {
    observationHistory: [{ name: 'blood pressure', history: [{ date: '2026-06-01', rawValue: '165/92' }] }],
  };
  const oneReadBrief = buildBrief(makeSnapshot([mtxChip]), oneReading);
  check(oneReadBrief.trendNotes.length === 0, 'single BP reading → no trend note');

  const oneHba1c = {
    observationHistory: [{ name: 'HbA1c', history: [{ date: '2026-06-01', value: 65 }] }],
  };
  const oneHba1cBrief = buildBrief(makeSnapshot([dm006Chip]), oneHba1c);
  const noHba1cNote = oneHba1cBrief.trendNotes.find((n) => n.text.includes('HbA1c'));
  check(noHba1cNote === undefined, 'single HbA1c reading → no trend note');

  // ── Results ───────────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
