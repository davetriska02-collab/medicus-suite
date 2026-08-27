// Medicus Suite — Frailty safety-monitoring rules + journal-history merge tests
// Run with: node test-frailty-safety-rules.js
//
// Covers the "live frailty indicator" feature:
//   1. mergeJournalIntoHistory — journal-coded scores (eFI/eFI2/Rockwood CFS)
//      folded into observationHistory so observation-trend can see them
//   2. observation-trend observationExclude — eFI and eFI2 series NEVER share a
//      rule (their category boundaries differ: severe is >0.36 on eFI but
//      >=0.24 on eFI2)
//   3. The five shipped frailty rules: three rising-trend monitors
//      (trend-frailty-efi-rising / -efi2- / -cfs-) and two "score in frailty
//      range but no frailty problem coded" alerts (alert-frailty-efi-uncoded /
//      -efi2-), including the excludeIfProblem suppression once frailty is coded.

'use strict';
const engine = require('./engine/rules-engine.js');
const normalisers = require('./engine/normalisers.js');
const qof = require('./rules/qof-rules.json');

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

const NOW = '2026-08-27T12:00:00Z';
const rule = (id) => qof.rules.find((r) => r.id === id);
const FRAILTY_RULE_IDS = [
  'trend-frailty-efi-rising',
  'trend-frailty-efi2-rising',
  'trend-frailty-cfs-rising',
  'alert-frailty-efi-uncoded',
  'alert-frailty-efi2-uncoded',
];

function evalRule(id, data) {
  return engine.evaluateQofIndicatorRule(
    rule(id),
    {
      medications: [],
      observations: [],
      observationHistory: [],
      problems: [],
      patientContext: { ageYears: 78 },
      _registerLookup: {},
      ...data,
    },
    NOW
  );
}

// History entry helper — observationHistory value is NUMERIC per the contract.
function series(name, points) {
  return {
    name,
    code: null,
    group: null,
    unit: null,
    history: points
      .slice()
      .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0))
      .map((p) => ({
        date: p.date,
        value: p.value,
        rawValue: String(p.value),
        isAbove: false,
        isBelow: false,
        source: 't',
      })),
  };
}

// ── Shipped rule presence and shape ──────────────────────────────────────────
console.log('\n--- shipped frailty rules: presence and shape ---');
FRAILTY_RULE_IDS.forEach((id) => {
  const r = rule(id);
  check(!!r, `${id} exists in qof-rules.json`);
  if (!r) return;
  check(r.enabled === true, `${id} is enabled`);
  check(r.category === 'safety-monitoring', `${id} is category safety-monitoring`);
  check(r.ageRange && r.ageRange.min === 65, `${id} is gated to age >= 65 (GMS frailty identification cohort)`);
  check(r.useQofYearFloor === false, `${id} uses a rolling window, not the QOF year floor`);
  check(typeof r.notes === 'string' && r.notes.length > 50, `${id} carries clinical notes`);
  check(typeof r.source === 'string' && r.source.length > 0, `${id} carries a source reference`);
});
// The eFI and eFI2 rules must never share thresholds — assert the separation is real.
check(
  (rule('trend-frailty-efi-rising').check.observationExclude || []).some((e) => e.toLowerCase() === 'efi2'),
  'original-eFI trend rule excludes eFI2-named series'
);
check(
  (rule('alert-frailty-efi-uncoded').check.observationExclude || []).some((e) => e.toLowerCase() === 'efi2'),
  'original-eFI range alert excludes eFI2-named series'
);
check(
  rule('alert-frailty-efi-uncoded').check.red === 0.36 && rule('alert-frailty-efi2-uncoded').check.red === 0.24,
  'eFI (severe >0.36) and eFI2 (severe >=0.24) alerts carry their own distinct red thresholds'
);

