// Medicus Suite — request-allocate-core tests
// Run with: node test-request-allocate-core.js
'use strict';

const C = require('./shared/request-allocate-core.js');
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

function row(n, extra) {
  return C.decorateRequestRow(
    Lab.normaliseTaskRow(
      Object.assign(
        {
          id: uuid(n),
          patientName: 'PATIENT ' + n,
          assignedTo: 'Unassigned',
          summary: 'Sore throat',
        },
        extra || {}
      ),
      'medical_patient_request_task'
    ),
    'medical'
  );
}

console.log('--- parseRequestQueueRoute ---');
{
  const med = C.parseRequestQueueRoute(
    '/e38a9f/tasks/medical_patient_request_task/task-list',
    '?statuses[]=new-request&viewContext=homepage&masterAssignee=' + uuid(1)
  );
  check(!!med && med.slug === 'medical_patient_request_task', 'medical homepage is claimed');
  check(med && /masterAssignee=/.test(med.search), 'medical inbox keeps masterAssignee');
  check(med && med.admin !== true, 'medical is not admin');
  const admin = C.parseRequestQueueRoute('/e38a9f/tasks/admin_patient_request_task/task-list');
  check(!!admin && admin.admin === true, 'admin request list is claimed');
  check(
    C.parseRequestQueueRoute(
      '/e38a9f/tasks/medical_patient_request_task/task-list',
      '?viewContext=workflow&masterAssignee=' + uuid(1)
    ) === null,
    'viewContext=workflow stays on the workflow canvas'
  );
  check(
    !!Wf.parseWorkflowQueueRoute(
      '/e38a9f/tasks/medical_patient_request_task/task-list',
      '?viewContext=workflow&masterAssignee=' + uuid(1)
    ),
    'workflow canvas still claims the workflow view of medical requests'
  );
  check(
    C.parseRequestQueueRoute('/e38a9f/tasks/prescription_request_task_non_routine/task-list') === null,
    'Rx queue stays on the rx canvas'
  );
  check(
    C.parseRequestQueueRoute('/e38a9f/tasks/review_investigation_results_task/task-list') === null,
    'results stay on the lab canvas'
  );
  check(
    C.parseRequestQueueRoute('/e38a9f/tasks/eps_subsequent_cancellation_task/task-list') === null,
    'EPS cancellation list is not the request canvas'
  );
  check(
    C.parseRequestQueueRoute('/e38a9f/tasks/patient_privacy_officer_alert_task/task-list') === null,
    'privacy officer list is not the request canvas'
  );
  check(
    C.parseRequestQueueRoute('/e38a9f/tasks/medical-patient-request-task/task-list') &&
      C.parseRequestQueueRoute('/e38a9f/tasks/data/medical_patient_request_task/task-list'),
    'hyphen twin and /tasks/data/ medical request lists are claimed'
  );
  check(
    C.parseRequestQueueRoute('/e38a9f/tasks/admin_patient_request_task/task-list', '?viewContext=workflow') === null,
    'admin workflow view stays on the workflow canvas'
  );
}

console.log('\n--- inbox pile ---');
{
  const boxId = uuid(9);
  const inBox = row(1, { assignedTo: 'Dr Jane Cole', assignedId: boxId });
  const marked = C.markInboxRows([inBox], '?viewContext=homepage&masterAssignee=' + boxId, 'medical');
  check(marked[0].requestInboxPile === true, 'page-inbox rows are the pile');
  check(C.isRequestUnallocated(marked[0]) === true, 'inbox rows are unallocated for the split');
  check(Lab.homeColumnKey(marked[0]) === Lab.POOL, 'inbox rows sit in the unallocated list');
  const sitting = row(2, { assignedTo: 'Dr Dave Triska', assignedId: uuid(2) });
  check(C.isRequestUnallocated(sitting) === false, 'already-sitting work is not in the split');
}

console.log('\n--- named GP is a caption ---');
{
  const r = row(3, { namedGp: 'Dr Dave Triska', assignedTo: 'Unassigned' });
  check(C.requestGroupName(r) === 'Dr Dave Triska', 'group uses named GP when no requester');
  check(Lab.homeColumnKey(r) === Lab.POOL, 'named GP never auto-places');
}

console.log('\n--- even split ---');
{
  const dests = Lab.asSplitDests([
    { name: 'Dr A', staffId: uuid(1) },
    { name: 'Dr B', staffId: uuid(2) },
  ]);
  const pile = [row(1), row(2), row(3)];
  const plan = C.planEvenSplit(pile, dests);
  check(plan.ok && plan.total === 3, 'split of 3 unallocated is ok');
  check(
    plan.shares
      .map((s) => s.count)
      .sort()
      .join(',') === '1,2',
    'counts differ by at most one'
  );
  const sitting = row(4, { assignedTo: 'Dr A' });
  const mixed = C.planEvenSplit([row(5), sitting], dests);
  check(mixed.total === 1, 'sitting work is not in Split equally');
}

