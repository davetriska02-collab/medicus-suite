// Medicus Suite — appointment-book tally core
// Run with: node test-appointment-tally-core.js

'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./shared/appointment-tally-core.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
    process.exitCode = 1;
  }
}

function slot(type, start) {
  return {
    diaryEntryType: { value: 'slot' },
    appointmentType: { name: type },
    startDateTime: start,
  };
}

function appt(type, extra) {
  extra = extra || {};
  return {
    diaryEntryType: { value: 'appointment' },
    appointmentType: { name: type },
    displayStatus: { value: extra.status || 'booked' },
    appointmentStatus: extra.appointmentStatus || { isCancelled: false },
    startDateTime: extra.start || '2026-09-10 09:00:00',
  };
}

function overview(staffSchedules, unassigned) {
  return {
    date: '2026-09-10',
    staffSchedules: staffSchedules || [],
    unassignedDiaries: unassigned || [],
  };
}

const NOW = new Date('2026-09-10T12:00:00');

console.log('\n--- booked vs free ---');
{
  const raw = overview([
    {
      name: 'Dr A',
      schedule: [
        {
          scheduleType: 'diary',
          summary: { status: { isCancelled: false } },
          entries: [
            appt('GP Routine', { start: '2026-09-10 09:00:00' }),
            appt('GP Routine', { start: '2026-09-10 09:15:00' }),
            slot('GP Routine', '2026-09-10 14:00:00'),
            slot('Nurse', '2026-09-10 14:15:00'),
            { diaryEntryType: { value: 'break' }, appointmentType: { name: 'GP Routine' } },
          ],
        },
      ],
    },
  ]);
  const t = core.tallyFromOverview(raw, { date: '2026-09-10', now: NOW, skipPastFree: false });
  check(t.byType['GP Routine'].booked === 2, 'two GP Routine bookings');
  check(t.byType['GP Routine'].free === 1, 'one GP Routine free slot');
  check(t.byType.Nurse.booked === 0 && t.byType.Nurse.free === 1, 'nurse free slot only');
  check(!t.byType['GP Routine'] || t.byType['GP Routine'].free === 1, 'breaks are not counted as slots');
}

console.log('\n--- cancelled appointments excluded ---');
{
  const raw = overview([
    {
      name: 'Dr A',
      schedule: [
        {
          summary: { status: { isCancelled: false } },
          entries: [
            appt('GP Routine', { status: 'cancelled' }),
            appt('GP Routine', { appointmentStatus: { isCancelled: true } }),
            appt('GP Routine'),
          ],
        },
      ],
    },
  ]);
  const t = core.tallyFromOverview(raw, { skipPastFree: false });
  check(t.byType['GP Routine'].booked === 1, 'cancelled bookings are not counted');
}

console.log('\n--- remaining-today free slots (Slots rule) ---');
{
  const raw = overview([
    {
      name: 'Dr A',
      schedule: [
        {
          summary: { status: { isCancelled: false } },
          entries: [
            slot('GP Routine', '2026-09-10 09:00:00'),
            slot('GP Routine', '2026-09-10 14:00:00'),
            appt('GP Routine', { start: '2026-09-10 09:30:00' }),
          ],
        },
      ],
    },
  ]);
  const today = core.tallyFromOverview(raw, { date: '2026-09-10', now: NOW });
  check(today.skipPastFree === true, 'today defaults to skip past free slots');
  check(today.byType['GP Routine'].free === 1, 'morning free slot is skipped after noon');
  check(today.byType['GP Routine'].booked === 1, 'past booked appointment still counts');

  const otherDay = core.tallyFromOverview(raw, { date: '2026-09-11', now: NOW });
  check(otherDay.skipPastFree === false, 'a future date does not skip past times');
  check(otherDay.byType['GP Routine'].free === 2, 'both free slots count on another day');

  const forced = core.tallyFromOverview(raw, { date: '2026-09-10', now: NOW, skipPastFree: false });
  check(forced.byType['GP Routine'].free === 2, 'skipPastFree false keeps morning slots');
}

console.log('\n--- cancelled session / unavailability skipped ---');
{
  const raw = overview([
    {
      name: 'Dr A',
      schedule: [
        {
          scheduleType: 'unavailability-period',
          summary: { status: { isCancelled: false } },
          entries: [slot('GP Routine', '2026-09-10 14:00:00')],
        },
        {
          scheduleType: 'diary',
          summary: { status: { isCancelled: true } },
          entries: [appt('GP Routine'), slot('GP Routine', '2026-09-10 14:00:00')],
        },
        {
          scheduleType: 'diary',
          summary: { status: { isCancelled: false } },
          entries: [slot('Phone', '2026-09-10 14:00:00')],
        },
      ],
    },
  ]);
  const t = core.tallyFromOverview(raw, { skipPastFree: false });
  check(!t.byType['GP Routine'], 'cancelled session and unavailability contribute nothing');
  check(t.byType.Phone.free === 1, 'live diary still counts');
}

console.log('\n--- unassigned diaries ---');
{
  const raw = overview(
    [],
    [
      {
        scheduleType: 'diary',
        summary: { status: { isCancelled: false } },
        entries: [slot('Duty', '2026-09-10 14:00:00'), appt('Duty')],
      },
    ]
  );
  const t = core.tallyFromOverview(raw, { skipPastFree: false });
  check(t.byType.Duty.booked === 1 && t.byType.Duty.free === 1, 'unassigned diaries are on the book');
  check(t.staff.indexOf('Unassigned') !== -1, 'Unassigned appears in staff list');
}

