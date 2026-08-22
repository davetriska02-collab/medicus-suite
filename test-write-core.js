// Medicus Suite — write-core ("success is only what the bridge confirms") tests
// Run with: node test-write-core.js
'use strict';

const fs = require('fs');
const path = require('path');
const { landedIds, diffWantedVsLanded, diffFinaliseOutcome, finaliseConfirmCopy } = require('./shared/write-core.js');

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

function landedHas(map, id) {
  return !!(map && map[id]);
}
function landedSize(map) {
  return map ? Object.keys(map).length : -1;
}

console.log('--- landedIds: null-safe empty ---');
check(landedSize(landedIds(null)) === 0, 'null list → empty map');
check(landedSize(landedIds(undefined)) === 0, 'undefined list → empty map');
check(landedSize(landedIds([])) === 0, 'empty list → empty map');
check(!landedHas(landedIds([{ id: 'x' }, null, {}]), 'missing'), 'items without id are skipped');
check(
  landedHas(landedIds([{ id: 'x' }, null, {}]), 'x') && landedSize(landedIds([{ id: 'x' }, null, {}])) === 1,
  'null items skipped, id kept'
);

console.log('--- landedIds: all landed ---');
{
  const landed = landedIds([{ id: 'j1' }, { id: 'c2' }, { id: 'd1' }]);
  check(landedHas(landed, 'j1') && landedHas(landed, 'c2') && landedHas(landed, 'd1'), 'all three ids landed');
  check(landedSize(landed) === 3, 'map size is 3');
}

console.log('--- diffWantedVsLanded: null-safe empty ---');
{
  const empty = diffWantedVsLanded(null, null);
  check(empty.wanted === 0 && empty.written === 0 && empty.failed === 0, 'null want + null landed → zeros');
  check(empty.allWritten === true && empty.failedIds.length === 0, 'null-safe is vacuously allWritten');
  const undef = diffWantedVsLanded(undefined, undefined);
  check(undef.wanted === 0 && undef.allWritten === true, 'undefined args → empty');
}

console.log('--- diffWantedVsLanded: all landed ---');
{
  const all = diffWantedVsLanded(['j1', 'c2'], [{ id: 'j1' }, { id: 'c2' }]);
  check(all.allWritten === true && all.written === 2 && all.failed === 0, 'everything confirmed → allWritten');
  check(all.wanted === 2 && all.failedIds.length === 0, 'wanted matches, no failedIds');
  check(all.written === all.wanted - all.failed, 'written = wanted - failed');
}

console.log('--- diffWantedVsLanded: partial ---');
{
  const partial = diffWantedVsLanded(['j1', 'c2', 'd1'], [{ id: 'j1' }]);
  check(partial.allWritten === false, 'a missing confirmation is a failure');
  check(partial.written === 1 && partial.failed === 2 && partial.wanted === 3, 'partial counts written vs failed');
  check(partial.failedIds.join() === 'c2,d1', 'failedIds are the unconfirmed ones');
  check(partial.written === partial.wanted - partial.failed, 'written = wanted - failed');
}

console.log('--- diffWantedVsLanded: none landed ---');
{
  const none = diffWantedVsLanded(['j1'], []);
  check(none.allWritten === false && none.failed === 1 && none.written === 0, 'empty landed list is never success');
  check(none.failedIds[0] === 'j1', 'the wanted id is the failed id');
  const skipped = diffWantedVsLanded(['j1'], null);
  check(skipped.allWritten === false && skipped.failed === 1, 'null landed list is never success');
}

