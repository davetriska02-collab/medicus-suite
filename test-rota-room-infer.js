// Medicus Suite — Rota room-infer tests (ported from medicus-rota-manager)
// Run with: node test-rota-room-infer.js
// Body is verbatim from the standalone repo; only the module loading changed —
// rota/ is ESM, this root file is CJS (suite package.json has no "type").
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { inferRooms, fillRooms } = await R('engine/room-infer.js');
  const { newStaff, typeById } = await R('shared/model.js');

  /* ---- original test body, unchanged ---- */
  const cell = (hasSession, booked = 0, f2f = 0) => ({ hasSession, slots: 2, booked, f2f });
  const off = cell(false);
  const row = (name, am, pm) => ({ name, am, pm });

  // Alice & Bob consult F2F together Mon AM (peak 2); Carol only Tue AM and
  // never overlaps either. Dave is remote-only and needs no room.
  const alice = newStaff({ id: 'a', name: 'Dr Alice' });
  const bob = newStaff({ id: 'b', name: 'Dr Bob' });
  const carol = newStaff({ id: 'c', name: 'Dr Carol' });
  const rowsByDate = {
    '2026-06-01': [
      row('Dr Alice', cell(true, 3, 3), off),
      row('Dr Bob', cell(true, 2, 2), off),
      row('Dr Dave', cell(true, 4, 0), off),
    ],
    '2026-06-02': [
      row('Dr Alice', cell(true, 3, 3), off),
      row('Dr Carol', off, cell(true, 1, 1)),
      row('Dr Eve', off, cell(true, 1, 1)),
    ],
  };

  const result = inferRooms({ rowsByDate, staff: [alice, bob, carol] });
  assert.equal(result.roomCount, 2); // peak: Alice + Bob Mon AM (Dave is remote-only and needs no room)
  assert.equal(result.datesObserved, 2);

  const room = (id) => result.assignments.find((x) => x.staffId === id).roomIndex;
  assert.notEqual(room('a'), room('b')); // overlapping pair never share
  assert.equal(room('a'), 0); // busiest (2 sessions) gets Room 1
  assert.equal(room('c'), 0); // Carol doesn't overlap Alice/Bob — reuses the lowest room
  assert.deepEqual(result.unmatched, ['Dr Eve']); // consulting F2F but unregistered; remote-only Dave needs no room at all

  // Empty/unbooked clinics are assumed face-to-face (rooms still needed).
  const unbooked = inferRooms({
    rowsByDate: { '2026-06-01': [row('Dr Alice', cell(true, 0, 0), off)] },
    staff: [alice],
  });
  assert.equal(unbooked.roomCount, 1);

  // Directory lanes (notAPerson) never occupy a room or an assignment.
  const bobLane = newStaff({ id: 'b2', name: 'Dr Bob', notAPerson: true });
  const laneResult = inferRooms({
    rowsByDate: { '2026-06-01': [row('Dr Alice', cell(true, 2, 2), off), row('Dr Bob', cell(true, 2, 2), off)] },
    staff: [alice, bobLane],
  });
  assert.equal(laneResult.roomCount, 1); // only Alice needs a room
  assert.ok(!laneResult.assignments.some((a) => a.staffId === 'b2'));

  // Booked but zero F2F (all remote/telephone) needs no room.
  const remote = inferRooms({ rowsByDate: { '2026-06-01': [row('Dr Alice', cell(true, 5, 0), off)] }, staff: [alice] });
  assert.equal(remote.roomCount, 0);

  // --- fillRooms ---
  const rooms = [
    { id: 'r1', name: 'Room 1' },
    { id: 'r2', name: 'Room 2' },
  ];
  alice.usualRoomId = 'r1';
  bob.usualRoomId = 'r1'; // same usual room: second arrival must spill over
  const entries = [
    { id: 'e1', staffId: 'a', date: '2026-06-08', period: 'am', typeId: 'surgery', status: 'planned', roomId: null },
    { id: 'e2', staffId: 'b', date: '2026-06-08', period: 'am', typeId: 'surgery', status: 'planned', roomId: null },
    { id: 'e3', staffId: 'a', date: '2026-06-08', period: 'pm', typeId: 'admin', status: 'planned', roomId: null }, // non-clinic: skipped
    { id: 'e4', staffId: 'b', date: '2026-06-08', period: 'pm', typeId: 'surgery', status: 'planned', roomId: 'r2' }, // already roomed: untouched
  ];
  const updates = fillRooms({ dates: ['2026-06-08'], entries, staff: [alice, bob], rooms, typeById });
  const get = (id) => (updates.find((u) => u.entryId === id) || {}).roomId;
  // Alice has more... ordering is by slot then entry order: e1 gets Alice's usual r1; e2 finds r1 taken -> r2.
  assert.equal(get('e1'), 'r1');
  assert.equal(get('e2'), 'r2');
  assert.equal(get('e3'), undefined); // admin needs no room
  assert.equal(get('e4'), undefined); // already assigned
  assert.equal(updates.length, 2);

  // No free room left -> entry stays unassigned rather than double-booked.
  const oneRoom = fillRooms({
    dates: ['2026-06-08'],
    entries: [
      { id: 'x1', staffId: 'a', date: '2026-06-08', period: 'am', typeId: 'surgery', status: 'planned', roomId: null },
      { id: 'x2', staffId: 'b', date: '2026-06-08', period: 'am', typeId: 'surgery', status: 'planned', roomId: null },
    ],
    staff: [alice, bob],
    rooms: [{ id: 'r1', name: 'Room 1' }],
    typeById,
  });
  assert.equal(oneRoom.length, 1);

  console.log('test-room-infer: OK');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
