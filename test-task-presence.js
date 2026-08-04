// Medicus Suite — task-presence ("is someone already on this request?") tests
// Run with: node test-task-presence.js
//
// Live Medicus, the DOM and the shared store aren't available here, so only
// the pure logic is exercised: bridge-row sanitisation (the ch-task-list-data
// detail is untrusted cross-world input), the staff-identity attribute parse,
// display-label fallback, the task-overview URL parse (both route shapes),
// the presence-config gate (the thing that keeps the feature dormant until a
// practice deliberately points every machine at the same store), the
// heartbeat payload (opened_at only on the first beat — an upsert that
// resent it would reset "opened N min ago" every 25s), the active-others
// filter (self excluded, stale excluded, store rows treated as untrusted),
// and the chip/banner text builders.

'use strict';

const {
  sanitizeBridgeRow,
  parseStaffAttr,
  displayLabel,
  parseTaskOverviewPath,
  validPresenceConfig,
  buildHeartbeatPayload,
  activeOthers,
  presenceChipText,
  minutesAgoText,
  actionedChipText,
  buildPresenceInFilter,
} = require('./content-scripts/task-presence.js');

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

const UUID_A = '019fccd2-7a31-73be-bb0b-82e1585b5f5e';
const UUID_B = '01970c94-d8ab-7139-b59b-67d97311d42d';
const UUID_ME = '019708e4-f1e1-7208-abe6-6901369d3832';

console.log('--- sanitizeBridgeRow: untrusted cross-world rows ---');
{
  const good = sanitizeBridgeRow({
    rowIndex: 0,
    taskUuid: UUID_A.toUpperCase(),
    actionedBy: 'Dr David Triska',
    actionedDateTime: '04 Aug 2026, 13:49',
  });
  check(good !== null, 'valid row accepted');
  check(good.taskUuid === UUID_A, 'taskUuid lower-cased');
  check(good.actionedBy === 'Dr David Triska', 'actionedBy carried');
  check(good.actionedDateTime === '04 Aug 2026, 13:49', 'actionedDateTime carried');

  const minimal = sanitizeBridgeRow({ rowIndex: 3, taskUuid: UUID_A });
  check(
    minimal !== null && minimal.actionedBy === '' && minimal.actionedDateTime === '',
    'missing actioned fields -> empty strings'
  );

  check(sanitizeBridgeRow(null) === null, 'null row rejected');
  check(sanitizeBridgeRow({ rowIndex: -1, taskUuid: UUID_A }) === null, 'negative rowIndex rejected');
  check(sanitizeBridgeRow({ rowIndex: 1.5, taskUuid: UUID_A }) === null, 'fractional rowIndex rejected');
  check(sanitizeBridgeRow({ rowIndex: NaN, taskUuid: UUID_A }) === null, 'NaN rowIndex rejected');
  check(sanitizeBridgeRow({ rowIndex: '0', taskUuid: UUID_A }) === null, 'string rowIndex rejected');
  check(sanitizeBridgeRow({ rowIndex: 0, taskUuid: 'not-a-uuid' }) === null, 'malformed uuid rejected');
  check(sanitizeBridgeRow({ rowIndex: 0, taskUuid: 42 }) === null, 'numeric uuid rejected');

  const long = sanitizeBridgeRow({ rowIndex: 0, taskUuid: UUID_A, actionedBy: 'x'.repeat(500) });
  check(long.actionedBy.length === 80, 'actionedBy capped at 80 chars');
  const objField = sanitizeBridgeRow({ rowIndex: 0, taskUuid: UUID_A, actionedBy: { evil: 1 } });
  check(objField.actionedBy === '', 'non-string actionedBy -> empty, never an object');
}

