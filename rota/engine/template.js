// Template roll-forward: generate rota entries from each staff member's
// repeating week pattern, punching out approved leave as it goes.
// Never overwrites an existing entry for the same staff/date/period —
// manual edits and prior generations win.

import { datesInRange, dayKey, templateWeekIndex } from '../shared/time.js';
import { typeById, canSupervise, periodsFor } from '../shared/model.js';
import { approvedLeaveFor } from './leave.js';
import { uid } from '../shared/store.js';

export function generateEntries({ staff, startDate, endDate, existingEntries, leaveList, settings }) {
  const existing = new Set(existingEntries.map((e) => `${e.staffId}|${e.date}|${e.period}`));
  const anchor = settings.templateAnchorMonday || startDate;
  const bankHolidays = settings.bankHolidays || [];
  const created = [];

  for (const person of staff) {
    const pattern = person.pattern || [];
    if (!pattern.length) continue;
    for (const date of datesInRange(startDate, endDate)) {
      if (bankHolidays.includes(date)) continue; // practice closed
      const week = pattern[templateWeekIndex(anchor, date, pattern.length)];
      const day = week && week[dayKey(date)];
      if (!day) continue;
      for (const period of periodsFor(settings)) {
        const typeId = day[period];
        if (!typeId || !typeById(typeId)) continue;
        if (existing.has(`${person.id}|${date}|${period}`)) continue;
        const leave = approvedLeaveFor(leaveList, person.id, date);
        const clinical = typeById(typeId).clinical;
        if (leave && !clinical) continue; // no point generating admin for someone away
        created.push({
          id: uid(),
          staffId: person.id,
          date,
          period,
          typeId,
          status: leave ? 'vacancy' : 'planned',
          source: 'template',
          note: leave ? `Cover needed — ${leave.type} leave` : '',
        });
      }
    }
  }

  // Registrar debriefs are real rostered time: when this run created both a
  // registrar clinical session and an eligible supervisor's session in the
  // same slot, note the debrief on the supervisor's session.
  const supervisorsById = Object.fromEntries(staff.filter(canSupervise).map((s) => [s.id, s]));
  const registrarsById = Object.fromEntries(
    staff.filter((s) => s.employmentType === 'registrar').map((s) => [s.id, s])
  );
  for (const reg of created) {
    const regPerson = registrarsById[reg.staffId];
    const t = typeById(reg.typeId);
    if (!regPerson || !t || !t.clinical || reg.status === 'vacancy') continue;
    const sup = created.find(
      (e) => supervisorsById[e.staffId] && e.date === reg.date && e.period === reg.period && e.status !== 'vacancy'
    );
    if (sup && !sup.note.includes('Debrief')) {
      sup.note = sup.note ? `${sup.note}; Debrief — ${regPerson.name}` : `Debrief — ${regPerson.name}`;
    }
  }

  return created;
}
