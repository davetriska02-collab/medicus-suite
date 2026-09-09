// Medicus Suite — staff-presence ("who is away") wrapper tests
// Run with: node test-staff-presence.js
//
// Pins the shared wrapper that Monitoring (Sentinel) and allocate canvases
// both use. LabAllocateCore.presenceForName stays the only matcher.

'use strict';

const fs = require('fs');
const path = require('path');

const C = require('./shared/lab-allocate-core.js');
const SP = require('./shared/staff-presence.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) {
    console.log(`  OK  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL  ${msg}`);
    failed++;
  }
}

const staff = [{ id: 'staff-azadian', name: 'Dr Natalie Azadian', medicusName: 'AZADIAN N' }];
const leaveAway = [
  {
    staffId: 'staff-azadian',
    status: 'approved',
    type: 'annual',
    startDate: '2026-09-08',
    endDate: '2026-09-12',
  },
];
const leavePending = [
  {
    staffId: 'staff-azadian',
    status: 'requested',
    type: 'annual',
    startDate: '2026-09-08',
    endDate: '2026-09-12',
  },
];

console.log('\n--- presence.enabled gate (same stance as task-presence) ---');
check(SP.isPresenceEnabled({}) === true, 'missing key is ON');
check(SP.isPresenceEnabled({ 'presence.enabled': true }) === true, 'explicit true is ON');
check(SP.isPresenceEnabled({ 'presence.enabled': false }) === false, 'explicit false is opted out');
check(SP.isPresenceEnabled(null) === true, 'null storage fails open to ON');

console.log('\n--- rota sources from storage ---');
const rota = SP.rotaSourcesFromStorage({
  'rota.staff': staff,
  'rota.leave': leaveAway,
});
check(rota.staffList === staff, 'staff list passed through');
check(rota.leaveList === leaveAway, 'leave list passed through');
check(SP.rotaSourcesFromStorage(null).staffList.length === 0, 'null storage → empty staff');
check(SP.rotaSourcesFromStorage({}).leaveList.length === 0, 'empty storage → empty leave');

console.log('\n--- lookup reuses LabAllocateCore.presenceForName ---');
const sources = SP.sourcesFromParts({
  enabled: true,
  staffList: staff,
  leaveList: leaveAway,
  dateISO: '2026-09-09',
});
const away = SP.lookup('Dr Natalie Azadian', sources);
const direct = C.presenceForName({
  name: 'Dr Natalie Azadian',
  dateISO: '2026-09-09',
  staffList: staff,
  leaveList: leaveAway,
});
check(away.state === 'away', 'rota approved leave → away');
check(away.state === direct.state, 'wrapper state matches LabAllocateCore');
check(SP.isAwayState(away.state) === true, 'isAwayState true for away');

const pendingSrc = SP.sourcesFromParts({
  enabled: true,
  staffList: staff,
  leaveList: leavePending,
  dateISO: '2026-09-09',
});
const pending = SP.lookup('Dr Natalie Azadian', pendingSrc);
check(pending.state === 'away-pending', 'requested leave → away-pending');
check(SP.isAwayState(pending.state) === true, 'isAwayState true for away-pending');

const present = SP.lookup(
  'Dr Natalie Azadian',
  SP.sourcesFromParts({ enabled: true, staffList: staff, leaveList: [] })
);
check(present.state !== 'away' && present.state !== 'away-pending', 'no leave → not away');

const optedOut = SP.lookup(
  'Dr Natalie Azadian',
  SP.sourcesFromParts({ enabled: false, staffList: staff, leaveList: leaveAway })
);
check(optedOut.state === 'n/a' && optedOut.reason === 'opted-out', 'presence.enabled false hides away chrome');
check(SP.isAwayState(optedOut.state) === false, 'opted-out is not an away state');