console.log('\n--- write is fail-closed ---');
{
  check(C.REQUEST_WRITE_CAPTURED === false, 'capture flag is off');
  const gate = C.canWriteRequestAllocations({
    taskList: 'medical_patient_request_task',
    slug: 'medical_patient_request_task',
  });
  check(gate.ok === false && /not captured/i.test(gate.reason), 'Write is blocked until a dummy capture exists');
  const gated = C.requestGatedWriteCopy({ count: 47 });
  check(gated.reviewButton === 'Review plan (47)', 'gated primary button is Review plan (N)');
  check(
    gated.reviewHeadline === 'This is a plan on this canvas only. Medicus has not changed.',
    'review headline says Medicus has not changed'
  );
  check(/checked on a test patient/.test(gated.reviewBody), 'review body names the capture gap');
  check(!gated.writeButton && gated.hideWrite === true, 'gated copy hides Write entirely');
  check(gate.hideWrite === true && !gate.writeButton, 'canWriteRequestAllocations hides Write while gated');
  check(gate.reviewHeadline === gated.reviewHeadline, 'canWriteRequestAllocations carries the headline');
  const src = fs.readFileSync(path.join(__dirname, 'shared/request-allocate-core.js'), 'utf8');
  check(!/\bmethod:\s*['"]POST['"]/.test(src), 'request core has no POST');
}

console.log('\n--- copy ban ---');
{
  const board = C.buildWorkspace([row(1)], C.emptyDraft(), {});
  const copy = C.copyList(board);
  check(/Not written to Medicus/.test(copy), 'copy list refuses to claim a write');
  check(!/\b(Done|Sent|Allocated|Submitted|Filed)\b/.test(copy), 'no completion verbs');
}

console.log('\n--- pool titles ---');
{
  check(C.poolTitle({}) === 'Medical requests', 'medical pool title');
  check(C.poolTitle({ admin: true }) === 'Admin requests', 'admin pool title');
}

console.log('\n--- canvas + manifest source locks ---');
{
  const canvasPath = path.join(__dirname, 'content-scripts/request-allocate-canvas.js');
  check(fs.existsSync(canvasPath), 'canvas file exists');
  const canvas = fs.readFileSync(canvasPath, 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  const coreMark = 'shared/request-allocate-core.js';
  const canvasMark = 'content-scripts/request-allocate-canvas.js';
  const coreIdx = manifest.indexOf(coreMark);
  const canvasIdx = manifest.indexOf(canvasMark);
  check(canvasIdx !== -1, 'canvas is in the manifest');
  check(coreIdx !== -1 && canvasIdx > coreIdx, 'canvas is after request-allocate-core');
  const between = coreIdx === -1 || canvasIdx === -1 ? '' : manifest.slice(coreIdx + coreMark.length, canvasIdx);
  check(!/content-scripts\//.test(between), 'canvas is immediately after request-allocate-core');
  check(!/\bmethod:\s*['"]POST['"]/.test(canvas), 'canvas has no POST');
  check(!/\bfetch\s*\(/.test(canvas), 'canvas never fetches');
  check(/Draft a split of this inbox/.test(canvas), 'launcher names the inbox');
  check(/Nothing is written\. Opens a planning board\./.test(canvas), 'launcher title is fail-closed');
  check(/ms-qac-overlay/.test(canvas) && /ms-qac-launch/.test(canvas), 'overlay and launcher use qac ids');
  check(/Write not captured for this queue yet/.test(canvas), 'write-closed copy is on the canvas');
  check(/canWriteRequestAllocations/.test(canvas), 'write path consults the request gate before commit');
  check(
    /function commitWrite[\s\S]*canWriteRequestAllocations[\s\S]*if \(!gate\.ok\)[\s\S]*return;[\s\S]*commitAllocations/.test(
      canvas
    ),
    'commitWrite returns before commitAllocations when the gate fails'
  );
  check(
    /destSetStripHtml/.test(canvas) && /ms-ags-in-today/.test(canvas),
    'dest-set strip / Working today is on the canvas'
  );
  check(/id="ms-lac-finalise"/.test(canvas), 'Review plan stays on the canvas while Write is blocked');
  check(/Review plan/.test(canvas), 'gated write primary control is Review plan');
  check(/requestGatedWriteCopy/.test(canvas), 'canvas uses the gated-write copy helper');
  check(/function applyPileSplit[\s\S]{0,500}planEvenSplit/.test(canvas), 'request Split equally binds planEvenSplit');
  check(/function applyTopUp[\s\S]{0,500}planTopUp/.test(canvas), 'request Top up binds planTopUp');
  check(
    /OVERVIEW_CAP/.test(canvas) && /OVERVIEW_CONCURRENCY/.test(canvas),
    'staff harvest uses the bounded overview pool'
  );
  check(/ms-ags-marquee/.test(canvas), 'people can be encircled into a group');
  check(/lastUsedBySurface\.request/.test(canvas), 'last-used dest set is the request surface');
  check(/allocationGroups\.staffCache/.test(canvas), 'harvested staff is saved for Options');
  check(
    /does not complete, file, or reply to the request/.test(canvas),
    'confirm says the write does not complete the request'
  );
  check(
    /Keep planning/.test(canvas) && /Write to Medicus/.test(canvas),
    'confirm is Keep planning vs Write to Medicus'
  );
  check(!/Write to Medicus \(not yet available/.test(canvas), 'gated review does not show a Write control');
  check(/writeGo = writeGate\.ok[\s\S]{0,400}: ''/.test(canvas), 'Write button is omitted while the gate is closed');
  check(/fetchRequestMergedTaskList/.test(canvas), 'Write vanish-check re-GETs inbox plus sitting work');
  check(/requireSitting:\s*true/.test(canvas), 'Write vanish-check fails closed if sitting GET throws');
  check(/replaceDestColumns/.test(canvas), 'request dest-set change replaces leftover columns');
  check(/setData\('text\/plain', 'people:'/.test(canvas), 'people-drag uses a people: payload');
  check(/indexOf\('people:'\) === 0/.test(canvas), 'people: payload is not staged as a task id');
  check(/ms-rxac-folder-head/.test(canvas), 'marquee hit-tests folder heads, not patient tiles');
  check(/id="ms-lac-finalise"/.test(canvas), 'Review then write stays on the canvas while Write is blocked');
  check(/'Review plan \('/.test(canvas), 'canvas source includes Review plan (N) fallback');
  check(/saveGroupRowHtml/.test(canvas), 'request Save as group uses the on-canvas name field');
  check(
    /ms-ags-all-panel/.test(canvas) && /data-ags-always/.test(canvas),
    'request All groups panel can edit schedule'
  );
  check(/refusedPatientsPhrase/.test(canvas), 'request confirm names refused patients');
  check(/REQUEST_WRITE_CAPTURE_COPY/.test(canvas), 'capture-gap copy is clinician English');
  check(
    /createClient[\s\S]{0,400}canWriteRequestAllocations/.test(
      fs.readFileSync(path.join(__dirname, 'shared/request-allocate-core.js'), 'utf8')
    ),
    'request createClient wraps commitAllocations with the capture gate'
  );
  check(/parseRequestQueueRoute/.test(canvas), 'canvas owns the request route');
  check(
    /if \(!_open\) _route = route/.test(canvas),
    'open overlay pins _route so ensureLauncher cannot clobber search'
  );
  check(!/\b(Done|Sent|Allocated|Submitted|Filed|Replied)\b/.test(canvas), 'canvas copy has no completion verbs');
  check(/ms-rxac-reviewing/.test(canvas), 'review-open puts a reviewing class on the panel');
  check(
    /if \(inboxEmpty\)[\s\S]{0,400}kind !== 'team'[\s\S]{0,200}tiles && col\.tiles\.length/.test(canvas),
    'empty leftover team folders drop out of the after-split dest grid'
  );
  const css = fs.readFileSync(path.join(__dirname, 'content-scripts/lab-allocate-canvas.css'), 'utf8');
  check(
    /#ms-qac-overlay \.ms-rxac-folders[\s\S]{0,160}minmax\(280px/.test(css),
    'request dest-grid cards are at least 280px wide'
  );
  check(
    /#ms-qac-overlay \.ms-rxac-board-clear \.ms-rxac-folders \.ms-rxac-folder[\s\S]{0,200}max-height:\s*none/.test(css),
    'after-split dest cards are not height-capped to the board'
  );
  check(
    /#ms-qac-overlay \.ms-lac-panel\.ms-rxac-reviewing \.ms-lac-body[\s\S]{0,200}display:\s*none/.test(css),
    'review-open hides the board so the proposal list is the page'
  );
  check(
    !/#ms-qac-overlay \.ms-rxac-review-open \{[\s\S]{0,180}max-height:\s*36vh/.test(css),
    'request review list is not height-capped to 36vh'
  );
  check(/No one is on the book for this day/.test(canvas), 'cold-start empty book names the book and add-a-name');
  check(/destFlagLabel/.test(canvas) && /destFlagHtml/.test(canvas), 'dest-person flag follows the dest set');
}

console.log('\n--- ' + passed + ' passed, ' + failed + ' failed ---');
if (failed) process.exit(1);
