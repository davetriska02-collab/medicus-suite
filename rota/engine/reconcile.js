// Rota ↔ Medicus appointment-book reconciliation — the feature no rota
// product on the market has live. Diffs the planned rota against what is
// actually built in the Medicus appointment book and surfaces:
//   missing-clinic   rota says they're consulting, no clinic built → lost capacity
//   ghost-clinic     clinic built for someone on approved leave → patients to rebook
//   unplanned-clinic clinic exists that the rota doesn't know about
//   unknown-clinician consulting in Medicus but not in the staff registry → import
// Patient details from the payload are counted, never persisted.

import { typeById } from '../shared/model.js';
import { approvedLeaveFor } from './leave.js';

const norm = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

// Parse one day's embedded-overview payload into per-clinician AM/PM facts.
// AM/PM split at 13:00. Cancelled session blocks are ignored.
export function parseOverview(payload) {
  const rows = [];
  for (const sched of (payload && payload.staffSchedules) || []) {
    const row = {
      name: String(sched.name || '').trim(),
      am: { hasSession: false, slots: 0, booked: 0, f2f: 0 },
      pm: { hasSession: false, slots: 0, booked: 0, f2f: 0 },
    };
    for (const block of sched.schedule || []) {
      if (block && block.summary && block.summary.status && block.summary.status.isCancelled) continue;
      for (const entry of block.entries || []) {
        const start = entry && entry.startDateTime;
        if (!start) continue;
        const hour = Number(String(start).slice(11, 13));
        const period = hour < 13 ? 'am' : 'pm';
        row[period].hasSession = true;
        const kind = entry.diaryEntryType && entry.diaryEntryType.value;
        if (kind === 'slot') {
          row[period].slots += 1;
        } else if (kind === 'appointment') {
          const status = entry.displayStatus && entry.displayStatus.value;
          if (status !== 'cancelled') {
            row[period].booked += 1;
            // Face-to-face needs a physical room; remote/telephone doesn't.
            const mode = entry.deliveryMode && entry.deliveryMode.value;
            if (mode !== 'remote' && mode !== 'telephone') row[period].f2f += 1;
          }
        }
      }
    }
    if (row.name) rows.push(row);
  }
  return rows;
}

function matchStaff(staff, medicusName) {
  const n = norm(medicusName);
  return staff.find((s) => norm(s.medicusName) === n) || staff.find((s) => norm(s.name) === n) || null;
}

// Diff one day. rotaEntries = all entries for this date.
export function diffDay({ date, medicusRows, rotaEntries, staff, leaveList }) {
  const findings = [];
  const matchedNames = new Set();

  // Pass 1: rota → Medicus. Every active clinic-building session should
  // have a matching session in the appointment book.
  for (const e of rotaEntries) {
    if (e.status !== 'planned' && e.status !== 'confirmed' && e.status !== 'covered') continue;
    const t = typeById(e.typeId);
    if (!t || !t.buildsClinic) continue;
    const person = staff.find((s) => s.id === e.staffId);
    if (!person || person.notAPerson) continue;
    if (approvedLeaveFor(leaveList, person.id, date)) continue; // handled by ghost pass
    const row = medicusRows.find((r) => matchStaff([person], r.name));
    if (!row || !row[e.period].hasSession) {
      findings.push({
        kind: 'missing-clinic',
        severity: 'high',
        date,
        period: e.period,
        staffName: person.name,
        message: `${person.name} is rostered for ${t.name} (${e.period.toUpperCase()}) but no clinic is built in Medicus — lost capacity`,
      });
    } else {
      findings.push({
        kind: 'ok',
        severity: 'ok',
        date,
        period: e.period,
        staffName: person.name,
        booked: row[e.period].booked,
        slots: row[e.period].slots,
        message: `${person.name} ${e.period.toUpperCase()}: ${row[e.period].booked} booked, ${row[e.period].slots} free slots`,
      });
    }
  }

  // Pass 2: Medicus → rota.
  for (const row of medicusRows) {
    const person = matchStaff(staff, row.name);
    if (person) matchedNames.add(norm(row.name));
    if (person && person.notAPerson) continue; // directory lane: never a ghost or unplanned clinic
    for (const period of ['am', 'pm']) {
      if (!row[period].hasSession) continue;
      if (!person) continue; // reported once below as unknown-clinician
      const leave = approvedLeaveFor(leaveList, person.id, date);
      if (leave) {
        findings.push({
          kind: 'ghost-clinic',
          severity: 'high',
          date,
          period,
          staffName: person.name,
          booked: row[period].booked,
          message: `Clinic built for ${person.name} (${period.toUpperCase()}) who is on approved ${leave.type} leave — ${row[period].booked} booked patient(s) to rebook`,
        });
        continue;
      }
      const hasRota = rotaEntries.some((e) => {
        const t = typeById(e.typeId);
        return (
          e.staffId === person.id &&
          e.period === period &&
          t &&
          t.buildsClinic &&
          (e.status === 'planned' || e.status === 'confirmed' || e.status === 'covered')
        );
      });
      if (!hasRota) {
        findings.push({
          kind: 'unplanned-clinic',
          severity: 'medium',
          date,
          period,
          staffName: person.name,
          booked: row[period].booked,
          message: `Medicus has a clinic for ${person.name} (${period.toUpperCase()}, ${row[period].booked} booked) but the rota has no clinical session — rota out of date?`,
        });
      }
    }
  }

  // Unknown clinicians: in the appointment book but not the registry.
  for (const row of medicusRows) {
    if (matchedNames.has(norm(row.name))) continue;
    if (!row.am.hasSession && !row.pm.hasSession) continue;
    findings.push({
      kind: 'unknown-clinician',
      severity: 'info',
      date,
      staffName: row.name,
      message: `${row.name} is consulting in Medicus but is not in the staff registry — import them?`,
    });
  }

  return findings;
}

export function summariseFindings(findings) {
  const counts = { 'missing-clinic': 0, 'ghost-clinic': 0, 'unplanned-clinic': 0, 'unknown-clinician': 0, ok: 0 };
  for (const f of findings) if (counts[f.kind] != null) counts[f.kind] += 1;
  return counts;
}
