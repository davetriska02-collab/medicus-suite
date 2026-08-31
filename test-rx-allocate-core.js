// Medicus Suite — rx-allocate-core tests
// Run with: node test-rx-allocate-core.js
'use strict';

const C = require('./shared/rx-allocate-core.js');
const Lab = require('./shared/lab-allocate-core.js');
const Wf = require('./shared/workflow-allocate-core.js');
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

function uuid(n) {
  const hex = String(n).padStart(12, '0');
  return 'aaaaaaaa-bbbb-cccc-dddd-' + hex;
}

function rxRow(n, extra) {
  return C.decorateRxRow(
    Lab.normaliseTaskRow(
      Object.assign(
        {
          id: uuid(n),
          patientName: 'PATIENT ' + n,
          assignedTo: 'Unassigned',
          summary: 'Acute request',
        },
        extra || {}
      ),
      'prescription_request_task_non_routine'
    )
  );
}

console.log('--- parseRxQueueRoute ---');
{
  const hit = C.parseRxQueueRoute('/e38a9f/tasks/prescription_request_task_non_routine/task-list');
  check(!!hit && hit.siteId === 'e38a9f', 'non-routine queue siteId');
  check(hit && hit.slug === 'prescription_request_task_non_routine', 'non-routine slug');
  check(hit && hit.kind === 'rx', 'kind is rx');
  check(
    !!C.parseRxQueueRoute('/e38a9f/tasks/data/prescription_request_task_non_routine/task-list'),
    'also matches /tasks/data/{slug}/task-list'
  );
  check(
    !!C.parseRxQueueRoute('/e38a9f/tasks/prescription-request-task-non-routine/task-list'),
    'hyphenated non-routine slug is claimed'
  );
  check(
    C.parseRxQueueRoute('/e38a9f/tasks/prescription_request_task_routine/task-list') === null,
    'routine prescription queue is not claimed'
  );
  check(
    C.parseRxQueueRoute('/e38a9f/tasks/review_investigation_results_task/task-list') === null,
    'results queue stays on the lab canvas'
  );
  check(
    C.parseRxQueueRoute('/e38a9f/tasks/review_inbound_document_task/task-list') === null,
    'document queue stays on the workflow canvas'
  );
  check(
    C.parseRxQueueRoute('/e38a9f/tasks/eps-prescription-order-item/task-list') === null,
    'EPS queue is excluded'
  );
  check(C.isNonRoutineRxQueueSlug('prescription_request_task_non_routine') === true, 'non-routine slug matches');
  check(C.isNonRoutineRxQueueSlug('prescription_request_task_routine') === false, 'routine slug does not match');
  check(
    Wf.parseWorkflowQueueRoute('/e38a9f/tasks/prescription_request_task_non_routine/task-list') === null,
    'workflow canvas still excludes prescription slugs'
  );
}

console.log('\n--- named GP groups the pile, never auto-places ---');
{
  const row = rxRow(1, { namedGp: 'Dr David Triska' });
  check(row.kind === 'rx', 'decorate stamps rx kind');
  check(!row.requester, 'named GP is not written onto requester');
  check(C.homeColumnKey(row) === Lab.homeColumnKey(row), 'decorate does not change homeColumnKey');
  check(Lab.homeColumnKey(row) !== Lab.clinicianColumnKey('Dr David Triska'), 'named GP is never auto-placement');

  const assigned = rxRow(2, { assignedTo: 'Dr Jane Cole', namedGp: 'Dr David Triska' });
  const board = C.buildWorkspace([row, assigned], C.emptyDraft());
  check(board.pool && board.pool.title === 'Non-routine prescriptions', 'rx pool title');
  check(board.pool.tiles.length === 1, 'unassigned named-GP row stays in the pool');
  check(
    board.pool.groups[0] && board.pool.groups[0].groupName === 'Dr David Triska' && board.pool.groups[0].count === 1,
    'pool groups unallocated work by registered GP'
  );
  check(/Registered GP/.test(board.pool.groups[0].label), 'group label says registered GP');
  check(!/ordered/i.test(board.pool.groups[0].label), 'group label never says ordered');
}

console.log('\n--- copy list is honest ---');
{
  const text = C.copyList(C.buildWorkspace([rxRow(4, { namedGp: 'Dr GP', summary: 'Prednisolone' })], C.emptyDraft()));
  check(/^Non-routine prescriptions \(1\)/.test(text), 'copy list leads with non-routine prescriptions');
  check(/registered GP/.test(text), 'named GP is labelled registered GP');
  check(/Not written to Medicus/.test(text), 'copy list refuses to claim a write');
  check(!/\b(Done|Sent|Allocated|Submitted|Booked|Filed|Issued|Signed)\b/.test(text), 'no completion verbs');
}

