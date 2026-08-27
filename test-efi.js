// Medicus Suite — eFI engine + Sentinel frailty-slip indicator
// Run with: node test-efi.js
'use strict';

const path = require('path');
const Efi = require(path.join(__dirname, 'engine', 'efi.js'));
const engine = require(path.join(__dirname, 'engine', 'rules-engine.js'));
const qof = require(path.join(__dirname, 'rules', 'qof-rules.json'));

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const NOW = '2026-08-27';

function qofRule() {
  return qof.rules.find((r) => r.id === 'trend-frailty-slipping');
}

function evalChip(data, now) {
  const rule = qofRule();
  return engine.evaluateQofIndicatorRule(rule, { ...data, _registerLookup: {} }, now || NOW);
}

console.log('\n--- visualiser fallback table stays in lock-step ---');
{
  const fs = require('fs');
  const vis = fs.readFileSync(path.join(__dirname, 'visualiser-core.js'), 'utf8');
  const start = vis.indexOf('const EFI_DEFICITS = [');
  const end = vis.indexOf('const CHARLSON_WEIGHTS');
  const block = start >= 0 && end > start ? vis.slice(start, end) : '';
  const visIds = [...block.matchAll(/id: '([a-z_]+)'/g)].map((m) => m[1]);
  const engineIds = Efi.EFI_DEFICITS.map((d) => d.id);
  check(visIds.length === 36, `visualiser EFI_DEFICITS still has 36 ids (got ${visIds.length})`);
  check(visIds.join() === engineIds.join(), 'visualiser fallback deficit ids match engine/efi.js');
}

console.log('\n--- eFI table shape ---');
check(Efi.EFI_DEFICITS.length === 36, '36 Clegg deficits');
check(Efi.EFI_DEFICITS.filter((d) => d.id === 'polypharm').length === 1, 'polypharmacy is one of the 36');
check(Efi.categoryFromScore(0.12) === 'Fit', '0.12 is Fit');
check(Efi.categoryFromScore(0.121) === 'Mild frailty', '>0.12 is Mild');
check(Efi.categoryFromScore(0.25) === 'Moderate frailty', '0.25 is Moderate');
check(Efi.categoryFromScore(0.36) === 'Moderate frailty', '0.36 is Moderate');
check(Efi.categoryFromScore(0.361) === 'Severe frailty', '>0.36 is Severe');

console.log('\n--- computeEFI matching ---');
{
  const r = Efi.computeEFI({
    problems: [{ label: 'Type 2 diabetes mellitus', codedDate: '2018-01-01' }],
    medications: [],
  });
  check(
    r.ticked.some((t) => t.id === 'diabetes'),
    'ticks diabetes on T2DM'
  );
  check(r.category === 'Fit', 'single deficit stays Fit (1/36)');
}
{
  const r = Efi.computeEFI({
    problems: [{ label: 'No frailty', codedDate: '2024-01-01' }],
    medications: [],
  });
  check(!r.ticked.some((t) => t.id === 'activity'), '"No frailty" does not tick activity/frailty');
}
{
  const r = Efi.computeEFI({
    problems: [{ label: 'Family history of stroke', codedDate: '2020-01-01' }],
    medications: [],
  });
  check(!r.ticked.some((t) => t.id === 'cva'), 'family history of stroke does not tick CVA');
}
{
  const r = Efi.computeEFI({
    problems: [],
    medications: ['ramipril', 'atorvastatin', 'metformin', 'amlodipine', 'lansoprazole'],
  });
  check(
    r.ticked.some((t) => t.id === 'polypharm'),
    '5 named drugs tick polypharmacy'
  );
}
{
  const r = Efi.computeEFI({
    problems: [],
    medications: ['ramipril', 'atorvastatin', 'metformin', 'amlodipine'],
  });
  check(!r.ticked.some((t) => t.id === 'polypharm'), '4 drugs do not tick polypharmacy');
}

console.log('\n--- asOf reconstruction ---');
{
  const problems = [
    { label: 'Hypertension', codedDate: '2019-03-01' },
    { label: 'Type 2 diabetes mellitus', codedDate: '2025-06-01' },
  ];
  const then = Efi.computeEFI({ problems, medications: [], asOf: '2024-08-27' });
  const now = Efi.computeEFI({ problems, medications: [], asOf: NOW });
  check(then.ticked.map((t) => t.id).join() === 'htn', 'then: only hypertension');
  check(
    now.ticked
      .map((t) => t.id)
      .sort()
      .join() === 'diabetes,htn',
    'now: hypertension + diabetes'
  );
}
{
  const problems = [{ label: 'Hypertension' }]; // undated
  const then = Efi.computeEFI({ problems, medications: [], asOf: '2024-08-27' });
  const now = Efi.computeEFI({ problems, medications: [], asOf: NOW });
  check(
    then.ticked.some((t) => t.id === 'htn') && now.ticked.some((t) => t.id === 'htn'),
    'undated problem counts in both snapshots'
  );
}