// ── mergeJournalIntoHistory ──────────────────────────────────────────────────
console.log('\n--- mergeJournalIntoHistory ---');
{
  const base = [series('eGFR', [{ date: '2026-01-01', value: 60 }])];
  const journal = [
    { name: 'Electronic frailty index', value: '0.19', date: '2026-06-01', source: 'journal' },
    { name: 'Electronic frailty index', value: '0.11', date: '2024-05-01', source: 'journal' },
  ];
  const merged = normalisers.mergeJournalIntoHistory(base, journal);
  const efi = merged.find((e) => e.name === 'Electronic frailty index');
  check(merged.length === 2, 'journal-only name creates a new history entry');
  check(!!efi && efi.history.length === 2, 'new entry carries both journal points');
  check(efi.history[0].date === '2026-06-01' && efi.history[1].date === '2024-05-01', 'history is newest-first');
  check(efi.history[0].value === 0.19 && typeof efi.history[0].value === 'number', 'journal value parsed to a NUMBER');
  check(efi.history[0].rawValue === '0.19', 'rawValue preserves the original string');
  check(efi.unit === null, 'journal-derived entry has unit: null (unit guard fails open by design)');
  check(merged.find((e) => e.name === 'eGFR') === base[0], 'untouched base entry is the SAME object (not copied)');
}
{
  // Merge into an existing entry: same-date dashboard point wins; base not mutated.
  const base = [series('Clinical frailty scale', [{ date: '2026-01-10', value: 4 }])];
  const baseHistRef = base[0].history;
  const journal = [
    { name: 'clinical frailty scale', value: '5', date: '2026-07-01', source: 'journal' },
    { name: 'Clinical frailty scale', value: '9', date: '2026-01-10', source: 'journal' }, // duplicate date
  ];
  const merged = normalisers.mergeJournalIntoHistory(base, journal);
  const cfs = merged.find((e) => e.name === 'Clinical frailty scale');
  check(cfs.history.length === 2, 'journal point added to existing entry; duplicate-date point dropped');
  check(cfs.history[0].date === '2026-07-01' && cfs.history[0].value === 5, 'merged history re-sorted newest-first');
  check(
    cfs.history.find((p) => p.date === '2026-01-10').value === 4,
    'existing dashboard point wins on date collision'
  );
  check(base[0].history === baseHistRef && base[0].history.length === 1, 'caller base entry was NOT mutated');
  check(merged !== base, 'a new top-level array is returned');
}
{
  // Garbage tolerance: bad dates skipped, non-numeric values become NaN, null inputs safe.
  const merged = normalisers.mergeJournalIntoHistory(null, [
    { name: 'Rockwood', value: '4 - Vulnerable', date: '2026-05-05' },
    { name: 'Rockwood', value: 'declined', date: '2026-06-06' },
    { name: 'Rockwood', value: '5', date: '05 Jun 2026' }, // non-ISO — skipped
    { name: '', value: '1', date: '2026-06-07' }, // nameless — skipped
  ]);
  const rw = merged.find((e) => e.name === 'Rockwood');
  check(!!rw && rw.history.length === 2, 'non-ISO dates and nameless entries are skipped');
  check(rw.history.find((p) => p.date === '2026-05-05').value === 4, '"4 - Vulnerable" parses to 4');
  check(isNaN(rw.history.find((p) => p.date === '2026-06-06').value), 'non-numeric value parses to NaN (contract)');
}

// ── observation-trend: observationExclude separates eFI from eFI2 ────────────
console.log('\n--- observation-trend: eFI / eFI2 series separation ---');
{
  // ONLY an eFI2 series exists. The original-eFI rule must NOT read it, even
  // though "frailty index" is a substring of its name — the scales differ.
  const efi2Only = [
    series('Electronic frailty index 2 (eFI2)', [
      { date: '2025-01-01', value: 0.1 },
      { date: '2026-06-01', value: 0.2 },
    ]),
  ];
  const efiChips = evalRule('trend-frailty-efi-rising', { observationHistory: efi2Only });
  check(
    efiChips.length === 1 && efiChips[0].status === 'no_data',
    'original-eFI trend rule ignores an eFI2 series (no_data, not a fired trend)'
  );
  const efi2Chips = evalRule('trend-frailty-efi2-rising', { observationHistory: efi2Only });
  check(
    efi2Chips.length === 1 && efi2Chips[0].status === 'not_met',
    'eFI2 trend rule fires on the same series (+0.10 >= 0.04)'
  );
}

