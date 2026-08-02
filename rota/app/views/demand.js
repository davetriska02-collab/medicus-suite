// Demand planning: pull booked-appointment and task-arrival history from
// Medicus, shape it into a per-weekday demand curve with configurable
// weighting, and compare required clinical sessions against the rostered
// rota. Every pulled figure is editable and every day excludable — the
// user's corrections always win and survive re-pulls.

import { esc } from '../../shared/esc.js';
import { todayISO, mondayOf, addDays, weekDates, dayKey, fmtDay } from '../../shared/time.js';
import { DEFAULT_SETTINGS } from '../../shared/model.js';
import { isValidPracticeCode, fetchOverviewRange, fetchTaskCounts } from '../../shared/medicus-api.js';
import { parseOverview } from '../../engine/reconcile.js';
import {
  mergePull,
  effective,
  weekdayProfile,
  demandToSessions,
  compareWeek,
  windowDates,
} from '../../engine/demand.js';

const DAY_LABELS = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function bar(value, max) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `<span class="bar" style="width:${pct}%"></span>`;
}

// Deterministic Monday-heavy sample history for demos.
function samplePull(state) {
  const dates = windowDates(todayISO(), state.settings);
  const mult = { mon: 1.5, tue: 1.25, wed: 1.05, thu: 0.95, fri: 0.85, sat: 0.5, sun: 0.5 };
  const rowsByDate = {};
  const taskCounts = {};
  for (const d of dates) {
    const m = mult[dayKey(d)] || 1;
    const jitter = (parseInt(d.replace(/-/g, ''), 10) % 9) - 4;
    rowsByDate[d] = [{ am: { booked: Math.round(52 * m + jitter) }, pm: { booked: Math.round(44 * m + jitter) } }];
    taskCounts[d] = Math.round(78 * m + jitter);
  }
  return { rowsByDate, taskCounts };
}

