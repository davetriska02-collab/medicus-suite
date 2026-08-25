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
  check(C.isTeamAssignee('Dr Jane Cole') === false, 'a named doctor is not a team');
  check(C.homeColumnKey(person) === C.clinicianColumnKey('Dr Jane Cole'), 'person assignee homes to that clinician');
  check(C.placementReason(person) === 'current-assignee', 'no requester → current-assignee, not who-ordered');

  const inbox = C.normaliseTaskRow(
    { id: uuid(2), patientName: 'PATEL, Ali', assignedTo: 'Results', namedGp: 'Dr Registered GP' },
    'review-investigation-report'
  );
  check(C.homeColumnKey(inbox).indexOf('inbox:') === 0, 'team assignee homes to inbox column');
  check(C.placementReason(inbox) === 'inbox', 'inbox reason');
  check(inbox.namedGp === 'Dr Registered GP', 'named GP kept as a hint only');
}

console.log('\n--- requester placement never uses named GP ---');
{
  const row = C.normaliseTaskRow(
    { id: uuid(3), patientName: 'LEE, Pat', assignedTo: 'Results', namedGp: 'Dr Registered GP' },
    'review-investigation-report'
  );
  C.applyRequester(row, { name: 'Dr David Triska', source: 'requestedBy', confidence: 'requester' });
  check(C.homeColumnKey(row) === C.clinicianColumnKey('Dr David Triska'), 'requester wins over inbox + named GP');
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
  const board0 = C.buildBoard([a, b], C.emptyDraft());
  const titles = board0.columns.map((c) => c.title);
  check(titles[0] === 'Unallocated', 'Unallocated is first');
  check(titles.indexOf('Results') !== -1, 'inbox column present');
  check(titles.indexOf('Dr Cole') !== -1, 'requester column present');
  const cole = board0.columns.find((c) => c.title === 'Dr Cole');
  check(cole && cole.tiles.length === 1 && cole.tiles[0].patientName === 'A', 'requester tile auto-placed');
  const inbox = board0.columns.find((c) => c.title === 'Results');
  check(inbox && inbox.tiles.some((t) => t.patientName === 'B'), 'unknown requester stays in the inbox');

  let draft = C.addColumn(C.emptyDraft(), 'Dr Reed');
  draft = C.stageMove(draft, b.id, C.clinicianColumnKey('Dr Reed'));
  const board1 = C.buildBoard([a, b], draft);
  const reed = board1.columns.find((c) => c.title === 'Dr Reed');
  check(reed && reed.tiles.length === 1 && reed.tiles[0].staged === true, 'drag stages onto a new clinician column');
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

testClient()
  .then(function () {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    if (failed) process.exit(1);
  })
  .catch(function (err) {
    console.error(err);
    process.exit(1);
  });
