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
check(role.dueVoiceForRole('nursing') === 'nursing', 'nursing uses treatment-room voice');
check(role.dueVoiceForRole('triage') === 'clinic', 'triage voice unused (due is hidden)');
check(role.roleCaption('clinic') === 'GP due list for this patient', 'clinic caption is plain English');
check(/treatment room|Bloods/.test(role.roleCaption('nursing')), 'nursing caption names the work');
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
  check(
    role.pageContext('/e38a9f/scheduling/diary', { allScreens: true }).kind === 'practice',
    'all-screens diary → practice (no patient pin)'
  );
  const enc = role.pageContext(
    '/e38a9f/patient/cccccccc-cccc-cccc-cccc-cccccccccccc/clinical/notes',
    { allScreens: true }
  );
  check(enc && enc.kind === 'elsewhere', 'all-screens /patient/{uuid}/… → elsewhere');
  check(enc.patientId === 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'elsewhere captures the patient UUID');
  check(
    role.pageContext('/e38a9f/scheduling/diary/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { allScreens: true }).kind ===
      'practice',
    'a random UUID on the diary is not treated as a patient'
  );
  check(role.pageContext('/login', { allScreens: true }) === null, 'no site id → still off even with all-screens');
  check(
    role.extractPatientUuidFromPath('/e38a9f/care-record/dddddddd-dddd-dddd-dddd-dddddddddddd') ===
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'extractPatientUuidFromPath reads a care-record UUID'
  );
  check(role.siteIdFromPath('/e38a9f/scheduling/diary') === 'e38a9f', 'siteIdFromPath reads the practice prefix');
}

console.log('\n--- all-screens / dock / size persist ---');
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
  check(role.readAllScreens(store) === false, 'all-screens defaults off');
  role.writeAllScreens(store, true);
  check(store.data[role.ALL_SCREENS_LS] === '1', 'all-screens persists as 1');
  check(role.readAllScreens(store) === true, 'all-screens reads back on');
  check(role.readDocked(store) === false, 'docked defaults off (floating)');
  role.writeDocked(store, true);
  check(role.readDocked(store) === true, 'docked reads back on');
  const clamped = role.clampSize({ width: 80, height: 40 }, { width: 800, height: 600 });
  check(clamped.width === role.MIN_WIDTH, 'clampSize floors width');
  check(clamped.height === role.MIN_HEIGHT, 'clampSize floors height');
  const wide = role.clampSize({ width: 9000, height: 9000 }, { width: 800, height: 600 });
  check(wide.width === 784, 'clampSize caps width to viewport-16');
  role.writeSavedSize(store, { width: 420, height: 300 });
  const saved = role.readSavedSize(store);
  check(saved && saved.width === 420 && saved.height === 300, 'saved size round-trips');
}