export default {
  render(root, ctx) {
    const { state } = ctx;
    const s = state.settings;
    const d = { ...DEFAULT_SETTINGS.demand, ...(s.demand || {}) };
    const today = todayISO();
    const demand = state.demand || { days: {} };
    const profile = weekdayProfile({ demand, settings: s, asOf: today });
    const required = demandToSessions(profile, s);
    const haveData = Object.keys(profile).length > 0;
    const maxAvg = Math.max(1, ...Object.values(profile).flatMap((p) => [p.am, p.pm]));

    const weekOffset = state.ui.demandWeek ?? 1; // default: next week
    const weekStart = addDays(mondayOf(today), weekOffset * 7);
    const comparison = compareWeek({
      dates: weekDates(weekStart),
      entries: state.entries,
      staff: state.staff,
      leaveList: state.leave,
      settings: s,
      required,
    });

    const histDates = windowDates(today, s).reverse();
    const showAll = state.ui.demandShowAll;
    const visible = showAll ? histDates : histDates.slice(0, 10);

    root.innerHTML = `
      <h1>Demand</h1>
      <div class="toolbar">
        <button id="d-pull" class="primary" ${isValidPracticeCode(s.practiceCode) ? '' : 'disabled title="Set your practice code in Settings first"'}>Pull from Medicus (${d.weeksWindow} weeks)</button>
        <button id="d-sample">Pull sample data</button>
        <span class="sub">${demand.pulledAt ? `Last pulled ${esc(new Date(demand.pulledAt).toLocaleString('en-GB'))}` : 'No data pulled yet'} — re-pulls refresh figures and keep your corrections.</span>
      </div>

      <div class="card">
        <h2 class="mt0">Model controls</h2>
        <div class="formgrid">
          <label class="field">History window (weeks)<input id="d-weeks" type="number" min="2" max="26" value="${esc(String(d.weeksWindow))}"></label>
          <label class="field">Recency half-life (weeks, 0 = equal weight)<input id="d-half" type="number" min="0" max="26" value="${esc(String(d.halfLifeWeeks))}"></label>
          <label class="field">Safety buffer (%)<input id="d-buffer" type="number" min="0" max="100" value="${esc(String(d.bufferPct))}"></label>
          <label class="field">Second-duty suggestion at (tasks/day)<input id="d-dutythresh" type="number" min="0" value="${esc(String(d.tasksDutyThreshold))}"></label>
        </div>
        <label class="check"><input type="checkbox" id="d-tasks" ${d.includeTasks ? 'checked' : ''}>Include inbound task load (medical/admin/Rx/results requests)</label>
        <button id="d-save" class="primary" style="margin-left:12px">Save controls</button>
        <div class="sub" style="margin-top:6px">Sessions are derived as average booked × (1 + buffer) ÷ ${esc(String(s.apptsPerSurgerySession))} appointments per session (Settings).</div>
      </div>

      <div class="card">
        <h2 class="mt0">Weekday demand profile</h2>
        ${
          haveData
            ? `<table>
          <thead><tr><th>Day</th><th style="width:24%">AM booked (avg)</th><th style="width:24%">PM booked (avg)</th><th>Sessions needed AM / PM</th>${d.includeTasks ? '<th>Tasks/day</th>' : ''}<th class="sub">Samples</th></tr></thead>
          <tbody>
            ${s.openDays
              .filter((dk) => profile[dk])
              .map((dk) => {
                const p = profile[dk];
                const r = required[dk] || {};
                const heavyTasks = d.includeTasks && p.tasks > d.tasksDutyThreshold;
                return `<tr>
                <td><strong>${DAY_LABELS[dk]}</strong></td>
                <td>${p.am} ${bar(p.am, maxAvg)}</td>
                <td>${p.pm} ${bar(p.pm, maxAvg)}</td>
                <td><strong>${r.am ?? '—'} / ${r.pm ?? '—'}</strong></td>
                ${d.includeTasks ? `<td>${p.tasks}${heavyTasks ? ' <span class="pill requested" title="Average inbound tasks exceed the threshold — consider a second duty doctor">2nd duty?</span>' : ''}</td>` : ''}
                <td class="sub">${p.samples}</td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>`
            : '<div class="muted">Pull data to build the profile.</div>'
        }
      </div>

      <div class="card">
        <h2 class="mt0">Capacity vs demand</h2>
        <div class="toolbar mb8">
          <label class="field" style="margin:0">Week
            <select id="d-week">
              ${[0, 1, 2, 3].map((n) => `<option value="${n}" ${weekOffset === n ? 'selected' : ''}>${n === 0 ? 'this week' : n === 1 ? 'next week' : `in ${n} weeks`}</option>`).join('')}
            </select>
          </label>
        </div>
        ${
          haveData && comparison.length
            ? `<table>
          <thead><tr><th>Day</th><th>Period</th><th>Sessions needed</th><th>Rostered</th><th>Balance</th></tr></thead>
          <tbody>
            ${comparison
              .map(
                (r) => `
              <tr>
                <td>${esc(fmtDay(r.date))}</td><td>${r.period.toUpperCase()}</td>
                <td>${r.required ?? '—'}</td><td>${r.rostered}</td>
                <td style="font-weight:700;color:${r.delta == null ? 'var(--muted)' : r.delta < 0 ? 'var(--high)' : r.delta > 1 ? 'var(--med)' : 'var(--ok)'}">${r.delta == null ? '—' : r.delta < 0 ? `${-r.delta} short` : r.delta > 1 ? `${r.delta} over` : 'OK'}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>`
            : '<div class="muted">Needs a demand profile and rostered sessions for the selected week.</div>'
        }
      </div>

      <div class="card">
        <h2 class="mt0">History — correct or exclude days</h2>
        <p class="sub">Edited figures override the pulled values (and survive re-pulls); excluded days drop out of the
        profile entirely — use it for flu-clinic days, closures and outages. Reset restores the pulled figures.</p>
        ${
          histDates.length
            ? `<table>
          <thead><tr><th>Date</th><th>AM booked</th><th>PM booked</th><th>Tasks</th><th>Excluded</th><th></th></tr></thead>
          <tbody>
            ${visible
              .map((date) => {
                const day = demand.days[date] || {};
                const v = effective(day);
                const edited = day.manualAm != null || day.manualPm != null || day.manualTasks != null;
                return `<tr style="${day.excluded ? 'opacity:.45' : ''}">
                <td>${esc(fmtDay(date))}${edited ? ' <span class="pill requested" title="Manually corrected">edited</span>' : ''}</td>
                <td><input type="number" min="0" class="w80" data-dfield="am" data-ddate="${esc(date)}" value="${v.am}"></td>
                <td><input type="number" min="0" class="w80" data-dfield="pm" data-ddate="${esc(date)}" value="${v.pm}"></td>
                <td><input type="number" min="0" class="w80" data-dfield="tasks" data-ddate="${esc(date)}" value="${v.tasks}"></td>
                <td><input type="checkbox" data-dexclude="${esc(date)}" ${day.excluded ? 'checked' : ''}></td>
                <td>${edited ? `<button class="small" data-dreset="${esc(date)}">Reset</button>` : ''}</td>
              </tr>`;
              })
              .join('')}
          </tbody>
        </table>
        ${histDates.length > 10 ? `<button id="d-showall" class="small" style="margin-top:8px">${showAll ? 'Show last 10' : `Show all ${histDates.length} days`}</button>` : ''}`
            : '<div class="muted">No history yet.</div>'
        }
      </div>
    `;

    /* ---- pulls ---- */
    const applyPull = async ({ rowsByDate, taskCounts }, errors = []) => {
      state.demand = mergePull({ existing: state.demand, rowsByDate, taskCounts, pulledAt: new Date().toISOString() });
      await ctx.persist('demand');
      await ctx.log(`Pulled demand history (${Object.keys(rowsByDate).length} days)`);
      ctx.toast(`Demand history updated${errors.length ? ` — ${errors.length} fetch error(s)` : ''}`);
      ctx.rerender();
    };

    const pullBtn = root.querySelector('#d-pull');
    if (pullBtn)
      pullBtn.onclick = async () => {
        ctx.toast(`Reading ${d.weeksWindow} weeks of appointment and task history…`);
        const dates = windowDates(today, s);
        try {
          const [appts, tasks] = await Promise.all([
            fetchOverviewRange(s.practiceCode, dates),
            d.includeTasks
              ? fetchTaskCounts(s.practiceCode, dates[0], dates[dates.length - 1])
              : Promise.resolve({ byDate: {}, errors: [] }),
          ]);
          if (!Object.keys(appts.byDate).length) {
            ctx.toast(`Medicus fetch failed: ${appts.errors[0] || 'no data'} — are you signed in?`);
            return;
          }
          const rowsByDate = Object.fromEntries(Object.entries(appts.byDate).map(([dt, p]) => [dt, parseOverview(p)]));
          await applyPull({ rowsByDate, taskCounts: tasks.byDate }, [...appts.errors, ...tasks.errors]);
        } catch (err) {
          ctx.toast(err instanceof Error ? err.message : String(err));
        }
      };

    root.querySelector('#d-sample').onclick = () => applyPull(samplePull(state));

    /* ---- controls ---- */
    root.querySelector('#d-save').onclick = async () => {
      s.demand = {
        weeksWindow: Number(root.querySelector('#d-weeks').value) || 8,
        halfLifeWeeks: Number(root.querySelector('#d-half').value) || 0,
        bufferPct: Number(root.querySelector('#d-buffer').value) || 0,
        includeTasks: root.querySelector('#d-tasks').checked,
        tasksDutyThreshold: Number(root.querySelector('#d-dutythresh').value) || 0,
      };
      await ctx.persist('settings');
      ctx.toast('Demand model updated');
      ctx.rerender();
    };

    root.querySelector('#d-week').onchange = (e) => {
      state.ui.demandWeek = Number(e.target.value);
      ctx.rerender();
    };
    const showAllBtn = root.querySelector('#d-showall');
    if (showAllBtn)
      showAllBtn.onclick = () => {
        state.ui.demandShowAll = !showAll;
        ctx.rerender();
      };

    /* ---- corrections ---- */
    root.querySelectorAll('[data-dfield]').forEach((input) => {
      input.onchange = async () => {
        const date = input.dataset.ddate;
        const field = input.dataset.dfield; // am | pm | tasks
        const day = (state.demand.days[date] ||= {});
        const value = Math.max(0, Number(input.value) || 0);
        const manualKey = `manual${field[0].toUpperCase()}${field.slice(1)}`;
        if (value === (day[field] ?? 0))
          delete day[manualKey]; // matches pulled: no override needed
        else day[manualKey] = value;
        await ctx.persist('demand');
        ctx.rerender();
      };
    });
    root.querySelectorAll('[data-dexclude]').forEach((input) => {
      input.onchange = async () => {
        const day = (state.demand.days[input.dataset.dexclude] ||= {});
        day.excluded = input.checked;
        await ctx.persist('demand');
        ctx.rerender();
      };
    });
    root.querySelectorAll('[data-dreset]').forEach((btn) => {
      btn.onclick = async () => {
        const day = state.demand.days[btn.dataset.dreset];
        if (!day) return;
        delete day.manualAm;
        delete day.manualPm;
        delete day.manualTasks;
        await ctx.persist('demand');
        ctx.rerender();
      };
    });
  },
};