console.log('\n--- progressFrailty fire rules ---');
{
  // Fit (4 deficits) → Mild (5) is the preventative crossing. 4/36=0.111 Fit; 5/36=0.139 Mild.
  const base = [
    { label: 'Hypertension', codedDate: '2015-01-01' },
    { label: 'Type 2 diabetes mellitus', codedDate: '2016-01-01' },
    { label: 'Osteoarthritis', codedDate: '2017-01-01' },
    { label: 'Hypothyroidism', codedDate: '2018-01-01' },
  ];
  const stable = Efi.progressFrailty({ problems: base, medications: [], now: NOW, withinMonths: 24 });
  check(!stable.fires, '4 long-standing deficits: Fit and stable — does not fire');
  check(stable.now.category === 'Fit', '4/36 is Fit');

  const slipped = Efi.progressFrailty({
    problems: [...base, { label: 'Falls', codedDate: '2026-03-01' }],
    medications: [],
    now: NOW,
    withinMonths: 24,
  });
  check(slipped.fires, 'Fit → Mild via a new fall fires (preventative window)');
  check(slipped.categoryWorsened, 'categoryWorsened on Fit → Mild');
  check(/Fit → Mild/.test(slipped.valueText), `valueText names the crossing (got ${slipped.valueText})`);
}
{
  // +2 new deficits inside Mild, no category change. 6/36=0.167, 8/36=0.222 — both Mild.
  const then = [
    { label: 'Hypertension', codedDate: '2015-01-01' },
    { label: 'Type 2 diabetes mellitus', codedDate: '2016-01-01' },
    { label: 'Osteoarthritis', codedDate: '2017-01-01' },
    { label: 'Hypothyroidism', codedDate: '2018-01-01' },
    { label: 'Atrial fibrillation', codedDate: '2019-01-01' },
    { label: 'COPD', codedDate: '2020-01-01' },
  ];
  const now = [...then, { label: 'Falls', codedDate: '2026-01-15' }, { label: 'Weight loss', codedDate: '2026-04-01' }];
  const prog = Efi.progressFrailty({ problems: now, medications: [], now: NOW, withinMonths: 24 });
  check(prog.fires, '+2 new deficits inside Mild fires (creeping frailty)');
  check(!prog.categoryWorsened, 'category stays Mild');
  check(prog.newDeficits.length === 2, 'two new deficits listed');
}
{
  const prog = Efi.progressFrailty({
    problems: [
      { label: 'Mild frailty', codedDate: '2023-01-01' },
      { label: 'Moderate frailty', codedDate: '2026-02-01' },
    ],
    medications: [],
    now: NOW,
    withinMonths: 24,
  });
  check(prog.codedWorsened, 'coded mild → moderate fires');
  check(prog.fires, 'coded-category worsening is a fire');
}
{
  // Isolated new fall from a truly fit record: 1 deficit, still Fit, must NOT fire.
  const prog = Efi.progressFrailty({
    problems: [{ label: 'Falls', codedDate: '2026-05-01' }],
    medications: [],
    now: NOW,
    withinMonths: 24,
  });
  check(!prog.fires, 'a single new deficit that stays Fit does not fire');
}

console.log('\n--- polypharmacy cannot invent a slip ---');
{
  const meds = ['a', 'b', 'c', 'd', 'e'];
  const prog = Efi.progressFrailty({
    problems: [{ label: 'Hypertension', codedDate: '2015-01-01' }],
    medications: meds,
    now: NOW,
    withinMonths: 24,
  });
  check(
    prog.then.ticked.some((t) => t.id === 'polypharm') && prog.now.ticked.some((t) => t.id === 'polypharm'),
    'current polypharmacy is counted in both snapshots'
  );
  check(!prog.fires, 'polypharmacy alone does not fire');
}

