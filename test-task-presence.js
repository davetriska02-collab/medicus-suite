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
  parseTaskListPath,
  validPresenceConfig,
  buildHeartbeatPayload,
  activeOthers,
  presenceChipText,
  minutesAgoText,
  actionedChipText,
  resolvePresenceConfig,
  buildPresenceInFilter,
  labelFromPresenceInfo,
  initialsFromLabel,
  avatarHue,
  sanitizeNativePresence,
  sanitizeNativeListPresence,
  parsePresenceTaskChannel,
  parsePresenceListChannel,
  othersOnTask,
  occupiedHeadline,
  listOccupiedHeadline,
  occupiedAction,
  occupiedNote,
  occupiedNameList,
  occupiedBannerTitle,
  occupancyHideHint,
  occupiedInnerHtml,
  listOccupiedInnerHtml,
  unknownColleagueLabel,
  preferKnownLabel,
  occupancyDismissKey,
  occupancyDismissValue,
  occupancyIsDismissed,
  occupancyWriteDismiss,
  sanitizeSelfExtras,
  AVATAR_HUES,
  safeAvatarHue,
} = require('./content-scripts/task-presence.js');
const {
  presenceEmitDecision,
  presenceSelfExtras,
  currentTaskListSlug,
  PRESENCE_LIST_CH_RE,
} = require('./content-scripts/triage-lens/page-world.js');

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

