// Shift-swap proposals: a clinician offers to trade one of their sessions
// with a colleague's; the manager approves and the two sessions exchange
// people (sessions stay where they are, the staff swap).

import { roleById } from '../shared/model.js';
import { approvedLeaveFor } from './leave.js';

export function validateSwap({ entryA, entryB, staff, leaveList }) {
  const errors = [];
  if (!entryA || !entryB) return ['Both sessions must exist'];
  if (entryA.id === entryB.id) return ['Pick two different sessions'];
  if (entryA.staffId === entryB.staffId) errors.push('Both sessions belong to the same person');
  const a = staff.find((s) => s.id === entryA.staffId);
  const b = staff.find((s) => s.id === entryB.staffId);
  if (!a || !b) return ['Unknown staff member'];
  if ((roleById(a.role) || {}).group !== (roleById(b.role) || {}).group) {
    errors.push(`${a.name} (${a.role}) and ${b.name} (${b.role}) are different role groups`);
  }
  if (approvedLeaveFor(leaveList, entryA.staffId, entryB.date)) {
    errors.push(`${a.name} is on leave on ${entryB.date}`);
  }
  if (approvedLeaveFor(leaveList, entryB.staffId, entryA.date)) {
    errors.push(`${b.name} is on leave on ${entryA.date}`);
  }
  return errors;
}

export function applySwap(swap, entries) {
  const a = entries.find((e) => e.id === swap.entryAId);
  const b = entries.find((e) => e.id === swap.entryBId);
  if (!a || !b) return { entries, ok: false };
  const updated = entries.map((e) => {
    if (e.id === a.id) return { ...e, staffId: b.staffId, source: 'swap' };
    if (e.id === b.id) return { ...e, staffId: a.staffId, source: 'swap' };
    return e;
  });
  return { entries: updated, ok: true };
}
