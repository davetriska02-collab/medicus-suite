// Medicus Suite — Signing queue core logic tests
// Run with: node test-signing-core.js
// Dynamic-imports signing-core.js (ES module).

'use strict';

const path = require('path');

(async () => {
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

  const corePath = new URL('side-panel/modules/signing/signing-core.js', `file://${path.resolve(__dirname)}/`).href;
  const {
    monitoringVerdict,
    requestedDrugFlags,
    sortSigningRows,
    requestAgeDays,
    renalContext,
    formatObsAge,
    locationBuckets,
    rowMatchesLocationFilter,
    filterHiddenSummary,
    NO_LOCATION_KEY,
    isDispensaryLocation,
    ROW_STATE,
    RED_CHIP_STATUSES,
    AMBER_CHIP_STATUSES,
  } = await import(corePath);

  // ── monitoringVerdict ────────────────────────────────────────────────────────
  console.log('--- monitoringVerdict ---');
  const chip = (over) => ({ type: 'drug-monitoring', drugName: 'Lithium', status: 'overdue', tests: [], ...over });

  let v = monitoringVerdict([chip({})]);
  check(v.level === 'red' && v.items.length === 1, 'overdue chip → red');
  v = monitoringVerdict([chip({ status: 'stale' })]);
  check(v.level === 'red', 'stale chip → red');
  v = monitoringVerdict([chip({ status: 'no_data' })]);
  check(v.level === 'red', 'no_data chip → red');
  v = monitoringVerdict([chip({ status: 'due_soon' })]);
  check(v.level === 'amber', 'due_soon only → amber');
  v = monitoringVerdict([chip({ status: 'due_soon' }), chip({ status: 'overdue', drugName: 'MTX' })]);
  check(v.level === 'red' && v.items.length === 2, 'mixed → red, both items kept');
  v = monitoringVerdict([chip({ status: 'in_date' }), chip({ status: 'recently_initiated', drugName: 'X' })]);
  check(v.level === null && v.items.length === 0, 'in-date/recent chips → no flags');
  v = monitoringVerdict([{ type: 'qof-indicator', status: 'overdue', indicatorCode: 'DM037' }]);
  check(v.level === null, 'QOF chips ignored — signing context is drug-monitoring only');
  v = monitoringVerdict(null);
  check(v.level === null && v.items.length === 0, 'null chips → clean empty verdict');

  // detail: flagged tests capped at 3
  v = monitoringVerdict([
    chip({
      tests: [
        { name: 'FBC', status: 'overdue' },
        { name: 'U&E', status: 'overdue' },
        { name: 'LFT', status: 'overdue' },
        { name: 'TFT', status: 'overdue' },
        { name: 'HbA1c', status: 'in_date' },
      ],
    }),
  ]);
  check(v.items[0].detail === 'FBC, U&E, LFT +1', 'test detail capped at 3 with +N, in-date tests excluded');

  // status band constants stay disjoint (a status must never be red AND amber)
  check(
    RED_CHIP_STATUSES.every((s) => !AMBER_CHIP_STATUSES.includes(s)),
    'red and amber status sets are disjoint'
  );

  // ── requestedDrugFlags ───────────────────────────────────────────────────────
  console.log('\n--- requestedDrugFlags ---');
  const items = [
    { name: 'Lithium', matchedTerm: 'lithium carbonate', status: 'overdue' },
    { name: 'Methotrexate', matchedTerm: 'methotrexate', status: 'due_soon' },
  ];
  let hits = requestedDrugFlags('Priadel (lithium carbonate) 400mg MR tablets x2', items);
  check(hits.length === 1 && hits[0].name === 'Lithium', 'matchedTerm substring hit, case-insensitive');
  hits = requestedDrugFlags('METHOTREXATE 2.5mg tablets', items);
  check(hits.length === 1 && hits[0].name === 'Methotrexate', 'drug-name hit, case-insensitive');
  check(requestedDrugFlags('Atorvastatin 20mg', items).length === 0, 'unrelated request → no hits');
  check(requestedDrugFlags('', items).length === 0, 'empty summary → no hits');
  check(requestedDrugFlags('lithium', null).length === 0, 'null items → no hits');

  // ── sortSigningRows ──────────────────────────────────────────────────────────
  console.log('\n--- sortSigningRows ---');
  const row = (over) => ({
    state: ROW_STATE.DONE,
    verdict: { level: null, items: [] },
    requestedHits: [],
    createdAt: '2026-07-01T08:00:00Z',
    ...over,
  });
  const clear = row({ taskId: 'clear' });
  const err = row({ taskId: 'err', state: ROW_STATE.ERROR, verdict: null });
  const pending = row({ taskId: 'pending', state: ROW_STATE.PENDING, verdict: null });
  const amber = row({ taskId: 'amber', verdict: { level: 'amber', items: [{}] } });
  const red = row({ taskId: 'red', verdict: { level: 'red', items: [{}] } });
  const redReq = row({ taskId: 'redReq', verdict: { level: 'red', items: [{}] }, requestedHits: [{}] });

  const order = sortSigningRows([clear, err, amber, red, pending, redReq]).map((r) => r.taskId);
  check(order[0] === 'redReq', 'requested-drug red first');
  check(order[1] === 'red', 'plain red second');
  check(order[2] === 'amber', 'amber third');
  check(order.indexOf('clear') === 5, 'no-flags row last (unknown outranks a recorded all-clear)');
  check(order.indexOf('err') < order.indexOf('clear'), 'error row above no-flags');
  check(order.indexOf('pending') < order.indexOf('clear'), 'unchecked row above no-flags');

  // ties: oldest first
  const a = row({ taskId: 'a', verdict: { level: 'red', items: [{}] }, createdAt: '2026-07-01T08:00:00Z' });
  const b = row({ taskId: 'b', verdict: { level: 'red', items: [{}] }, createdAt: '2026-06-28T08:00:00Z' });
  check(sortSigningRows([a, b])[0].taskId === 'b', 'same band → oldest request first');
  check(Array.isArray(sortSigningRows(null)), 'null input tolerated');

  // ── requestAgeDays ───────────────────────────────────────────────────────────
  console.log('\n--- requestAgeDays ---');
  const now = new Date('2026-07-07T12:00:00Z').getTime();
  check(requestAgeDays('2026-07-04T09:00:00Z', now) === 3, '3 days old');
  check(requestAgeDays('2026-07-07T09:00:00Z', now) === 0, 'today → 0');
  check(requestAgeDays('garbage', now) === null, 'garbage → null');
  check(requestAgeDays('', now) === null, 'empty → null');
  check(requestAgeDays('2026-07-09T09:00:00Z', now) === null, 'future createdAt → null, never negative');

  // ── renalContext / formatObsAge ──────────────────────────────────────────────
  console.log('\n--- renal context ---');
  const NOW = new Date('2026-07-07T12:00:00Z').getTime();
  const obs = (name, date, value) => ({ name, date, value });
  let rc = renalContext(
    [
      obs('eGFR', '2025-08-01', '38 mL/min/1.73m2'),
      obs('eGFR', '2024-01-01', '52 mL/min/1.73m2'),
      obs('HbA1c', '2026-06-01', '48'),
    ],
    NOW
  );
  check(rc.value.startsWith('38'), 'latest eGFR wins, HbA1c ignored');
  check(rc.ageDays > 300 && rc.ageDays < 400, 'ageDays computed from latest date');
  rc = renalContext([obs('Glomerular filtration rate', '2026-06-30', '61')], NOW);
  check(rc && rc.value === '61', 'glomerular filtration name variant matches');
  check(renalContext([obs('HbA1c', '2026-06-01', '48')], NOW) === null, 'no renal obs → null');
  check(renalContext(null, NOW) === null, 'null observations → null');
  rc = renalContext([obs('eGFR', 'garbage-date', '40')], NOW);
  check(rc && rc.ageDays === null, 'unparseable date → ageDays null (renderer shows raw date)');

  check(formatObsAge(0) === 'today', 'formatObsAge today');
  check(formatObsAge(12) === '12d ago', 'formatObsAge days');
  check(formatObsAge(200) === '7mo ago', 'formatObsAge months');
  check(formatObsAge(900) === '2y ago', 'formatObsAge years');
  check(formatObsAge(null) === '', 'formatObsAge null → empty (renderer must fall back to raw date)');

  // ── location buckets / filter (Practice-panel ruling) ───────────────────────
  console.log('\n--- location buckets ---');
  const lrow = (loc, level) => ({
    collectionLocation: loc,
    verdict: level ? { level, items: [{}] } : { level: null, items: [] },
  });
  const pile = [
    lrow('Dispensary', 'red'),
    lrow('Dispensary', null),
    lrow('Dispensary', null),
    lrow('Boots Pharmacy, Godalming', 'red'),
    lrow('', 'amber'),
    lrow('', null),
  ];
  let buckets = locationBuckets(pile);
  check(buckets.length === 3, 'three buckets: two named + No location');
  check(buckets[0].label === 'Dispensary' && buckets[0].count === 3, 'highest count first');
  check(
    buckets[2].key === NO_LOCATION_KEY && buckets[2].label === 'No location' && buckets[2].count === 2,
    'No location is an explicit, countable bucket (blank never silently means not-ours)'
  );
  check(
    locationBuckets([lrow('', null), lrow('', 'red')]).length === 0,
    'practice that never records locations → no pills at all (feature invisible)'
  );
  check(locationBuckets(null).length === 0, 'null rows tolerated');

  // filter matching
  const dispOnly = new Set(['Dispensary']);
  check(rowMatchesLocationFilter(pile[0], dispOnly) === true, 'Dispensary row passes Dispensary filter');
  check(rowMatchesLocationFilter(pile[3], dispOnly) === false, 'pharmacy row excluded by Dispensary filter');
  check(rowMatchesLocationFilter(pile[4], new Set([NO_LOCATION_KEY])) === true, 'blank row passes No-location filter');
  check(rowMatchesLocationFilter(pile[3], new Set()) === true, 'empty filter shows everything');

  // hidden summary — the safety note: hidden reds are always counted
  let hs = filterHiddenSummary(pile, dispOnly);
  check(hs.hidden === 3, 'filter hides the 3 non-Dispensary rows');
  check(hs.hiddenRed === 1, 'hidden RED rows counted (Boots red must never vanish silently)');
  check(filterHiddenSummary(pile, new Set()) === null, 'no active filter → no note');

  // in-house vs chemist glance category (heuristic; verbatim text always shown)
  check(isDispensaryLocation('Dispensary') === true, 'Dispensary → in-house');
  check(isDispensaryLocation('Witley Dispensing Hub') === true, 'dispens* variants → in-house');
  check(isDispensaryLocation('Boots Pharmacy, Godalming') === false, 'community pharmacy → chemist');
  check(isDispensaryLocation('') === false, 'blank → not in-house');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
