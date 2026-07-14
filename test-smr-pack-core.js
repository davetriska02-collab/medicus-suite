// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
//
// test-smr-pack-core.js — unit tests for buildSmrPack()
// Run with: node test-smr-pack-core.js
//
// Pins:
//   • gap block always present (3 entries: allergies, immunisations, consultation history)
//   • empty-section honesty lines for every section that can be empty (never a
//     silent blank — absence must never read as "reviewed and clear")
//   • no "undefined"/"null" token ever appears in a rendered (string) value
//   • letterhead placeholders ('[Practice name]' / '[Clinician name]') when unset
//   • letterhead passthrough when set
//   • medications / monitoring / QOF / problems / observations composition from
//     a realistic fixture (doses, overdue/review flags, per-test due text,
//     major-problem flagging, high/low observation flags)
//   • ACB/STOPP-START unavailable in a non-browser (window-less) environment
//     render an explicit "unavailable" note, not a blank/undefined
//   • generatedAt honours the injected nowISO (deterministic for callers/tests)
//   • null/undefined model never throws and never returns null (unlike passport)

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

// Recursively collect every string leaf value in an object/array so we can
// assert none of them ever render the literal tokens "undefined" or "null" —
// the patient-safety requirement that absence is always spelled out in words,
// never leaked as a raw JS stringification artefact.
function collectStrings(value, out) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectStrings(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collectStrings(v, out));
  }
  return out;
}

