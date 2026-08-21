// Leave accounting and guardrails. Entitlements are counted in SESSIONS
// (the BMA publishes a calculator precisely because day-counting breaks for
// part-timers): a leave request consumes one session per templated/rostered
// session it punches out.

import {
  datesInRange,
  dayKey,
  leaveYearStart,
  templateWeekIndex,
  diffDays,
  todayISO,
  addDays,
} from '../shared/time.js';
import { roleById, typeById, leaveTypeById, periodsFor } from '../shared/model.js';

export function approvedLeaveFor(leaveList, staffId, dateISO) {
  return (
    leaveList.find(
      (l) => l.staffId === staffId && l.status === 'approved' && l.startDate <= dateISO && l.endDate >= dateISO
    ) || null
  );
}

function anyLeaveOn(leaveList, staffId, dateISO, statuses) {
  return (
    leaveList.find(
      (l) => l.staffId === staffId && statuses.includes(l.status) && l.startDate <= dateISO && l.endDate >= dateISO
    ) || null
  );
}

// How many sessions a date range costs a given staff member.
// Rostered entries are the truth where they exist; otherwise fall back to
// the working pattern.
function sessionCostOnDate(staffMember, date, entries, settings, rangeStartISO) {
  const bankHolidays = settings.bankHolidays || [];
  if (bankHolidays.includes(date)) return 0;
  let count = 0;
  for (const period of periodsFor(settings)) {
    const entry = entries.find(
      (e) => e.staffId === staffMember.id && e.date === date && e.period === period && e.status !== 'cancelled'
    );
    if (entry) {
      count += 1;
      continue;
    }
    const pattern = staffMember.pattern || [];
    if (!pattern.length) continue;
    const anchor = settings.templateAnchorMonday || rangeStartISO || date;
    const week = pattern[templateWeekIndex(anchor, date, pattern.length)];
    if (week && week[dayKey(date)] && week[dayKey(date)][period]) count += 1;
  }
  return count;
}

export function sessionsInRange(staffMember, startISO, endISO, entries, settings) {
  let count = 0;
  for (const date of datesInRange(startISO, endISO)) {
    count += sessionCostOnDate(staffMember, date, entries, settings, startISO);
  }
  return count;
}

export function sessionsByLeaveYear(staffMember, startISO, endISO, entries, settings) {
  const byYear = {};
  for (const date of datesInRange(startISO, endISO)) {
    const cost = sessionCostOnDate(staffMember, date, entries, settings, startISO);
    if (!cost) continue;
    const ys = leaveYearStart(date);
    byYear[ys] = (byYear[ys] || 0) + cost;
  }
  return byYear;
}

// Balance for a counted leave type (annual/study) in the leave year of asOf.
export function leaveBalance(staffMember, leaveList, type, asOfISO) {
  const yearStart = leaveYearStart(asOfISO);
  const entitled = (staffMember.entitlement && staffMember.entitlement[type]) || 0;
  const used = leaveList
    .filter(
      (l) =>
        l.staffId === staffMember.id &&
        l.type === type &&
        l.status === 'approved' &&
        leaveYearStart(l.startDate) === yearStart
    )
    .reduce((sum, l) => sum + (l.sessions || 0), 0);
  return { entitled, used, remaining: entitled - used };
}

// TOIL doesn't reset with the leave year: balance = sessions banked minus
// approved TOIL leave, all time.
export function toilBalance(staffMember, leaveList) {
  const accrued = staffMember.toilAccrued || 0;
  const spent = leaveList
    .filter((l) => l.staffId === staffMember.id && l.type === 'toil' && l.status === 'approved')
    .reduce((sum, l) => sum + (l.sessions || 0), 0);
  return { accrued, spent, remaining: accrued - spent };
}

