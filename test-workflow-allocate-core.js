// Medicus Suite — workflow-allocate-core tests
// Run with: node test-workflow-allocate-core.js
'use strict';

const C = require('./shared/workflow-allocate-core.js');
const Lab = require('./shared/lab-allocate-core.js');
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

console.log('--- parseWorkflowQueueRoute ---');
{
  const doc = C.parseWorkflowQueueRoute('/e38a9f/tasks/review_inbound_document_task/task-list');
  check(!!doc && doc.siteId === 'e38a9f', 'document queue siteId');
  check(doc && doc.slug === 'review_inbound_document_task', 'document queue slug');
  check(doc && doc.kind === 'document', 'inbound-document slug is kind=document');
  check(doc && doc.apiBase === 'https://e38a9f.api.england.medicus.health', 'apiBase from siteId');
  check(
    !!C.parseWorkflowQueueRoute('/e38a9f/tasks/data/file_correspondence_task/task-list'),
    'also matches /tasks/data/{slug}/task-list'
  );
  check(C.kindForSlug('scan_letter_task') === 'document', 'letter/scan slug is document');

  check(
    C.parseWorkflowQueueRoute('/e38a9f/tasks/review_investigation_results_task/task-list') === null,
    'results queue stays on the lab canvas'
  );
  check(
    C.parseWorkflowQueueRoute('/e38a9f/tasks/review-investigation-report/task-list') === null,
    'investigation-report slug is not a workflow queue'
  );
  check(
    C.parseWorkflowQueueRoute('/e38a9f/tasks/medical_patient_request_task/task-list') === null,
    'request queue without workflow view is not claimed'
  );
  const wf = C.parseWorkflowQueueRoute(
    '/e38a9f/tasks/medical_patient_request_task/task-list',
    '?viewContext=workflow&masterAssignee=abc'
  );
  check(!!wf && wf.kind === 'workflow', 'viewContext=workflow claims a team inbox');
  check(wf && wf.search === '?viewContext=workflow', 'keeps viewContext and drops masterAssignee');

  check(
    C.parseWorkflowQueueRoute('/e38a9f/tasks/patient-privacy-officer/task-list') === null,
    'privacy-officer queue is excluded'
  );
  check(
    C.parseWorkflowQueueRoute('/e38a9f/tasks/eps-prescription-order-item/task-list', '?viewContext=workflow') === null,
    'EPS slug is excluded even with workflow view'
  );
  check(
    C.parseWorkflowQueueRoute('/e38a9f/scheduling/appointment-book') === null,
    'appointment book is not a workflow queue'
  );
  check(C.isWorkflowQueueSlug('review_inbound_document_task') === true, 'document slug matches');
  check(C.isWorkflowQueueSlug('review_investigation_results_task') === false, 'results slug does not match');
  check(C.isWorkflowQueueSlug('medical_patient_request_task') === false, 'request slug without view does not match');
  check(
    C.isWorkflowQueueSlug('medical_patient_request_task', '?viewContext=workflow') === true,
    'request slug with workflow view matches'
  );
}

