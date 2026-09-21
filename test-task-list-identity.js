// Regression test: queue task-list row identity must FAIL CLOSED.
//
// pickUuid (content-scripts/triage-lens/page-world.js) keys every downstream
// consumer — _durableRowMap, _queueResultCache, monitoring/result chips — off
// the value it returns as the row's taskUuid. It used to carry a generic
// fallback that scanned every key matching /task|id|uuid/i when the explicit
// identity fields were missing or non-UUID. That scan matched staff-shaped
// fields (registeredGpId, actionedById, staffId, assignedToUuid, …) and cached
// a STAFF/registered-GP UUID as the task id, mis-keying chips onto the wrong
// task. The safe behaviour is: no valid task UUID → no identity → the row is
// dropped by handleTaskList's filter. No chip is safer than a mis-keyed chip.

'use strict';

const { pickUuid } = require('./content-scripts/triage-lens/page-world.js');

const TASK_UUID = '11111111-2222-4333-8444-555555555555';
const STAFF_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GP_UUID = '99999999-8888-4777-8666-555555555544';

let passed = 0,
  failed = 0;
function check(cond, label) {
  if (cond) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

console.log('--- pickUuid: explicit identity fields still work ---');
{
  check(pickUuid({ taskUuid: TASK_UUID }) === TASK_UUID, 'taskUuid accepted');
  check(pickUuid({ taskId: TASK_UUID }) === TASK_UUID, 'taskId accepted');
  check(pickUuid({ uuid: TASK_UUID }) === TASK_UUID, 'uuid accepted');
  check(pickUuid({ id: TASK_UUID }) === TASK_UUID, 'id accepted');
  check(
    pickUuid({ id: TASK_UUID.toUpperCase() }) === TASK_UUID.toUpperCase(),
    'uppercase UUID accepted (case-insensitive shape)'
  );
  check(pickUuid({ id: 'junk', taskUuid: TASK_UUID }) === TASK_UUID, 'valid taskUuid wins even when id is malformed');
}

console.log('--- pickUuid: fail closed — never key off a staff/GP id ---');
{
  // The core regression: id missing entirely, but staff-shaped UUID fields
  // present. The old key-scan fallback returned one of these.
  check(
    pickUuid({ registeredGpId: GP_UUID, title: 'Bloods' }) === null,
    'missing id + registeredGpId UUID -> null, not the GP id'
  );
  check(pickUuid({ actionedById: STAFF_UUID }) === null, 'missing id + actionedById UUID -> null, not the staff id');
  check(pickUuid({ staffId: STAFF_UUID }) === null, 'missing id + staffId UUID -> null');
  check(
    pickUuid({ assignedTaskOwnerUuid: STAFF_UUID }) === null,
    'task-flavoured staff key (assignedTaskOwnerUuid) -> null'
  );
  // id present but NOT a UUID (e.g. numeric row id) + staff UUID alongside.
  check(
    pickUuid({ id: '12345', registeredGpId: GP_UUID }) === null,
    'non-UUID id + registeredGpId UUID -> null, not the GP id'
  );
  check(
    pickUuid({ taskUuid: 'not-a-uuid', actionedById: STAFF_UUID }) === null,
    'malformed taskUuid + actionedById UUID -> null'
  );
}

console.log('--- pickUuid: malformed / missing identity -> null ---');
{
  check(pickUuid({}) === null, 'empty object -> null');
  check(pickUuid(null) === null, 'null -> null');
  check(pickUuid('string') === null, 'non-object -> null');
  check(pickUuid({ id: 42 }) === null, 'numeric id -> null');
  check(pickUuid({ id: TASK_UUID + 'x' }) === null, 'UUID with trailing junk -> null');
  check(pickUuid({ id: TASK_UUID.slice(0, -1) }) === null, 'truncated UUID -> null');
  check(pickUuid({ taskUuid: { nested: TASK_UUID } }) === null, 'object-valued taskUuid -> null');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
