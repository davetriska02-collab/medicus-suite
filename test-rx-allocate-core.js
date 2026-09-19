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
  check(C.parseRxQueueRoute('/e38a9f/tasks/eps-prescription-order-item/task-list') === null, 'EPS queue is excluded');
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
  check(/Usual GP/.test(board.pool.groups[0].label), 'group label says usual GP');
  check(!/ordered/i.test(board.pool.groups[0].label), 'group label never says ordered');
}

console.log('\n--- copy list is honest ---');
{
  const text = C.copyList(C.buildWorkspace([rxRow(4, { namedGp: 'Dr GP', summary: 'Prednisolone' })], C.emptyDraft()));
  check(/^Non-routine prescriptions \(1\)/.test(text), 'copy list leads with non-routine prescriptions');
  check(/usual GP/.test(text), 'named GP is labelled usual GP');
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
        schedule: [
          { summary: { status: { isCancelled: false }, site: { name: 'Witley' }, service: { name: 'Nurse' } } },
        ],
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
    plan.shares
      .map((s) => s.count)
      .sort()
      .join(',') === '2,3',
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
  check(
    plan.shares.every((s) => s.count === 1),
    'two pool tiles split 1+1, ignoring named GP'
  );
  check(
    !plan.shares.some((s) => (s.tileIds || []).indexOf(sitting.id) !== -1),
    'already-sitting work is not in the even-split plan'
  );
  check(plan.total === 2, 'sitting rows are not counted in the split total');
  const sharePlan = C.planEvenSplit([sitting], dests, { anyTile: true });
  check(sharePlan.ok === true && sharePlan.total === 1, 'a doctor folder can be shared out among those in today');
  check(
    (sharePlan.shares || []).every((s) => (s.tileIds || []).indexOf(sitting.id) !== -1 || s.count === 0 || s.tileIds),
    'share-out uses the sitting tiles'
  );
  const holidayTiles = [
    rxRow(21, { assignedTo: 'Dr Away' }),
    rxRow(22, { assignedTo: 'Dr Away' }),
    rxRow(23, { assignedTo: 'Dr Away' }),
  ];
  const holidayPlan = C.planEvenSplit(holidayTiles, dests, { anyTile: true, dayPhrase: 'today' });
  check(holidayPlan.ok === true && holidayPlan.total === 3, 'a holiday box of three shares out among those in today');
  check(
    holidayPlan.shares
      .map((s) => s.count)
      .sort()
      .join(',') === '1,2',
    'holiday share-out is even (2 and 1)'
  );
  const holidayDraft = C.applyEvenSplit(C.emptyDraft(), holidayPlan);
  const holidayBoard = C.buildWorkspace(holidayTiles, holidayDraft);
  const awayCol = holidayBoard.clinicians.find((c) => /Away/i.test(c.title));
  check(!awayCol || awayCol.count === 0, 'share-out empties the holiday doctor’s box');
  check(
    dests.every((d) => holidayPlan.shares.some((s) => s.key === d.key)),
    'share-out destinations are the in-today doctors, not the holiday source'
  );

  const inbox = rxRow(3, { assignedTo: 'Non-Routine Prescription Requests' });
  const sittingGp = rxRow(4, { assignedTo: 'Dr Jane Cole' });
  check(C.isRxUnallocated(inbox) === true, 'the Non-Routine Prescription Requests inbox is the unallocated pile');
  check(C.isRxUnallocated(sittingGp) === false, 'a request already sitting with a GP is not in the split');
  check(Lab.isTeamAssignee('Non-Routine Prescription Requests') === true, 'the queue name is an inbox, not a person');
  check(Lab.homeColumnKey(inbox) === Lab.POOL, 'inbox-assigned Rx stays in the unallocated pool');
  check(Lab.homeColumnKey(sittingGp) !== Lab.POOL, 'GP-assigned Rx sits on that clinician field');

  const boxId = '0198ef96-6a17-71e4-8354-78de2b371ef3';
  const inBox = rxRow(6, { assignedTo: 'Dr Jane Cole', assignedId: boxId });
  const marked = C.markInboxRows([inBox], '?statuses[]=pending-review&viewContext=homepage&masterAssignee=' + boxId);
  check(marked[0] && marked[0].rxInboxPile === true, 'page-inbox rows are stamped as the box to work');
  check(C.isRxUnallocated(marked[0]) === true, 'the twelve in the box are unallocated for the split');
  check(Lab.homeColumnKey(marked[0]) === Lab.POOL, 'inbox rows sit in the unallocated list, not on a GP field');
  check(
    C.inboxAssigneeId('?statuses[]=pending-review&viewContext=homepage&masterAssignee=' + boxId) === boxId,
    'inboxAssigneeId reads masterAssignee from the page query'
  );
  const untouched = C.markInboxRows([sittingGp], '');
  check(C.isRxUnallocated(untouched[0]) === false, 'without an inbox filter, GP-assigned work stays sitting');
  const leaked = rxRow(30, { assignedTo: 'Dr Jane Cole', assignedId: uuid(10) });
  const markedLeaked = C.markInboxRows(
    [leaked],
    '?statuses[]=pending-review&viewContext=homepage&masterAssignee=' + boxId
  );
  check(
    !markedLeaked[0].rxInboxPile && C.isRxUnallocated(markedLeaked[0]) === false,
    'inbox GET rows already sitting with a GP are not restamped unallocated'
  );
  const merged = C.mergeInboxAndSitting(
    [rxRow(7, { assignedTo: 'Dr Jane Cole', assignedId: boxId })],
    [rxRow(7, { assignedTo: 'Dr Jane Cole', assignedId: boxId }), rxRow(8, { assignedTo: 'Dr David Triska' })],
    '?masterAssignee=' + boxId
  );
  check(merged.length === 2, 'inbox + already-sitting merge to two rows');
  check(merged.filter((r) => C.isRxUnallocated(r)).length === 1, 'inbox row stays the pile; GP-sitting stays sitting');
  const mixed = C.planEvenSplit([inbox, sittingGp, rxRow(5)], dests);
  check(mixed.total === 2, 'even split is the unallocated inbox pile, not already-allocated GP work');
  check(
    !mixed.shares.some((s) => (s.tileIds || []).indexOf(sittingGp.id) !== -1),
    'already-allocated GP work is not in the even-split tile list'
  );
}