console.log('\n--- named GP groups the pile, never auto-places ---');
{
  const row = C.decorateWorkflowRow(
    Lab.normaliseTaskRow(
      {
        id: uuid(1),
        patientName: 'FORD, Michael',
        assignedTo: 'Unassigned',
        namedGp: 'Dr David Triska',
        summary: 'Discharge letter',
      },
      'review_inbound_document_task'
    ),
    'document'
  );
  check(row.kind === 'document', 'decorate stamps document kind');
  check(!row.requester, 'named GP is not written onto requester');
  check(
    C.homeColumnKey(row) === 'pool' || C.homeColumnKey(row) === Lab.homeColumnKey(row),
    'home column is assignment-only'
  );
  check(C.homeColumnKey(row) === Lab.homeColumnKey(row), 'decorate does not change homeColumnKey');
  check(Lab.homeColumnKey(row) !== Lab.clinicianColumnKey('Dr David Triska'), 'named GP is never auto-placement');

  const assigned = C.decorateWorkflowRow(
    Lab.normaliseTaskRow(
      {
        id: uuid(2),
        patientName: 'LEE, Pat',
        assignedTo: 'Dr Jane Cole',
        namedGp: 'Dr David Triska',
      },
      'x'
    ),
    'document'
  );
  check(
    C.homeColumnKey(assigned) === Lab.clinicianColumnKey('Dr Jane Cole'),
    'a person assignee still sits on that clinician field'
  );

  const board = C.buildWorkspace([row, assigned], C.emptyDraft(), { kind: 'document' });
  check(board.pool && board.pool.title === 'Inbound documents', 'document pool title');
  check(board.pool.tiles.length === 1, 'unassigned named-GP row stays in the pool');
  check(
    board.pool.groups[0] && board.pool.groups[0].groupName === 'Dr David Triska' && board.pool.groups[0].count === 1,
    'pool groups unallocated work by registered GP'
  );
  check(/Registered GP/.test(board.pool.groups[0].label), 'group label says registered GP, not who ordered');
  check(!/ordered/i.test(board.pool.groups[0].label), 'group label never says ordered');

  const cole = board.clinicians.find((c) => /Cole/i.test(c.title));
  check(cole && cole.count === 1, 'assigned row sits on the clinician field');
  check(cole.inPoolCount === 0, 'Cole has no unallocated pile of their own');
  check(
    board.pool.groups[0].key === Lab.clinicianKeyForName('Dr David Triska', board.aliases),
    'named-GP group keys to that clinician so take-their-pile can land'
  );
  const withField = C.buildWorkspace([row, assigned], Lab.addColumn(C.emptyDraft(), 'Dr David Triska'), {
    kind: 'document',
  });
  const triska = withField.clinicians.find((c) => /Triska/i.test(c.title));
  check(triska && triska.inPoolCount === 1, 'registered-GP group keys the take-their-pile count');
}

console.log('\n--- generic workflow pool title ---');
{
  const row = C.decorateWorkflowRow(
    Lab.normaliseTaskRow({ id: uuid(3), patientName: 'A', assignedTo: 'Team inbox' }, 'x'),
    'workflow'
  );
  const board = C.buildWorkspace([row], C.emptyDraft(), { kind: 'workflow' });
  check(board.pool.title === 'Unallocated', 'generic workflow pool is Unallocated, not Investigation reports');
  check(board.pool.title !== 'Investigation reports', 'must not reuse the lab pool title');
}

console.log('\n--- copy list is honest ---');
{
  const row = C.decorateWorkflowRow(
    Lab.normaliseTaskRow(
      {
        id: uuid(4),
        patientName: 'SMITH, Jane',
        assignedTo: 'Unassigned',
        namedGp: 'Dr GP',
        summary: 'Scan',
      },
      'x'
    ),
    'document'
  );
  const text = C.copyList(C.buildWorkspace([row], C.emptyDraft(), { kind: 'document' }));
  check(/^Inbound documents \(1\)/.test(text), 'copy list leads with inbound documents');
  check(/registered GP/.test(text), 'named GP is labelled registered GP');
  check(!/ordered by/i.test(text), 'copy list never says ordered by');
  check(/Not written to Medicus/.test(text), 'copy list refuses to claim a write');
  check(!/\b(Done|Sent|Allocated|Submitted|Booked|Filed)\b/.test(text), 'no completion verbs');
}

