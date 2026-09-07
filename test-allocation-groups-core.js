// Medicus Suite — allocation-groups-core tests
// Run with: node test-allocation-groups-core.js
'use strict';

const C = require('./shared/allocation-groups-core.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log('  OK  ' + msg);
    passed++;
  } else {
    console.error('  FAIL  ' + msg);
    failed++;
  }
}

function uuid(n) {
  const hex = String(n).padStart(12, '0');
  return 'aaaaaaaa-bbbb-cccc-dddd-' + hex;
}

function weekdayMorning() {
  return {
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    start: '08:00',
    end: '13:00',
  };
}

// Monday 8 Sep 2026 is a Tuesday wait — 2026-09-07 is Monday.
// Use a known London instant: 2026-09-07T08:30:00Z is 09:30 BST (BST = UTC+1 in September).
const MON_0930_LONDON = '2026-09-07T08:30:00Z'; // Monday 09:30 Europe/London
const MON_1400_LONDON = '2026-09-07T13:00:00Z'; // Monday 14:00 Europe/London
const SAT_0930_LONDON = '2026-09-12T08:30:00Z'; // Saturday 09:30 Europe/London

console.log('--- schema ---');
{
  check(C.presetErrors({})[0] === 'group needs a name', 'empty object needs a name');
  check(C.presetErrors({ name: '  ' })[0] === 'group needs a name', 'whitespace name is empty');
  check(C.presetErrors({ name: 'Morning' })[0] === 'group needs at least one person', 'name without people');
  const tooMany = {
    name: 'Huge',
    memberIds: Array.from({ length: 13 }, (_, i) => uuid(i + 1)),
  };
  check(
    C.presetErrors(tooMany)[0] === 'a group can have at most ' + C.MAX_MEMBERS + ' people',
    'cap 12 people'
  );
  const ok = C.normalisePreset({
    name: '  Morning   triage ',
    memberIds: [uuid(1), uuid(1), uuid(2)],
    memberNames: { [uuid(1)]: 'Dr Dave Triska', [uuid(2)]: 'Dr Sarah Chen' },
  });
  check(!!ok && ok.name === 'Morning triage', 'name is trimmed and collapsed');
  check(ok.memberIds.length === 2, 'duplicate member ids are dropped');
  check(ok.memberIds[0] === uuid(1) && ok.memberIds[1] === uuid(2), 'member order is first-seen');
  check(ok.schedule === null, 'missing schedule is null (always visible)');
  check(C.isUuid(ok.id), 'missing id is generated as a UUID');
  check(C.normalisePreset({ name: 'X', id: 'not-a-uuid', memberIds: [uuid(1)] }) === null, 'bad id is refused');
}

console.log('\n--- schedule ---');
{
  check(C.scheduleErrors({ days: ['mon'], start: '08:00', end: '08:00' }).length > 0, 'end === start refused');
  check(C.scheduleErrors({ days: ['mon'], start: '13:00', end: '08:00' }).length > 0, 'overnight wrap refused');
  check(C.scheduleErrors({ days: [], start: '08:00', end: '13:00' }).length > 0, 'no days refused');
  check(C.scheduleErrors({ days: ['mon'], start: '25:00', end: '13:00' }).length > 0, 'bad start refused');
  const sched = C.normaliseSchedule({ days: ['fri', 'mon', 'mon', 'xyz'], start: '8:00', end: '13:00' });
  check(sched && sched.days.join(',') === 'mon,fri', 'days unique, ordered, unknown dropped');
  check(sched.start === '08:00' && sched.end === '13:00', 'start padded to HH:MM');
  const clock = C.londonClock(MON_0930_LONDON);
  check(clock.day === 'mon', '2026-09-07 09:30 London is Monday (got ' + clock.day + ')');
  check(clock.minutes === 9 * 60 + 30, 'minutes since midnight 09:30 (got ' + clock.minutes + ')');
}