console.log('--- parseStaffAttr: page-world identity stamp ---');
{
  const both = parseStaffAttr(`${UUID_ME}|david.triska@nhs.net`);
  check(both !== null && both.staffId === UUID_ME, 'staffId parsed');
  check(both.email === 'david.triska@nhs.net', 'email parsed');

  const upper = parseStaffAttr(`${UUID_ME.toUpperCase()}|X@Y.Z`);
  check(upper.staffId === UUID_ME, 'staffId lower-cased');

  const noEmail = parseStaffAttr(`${UUID_ME}|`);
  check(noEmail !== null && noEmail.email === '', 'empty email tolerated');
  const bare = parseStaffAttr(UUID_ME);
  check(bare !== null && bare.email === '', 'bare uuid (no bar) tolerated');

  check(parseStaffAttr('') === null, 'empty attr -> null');
  check(parseStaffAttr(null) === null, 'null attr -> null');
  check(parseStaffAttr('nonsense|a@b.c') === null, 'malformed staffId -> null (it keys presence rows)');
  const hugeEmail = parseStaffAttr(`${UUID_ME}|${'e'.repeat(200)}`);
  check(hugeEmail !== null && hugeEmail.email === '', 'oversized email dropped, identity kept');
}

console.log('--- displayLabel: options override, else email local part ---');
{
  check(displayLabel('Dr D Triska', 'david.triska@nhs.net') === 'Dr D Triska', 'configured name wins');
  check(displayLabel('  ', 'david.triska@nhs.net') === 'david.triska', 'whitespace name -> email local part');
  check(displayLabel('', 'david.triska@nhs.net') === 'david.triska', 'empty name -> email local part');
  check(displayLabel('', 'plainstring') === 'plainstring', 'email without @ used whole');
  check(displayLabel('', '') === '', 'nothing available -> empty (caller falls back)');
  check(displayLabel('x'.repeat(100), '').length === 60, 'name capped at 60');
  check(displayLabel(null, undefined) === '', 'null/undefined never throw');
}

console.log('--- parseTaskOverviewPath: both route shapes ---');
{
  const route = parseTaskOverviewPath(`/560b6c/tasks/communication-thread/overview/${UUID_A}`);
  check(
    route !== null && route.site === '560b6c' && route.slug === 'communication-thread' && route.taskUuid === UUID_A,
    'route shape parsed'
  );
  const data = parseTaskOverviewPath(`/560b6c/tasks/data/communication-thread/overview/${UUID_A}`);
  check(data !== null && data.taskUuid === UUID_A, 'data shape parsed');
  const query = parseTaskOverviewPath(`/560b6c/tasks/communication-thread/overview/${UUID_A}?taskList=x`);
  check(
    query !== null && query.taskUuid === UUID_A,
    'query suffix tolerated (defensive: callers pass location.pathname, but a full path+query must not break the parse)'
  );
  const trailing = parseTaskOverviewPath(`/560b6c/tasks/communication-thread/overview/${UUID_A}/`);
  check(trailing !== null, 'trailing slash tolerated');
  check(
    parseTaskOverviewPath(`/560b6c/tasks/medical_patient_request_task/task-list`) === null,
    'queue (task-list) never matches — a list has no single task'
  );
  check(parseTaskOverviewPath(`/560b6c/tasks/x/overview/not-a-uuid`) === null, 'malformed uuid -> null');
  check(parseTaskOverviewPath(null) === null, 'null -> null');
  const upperUuid = parseTaskOverviewPath(`/560B6C/tasks/x/overview/${UUID_A.toUpperCase()}`);
  check(upperUuid !== null && upperUuid.site === '560b6c' && upperUuid.taskUuid === UUID_A, 'case normalised');
}

console.log('--- validPresenceConfig: the dormancy gate ---');
{
  const good = { enabled: true, url: 'https://abcproj.supabase.co', key: 'k'.repeat(40) };
  check(validPresenceConfig(good) === true, 'valid config accepted');
  check(validPresenceConfig({ ...good, enabled: false }) === false, 'disabled -> dormant');
  check(validPresenceConfig({ ...good, enabled: 'true' }) === false, 'string true is not enabled (strict)');
  check(validPresenceConfig({ ...good, url: 'http://abcproj.supabase.co' }) === false, 'http rejected');
  check(validPresenceConfig({ ...good, url: 'https://evil.com' }) === false, 'non-supabase host rejected');
  check(
    validPresenceConfig({ ...good, url: 'https://abcproj.supabase.co.evil.com' }) === false,
    'suffix-spoof host rejected'
  );
  check(validPresenceConfig({ ...good, key: 'short' }) === false, 'implausibly short key rejected');
  check(validPresenceConfig({ ...good, url: 'not a url' }) === false, 'unparseable url rejected');
  check(validPresenceConfig(null) === false, 'null config -> dormant, never throws');
  check(validPresenceConfig({}) === false, 'empty config -> dormant');
}

