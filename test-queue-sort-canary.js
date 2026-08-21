// Medicus Suite — queue sort canary tests (audit H6)
// Run with: node test-queue-sort-canary.js
//
// The rowIndex→taskUuid maps that key every fetch-driven queue chip
// (result / monitoring / patient-flag) are built from the bridge's task-list
// payload. A CLIENT-side AG-Grid sort reassigns row-index attributes without a
// new fetch, so a chip re-injected by rowIndex would land on the WRONG
// patient's row. The canary drops both maps whenever the grid's sort state
// changes; a server-side sort re-fetches and rebuilds them, a client-side
// sort leaves chips safely absent.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'triage-lens', 'content.js'), 'utf8');

// ============================================================
// Layer 1 — functional: extract queueSortSignature + checkQueueSortCanary
// ============================================================
console.log('Layer 1: canary behaviour (extracted functions)');

const sigMatch = src.match(/const queueSortSignature = \(\) => \{[\s\S]*?\n  \};/);
const canaryMatch = src.match(/const checkQueueSortCanary = \(\) => \{[\s\S]*?\n  \};/);
check(!!sigMatch, 'queueSortSignature found in content.js');
check(!!canaryMatch, 'checkQueueSortCanary found in content.js');

if (sigMatch && canaryMatch) {
  // Fake sorted-header cells: [colId, dir] pairs → objects shaped like DOM cells
  const makeCells = (pairs) =>
    pairs.map(([colId, dir]) => ({
      getAttribute: (a) => (a === 'col-id' ? colId : null),
      classList: { contains: (c) => c === `ag-header-cell-sorted-${dir}` },
    }));

  const sandbox = {
    _cells: [],
    _filterCells: [],
    _logs: [],
    _queueRowUuids: new Map(),
    _durableRowMap: new Map(),
    _pulseActByRow: new Map(),
    queueScope: () => ({
      querySelectorAll: (sel) => (String(sel).includes('filtered') ? sandbox._filterCells : sandbox._cells),
    }),
    log: (m) => sandbox._logs.push(m),
  };
  vm.runInNewContext(
    'let _queueSortSig;\n' +
      sigMatch[0] +
      '\n' +
      canaryMatch[0] +
      '\nthis.run = checkQueueSortCanary;' +
      '\nthis.sig = queueSortSignature;' +
      '\nthis.reset = () => { _queueSortSig = undefined; };' +
      '\nthis.getSig = () => _queueSortSig;',
    sandbox
  );

  const seed = () => {
    sandbox._queueRowUuids.set(0, 'aaaaaaaa-0000-0000-0000-000000000000');
    sandbox._durableRowMap.set(0, 'aaaaaaaa-0000-0000-0000-000000000000');
    sandbox._pulseActByRow.set(0, { pathway: { title: 'stale' } });
  };

  // Unsorted grid → empty signature
  sandbox._cells = [];
  check(sandbox.sig() === '', 'unsorted grid produces empty signature');

  // Signature is order-independent and encodes col + direction
  sandbox._cells = makeCells([
    ['patientName', 'asc'],
    ['dueDate', 'desc'],
  ]);
  const s1 = sandbox.sig();
  sandbox._cells = makeCells([
    ['dueDate', 'desc'],
    ['patientName', 'asc'],
  ]);
  check(sandbox.sig() === s1, 'signature is stable across header-cell DOM order');
  check(s1.includes('patientName:asc') && s1.includes('dueDate:desc'), 'signature encodes col-id and direction');

  // First run establishes a baseline WITHOUT dropping the maps
  sandbox.reset();
  seed();
  sandbox._cells = makeCells([['dueDate', 'desc']]);
  sandbox.run();
  check(sandbox._durableRowMap.size === 1, 'baseline run does not drop the durable map');
  check(sandbox._queueRowUuids.size === 1, 'baseline run does not drop _queueRowUuids');

  // Unchanged sort state → maps kept
  sandbox.run();
  check(sandbox._durableRowMap.size === 1, 'unchanged sort state keeps the maps');

  // Sort state CHANGES → both maps dropped
  sandbox._cells = makeCells([['patientName', 'asc']]);
  sandbox.run();
  check(sandbox._durableRowMap.size === 0, 'sort change drops _durableRowMap');
  check(sandbox._queueRowUuids.size === 0, 'sort change drops _queueRowUuids');
  check(sandbox._pulseActByRow.size === 0, 'sort change drops _pulseActByRow (stale Act tray)');
  check(
    sandbox._logs.some((m) => /sort(?:\/filter)? change/.test(m)),
    'sort change is logged'
  );

  // Direction flip on the same column is a change too
  seed();
  sandbox._cells = makeCells([['patientName', 'desc']]);
  sandbox.run();
  check(sandbox._durableRowMap.size === 0, 'direction flip on same column drops the maps');

  // Removing the sort (back to unsorted) is also a change
  seed();
  sandbox._cells = [];
  sandbox.run();
  check(sandbox._durableRowMap.size === 0, 'clearing the sort drops the maps');

  // Re-baseline (bridge event / queue re-entry) → next run establishes, not drops
  sandbox.reset();
  seed();
  sandbox._cells = makeCells([['dueDate', 'asc']]);
  sandbox.run();
  check(sandbox._durableRowMap.size === 1, 're-baselined canary does not drop the maps on next run');

  // Client-side FILTER (no sort change) must also drop the maps — same
  // wrong-patient hazard as H6 sort.
  sandbox.reset();
  seed();
  sandbox._cells = [];
  sandbox._filterCells = [];
  sandbox.run();
  check(sandbox._durableRowMap.size === 1, 'empty-filter baseline keeps the maps');
  sandbox._filterCells = [
    { getAttribute: (a) => (a === 'col-id' ? 'patientName' : null), classList: { contains: () => false } },
  ];
  sandbox.run();
  check(sandbox._durableRowMap.size === 0, 'filter-only change drops _durableRowMap');
  check(sandbox._queueRowUuids.size === 0, 'filter-only change drops _queueRowUuids');
}

