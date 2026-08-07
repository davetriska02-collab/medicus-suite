// Demand-curve planning. Booked-appointment history (from the appointment
// book) and inbound task arrivals (from the task lists) become a per-weekday
// demand profile, which converts into required clinical sessions and a
// surplus/deficit view against the rostered rota.
//
// Every pulled number is correctable: a day can carry manualAm/manualPm/
// manualTasks overrides (the user's figure wins) or be excluded entirely
// (flu-clinic days, outages). Re-pulls refresh the pulled values and never
// touch corrections.

import { dayKey, diffDays, addDays, datesInRange } from '../shared/time.js';
import { typeById } from '../shared/model.js';
import { approvedLeaveFor } from './leave.js';

export const DEMAND_DEFAULTS = {
  weeksWindow: 8, // how much history feeds the profile
  halfLifeWeeks: 4, // exponential decay; 0 = weight all weeks equally
  bufferPct: 10, // safety margin on top of average demand
  includeTasks: true, // show inbound task load alongside appointments
  tasksDutyThreshold: 60, // avg tasks/day above which a second duty is suggested
};

// Merge a fresh pull into the stored dataset. Pulled fields (am/pm/tasks)
// refresh; user corrections (manual*, excluded, note) are preserved.
export function mergePull({ existing = { days: {} }, rowsByDate = {}, taskCounts = {}, pulledAt = '' }) {
  const days = { ...existing.days };
  for (const [date, rows] of Object.entries(rowsByDate)) {
    let am = 0;
    let pm = 0;
    for (const r of rows) {
      am += (r.am && r.am.booked) || 0;
      pm += (r.pm && r.pm.booked) || 0;
    }
    days[date] = { ...(days[date] || {}), am, pm };
  }
  for (const [date, n] of Object.entries(taskCounts)) {
    days[date] = { ...(days[date] || {}), tasks: n };
  }
  return { days, pulledAt };
}

// The user's correction wins over the pulled figure.
export function effective(day) {
  return {
    am: day.manualAm ?? day.am ?? 0,
    pm: day.manualPm ?? day.pm ?? 0,
    tasks: day.manualTasks ?? day.tasks ?? 0,
  };
}

// Weighted per-weekday averages over the window. Excluded days and bank
// holidays drop out; recent weeks count more when halfLifeWeeks > 0.
export function weekdayProfile({ demand, settings, asOf }) {
  const d = { ...DEMAND_DEFAULTS, ...(settings.demand || {}) };
  const windowStart = addDays(asOf, -7 * d.weeksWindow);
  const bankHolidays = settings.bankHolidays || [];
  const sums = {};
  for (const [date, day] of Object.entries(demand.days || {})) {
    if (date < windowStart || date >= asOf) continue;
    if (day.excluded || bankHolidays.includes(date)) continue;
    const dk = dayKey(date);
    if (!settings.openDays.includes(dk)) continue;
    const ageWeeks = Math.floor(diffDays(date, asOf) / 7);
    const weight = d.halfLifeWeeks > 0 ? Math.pow(0.5, ageWeeks / d.halfLifeWeeks) : 1;
    const v = effective(day);
    const s = (sums[dk] ||= { am: 0, pm: 0, tasks: 0, weight: 0, samples: 0 });
    s.am += v.am * weight;
    s.pm += v.pm * weight;
    s.tasks += v.tasks * weight;
    s.weight += weight;
    s.samples += 1;
  }
  const profile = {};
  for (const [dk, s] of Object.entries(sums)) {
    if (!s.weight) continue;
    profile[dk] = {
      am: Math.round((s.am / s.weight) * 10) / 10,
      pm: Math.round((s.pm / s.weight) * 10) / 10,
      tasks: Math.round((s.tasks / s.weight) * 10) / 10,
      samples: s.samples,
    };
  }
  return profile;
}

// Average demand -> required clinical sessions per weekday/period, with the
// configured safety buffer on top.
export function demandToSessions(profile, settings) {
  const d = { ...DEMAND_DEFAULTS, ...(settings.demand || {}) };
  const perSession = settings.apptsPerSurgerySession || 15;
  const required = {};
  for (const [dk, p] of Object.entries(profile)) {
    required[dk] = {
      am: Math.ceil((p.am * (1 + d.bufferPct / 100)) / perSession),
      pm: Math.ceil((p.pm * (1 + d.bufferPct / 100)) / perSession),
    };
  }
  return required;
}

const ACTIVE = ['planned', 'confirmed', 'covered'];

// Forward look: required vs rostered clinical sessions for a week of dates.
// Booked counts in the appointment book span every clinician, so rostered
// counts every clinical session regardless of role.
export function compareWeek({ dates, entries, staff, leaveList, settings, required }) {
  const bankHolidays = settings.bankHolidays || [];
  const rows = [];
  for (const date of dates) {
    const dk = dayKey(date);
    if (!settings.openDays.includes(dk) || bankHolidays.includes(date)) continue;
    for (const period of ['am', 'pm']) {
      const rostered = entries.filter((e) => {
        if (e.date !== date || e.period !== period || !ACTIVE.includes(e.status)) return false;
        const t = typeById(e.typeId);
        if (!t || !t.clinical) return false;
        const person = staff.find((s) => s.id === e.staffId);
        return person && !approvedLeaveFor(leaveList, person.id, date);
      }).length;
      const req = (required[dk] || {})[period] ?? null;
      rows.push({ date, period, required: req, rostered, delta: req == null ? null : rostered - req });
    }
  }
  return rows;
}

// Past open-weekday dates covering the configured window, oldest first.
export function windowDates(asOf, settings) {
  const d = { ...DEMAND_DEFAULTS, ...(settings.demand || {}) };
  return datesInRange(addDays(asOf, -7 * d.weeksWindow), addDays(asOf, -1)).filter((x) =>
    settings.openDays.includes(dayKey(x))
  );
}
