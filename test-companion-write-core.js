// Medicus Suite — Companion write-core (W2 / W5) executable tests
// Run with: node test-companion-write-core.js
'use strict';

const C = require('./shared/companion-write-core.js');
const WriteCore = require('./shared/write-core.js');

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

const PATIENT = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER = 'bbbbbbbb-1111-2222-3333-444444444444';

console.log('--- W2 bookingReady ---');
check(
  C.bookingReady({
    confirming: false,
    reservationId: 'res-1',
    patientId: PATIENT,
    selectedSlot: { diaryId: 'd' },
  }) === true,
  'ready when reservation, patient and slot are present'
);
check(
  C.bookingReady({ confirming: true, reservationId: 'res-1', patientId: PATIENT, selectedSlot: {} }) === false,
  'in-flight confirm is not ready'
);
check(
  C.bookingReady({ confirming: false, reservationId: null, patientId: PATIENT, selectedSlot: {} }) === false,
  'no reservation is not ready'
);
check(
  C.bookingReady({ confirming: false, reservationId: 'res-1', patientId: null, selectedSlot: {} }) === false,
  'no patient is not ready'
);
check(
  C.bookingReady({ confirming: false, reservationId: 'res-1', patientId: PATIENT, selectedSlot: null }) === false,
  'no slot is not ready'
);

console.log('--- W5 taskReady ---');
check(
  C.taskReady({ creating: false, patientId: PATIENT, assignee: 'staff|s1', description: 'Follow up' }) === true,
  'ready when patient, assignee and description are present'
);
check(
  C.taskReady({ creating: true, patientId: PATIENT, assignee: 'staff|s1', description: 'Follow up' }) === false,
  'in-flight create is not ready'
);
check(
  C.taskReady({ creating: false, patientId: PATIENT, assignee: 'staff|s1', description: '   ' }) === false,
  'blank description is not ready'
);
check(
  C.taskReady({ creating: false, patientId: PATIENT, assignee: '', description: 'Follow up' }) === false,
  'no assignee is not ready'
);

console.log('--- identity recheck ---');
check(C.identitiesMatch(PATIENT, PATIENT) === true, 'same patient matches');
check(C.identitiesMatch(PATIENT, OTHER) === false, 'other patient does not match');
check(C.identitiesMatch(PATIENT, null) === false, 'null live fails closed');
check(C.identitiesMatch(null, PATIENT) === false, 'null pin fails closed');
check(C.refuseIfIdentityMoved(PATIENT, PATIENT).ok === true, 'unmoved gate ok');
check(C.refuseIfIdentityMoved(PATIENT, OTHER).ok === false, 'moved gate refuses');
check(/re-verified/.test(C.refuseIfIdentityMoved(PATIENT, OTHER).reason), 'moved reason tells the clinician to reopen');

console.log('--- write gates ---');
{
  const bk = { confirming: false, reservationId: 'res-1', patientId: PATIENT, selectedSlot: { diaryId: 'd' } };
  check(C.bookingWriteGate(bk, PATIENT).ok === true, 'W2 gate passes when identity holds');
  check(C.bookingWriteGate(bk, OTHER).ok === false, 'W2 gate refuses a moved patient');
  check(
    C.bookingWriteGate({ confirming: false, reservationId: null, patientId: PATIENT, selectedSlot: {} }, PATIENT).ok ===
      false,
    'W2 gate refuses an unready booking'
  );
  const tk = { creating: false, patientId: PATIENT, assignee: 'staff|s1', description: 'Review' };
  check(C.taskWriteGate(tk, PATIENT).ok === true, 'W5 gate passes when identity holds');
  check(C.taskWriteGate(tk, OTHER).ok === false, 'W5 gate refuses a moved patient');
}

console.log('--- landed-id confirmation ---');
{
  const landed = C.confirmBookingLanded({ appointmentId: 'appt-9' });
  const outcome = WriteCore.confirmLanded(['appt-9'], landed);
  check(outcome.allWritten === true && outcome.written === 1, 'W2 success is the confirmed appointment id');
  const missed = WriteCore.confirmLanded(['appt-9'], C.confirmBookingLanded({}));
  check(missed.allWritten === false && missed.written === 0, 'W2 without appointmentId is not success');
  const taskOk = WriteCore.confirmLanded(['t1'], C.confirmTaskLanded({ taskId: 't1' }));
  check(taskOk.allWritten === true, 'W5 success is the confirmed task id');
  const taskMiss = WriteCore.confirmLanded(['t1'], C.confirmTaskLanded({}));
  check(taskMiss.allWritten === false, 'W5 without taskId is not success');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