console.log('--- diffFinaliseOutcome: parity with allergy-canvas cases ---');
{
  const all = diffFinaliseOutcome(['j1', 'c2'], ['d1'], [{ id: 'j1' }, { id: 'c2' }], [{ id: 'd1' }]);
  check(all.allWritten === true && all.written === 3 && all.failed === 0, 'everything confirmed -> allWritten');
  const partial = diffFinaliseOutcome(['j1', 'c2'], ['d1'], [{ id: 'j1' }], []);
  check(partial.allWritten === false, 'a missing confirmation is a failure');
  check(partial.written === 1 && partial.failed === 2, 'partial counts written vs failed');
  check(partial.failedEnds.length === 1 && partial.failedEnds[0] === 'c2', 'failed end ids are the unconfirmed ones');
  check(partial.failedTidies.length === 1 && partial.failedTidies[0] === 'd1', 'failed tidy ids kept');
  const skipped = diffFinaliseOutcome(['j1'], [], [], []);
  check(
    skipped.allWritten === false && skipped.failed === 1,
    'a skipped commit (empty ended list) is never reported as success'
  );
  const none = diffFinaliseOutcome([], [], [], []);
  check(none.allWritten === true && none.wanted === 0, 'nothing wanted -> vacuously all written');
  const nullSafe = diffFinaliseOutcome(['j1'], null, null, null);
  check(nullSafe.failed === 1 && nullSafe.failedEnds[0] === 'j1', 'null lists never throw');
}

console.log('--- finaliseConfirmCopy: pinned strings ---');
check(
  finaliseConfirmCopy({ allWritten: true, wanted: 3, written: 3, failed: 0 }, 'allergies') === '3 allergies written',
  'allWritten → "N ${noun} written"'
);
check(
  finaliseConfirmCopy({ allWritten: true, wanted: 1, written: 1, failed: 0 }, 'allergy') === '1 allergy written',
  'singular noun is used as given'
);
check(
  finaliseConfirmCopy({ allWritten: false, wanted: 3, written: 1, failed: 2 }, 'allergies') ===
    '1 written, 2 failed — failed stay staged',
  'partial → "N written, M failed — failed stay staged"'
);
check(
  finaliseConfirmCopy({ allWritten: true, wanted: 0, written: 0, failed: 0 }, 'allergies') === 'Nothing to write',
  'wanted=0 → "Nothing to write" (not a success claim)'
);

console.log('--- finaliseConfirmCopy: never claims completion ---');
{
  const copies = [
    finaliseConfirmCopy({ allWritten: true, wanted: 3, written: 3, failed: 0 }, 'allergies'),
    finaliseConfirmCopy({ allWritten: true, wanted: 1, written: 1, failed: 0 }, 'allergy'),
    finaliseConfirmCopy({ allWritten: false, wanted: 3, written: 1, failed: 2 }, 'allergies'),
    finaliseConfirmCopy({ allWritten: true, wanted: 0, written: 0, failed: 0 }, 'allergies'),
    finaliseConfirmCopy(null, 'allergies'),
  ];
  const BANNED = /\b(Done|Sent|Booked|Submitted)\b/;
  const offenders = copies.filter(function (s) {
    return BANNED.test(s) || /Staged writes sent/.test(s);
  });
  check(
    offenders.length === 0,
    'returned strings never contain Done/Sent/Booked/Submitted/Staged writes sent' +
      (offenders.length ? ': ' + JSON.stringify(offenders) : '')
  );

  const src = fs.readFileSync(path.join(__dirname, 'shared', 'write-core.js'), 'utf8');
  const start = src.indexOf('function finaliseConfirmCopy');
  check(start !== -1, 'finaliseConfirmCopy is in the source');
  const rest = src.slice(start);
  const end = rest.search(/\n  var api|\n  const api|\n}\)/);
  const body = end === -1 ? rest : rest.slice(0, end);
  const literals = body.match(/'(?:[^'\\]|\\.)*'/g) || [];
  const badLiterals = literals.filter(function (l) {
    return BANNED.test(l) || /Staged writes sent/.test(l);
  });
  check(
    badLiterals.length === 0,
    'source-grep of finaliseConfirmCopy returned strings: no Done/Sent/Booked/Submitted' +
      (badLiterals.length ? ': ' + badLiterals.join(', ') : '')
  );
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