console.log('\n--- even split among doctors working today ---');
{
  const book = Lab.parseTodayBook({
    date: '2026-08-31',
    staffSchedules: [
      {
        name: 'Dr Natalie Azadian',
        schedule: [{ summary: { status: { isCancelled: false }, site: { name: 'Witley' }, service: { name: 'GP' } } }],
      },
      {
        name: 'Dr David Triska',
        schedule: [
          { summary: { status: { isCancelled: false }, site: { name: 'Witley' }, service: { name: 'GP' } } },
          { summary: { status: { isCancelled: false }, site: { name: 'Witley' }, service: { name: 'GP' } } },
        ],
      },
      {
        name: 'Practice Nurse Pat',
        schedule: [{ summary: { status: { isCancelled: false }, site: { name: 'Witley' }, service: { name: 'Nurse' } } }],
      },
    ],
  });
  const dests = C.workingTodayDoctors({ book: book, dateISO: '2026-08-31' });
  check(dests.length === 2, 'nurses are not in the even-split destinations (got ' + dests.length + ')');
  check(
    dests.every((d) => /Azadian|Triska/.test(d.name)),
    'destinations are the two GPs with a session'
  );
  check(dests[0].name < dests[1].name || dests[0].name > dests[1].name, 'destinations are ordered');

  const tiles = [rxRow(1), rxRow(2), rxRow(3), rxRow(4), rxRow(5)];
  const plan = C.planEvenSplit(tiles, dests);
  check(plan.ok === true, 'even split of 5 onto 2 is ok');
  check(plan.total === 5, 'plan total is 5');
  check(plan.doctors === 2, 'plan doctors is 2');
  check(
    plan.shares.map((s) => s.count).sort().join(',') === '2,3',
    'counts are 3 and 2 (got ' + plan.shares.map((s) => s.count).join(',') + ')'
  );
  check(
    plan.shares.every((s) => s.tileIds.length === s.count),
    'each share’s tile list matches its count'
  );
  const allIds = plan.shares.reduce((acc, s) => acc.concat(s.tileIds), []);
  check(allIds.length === 5, 'every unallocated tile is assigned once');
  check(new Set(allIds).size === 5, 'no tile is assigned twice');

  const empty = C.planEvenSplit([], dests);
  check(empty.ok === false && /Nothing unallocated/.test(empty.reason), 'empty pool refuses the split');
  const nobody = C.planEvenSplit(tiles, []);
  check(nobody.ok === false && /No doctors/.test(nobody.reason), 'no working doctors refuses the split');

  const staged = C.applyEvenSplit(C.emptyDraft(), plan);
  check(C.draftSummary(tiles, staged).count === 5, 'applyEvenSplit stages every unallocated request');
  const board = C.buildWorkspace(tiles, staged);
  check(board.pool.count === 0, 'after even split the pool is empty');
  const az = board.clinicians.find((c) => /Azadian/i.test(c.title));
  const dt = board.clinicians.find((c) => /Triska/i.test(c.title));
  check(az && dt, 'both working GPs have a field');
  check(az.count + dt.count === 5, 'the five requests sit on the two GP fields');
  check(Math.abs(az.count - dt.count) <= 1, 'the two fields differ by at most one');
}

console.log('\n--- even split ignores named GP and already-sitting work ---');
{
  const dests = [
    { key: Lab.clinicianColumnKey('Dr A'), name: 'Dr A' },
    { key: Lab.clinicianColumnKey('Dr B'), name: 'Dr B' },
  ];
  const pool = [rxRow(1, { namedGp: 'Dr A' }), rxRow(2, { namedGp: 'Dr A' })];
  const sitting = rxRow(9, { assignedTo: 'Dr A' });
  const plan = C.planEvenSplit(pool, dests);
  check(plan.shares.every((s) => s.count === 1), 'two pool tiles split 1+1, ignoring named GP');
  check(
    !plan.shares.some((s) => (s.tileIds || []).indexOf(sitting.id) !== -1),
    'already-sitting work is not in the even-split plan'
  );
}

