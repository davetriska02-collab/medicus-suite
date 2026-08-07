// Leave management: balances in sessions, requests with instant guardrail
// checks (entitlement, simultaneous-absence caps, duty/cover impact), and
// approval that punches the rota out into a cover worklist.

import { esc } from '../../shared/esc.js';
import { LEAVE_TYPES, leaveTypeById } from '../../shared/model.js';
import { uid } from '../../shared/store.js';
import { todayISO, fmtRange } from '../../shared/time.js';
import {
  leaveBalance,
  checkLeaveRequest,
  applyApprovedLeave,
  sfeReimbursementFlags,
  fitNoteFlags,
  toilBalance,
} from '../../engine/leave.js';
import { bradfordRows } from '../../engine/bradford.js';
import { addDays } from '../../shared/time.js';
import { staffSorted, warnHTML } from './ui.js';

export default {
  render(root, ctx) {
    const { state } = ctx;
    const people = staffSorted(state.staff.filter((p) => !p.notAPerson));
    const sfe = sfeReimbursementFlags(state.leave, state.staff);
    const fitFlags = fitNoteFlags(state.leave, state.staff);
    const recentSick = state.leave
      .filter((l) => l.type === 'sick' && l.status === 'approved' && l.endDate >= addDays(todayISO(), -30))
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
    const bradford = bradfordRows({ staff: state.staff, leaveList: state.leave, settings: state.settings });
    const requested = state.leave.filter((l) => l.status === 'requested');
    const decided = state.leave
      .filter((l) => l.status !== 'requested')
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .slice(0, 30);

    root.innerHTML = `
      <h1>Leave</h1>
      ${
        sfe.length || fitFlags.length || recentSick.length || bradford.length
          ? `
        <div class="card">
          <h2 class="mt0">Sickness</h2>
          ${sfe
            .map(
              (f) => `<div class="warn"><span class="sev ${f.eligible ? 'high' : 'medium'}">SFE</span>
            <span>${esc(f.name)} — sickness day ${f.days}${f.eligible ? ': locum cover is reimbursable from week 3 under the SFE' : ': reimbursement threshold (14 days) approaching'}</span></div>`
            )
            .join('')}
          ${fitFlags.map((f) => `<div class="warn"><span class="sev ${esc(f.severity)}">fit note</span><span>${esc(f.message)}</span></div>`).join('')}
          ${
            recentSick.length
              ? `
            <table style="margin-top:10px">
              <thead><tr><th>Staff</th><th>Episode</th><th>Fit note until</th><th>RTW done</th></tr></thead>
              <tbody>
                ${recentSick
                  .map((l) => {
                    const p = state.staff.find((s) => s.id === l.staffId);
                    return `<tr>
                    <td>${esc(p ? p.name : '?')}</td>
                    <td>${esc(fmtRange(l.startDate, l.endDate))}</td>
                    <td><input type="date" data-fitnote="${esc(l.id)}" value="${esc(l.fitNoteUntil || '')}"></td>
                    <td><input type="checkbox" data-rtw="${esc(l.id)}" ${l.rtwDone ? 'checked' : ''}></td>
                  </tr>`;
                  })
                  .join('')}
              </tbody>
            </table>`
              : ''
          }
          ${
            bradford.length
              ? `
            <h2>Bradford Factor (rolling 52 weeks)</h2>
            <table>
              <thead><tr><th>Staff</th><th>Episodes</th><th>Working days</th><th>Score (S²×D)</th><th>Band</th></tr></thead>
              <tbody>
                ${bradford
                  .map(
                    (r) => `<tr><td>${esc(r.name)}</td><td>${r.episodes}</td><td>${r.days}</td><td>${r.score}</td>
                  <td><span class="pill bf-${esc(r.band)}">${esc(r.band)}</span></td></tr>`
                  )
                  .join('')}
              </tbody>
            </table>
            <div class="sub mt8">Thresholds (Settings): monitor ≥ ${state.settings.bradfordThresholds.monitor}, high ≥ ${state.settings.bradfordThresholds.high}, severe ≥ ${state.settings.bradfordThresholds.severe}. A trigger means a conversation, never automatic action.</div>
          `
              : ''
          }
        </div>`
          : ''
      }

      <div class="card">
        <h2 class="mt0">New request</h2>
        <div class="formgrid">
          <label class="field">Staff member
            <select id="r-staff">${people.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>
          </label>
          <label class="field">Leave type
            <select id="r-type">${LEAVE_TYPES.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
          </label>
          <label class="field">Start date
            <input id="r-start" type="date" value="${esc(todayISO())}">
          </label>
          <label class="field">End date
            <input id="r-end" type="date" value="${esc(todayISO())}">
          </label>
          <label class="field">Note (optional)
            <input id="r-note" placeholder="e.g. pre-booked holiday">
          </label>
        </div>
        <button id="r-submit" class="primary mt8">Check &amp; submit</button>
        <div id="r-preview"></div>
      </div>

      ${
        requested.length
          ? `
        <div class="card">
          <h2 class="mt0">Awaiting decision (${requested.length})</h2>
          ${requested.map((l) => requestRow(ctx, l)).join('')}
        </div>`
          : ''
      }

      <div class="card">
        <h2 class="mt0">Balances (sessions, this leave year)</h2>
        <table>
          <thead><tr><th>Staff</th><th>Annual</th><th>Used</th><th>Remaining</th><th>Study</th><th>Used</th><th>Remaining</th><th>TOIL left</th></tr></thead>
          <tbody>
            ${people
              .map((p) => {
                const al = leaveBalance(p, state.leave, 'annual', todayISO());
                const sl = leaveBalance(p, state.leave, 'study', todayISO());
                const tb = toilBalance(p, state.leave);
                return `<tr><td>${esc(p.name)}</td>
                <td>${al.entitled}</td><td>${al.used}</td><td class="${al.remaining < 0 ? 'overdrawn' : ''}">${al.remaining}</td>
                <td>${sl.entitled}</td><td>${sl.used}</td><td class="${sl.remaining < 0 ? 'overdrawn' : ''}">${sl.remaining}</td>
                <td class="${tb.remaining < 0 ? 'overdrawn' : ''}">${tb.remaining}</td></tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2 class="mt0">History</h2>
        ${
          decided.length
            ? `<table>
          <thead><tr><th>Staff</th><th>Type</th><th>Dates</th><th>Sessions</th><th>Status</th></tr></thead>
          <tbody>${decided
            .map((l) => {
              const p = state.staff.find((s) => s.id === l.staffId);
              return `<tr><td>${esc(p ? p.name : '?')}</td><td>${esc((leaveTypeById(l.type) || {}).name || l.type)}</td>
              <td>${esc(fmtRange(l.startDate, l.endDate))}</td><td>${esc(String(l.sessions ?? '—'))}</td>
              <td><span class="pill ${esc(l.status)}">${esc(l.status)}</span></td></tr>`;
            })
            .join('')}</tbody>
        </table>`
            : '<div class="muted">No decided requests yet.</div>'
        }
      </div>
    `;

    root.querySelector('#r-submit').onclick = async () => {
      const req = {
        id: uid(),
        staffId: root.querySelector('#r-staff').value,
        type: root.querySelector('#r-type').value,
        startDate: root.querySelector('#r-start').value,
        endDate: root.querySelector('#r-end').value,
        note: root.querySelector('#r-note').value.trim(),
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
      ctx.toast(`Request submitted (${check.sessions} sessions, ${check.warnings.length} warning(s))`);
      ctx.rerender();
    };

    root.querySelectorAll('[data-approve]').forEach((btn) => {
      btn.onclick = async () => {
        const l = state.leave.find((x) => x.id === btn.dataset.approve);
        if (!l) return;
        l.status = 'approved';
        l.decidedAt = new Date().toISOString();
        const applied = applyApprovedLeave(l, state.entries);
        state.entries = applied.entries;
        await ctx.persist('leave', 'entries');
        ctx.toast(`Approved — ${applied.vacancies} session(s) moved to the cover worklist`);
        ctx.rerender();
      };
    });
    root.querySelectorAll('[data-fitnote]').forEach((input) => {
      input.onchange = async () => {
        const l = state.leave.find((x) => x.id === input.dataset.fitnote);
        if (!l) return;
        l.fitNoteUntil = input.value || null;
        await ctx.persist('leave');
        ctx.rerender();
      };
    });
    root.querySelectorAll('[data-rtw]').forEach((input) => {
      input.onchange = async () => {
        const l = state.leave.find((x) => x.id === input.dataset.rtw);
        if (!l) return;
        l.rtwDone = input.checked;
        await ctx.persist('leave');
        ctx.rerender();
      };
    });
    root.querySelectorAll('[data-decline]').forEach((btn) => {
      btn.onclick = async () => {
        const l = state.leave.find((x) => x.id === btn.dataset.decline);
        if (!l) return;
        l.status = 'declined';
        l.decidedAt = new Date().toISOString();
        await ctx.persist('leave');
        ctx.rerender();
      };
    });
  },
};

function requestRow(ctx, l) {
  const { state } = ctx;
  const p = state.staff.find((s) => s.id === l.staffId);
  const check = checkLeaveRequest(l, {
    staff: state.staff,
    leaveList: state.leave,
    entries: state.entries,
    settings: state.settings,
  });
  return `
    <div style="border-bottom:1px solid var(--line); padding:10px 0">
      <div class="toolbar" style="margin-bottom:6px">
        <strong>${esc(p ? p.name : '?')}</strong>
        <span>${esc((leaveTypeById(l.type) || {}).name || l.type)} · ${esc(fmtRange(l.startDate, l.endDate))} · ${check.sessions} sessions</span>
        ${l.note ? `<span class="sub">“${esc(l.note)}”</span>` : ''}
        <span class="spacer"></span>
        <button class="small primary" data-approve="${esc(l.id)}">Approve</button>
        <button class="small danger" data-decline="${esc(l.id)}">Decline</button>
      </div>
      ${check.warnings.length ? warnHTML(check.warnings) : '<div class="sub">No clashes — safe to approve.</div>'}
    </div>
  `;
}