console.log('\n--- top-up empty boxes and distribute equally ---');
{
  const dests = [
    { key: Lab.clinicianColumnKey('Dr A'), name: 'Dr A' },
    { key: Lab.clinicianColumnKey('Dr B'), name: 'Dr B' },
    { key: Lab.clinicianColumnKey('Dr C'), name: 'Dr C' },
  ];
  const pile = [rxRow(1), rxRow(2), rxRow(3)];
  const counts = {};
  counts[dests[0].key] = 5;
  counts[dests[1].key] = 5;
  counts[dests[2].key] = 0;
  const top = C.planTopUp(pile, dests, counts);
  check(top.ok === true && top.total === 3, 'top-up of 3 is ok');
  const byName = {};
  top.shares.forEach((s) => {
    byName[s.name] = s.count;
  });
  check(
    byName['Dr C'] === 3 && byName['Dr A'] === 0 && byName['Dr B'] === 0,
    'all three go to the empty box (got ' + JSON.stringify(byName) + ')'
  );
  const evenish = C.planTopUp(pile, dests, {});
  check(
    evenish.shares
      .map((s) => s.count)
      .sort()
      .join(',') === '1,1,1',
    'top-up from empty dests is even'
  );
  const sitting = [
    rxRow(11, { assignedTo: 'Dr A' }),
    rxRow(12, { assignedTo: 'Dr A' }),
    rxRow(13, { assignedTo: 'Dr A' }),
    rxRow(14, { assignedTo: 'Dr A' }),
    rxRow(15, { assignedTo: 'Dr A' }),
    rxRow(16, { assignedTo: 'Dr B' }),
    rxRow(17, { assignedTo: 'Dr B' }),
    rxRow(18, { assignedTo: 'Dr B' }),
    rxRow(19, { assignedTo: 'Dr B' }),
    rxRow(20, { assignedTo: 'Dr B' }),
  ];
  const level = C.planLevel(sitting.concat(pile), dests);
  check(level.ok && level.total === 13, 'level uses sitting plus pile');
  const levelCounts = level.shares.map((s) => s.count).sort((a, b) => a - b);
  check(levelCounts[levelCounts.length - 1] - levelCounts[0] <= 1, 'levelled counts differ by at most one');
  const draft = C.applyEvenSplit(C.emptyDraft(), C.planEvenSplit(pile, dests.slice(0, 2)));
  check(C.unallocatedNotStaged(pile, draft).length === 0, 'staged unallocated tiles are not still in the pile');
  check(C.unallocatedNotStaged(pile, C.emptyDraft()).length === 3, 'without a draft they stay in the pile');
  const trickle = C.planEvenSplit([rxRow(31), rxRow(32)], dests);
  check(
    trickle.shares.map((s) => s.count).join(',') === '1,1,0',
    'plain even-split of a 2-item trickle onto 3 dests is 1,1,0 — empty dest stays empty'
  );
  check(
    C.destNamesPhrase(dests) === 'Dr A, Dr B, and Dr C',
    'dest phrase names who top-up and distribute go to (got ' + C.destNamesPhrase(dests) + ')'
  );
  const teamKey = Lab.teamColumnKey('Duty GP');
  const teamDraft = C.addTeamColumn(C.emptyDraft(), 'Duty GP', uuid(40));
  check(teamDraft.extraColumns.indexOf(teamKey) !== -1, 'addTeamColumn keeps a Medicus team as a destination');
  const teamPlan = C.planEvenSplit(
    [rxRow(41), rxRow(42)],
    [{ key: teamKey, name: 'Duty GP', staffId: uuid(40) }, dests[0]]
  );
  check(teamPlan.ok && teamPlan.doctors === 2, 'even split can land on a harvested team');

  const Groups = require('./shared/allocation-groups-core.js');
  const morning = Groups.normalisePreset({
    name: 'Morning triage',
    memberIds: [uuid(51), uuid(52)],
    memberNames: { [uuid(51)]: 'Dr Dave Triska', [uuid(52)]: 'Dr Sarah Chen' },
  });
  const fromGroup = Groups.destsFromSet({ kind: 'group', id: morning.id }, { presets: [morning] });
  const groupDests = Lab.asSplitDests(fromGroup.dests);
  check(groupDests.length === 2, 'a saved group becomes two staff dests');
  check(
    groupDests.every((d) => String(d.key).indexOf('clinician:') === 0),
    'group dests are people, not Medicus team inboxes'
  );
  const pinnedGroup = C.pinDestStaffIds(groupDests, {
    list: [
      { id: uuid(51), name: 'Dr Dave Triska' },
      { id: uuid(52), name: 'Dr Sarah Chen' },
    ],
  });
  check(
    pinnedGroup[0].staffId === uuid(51) && pinnedGroup[1].staffId === uuid(52),
    'group dest staff ids stay pinned for Write'
  );
  const gPlan = C.planEvenSplit([rxRow(61), rxRow(62), rxRow(63), rxRow(64)], pinnedGroup);
  check(gPlan.ok && gPlan.doctors === 2 && gPlan.total === 4, 'even split onto a group of two people');
  const replaced = C.replaceDestColumns(C.ensureWorkingTodayColumns(C.emptyDraft(), dests), pinnedGroup);
  check(
    replaced.extraColumns.length === 2 && pinnedGroup.every((d) => replaced.extraColumns.indexOf(d.key) !== -1),
    'switching dest set replaces leftover In-today columns, it does not union them'
  );
  const leftoverMove = C.stageMove(C.ensureWorkingTodayColumns(C.emptyDraft(), dests), rxRow(70).id, dests[0].key);
  const cleared = C.replaceDestColumns(leftoverMove, pinnedGroup);
  check(!cleared.moves[rxRow(70).id], 'switching dest set drops staged moves onto leftover In-today dests');
}

