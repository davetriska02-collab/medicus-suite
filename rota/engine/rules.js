// The compliance rules engine. Evaluates a week of the rota against the
// constraints that make a GP rota safe and CQC-defensible:
//   1. Duty-doctor cover every open AM and PM (core hours 8:00–18:30).
//   2. Registrar clinical sessions need a co-rostered eligible supervisor
//      on site (a partner/salaried supervising GP — never a locum).
//   3. HCA clinical sessions need a registered professional in the building.
//   4. Open vacancies surfaced as a cover worklist.
//   5. Capacity vs the ~72 appointments/1,000 patients/week benchmark.
//   6. Duty fairness: share pro-rata to contracted sessions.
// All warnings, no hard blocks — guidance, not regulation.

import { dayKey, fmtDay } from '../shared/time.js';
import { typeById, roleById, canSupervise, periodsFor, PERIOD_INFO } from '../shared/model.js';
import { approvedLeaveFor } from './leave.js';

const ACTIVE = (e) => e.status === 'planned' || e.status === 'confirmed' || e.status === 'covered';

function rosteredOn(entries, staff, leaveList, date, period) {
  return entries
    .filter((e) => e.date === date && e.period === period && ACTIVE(e))
    .map((e) => ({ entry: e, person: staff.find((s) => s.id === e.staffId) }))
    .filter((x) => x.person && !approvedLeaveFor(leaveList, x.person.id, date));
}