console.log('--- buildHeartbeatPayload: opened_at only on the first beat ---');
{
  const first = buildHeartbeatPayload(
    '560b6c',
    UUID_A,
    UUID_ME,
    'Dr D',
    '2026-08-04T12:00:00.000Z',
    '2026-08-04T11:58:00.000Z'
  );
  check(first.site === '560b6c' && first.task_uuid === UUID_A && first.staff_id === UUID_ME, 'identity fields set');
  check(first.staff_label === 'Dr D', 'label carried');
  check(first.last_seen === '2026-08-04T12:00:00.000Z', 'last_seen set');
  check(first.opened_at === '2026-08-04T11:58:00.000Z', 'first beat carries opened_at');

  const later = buildHeartbeatPayload('560b6c', UUID_A, UUID_ME, 'Dr D', '2026-08-04T12:00:25.000Z', null);
  check(!('opened_at' in later), 'subsequent beats omit opened_at (upsert merge must not reset it)');
  check(
    Object.keys(later).sort().join(',') === 'last_seen,site,staff_id,staff_label,task_uuid',
    'exact key set on a plain beat'
  );

  const anon = buildHeartbeatPayload('560b6c', UUID_A, UUID_ME, '', '2026-08-04T12:00:00.000Z', null);
  check(anon.staff_label === 'A colleague', 'empty label -> "A colleague", never blank on a colleague-facing chip');
  const longLabel = buildHeartbeatPayload('560b6c', UUID_A, UUID_ME, 'x'.repeat(100), 'now', null);
  check(longLabel.staff_label.length === 60, 'label capped at 60');
}

console.log('--- activeOthers: self out, stale out, untrusted rows validated ---');
{
  const NOW = Date.parse('2026-08-04T12:00:00Z');
  const TTL = 90000;
  const fresh = (staff, secsAgo, extra) =>
    Object.assign(
      {
        staff_id: staff,
        staff_label: 'Dr X',
        task_uuid: UUID_A,
        opened_at: new Date(NOW - 300000).toISOString(),
        last_seen: new Date(NOW - secsAgo * 1000).toISOString(),
      },
      extra || {}
    );

  const rows = [fresh(UUID_B, 10)];
  const out = activeOthers(rows, UUID_ME, NOW, TTL);
  check(out.length === 1 && out[0].staffId === UUID_B, 'fresh colleague row kept');
  check(out[0].label === 'Dr X', 'label carried');
  check(out[0].openedAtMs === NOW - 300000, 'openedAt parsed');

  check(activeOthers([fresh(UUID_ME, 10)], UUID_ME, NOW, TTL).length === 0, 'own row excluded');
  check(activeOthers([fresh(UUID_B, 120)], UUID_ME, NOW, TTL).length === 0, 'stale row (2 min) excluded');
  check(
    activeOthers([fresh(UUID_B, -120)], UUID_ME, NOW, TTL).length === 0,
    'future-dated row (>60s ahead) excluded — a corrupt clock must not pin presence forever'
  );

  const dupes = [fresh(UUID_B, 30), fresh(UUID_B, 5)];
  const deduped = activeOthers(dupes, UUID_ME, NOW, TTL);
  check(deduped.length === 1 && deduped[0].lastSeenMs === NOW - 5000, 'newest row per staff wins');

  check(
    activeOthers([{ staff_id: 'garbage', last_seen: new Date(NOW).toISOString() }], UUID_ME, NOW, TTL).length === 0,
    'malformed staff_id dropped'
  );
  check(
    activeOthers([fresh(UUID_B, 10, { last_seen: 'not-a-date' })], UUID_ME, NOW, TTL).length === 0,
    'unparseable last_seen dropped'
  );
  check(activeOthers(null, UUID_ME, NOW, TTL).length === 0, 'null rows -> empty, never throws');
  check(activeOthers([null, undefined, 42], UUID_ME, NOW, TTL).length === 0, 'junk entries dropped');

  const noLabel = activeOthers([fresh(UUID_B, 10, { staff_label: '   ' })], UUID_ME, NOW, TTL);
  check(noLabel[0].label === 'A colleague', 'blank label -> "A colleague"');
  const noOpened = activeOthers([fresh(UUID_B, 10, { opened_at: undefined })], UUID_ME, NOW, TTL);
  check(noOpened[0].openedAtMs === noOpened[0].lastSeenMs, 'missing opened_at falls back to last_seen');

  const two = activeOthers(
    [fresh(UUID_B, 10), fresh(UUID_A, 10, { opened_at: new Date(NOW - 600000).toISOString() })],
    UUID_ME,
    NOW,
    TTL
  );
  check(two.length === 2 && two[0].staffId === UUID_A, 'sorted earliest-opened first (they have the strongest claim)');
}