// ── trend-frailty-efi-rising behaviour ───────────────────────────────────────
console.log('\n--- trend-frailty-efi-rising ---');
{
  const rising = [
    series('Electronic frailty index', [
      { date: '2024-06-01', value: 0.11 },
      { date: '2026-06-01', value: 0.19 },
    ]),
  ];
  const chips = evalRule('trend-frailty-efi-rising', { observationHistory: rising });
  check(chips.length === 1 && chips[0].status === 'not_met', 'fires on +0.08 rise over 24 months (>= 0.06 minDelta)');
  check(chips[0].category === 'safety-monitoring', 'chip carries safety-monitoring category');

  const small = [
    series('Electronic frailty index', [
      { date: '2024-06-01', value: 0.11 },
      { date: '2026-06-01', value: 0.14 },
    ]),
  ];
  check(
    evalRule('trend-frailty-efi-rising', { observationHistory: small })[0].status === 'achieved',
    'does NOT fire on +0.03 (below minDelta)'
  );

  const falling = [
    series('Electronic frailty index', [
      { date: '2024-06-01', value: 0.25 },
      { date: '2026-06-01', value: 0.14 },
    ]),
  ];
  check(
    evalRule('trend-frailty-efi-rising', { observationHistory: falling })[0].status === 'achieved',
    'does NOT fire on an improving (falling) eFI'
  );

  const single = [series('Electronic frailty index', [{ date: '2026-06-01', value: 0.3 }])];
  check(
    evalRule('trend-frailty-efi-rising', { observationHistory: single })[0].status === 'no_data',
    'single reading -> no_data (needs minPoints 2)'
  );

  const stale = [
    series('Electronic frailty index', [
      { date: '2021-01-01', value: 0.11 },
      { date: '2022-06-01', value: 0.19 },
    ]),
  ];
  check(
    evalRule('trend-frailty-efi-rising', { observationHistory: stale })[0].status === 'no_data',
    'readings older than the 36-month window -> no_data'
  );

  check(
    evalRule('trend-frailty-efi-rising', { observationHistory: rising, patientContext: { ageYears: 50 } }).length === 0,
    'suppressed for a patient positively under 65'
  );
  check(
    evalRule('trend-frailty-efi-rising', { observationHistory: rising, patientContext: { ageYears: null } }).length ===
      1,
    'fail-open: fires when age is unknown'
  );
}

// ── trend-frailty-cfs-rising behaviour ───────────────────────────────────────
console.log('\n--- trend-frailty-cfs-rising ---');
{
  const worsening = [
    series('Rockwood Clinical Frailty Scale', [
      { date: '2025-01-01', value: 4 },
      { date: '2026-06-01', value: 5 },
    ]),
  ];
  check(
    evalRule('trend-frailty-cfs-rising', { observationHistory: worsening })[0].status === 'not_met',
    'fires on CFS 4 -> 5 (crossing into living-with-frailty)'
  );
  const flat = [
    series('Clinical frailty scale', [
      { date: '2025-01-01', value: 5 },
      { date: '2026-06-01', value: 5 },
    ]),
  ];
  check(
    evalRule('trend-frailty-cfs-rising', { observationHistory: flat })[0].status === 'achieved',
    'does NOT fire on a flat CFS'
  );
}

