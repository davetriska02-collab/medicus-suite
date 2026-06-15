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
    pharmacyFirstHint, referralMatchesPatient,
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
  check(!textClean.includes('Referrals on file'), 'no referral block when no referral lines supplied');

  const textRef = buildCaptureText({
    pathway, closingQuestions: closing, escalations,
    ownWords: '',
    redFlagAnswers: { a: 'no', b: 'no', c: 'no' },
    questionAnswers: {}, closingAnswers: {},
    meta: {
      takerInitials: '', nowIso: '2026-06-10T09:00:00Z', suiteVersion: '3.38.0',
      referralLines: ['Cardiology, St Thomas Hospital · Dr Jane Doe · 12/03/2026 · Urgent · Incomplete'],
    },
  });
  check(textRef.includes('Referrals on file (matched by name'), 'referral block header present when lines supplied');
  check(textRef.includes('- Cardiology, St Thomas Hospital · Dr Jane Doe · 12/03/2026'), 'referral line rendered as bullet');

  // ── buildCaptureText: label collision disambiguation ──────────────────────────
  console.log('\n--- buildCaptureText: label collision disambiguation ---');
  const collisionPath = {
    id: 'test-collision', title: 'Collision test',
    // Two flags whose text before the first separator (',' here) is identical — both truncate to "Fever"
    redFlags: [
      { id: 'rf-x', ask: 'Fever, with shaking?', escalate: '999' },
      { id: 'rf-y', ask: 'Fever, with confusion?', escalate: 'duty' },
      { id: 'rf-z', ask: 'Chest pain?', escalate: '999' },
    ],
    questions: [{ id: 'q1', ask: 'Duration?', type: 'text' }],
  };
  const collText = buildCaptureText({
    pathway: collisionPath, closingQuestions: [], escalations: {},
    ownWords: '',
    redFlagAnswers: { 'rf-x': 'no', 'rf-y': 'no', 'rf-z': 'no' },
    questionAnswers: {}, closingAnswers: {},
    meta: { takerInitials: '', nowIso: '2026-06-10T10:00:00Z', suiteVersion: '' },
  });
  // The two "Fever" labels must be disambiguated
  check(collText.includes('Fever (#1)') && collText.includes('Fever (#2)'), 'colliding short labels disambiguated with (#n)');
  // The non-colliding label must remain unchanged
  check(collText.includes('Chest pain: no'), 'non-colliding label unchanged');
  // Unique labels are not suffixed
  check(!collText.includes('Chest pain (#'), 'non-colliding label has no (#n) suffix');

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

  // Practice chip filter (reception.config.hiddenChipRules): hidden action
  // chips are excluded from counts but COUNTED in hiddenCount — filtering is
  // surfaced in the UI, never silent.
  const sumHidden = summariseActionChips([
    { status: 'overdue', ruleId: 'mtx', drugName: 'Methotrexate' },
    { status: 'due_soon', ruleId: 'lith', drugName: 'Lithium' },
    { status: 'achieved', ruleId: 'qof1' },
  ], { mtx: true, qof1: true });
  check(sumHidden.red === 0 && sumHidden.amber === 1, 'hidden rule excluded from counts');
  check(sumHidden.hiddenCount === 1, 'hiddenCount counts only suppressed ACTION chips (green chip ignored)');
  check(sumHidden.items.length === 1 && sumHidden.items[0].name === 'Lithium', 'remaining chip listed');
  const sumNoHide = summariseActionChips([{ status: 'overdue', ruleId: 'mtx', drugName: 'M' }], {});
  check(sumNoHide.red === 1 && sumNoHide.hiddenCount === 0, 'empty filter map hides nothing');

  // ── pharmacyFirstHint ─────────────────────────────────────────────────────────
  console.log('\n--- pharmacyFirstHint ---');
  const pfPath = { pharmacyFirst: { ageMin: 16, ageMax: 64, note: 'PF UTI note' } };
  check(pharmacyFirstHint(pfPath, 30) === 'PF UTI note', 'in age band → note');
  check(pharmacyFirstHint(pfPath, 12) === null, 'below ageMin → null');
  check(pharmacyFirstHint(pfPath, 70) === null, 'above ageMax → null');
  check(String(pharmacyFirstHint(pfPath, null)).includes('age unknown'), 'unknown age → caveated note, never silent eligibility');
  check(pharmacyFirstHint({}, 30) === null, 'no pharmacyFirst on pathway → null');

  // ── referralMatchesPatient ────────────────────────────────────────────────────
  console.log('\n--- referralMatchesPatient ---');
  const refJS = { patientGivenName: 'John', patientFamilyName: 'Smith' };
  check(referralMatchesPatient(refJS, 'John Smith') === true, 'given+family both present → match');
  check(referralMatchesPatient(refJS, 'SMITH, John') === true, 'case/order/punctuation insensitive → match');
  check(referralMatchesPatient(refJS, 'John Smith-Jones') === false, 'different surname token → no match');
  check(referralMatchesPatient(refJS, 'Jane Smith') === false, 'surname shared but given differs → no match (no surname-only match)');
  check(referralMatchesPatient({ patientGivenName: 'John James', patientFamilyName: 'Smith' }, 'John James Smith') === true,
    'every given-name token must be present → multi-token given matches');
  check(referralMatchesPatient({ patientGivenName: 'John James', patientFamilyName: 'Smith' }, 'John Smith') === false,
    'missing one given-name token → no match');
  check(referralMatchesPatient({ patientGivenName: '', patientFamilyName: 'Smith' }, 'John Smith') === false, 'empty given name → no match');
  check(referralMatchesPatient(refJS, '') === false, 'empty patient name → no match');
  check(referralMatchesPatient(null, 'John Smith') === false, 'null referral → no match');

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
