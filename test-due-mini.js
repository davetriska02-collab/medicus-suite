// Medicus Suite — due-mini.js unit tests
// Run with: node test-due-mini.js
//
// Pins the miniaturised "What's due" builder used by the floating
// Patient-actions panel:
//   • action-needed filter (STATUS_RANK <= 2, plus drug-monitoring no_data)
//   • red-before-amber, drug-before-QOF (visual red, then type, then rank)
//   • max-4 cap + moreCount / moreRed
//   • drug signal lists only due tests
//   • identity gate: dueFromSnapshot never returns chips for the wrong patient
//   • STATUS_RANK lock-step with the engine
//   • journal-augment / unmatched-high-risk flags; QOF glance collisions; bidi strip

'use strict';

const path = require('path');

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

const due = require(path.join(__dirname, 'shared', 'due-mini.js'));
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));

console.log('--- exports ---');
check(typeof due.buildDueMini === 'function', 'buildDueMini exported');
check(typeof due.dueFromSnapshot === 'function', 'dueFromSnapshot exported');
check(due.MAX_ITEMS === 4, 'MAX_ITEMS is 4 (same cap as the Sentinel brief)');

console.log('\n--- STATUS_RANK lock-step with engine ---');
{
  const engineRank = engine.STATUS_RANK;
  const miniRank = due.STATUS_RANK;
  const engineKeys = Object.keys(engineRank).sort();
  const miniKeys = Object.keys(miniRank).sort();
  const missing = engineKeys.filter((k) => !(k in miniRank));
  const extra = miniKeys.filter((k) => !(k in engineRank));
  check(missing.length === 0, `every engine status is ranked in due-mini (${missing.join(', ') || 'none missing'})`);
  check(extra.length === 0, `due-mini has no extra statuses (${extra.join(', ') || 'none extra'})`);
  let valuesMatch = true;
  for (const k of engineKeys) {
    if (engineRank[k] !== miniRank[k]) valuesMatch = false;
  }
  check(valuesMatch, 'STATUS_RANK values match the engine table');
}

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

const dmChip = {
  type: 'qof-indicator',
  ruleId: 'dm006',
  status: 'not_met',
  indicatorCode: 'DM006',
  indicatorName: 'HbA1c ≤58 mmol/mol',
};

const hypSoon = {
  type: 'qof-indicator',
  ruleId: 'hyp001',
  status: 'due_soon',
  indicatorCode: 'HYP001',
  indicatorName: 'BP measured',
};

const fluChip = {
  type: 'vaccine',
  status: 'vax_due',
  displayName: 'Flu vaccine',
};

const achievedChip = {
  type: 'qof-indicator',
  status: 'achieved',
  indicatorCode: 'AST002',
  indicatorName: 'Asthma review',
};

console.log('\n--- action-needed filter ---');
{
  const mini = due.buildDueMini([mtxChip, dmChip, hypSoon, fluChip, achievedChip, null]);
  check(mini.nothingDue === false, 'nothingDue is false when action chips exist');
  check(mini.redCount === 2, `redCount is 2 (overdue + not_met), got ${mini.redCount}`);
  check(mini.amberCount === 2, `amberCount is 2 (due_soon + vax_due), got ${mini.amberCount}`);
  check(!mini.items.some((i) => /AST002|Asthma/.test(i.text)), 'achieved chips are excluded');
}

console.log('\n--- drug signal lists only due tests ---');
{
  const mini = due.buildDueMini([mtxChip]);
  check(mini.items.length === 1, 'one drug item');
  check(mini.items[0].severity === 'red', 'overdue drug is red');
  check(
    mini.items[0].text === 'Methotrexate — FBC, LFT overdue',
    `drug text lists only due tests (got ${JSON.stringify(mini.items[0].text)})`
  );
  check(!/U&E/.test(mini.items[0].text), 'in-date U&E is not listed');
  check(
    mini.items[0].label === 'Methotrexate — FBC, LFT',
    `label strips the trailing status word (got ${JSON.stringify(mini.items[0].label)})`
  );
}

