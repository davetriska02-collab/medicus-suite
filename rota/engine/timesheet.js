// Timesheet export: sessions worked per person over a date range, as CSV
// for payroll. Counts only what happened on the rota (active entries);
// hours come from PERIOD_INFO session lengths. Money stays auditable:
// covered (locum-filled) sessions and leave are reported separately.

import { datesInRange } from '../shared/time.js';
import { SESSION_TYPES, LEAVE_TYPES, PERIOD_INFO, roleById, EMPLOYMENT_TYPES } from '../shared/model.js';

const ACTIVE = ['planned', 'confirmed', 'covered'];

export function buildTimesheet({ startDate, endDate, staff, entries, leaveList }) {
  const range = new Set(datesInRange(startDate, endDate));
  return staff.map((person) => {
    const mine = entries.filter((e) => e.staffId === person.id && range.has(e.date) && ACTIVE.includes(e.status));
    const byType = {};
    let minutes = 0;
    let covered = 0;
    for (const e of mine) {
      byType[e.typeId] = (byType[e.typeId] || 0) + 1;
      minutes += (PERIOD_INFO[e.period] || {}).minutes || 0;
      if (e.status === 'covered') covered += 1;
    }
    const leaveByType = {};
    for (const l of leaveList) {
      if (l.staffId !== person.id || l.status !== 'approved') continue;
      if (l.endDate < startDate || l.startDate > endDate) continue;
      leaveByType[l.type] = (leaveByType[l.type] || 0) + (l.sessions || 0);
    }
    return {
      name: person.name,
      role: (roleById(person.role) || {}).name || person.role,
      employment: (EMPLOYMENT_TYPES.find((t) => t.id === person.employmentType) || {}).name || person.employmentType,
      site: person.site || '',
      contracted: person.contractedSessions || 0,
      byType,
      totalSessions: mine.length,
      totalHours: Math.round((minutes / 60) * 10) / 10,
      coveredSessions: covered,
      leaveByType,
    };
  });
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function timesheetCSV({ startDate, endDate, staff, entries, leaveList }) {
  const rows = buildTimesheet({ startDate, endDate, staff, entries, leaveList });
  const header = [
    'Name',
    'Role',
    'Employment',
    'Site',
    'Contracted/wk',
    ...SESSION_TYPES.map((t) => t.short),
    'Total sessions',
    'Total hours',
    'Covered by locum',
    ...LEAVE_TYPES.map((t) => `Leave ${t.short}`),
  ];
  const lines = [
    `Timesheet ${startDate} to ${endDate}`,
    header.map(csvCell).join(','),
    ...rows.map((r) =>
      [
        r.name,
        r.role,
        r.employment,
        r.site,
        r.contracted,
        ...SESSION_TYPES.map((t) => r.byType[t.id] || 0),
        r.totalSessions,
        r.totalHours,
        r.coveredSessions,
        ...LEAVE_TYPES.map((t) => r.leaveByType[t.id] || 0),
      ]
        .map(csvCell)
        .join(',')
    ),
  ];
  return lines.join('\r\n') + '\r\n';
}
