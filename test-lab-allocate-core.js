// Medicus Suite — lab-allocate-core tests
// Run with: node test-lab-allocate-core.js
'use strict';

const C = require('./shared/lab-allocate-core.js');

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

console.log('--- parseResultsQueueRoute ---');
{
  const r = C.parseResultsQueueRoute('/e38a9f/tasks/review-investigation-report/task-list');
  check(!!r && r.siteId === 'e38a9f', 'results queue siteId');
  check(r && r.slug === 'review-investigation-report', 'results queue slug');
  check(r && r.apiBase === 'https://e38a9f.api.england.medicus.health', 'apiBase from siteId');
  check(
    !!C.parseResultsQueueRoute('/e38a9f/tasks/data/review_investigation_report/task-list'),
    'also matches /tasks/data/{slug}/task-list'
  );
  check(
    C.parseResultsQueueRoute('/e38a9f/tasks/medical_patient_request_task/task-list') === null,
    'request queue is not a results queue'
  );
  check(
    C.parseResultsQueueRoute('/e38a9f/scheduling/appointment-book') === null,
    'appointment book is not a results queue'
  );
  check(C.isResultsQueueSlug('review-investigation-report') === true, 'investigation slug matches');
  check(C.isResultsQueueSlug('medical_patient_request_task') === false, 'request slug does not match');
  const withQs = C.parseResultsQueueRoute(
    '/560b6c/tasks/review_investigation_results_task/task-list',
    '?viewContext=workflow&masterAssignee=abc'
  );
  check(withQs && withQs.search === '?viewContext=workflow', 'keeps viewContext and drops masterAssignee');
  check(C.queryStringForList('https://evil.example/?x=1') === '', 'rejects a query that looks like a URL');
  check(C.sanitizeSlug('../x') === '', 'rejects a path-like slug');
}

console.log('\n--- extractTaskArray / pickTaskId ---');
{
  check(C.extractTaskArray({ tasks: [{ id: uuid(1) }] }).length === 1, 'tasks envelope');
  check(C.extractTaskArray({ data: { tasks: [{ id: uuid(2) }] } }).length === 1, 'data.tasks envelope');
  check(C.extractTaskArray({ data: [{ id: uuid(3) }] }).length === 1, 'data array envelope');
  check(C.extractTaskArray({ items: [{ id: uuid(8) }] }).length === 1, 'items envelope');
  check(C.extractTaskArray({ taskList: { tasks: [{ id: uuid(9) }] } }).length === 1, 'taskList.tasks envelope');
  check(C.pickTaskId({ taskUuid: uuid(4) }) === uuid(4), 'prefers taskUuid');
  check(C.pickTaskId({ id: 'not-a-uuid' }) === '', 'rejects non-uuid id');
}

console.log('\n--- parseRequestLabel (OIR card shape) ---');
{
  const p = C.parseRequestLabel('Full Lipid Profile (Dr David Triska • 09 Jun 2026, 13:31)');
  check(p.name === 'Full Lipid Profile', 'panel name');
  check(p.requester === 'Dr David Triska', 'requester from OIR label');
  check(p.requestedDate === '2026-06-09', 'requested date');
}

console.log('\n--- pickRequesterFromOverview ---');
{
  check(C.pickRequesterFromOverview(null) === null, 'null payload');
  check(C.pickRequesterFromOverview({ data: { investigationReport: { groups: [] } } }) === null, 'no requester field');
  const byField = C.pickRequesterFromOverview({
    data: { investigationReport: { requestedBy: 'Dr Jane Cole', results: [{ resultValue: '12.3' }] } },
  });
  check(byField && byField.name === 'Dr Jane Cole', 'requestedBy string on the report');
  check(byField && byField.confidence === 'requester', 'confidence is requester, not named-gp');
  const byObj = C.pickRequesterFromOverview({
    data: { requestedBy: { displayName: 'Dr Sam Reed' } },
  });
  check(byObj && byObj.name === 'Dr Sam Reed', 'requestedBy object.displayName');
  const byLabel = C.pickRequesterFromOverview({
    data: { outstanding: ['Full Lipid Profile (Dr David Triska • 09 Jun 2026, 13:31)'] },
  });
  check(byLabel && byLabel.name === 'Dr David Triska', 'OIR-style label inside an array');
  const namedOnly = C.pickRequesterFromOverview({
    data: { namedGp: 'Dr Registered GP', investigationReport: {} },
  });
  check(namedOnly === null, 'namedGp is never treated as who ordered');
  const orgReq = C.pickRequesterFromOverview({
    data: {
      investigationReport: {
        requester: {
          organisationName: 'Some Lab',
          organisationOdsCode: 'ABC',
          departmentName: 'Haem',
          practitionerName: 'Lab Person',
        },
        requesterComments: 'Bloating, tiredness',
      },
    },
  });
  check(orgReq === null, 'lab/org requester object is not who ordered');
  const fromRow = C.pickRequesterFromTaskRow({
    requestedBy: 'TRISKA D',
    namedGp: 'Dr Registered GP',
    assignedTo: 'Investigation Reports',
  });
  check(fromRow && fromRow.name === 'TRISKA D', 'task-list requestedBy is who ordered');
  check(
    C.pickRequesterFromTaskRow({ namedGp: 'Dr Registered GP' }) === null,
    'namedGp on the row is still not who ordered'
  );
  const fromNorm = C.normaliseTaskRow(
    {
      id: uuid(11),
      patientName: 'FORD, Michael',
      assignedTo: 'Investigation Reports',
      namedGp: 'Dr David Triska',
      requestedBy: 'TRISKA D',
      summary: 'Serum TSH level',
    },
    'review-investigation-report'
  );
  check(fromNorm && fromNorm.requester === 'TRISKA D', 'normaliseTaskRow reads Requested By off the task-list row');
  check(fromNorm.namedGp === 'Dr David Triska', 'named GP stays a separate caption');
  const fromInv = C.normaliseTaskRow(
    {
      id: uuid(12),
      patientName: 'LEE, Pat',
      investigations: 'TISSUE TRANSGLUTAMINASE IGA ANTIBOD, PROTEIN ELECTROPHORESIS',
      requestedBy: 'AZADIAN N',
    },
    'review_investigation_results_task'
  );
  check(/TRANSGLUTAMINASE/.test(fromInv.summary), 'task-list investigations become the row summary');
}

console.log('\n--- normaliseTaskRow / team vs person assignee ---');
{
  const person = C.normaliseTaskRow(
    {
      id: uuid(1),
      patientName: 'SMITH, Jane',
      summary: 'FBC',
      assignedTo: 'Dr Jane Cole',
      assignedId: uuid(9),
      namedGp: 'Dr Registered GP',
      status: 'new',
      statusText: 'New',
      overviewURL: '/tasks/data/review-investigation-report/overview/' + uuid(1),
    },
    'review-investigation-report'
  );
  check(person && person.patientName === 'SMITH, Jane', 'patient name clipped through');
  check(C.isTeamAssignee('Results inbox') === true, 'Results inbox is a team');
  check(C.isTeamAssignee('Triage Doctor') === true, 'Triage Doctor is a team-like inbox');
  check(C.isTeamAssignee('Investigation Reports') === true, 'Investigation Reports is the results inbox, not a person');
  check(C.isTeamAssignee('Dr Jane Cole') === false, 'a named doctor is not a team');
  check(
    C.homeColumnKey(person) === C.clinicianColumnKey('Dr Jane Cole'),
    'person assignee homes to that clinician field'
  );
  check(C.placementReason(person) === 'current-assignee', 'no requester → current-assignee, not who-ordered');

  const inbox = C.normaliseTaskRow(
    { id: uuid(2), patientName: 'PATEL, Ali', assignedTo: 'Results', namedGp: 'Dr Registered GP' },
    'review-investigation-report'
  );
  check(C.homeColumnKey(inbox) === C.POOL, 'team assignee stays in the unallocated reports pool');
  check(C.placementReason(inbox) === 'inbox', 'inbox reason is still recorded');
  check(inbox.namedGp === 'Dr Registered GP', 'named GP kept as a hint only');
  const objAssigned = C.normaliseTaskRow(
    {
      id: uuid(15),
      patientName: 'A',
      assignedTo: { type: 'staff', id: uuid(9), name: 'Dr David Triska' },
      summary: 'FBC',
    },
    'x'
  );
  check(objAssigned.assignedTo === 'Dr David Triska', 'object assignedTo yields the person name');
  check(
    C.homeColumnKey(objAssigned) === C.clinicianColumnKey('Dr David Triska'),
    'object staff assignee sits on that clinician field'
  );
  check(objAssigned.assignedId === uuid(9), 'object assignedTo still keeps the staff UUID');
}

