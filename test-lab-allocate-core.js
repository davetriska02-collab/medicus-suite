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
  const fromRow = C.pickRequesterFromTaskRow({
    requestedBy: 'TRISKA D',
    namedGp: 'Dr Registered GP',
    assignedTo: 'Investigation Reports',
  });
  check(fromRow && fromRow.name === 'TRISKA D', 'task-list requestedBy is who ordered');
  check(C.pickRequesterFromTaskRow({ namedGp: 'Dr Registered GP' }) === null, 'namedGp on the row is still not who ordered');
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
  check(reed.stagedCount === 1 && reed.assignedCount === 0, 'chip counts staged vs already-assigned separately');
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

console.log('\n--- write contract stays closed ---');
{
  const w = C.canWriteAllocations();
  check(w.ok === false, 'canWriteAllocations is false');
  check(/not been captured live/.test(w.reason), 'reason names the missing capture');
  const src = require('fs').readFileSync(require('path').join(__dirname, 'shared/lab-allocate-core.js'), 'utf8');
  check(!/method:\s*['"]POST['"]/.test(src), 'core has no POST');
  check(!/method:\s*['"]PUT['"]/.test(src), 'core has no PUT');
  check(!/method:\s*['"]PATCH['"]/.test(src), 'core has no PATCH');
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
  check(!/method:\s*['"]POST['"]/.test(canvas), 'canvas has no POST');
  check(!/\.click\(\)/.test(canvas), 'canvas does not synthesise Medicus clicks');
  check(/Write to Medicus — not available/.test(canvas), 'Finalise control is visibly unavailable');
  check(!/\b(Done|Sent|Booked|Submitted|Allocated)\b/.test(canvas), 'canvas copy has no completion verbs');
  check(/not confirmed as the requester/.test(canvas), 'named GP caption refuses to claim who ordered');
  check(/Absence check before staging/.test(canvas), 'clinician drop always offers an absence check');
  check(/loadRotaAbsences/.test(canvas), 'canvas reads rota.leave before allocation');
  check(/ms-lac-pool/.test(canvas) && /ms-lac-chip/.test(canvas), 'canvas is a reports pool plus clinician chips');
  check(!/Add clinician column/.test(canvas), 'clinicians are chips, not full columns');
  const capture = fs.readFileSync(path.join(__dirname, 'scripts/staff-scheduling-capture.js'), 'utf8');
  check(/staff-scheduling SCOPING capture/.test(capture), 'staff-scheduling capture script is present');
  check(!/method:\s*['"]POST['"]/.test(capture), 'staff-scheduling capture does not POST');
  check(
    /embedded-overview/.test(capture),
    'staff-scheduling capture may re-read the confirmed appointment-book overview'
  );
  const reqCap = fs.readFileSync(path.join(__dirname, 'scripts/lab-requester-capture.js'), 'utf8');
  check(/REQUESTED-BY SCOPING capture/.test(reqCap), 'requester capture script is present');
  check(!/method:\s*['"]POST['"]/.test(reqCap), 'requester capture does not POST');
  check(!/Absence unknown<\/span>/.test(canvas), 'chips do not wear Absence unknown as a standing badge');
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
    C.shouldWarnAbsence(C.absenceForName([], [], 'Dr Jane Cole', '2026-08-25')) === true,
    'empty rota still warns — absence unknown'
  );
  check(
    C.shouldWarnAbsence(C.absenceForName(staff, [], 'Dr Reed', '2026-08-25')) === true,
    'unmatched name still warns — absence unknown'
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

async function testClient() {
  console.log('\n--- createClient GET-only fetch ---');
  const calls = [];
  const client = C.createClient('https://e38a9f.api.england.medicus.health', {
    fetchImpl: async (url, opts) => {
      calls.push({ url: url, method: opts.method });
      return {
        ok: true,
        status: 200,
        text: async function () {
          return JSON.stringify({
            tasks: [
              {
                id: uuid(1),
                patientName: 'A',
                assignedTo: 'Results',
                overviewURL: '/tasks/data/review-investigation-report/overview/' + uuid(1),
              },
            ],
          });
        },
      };
    },
  });
  const out = await client.fetchTaskList('review-investigation-report');
  check(out.rows.length === 1, 'client maps the task-list');
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
