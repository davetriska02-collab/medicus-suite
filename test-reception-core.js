// Medicus Suite — Reception core logic tests
// Run with: node test-reception-core.js
// Dynamic-imports reception-core.js (ES module), same technique as test-sweep-core.js.

'use strict';

const path = require('path');

(async () => {
  let passed = 0, failed = 0;
  function check(cond, msg) {
    if (cond) { console.log(`  OK  ${msg}`); passed++; }
    else { console.error(`  FAIL  ${msg}`); failed++; process.exitCode = 1; }
  }

  const corePath = new URL(
    'side-panel/modules/reception/reception-core.js',
    `file://${path.resolve(__dirname)}/`
  ).href;

  const {
    summariseActionChips, evaluateRedFlags, buildCaptureText,
    extractPatientAppointments, pharmacyFirstHint,
  } = await import(corePath);

  // ── evaluateRedFlags ──────────────────────────────────────────────────────────
  console.log('--- evaluateRedFlags ---');
  const flags = [
    { id: 'a', ask: 'Flag A?', escalate: '999' },
    { id: 'b', ask: 'Flag B?', escalate: 'duty' },
    { id: 'c', ask: 'Flag C?', escalate: 'duty' },
  ];
  let r = evaluateRedFlags(flags, { a: 'no', b: 'yes' });
  check(r.unanswered.length === 1 && r.unanswered[0] === 'c', 'unanswered flag detected (undefined is not "no")');
  check(r.positives.length === 1 && r.positives[0].id === 'b' && r.positives[0].escalate === 'duty', 'positive flag carries escalation level');
  r = evaluateRedFlags(flags, { a: 'no', b: 'no', c: 'no' });
  check(r.unanswered.length === 0 && r.positives.length === 0, 'all-no → none positive, none unanswered');
  r = evaluateRedFlags(flags, null);
  check(r.unanswered.length === 3, 'null answers → all unanswered');

  // ── buildCaptureText ──────────────────────────────────────────────────────────
  console.log('\n--- buildCaptureText ---');
  const pathway = {
    id: 'sore-throat', title: 'Sore throat',
    redFlags: flags,
    questions: [
      { id: 'duration', ask: 'How long?', type: 'text', label: 'Duration' },
      { id: 'symptoms', ask: 'Which?', type: 'multi', options: ['X', 'Y'], label: 'Symptoms' },
      { id: 'fever', ask: 'Fever?', type: 'yesno', label: 'Fever' },
    ],
  };
  const closing = [{ id: 'contact', ask: 'Best number?', type: 'text', label: 'Contact' }];
  const escalations = { '999': 'CALL 999 NOW.', duty: 'DUTY GP NOW.' };

  const textPos = buildCaptureText({
    pathway, closingQuestions: closing, escalations,
    ownWords: 'my throat is killing me',
    redFlagAnswers: { a: 'yes', b: 'no', c: 'no' },
    questionAnswers: { duration: '3 days', symptoms: ['X', 'Y'], fever: '' },
    closingAnswers: { contact: '07700 900000' },
    meta: { takerInitials: 'AB', nowIso: '2026-06-10T14:32:00Z', suiteVersion: '3.38.0', patientLine: 'John Smith, DOB 1980-01-01', pharmacyFirstHint: 'PF note here' },
  });
  check(textPos.includes('RED FLAG REPORTED: Flag A?'), 'positive red flag named loudly');
  check(textPos.includes('ACTION: CALL 999 NOW.'), 'escalation text included for positive flag');
  check(textPos.includes('Flag B: no'), 'denied flags recorded as asked');
  check(textPos.includes('"my throat is killing me"'), "patient's own words quoted");
  check(textPos.includes('Duration: 3 days'), 'text answer rendered with label');
  check(textPos.includes('Symptoms: X, Y'), 'multi answers joined');
  check(textPos.includes('Fever: not recorded'), 'unanswered question marked "not recorded", not blank');
  check(textPos.includes('Contact: 07700 900000'), 'closing answers rendered');
  check(textPos.includes('Patient (from open record): John Smith'), 'patient line included when known (wrong-record paste guard)');
  check(textPos.includes('Pharmacy First: PF note here'), 'pharmacy first hint line included');
  check(textPos.includes('not a clinical assessment'), 'disclaimer footer present');
  check(textPos.includes('Taken by AB (reception)'), 'taker initials in header');
  check(!/[<>]/.test(textPos), 'plain text — no angle brackets');

  const textClean = buildCaptureText({
    pathway, closingQuestions: closing, escalations,
    ownWords: '',
    redFlagAnswers: { a: 'no', b: 'no', c: 'no' },
    questionAnswers: {}, closingAnswers: {},
    meta: { takerInitials: '', nowIso: '2026-06-10T09:00:00Z', suiteVersion: '3.38.0', patientLine: null, pharmacyFirstHint: null },
  });
  check(!textClean.includes('RED FLAG REPORTED'), 'no red-flag block when all denied');
  check(textClean.includes('Red flags asked'), 'asked/denied record still present when all denied');
  check(textClean.includes('In their own words: not recorded'), 'missing own-words marked');
  check(!textClean.includes('Pharmacy First:'), 'no PF line when hint null');
  check(!textClean.includes('Patient (from open record)'), 'no patient line when record not open');

  // ── extractPatientAppointments ────────────────────────────────────────────────
  console.log('\n--- extractPatientAppointments ---');
  const U1 = '11111111-2222-3333-4444-555555555555';
  const U2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const day = {
    staffSchedules: [
      {
        name: 'Dr Foo',
        schedule: [{
          entries: [
            { diaryEntryType: { value: 'appointment' }, patient: { id: U1, name: 'John Smith' }, startDateTime: '2026-06-01T09:00:00', appointmentType: { name: 'GP appt' }, displayStatus: { value: 'completed' } },
            { diaryEntryType: { value: 'appointment' }, patient: { id: U2, name: 'John Smith' }, startDateTime: '2026-06-01T09:30:00', appointmentType: { name: 'GP appt' } },
            { diaryEntryType: { value: 'slot' }, patient: { id: U1 } },
          ]
        }]
      },
      {
        name: 'Nurse Bar',
        schedule: [{
          entries: [
            { diaryEntryType: { value: 'appointment' }, patient: { ref: `/patient/${U1}` }, startDateTime: '2026-06-01T11:00:00', appointmentType: { name: 'Bloods' } },
          ]
        }]
      }
    ]
  };
  const appts = extractPatientAppointments(day, U1);
  check(appts.length === 2, 'matches by UUID only — same-name different-UUID patient excluded');
  check(appts.some(a => a.clinician === 'Dr Foo') && appts.some(a => a.clinician === 'Nurse Bar'), 'clinician taken from staff schedule');
  check(appts.some(a => a.type === 'Bloods'), 'UUID found via defensive scan of patient object string fields');
  check(!appts.some(a => a.type === '' && !a.startDateTime), 'slot entries ignored');
  check(extractPatientAppointments(day, null).length === 0, 'no uuid → no matches (never name-matches)');
  check(extractPatientAppointments({}, U1).length === 0, 'empty payload → no crash');

  // ── summariseActionChips ──────────────────────────────────────────────────────
  console.log('\n--- summariseActionChips ---');
  const sum = summariseActionChips([
    { status: 'in_date', ruleId: 'x' },
    { status: 'due_soon', drugName: 'Lithium' },
    { status: 'overdue', drugName: 'Methotrexate' },
    { status: 'achieved', ruleId: 'q' },
    { status: 'vax_due', displayName: 'Flu vaccine' },
  ]);
  check(sum.red === 1 && sum.amber === 2, 'counts: 1 red, 2 amber (vaccine due counts amber)');
  check(sum.items[0].name === 'Methotrexate', 'red items sorted first');
  check(sum.items.length === 3, 'green/neutral chips excluded');
  const sumEmpty = summariseActionChips(null);
  check(sumEmpty.red === 0 && sumEmpty.amber === 0 && sumEmpty.items.length === 0, 'null chips → zero summary');

  // ── pharmacyFirstHint ─────────────────────────────────────────────────────────
  console.log('\n--- pharmacyFirstHint ---');
  const pfPath = { pharmacyFirst: { ageMin: 16, ageMax: 64, note: 'PF UTI note' } };
  check(pharmacyFirstHint(pfPath, 30) === 'PF UTI note', 'in age band → note');
  check(pharmacyFirstHint(pfPath, 12) === null, 'below ageMin → null');
  check(pharmacyFirstHint(pfPath, 70) === null, 'above ageMax → null');
  check(String(pharmacyFirstHint(pfPath, null)).includes('age unknown'), 'unknown age → caveated note, never silent eligibility');
  check(pharmacyFirstHint({}, 30) === null, 'no pharmacyFirst on pathway → null');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
