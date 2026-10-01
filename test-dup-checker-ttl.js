// Medicus Suite — duplicate-checker scan-state TTL
// Run with: node test-dup-checker-ttl.js
'use strict';

const fs = require('fs');
const path = require('path');
const {
  STATE_TTL_MS,
  REMOVAL_LOG_TTL_MS,
  REMOVAL_LOG_MAX,
  stateIsFresh,
  prepareStateForSave,
  migrateLoadedState,
  pruneRemovalLog,
} = require('./shared/dup-checker-state.js');

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

console.log('\n--- removal log TTL and cap ---');
const DAY = 24 * 60 * 60 * 1000;
check(REMOVAL_LOG_TTL_MS === 30 * DAY, 'removal log TTL is 30 days');
check(REMOVAL_LOG_MAX === 500, 'removal log cap is 500 entries');

const logNow = Date.parse('2026-10-01T12:00:00.000Z');
function entryAt(iso, id) {
  return {
    patientUuid: '11111111-2222-4333-8444-555555555555',
    patientName: 'Example Person',
    kind: 'problem',
    entryId: id,
    removedAt: iso,
  };
}

{
  const kept = entryAt('2026-10-01T11:00:00.000Z', 'fresh');
  const edge = entryAt('2026-09-01T12:00:01.000Z', 'inside');
  const exact = entryAt('2026-09-01T12:00:00.000Z', 'exact');
  const old = entryAt('2026-08-01T12:00:00.000Z', 'old');
  const undated = { patientUuid: '11111111-2222-4333-8444-555555555555', patientName: 'Example Person', entryId: 'undated' };
  const pruned = pruneRemovalLog([old, undated, exact, edge, kept], logNow);
  check(pruned.changed === true, 'dropping expired or undated entries marks the log changed');
  check(
    pruned.entries.map((e) => e.entryId).join(',') === 'inside,fresh',
    'keeps entries inside 30 days, drops exact-30-days, older, and undated'
  );
  const same = pruneRemovalLog(pruned.entries, logNow);
  check(same.changed === false, 'a second prune of an already-fresh log is unchanged');
  check(pruneRemovalLog(null, logNow).entries.length === 0, 'a missing log prunes to empty');
}

{
  const many = [];
  for (let i = 0; i < REMOVAL_LOG_MAX + 1; i++) {
    const t = new Date(logNow - (REMOVAL_LOG_MAX - i) * 1000).toISOString();
    many.push(entryAt(t, 'id-' + i));
  }
  const capped = pruneRemovalLog(many, logNow);
  check(capped.changed === true, 'over-cap log is changed');
  check(capped.entries.length === REMOVAL_LOG_MAX, 'cap keeps 500 entries');
  check(capped.entries[0].entryId === 'id-1', 'cap drops the oldest entry');
  check(capped.entries[capped.entries.length - 1].entryId === 'id-' + REMOVAL_LOG_MAX, 'cap keeps the newest entry');
  const shuffled = [many[many.length - 1], many[0], many[10]];
  const ordered = pruneRemovalLog(shuffled, logNow);
  check(
    ordered.entries.map((e) => e.entryId).join(',') === 'id-0,id-10,id-' + REMOVAL_LOG_MAX,
    'prune sorts by removedAt so the cap drops the oldest even if the array is not append-ordered'
  );
}

console.log('\n--- NHS number is not persisted; migration strips it ---');
const NHS_SENTINEL = 'not-an-nhs-number';
const liveRow = {
  name: 'Example Person',
  nhs: NHS_SENTINEL,
  nhsNumber: NHS_SENTINEL,
  nhsNo: NHS_SENTINEL,
  dob: '1970-01-15',
  uuid: '11111111-2222-4333-8444-555555555555',
  count: 1,
  duplicated: [{ label: 'Example condition', count: 2 }],
  triggers: ['batch'],
};
const saved = prepareStateForSave(
  'e38a9f',
  [liveRow],
  new Set(['11111111-2222-4333-8444-555555555555']),
  '2026-10-01T12:00:00.000Z'
);
check(liveRow.nhs === NHS_SENTINEL, 'prepareStateForSave does not mutate the live row');
const savedJson = JSON.stringify(saved);
check(!savedJson.includes(NHS_SENTINEL), 'saved state JSON does not contain the NHS number');
check(!Object.prototype.hasOwnProperty.call(saved.flagged[0], 'nhs'), 'saved flagged row has no nhs key');
check(!Object.prototype.hasOwnProperty.call(saved.flagged[0], 'nhsNumber'), 'saved flagged row has no nhsNumber key');
check(!Object.prototype.hasOwnProperty.call(saved.flagged[0], 'nhsNo'), 'saved flagged row has no nhsNo key');
check(saved.flagged[0].name === 'Example Person', 'name is kept');
check(saved.flagged[0].dob === '1970-01-15', 'date of birth is kept');
check(saved.flagged[0].uuid === '11111111-2222-4333-8444-555555555555', 'UUID is kept');
check(saved.flagged[0].duplicated[0].label === 'Example condition', 'duplicate findings are kept');
check(saved.checkedUuids.length === 1, 'checked UUIDs are kept');
check(saved.practiceCode === 'e38a9f' && saved.scanDate === '2026-10-01T12:00:00.000Z', 'practice code and scan date are kept');

{
  const legacy = {
    practiceCode: 'e38a9f',
    scanDate: '2026-10-01T12:00:00.000Z',
    flagged: [{ name: 'Example Person', nhs: NHS_SENTINEL, NHSNumber: NHS_SENTINEL, dob: '1970-01-15', uuid: 'abc' }],
    checkedUuids: ['abc'],
  };
  const migrated = migrateLoadedState(legacy);
  check(migrated.changed === true, 'a stored scan that still has an NHS number is migrated');
  check(!JSON.stringify(migrated.state).includes(NHS_SENTINEL), 'migrated state does not contain the NHS number');
  check(migrated.state.flagged[0].name === 'Example Person', 'migration keeps the name');
  check(migrated.state.flagged[0].dob === '1970-01-15', 'migration keeps the date of birth');
  check(migrated.state.checkedUuids[0] === 'abc', 'migration keeps checked UUIDs');
  check(legacy.flagged[0].nhs === NHS_SENTINEL, 'migration does not mutate the object it was given');
  const again = migrateLoadedState(migrated.state);
  check(again.changed === false, 'a second migration of a clean scan is a no-op');
  check(migrateLoadedState(null).changed === false, 'missing state is not migrated');
  check(migrateLoadedState({ flagged: [{ name: 'Example Person', uuid: 'abc' }] }).changed === false, 'a row with no NHS keys is unchanged');
}

console.log('\n--- page wires retention on save, load and removal ---');
const page = fs.readFileSync(path.join(__dirname, 'duplicate-checker.js'), 'utf8');
check(page.includes('prepareStateForSave('), 'save path uses prepareStateForSave');
check(page.includes('migrateLoadedState('), 'load path migrates stored state');
check(page.includes('pruneRemovalLog('), 'removal log is pruned');
check(page.includes('pruneStoredRemovalLog('), 'removal log is pruned on load');
check(/initSavedState\(\);\s*pruneStoredRemovalLog\(\);/.test(page), 'startup prunes the removal log');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
