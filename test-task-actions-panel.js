// Medicus Suite — task-actions floating panel (W2 / W5 / triage patient-record)
// Run with: node test-task-actions-panel.js
//
// The panel lives inside a content-script IIFE, so — as with
// test-result-inspect-recent.js — pure helpers are extracted by regex and
// evaluated in an isolated VM. H-043 write-path controls are locked by
// source-level greps of the same shape as test-booking-core.js's slots.js
// commit-time re-verify block.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const src = fs.readFileSync(path.join(__dirname, 'content-scripts', 'task-actions-panel.js'), 'utf8');

console.log('Layer 1: extractable helpers');
const slugFn = src.match(/function isCommunicationThreadSlug\(slug\) \{[\s\S]*?\n  \}/);
const classifyFn = src.match(/function classifyPatientRequest\(overview\) \{[\s\S]*?\n  \}/);
const infoFn = src.match(/function getTaskInfo\(\) \{[\s\S]*?\n  \}/);
check(!!slugFn, 'isCommunicationThreadSlug found');
check(!!classifyFn, 'classifyPatientRequest found');
check(!!infoFn, 'getTaskInfo found');

const box = {};
if (slugFn && classifyFn) {
  vm.runInNewContext(
    slugFn[0] +
      '\n' +
      classifyFn[0] +
      '\nthis.isCommunicationThreadSlug = isCommunicationThreadSlug;' +
      '\nthis.classifyPatientRequest = classifyPatientRequest;',
    box
  );
}
const { isCommunicationThreadSlug, classifyPatientRequest } = box;
check(typeof isCommunicationThreadSlug === 'function', 'isCommunicationThreadSlug callable');
check(typeof classifyPatientRequest === 'function', 'classifyPatientRequest callable');

const locBox = { location: { pathname: '' } };
if (infoFn) {
  vm.runInNewContext(infoFn[0] + '\nthis.getTaskInfo = getTaskInfo;', locBox);
}
check(typeof locBox.getTaskInfo === 'function', 'getTaskInfo callable');

console.log('\nLayer 2: URL / slug pre-filter');
check(isCommunicationThreadSlug('communication-thread') === true, 'communication-thread slug is the overview slug');
check(isCommunicationThreadSlug('COMMUNICATION-THREAD') === true, 'slug match is case-insensitive');
check(
  isCommunicationThreadSlug('medical_patient_request_task') === false,
  'queue-list medical slug is NOT the overview slug'
);
check(
  isCommunicationThreadSlug('admin_patient_request_task') === false,
  'queue-list admin slug is NOT the overview slug'
);
check(isCommunicationThreadSlug('document') === false, 'document slug is not a thread');
check(
  isCommunicationThreadSlug('') === false && isCommunicationThreadSlug(null) === false,
  'empty/null slug fails closed'
);

{
  locBox.location.pathname = '/e38a9f/tasks/data/communication-thread/overview/550e8400-e29b-41d4-a716-446655440000';
  const info = locBox.getTaskInfo();
  check(!!info && info.siteId === 'e38a9f', 'overview URL yields siteId');
  check(info && info.typeSlug === 'communication-thread', 'overview URL yields communication-thread slug');
  check(info && info.taskUuid === '550e8400-e29b-41d4-a716-446655440000', 'overview URL yields task UUID');
}
{
  locBox.location.pathname = '/e38a9f/tasks/data/medical_patient_request_task/task-list';
  check(locBox.getTaskInfo() === null, 'queue-list URL is not a task overview');
}
{
  locBox.location.pathname = '/e38a9f/care-record/abc';
  check(locBox.getTaskInfo() === null, 'non-task URL is not a task overview');
}

function overview(opts) {
  opts = opts || {};
  const comms = Array.isArray(opts.comms)
    ? opts.comms
    : opts.reqType
      ? [{ patientRequest: { patientRequestType: opts.reqType } }]
      : [];
  return {
    data: {
      patientId: opts.patientId === undefined ? 'pat-1' : opts.patientId,
      communicationThreadTaskType:
        opts.threadType === undefined ? { isPatientRequestTask: !!opts.isPatientRequestTask } : opts.threadType,
      communicationThread: { communications: comms },
    },
  };
}

