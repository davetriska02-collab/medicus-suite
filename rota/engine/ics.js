// ICS (RFC 5545) calendar export: one clinician's rota as VEVENTs so they
// can subscribe their phone/Outlook to their own sessions. Floating local
// times by design — UK practices, local wall-clock sessions.

import { typeById } from '../shared/model.js';

const PERIOD_TIMES = {
  early: ['070000', '080000'],
  am: ['080000', '130000'],
  pm: ['130000', '183000'],
  eve: ['183000', '200000'],
};
const EXPORTABLE = ['planned', 'confirmed', 'covered'];

function icsEscape(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

export function staffICS({ person, entries, rooms = [] }) {
  const events = entries
    .filter((e) => e.staffId === person.id && EXPORTABLE.includes(e.status))
    .sort((a, b) => `${a.date}${a.period}`.localeCompare(`${b.date}${b.period}`))
    .map((e) => {
      const t = typeById(e.typeId);
      const day = e.date.replace(/-/g, '');
      const [start, end] = PERIOD_TIMES[e.period] || PERIOD_TIMES.am;
      const room = rooms.find((r) => r.id === e.roomId);
      return [
        'BEGIN:VEVENT',
        `UID:${e.id}@medicus-rota-manager`,
        `DTSTART:${day}T${start}`,
        `DTEND:${day}T${end}`,
        `SUMMARY:${icsEscape(`${t ? t.name : e.typeId} (${e.period.toUpperCase()})`)}`,
        ...(room ? [`LOCATION:${icsEscape(room.name)}`] : []),
        ...(e.note ? [`DESCRIPTION:${icsEscape(e.note)}`] : []),
        'END:VEVENT',
      ].join('\r\n');
    });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Medicus Rota Manager//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(`Rota — ${person.name}`)}`,
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