console.log('\n--- staffNames filter ---');
{
  const raw = overview([
    {
      name: 'Dr A',
      schedule: [
        {
          summary: { status: { isCancelled: false } },
          entries: [appt('GP Routine'), slot('GP Routine', '2026-09-10 14:00:00')],
        },
      ],
    },
    {
      name: 'Nurse B',
      schedule: [
        {
          summary: { status: { isCancelled: false } },
          entries: [appt('Nurse'), slot('Nurse', '2026-09-10 14:00:00')],
        },
      ],
    },
  ]);
  const t = core.tallyFromOverview(raw, { skipPastFree: false, staffNames: ['dr a'] });
  check(t.byType['GP Routine'].booked === 1, 'matching clinician is counted');
  check(!t.byType.Nurse, 'other clinician is excluded');
}

console.log('\n--- type toggles (slots.hiddenTypes shape) ---');
{
  const byType = {
    'GP Routine': { booked: 10, free: 2 },
    Nurse: { booked: 4, free: 1 },
    Phone: { booked: 3, free: 0 },
  };
  const vis = core.applyHidden(byType, ['Phone', 'Nurse']);
  check(vis.totals.booked === 10 && vis.totals.free === 2, 'hidden types drop out of the total');
  check(vis.all === 12, 'all = booked + free of visible types');
  check(vis.excluded.Phone.booked === 3, 'excluded map keeps the hidden type');
  check(!vis.byType.Nurse, 'Nurse is not in the visible map');
  const noneHidden = core.applyHidden(byType, []);
  check(noneHidden.totals.booked === 17 && noneHidden.totals.free === 3, 'empty hiddenTypes includes every type');
  check(core.buttonLabel(vis.totals) === '10 booked · 2 free', 'button label is booked · free');
}

console.log('\n--- type sort ---');
{
  const entries = core.sortedTypeEntries({
    Alpha: { booked: 1, free: 0 },
    Zulu: { booked: 5, free: 5 },
    Mid: { booked: 1, free: 0 },
  });
  check(entries[0][0] === 'Zulu', 'highest volume first');
  check(entries[1][0] === 'Alpha' && entries[2][0] === 'Mid', 'ties break alphabetically');
}

console.log('\n--- unknown type name ---');
{
  const raw = overview([
    {
      name: 'Dr A',
      schedule: [
        {
          summary: { status: { isCancelled: false } },
          entries: [{ diaryEntryType: { value: 'slot' }, startDateTime: '2026-09-10 14:00:00' }],
        },
      ],
    },
  ]);
  const t = core.tallyFromOverview(raw, { skipPastFree: false });
  check(t.byType.Unknown.free === 1, 'missing appointmentType becomes Unknown');
}

console.log('\n--- source lock: injected widget ---');
{
  const js = fs.readFileSync(path.join(__dirname, 'content-scripts', 'appointment-tally.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'content-scripts', 'appointment-tally.css'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  check(!/method:\s*['"]POST['"]/.test(js), 'tally JS has no POST');
  check(
    !/\.click\(\)|dispatchEvent\(new (?:Mouse|Keyboard|Pointer)Event/.test(js),
    'tally JS does not click Medicus controls'
  );
  check(js.includes('slots.hiddenTypes'), 'tally writes/reads slots.hiddenTypes');
  check(js.includes('embedded-overview'), 'tally uses the Slot Counter overview');
  check(js.includes('AppointmentTallyCore'), 'tally delegates counts to the shared core');
  check(js.includes('parseBookRoute'), 'tally only injects on the appointment-book route');
  check(js.includes('&quot;'), 'esc() quotes attributes');
  check(/replace\(\/"\/g,\s*'&quot;'\)/.test(js), 'esc() replaces double quotes');
  check(/#ms-apt-tally/.test(css) && /#1e3a5f/.test(css), 'CSS uses the organise-canvas navy');
  check(/prefers-reduced-motion/.test(css), 'CSS respects prefers-reduced-motion');
  check(manifest.includes('shared/appointment-tally-core.js'), 'core is in the manifest');
  check(manifest.includes('content-scripts/appointment-tally.js'), 'widget JS is in the manifest');
  check(manifest.includes('content-scripts/appointment-tally.css'), 'widget CSS is in the manifest');
  const coreIdx = manifest.indexOf('shared/appointment-tally-core.js');
  const widgetIdx = manifest.indexOf('content-scripts/appointment-tally.js');
  const organiseIdx = manifest.indexOf('shared/appointment-organise-core.js');
  check(organiseIdx !== -1 && organiseIdx < widgetIdx, 'organise core loads before the tally widget (parseBookRoute)');
  check(coreIdx !== -1 && coreIdx < widgetIdx, 'tally core loads before the tally widget');

  const slotsSrc = fs.readFileSync(path.join(__dirname, 'side-panel', 'modules', 'slots', 'slots.js'), 'utf8');
  check(slotsSrc.includes('bookedByType'), 'Slots tab also counts taken/booked');
  check(slotsSrc.includes('unassignedDiaries'), 'Slots tab includes unassigned diaries');
  check(slotsSrc.includes('slots-taken-line'), 'Slots hero renders a taken line');
  check(
    slotsSrc.includes("!stored['slots.hiddenTypes']"),
    'Slots init does not let stale uiState clobber slots.hiddenTypes'
  );
  check(slotsSrc.includes('isCancelled'), 'Slots aggregate skips cancelled sessions like the tally');
  check(js.includes('_inFlightKey'), 'tally load is keyed so a late fetch cannot paint the previous date');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