console.log('\n--- roleShows ---');
{
  const clinicTask = role.roleShows('clinic', 'task');
  check(clinicTask.due && clinicTask.book && clinicTask.task, 'clinic task: due + book + create-task');
  check(!clinicTask.desk && !clinicTask.pulse && !clinicTask.slots, 'clinic task: no desk / pulse / slots');

  const recTask = role.roleShows('reception', 'task');
  check(recTask.due && recTask.desk && recTask.slots && recTask.book, 'reception task: due + desk + slots + book');
  check(recTask.record, 'reception task: already-booked appointments (same fetch as clinic)');
  check(!recTask.task && !recTask.pulse, 'reception task: no create-task, no pulse');

  const triageQ = role.roleShows('triage', 'queue');
  check(triageQ.pulse && !triageQ.due && !triageQ.book && !triageQ.slots, 'triage queue: pulse only');
  check(!triageQ.task, 'triage on the queue cannot create a task (no patient pin)');

  const triageTask = role.roleShows('triage', 'task');
  check(triageTask.pulse && triageTask.task && !triageTask.due && !triageTask.book, 'triage task: pulse + create-task, no due/book');

  const nurseRec = role.roleShows('nursing', 'record');
  check(nurseRec.due && nurseRec.slots && nurseRec.book, 'nursing record: due + nurse slots + book');
  check(!nurseRec.pulse && !nurseRec.desk && !nurseRec.task, 'nursing: no pulse / desk / create-task');

  const clinicElse = role.roleShows('clinic', 'elsewhere');
  check(clinicElse.due && clinicElse.book && !clinicElse.task, 'clinic elsewhere: due + book, no create-task');
  const clinicPractice = role.roleShows('clinic', 'practice');
  check(!clinicPractice.due && !clinicPractice.book, 'clinic practice page: no due/book without a patient pin');
  const recPractice = role.roleShows('reception', 'practice');
  check(recPractice.desk && recPractice.slots && !recPractice.due, 'reception practice: desk + slots only');
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

console.log('\n--- slotsFromOverview (Slot Counter scrape) ---');
{
  const raw = {
    staffSchedules: [
      {
        name: 'Dr A',
        schedule: [
          {
            entries: [
              {
                diaryEntryType: { value: 'slot' },
                appointmentType: { name: 'GP telephone' },
                startDateTime: '2026-08-24 14:20:00',
              },
              {
                diaryEntryType: { value: 'slot' },
                appointmentType: { name: 'GP telephone' },
                startDateTime: '2026-08-24 14:40:00',
              },
              {
                diaryEntryType: { value: 'appointment' },
                appointmentType: { name: 'GP telephone' },
                startDateTime: '2026-08-24 15:00:00',
              },
              {
                diaryEntryType: { value: 'slot' },
                appointmentType: { name: 'Nurse treatment room' },
                startDateTime: '2026-08-24 09:05:00',
              },
              {
                diaryEntryType: { value: 'slot' },
                appointmentType: { name: 'HCA bloods' },
                startDateTime: '2026-08-24 16:00:00',
              },
            ],
          },
        ],
      },
    ],
  };
  const now = new Date('2026-08-24T10:00:00').getTime();
  const rec = role.slotsFromOverview(raw, { todayISO: '2026-08-24', nowMs: now, role: 'reception' });
  check(rec.total === 3, `past morning nurse slot is dropped (got total ${rec.total})`);
  check(rec.typeCount === 2, 'booked appointments are not counted as free slots');
  check(rec.lines[0].label === 'GP telephone' && rec.lines[0].count === 2, 'types ranked by remaining count');
  check(rec.lines[0].time === '14:20', 'next time is the earliest remaining slot');
  check(rec.lines.some((l) => l.label === 'HCA bloods'), 'overview includes every remaining type, not the first two finder types');
  check(Array.isArray(rec.allLines) && rec.allLines.length === rec.lines.length, 'allLines is present for in-widget expand');
  check(!rec.lines.some((l) => l.label === 'Nurse treatment room'), 'past-today slots are excluded');

  const nurse = role.slotsFromOverview(raw, { todayISO: '2026-08-24', nowMs: now, role: 'nursing' });
  check(
    nurse.lines.every((l) => /nurse|bloods/i.test(l.label)),
    'nursing glance filters to nurse-ish types from the same scrape'
  );
  check(nurse.total === 1 && nurse.lines[0].label === 'HCA bloods', 'nursing still sees remaining HCA bloods');

  const empty = role.slotsFromOverview({ staffSchedules: [] }, { role: 'reception' });
  check(empty.total === 0 && empty.lines.length === 0, 'empty book → zero types, not a fake list');
}

console.log('\n--- slotsGlanceLines fallback ---');
{
  const types = [
    { label: 'GP telephone', slots: [{ startDateTime: '2026-08-24 14:20:00' }] },
    { label: 'Nurse treatment room', slots: [{ startDateTime: '2026-08-24 15:05:00' }] },
    { label: 'HCA bloods', slots: [] },
  ];
  const rec = role.slotsGlanceLines(types, 'reception');
  check(rec.length === 3, 'fallback no longer silently drops types after the first two');
  check(rec[0].time === '14:20' && rec[0].none === false, 'first available time is HH:mm');
  const nurse = role.slotsGlanceLines(types, 'nursing');
  check(
    nurse.every((l) => /nurse|bloods/i.test(l.label)),
    'nursing fallback does not include the GP telephone type'
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
  check(pulse.oldestMinutes == null, 'no minute chips → oldest stays unknown (not a fake 0)');
}

console.log('\n--- suggestedBookHint ---');
{
  const lines = [
    { label: 'HCA bloods', count: 2 },
    { label: 'Diabetes clinic', count: 1 },
    { label: 'GP telephone', count: 8 },
  ];
  check(
    role.suggestedBookHint('Methotrexate bloods', lines) === 'HCA bloods',
    'bloods due line maps to a live bloods type'
  );
  check(
    role.suggestedBookHint('Book a diabetes review', lines) === 'Diabetes clinic',
    'diabetes due line maps to a live diabetes type'
  );
  check(
    role.suggestedBookHint('Methotrexate bloods', []) === 'a bloods slot',
    'without a live match the hint stays generic — never a committed type'
  );
  check(role.suggestedBookHint('Serotonin syndrome risk', lines) === '', 'combo/alert lines get no book hint');
}

console.log('\n--- queuePulse oldest wait ---');
{
  function fakeList(items) {
    const arr = items.slice();
    arr.length = items.length;
    return arr;
  }
  const root = {
    querySelectorAll(sel) {
      if (sel.indexOf('.ag-row') !== -1) {
        return fakeList([{ classList: { contains: () => false }, getAttribute: () => null }]);
      }
      if (sel.indexOf('ch-q-result') !== -1) {
        return fakeList([{ textContent: 'Chest pain — 41 min' }]);
      }
      if (sel.indexOf('ch-queue-chips') !== -1 || sel.indexOf('ch-chip-age') !== -1) {
        return fakeList([{ textContent: '18 min' }]);
      }
      return [];
    },
  };
  const pulse = role.queuePulseFromDom(root);
  check(pulse.oldestMinutes === 41, 'oldest wait is the largest on-screen minute count');
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
