// Dashboard: what a practice manager needs at 8am — today's duty cover,
// this week's risk picture, the cover worklist and pending decisions.

import { esc } from '../../shared/esc.js';
import { todayISO, mondayOf, weekDates, fmtDay } from '../../shared/time.js';
import { typeById } from '../../shared/model.js';
import { checkWeek, capacitySummary } from '../../engine/rules.js';
import {
  approvedLeaveFor,
  sfeReimbursementFlags,
  fitNoteFlags,
  sessionsInRange,
  applyApprovedLeave,
} from '../../engine/leave.js';
import { bradfordRows } from '../../engine/bradford.js';
import { rankCover, applyCover } from '../../engine/cover.js';
import { validateSwap, applySwap } from '../../engine/swaps.js';
import { uid } from '../../shared/store.js';
import { staffSorted, warnHTML } from './ui.js';

export default {
  render(root, ctx) {
    const { state } = ctx;
    const today = todayISO();
    const monday = mondayOf(today);
    const dates = weekDates(monday);

    const warnings = checkWeek({
      dates,
      entries: state.entries,
      staff: state.staff,
      leaveList: state.leave,
      settings: state.settings,
    });
    const high = warnings.filter((w) => w.severity === 'high');
    const cap = capacitySummary({
      dates,
      entries: state.entries,
      staff: state.staff,
      leaveList: state.leave,
      settings: state.settings,
    });
    const vacancies = state.entries.filter((e) => e.status === 'vacancy' && e.date >= today);
    const pending = state.leave.filter((l) => l.status === 'requested');
    const pendingSwaps = (state.swaps || []).filter((s) => s.status === 'requested');
    const sfe = sfeReimbursementFlags(state.leave, state.staff);
    const fitFlags = fitNoteFlags(state.leave, state.staff);
    const bradfordFlagged = bradfordRows({
      staff: state.staff,
      leaveList: state.leave,
      settings: state.settings,
    }).filter((r) => r.band === 'high' || r.band === 'severe');

    const dutyToday = {};
    for (const period of ['am', 'pm']) {
      dutyToday[period] = state.entries
        .filter(
          (e) =>
            e.date === today &&
            e.period === period &&
            e.typeId === 'duty' &&
            e.status !== 'vacancy' &&
            e.status !== 'cancelled'
        )
        .map((e) => state.staff.find((s) => s.id === e.staffId))
        .filter((p) => p && !approvedLeaveFor(state.leave, p.id, today))
        .map((p) => p.name);
    }
    const onLeaveToday = state.staff.filter((p) => approvedLeaveFor(state.leave, p.id, today)).map((p) => p.name);

    const checklist = checklistItems(ctx);
    const showChecklist =
      state.staff.length > 0 && !state.settings.checklistDismissed && checklist.some((item) => !item.done);

    root.innerHTML = `
      <h1>Dashboard — ${esc(fmtDay(today))}</h1>
      ${showChecklist ? checklistHTML(checklist) : ''}
      <div class="cards">
        <div class="card">
          <div class="kpi ${dutyToday.am.length && dutyToday.pm.length ? 'good' : 'bad'}">${dutyToday.am.length && dutyToday.pm.length ? 'OK' : 'Gap'}</div>
          <div class="sub">Duty today — AM: ${esc(dutyToday.am.join(', ') || 'nobody')} · PM: ${esc(dutyToday.pm.join(', ') || 'nobody')}</div>
        </div>
        <div class="card"><div class="kpi ${high.length ? 'bad' : 'good'}">${high.length}</div><div class="sub">High-priority warnings this week</div></div>
        <div class="card"><div class="kpi ${vacancies.length ? 'bad' : 'good'}">${vacancies.length}</div><div class="sub">Upcoming sessions needing cover</div></div>
        <div class="card"><div class="kpi">${pending.length}</div><div class="sub">Leave requests awaiting decision</div></div>
        <div class="card"><div class="kpi ${cap.estimated >= cap.target ? 'good' : ''}">${cap.estimated}<span class="kpi-unit"> / ${cap.target}</span></div><div class="sub">GP appointments this week vs benchmark</div></div>
      </div>

      ${onLeaveToday.length ? `<div class="card"><h2 class="mt0">On leave today</h2>${esc(onLeaveToday.join(', '))}</div>` : ''}
      ${
        sfe.length || fitFlags.length || bradfordFlagged.length
          ? `<div class="card">
        ${sfe.map((f) => `<div class="warn"><span class="sev ${f.eligible ? 'high' : 'medium'}">SFE</span><span>${esc(f.name)} — sickness day ${f.days}${f.eligible ? ', locum reimbursement claimable' : ''}</span></div>`).join('')}
        ${fitFlags.map((f) => `<div class="warn"><span class="sev ${esc(f.severity)}">fit note</span><span>${esc(f.message)}</span></div>`).join('')}
        ${bradfordFlagged.map((r) => `<div class="warn"><span class="sev ${r.band === 'severe' ? 'high' : 'medium'}">Bradford</span><span>${esc(r.name)} — score ${r.score} (${r.episodes} episodes, ${r.days} days, 52-week rolling) — <a href="#leave">review</a></span></div>`).join('')}
      </div>`
          : ''
      }

      ${
        vacancies.length
          ? `
        <div class="card">
          <h2 class="mt0">Cover worklist</h2>
          ${vacancies
            .slice(0, 12)
            .map((e) => {
              const p = state.staff.find((s) => s.id === e.staffId);
              const t = typeById(e.typeId);
              const options = rankCover({
                vacancy: e,
                staff: state.staff,
                entries: state.entries,
                leaveList: state.leave,
              }).slice(0, 4);
              return `
              <div style="border-bottom:1px solid var(--line);padding:8px 0">
                <div><strong>${esc(fmtDay(e.date))} ${e.period.toUpperCase()}</strong> — ${esc(t ? t.name : e.typeId)} (was ${esc(p ? p.name : '?')})
                  ${e.note ? `<span class="sub">· ${esc(e.note)}</span>` : ''}</div>
                ${
                  options.length
                    ? `
                  <details class="mt8"><summary class="sub">Cover options (${options.length})</summary>
                    ${options
                      .map(
                        (c) => `
                      <div class="toolbar mt8" style="margin-bottom:0">
                        <span>${esc(c.name)}${c.isLocum ? ' <span class="pill requested">locum</span>' : ''}</span>
                        <span class="sub">${esc(c.reason)}</span>
                        <span class="spacer"></span>
                        <button class="small primary" data-assign="${esc(e.id)}|${esc(c.staffId)}">Assign</button>
                      </div>`
                      )
                      .join('')}
                  </details>`
                    : '<div class="sub mt8">No eligible cover found — consider an external locum.</div>'
                }
              </div>`;
            })
            .join('')}
        </div>`
          : ''
      }

      <div class="card">
        <h2 class="mt0">This week's checks <a href="#rota" class="sub" style="font-weight:400">open rota →</a></h2>
        ${warnHTML(warnings.slice(0, 10))}
        ${warnings.length > 10 ? `<div class="sub mt8">…and ${warnings.length - 10} more on the Rota page.</div>` : ''}
      </div>

      ${
        pendingSwaps.length
          ? `
        <div class="card">
          <h2 class="mt0">Swap requests (${pendingSwaps.length})</h2>
          ${pendingSwaps
            .map((s) => {
              const a = state.entries.find((e) => e.id === s.entryAId);
              const b = state.entries.find((e) => e.id === s.entryBId);
              if (!a || !b) return '';
              const pa = state.staff.find((p) => p.id === a.staffId);
              const pb = state.staff.find((p) => p.id === b.staffId);
              const ta = typeById(a.typeId);
              const tb = typeById(b.typeId);
              const errors = validateSwap({ entryA: a, entryB: b, staff: state.staff, leaveList: state.leave });
              return `
              <div style="border-bottom:1px solid var(--line);padding:8px 0">
                <div class="toolbar mb8">
                  <span><strong>${esc(pa ? pa.name : '?')}</strong> ${esc(fmtDay(a.date))} ${a.period.toUpperCase()} (${esc(ta ? ta.name : a.typeId)})
                    ⇄ <strong>${esc(pb ? pb.name : '?')}</strong> ${esc(fmtDay(b.date))} ${b.period.toUpperCase()} (${esc(tb ? tb.name : b.typeId)})</span>
                  <span class="spacer"></span>
                  <button class="small primary" data-swapok="${esc(s.id)}">Approve</button>
                  <button class="small danger" data-swapno="${esc(s.id)}">Decline</button>
                </div>
                ${errors.length ? warnHTML(errors.map((m) => ({ severity: 'medium', message: m }))) : ''}
              </div>`;
            })
            .join('')}
        </div>`
          : ''
      }

      ${
        state.staff.length
          ? `
        <div class="card">
          <h2 class="mt0">Same-day sickness</h2>
          <div class="toolbar mb8">
            <select id="sickwho">${staffSorted(state.staff.filter((p) => !p.notAPerson))
              .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
              .join('')}</select>
            <button id="sickgo" class="danger">Mark sick today</button>
            <span class="sub">Approves a sickness episode for today, punches out their sessions and lines up cover options below.</span>
          </div>
        </div>`
          : ''
      }

      ${
        state.staff.length
          ? `
        <details class="card">
          <summary>Set up more of your practice</summary>
          <p class="sub mt8">The setup assistant imports clinicians from the Medicus appointment book, infers
          each person's usual week and your room count, and generates the rota — additive, so existing staff,
          rooms and sessions are never overwritten.</p>
          <a class="btnlink" href="#setup">Open the setup assistant</a>
        </details>`
          : `
        <div class="card">
          <h2 class="mt0">Set up your practice</h2>
          <p class="sub">Import your clinicians from Medicus, or explore with a sample practice. About three
          minutes, and it ends with a working rota on the grid.</p>
          <a class="btnlink primary" href="#setup">Open the setup assistant</a>
        </div>`
      }
    `;

    const dismiss = root.querySelector('#cl-dismiss');
    if (dismiss)
      dismiss.onclick = async () => {
        state.settings.checklistDismissed = true;
        await ctx.persist('settings');
        ctx.rerender();
      };

    const sickBtn = root.querySelector('#sickgo');
    if (sickBtn)
      sickBtn.onclick = async () => {
        const person = state.staff.find((p) => p.id === root.querySelector('#sickwho').value);
        if (!person) return;
        if (!confirm(`Mark ${person.name} sick for today and free their sessions for cover?`)) return;
        const req = {
          id: uid(),
          staffId: person.id,
          type: 'sick',
          startDate: today,
          endDate: today,
          status: 'approved',
          rtwDone: false,
          note: 'Same-day sickness',
          createdAt: new Date().toISOString(),
        };
        req.sessions = sessionsInRange(person, today, today, state.entries, state.settings);
        state.leave.push(req);
        const applied = applyApprovedLeave(req, state.entries);
        state.entries = applied.entries;
        await ctx.persist('leave', 'entries');
        await ctx.log(`${person.name} marked sick today — ${applied.vacancies} session(s) to cover`);
        ctx.toast(`${person.name} marked sick — ${applied.vacancies} session(s) need cover`);
        ctx.rerender();
      };

    root.querySelectorAll('[data-swapok]').forEach((btn) => {
      btn.onclick = async () => {
        const s = state.swaps.find((x) => x.id === btn.dataset.swapok);
        if (!s) return;
        const result = applySwap(s, state.entries);
        if (!result.ok) {
          ctx.toast('One of the sessions no longer exists');
          return;
        }
        state.entries = result.entries;
        s.status = 'approved';
        s.decidedAt = new Date().toISOString();
        await ctx.persist('entries', 'swaps');
        await ctx.log(`Swap approved (${s.id})`);
        ctx.toast('Swap approved — sessions exchanged');
        ctx.rerender();
      };
    });
    root.querySelectorAll('[data-swapno]').forEach((btn) => {
      btn.onclick = async () => {
        const s = state.swaps.find((x) => x.id === btn.dataset.swapno);
        if (!s) return;
        s.status = 'declined';
        s.decidedAt = new Date().toISOString();
        await ctx.persist('swaps');
        ctx.rerender();
      };
    });

    root.querySelectorAll('[data-assign]').forEach((btn) => {
      btn.onclick = async () => {
        const [vacancyId, staffId] = btn.dataset.assign.split('|');
        const vacancy = state.entries.find((e) => e.id === vacancyId);
        const candidate = state.staff.find((s) => s.id === staffId);
        if (!vacancy || !candidate) return;
        const result = applyCover({
          vacancy,
          candidate: { staffId: candidate.id, name: candidate.name },
          entries: state.entries,
        });
        state.entries = result.entries;
        await ctx.persist('entries');
        ctx.toast(`${candidate.name} assigned to cover ${fmtDay(vacancy.date)} ${vacancy.period.toUpperCase()}`);
        ctx.rerender();
      };
    });
  },
};