console.log('\nLayer 3: classifyPatientRequest — fail-closed triage gate');
{
  const r = classifyPatientRequest(
    overview({ isPatientRequestTask: true, reqType: { isMedical: true, isAdmin: false }, patientId: 'p-med' })
  );
  check(r.isTriage === true && r.patientId === 'p-med', 'medical patient-request is triage');
}
{
  const r = classifyPatientRequest(
    overview({ isPatientRequestTask: true, reqType: { isMedical: false, isAdmin: true }, patientId: 'p-adm' })
  );
  check(r.isTriage === true && r.patientId === 'p-adm', 'admin patient-request is triage');
}
{
  const r = classifyPatientRequest(
    overview({
      isPatientRequestTask: true,
      reqType: { isMedical: false, isAdmin: false, isRepeatPrescription: true },
    })
  );
  check(r.isTriage === false, 'repeat-prescription request is NOT triage');
}
{
  const r = classifyPatientRequest(overview({ isPatientRequestTask: false, reqType: { isMedical: true } }));
  check(
    r.isTriage === false,
    'isPatientRequestTask=false (questionnaire / conversation) is NOT triage even if a type is present'
  );
}
{
  const r = classifyPatientRequest(overview({ threadType: null, reqType: { isMedical: true } }));
  check(r.isTriage === false, 'missing communicationThreadTaskType fails closed');
}
{
  const r = classifyPatientRequest(null);
  check(r.isTriage === false, 'null overview fails closed');
}
{
  const r = classifyPatientRequest(overview({ isPatientRequestTask: true, comms: [] }));
  check(r.isTriage === false, 'patient-request thread with no typed communication fails closed');
}
{
  const r = classifyPatientRequest(
    overview({
      isPatientRequestTask: true,
      comms: [{ body: 'thanks' }, { patientRequest: { patientRequestType: { isMedical: true, isAdmin: false } } }],
    })
  );
  check(r.isTriage === true, 'reply-only first entry is skipped; original request type is used');
}
{
  const r = classifyPatientRequest({
    data: { patient: { id: 'nested' }, communicationThreadTaskType: { isPatientRequestTask: false } },
  });
  check(r.isTriage === false && r.patientId === 'nested', 'patient.id fallback is returned even when not triage');
}

console.log('\nLayer 4: H-043 write-path greps (W2 / W5)');
function sliceFn(name) {
  const re = new RegExp('async function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}');
  const m = src.match(re);
  return m ? m[0] : '';
}
const confirmBk = sliceFn('doConfirmBooking');
const createTk = sliceFn('doCreateTask');
const selectSlot = sliceFn('doSelectSlot');
const openBk = sliceFn('doOpenBooking');
const openTk = sliceFn('doOpenTask');
check(!!confirmBk, 'doConfirmBooking extracted');
check(!!createTk, 'doCreateTask extracted');

