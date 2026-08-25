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
}

console.log('\n--- extractTaskArray / pickTaskId ---');
{
  check(C.extractTaskArray({ tasks: [{ id: uuid(1) }] }).length === 1, 'tasks envelope');
  check(C.extractTaskArray({ data: { tasks: [{ id: uuid(2) }] } }).length === 1, 'data.tasks envelope');
  check(C.extractTaskArray({ data: [{ id: uuid(3) }] }).length === 1, 'data array envelope');
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
  check(C.homeColumnKey(person) === C.POOL, 'every queue row homes to the reports pool');
  check(C.placementReason(person) === 'current-assignee', 'no requester → current-assignee, not who-ordered');

  const inbox = C.normaliseTaskRow(
    { id: uuid(2), patientName: 'PATEL, Ali', assignedTo: 'Results', namedGp: 'Dr Registered GP' },
    'review-investigation-report'
  );
  check(C.homeColumnKey(inbox) === C.POOL, 'team assignee stays in the investigation-reports pool');
  check(C.placementReason(inbox) === 'inbox', 'inbox reason is still recorded');
  check(inbox.namedGp === 'Dr Registered GP', 'named GP kept as a hint only');
}

console.log('\n--- requester placement never uses named GP ---');
{
  const row = C.normaliseTaskRow(
    { id: uuid(3), patientName: 'LEE, Pat', assignedTo: 'Results', namedGp: 'Dr Registered GP' },
    'review-investigation-report'
  );
  C.applyRequester(row, { name: 'Dr David Triska', source: 'requestedBy', confidence: 'requester' });
  check(C.homeColumnKey(row) === C.POOL, 'requester stays in the reports pool — not auto-placed onto a column');
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
  check(board0.pool.tiles.length === 2, 'requester and unknown both stay in the pool until staged');
  check(
    board0.pool.groups[0] && board0.pool.groups[0].requester === 'Dr Cole' && board0.pool.groups[0].count === 1,
    'pool groups by who requested'
  );
  check(
    board0.clinicians.some((c) => c.title === 'Dr Cole' && c.count === 0),
    'requester appears as an empty clinician chip'
  );
  check(!board0.clinicians.some((c) => c.title === 'Results'), 'the shared inbox is not a clinician chip');

  let draft = C.addColumn(C.emptyDraft(), 'Dr Reed');
  draft = C.stageMove(draft, b.id, C.clinicianColumnKey('Dr Reed'));
  const board1 = C.buildWorkspace([a, b], draft);
  const reed = board1.clinicians.find((c) => c.title === 'Dr Reed');
  check(reed && reed.tiles.length === 1 && reed.tiles[0].staged === true, 'drag stages onto a clinician chip');
  check(reed.stagedCount === 1, 'chip counts what is staged onto it');
  check(
    board1.pool.tiles.length === 1 && board1.pool.tiles[0].patientName === 'A',
    'unstaged requester group stays in the reports pool'
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
  const src = require('fs').readFileSync(require('path').join(__dirname, 'shared/lab-allocate-core.js'), 'utf8');
  check(/method:\s*['"]POST['"]/.test(src), 'core POSTs the captured bulk-reassign');
  check(src.indexOf('/tasks/task-list/bulk-reassign') !== -1, 'core uses the captured path');
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
  check(/ms-lac-pool/.test(canvas) && /ms-lac-chip/.test(canvas), 'canvas is a reports pool plus clinician chips');
  check(
    /requestStage\(ids, key, btn\.closest/.test(canvas),
    'clicking a chip stages the active selection — no drag needed'
  );
  check(/tabindex="0"/.test(canvas), 'tiles and group heads are keyboard focusable');
  check(/aria-selected/.test(canvas), 'selection state is exposed to assistive tech');
  check(/ms-lac-selectbar/.test(canvas), 'an active selection shows a visible count bar');
  check(/Select all/.test(canvas), 'group headers name their select-all affordance');
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
  check(/inset: 0;/.test(canvasCss) && !/min\(1280px/.test(canvasCss), 'workbench is full-bleed, not a capped modal');
  check(!/Add clinician column/.test(canvas), 'clinicians are chips, not full columns');
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
  check(board.pool.tiles.length === 3, 'all inbox results start in the reports pool');
  const coleGroup = board.pool.groups.find((g) => g.requester === 'Dr Cole');
  const unknownGroup = board.pool.groups.find((g) => !g.known);
  check(coleGroup && coleGroup.count === 2, 'same-requester tiles share one pool group');
  check(unknownGroup && unknownGroup.count === 1, 'unknown requester stays in its own pile inside the pool');
  const coleChip = board.clinicians.find((col) => col.title === 'Dr Cole');
  check(coleChip && coleChip.count === 0, 'requester chip stays empty until something is staged onto it');
  check(coleChip && coleChip.inPoolCount === 2, 'chip counts how much of the pile that person ordered');
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

console.log('\n--- one person, two wire formats ---');
{
  check(C.personNameKey('AZADIAN N') === 'azadian|n', 'caps SURNAME INITIAL keys as surname|initial');
  check(C.personNameKey('Dr Natalie Azadian') === 'azadian|n', 'full name keys the same');
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
  check(ws.pool.tiles.length === 1, 'inbox-assigned result stays in the reports pool');
  check(
    !ws.clinicians.some((c) => /investigation reports/i.test(c.title)),
    'Investigation Reports is not a clinician chip'
  );
  check(
    ws.clinicians.some((c) => c.title === 'HEYLEN E' && c.count === 0),
    'the requester is an empty drop-target chip'
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
                  assignedTo: 'Dr Natalie Azadian',
                  assignedId: uuid(21),
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
  const out = await client.fetchTaskList('review-investigation-report');
  check(out.rows.length === 1, 'client maps the task-list');
  check(out.taskList === 'envelope-token', 'client keeps the envelope taskList token');
  check(calls[0].method === 'GET', 'task-list fetch is GET');
  check(/\/tasks\/data\/review-investigation-report\/task-list$/.test(calls[0].url), 'confirmed task-list path family');
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
  const dir = C.harvestStaffDirectory(out.rows, null);
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
  check(/\/tasks\/task-list\/bulk-reassign$/.test(posts[0].url), 'POST hits the captured bulk-reassign path');
  check(bodies[0].assigneeType === 'staff', 'POST assigneeType is staff');
  check(bodies[0].taskList === 'envelope-token', 'POST passes the envelope taskList through');
  check(
    Object.keys(bodies[0]).join(',') === 'assigneeId,assigneeType,taskList,taskIds',
    'POST body is exactly the four captured keys'
  );

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
  check(board.pool.count === 4, 'every queue row sits in the pool until staged');
  const poolIds = board.pool.tiles.map(function (t) {
    return t.id;
  });
  check(poolIds.indexOf(rows[0].id) !== -1, 'a name that normalises to nothing stays visible in the pool');

  const staged = C.stageMove(C.emptyDraft(), rows[0].id, 'clinician:b jones');
  const after = C.buildBoard(rows, staged);
  const shownAfter = after.columns.reduce(function (n, col) {
    return n + col.tiles.length;
  }, 0);
  check(shownAfter === after.count, 'staging a move does not drop a row');
  check(after.pool.count === 3, 'staged row leaves the pool');
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