// Guardrails evaluated when a request is submitted or about to be approved.
// Returns the session cost plus human-readable warnings; the manager keeps
// the final say (warn, don't hard-block).
export function checkLeaveRequest(req, { staff, leaveList, entries, settings }) {
  const warnings = [];
  const person = staff.find((s) => s.id === req.staffId);
  if (!person) return { sessions: 0, warnings: [{ severity: 'high', message: 'Unknown staff member' }] };

  const sessions = sessionsInRange(person, req.startDate, req.endDate, entries, settings);
  const byYear = sessionsByLeaveYear(person, req.startDate, req.endDate, entries, settings);

  const lt = leaveTypeById(req.type);
  if (lt && lt.counted) {
    const others = leaveList.filter((l) => l.id !== req.id);
    for (const [yearStart, yearSessions] of Object.entries(byYear)) {
      const bal = leaveBalance(person, others, req.type, yearStart);
      if (yearSessions > bal.remaining) {
        warnings.push({
          severity: 'high',
          message: `${person.name}: request costs ${yearSessions} sessions in the ${yearStart} leave year but only ${bal.remaining} of ${bal.entitled} ${lt.name.toLowerCase()} sessions remain that year`,
        });
      }
    }
  }

  if (req.type === 'toil') {
    const bal = toilBalance(
      person,
      leaveList.filter((l) => l.id !== req.id)
    );
    if (sessions > bal.remaining) {
      warnings.push({
        severity: 'high',
        message: `${person.name}: request costs ${sessions} TOIL sessions but only ${bal.remaining} are banked (${bal.accrued} accrued, ${bal.spent} taken)`,
      });
    }
  }

  // Simultaneous-absence cap per role group (local policy, configurable).
  const group = (roleById(person.role) || {}).group || 'nonclinical';
  const cap = (settings.maxSimultaneousLeave || {})[group];
  if (cap != null) {
    for (const date of datesInRange(req.startDate, req.endDate)) {
      const others = leaveList.filter((l) => {
        if (l.id === req.id || l.staffId === req.staffId) return false;
        if (l.status !== 'approved') return false;
        if (l.startDate > date || l.endDate < date) return false;
        const other = staff.find((s) => s.id === l.staffId);
        return other && (roleById(other.role) || {}).group === group;
      });
      if (others.length >= cap) {
        const names = others.map((l) => (staff.find((s) => s.id === l.staffId) || {}).name).filter(Boolean);
        warnings.push({
          severity: 'medium',
          message: `${date}: already ${others.length} ${group} staff on approved leave (${names.join(', ')}) — cap is ${cap}`,
        });
        break; // one clash message per request is enough to flag it
      }
    }
  }

  // Seasonal caps (local policy): total counted leave within a configured
  // peak period (school holidays, Christmas, summer) per person.
  if (lt && lt.counted) {
    for (const peak of settings.peakPeriods || []) {
      if (req.endDate < peak.start || req.startDate > peak.end) continue;
      const overlapStart = req.startDate > peak.start ? req.startDate : peak.start;
      const overlapEnd = req.endDate < peak.end ? req.endDate : peak.end;
      const thisCost = sessionsInRange(person, overlapStart, overlapEnd, entries, settings);
      const already = leaveList
        .filter(
          (l) =>
            l.id !== req.id &&
            l.staffId === person.id &&
            l.status === 'approved' &&
            leaveTypeById(l.type) &&
            leaveTypeById(l.type).counted &&
            l.startDate <= peak.end &&
            l.endDate >= peak.start
        )
        .reduce((sum, l) => {
          const s = l.startDate > peak.start ? l.startDate : peak.start;
          const e = l.endDate < peak.end ? l.endDate : peak.end;
          return sum + sessionsInRange(person, s, e, entries, settings);
        }, 0);
      if (already + thisCost > peak.maxSessions) {
        warnings.push({
          severity: 'medium',
          message: `${person.name}: ${already + thisCost} leave sessions in "${peak.name}" (${peak.start} – ${peak.end}) — local cap is ${peak.maxSessions}`,
        });
      }
    }
  }

  // Coverage impact: duty sessions and registrar supervision this person provides.
  for (const date of datesInRange(req.startDate, req.endDate)) {
    for (const period of periodsFor(settings)) {
      const entry = entries.find(
        (e) =>
          e.staffId === person.id &&
          e.date === date &&
          e.period === period &&
          e.status !== 'cancelled' &&
          e.status !== 'vacancy'
      );
      if (entry && entry.typeId === 'duty') {
        warnings.push({
          severity: 'high',
          message: `${person.name} is the duty doctor on ${date} ${period.toUpperCase()} — cover must be reassigned`,
        });
      }
    }
  }

  return { sessions, warnings };
}