export function checkWeek({ dates, entries, staff, leaveList, settings, rooms = [] }) {
  const warnings = [];
  const weekEntries = entries.filter((e) => dates.includes(e.date));

  const bankHolidays = settings.bankHolidays || [];
  const sites = (settings.sites || []).filter(Boolean);

  for (const date of dates) {
    if (!settings.openDays.includes(dayKey(date))) continue;
    if (bankHolidays.includes(date)) continue; // closed — no cover required
    for (const period of periodsFor(settings)) {
      const present = rosteredOn(weekEntries, staff, leaveList, date, period);

      // 1. Duty cover — core hours (AM/PM) only, per site when the
      // practice runs more than one.
      if (period === 'am' || period === 'pm') {
        const required = (settings.dutyRequired || {})[period] ?? 1;
        const siteGroups = sites.length > 1 ? sites : [null];
        for (const site of siteGroups) {
          const pool = site ? present.filter((x) => (x.person.site || sites[0]) === site) : present;
          const duty = pool.filter((x) => x.entry.typeId === 'duty' && x.person.dutyEligible);
          if (duty.length < required) {
            warnings.push({
              severity: 'high',
              kind: 'duty',
              date,
              period,
              message: `${fmtDay(date)} ${period.toUpperCase()}${site ? ` (${site})` : ''}: no duty doctor rostered (${duty.length}/${required})`,
            });
          }
        }
      }

      // Extended-access periods need a GP physically present (DES rule).
      if ((period === 'early' || period === 'eve') && present.length && !present.some((x) => x.person.role === 'gp')) {
        warnings.push({
          severity: 'medium',
          kind: 'enhanced',
          date,
          period,
          message: `${fmtDay(date)} ${PERIOD_INFO[period].label}: extended-access sessions running with no GP rostered — a GP must be physically present throughout`,
        });
      }

      // Enhanced access sessions inside core hours need a GP physically
      // present (early/eve periods are covered by the check above).
      const enhanced = period === 'am' || period === 'pm' ? present.filter((x) => x.entry.typeId === 'enhanced') : [];
      if (enhanced.length && !enhanced.some((x) => x.person.role === 'gp')) {
        warnings.push({
          severity: 'medium',
          kind: 'enhanced',
          date,
          period,
          message: `${fmtDay(date)} ${period.toUpperCase()}: enhanced access running with no GP rostered on it — a GP must be physically present throughout the EA period`,
        });
      }

      // Registrar VTS half-day is immovable: no clinical session on it.
      for (const { person, entry } of present) {
        if (person.employmentType !== 'registrar' || !person.vtsDay) continue;
        const t = typeById(entry.typeId);
        if (t && t.clinical && person.vtsDay === `${dayKey(date)}-${period}`) {
          warnings.push({
            severity: 'medium',
            kind: 'vts',
            date,
            period,
            staffId: person.id,
            message: `${fmtDay(date)} ${period.toUpperCase()}: ${person.name} is rostered clinically on their VTS half-day (${person.vtsDay.toUpperCase()}) — that teaching time is immovable`,
          });
        }
      }

      // 2. Registrar supervision
      for (const { person, entry } of present) {
        if (person.employmentType !== 'registrar') continue;
        const t = typeById(entry.typeId);
        if (!t || !t.clinical) continue;
        const supervisor = present.find((x) => x.person.id !== person.id && canSupervise(x.person));
        if (!supervisor) {
          warnings.push({
            severity: 'high',
            kind: 'supervision',
            date,
            period,
            staffId: person.id,
            message: `${fmtDay(date)} ${period.toUpperCase()}: ${person.name} (${person.registrarStage || 'GPST'}) has a clinical session with no eligible supervising GP co-rostered`,
          });
        }
      }

      // 3. HCA delegation cover
      for (const { person, entry } of present) {
        if (person.role !== 'hca') continue;
        const t = typeById(entry.typeId);
        if (!t || !t.clinical) continue;
        const registered = present.find((x) => x.person.id !== person.id && (roleById(x.person.role) || {}).registered);
        if (!registered) {
          warnings.push({
            severity: 'medium',
            kind: 'hca',
            date,
            period,
            staffId: person.id,
            message: `${fmtDay(date)} ${period.toUpperCase()}: ${person.name} (HCA) rostered with no registered professional in the building`,
          });
        }
      }
    }
  }

  // 4. Vacancies
  for (const e of weekEntries.filter((x) => x.status === 'vacancy')) {
    const person = staff.find((s) => s.id === e.staffId);
    const t = typeById(e.typeId);
    warnings.push({
      severity: 'medium',
      kind: 'vacancy',
      date: e.date,
      period: e.period,
      staffId: e.staffId,
      message: `${fmtDay(e.date)} ${e.period.toUpperCase()}: ${t ? t.name : e.typeId} session needs cover${person ? ` (was ${person.name})` : ''}${e.note ? ` — ${e.note}` : ''}`,
    });
  }

  // Working Time Regulations (employed staff only — partners are
  // self-employed, locums set their own hours): weekly rostered hours vs
  // the 48h average cap, and at least one rest day in seven. Warn, never
  // block — opt-outs exist and one heavy week within a fair average is lawful.
  const WTR_EMPLOYED = ['salaried', 'registrar', 'employed', 'arrs'];
  const capMinutes = (settings.wtdWeeklyHours || 48) * 60;
  for (const person of staff) {
    if (!WTR_EMPLOYED.includes(person.employmentType)) continue;
    const mine = weekEntries.filter(
      (e) => e.staffId === person.id && ACTIVE(e) && !approvedLeaveFor(leaveList, person.id, e.date)
    );
    if (!mine.length) continue;
    const minutes = mine.reduce((sum, e) => sum + ((PERIOD_INFO[e.period] || {}).minutes || 0), 0);
    if (minutes > capMinutes) {
      warnings.push({
        severity: 'medium',
        kind: 'wtd',
        staffId: person.id,
        message: `WTD: ${person.name} is rostered ${(minutes / 60).toFixed(1)}h this week — over the ${settings.wtdWeeklyHours || 48}h average cap (lawful only with an opt-out and a fair average)`,
      });
    }
    if (new Set(mine.map((e) => e.date)).size >= 7) {
      warnings.push({
        severity: 'medium',
        kind: 'wtd',
        staffId: person.id,
        message: `WTD: ${person.name} is rostered on all seven days this week — no rest day`,
      });
    }
  }

  // Room clashes: two active sessions in the same room at the same time.
  const byRoom = {};
  for (const e of weekEntries.filter(ACTIVE)) {
    if (!e.roomId) continue;
    const key = `${e.date}|${e.period}|${e.roomId}`;
    (byRoom[key] ||= []).push(e);
  }
  for (const [key, list] of Object.entries(byRoom)) {
    if (list.length < 2) continue;
    const [date, period, roomId] = key.split('|');
    const room = rooms.find((r) => r.id === roomId);
    const names = list.map((e) => (staff.find((s) => s.id === e.staffId) || {}).name).filter(Boolean);
    warnings.push({
      severity: 'medium',
      kind: 'room',
      date,
      period,
      message: `${fmtDay(date)} ${period.toUpperCase()}: ${room ? room.name : 'room'} double-booked (${names.join(', ')})`,
    });
  }

  // 5. Capacity vs access benchmark
  const cap = capacitySummary({ dates, entries: weekEntries, staff, leaveList, settings });
  if (cap.target > 0 && cap.estimated < cap.target) {
    warnings.push({
      severity: 'info',
      kind: 'capacity',
      message: `Capacity: ~${cap.estimated} GP appointments rostered this week vs ${cap.target} benchmark (${settings.accessBenchmarkPer1000}/1,000 × list of ${settings.listSize.toLocaleString()})`,
    });
  }

  return warnings;
}

