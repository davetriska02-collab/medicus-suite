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

const ACTIVE = ['planned', 'confirmed', 'covered'];
let activeCtx = null;

/* ---- undo ---- */
function pushUndo(state) {
  const stack = state.ui.undoStack || (state.ui.undoStack = []);
  stack.push(JSON.stringify(state.entries));
  if (stack.length > 30) stack.shift();
}

async function undo(ctx) {
  const stack = ctx.state.ui.undoStack || [];
  const snapshot = stack.pop();
  if (!snapshot) {
    ctx.toast('Nothing to undo');
    return;
  }
  ctx.state.entries = JSON.parse(snapshot);
  await ctx.persist('entries');
  ctx.toast('Undone');
  ctx.rerender();
}

/* ---- cell editor menu ---- */
function closeMenu() {
  const m = document.getElementById('cellmenu');
  if (m) m.remove();
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
    ${entry && entry.status === 'vacancy' ? '<button data-act="covered"><span class="chip covered" style="background:#059669">LOC</span>Mark covered (locum)</button>' : ''}
    ${entry ? '<button data-act="clear"><span class="chip" style="background:#94a3b8">×</span>Clear session</button>' : ''}
  `;
  document.body.appendChild(menu);
  const r = cell.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 12)}px`;
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 12)}px`;

  menu.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
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

document.addEventListener('click', (ev) => {
  if (!ev.target.closest('#cellmenu') && !ev.target.closest('td.cell')) closeMenu();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeMenu();
  if (!activeCtx) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
    if (location.hash !== '#rota') return;
    if (ev.target.closest('input, select, textarea')) return;
    ev.preventDefault();
    undo(activeCtx);
  }
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
    const s = state.settings;
    const mode = state.ui.rotaMode || 'staff';
    const selected = state.ui.selected || (state.ui.selected = []);
    const undoStack = state.ui.undoStack || [];
    const rooms = state.rooms || [];
    const dates = weekDates(state.weekMonday);
    const today = todayISO();
    const showDates = dates.filter((d) => s.openDays.includes(dayKey(d)) || state.entries.some((e) => e.date === d));
    const sites = (s.sites || []).filter(Boolean);
    const siteFilter = state.ui.siteFilter || '';
    const people = staffSorted(state.staff).filter(
      (p) => !p.notAPerson && (!siteFilter || (p.site || sites[0]) === siteFilter)
    );

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
        <button id="undobtn" ${undoStack.length ? '' : 'disabled'} title="Ctrl+Z">↶ Undo</button>
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
        </details>
      </div>
      ${
        mode === 'staff' && selected.length
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
      ${state.ui.solvePanel && mode === 'staff' ? solvePanel(state) : ''}
      <div class="rotawrap">
        ${mode === 'staff' ? staffGrid(state, people, showDates, dates, today, selected) : roomGrid(state, rooms, showDates, today)}
      </div>
      <div class="sub" style="margin:6px 0 14px">
        ${
          mode === 'staff'
            ? `Click to edit · Shift-click to multi-select · drag to move · Ctrl+Z to undo.
             <details style="display:inline"><summary>More shortcuts</summary>
               Drop on occupied = swap · Ctrl-drop = copy · arrows + Enter to navigate · Delete to clear
             </details>`
            : 'Rooms view: who is in each room per session. Assign rooms from the Staff view cell menu. The Unassigned row shows clinical sessions with no room.'
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
    root.querySelector('#undobtn').onclick = () => undo(ctx);

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

    root.querySelector('#copyweek').onclick = async () => {
      const prevDates = weekDates(addDays(state.weekMonday, -7));
      pushUndo(state);
      let copied = 0;
      let skipped = 0;
      const source = state.entries.filter((e) => prevDates.includes(e.date) && ACTIVE.includes(e.status));
      for (const e of source) {
        const date = addDays(e.date, 7);
        const occupied = state.entries.some((t) => t.staffId === e.staffId && t.date === date && t.period === e.period);
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

    root.querySelector('#generate').onclick = async () => {
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

    root.querySelector('#autoduty').onclick = async () => {
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

    root.querySelector('#solvebtn').onclick = () => {
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
        if (!result || !result.changes.length) return;
        const weeks = Number(root.querySelector('#sv-weeks').value) || 4;
        pushUndo(state);
        for (const change of result.changes) {
          const entry = state.entries.find((e) => e.id === change.entryId);
          if (entry) {
            entry.typeId = change.to;
            entry.source = 'solver';
          }
        }
        await ctx.persist('entries');
        await ctx.log(`Solver applied ${result.changes.length} change(s) over ${weeks} week(s)`);
        ctx.toast(`Solver applied ${result.changes.length} change(s) over ${weeks} week(s)`);
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
      for (const key of selected) {
        const { staffId, date, period } = parseKey(key);
        if (approvedLeaveFor(state.leave, staffId, date)) continue;
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
      ctx.toast(`Set ${changed} session(s) to ${typeById(typeId).name}`);
      ctx.rerender();
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
      ctx.toast(`Room updated on ${changed} session(s)`);
      ctx.rerender();
    });

    bulkBtn('#bulkclear', async () => {
      pushUndo(state);
      const keys = new Set(selected);
      const before = state.entries.length;
      state.entries = state.entries.filter((e) => !keys.has(`${e.staffId}|${e.date}|${e.period}`));
      state.ui.selected = [];
      await ctx.persist('entries');
      ctx.toast(`Cleared ${before - state.entries.length} session(s)`);
      ctx.rerender();
    });

    bulkBtn('#bulkdeselect', () => {
      state.ui.selected = [];
      ctx.rerender();
    });

    /* ---- cell wiring (staff mode only) ---- */
    if (mode !== 'staff') return;
    const cells = [...root.querySelectorAll('td.cell')];
    cells.forEach((cell, i) => {
      cell.tabIndex = i === 0 ? 0 : -1;

      cell.addEventListener('click', (ev) => {
        const person = state.staff.find((p) => p.id === cell.dataset.staff);
        if (!person) return;
        if (ev.shiftKey) {
          const key = cellKey(cell);
          const idx = selected.indexOf(key);
          if (idx >= 0) selected.splice(idx, 1);
          else selected.push(key);
          ctx.rerender();
          return;
        }
        openCellMenu(ctx, cell, person, cell.dataset.date, cell.dataset.period);
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
            ev.preventDefault();
            const person = state.staff.find((p) => p.id === cell.dataset.staff);
            if (person) openCellMenu(ctx, cell, person, cell.dataset.date, cell.dataset.period);
            break;
          }
          case 'Delete':
          case 'Backspace': {
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
      // Ctrl/Alt-drop copies the session type into an empty cell.
      cell.addEventListener('dragstart', (ev) => {
        const entry = state.entries.find(
          (e) => e.staffId === cell.dataset.staff && e.date === cell.dataset.date && e.period === cell.dataset.period
        );
        if (!entry) {
          ev.preventDefault();
          return;
        }
        closeMenu();
        ev.dataTransfer.setData('text/plain', entry.id);
        ev.dataTransfer.effectAllowed = 'copyMove';
      });
      cell.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        cell.classList.add('dragover');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('dragover'));
      cell.addEventListener('drop', async (ev) => {
        ev.preventDefault();
        cell.classList.remove('dragover');
        const src = state.entries.find((e) => e.id === ev.dataTransfer.getData('text/plain'));
        if (!src) return;
        const { staff: staffId, date, period } = cell.dataset;
        if (src.staffId === staffId && src.date === date && src.period === period) return;
        const person = state.staff.find((p) => p.id === staffId);
        if (!person) return;
        if (approvedLeaveFor(state.leave, staffId, date)) {
          ctx.toast(`${person.name} is on approved leave that day`);
          return;
        }
        const target = state.entries.find((e) => e.staffId === staffId && e.date === date && e.period === period);
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
        } else if (target) {
          pushUndo(state);
          const pos = { staffId: src.staffId, date: src.date, period: src.period };
          Object.assign(src, { staffId, date, period });
          Object.assign(target, pos);
        } else {
          pushUndo(state);
          Object.assign(src, { staffId, date, period });
        }
        await ctx.persist('entries');
        ctx.rerender();
      });
    });
  },
};

/* ---- staff × day grid ---- */
function staffGrid(state, people, showDates, dates, today, selected) {
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
                  return `<td class="cell${d === today ? ' today' : ''}${isSelected ? ' selected' : ''}"${entry ? ' draggable="true"' : ''} data-staff="${esc(p.id)}" data-date="${esc(d)}" data-period="${period}">${inner}</td>`;
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
function roomGrid(state, rooms, showDates, today) {
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
                      return `<span class="chip" style="background:${esc(t.colour)}" title="${esc(`${person.name} — ${t.name}`)}">${esc(shortName(person.name))}</span>`;
                    })
                    .join(' ');
                  const clash = room.id && here.length > 1;
                  return `<td class="${d === today ? 'today' : ''}" style="text-align:center;${clash ? 'box-shadow:inset 0 0 0 2px var(--high)' : ''}">${chips || '<span class="empty">·</span>'}</td>`;
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
            result.unresolved && result.unresolved.length
              ? `
            <div class="mt8">
              ${warnHTML(result.unresolved.map((u) => ({ severity: 'medium', message: u.message })))}
            </div>
          `
              : ''
          }
          <div class="toolbar mt8">
            <button id="sv-apply" class="primary" ${result.changes.length ? '' : 'disabled'}>Apply</button>
            <button id="sv-discard">Discard</button>
          </div>
        </div>
      `
          : ''
      }
    </div>
  `;
}