console.log('\n--- requester placement never uses named GP ---');
{
  const row = C.normaliseTaskRow(
    { id: uuid(3), patientName: 'LEE, Pat', assignedTo: 'Results', namedGp: 'Dr Registered GP' },
    'review-investigation-report'
  );
  C.applyRequester(row, { name: 'Dr David Triska', source: 'requestedBy', confidence: 'requester' });
  check(C.homeColumnKey(row) === C.POOL, 'requester stays in the unallocated pool — not auto-placed onto a field');
  check(C.placementReason(row) === 'requester', 'reason is requester');
  check(C.sameClinician('Dr David Triska', 'David Triska') === true, 'title-stripped name match');
}

console.log('\n--- board + draft moves ---');
{
  const a = C.applyRequester(
    C.normaliseTaskRow({ id: uuid(1), patientName: 'A', assignedTo: 'Results', summary: 'FBC' }, 'x'),
    { name: 'Dr Cole', source: 'requestedBy', confidence: 'requester' }
  );
  const b = C.normaliseTaskRow({ id: uuid(2), patientName: 'B', assignedTo: 'Results', summary: 'U&E' }, 'x');
  const board0 = C.buildWorkspace([a, b], C.emptyDraft());
  check(board0.pool && board0.pool.title === 'Investigation reports', 'pool is the investigation-reports pile');
  check(board0.pool.tiles.length === 2, 'inbox requester and unknown both stay unallocated until staged');
  check(
    board0.pool.groups[0] && board0.pool.groups[0].requester === 'Dr Cole' && board0.pool.groups[0].count === 1,
    'unallocated pool groups by who requested'
  );
  check(
    board0.clinicians.some((c) => c.title === 'Dr Cole' && c.count === 0),
    'requester appears as an empty clinician field'
  );
  check(!board0.clinicians.some((c) => c.title === 'Results'), 'the shared inbox is not a clinician field');

  let draft = C.addColumn(C.emptyDraft(), 'Dr Reed');
  draft = C.stageMove(draft, b.id, C.clinicianColumnKey('Dr Reed'));
  const board1 = C.buildWorkspace([a, b], draft);
  const reed = board1.clinicians.find((c) => c.title === 'Dr Reed');
  check(reed && reed.tiles.length === 1 && reed.tiles[0].staged === true, 'drag stages onto a clinician field');
  check(reed.stagedCount === 1, 'field counts what is staged onto it');
  check(
    board1.pool.tiles.length === 1 && board1.pool.tiles[0].patientName === 'A',
    'unstaged requester group stays in the unallocated pool'
  );
  const sum = C.draftSummary([a, b], draft);
  check(sum.count === 1 && sum.items[0].toTitle === 'Dr Reed', 'draft summary names the destination');
  check(sum.items[0].text.indexOf('B → Dr Reed') === 0, 'summary text is patient → clinician');
}

console.log('\n--- copy list is honest ---');
{
  const row = C.normaliseTaskRow(
    { id: uuid(1), patientName: 'SMITH, Jane', assignedTo: 'Results', namedGp: 'Dr GP', summary: 'FBC' },
    'x'
  );
  const text = C.copyList(C.buildBoard([row], C.emptyDraft()));
  check(/^Investigation reports \(1\)/.test(text), 'copy list leads with the reports pool');
  check(/Not written to Medicus/.test(text), 'copy list refuses to claim a write');
  check(/registered GP/.test(text), 'named GP is labelled as registered GP, not requester');
  check(!/\b(Done|Sent|Allocated|Submitted|Booked)\b/.test(text), 'no completion verbs');
}

