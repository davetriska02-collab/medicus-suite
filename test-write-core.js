// Medicus Suite — write-core ("success is only what the bridge confirms") tests
// Run with: node test-write-core.js
'use strict';

const fs = require('fs');
const path = require('path');
const {
  landedIds,
  diffWantedVsLanded,
  diffFinaliseOutcome,
  assertUnmoved,
  pinIdentity,
  recheckIdentity,
  requireUnmoved,
  confirmLanded,
  runConfirmedWrite,
  finaliseConfirmCopy,
} = require('./shared/write-core.js');

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

console.log('--- assertUnmoved ---');
check(
  assertUnmoved({ apiBase: 'https://a.x', date: '2026-09-10' }, { apiBase: 'https://a.x', date: '2026-09-10' }),
  'same book pin is unmoved'
);
check(
  !assertUnmoved({ apiBase: 'https://a.x', date: '2026-09-10' }, { apiBase: 'https://a.x', date: '2026-09-11' }),
  'date change is moved'
);
check(
  !assertUnmoved({ apiBase: 'https://a.x', date: '2026-09-10' }, { apiBase: 'https://b.x', date: '2026-09-10' }),
  'site change is moved'
);
check(!assertUnmoved(null, { apiBase: 'https://a.x' }), 'null pin is moved');
check(
  !assertUnmoved({ apiBase: 'https://a.x', date: '2026-09-10' }, { apiBase: 'https://a.x' }),
  'missing live date is moved (fail-closed)'
);
check(!assertUnmoved({ apiBase: 'https://a.x', date: '2026-09-10' }, {}), 'empty live is moved');
check(!assertUnmoved({}, { apiBase: 'https://a.x', date: '2026-09-10' }), 'empty pin is moved (nothing was pinned)');
check(
  !assertUnmoved({ patientId: 'p1', taskUuid: 'task-a' }, { patientId: 'p1', taskUuid: 'task-b' }),
  'same patient on a different task is moved'
);
check(
  !assertUnmoved({ patientId: 'p1', appointmentId: 'appt-a' }, { patientId: 'p1', appointmentId: 'appt-b' }),
  'same patient on a different appointment is moved'
);
check(
  assertUnmoved(
    { patientId: 'p1', taskUuid: 'task-a', appointmentId: 'appt-a' },
    { patientId: 'p1', taskUuid: 'task-a', appointmentId: 'appt-a' }
  ),
  'matching task and appointment stay unmoved'
);
check(!assertUnmoved({ taskUuid: 'task-a' }, { patientId: 'p1' }), 'a pinned task with no live task uuid is moved');

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

  // 2026-08-23 review fix: this BANNED sweep only ever scanned write-core.js, so
  // the house "never claim completion" rule was unenforced on the two DOM macros
  // that actually click Medicus's own commit buttons — exactly where observing a
  // click is furthest from observing a successful write. Scan their user-facing
  // toast copy too.
  {
    const MACROS = [
      ['content-scripts', 'triage-lens', 'lab-file-button.js'],
      ['content-scripts', 'triage-lens', 'routine-rx-button.js'],
    ];
    // Past-tense completion claims about the Medicus action itself. "Clicked X"
    // is fine — that is what the macro actually observed.
    const CLAIMS =
      /\b(Filed as normal|Filed successfully|Successfully filed|Sent to routine list\.|Done|Submitted|Booked)\b/;
    const offending = [];
    for (const parts of MACROS) {
      const text = fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
      const toastCalls = text.match(/toast\(\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g) || [];
      for (const c of toastCalls) if (CLAIMS.test(c)) offending.push(parts[parts.length - 1] + ': ' + c);
    }
    check(
      offending.length === 0,
      'DOM macro toast copy never claims the Medicus action completed' +
        (offending.length ? ': ' + JSON.stringify(offending) : '')
    );
  }

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

console.log('--- pinIdentity / requireUnmoved / confirmLanded ---');
{
  const pin = pinIdentity({ apiBase: 'https://a.x', date: '2026-09-10', patientId: 'p1', extra: 'drop' });
  check(
    pin.apiBase === 'https://a.x' && pin.date === '2026-09-10' && pin.patientId === 'p1',
    'pin keeps identity fields'
  );
  const taskPin = pinIdentity({ patientId: 'p1', taskUuid: 'task-a', appointmentId: 'appt-a' });
  check(taskPin.taskUuid === 'task-a' && taskPin.appointmentId === 'appt-a', 'pin keeps task and appointment ids');
  check(
    !recheckIdentity(taskPin, { patientId: 'p1', taskUuid: 'task-b', appointmentId: 'appt-a' }),
    'recheck refuses a task change on the same patient'
  );
  check(pin.extra === undefined, 'pin drops unknown fields');
  check(pinIdentity({ apiBase: '', date: '2026-09-10' }).apiBase === undefined, 'blank apiBase is omitted');
  check(
    recheckIdentity(pin, { apiBase: 'https://a.x', date: '2026-09-10', patientId: 'p1' }) === true,
    'recheck is assertUnmoved'
  );
  const ok = requireUnmoved(pin, { apiBase: 'https://a.x', date: '2026-09-10', patientId: 'p1' });
  check(ok.ok === true, 'requireUnmoved passes an unmoved pin');
  const moved = requireUnmoved(pin, { apiBase: 'https://a.x', date: '2026-09-11', patientId: 'p1' });
  check(moved.ok === false && /moved/.test(moved.reason), 'requireUnmoved refuses a date change');
  const landed = confirmLanded(['a1'], [{ id: 'a1' }]);
  check(landed.allWritten === true && landed.written === 1, 'confirmLanded is the landed-id diff');
}

console.log('--- runConfirmedWrite ---');
(async function () {
  const pin = pinIdentity({ apiBase: 'https://a.x', date: '2026-09-10' });
  const moved = await runConfirmedWrite({
    pinned: pin,
    live: { apiBase: 'https://b.x', date: '2026-09-10' },
    wantIds: ['a1'],
    write: function () {
      throw new Error('must not write after move');
    },
  });
  check(moved.ok === false && moved.moved === true && moved.outcome.written === 0, 'moved pin never writes');
  let taskWrites = 0;
  const taskMoved = await runConfirmedWrite({
    pinned: pinIdentity({ patientId: 'p1', taskUuid: 'task-a' }),
    live: { patientId: 'p1', taskUuid: 'task-b' },
    wantIds: ['n1'],
    write: function () {
      taskWrites += 1;
      return [{ id: 'n1' }];
    },
  });
  check(taskMoved.ok === false && taskMoved.moved === true && taskWrites === 0, 'task change never writes');
  const partial = await runConfirmedWrite({
    pinned: pin,
    live: { apiBase: 'https://a.x', date: '2026-09-10' },
    wantIds: ['a1', 'a2'],
    write: function () {
      return Promise.resolve([{ id: 'a1' }]);
    },
  });
  check(
    partial.ok === false && partial.moved === false && partial.outcome.written === 1 && partial.outcome.failed === 1,
    'partial land is not success'
  );
  const all = await runConfirmedWrite({
    pinned: pin,
    live: { apiBase: 'https://a.x', date: '2026-09-10' },
    wantIds: ['a1'],
    write: function () {
      return [{ id: 'a1' }];
    },
  });
  check(all.ok === true && all.outcome.allWritten === true, 'all landed ids are success');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(function (err) {
  console.error(err);
  process.exit(1);
});
