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
  const row = {
    diaryEntryType: { value: 'appointment' },
    appointmentType: { name: type },
    displayStatus: { value: extra.status || 'booked' },
    appointmentStatus: extra.appointmentStatus || { isCancelled: false },
    startDateTime: extra.start || '2026-09-10 09:00:00',
  };
  if (extra.patient) row.patient = extra.patient;
  if (extra.patientId) {
    row.patient = { id: extra.patientId, name: extra.name || 'Anon' };
  }
  return row;
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

console.log('\n--- booked patient extraction ---');
{
  const raw = overview([
    {
      name: 'Dr A',
      schedule: [
        {
          summary: { status: { isCancelled: false } },
          entries: [
            appt('GP Routine', { patientId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'One' }),
            appt('Phone', { patientId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'One' }),
            appt('Nurse', { patientId: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Two' }),
            appt('GP Routine', { status: 'cancelled', patientId: 'cccccccc-0000-0000-0000-000000000003' }),
            appt('Duty', { name: 'No id' }),
          ],
        },
      ],
    },
  ]);
  const t = core.tallyFromOverview(raw, { skipPastFree: false });
  check(t.patients.appointmentCount === 4, 'cancelled booking is not a collected patient appointment');
  check(t.patients.missing === 1, 'booking without a patient id is counted as missing');
  check(!!t.patients.byUuid['aaaaaaaa-0000-0000-0000-000000000001'], 'first patient is collected once');
  check(
    t.patients.byUuid['aaaaaaaa-0000-0000-0000-000000000001'].types['GP Routine'] &&
      t.patients.byUuid['aaaaaaaa-0000-0000-0000-000000000001'].types.Phone,
    'same patient booked twice keeps both types'
  );
  check(!!t.patients.byUuid['bbbbbbbb-0000-0000-0000-000000000002'], 'second patient is collected');
  check(!t.patients.byUuid['cccccccc-0000-0000-0000-000000000003'], 'cancelled patient is not collected');
  const vis = core.visiblePatientUuids(t.patients, ['Phone', 'Duty']);
  check(vis.length === 2, 'visible uuids include anyone with a still-ticked type');
  const nurseOnly = core.visiblePatientUuids(t.patients, ['GP Routine', 'Phone', 'Duty']);
  check(nurseOnly.length === 1 && nurseOnly[0] === 'bbbbbbbb-0000-0000-0000-000000000002', 'hiding GP+Phone leaves the nurse patient');
}

console.log('\n--- unassigned diary patients ---');
{
  const raw = overview(
    [],
    [
      {
        scheduleType: 'diary',
        summary: { status: { isCancelled: false } },
        entries: [appt('Duty', { patientId: 'dddddddd-0000-0000-0000-000000000004' })],
      },
    ]
  );
  const t = core.tallyFromOverview(raw, { skipPastFree: false });
  check(!!t.patients.byUuid['dddddddd-0000-0000-0000-000000000004'], 'unassigned diary bookings are eligible for the vax count');
}

console.log('\n--- uuid extract prefers patient.id ---');
{
  const uuid = core.extractPatientUuid({
    patient: { id: 'eeeeeeee-0000-0000-0000-000000000005', href: '/x/ffffffff-0000-0000-0000-000000000006' },
    appointmentId: '99999999-0000-0000-0000-000000000099',
  });
  check(uuid === 'eeeeeeee-0000-0000-0000-000000000005', 'patient.id wins over other UUIDs on the entry');
  check(core.extractPatientUuid({ patient: { name: 'None' } }) === null, 'no uuid returns null');
}

console.log('\n--- vaccine toggle + chip summary ---');
{
  check(core.anyVaxOn({}) === false, 'empty toggles are off');
  check(core.anyVaxOn({ flu: true }) === true, 'flu on is any-on');
  check(core.parseVaxToggles({ flu: 1, extra: true }).flu === true, 'truthy flu is kept');
  check(core.parseVaxToggles({ flu: 1, extra: true }).covid === false, 'unknown keys are dropped');
  const flags = core.vaxFlagsFromChips([
    { type: 'vaccine', vaccine: 'flu', status: 'vax_due' },
    { type: 'vaccine', ruleId: 'vax-covid', status: 'vax_given' },
    { type: 'vaccine', vaccine: 'rsv', status: 'vax_declined' },
    { type: 'qof-indicator', vaccine: 'flu', status: 'vax_due' },
  ]);
  check(flags.flu === 'vax_due' && flags.covid === 'vax_given' && flags.rsv === 'vax_declined', 'only vaccine chips count');
  const byUuid = {
    a: { flu: 'vax_due', covid: null, rsv: 'vax_given' },
    b: { flu: 'vax_given', covid: 'vax_due', rsv: null },
    c: { error: 'unread' },
  };
  const sum = core.summariseVax(byUuid, ['a', 'b', 'c', 'd']);
  check(sum.total === 4 && sum.checked === 3 && sum.pending === 1 && sum.errors === 1, 'pending / error / checked split');
  check(sum.flu.eligible === 2 && sum.flu.due === 1 && sum.flu.given === 1, 'flu eligible includes due and given');
  check(sum.covid.eligible === 1 && sum.covid.due === 1, 'covid due only');
  check(sum.rsv.eligible === 1 && sum.rsv.given === 1, 'rsv given is still eligible');
  const parts = core.vaxButtonParts(sum, { flu: true, covid: false, rsv: true }, true);
  check(parts[0] === 'Flu 2…' && parts[1] === 'RSV 1…', 'button parts follow the toggles and show a scan ellipsis');
  check(
    core.buttonLabel({ booked: 10, free: 2 }, ['Flu 2']) === '10 booked · 2 free · Flu 2',
    'button label appends vaccine parts'
  );
}

console.log('\n--- source lock: injected widget ---');
{
  const js = fs.readFileSync(path.join(__dirname, 'content-scripts', 'appointment-tally.js'), 'utf8');
  const coreSrc = fs.readFileSync(path.join(__dirname, 'shared', 'appointment-tally-core.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, 'content-scripts', 'appointment-tally.css'), 'utf8');
  const manifest = fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8');
  check(!/method:\s*['"]POST['"]/.test(js), 'tally JS has no POST');
  check(
    !/\.click\(\)|dispatchEvent\(new (?:Mouse|Keyboard|Pointer)Event/.test(js),
    'tally JS does not click Medicus controls'
  );
  check(js.includes('slots.hiddenTypes'), 'tally writes/reads slots.hiddenTypes');
  check(js.includes('slots.vaxTally'), 'tally writes/reads slots.vaxTally');
  const ioSrc = fs.readFileSync(path.join(__dirname, 'shared', 'io', 'slot-counter-io.js'), 'utf8');
  check(ioSrc.includes('slots.vaxTally'), 'slot-counter-io backs up the vaccine tally toggles');
  check(
    coreSrc.includes("flu: 'vax-flu'") && coreSrc.includes("covid: 'vax-covid'") && coreSrc.includes("rsv: 'vax-rsv'"),
    'core maps flu/COVID/RSV to the Sentinel vaccine rule ids'
  );
  check(/double-check before offering a vaccine/i.test(js), 'tally vaccine copy tells the user to double-check');
  check(js.includes('SentinelRules'), 'tally reuses the live vaccine engine');
  check(js.includes('qof-register'), 'tally loads QOF register rules so flu clinical-risk clauses can fire');
  check(!/patient\?\.name|patient\.name|displayName/.test(js), 'tally vaccine UI never paints a patient name');
  check(js.includes('embedded-overview'), 'tally uses the Slot Counter overview');
  check(js.includes('AppointmentTallyCore'), 'tally delegates counts to the shared core');
  check(js.includes('parseBookRoute'), 'tally only injects on the appointment-book route');
  check(js.includes('&quot;'), 'esc() quotes attributes');
  check(/replace\(\/"\/g,\s*'&quot;'\)/.test(js), 'esc() replaces double quotes');
  check(/#ms-apt-tally/.test(css) && /#1e3a5f/.test(css), 'CSS uses the organise-canvas navy');
  check(/ms-apt-tally-vax/.test(css), 'CSS styles the vaccine eligibility toggles');
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
  check(js.includes('shouldReuseInFlight'), 'tally load uses shouldReuseInFlight so a matching in-flight is reused');
  check(js.includes('beginInFlight'), 'tally load records the in-flight key via beginInFlight');
  check(js.includes('finishInFlight'), 'tally load clears only its own in-flight via finishInFlight');
  check(js.includes('shouldApplyFetch'), 'tally load uses shouldApplyFetch so a stale in-flight date is discarded');
  check(core.shouldApplyFetch('a|2026-09-10', 'a|2026-09-10') === true, 'matching in-flight key applies');
  check(core.shouldApplyFetch('a|2026-09-10', 'a|2026-09-11') === false, 'date B in flight does not apply date A');
  check(core.shouldApplyFetch('', 'a|2026-09-10') === false, 'empty in-flight key does not apply');
  check(
    core.shouldReuseInFlight(Promise.resolve(), 'a|2026-09-10', 'a|2026-09-10', false) === true,
    'same-key in-flight is reused when not bypassing cache'
  );
  check(
    core.shouldReuseInFlight(Promise.resolve(), 'a|2026-09-10', 'a|2026-09-11', false) === false,
    'different-key in-flight is not reused'
  );
  check(
    core.shouldReuseInFlight(Promise.resolve(), 'a|2026-09-10', 'a|2026-09-10', true) === false,
    'bypassCache does not reuse the in-flight'
  );
  check(core.shouldReuseInFlight(null, 'a|2026-09-10', 'a|2026-09-10', false) === false, 'no in-flight is not reused');
  {
    const pOld = Promise.resolve('old');
    const pNew = Promise.resolve('new');
    const started = core.beginInFlight('a|2026-09-11', pNew);
    check(started.inFlight === pNew && started.inFlightKey === 'a|2026-09-11', 'beginInFlight records the new key');
    const staleFinish = core.finishInFlight(started, pOld);
    check(
      staleFinish.inFlight === pNew && staleFinish.inFlightKey === 'a|2026-09-11',
      'a late finish for the previous date does not clear the newer in-flight'
    );
    const ownFinish = core.finishInFlight(started, pNew);
    check(ownFinish.inFlight === null && ownFinish.inFlightKey === '', 'the owning fetch clears its own in-flight');
  }
  check(manifest.includes('shared/injector-runtime.js'), 'injector runtime is in the manifest');
  check(
    manifest.indexOf('shared/injector-runtime.js') < widgetIdx,
    'injector runtime loads before the tally widget'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