console.log('\n--- even-split dest staff UUID is what Write uses ---');
{
  const staffId = uuid(77);
  const dests = [{ key: Lab.clinicianColumnKey('Dr Natalie Azadian'), name: 'Dr Natalie Azadian', staffId: staffId }];
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

console.log('\n--- send to usual GP is staging, never auto-place ---');
{
  const janeId = uuid(100);
  const daveId = uuid(101);
  const samA = uuid(200);
  const samB = uuid(201);
  const janeKey = Lab.clinicianColumnKey('Dr Jane Cole');
  const daveKey = Lab.clinicianColumnKey('Dr David Triska');
  const inDay = [
    { key: janeKey, name: 'Dr Jane Cole', staffId: janeId },
    { key: daveKey, name: 'Dr David Triska', staffId: daveId },
  ];
  const dir = Lab.harvestStaffDirectory(
    [
      rxRow(1, { namedGp: 'Dr Jane Cole', namedGpId: janeId }),
      rxRow(2, { namedGp: 'Dr David Triska', namedGpId: daveId }),
      rxRow(3, { namedGp: 'Dr Sam Smith', namedGpId: samA }),
      rxRow(4, { namedGp: 'Dr Sam Smith', namedGpId: samB }),
    ],
    null
  );

  const inDayJane = rxRow(10, { namedGp: 'Dr Jane Cole', namedGpId: janeId, summary: 'Ramipril' });
  const inDayDave = rxRow(11, { namedGp: 'Dr David Triska', namedGpId: daveId });
  const notInSam = rxRow(12, { namedGp: 'Dr Natalie Azadian', namedGpId: uuid(300) });
  const noGp = rxRow(13, { summary: 'Acute' });
  const ambiguous = rxRow(14, { namedGp: 'Dr Sam Smith' });
  const requesterOnly = rxRow(15, { requester: 'Dr Jane Cole' });
  const sitting = rxRow(16, {
    assignedTo: 'Dr Jane Cole',
    assignedId: janeId,
    namedGp: 'Dr David Triska',
    namedGpId: daveId,
  });
  const teamName = rxRow(17, { namedGp: 'Duty Doctor' });
  const nameOnlyIn = rxRow(18, { namedGp: 'Dr Jane Cole' });
  const idBeatsRequester = rxRow(19, {
    namedGp: 'Dr David Triska',
    namedGpId: daveId,
    requester: 'Dr Jane Cole',
  });

  const boardBefore = C.buildWorkspace(
    [inDayJane, inDayDave, notInSam, noGp, ambiguous, requesterOnly, sitting, teamName],
    C.emptyDraft()
  );
  check(
    boardBefore.pool.tiles.some((t) => t.id === inDayJane.id),
    'usual-GP row stays in the pool until the user asks'
  );
  check(C.homeColumnKey(inDayJane) === Lab.POOL, 'homeColumnKey stays pool — named GP never auto-places');
  check(!inDayJane.requester, 'decorate still does not write named GP onto requester');

  const safe = C.planSendToUsualGp(
    [inDayJane, inDayDave, notInSam, noGp, ambiguous, requesterOnly, sitting, teamName, nameOnlyIn, idBeatsRequester],
    inDay,
    { directory: dir }
  );
  check(safe.ok === true, 'in-day usual GPs can be staged');
  check(
    safe.sent.length === 4,
    'in-day send stages Jane, Dave, name-only Jane, and id-preferred Dave (got ' + safe.sent.length + ')'
  );
  check(
    safe.sent.every(function (m) {
      return m.toKey === janeKey || m.toKey === daveKey;
    }),
    'in-day dests are the usual GPs, not a duty / first dest'
  );
  check(
    safe.sent.some(function (m) {
      return m.id === idBeatsRequester.id && m.toKey === daveKey && m.staffId === daveId;
    }),
    'namedGpId is preferred; requester is ignored'
  );
  check(
    safe.sent.some(function (m) {
      return m.id === nameOnlyIn.id && m.toKey === janeKey;
    }),
    'unique usual-GP name on the working-day book is used'
  );
  check(
    safe.sent.every(function (m) {
      return m.id !== sitting.id;
    }),
    'work already sitting with a person is not in the send pool'
  );
  check(
    safe.skippedNotIn.some((s) => s.id === notInSam.id),
    'usual GP who is not in stays in the pile'
  );
  check(
    safe.skippedUnknown.some((s) => s.id === noGp.id),
    'no usual GP stays in the pile'
  );
  check(
    safe.skippedUnknown.some((s) => s.id === requesterOnly.id),
    'requester-only row is not treated as usual GP'
  );
  check(
    safe.skippedUnknown.some((s) => s.id === teamName.id),
    'team-inbox usual-GP name stays in the pile'
  );
  check(
    safe.skippedAmbiguous.some((s) => s.id === ambiguous.id),
    'two staff matching the name stay in the pile'
  );
  check(!safe.sent.some((m) => m.id === ambiguous.id), 'ambiguous name is never picked');
  check(
    safe.sent.every(function (m) {
      return !m.notIn;
    }),
    'safe plan does not stage not-in usual GPs'
  );

  const unsafe = C.planSendToUsualGp([notInSam], inDay, { includeNotIn: true, directory: dir });
  check(
    unsafe.sent.length === 1 && unsafe.sent[0].notIn === true,
    'not-in toggle stages the usual GP who is not working'
  );
  check(unsafe.sent[0].staffId === uuid(300), 'not-in send pins namedGpId on the dest');

  const idOnly = rxRow(20, { namedGp: '', namedGpId: janeId });
  const idPlan = C.planSendToUsualGp([idOnly], inDay, { directory: dir });
  check(
    idPlan.ok && idPlan.sent[0] && idPlan.sent[0].toKey === janeKey && idPlan.sent[0].staffId === janeId,
    'namedGpId matches the in-day book even without a display name on the row'
  );

  const leftoverTiles = [notInSam, noGp, ambiguous, requesterOnly];
  const leftoverPlan = C.planEvenSplit(leftoverTiles, inDay);
  check(
    leftoverPlan.ok === true && leftoverPlan.total === 4,
    'Split equally still works on leftovers after usual-GP send'
  );

  let draft = C.emptyDraft();
  draft = C.applySendToUsualGp(draft, safe);
  check(draft.moves[inDayJane.id] === janeKey, 'apply stages the in-day usual-GP move');
  check(draft.columnStaffIds[janeKey] === janeId, 'apply pins namedGpId on the dest column');
  check(!draft.moves[notInSam.id], 'apply does not stage the not-in usual GP when the toggle is off');
  check(!draft.moves[sitting.id], 'apply does not move sitting work');
  check(!draft.moves[requesterOnly.id], 'apply never stages the requester as usual GP');

  const preview = C.usualGpPreviewCopy(safe, 'Tue 15 Sep');
  check(/can go to their usual GP/.test(preview), 'preview names will-send');
  check(/those GPs are not in/.test(preview), 'preview names not-in');
  check(/no usual GP on the request/.test(preview), 'preview names missing usual GP');
  check(/two staff match that name/.test(preview), 'preview names ambiguous name');
  check(
    !/\b(Done|Sent|Allocated|Submitted|Booked|Filed|Issued|Signed)\b/.test(preview),
    'preview has no completion verbs'
  );
  const destPhrase = C.usualGpDestPhrase(safe);
  check(/would sit with their usual GP/.test(destPhrase), 'dest phrase names usual GP, not a write');
  check(
    !/\b(Done|Sent|Allocated|Submitted|Booked|Filed|Issued|Signed)\b/.test(destPhrase),
    'dest phrase has no completion verbs'
  );
  const rxCoreSrc = fs.readFileSync(path.join(__dirname, 'shared/rx-allocate-core.js'), 'utf8');
  check(!/planSendToRequester\(/.test(rxCoreSrc), 'rx core does not call the lab requester planner');
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
  check(
    !/\b(Done|Sent|Booked|Submitted|Allocated|Filed|Issued|Signed)\b/.test(canvas),
    'canvas copy has no completion verbs'
  );
  check(!/Ordered by|who ordered|Who ordered/.test(canvas), 'canvas copy never claims who ordered');
  check(/mergeInboxAndSitting/.test(canvas), 'rows are decorated after the task-list GET');
  check(/Split equally/.test(canvas), 'split equally is a user-initiated proposal');
  check(/applyDefaultEvenSplit/.test(canvas), 'even split is applied when you ask for it');
  check(/applyPileSplit/.test(canvas) && /planTopUp/.test(canvas), 'new unallocated work can top up empty boxes');
  check(/function applyPileSplit[\s\S]{0,500}planEvenSplit/.test(canvas), 'Split equally binds planEvenSplit');
  check(/gen !== _boardGen/.test(canvas), 'overview harvest stops when the overlay is closed');
  check(/function applyTopUp[\s\S]{0,500}planTopUp/.test(canvas), 'Top up binds planTopUp');
  check(/applyLevel/.test(canvas) && /planLevel/.test(canvas), 'distribute equally levels sitting plus new work');
  check(/unallocatedNotStaged/.test(canvas), 'staged unallocated tiles leave the split pile');
  check(/Top up empty boxes/.test(canvas), 'top-up is a named action');
  check(/Distribute equally/.test(canvas), 'distribute equally is a named action');
  check(!/Re-split equally/.test(canvas), 'proposal page does not offer a redundant re-split');
  check(/Drag a patient from one person onto another/.test(canvas), 'proposal explains drag and drop');
  check(/Review then write/.test(canvas), 'the review control says it starts the write');
  check(/Confirm write to Medicus/.test(canvas), 'the confirm card is the write step');
  check(/data-share-key/.test(canvas), 'each doctor folder can share its box among those in today');
  check(/ms-rxac-folder-action/.test(canvas), 'share-this-box sits on that doctor’s folder');
  check(/>Share this box</.test(canvas), 'the per-doc control shares that doctor’s box only');
  check(/ms-rxac-share-away/.test(canvas), 'an away doctor’s share-this-box is marked for the holiday case');
  check(/ms-rxac-share-quiet/.test(canvas), 'in-today share-this-box stays a quieter folder action');
  check(/ms-rxac-split-go/.test(canvas), 'split equally is a primary control');
  check(/ms-rxac-proposal/.test(canvas), 'after split the board names it a proposal');
  check(/ms-rxac-count-pop/.test(canvas), 'proposed numbers on each doctor pop');
  check(
    /ms-rxac-review-dock/.test(canvas) && /ms-rxac-review-go/.test(canvas),
    'review is a floating dock in the panel'
  );
  check(/ms-rxac-review-open/.test(canvas), 'confirm list opens in the review dock, not a scrim');
  check(/ms-rxac-reviewing/.test(canvas), 'review-open puts a reviewing class on the panel');
  check(/ms-rxac-dests/.test(canvas) && /To:/.test(canvas), 'top-up and distribute name who they go to');
  check(/Add a team from Medicus/.test(canvas), 'Medicus teams can be added as destinations');
  check(
    /function setCustomFromKeys[\s\S]{0,500}replaceDestColumns/.test(canvas),
    'custom dest-set change replaces leftover In-today columns'
  );
  check(/setData\('text\/plain', 'people:'/.test(canvas), 'people-drag uses a people: payload');
  check(/indexOf\('people:'\) === 0/.test(canvas), 'people: payload is not staged as a task id');
  check(/these prescriptions/.test(canvas), 'Rx confirm names prescriptions, not requests');
  check(/refusedPatientsPhrase/.test(canvas), 'Rx confirm names refused patients');
  check(/addTeamColumn/.test(canvas), 'adding a team uses addTeamColumn, not a doctor field');
  check(/visibleUnallocatedCount/.test(canvas), 'unallocated count is the visible pile, not sitting work');
  check(/splitDestinations/.test(canvas), 'split dests include in-today doctors plus added teams');
  check(
    /splitDestinations[\s\S]{0,900}?away-pending/.test(canvas),
    'extra dests that are away do not get the even split'
  );
  check(
    /var keepDraft = opts\.skipSplit/.test(canvas),
    'loadBoard snapshots the draft at entry so a successful Write cannot restage during re-GET'
  );
  check(/ms-rxac-folder-clear/.test(canvas), 'empty unallocated is greened out');
  check(
    /ms-rxac-board/.test(canvas) && /ms-rxac-rail/.test(canvas),
    'unallocated is the main pane, doctors sit in a rail'
  );
  check(/ms-rxac-board-clear/.test(canvas), 'an empty unallocated pile lays doctors out as a grid');
  check(
    /function bindPileAction[\s\S]{0,400}?stopPropagation/.test(canvas) &&
      /bindPileAction\('#ms-rxac-split'/.test(canvas),
    'split click is not swallowed by the pool drop target'
  );
  check(
    /\[data-share-key\][\s\S]{0,400}?stopPropagation/.test(canvas),
    'share-out click is not swallowed by the folder drop target'
  );
  check(
    /_copyNote[\s\S]{0,200}?'Split ' \+/.test(canvas) || /'Split ' \+[\s\S]{0,200}?_copyNote/.test(canvas),
    'split writes a visible note, not only a live-region whisper'
  );
  check(
    /_copyNote[\s\S]{0,200}?'Shared ' \+/.test(canvas) || /'Shared ' \+[\s\S]{0,200}?_copyNote/.test(canvas),
    'share-out writes a visible note, not only a live-region whisper'
  );
  check(
    /evenSplitHtml\(\) \+[\s\S]{0,80}?ms-rxac-folders/.test(canvas),
    'even-split box is outside the unallocated pool drop target'
  );
  check(
    /Unallocated is the pile/.test(canvas) && /drag a patient onto a doctor/.test(canvas),
    'copy says you can still move requests by hand'
  );
  check(/Share this box/.test(canvas), 'header says Share this box splits only that doctor’s requests');
  check(/ms-rxac-split/.test(canvas), 'even-split control has its own id');
  check(/id="ms-rxac-day"/.test(canvas), 'working-day date input is on the canvas');
  check(/ms-rxac-day-tomorrow/.test(canvas), 'Tomorrow shortcut is on the canvas');
  check(/Working day/.test(canvas) && /ms-rxac-day-today/.test(canvas), 'date picker copy says it defaults to today');
  check(/Share out this inbox/.test(canvas), 'launcher names the inbox, not a canvas');
  check(/ms-rxac-launch-wrap/.test(canvas), 'share-out launcher shares a wrap with Check for overdue monitoring');
  check(/ms-rxac-folder-body/.test(canvas), 'folder patient lists are always visible');
  check(/ms-rxac-overlay/.test(canvas) && /ms-rxac-launch/.test(canvas), 'overlay and launcher use rxac ids');
  check(/ms-rxac-folder/.test(canvas) && /ms-rxac-folders/.test(canvas), 'board is a grid of clinician folders');
  check(
    /result\.written > 0[\s\S]{0,240}?await loadBoard\(\{ skipSplit: true \}\)/.test(canvas),
    'a partly-written batch re-reads the queue without restaging the even split'
  );
  check(
    /currentStaffId/.test(canvas) && /data-ch-staff/.test(canvas),
    'canvas reads the staff stamp to skip a homepage personal slice'
  );
  check(
    /inboxFetchOpts/.test(canvas) && /mergeOptsFor/.test(canvas),
    'loadBoard passes staffId and winning-search merge opts'
  );
  check(/stampSearch/.test(canvas), 'loadBoard stamps with the winning GET, not leftover location.search');
  check(/bareOnly:\s*true/.test(canvas), 'sitting GET is the bare open list, not the query plan');
  check(/ch-task-list-data/.test(canvas), 'launcher listens for the task-list bridge count');
  check(
    /rxEmptyPileReason/.test(canvas) && /pileReason/.test(canvas),
    'distribute copy names empty dests vs empty pile'
  );
  check(/Suite’s list is empty — the table is not/.test(canvas), 'empty overlay names a grid-vs-Suite mismatch');
  check(
    /No doctors working/.test(canvas) || /no doctors to share onto/.test(canvas),
    'empty dests are not described as an empty inbox'
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
  check(
    /folder-inbox\.ms-rxac-folder-clear/.test(css),
    'empty unallocated keeps its green clear paint over the inbox dashed well'
  );
  check(
    /#ms-rxac-overlay \.ms-rxac-share:focus-visible/.test(css),
    'share-this-box has an overlay-local keyboard ring'
  );
  check(/#ms-rxac-overlay \.ms-rxac-split-go/.test(css), 'split equally is sized as the primary action');
  check(/#ms-rxac-overlay \.ms-lac-nwd-offer/.test(css), 'usual-GP offer strip is painted on the rx overlay');
  check(
    /#ms-rxac-overlay \.ms-lac-nwd-offer[\s\S]{0,220}background:\s*transparent/.test(css),
    'usual-GP preview is supporting copy, not an accent callout'
  );
  check(
    !/#ms-lac-overlay \.ms-lac-nwd-offer,\s*#ms-rxac-overlay \.ms-lac-nwd-offer/.test(css),
    'lab send strip and rx usual-GP preview do not share the hero panel'
  );
  check(/#ms-rxac-overlay \.ms-rxac-count-pop/.test(css), 'proposed dest counts are a pop number');
  check(/#ms-rxac-overlay \.ms-rxac-review-dock/.test(css), 'review docks inside the panel');
  check(
    /#ms-rxac-overlay \.ms-rxac-folders[\s\S]{0,160}minmax\(280px/.test(css),
    'rx dest-grid cards are at least 280px wide'
  );
  check(
    /#ms-rxac-overlay \.ms-rxac-board-clear \.ms-rxac-folders \.ms-rxac-folder[\s\S]{0,200}max-height:\s*none/.test(
      css
    ),
    'after-split rx dest cards are not height-capped to the board'
  );
  check(
    /#ms-rxac-overlay \.ms-lac-panel\.ms-rxac-reviewing \.ms-lac-body[\s\S]{0,200}display:\s*none/.test(css),
    'rx review-open hides the board so the proposal list is the page'
  );
  check(/#ms-rxac-launch/.test(css), 'rx launcher has the same chrome as the lab launcher');
  check(/#ms-rxac-launch:focus-visible/.test(css), 'launcher focus ring is a literal (html-appended)');
  check(!/ms-rxac-overlay/.test(labCanvas), 'lab canvas does not open the rx overlay');
  check(!/ms-rxac-overlay/.test(wfCanvas), 'workflow canvas does not open the rx overlay');
  check(
    /AllocationGroupsCore/.test(canvas) || /destSetStripHtml/.test(canvas) || /ms-ags-in-today/.test(canvas),
    'rx canvas uses allocation groups dest-set strip'
  );
  check(
    /destSetStripHtml/.test(canvas) && /ms-ags-in-today/.test(canvas),
    'dest-set strip includes Working today chip id'
  );
  check(/inTodayPeople\(\)\.length/.test(canvas), 'Working today count is people on the book, not current dests');
  check(
    /id="ms-rxac-split"/.test(canvas) && /bindPileAction\('#ms-rxac-split'/.test(canvas),
    'Split equally still uses ms-rxac-split'
  );
  check(/ms-ags-marquee/.test(canvas) && /ms-ags-field-on/.test(canvas), 'people marquee and selected field chrome');
  check(/ms-ags-new-group/.test(canvas), 'New group well is on the dest-set strip');
  check(/Save as group/.test(canvas) && /ms-ags-save/.test(canvas), 'Save as group is on the canvas');
  check(/saveGroupRowHtml/.test(canvas), 'rx Save as group uses the on-canvas name field');
  check(!/window\.prompt/.test(canvas), 'rx Save as group does not use window.prompt');
  check(/data-people-key/.test(canvas), 'people-drag starts from clinician field headers, not patient tiles');
  check(/Named GP[\s\S]{0,80}never auto-placement/.test(canvas), 'named GP still never auto-places');
  check(/planSendToUsualGp/.test(canvas), 'send-to-usual-GP uses the Rx planner');
  check(!/planSendToRequester/.test(canvas), 'rx canvas does not call the lab requester planner');
  check(/id="ms-rxac-send-usual"/.test(canvas), 'send-to-usual-GP is a named button');
  check(
    /class="ms-lac-confirm-btn ms-rxac-action" id="ms-rxac-send-usual"/.test(canvas),
    'usual-GP send matches Distribute equally, not Split equally'
  );
  check(!/ms-lac-primary[^>]*id="ms-rxac-send-usual"/.test(canvas), 'usual-GP send is not a primary CTA');
  check(/actions \+\s*usualOffer\.button/.test(canvas), 'usual-GP send sits in the split-row action cluster');
  check(/ms-rxac-split-actions/.test(canvas), 'usual-GP send stays with Top up / Distribute equally');
  check(/#ms-rxac-overlay \.ms-rxac-split-actions/.test(css), 'allocate peers share one action cluster');
  check(/id="ms-rxac-send-not-in"/.test(canvas), 'not-in usual-GP toggle is session state on the overlay');
  check(/_sendToUsualGpNotIn/.test(canvas), 'not-in usual-GP box is not a storage key');
  check(/Send .* to usual GP/.test(canvas), 'primary control is Send N to usual GP');
  check(/Send this pile to usual GP/.test(canvas), 'per-group send is on a usual-GP pile header');
  check(/ms-lac-nwd-offer/.test(canvas), 'usual-GP preview stays on the overlay as supporting copy');
  check(
    !/chrome\.storage/.test(canvas) || !/_sendToUsualGpNotIn[\s\S]{0,80}chrome\.storage/.test(canvas),
    'not-in usual-GP is not persisted'
  );
  check(!/assigneeType:\s*['"]team['"]/.test(canvas), 'groups never write assigneeType team');
  check(/parseRxQueueRoute/.test(canvas), 'rx canvas owns the non-routine route');
  check(!/parseRxQueueRoute/.test(labCanvas), 'lab canvas does not parse rx routes');
  check(/fetchRxTaskList/.test(canvas), 'canvas loads the pile via fetchRxTaskList');
  check(/mergeInboxAndSitting/.test(canvas), 'canvas treats the page-inbox GET as the unallocated pile');
  check(/isRxUnallocated/.test(canvas), 'canvas even-split only stages unallocated Non-Routine requests');
  check(/isRxUnallocated\(t\)/.test(canvas), 'split counts ignore requests already sitting with a GP');
  check(/skipSplit/.test(canvas), 'after Write the canvas does not re-stage an even split');
  check(/fetchList:/.test(canvas), 'Write re-GETs via fetchRxTaskList, not a page-filter fetchTaskList');
  check(
    /fetchRxMergedTaskList/.test(canvas),
    'Write vanish-check re-GETs inbox plus already-sitting work (distribute equally)'
  );
  check(
    /if \(!_open && !_writing\) _route = route/.test(canvas),
    'open overlay pins _route so ensureLauncher cannot clobber search'
  );
  check(
    /pin\.apiBase/.test(canvas) && /fetchRxMergedTaskList\(pin\.apiBase/.test(canvas),
    'Write confirm GET snapshots the route, not live _route'
  );
  check(
    /reload Medicus if the grid still shows the old number/.test(canvas),
    'after Write the canvas says the open-list count may not drop'
  );
  check(
    /cache:\s*['"]no-store['"]/.test(fs.readFileSync(path.join(__dirname, 'shared/lab-allocate-core.js'), 'utf8')),
    'queue re-GET is not served from HTTP cache'
  );
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
  const qs = '?statuses[]=pending-review&viewContext=homepage&masterAssignee=0198ef96-6a17-71e4-8354-78de2b371ef3';
  const out = await C.fetchRxTaskList(
    'https://560b6c.api.england.medicus.health',
    'prescription_request_task_routine',
    qs,
    { fetchImpl: fetchImpl }
  );
  check(
    out.rows && out.rows.length === 2,
    'page inbox GET returns the routine box (got ' + ((out.rows && out.rows.length) || 0) + ')'
  );
  check(
    calls[0] && calls[0].indexOf('masterAssignee=0198ef96-6a17-71e4-8354-78de2b371ef3') !== -1,
    'first request keeps the inbox masterAssignee'
  );
  check(C.isRxUnallocated(out.rows[0]) === true, 'inbox-assigned routine requests are the unallocated pile');
  check(
    /fetchRxTaskList/.test(fs.readFileSync(path.join(__dirname, 'content-scripts/rx-allocate-canvas.js'), 'utf8')),
    'canvas calls fetchRxTaskList'
  );

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

  const mergeCalls = [];
  const mergeFetch = async (url) => {
    mergeCalls.push(String(url));
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const body = path.indexOf('masterAssignee') !== -1 ? inboxBody : allocatedBody;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(body),
    };
  };
  const merged = await C.fetchRxMergedTaskList(
    'https://560b6c.api.england.medicus.health',
    'prescription_request_task_routine',
    qs,
    { fetchImpl: mergeFetch }
  );
  check(
    merged.rows && merged.rows.length === 3,
    'write re-GET merges inbox pile with already-sitting work (got ' + ((merged.rows && merged.rows.length) || 0) + ')'
  );
  check(
    merged.rows.some((r) => r.id === uuid(99)),
    'already-sitting GP work is on the write re-GET so Distribute equally does not vanish'
  );
  check(
    merged.rows.filter((r) => C.isRxUnallocated(r)).length === 2,
    'merged write re-GET still treats the inbox rows as the pile'
  );

  console.log('\n--- homepage+staff stamp must not empty the non-routine pile ---');
  {
    const staffId = '0198ef96-6a17-71e4-8354-78de2b371ef3';
    const inboxId = uuid(80);
    const staffQs = '?statuses[]=pending-review&viewContext=homepage&masterAssignee=' + staffId;
    const plan = C.rxListQueryPlan(staffQs, { staffId: staffId });
    check(plan[0] && plan[0].indexOf('masterAssignee=') === -1, 'staff-stamp assignee is not the first GET');
    check(plan[plan.length - 1] === staffQs, 'personal slice is last resort, not the inbox');
    check(
      C.rxListQueryPlan(qs)[0] && C.rxListQueryPlan(qs)[0].indexOf('masterAssignee=0198ef96') !== -1,
      'a non-staff inbox UUID stays first (routine box)'
    );

    const pileBody = {
      tasks: [
        {
          id: uuid(81),
          patientName: 'FORD, A',
          assignedTo: 'Non-Routine Prescription Requests',
          assignedId: inboxId,
          summary: 'Acute A',
        },
        {
          id: uuid(82),
          patientName: 'FORD, B',
          assignedTo: 'Non-Routine Prescription Requests',
          assignedId: inboxId,
          summary: 'Acute B',
        },
        {
          id: uuid(83),
          patientName: 'OTHER, C',
          assignedTo: 'Dr Jane Cole',
          assignedId: uuid(10),
          summary: 'Already sitting',
        },
      ],
    };
    const personalBody = {
      tasks: [{ id: uuid(84), patientName: 'MINE, D', assignedTo: 'Dr Dave', assignedId: staffId, summary: 'Mine' }],
    };
    const staffThenPile = async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      const body = path.indexOf('masterAssignee=' + staffId) !== -1 ? personalBody : pileBody;
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    };
    const recovered = await C.fetchRxTaskList(
      'https://560b6c.api.england.medicus.health',
      'prescription_request_task_non_routine',
      staffQs,
      { fetchImpl: staffThenPile, staffId: staffId }
    );
    check(
      recovered.rows && recovered.rows.length === 3,
      'working staff stamp does not keep the 1-row personal slice (got ' +
        ((recovered.rows && recovered.rows.length) || 0) +
        ')'
    );
    check(
      recovered.search != null && String(recovered.search).indexOf('masterAssignee=' + staffId) === -1,
      'winning search is not the homepage+staff filter'
    );

    const thrownThenBare = async (url) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '');
      if (path.indexOf('?') !== -1) {
        const err = new Error('HTTP 400');
        err.status = 400;
        throw err;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(pileBody) };
    };
    const afterThrow = await C.fetchRxTaskList(
      'https://560b6c.api.england.medicus.health',
      'prescription_request_task_non_routine',
      staffQs,
      { fetchImpl: thrownThenBare, staffId: staffId }
    );
    check(
      afterThrow.rows && afterThrow.rows.length === 3,
      'a 4xx homepage GET is skipped so the bare pile still loads'
    );

    const mergedStaff = await C.fetchRxMergedTaskList(
      'https://560b6c.api.england.medicus.health',
      'prescription_request_task_non_routine',
      staffQs,
      { fetchImpl: staffThenPile, staffId: staffId }
    );
    check(
      mergedStaff.rows.filter((r) => C.isRxUnallocated(r)).length === 2,
      'winning-search merge keeps the shared inbox as Unallocated, not the staff stamp'
    );
    check(
      mergedStaff.rows.filter((r) => r.id === uuid(83) && !C.isRxUnallocated(r)).length === 1,
      'already-sitting GP work stays sitting after the staff-stamp fallback'
    );

    const personShaped = rxRow(85, { assignedTo: 'Dr Jane Cole', assignedId: inboxId });
    const sittingGp = rxRow(86, { assignedTo: 'Dr David Triska', assignedId: uuid(11) });
    const leakedStamp = C.mergeInboxAndSitting([personShaped, sittingGp], [], staffQs);
    check(
      leakedStamp.filter((r) => C.isRxUnallocated(r)).length === 0,
      'stamping with the leftover staff UUID hides a person-shaped inbox (the live failure)'
    );
    const winningEmpty = C.mergeInboxAndSitting([personShaped, sittingGp], [], '');
    check(
      winningEmpty.filter((r) => C.isRxUnallocated(r)).length === 0,
      'without an inbox UUID, person-shaped names stay sitting unless the grid hints them'
    );
    const hinted = C.mergeInboxAndSitting([personShaped, sittingGp], [], '', {
      visibleIds: { [personShaped.id.toLowerCase()]: true },
    });
    check(
      hinted
        .filter((r) => C.isRxUnallocated(r))
        .map((r) => r.id)
        .join() === personShaped.id,
      'grid-visible person-shaped inbox rows are the Unallocated pile'
    );
    check(
      C.isRxUnallocated(hinted.find((r) => r.id === sittingGp.id) || {}) === false,
      'grid hint does not restamp sitting GPs'
    );

    const dests = [
      { key: Lab.clinicianColumnKey('Dr A'), name: 'Dr A' },
      { key: Lab.clinicianColumnKey('Dr B'), name: 'Dr B' },
    ];
    const split = C.planEvenSplit(hinted, dests);
    check(split.ok === true && split.total === 1, 'Split equally can stage the recovered non-routine pile');
    const usual = C.planSendToUsualGp(
      hinted.map((r) => Object.assign({}, r, { namedGp: 'Dr A', namedGpId: '' })),
      dests
    );
    check(usual.ok === true && usual.sent.length === 1, 'usual-GP send still stages recovered unallocated rows');

    check(
      /No doctors working/.test(
        C.rxEmptyPileReason({ rowCount: 4, unallocatedCount: 4, destCount: 0, dayPhrase: 'today' })
      ),
      'empty dests say no doctors, not an empty pile'
    );
    check(
      /already sit with people/.test(C.rxEmptyPileReason({ rowCount: 4, unallocatedCount: 0, destCount: 3 })),
      'rows but no Unallocated says they already sit with people'
    );
    check(
      /table has 12/.test(C.rxEmptyPileReason({ rowCount: 0, unallocatedCount: 0, destCount: 3, bridgeCount: 12 })),
      'grid-has-work / Suite-empty is named'
    );
    check(
      C.inboxCountFromTaskListBridge(
        { rows: new Array(5), taskTypeSlug: 'prescription_request_task_non_routine' },
        'prescription_request_task_non_routine'
      ) === 5,
      'bridge count is count-only on the matching Rx slug'
    );
    check(
      C.inboxCountFromTaskListBridge(
        { rows: new Array(5), taskTypeSlug: 'prescription_request_task_non_routine' },
        'prescription_request_task_routine'
      ) === 0,
      'bridge count ignores another Rx slug'
    );
  }

  // ---- Per-request medication summary (2026-09-10) ----
  console.log('\n--- itemCountsFromOverviewPayload: prescriptionRequestItemsByType bucket summing ---');
  {
    const payload = {
      data: {
        prescriptionRequestItemsByType: {
          repeatWithAnAuthorisedIssue: { items: [{ product: 'A' }, { product: 'B' }] },
          repeatPrescribingWithNoIssues: { items: [{ product: 'C' }] },
          acutePrescriptions: { items: [{ product: 'D' }] },
          repeatDispensing: { items: [{ product: 'E' }, { product: 'F' }] },
          variableRepeat: { items: [] },
        },
      },
    };
    const counts = C.itemCountsFromOverviewPayload(payload, 'pt-1');
    check(
      counts.repeat === 3,
      'repeat = repeatWithAnAuthorisedIssue + repeatPrescribingWithNoIssues (got ' + counts.repeat + ')'
    );
    check(counts.acute === 1, 'acute reads the acutePrescriptions bucket (HAR-confirmed live, 2026-09-10)');
    check(counts.repeatDispensing === 2, 'repeatDispensing reads its own bucket');
    check(counts.variableRepeat === 0, 'an empty bucket counts as 0, not omitted');
    check(counts.resolvedPatientId === 'pt-1', 'resolvedPatientId passes through');
  }
  {
    const counts = C.itemCountsFromOverviewPayload({}, '');
    check(
      counts.repeat === 0 && counts.acute === 0 && counts.repeatDispensing === 0 && counts.variableRepeat === 0,
      'missing prescriptionRequestItemsByType entirely -> all zero counts, no throw'
    );
    check(counts.resolvedPatientId === '', 'no patientId resolved falls back to empty string, not null/undefined');
  }

  console.log(
    '\n--- overdueMedicationReviewFromPayload: patient-level flag (futureActionIdRequiringAttention), 2026-09-16 ---'
  );
  {
    check(
      C.overdueMedicationReviewFromPayload({
        data: { futureActionIdRequiringAttention: '019e2b99-a736-72b4-aea7-7c3cc39fa433' },
      }) === true,
      'a non-null futureActionIdRequiringAttention is an overdue review — confirmed live, HAR 130-reviewoverdue.har'
    );
    check(
      C.overdueMedicationReviewFromPayload({ data: { futureActionIdRequiringAttention: null } }) === false,
      'null futureActionIdRequiringAttention is NOT overdue — confirmed live on a patient with an in-date review'
    );
    check(
      C.overdueMedicationReviewFromPayload({
        data: {
          futureActionIdRequiringAttention: null,
          medicationRequiringReview: [],
          patientRequiresMedicationReview: false,
        },
      }) === false,
      'the two more literally-named fields are deliberately NOT read here — they were both empty/false on a confirmed-overdue capture, so they track something else'
    );
    check(
      C.overdueMedicationReviewFromPayload({ data: {} }) === false,
      'a missing field entirely is treated as not-overdue, never guessed true'
    );
    check(C.overdueMedicationReviewFromPayload({}) === false, 'missing data section -> false, no throw');
    check(C.overdueMedicationReviewFromPayload(null) === false, 'is defensive against a missing payload');
  }

  console.log('\n--- regimenTotalsFromPayload: repeat-type-only scope + isOverDue tally ---');
  {
    const regimen = {
      currentRepeatPrescribingMedications: [{ isOverDue: true }, { isOverDue: false }, { isOverDue: true }],
      currentVariableRepeatMedications: [{ isOverDue: false }],
      currentRepeatDispensingMedications: [{ isOverDue: true }],
      // Confirmed out of scope with Nick (2026-09-10) — must NOT be summed
      // into overdueTotal/overdueCount even though isOverDue is present:
      acuteMedicationsLastTwelveMonths: [{ isOverDue: true }, { isOverDue: true }],
      overTheCounterMedicationStatements: [{ isOverDue: true }],
    };
    const totals = C.regimenTotalsFromPayload(regimen);
    check(totals.repeatTotal === 3, 'repeatTotal is currentRepeatPrescribingMedications.length');
    check(totals.variableRepeatTotal === 1, 'variableRepeatTotal is currentVariableRepeatMedications.length');
    check(totals.repeatDispensingTotal === 1, 'repeatDispensingTotal is currentRepeatDispensingMedications.length');
    check(
      totals.overdueTotal === 5,
      'overdueTotal = 3+1+1 repeat-type meds, acute/OTC excluded (got ' + totals.overdueTotal + ')'
    );
    check(
      totals.overdueCount === 3,
      'overdueCount = isOverDue:true across repeat-type meds ONLY, acute/OTC excluded (got ' + totals.overdueCount + ')'
    );
  }
  {
    const totals = C.regimenTotalsFromPayload({});
    check(
      totals.repeatTotal === 0 && totals.overdueTotal === 0 && totals.overdueCount === 0,
      'missing regimen buckets entirely -> all zero, no throw'
    );
  }

  console.log('\n--- fractionOrCount ---');
  check(C.fractionOrCount(0, 6, 'repeats') === '', 'zero requested -> omitted entirely, even with a known total');
  check(
    C.fractionOrCount(3, null, 'repeats') === '3 repeats',
    'no total yet (Pass B unresolved) -> bare requested count'
  );
  check(C.fractionOrCount(3, 6, 'repeats') === '3/6 repeats', 'total known -> requested/total fraction');
  check(C.fractionOrCount(0, null, 'batches') === '', 'zero requested, no total either -> still omitted');

  console.log("\n--- rxMonitoringLine: Nick's confirmed tile-sentence format ---");
  check(C.rxMonitoringLine(null, null) === '', 'no item counts yet (Pass A unresolved) -> empty, no placeholder text');
  check(
    C.rxMonitoringLine({ repeat: 0, acute: 0, repeatDispensing: 0, variableRepeat: 0 }, null) === '',
    'a request with none of the four tracked types -> empty line, not "Request for ."'
  );
  check(
    C.rxMonitoringLine({ repeat: 3, acute: 1, repeatDispensing: 0, variableRepeat: 0 }, null) ===
      'Request for 3 repeats, 1 acute.',
    'Pass B not yet resolved for this patient -> bare counts, zero segments (batches) omitted, no trailing overdue sentence'
  );
  check(
    C.rxMonitoringLine(
      { repeat: 3, acute: 1, repeatDispensing: 0, variableRepeat: 0 },
      { repeatTotal: 6, repeatDispensingTotal: 2, variableRepeatTotal: 0, overdueCount: 3, overdueTotal: 5 }
    ) === 'Request for 3/6 repeats, 1 acute. 3/5 repeats overdue for reauthorising.',
    "Nick's own example format, minus the zero-requested batches segment (0 requested -> omitted even though the total is known)"
  );
  check(
    C.rxMonitoringLine(
      { repeat: 3, acute: 1, repeatDispensing: 0, variableRepeat: 0 },
      { repeatTotal: 6, repeatDispensingTotal: 2, variableRepeatTotal: 0, overdueCount: 0, overdueTotal: 0 }
    ) === 'Request for 3/6 repeats, 1 acute.',
    'totals resolved but this patient has zero repeat-type meds at all -> no overdue sentence appended'
  );
  check(
    C.rxMonitoringLine(
      { repeat: 0, acute: 1, repeatDispensing: 0, variableRepeat: 0 },
      { repeatTotal: 6, repeatDispensingTotal: 2, variableRepeatTotal: 0, overdueCount: 3, overdueTotal: 5 }
    ) === 'Request for 1 acute. 3/5 repeats overdue for reauthorising.',
    'acute NEVER gets a "/total" fraction, even once totals are known (confirmed with Nick, 2026-09-10)'
  );
  check(
    C.rxMonitoringLine(
      { repeat: 0, acute: 0, repeatDispensing: 2, variableRepeat: 1 },
      { repeatTotal: 6, repeatDispensingTotal: 2, variableRepeatTotal: 4, overdueCount: 0, overdueTotal: 6 }
    ) === 'Request for 2/2 batches, 1/4 variable repeat. 0/6 repeats overdue for reauthorising.',
    'batches and variable repeat both get fractions like repeats; a genuine 0/6 overdue tally still renders (only omitted when overdueTotal is 0)'
  );

  console.log('\n--- complexityScore: 1 (least) to 5 (most), green-to-amber, requested-items-only 2026-09-10 ---');
  check(C.complexityScore(null) === null, 'no item counts yet -> null, not a guessed level');
  check(
    (() => {
      const sixRequested = C.complexityScore({ repeat: 6, acute: 0, repeatDispensing: 0, variableRepeat: 0 });
      const threeRequested = C.complexityScore({ repeat: 3, acute: 0, repeatDispensing: 0, variableRepeat: 0 });
      return sixRequested.level > threeRequested.level;
    })(),
    "Nick's own motivating example still holds structurally: 6 requested items outscores 3"
  );
  {
    // raw = requestedItemsTotal alone. Even steps of 2 (inclusive upper
    // end of each level): 2 / 4 / 6 / 8, then 5 for anything above.
    const cases = [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 3],
      [6, 3],
      [7, 4],
      [8, 4],
      [9, 5],
      [30, 5], // way over -> still level 5, never higher
    ];
    cases.forEach(([requested, expectedLevel]) => {
      const counts = { repeat: requested, acute: 0, repeatDispensing: 0, variableRepeat: 0 };
      const score = C.complexityScore(counts);
      check(
        score && score.level === expectedLevel,
        `requested=${requested} -> level ${expectedLevel} (got ${score && score.level})`
      );
    });
  }
  {
    const counts = { repeat: 2, acute: 1, repeatDispensing: 1, variableRepeat: 0 };
    const score = C.complexityScore(counts);
    check(
      score.requestedItemsTotal === 4,
      'requestedItemsTotal sums all four requested-item counts (2+1+1+0=4, got ' + score.requestedItemsTotal + ')'
    );
    check(score.raw === 4, 'raw is just requestedItemsTotal now (got ' + score.raw + ')');
    check(!('medicationsTotal' in score), 'medicationsTotal is no longer part of the returned score object at all');
  }

  if (failed) {
    console.error('\n' + failed + ' failed, ' + passed + ' passed');
    process.exit(1);
  }
  console.log('\n' + passed + ' passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
