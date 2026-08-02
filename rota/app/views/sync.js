// Live sync: reconcile the planned rota against the real Medicus
// appointment book — the check no other rota product can run live.
// Requires a logged-in Medicus session in this browser profile.

import { esc } from '../../shared/esc.js';
import { weekDates, dayKey, fmtDay } from '../../shared/time.js';
import { newStaff } from '../../shared/model.js';
import { uid } from '../../shared/store.js';
import { isValidPracticeCode, fetchOverviewRange } from '../../shared/medicus-api.js';
import { parseOverview, diffDay, summariseFindings } from '../../engine/reconcile.js';
import { demoOverviewPayload } from '../../shared/demo.js';

const KIND_LABELS = {
  'missing-clinic': { sev: 'high', label: 'Missing clinic' },
  'ghost-clinic': { sev: 'high', label: 'Ghost clinic' },
  'unplanned-clinic': { sev: 'medium', label: 'Unplanned clinic' },
  'unknown-clinician': { sev: 'info', label: 'Not in registry' },
  ok: { sev: 'ok', label: 'In sync' },
};

function runDiff(state, byDate) {
  const results = [];
  for (const [date, payload] of Object.entries(byDate)) {
    const medicusRows = parseOverview(payload);
    const findings = diffDay({
      date,
      medicusRows,
      rotaEntries: state.entries.filter((e) => e.date === date),
      staff: state.staff,
      leaveList: state.leave,
    });
    results.push({ date, medicusRows, findings });
  }
  results.sort((a, b) => a.date.localeCompare(b.date));
  return results;
}

export default {
  render(root, ctx) {
    const { state } = ctx;
    const code = (state.settings.practiceCode || '').trim();
    const results = state.ui.syncResults || null;
    const errors = state.ui.syncErrors || [];
    const allFindings = results ? results.flatMap((r) => r.findings) : [];
    const summary = summariseFindings(allFindings);
    const unknownNames = [
      ...new Set(allFindings.filter((f) => f.kind === 'unknown-clinician').map((f) => f.staffName)),
    ];

    root.innerHTML = `
      <h1>Live sync — rota vs Medicus appointment book</h1>
      <p class="sub">Reads the appointment book for the selected week straight from Medicus (read-only, via your logged-in
      session) and diffs it against the planned rota: clinics that should exist but don't, ghost clinics for people on
      leave, and clinicians the rota doesn't know about. Patient data is counted on screen and never stored.</p>
      <div class="toolbar">
        <span>Week of <strong>${esc(fmtDay(state.weekMonday))}</strong> (set on the Rota page)</span>
        <span class="spacer"></span>
        <button id="run" class="primary" ${isValidPracticeCode(code) ? '' : 'disabled title="Set your practice code in Settings first"'}>Run live check</button>
        <button id="demo">Run with sample data</button>
      </div>
      ${isValidPracticeCode(code) ? '' : '<div class="card"><span class="sev info">info</span> No valid practice code configured — set it in Settings to run a live check. The sample-data run works without one.</div>'}
      ${errors.length ? `<div class="card">${errors.map((e) => `<div class="warn"><span class="sev high">fetch</span><span>${esc(e)}</span></div>`).join('')}</div>` : ''}
      ${
        results
          ? `
        <div class="cards">
          ${['missing-clinic', 'ghost-clinic', 'unplanned-clinic', 'unknown-clinician', 'ok']
            .map(
              (k) => `
            <div class="card"><div class="kpi ${k === 'ok' ? 'good' : summary[k] ? 'bad' : ''}">${summary[k]}</div><div class="sub">${esc(KIND_LABELS[k].label)}</div></div>
          `
            )
            .join('')}
        </div>
        ${
          unknownNames.length
            ? `
          <div class="card">
            <h2 class="mt0">Import clinicians from Medicus</h2>
            ${unknownNames.map((n) => `<div class="toolbar" style="margin-bottom:4px"><span>${esc(n)}</span><span class="spacer"></span><button class="small" data-import="${esc(n)}">Add to staff</button></div>`).join('')}
          </div>`
            : ''
        }
        ${results
          .map(
            (r) => `
          <div class="card">
            <h2 class="mt0">${esc(fmtDay(r.date))}</h2>
            ${
              r.findings
                .filter((f) => f.kind !== 'ok')
                .map(
                  (f) => `
              <div class="warn"><span class="sev ${esc(KIND_LABELS[f.kind].sev)}">${esc(KIND_LABELS[f.kind].label)}</span><span>${esc(f.message)}</span></div>
            `
                )
                .join('') || '<div class="sub">No discrepancies.</div>'
            }
            ${
              r.findings.some((f) => f.kind === 'ok')
                ? `
              <details style="margin-top:8px"><summary class="sub">${r.findings.filter((f) => f.kind === 'ok').length} session(s) in sync</summary>
                ${r.findings
                  .filter((f) => f.kind === 'ok')
                  .map((f) => `<div class="warn"><span class="sev ok">ok</span><span>${esc(f.message)}</span></div>`)
                  .join('')}
              </details>`
                : ''
            }
          </div>
        `
          )
          .join('')}
      `
          : `<div class="card"><div class="empty-state"><h3>No check run yet</h3><p>Run a live check or sample check above to compare the rota against the Medicus appointment book.</p></div></div>`
      }
    `;

    root.querySelector('#run').onclick = async () => {
      ctx.toast('Fetching appointment book from Medicus…');
      const dates = weekDates(state.weekMonday).filter((d) => state.settings.openDays.includes(dayKey(d)));
      try {
        const { byDate, errors: errs } = await fetchOverviewRange(code, dates);
        state.ui.syncResults = runDiff(state, byDate);
        state.ui.syncErrors = errs.length
          ? [...errs, 'Tip: you must be signed in to Medicus in this browser profile.']
          : [];
      } catch (err) {
        state.ui.syncResults = null;
        state.ui.syncErrors = [err instanceof Error ? err.message : String(err)];
      }
      ctx.rerender();
    };

    root.querySelector('#demo').onclick = () => {
      const dates = weekDates(state.weekMonday)
        .filter((d) => state.settings.openDays.includes(dayKey(d)))
        .slice(0, 2);
      const byDate = Object.fromEntries(dates.map((d) => [d, demoOverviewPayload(state.staff, d)]));
      state.ui.syncResults = runDiff(state, byDate);
      state.ui.syncErrors = [];
      ctx.toast('Sample reconciliation complete');
      ctx.rerender();
    };

    root.querySelectorAll('[data-import]').forEach((btn) => {
      btn.onclick = async () => {
        const name = btn.dataset.import;
        state.staff.push(newStaff({ id: uid(), name, medicusName: name, role: 'gp', employmentType: 'salaried' }));
        await ctx.persist('staff');
        ctx.toast(`${name} added — review their details under Staff`);
        // Refresh the diff so they stop showing as unknown.
        if (state.ui.syncResults) {
          state.ui.syncResults = state.ui.syncResults.map((r) => ({
            ...r,
            findings: diffDay({
              date: r.date,
              medicusRows: r.medicusRows,
              rotaEntries: state.entries.filter((e) => e.date === r.date),
              staff: state.staff,
              leaveList: state.leave,
            }),
          }));
        }
        ctx.rerender();
      };
    });
  },
};
