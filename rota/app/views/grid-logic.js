// Pure grid geometry + clipboard mapping for the rota grid.
//
// Nothing in here touches the DOM, chrome.* or app state: the caller passes in
// the grid's ordered row keys (staff ids, top to bottom) and column keys
// ("<date>|<period>", left to right) plus plain lookup/predicate callbacks, and
// gets back plain data. That keeps the fiddly bits (rectangle selection,
// relative-offset paste, edge clipping) node-testable — see
// test-rota-grid-logic.js.
//
// Cell key format matches rota.js's `cellKey()`: `<staffId>|<date>|<period>`.

export function cellKey(staffId, date, period) {
  return `${staffId}|${date}|${period}`;
}

export function colKey(date, period) {
  return `${date}|${period}`;
}

export function parseCellKey(key) {
  const [staffId, date, period] = String(key).split('|');
  return { staffId, date, period };
}

// Where a cell key sits in the rendered grid, or null when it is not on it
// (a filtered-out staff member, a day the week no longer shows, …).
function locate(rowIds, colKeys, key) {
  const { staffId, date, period } = parseCellKey(key);
  const r = rowIds.indexOf(staffId);
  const c = colKeys.indexOf(colKey(date, period));
  if (r < 0 || c < 0) return null;
  return { r, c, key };
}

// Excel-style rectangle: every cell between the anchor and the current cell,
// returned in grid order (row-major, top-left → bottom-right) regardless of
// which corner the sweep started from. A single cell yields one key.
export function rectKeys(rowIds, colKeys, anchorKey, currentKey) {
  const a = locate(rowIds, colKeys, anchorKey);
  const b = locate(rowIds, colKeys, currentKey);
  if (!a || !b) return [];
  const r0 = Math.min(a.r, b.r);
  const r1 = Math.max(a.r, b.r);
  const c0 = Math.min(a.c, b.c);
  const c1 = Math.max(a.c, b.c);
  const out = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) out.push(`${rowIds[r]}|${colKeys[c]}`);
  }
  return out;
}

// Snapshot the covered cells as offsets from the selection's top-left corner.
// `entryFor(key)` returns the entry at that cell (or null/undefined). Only the
// layout travels — type + note. Room is deliberately dropped: a room is a
// physical resource that cannot be in two places at once, so copying it would
// manufacture clashes.
// A covered cell with no entry is kept as `typeId: null`, i.e. "clear the
// target" — that is what makes pasting a rectangle reproduce the rectangle.
export function buildClipboard({ rowIds, colKeys, keys, entryFor }) {
  const located = [...new Set(keys || [])].map((k) => locate(rowIds, colKeys, k)).filter(Boolean);
  if (!located.length) return null;
  const r0 = Math.min(...located.map((p) => p.r));
  const c0 = Math.min(...located.map((p) => p.c));
  const r1 = Math.max(...located.map((p) => p.r));
  const c1 = Math.max(...located.map((p) => p.c));
  const cells = located.map((p) => {
    const entry = (entryFor && entryFor(p.key)) || null;
    return {
      dr: p.r - r0,
      dc: p.c - c0,
      typeId: entry ? entry.typeId : null,
      note: entry && entry.note ? entry.note : '',
    };
  });
  return { rows: r1 - r0 + 1, cols: c1 - c0 + 1, cells };
}

// Map a clipboard onto the grid, anchored at `anchorKey` (which becomes the
// clipboard's top-left cell). Targets that fall off the grid are clipped, not
// wrapped; targets the caller's `isBlocked({staffId,date,period})` refuses
// (approved leave, non-person rows) are skipped and counted so the UI can say
// so out loud rather than silently dropping sessions.
export function pasteOps({ rowIds, colKeys, clipboard, anchorKey, isBlocked }) {
  const ops = [];
  let skipped = 0;
  let offGrid = 0;
  const anchor = locate(rowIds, colKeys, anchorKey);
  if (!anchor || !clipboard || !clipboard.cells) return { ops, skipped, offGrid };
  for (const cell of clipboard.cells) {
    const r = anchor.r + cell.dr;
    const c = anchor.c + cell.dc;
    if (r < 0 || r >= rowIds.length || c < 0 || c >= colKeys.length) {
      offGrid += 1;
      continue;
    }
    const { date, period } = parseCellKey(`x|${colKeys[c]}`);
    const target = { staffId: rowIds[r], date, period, key: `${rowIds[r]}|${colKeys[c]}` };
    if (isBlocked && isBlocked(target)) {
      skipped += 1;
      continue;
    }
    ops.push({
      ...target,
      action: cell.typeId ? 'set' : 'clear',
      typeId: cell.typeId,
      note: cell.note || '',
    });
  }
  return { ops, skipped, offGrid };
}