console.log('--- presenceChipText / minutesAgoText / actionedChipText ---');
{
  check(presenceChipText([]) === '', 'no others -> no chip');
  check(presenceChipText(null) === '', 'null -> no chip, never throws');
  check(presenceChipText([{ label: 'david.triska' }]) === '👁 david.triska', 'single name shown');
  check(
    presenceChipText([{ label: 'a' }, { label: 'b' }]) === '👁 2 colleagues',
    'multiple counted, not listed (fixed-width cell)'
  );

  const NOW = Date.parse('2026-08-04T12:00:00Z');
  check(minutesAgoText(NOW - 20000, NOW) === 'just now', '<1 min -> just now');
  check(minutesAgoText(NOW - 60000, NOW) === '1 min ago', 'singular minute');
  check(minutesAgoText(NOW - 600000, NOW) === '10 min ago', 'minutes');
  check(minutesAgoText(NOW - 3900000, NOW) === '1 hr ago', 'singular hour');
  check(minutesAgoText(NOW - 7500000, NOW) === '2 hrs ago', 'plural hours');

  check(actionedChipText('', '') === '', 'no actionedBy -> no chip (untouched task stays clean)');
  check(
    actionedChipText('Dr David Triska', '04 Aug 2026, 13:49') === '✎ Dr David Triska · 13:49',
    'name + time-of-day extracted'
  );
  check(actionedChipText('Dr X', 'weird format') === '✎ Dr X', 'unrecognised datetime -> name only, never garbage');
  check(actionedChipText('Dr X', '') === '✎ Dr X', 'missing datetime tolerated');
  check(actionedChipText('x'.repeat(80), '').length <= 42, 'name capped for the fixed-width cell');
}

console.log('--- buildPresenceInFilter: PostgREST in.() for queue reads ---');
{
  check(buildPresenceInFilter([UUID_A, UUID_B]) === `in.(${UUID_A},${UUID_B})`, 'two uuids joined');
  check(buildPresenceInFilter([UUID_A, UUID_A.toUpperCase()]) === `in.(${UUID_A})`, 'case-insensitive dedupe');
  check(
    buildPresenceInFilter(['junk', UUID_A]) === `in.(${UUID_A})`,
    'non-uuid entries dropped (they would corrupt the filter syntax)'
  );
  check(buildPresenceInFilter([]) === '', 'empty -> empty string (caller skips the fetch)');
  check(buildPresenceInFilter(null) === '', 'null -> empty, never throws');
  const many = [];
  for (let i = 0; i < 150; i++) many.push(`019fccd2-7a31-73be-bb0b-${String(100000000000 + i).slice(0, 12)}`);
  const capped = buildPresenceInFilter(many);
  check(capped.split(',').length === 100, 'capped at 100 uuids');
  const custom = buildPresenceInFilter(many, 5);
  check(custom.split(',').length === 5, 'explicit cap honoured');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
