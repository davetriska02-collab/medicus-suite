// Medicus Suite — duplicate-checker scan-state TTL
// Run with: node test-dup-checker-ttl.js
'use strict';

const { STATE_TTL_MS, stateIsFresh } = require('./shared/dup-checker-state.js');

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

console.log('--- stateIsFresh ---');
const now = Date.parse('2026-09-20T12:00:00.000Z');
check(STATE_TTL_MS === 7 * 24 * 60 * 60 * 1000, 'TTL is 7 days');
check(stateIsFresh(null, now) === false, 'null state is stale');
check(stateIsFresh({}, now) === false, 'missing scanDate is stale');
check(stateIsFresh({ scanDate: 'not-a-date' }, now) === false, 'unparseable scanDate is stale');
check(stateIsFresh({ scanDate: '2026-09-20T11:00:00.000Z' }, now) === true, 'a scan from an hour ago is still fresh');
check(stateIsFresh({ scanDate: '2026-09-13T12:00:01.000Z' }, now) === true, 'just inside 7 days is fresh');
check(stateIsFresh({ scanDate: '2026-09-13T12:00:00.000Z' }, now) === false, 'exactly 7 days old is stale');
check(stateIsFresh({ scanDate: '2026-09-01T12:00:00.000Z' }, now) === false, 'older than 7 days is stale');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
