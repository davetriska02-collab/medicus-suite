// The cover assistant: given a vacancy (someone off sick / on leave),
// rank who could plausibly take the session — same role group, free that
// period, not on leave. Staff with unrostered contracted capacity rank
// first (no extra cost), then anyone willing to do an extra session,
// then locums (a booking, not a favour).

import { roleById } from '../shared/model.js';
import { approvedLeaveFor } from './leave.js';
import { mondayOf, weekDates } from '../shared/time.js';
import { uid } from '../shared/uid.js';

const ACTIVE = ['planned', 'confirmed', 'covered'];

export function rankCover({ vacancy, staff, entries, leaveList }) {
  const absent = staff.find((s) => s.id === vacancy.staffId);
  const group = absent ? (roleById(absent.role) || {}).group : 'gp';
  const week = weekDates(mondayOf(vacancy.date));
  const candidates = [];

  for (const c of staff) {
    if (c.id === vacancy.staffId) continue;
    if (c.notAPerson) continue;
    if ((roleById(c.role) || {}).group !== group) continue;
    if (vacancy.typeId === 'duty' && !(c.dutyEligible && c.role === 'gp')) continue;
    if (approvedLeaveFor(leaveList, c.id, vacancy.date)) continue;
    const busy = entries.some(
      (e) => e.staffId === c.id && e.date === vacancy.date && e.period === vacancy.period && e.status !== 'cancelled'
    );
    if (busy) continue;

    const rostered = entries.filter(
      (e) => e.staffId === c.id && week.includes(e.date) && ACTIVE.includes(e.status)
    ).length;
    const isLocum = c.employmentType === 'locum';
    const spare = (c.contractedSessions || 0) - rostered;
    candidates.push({
      staffId: c.id,
      name: c.name,
      isLocum,
      spare,
      rostered,
      reason: isLocum
        ? 'locum — book a session'
        : spare > 0
          ? `${spare} contracted session(s) unrostered this week`
          : `extra session (already at ${rostered}/${c.contractedSessions})`,
    });
  }

  candidates.sort((a, b) => {
    if (a.isLocum !== b.isLocum) return a.isLocum ? 1 : -1;
    if (b.spare !== a.spare) return b.spare - a.spare;
    return a.name.localeCompare(b.name);
  });
  return candidates;
}

// Assigning cover: the vacancy is marked covered (audit trail of who was
// originally rostered) and the covering person gets a real session of the
// same type, inheriting the freed room.
export function applyCover({ vacancy, candidate, entries }) {
  const newEntry = {
    id: uid(),
    staffId: candidate.staffId,
    date: vacancy.date,
    period: vacancy.period,
    typeId: vacancy.typeId,
    status: 'planned',
    source: 'cover',
    note: `Covering for absence`,
    roomId: vacancy.roomId || null,
  };
  const updated = entries.map((e) =>
    e.id === vacancy.id ? { ...e, status: 'covered', note: `Covered by ${candidate.name}` } : e
  );
  return { entries: [...updated, newEntry], newEntry };
}
