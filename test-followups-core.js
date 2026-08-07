// Medicus Suite — Follow-ups core logic tests
// Run with: node test-followups-core.js
// Dynamic-imports followups-core.js (ES module).

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

  const corePath = new URL('side-panel/modules/followups/followups-core.js', `file://${path.resolve(__dirname)}/`).href;
  const {
    classifyFollowup,
    sortFollowups,
    followupCounts,
    validateFollowup,
    pruneFollowups,
    formatDueLabel,
    daysUntilDue,
    dateOnlyISO,
    FOLLOWUP_STATUS,
    FOLLOWUP_CAP,
    DONE_RETENTION_DAYS,
  } = await import(corePath);

  // Noon local avoids any midnight-boundary flake in date-only arithmetic.
  const NOW = new Date('2026-07-07T12:00:00').getTime();
  const e = (over) => ({
    id: 'x',
    what: 'chase MSU',
    due: '2026-07-10',
    createdAt: '2026-07-01T09:00:00Z',
    status: FOLLOWUP_STATUS.OPEN,
    doneAt: null,
    patientUuid: null,
    patientName: '',
    source: 'manual',
    ...over,
  });

  // ── daysUntilDue / classify ─────────────────────────────────────────────────
  console.log('--- classifyFollowup ---');
  check(dateOnlyISO(NOW) === '2026-07-07', 'dateOnlyISO uses local calendar date');
  check(daysUntilDue('2026-07-10', NOW) === 3, 'daysUntilDue counts whole days');
  check(daysUntilDue('garbage', NOW) === null, 'garbage due → null');
  check(classifyFollowup(e({ due: '2026-07-04' }), NOW) === 'lapsed', 'past due → lapsed');
  check(classifyFollowup(e({ due: '2026-07-07' }), NOW) === 'due_today', 'today → due_today');
  check(classifyFollowup(e({ due: '2026-07-10' }), NOW) === 'due_soon', 'within 3 days → due_soon');
  check(classifyFollowup(e({ due: '2026-07-20' }), NOW) === 'waiting', 'far future → waiting');
  check(
    classifyFollowup(e({ status: FOLLOWUP_STATUS.DONE, doneAt: '2026-07-06T10:00:00Z' }), NOW) === 'done',
    'done status wins regardless of due'
  );
  check(classifyFollowup(e({ due: 'garbage' }), NOW) === 'waiting', 'unparseable due → waiting, never hidden');

  // ── sortFollowups ───────────────────────────────────────────────────────────
  console.log('\n--- sortFollowups ---');
  const lapsedOld = e({ id: 'lapsedOld', due: '2026-06-20' });
  const lapsedNew = e({ id: 'lapsedNew', due: '2026-07-05' });
  const today = e({ id: 'today', due: '2026-07-07' });
  const soon = e({ id: 'soon', due: '2026-07-09' });
  const waiting = e({ id: 'waiting', due: '2026-08-01' });
  const done = e({ id: 'done', status: FOLLOWUP_STATUS.DONE, doneAt: '2026-07-06T10:00:00Z' });
  const order = sortFollowups([waiting, done, soon, lapsedNew, today, lapsedOld], NOW).map((x) => x.id);
  check(order[0] === 'lapsedOld' && order[1] === 'lapsedNew', 'lapsed first, oldest due first');
  check(order[2] === 'today' && order[3] === 'soon' && order[4] === 'waiting', 'then due today, soon, waiting');
  check(order[5] === 'done', 'done last');
  check(Array.isArray(sortFollowups(null, NOW)), 'null input tolerated');

  // ── followupCounts ──────────────────────────────────────────────────────────
  console.log('\n--- followupCounts ---');
  const counts = followupCounts([lapsedOld, lapsedNew, today, soon, waiting, done], NOW);
  check(counts.open === 5, 'open excludes done');
  check(counts.lapsed === 2 && counts.dueToday === 1 && counts.dueSoon === 1, 'bands counted');
  check(followupCounts(null, NOW).open === 0, 'null input → zero counts');

  // ── validateFollowup ────────────────────────────────────────────────────────
  console.log('\n--- validateFollowup ---');
  check(validateFollowup({ what: 'chase MSU', due: '2026-07-10' }) === null, 'valid entry passes');
  check(validateFollowup({ what: '   ', due: '2026-07-10' }) !== null, 'blank what rejected');
  check(validateFollowup({ what: 'x'.repeat(201), due: '2026-07-10' }) !== null, 'over-long what rejected');
  check(validateFollowup({ what: 'chase', due: 'not-a-date' }) !== null, 'garbage due rejected');
  check(validateFollowup({ what: 'chase', due: '2026-07-04' }) === null, 'past due allowed (lapses immediately)');
  check(validateFollowup({}) !== null, 'empty object rejected');

  // ── pruneFollowups ──────────────────────────────────────────────────────────
  console.log('\n--- pruneFollowups ---');
  const staleDone = e({
    id: 'staleDone',
    status: FOLLOWUP_STATUS.DONE,
    doneAt: new Date(NOW - (DONE_RETENTION_DAYS + 1) * 86400000).toISOString(),
  });
  const freshDone = e({ id: 'freshDone', status: FOLLOWUP_STATUS.DONE, doneAt: '2026-07-06T10:00:00Z' });
  let pruned = pruneFollowups([staleDone, freshDone, waiting], NOW);
  check(
    pruned.length === 2 && !pruned.some((x) => x.id === 'staleDone'),
    'done entries past retention dropped, fresh done + open kept'
  );
  check(
    pruneFollowups([e({ status: FOLLOWUP_STATUS.DONE, doneAt: 'garbage' })], NOW).length === 0,
    'done entry with unparseable doneAt dropped (cannot age it)'
  );
  // cap: open entries are never dropped
  const many = [];
  for (let i = 0; i < FOLLOWUP_CAP + 20; i++) many.push(e({ id: `open${i}` }));
  check(pruneFollowups(many, NOW).length === FOLLOWUP_CAP + 20, 'cap never drops OPEN entries');
  const mixed = [];
  for (let i = 0; i < FOLLOWUP_CAP; i++) mixed.push(e({ id: `o${i}` }));
  for (let i = 0; i < 30; i++)
    mixed.push(
      e({
        id: `d${i}`,
        status: FOLLOWUP_STATUS.DONE,
        doneAt: new Date(NOW - i * 3600000).toISOString(),
      })
    );
  pruned = pruneFollowups(mixed, NOW);
  check(pruned.length === FOLLOWUP_CAP, 'cap enforced by dropping oldest DONE entries');
  check(
    pruned.filter((x) => x.status === FOLLOWUP_STATUS.OPEN).length === FOLLOWUP_CAP,
    'all open entries survive the cap'
  );

  // ── formatDueLabel ──────────────────────────────────────────────────────────
  console.log('\n--- formatDueLabel ---');
  check(formatDueLabel('2026-07-04', NOW) === '3d overdue', 'overdue label');
  check(formatDueLabel('2026-07-07', NOW) === 'due today', 'today label');
  check(formatDueLabel('2026-07-08', NOW) === 'due tomorrow', 'tomorrow label');
  check(formatDueLabel('2026-07-12', NOW) === 'due in 5d', 'future label');
  check(formatDueLabel('garbage', NOW) === 'due garbage', 'unparseable → raw string shown, never invented');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
