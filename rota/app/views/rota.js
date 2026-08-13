// The rota grid: staff × (day, AM/PM) for one week, with inline cell
// editing, drag-and-drop, multi-select bulk editing, keyboard navigation,
// undo, a rooms pivot view, template generation, fair duty auto-assignment
// and the rules-engine warnings panel underneath.

import { esc } from '../../shared/esc.js';
import { weekDates, dayKey, fmtDay, addDays, mondayOf, todayISO } from '../../shared/time.js';
import { SESSION_TYPES, typeById, periodsFor, PERIOD_INFO } from '../../shared/model.js';
import { uid } from '../../shared/store.js';
import { checkWeek, capacitySummary, dutyFairness, eaSummary } from '../../engine/rules.js';
import { fillRooms } from '../../engine/room-infer.js';
import { generateEntries } from '../../engine/template.js';
import { autoAssignDuty, applyDutyChanges } from '../../engine/fairness.js';
import { solveRota } from '../../engine/solver.js';
import { approvedLeaveFor } from '../../engine/leave.js';
import { staffSorted, staffLabel, typeChip, leaveChip, warnHTML } from './ui.js';
import { rectKeys, buildClipboard, pasteOps, parseCellKey } from './grid-logic.js';

const ACTIVE = ['planned', 'confirmed', 'covered'];
const HISTORY_CAP = 30;
let activeCtx = null;

// The shape of the grid currently on screen, captured on every staff-mode
// render. The module-scope keyboard/mouse listeners live outside render(), so
// this is how they know the row/column order the user is looking at.
let gridShape = { rowIds: [], colKeys: [] };
let gridRoot = null;
// Copy/paste buffer — session layout only, deliberately session-scoped (never
// persisted): a rota clipboard that survived a reload would paste stale weeks.
let clipboard = null;
let lastFocusedKey = null;

/* ---- undo / redo ---- */
function pushHistory(stack, entries) {
  stack.push(JSON.stringify(entries));
  if (stack.length > HISTORY_CAP) stack.shift();
}

// Read-only backstop. Every mutation in this file goes through pushUndo first,
// so this is the single choke point that holds even if a handler, a stale
// listener or a console-driven call slips past the UI suppression above. It
// THROWS rather than no-oping: an edit that silently vanishes is worse than an
// obvious failure.
function pushUndo(state) {
  if (activeCtx && (activeCtx.readOnly || activeCtx.locked)) throw new Error('read-only');
  const stack = state.ui.undoStack || (state.ui.undoStack = []);
  pushHistory(stack, state.entries);
  // Any new mutation invalidates the redo branch — redoing onto a rota that has
  // moved on since would resurrect sessions nobody asked for.
  state.ui.redoStack = [];
}

async function undo(ctx) {
  const stack = ctx.state.ui.undoStack || [];
  const snapshot = stack.pop();
  if (!snapshot) {
    ctx.toast('Nothing to undo');
    return;
  }
  pushHistory(ctx.state.ui.redoStack || (ctx.state.ui.redoStack = []), ctx.state.entries);
  ctx.state.entries = JSON.parse(snapshot);
  await ctx.persist('entries');
  ctx.toast('Undone');
  ctx.rerender();
}

async function redo(ctx) {
  const stack = ctx.state.ui.redoStack || [];
  const snapshot = stack.pop();
  if (!snapshot) {
    ctx.toast('Nothing to redo');
    return;
  }
  // Straight onto the undo stack: pushUndo() would clear the redo branch we are
  // half way through walking back up.
  pushHistory(ctx.state.ui.undoStack || (ctx.state.ui.undoStack = []), ctx.state.entries);
  ctx.state.entries = JSON.parse(snapshot);
  await ctx.persist('entries');
  ctx.toast('Redone');
  ctx.rerender();
}

/* ---- undo toast (a toast with a real button, anchored above the grid) ---- */
let actionToastTimer = null;

function closeActionToast() {
  clearTimeout(actionToastTimer);
  const el = document.getElementById('rota-actiontoast');
  if (el) el.remove();
}

// Called AFTER ctx.rerender(), so it measures the grid that is actually on
// screen and survives the re-render (it lives on document.body, not #main).
function actionToast(ctx, message) {
  closeActionToast();
  const el = document.createElement('div');
  el.id = 'rota-actiontoast';
  el.innerHTML = `<span>${esc(message)}</span><button type="button" id="rota-actiontoast-undo">Undo</button>`;
  document.body.appendChild(el);
  const wrap = document.querySelector('.rotawrap');
  if (wrap) {
    const r = wrap.getBoundingClientRect();
    el.style.left = `${Math.round(r.left + r.width / 2)}px`;
    el.style.top = `${Math.max(12, Math.round(r.top - el.offsetHeight - 8))}px`;
  }
  el.querySelector('#rota-actiontoast-undo').onclick = async () => {
    closeActionToast();
    await undo(ctx);
  };
  actionToastTimer = setTimeout(closeActionToast, 6000);
}

/* ---- copy / paste ---- */
function entryAt(state, staffId, date, period) {
  return state.entries.find((e) => e.staffId === staffId && e.date === date && e.period === period) || null;
}

// One predicate for "you cannot put a session here", shared by the drag
// greying, the drop handler and paste, so they can never disagree.
function blockedReason(state, staffId, date) {
  const person = state.staff.find((p) => p.id === staffId);
  if (!person) return 'no such staff member';
  if (person.notAPerson) return `${person.name} is not a person`;
  if (approvedLeaveFor(state.leave, staffId, date)) return `${person.name} is on approved leave that day`;
  return '';
}

function copyCells(ctx, fallbackKey) {
  const { state } = ctx;
  const selected = state.ui.selected || [];
  const keys = selected.length ? selected : fallbackKey ? [fallbackKey] : [];
  if (!keys.length) {
    ctx.toast('Nothing to copy — click a cell or select a block first');
    return;
  }
  const clip = buildClipboard({
    rowIds: gridShape.rowIds,
    colKeys: gridShape.colKeys,
    keys,
    entryFor: (key) => {
      const { staffId, date, period } = parseCellKey(key);
      return entryAt(state, staffId, date, period);
    },
  });
  if (!clip) {
    ctx.toast('Nothing to copy');
    return;
  }
  clipboard = clip;
  const filled = clip.cells.filter((c) => c.typeId).length;
  ctx.toast(`Copied ${clip.rows}×${clip.cols} block (${filled} session${filled === 1 ? '' : 's'}) — Ctrl+V to paste`);
}

