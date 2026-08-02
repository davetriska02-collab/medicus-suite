// Dashboard: what a practice manager needs at 8am — today's duty cover,
// this week's risk picture, the cover worklist and pending decisions.

import { esc } from '../../shared/esc.js';
import { todayISO, mondayOf, weekDates, fmtDay, addDays } from '../../shared/time.js';
import { typeById, newStaff } from '../../shared/model.js';
import { isValidPracticeCode, fetchOverviewRange } from '../../shared/medicus-api.js';
import { parseOverview } from '../../engine/reconcile.js';
import { inferPatterns } from '../../engine/infer.js';
import { inferRooms } from '../../engine/room-infer.js';
import { generateEntries } from '../../engine/template.js';
import { demoOverviewPayload } from '../../shared/demo.js';
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

    root.innerHTML = `
      <h1>Dashboard — ${esc(fmtDay(today))}</h1>
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
          <summary>One-click setup from Medicus</summary>
          <p class="sub mt8">Reads 4 weeks of the appointment book, imports your clinicians, infers each person's
          week pattern and the rooms (incl. a usual room each), then generates the next 4 weeks of rota.
          Additive only — existing staff, rooms and sessions are never overwritten. Review Staff and
          Templates afterwards.</p>
          <div class="toolbar mb8">
            <button id="setup-live" class="primary" ${isValidPracticeCode(state.settings.practiceCode) ? '' : 'disabled title="Set your practice code in Settings first"'}>Set up from Medicus</button>
            <button id="setup-demo">Run with sample data</button>
          </div>
          ${state.ui.setupResult ? setupSummary(state.ui.setupResult) : ''}
        </details>`
          : `
        <div class="card">
          <h2 class="mt0">One-click setup from Medicus</h2>
          <p class="sub">Reads 4 weeks of the appointment book, imports your clinicians, infers each person's
          week pattern and the rooms (incl. a usual room each), then generates the next 4 weeks of rota.
          Additive only — existing staff, rooms and sessions are never overwritten. Review Staff and
          Templates afterwards.</p>
          <div class="toolbar mb8">
            <button id="setup-live" class="primary" ${isValidPracticeCode(state.settings.practiceCode) ? '' : 'disabled title="Set your practice code in Settings first"'}>Set up from Medicus</button>
            <button id="setup-demo">Run with sample data</button>
          </div>
          ${state.ui.setupResult ? setupSummary(state.ui.setupResult) : ''}
        </div>

        <div class="card">
          <h2 class="mt0">Getting started</h2>
          <ol>
            <li>Use the one-click setup above (your practice code goes in <a href="#settings">Settings</a>), or</li>
            <li>load the <a href="#settings">demo dataset</a> to explore, or</li>
            <li>add staff by hand, set patterns under <a href="#templates">Templates</a> and generate the rota.</li>
          </ol>
        </div>`
      }
    `;

    const setupLive = root.querySelector('#setup-live');
    if (setupLive) setupLive.onclick = () => runSetup(ctx, false);
    root.querySelector('#setup-demo').onclick = () => runSetup(ctx, true);

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

const norm = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

function setupSummary(r) {
  return `
    <div style="margin-top:10px">
      <div class="warn"><span class="sev ok">done</span><span>${r.days} day(s) of appointment-book history analysed</span></div>
      <div class="warn"><span class="sev ${r.clinicians ? 'ok' : 'info'}">staff</span><span>${r.clinicians} clinician(s) imported — review roles/contracts under <a href="#staff">Staff</a></span></div>
      <div class="warn"><span class="sev ${r.patterns ? 'ok' : 'info'}">patterns</span><span>${r.patterns} week pattern(s) inferred and applied</span></div>
      <div class="warn"><span class="sev ${r.rooms ? 'ok' : 'info'}">rooms</span><span>${r.rooms} room(s) ready with usual-room assignments</span></div>
      <div class="warn"><span class="sev ${r.sessions ? 'ok' : 'info'}">rota</span><span>${r.sessions} session(s) generated for the next 4 weeks — open the <a href="#rota">Rota</a></span></div>
      ${(r.errors || []).map((e) => `<div class="warn"><span class="sev medium">fetch</span><span>${esc(e)}</span></div>`).join('')}
    </div>`;
}

async function runSetup(ctx, sample) {
  const { state } = ctx;
  const summary = { errors: [] };
  const thisMonday = mondayOf(todayISO());
  const pastDates = [];
  for (let w = 4; w >= 1; w--) {
    for (let i = 0; i < 5; i++) pastDates.push(addDays(thisMonday, -7 * w + i));
  }

  let rowsByDate = {};
  if (sample) {
    rowsByDate = Object.fromEntries(pastDates.map((d) => [d, parseOverview(demoOverviewPayload(state.staff, d))]));
  } else {
    ctx.toast('Reading 4 weeks of appointment-book history…');
    try {
      const { byDate, errors } = await fetchOverviewRange(state.settings.practiceCode, pastDates);
      if (!Object.keys(byDate).length) {
        ctx.toast(`Medicus fetch failed: ${errors[0] || 'no data'} — are you signed in to Medicus?`);
        return;
      }
      summary.errors = errors.slice(0, 2);
      rowsByDate = Object.fromEntries(Object.entries(byDate).map(([d, p]) => [d, parseOverview(p)]));
    } catch (err) {
      ctx.toast(err instanceof Error ? err.message : String(err));
      return;
    }
  }
  summary.days = Object.keys(rowsByDate).length;

  // Import clinicians the registry doesn't know (additive, defaults to GP —
  // the summary points at the Staff page for role/contract review).
  const known = new Set(state.staff.flatMap((s) => [norm(s.medicusName), norm(s.name)]).filter(Boolean));
  const seen = new Set();
  summary.clinicians = 0;
  for (const rows of Object.values(rowsByDate)) {
    for (const r of rows) {
      const key = norm(r.name);
      if (!key || known.has(key) || seen.has(key)) continue;
      if (!r.am.hasSession && !r.pm.hasSession) continue;
      seen.add(key);
      state.staff.push(newStaff({ id: uid(), name: r.name, medicusName: r.name }));
      summary.clinicians += 1;
    }
  }

  const inferred = inferPatterns({ rowsByDate, staff: state.staff });
  for (const p of inferred.proposals) {
    const person = state.staff.find((s) => s.id === p.staffId);
    if (person) person.pattern = p.pattern;
  }
  summary.patterns = inferred.proposals.length;

  const ri = inferRooms({ rowsByDate, staff: state.staff });
  while (state.rooms.length < ri.roomCount) {
    state.rooms.push({ id: uid(), name: `Room ${state.rooms.length + 1}` });
  }
  for (const a of ri.assignments) {
    const person = state.staff.find((s) => s.id === a.staffId);
    const room = state.rooms[a.roomIndex];
    if (person && room) person.usualRoomId = room.id;
  }
  summary.rooms = ri.roomCount;

  if (!state.settings.templateAnchorMonday) state.settings.templateAnchorMonday = thisMonday;
  const created = generateEntries({
    staff: state.staff,
    startDate: thisMonday,
    endDate: addDays(thisMonday, 27),
    existingEntries: state.entries,
    leaveList: state.leave,
    settings: state.settings,
  });
  state.entries.push(...created);
  summary.sessions = created.length;

  await ctx.persist('staff', 'rooms', 'entries', 'settings');
  await ctx.log(
    `Setup wizard${sample ? ' (sample)' : ''}: ${summary.clinicians} clinicians, ${summary.patterns} patterns, ${summary.rooms} rooms, ${summary.sessions} sessions`
  );
  state.ui.setupResult = summary;
  ctx.toast('Setup complete — review Staff, then open the Rota');
  ctx.rerender();
}