console.log('\n--- visibility ---');
{
  const morning = C.normalisePreset({
    name: 'Morning triage',
    memberIds: [uuid(1)],
    memberNames: { [uuid(1)]: 'Dr Dave' },
    schedule: weekdayMorning(),
  });
  const always = C.normalisePreset({
    name: 'Duty',
    memberIds: [uuid(2)],
    memberNames: { [uuid(2)]: 'Dr Sam' },
  });
  check(C.groupIsVisible(morning, MON_0930_LONDON) === true, 'weekday morning is visible at 09:30');
  check(C.groupIsVisible(morning, MON_1400_LONDON) === false, 'weekday morning is hidden at 14:00');
  check(C.groupIsVisible(morning, SAT_0930_LONDON) === false, 'weekday morning is hidden on Saturday');
  check(C.groupIsVisible(always, SAT_0930_LONDON) === true, 'unscheduled is always visible');
  check(C.groupIsVisible(morning, '2026-09-07T12:00:00Z') === false, 'end is exclusive — 13:00 London is out');
  check(C.groupIsVisible(morning, '2026-09-07T07:00:00Z') === true, 'start is inclusive — 08:00 London is in');
}

console.log('\n--- default dest set ---');
{
  const morning = C.normalisePreset({
    id: uuid(10),
    name: 'Morning triage',
    memberIds: [uuid(1)],
    schedule: weekdayMorning(),
  });
  const afternoon = C.normalisePreset({
    id: uuid(11),
    name: 'Afternoon triage',
    memberIds: [uuid(2)],
    schedule: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '13:00', end: '18:00' },
  });
  const always = C.normalisePreset({
    id: uuid(12),
    name: 'Partners',
    memberIds: [uuid(3)],
  });
  const presets = [morning, afternoon, always];
  const atMorning = C.defaultDestSet(presets, MON_0930_LONDON, null);
  check(atMorning.kind === 'group' && atMorning.id === morning.id, 'exactly one in-window scheduled group is the default');
  const atAfternoon = C.defaultDestSet(presets, MON_1400_LONDON, null);
  check(atAfternoon.kind === 'group' && atAfternoon.id === afternoon.id, 'afternoon window picks afternoon group');
  const weekend = C.defaultDestSet(presets, SAT_0930_LONDON, { kind: 'group', id: morning.id });
  check(weekend.kind === 'in-today', 'out-of-window last-used is not the default');
  const weekendAlways = C.defaultDestSet(presets, SAT_0930_LONDON, { kind: 'group', id: always.id });
  check(weekendAlways.kind === 'group' && weekendAlways.id === always.id, 'unscheduled last-used still visible is kept');
  const bothDay = [
    C.normalisePreset({
      id: uuid(20),
      name: 'A',
      memberIds: [uuid(1)],
      schedule: { days: ['mon'], start: '08:00', end: '18:00' },
    }),
    C.normalisePreset({
      id: uuid(21),
      name: 'B',
      memberIds: [uuid(2)],
      schedule: { days: ['mon'], start: '08:00', end: '18:00' },
    }),
  ];
  const clash = C.defaultDestSet(bothDay, MON_0930_LONDON, null);
  check(clash.kind === 'in-today', 'two in-window scheduled groups → In today');
  const clashLast = C.defaultDestSet(bothDay, MON_0930_LONDON, { kind: 'group', id: uuid(21) });
  check(clashLast.kind === 'group' && clashLast.id === uuid(21), 'two in-window: last-used among them wins');
}

console.log('\n--- members for split / away skip ---');
{
  const group = C.normalisePreset({
    name: 'Morning',
    memberIds: [uuid(1), uuid(2), uuid(3)],
    memberNames: {
      [uuid(1)]: 'Dr Dave Triska',
      [uuid(2)]: 'Dr Sarah Chen',
      [uuid(3)]: 'Dr Tom Hale',
    },
  });
  const away = C.membersForSplit(group, {
    presenceFor: function (m) {
      return m.staffId === uuid(2) ? { state: 'away' } : { state: 'present' };
    },
  });
  check(away.dests.length === 2, 'away member is not a dest');
  check(away.dests.map((d) => d.name).join(',') === 'Dr Dave Triska,Dr Tom Hale', 'remaining dests keep order');
  check(away.skipped.length === 1 && away.skipped[0].reason === 'away', 'away is listed as skipped');
  check(
    C.skippedPhrase(away.skipped) === 'Dr Sarah Chen is away — skipped.',
    'skipped phrase names the away person'
  );
  const allAway = C.membersForSplit(group, {
    presenceFor: function () {
      return { state: 'away-pending' };
    },
  });
  check(allAway.dests.length === 0 && /away/i.test(allAway.reason), 'all-away refuses the split');
}