console.log('\n--- assignee label + advisory warning ---');
check(SP.decorateAssigneeLabel('Dr Natalie Azadian', away) === 'Dr Natalie Azadian — Away', 'away suffix');
check(SP.decorateAssigneeLabel('Dr Natalie Azadian', present) === 'Dr Natalie Azadian', 'present keeps the name');
check(SP.decorateAssigneeLabel('  ', away) === '', 'blank label stays blank');
const warn = SP.assigneeWarning(away);
check(/still create the task/i.test(warn), 'away warning does not block create');
check(/will not see this today/i.test(warn), 'away warning states they will not see it today');
const pendingWarn = SP.assigneeWarning(pending);
check(/requested, not yet approved/i.test(pendingWarn), 'pending warning names requested leave');
check(SP.assigneeWarning(present) === '', 'no warning when not away');
check(SP.assigneeWarning(optedOut) === '', 'no warning when opted out');

console.log('\n--- open-task row normaliser ---');
check(SP.pickTaskAssigneeName({ assignedTo: 'Dr Smith' }) === 'Dr Smith', 'string assignedTo');
check(SP.pickTaskAssigneeName({ assignedTo: { name: 'Dr Jones' } }) === 'Dr Jones', 'object assignedTo.name');
check(SP.pickTaskAssigneeName({ assignee: { label: 'Nurse Patel' } }) === 'Nurse Patel', 'assignee.label fallback');
check(SP.pickTaskAssigneeName({}) === '', 'missing assignee is empty');
check(SP.normaliseOpenTask(null) === null, 'null task → null');
const row = SP.normaliseOpenTask({
  taskType: 'Drug monitoring review',
  assignedTo: 'Dr Natalie Azadian',
  dueDate: '-',
  isOverdue: true,
});
check(row && row.taskType === 'Drug monitoring review', 'taskType kept');
check(row && row.assignedTo === 'Dr Natalie Azadian', 'assignedTo kept');
check(row && row.dueDate === '', 'placeholder dueDate "-" dropped');
check(row && row.isOverdue === true, 'isOverdue kept');

console.log('\n--- Monitoring (Sentinel) reuses this module ---');
const sent = fs.readFileSync(path.join(__dirname, 'side-panel/modules/sentinel/sentinel.js'), 'utf8');
check(/staffPresenceApi\(\)/.test(sent), 'Sentinel calls staffPresenceApi()');
check(/StaffPresence/.test(sent), 'Sentinel talks to window.StaffPresence');
check(/decorateAssigneeLabel/.test(sent), 'assignee options use decorateAssigneeLabel');
check(/normaliseOpenTask/.test(sent), 'open-task rows use normaliseOpenTask');
check(/sent-task-away/.test(sent), 'open-task rows paint the Away chip');
check(
  /You can still create the task/.test(SP.assigneeWarning.toString()) || /assigneeWarning/.test(sent),
  'create path keeps the advisory warning helper'
);
check(!/function presenceForName\(/.test(sent), 'Sentinel does not invent a second presenceForName');

const panel = fs.readFileSync(path.join(__dirname, 'side-panel/panel.html'), 'utf8');
const pop = fs.readFileSync(path.join(__dirname, 'pop-out/pop-out.html'), 'utf8');
check(
  /shared\/lab-allocate-core\.js[\s\S]*shared\/staff-presence\.js/.test(panel),
  'panel.html loads lab-allocate-core immediately before staff-presence'
);
check(
  /shared\/lab-allocate-core\.js[\s\S]*shared\/staff-presence\.js/.test(pop),
  'pop-out.html loads lab-allocate-core immediately before staff-presence'
);

const taskApi = fs.readFileSync(path.join(__dirname, 'shared/task-api.js'), 'utf8');
check(/fetchOpenPatientTasks/.test(taskApi), 'task-api exports fetchOpenPatientTasks');
check(
  /statuses\[\]/.test(taskApi) && /incomplete/.test(taskApi) && /snoozed/.test(taskApi),
  'open-task GET asks Medicus for incomplete + snoozed only'
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