console.log('\n--- cancelled sessions and absences drop out of working-today ---');
{
  const book = Lab.parseTodayBook({
    date: '2026-08-31',
    staffSchedules: [
      {
        name: 'Dr Away',
        schedule: [{ summary: { status: { isCancelled: true }, site: { name: 'Witley' } } }],
      },
      {
        name: 'Dr Present',
        schedule: [{ summary: { status: { isCancelled: false }, site: { name: 'Witley' }, service: { name: 'GP' } } }],
      },
    ],
  });
  const dests = C.workingTodayDoctors({
    book: book,
    dateISO: '2026-08-31',
    absences: [{ name: 'Dr Present', startDate: '2026-08-31', endDate: '2026-09-01', type: 'leave' }],
  });
  check(dests.length === 0, 'cancelled sessions and Medicus absences are not working-today doctors');
}

console.log('\n--- likely-doctor filter ---');
{
  check(C.isLikelyDoctor('Dr Jane Cole', 'GP') === true, 'Dr + GP service is a doctor');
  check(C.isLikelyDoctor('Practice Nurse Pat', 'Nurse clinic') === false, 'practice nurse is not a doctor');
  check(C.isLikelyDoctor('Pharmacist Kim', 'Pharmacy') === false, 'pharmacist is not a doctor');
}

console.log('\n--- write stays on the lab client ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'shared/rx-allocate-core.js'), 'utf8');
  const canvas = fs.readFileSync(path.join(__dirname, 'content-scripts/rx-allocate-canvas.js'), 'utf8');
  check(!/method:\s*['"]POST['"]/.test(src), 'rx core has no POST');
  check(!/method:\s*['"]POST['"]/.test(canvas), 'rx canvas has no POST — the lab client writes');
  check(/createClient: Lab\.createClient/.test(src), 'rx core re-exports the lab client');
  check(/commitAllocations/.test(canvas), 'canvas commits through the core client');
  check(/_confirmWrite/.test(canvas), 'write goes through a named patient → destination confirm');
  check(/Keep planning/.test(canvas), 'confirm defaults the clinician back to planning');
  check(/does not issue, sign, or file the prescription/.test(canvas), 'confirm says the write does not issue the Rx');
  check(!/\b(Done|Sent|Booked|Submitted|Allocated|Filed|Issued|Signed)\b/.test(canvas), 'canvas copy has no completion verbs');
  check(!/Ordered by|who ordered|Who ordered/.test(canvas), 'canvas copy never claims who ordered');
  check(/decorateRxRow/.test(canvas), 'rows are decorated after the task-list GET');
  check(/Stage even split on canvas/.test(canvas), 'even-split button stages, it does not write');
  check(/ms-rxac-split/.test(canvas), 'even-split control has its own id');
  check(/Allocate non-routine prescriptions on canvas/.test(canvas), 'launcher names non-routine prescriptions');
  check(/ms-rxac-overlay/.test(canvas) && /ms-rxac-launch/.test(canvas), 'overlay and launcher use rxac ids');
  check(/ms-lac-pool/.test(canvas) && /ms-lac-field/.test(canvas), 'reuses the lab layout classes');
  check(
    /result\.written > 0[\s\S]{0,200}?await loadBoard\(\)/.test(canvas),
    'a partly-written batch re-reads the queue'
  );
}

console.log('\n--- canvas + manifest + css source locks ---');
{
  const canvas = fs.readFileSync(path.join(__dirname, 'content-scripts/rx-allocate-canvas.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'content-scripts/lab-allocate-canvas.css'), 'utf8');
  const labCanvas = fs.readFileSync(path.join(__dirname, 'content-scripts/lab-allocate-canvas.js'), 'utf8');
  const wfCanvas = fs.readFileSync(path.join(__dirname, 'content-scripts/workflow-allocate-canvas.js'), 'utf8');
  check(manifest.indexOf('shared/rx-allocate-core.js') !== -1, 'rx core is in the manifest');
  check(manifest.indexOf('content-scripts/rx-allocate-canvas.js') !== -1, 'rx canvas is in the manifest');
  check(
    manifest.indexOf('shared/lab-allocate-core.js') < manifest.indexOf('shared/rx-allocate-core.js'),
    'lab core loads before rx core'
  );
  check(/#ms-rxac-overlay/.test(css), 'rx overlay is on the token block');
  check(/#ms-rxac-launch/.test(css), 'rx launcher has the same chrome as the lab launcher');
  check(/#ms-rxac-launch:focus-visible/.test(css), 'launcher focus ring is a literal (html-appended)');
  check(!/ms-rxac-overlay/.test(labCanvas), 'lab canvas does not open the rx overlay');
  check(!/ms-rxac-overlay/.test(wfCanvas), 'workflow canvas does not open the rx overlay');
  check(/parseRxQueueRoute/.test(canvas), 'rx canvas owns the non-routine route');
  check(!/parseRxQueueRoute/.test(labCanvas), 'lab canvas does not parse rx routes');
}

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