console.log('\n--- empty / all-clear ---');
{
  const empty = due.buildDueMini([]);
  check(empty.nothingDue === true, 'empty chips → nothingDue');
  check(empty.items.length === 0, 'empty chips → no items');
  check(empty.redCount === 0 && empty.amberCount === 0, 'empty chips → zero counts');

  const green = due.buildDueMini([achievedChip, { type: 'drug-monitoring', status: 'in_date', drugName: 'Lithium' }]);
  check(green.nothingDue === true, 'only in-date/achieved → nothingDue (not an all-clear claim)');
  check(green.items.length === 0, 'only in-date/achieved → no items');
}

console.log('\n--- ordering + cap ---');
{
  const extraRed = {
    type: 'qof-indicator',
    status: 'overdue',
    indicatorCode: 'CKD002',
    indicatorName: 'ACR',
  };
  const extraAmber = {
    type: 'vaccine',
    status: 'due_soon',
    displayName: 'COVID vaccine',
  };
  const combo = {
    type: 'drug-combo',
    status: 'alert',
    displayName: 'Serotonin syndrome risk',
  };
  const mini = due.buildDueMini([hypSoon, extraAmber, dmChip, mtxChip, extraRed, combo]);
  check(mini.items.length === 4, `capped at 4 (got ${mini.items.length})`);
  check(mini.moreCount === 2, `moreCount is 2 (got ${mini.moreCount})`);
  check(mini.items[0].severity === 'red', 'first item is red');
  check(/Methotrexate/.test(mini.items[0].text), 'drug-monitoring ranks before QOF among reds');
  check(
    mini.items.every((i) => i.severity === 'red'),
    'first four are the reds (4 reds exist)'
  );
  check(mini.moreRed === 0, 'hidden items are the two ambers (moreRed 0)');
}

console.log('\n--- more line names hidden overdue, not the list total ---');
{
  check(due.moreLineText(3, 1) === '+3 more (1 of them overdue)', 'hidden red is "of them overdue"');
  check(due.moreLineText(2, 0) === '+2 more', 'no hidden red → no overdue clause');
  check(due.moreLineText(0, 1) === '', 'zero more → empty string');
}

console.log('\n--- lithium stale wins the visible four over a QOF review ---');
{
  const lithiumStale = {
    type: 'drug-monitoring',
    status: 'stale',
    drugName: 'Lithium',
    tests: [{ name: 'Lithium level', status: 'stale' }],
  };
  const asthma = {
    type: 'qof-indicator',
    status: 'not_met',
    indicatorCode: 'AST001',
    indicatorName: 'Asthma review',
  };
  const extraQof = {
    type: 'qof-indicator',
    status: 'not_met',
    indicatorCode: 'CKD001',
    indicatorName: 'Kidney review',
  };
  const extraQof2 = {
    type: 'qof-indicator',
    status: 'not_met',
    indicatorCode: 'HF001',
    indicatorName: 'Heart failure review',
  };
  const mini = due.buildDueMini([asthma, extraQof, extraQof2, lithiumStale, mtxChip]);
  check(mini.items.some((i) => /Lithium/.test(i.text)), 'severely-overdue lithium is in the visible four');
  check(mini.items[0] && /Methotrexate/.test(mini.items[0].text), 'overdue MTX still ranks first among red drugs');
  check(mini.allItems.length === 5, 'allItems keeps the uncapped list');
}

console.log('\n--- hidden red is counted ---');
{
  const reds = [
    mtxChip,
    dmChip,
    { type: 'qof-indicator', status: 'not_met', indicatorCode: 'A' },
    { type: 'qof-indicator', status: 'overdue', indicatorCode: 'B' },
    { type: 'qof-indicator', status: 'alert', indicatorCode: 'C' },
  ];
  const mini = due.buildDueMini(reds);
  check(mini.moreCount === 1, 'fifth red becomes moreCount');
  check(mini.moreRed === 1, 'hidden red is counted in moreRed (never silently dropped)');
}

console.log('\n--- QOF + vaccine wording ---');
{
  // 2026-08-28: DM006 now gets its own short disambiguator (was plain
  // "Diabetes review", indistinguishable from DM020/DM036 which need a
  // different action) — see QOF_CODE_DISAMBIGUATORS in due-mini.js.
  const mini = due.buildDueMini([dmChip, fluChip]);
  check(
    mini.items[0].text === 'DM006: ACE-I/ARB',
    `QOF glance disambiguates DM006 from the generic "Diabetes review" (got ${JSON.stringify(mini.items[0].text)})`
  );
  check(mini.items[0].label === mini.items[0].text, 'QOF label matches text — no trailing status word to strip');
  const vax = mini.items.find((i) => /Flu/.test(i.text));
  check(!!vax, 'vaccine item present');
  check(vax.severity === 'amber', 'vax_due is amber (rank 1)');
}

