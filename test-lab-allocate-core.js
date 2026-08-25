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
  check(/confirm this results list/.test(closed.reason), 'reason names the missing results-list confirmation');
  check(
    C.canWriteAllocations({ taskList: 'review_investigation_results_task' }).ok === true,
    'token unlocks the write'
  );
  check(C.canWriteAllocations({ taskList: '' }).ok === false, 'empty string is not a token');
  check(C.canWriteAllocations({ taskList: {} }).ok === false, 'empty object is not a token');
  check(
    C.extractTaskListToken({ data: { taskList: 'nested-token' } }) === 'nested-token',
    'taskList token may sit on data.taskList'
  );
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
  check(/Go back/.test(canvas), 'confirm defaults the clinician back to planning');
  check(/chip-stagehint/.test(canvas), 'a selection shows a Plan N here token, not a repeated sentence');
  check(/Plan ' \+ selCount \+ ' here/.test(canvas), 'the stage token names the destination action, not a bare +N');
  check(!/">\+' \+ selCount/.test(canvas), 'no bare +N destination target remains');
  check(/ms-lac-confirm-btn-primary/.test(canvas), 'confirm write is a primary action');
  check(/unstageIds/.test(canvas), 'a staged drawer row can return to unallocated');
  check(/\binert\b/.test(canvas), 'the board is inert while a write is in flight');
  check(/Add clinician…/.test(canvas), 'add-clinician starts behind a disclosure, worded as a person not a form field');
  check(!/Add a clinician field/.test(canvas), 'the developer term "clinician field" is not user-facing');
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
  check(/Absence check before planning/.test(canvas), 'clinician drop always offers an absence check');
  check(/Choose someone else/.test(canvas), 'the safe absence action is the sole primary');
  check(/Plan here anyway/.test(canvas), 'the risky absence action reads as an amber ghost, not the default');
  check(/loadRotaAbsences/.test(canvas), 'canvas reads rota.leave before allocation');
  check(/fetchTodayBook/.test(canvas), 'canvas reads today’s appointment book');
  check(/fetchStaffScheduleAbsences/.test(canvas), 'canvas may parse GET staff-schedule for absences');
  check(!/change-absence/.test(canvas), 'canvas never calls change-absence');
  check(!/calendar-resources/.test(canvas), 'canvas never calls calendar-resources');
  check(/In today/.test(canvas), 'chips can show In today from the appointment book');
  check(
    !/dateOfBirth|nhsNumber/i.test(canvas),
    'no patient DOB/NHS column — this is task routing, not clinical review'
  );
  check(/Already holding tasks/.test(canvas), 'the rail section is renamed from Holding work');
  check(!/Holding work/.test(canvas), 'the old Holding work label is gone');
  check(
    /Choose a clinician on the right.{0,10}nothing changes in Medicus until review/.test(canvas),
    'the selection bar removes destination ambiguity'
  );
  check(
    /Choose a clinician to plan these ' \+ selCount/.test(canvas),
    'the rail helper names the plan action, not a generic instruction'
  );
  check(
    /Select reports, then Plan N here/.test(canvas),
    'the resting rail helper names select-then-plan, not only drag'
  );
  check(/ms-lac-howto/.test(canvas), 'a numbered how-to strip is always visible');
  check(/Select reports/.test(canvas) && /Choose a clinician/.test(canvas), 'the how-to names the first two steps');
  check(/Review before Medicus changes/.test(canvas), 'the how-to names the confirm boundary');
  check(/unallocated in Medicus/.test(canvas), 'the header count is labelled as Medicus state, not the plan');
  check(/planned here/.test(canvas), 'the header names planned-on-this-board separately');
  check(/ms-lac-header-main/.test(canvas), 'the header uses Companion title-then-badge stacking');
  check(
    /Allocate labs'/.test(canvas) || /Allocate labs"/.test(canvas) || /'Allocate labs'/.test(canvas),
    'the launcher drops the canvas jargon'
  );
  check(/ms-lac-launch-count/.test(canvas), 'the launcher can wear a Companion-style count badge');
  check(!/Allocate labs on canvas/.test(canvas), 'the old Allocate labs on canvas… label is gone');
  check(/id="ms-lac-reload">Reload this board/.test(canvas), 'a blocked write offers a one-click reload');
  check(/earlyBlock/.test(canvas), 'missing results-list confirmation is shown before any plan is built');
  check(
    !/away \? '.*disabled/.test(canvas),
    'away clinicians are never disabled — intentional reassignment stays possible behind the absence gate'
  );
  check(/ms-lac-modal-scrim/.test(canvas), 'write confirmation renders as a real scrimmed modal, not a footer band');
  check(
    /'Reassign <span class="ms-lac-modal-count">'[\s\S]{0,160}' to '/.test(canvas),
    'single-destination confirm headline names the destination'
  );
  check(
    /'Review <span class="ms-lac-modal-count">' \+ n \+ '<\/span> task reassignment'/.test(canvas),
    'multi-destination confirm is a neutral review headline'
  );
  check(/Reassign tasks in Medicus/.test(canvas), 'the confirm primary action names the write honestly');
  check(/Review reassignments…/.test(canvas), 'the footer action to open the confirm modal is Review reassignments…');
  check(!/Write to Medicus/.test(canvas), 'the developer phrase Write to Medicus is gone from user-facing copy');
  check(/aria-multiselectable="true"/.test(canvas), 'pool groups expose a valid multiselectable listbox');
  check(/_roving/.test(canvas), 'roving tabindex tracks one tabbable option per group');
  check(/ArrowDown.*ArrowUp|ArrowUp.*ArrowDown/.test(canvas), 'Up/Down arrow keys move focus within a group');
  check(/updateStickyOffset/.test(canvas), 'sticky group offset is measured from the real rendered header height');
  check(/ms-lac-sticky-offset/.test(canvas), 'the measured offset is applied as a CSS custom property');
  check(/ms-lac-filter-axis-label/.test(canvas), 'Availability and Test filter axes carry explicit visual labels');
  check(/>Availability</.test(canvas) && />Test</.test(canvas), 'the two filter axis labels are present');
  check(
    /poolTestFacets\(board\.pool\.groups, 6, countingGroups\)/.test(canvas),
    'test chip counts intersect the live filter subset'
  );
  check(
    /body \|\| emptyPoolHtml\(pool\.count\)/.test(canvas) && !/Nothing left unallocated/.test(canvas),
    'the icon empty state is used consistently, not an alternate iconless branch'
  );
  check(
    /ms-lac-pool/.test(canvas) && /ms-lac-field/.test(canvas) && /ms-lac-chip/.test(canvas),
    'canvas is an unallocated pool plus clinician fields'
  );
  check(/Unallocated reports/.test(canvas), 'the large box is labelled Unallocated reports');
  check(/Ordered by/.test(canvas), 'group heads prefix Ordered by so surnames are not destinations');
  check(/already with them/.test(canvas), 'clinician fields count what already sits with them, distinct from planned');
  check(/planned here/.test(canvas), 'clinician fields separately count what is planned on this canvas');
  check(
    /they ordered still unallocated/.test(canvas),
    'clinician fields count what that person ordered but is unallocated'
  );
  check(
    /col\.count - \(col\.stagedCount \|\| 0\)/.test(canvas),
    'existing count subtracts the staged share back out of col.count'
  );
  check(/Already with them/.test(canvas), 'the expanded drawer labels the view-only existing rows');
  check(/Planned on this board/.test(canvas), 'the expanded drawer labels the staged rows separately');
  check(/>Planned</.test(canvas), 'planned tiles wear a Planned marker, not STAGED');
  check(!/>STAGED</.test(canvas), 'the old STAGED label is gone');
  check(!/ms-lac-pool-eyebrow/.test(canvas), 'the pool no longer wears a second Investigation reports eyebrow');
  check(/harvestStaffFromOverviews/.test(canvas), 'staff UUIDs are harvested even when requester is already known');
  check(/railSections/.test(canvas), 'Favourites then In today are sectioned on the rail');
  check(/filterPoolGroups/.test(canvas), 'the unallocated pile can be filtered');
  check(
    /id="ms-lac-select-visible">Select all shown/.test(canvas),
    'the toolbar keeps a single Select all shown action'
  );
  check(
    (canvas.match(/Select all shown/g) || []).length === 1,
    'Select all shown appears exactly once — the toolbar action, never repeated per group'
  );
  check(/labAllocate\.favourites/.test(canvas), 'favourites persist under labAllocate.favourites');
  check(/scrollNearEdge/.test(canvas), 'the rail scrolls while a drag is held over it');
  check(/Why reassignment is blocked/.test(canvas), 'a blocked reassignment is a visible action, not a dead button');
  check(
    /requestStage\(ids, key, btn\.closest/.test(canvas),
    'clicking a field stages the active selection — no drag needed'
  );
  check(/tabindex="0"/.test(canvas), 'tiles and group heads are keyboard focusable');
  check(/aria-selected/.test(canvas), 'selection state is exposed to assistive tech');
  check(/ms-lac-selectbar/.test(canvas), 'an active selection shows a visible count bar');
  check(/aria-label="Select ' \+/.test(canvas), 'group action carries an explicit aria-label naming the group');
  check(
    /'">Select ' \+[\s\S]{0,20}group\.count[\s\S]{0,20}'<\/button>'/.test(canvas),
    'group action button reads Select {N}'
  );
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
}

console.log('\n--- guide: help button, modal semantics, Escape, copy + dynamic-test wording ---');
{
  const fs = require('fs');
  const path = require('path');
  const canvas = fs.readFileSync(path.join(__dirname, 'content-scripts/lab-allocate-canvas.js'), 'utf8');
  const canvasCss = fs.readFileSync(path.join(__dirname, 'content-scripts/lab-allocate-canvas.css'), 'utf8');

  // A. a small, accessible help button that sits right before Close.
  check(/id="ms-lac-help"/.test(canvas), 'a help button exists in the canvas header');
  check(/aria-label="How to use lab allocation"/.test(canvas), 'the help button carries an explicit accessible name');
  check(
    /id="ms-lac-help"[\s\S]{0,260}id="ms-lac-close"/.test(canvas),
    'the help button sits immediately before Close in the header markup'
  );
  check(/>\?<\/button>/.test(canvas), 'the help button label is a literal question mark, not an emoji/icon');
  check(
    !/ms-lac-help[\s\S]{0,120}(emoji|❓|🛈|ℹ)/i.test(canvas),
    'the help button never uses an emoji or a second icon'
  );
  check(/\.ms-lac-help:hover/.test(canvasCss), 'the help button has a hover state');
  check(/\.ms-lac-help:active/.test(canvasCss), 'the help button has an active state');
  check(/\.ms-lac-help:focus-visible/.test(canvasCss), 'the help button has a visible focus ring');
  check(/\.ms-lac-help:disabled/.test(canvasCss), 'the help button has a disabled state, matching Close');
  const helpCssMatch = canvasCss.match(/\.ms-lac-help \{[\s\S]*?\.ms-lac-help:disabled \{[\s\S]*?\n\}/);
  check(!!helpCssMatch, 'the help button CSS block can be isolated for a tokens-only check');
  check(
    !!helpCssMatch && !/#[0-9a-fA-F]{3,6}/.test(helpCssMatch[0]),
    'the help button uses the scoped token block only, no new raw hex colours'
  );

  // B. a real, keyboard-contained modal dialog — board inert behind it.
  check(/function guideModalHtml/.test(canvas), 'the guide renders through its own builder');
  const guideTagMatch = canvas.match(/<div class="ms-lac-modal ms-lac-guide"[^>]*>/);
  check(!!guideTagMatch, 'the guide dialog element can be isolated for an attribute check');
  const guideTag = guideTagMatch ? guideTagMatch[0] : '';
  check(
    /role="dialog"/.test(guideTag) && /aria-modal="true"/.test(guideTag) && /id="ms-lac-guide-sheet"/.test(guideTag),
    'the guide dialog carries role="dialog" and aria-modal="true" on its own element'
  );
  check(/aria-labelledby="ms-lac-guide-heading"/.test(guideTag), 'the guide dialog is labelled via aria-labelledby');
  check(
    /id="ms-lac-guide-heading">How to use lab allocation</.test(canvas),
    'the guide has a visible heading matching that aria-labelledby target'
  );
  check(/id="ms-lac-guide-close">Close guide</.test(canvas), 'the guide offers an explicit Close guide action');
  check(
    /var sheet = document\.querySelector\('#' \+ OVERLAY_ID \+ ' #ms-lac-guide-sheet'\);\s*if \(sheet\) sheet\.focus\(\);/.test(
      canvas
    ),
    'opening the guide moves focus onto it'
  );
  check(/function closeGuide/.test(canvas), 'a dedicated closeGuide function returns focus to the planning board');
  check(/help\.focus\(\)/.test(canvas), 'closing the guide returns focus to the help button that opened it');
  check(
    /_confirmWrite \|\| _guideOpen \? ' inert' : ''/.test(canvas),
    'the planning board is marked inert while the guide is open, same treatment as the write-confirm modal'
  );
  check(
    (canvas.match(/_guideOpen = false;/g) || []).length >= 3,
    'guide state is explicitly reset on close, and again whenever the overlay opens/closes'
  );

  // Escape closes the guide back to the planning board, and takes priority
  // over the other Escape behaviours (filter clear, selection clear, close).
  check(
    /if \(e\.key === 'Escape'\) \{\s*e\.stopPropagation\(\);\s*if \(_writing\) return;\s*if \(_guideOpen\) \{\s*closeGuide\(\);\s*return;\s*\}/.test(
      canvas
    ),
    'Escape closes an open guide first, ahead of the confirm-write/filter/selection/close checks'
  );
  check(
    /e\.key === '\/' && !_guideOpen/.test(canvas),
    'the / search shortcut is disabled while the guide is open, so it can never send focus behind it'
  );

  // D. the footer's Copy working list action is explained, and accurately —
  // it must match LabAllocateCore.copyList's actual behaviour, not guesswork.
  check(
    /What “Copy working list” does<\/h4>/.test(canvas),
    'the guide has an explicit section headed What "Copy working list" does'
  );
  check(
    /plain-text snapshot of the whole board[\s\S]{0,40}clipboard[\s\S]{0,40}unallocated pool[\s\S]{0,40}sitting with clinicians[\s\S]{0,40}planned on this board/.test(
      canvas
    ),
    'the copy explanation names the unallocated pool, work already with clinicians, and staged moves'
  );
  check(
    /It does not write anything to Medicus\./.test(canvas),
    'the copy explanation is explicit that Copy working list never writes to Medicus'
  );
  check(
    /contains patient names, so only paste it into an approved practice system/.test(canvas),
    'the copy explanation names the clipboard patient-data boundary'
  );

  // E. test types are explained as dynamic/Medicus-sourced, never hard-coded.
  check(
    /Test names and counts come from the results queue Medicus returns/.test(canvas),
    'the guide explains that test names and counts come from the live Medicus results queue'
  );
  check(
    /filter chips show the most common test types in that queue/.test(canvas),
    'the guide explains the filter chips surface the most common test types from that queue'
  );
  check(
    /search matches any test name Medicus reports, chip or not/.test(canvas),
    'the guide explains search covers any Medicus-reported test name, not just the chip set'
  );

  // G. the guide itself never hard-codes an example clinical test name — the
  // rest of the codebase (fixtures, capture scripts) legitimately does, so
  // this check is scoped to the guide's own source, not the whole file.
  const guideFnMatch = canvas.match(/function guideModalHtml\(\)[\s\S]*?\n  \}/);
  check(!!guideFnMatch, 'guideModalHtml function body can be isolated for source inspection');
  const guideSrc = guideFnMatch ? guideFnMatch[0] : '';
  check(
    !/\b(FBC|TSH|U&E|LFT|TFT|CRP|HbA1c|Lipid Profile|Full Blood Count|Full Lipid Profile)\b/i.test(guideSrc),
    'the guide never hard-codes an example clinical test name'
  );
  check(!/\b(Done|Sent|Booked|Submitted|Allocated)\b/.test(guideSrc), 'the guide itself has no completion verbs');

  const guideCssMatch = canvasCss.match(/\/\* Guide —[\s\S]*?\n@media \(prefers-reduced-motion/);
  check(!!guideCssMatch, 'the guide CSS block can be isolated for a tokens-only check');
  check(
    !!guideCssMatch && !/#[0-9a-fA-F]{3,6}/.test(guideCssMatch[0]),
    'the guide content classes use the scoped token block only, no new raw hex colours'
  );
  check(
    /\.ms-lac-guide-steps/.test(canvasCss) &&
      /\.ms-lac-guide-subhead/.test(canvasCss) &&
      /\.ms-lac-guide-p/.test(canvasCss),
    'the guide has its own content classes, distinct from the write-confirm modal rows'
  );
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
    /If you confirm, 4 results will be reassigned to Dr Jane Cole/.test(copy) &&
      /may sit until that person is back/.test(copy),
    'allocation warning states the consequence of confirming the reassignment'
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
  const fromBook = C.harvestStaffDirectory([], {
    staffOptions: [
      { id: azadianId, name: 'Dr Natalie Azadian' },
      { value: coleId, label: 'Dr Jane Cole' },
    ],
  });
  check(fromBook.byId[azadianId] && fromBook.byId[coleId], 'today-book staffOptions populate the staff directory');
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

console.log('\n--- pool filter + favourites ---');
{
  const a = C.normaliseTaskRow(
    { id: uuid(1), patientName: 'A', assignedTo: 'Investigation Reports', requestedBy: 'AZADIAN N', summary: 'HbA1c' },
    'x'
  );
  const b = C.normaliseTaskRow(
    { id: uuid(2), patientName: 'B', assignedTo: 'Investigation Reports', requestedBy: 'NICHOLLS E', summary: 'U&E' },
    'x'
  );
  const groups = C.buildWorkspace([a, b], C.emptyDraft()).pool.groups;
  const byKey = {};
  groups.forEach((g) => {
    byKey[g.key] = /azadian/i.test(g.requester) ? 'in-today' : 'not-in-today';
  });
  const notIn = C.filterPoolGroups(groups, { presence: 'not-in-today' }, byKey);
  check(notIn.length === 1 && /nicholls/i.test(notIn[0].requester), 'not-in-today hides in-today requesters');
  const hba1c = C.filterPoolGroups(groups, { test: 'HbA1c' }, byKey);
  check(hba1c.length === 1 && hba1c[0].tiles[0].summary === 'HbA1c', 'test filter keeps matching rows');
  const q = C.filterPoolGroups(groups, { query: 'khan' }, byKey);
  check(q.length === 0, 'query that matches no patient empties the view');
  const facets = C.poolTestFacets(groups, 6);
  check(
    facets.some((f) => f.label === 'HbA1c' && f.count === 1),
    'test facets are derived from the loaded pile'
  );
  check(C.hiddenSelectedCount([a.id, b.id], [a.id]) === 1, 'hiddenSelectedCount names selected rows the filter hid');

  // poolTestFacets(groups, cap, countingGroups) — the base top-N choices come
  // from the full pile, but when a countingGroups intersection is supplied
  // the digit beside each chip reflects that narrower subset, not the base.
  const facetsNoCounting = C.poolTestFacets(groups, 6);
  check(
    facetsNoCounting.find((f) => f.label === 'HbA1c').count === 1 &&
      facetsNoCounting.find((f) => f.label === 'U&E').count === 1,
    'without countingGroups, counts come from the same groups as the choices (old call shape, backward compatible)'
  );
  const notInGroups = C.filterPoolGroups(groups, { presence: 'not-in-today' }, byKey);
  const facetsFiltered = C.poolTestFacets(groups, 6, notInGroups);
  check(
    facetsFiltered.find((f) => f.label === 'HbA1c').count === 0,
    'a countingGroups intersection that excludes a test zeroes its count, even though it is still a top-N choice'
  );
  check(
    facetsFiltered.find((f) => f.label === 'U&E').count === 1,
    'a test still present in the countingGroups intersection keeps its live count'
  );
  check(
    facetsFiltered
      .map((f) => f.label)
      .sort()
      .join(',') ===
      facetsNoCounting
        .map((f) => f.label)
        .sort()
        .join(','),
    'the top-N choice set itself does not reshuffle when only the counting subset narrows'
  );
  const emptyIntersection = C.poolTestFacets(groups, 6, []);
  check(
    emptyIntersection.every((f) => f.count === 0),
    'an empty countingGroups intersection zeroes every chip, but the chips themselves stay visible'
  );

  const key = C.clinicianColumnKey('Dr Natalie Azadian');
  const store = C.sanitiseFavouriteStore({ keys: [key, 'not-a-key', key] });
  check(store.keys.length === 1 && store.keys[0] === key, 'favourite store keeps unique clinician keys');
  const toggled = C.toggleFavouriteKey(store, key);
  check(toggled.keys.length === 0, 'toggling a favourite off removes it');
  check(C.isFavouriteKey(C.toggleFavouriteKey({ keys: [] }, key), key) === true, 'toggling on adds it');
  check(C.presenceBucket({ state: 'present', reason: 'in-today' }) === 'in-today', 'in-today buckets as in-today');
  check(C.presenceBucket({ state: 'unknown', reason: 'no-evidence' }) === 'not-in-today', 'unknown is not in today');
  check(C.FAVOURITE_STORE_KEY === 'labAllocate.favourites', 'favourites use the backup key');

  const io = require('./shared/io/lab-allocate-io.js');
  check(
    io.sanitiseFavouriteKeys(['clinician:azadian|n', 'pool', 'clinician:x']).length === 2,
    'IO drops non-clinician keys'
  );
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
