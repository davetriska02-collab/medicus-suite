// Medicus Suite — presence folder-store tests
// Run with: node test-presence-folder.js
//
// The File System Access API, IndexedDB and the shared folder aren't
// available here, so only the pure logic is exercised: the beat filename
// (the write-authorisation unit — one file per staff member, built only from
// validated parts), its parse round-trip, and beat-row sanitisation in both
// directions (folder contents are UNTRUSTED — anything on the practice
// network can write to the share, so reads validate as strictly as writes).

'use strict';

const {
  DIR_NAME,
  beatFileName,
  parseBeatFileName,
  sanitizeBeatRow,
  serializeBeatRow,
  parseBeatFile,
} = require('./shared/presence-folder.js');

let passed = 0,
  failed = 0;
function check(cond, label) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
}

const STAFF = '019708e4-f1e1-7208-abe6-6901369d3832';
const TASK = '019fccd2-7a31-73be-bb0b-82e1585b5f5e';
const ROW = {
  site: '560b6c',
  task_uuid: TASK,
  staff_id: STAFF,
  staff_label: 'david.triska',
  opened_at: '2026-08-04T12:00:00.000Z',
  last_seen: '2026-08-04T12:05:00.000Z',
};

console.log('--- beatFileName / parseBeatFileName ---');
{
  check(DIR_NAME === 'ms-presence', 'directory name is ms-presence');
  const name = beatFileName('560b6c', STAFF);
  check(name === `560b6c-${STAFF}.json`, 'filename is <site>-<staffId>.json');
  check(beatFileName('560B6C', STAFF.toUpperCase()) === name, 'case-normalised');
  check(beatFileName('../../etc', STAFF) === null, 'path-traversal site rejected');
  check(beatFileName('560b6c', 'not-a-uuid') === null, 'malformed staffId rejected');
  check(beatFileName('', STAFF) === null, 'empty site rejected');
  check(beatFileName(null, null) === null, 'nulls rejected, never throw');

  const parsed = parseBeatFileName(name);
  check(parsed !== null && parsed.site === '560b6c' && parsed.staffId === STAFF, 'parse round-trips');
  check(parseBeatFileName('junk.json') === null, 'junk filename -> null');
  check(parseBeatFileName('560b6c-' + STAFF + '.txt') === null, 'wrong extension -> null');
  check(parseBeatFileName(null) === null, 'null -> null');
}

console.log('--- sanitizeBeatRow: untrusted share contents ---');
{
  const clean = sanitizeBeatRow(ROW);
  check(clean !== null, 'valid row accepted');
  check(clean.staff_label === 'david.triska', 'label carried');
  check(clean.opened_at === '2026-08-04T12:00:00.000Z', 'opened_at normalised ISO');

  check(sanitizeBeatRow(null) === null, 'null -> null');
  check(sanitizeBeatRow({ ...ROW, site: 'bad site!' }) === null, 'malformed site rejected');
  check(sanitizeBeatRow({ ...ROW, task_uuid: 'nope' }) === null, 'malformed task uuid rejected');
  check(sanitizeBeatRow({ ...ROW, staff_id: 'nope' }) === null, 'malformed staff id rejected');
  check(sanitizeBeatRow({ ...ROW, last_seen: 'not-a-date' }) === null, 'unparseable last_seen rejected');

  const noOpened = sanitizeBeatRow({ ...ROW, opened_at: undefined });
  check(noOpened !== null && noOpened.opened_at === noOpened.last_seen, 'missing opened_at falls back to last_seen');
  const blankLabel = sanitizeBeatRow({ ...ROW, staff_label: '  ' });
  check(blankLabel.staff_label === 'A colleague', 'blank label -> "A colleague"');
  const longLabel = sanitizeBeatRow({ ...ROW, staff_label: 'x'.repeat(200) });
  check(longLabel.staff_label.length === 60, 'label capped at 60');
  const upper = sanitizeBeatRow({ ...ROW, task_uuid: TASK.toUpperCase(), staff_id: STAFF.toUpperCase() });
  check(upper.task_uuid === TASK && upper.staff_id === STAFF, 'uuids lower-cased');
}

console.log('--- serializeBeatRow / parseBeatFile round-trip ---');
{
  const json = serializeBeatRow(ROW);
  check(typeof json === 'string' && json.length < 400, 'serialises small');
  const back = parseBeatFile(json);
  check(back !== null && back.task_uuid === TASK && back.staff_id === STAFF, 'round-trips');
  check(serializeBeatRow({ bad: true }) === null, 'invalid row -> null, nothing written');

  check(parseBeatFile('') === null, 'empty file -> null');
  check(parseBeatFile('not json') === null, 'junk file -> null, never throws');
  check(parseBeatFile('[1,2,3]') === null, 'wrong JSON shape -> null');
  check(parseBeatFile(null) === null, 'null -> null');
  check(parseBeatFile('x'.repeat(5000)) === null, 'oversize file rejected (share junk must not OOM the reader)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