console.log('\n--- lithium stale is red (hue matches Severely overdue) ---');
{
  const lithiumStale = {
    type: 'drug-monitoring',
    ruleId: 'lithium-maintenance',
    status: 'stale',
    drugName: 'Lithium',
    tests: [{ name: 'Lithium level', status: 'stale' }],
  };
  const mini = due.buildDueMini([lithiumStale]);
  check(mini.items[0].status === 'stale', 'lithium item carries status stale');
  check(mini.items[0].severity === 'red', 'stale is red so the filled dot matches Severely overdue');
  check(mini.redCount === 1 && mini.amberCount === 0, 'stale counts as red, not amber');
  check(/severely overdue/.test(mini.items[0].text), 'line still says severely overdue');
  check(!/overdue/.test(mini.items[0].label), 'label strips the trailing "severely overdue" wording entirely');
}

console.log('\n--- drug-monitoring no_data is action-needed (HUD-aligned) ---');
{
  const leflunomide = {
    type: 'drug-monitoring',
    ruleId: 'leflunomide-maintenance',
    status: 'no_data',
    drugName: 'Leflunomide',
    tests: [
      { name: 'FBC', status: 'no_data' },
      { name: 'LFT', status: 'no_data' },
      { name: 'Weight', status: 'in_date' },
    ],
  };
  const qofNoData = {
    type: 'qof-indicator',
    status: 'no_data',
    indicatorCode: 'AST007',
    indicatorName: 'Asthma review',
  };
  const mini = due.buildDueMini([leflunomide, qofNoData, achievedChip]);
  check(mini.items.length === 1, 'only drug-monitoring no_data is included (QOF no_data stays out)');
  check(mini.items[0].severity === 'red', 'drug-monitoring no_data is red');
  check(
    mini.items[0].text === 'Leflunomide — no recent FBC, LFT',
    `no_data uses HUD wording (got ${JSON.stringify(mini.items[0].text)})`
  );
  check(
    mini.items[0].label === 'Leflunomide — FBC, LFT',
    `label drops "no recent" in favour of the tag (got ${JSON.stringify(mini.items[0].label)})`
  );
  check(!mini.items.some((i) => /AST007|Asthma/.test(i.text)), 'QOF no_data is not listed as due');
}

console.log('\n--- QOF glance: MH011 is lipids, prefixes need a digit ---');
{
  const mh011 = {
    type: 'qof-indicator',
    status: 'not_met',
    indicatorCode: 'MH011',
    indicatorName: 'Lipid profile recorded in SMI (preceding 12 months)',
  };
  const mh002 = {
    type: 'qof-indicator',
    status: 'not_met',
    indicatorCode: 'MH002',
    indicatorName: 'Comprehensive care plan in SMI',
  };
  const ldl = {
    type: 'qof-indicator',
    status: 'not_met',
    indicatorCode: 'LDL99',
    indicatorName: 'LDL cholesterol',
  };
  const mh = due.buildDueMini([mh011]);
  check(
    mh.items[0].text === 'Lipid profile (SMI)',
    `MH011 is lipid profile, not a mental-health review (got ${JSON.stringify(mh.items[0].text)})`
  );
  const mhReview = due.buildDueMini([mh002]);
  check(
    mhReview.items[0].text === 'Mental health review',
    `MH002 still glances as mental health review (got ${JSON.stringify(mhReview.items[0].text)})`
  );
  const ldlMini = due.buildDueMini([ldl]);
  check(
    ldlMini.items[0].text === 'LDL cholesterol',
    `LD prefix does not steal LDL… codes (got ${JSON.stringify(ldlMini.items[0].text)})`
  );
}

console.log('\n--- bidi controls stripped from labels ---');
{
  const poisoned = {
    type: 'drug-monitoring',
    status: 'overdue',
    drugName: 'Methotrexate\u202E',
    tests: [{ name: 'FBC', status: 'overdue' }],
  };
  const mini = due.buildDueMini([poisoned]);
  check(!/[\u202A-\u202E\u2066-\u2069]/.test(mini.items[0].text), 'bidi controls stripped from text');
  check(!/[\u202A-\u202E\u2066-\u2069]/.test(mini.items[0].label), 'bidi controls stripped from label');
}

