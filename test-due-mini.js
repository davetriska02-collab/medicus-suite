// Medicus Suite — due-mini.js unit tests
// Run with: node test-due-mini.js
//
// Pins the miniaturised "What's due" builder used by the floating
// Patient-actions panel:
//   • action-needed filter (STATUS_RANK <= 2)
//   • red-before-amber, drug-before-QOF ordering
//   • max-4 cap + moreCount / moreRed
//   • drug signal lists only due tests
//   • identity gate: dueFromSnapshot never returns chips for the wrong patient
//   • STATUS_RANK lock-step with the engine

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
  const mini = due.buildDueMini([dmChip, fluChip]);
  check(mini.items[0].text === 'DM006 — HbA1c ≤58 mmol/mol', `QOF text (got ${JSON.stringify(mini.items[0].text)})`);
  const vax = mini.items.find((i) => /Flu/.test(i.text));
  check(!!vax, 'vaccine item present');
  check(vax.severity === 'amber', 'vax_due is amber (rank 1)');
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
}

console.log('\n--- nothingDue is not an all-clear claim ---');
{
  const src = require('fs').readFileSync(path.join(__dirname, 'shared', 'due-mini.js'), 'utf8');
  check(!/\ball clear\b/i.test(src), 'due-mini source never says "all clear"');
  check(!/\bsafe to\b/i.test(src), 'due-mini source never says "safe to"');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