// Approving leave punches out the rota: clinical sessions become vacancies
// (a cover worklist), non-clinical sessions are simply removed.
export function applyApprovedLeave(req, entries) {
  const updated = [];
  const removedIds = new Set();
  let vacancies = 0;
  for (const e of entries) {
    if (e.staffId !== req.staffId || e.date < req.startDate || e.date > req.endDate) {
      updated.push(e);
      continue;
    }
    const t = typeById(e.typeId);
    if (t && t.clinical) {
      updated.push({ ...e, status: 'vacancy', note: `Cover needed — ${req.type} leave` });
      vacancies += 1;
    } else {
      removedIds.add(e.id);
    }
  }
  return { entries: updated, vacancies, removed: removedIds.size };
}

// Fit-note (Med3) and return-to-work compliance on sickness episodes.
// Self-certification covers the first 7 calendar days; after that an
// ongoing absence needs a fit note, and ended episodes need a recorded
// return-to-work conversation (flagged for 30 days, then dropped).
export function fitNoteFlags(leaveList, staff, asOfISO = todayISO()) {
  const flags = [];
  for (const l of leaveList.filter((x) => x.type === 'sick' && x.status === 'approved')) {
    const person = staff.find((s) => s.id === l.staffId);
    const name = person ? person.name : '?';
    const ongoing = l.endDate >= asOfISO && l.startDate <= asOfISO;
    if (ongoing) {
      const days = diffDays(l.startDate, asOfISO) + 1;
      if (!l.fitNoteUntil && days > 7) {
        flags.push({
          severity: 'high',
          leaveId: l.id,
          message: `${name}: off sick ${days} days with no fit note recorded (self-certification covers 7)`,
        });
      } else if (l.fitNoteUntil && l.fitNoteUntil < asOfISO) {
        flags.push({
          severity: 'high',
          leaveId: l.id,
          message: `${name}: fit note expired on ${l.fitNoteUntil} but they are still off`,
        });
      } else if (l.fitNoteUntil && l.fitNoteUntil <= addDays(asOfISO, 7)) {
        flags.push({
          severity: 'medium',
          leaveId: l.id,
          message: `${name}: fit note expires ${l.fitNoteUntil} — chase a renewal or plan the return`,
        });
      }
    } else if (l.endDate < asOfISO && !l.rtwDone && diffDays(l.endDate, asOfISO) <= 30) {
      flags.push({
        severity: 'medium',
        leaveId: l.id,
        message: `${name}: return-to-work conversation not recorded after sickness ending ${l.endDate}`,
      });
    }
  }
  return flags;
}

// Sickness episodes ≥ 2 weeks qualify for SFE locum-cover reimbursement —
// flag any approaching or past the threshold so the money isn't missed.
export function sfeReimbursementFlags(leaveList, staff, asOfISO = todayISO()) {
  return leaveList
    .filter((l) => l.type === 'sick' && l.status === 'approved')
    .map((l) => {
      const end = l.endDate < asOfISO ? l.endDate : asOfISO;
      const days = diffDays(l.startDate, end) + 1;
      const person = staff.find((s) => s.id === l.staffId);
      return {
        leaveId: l.id,
        name: person ? person.name : '?',
        days,
        eligible: days > 14,
        nearing: days >= 10 && days <= 14,
      };
    })
    .filter((f) => f.eligible || f.nearing);
}