async function runTests() {
  const modPath = new URL('side-panel/modules/record/smr-pack-core.js', `file://${process.cwd().replace(/\\/g, '/')}/`)
    .href;

  let buildSmrPack;
  try {
    const mod = await import(modPath);
    buildSmrPack = mod.buildSmrPack;
    check(typeof buildSmrPack === 'function', 'buildSmrPack imported');
  } catch (e) {
    console.error('FATAL: could not import smr-pack-core.js:', e.message);
    process.exitCode = 1;
    return;
  }

  const NOW_ISO = '2026-07-04T09:41:00.000Z';

  // ── Fixtures ────────────────────────────────────────────────────────────────

  const FIXTURE_MODEL = {
    patientContext: {
      patientName: 'Joan Smith',
      ageYears: 78,
      sex: 'Female',
      dob: '1948-03-12',
      // Deliberately fails NHS Modulus-11 (the valid check digit here is 9) so
      // the patient-data CI guard can prove this fixture is synthetic:
      nhsNumber: '9000000001',
      namedGP: 'Dr A. Patel',
      isDeceased: false,
      testPatient: false,
    },
    medications: [
      { name: 'Methotrexate 10mg tablets', dosage: '10mg once weekly', isOverDue: false, isReviewOverDue: true },
      { name: 'Folic acid 5mg tablets', dosage: '5mg once weekly', isOverDue: true, isReviewOverDue: false },
      { name: 'Ramipril 5mg capsules', dosage: '5mg once daily', isOverDue: false, isReviewOverDue: false },
    ],
    problems: [
      { label: 'Rheumatoid arthritis', codedDate: '2012-06-01', significance: 'Major' },
      { label: 'Hypertension', codedDate: '2019-01-15', significance: '' },
    ],
    pastProblems: [{ label: 'Appendicitis', codedDate: '1995-04-20' }],
    observations: [
      { name: 'eGFR', rawValue: '58', value: '58 mL/min/1.73m²', date: '2026-05-10', isAbove: false, isBelow: false },
      { name: 'Haemoglobin', rawValue: '102', value: '102 g/L', date: '2026-05-10', isAbove: false, isBelow: true },
      { name: 'ALT', rawValue: '250', value: '250 U/L', date: '2026-05-10', isAbove: true, isBelow: false },
    ],
    apiErrors: {},
  };

  const FIXTURE_CHIPS = [
    {
      type: 'drug-monitoring',
      ruleId: 'methotrexate-maintenance',
      status: 'overdue',
      drugName: 'Methotrexate',
      sharedCare: true,
      tests: [
        { name: 'FBC', status: 'overdue', days: 120, intervalDays: 90 },
        { name: 'LFT', status: 'due_soon', days: 80, intervalDays: 90 },
        { name: 'U&E', status: 'in_date', days: 10, intervalDays: 90 },
      ],
    },
    {
      type: 'qof-indicator',
      ruleId: 'ra001',
      indicatorCode: 'RA001',
      indicatorName: 'Rheumatoid arthritis annual review',
      status: 'not_met',
    },
    {
      type: 'qof-register',
      ruleId: 'ra-register',
      registerCode: 'RA',
      registerName: 'Rheumatoid arthritis register',
      status: 'achieved',
    },
  ];

  const FIXTURE_LETTERHEAD = { practiceName: 'Elm Tree Surgery', clinicianName: 'Dr S. Okafor' };

  // ── 1. Gap block always present ────────────────────────────────────────────
  console.log('\n--- mandatory gap block ---');
  const full = buildSmrPack(FIXTURE_MODEL, FIXTURE_CHIPS, FIXTURE_LETTERHEAD, NOW_ISO);
  check(Array.isArray(full.gaps) && full.gaps.length === 3, `gaps has exactly 3 entries (got ${full.gaps?.length})`);
  check(
    full.gaps.some((g) => /allerg/i.test(g.label)),
    'gap block includes allergies & adverse reactions'
  );
  check(
    full.gaps.some((g) => /immunisation/i.test(g.label)),
    'gap block includes immunisations'
  );
  check(
    full.gaps.some((g) => /consultation history/i.test(g.label)),
    'gap block includes consultation history'
  );
  full.gaps.forEach((g) => {
    check(typeof g.note === 'string' && g.note.length > 0, `gap "${g.label}" has a non-empty note`);
  });

  // Gap block present even for a completely empty/absent model.
  const emptyModelPack = buildSmrPack(null, null, null, NOW_ISO);
  check(emptyModelPack !== null, 'null model never returns null (unlike passport)');
  check(Array.isArray(emptyModelPack.gaps) && emptyModelPack.gaps.length === 3, 'gap block present for null model too');

  // ── 2. Empty-section honesty lines ─────────────────────────────────────────
  console.log('\n--- empty-section honesty lines ---');
  check(emptyModelPack.problems.count === 0, 'empty model -> 0 active problems');
  check(
    typeof emptyModelPack.problems.emptyNote === 'string' && emptyModelPack.problems.emptyNote.length > 0,
    `problems emptyNote present (got: "${emptyModelPack.problems.emptyNote}")`
  );
  check(
    typeof emptyModelPack.medications.emptyNote === 'string' && emptyModelPack.medications.emptyNote.length > 0,
    `medications emptyNote present (got: "${emptyModelPack.medications.emptyNote}")`
  );
  check(
    typeof emptyModelPack.observations.emptyNote === 'string' && emptyModelPack.observations.emptyNote.length > 0,
    `observations emptyNote present (got: "${emptyModelPack.observations.emptyNote}")`
  );

  // chips === null (unavailable) -> monitoring/qof must say "unavailable", not "none"
  check(emptyModelPack.monitoring.available === false, 'chips=null -> monitoring.available is false');
  check(
    /unavailable/i.test(emptyModelPack.monitoring.emptyNote || ''),
    `monitoring emptyNote distinguishes "unavailable" from "none" (got: "${emptyModelPack.monitoring.emptyNote}")`
  );
  check(emptyModelPack.qof.available === false, 'chips=null -> qof.available is false');
  check(
    /unavailable/i.test(emptyModelPack.qof.emptyNote || ''),
    `qof emptyNote distinguishes "unavailable" from "none" (got: "${emptyModelPack.qof.emptyNote}")`
  );

  // chips === [] (available but empty) -> "no chips", NOT "unavailable"
  const emptyChipsPack = buildSmrPack(FIXTURE_MODEL, [], FIXTURE_LETTERHEAD, NOW_ISO);
  check(emptyChipsPack.monitoring.available === true, 'chips=[] -> monitoring.available is true');
  check(
    !/unavailable/i.test(emptyChipsPack.monitoring.emptyNote || '') &&
      typeof emptyChipsPack.monitoring.emptyNote === 'string',
    `monitoring emptyNote for chips=[] does not say "unavailable" (got: "${emptyChipsPack.monitoring.emptyNote}")`
  );
  check(emptyChipsPack.qof.available === true, 'chips=[] -> qof.available is true');
  check(
    !/unavailable/i.test(emptyChipsPack.qof.emptyNote || ''),
    `qof emptyNote for chips=[] does not say "unavailable" (got: "${emptyChipsPack.qof.emptyNote}")`
  );

  // ── 3. No "undefined"/"null" token in any rendered string ─────────────────
  console.log('\n--- no undefined/null tokens ---');
  [full, emptyModelPack, emptyChipsPack].forEach((pack, i) => {
    const strings = collectStrings(pack, []);
    const joined = strings.join(' ␟ ');
    check(!/\bundefined\b/.test(joined), `pack #${i} has no bare "undefined" token`);
    check(!/\bnull\b/i.test(joined), `pack #${i} has no bare "null" token`);
  });

  // ── 4. Letterhead placeholders when unset ──────────────────────────────────
  console.log('\n--- letterhead ---');
  check(
    emptyModelPack.practice.practiceName === '[Practice name]',
    `unset letterhead -> practice placeholder (got: "${emptyModelPack.practice.practiceName}")`
  );
  check(
    emptyModelPack.practice.clinicianName === '[Clinician name]',
    `unset letterhead -> clinician placeholder (got: "${emptyModelPack.practice.clinicianName}")`
  );
  const emptyObjLetterheadPack = buildSmrPack(FIXTURE_MODEL, [], {}, NOW_ISO);
  check(
    emptyObjLetterheadPack.practice.practiceName === '[Practice name]',
    'empty-object letterhead -> practice placeholder'
  );

  check(full.practice.practiceName === 'Elm Tree Surgery', 'set letterhead -> practice name passed through');
  check(full.practice.clinicianName === 'Dr S. Okafor', 'set letterhead -> clinician name passed through');

  // ── 5. generatedAt honours injected nowISO ─────────────────────────────────
  console.log('\n--- generatedAt ---');
  check(full.generatedAt === NOW_ISO, `generatedAt matches injected nowISO (got: "${full.generatedAt}")`);
  const fallbackPack = buildSmrPack(FIXTURE_MODEL, [], null, null);
  check(
    typeof fallbackPack.generatedAt === 'string' && fallbackPack.generatedAt.includes('T'),
    'omitted nowISO falls back to a real ISO timestamp'
  );

  // ── 6. Problems composition ────────────────────────────────────────────────
  console.log('\n--- problems composition ---');
  check(full.problems.count === 2, `problems.count is 2 (got ${full.problems.count})`);
  check(full.problems.pastCount === 1, `problems.pastCount is 1 (got ${full.problems.pastCount})`);
  const raProblem = full.problems.active.find((p) => p.label === 'Rheumatoid arthritis');
  check(!!raProblem && raProblem.major === true, 'RA problem (significance: Major) flagged major');
  const htnProblem = full.problems.active.find((p) => p.label === 'Hypertension');
  check(!!htnProblem && htnProblem.major === false, 'Hypertension (no significance) not flagged major');
  check(full.problems.emptyNote === null, 'problems.emptyNote is null when problems present');

  // ── 7. Medications composition ─────────────────────────────────────────────
  console.log('\n--- medications composition ---');
  check(full.medications.count === 3, `medications.count is 3 (got ${full.medications.count})`);
  const mtx = full.medications.items.find((m) => m.name.includes('Methotrexate'));
  check(!!mtx && mtx.dosage === '10mg once weekly', 'methotrexate dose composed correctly');
  check(!!mtx && mtx.reviewOverdue === true && mtx.overdue === false, 'methotrexate flagged review-overdue only');
  const folic = full.medications.items.find((m) => m.name.includes('Folic'));
  check(!!folic && folic.overdue === true && folic.reviewOverdue === false, 'folic acid flagged overdue only');

  // ── 8. Monitoring composition (per-test due text) ──────────────────────────
  console.log('\n--- monitoring composition ---');
  check(full.monitoring.count === 1, `monitoring.count is 1 (got ${full.monitoring.count})`);
  const mtxChip = full.monitoring.items[0];
  check(mtxChip.drugName === 'Methotrexate', 'monitoring item drugName correct');
  check(mtxChip.sharedCare === true, 'monitoring item sharedCare flag passed through');
  check(mtxChip.statusLabel === 'Overdue', `monitoring item statusLabel humanised (got: "${mtxChip.statusLabel}")`);
  const fbcTest = mtxChip.tests.find((t) => t.name === 'FBC');
  check(fbcTest?.dueText === 'due 30d ago', `overdue test due-text correct (got: "${fbcTest?.dueText}")`);
  const lftTest = mtxChip.tests.find((t) => t.name === 'LFT');
  check(lftTest?.dueText === 'due in 10d', `due-soon test due-text correct (got: "${lftTest?.dueText}")`);
  const ueTest = mtxChip.tests.find((t) => t.name === 'U&E');
  check(ueTest?.dueText === '10d since last', `in-date test due-text correct (got: "${ueTest?.dueText}")`);

  // ── 9. QOF gaps composition ─────────────────────────────────────────────────
  console.log('\n--- QOF composition ---');
  check(full.qof.checkedCount === 2, `qof.checkedCount is 2 (got ${full.qof.checkedCount})`);
  const ra001 = full.qof.items.find((q) => q.code === 'RA001');
  check(!!ra001 && ra001.kind === 'indicator' && ra001.statusLabel === 'Not met', 'QOF indicator composed correctly');
  const raRegister = full.qof.items.find((q) => q.code === 'RA');
  check(
    !!raRegister && raRegister.kind === 'register' && raRegister.statusLabel === 'On register',
    'QOF register composed correctly (not mislabelled via generic status phrase)'
  );

  // ── 10. Observations composition ────────────────────────────────────────────
  console.log('\n--- observations composition ---');
  check(full.observations.count === 3, `observations.count is 3 (got ${full.observations.count})`);
  const alt = full.observations.items.find((o) => o.name === 'ALT');
  check(alt?.flag === 'high', `ALT flagged high (got: "${alt?.flag}")`);
  const hb = full.observations.items.find((o) => o.name === 'Haemoglobin');
  check(hb?.flag === 'low', `Haemoglobin flagged low (got: "${hb?.flag}")`);
  const egfr = full.observations.items.find((o) => o.name === 'eGFR');
  check(egfr?.flag === null, 'eGFR (in range) has no flag');

  // ── 11. Prescribing safety prompts — unavailable in a window-less env ──────
  console.log('\n--- prescribing safety (no window in this test env) ---');
  check(full.safety.acb.available === false, 'ACB unavailable without window.ACBScores');
  check(
    typeof full.safety.acb.note === 'string' && /unavailable/i.test(full.safety.acb.note),
    `ACB note explains unavailability (got: "${full.safety.acb.note}")`
  );
  check(full.safety.stoppStart.available === false, 'STOPP/START unavailable without window.StoppStart');
  check(
    typeof full.safety.stoppStart.note === 'string' && /unavailable/i.test(full.safety.stoppStart.note),
    `STOPP/START note explains unavailability (got: "${full.safety.stoppStart.note}")`
  );
  check(
    full.safety.acb.total === 0 && full.safety.acb.perDrug.length === 0,
    'ACB defaults to 0/empty (not undefined) when unavailable'
  );
  check(
    Array.isArray(full.safety.stoppStart.flags) && full.safety.stoppStart.flags.length === 0,
    'STOPP/START defaults to empty array when unavailable'
  );

  // ── 12. Verbatim clinical-safety caveat ─────────────────────────────────────
  console.log('\n--- caveat ---');
  const expectedCaveat =
    'Coded live snapshot, not the complete record. Excludes allergies, immunisations and free-text history. ' +
    'Verify against the patient record before any prescribing decision.';
  check(full.caveat === expectedCaveat, `caveat matches verbatim wording (got: "${full.caveat}")`);

  // ── Results ───────────────────────────────────────────────────────────────
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