console.log('\n--- XSS payloads stay in the string (esc is the render boundary) ---');
{
  const xss = {
    type: 'drug-monitoring',
    status: 'overdue',
    drugName: '<img onerror=alert(1)>',
    tests: [{ name: '<script>alert(1)</script>', status: 'overdue' }],
  };
  const mini = due.buildDueMini([xss]);
  check(/<img onerror/.test(mini.items[0].label), 'payload survives as text for the panel to escape');
}

console.log('\n--- unclassified statuses fail closed ---');
{
  const junk = due.buildDueMini([{ type: 'drug-monitoring', status: 'totally_unknown', drugName: 'X' }]);
  check(junk.unclassified === true, 'unknown status → unclassified (not nothingDue)');
  check(junk.nothingDue === false, 'unknown status is not painted as nothing due');
  const mixed = due.buildDueMini([achievedChip, { type: 'qof-indicator', status: '???', indicatorCode: 'Z' }]);
  check(mixed.unclassified === true && mixed.nothingDue === false, 'achieved + unknown → unclassified, not all-clear');
}

console.log('\n--- identity gate (dueFromSnapshot) ---');
{
  const pid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const snap = {
    chips: [mtxChip],
    patientContext: { patientUuid: pid },
    degraded: false,
  };

  check(due.dueFromSnapshot(null, pid).state === 'pending', 'null snapshot → pending');
  check(
    due.dueFromSnapshot({ unavailable: true, chips: [mtxChip], patientContext: { patientUuid: pid } }, pid).state ===
      'pending',
    'unavailable snapshot → pending (even with chips)'
  );
  check(
    due.dueFromSnapshot({ chips: null, patientContext: { patientUuid: pid } }, pid).state === 'pending',
    'chips:null → pending'
  );
  check(due.dueFromSnapshot(snap, null).state === 'pending', 'missing caller patientId → pending');
  check(due.dueFromSnapshot(snap, other).state === 'pending', 'wrong patient → pending (never their chips)');
  check(
    due.dueFromSnapshot({ chips: [mtxChip], patientContext: { patientUuid: other } }, pid).state === 'pending',
    'snapshot for someone else → pending'
  );

  const ready = due.dueFromSnapshot(snap, pid);
  check(ready.state === 'ready', 'matching patient → ready');
  check(ready.mini && ready.mini.items.length === 1, 'matching patient → mini items');
  check(ready.degraded === false, 'degraded flag forwarded');

  const caseFold = due.dueFromSnapshot(snap, pid.toUpperCase());
  check(caseFold.state === 'ready', 'UUID compare is case-insensitive');

  const altField = due.dueFromSnapshot({ chips: [mtxChip], patientContext: { patientId: pid } }, pid);
  check(altField.state === 'ready', 'patientId alias accepted');

  const degraded = due.dueFromSnapshot({ chips: [mtxChip], patientContext: { patientUuid: pid }, degraded: true }, pid);
  check(
    degraded.state === 'ready' && degraded.degraded === true,
    'degraded snapshot still ready (caller surfaces the warning, does not hide due items)'
  );

  const journal = due.dueFromSnapshot(
    { chips: [], patientContext: { patientUuid: pid }, journalAugmentFailed: true },
    pid
  );
  check(journal.state === 'ready', 'journal-failed empty snapshot is still ready (identity matched)');
  check(journal.journalAugmentFailed === true, 'journalAugmentFailed is forwarded');
  check(journal.mini && journal.mini.nothingDue === true, 'empty chips still produce nothingDue for the caller to override');

  const highRisk = due.dueFromSnapshot(
    {
      chips: [],
      patientContext: { patientUuid: pid },
      unmatchedHighRisk: [{ name: 'Jaylamine 100mg', riskClass: 'DMARD' }],
    },
    pid
  );
  check(highRisk.unmatchedHighRisk && highRisk.unmatchedHighRisk.length === 1, 'unmatchedHighRisk is forwarded');
  check(highRisk.unmatchedHighRisk[0].name === 'Jaylamine 100mg', 'high-risk name preserved');

  const journalWrongPatient = due.dueFromSnapshot(
    { chips: [], patientContext: { patientUuid: other }, journalAugmentFailed: true },
    pid
  );
  check(
    journalWrongPatient.state === 'pending' && journalWrongPatient.journalAugmentFailed == null,
    'journal flag never leaks across a patient mismatch'
  );
}

