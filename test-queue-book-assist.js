// Queue Book assist — C4 next-green-day snippet (prepare-only).
// Run with: node test-queue-book-assist.js
'use strict';

const B = require('./content-scripts/triage-lens/queue-book-assist.js');

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

const preset = {
  name: 'Routine GP f2f',
  slotTypes: ['GP Routine', 'GP Morning'],
  minimumByDay: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
};

console.log('Layer 1: isGreenDay / pickNextGreenDay');
{
  check(B.isGreenDay({ iso: '2026-08-25', free: 8 }, preset) === true, 'free == minimum is green');
  check(B.isGreenDay({ iso: '2026-08-25', free: 7 }, preset) === false, 'free below minimum is not green');
  check(B.isGreenDay({ iso: '2026-08-22', free: 20 }, preset) === false, 'Saturday minimum 0 is not offered');
  const picked = B.pickNextGreenDay(
    [
      { iso: '2026-08-25', free: 3 },
      { iso: '2026-08-26', free: 12 },
      { iso: '2026-08-27', free: 20 },
    ],
    preset
  );
  check(picked && picked.iso === '2026-08-26', 'picks the first green day, not a later greener one');
  check(B.pickNextGreenDay([{ iso: '2026-08-25', free: 1 }], preset) === null, 'no green day → null (never invents)');
}

console.log('\nLayer 2: countFreeSlots');
{
  const raw = {
    staffSchedules: [
      {
        name: 'Dr A',
        schedule: [
          {
            summary: { status: { isCancelled: false } },
            entries: [
              {
                diaryEntryType: { value: 'slot' },
                appointmentType: { name: 'GP Routine' },
                startDateTime: '2026-08-25T09:00:00',
              },
              {
                diaryEntryType: { value: 'slot' },
                appointmentType: { name: 'Nurse' },
                startDateTime: '2026-08-25T09:10:00',
              },
              { diaryEntryType: { value: 'break' }, appointmentType: { name: 'GP Routine' } },
            ],
          },
        ],
      },
    ],
  };
  check(B.countFreeSlots(raw, { allowedTypes: ['GP Routine'] }).free === 1, 'counts matching slot types only');
  check(B.countFreeSlots(raw, {}).free === 2, 'no whitelist counts every slot');
  check(B.countFreeSlots(null).free === 0, 'null payload → 0 (fail closed)');
}

console.log('\nLayer 3: composeBookSnippet — prepare-only copy');
{
  const now = new Date(2026, 7, 24, 10, 42, 0);
  const s = B.composeBookSnippet({
    patientName: 'ADEYEMI, Chioma',
    presetName: 'Routine GP f2f',
    day: { iso: '2026-08-25', free: 3 },
    now: now,
  });
  check(/book ADEYEMI, Chioma/.test(s), 'names the patient');
  check(/Routine GP f2f/.test(s), 'names the preset');
  check(/Tue 25 Aug/.test(s), 'names the day');
  check(/3 free as of 10:42/.test(s), 'names free count + timestamp');
  check(/or nearest equivalent/.test(s), 'always includes or nearest equivalent');
  check(/Does not hold a slot/.test(s), 'states it does not hold a slot');
  check(!/\bBooked\b/.test(s), 'never claims Booked');
  check(!/slot id|slotId|reservation/i.test(s), 'never a slot id');
}

{
  const s = B.composeBookSnippet({
    patientName: 'PATEL, Raj',
    presetName: 'Routine GP f2f',
    day: null,
    now: new Date(2026, 7, 24, 10, 42, 0),
  });
  check(/confirm on the Capacity tab/.test(s), 'empty day points at the Capacity tab');
  check(/or nearest equivalent/.test(s), 'empty day still has or nearest equivalent');
}

console.log('\nLayer 4: workingDatesFrom skips today + weekend');
{
  const mon = new Date(2026, 7, 24, 10, 0, 0);
  const dates = B.workingDatesFrom(mon, 5);
  check(dates[0] === '2026-08-25', 'first date is tomorrow (not today)');
  check(dates.indexOf('2026-08-29') === -1 && dates.indexOf('2026-08-30') === -1, 'skips Sat/Sun');
  check(dates.length === 5, 'returns the requested count');
}

console.log('\nLayer 5: C4 v2 create-task identity + payload');
{
  const form = {
    assigneeOptions: {
      teams: [
        { value: 't1', label: 'Reception' },
        { value: 't2', label: 'GPs' },
      ],
      staff: [{ value: 's1', label: 'Dr Chen' }],
    },
  };
  const assignees = B.normaliseAssignees(form);
  check(assignees.length === 3, 'normalise teams + staff');
  check(B.pickDefaultAssignee(assignees) === 'team|t1', 'defaults to Reception when present');
  check(B.normaliseAssignees(null).length === 0, 'null form → no assignees');

  const pin = { taskUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', patientId: 'pat-1' };
  check(B.assertTaskIdentity(pin, pin).ok === true, 'matching pin/live is ok');
  check(
    B.assertTaskIdentity(pin, { taskUuid: pin.taskUuid, patientId: 'other' }).ok === false,
    'patient mismatch refuses'
  );
  check(
    B.assertTaskIdentity(pin, { taskUuid: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', patientId: 'pat-1' }).ok === false,
    'task mismatch refuses'
  );
  check(B.assertTaskIdentity(null, pin).ok === false, 'missing pin refuses');

  const payload = B.buildCreatePayload({
    patientId: 'pat-1',
    assignee: 'team|t1',
    description: 'book Patel — GP 15 — Mon 25 Aug. Does not hold a slot.',
  });
  check(!!payload && payload.assigneeType === 'team' && payload.assigneeId === 't1', 'payload splits assignee');
  check(payload.contextId === null && payload.snoozeUntil === null, 'no invented context / snooze');
  check(
    B.buildCreatePayload({ patientId: 'pat-1', assignee: 't1', description: 'x' }) === null,
    'bad assignee refuses'
  );
  check(
    B.buildCreatePayload({ patientId: 'pat-1', assignee: 'team|t1', description: '  ' }) === null,
    'blank description refuses'
  );
}

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---\n');
if (failed > 0) process.exit(1);
