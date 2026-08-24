// Medicus Suite — companion-role.js unit tests
// Run with: node test-companion-role.js
//
// Pins the Companion HUD role + page-context helpers: valid roles, which
// sections each role shows, Medicus URL → page kind, desk/slot/pulse
// mapping that must stay honest (no invented counts).

'use strict';

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

const role = require(path.join(__dirname, 'shared', 'companion-role.js'));

console.log('--- roles ---');
check(role.ROLES.join(',') === 'clinic,reception,triage,nursing', 'four roles in product order');
check(role.normalizeRole('Reception') === 'reception', 'normalizeRole folds case');
check(role.normalizeRole('nope') === 'clinic', 'unknown role falls back to clinic');
check(role.dueVoiceForRole('reception') === 'reception', 'reception uses booking voice');
check(role.dueVoiceForRole('nursing') === 'clinic', 'nursing keeps clinic voice');
check(role.dueVoiceForRole('triage') === 'clinic', 'triage voice unused (due is hidden)');
check(role.suggestedRole('queue', null) === 'triage', 'unsaved queue visit suggests triage');
check(role.suggestedRole('queue', 'clinic') === 'clinic', 'saved clinic is never yanked on the queue');
check(role.suggestedRole('task', null) === 'clinic', 'unsaved task visit suggests clinic');

console.log('\n--- role persist ---');
{
  const store = {
    data: {},
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null;
    },
    setItem(k, v) {
      this.data[k] = String(v);
    },
  };
  check(role.readSavedRole(store) === null, 'empty storage → no saved role');
  role.writeSavedRole(store, 'TRIAGE');
  check(store.data[role.ROLE_LS] === 'triage', 'write persists the normalised key');
  check(role.readSavedRole(store) === 'triage', 'read returns the saved role');
}