export function capacitySummary({ dates, entries, staff, leaveList, settings }) {
  // Registrar sessions are weighted down: longer appointments and the
  // 70/30 clinical/educational split mean they are not a full GP session.
  const weights = settings.registrarWeights || { early: 0.5, st3: 0.75 };
  let gpClinicalSessions = 0;
  for (const e of entries.filter((x) => dates.includes(x.date) && ACTIVE(x))) {
    const person = staff.find((s) => s.id === e.staffId);
    const t = typeById(e.typeId);
    if (!person || !t || !t.clinical || person.role !== 'gp') continue;
    if (approvedLeaveFor(leaveList, person.id, e.date)) continue;
    if (person.employmentType === 'registrar') {
      gpClinicalSessions += person.registrarStage === 'ST3' ? weights.st3 : weights.early;
    } else {
      gpClinicalSessions += 1;
    }
  }
  gpClinicalSessions = Math.round(gpClinicalSessions * 100) / 100;
  const estimated = Math.round(gpClinicalSessions * (settings.apptsPerSurgerySession || 15));
  const target = Math.round(((settings.listSize || 0) / 1000) * (settings.accessBenchmarkPer1000 || 72));
  return { gpClinicalSessions, estimated, target };
}

// Enhanced Access DES: 60 minutes of appointments per 1,000 patients per
// week, delivered in the extended periods (EARLY 60 min, EVE 90 min).
export function eaSummary({ dates, entries, staff, leaveList, settings }) {
  const extra = settings.extraPeriods || {};
  if (!extra.early && !extra.eve) return null;
  let minutes = 0;
  for (const e of entries.filter((x) => dates.includes(x.date) && ACTIVE(x))) {
    if (e.period !== 'early' && e.period !== 'eve') continue;
    const t = typeById(e.typeId);
    const person = staff.find((s) => s.id === e.staffId);
    if (!t || !t.clinical || !person) continue;
    if (approvedLeaveFor(leaveList, person.id, e.date)) continue;
    minutes += PERIOD_INFO[e.period].minutes;
  }
  const target = Math.round(((settings.listSize || 0) / 1000) * 60);
  return { minutes, target };
}

// 6. Duty fairness over a history window: each duty-eligible GP's duty count
// per contracted session, vs the practice mean. Flags >1.5× the mean.
export function dutyFairness({ entries, staff }) {
  const eligible = staff.filter((s) => s.dutyEligible && s.role === 'gp' && (s.contractedSessions || 0) > 0);
  const rows = eligible.map((person) => {
    const count = entries.filter(
      (e) => e.staffId === person.id && e.typeId === 'duty' && e.status !== 'cancelled' && e.status !== 'vacancy'
    ).length;
    return { staffId: person.id, name: person.name, dutyCount: count, share: count / person.contractedSessions };
  });
  const mean = rows.length ? rows.reduce((s, r) => s + r.share, 0) / rows.length : 0;
  const flagged = mean > 0 ? rows.filter((r) => r.share > mean * 1.5) : [];
  return { rows, mean, flagged };
}