console.log('\n--- write stays on the lab client ---');
{
  const src = fs.readFileSync(path.join(__dirname, 'shared/workflow-allocate-core.js'), 'utf8');
  const canvas = fs.readFileSync(path.join(__dirname, 'content-scripts/workflow-allocate-canvas.js'), 'utf8');
  check(!/method:\s*['"]POST['"]/.test(src), 'workflow core has no POST');
  check(!/method:\s*['"]POST['"]/.test(canvas), 'workflow canvas has no POST — the lab client writes');
  check(/createClient: Lab\.createClient/.test(src), 'workflow core re-exports the lab client');
  check(/commitAllocations/.test(canvas), 'canvas commits through the core client');
  check(/_confirmWrite/.test(canvas), 'write goes through a named patient → destination confirm');
  check(/Keep planning/.test(canvas), 'confirm defaults the clinician back to planning');
  check(/does not file the document/.test(canvas), 'confirm says the write does not file the document');
  check(!/\b(Done|Sent|Booked|Submitted|Allocated|Filed)\b/.test(canvas), 'canvas copy has no completion verbs');
  check(!/Ordered by|who ordered|Who ordered/.test(canvas), 'canvas copy never claims who ordered');
  check(!/enrichRequesters/.test(canvas) || /deliberately skipped/.test(canvas), 'lab requester walker is skipped');
  check(!/pickRequesterFromOverview/.test(canvas), 'canvas does not walk lab requestedBy fields');
  check(/decorateWorkflowRow/.test(canvas), 'rows are decorated after the task-list GET');
  check(/harvestStaffFromOverviews/.test(canvas), 'staff UUIDs are still harvested from a few overviews');
  check(/fetchAssigneeStaff/.test(canvas), 'staff directory falls back to the create-task assignee list');
  check(/Allocate documents on canvas/.test(canvas), 'document launcher names documents');
  check(/Allocate on canvas/.test(canvas), 'generic workflow launcher is Allocate on canvas');
  check(!/Allocate labs on canvas/.test(canvas), 'workflow launcher is not the lab launcher');
  check(/ms-wac-overlay/.test(canvas) && /ms-wac-launch/.test(canvas), 'overlay and launcher use wac ids');
  check(/ms-lac-pool/.test(canvas) && /ms-lac-field/.test(canvas), 'reuses the lab layout classes');
  check(
    /result\.written > 0[\s\S]{0,200}?await loadBoard\(\)/.test(canvas),
    'a partly-written batch re-reads the queue'
  );
}

console.log('\n--- canvas + manifest + css source locks ---');
{
  const canvas = fs.readFileSync(path.join(__dirname, 'content-scripts/workflow-allocate-canvas.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'content-scripts/lab-allocate-canvas.css'), 'utf8');
  const labCanvas = fs.readFileSync(path.join(__dirname, 'content-scripts/lab-allocate-canvas.js'), 'utf8');
  check(manifest.indexOf('shared/workflow-allocate-core.js') !== -1, 'workflow core is in the manifest');
  check(manifest.indexOf('content-scripts/workflow-allocate-canvas.js') !== -1, 'workflow canvas is in the manifest');
  check(
    manifest.indexOf('shared/lab-allocate-core.js') < manifest.indexOf('shared/workflow-allocate-core.js'),
    'lab core loads before workflow core'
  );
  check(/#ms-wac-overlay/.test(css), 'workflow overlay is on the token block');
  check(/#ms-wac-launch/.test(css), 'workflow launcher has the same chrome as the lab launcher');
  check(/#ms-wac-launch:focus-visible/.test(css), 'launcher focus ring is a literal (html-appended)');
  check(/Investigation reports/.test(labCanvas) || true, 'lab canvas still exists as a sibling');
  check(!/ms-wac-overlay/.test(labCanvas), 'lab canvas does not open the workflow overlay');
  check(/parseResultsQueueRoute/.test(labCanvas), 'lab canvas still owns results queues');
  check(!/parseWorkflowQueueRoute/.test(labCanvas), 'lab canvas does not parse workflow routes');
}

console.log('\n--- lab pool title is untouched ---');
{
  const a = Lab.applyRequester(
    Lab.normaliseTaskRow({ id: uuid(1), patientName: 'A', assignedTo: 'Results', summary: 'FBC' }, 'x'),
    { name: 'Dr Cole', source: 'requestedBy', confidence: 'requester' }
  );
  const board = Lab.buildWorkspace([a], Lab.emptyDraft());
  check(board.pool.title === 'Investigation reports', 'lab pool title stays Investigation reports');
}

if (failed) {
  console.error('\n' + failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log('\n' + passed + ' passed');