console.log('\n--- reception voice (booking list, no clinical jargon) ---');
{
  const clinic = due.buildDueMini([mtxChip, dmChip]);
  check(clinic.voice === 'clinic', 'default voice is clinic');
  check(/FBC, LFT/.test(clinic.items[0].text), 'clinic drug line still names tests');

  const rec = due.buildDueMini([mtxChip, dmChip, fluChip], { voice: 'reception' });
  check(rec.voice === 'reception', 'opts.voice reception is recorded');
  const mtx = rec.items.find((i) => /Methotrexate/.test(i.text));
  check(!!mtx, 'reception still lists methotrexate (as a booking line)');
  check(mtx.text === 'Methotrexate bloods', `reception drug is "Methotrexate bloods" (got ${JSON.stringify(mtx.text)})`);
  check(!/FBC|LFT|overdue/.test(mtx.text), 'reception drug line drops test names and overdue jargon');
  const dm = rec.items.find((i) => /diabetes/i.test(i.text));
  check(dm && dm.text === 'Book a diabetes review', `reception QOF is a booking verb (got ${JSON.stringify(dm && dm.text)})`);
  const flu = rec.items.find((i) => /Flu/.test(i.text));
  check(flu && flu.text === 'Book Flu vaccine', `reception vaccine is a booking line (got ${JSON.stringify(flu && flu.text)})`);

  const combo = {
    type: 'drug-combo',
    status: 'alert',
    displayName: 'Serotonin syndrome risk',
  };
  const lithiumStale = {
    type: 'drug-monitoring',
    status: 'stale',
    drugName: 'Lithium',
    tests: [{ name: 'Lithium level', status: 'stale' }],
  };
  const recFilter = due.buildDueMini([combo, lithiumStale, dmChip], { voice: 'reception' });
  check(
    !recFilter.items.some((i) => /[Ss]erotonin|[Ss]yndrome/.test(i.text)),
    'reception voice drops combo/alert chips (not a booking)'
  );
  check(
    recFilter.items.some((i) => i.text === 'Lithium bloods'),
    'reception lithium is "Lithium bloods", not a level/severely-overdue line'
  );
  check(
    !recFilter.items.some((i) => /severely overdue|Lithium level/.test(i.text + i.label)),
    'reception lithium line has no clinical test jargon'
  );

  const pid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const snap = { chips: [mtxChip], patientContext: { patientUuid: pid } };
  const voiced = due.dueFromSnapshot(snap, pid, { voice: 'reception' });
  check(voiced.state === 'ready' && voiced.mini.voice === 'reception', 'dueFromSnapshot forwards voice after the identity gate');
  check(voiced.mini.items[0].text === 'Methotrexate bloods', 'ready reception mini uses booking wording');
  check(
    due.dueFromSnapshot(snap, other, { voice: 'reception' }).state === 'pending',
    'reception voice never bypasses the wrong-patient gate'
  );
}

console.log('\n--- nursing voice (treatment room, no clinical jargon / no Book) ---');
{
  const combo = {
    type: 'drug-combo',
    status: 'alert',
    displayName: 'Serotonin syndrome risk',
  };
  const nurse = due.buildDueMini([mtxChip, dmChip, fluChip, combo], { voice: 'nursing' });
  check(nurse.voice === 'nursing', 'opts.voice nursing is recorded');
  check(
    nurse.items.some((i) => i.text === 'Methotrexate bloods'),
    'nursing drug is "Methotrexate bloods", not FBC/LFT'
  );
  check(
    !nurse.items.some((i) => /FBC|LFT|serotonin/i.test(i.text + i.label)),
    'nursing drops test names and combo alerts'
  );
  check(
    nurse.items.some((i) => i.text === 'DM006: ACE-I/ARB'),
    'nursing QOF names the specific review (DM006 disambiguator), not "Book a …"'
  );
  check(
    !nurse.items.some((i) => /^Book /.test(i.text)),
    'nursing voice never uses the booking verb'
  );
  check(
    nurse.items.some((i) => /Flu/.test(i.text)),
    'nursing still lists a due vaccine'
  );
  const pid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const snap = { chips: [mtxChip], patientContext: { patientUuid: pid } };
  check(
    due.dueFromSnapshot(snap, pid, { voice: 'nursing' }).state === 'ready',
    'dueFromSnapshot forwards nursing voice after the identity gate'
  );
  check(
    due.dueFromSnapshot(snap, other, { voice: 'nursing' }).state === 'pending',
    'nursing voice never bypasses the wrong-patient gate'
  );
}