console.log('--- resolvePresenceConfig: shared-folder fire-and-forget resolution ---');
{
  const FILE = { 'presence.fileCache': { url: 'https://proj.supabase.co', key: 'f'.repeat(40) } };
  const MANUAL = { 'presence.url': 'https://manual.supabase.co', 'presence.key': 'm'.repeat(40) };

  const fileOnly = resolvePresenceConfig(FILE);
  check(
    fileOnly.url === 'https://proj.supabase.co' && fileOnly.key === 'f'.repeat(40),
    'file cache used when no manual values'
  );
  check(fileOnly.source === 'file', 'source reported as file');
  check(
    fileOnly.enabled === true,
    'never-touched enabled -> ON (fire-and-forget: a machine that never opened Options runs)'
  );
  check(validPresenceConfig(fileOnly) === true, 'file-resolved config passes the shape gate end-to-end');

  const both = resolvePresenceConfig({ ...FILE, ...MANUAL });
  check(both.url === 'https://manual.supabase.co' && both.source === 'manual', 'manual override wins over the file');

  const manualPartial = resolvePresenceConfig({ ...FILE, 'presence.url': 'https://manual.supabase.co' });
  check(manualPartial.source === 'file', 'manual url WITHOUT key does not half-override — falls back to the file pair');

  const optedOut = resolvePresenceConfig({ ...FILE, 'presence.enabled': false });
  check(optedOut.enabled === false, 'explicit opt-out respected');
  check(validPresenceConfig(optedOut) === false, 'opted-out machine fails the gate even with a valid store');
  check(resolvePresenceConfig({ ...FILE, 'presence.enabled': true }).enabled === true, 'explicit opt-in respected');

  const none = resolvePresenceConfig({});
  check(none.source === 'none' && none.url === '' && none.key === '', 'nothing configured -> empty');
  check(validPresenceConfig(none) === false, 'unconfigured machine stays dormant');

  const junkCache = resolvePresenceConfig({ 'presence.fileCache': 'not-an-object' });
  check(junkCache.source === 'none', 'corrupt file cache -> treated as absent, never throws');
  check(resolvePresenceConfig(null).source === 'none', 'null storage snapshot -> empty, never throws');

  const trailing = resolvePresenceConfig({
    'presence.fileCache': { url: 'https://proj.supabase.co///', key: 'f'.repeat(40) },
  });
  check(trailing.url === 'https://proj.supabase.co', 'trailing slashes stripped from file url');
  check(resolvePresenceConfig(FILE).name === '', 'no name key -> empty string');
  check(resolvePresenceConfig({ ...FILE, 'presence.name': 'Dr D' }).name === 'Dr D', 'name passed through');
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

console.log('--- native Pusher presence: label / initials / sanitise ---');
{
  check(labelFromPresenceInfo({ displayName: 'Aisha Malik' }) === 'Aisha Malik', 'displayName wins');
  check(labelFromPresenceInfo({ firstName: 'Aisha', lastName: 'Malik' }) === 'Aisha Malik', 'first+last joined');
  check(labelFromPresenceInfo({ email: 'aisha.malik@nhs.net' }) === 'aisha.malik', 'email local part');
  check(labelFromPresenceInfo({ initials: 'AM' }) === 'AM', 'initials fallback when no name');
  check(labelFromPresenceInfo(null) === '', 'null info -> empty');
  check(labelFromPresenceInfo({ patientName: 'Jordan Hale' }) === '', 'patient-shaped key is not a label source');

  check(initialsFromLabel('Dr Aisha Malik') === 'AM', 'skips Dr');
  check(initialsFromLabel('david.triska') === 'DT', 'dotted local-part');
  check(initialsFromLabel('AM') === 'AM', 'already-initials');
  check(initialsFromLabel('') === '?', 'empty -> placeholder');
  check(initialsFromLabel('Jo') === 'JO', 'short single token');

  check(avatarHue(UUID_A) === avatarHue(UUID_A), 'hue is deterministic');
  check(/^#[0-9a-f]{6}$/i.test(avatarHue(UUID_A)), 'hue is a hex');
  check(
    !/#dc2626|#b45309/i.test([avatarHue(UUID_A), avatarHue(UUID_B), avatarHue(UUID_ME)].join()),
    'identity hues are not status red/amber'
  );

  const native = sanitizeNativePresence(
    {
      taskUuid: UUID_A,
      members: [
        { id: UUID_ME, info: { displayName: 'Me' } },
        { id: UUID_B, info: { displayName: 'Aisha Malik', initials: 'AM' } },
        { id: 'not-a-uuid', info: { displayName: 'Nope' } },
        { id: UUID_B, info: { displayName: 'dup' } },
      ],
    },
    UUID_ME,
    UUID_A
  );
  check(native.length === 1 && native[0].staffId === UUID_B, 'self / junk / dup dropped');
  check(native[0].label === 'Aisha Malik' && native[0].initials === 'AM', 'label + initials from info');
  check(native[0].native === true, 'flagged as native');
  check(
    sanitizeNativePresence({ taskUuid: UUID_A, members: [{ id: UUID_B, info: {} }] }, UUID_ME, UUID_B).length === 0,
    'wrong task uuid -> empty'
  );
  check(sanitizeNativePresence(null, UUID_ME, UUID_A).length === 0, 'null detail -> empty');
  check(
    sanitizeNativePresence({ taskUuid: UUID_A, members: [{ id: UUID_B, info: {} }] }, UUID_ME, UUID_A)[0].label ===
      'A colleague',
    'empty info -> A colleague (never Someone else)'
  );
  check(
    sanitizeNativePresence({ taskUuid: UUID_A, members: [{ id: UUID_B, info: {} }] }, UUID_ME, UUID_A)[0].initials ===
      '?',
    'unknown identity uses ? not invented initials'
  );

  check(unknownColleagueLabel() === 'A colleague', 'fallback helper is A colleague, not Someone');
  check(
    occupiedHeadline([{ label: 'Dr Priya Nair' }]) === 'Dr Priya Nair has this open. You can still work it.',
    'single headline merges who + you can still work it'
  );
  check(
    occupiedHeadline([{ label: 'Dr Priya Nair' }, { label: 'Dr Sam Okonkwo' }]) ===
      'Dr Priya Nair and Dr Sam Okonkwo have this open. You can still work it.',
    'two names'
  );
  check(
    occupiedHeadline([{ label: 'A' }, { label: 'B' }, { label: 'C' }]) ===
      'A, B and C have this open. You can still work it.',
    'three: all three names, no "1 other"'
  );
  check(
    occupiedHeadline([
      { label: 'Dr Priya Nair' },
      { label: 'Dr Sam Okonkwo' },
      { label: 'c' },
      { label: 'd' },
      { label: 'e' },
      { label: 'f' },
    ]) === 'Dr Priya Nair, Dr Sam Okonkwo, c and 3 others have this open. You can still work it.',
    'six: three names then 3 others'
  );
  check(
    occupiedHeadline([{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }]) ===
      'A, B, C and 1 other have this open. You can still work it.',
    'four: three names then 1 other'
  );
  check(occupiedNameList(['A']) === 'A', 'name list: 1');
  check(occupiedNameList(['A', 'B']) === 'A and B', 'name list: 2');
  check(occupiedNameList(['A', 'B', 'C']) === 'A, B and C', 'name list: 3');
  check(occupiedNameList(['A', 'B', 'C', 'D']) === 'A, B, C and 1 other', 'name list: 4+');
  check(
    occupiedHeadline([{ label: 'A colleague' }]) === 'A colleague has this open. You can still work it.',
    'one unknown: A colleague has this open'
  );
  check(
    occupiedHeadline([{ label: '' }]) === 'A colleague has this open. You can still work it.',
    'blank label uses A colleague, never Someone else'
  );
  check(
    occupiedHeadline([{ label: 'A colleague' }, { label: 'A colleague' }]) ===
      'Two colleagues have this open (names not shown). You can still work it.',
    'two unknowns: Two colleagues (names not shown), not "a colleague and a colleague"'
  );
  check(
    occupiedHeadline([{ label: 'A colleague' }, { label: 'A colleague' }, { label: 'A colleague' }]) ===
      '3 colleagues have this open (names not shown). You can still work it.',
    'three unknowns: N colleagues (names not shown)'
  );
  check(
    occupiedHeadline([{ label: 'Dr Priya Nair' }, { label: 'A colleague' }]) ===
      'Dr Priya Nair and a colleague have this open. You can still work it.',
    'mixed: named + a colleague'
  );
  check(!/someone else/i.test(occupiedHeadline([{ label: 'Someone else' }])), 'legacy Someone else is rewritten');
  check(
    occupiedHeadline([{ selfExtra: true, label: 'You' }]) ===
      'You also have this open somewhere else. You can still work it.',
    'dual-tab self headline'
  );
  check(occupiedHeadline([]) === '', 'no others -> empty headline');
  check(
    !/is on this request/i.test(occupiedHeadline([{ label: 'Dr Priya Nair' }])),
    'headline never says is on this request'
  );
  check(occupiedAction() === '', 'action is not a separate visible line');
  check(occupiedAction([{ selfExtra: true }]) === '', 'dual-tab self action is empty (folded into headline)');
  check(!/opened/i.test(occupiedAction()), 'action never says opened');
  check(!/locked out/i.test(occupiedAction()), 'action never says locked out');
  check(!/carry on/i.test(occupiedAction()), 'action never says carry on');
  check(!/check with them/i.test(occupiedAction()), 'action never says check with them');
  check(
    occupiedBannerTitle() === 'A colleague has this request open. It is not assigned to them. You can still work it.',
    'tooltip: colleague has it open, not assigned, can still work it'
  );
  check(
    occupancyHideHint() === 'Hide this warning until someone else joins. It comes back if the people change.',
    'Hide title/aria-label explains dismiss-until-set-changes'
  );

  const NOW = Date.parse('2026-09-07T12:00:00Z');
  check(
    occupiedNote([{ native: true, openedAtMs: NOW - 20000 }], NOW) === '',
    'native recency is the pulse, not a word'
  );
  check(
    occupiedNote([{ native: true, openedAtMs: NOW - 180000 }], NOW) === '',
    'native dwell is not a visible word either'
  );
  check(
    !/On it now/i.test(occupiedNote([{ native: true, openedAtMs: NOW - 180000 }], NOW)),
    'native note never says On it now'
  );
  check(
    !/Opened/i.test(occupiedNote([{ native: true, openedAtMs: NOW - 180000 }], NOW)),
    'native note never says Opened'
  );
  check(occupiedNote([{ openedAtMs: NOW }], NOW) === '', 'store just-now has no recency word');
  check(occupiedNote([{ openedAtMs: NOW - 120000 }], NOW) === 'Seen 2 min ago', 'store recency is Seen N min ago');

  const inner = occupiedInnerHtml(
    [{ label: 'Dr Priya Nair', initials: 'PN', hue: '#047857', native: true, openedAtMs: NOW }],
    NOW
  );
  check(!/On it now/.test(inner) && !/>Live</.test(inner), 'strip HTML has no On it now / LIVE word');
  check(/class="ms-tp-live"[^>]*aria-hidden="true"/.test(inner), 'pulse pip stays, aria-hidden, no recency word');
  check(
    inner.indexOf('Dr Priya Nair has this open. You can still work it.') >= 0,
    'strip HTML is one sentence at headline weight'
  );
  check(!/They have it open/.test(inner) && !/is on this request/.test(inner), 'old two-line copy is gone');
  check(!/class="ms-tp-action"/.test(inner), 'no separate action span on the visible strip');
  check(
    inner.indexOf(occupancyHideHint()) >= 0 && /aria-label="/.test(inner) && /title="/.test(inner),
    'Hide button has title and aria-label'
  );
  check(/>Hide for now</.test(inner), 'Hide button visible label is Hide for now');
  check(!/ms-tp-hide"[^>]*tabindex="-1"/.test(inner), 'Hide button is not removed from tab order');
  check(
    occupiedInnerHtml([{ label: 'A colleague', initials: '?', native: true, openedAtMs: NOW }], NOW).indexOf(
      'A colleague (name not shown)'
    ) >= 0,
    'unknown avatar title is A colleague (name not shown)'
  );

  check(
    sanitizeNativePresence({ taskUuid: UUID_A, members: [{ id: UUID_B, info: {} }] }, null, UUID_A).length === 0,
    'no self id -> empty (would otherwise paint YOU as occupying)'
  );
  check(
    sanitizeNativePresence({ taskUuid: UUID_A, members: [{ id: UUID_B, info: {} }] }, UUID_ME, '').length === 0,
    'not on an overview -> empty'
  );
  check(
    sanitizeNativePresence(
      { taskUuid: UUID_A, members: [{ id: UUID_ME, info: { displayName: 'Me' } }] },
      UUID_ME,
      UUID_A
    ).length === 0,
    'only-self membership -> no bar'
  );

  check(
    parsePresenceTaskChannel('presence-560b6c-task-' + UUID_A).taskUuid === UUID_A,
    'per-task presence channel parses'
  );
  check(
    parsePresenceTaskChannel('presence-560b6c-task-list-medical_patient_request_task') === null,
    'queue presence channel is NOT a per-task occupant'
  );
  check(parsePresenceTaskChannel('560b6c-task-' + UUID_A) === null, 'public task channel is not presence');

  const leftover = othersOnTask(
    [
      { staffId: UUID_B, taskUuid: UUID_A, label: 'Aisha' },
      { staffId: UUID_ME, taskUuid: UUID_B, label: 'stale' },
    ],
    UUID_A
  );
  check(leftover.length === 1 && leftover[0].staffId === UUID_B, 'stale occupant from another request dropped');
  check(
    othersOnTask([{ staffId: UUID_B, label: 'no uuid' }], UUID_A).length === 0,
    'missing taskUuid is dropped when an expected uuid is set'
  );
}

console.log('--- live:false hides; missing live still shows ---');
{
  check(
    sanitizeNativePresence(
      { taskUuid: UUID_A, members: [{ id: UUID_B, info: { displayName: 'Aisha' } }], live: false },
      UUID_ME,
      UUID_A
    ).length === 0,
    'live === false -> empty (strip hides; do not claim Live on a dead socket)'
  );
  check(
    sanitizeNativePresence(
      { taskUuid: UUID_A, members: [{ id: UUID_B, info: { displayName: 'Aisha' } }] },
      UUID_ME,
      UUID_A
    ).length === 1,
    'omitted live is treated as live (rig fixtures omit it)'
  );
  check(
    sanitizeNativePresence(
      { taskUuid: UUID_A, members: [{ id: UUID_B, info: { displayName: 'Aisha' } }], live: true },
      UUID_ME,
      UUID_A
    ).length === 1,
    'live === true keeps the member'
  );
}

console.log('--- list channel parse + path: queue occupancy, never a request occupant ---');
{
  const listCh = parsePresenceListChannel('presence-560b6c-task-list-medical_patient_request_task');
  check(!!listCh && listCh.site === '560b6c', 'list channel site');
  check(listCh.slug === 'medical_patient_request_task', 'list channel slug');
  check(
    parsePresenceListChannel('presence-560b6c-task-' + UUID_A) === null,
    'per-task uuid channel is NOT a list channel'
  );
  check(
    parsePresenceTaskChannel('presence-560b6c-task-list-medical_patient_request_task') === null,
    'list channel is still null from parsePresenceTaskChannel'
  );
  check(PRESENCE_LIST_CH_RE.test('presence-560b6c-task-' + UUID_A) === false, 'task-uuid regex does not consume list');
  check(
    PRESENCE_LIST_CH_RE.test('presence-560b6c-task-list-medical_patient_request_task') === true,
    'list regex matches task-list slug'
  );
  check(
    currentTaskListSlug('/560b6c/tasks/medical_patient_request_task/task-list') === 'medical_patient_request_task',
    'currentTaskListSlug from /tasks/{slug}/task-list'
  );
  check(
    currentTaskListSlug('/560b6c/tasks/data/medical_patient_request_task/task-list') === 'medical_patient_request_task',
    'currentTaskListSlug from /tasks/data/{slug}/task-list'
  );
  check(
    currentTaskListSlug('/560b6c/tasks/medical_patient_request_task/overview/' + UUID_A) === '',
    'overview is not a list'
  );
  check(
    parseTaskListPath('/560b6c/tasks/medical_patient_request_task/task-list').slug === 'medical_patient_request_task',
    'parseTaskListPath route shape'
  );
  check(
    parseTaskListPath('/560b6c/tasks/data/medical_patient_request_task/task-list').slug ===
      'medical_patient_request_task',
    'parseTaskListPath data shape'
  );
}

console.log('--- listOccupiedHeadline: 1 / 2 / 3+ / unknown ---');
{
  check(
    listOccupiedHeadline([{ label: 'Dr Priya Nair' }]) === 'Dr Priya Nair is also on this list. You can still work it.',
    'one named colleague'
  );
  check(
    listOccupiedHeadline([{ label: 'Dr Priya Nair' }, { label: 'Dr Sam Okonkwo' }]) ===
      'Dr Priya Nair and Dr Sam Okonkwo are also on this list. You can still work it.',
    'two named colleagues'
  );
  check(
    listOccupiedHeadline([{ label: 'A' }, { label: 'B' }, { label: 'C' }]) ===
      'A, B and 1 other are also on this list. You can still work it.',
    'three+ uses A, B and N others'
  );
  check(
    listOccupiedHeadline([{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }]) ===
      'A, B and 2 others are also on this list. You can still work it.',
    'four is A, B and 2 others'
  );
  check(
    listOccupiedHeadline([{ label: 'A colleague' }]) === 'A colleague is also on this list. You can still work it.',
    'unknown colleague'
  );
  check(listOccupiedHeadline([]) === '', 'empty others -> empty headline');
  const listHtml = listOccupiedInnerHtml([{ label: 'Dr Priya Nair', initials: 'PN', hue: '#1e3a5f', native: true }]);
  check(listHtml.indexOf('Dr Priya Nair is also on this list.') >= 0, 'list inner html carries the lead');
  check(listHtml.indexOf('You can still work it.') >= 0, 'list inner html carries the quiet clause');
  check(listHtml.indexOf('ms-tp-quiet') >= 0, 'quiet clause is one step quieter');
  check(!/lock/i.test(listHtml), 'list strip never says lock');
}

console.log('--- sanitizeNativeListPresence: drop self; empty / live:false hides ---');
{
  const slug = 'medical_patient_request_task';
  const priya = {
    slug,
    members: [{ id: UUID_B, info: { displayName: 'Dr Priya Nair' } }],
  };
  const got = sanitizeNativeListPresence(priya, UUID_ME, slug);
  check(got.length === 1 && got[0].staffId === UUID_B, 'other on this list kept');
  check(got[0].listSlug === slug && got[0].taskUuid === undefined, 'list member carries listSlug, never a taskUuid');
  check(
    sanitizeNativeListPresence({ slug, members: [{ id: UUID_ME, info: { displayName: 'Me' } }] }, UUID_ME, slug)
      .length === 0,
    'only-self membership -> hide'
  );
  check(sanitizeNativeListPresence(priya, null, slug).length === 0, 'no self id -> hide');
  check(sanitizeNativeListPresence(priya, UUID_ME, 'other_slug').length === 0, 'wrong slug -> hide');
  check(
    sanitizeNativeListPresence(
      { slug, members: [{ id: UUID_B, info: { displayName: 'Priya' } }], live: false },
      UUID_ME,
      slug
    ).length === 0,
    'live === false hides'
  );
  check(sanitizeNativeListPresence(priya, UUID_ME, slug).length === 1, 'omitted live is treated as live');
  check(
    othersOnTask([{ staffId: UUID_B, listSlug: slug, label: 'Priya' }], UUID_A).length === 0,
    'list members are not per-request occupants'
  );
}

console.log('--- preferKnownLabel: native empty info uses store/cache name ---');
{
  const cache = {};
  check(preferKnownLabel('A colleague', UUID_B, cache) === 'A colleague', 'nothing known -> A colleague');
  check(preferKnownLabel('Someone else', UUID_B, cache) === 'A colleague', 'legacy Someone else -> A colleague');
  check(preferKnownLabel('Aisha Malik', UUID_B, { [UUID_B]: 'Other' }) === 'Aisha Malik', 'a real native name wins');
  check(
    preferKnownLabel('A colleague', UUID_B, { [UUID_B]: 'Dr Priya Nair' }) === 'Dr Priya Nair',
    'empty native info + known cache -> known label'
  );
  check(
    preferKnownLabel('', UUID_B, { [UUID_B]: 'A colleague' }) === 'A colleague',
    'generic A colleague is not a known name'
  );
}

console.log('--- occupancy dismiss key: this request + this tab ---');
{
  const mem = {
    store: {},
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null;
    },
    setItem: function (k, v) {
      this.store[k] = String(v);
    },
  };
  check(occupancyDismissKey(UUID_A) === 'ms-tp-dismiss:' + UUID_A, 'sessionStorage key is ms-tp-dismiss:{taskUuid}');
  check(
    occupancyDismissValue([UUID_B, UUID_ME]) === occupancyDismissValue([UUID_ME, UUID_B]),
    'dismiss value is sorted, order-independent'
  );
  occupancyWriteDismiss(UUID_A, [UUID_B, UUID_ME], mem);
  check(occupancyIsDismissed(UUID_A, [UUID_ME, UUID_B], mem) === true, 'same member set stays hidden');
  check(occupancyIsDismissed(UUID_A, [UUID_B], mem) === false, 'a new joiner (set change) is not dismissed');
  check(occupancyIsDismissed(UUID_B, [UUID_B, UUID_ME], mem) === false, 'a different request is not dismissed');
  check(
    occupancyIsDismissed(UUID_A, [UUID_B, UUID_ME], {
      getItem: function () {
        return null;
      },
    }) === false,
    'empty storage -> not dismissed'
  );
}

console.log('--- presenceEmitDecision: wipe fires; idle emits once ---');
{
  const first = presenceEmitDecision('', UUID_A, [{ id: UUID_B }], true);
  check(first.emit === true, 'first occupy emits');
  check(first.sig.indexOf(UUID_A + ':' + UUID_B) === 0, 'sig starts with task:member');

  const same = presenceEmitDecision(first.sig, UUID_A, [{ id: UUID_B }], true);
  check(same.emit === false, 'unchanged members are de-duped');

  const wipe = presenceEmitDecision(first.sig, UUID_B, [], true);
  check(wipe.emit === true, 'task change emits empty members (the wipe that used to be de-duped)');
  check(wipe.sig.indexOf(UUID_B + ':') === 0, 'wipe sig is the new task with empty members');

  const idle1 = presenceEmitDecision(wipe.sig, '', []);
  check(idle1.emit === true && idle1.sig === 'idle', 'leaving an overview emits idle once');
  const idle2 = presenceEmitDecision('idle', '', []);
  check(idle2.emit === false && idle2.sig === 'idle', 'idle does not flap an empty event forever');
  const idle0 = presenceEmitDecision('', '', []);
  check(idle0.emit === false, 'a page that never had presence does not emit idle');

  const dead = presenceEmitDecision(first.sig, UUID_A, [], false);
  check(dead.emit === true, 'socket-down (live:false, members:[]) emits so the strip can hide');
  check(/:0$/.test(dead.sig), 'dead-socket sig carries the live:false bit');

  const extra1 = presenceEmitDecision('', UUID_A, [{ id: UUID_ME }], true, 1);
  check(extra1.emit === true && /:x1$/.test(extra1.sig), 'selfExtras>=1 is in the emit sig');
  const extraSame = presenceEmitDecision(extra1.sig, UUID_A, [{ id: UUID_ME }], true, 1);
  check(extraSame.emit === false, 'unchanged selfExtras is de-duped');
  const extraOff = presenceEmitDecision(extra1.sig, UUID_A, [{ id: UUID_ME }], true, 0);
  check(extraOff.emit === true, 'selfExtras dropping to 0 emits so the dual-tab strip can hide');
}

console.log('--- presenceSelfExtras / sanitizeSelfExtras: dual-tab only when extras visible ---');
{
  check(presenceSelfExtras([UUID_ME, UUID_B], 2, UUID_ME) === 0, 'unique hash, count==unique -> 0 (Pusher collapse)');
  check(presenceSelfExtras([UUID_ME, UUID_ME], 1, UUID_ME) === 1, 'same staff UUID twice -> 1 extra');
  check(presenceSelfExtras([UUID_ME], 2, UUID_ME) === 1, 'count > unique and self present -> extras');
  check(presenceSelfExtras([UUID_B, UUID_B], 3, UUID_ME) === 0, 'extras on someone else, not self -> 0');
  check(presenceSelfExtras([UUID_ME], 2, '') === 0, 'no self id -> 0');
  check(
    sanitizeSelfExtras({ taskUuid: UUID_A, members: [], selfExtras: 1 }, UUID_ME, UUID_A) === 1,
    'selfExtras on the event is accepted'
  );
  check(
    sanitizeSelfExtras({ taskUuid: UUID_A, members: [], selfExtras: 1, live: false }, UUID_ME, UUID_A) === 0,
    'live:false drops selfExtras (fail closed)'
  );
  check(sanitizeSelfExtras({ taskUuid: UUID_A, selfExtras: 0 }, UUID_ME, UUID_A) === 0, 'selfExtras 0 is not extras');
  check(sanitizeSelfExtras({ taskUuid: UUID_B, selfExtras: 2 }, UUID_ME, UUID_A) === 0, 'wrong task -> 0');
}

console.log('--- avatar hues: applied hex, contrast, not status colours ---');
{
  AVATAR_HUES.forEach(function (h) {
    check(safeAvatarHue(h) === h, 'whitelist accepts ' + h);
    const r = parseInt(h.slice(1, 3), 16) / 255;
    const g = parseInt(h.slice(3, 5), 16) / 255;
    const b = parseInt(h.slice(5, 7), 16) / 255;
    const f = function (c) {
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const L = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    const contrast = 1.05 / (L + 0.05);
    check(contrast >= 4.5, h + ' contrast vs white is AA (' + contrast.toFixed(2) + ')');
    check(!/^#dc2626$/i.test(h) && !/^#b45309$/i.test(h), h + ' is not status red/amber');
  });
  check(safeAvatarHue('red') === '', 'non-hex rejected');
  check(safeAvatarHue('#fff') === '', 'short hex rejected');
  check(safeAvatarHue('javascript:alert(1)') === '', 'non-colour rejected');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
