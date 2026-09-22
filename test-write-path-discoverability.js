// Medicus Suite — entry-copy guards for companion / signing / reception writes.
// Run with: node test-write-path-discoverability.js
//
// These surfaces already write (or, for Signing, deliberately do not). The
// copy must say where to compose and what is still left to do in Medicus,
// and must not claim the Medicus step is finished.

'use strict';

const fs = require('fs');
const path = require('path');

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

function read(rel) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

const BANNED = /\b(Done|Sent|Booked|Submitted)\b/;

console.log('1. Companion book / create-task entry copy');
const tap = read('content-scripts/task-actions-panel.js');
const bookHint = 'Compose the booking here. Nothing is written until you press Confirm booking.';
const taskHint = 'Compose the task here. Nothing is created until you press Create task.';
check(tap.includes(bookHint), 'booking section says where to compose and that confirm is the write');
check(tap.includes(taskHint), 'create-task section says where to compose and that Create task is the write');
check(/bk\.step === 'booked'/.test(tap), 'booking hint is withheld once the panel has recorded a booking');
check(/tk\.step === 'created'/.test(tap), 'task hint is withheld once the panel has recorded a created task');
check(!BANNED.test(bookHint) && !BANNED.test(taskHint), 'new companion hints do not claim completion');

console.log('\n2. Signing Queue points at Medicus for the authorise step');
const signing = read('side-panel/modules/signing/signing.js');
check(signing.includes('This panel never writes to Medicus.'), 'honest line still says the panel never writes');
check(signing.includes('No flag'), 'honest line still negates a safe-to-sign reading');
check(
  signing.includes('this list does not sign or submit it.'),
  'honest line says authorising happens on the request in Medicus'
);
const honest = signing.match(/function honestStateHtml\(\) \{[\s\S]*?\n\}/);
check(!!honest && !BANNED.test(honest[0]), 'honest-state copy does not claim completion');

console.log('\n3. Reception capture handoff');
const reception = read('side-panel/modules/reception/reception.js');
check(reception.includes('The summary is composed in Guided capture.'), 'tab says where the summary is composed');
check(
  reception.includes('until you do, the clinician sees nothing.'),
  'tab states the consequence of not pasting and submitting'
);
check(reception.includes('1. Copy the summary.'), 'summary screen numbers the copy step');
check(
  reception.includes('2. Paste it into the Medicus task for this patient, then submit there.'),
  'summary screen numbers the Medicus paste-and-submit step'
);
check(
  reception.includes('Check you are on the right patient before pasting.'),
  'summary screen still requires a patient check before paste'
);
check(reception.includes('1. Copy summary'), 'the copy control is labelled as step 1');

console.log('\n4. Reception booking card');
const booking = read('side-panel/modules/shared/booking-panel.js');
check(
  booking.includes('1. Choose a type and find a slot. 2. Press Confirm booking on the next step.'),
  'browse step says where the booking is composed'
);
check(booking.includes('Nothing is written until then.'), 'browse step says confirm is still ahead');
check(booking.includes('Pressing Confirm booking is the write.'), 'confirm step names the write');
check(booking.includes('nothing is booked.'), 'a changed patient still blocks the write');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
