// Park-until ledger (queue Act-tray, local only).
// Run with: node test-park-ledger.js
'use strict';

const P = require('./shared/park-ledger.js');

let passed = 0,
  failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const now = Date.parse('2026-08-24T10:00:00');

console.log('Layer 1: park / lookup / unpark');
{
  const parked = P.parkTask({}, UUID, now + 3600000, 'DT', now);
  check(parked.ok === true, 'park accepts a uuid + until');
  const hit = P.lookup(parked.store, UUID, now);
  check(!!hit && hit.until === now + 3600000, 'lookup returns the until');
  check(hit.actor === 'DT', 'actor is stored');
  check(P.lookup(parked.store, 'not-a-uuid', now) === null, 'bad uuid looks up nothing');
  const gone = P.unparkTask(parked.store, UUID);
  check(P.lookup(gone.store, UUID, now) === null, 'unpark drops the entry');
}

console.log('\nLayer 2: fail closed / prune');
{
  check(P.parkTask({}, 'nope', now + 1000, '', now).ok === false, 'invalid uuid refuses');
  check(P.parkTask({}, UUID, 'soon', '', now).ok === false, 'invalid until refuses');
  const stale = P.parkTask({}, UUID, now - 20 * 3600000, '', now - 20 * 3600000);
  const pruned = P.pruneStore(stale.store, now);
  check(!pruned[UUID], 'entries older than until+12h are pruned');
}

console.log('\nLayer 3: default until + format');
{
  const monMorning = new Date(2026, 7, 24, 7, 0, 0); // Mon 07:00 → today 08:00
  const until = P.defaultUntilMs(monMorning);
  const d = new Date(until);
  check(d.getDate() === 24 && d.getHours() === 8, 'before 08:00 parks until today 08:00');
  const monAfternoon = new Date(2026, 7, 24, 15, 0, 0);
  const until2 = P.defaultUntilMs(monAfternoon);
  const d2 = new Date(until2);
  check(d2.getDate() === 25 && d2.getHours() === 8, 'after 08:00 parks until tomorrow 08:00');
  const friEve = new Date(2026, 7, 21, 18, 0, 0);
  const until3 = P.defaultUntilMs(friEve);
  check(new Date(until3).getDay() === 1, 'Friday evening parks until Monday 08:00');
  check(P.formatUntil(until2, monAfternoon.getTime()) === 'tomorrow 08:00', 'format tomorrow 08:00');
}

console.log('\nLayer 4: no clinical text / storage key');
{
  check(P.STORAGE_KEY === 'ledger.parkedTasks', 'storage key is ledger.parkedTasks');
  const parked = P.parkTask({}, UUID, now + 1000, 'a'.repeat(80), now);
  check(parked.store[UUID].a.length <= 40, 'actor is capped — no free-text dump');
}

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---\n');
if (failed > 0) process.exit(1);
