// My week — the self-service view. A clinician identifies themselves once,
// then sees their upcoming sessions, leave balances, can submit leave
// requests and propose shift swaps with colleagues. Managers approve
// swaps from the Dashboard.

import { esc } from '../../shared/esc.js';
import { todayISO, addDays, fmtDay, fmtRange } from '../../shared/time.js';
import { typeById, LEAVE_TYPES, leaveTypeById } from '../../shared/model.js';
import { uid } from '../../shared/store.js';
import { leaveBalance, checkLeaveRequest } from '../../engine/leave.js';
import { validateSwap } from '../../engine/swaps.js';
import { staffICS } from '../../engine/ics.js';
import { staffSorted, download, warnHTML } from './ui.js';

const ACTIVE = ['planned', 'confirmed', 'covered'];

export default {
  render(root, ctx) {
    const { state } = ctx;
    const today = todayISO();
    const horizon = addDays(today, 13);
    const meStaff = state.staff.find((s) => s.id === state.settings.userStaffId);

    if (!meStaff) {
      root.innerHTML = `
        <h1>My week</h1>
        <div class="card">
          <h2 class="mt0">Who are you?</h2>
          <p class="sub">Pick yourself once on this machine — your sessions, balances and swap requests live here.</p>
          <div class="toolbar">
            <select id="whoami">${staffSorted(state.staff.filter((p) => !p.notAPerson))
              .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
              .join('')}</select>
            <button id="saveme" class="primary" ${state.staff.length ? '' : 'disabled'}>That's me</button>
          </div>
          ${state.staff.length ? '' : '<div class="muted">No staff yet — set the practice up first (Staff page or demo data in Settings).</div>'}
        </div>`;
      const btn = root.querySelector('#saveme');
      if (btn)
        btn.onclick = async () => {
          const person = state.staff.find((p) => p.id === root.querySelector('#whoami').value);
          if (!person) return;
          state.settings.userStaffId = person.id;
          if (!state.settings.userName) state.settings.userName = person.name;
          await ctx.persist('settings');
          ctx.rerender();
        };
      return;
    }

    const mySessions = state.entries
      .filter((e) => e.staffId === meStaff.id && e.date >= today && e.date <= horizon && e.status !== 'cancelled')
      .sort((a, b) => `${a.date}${a.period}`.localeCompare(`${b.date}${b.period}`));
    const al = leaveBalance(meStaff, state.leave, 'annual', today);
    const sl = leaveBalance(meStaff, state.leave, 'study', today);
    const mySwaps = state.swaps
      .filter((s) => s.proposedBy === meStaff.id)
      .slice(-10)
      .reverse();
    const myLeave = state.leave
      .filter((l) => l.staffId === meStaff.id)
      .slice(-8)
      .reverse();

    const colleagues = staffSorted(state.staff.filter((p) => p.id !== meStaff.id && !p.notAPerson));
    const swappable = (staffId) =>
      state.entries
        .filter(
          (e) => e.staffId === staffId && e.date >= today && e.date <= addDays(today, 27) && ACTIVE.includes(e.status)
        )
        .sort((a, b) => `${a.date}${a.period}`.localeCompare(`${b.date}${b.period}`));
    const entryLabel = (e) => {
      const t = typeById(e.typeId);
      return `${fmtDay(e.date)} ${e.period.toUpperCase()} — ${t ? t.name : e.typeId}`;
    };

    root.innerHTML = `
      <h1>My week — ${esc(meStaff.name)} <button id="notme" class="small" style="vertical-align:middle">Switch user</button></h1>
      <div class="cards">
        <div class="card"><div class="kpi">${mySessions.length}</div><div class="sub">Sessions in the next 14 days</div></div>
        <div class="card"><div class="kpi">${al.remaining}</div><div class="sub">Annual leave sessions remaining (of ${al.entitled})</div></div>
        <div class="card"><div class="kpi">${sl.remaining}</div><div class="sub">Study leave sessions remaining (of ${sl.entitled})</div></div>
      </div>

      <div class="card">
        <h2 class="mt0">Coming up <button id="myics" class="small">Export .ics</button></h2>
        ${
          mySessions.length
            ? `<table>
          <thead><tr><th>When</th><th>Session</th><th>Room</th><th>Note</th></tr></thead>
          <tbody>${mySessions
            .map((e) => {
              const t = typeById(e.typeId);
              const room = (state.rooms || []).find((r) => r.id === e.roomId);
              return `<tr><td>${esc(fmtDay(e.date))} ${e.period.toUpperCase()}</td>
              <td><span class="chip" style="background:${esc(t ? t.colour : '#64748b')}">${esc(t ? t.short : '?')}</span> ${esc(t ? t.name : e.typeId)}${e.status === 'covered' ? ' <span class="pill approved">covered</span>' : ''}</td>
              <td>${esc(room ? room.name : '—')}</td><td class="sub">${esc(e.note || '')}</td></tr>`;
            })
            .join('')}</tbody>
        </table>`
            : '<div class="muted">Nothing rostered in the next two weeks.</div>'
        }
      </div>

      <div class="card">
        <h2 class="mt0">Request leave</h2>
        <div class="toolbar">
          <select id="ml-type">${LEAVE_TYPES.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
          <input id="ml-start" type="date" value="${esc(today)}">
          <input id="ml-end" type="date" value="${esc(today)}">
          <input id="ml-note" placeholder="note (optional)" style="width:160px">
          <button id="ml-submit" class="primary">Submit request</button>
        </div>
        ${
          myLeave.length
            ? `<table class="mt8">
          <thead><tr><th>Type</th><th>Dates</th><th>Sessions</th><th>Status</th></tr></thead>
          <tbody>${myLeave
            .map(
              (l) => `<tr><td>${esc((leaveTypeById(l.type) || {}).name || l.type)}</td>
            <td>${esc(fmtRange(l.startDate, l.endDate))}</td><td>${esc(String(l.sessions ?? '—'))}</td>
            <td><span class="pill ${esc(l.status)}">${esc(l.status)}</span></td></tr>`
            )
            .join('')}</tbody>
        </table>`
            : ''
        }
      </div>

      <div class="card">
        <h2 class="mt0">Propose a swap</h2>
        <p class="sub">Trade one of your sessions with a colleague's — the manager approves it from the Dashboard.</p>
        <div class="toolbar">
          <select id="sw-mine" style="max-width:260px">
            ${swappable(meStaff.id)
              .map((e) => `<option value="${esc(e.id)}">${esc(entryLabel(e))}</option>`)
              .join('')}
          </select>
          <span>⇄</span>
          <select id="sw-who" style="max-width:180px">
            ${colleagues.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
          </select>
          <select id="sw-theirs" style="max-width:260px"></select>
          <button id="sw-submit" class="primary">Propose</button>
        </div>
        <div id="sw-check"></div>
        ${
          mySwaps.length
            ? `<table class="mt8">
          <thead><tr><th>Mine</th><th>Theirs</th><th>Status</th></tr></thead>
          <tbody>${mySwaps
            .map((s) => {
              const a = state.entries.find((e) => e.id === s.entryAId);
              const b = state.entries.find((e) => e.id === s.entryBId);
              const other = state.staff.find(
                (p) => b && p.id === (s.status === 'approved' ? a && a.staffId : b.staffId)
              );
              return `<tr><td>${a ? esc(entryLabel(a)) : '—'}</td>
              <td>${b ? `${esc(entryLabel(b))}${other ? ` (${esc(other.name)})` : ''}` : '—'}</td>
              <td><span class="pill ${esc(s.status)}">${esc(s.status)}</span></td></tr>`;
            })
            .join('')}</tbody>
        </table>`
            : ''
        }
      </div>
    `;

    root.querySelector('#notme').onclick = async () => {
      state.settings.userStaffId = null;
      await ctx.persist('settings');
      ctx.rerender();
    };

    root.querySelector('#myics').onclick = () => {
      const slug = meStaff.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      download(
        `rota-${slug}.ics`,
        staffICS({ person: meStaff, entries: state.entries, rooms: state.rooms || [] }),
        'text/calendar'
      );
      ctx.toast('Calendar exported');
    };

    root.querySelector('#ml-submit').onclick = async () => {
      const req = {
        id: uid(),
        staffId: meStaff.id,
        type: root.querySelector('#ml-type').value,
        startDate: root.querySelector('#ml-start').value,
        endDate: root.querySelector('#ml-end').value,
        note: root.querySelector('#ml-note').value.trim(),
        status: 'requested',
        createdAt: new Date().toISOString(),
      };
      if (!req.startDate || !req.endDate || req.endDate < req.startDate) {
        ctx.toast('Check the dates');
        return;
      }
      const check = checkLeaveRequest(req, {
        staff: state.staff,
        leaveList: state.leave,
        entries: state.entries,
        settings: state.settings,
      });
      req.sessions = check.sessions;
      state.leave.push(req);
      await ctx.persist('leave');
      await ctx.log(
        `${meStaff.name} requested ${req.type} leave ${req.startDate} – ${req.endDate} (${req.sessions} sessions)`
      );
      ctx.toast(
        `Request submitted — ${check.warnings.length ? `${check.warnings.length} clash warning(s) for the manager` : 'no clashes'}`
      );
      ctx.rerender();
    };

    // Swap form: refresh the colleague's session list when they change.
    const whoSel = root.querySelector('#sw-who');
    const theirsSel = root.querySelector('#sw-theirs');
    const fillTheirs = () => {
      theirsSel.innerHTML =
        swappable(whoSel.value)
          .map((e) => `<option value="${esc(e.id)}">${esc(entryLabel(e))}</option>`)
          .join('') || '<option value="">no upcoming sessions</option>';
    };
    if (whoSel) {
      whoSel.onchange = fillTheirs;
      fillTheirs();
    }

    const swBtn = root.querySelector('#sw-submit');
    if (swBtn)
      swBtn.onclick = async () => {
        const entryA = state.entries.find((e) => e.id === root.querySelector('#sw-mine').value);
        const entryB = state.entries.find((e) => e.id === theirsSel.value);
        const errors = validateSwap({ entryA, entryB, staff: state.staff, leaveList: state.leave });
        const box = root.querySelector('#sw-check');
        if (errors.length) {
          box.innerHTML = warnHTML(errors.map((m) => ({ severity: 'high', message: m })));
          return;
        }
        state.swaps.push({
          id: uid(),
          entryAId: entryA.id,
          entryBId: entryB.id,
          proposedBy: meStaff.id,
          status: 'requested',
          createdAt: new Date().toISOString(),
        });
        await ctx.persist('swaps');
        await ctx.log(
          `${meStaff.name} proposed a swap: ${entryA.date} ${entryA.period.toUpperCase()} ⇄ ${entryB.date} ${entryB.period.toUpperCase()}`
        );
        ctx.toast('Swap proposed — awaiting manager approval');
        ctx.rerender();
      };
  },
};