{
  const verifyAt = confirmBk.indexOf('resolvePatientId(');
  const createAt = confirmBk.indexOf('apiCreateAppointment(');
  check(verifyAt !== -1, 'doConfirmBooking re-resolves the patient');
  check(createAt !== -1 && verifyAt < createAt, 'doConfirmBooking re-verifies BEFORE apiCreateAppointment');
  check(/s\.taskUuid !== info\.taskUuid/.test(confirmBk), 'doConfirmBooking aborts if the on-screen task UUID changed');
  check(
    /verifiedPatientId !== st\.patientId/.test(confirmBk),
    'doConfirmBooking aborts if the re-resolved patient differs'
  );
  check(/const st = s\.bk/.test(confirmBk), 'doConfirmBooking pins s.bk across awaits');
  check(/if \(st !== s\.bk\) return/.test(confirmBk), 'doConfirmBooking discards a mid-verify navigation');
}
{
  const verifyAt = createTk.indexOf('resolvePatientId(');
  const createAt = createTk.indexOf('apiCreateTask(');
  check(verifyAt !== -1, 'doCreateTask re-resolves the patient');
  check(createAt !== -1 && verifyAt < createAt, 'doCreateTask re-verifies BEFORE apiCreateTask');
  check(/s\.taskUuid !== info\.taskUuid/.test(createTk), 'doCreateTask aborts if the on-screen task UUID changed');
  check(/verifiedPatientId !== st\.patientId/.test(createTk), 'doCreateTask aborts if the re-resolved patient differs');
  check(/const st = s\.tk/.test(createTk), 'doCreateTask pins s.tk across awaits');
}
check(
  /const st = s\.bk/.test(openBk) && /if \(st !== s\.bk\) return/.test(openBk),
  'doOpenBooking pins and discards stale open'
);
check(
  /const st = s\.tk/.test(openTk) && /if \(st !== s\.tk\) return/.test(openTk),
  'doOpenTask pins and discards stale open'
);
check(
  /if \(st !== s\.bk\) \{[\s\S]*?apiReleaseReservation\(result\.slotReservationId\)/.test(selectSlot || src),
  'doSelectSlot releases an orphan reservation after navigation'
);
check(
  /if \(currentPath !== _lastPath\) \{[\s\S]*?apiReleaseReservation\(s\.bk\.reservationId\)[\s\S]*?s = blankState\(\)/.test(
    src
  ),
  'SPA path change releases a held reservation then blanks all panel state'
);
check(
  /pagehide/.test(src) && /apiReleaseReservation\(s\.bk\.reservationId\)/.test(src),
  'pagehide releases a held reservation'
);

console.log('\nLayer 5: W2 payload keys + no extra write verbs');
const CREATE_PAYLOAD_KEYS = [
  'context',
  'appointmentTemporalType',
  'appointmentTypeId',
  'patientId',
  'deliveryMode',
  'intendedDuration',
  'diaryId',
  'isHighPriority',
  'isHiddenFromPatientFacingServices',
  'intendedStartDateTime',
  'reasonForAppointment',
  'additionalInformation',
  'embargoOverrideReason',
  'slotReservationId',
  'nhsNationalSlotTypeCategory',
  'allowOverlappingAppointments',
  'gpadReportingExceptionReasons',
  'clinicalCaseId',
  'bookingConfirmationRecipients',
  'rescheduledAppointmentVersionId',
];
CREATE_PAYLOAD_KEYS.forEach((k) => {
  check(confirmBk.includes(k + ':') || confirmBk.includes(k + ' :'), 'W2 payload still has ' + k);
});
check(
  !/method:\s*['"](PUT|PATCH|DELETE)['"]/.test(src),
  'panel has no PUT/PATCH/DELETE — only the inherited W2/W5 POSTs'
);
check(
  /method: 'POST'/.test(src) && (src.match(/method: 'POST'/g) || []).length === 4,
  'exactly four POST sites (reserve, create-appointment, release-reservation, create-task)'
);

console.log('\nLayer 6: XSS + patient-record render gates');
const apptFn = src.match(/function renderApptRow\(a\) \{[\s\S]*?\n  \}/);
const linkFn = src.match(/function renderLinkRow\(l\) \{[\s\S]*?\n  \}/);
check(
  !!apptFn && /esc\(when\)/.test(apptFn[0]) && /esc\(typeName\)/.test(apptFn[0]),
  'appointment rows escape when + type'
);
check(
  !!apptFn && /esc\(a\.assignees\)/.test(apptFn[0]) && /esc\(apptStatusLabel/.test(apptFn[0]),
  'appointment rows escape assignees + status'
);
check(
  !!linkFn && /esc\(l\.created/.test(linkFn[0]) && /esc\(typeName\)/.test(linkFn[0]) && /esc\(reason\)/.test(linkFn[0]),
  'booking-link rows escape date + type + reason'
);
check(
  /const showRecord = s\.rec\.applicable === true/.test(src),
  'Patient record section renders only when applicable === true'
);
check(
  /if \(!classification\.isTriage\) \{[\s\S]*?st\.applicable = false/.test(src),
  'non-triage classification sets applicable=false (hidden, not an error)'
);
check(
  /catch \(_\) \{[\s\S]*?st\.checking = false[\s\S]*?return;/.test(src),
  'stage-1 overview fetch failure returns without setting applicable (fail closed / hidden)'
);
check(
  /Future appointments' \+[\s\S]*?rec\.appointments\.length/.test(src) &&
    /Unused booking links' \+[\s\S]*?rec\.bookingLinks\.length/.test(src),
  'record headings name the appointment / unused-link counts'
);

console.log('\n--- Results: ' + passed + ' passed, ' + failed + ' failed ---\n');
if (failed > 0) process.exit(1);