async function pasteAt(ctx, anchorKey) {
  const { state } = ctx;
  if (!clipboard) {
    ctx.toast('Clipboard is empty — copy a cell or block first (Ctrl+C)');
    return;
  }
  if (!anchorKey) {
    ctx.toast('Click the cell to paste into first');
    return;
  }
  const { ops, skipped, offGrid } = pasteOps({
    rowIds: gridShape.rowIds,
    colKeys: gridShape.colKeys,
    clipboard,
    anchorKey,
    isBlocked: ({ staffId, date }) => Boolean(blockedReason(state, staffId, date)),
  });
  // A "clear" onto an already-empty cell is not a change: filtering those out
  // first keeps the undo stack free of no-op snapshots.
  const effective = ops.filter((op) => op.action === 'set' || entryAt(state, op.staffId, op.date, op.period));
  if (!effective.length) {
    ctx.toast(skipped ? `Nothing pasted — ${skipped} cell(s) on leave or not a person` : 'Nothing to paste here');
    return;
  }
  pushUndo(state);
  let written = 0;
  let cleared = 0;
  for (const op of effective) {
    const existing = entryAt(state, op.staffId, op.date, op.period);
    // A blank cell in the copied block blanks its target, so a pasted rectangle
    // reproduces the rectangle. Counted separately: deleting somebody's session
    // is not the same event as writing one, and the toast must say so.
    if (op.action === 'clear') {
      if (existing) {
        state.entries = state.entries.filter((e) => e.id !== existing.id);
        cleared += 1;
      }
      continue;
    }
    if (existing) {
      Object.assign(existing, { typeId: op.typeId, status: 'planned', source: 'manual', note: op.note });
    } else {
      state.entries.push({
        id: uid(),
        staffId: op.staffId,
        date: op.date,
        period: op.period,
        typeId: op.typeId,
        status: 'planned',
        source: 'manual',
        note: op.note,
        roomId: null,
      });
    }
    written += 1;
  }
  await ctx.persist('entries');
  ctx.rerender();
  const notes = [];
  if (cleared) notes.push(`${cleared} cell(s) cleared`);
  if (skipped) notes.push(`${skipped} skipped (leave / not a person)`);
  if (offGrid) notes.push(`${offGrid} off the grid`);
  actionToast(
    ctx,
    `Pasted ${written} session${written === 1 ? '' : 's'}${notes.length ? ` — ${notes.join(', ')}` : ''}`
  );
}

/* ---- drag-time validity feedback ---- */
function clearDragMarks() {
  if (!gridRoot) return;
  for (const td of gridRoot.querySelectorAll('td.cell')) {
    td.classList.remove('drop-invalid', 'dragover', 'dragover-bad', 'dragover-copy');
  }
}

// Grey out every cell this entry could not legally land on, for the duration of
// the drag. The drop handler still refuses independently — this is the
// affordance, not the guard.
function markInvalidTargets(root, state) {
  for (const td of root.querySelectorAll('td.cell')) {
    if (blockedReason(state, td.dataset.staff, td.dataset.date)) td.classList.add('drop-invalid');
  }
}

/* ---- cell editor menu ---- */
function closeMenu() {
  const m = document.getElementById('cellmenu');
  if (m) m.remove();
}

function positionMenu(menu, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 12))}px`;
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 12)}px`;
}

function openCellMenu(ctx, cell, person, date, period) {
  closeMenu();
  const { state } = ctx;
  const entry = state.entries.find((e) => e.staffId === person.id && e.date === date && e.period === period);
  const rooms = state.rooms || [];
  const menu = document.createElement('div');
  menu.id = 'cellmenu';
  menu.innerHTML = `
    <div class="who">${esc(person.name)} — ${esc(fmtDay(date))} ${period.toUpperCase()}</div>
    ${SESSION_TYPES.map(
      (t) => `
      <button data-type="${esc(t.id)}"><span class="chip" style="background:${esc(t.colour)}">${esc(t.short)}</span>${esc(t.name)}</button>
    `
    ).join('')}
    ${
      entry && rooms.length
        ? `
      <div class="who">Room</div>
      ${rooms.map((r) => `<button data-room="${esc(r.id)}"><span class="chip" style="background:${entry.roomId === r.id ? '#0d9488' : '#64748b'}">RM</span>${esc(r.name)}${entry.roomId === r.id ? ' ✓' : ''}</button>`).join('')}
      ${entry.roomId ? '<button data-room=""><span class="chip" style="background:#94a3b8">×</span>No room</button>' : ''}
    `
        : ''
    }
    ${entry ? '<button data-act="note"><span class="chip" style="background:#64748b">…</span>Edit note</button>' : ''}
    <button data-act="copy"><span class="chip" style="background:#64748b">⧉</span>Copy${(state.ui.selected || []).length > 1 ? ` ${(state.ui.selected || []).length} cells` : ''}</button>
    ${clipboard ? `<button data-act="paste"><span class="chip" style="background:#0ea5e9">⤓</span>Paste ${esc(`${clipboard.rows}×${clipboard.cols}`)} here</button>` : ''}
    ${entry && entry.status === 'vacancy' ? '<button data-act="covered"><span class="chip covered" style="background:#059669">LOC</span>Mark covered (locum)</button>' : ''}
    ${entry ? '<button data-act="clear"><span class="chip" style="background:#94a3b8">×</span>Clear session</button>' : ''}
  `;
  document.body.appendChild(menu);
  positionMenu(menu, cell);

  menu.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    // Copy/paste run their own persist+rerender (or none at all), so they leave
    // before the shared tail below.
    if (btn.dataset.act === 'copy') {
      closeMenu();
      copyCells(ctx, `${person.id}|${date}|${period}`);
      return;
    }
    if (btn.dataset.act === 'paste') {
      closeMenu();
      await pasteAt(ctx, `${person.id}|${date}|${period}`);
      return;
    }
    if (btn.dataset.type) {
      pushUndo(state);
      if (entry) {
        entry.typeId = btn.dataset.type;
        entry.status = 'planned';
        entry.source = 'manual';
        entry.note = '';
      } else {
        state.entries.push({
          id: uid(),
          staffId: person.id,
          date,
          period,
          typeId: btn.dataset.type,
          status: 'planned',
          source: 'manual',
          note: '',
        });
      }
    } else if ('room' in btn.dataset && entry) {
      pushUndo(state);
      entry.roomId = btn.dataset.room || null;
    } else if (btn.dataset.act === 'note' && entry) {
      const note = prompt('Note for this session', entry.note || '');
      if (note === null) return;
      pushUndo(state);
      entry.note = note.trim();
    } else if (btn.dataset.act === 'covered' && entry) {
      pushUndo(state);
      entry.status = 'covered';
      entry.note = 'Covered by locum';
    } else if (btn.dataset.act === 'clear' && entry) {
      pushUndo(state);
      state.entries = state.entries.filter((e) => e.id !== entry.id);
    }
    closeMenu();
    await ctx.persist('entries');
    ctx.rerender();
  });
}

/* ---- room re-assignment menu (rooms pivot) ---- */
function openRoomMenu(ctx, anchorEl, entry) {
  closeMenu();
  const { state } = ctx;
  const rooms = state.rooms || [];
  const person = state.staff.find((p) => p.id === entry.staffId);
  const menu = document.createElement('div');
  menu.id = 'cellmenu';
  menu.innerHTML = `
    <div class="who">${esc(person ? person.name : entry.staffId)} — ${esc(fmtDay(entry.date))} ${esc(String(entry.period).toUpperCase())}</div>
    ${rooms
      .map(
        (r) =>
          `<button data-room="${esc(r.id)}"><span class="chip" style="background:${entry.roomId === r.id ? '#0d9488' : '#64748b'}">RM</span>${esc(r.name)}${entry.roomId === r.id ? ' ✓' : ''}</button>`
      )
      .join('')}
    ${entry.roomId ? '<button data-room=""><span class="chip" style="background:#94a3b8">×</span>No room</button>' : ''}
  `;
  document.body.appendChild(menu);
  positionMenu(menu, anchorEl);

  menu.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button');
    if (!btn || !('room' in btn.dataset)) return;
    const roomId = btn.dataset.room || null;
    closeMenu();
    if ((entry.roomId || null) === roomId) return;
    pushUndo(state);
    entry.roomId = roomId;
    await ctx.persist('entries');
    ctx.rerender();
    const room = rooms.find((r) => r.id === roomId);
    actionToast(ctx, room ? `Moved to ${room.name} ✓` : 'Room cleared ✓');
  });
}

document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#cellmenu') && !ev.target.closest('td.cell')) closeMenu();
});

