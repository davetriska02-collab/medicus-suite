// Medicus Suite — Rota ics tests (ported from medicus-rota-manager)
// Run with: node test-rota-ics.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { staffICS } = await R('engine/ics.js');
  const { newStaff } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  const gp = newStaff({ id: 'g1', name: 'Dr A' });
  const rooms = [{ id: 'r1', name: 'Room 1' }];
  const entries = [
    {
      id: 'e1',
      staffId: 'g1',
      date: '2026-06-08',
      period: 'am',
      typeId: 'surgery',
      status: 'planned',
      roomId: 'r1',
      note: 'Joint clinic, with; commas',
    },
    { id: 'e2', staffId: 'g1', date: '2026-06-08', period: 'pm', typeId: 'duty', status: 'confirmed' },
    { id: 'e3', staffId: 'g1', date: '2026-06-09', period: 'am', typeId: 'surgery', status: 'vacancy' }, // not exported
    { id: 'e4', staffId: 'other', date: '2026-06-08', period: 'am', typeId: 'surgery', status: 'planned' }, // wrong person
  ];

  const ics = staffICS({ person: gp, entries, rooms });

  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('END:VCALENDAR'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2); // vacancy + other person excluded
  assert.ok(ics.includes('UID:e1@medicus-rota-manager'));
  assert.ok(ics.includes('DTSTART:20260608T080000'));
  assert.ok(ics.includes('DTEND:20260608T130000'));
  assert.ok(ics.includes('DTSTART:20260608T130000')); // PM session
  assert.ok(ics.includes('DTEND:20260608T183000'));
  assert.ok(ics.includes('SUMMARY:Surgery (AM)'));
  assert.ok(ics.includes('SUMMARY:Duty doctor (PM)'));
  assert.ok(ics.includes('LOCATION:Room 1'));
  assert.ok(ics.includes('DESCRIPTION:Joint clinic\\, with\\; commas')); // RFC 5545 escaping
  assert.ok(!ics.includes('e3@')); // vacancy not exported
  assert.ok(/\r\n/.test(ics)); // CRLF line endings

  console.log('test-ics: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
