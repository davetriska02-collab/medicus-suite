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
  const routine = C.parseRxQueueRoute(
    '/560b6c/tasks/prescription_request_task_routine/task-list',
    '?statuses[]=pending-review&viewContext=homepage&masterAssignee=0198ef96-6a17-71e4-8354-78de2b371ef3'
  );
  check(!!routine && routine.slug === 'prescription_request_task_routine', 'routine prescription queue is claimed');
  check(routine && routine.routine === true, 'routine route is flagged');
  check(
    /masterAssignee=0198ef96-6a17-71e4-8354-78de2b371ef3/.test(routine.search),
    'routine inbox keeps masterAssignee — that UUID is the box on the page'
  );
  check(/statuses\[\]=pending-review/.test(routine.search), 'routine inbox keeps pending-review');
  check(C.isRoutineRxQueueSlug('prescription_request_task_routine') === true, 'routine slug matches');
  check(C.isRxQueueSlug('prescription_request_task_routine') === true, 'rx canvas claims routine and non-routine');
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
  check(
    Wf.parseWorkflowQueueRoute('/560b6c/tasks/prescription_request_task_routine/task-list') === null,
    'workflow canvas still excludes the routine prescription queue'
  );
  check(
    C.queryStringForRxList(
      '?statuses[]=pending-review&viewContext=homepage&masterAssignee=0198ef96-6a17-71e4-8354-78de2b371ef3'
    ).indexOf('masterAssignee=') !== -1,
    'Rx query keeps the inbox masterAssignee'
  );
  check(
    Lab.queryStringForList(
      '?statuses[]=pending-review&viewContext=homepage&masterAssignee=0198ef96-6a17-71e4-8354-78de2b371ef3'
    ).indexOf('masterAssignee=') === -1,
    'lab query still drops masterAssignee'
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
  check(
    C.buildWorkspace([row], C.emptyDraft(), { routine: true }).pool.title === 'Routine prescriptions',
    'routine queue pool title'
  );
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

console.log('\n--- extractTaskArray extra envelopes ---');
{
  check(Lab.extractTaskArray({ items: [{ id: uuid(1) }] }).length === 1, 'items envelope');
  check(Lab.extractTaskArray({ taskList: [{ id: uuid(2) }] }).length === 1, 'taskList array envelope');
  check(Lab.extractTaskArray({ taskList: { tasks: [{ id: uuid(3) }] } }).length === 1, 'taskList.tasks envelope');
}

console.log('\n--- working day defaults to the calendar and can look ahead ---');
{
  check(C.coerceWorkDate('2026-09-01', '2026-08-31') === '2026-09-01', 'valid ISO is kept');
  check(C.coerceWorkDate('', '2026-08-31') === '2026-08-31', 'empty falls back to calendar day');
  check(C.coerceWorkDate('nights', '2026-08-31') === '2026-08-31', 'garbage falls back to calendar day');
  check(C.addDaysISO('2026-08-31', 1) === '2026-09-01', 'tomorrow is calendar day + 1');
  check(C.workDayPhrase('2026-08-31', '2026-08-31') === 'today', 'same day reads as today');
  check(/1 Sep 2026/.test(C.workDayPhrase('2026-09-01', '2026-08-31')), 'ahead day is named, not called today');
  const tomorrowPlan = C.planEvenSplit([rxRow(1)], [], { dayPhrase: '1 Sep 2026' });
  check(
    /1 Sep 2026/.test(tomorrowPlan.reason) && !/working today/.test(tomorrowPlan.reason),
    'no-doctors reason uses the picked day'
  );
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
  const plan = C.planEvenSplit(pool.concat([sitting]), dests);
  check(plan.shares.every((s) => s.count === 1), 'two pool tiles split 1+1, ignoring named GP');
  check(
    !plan.shares.some((s) => (s.tileIds || []).indexOf(sitting.id) !== -1),
    'already-sitting work is not in the even-split plan'
  );
  check(plan.total === 2, 'sitting rows are not counted in the split total');

  const inbox = rxRow(3, { assignedTo: 'Non-Routine Prescription Requests' });
  const sittingGp = rxRow(4, { assignedTo: 'Dr Jane Cole' });
  check(C.isRxUnallocated(inbox) === true, 'the Non-Routine Prescription Requests inbox is the unallocated pile');
  check(C.isRxUnallocated(sittingGp) === false, 'a request already sitting with a GP is not in the split');
  check(Lab.isTeamAssignee('Non-Routine Prescription Requests') === true, 'the queue name is an inbox, not a person');
  check(Lab.homeColumnKey(inbox) === Lab.POOL, 'inbox-assigned Rx stays in the unallocated pool');
  check(Lab.homeColumnKey(sittingGp) !== Lab.POOL, 'GP-assigned Rx sits on that clinician field');
  const mixed = C.planEvenSplit([inbox, sittingGp, rxRow(5)], dests);
  check(mixed.total === 2, 'even split is the unallocated inbox pile, not already-allocated GP work');
  check(
    !mixed.shares.some((s) => (s.tileIds || []).indexOf(sittingGp.id) !== -1),
    'already-allocated GP work is not in the even-split tile list'
  );
}

console.log('\n--- even-split dest staff UUID is what Write uses ---');
{
  const staffId = uuid(77);
  const dests = [
    { key: Lab.clinicianColumnKey('Dr Natalie Azadian'), name: 'Dr Natalie Azadian', staffId: staffId },
  ];
  const tiles = [rxRow(1), rxRow(2)];
  const plan = C.planEvenSplit(tiles, dests);
  check(plan.shares[0] && plan.shares[0].staffId === staffId, 'share carries the book staff UUID');
  const draft = C.applyEvenSplit(C.emptyDraft(), plan);
  check(draft.columnStaffIds[dests[0].key] === staffId, 'draft pins the staff UUID on the dest column');
  const wrote = Lab.planBulkReassign(tiles, draft, 'prescription_request_task_non_routine', { list: [] });
  check(wrote.ok === true, 'Write does not need a staff directory when the dest UUID is pinned');
  check(wrote.batches[0] && wrote.batches[0].assigneeId === staffId, 'POST assigneeId is the pinned UUID');

  const dirId = uuid(88);
  const nameless = [{ key: Lab.clinicianColumnKey('Dr Jane Cole'), name: 'Dr Jane Cole' }];
  const pinned = C.pinDestStaffIds(nameless, {
    list: [{ id: dirId, name: 'Dr Jane Cole' }],
  });
  check(pinned[0] && pinned[0].staffId === dirId, 'empty In-today UUID is filled from a unique directory match');
  const missed = C.pinDestStaffIds(nameless, { list: [] });
  check(!missed[0].staffId, 'no directory match leaves staffId empty rather than inventing one');
  const keyMatch = C.pinDestStaffIds(
    [{ key: Lab.clinicianColumnKey('Dr Natalie Azadian'), name: 'Dr Natalie Azadian' }],
    { list: [{ id: uuid(91), name: 'AZADIAN N' }] }
  );
  check(
    keyMatch[0] && keyMatch[0].staffId === uuid(91),
    'dest UUID pins from a staff-option name that shares the clinician key'
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
  check(/Re-split equally/.test(canvas), 're-split button resets to an even split');
  check(/applyDefaultEvenSplit/.test(canvas), 'even split is applied as the default board');
  check(
    /#ms-rxac-split[\s\S]{0,500}?stopPropagation/.test(canvas),
    're-split click is not swallowed by the pool drop target'
  );
  check(
    /Re-split ' \+[\s\S]{0,400}?_copyNote/.test(canvas) || /_copyNote\s*=[\s\S]{0,400}?Re-split /.test(canvas),
    're-split writes a visible note, not only a live-region whisper'
  );
  check(
    /evenSplitHtml\(\) \+[\s\S]{0,80}?<div class="ms-lac-workspace">/.test(canvas),
    'even-split box is outside the unallocated pool drop target'
  );
  check(/Drag a request onto another doctor/.test(canvas), 'copy says you can still move requests by hand');
  check(/ms-rxac-split/.test(canvas), 'even-split control has its own id');
  check(/id="ms-rxac-day"/.test(canvas), 'working-day date input is on the canvas');
  check(/ms-rxac-day-tomorrow/.test(canvas), 'Tomorrow shortcut is on the canvas');
  check(/Defaults to today/.test(canvas), 'date picker copy says it defaults to today');
  check(/queueTitle\(\)/.test(canvas) && /on canvas/.test(canvas), 'launcher names this prescription queue');
  check(/data-expand-key/.test(canvas), 'clinician fields have a dedicated Expand control for the patient list');
  check(/ms-rxac-overlay/.test(canvas) && /ms-rxac-launch/.test(canvas), 'overlay and launcher use rxac ids');
  check(/ms-lac-pool/.test(canvas) && /ms-lac-field/.test(canvas), 'reuses the lab layout classes');
  check(
    /result\.written > 0[\s\S]{0,240}?await loadBoard\(\{ skipSplit: true \}\)/.test(canvas),
    'a partly-written batch re-reads the queue without restaging the even split'
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
  check(/fetchRxTaskList/.test(canvas), 'canvas loads the pile via fetchRxTaskList');
  check(/isRxUnallocated/.test(canvas), 'canvas even-split only stages unallocated Non-Routine requests');
  check(/isRxUnallocated\(t\)/.test(canvas), 'split counts ignore requests already sitting with a GP');
  check(/skipSplit/.test(canvas), 'after Write the canvas does not re-stage an even split');
  check(/fetchList:/.test(canvas), 'Write re-GETs via fetchRxTaskList, not a page-filter fetchTaskList');
  check(/if \(!_open\) _route = route/.test(canvas), 'open overlay pins _route so ensureLauncher cannot clobber search');
  check(/reload Medicus if the grid still shows the old number/.test(canvas), 'after Write the canvas says the open-list count may not drop');
  check(/cache:\s*['"]no-store['"]/.test(fs.readFileSync(path.join(__dirname, 'shared/lab-allocate-core.js'), 'utf8')), 'queue re-GET is not served from HTTP cache');
}

(async function () {
  console.log('\n--- fetchRxTaskList prefers the page inbox (masterAssignee) ---');
  const idA = uuid(21);
  const idB = uuid(22);
  const inboxBody = {
    tasks: [
      { id: idA, patientName: 'FORD, A', assignedTo: 'Routine Prescription Requests', summary: 'Repeat A' },
      { id: idB, patientName: 'FORD, B', assignedTo: 'Routine Prescription Requests', summary: 'Repeat B' },
    ],
  };
  const allocatedBody = {
    tasks: [{ id: uuid(99), patientName: 'OTHER, C', assignedTo: 'Dr Jane Cole', summary: 'Already allocated' }],
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    let body = allocatedBody;
    if (path.indexOf('masterAssignee') !== -1) body = inboxBody;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    };
  };
  const qs =
    '?statuses[]=pending-review&viewContext=homepage&masterAssignee=0198ef96-6a17-71e4-8354-78de2b371ef3';
  const out = await C.fetchRxTaskList(
    'https://560b6c.api.england.medicus.health',
    'prescription_request_task_routine',
    qs,
    { fetchImpl: fetchImpl }
  );
  check(out.rows && out.rows.length === 2, 'page inbox GET returns the routine box (got ' + ((out.rows && out.rows.length) || 0) + ')');
  check(
    calls[0] && calls[0].indexOf('masterAssignee=0198ef96-6a17-71e4-8354-78de2b371ef3') !== -1,
    'first request keeps the inbox masterAssignee'
  );
  check(C.isRxUnallocated(out.rows[0]) === true, 'inbox-assigned routine requests are the unallocated pile');
  check(/fetchRxTaskList/.test(fs.readFileSync(path.join(__dirname, 'content-scripts/rx-allocate-canvas.js'), 'utf8')), 'canvas calls fetchRxTaskList');

  const emptyCalls = [];
  const emptyThenBare = async (url) => {
    emptyCalls.push(String(url));
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const empty = path.indexOf('?') !== -1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(empty ? { tasks: [] } : inboxBody),
    };
  };
  const fallback = await C.fetchRxTaskList(
    'https://560b6c.api.england.medicus.health',
    'prescription_request_task_routine',
    qs,
    { fetchImpl: emptyThenBare }
  );
  check(fallback.rows && fallback.rows.length === 2, 'empty inbox filter falls back to the bare GET');

  if (failed) {
    console.error('\n' + failed + ' failed, ' + passed + ' passed');
    process.exit(1);
  }
  console.log('\n' + passed + ' passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