console.log('\n--- write contract is the captured bulk-reassign ---');
{
  const closed = C.canWriteAllocations();
  check(closed.ok === false, 'canWriteAllocations is false without the queue token');
  check(/queue token/.test(closed.reason), 'reason names the missing task-list token');
  check(
    C.canWriteAllocations({ taskList: 'review_investigation_results_task' }).ok === true,
    'token unlocks the write'
  );
  check(C.canWriteAllocations({ taskList: '' }).ok === false, 'empty string is not a token');
  check(C.canWriteAllocations({ taskList: {} }).ok === false, 'empty object is not a token');
  check(
    C.canWriteAllocations({ taskList: {}, slug: 'review_investigation_results_task' }).ok === true,
    'queue slug unlocks the write when the envelope token is not a string'
  );
  check(
    C.extractTaskListToken({ data: { taskList: 'nested-token' } }) === 'nested-token',
    'taskList token may sit on data.taskList'
  );
  check(
    C.coerceTaskListToken({ slug: 'review_investigation_results_task' }) === 'review_investigation_results_task',
    'object token yields its slug string, not the object'
  );
  check(
    C.coerceTaskListToken({}, 'review_investigation_results_task') === 'review_investigation_results_task',
    'missing token falls back to the URL slug'
  );
  const src = require('fs').readFileSync(require('path').join(__dirname, 'shared/lab-allocate-core.js'), 'utf8');
  check(/method:\s*['"]POST['"]/.test(src), 'core POSTs the captured bulk-reassign');
  check(src.indexOf('/tasks/task-list/bulk-reassign') !== -1, 'captured literal path is still the 404 fallback');
  check(
    C.bulkReassignPaths('review_investigation_results_task')[0] ===
      '/tasks/review_investigation_results_task/task-list/bulk-reassign',
    'first POST path nests the queue slug'
  );
  check(
    C.bulkReassignPaths('review_investigation_results_task')[1] === '/tasks/task-list/bulk-reassign',
    'second POST path is the captured literal'
  );
  check(!/method:\s*['"]PUT['"]/.test(src), 'core has no PUT');
  check(!/method:\s*['"]PATCH['"]/.test(src), 'core has no PATCH');
  check(!/change-absence/.test(src), 'core never mentions change-absence');
  check(!/calendar-resources/.test(src), 'core never mentions calendar-resources');
  const body = C.buildBulkReassignBody(uuid(9), 'token-from-envelope', [uuid(1), uuid(2)]);
  check(body.assigneeType === 'staff', 'assigneeType is the sibling-confirmed staff value');
  check(body.taskList === 'token-from-envelope', 'taskList is passed through, not invented');
  check(body.taskIds.length === 2 && body.assigneeId === uuid(9), 'taskIds and assigneeId are the captured keys');
  check(
    Object.keys(body).join(',') === 'assigneeId,assigneeType,taskList,taskIds',
    'body has exactly the four captured keys'
  );
  check(C.buildBulkReassignBody('not-a-uuid', 'token', [uuid(1)]) === null, 'refuses a non-uuid assignee');
  check(C.buildBulkReassignBody(uuid(9), '', [uuid(1)]) === null, 'refuses a missing taskList token');
  check(
    C.buildBulkReassignBody(uuid(9), {}, [uuid(1)], 'review_investigation_results_task').taskList ===
      'review_investigation_results_task',
    'object token is not posted — the URL slug is'
  );
}

console.log('\n--- canvas + manifest source locks ---');
{
  const fs = require('fs');
  const path = require('path');
  const canvas = fs.readFileSync(path.join(__dirname, 'content-scripts/lab-allocate-canvas.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  check(manifest.indexOf('shared/lab-allocate-core.js') !== -1, 'core is in the manifest');
  check(manifest.indexOf('content-scripts/lab-allocate-canvas.js') !== -1, 'canvas is in the manifest');
  check(manifest.indexOf('content-scripts/lab-allocate-canvas.css') !== -1, 'canvas CSS is in the manifest');
  check(!/method:\s*['"]POST['"]/.test(canvas), 'canvas has no POST — the core client writes');
  check(/commitAllocations/.test(canvas), 'canvas commits through the core client');
  check(/_confirmWrite/.test(canvas), 'write goes through a named patient → clinician confirm');
  check(/Keep planning/.test(canvas), 'confirm defaults the clinician back to planning');
  // A part-written batch leaves the board claiming work Medicus already took.
  // The failure path must re-read before it tells anyone to check the queue.
  check(
    /result\.written > 0[\s\S]{0,200}?await loadBoard\(\)/.test(canvas),
    'a partly-written batch re-reads the queue instead of leaving stale staged tiles'
  );
  check(
    /await loadBoard\(\);\s*_error = failReason;/.test(canvas),
    'the partial-write reason survives that reload — loadBoard clears _error'
  );
  check(!/\.click\(\)/.test(canvas), 'canvas does not synthesise Medicus clicks');
  check(!/Write to Medicus — not available/.test(canvas), 'Finalise is no longer hard-disabled');
  check(!/\b(Done|Sent|Booked|Submitted|Allocated)\b/.test(canvas), 'canvas copy has no completion verbs');
  check(/not confirmed as the requester/.test(canvas), 'named GP caption refuses to claim who ordered');
  check(/Absence check before staging/.test(canvas), 'clinician drop always offers an absence check');
  check(/loadRotaAbsences/.test(canvas), 'canvas reads rota.leave before allocation');
  check(/fetchTodayBook/.test(canvas), 'canvas reads today’s appointment book');
  check(/fetchStaffScheduleAbsences/.test(canvas), 'canvas may parse GET staff-schedule for absences');
  check(!/change-absence/.test(canvas), 'canvas never calls change-absence');
  check(!/calendar-resources/.test(canvas), 'canvas never calls calendar-resources');
  check(/In today/.test(canvas), 'chips can show In today from the appointment book');
  check(
    /ms-lac-pool/.test(canvas) && /ms-lac-field/.test(canvas) && /ms-lac-chip/.test(canvas),
    'canvas is an unallocated pool plus clinician fields'
  );
  check(/Unallocated reports/.test(canvas), 'the large box is labelled Unallocated reports');
  check(/harvestStaffFromOverviews/.test(canvas), 'staff UUIDs are harvested even when requester is already known');
  check(/fetchAssigneeStaff/.test(canvas), 'staff directory falls back to the create-task assignee list');
  check(!/list\.length >= 8/.test(canvas), 'overview harvest does not stop at eight staff ids');
  check(/fetchTaskList\(_route\.slug, _route\.search\)/.test(canvas), 'task-list GET uses the page query (minus masterAssignee)');
  check(/search: _route && _route\.search/.test(canvas), 'write re-GET keeps the page filters');
  check(/sortClinicianFields/.test(canvas), 'In today clinicians are sorted to the top of the rail');
  check(/scrollNearEdge/.test(canvas), 'the rail scrolls while a drag is held over it');
  check(/Why this will not write/.test(canvas), 'a blocked write is a visible action, not a dead button');
  check(/writeBlockReason/.test(canvas), 'blocked write uses the shared refuse copy, not plan.reason');
  check(
    /requestStage\(ids, key, btn\.closest/.test(canvas),
    'clicking a field stages the active selection — no drag needed'
  );
  check(/tabindex="0"/.test(canvas), 'tiles and group heads are keyboard focusable');
  check(/aria-selected/.test(canvas), 'selection state is exposed to assistive tech');
  check(/ms-lac-selectbar/.test(canvas), 'an active selection shows a visible count bar');
  check(/Select all/.test(canvas), 'group headers name their select-all affordance');
  check(/ms-lac-group-pick/.test(canvas), 'each requester group has an explicit add-to-selection control');
  check(/Select all sitting/.test(canvas), 'a clinician field can select every report sitting with them');
  check(/toggleGroupInSelection/.test(canvas), 'clinician groups can be added to the selection');
  check(/dropTargetShowsHover/.test(canvas), 'pool is not shaded when dragging a group out of it');
  check(/ms-lac-lifting/.test(canvas), 'lifting a group marks the overlay, not the whole well as a drop');
  check(/_dragOriginKind/.test(canvas), 'drag origin is tracked so the pile is not a drop target for itself');
  check(/harvestTeamDirectory/.test(canvas), 'teams are harvested as drop targets');
  check(/ms-lac-rail-teams/.test(canvas), 'the rail has a Teams section');
  check(/data-col-kind/.test(canvas), 'drop targets declare pool, clinician or team');
  check(/_confirmClose/.test(canvas), 'closing with staged moves asks before discarding');
  check(!/do not invent a slug/.test(canvas), 'footer no longer shows developer jargon');
  check(
    !/on the payload|Reassign-task endpoint has not been captured live/.test(canvas),
    'user-facing copy avoids developer vocabulary'
  );
  check(/displayClinicianName/.test(canvas), 'ALL-CAPS wire names are title-cased for display');
  const canvasCss = fs.readFileSync(path.join(__dirname, 'content-scripts/lab-allocate-canvas.css'), 'utf8');
  check(canvasCss.indexOf('214748' + '3001') === -1, 'drag-ghost z-index is not a 10-digit Modulus-11 lookalike');
  check(/position: sticky/.test(canvasCss), 'group headers stay pinned while the pile scrolls');
  check(
    !/#fff7ed|#9a3412|#ffedd5|#fdba74|#fee2e2/.test(canvasCss),
    'warn/red surfaces use the token triads, not raw hexes'
  );
  check(/prefers-reduced-motion/.test(canvasCss), 'motion respects prefers-reduced-motion');
  check(/ms-lac-lifting/.test(canvasCss), 'lifting a group dims the rest of the pile, not the well');
  check(/ms-lac-drag-source/.test(canvasCss), 'the dragged reports are marked, not the whole list');
  check(/inset: 0;/.test(canvasCss) && !/min\(1280px/.test(canvasCss), 'workbench is full-bleed, not a capped modal');
  check(!/Add clinician column/.test(canvas), 'clinicians are fields, not full-page columns');
  const capture = fs.readFileSync(path.join(__dirname, 'scripts/staff-scheduling-capture.js'), 'utf8');
  check(/staff-scheduling SCOPING capture/.test(capture), 'staff-scheduling capture script is present');
  check(!/method:\s*['"]POST['"]/.test(capture), 'staff-scheduling capture does not POST');
  check(!/inset:24px/.test(capture), 'staff-scheduling capture is a corner panel, not a full-page overlay');
  check(/makeDraggable/.test(capture), 'staff-scheduling capture panel can be dragged');
  check(/responseText/.test(capture), 'staff-scheduling capture samples XHR JSON as well as fetch');
  check(
    /embedded-overview/.test(capture),
    'staff-scheduling capture may re-read the confirmed appointment-book overview'
  );
  check(/\/scheduling\/data\/staff-schedule/.test(capture), 'staff-scheduling capture re-reads GET staff-schedule');
  const reqCap = fs.readFileSync(path.join(__dirname, 'scripts/lab-requester-capture.js'), 'utf8');
  check(/REQUESTED-BY SCOPING capture/.test(reqCap), 'requester capture script is present');
  check(!/method:\s*['"]POST['"]/.test(reqCap), 'requester capture does not POST');
  check(!/inset:24px/.test(reqCap), 'requester capture is a corner panel, not a full-page overlay');
  check(!/Absence unknown<\/span>/.test(canvas), 'chips do not wear Absence unknown as a standing badge');
  const labCap = fs.readFileSync(path.join(__dirname, 'scripts/lab-allocate-capture.js'), 'utf8');
  check(/describeWriteValue/.test(labCap), 'lab-allocate capture samples write-key types, not PHI values');
  check(!/method:\s*['"]POST['"]/.test(labCap), 'lab-allocate capture does not POST');
  check(/teamOptions/.test(labCap), 'lab-allocate capture samples teamOptions alongside staff');
}

console.log('\n--- grouping by who ordered ---');
{
  const a = C.applyRequester(
    C.normaliseTaskRow({ id: uuid(1), patientName: 'A', assignedTo: 'Results', summary: 'FBC' }, 'x'),
    {
      name: 'Dr Cole',
      source: 'requestedBy',
      confidence: 'requester',
    }
  );
  const b = C.applyRequester(
    C.normaliseTaskRow({ id: uuid(2), patientName: 'B', assignedTo: 'Results', summary: 'U&E' }, 'x'),
    {
      name: 'Dr Cole',
      source: 'requestedBy',
      confidence: 'requester',
    }
  );
  const c = C.normaliseTaskRow({ id: uuid(3), patientName: 'C', assignedTo: 'Results', summary: 'LFT' }, 'x');
  const board = C.buildWorkspace([a, b, c], C.emptyDraft());
  check(board.pool.tiles.length === 3, 'all inbox results start in the unallocated pool');
  const coleGroup = board.pool.groups.find((g) => g.requester === 'Dr Cole');
  const unknownGroup = board.pool.groups.find((g) => !g.known);
  check(coleGroup && coleGroup.count === 2, 'same-requester tiles share one pool group');
  check(unknownGroup && unknownGroup.count === 1, 'unknown requester stays in its own pile inside the pool');
  const coleChip = board.clinicians.find((col) => col.title === 'Dr Cole');
  check(coleChip && coleChip.count === 0, 'requester field stays empty until something sits with them');
  check(coleChip && coleChip.inPoolCount === 2, 'field counts how much of the unallocated pile that person ordered');
  const groups = C.groupTiles([
    { id: a.id, requester: 'Dr Cole' },
    { id: b.id, requester: 'Dr Cole' },
    { id: c.id, requester: '' },
  ]);
  check(groups[0].known === true && groups[0].count === 2, 'known requester group is first and counted');
  check(groups[0].requester === 'Dr Cole', 'group names who ordered');
  check(/Drag this group/.test(groups[0].dragHint), 'group is explicitly draggable');
  check(groups[1].known === false && groups[1].count === 1, 'unknown requester stays in its own pile');
  const preview = C.dragPreview([a, b, c], [a.id, b.id]);
  check(preview.canGroup === true, 'two same-requester tiles can group');
  check(preview.label === '2 results ordered by Dr Cole', 'drag label names who ordered');
  const mixed = C.dragPreview([a, b, c], [a.id, c.id]);
  check(mixed.mixed === true && mixed.canGroup === false, 'mixed requesters cannot auto-group');
}

console.log('\n--- multi-select and drag origin ---');
{
  const a = uuid(1);
  const b = uuid(2);
  const c = uuid(3);
  const d = uuid(4);
  check(C.selectedIdList({ [a]: true, [b]: false }).join(',') === a, 'selectedIdList drops falsey flags');
  const one = C.toggleIdInSelection({}, a, false);
  check(one[a] === true && C.selectedIdList(one).length === 1, 'plain click selects that report');
  const toggledOff = C.toggleIdInSelection(one, a, false);
  check(C.selectedIdList(toggledOff).length === 0, 'plain click on the only pick clears it');
  const replaced = C.toggleIdInSelection({ [a]: true }, b, false);
  check(replaced[b] === true && !replaced[a], 'plain click replaces a previous pick');
  const added = C.toggleIdInSelection({ [a]: true }, b, true);
  check(added[a] && added[b], 'ctrl-click adds another report');
  const removed = C.toggleIdInSelection(added, a, true);
  check(!removed[a] && removed[b], 'ctrl-click on a picked report removes it');
  const g1 = C.toggleGroupInSelection({}, [a, b], false);
  check(g1[a] && g1[b] && C.selectedIdList(g1).length === 2, 'plain group click takes that clinician’s lot');
  const g2 = C.toggleGroupInSelection(g1, [c], true);
  check(g2[a] && g2[b] && g2[c], 'ctrl-click another heading adds that clinician too');
  const g2off = C.toggleGroupInSelection(g2, [a, b], true);
  check(!g2off[a] && !g2off[b] && g2off[c], 'ctrl-click a fully-picked heading removes just that clinician');
  const gReplace = C.toggleGroupInSelection(g2, [d], false);
  check(gReplace[d] && !gReplace[a] && !gReplace[c], 'plain click on a heading replaces the set');
  check(
    C.rangeSelectIds([a, b, c, d], b, d).join(',') === [b, c, d].join(','),
    'shift-click range is inclusive in visual order'
  );
  check(C.rangeSelectIds([a, b, c, d], d, b).join(',') === [b, c, d].join(','), 'shift-click range works backwards');
  check(C.rangeSelectIds([a, b, c], 'missing', b).join(',') === b, 'shift-click without an anchor is that report');
  const groups = [
    { key: 'clinician:cole', tileIds: [a, b] },
    { key: 'clinician:triska', tileIds: [c] },
    { key: 'unknown', tileIds: [d] },
  ];
  check(
    C.idsInGroupRange(groups, 'clinician:cole', 'clinician:triska').join(',') === [a, b, c].join(','),
    'shift-click across headings takes every report in between'
  );
  check(
    C.dragIdsFor({ [a]: true, [c]: true }, [a, b]).join(',') === [a, c].join(','),
    'dragging a picked clinician block takes the whole selection'
  );
  check(
    C.dragIdsFor({ [a]: true }, [c]).join(',') === c,
    'dragging an unpicked block does not swallow a previous pick'
  );
  check(C.dropTargetShowsHover('pool', 'pool') === false, 'lifting from unallocated does not shade the pile');
  check(C.dropTargetShowsHover('pool', 'clinician') === true, 'a clinician field still highlights as the drop');
  check(C.dropTargetShowsHover('clinician', 'pool') === true, 'bringing work back to unallocated does highlight the well');
  check(C.dropTargetShowsHover('clinician', 'clinician') === true, 'field-to-field still highlights the destination');
  check(C.dropTargetShowsHover('pool', 'team') === true, 'a team field highlights as a drop from the pile');
  check(C.dropTargetShowsHover('team', 'pool') === true, 'bringing work back from a team highlights the well');
}

console.log('\n--- one person, two wire formats ---');
{
  check(C.personNameKey('AZADIAN N') === 'azadian|n', 'caps SURNAME INITIAL keys as surname|initial');
  check(C.personNameKey('Dr Natalie Azadian') === 'azadian|n', 'full name keys the same');
  check(C.personNameKey('Triska, David') === 'triska|d', 'surname, forename comma form keys as surname|initial');
  check(C.samePerson('TRISKA D', 'Triska, David') === true, 'requestedBy matches surname, forename staff option');
  check(C.samePerson('TRISKA D', 'Triska David') === true, 'requestedBy matches surname-then-forename');
  check(C.samePerson('TRISKA D', 'Dr David Triska GP') === true, 'trailing GP role suffix is stripped');
  check(C.samePerson('Triska', 'Dr David Triska') === true, 'bare surname matches the full name');
  check(C.personNameKey('Anstead') === 'anstead', 'bare surname keys alone');
  check(C.personNameKey('Subancely Heelas-Ebance') === 'heelas ebance|s', 'hyphenated surname keeps both parts');
  check(C.personNameKey('HEELAS-EBANCE S') === 'heelas ebance|s', 'caps hyphenated format matches it');
  check(C.samePerson('AZADIAN N', 'Dr Natalie Azadian') === true, 'caps and full form are one person');
  check(C.samePerson('Anstead', 'Claire Anstead') === true, 'bare surname matches any initial');
  check(C.samePerson('AZADIAN N', 'Dr Amy Azadian') === false, 'different initials stay different people');
  check(C.samePerson('OFFER A', 'Dr Amy Offer') === true, 'sameClinician family covers presence lookups');
  check(
    C.clinicianColumnKey('AZADIAN N') === C.clinicianColumnKey('Dr Natalie Azadian'),
    'both formats land the same chip key'
  );
  check(C.displayClinicianName('AZADIAN N') === 'Azadian N', 'ALL-CAPS wire names are title-cased for display');
  check(
    C.displayClinicianName('Dr Georgina BLANCO') === 'Dr Georgina Blanco',
    'mixed names only fix the shouting token'
  );

  // Two requester formats for one person merge into ONE pool group and chip.
  const r1 = C.applyRequester(
    C.normaliseTaskRow({ id: uuid(41), patientName: 'A', assignedTo: 'Investigation Reports', summary: 'FBC' }, 'x'),
    { name: 'AZADIAN N', source: 'requestedBy', confidence: 'requester' }
  );
  const r2 = C.applyRequester(
    C.normaliseTaskRow({ id: uuid(42), patientName: 'B', assignedTo: 'Investigation Reports', summary: 'TSH' }, 'x'),
    { name: 'Dr Natalie Azadian', source: 'requestedBy', confidence: 'requester' }
  );
  const ws2 = C.buildWorkspace([r1, r2], C.emptyDraft());
  const azChips = ws2.clinicians.filter((c) => /azadian/i.test(c.title));
  check(azChips.length === 1, 'one chip for one person, not one per name format');
  const azGroup = ws2.pool.groups.filter((g) => /azadian/i.test(g.requester));
  check(azGroup.length === 1 && azGroup[0].count === 2, 'both formats share one pool group');
  check(azGroup[0].requester === 'Dr Natalie Azadian', 'the group shows the fullest name variant');

  // The caps chip title now matches the appointment book and rota.
  const book = C.parseTodayBook({
    date: '2026-08-25',
    staffSchedules: [{ name: 'Dr Natalie Azadian', schedule: [{ scheduleType: 'diary' }] }],
  });
  const pres = C.presenceForName({ name: 'AZADIAN N', dateISO: '2026-08-25', book: book });
  check(pres.state === 'present' && pres.reason === 'in-today', 'caps chip reads In today off the book');
  const rotaAway = C.presenceForName({
    name: 'AZADIAN N',
    dateISO: '2026-08-25',
    staffList: [{ id: 's9', name: 'Dr Natalie Azadian', notAPerson: false }],
    leaveList: [{ staffId: 's9', status: 'approved', type: 'annual', startDate: '2026-08-01', endDate: '2026-09-01' }],
  });
  check(rotaAway.state === 'away', 'caps chip reads Away off the rota leave list');

  // Surname-then-forename without a comma keys as forename|s — a second
  // chip, and the empty one has no sitting assignedId so it will not write.
  check(C.personNameKey('Triska David') === 'david|t', 'surname-forename without comma is the swapped key');
  check(
    C.clinicianColumnKey('Triska David') !== C.clinicianColumnKey('Dr David Triska'),
    'raw keys still differ — merge happens at board build'
  );
  check(C.sameClusterPerson('Triska David', 'Dr David Triska') === true, 'those two names are one person for chip merge');
  check(C.sameClusterPerson('AZADIAN N', 'Dr Amy Azadian') === false, 'different initials stay two people on the rail');

  const daveId = uuid(61);
  const sittingDave = C.normaliseTaskRow(
    {
      id: uuid(62),
      patientName: 'Sit',
      assignedTo: 'Dr David Triska',
      assignedId: daveId,
      summary: 'FBC',
    },
    'x'
  );
  const pileDave = C.applyRequester(
    C.normaliseTaskRow({ id: uuid(63), patientName: 'Pile', assignedTo: 'Investigation Reports', summary: 'TSH' }, 'x'),
    { name: 'Triska David', source: 'requestedBy', confidence: 'requester' }
  );
  const dupDraft = C.addColumn(C.emptyDraft(), 'Triska David');
  const dupBoard = C.buildWorkspace([sittingDave, pileDave], dupDraft);
  const daveChips = dupBoard.clinicians.filter((c) => /triska|david/i.test(c.title));
  check(daveChips.length === 1, 'Dr David Triska and Triska David share one drop field');
  check(/triska/i.test(daveChips[0].title), 'the merged field keeps the fullest name');
  const daveGroups = dupBoard.pool.groups.filter((g) => /triska|david/i.test(g.requester));
  check(daveGroups.length === 1, 'the unallocated pile also merges those requester spellings');
  const writeDup = C.planBulkReassign(
    [sittingDave, pileDave],
    C.stageMove(dupDraft, pileDave.id, daveChips[0].key),
    'token',
    C.harvestStaffDirectory([], { staffOptions: [{ id: uuid(99), name: 'Dr Someone Else' }] })
  );
  check(writeDup.ok === true, 'the merged field writes using the sitting assignedId');
  check(writeDup.batches[0].assigneeId === daveId, 'write id is the sitting lab’s staff UUID, not a name guess');
}

console.log('\n--- team drop targets ---');
{
  const teamId = uuid(81);
  const resultsId = uuid(82);
  const inbox = C.normaliseTaskRow(
    {
      id: uuid(83),
      patientName: 'A',
      assignedTo: 'Investigation Reports',
      assignedId: teamId,
      summary: 'FBC',
    },
    'x'
  );
  const teamDir = C.harvestTeamDirectory([inbox], {
    assigneeOptions: {
      teams: [
        { value: teamId, label: 'Investigation Reports', type: 'team' },
        { value: resultsId, label: 'Results', type: 'team' },
      ],
    },
  });
  check(teamDir.list.length === 2, 'assigneeOptions.teams harvests both inboxes');
  check(
    teamDir.list.some((t) => t.id === resultsId && t.name === 'Results'),
    'Results team keeps its UUID'
  );
  const teamBoard = C.buildWorkspace([inbox], C.emptyDraft(), { teams: teamDir.list });
  check(teamBoard.teams.length === 2, 'harvested teams appear as drop targets');
  check(teamBoard.pool.count === 1, 'inbox-assigned work stays in the unallocated pile');
  check(
    teamBoard.clinicians.every((c) => !/investigation reports/i.test(c.title)),
    'the inbox name is not a clinician field'
  );
  const resultsKey = C.teamColumnKey('Results');
  const teamPlan = C.planBulkReassign(
    [inbox],
    C.stageMove(C.emptyDraft(), inbox.id, resultsKey),
    'token',
    C.harvestStaffDirectory([], null),
    'review_investigation_results_task',
    teamDir
  );
  check(teamPlan.ok === true, 'staging onto a team is writable when the team UUID is unique');
  check(teamPlan.batches[0].assigneeType === 'team', 'team write uses assigneeType team');
  check(teamPlan.batches[0].assigneeId === resultsId, 'team write uses the harvested team UUID');
  const teamBody = C.buildBulkReassignBody(resultsId, 'token', [inbox.id], 'slug', 'team');
  check(teamBody.assigneeType === 'team', 'body assigneeType is team when the destination is a team');
  check(
    Object.keys(teamBody).join(',') === 'assigneeId,assigneeType,taskList,taskIds',
    'team write still posts exactly the four captured keys'
  );
  const staffBody = C.buildBulkReassignBody(uuid(1), 'token', [inbox.id], 'slug');
  check(staffBody.assigneeType === 'staff', 'omitted type stays staff');
}

console.log('\n--- person-assigned sits on the clinician field ---');
{
  const assigned = C.normaliseTaskRow(
    { id: uuid(21), patientName: 'A', assignedTo: 'Dr Jane Cole', summary: 'FBC' },
    'x'
  );
  const inbox = C.normaliseTaskRow(
    {
      id: uuid(22),
      patientName: 'B',
      assignedTo: 'Investigation Reports',
      requestedBy: 'COLE J',
      namedGp: 'Dr Registered GP',
      summary: 'U&E',
    },
    'x'
  );
  check(
    C.homeColumnKey(assigned) === C.clinicianColumnKey('Dr Jane Cole'),
    'already sitting with a person homes to that field'
  );
  check(C.homeColumnKey(inbox) === C.POOL, 'inbox work stays in the large unallocated box');
  const board = C.buildWorkspace([assigned, inbox], C.emptyDraft());
  check(
    board.pool.tiles.length === 1 && board.pool.tiles[0].patientName === 'B',
    'only unallocated sit in the large box'
  );
  const cole = board.clinicians.find((c) => /cole/i.test(c.title));
  check(
    cole && cole.tiles.some((t) => t.patientName === 'A' && t.staged === false),
    'already-assigned sits on the clinician field, not staged'
  );
  check(inbox.requester === 'COLE J', 'requester is still read for grouping on the unallocated pile');
  check(inbox.namedGp === 'Dr Registered GP', 'named GP stays a caption and does not move the row');
  const back = C.stageMove(C.emptyDraft(), assigned.id, C.POOL);
  check(C.draftSummary([assigned], back).count === 0, 'dropping a person-assigned row on the pool is not a write');
}

console.log('\n--- inbox name is never a clinician chip ---');
{
  const inboxRow = C.normaliseTaskRow(
    {
      id: uuid(8),
      patientName: 'KERR, Mo',
      assignedTo: 'Investigation Reports',
      requestedBy: 'HEYLEN E',
      summary: 'TSH',
    },
    'x'
  );
  const ws = C.buildWorkspace([inboxRow], C.emptyDraft());
  check(ws.pool.tiles.length === 1, 'inbox-assigned result stays in the unallocated pool');
  check(
    !ws.clinicians.some((c) => /investigation reports/i.test(c.title)),
    'Investigation Reports is not a clinician field'
  );
  check(
    ws.clinicians.some((c) => c.title === 'HEYLEN E' && c.count === 0),
    'the requester is an empty drop-target field'
  );
}

console.log('\n--- absence warning at allocation ---');
{
  const staff = [
    { id: 's1', name: 'Dr Jane Cole', medicusName: 'Jane Cole', notAPerson: false },
    { id: 'lane', name: 'Results inbox', notAPerson: true },
  ];
  const leave = [{ staffId: 's1', status: 'approved', type: 'annual', startDate: '2026-08-24', endDate: '2026-08-29' }];
  check(C.matchStaffByName(staff, 'Jane Cole').id === 's1', 'matches medicusName as well as name');
  check(C.matchStaffByName(staff, 'Results inbox') === null, 'directory lanes are not a person');
  const away = C.absenceForName(staff, leave, 'Dr Jane Cole', '2026-08-25');
  check(away.state === 'away', 'approved leave → away');
  check(C.shouldWarnAbsence(away) === true, 'away must warn at allocation');
  check(/annual leave until 29 Aug 2026/.test(away.label), 'warning names the leave and the return date');
  const copy = C.absenceWarningCopy(away, 4, 'Dr Jane Cole');
  check(
    /does not mean they will see them today/.test(copy),
    'allocation warning states they will not see the labs today'
  );
  check(!/\b(Done|Sent|Allocated|Submitted|Booked)\b/.test(copy), 'absence copy has no completion verbs');
  check(
    C.shouldWarnAbsence(C.absenceForName([], [], 'Dr Jane Cole', '2026-08-25')) === false,
    'empty rota does not warn — unknown is not away'
  );
  check(
    C.shouldWarnAbsence(C.absenceForName(staff, [], 'Dr Reed', '2026-08-25')) === false,
    'unmatched name does not warn — unknown is not away'
  );
  check(
    C.shouldWarnAbsence(C.absenceForName(staff, [], 'Dr Jane Cole', '2026-08-25')) === false,
    'matching staff with no leave is present — no warn'
  );
  const pending = C.absenceForName(
    staff,
    [{ staffId: 's1', status: 'requested', type: 'sick', startDate: '2026-08-25', endDate: '2026-08-26' }],
    'Dr Jane Cole',
    '2026-08-25'
  );
  check(pending.state === 'away-pending' && C.shouldWarnAbsence(pending), 'requested leave still warns');
}

console.log('\n--- Medicus today-book presence (captured 2026-08-25) ---');
{
  const payload = {
    date: '2026-08-25',
    scheduleUnavailabilityPeriodType: 'unavailability-period',
    staffSchedules: [
      {
        name: 'Nhs 111',
        schedule: [
          {
            scheduleType: 'diary',
            summary: { site: { name: 'Witley Surgery' }, service: { name: 'General Appointments' } },
          },
        ],
      },
      {
        name: 'Dr Natalie Azadian',
        schedule: [
          { scheduleType: 'diary', summary: { site: { name: 'Witley Surgery' } } },
          { scheduleType: 'diary', summary: { site: { name: 'Witley Surgery' } } },
        ],
      },
      {
        name: 'Dr David Triska',
        schedule: [{ scheduleType: 'diary', summary: { status: { isCancelled: true } } }],
      },
    ],
  };
  const book = C.parseTodayBook(payload);
  check(book.date === '2026-08-25', 'book date is the captured day');
  check(
    book.present.some((p) => p.name === 'Dr Natalie Azadian' && p.sessions === 2),
    'Azadian is in today with two diaries'
  );
  check(!!C.bookPresenceForName(book, 'Natalie Azadian'), 'title-stripped name still matches the book');
  check(!C.bookPresenceForName(book, 'Emma Heylen'), 'a clinician not on today’s book is not present');
  check(!C.bookPresenceForName(book, 'Dr David Triska'), 'a cancelled-only diary is not In today');

  const inToday = C.presenceForName({ name: 'Dr Natalie Azadian', dateISO: '2026-08-25', book: book });
  check(inToday.state === 'present' && inToday.reason === 'in-today', 'book hit → In today');
  check(C.shouldWarnAbsence(inToday) === false, 'In today does not warn');
  check(/appointment book/.test(inToday.label), 'In today names the appointment book');

  const quiet = C.presenceForName({ name: 'Emma Heylen', dateISO: '2026-08-25', book: book });
  check(quiet.state === 'unknown' && quiet.reason === 'no-evidence', 'not on the book is not absence');
  check(C.shouldWarnAbsence(quiet) === false, 'missing from today’s 11 does not warn');

  const parsedAbs = C.parseAbsenceRecords({
    items: [
      {
        absenceId: '019e8211-f3cf-715f-9996-ccbe4d0b2366',
        staff: { name: 'Kate Downs' },
        startDate: '2026-08-03',
        endDate: '2026-09-03',
        absenceType: { label: 'Annual leave' },
      },
      {
        name: 'Dr Natalie Azadian',
        startDateTime: '2026-08-25T08:00:00',
        diaryEntryType: { value: 'slot', isSlot: true },
      },
    ],
  });
  check(parsedAbs.length === 1 && parsedAbs[0].name === 'Kate Downs', 'only absence-shaped records parse as away');
  check(!C.absenceOnDate(parsedAbs, 'Dr Natalie Azadian', '2026-08-25'), 'a diary slot is not an absence');

  const medicusAway = C.presenceForName({
    name: 'Kate Downs',
    dateISO: '2026-08-25',
    book: book,
    absences: parsedAbs,
  });
  check(medicusAway.state === 'away' && medicusAway.source === 'medicus', 'parsed Medicus absence wins');
  check(C.shouldWarnAbsence(medicusAway) === true, 'Medicus absence warns');

  const rotaWins = C.presenceForName({
    name: 'Dr Jane Cole',
    dateISO: '2026-08-25',
    book: book,
    staffList: staffForPresence(),
    leaveList: [{ staffId: 's1', status: 'approved', type: 'annual', startDate: '2026-08-24', endDate: '2026-08-29' }],
  });
  check(rotaWins.state === 'away' && rotaWins.source === 'rota', 'rota leave still marks Away when Medicus has no row');
  const wrappedBook = C.parseTodayBook({
    data: {
      date: '2026-08-25',
      staffSchedules: [{ name: 'Dr Natalie Azadian', schedule: [{ scheduleType: 'diary' }] }],
    },
  });
  check(
    wrappedBook.present.some(function (p) {
      return p.name === 'Dr Natalie Azadian';
    }),
    'today-book unwraps data.staffSchedules'
  );
}

function staffForPresence() {
  return [{ id: 's1', name: 'Dr Jane Cole', medicusName: 'Jane Cole', notAPerson: false }];
}

console.log('\n--- staff directory + unique UUID resolve ---');
{
  const azadianId = uuid(21);
  const coleId = uuid(22);
  const teamId = uuid(23);
  const row = C.normaliseTaskRow(
    {
      id: uuid(1),
      patientName: 'A',
      requestedBy: 'AZADIAN N',
      assignedTo: 'Dr Natalie Azadian',
      assignedId: azadianId,
      namedGp: 'Dr David Triska',
      namedGpId: uuid(24),
    },
    'x'
  );
  const dir = C.harvestStaffDirectory([row], {
    data: {
      assigneeOptions: {
        staff: [
          { type: 'staff', value: coleId, label: 'Dr Jane Cole' },
          { id: azadianId, name: 'Dr Natalie Azadian' },
        ],
        teams: [{ type: 'team', value: teamId, label: 'Investigation Reports' }],
      },
    },
  });
  check(dir.byId[azadianId] && dir.byId[coleId], 'directory keeps both staff UUIDs');
  check(!dir.byId[teamId], 'team assigneeOptions are not people');
  const fromBook = C.harvestStaffDirectory([], {
    staffOptions: [
      { id: azadianId, name: 'Dr Natalie Azadian' },
      { value: coleId, label: 'Dr Jane Cole' },
    ],
  });
  check(fromBook.byId[azadianId] && fromBook.byId[coleId], 'today-book staffOptions populate the staff directory');
  const wrappedVal = C.harvestStaffDirectory([], {
    staffOptions: [{ value: { id: azadianId, name: 'Natalie' }, label: 'Dr Natalie Azadian' }],
  });
  check(wrappedVal.byId[azadianId], 'Vue-wrapped staffOptions value object is harvested');
  check(
    wrappedVal.byId[azadianId].name.indexOf('Azadian') !== -1,
    'outer full label wins over inner first name'
  );
  check(
    C.pickStaffFields({ id: azadianId, name: 'Natalie', label: 'Dr Natalie Azadian' }).name.indexOf('Azadian') !== -1,
    'prefers full label over short name field'
  );
  const commaDir = C.harvestStaffDirectory([], {
    staffOptions: [{ id: azadianId, label: 'Azadian, Natalie' }],
  });
  check(
    C.resolveStaffForColumn(C.clinicianColumnKey('AZADIAN N'), 'AZADIAN N', commaDir).ok === true,
    'AZADIAN N resolves against Surname, Forename staff option'
  );
  const bareDir = C.harvestStaffDirectory([], {
    staffOptions: [{ id: uuid(21), name: 'Dr David Triska' }],
  });
  check(
    C.resolveStaffForColumn(C.clinicianColumnKey('Triska'), 'Triska', bareDir).ok === true,
    'bare surname Triska resolves to Dr David Triska'
  );
  const mapped = C.harvestStaffDirectory([], {
    staffOptions: { [azadianId]: 'Dr Natalie Azadian' },
  });
  check(mapped.byId[azadianId], 'id→name staffOptions map is harvested');
  const nestedOpts = C.harvestStaffDirectory([], {
    staffOptions: { options: [{ value: coleId, label: 'Dr Jane Cole' }] },
  });
  check(nestedOpts.byId[coleId], 'staffOptions.options array is harvested');
  const dutyId = uuid(40);
  const duty = C.harvestStaffDirectory([], {
    staffOptions: [{ id: dutyId, name: 'Duty Doctor' }],
  });
  check(duty.byId[dutyId], 'a staff option named Duty Doctor keeps its UUID');
  const wrappedData = C.harvestStaffDirectory([], {
    data: { staffOptions: [{ id: azadianId, name: 'Dr Natalie Azadian' }] },
  });
  check(wrappedData.byId[azadianId], 'staffOptions nested under data is harvested');
  check(C.pickPatientId({ patientId: uuid(5) }) === uuid(5), 'row patientId is a UUID');
  check(C.pickPatientIdFromPayload({ data: { patient: { id: uuid(6) } } }) === uuid(6), 'overview patient.id is picked');
  const hit = C.resolveStaffForColumn(C.clinicianColumnKey('AZADIAN N'), 'AZADIAN N', dir);
  check(hit.ok && hit.staff.id === azadianId, 'AZADIAN N resolves to the Azadian UUID');
  const miss = C.resolveStaffForColumn(C.clinicianColumnKey('Dr Mystery'), 'Dr Mystery', dir);
  check(miss.ok === false && miss.reason === 'no-unique-staff', 'unknown chip is refused');
  const clash = C.mergeStaffDirectory(dir, {
    byId: {
      [uuid(31)]: { id: uuid(31), name: 'Dr Nora Azadian', source: 'clash' },
    },
    list: [{ id: uuid(31), name: 'Dr Nora Azadian' }],
  });
  const ambiguous = C.resolveStaffForColumn(C.clinicianColumnKey('Azadian N'), 'Azadian N', clash);
  check(
    ambiguous.ok === false && ambiguous.reason === 'ambiguous-staff',
    'same surname+initial with two UUIDs is refused'
  );
}

console.log('\n--- planBulkReassign groups by destination UUID ---');
{
  const azadianId = uuid(21);
  const a = C.applyRequester(
    C.normaliseTaskRow({ id: uuid(1), patientName: 'A', assignedTo: 'Results', summary: 'FBC' }, 'x'),
    { name: 'AZADIAN N', source: 'requestedBy', confidence: 'requester' }
  );
  const b = C.normaliseTaskRow({ id: uuid(2), patientName: 'B', assignedTo: 'Results', summary: 'U&E' }, 'x');
  let draft = C.stageMoves(C.emptyDraft(), [a.id, b.id], C.clinicianColumnKey('AZADIAN N'));
  draft = C.addColumn(draft, 'Dr Mystery');
  draft = C.stageMove(draft, b.id, C.clinicianColumnKey('Dr Mystery'));
  const dir = C.harvestStaffDirectory(
    [
      C.normaliseTaskRow(
        { id: uuid(9), patientName: 'X', assignedTo: 'Dr Natalie Azadian', assignedId: azadianId },
        'x'
      ),
    ],
    null
  );
  const plan = C.planBulkReassign([a, b], draft, 'envelope-token', dir);
  check(plan.ok === true, 'plan is writable when one destination resolves');
  check(plan.batches.length === 1 && plan.batches[0].assigneeId === azadianId, 'one POST per unique staff UUID');
  check(plan.batches[0].taskIds.join(',') === String(a.id), 'only the matched destination is written');
  check(plan.refused.length === 1 && /Mystery/.test(plan.refused[0].toTitle), 'unmatched chip is refused, not guessed');
  const noToken = C.planBulkReassign([a, b], draft, '', dir);
  check(noToken.ok === false, 'plan refuses without the queue token');
}

console.log('\n--- sitting assignedId is the write destination ---');
{
  const daveId = uuid(50);
  const sitting = C.normaliseTaskRow(
    {
      id: uuid(51),
      patientName: 'A',
      assignedTo: 'Dr David Triska',
      assignedId: daveId,
      summary: 'FBC',
    },
    'x'
  );
  const pile = C.normaliseTaskRow(
    { id: uuid(52), patientName: 'B', assignedTo: 'Investigation Reports', summary: 'TSH' },
    'x'
  );
  const key = C.clinicianColumnKey('Dr David Triska');
  const draft = C.stageMove(C.emptyDraft(), pile.id, key);
  const emptyDir = C.harvestStaffDirectory([], { staffOptions: [{ id: uuid(99), name: 'Dr Someone Else' }] });
  const plan = C.planBulkReassign([sitting, pile], draft, 'token', emptyDir);
  check(plan.ok === true, 'plan writes using the sitting row assignedId');
  check(plan.batches[0].assigneeId === daveId, 'assigneeId is the sitting lab’s staff UUID');
  check(plan.batches[0].taskIds.join(',') === String(pile.id), 'only the staged pile row is written');
  const onField = C.assignedIdsOnColumn([sitting, pile], key);
  check(onField.ids.join(',') === daveId, 'assignedIdsOnColumn sees only the sitting UUID');

  const otherId = uuid(53);
  const clashSit = C.normaliseTaskRow(
    {
      id: uuid(54),
      patientName: 'C',
      assignedTo: 'Dr David Triska',
      assignedId: otherId,
      summary: 'U&E',
    },
    'x'
  );
  const clash = C.planBulkReassign([sitting, clashSit, pile], draft, 'token', emptyDir);
  check(clash.ok === false, 'two assignedIds on one field refuse');
  check(
    clash.refused[0] && clash.refused[0].reason === 'ambiguous-assigned-id',
    'reason is ambiguous-assigned-id'
  );
  check(/more than one staff id/.test(C.writeBlockReason(clash)), 'refuse copy names two ids on the field');

  const emptyDraft = C.addColumn(C.emptyDraft(), 'Dr Mystery');
  const emptyField = C.planBulkReassign(
    [pile],
    C.stageMove(emptyDraft, pile.id, C.clinicianColumnKey('Dr Mystery')),
    'token',
    emptyDir
  );
  check(emptyField.ok === false, 'empty field with no name match still refuses');
  check(/Mystery/.test(C.writeBlockReason(emptyField)), 'refuse copy names the field');
}

async function testClient() {
  console.log('\n--- createClient GET + captured bulk-reassign POST ---');
  const calls = [];
  let bodies = [];
  let taskListGone = false;
  const client = C.createClient('https://e38a9f.api.england.medicus.health', {
    fetchImpl: async (url, opts) => {
      calls.push({ url: url, method: opts.method, body: opts.body });
      let body = {};
      if (/bulk-reassign/.test(url)) {
        bodies.push(JSON.parse(opts.body || '{}'));
        body = { ok: true };
      } else if (/task-list/.test(url)) {
        body = {
          taskList: 'envelope-token',
          tasks: taskListGone
            ? []
            : [
                {
                  id: uuid(1),
                  patientName: 'A',
                  assignedTo: 'Investigation Reports',
                  requestedBy: 'AZADIAN N',
                  overviewURL: '/tasks/data/review-investigation-report/overview/' + uuid(1),
                },
              ],
        };
      } else if (/embedded-overview/.test(url)) {
        body = {
          date: '2026-08-25',
          staffSchedules: [{ name: 'Dr Natalie Azadian', schedule: [{ scheduleType: 'diary' }] }],
        };
      } else if (/staff-schedule/.test(url)) {
        body = {
          absences: [
            {
              absenceId: '019e8211-f3cf-715f-9996-ccbe4d0b2366',
              staff: { name: 'Kate Downs' },
              startDate: '2026-08-03',
              endDate: '2026-09-03',
            },
          ],
        };
      }
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify(body);
        },
      };
    },
  });
  const out = await client.fetchTaskList(
    'review-investigation-report',
    '?viewContext=workflow&masterAssignee=team-1'
  );
  check(out.rows.length === 1, 'client maps the task-list');
  check(out.taskList === 'envelope-token', 'client keeps the envelope taskList token');
  check(calls[0].method === 'GET', 'task-list fetch is GET');
  check(
    /\/tasks\/data\/review-investigation-report\/task-list\?viewContext=workflow$/.test(calls[0].url),
    'task-list GET keeps viewContext and drops masterAssignee'
  );
  await client.fetchOverview(out.rows[0].overviewURL);
  check(calls[1].method === 'GET', 'overview fetch is GET');
  try {
    await client.fetchOverview('https://evil.example/tasks/data/x/overview/' + uuid(1));
    check(false, 'absolute overviewURL must reject');
  } catch (err) {
    check(/bad overviewURL/.test(err.message), 'absolute overviewURL rejected');
  }
  const book = await client.fetchTodayBook('2026-08-25');
  check(calls[2].method === 'GET', 'today-book fetch is GET');
  check(
    /\/scheduling\/data\/appointment-book\/embedded-overview\?date=2026-08-25&filterByUsualLocation=false$/.test(
      calls[2].url
    ),
    'today-book uses the captured embedded-overview GET'
  );
  check(
    book.present.some((p) => p.name === 'Dr Natalie Azadian'),
    'today-book parser runs through the client'
  );
  const abs = await client.fetchStaffScheduleAbsences();
  check(calls[3].method === 'GET', 'staff-schedule fetch is GET');
  check(/\/scheduling\/data\/staff-schedule$/.test(calls[3].url), 'staff-schedule uses the captured GET');
  check(
    abs.some((a) => a.name === 'Kate Downs'),
    'staff-schedule absences parse when the body is absence-shaped'
  );

  const row = out.rows[0];
  C.applyRequester(row, { name: 'AZADIAN N', source: 'requestedBy', confidence: 'requester' });
  const draft = C.stageMove(C.emptyDraft(), row.id, C.clinicianColumnKey('AZADIAN N'));
  const dir = C.harvestStaffDirectory(
    [
      C.normaliseTaskRow(
        {
          id: uuid(99),
          patientName: 'Dir',
          assignedTo: 'Dr Natalie Azadian',
          assignedId: uuid(21),
        },
        'x'
      ),
    ],
    null
  );
  const written = await client.commitAllocations({
    slug: 'review-investigation-report',
    draft: draft,
    rows: [row],
    taskList: out.taskList,
    directory: dir,
  });
  check(written.ok === true && written.written === 1, 'commit writes the staged row');
  const posts = calls.filter(function (c) {
    return c.method === 'POST';
  });
  check(posts.length === 1, 'exactly one POST for one destination');
  check(
    /\/tasks\/review-investigation-report\/task-list\/bulk-reassign$/.test(posts[0].url),
    'POST nests the queue slug, not the captured literal'
  );
  check(bodies[0].assigneeType === 'staff', 'POST assigneeType is staff');
  check(bodies[0].taskList === 'envelope-token', 'POST passes the envelope taskList through');
  check(
    Object.keys(bodies[0]).join(',') === 'assigneeId,assigneeType,taskList,taskIds',
    'POST body is exactly the four captured keys'
  );

  const calls404 = [];
  const client404 = C.createClient('https://e38a9f.api.england.medicus.health', {
    fetchImpl: async function (url, opts) {
      calls404.push({ url: url, method: opts.method });
      if (/\/tasks\/review-investigation-report\/task-list\/bulk-reassign$/.test(url)) {
        return {
          ok: false,
          status: 404,
          text: async function () {
            return '';
          },
        };
      }
      var body404 = { ok: true };
      if (/\/tasks\/data\/.+\/task-list/.test(url)) {
        body404 = {
          taskList: 'envelope-token',
          tasks: [
            {
              id: uuid(1),
              patientName: 'A',
              assignedTo: 'Investigation Reports',
              requestedBy: 'AZADIAN N',
            },
          ],
        };
      }
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify(body404);
        },
      };
    },
  });
  const written404 = await client404.commitAllocations({
    slug: 'review-investigation-report',
    draft: draft,
    rows: [row],
    taskList: out.taskList,
    directory: dir,
  });
  check(
    written404.ok === true && written404.written === 1,
    '404 on the slug path still writes via the captured fallback'
  );
  const posts404 = calls404.filter(function (c) {
    return c.method === 'POST';
  });
  check(posts404.length === 2, 'slug path 404 then one fallback POST');
  check(/\/tasks\/task-list\/bulk-reassign$/.test(posts404[1].url), 'fallback POST is the captured literal');

  taskListGone = true;
  const vanished = await client.commitAllocations({
    slug: 'review-investigation-report',
    draft: draft,
    rows: [row],
    taskList: out.taskList,
    directory: dir,
  });
  check(
    vanished.ok === false && /no longer on the list/.test(vanished.reason),
    'vanished task aborts with nothing written'
  );
  check(
    calls.filter(function (c) {
      return c.method === 'POST';
    }).length === 1,
    'vanished abort does not POST'
  );

  const staffFormCalls = [];
  const staffClient = C.createClient('https://e38a9f.api.england.medicus.health', {
    fetchImpl: async function (url) {
      staffFormCalls.push(url);
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify({
            assigneeOptions: { staff: [{ type: 'staff', value: uuid(21), label: 'Dr Natalie Azadian' }] },
          });
        },
      };
    },
  });
  const form = await staffClient.fetchAssigneeStaff(uuid(8));
  check(
    /\/patient\/data\/workflow\/general-task\/create\?patientId=/.test(staffFormCalls[0]),
    'create-task GET for staff directory'
  );
  check(C.harvestStaffDirectory(null, form).byId[uuid(21)], 'create-task assigneeOptions.staff harvests');
}

console.log('--- board keeps every row visible ---');
{
  // A name that normalises to nothing ("Dr.") once landed on a key no column
  // rendered, so the result vanished off the board while count still said N.
  const rows = [
    { id: uuid(70), patientName: 'A', assignedTo: 'Dr.', summary: 'FBC' },
    { id: uuid(71), patientName: 'B', requester: 'Dr A Smith', summary: 'U&E' },
    { id: uuid(72), patientName: 'C', assignedTo: 'Dr B Jones', summary: 'TFT' },
    { id: uuid(73), patientName: 'D', assignedTo: 'Results Team', summary: 'HbA1c' },
  ];
  const board = C.buildBoard(rows, C.emptyDraft());
  const shown = board.columns.reduce(function (n, col) {
    return n + col.tiles.length;
  }, 0);
  check(shown === board.count, 'every row appears exactly once on the board');
  check(board.pool.count === 3, 'unallocated / inbox / unkeyable names stay in the pool');
  const jones = board.clinicians.find(function (c) {
    return /jones/i.test(c.title);
  });
  check(jones && jones.count === 1, 'person-assigned work sits on that clinician field');
  const poolIds = board.pool.tiles.map(function (t) {
    return t.id;
  });
  check(poolIds.indexOf(rows[0].id) !== -1, 'a name that normalises to nothing stays visible in the pool');
  check(poolIds.indexOf(rows[2].id) === -1, 'person-assigned work is not also in the unallocated box');

  const staged = C.stageMove(C.emptyDraft(), rows[0].id, C.clinicianColumnKey('Dr B Jones'));
  const after = C.buildBoard(rows, staged);
  const shownAfter = after.columns.reduce(function (n, col) {
    return n + col.tiles.length;
  }, 0);
  check(shownAfter === after.count, 'staging a move does not drop a row');
  check(after.pool.count === 2, 'staged row leaves the unallocated pool');
}

testClient()
  .then(function () {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed) process.exit(1);
  })
  .catch(function (err) {
    console.error(err);
    process.exit(1);
  });