// ── End-to-end: journal merge feeds the trend rule ───────────────────────────
console.log('\n--- end-to-end: journal observations -> merged history -> trend chip ---');
{
  // Simulates the content-script pipeline: dashboard history has no frailty
  // series; the journal fetch returns two eFI codings; after the merge the
  // trend rule fires. This is the exact gap the feature closes.
  const dashboardHistory = [series('Sodium', [{ date: '2026-05-01', value: 140 }])];
  const journalObs = [
    { name: 'Electronic frailty index', value: '0.13', date: '2024-09-01', source: 'journal' },
    { name: 'Electronic frailty index', value: '0.22', date: '2026-06-15', source: 'journal' },
  ];
  const beforeMerge = evalRule('trend-frailty-efi-rising', { observationHistory: dashboardHistory });
  check(beforeMerge[0].status === 'no_data', 'WITHOUT the merge, journal-coded eFI is invisible (no_data)');
  const merged = normalisers.mergeJournalIntoHistory(dashboardHistory, journalObs);
  const afterMerge = evalRule('trend-frailty-efi-rising', { observationHistory: merged });
  check(afterMerge[0].status === 'not_met', 'WITH the merge, the rising eFI trend fires (+0.09 >= 0.06)');
}

// ── alert-frailty-efi-uncoded behaviour ──────────────────────────────────────
console.log('\n--- alert-frailty-efi-uncoded (frailty-range score, no frailty code) ---');
{
  const obs = (value, date, name) => [{ name: name || 'Electronic frailty index', value, date }];
  const amber = evalRule('alert-frailty-efi-uncoded', { observations: obs('0.30', '2026-05-01') });
  check(amber.length === 1 && amber[0].status === 'caution', 'eFI 0.30 (moderate range), nothing coded -> AMBER chip');
  const red = evalRule('alert-frailty-efi-uncoded', { observations: obs('0.42', '2026-05-01') });
  check(red.length === 1 && red[0].status === 'alert', 'eFI 0.42 (severe range), nothing coded -> RED chip');
  check(
    evalRule('alert-frailty-efi-uncoded', { observations: obs('0.19', '2026-05-01') }).length === 0,
    'eFI 0.19 (mild range) -> no chip (quiet when out of the alert bands)'
  );
  check(
    evalRule('alert-frailty-efi-uncoded', {
      observations: obs('0.30', '2026-05-01'),
      problems: [{ label: 'Moderate frailty' }],
    }).length === 0,
    'suppressed once ANY frailty problem is coded (the prompt has done its job)'
  );
  check(
    evalRule('alert-frailty-efi-uncoded', {
      observations: obs('0.30', '2026-05-01'),
      problems: [{ label: 'No frailty' }],
    }).length === 1,
    'negation-aware: a "No frailty" problem does NOT suppress the prompt'
  );
  check(
    evalRule('alert-frailty-efi-uncoded', { observations: obs('0.30', '2023-05-01') }).length === 0,
    'score older than 2 years -> no chip (stale)'
  );
  check(
    evalRule('alert-frailty-efi-uncoded', {
      observations: obs('0.30', '2026-05-01', 'Electronic frailty index 2 (eFI2)'),
    }).length === 0,
    'an eFI2-named score does NOT trigger the original-eFI alert (different scale)'
  );
}

// ── alert-frailty-efi2-uncoded behaviour ─────────────────────────────────────
console.log('\n--- alert-frailty-efi2-uncoded ---');
{
  const obs = (value) => [{ name: 'Electronic frailty index 2 (eFI2)', value, date: '2026-05-01' }];
  const amber = evalRule('alert-frailty-efi2-uncoded', { observations: obs('0.18') });
  check(amber.length === 1 && amber[0].status === 'caution', 'eFI2 0.18 (moderate band) -> AMBER chip');
  const red = evalRule('alert-frailty-efi2-uncoded', { observations: obs('0.24') });
  check(red.length === 1 && red[0].status === 'alert', 'eFI2 0.24 (severe band, inclusive bound) -> RED chip');
  check(
    evalRule('alert-frailty-efi2-uncoded', { observations: obs('0.12') }).length === 0,
    'eFI2 0.12 (mild band) -> no chip'
  );
  check(
    evalRule('alert-frailty-efi2-uncoded', {
      observations: obs('0.18'),
      problems: [{ label: 'Severe frailty' }],
    }).length === 0,
    'suppressed once frailty is coded'
  );
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