// ============================================================
// Layer 2 — wiring: the canary is actually in the hot paths
// ============================================================
console.log('Layer 2: canary wiring in refreshQueueChips / teardown / bridge');

const refreshMatch = src.match(/const refreshQueueChips = \(\) => \{[\s\S]*?\n  \};/);
check(!!refreshMatch, 'refreshQueueChips found');
if (refreshMatch) {
  const body = refreshMatch[0];
  const canaryAt = body.indexOf('checkQueueSortCanary()');
  check(canaryAt !== -1, 'refreshQueueChips calls checkQueueSortCanary');
  for (const reinject of [
    'reinjectCachedResultChips()',
    'reinjectCachedMonitoringChips()',
    'reinjectCachedPaChips()',
  ]) {
    const at = body.indexOf(reinject);
    check(at !== -1 && canaryAt < at, `canary runs BEFORE ${reinject}`);
  }
}

const teardownMatch = src.match(/const teardownQueueObserver = \(\) => \{[\s\S]*?\n  \};/);
check(!!teardownMatch, 'teardownQueueObserver found');
check(
  !!teardownMatch && /_queueSortSig = undefined/.test(teardownMatch[0]),
  'teardownQueueObserver resets the canary baseline'
);

// Bridge handler must re-baseline after repopulating the maps, or a server-side
// sort whose fetch lands before the observer tick gets its correct maps dropped.
const bridgeMatch = src.match(/window\.addEventListener\('ch-task-list-data',[\s\S]*?\n  \}\);/);
check(!!bridgeMatch, 'ch-task-list-data bridge listener found');
if (bridgeMatch) {
  const body = bridgeMatch[0];
  const clearAt = body.indexOf('_durableRowMap.clear()');
  const rebaseAt = body.indexOf('_queueSortSig = undefined');
  check(clearAt !== -1, 'bridge listener clears _durableRowMap');
  check(rebaseAt !== -1 && rebaseAt > clearAt, 'bridge listener re-baselines the canary after clearing the maps');
}

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