/* ---- keyboard shortcuts (grid-wide, so they live outside render) ---- */
const onRotaPage = (ev) =>
  Boolean(activeCtx) &&
  location.hash === '#rota' &&
  !(ev.target.closest && ev.target.closest('input, select, textarea'));

// These listeners are registered ONCE, at module scope, and outlive every
// render — so they must read the gate from activeCtx at EVENT time, not from a
// value captured when the page was drawn. A passcode re-locked in another part
// of the app is in force for the very next keystroke.
const gateBlocks = () => Boolean(activeCtx && (activeCtx.readOnly || activeCtx.locked));

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    closeMenu();
    closeActionToast();
  }
  if (!onRotaPage(ev)) return;
  if (!(ev.ctrlKey || ev.metaKey)) return;
  const key = ev.key.toLowerCase();
  // Ctrl+C stays: copying what is on screen is reading, not writing. Undo,
  // redo and paste all mutate, so they are dead while read-only.
  if (key === 'z' && !ev.shiftKey) {
    if (gateBlocks()) return;
    ev.preventDefault();
    undo(activeCtx);
  } else if ((key === 'z' && ev.shiftKey) || key === 'y') {
    if (gateBlocks()) return;
    ev.preventDefault();
    redo(activeCtx);
  } else if (key === 'c' && (activeCtx.state.ui.rotaMode || 'staff') === 'staff') {
    // Only hijack Ctrl+C when there is actually a grid target, and never over a
    // live text selection — copying selected prose must keep working.
    if (!(activeCtx.state.ui.selected || []).length && !lastFocusedKey) return;
    if (String(window.getSelection() || '')) return;
    ev.preventDefault();
    copyCells(activeCtx, lastFocusedKey);
  } else if (key === 'v' && (activeCtx.state.ui.rotaMode || 'staff') === 'staff') {
    if (gateBlocks()) return;
    ev.preventDefault();
    pasteAt(activeCtx, lastFocusedKey || (activeCtx.state.ui.selected || [])[0]);
  }
});

/* ---- Excel-style rectangle selection (mouse sweep) ----
   Left running while read-only ON PURPOSE: a sweep writes nothing but
   state.ui.selected, and being able to trace a block across the grid with the
   mouse is a reading aid. The bulk bar it normally summons is suppressed.
   Cells holding an entry are draggable=true so HTML5 drag keeps working, so a
   sweep may only START from an empty cell — or from any cell with Shift held,
   where the mousedown handler suppresses the native drag for that one gesture.
   The sweep paints .selecting straight onto the DOM; state.ui.selected and the
   re-render happen once, on mouseup. */
let sweep = null;
let suppressClick = false;

function paintSweep() {
  if (!sweep || !gridRoot) return;
  const covered = new Set(rectKeys(gridShape.rowIds, gridShape.colKeys, sweep.anchor, sweep.last));
  for (const td of gridRoot.querySelectorAll('td.cell')) {
    td.classList.toggle('selecting', covered.has(cellKey(td)));
  }
}

document.addEventListener('mousemove', (ev) => {
  if (!sweep) return;
  const td = ev.target.closest && ev.target.closest('td.cell');
  if (!td || !gridRoot || !gridRoot.contains(td)) return;
  const key = cellKey(td);
  if (key === sweep.last) return;
  sweep.last = key;
  sweep.moved = true;
  paintSweep();
});

document.addEventListener('mouseup', () => {
  if (!sweep) return;
  const done = sweep;
  sweep = null;
  if (done.restoreDrag) done.restoreDrag.draggable = true;
  if (gridRoot) for (const td of gridRoot.querySelectorAll('td.cell')) td.classList.remove('selecting');
  // A sweep that never left its anchor is an ordinary click — let the click
  // handler deal with it (shift-click toggle, plain click opens the menu).
  if (!done.moved || !activeCtx) return;
  const keys = rectKeys(gridShape.rowIds, gridShape.colKeys, done.anchor, done.last);
  const state = activeCtx.state;
  if (done.additive) {
    const merged = new Set(state.ui.selected || []);
    for (const k of keys) merged.add(k);
    state.ui.selected = [...merged];
  } else {
    state.ui.selected = keys;
  }
  suppressClick = true;
  // The click event fires synchronously after this mouseup; clear the flag once
  // that has happened, whether or not a click actually landed on a cell.
  setTimeout(() => {
    suppressClick = false;
  }, 0);
  activeCtx.rerender();
});

/* ---- keyboard grid navigation ---- */
function moveFocus(root, cell, dx, dy) {
  const rows = [...root.querySelectorAll('table.rota tbody tr')].filter((r) => r.querySelector('td.cell'));
  const rowIdx = rows.findIndex((r) => r.contains(cell));
  if (rowIdx < 0) return;
  const cells = [...rows[rowIdx].querySelectorAll('td.cell')];
  const colIdx = cells.indexOf(cell);
  const r = rowIdx + dy;
  const c = colIdx + dx;
  if (r < 0 || r >= rows.length) return;
  const targetCells = [...rows[r].querySelectorAll('td.cell')];
  if (c < 0 || c >= targetCells.length) return;
  cell.tabIndex = -1;
  targetCells[c].tabIndex = 0;
  targetCells[c].focus();
}

