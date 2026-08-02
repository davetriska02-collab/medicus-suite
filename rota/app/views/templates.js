// Working-pattern templates: each staff member's repeating 1/2/4-week
// pattern. The rota view rolls these forward into real entries.

import { esc } from '../../shared/esc.js';
import { SESSION_TYPES, DAY_KEYS, blankPattern, periodsFor, PERIOD_INFO } from '../../shared/model.js';
import { addDays, mondayOf, todayISO, dayKey } from '../../shared/time.js';
import { isValidPracticeCode, fetchOverviewRange } from '../../shared/medicus-api.js';
import { parseOverview } from '../../engine/reconcile.js';
import { inferPatterns } from '../../engine/infer.js';
import { demoOverviewPayload } from '../../shared/demo.js';
import { staffSorted } from './ui.js';

const DAY_LABELS = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export default {
  render(root, ctx) {
    const { state } = ctx;
    const people = staffSorted(state.staff);
    if (!state.ui.tplStaff && people.length) state.ui.tplStaff = people[0].id;
    const person = state.staff.find((s) => s.id === state.ui.tplStaff);

    root.innerHTML = `
      <h1>Templates</h1>
      <div class=”card mb8”>
        <p class=”sub” style=”margin:0”>Repeating week patterns per staff member. “Generate from templates” on the Rota page rolls them forward,
        skipping anything already rostered and punching out approved leave. Pattern weeks count from the anchor Monday
        (${esc(state.settings.templateAnchorMonday || 'set on first generation')}).</p>
      </div>
      <div class=”toolbar”>
        <select id="who">
          ${people.map((p) => `<option value="${esc(p.id)}" ${person && p.id === person.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        ${
          person
            ? `
          <select id="weeks">
            ${[1, 2, 4].map((n) => `<option value="${n}" ${(person.pattern || []).length === n ? 'selected' : ''}>${n}-week pattern</option>`).join('')}
          </select>
          <button id="save" class="primary">Save pattern</button>
        `
            : ''
        }
      </div>
      ${person ? pattern(person, state.settings) : `<div class="card"><div class="empty-state"><h3>Add staff first</h3><p>Once you have staff members, select one above to set their weekly pattern.</p></div></div>`}

      <div class="card">
        <h2 class="mt0">Auto-infer patterns from the appointment book</h2>
        <p class="sub">Reads the last 4 weeks of Medicus history and proposes each clinician's week pattern —
        a cell is proposed when they were consulting in at least 60% of that weekday's observations.
        Review, then apply per person.</p>
        <div class="toolbar">
          <button id="infer-live" class="primary" ${isValidPracticeCode(state.settings.practiceCode) ? '' : 'disabled title="Set your practice code in Settings"'}>Infer from Medicus (4 weeks)</button>
          <button id="infer-demo">Infer from sample data</button>
          ${
            ((state.ui.inferResult || {}).proposals || []).some((p) => !p.applied)
              ? `<button id="infer-applyall" class="primary">Apply all (${((state.ui.inferResult || {}).proposals || []).filter((p) => !p.applied).length})</button>`
              : ''
          }
        </div>
        <div id="infer-out">
          ${state.ui.inferResult ? renderInference(state.ui.inferResult) : ''}
        </div>
      </div>
    `;

    root.querySelector('#who')?.addEventListener('change', (e) => {
      state.ui.tplStaff = e.target.value;
      ctx.rerender();
    });

    if (!person) return;

    root.querySelector('#weeks').addEventListener('change', (e) => {
      const n = Number(e.target.value);
      const next = blankPattern(n);
      (person.pattern || []).slice(0, n).forEach((week, i) => {
        next[i] = week;
      });
      person.pattern = next;
      ctx.rerender();
    });

    root.querySelector('#save').onclick = async () => {
      root.querySelectorAll('select.cellpick').forEach((sel) => {
        const { week, day, period } = sel.dataset;
        person.pattern[Number(week)][day][period] = sel.value || null;
      });
      await ctx.persist('staff');
      ctx.toast(`Pattern saved for ${person.name}`);
      ctx.rerender();
    };

    wireInference(root, ctx);
  },
};

function pastWeekdays(weeks) {
  // The last `weeks` full Mon–Fri weeks before this one.
  const thisMonday = mondayOf(todayISO());
  const dates = [];
  for (let w = weeks; w >= 1; w--) {
    const monday = addDays(thisMonday, -7 * w);
    for (let i = 0; i < 5; i++) dates.push(addDays(monday, i));
  }
  return dates;
}

function renderInference(result) {
  return `
    ${result.errors && result.errors.length ? `<div class="warn"><span class="sev medium">fetch</span><span>${esc(result.errors[0])}${result.errors.length > 1 ? ` (+${result.errors.length - 1} more)` : ''}</span></div>` : ''}
    <div class="sub" style="margin:6px 0">${result.datesObserved} day(s) of appointment-book history analysed.</div>
    ${
      result.proposals.length
        ? result.proposals
            .map(
              (p) => `
      <div class="toolbar" style="margin-bottom:4px">
        <strong>${esc(p.name)}</strong>
        <span class="sub">${esc(p.summary.join(', '))}</span>
        <span class="spacer"></span>
        ${
          p.applied
            ? `<span class="pill approved">applied ✓</span> <button class="small" data-applypattern="${esc(p.staffId)}">Re-apply</button>`
            : `<button class="small primary" data-applypattern="${esc(p.staffId)}">Apply pattern (${p.cells} sessions/wk)</button>`
        }
      </div>`
            )
            .join('')
        : '<div class="muted">No regular patterns detected for your registered staff.</div>'
    }
    ${result.unmatched.length ? `<div class="sub" style="margin-top:6px">Consulting in Medicus but not in the staff registry: ${result.unmatched.map(esc).join(', ')} — import them via Live sync first.</div>` : ''}
  `;
}

function wireInference(root, ctx) {
  const { state } = ctx;

  const run = (rowsByDate, errors = []) => {
    const result = inferPatterns({ rowsByDate, staff: state.staff });
    state.ui.inferResult = { ...result, errors };
    ctx.rerender();
  };

  const live = root.querySelector('#infer-live');
  if (live)
    live.onclick = async () => {
      ctx.toast('Reading 4 weeks of appointment-book history…');
      const dates = pastWeekdays(4);
      try {
        const { byDate, errors } = await fetchOverviewRange(state.settings.practiceCode, dates);
        const rowsByDate = Object.fromEntries(
          Object.entries(byDate).map(([d, payload]) => [d, parseOverview(payload)])
        );
        run(rowsByDate, errors.length ? [...errors, 'You must be signed in to Medicus in this browser profile.'] : []);
      } catch (err) {
        ctx.toast(err instanceof Error ? err.message : String(err));
      }
    };

  const demo = root.querySelector('#infer-demo');
  if (demo)
    demo.onclick = () => {
      const rowsByDate = Object.fromEntries(
        pastWeekdays(4)
          .filter((d) => ['mon', 'tue', 'wed', 'thu'].includes(dayKey(d))) // synthetic practice closed Fridays
          .map((d) => [d, parseOverview(demoOverviewPayload(state.staff, d))])
      );
      run(rowsByDate);
    };

  root.querySelectorAll('[data-applypattern]').forEach((btn) => {
    btn.onclick = async () => {
      const proposal = ((state.ui.inferResult || {}).proposals || []).find(
        (p) => p.staffId === btn.dataset.applypattern
      );
      const person = state.staff.find((s) => s.id === btn.dataset.applypattern);
      if (!proposal || !person) return;
      person.pattern = proposal.pattern;
      proposal.applied = true;
      await ctx.persist('staff');
      await ctx.log(`Applied inferred pattern to ${person.name} (${proposal.cells} sessions/wk)`);
      ctx.toast(`Pattern applied to ${person.name} — review it above, then generate the rota`);
      state.ui.tplStaff = person.id;
      ctx.rerender();
    };
  });

  const applyAll = root.querySelector('#infer-applyall');
  if (applyAll)
    applyAll.onclick = async () => {
      const proposals = ((state.ui.inferResult || {}).proposals || []).filter((p) => !p.applied);
      let applied = 0;
      for (const proposal of proposals) {
        const person = state.staff.find((s) => s.id === proposal.staffId);
        if (!person) continue;
        person.pattern = proposal.pattern;
        proposal.applied = true;
        applied += 1;
      }
      if (!applied) return;
      await ctx.persist('staff');
      await ctx.log(`Applied ${applied} inferred week pattern(s)`);
      ctx.toast(`${applied} pattern(s) applied — generate the rota when ready`);
      ctx.rerender();
    };
}

function pattern(person, settings) {
  const weeks = person.pattern || [];
  const P = periodsFor(settings);
  return weeks
    .map(
      (week, wi) => `
    <div class="card">
      <h2 class="mt0">${weeks.length > 1 ? `Week ${wi + 1}` : 'Every week'}</h2>
      <table>
        <thead><tr><th></th>${DAY_KEYS.map((d) => `<th>${DAY_LABELS[d]}</th>`).join('')}</tr></thead>
        <tbody>
          ${P.map(
            (period) => `
            <tr>
              <th>${PERIOD_INFO[period].label}</th>
              ${DAY_KEYS.map(
                (day) => `
                <td>
                  <select class="cellpick" data-week="${wi}" data-day="${day}" data-period="${period}" aria-label="${esc(DAY_LABELS[day])} ${esc(PERIOD_INFO[period].label)} week ${wi + 1}">
                    <option value="">—</option>
                    ${SESSION_TYPES.map((t) => `<option value="${t.id}" ${week[day] && week[day][period] === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
                  </select>
                </td>
              `
              ).join('')}
            </tr>
          `
          ).join('')}
        </tbody>
      </table>
    </div>
  `
    )
    .join('');
}
