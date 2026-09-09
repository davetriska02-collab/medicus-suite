// Medicus Suite — Away / staff absence wrapper tests
// Run with: node test-staff-presence.js
//
// Away ≠ Task Presence. Pins that Monitoring reuses LabAllocateCore
// (presenceForName / shouldWarnAbsence / absenceWarningCopy / matchStaffByName)
// and never the occupancy stack.

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

console.log('\n--- rota sources (read-only keys) ---');
const rota = SP.rotaSourcesFromStorage({
  'rota.staff': staff,
  'rota.leave': leaveAway,
});
check(rota.staffList === staff, 'staff list passed through');
check(rota.leaveList === leaveAway, 'leave list passed through');
check(SP.rotaSourcesFromStorage(null).staffList.length === 0, 'null storage → empty staff');
check(SP.rotaSourcesFromStorage({}).leaveList.length === 0, 'empty storage → empty leave');

console.log('\n--- lookup is LabAllocateCore.presenceForName ---');
const sources = SP.sourcesFromParts({
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
check(away.label === direct.label, 'wrapper label matches LabAllocateCore');
check(C.shouldWarnAbsence(away) === true, 'core shouldWarnAbsence true for away');
check(SP.shouldWarnAbsence(away) === C.shouldWarnAbsence(away), 'shouldWarnAbsence is the core export');

const pendingSrc = SP.sourcesFromParts({
  staffList: staff,
  leaveList: leavePending,
  dateISO: '2026-09-09',
});
const pending = SP.lookup('Dr Natalie Azadian', pendingSrc);
check(pending.state === 'away-pending', 'requested leave → away-pending');
check(SP.shouldWarnAbsence(pending) === true, 'shouldWarnAbsence true for away-pending');

const noLeave = SP.lookup('Dr Natalie Azadian', SP.sourcesFromParts({ staffList: staff, leaveList: [] }));
check(noLeave.state !== 'away' && noLeave.state !== 'away-pending', 'no leave → not away');
check(SP.shouldWarnAbsence(noLeave) === false, 'shouldWarnAbsence false when not away');

console.log('\n--- unknown is not present ---');
const unknown = SP.lookup('Dr Natalie Azadian', SP.sourcesFromParts({}));
check(unknown.state === 'unknown', 'no rota / absences / book → unknown, not present');
check(SP.shouldWarnAbsence(unknown) === false, 'unknown does not warn');
check(SP.decorateAssigneeLabel('Dr Natalie Azadian', unknown) === 'Dr Natalie Azadian', 'unknown is not painted Away');
check(SP.absenceNote(unknown) === '', 'unknown has no absence note');

console.log('\n--- teams are n/a ---');
const team = SP.lookup('Triage Doctor', sources);
check(team.state === 'n/a' && team.reason === 'team', 'team inbox is n/a');
check(SP.isTeamAssignee('Triage Doctor') === C.isTeamAssignee('Triage Doctor'), 'isTeamAssignee is the core export');
check(SP.shouldWarnAbsence(team) === false, 'teams do not warn');
check(SP.decorateAssigneeLabel('Triage Doctor', team) === 'Triage Doctor', 'team label is not painted Away');

console.log('\n--- matchStaffByName / absenceWarningCopy are core exports ---');
check(SP.matchStaffByName(staff, 'Dr Natalie Azadian') === C.matchStaffByName(staff, 'Dr Natalie Azadian'),
  'matchStaffByName is the core export');
check(SP.matchStaffByName(staff, 'Dr Natalie Azadian').id === 'staff-azadian', 'matchStaffByName hits the rota row');
const coreCopy = C.absenceWarningCopy(away, 1, 'Dr Natalie Azadian');
check(SP.absenceWarningCopy(away, 1, 'Dr Natalie Azadian') === coreCopy, 'absenceWarningCopy is the core export');
check(/is on /.test(away.label), 'presence.label is "{name} is on {leave type}…"');
check(/until /.test(away.label), 'presence.label names the return date');

console.log('\n--- assignee label + allocate absence note ---');
check(SP.decorateAssigneeLabel('Dr Natalie Azadian', away) === 'Dr Natalie Azadian — Away', 'away suffix');
check(SP.decorateAssigneeLabel('Dr Natalie Azadian', noLeave) === 'Dr Natalie Azadian', 'not-away keeps the name');
check(SP.decorateAssigneeLabel('  ', away) === '', 'blank label stays blank');
check(SP.absenceNote(away) === away.label, 'note is the allocate abs.label sentence');
check(SP.absenceNote(pending) === pending.label, 'pending note is abs.label');
check(SP.absenceNote(noLeave) === '', 'no note when shouldWarnAbsence is false');

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

console.log('\n--- Away ≠ Task Presence (source guard) ---');
const wrap = fs.readFileSync(path.join(__dirname, 'shared/staff-presence.js'), 'utf8');
const sent = fs.readFileSync(path.join(__dirname, 'side-panel/modules/sentinel/sentinel.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'side-panel/modules/sentinel/sentinel.css'), 'utf8');
for (const [name, src] of [
  ['staff-presence.js', wrap],
  ['sentinel.js', sent],
]) {
  check(!/task-presence\.js/.test(src), `${name} does not load task-presence.js`);
  check(!/ms-tp-chip/.test(src), `${name} does not use occupancy chips`);
  check(!/presenceLook/.test(src), `${name} does not use suite.display.presenceLook`);
  check(!/presence\.enabled/.test(src), `${name} does not read presence.enabled`);
  check(!/['"]rota\.(staff|leave)['"]\s*:/.test(src), `${name} does not write rota.staff / rota.leave`);
}
check(!/function presenceForName\(/.test(sent), 'Sentinel does not invent a second presenceForName');
check(!/leaveOnDate|absenceForName/.test(sent), 'Sentinel does not copy-paste leave math');
check(/shouldWarnAbsence/.test(sent), 'Sentinel uses shouldWarnAbsence');
check(/absenceNote/.test(sent), 'Sentinel paints the allocate absence note');
check(/ms-lac-chip-flag/.test(sent), 'Away chip reuses the allocate flag class');
check(/ms-lac-col-absence/.test(sent), 'note reuses the allocate absence class');
check(/ms-lac-chip-flag/.test(css) && /ms-lac-col-absence/.test(css), 'sentinel.css mirrors allocate away tokens');
check(
  /createBtn\.disabled = !\(assigneeSel\.value && descEl\.value\.trim\(\)\)/.test(sent),
  'Create is disabled only when assignee or details are empty — not because away'
);
check(!/createBtn\.disabled.*away|away.*createBtn\.disabled/.test(sent), 'no away-gated disable of Create');

console.log('\n--- Monitoring (Sentinel) wiring ---');
check(/staffPresenceApi\(\)/.test(sent), 'Sentinel calls staffPresenceApi()');
check(/StaffPresence/.test(sent), 'Sentinel talks to window.StaffPresence');
check(/decorateAssigneeLabel/.test(sent), 'assignee options use decorateAssigneeLabel');
check(/normaliseOpenTask/.test(sent), 'open-task rows use normaliseOpenTask');
check(/fetchStaffScheduleAbsences/.test(wrap), 'loader uses allocate fetchStaffScheduleAbsences');
check(/rota\.staff/.test(wrap) && /rota\.leave/.test(wrap), 'loader reads rota.staff + rota.leave');
check(/get\(\['rota\.staff', 'rota\.leave'\]\)/.test(wrap), 'storage GET is rota keys only');
check(!/chrome\.storage\.local\.set\(/.test(wrap), 'wrapper never calls chrome.storage.local.set');

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