const cellKey = (cell) => `${cell.dataset.staff}|${cell.dataset.date}|${cell.dataset.period}`;
const shortName = (name) =>
  String(name || '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();

export default {
  render(root, ctx) {
    activeCtx = ctx;
    const { state } = ctx;
    // Passcode gate, staff view: the grid renders in full but cannot be edited.
    // Suppression here is the affordance; pushUndo() and app.js's persist() are
    // the guards. Anything already open from before the lock is closed first —
    // a cell menu left on screen would offer edits that now throw.
    const readOnly = Boolean(ctx.readOnly || ctx.locked);
    if (readOnly) {
      closeMenu();
      closeActionToast();
    }
    const s = state.settings;
    const mode = state.ui.rotaMode || 'staff';
    const selected = state.ui.selected || (state.ui.selected = []);
    const undoStack = state.ui.undoStack || [];
    const redoStack = state.ui.redoStack || [];
    const rooms = state.rooms || [];
    const dates = weekDates(state.weekMonday);
    const today = todayISO();
    const showDates = dates.filter((d) => s.openDays.includes(dayKey(d)) || state.entries.some((e) => e.date === d));
    const sites = (s.sites || []).filter(Boolean);
    const siteFilter = state.ui.siteFilter || '';
    const people = staffSorted(state.staff).filter(
      (p) => !p.notAPerson && (!siteFilter || (p.site || sites[0]) === siteFilter)
    );
    const P = periodsFor(s);

    // What the module-scope mouse/keyboard listeners need to know about the
    // grid on screen: its row order and its column order.
    gridRoot = root;
    gridShape = {
      rowIds: people.map((p) => p.id),
      colKeys: showDates.flatMap((d) => P.map((period) => `${d}|${period}`)),
    };
    if (lastFocusedKey) {
      const { staffId, date, period } = parseCellKey(lastFocusedKey);
      if (!gridShape.rowIds.includes(staffId) || !gridShape.colKeys.includes(`${date}|${period}`))
        lastFocusedKey = null;
    }

    const warnings = checkWeek({
      dates,
      entries: state.entries,
      staff: state.staff,
      leaveList: state.leave,
      settings: s,
      rooms,
    });
    const cap = capacitySummary({
      dates,
      entries: state.entries,
      staff: state.staff,
      leaveList: state.leave,
      settings: s,
    });
    const fairnessWindowStart = addDays(state.weekMonday, -56);
    const fair = dutyFairness({
      entries: state.entries.filter((e) => e.date >= fairnessWindowStart && e.date <= dates[6]),
      staff: state.staff,
    });
    for (const f of fair.flagged) {
      warnings.push({
        severity: 'info',
        kind: 'fairness',
        message: `Duty fairness: ${f.name} carries ${f.dutyCount} duty sessions in the last 8 weeks — well above the pro-rata practice average`,
      });
    }
    const high = warnings.filter((w) => w.severity === 'high').length;
    const ea = eaSummary({ dates, entries: state.entries, staff: state.staff, leaveList: state.leave, settings: s });

    root.innerHTML = `
      <h1>Rota</h1>
      <div class="printhead">Rota — ${esc(fmtDay(dates[0]))} to ${esc(fmtDay(dates[6]))}</div>
      <div class="toolbar">
        <button id="prev" title="Previous week">‹</button>
        <button id="todaybtn">This week</button>
        <button id="next" title="Next week">›</button>
        <input type="date" id="jump" value="${esc(state.weekMonday)}" title="Jump to week">
        <span class="weeklabel">${esc(fmtDay(dates[0]))} – ${esc(fmtDay(dates[6]))}</span>
        <span class="seg">
          <button id="modestaff" class="${mode === 'staff' ? 'primary' : ''}">Staff</button>
          <button id="moderooms" class="${mode === 'rooms' ? 'primary' : ''}" ${rooms.length ? '' : 'disabled title="Add rooms in Settings first"'}>Rooms</button>
        </span>
        ${
          sites.length > 1
            ? `
          <select id="sitefilter" title="Filter by site">
            <option value="">All sites</option>
            ${sites.map((x) => `<option ${siteFilter === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}
          </select>`
            : ''
        }
        <span class="spacer"></span>
        ${readOnly ? '<span class="pill requested" title="Enter the practice passcode to edit">view only</span>' : ''}
        <button id="shortcutsbtn" class="${state.ui.showShortcuts ? 'primary' : ''}" title="Show the drag, select and clipboard gestures" aria-pressed="${state.ui.showShortcuts ? 'true' : 'false'}">⌨ Shortcuts</button>
        ${
          readOnly
            ? // Read-only keeps the reading tools — week navigation, the mode
              // toggle, the site filter, shortcuts and print — and drops every
              // control that writes.
              '<button id="printbtn" title="Print this week">Print</button>'
            : `
        <button id="undobtn" ${undoStack.length ? '' : 'disabled'} title="Ctrl+Z">↶ Undo</button>
        <button id="redobtn" ${redoStack.length ? '' : 'disabled'} title="Ctrl+Shift+Z or Ctrl+Y">↷ Redo</button>
        <button id="solvebtn" class="primary">Solve rota</button>
        <details class="actions">
          <summary>Actions</summary>
          <div class="actions-panel">
            <button id="autoduty">Auto-assign duty</button>
            <button id="copyweek" title="Copy last week's sessions into empty cells this week">Copy previous week</button>
            ${rooms.length ? '<button id="fillrooms" title="Give each clinic session its owner\'s usual room, avoiding clashes">Assign rooms</button>' : ''}
            <div class="actions-row">
              <select id="genweeks">
                ${[1, 2, 4, 6, 8, 12].map((n) => `<option value="${n}">${n} week${n > 1 ? 's' : ''}</option>`).join('')}
              </select>
              <button id="generate">Generate from templates</button>
            </div>
            <button id="printbtn" title="Print this week">Print</button>
          </div>
        </details>`
        }
      </div>
      ${state.ui.showShortcuts ? shortcutsStrip(mode, readOnly) : ''}
      ${
        mode === 'staff' && selected.length && !readOnly
          ? `
        <div class="toolbar bulkbar">
          <strong>${selected.length} cell(s) selected</strong>
          <select id="bulktype">${SESSION_TYPES.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
          <button id="bulktypeapply">Set type</button>
          ${
            rooms.length
              ? `
            <select id="bulkroom"><option value="">No room</option>${rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select>
            <button id="bulkroomapply">Set room</button>`
              : ''
          }
          <button id="bulkclear" class="danger">Clear sessions</button>
          <button id="bulkdeselect">Deselect</button>
        </div>`
          : ''
      }
      ${state.ui.solvePanel && mode === 'staff' && !readOnly ? solvePanel(state) : ''}
      <div class="rotawrap">
        ${mode === 'staff' ? staffGrid(state, people, showDates, dates, today, selected, readOnly) : roomGrid(state, rooms, showDates, today, readOnly)}
      </div>
      <div class="sub" style="margin:6px 0 14px">
        ${
          readOnly
            ? 'View only — the rota is passcode-protected. Use Unlock in the sidebar to edit it. Week navigation, the rooms view and printing all still work.'
            : mode === 'staff'
              ? 'Click to edit · drag to move · drag across empty cells to select a block · Ctrl+Z to undo. Press ⌨ Shortcuts above for the full set.'
              : 'Rooms view: who is in each room per session. Click a name chip to reassign it, or drag it to another room in the same day and session column. The Unassigned row shows clinical sessions with no room.'
        }
      </div>
      <div class="card">
        <h2 class="mt0">Checks — ${high ? `<span style="color:var(--high)">${high} high-priority</span>, ` : ''}${warnings.length} total</h2>
        <div class="sub" style="margin-bottom:8px">
          Capacity: ${cap.gpClinicalSessions} GP clinical sessions ≈ ${cap.estimated} appointments vs benchmark ${cap.target}
          (${esc(String(s.accessBenchmarkPer1000))}/1,000 × ${Number(s.listSize).toLocaleString()} patients)
          ${ea ? `<br>Enhanced access: ${ea.minutes} min this week vs DES requirement ${ea.target} min (60 min/1,000/week)` : ''}
        </div>
        ${warnHTML(warnings)}
      </div>
    `;

    /* ---- toolbar ---- */
    root.querySelector('#prev').onclick = () => {
      state.weekMonday = addDays(state.weekMonday, -7);
      ctx.rerender();
    };
    root.querySelector('#next').onclick = () => {
      state.weekMonday = addDays(state.weekMonday, 7);
      ctx.rerender();
    };
    root.querySelector('#todaybtn').onclick = () => {
      state.weekMonday = mondayOf(todayISO());
      ctx.rerender();
    };
    root.querySelector('#jump').onchange = (e) => {
      if (e.target.value) {
        state.weekMonday = mondayOf(e.target.value);
        ctx.rerender();
      }
    };
    root.querySelector('#modestaff').onclick = () => {
      state.ui.rotaMode = 'staff';
      ctx.rerender();
    };
    root.querySelector('#moderooms').onclick = () => {
      state.ui.rotaMode = 'rooms';
      ctx.rerender();
    };
    const siteSel = root.querySelector('#sitefilter');
    if (siteSel)
      siteSel.onchange = () => {
        state.ui.siteFilter = siteSel.value;
        ctx.rerender();
      };
    root.querySelector('#printbtn').onclick = () => window.print();
    // Undo/redo are not rendered at all while read-only — hence the guards
    // rather than a bare querySelector().onclick.
    const undoBtn = root.querySelector('#undobtn');
    if (undoBtn) undoBtn.onclick = () => undo(ctx);
    const redoBtn = root.querySelector('#redobtn');
    if (redoBtn) redoBtn.onclick = () => redo(ctx);
    root.querySelector('#shortcutsbtn').onclick = () => {
      state.ui.showShortcuts = !state.ui.showShortcuts;
      ctx.rerender();
    };
    const shortcutsClose = root.querySelector('#shortcuts-dismiss');
    if (shortcutsClose)
      shortcutsClose.onclick = () => {
        state.ui.showShortcuts = false;
        ctx.rerender();
      };

    const fillBtn = root.querySelector('#fillrooms');
    if (fillBtn)
      fillBtn.onclick = async () => {
        const updates = fillRooms({ dates, entries: state.entries, staff: state.staff, rooms, typeById });
        if (!updates.length) {
          ctx.toast('Nothing to assign — every clinic session already has a room (or no rooms are free)');
          return;
        }
        pushUndo(state);
        const byId = Object.fromEntries(updates.map((u) => [u.entryId, u.roomId]));
        state.entries = state.entries.map((e) => (byId[e.id] ? { ...e, roomId: byId[e.id] } : e));
        await ctx.persist('entries');
        await ctx.log(`Assigned rooms to ${updates.length} session(s) this week`);
        ctx.toast(`${updates.length} session(s) given rooms — check the Rooms view`);
        ctx.rerender();
      };

    const copyWeekBtn = root.querySelector('#copyweek');
    if (copyWeekBtn)
      copyWeekBtn.onclick = async () => {
        const prevDates = weekDates(addDays(state.weekMonday, -7));
        pushUndo(state);
        let copied = 0;
        let skipped = 0;
        const source = state.entries.filter((e) => prevDates.includes(e.date) && ACTIVE.includes(e.status));
        for (const e of source) {
          const date = addDays(e.date, 7);
          const occupied = state.entries.some(
            (t) => t.staffId === e.staffId && t.date === date && t.period === e.period
          );
          if (occupied || approvedLeaveFor(state.leave, e.staffId, date)) {
            skipped += 1;
            continue;
          }
          state.entries.push({
            id: uid(),
            staffId: e.staffId,
            date,
            period: e.period,
            typeId: e.typeId,
            status: 'planned',
            source: 'manual',
            note: '',
            roomId: e.roomId || null,
          });
          copied += 1;
        }
        if (copied) await ctx.persist('entries');
        else state.ui.undoStack.pop();
        ctx.toast(
          `Copied ${copied} session(s) from last week${skipped ? `; ${skipped} skipped (occupied or on leave)` : ''}`
        );
        ctx.rerender();
      };

    const generateBtn = root.querySelector('#generate');
    if (generateBtn)
      generateBtn.onclick = async () => {
        const weeks = Number(root.querySelector('#genweeks').value);
        if (!state.settings.templateAnchorMonday) {
          state.settings.templateAnchorMonday = state.weekMonday;
          await ctx.persist('settings');
        }
        const created = generateEntries({
          staff: state.staff,
          startDate: state.weekMonday,
          endDate: addDays(state.weekMonday, weeks * 7 - 1),
          existingEntries: state.entries,
          leaveList: state.leave,
          settings: state.settings,
        });
        if (created.length) {
          pushUndo(state);
          state.entries.push(...created);
          await ctx.persist('entries');
        }
        ctx.toast(`Generated ${created.length} sessions over ${weeks} week(s)`);
        ctx.rerender();
      };

    const autoDutyBtn = root.querySelector('#autoduty');
    if (autoDutyBtn)
      autoDutyBtn.onclick = async () => {
        const history = state.entries.filter((e) => e.date >= fairnessWindowStart && e.date < dates[0]);
        const { changes, unfilled } = autoAssignDuty({
          dates,
          entries: state.entries,
          staff: state.staff,
          leaveList: state.leave,
          settings: state.settings,
          historyEntries: history,
        });
        if (changes.length) {
          pushUndo(state);
          state.entries = applyDutyChanges(state.entries, changes);
          await ctx.persist('entries');
        }
        ctx.toast(
          `Duty assigned: ${changes.length} session(s)${unfilled.length ? `; ${unfilled.length} slot(s) had no eligible GP` : ''}`
        );
        ctx.rerender();
      };

    const solveBtn = root.querySelector('#solvebtn');
    if (solveBtn)
      solveBtn.onclick = () => {
        if (state.ui.solvePanel) {
          state.ui.solvePanel = false;
          state.ui.solveResult = null;
        } else {
          state.ui.solvePanel = true;
        }
        ctx.rerender();
      };

    const svRun = root.querySelector('#sv-run');
    if (svRun) {
      svRun.onclick = async () => {
        const weeks = Number(root.querySelector('#sv-weeks').value) || 4;
        const maxDutyPerWeek = Number(root.querySelector('#sv-cap').value) || 2;
        const iterations = Number(root.querySelector('#sv-effort').value) || 8000;
        const horizonDates = [];
        for (let w = 0; w < weeks; w++) {
          const weekStart = addDays(state.weekMonday, w * 7);
          for (const d of weekDates(weekStart)) horizonDates.push(d);
        }
        const horizonStart = horizonDates[0];
        const historyStart = addDays(horizonStart, -56);
        const historyEntries = state.entries.filter((e) => e.date >= historyStart && e.date < horizonStart);
        const result = solveRota({
          dates: horizonDates,
          entries: state.entries,
          staff: state.staff,
          leaveList: state.leave,
          settings: state.settings,
          rooms: state.rooms,
          historyEntries,
          options: { maxDutyPerWeek, iterations, seed: 1 },
        });
        state.ui.solveResult = result;
        ctx.rerender();
      };
    }

    const svApply = root.querySelector('#sv-apply');
    if (svApply) {
      svApply.onclick = async () => {
        const result = state.ui.solveResult;
        const roomMoves = (result && result.roomChanges) || [];
        if (!result || (!result.changes.length && !roomMoves.length)) return;
        const weeks = Number(root.querySelector('#sv-weeks').value) || 4;
        pushUndo(state);
        for (const change of result.changes) {
          const entry = state.entries.find((e) => e.id === change.entryId);
          if (entry) {
            entry.typeId = change.to;
            entry.source = 'solver';
          }
        }
        for (const move of roomMoves) {
          const entry = state.entries.find((e) => e.id === move.entryId);
          if (entry) entry.roomId = move.to;
        }
        await ctx.persist('entries');
        const summary =
          `Solver applied ${result.changes.length} change(s)` +
          (roomMoves.length ? ` and ${roomMoves.length} room move(s)` : '') +
          ` over ${weeks} week(s)`;
        await ctx.log(summary);
        ctx.toast(summary);
        state.ui.solvePanel = false;
        state.ui.solveResult = null;
        ctx.rerender();
      };
    }

    const svDiscard = root.querySelector('#sv-discard');
    if (svDiscard) {
      svDiscard.onclick = () => {
        state.ui.solveResult = null;
        ctx.rerender();
      };
    }

    /* ---- bulk editing ---- */
    const parseKey = (key) => {
      const [staffId, date, period] = key.split('|');
      return { staffId, date, period };
    };
    const bulkBtn = (id, fn) => {
      const b = root.querySelector(id);
      if (b) b.onclick = fn;
    };

    bulkBtn('#bulktypeapply', async () => {
      const typeId = root.querySelector('#bulktype').value;
      pushUndo(state);
      let changed = 0;
      let skipped = 0;
      for (const key of selected) {
        const { staffId, date, period } = parseKey(key);
        if (blockedReason(state, staffId, date)) {
          skipped += 1;
          continue;
        }
        const entry = state.entries.find((e) => e.staffId === staffId && e.date === date && e.period === period);
        if (entry) {
          Object.assign(entry, { typeId, status: 'planned', source: 'manual' });
        } else {
          state.entries.push({
            id: uid(),
            staffId,
            date,
            period,
            typeId,
            status: 'planned',
            source: 'manual',
            note: '',
          });
        }
        changed += 1;
      }
      await ctx.persist('entries');
      ctx.rerender();
      actionToast(
        ctx,
        `Set ${changed} session(s) to ${typeById(typeId).name}${skipped ? ` — ${skipped} skipped (leave / not a person)` : ''}`
      );
    });

    bulkBtn('#bulkroomapply', async () => {
      const roomId = root.querySelector('#bulkroom').value || null;
      pushUndo(state);
      let changed = 0;
      for (const key of selected) {
        const { staffId, date, period } = parseKey(key);
        const entry = state.entries.find((e) => e.staffId === staffId && e.date === date && e.period === period);
        if (entry) {
          entry.roomId = roomId;
          changed += 1;
        }
      }
      await ctx.persist('entries');
      ctx.rerender();
      actionToast(ctx, `Room updated on ${changed} session(s)`);
    });

    bulkBtn('#bulkclear', async () => {
      pushUndo(state);
      const keys = new Set(selected);
      const before = state.entries.length;
      state.entries = state.entries.filter((e) => !keys.has(`${e.staffId}|${e.date}|${e.period}`));
      state.ui.selected = [];
      await ctx.persist('entries');
      ctx.rerender();
      actionToast(ctx, `Cleared ${before - state.entries.length} session(s)`);
    });

    bulkBtn('#bulkdeselect', () => {
      state.ui.selected = [];
      ctx.rerender();
    });

    /* ---- rooms pivot wiring ---- */
    if (mode === 'rooms') {
      wireRoomGrid(root, ctx, readOnly);
      return;
    }

    /* ---- cell wiring (staff mode only) ---- */
    if (mode !== 'staff') return;
    const cells = [...root.querySelectorAll('td.cell')];
    cells.forEach((cell, i) => {
      cell.tabIndex = i === 0 ? 0 : -1;

      cell.addEventListener('focus', () => {
        lastFocusedKey = cellKey(cell);
      });

      cell.addEventListener('click', (ev) => {
        // A rectangle sweep ends in a click; that click is not an edit.
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        const person = state.staff.find((p) => p.id === cell.dataset.staff);
        if (!person) return;
        lastFocusedKey = cellKey(cell);
        if (ev.shiftKey) {
          const key = cellKey(cell);
          const idx = selected.indexOf(key);
          if (idx >= 0) selected.splice(idx, 1);
          else selected.push(key);
          ctx.rerender();
          return;
        }
        // Selection is reading; the editor menu is not. Suppress the OPENER,
        // not just its styling — a menu that appears and then throws on every
        // button is worse than no menu.
        if (readOnly) return;
        openCellMenu(ctx, cell, person, cell.dataset.date, cell.dataset.period);
      });

      if (!readOnly)
        cell.addEventListener('contextmenu', (ev) => {
          const person = state.staff.find((p) => p.id === cell.dataset.staff);
          if (!person) return;
          ev.preventDefault();
          lastFocusedKey = cellKey(cell);
          cell.focus();
          openCellMenu(ctx, cell, person, cell.dataset.date, cell.dataset.period);
        });

      // Rectangle selection. Cells holding an entry stay draggable, so a sweep
      // may only start on an empty cell — unless Shift is held, in which case
      // the native drag is suppressed for this one gesture.
      cell.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        const hasEntry = Boolean(cell.dataset.entry);
        if (hasEntry && !ev.shiftKey) return;
        sweep = { anchor: cellKey(cell), last: cellKey(cell), moved: false, additive: ev.shiftKey, restoreDrag: null };
        if (hasEntry) {
          cell.draggable = false;
          sweep.restoreDrag = cell;
        }
        // Stops the browser turning the sweep into a text selection; focus is
        // then set by hand so the roving tabindex and paste anchor still follow.
        ev.preventDefault();
        cell.focus();
      });

      cell.addEventListener('keydown', async (ev) => {
        switch (ev.key) {
          case 'ArrowLeft':
            ev.preventDefault();
            moveFocus(root, cell, -1, 0);
            break;
          case 'ArrowRight':
            ev.preventDefault();
            moveFocus(root, cell, 1, 0);
            break;
          case 'ArrowUp':
            ev.preventDefault();
            moveFocus(root, cell, 0, -1);
            break;
          case 'ArrowDown':
            ev.preventDefault();
            moveFocus(root, cell, 0, 1);
            break;
          case 'Enter':
          case ' ': {
            if (readOnly) return;
            ev.preventDefault();
            const person = state.staff.find((p) => p.id === cell.dataset.staff);
            if (person) openCellMenu(ctx, cell, person, cell.dataset.date, cell.dataset.period);
            break;
          }
          case 'Delete':
          case 'Backspace': {
            if (readOnly) return;
            ev.preventDefault();
            const entry = state.entries.find(
              (e) =>
                e.staffId === cell.dataset.staff && e.date === cell.dataset.date && e.period === cell.dataset.period
            );
            if (!entry) return;
            pushUndo(state);
            state.entries = state.entries.filter((e) => e.id !== entry.id);
            await ctx.persist('entries');
            ctx.rerender();
            break;
          }
        }
      });

      // Drag & drop: move a session; drop on an occupied cell to swap;
      // Ctrl/Alt-drop copies the session type into an empty cell. Not wired at
      // all while read-only — the cells are also rendered without `draggable`,
      // so there is nothing to start a drag from either.
      if (readOnly) return;

      cell.addEventListener('dragstart', (ev) => {
        const entry = state.entries.find((e) => e.id === cell.dataset.entry);
        if (!entry) {
          ev.preventDefault();
          return;
        }
        closeMenu();
        ev.dataTransfer.setData('text/plain', entry.id);
        ev.dataTransfer.effectAllowed = 'copyMove';
        // Grey the cells this session could never land on, for the whole drag.
        markInvalidTargets(root, state);
      });
      cell.addEventListener('dragend', clearDragMarks);
      cell.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        if (cell.classList.contains('drop-invalid')) {
          ev.dataTransfer.dropEffect = 'none';
          cell.classList.add('dragover-bad');
          return;
        }
        const copying = ev.ctrlKey || ev.altKey || ev.metaKey;
        ev.dataTransfer.dropEffect = copying ? 'copy' : 'move';
        cell.classList.add('dragover');
        cell.classList.toggle('dragover-copy', copying);
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('dragover', 'dragover-bad', 'dragover-copy'));
      cell.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        clearDragMarks();
        const src = state.entries.find((e) => e.id === ev.dataTransfer.getData('text/plain'));
        if (!src) return;
        const { staff: staffId, date, period } = cell.dataset;
        if (src.staffId === staffId && src.date === date && src.period === period) return;
        const person = state.staff.find((p) => p.id === staffId);
        if (!person) return;
        // Backstop: the greying is only an affordance — this is the rule.
        const blocked = blockedReason(state, staffId, date);
        if (blocked) {
          ctx.toast(blocked);
          return;
        }
        const target = state.entries.find((e) => e.staffId === staffId && e.date === date && e.period === period);
        let what = 'Moved';
        if (ev.ctrlKey || ev.altKey || ev.metaKey) {
          if (target) {
            ctx.toast('Cannot copy onto an occupied session');
            return;
          }
          pushUndo(state);
          state.entries.push({
            id: uid(),
            staffId,
            date,
            period,
            typeId: src.typeId,
            status: 'planned',
            source: 'manual',
            note: '',
            roomId: null,
          });
          what = 'Copied';
        } else if (target) {
          pushUndo(state);
          const pos = { staffId: src.staffId, date: src.date, period: src.period };
          Object.assign(src, { staffId, date, period });
          Object.assign(target, pos);
          what = 'Swapped';
        } else {
          pushUndo(state);
          Object.assign(src, { staffId, date, period });
        }
        await ctx.persist('entries');
        ctx.rerender();
        actionToast(ctx, `${what} ✓`);
      });
    });
  },
};

/* ---- rooms pivot: click to reassign, drag within a column to move room ---- */
function wireRoomGrid(root, ctx, readOnly) {
  // Read-only: the pivot is still rendered and still readable, but nothing is
  // wired — no chip menu, no drag, no drop target.
  if (readOnly) return;
  const { state } = ctx;
  const entryOf = (el) => state.entries.find((e) => e.id === el.dataset.entry) || null;
  const sameColumn = (a, b) => a.dataset.date === b.dataset.date && a.dataset.period === b.dataset.period;

  const clearRoomMarks = () => {
    for (const td of root.querySelectorAll('td.cell')) {
      td.classList.remove('drop-invalid', 'dragover', 'dragover-bad');
    }
  };

  for (const chip of root.querySelectorAll('.roomchip')) {
    chip.addEventListener('click', (ev) => {
      const entry = entryOf(chip);
      if (!entry) return;
      ev.stopPropagation();
      openRoomMenu(ctx, chip, entry);
    });
    chip.addEventListener('dragstart', (ev) => {
      const entry = entryOf(chip);
      if (!entry) {
        ev.preventDefault();
        return;
      }
      closeMenu();
      ev.dataTransfer.setData('text/plain', entry.id);
      ev.dataTransfer.effectAllowed = 'move';
      // A session cannot change day or period by changing room, so every cell
      // outside its own column is greyed for the duration of the drag.
      const home = chip.closest('td.cell');
      for (const td of root.querySelectorAll('td.cell')) {
        if (!home || !sameColumn(home, td)) td.classList.add('drop-invalid');
      }
    });
    chip.addEventListener('dragend', clearRoomMarks);
  }

  for (const td of root.querySelectorAll('td.cell')) {
    td.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      if (td.classList.contains('drop-invalid')) {
        ev.dataTransfer.dropEffect = 'none';
        td.classList.add('dragover-bad');
        return;
      }
      ev.dataTransfer.dropEffect = 'move';
      td.classList.add('dragover');
    });
    td.addEventListener('dragleave', () => td.classList.remove('dragover', 'dragover-bad'));
    td.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      clearRoomMarks();
      const entry = state.entries.find((e) => e.id === ev.dataTransfer.getData('text/plain'));
      if (!entry) return;
      if (entry.date !== td.dataset.date || entry.period !== td.dataset.period) {
        ctx.toast('Drop into the same day and session — changing room cannot move a session in time');
        return;
      }
      const roomId = td.dataset.room || null;
      if ((entry.roomId || null) === roomId) return;
      pushUndo(state);
      entry.roomId = roomId;
      await ctx.persist('entries');
      ctx.rerender();
      const room = (state.rooms || []).find((r) => r.id === roomId);
      actionToast(ctx, room ? `Moved to ${room.name} ✓` : 'Room cleared ✓');
    });
  }
}

/* ---- shortcuts strip ---- */
function shortcutsStrip(mode, readOnly) {
  // Read-only advertises only the gestures that still do something. Listing
  // "Ctrl+Z undo" on a grid that refuses to undo is a small lie that costs a
  // support call.
  const gestures = readOnly
    ? [
        ['drag empty cell', 'select block'],
        ['Shift + click', 'add to selection'],
        ['Ctrl + C', 'copy block'],
        ['← ↑ → ↓', 'navigate'],
      ]
    : mode === 'staff'
      ? [
          ['drag', 'move session'],
          ['Ctrl + drag', 'copy'],
          ['drag empty cell', 'select block'],
          ['Shift + click', 'add to selection'],
          ['Ctrl + C / V', 'copy / paste block'],
          ['Ctrl + Z / Y', 'undo / redo'],
          ['Del', 'clear session'],
          ['← ↑ → ↓', 'navigate'],
          ['right-click', 'cell menu'],
        ]
      : [
          ['click chip', 'reassign room'],
          ['drag chip', 'move room (same day + session)'],
          ['Ctrl + Z / Y', 'undo / redo'],
        ];
  return `
    <div class="rota-shortcuts">
      ${gestures.map(([k, what]) => `<span><kbd>${esc(k)}</kbd> ${esc(what)}</span>`).join('<i aria-hidden="true">·</i>')}
      <button id="shortcuts-dismiss" class="small" title="Hide shortcuts" aria-label="Hide shortcuts">×</button>
    </div>
  `;
}

/* ---- staff × day grid ---- */
function staffGrid(state, people, showDates, dates, today, selected, readOnly) {
  const s = state.settings;
  const bh = s.bankHolidays || [];
  const P = periodsFor(s);
  return `
    <table class="rota">
      <thead>
        <tr>
          <th rowspan="2">Staff</th>
          ${showDates.map((d) => `<th colspan="${P.length}" class="day${d === today ? ' today' : ''}">${esc(fmtDay(d))}${bh.includes(d) ? ' <span class="pill requested">BH</span>' : ''}</th>`).join('')}
          <th rowspan="2" title="Sessions rostered this week / contracted per week">Σ</th>
        </tr>
        <tr>${showDates.map((d) => P.map((p) => `<th class="${d === today ? 'today' : ''}">${PERIOD_INFO[p].label}</th>`).join('')).join('')}</tr>
      </thead>
      <tbody>
        ${people
          .map((p) => {
            const rostered = state.entries.filter(
              (e) => e.staffId === p.id && dates.includes(e.date) && ACTIVE.includes(e.status)
            ).length;
            const over = p.contractedSessions > 0 && rostered > p.contractedSessions;
            return `
          <tr>
            <td class="staffname">${staffLabel(p)}</td>
            ${showDates
              .map((d) => {
                const onLeave = approvedLeaveFor(state.leave, p.id, d);
                return P.map((period) => {
                  const entry = state.entries.find((e) => e.staffId === p.id && e.date === d && e.period === period);
                  const room = entry && entry.roomId ? (state.rooms || []).find((r) => r.id === entry.roomId) : null;
                  const extra = entry ? [room && room.name, entry.note].filter(Boolean).join(' — ') : '';
                  let inner;
                  if (entry && entry.status === 'vacancy') inner = typeChip(entry.typeId, 'vacancy', extra);
                  else if (onLeave) inner = leaveChip(onLeave);
                  else if (entry) inner = typeChip(entry.typeId, entry.status, extra);
                  else inner = '<span class="empty">·</span>';
                  if (entry && !onLeave && (room || entry.note)) {
                    inner += `<div class="roomtag">${esc(room ? room.name : '')}${entry.note ? (room ? ' ' : '') + '✎' : ''}</div>`;
                  }
                  const isSelected = selected.includes(`${p.id}|${d}|${period}`);
                  // data-entry stays even when read-only (the sweep and the
                  // cell wiring both read it); only `draggable` is dropped, so
                  // there is no drag affordance offered that cannot complete.
                  return `<td class="cell${d === today ? ' today' : ''}${isSelected ? ' selected' : ''}"${entry ? `${readOnly ? '' : ' draggable="true"'} data-entry="${esc(entry.id)}"` : ''} data-staff="${esc(p.id)}" data-date="${esc(d)}" data-period="${period}">${inner}</td>`;
                }).join('');
              })
              .join('')}
            <td class="right${over ? ' overdrawn' : rostered < p.contractedSessions ? ' muted' : ''}" title="${rostered} rostered / ${esc(String(p.contractedSessions))} contracted">${rostered}/${esc(String(p.contractedSessions))}</td>
          </tr>
        `;
          })
          .join('')}
        ${people.length ? '' : `<tr><td colspan="99" class="muted">No staff yet — add your team under Staff, or load the demo dataset from Settings.</td></tr>`}
      </tbody>
      ${
        people.length
          ? `
      <tfoot>
        <tr>
          <th>Clinical on site</th>
          ${showDates
            .map((d) =>
              P.map((period) => {
                const present = state.entries.filter((e) => {
                  if (e.date !== d || e.period !== period) return false;
                  if (!ACTIVE.includes(e.status)) return false;
                  const t = typeById(e.typeId);
                  if (!t || !t.clinical) return false;
                  const person = state.staff.find((x) => x.id === e.staffId);
                  return person && !approvedLeaveFor(state.leave, person.id, d);
                });
                const duty = present.some((e) => {
                  const person = state.staff.find((x) => x.id === e.staffId);
                  return e.typeId === 'duty' && person && person.dutyEligible;
                });
                if (!s.openDays.includes(dayKey(d))) return '<th class="muted">—</th>';
                return `<th title="${present.length} clinical staff, duty ${duty ? 'covered' : 'NOT covered'}"><span class="${duty ? 'ok-mark' : 'bad-mark'}">${present.length} ${duty ? 'OK' : 'Gap'}</span></th>`;
              }).join('')
            )
            .join('')}
          <th></th>
        </tr>
      </tfoot>`
          : ''
      }
    </table>
  `;
}

/* ---- rooms × day pivot ---- */
function roomGrid(state, rooms, showDates, today, readOnly) {
  const P = periodsFor(state.settings);
  const rows = [...rooms, { id: null, name: 'Unassigned' }];
  const occupants = (roomId, date, period) =>
    state.entries.filter((e) => {
      if (e.date !== date || e.period !== period || !ACTIVE.includes(e.status)) return false;
      if (roomId) return e.roomId === roomId;
      const t = typeById(e.typeId);
      return !e.roomId && t && t.clinical && t.buildsClinic; // unassigned row: clinic sessions that need a room
    });
  return `
    <table class="rota">
      <thead>
        <tr>
          <th rowspan="2">Room</th>
          ${showDates.map((d) => `<th colspan="${P.length}" class="day${d === today ? ' today' : ''}">${esc(fmtDay(d))}</th>`).join('')}
        </tr>
        <tr>${showDates.map((d) => P.map((p) => `<th class="${d === today ? 'today' : ''}">${PERIOD_INFO[p].label}</th>`).join('')).join('')}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (room) => `
          <tr>
            <td class="staffname">${esc(room.name)}</td>
            ${showDates
              .map((d) =>
                P.map((period) => {
                  const here = occupants(room.id, d, period);
                  const chips = here
                    .map((e) => {
                      const person = state.staff.find((p) => p.id === e.staffId);
                      const t = typeById(e.typeId);
                      if (!person || !t) return '';
                      const tip = readOnly
                        ? `${person.name} — ${t.name}`
                        : `${person.name} — ${t.name} — click to reassign, drag to another room`;
                      return `<span class="chip roomchip"${readOnly ? '' : ' draggable="true"'} data-entry="${esc(e.id)}" style="background:${esc(t.colour)}" title="${esc(tip)}">${esc(shortName(person.name))}</span>`;
                    })
                    .join(' ');
                  const clash = room.id && here.length > 1;
                  return `<td class="cell${d === today ? ' today' : ''}" data-room="${esc(room.id || '')}" data-date="${esc(d)}" data-period="${esc(period)}" style="text-align:center;${clash ? 'box-shadow:inset 0 0 0 2px var(--high)' : ''}">${chips || '<span class="empty">·</span>'}</td>`;
                }).join('')
              )
              .join('')}
          </tr>
        `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

/* ---- solve panel ---- */
function solvePanel(state) {
  const result = state.ui.solveResult;
  return `
    <div class="card" id="solvepanel">
      <h2 class="mt0">Solve rota</h2>
      <div class="formgrid">
        <label class="field">Horizon (weeks)
          <select id="sv-weeks">
            ${[1, 2, 4, 8].map((n) => `<option value="${n}" ${n === 4 ? 'selected' : ''}>${esc(String(n))} week${n > 1 ? 's' : ''}</option>`).join('')}
          </select>
        </label>
        <label class="field">Max duty / week<input id="sv-cap" type="number" min="1" max="10" value="2"></label>
        <label class="field">Effort
          <select id="sv-effort">
            <option value="3000">Quick (3 000 iterations)</option>
            <option value="8000" selected>Standard (8 000 iterations)</option>
            <option value="20000">Thorough (20 000 iterations)</option>
          </select>
        </label>
      </div>
      <div class="toolbar mt8">
        <button id="sv-run" class="primary">Run</button>
      </div>
      ${
        result
          ? `
        <div class="mt12">
          <div class="sub mb8">
            Score ${esc(String(result.score.before))} → ${esc(String(result.score.after))} &middot; ${esc(String(result.changes.length))} change(s)
          </div>
          ${
            result.changes.length
              ? `
            <table>
              <thead><tr><th>Staff</th><th>Day</th><th>Period</th><th>Change</th></tr></thead>
              <tbody>
                ${result.changes
                  .map((c) => {
                    const person = state.staff.find((p) => p.id === c.staffId);
                    return `<tr>
                    <td>${esc(person ? person.name : c.staffId)}</td>
                    <td>${esc(fmtDay(c.date))}</td>
                    <td>${esc(c.period.toUpperCase())}</td>
                    <td>${typeChip(c.from)} ⇢ ${typeChip(c.to)}</td>
                  </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          `
              : '<div class="muted">No changes — rota is already optimal.</div>'
          }
          ${
            result.roomChanges && result.roomChanges.length
              ? `
            <div class="sub mt8 mb8">Room moves to resolve clashes</div>
            <table>
              <thead><tr><th>Staff</th><th>Day</th><th>Period</th><th>Room</th></tr></thead>
              <tbody>
                ${result.roomChanges
                  .map((c) => {
                    const person = state.staff.find((p) => p.id === c.staffId);
                    const roomName = (id) => {
                      const r = (state.rooms || []).find((x) => x.id === id);
                      return r ? r.name : id || '—';
                    };
                    return `<tr>
                    <td>${esc(person ? person.name : c.staffId)}</td>
                    <td>${esc(fmtDay(c.date))}</td>
                    <td>${esc(c.period.toUpperCase())}</td>
                    <td>${esc(roomName(c.from))} ⇢ ${esc(roomName(c.to))}</td>
                  </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>
          `
              : ''
          }
          ${
            result.explain && result.explain.some((d) => d.score > 0)
              ? `
            <div class="sub mt8">Remaining score by dimension: ${result.explain
              .filter((d) => d.score > 0)
              .map((d) => `${esc(d.label)} ${esc(String(d.score))}`)
              .join(' · ')}</div>
          `
              : ''
          }
          ${
            result.unresolved && result.unresolved.length
              ? `
            <div class="mt8">
              ${warnHTML(result.unresolved.map((u) => ({ severity: 'medium', message: u.message })))}
            </div>
          `
              : ''
          }
          <div class="toolbar mt8">
            <button id="sv-apply" class="primary" ${result.changes.length || (result.roomChanges && result.roomChanges.length) ? '' : 'disabled'}>Apply</button>
            <button id="sv-discard">Discard</button>
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;
}