/* ---- post-setup checklist ---- */

// The long tail of setup, kept off the wizard so the wizard can end at a
// working rota. Every item is LIVE-detected from state — nothing here is a
// "you have seen this" flag, so an item that ticks itself stays ticked and an
// item that never applies is still honestly outstanding.
function checklistItems(ctx) {
  const { state } = ctx;
  const s = state.settings;
  // Locums have no contracted week, and directory lanes are not people.
  const contracted = state.staff.filter((p) => !p.notAPerson && p.employmentType !== 'locum');
  const hasPattern = (p) =>
    (p.pattern || []).some((week) => Object.values(week || {}).some((day) => day && (day.am || day.pm)));

  return [
    { text: 'Tell the app who you are', href: '#me', done: Boolean(s.userStaffId) },
    {
      // There is no stored "entitlements reviewed" flag to read (staff carry
      // entitlement: { annual, study } with a shipped default), so this item
      // detects the real, checkable thing next door: everybody who has a
      // contracted week actually has one set.
      text: 'Check contracted sessions and week patterns',
      href: '#staff',
      done: contracted.length > 0 && contracted.every(hasPattern),
    },
    { text: 'Share the rota with other machines', href: '#settings', done: state.ui.syncStatus === 'connected' },
    {
      text: 'Protect the rota with a passcode',
      href: '#settings',
      done: Boolean(state.access && state.access.enabled),
    },
    {
      // Session-scoped by nature: the reconciliation is a thing you do, not a
      // setting you save, so this ticks once it has been run in this tab.
      text: 'Check tomorrow against the appointment book',
      href: '#sync',
      done: Array.isArray(state.ui.syncResults),
    },
  ];
}

function checklistHTML(items) {
  const done = items.filter((i) => i.done).length;
  return `
    <div class="card checklist">
      <div class="toolbar mb8">
        <h2 class="mt0">Finish setting up</h2>
        <span class="sub">${done} of ${items.length} done</span>
        <span class="spacer"></span>
        <button class="small" id="cl-dismiss">Dismiss</button>
      </div>
      ${items
        .map((i) =>
          i.done
            ? `<div class="cl-item done"><span class="cl-mark">&#10003;</span><span>${esc(i.text)}</span></div>`
            : `<div class="cl-item"><span class="cl-mark">&rarr;</span><a href="${esc(i.href)}">${esc(i.text)}</a></div>`
        )
        .join('')}
    </div>`;
}