console.log('\n--- nothingDue is not an all-clear claim ---');
{
  const src = require('fs').readFileSync(path.join(__dirname, 'shared', 'due-mini.js'), 'utf8');
  check(!/\ball clear\b/i.test(src), 'due-mini source never says "all clear"');
  check(!/\bsafe to\b/i.test(src), 'due-mini source never says "safe to"');
}

console.log('\n--- 2026-08-28: QOF code disambiguators (AST014/015, DM006/020/036) ---');
{
  // Reported live: AST014 (new-diagnosis objective test) and AST015 (annual
  // review) both fell through to the same generic "Asthma review" prefix
  // text, so a clinic user couldn't tell which was which at a glance. Same
  // problem for DM006/DM020/DM036 all showing "Diabetes review".
  const ast014Chip = { type: 'qof-indicator', status: 'overdue', indicatorCode: 'AST014' };
  const ast015Chip = { type: 'qof-indicator', status: 'overdue', indicatorCode: 'AST015' };
  const dm020Chip = { type: 'qof-indicator', status: 'not_met', indicatorCode: 'DM020' };
  const dm036Chip = { type: 'qof-indicator', status: 'not_met', indicatorCode: 'DM036' };

  const clinicAst = due.buildDueMini([ast014Chip, ast015Chip]);
  check(
    clinicAst.items.find((i) => i.text.startsWith('AST014')).text === 'AST014: test <3m of diag',
    'clinic: AST014 gets its own short disambiguator'
  );
  check(
    clinicAst.items.some((i) => i.text === 'Asthma review'),
    'clinic: AST015 keeps the plain "Asthma review" text (it IS the review — only AST014 needed disambiguating)'
  );
  check(
    clinicAst.items[0].text !== clinicAst.items[1].text,
    'AST014 and AST015 no longer produce identical glance text'
  );

  const clinicDm = due.buildDueMini([dm020Chip, dm036Chip]);
  check(
    clinicDm.items.find((i) => i.text.startsWith('DM020')).text === 'DM020: HbA1c ≤58',
    'clinic: DM020 gets its own short disambiguator'
  );
  check(
    clinicDm.items.find((i) => i.text.startsWith('DM036')).text === 'DM036: BP target',
    'clinic: DM036 gets its own short disambiguator'
  );

  // Critical: the raw "CODE: " disambiguator must NEVER leak into the
  // reception booking sentence — "Book an AST014: test <3m of diag" would
  // read as nonsense to someone booking an appointment slot. Reception keeps
  // the broader, booking-appropriate prefix wording instead.
  const recAst = due.buildDueMini([ast014Chip], { voice: 'reception' });
  check(
    recAst.items[0].text === 'Book an asthma review',
    `reception: AST014 still books the broad appointment type, not the raw disambiguator (got ${JSON.stringify(recAst.items[0].text)})`
  );
  check(!/AST014/.test(recAst.items[0].text), 'reception: the raw QOF code never appears in a booking sentence');

  const recDm = due.buildDueMini([dm020Chip], { voice: 'reception' });
  check(
    recDm.items[0].text === 'Book a diabetes review',
    `reception: DM020 still books the broad appointment type (got ${JSON.stringify(recDm.items[0].text)})`
  );
  check(!/DM020/.test(recDm.items[0].text), 'reception: the raw QOF code never appears in a booking sentence');

  // Nursing shares the clinic glance directly (same as the pre-existing MH011
  // behaviour) — the disambiguator is useful there too, not just clinic.
  const nurseAst = due.buildDueMini([ast014Chip], { voice: 'nursing' });
  check(
    nurseAst.items[0].text === 'AST014: test <3m of diag',
    'nursing: gets the same short disambiguator as clinic (not the booking sentence)'
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