console.log('\n--- pageContext ---');
{
  const task =
    '/e38a9f/tasks/data/communication-thread/overview/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ctx = role.pageContext(task);
  check(ctx && ctx.kind === 'task', 'task overview → kind task');
  check(ctx.taskUuid === 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'task UUID captured');
  check(ctx.pageKey === ctx.taskUuid, 'task pageKey is the UUID');

  check(role.pageContext('/e38a9f/tasks/data/document/overview/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') === null, 'document-filing overview is skipped');

  const rec = role.pageContext(
    '/e38a9f/patient/patient/care-record/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  );
  check(rec && rec.kind === 'record', 'care-record → kind record');
  check(rec.patientId === 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'record patient UUID captured');

  const q = role.pageContext('/e38a9f/tasks/data/medical_patient_request_task/task-list');
  check(q && q.kind === 'queue', 'task-list → kind queue');
  check(q.typeSlug === 'medical_patient_request_task', 'queue slug captured');

  const qRoot = role.pageContext('/e38a9f/tasks/data/admin_patient_request_task');
  check(qRoot && qRoot.kind === 'queue', 'queue root without /task-list still counts');

  check(role.pageContext('/e38a9f/scheduling/diary') === null, 'unknown page → null (widget stays off)');
}

console.log('\n--- roleShows ---');
{
  const clinicTask = role.roleShows('clinic', 'task');
  check(clinicTask.due && clinicTask.book && clinicTask.task, 'clinic task: due + book + create-task');
  check(!clinicTask.desk && !clinicTask.pulse && !clinicTask.slots, 'clinic task: no desk / pulse / slots');

  const recTask = role.roleShows('reception', 'task');
  check(recTask.due && recTask.desk && recTask.slots && recTask.book, 'reception task: due + desk + slots + book');
  check(!recTask.task && !recTask.pulse, 'reception task: no create-task, no pulse');

  const triageQ = role.roleShows('triage', 'queue');
  check(triageQ.pulse && !triageQ.due && !triageQ.book && !triageQ.slots, 'triage queue: pulse only');
  check(!triageQ.task, 'triage on the queue cannot create a task (no patient pin)');

  const triageTask = role.roleShows('triage', 'task');
  check(triageTask.pulse && triageTask.task && !triageTask.due && !triageTask.book, 'triage task: pulse + create-task, no due/book');

  const nurseRec = role.roleShows('nursing', 'record');
  check(nurseRec.due && nurseRec.slots && nurseRec.book, 'nursing record: due + nurse slots + book');
  check(!nurseRec.pulse && !nurseRec.desk && !nurseRec.task, 'nursing: no pulse / desk / create-task');
}

console.log('\n--- deskFromPayloads is honest ---');
{
  const raw = {
    schedule: {
      schedule: [
        {
          entries: [
            { diaryEntryType: { value: 'appointment' }, displayStatus: { value: 'arrived' } },
            { diaryEntryType: { value: 'appointment' }, displayStatus: { value: 'booked' } },
            { diaryEntryType: { value: 'break' }, displayStatus: { value: 'arrived' } },
          ],
        },
      ],
    },
  };
  const desk = role.deskFromPayloads(raw, { tasks: [{ id: 1 }, { id: 2 }] }, { data: { tasks: [{ id: 3 }] } });
  check(desk.waiting === 1, 'waiting counts arrived appointments only');
  check(desk.medical === 2, 'medical requests counted from tasks[]');
  check(desk.admin === 1, 'admin requests counted from data.tasks[]');
  const missing = role.deskFromPayloads(null, null, { tasks: [] });
  check(missing.waiting === null && missing.medical === null, 'failed fetches stay null — never a fake 0');
  check(missing.admin === 0, 'successful empty list is a real 0');
}

console.log('\n--- slotsGlanceLines ---');
{
  const types = [
    { label: 'GP telephone', slots: [{ startDateTime: '2026-08-24 14:20:00' }] },
    { label: 'Nurse treatment room', slots: [{ startDateTime: '2026-08-24 15:05:00' }] },
    { label: 'HCA bloods', slots: [] },
  ];
  const rec = role.slotsGlanceLines(types, 'reception');
  check(rec.length === 2, 'reception glance is first two types');
  check(rec[0].time === '14:20' && rec[0].none === false, 'first available time is HH:mm');
  const nurse = role.slotsGlanceLines(types, 'nursing');
  check(nurse.length === 2, 'nursing picks nurse-ish types');
  check(
    nurse.every((l) => /nurse|bloods/i.test(l.label)),
    'nursing glance does not include the GP telephone type'
  );
  check(nurse[1].none === true, 'a type with no slots today is named as none, not hidden');
}

console.log('\n--- queuePulseFromDom ---');
{
  check(role.queuePulseFromDom(null).kind === 'not_queue', 'no root → not_queue (honest unknown)');
  const empty = {
    querySelectorAll() {
      return [];
    },
  };
  check(role.queuePulseFromDom(empty).kind === 'not_queue', 'no grid rows → not_queue');

  function fakeList(items) {
    const arr = items.slice();
    arr.length = items.length;
    return arr;
  }
  const root = {
    querySelectorAll(sel) {
      if (sel.indexOf('.ag-row') !== -1) {
        return fakeList([
          {
            classList: { contains: (c) => c === 'ag-row' },
            getAttribute: () => null,
          },
          {
            classList: { contains: (c) => c === 'ag-row-level-1' },
            getAttribute: () => null,
          },
          {
            classList: { contains: () => false },
            getAttribute: (n) => (n === 'aria-hidden' ? 'true' : null),
          },
        ]);
      }
      if (sel.indexOf('ch-queue-chips') !== -1) return fakeList([{}, {}]);
      if (sel.indexOf('ch-q-result') !== -1) {
        return fakeList([{ textContent: '  K 6.4  ' }, { textContent: 'Hb 68' }]);
      }
      return [];
    },
  };
  const pulse = role.queuePulseFromDom(root);
  check(pulse.kind === 'queue', 'grid present → kind queue');
  check(pulse.count === 1, 'detail rows and aria-hidden rows are not counted');
  check(pulse.redFlags === 2, 'red-flag chips counted from .ch-queue-chips');
  check(pulse.resultRed === 2 && pulse.worst.length === 2, 'worst two red results are named');
  check(pulse.worst[0] === 'K 6.4', 'result text is trimmed');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
