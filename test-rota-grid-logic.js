// Medicus Suite — Rota grid interaction logic tests
// Run with: node test-rota-grid-logic.js
// rota/ is ESM, this root file is CJS (suite package.json has no "type"), so
// the module is pulled in through a dynamic import like every other test-rota-*.
'use strict';
const assert = require('node:assert/strict');
const path = require('path');
const R = (p) => import(new URL('rota/' + p, `file://${path.resolve(__dirname)}/`).href);

(async () => {
  const { cellKey, colKey, parseCellKey, rectKeys, buildClipboard, pasteOps } = await R('app/views/grid-logic.js');

  // A 3-staff × 4-column grid: Mon AM/PM, Tue AM/PM.
  const rowIds = ['gp1', 'gp2', 'nurse1'];
  const colKeys = ['2026-06-08|am', '2026-06-08|pm', '2026-06-09|am', '2026-06-09|pm'];

  /* ---- key helpers ---- */
  assert.equal(cellKey('gp1', '2026-06-08', 'am'), 'gp1|2026-06-08|am');
  assert.equal(colKey('2026-06-08', 'am'), '2026-06-08|am');
  assert.deepEqual(parseCellKey('gp1|2026-06-08|am'), { staffId: 'gp1', date: '2026-06-08', period: 'am' });

  /* ---- rectangle selection ---- */

  // Single cell: the anchor is the whole rectangle.
  assert.deepEqual(rectKeys(rowIds, colKeys, 'gp2|2026-06-09|am', 'gp2|2026-06-09|am'), ['gp2|2026-06-09|am']);

  // 2 rows × 2 cols, swept top-left → bottom-right. Row-major order.
  const forward = rectKeys(rowIds, colKeys, 'gp1|2026-06-08|pm', 'gp2|2026-06-09|am');
  assert.deepEqual(forward, ['gp1|2026-06-08|pm', 'gp1|2026-06-09|am', 'gp2|2026-06-08|pm', 'gp2|2026-06-09|am']);

  // Reversed anchors (swept bottom-right → top-left) cover the same cells in
  // the same grid order — the sweep direction must not leak into the result.
  const reversed = rectKeys(rowIds, colKeys, 'gp2|2026-06-09|am', 'gp1|2026-06-08|pm');
  assert.deepEqual(reversed, forward);

  // Mixed corners (bottom-left → top-right) too.
  assert.deepEqual(rectKeys(rowIds, colKeys, 'gp2|2026-06-08|am', 'gp1|2026-06-08|pm'), [
    'gp1|2026-06-08|am',
    'gp1|2026-06-08|pm',
    'gp2|2026-06-08|am',
    'gp2|2026-06-08|pm',
  ]);

  // A full-height, full-width sweep is the whole grid (3 × 4 = 12 cells).
  assert.equal(rectKeys(rowIds, colKeys, 'gp1|2026-06-08|am', 'nurse1|2026-06-09|pm').length, 12);

  // Cells that are not on the rendered grid (filtered staff, a day outside the
  // week) yield nothing rather than a bogus rectangle.
  assert.deepEqual(rectKeys(rowIds, colKeys, 'ghost|2026-06-08|am', 'gp1|2026-06-08|am'), []);
  assert.deepEqual(rectKeys(rowIds, colKeys, 'gp1|2026-06-08|am', 'gp1|2026-07-01|am'), []);

  /* ---- clipboard: relative offsets ---- */

  const entries = {
    'gp1|2026-06-08|am': { typeId: 'surgery', note: 'joint clinic', roomId: 'r1' },
    'gp1|2026-06-08|pm': { typeId: 'duty', note: '', roomId: 'r2' },
    'gp2|2026-06-08|pm': { typeId: 'admin', note: 'appraisal' },
  };
  const entryFor = (key) => entries[key] || null;

  const clip = buildClipboard({
    rowIds,
    colKeys,
    keys: ['gp1|2026-06-08|am', 'gp1|2026-06-08|pm', 'gp2|2026-06-08|am', 'gp2|2026-06-08|pm'],
    entryFor,
  });
  assert.equal(clip.rows, 2);
  assert.equal(clip.cols, 2);
  assert.equal(clip.cells.length, 4);
  assert.deepEqual(clip.cells[0], { dr: 0, dc: 0, typeId: 'surgery', note: 'joint clinic' });
  assert.deepEqual(clip.cells[1], { dr: 0, dc: 1, typeId: 'duty', note: '' });
  // An empty source cell travels as a "clear" so the rectangle pastes faithfully.
  assert.deepEqual(clip.cells[2], { dr: 1, dc: 0, typeId: null, note: '' });
  assert.deepEqual(clip.cells[3], { dr: 1, dc: 1, typeId: 'admin', note: 'appraisal' });
  // Room is deliberately NOT copied — a room cannot be in two places at once.
  assert.ok(clip.cells.every((c) => !('roomId' in c)));

  // Offsets are relative to the selection's own top-left, not the grid's.
  const clipMid = buildClipboard({ rowIds, colKeys, keys: ['gp2|2026-06-09|am'], entryFor });
  assert.deepEqual(clipMid, { rows: 1, cols: 1, cells: [{ dr: 0, dc: 0, typeId: null, note: '' }] });

  // Duplicate keys collapse; keys off the grid are ignored; nothing usable → null.
  const clipDup = buildClipboard({
    rowIds,
    colKeys,
    keys: ['gp1|2026-06-08|am', 'gp1|2026-06-08|am', 'ghost|2026-06-08|am'],
    entryFor,
  });
  assert.equal(clipDup.cells.length, 1);
  assert.equal(buildClipboard({ rowIds, colKeys, keys: ['ghost|2026-06-08|am'], entryFor }), null);
  assert.equal(buildClipboard({ rowIds, colKeys, keys: [], entryFor }), null);

  /* ---- paste: anchored mapping ---- */

  // Basic paste: the anchor becomes the clipboard's top-left cell.
  const basic = pasteOps({ rowIds, colKeys, clipboard: clip, anchorKey: 'gp2|2026-06-09|am' });
  assert.equal(basic.ops.length, 4);
  assert.equal(basic.skipped, 0);
  assert.equal(basic.offGrid, 0);
  assert.deepEqual(basic.ops[0], {
    staffId: 'gp2',
    date: '2026-06-09',
    period: 'am',
    key: 'gp2|2026-06-09|am',
    action: 'set',
    typeId: 'surgery',
    note: 'joint clinic',
  });
  assert.deepEqual(basic.ops[1].key, 'gp2|2026-06-09|pm');
  assert.deepEqual(basic.ops[2], {
    staffId: 'nurse1',
    date: '2026-06-09',
    period: 'am',
    key: 'nurse1|2026-06-09|am',
    action: 'clear',
    typeId: null,
    note: '',
  });

  // Edge clipping: anchored on the last row and last column, three of the four
  // clipboard cells fall off the grid — clipped and counted, never wrapped.
  const edge = pasteOps({ rowIds, colKeys, clipboard: clip, anchorKey: 'nurse1|2026-06-09|pm' });
  assert.equal(edge.ops.length, 1);
  assert.equal(edge.offGrid, 3);
  assert.equal(edge.ops[0].key, 'nurse1|2026-06-09|pm');

  // Bottom edge only (last row, first column): the second clipboard row is off.
  const bottom = pasteOps({ rowIds, colKeys, clipboard: clip, anchorKey: 'nurse1|2026-06-08|am' });
  assert.equal(bottom.ops.length, 2);
  assert.equal(bottom.offGrid, 2);

  // An anchor that is not on the grid pastes nothing.
  assert.deepEqual(pasteOps({ rowIds, colKeys, clipboard: clip, anchorKey: 'ghost|2026-06-08|am' }), {
    ops: [],
    skipped: 0,
    offGrid: 0,
  });
  assert.deepEqual(pasteOps({ rowIds, colKeys, clipboard: null, anchorKey: 'gp1|2026-06-08|am' }), {
    ops: [],
    skipped: 0,
    offGrid: 0,
  });

  /* ---- paste: skip rules, driven by caller-supplied data ---- */

  const approvedLeave = [{ staffId: 'nurse1', startDate: '2026-06-09', endDate: '2026-06-09' }];
  const notAPerson = new Set(['gp2']); // e.g. a "Registrar slot" placeholder row
  const isBlocked = ({ staffId, date }) =>
    notAPerson.has(staffId) ||
    approvedLeave.some((l) => l.staffId === staffId && l.startDate <= date && l.endDate >= date);

  const guarded = pasteOps({ rowIds, colKeys, clipboard: clip, anchorKey: 'gp2|2026-06-09|am', isBlocked });
  // gp2's two targets are a non-person row; nurse1's two are on approved leave
  // that day — all four skipped, and the count is reported, not swallowed.
  assert.equal(guarded.ops.length, 0);
  assert.equal(guarded.skipped, 4);

  // Same clipboard anchored on gp1 (no leave, real person) lands intact, and
  // the skip count only covers the blocked rows below it.
  const partial = pasteOps({ rowIds, colKeys, clipboard: clip, anchorKey: 'gp1|2026-06-09|am', isBlocked });
  assert.equal(partial.ops.length, 2);
  assert.equal(partial.skipped, 2);
  assert.ok(partial.ops.every((o) => o.staffId === 'gp1'));

  // Leave is date-specific: the same person on a different day is not blocked.
  const otherDay = pasteOps({
    rowIds,
    colKeys,
    clipboard: buildClipboard({ rowIds, colKeys, keys: ['gp1|2026-06-08|am'], entryFor }),
    anchorKey: 'nurse1|2026-06-08|am',
    isBlocked,
  });
  assert.equal(otherDay.ops.length, 1);
  assert.equal(otherDay.skipped, 0);

  console.log('rota grid-logic tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
