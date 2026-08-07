// Fair duty-doctor auto-assignment. Convention: on-call frequency pro-rata
// to sessions worked. For each open AM/PM lacking duty cover, convert the
// surgery/triage session of the duty-eligible GP carrying the lowest
// duty debt (history + this run) into a duty session.

import { dayKey } from '../shared/time.js';
import { approvedLeaveFor } from './leave.js';

const CONVERTIBLE = ['surgery', 'triage'];

export function autoAssignDuty({ dates, entries, staff, leaveList, settings, historyEntries = [] }) {
  const debt = {};
  for (const person of staff) {
    if (!person.dutyEligible || person.role !== 'gp') continue;
    const past = historyEntries.filter(
      (e) => e.staffId === person.id && e.typeId === 'duty' && e.status !== 'cancelled' && e.status !== 'vacancy'
    ).length;
    debt[person.id] = { count: past, contracted: Math.max(person.contractedSessions || 1, 1) };
  }

  const changes = [];
  const unfilled = [];
  const changedType = {}; // entryId -> new typeId within this run

  for (const date of dates) {
    if (!settings.openDays.includes(dayKey(date))) continue;
    for (const period of ['am', 'pm']) {
      const required = (settings.dutyRequired || {})[period] ?? 1;
      const slot = entries.filter(
        (e) => e.date === date && e.period === period && (e.status === 'planned' || e.status === 'confirmed')
      );
      const effType = (e) => changedType[e.id] || e.typeId;

      let covered = slot.filter((e) => {
        const person = staff.find((s) => s.id === e.staffId);
        return effType(e) === 'duty' && person && person.dutyEligible && !approvedLeaveFor(leaveList, person.id, date);
      }).length;

      while (covered < required) {
        const candidates = slot
          .filter((e) => {
            const person = staff.find((s) => s.id === e.staffId);
            return (
              person &&
              person.dutyEligible &&
              person.role === 'gp' &&
              debt[person.id] &&
              CONVERTIBLE.includes(effType(e)) &&
              !approvedLeaveFor(leaveList, person.id, date)
            );
          })
          .sort((a, b) => {
            const da = debt[a.staffId],
              db = debt[b.staffId];
            const diff = da.count / da.contracted - db.count / db.contracted;
            if (diff !== 0) return diff;
            const na = (staff.find((s) => s.id === a.staffId) || {}).name || '';
            const nb = (staff.find((s) => s.id === b.staffId) || {}).name || '';
            return na.localeCompare(nb); // deterministic tie-break
          });

        const pick = candidates[0];
        if (!pick) {
          unfilled.push({ date, period });
          break;
        }
        changes.push({ entryId: pick.id, staffId: pick.staffId, date, period, from: effType(pick), to: 'duty' });
        changedType[pick.id] = 'duty';
        debt[pick.staffId].count += 1;
        covered += 1;
      }
    }
  }
  return { changes, unfilled };
}

export function applyDutyChanges(entries, changes) {
  const byId = Object.fromEntries(changes.map((c) => [c.entryId, c]));
  return entries.map((e) => (byId[e.id] ? { ...e, typeId: 'duty', source: 'auto-duty' } : e));
}