console.log('\n--- observation weight decline ticks weight now ---');
{
  const history = [
    {
      name: 'Body weight',
      unit: 'kg',
      history: [
        { date: '2026-08-01', value: 62 },
        { date: '2025-02-01', value: 72 },
      ],
    },
  ];
  const prog = Efi.progressFrailty({
    problems: [
      { label: 'Hypertension', codedDate: '2015-01-01' },
      { label: 'Type 2 diabetes mellitus', codedDate: '2016-01-01' },
      { label: 'Osteoarthritis', codedDate: '2017-01-01' },
      { label: 'Hypothyroidism', codedDate: '2018-01-01' },
    ],
    medications: [],
    observationHistory: history,
    now: NOW,
    withinMonths: 24,
  });
  check(
    prog.now.ticked.some((t) => t.id === 'weight'),
    'falling weight ticks the weight deficit now'
  );
  check(prog.fires, 'Fit → Mild via uncoded weight loss fires');
  check(prog.now.weightDecline && prog.now.weightDecline.pct < -5, 'weight decline recorded on the snapshot');
}
{
  const history = [
    {
      name: 'Birth weight',
      unit: 'kg',
      history: [
        { date: '2026-08-01', value: 2 },
        { date: '2025-02-01', value: 4 },
      ],
    },
  ];
  const decline = Efi.weightDecline(history, 24, NOW);
  check(decline == null, 'birth weight is not treated as body-weight loss');
}

console.log('\n--- shipped rule + engine chip ---');
{
  const rule = qofRule();
  check(!!rule, 'trend-frailty-slipping ships in qof-rules.json');
  check(rule.category === 'safety-monitoring', 'tagged safety-monitoring');
  check(rule.check.kind === 'efi-progression', 'kind is efi-progression');
  check(rule.ageRange && rule.ageRange.min === 65, 'age gate 65+');
  check(rule.enabled === true, 'enabled');
}
{
  const chips = evalChip({
    problems: [
      { label: 'Hypertension', codedDate: '2015-01-01' },
      { label: 'Type 2 diabetes mellitus', codedDate: '2016-01-01' },
      { label: 'Osteoarthritis', codedDate: '2017-01-01' },
      { label: 'Hypothyroidism', codedDate: '2018-01-01' },
      { label: 'Falls', codedDate: '2026-03-01' },
    ],
    pastProblems: [],
    medications: [],
    observationHistory: [],
    patientContext: { ageYears: 78 },
  });
  check(chips.length === 1, 'emits one chip');
  check(chips[0].status === 'not_met', 'Fit → Mild is not_met');
  check(chips[0].category === 'safety-monitoring', 'chip carries safety-monitoring');
  check(chips[0].indicatorCode === 'TREND-FRAILTY', 'indicator code TREND-FRAILTY');
  check(
    chips[0].evidence && chips[0].evidence.facts.some((f) => f.label === 'New deficit'),
    'evidence lists new deficit'
  );
}
{
  const chips = evalChip({
    problems: [{ label: 'Hypertension', codedDate: '2015-01-01' }],
    pastProblems: [],
    medications: [],
    observationHistory: [],
    patientContext: { ageYears: 70 },
  });
  check(
    chips[0] && chips[0].status === 'achieved',
    'stable long-standing HTN is achieved (live indicator, not hidden)'
  );
  check(/stable|Fit/.test(chips[0].valueText), `stable chip still shows current state (got ${chips[0].valueText})`);
}
{
  const chips = evalChip({
    problems: [
      { label: 'Hypertension', codedDate: '2015-01-01' },
      { label: 'Falls', codedDate: '2026-03-01' },
    ],
    pastProblems: [],
    medications: [],
    observationHistory: [],
    patientContext: { ageYears: 50 },
  });
  check(chips.length === 0, 'known age <65 suppresses the chip (ageRange)');
}
{
  const chips = evalChip({
    problems: [
      { label: 'Hypertension', codedDate: '2015-01-01' },
      { label: 'Type 2 diabetes mellitus', codedDate: '2016-01-01' },
      { label: 'Osteoarthritis', codedDate: '2017-01-01' },
      { label: 'Hypothyroidism', codedDate: '2018-01-01' },
      { label: 'Falls', codedDate: '2026-03-01' },
    ],
    pastProblems: [],
    medications: [],
    observationHistory: [],
    patientContext: {}, // unknown age — fail open
  });
  check(chips.length === 1 && chips[0].status === 'not_met', 'unknown age fail-opens and still evaluates');
}
{
  // Past/ended problem still counts (lifetime eFI).
  const chips = evalChip({
    problems: [
      { label: 'Hypertension', codedDate: '2015-01-01' },
      { label: 'Type 2 diabetes mellitus', codedDate: '2016-01-01' },
      { label: 'Osteoarthritis', codedDate: '2017-01-01' },
    ],
    pastProblems: [
      { label: 'Hypothyroidism', codedDate: '2018-01-01' },
      { label: 'Falls', codedDate: '2026-03-01' },
    ],
    medications: [],
    observationHistory: [],
    patientContext: { ageYears: 80 },
  });
  check(chips[0] && chips[0].status === 'not_met', 'ended/past problems still count toward eFI slip');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
