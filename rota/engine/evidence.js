// CQC evidence pack: a self-contained printable HTML report showing the
// practice's safe-staffing rules and the compliance record over a period —
// the Regulation 18 "evidence your own safe-staffing logic" artefact,
// generated as a by-product of running the rota.

import { esc } from '../shared/esc.js';
import { weekDates, addDays, fmtDay, dayKey } from '../shared/time.js';
import { checkWeek, capacitySummary } from './rules.js';
import { leaveTypeById } from '../shared/model.js';
import { bradfordRows } from './bradford.js';

export function buildEvidenceReport({
  startMonday,
  weeks,
  staff,
  entries,
  leave,
  rooms,
  settings,
  audit = [],
  generatedBy = '',
}) {
  const weekRows = [];
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(startMonday, w * 7);
    const dates = weekDates(monday);
    const warnings = checkWeek({ dates, entries, staff, leaveList: leave, settings, rooms });
    const cap = capacitySummary({ dates, entries, staff, leaveList: leave, settings });
    const count = (kind) => warnings.filter((x) => x.kind === kind).length;
    const openSlots =
      dates.filter((d) => settings.openDays.includes(dayKey(d)) && !(settings.bankHolidays || []).includes(d)).length *
      2;
    weekRows.push({
      monday,
      label: `${fmtDay(dates[0])} – ${fmtDay(dates[6])}`,
      dutyGaps: count('duty'),
      openSlots,
      supervision: count('supervision'),
      hca: count('hca'),
      rooms: count('room'),
      vacancies: count('vacancy'),
      capacity: cap,
    });
  }

  const endDate = addDays(startMonday, weeks * 7 - 1);
  const leaveInPeriod = leave.filter(
    (l) => l.status === 'approved' && l.startDate <= endDate && l.endDate >= startMonday
  );
  const leaveByType = {};
  for (const l of leaveInPeriod) {
    leaveByType[l.type] = (leaveByType[l.type] || 0) + (l.sessions || 0);
  }
  const bradford = bradfordRows({ staff, leaveList: leave, settings, asOf: endDate });
  const totalDutyGaps = weekRows.reduce((s, r) => s + r.dutyGaps, 0);
  const totalSlots = weekRows.reduce((s, r) => s + r.openSlots, 0);
  const dutyCoverPct = totalSlots ? Math.round(((totalSlots - totalDutyGaps) / totalSlots) * 100) : 100;

  const row = (r) => `
    <tr>
      <td>${esc(r.label)}</td>
      <td class="${r.dutyGaps ? 'bad' : 'good'}">${r.dutyGaps ? `${r.dutyGaps} gap(s)` : 'Full'}</td>
      <td class="${r.supervision ? 'bad' : 'good'}">${r.supervision || '—'}</td>
      <td class="${r.hca ? 'warn' : 'good'}">${r.hca || '—'}</td>
      <td class="${r.rooms ? 'warn' : 'good'}">${r.rooms || '—'}</td>
      <td class="${r.vacancies ? 'warn' : 'good'}">${r.vacancies || '—'}</td>
      <td>${r.capacity.estimated} / ${r.capacity.target}</td>
    </tr>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Safe-staffing evidence pack</title>
<style>
  body { font: 13px/1.5 system-ui, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 20px; margin-bottom: 2px; } h2 { font-size: 15px; margin: 22px 0 6px; }
  .sub { color: #555; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin-top: 6px; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; font-size: 12px; }
  th { background: #f2f2f2; }
  .good { color: #047857; } .warn { color: #b45309; } .bad { color: #b91c1c; font-weight: 700; }
  @media print { body { margin: 12mm; } }
</style></head><body>
  <h1>Safe-staffing evidence pack</h1>
  <div class="sub">Period: ${esc(fmtDay(startMonday))} – ${esc(fmtDay(endDate))} (${weeks} weeks) ·
    Generated ${esc(new Date().toLocaleString('en-GB'))}${generatedBy ? ` by ${esc(generatedBy)}` : ''} ·
    Medicus Rota Manager</div>

  <h2>Safe-staffing rules in force</h2>
  <table>
    <tr><th>Rule</th><th>Standard applied</th></tr>
    <tr><td>Duty doctor cover</td><td>${esc(String(settings.dutyRequired.am))} AM / ${esc(String(settings.dutyRequired.pm))} PM duty doctor(s) every open day (core hours 8:00–18:30)</td></tr>
    <tr><td>Registrar supervision</td><td>Named eligible supervising GP (partner/salaried, never a locum) co-rostered for every registrar clinical session</td></tr>
    <tr><td>HCA delegation</td><td>Registered professional on site for every HCA clinical session</td></tr>
    <tr><td>Access capacity</td><td>${esc(String(settings.accessBenchmarkPer1000))} appointments / 1,000 patients / week benchmark (list size ${Number(settings.listSize).toLocaleString()})</td></tr>
    <tr><td>Leave clash caps</td><td>Max simultaneous leave — GP: ${esc(String(settings.maxSimultaneousLeave.gp))}, nursing: ${esc(String(settings.maxSimultaneousLeave.nursing))}, ARRS: ${esc(String(settings.maxSimultaneousLeave.arrs))}, non-clinical: ${esc(String(settings.maxSimultaneousLeave.nonclinical))}</td></tr>
    <tr><td>Sickness monitoring</td><td>Fit notes from day 8, return-to-work recorded, Bradford Factor reviewed at ${esc(String(settings.bradfordThresholds.monitor))}/${esc(String(settings.bradfordThresholds.high))}/${esc(String(settings.bradfordThresholds.severe))}</td></tr>
  </table>

  <h2>Weekly compliance record — duty cover ${dutyCoverPct}% of ${totalSlots} sessions</h2>
  <table>
    <tr><th>Week</th><th>Duty cover</th><th>Supervision breaches</th><th>HCA cover</th><th>Room clashes</th><th>Uncovered sessions</th><th>Capacity (est / target)</th></tr>
    ${weekRows.map(row).join('')}
  </table>

  <h2>Leave &amp; absence in period</h2>
  <table>
    <tr><th>Type</th><th>Approved sessions</th></tr>
    ${
      Object.entries(leaveByType)
        .map(([t, n]) => `<tr><td>${esc((leaveTypeById(t) || { name: t }).name)}</td><td>${n}</td></tr>`)
        .join('') || '<tr><td colspan="2">None</td></tr>'
    }
  </table>
  ${
    bradford.length
      ? `
  <h2>Bradford Factor (rolling 52 weeks at period end)</h2>
  <table>
    <tr><th>Staff</th><th>Episodes</th><th>Working days</th><th>Score</th><th>Band</th></tr>
    ${bradford.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.episodes}</td><td>${r.days}</td><td>${r.score}</td><td class="${r.band === 'ok' ? 'good' : r.band === 'monitor' ? 'warn' : 'bad'}">${esc(r.band)}</td></tr>`).join('')}
  </table>`
      : ''
  }
  ${
    audit.length
      ? `
  <h2>Change log (most recent ${Math.min(audit.length, 30)})</h2>
  <table>
    <tr><th>When</th><th>Who</th><th>Action</th></tr>
    ${audit
      .slice(-30)
      .reverse()
      .map(
        (a) =>
          `<tr><td>${esc(new Date(a.at).toLocaleString('en-GB'))}</td><td>${esc(a.by || '—')}</td><td>${esc(a.summary)}</td></tr>`
      )
      .join('')}
  </table>`
      : ''
  }
  <p class="sub">Thresholds encode national guidance (BMA safe working, CQC Regulation 18, NHSE access benchmark) configured to local policy.
  Warnings inform professional judgement; they do not hard-block rostering decisions. No patient-identifiable data is held by this system.</p>
</body></html>`;
}