console.log('\n--- destsFromSet ---');
{
  const group = C.normalisePreset({
    id: uuid(30),
    name: 'Morning',
    memberIds: [uuid(1)],
    memberNames: { [uuid(1)]: 'Dr Dave' },
  });
  const fromGroup = C.destsFromSet({ kind: 'group', id: uuid(30) }, { presets: [group] });
  check(fromGroup.dests.length === 1 && fromGroup.dests[0].staffId === uuid(1), 'group set resolves members');
  const missing = C.destsFromSet({ kind: 'group', id: uuid(99) }, { presets: [group] });
  check(/unknown/i.test(missing.reason), 'unknown group is refused');
  const inToday = C.destsFromSet(
    { kind: 'in-today' },
    { inToday: [{ name: 'Dr A', staffId: uuid(4), key: 'clinician:a|d' }] }
  );
  check(inToday.dests[0].name === 'Dr A' && inToday.dests[0].key === 'clinician:a|d', 'in-today uses the book list');
  const junkId = C.destsFromSet(
    { kind: 'in-today' },
    { inToday: [{ name: 'Dr A', staffId: 'not-a-uuid', key: 'clinician:a|d' }] }
  );
  check(junkId.dests[0].staffId === '', 'in-today drops a non-UUID staffId rather than forwarding it');
  const emptyToday = C.destsFromSet({ kind: 'in-today' }, { inToday: [] });
  check(emptyToday.dests.length === 0 && /appointment book/i.test(emptyToday.reason), 'empty in-today has a reason');
  const custom = C.destsFromSet({
    kind: 'custom',
    members: [
      { id: uuid(1), name: 'Dr Dave' },
      { id: uuid(2), name: 'Dr Sarah' },
    ],
  });
  check(custom.dests.length === 2, 'custom ticks become dests');
}

console.log('\n--- upsert / last-used ---');
{
  const first = C.upsertPreset([], { name: 'Morning', memberIds: [uuid(1)] });
  check(first.ok && first.presets.length === 1, 'upsert creates');
  const again = C.upsertPreset(first.presets, {
    id: first.preset.id,
    name: 'Morning triage',
    memberIds: [uuid(1), uuid(2)],
  });
  check(again.presets.length === 1 && again.preset.name === 'Morning triage', 'upsert updates in place');
  const gone = C.removePreset(again.presets, first.preset.id);
  check(gone.presets.length === 0, 'remove drops the group');
  let cfg = C.rememberLastUsed({}, 'rx', { kind: 'group', id: uuid(1) });
  check(cfg.lastUsedBySurface.rx.kind === 'group', 'last-used group is stored per surface');
  cfg = C.rememberLastUsed(cfg, 'rx', { kind: 'custom', members: [] });
  check(cfg.lastUsedBySurface.rx.kind === 'group', 'custom dest set is not remembered');
  cfg = C.rememberLastUsed(cfg, 'lab', { kind: 'in-today' });
  check(cfg.lastUsedBySurface.lab.kind === 'in-today', 'in-today last-used is stored');
  const dirty = C.normaliseConfig({ lastUsedBySurface: { rx: { kind: 'group', id: 'nope' }, hack: {} } });
  check(!dirty.lastUsedBySurface.rx, 'invalid last-used id is dropped');
}

console.log('\n--- ' + passed + ' passed, ' + failed + ' failed ---');
if (failed) process.exit(1);
