// Room inference: Medicus doesn't expose room names, but the appointment
// book tells us who consults face-to-face at the same time. Peak concurrent
// F2F clinicians = the number of rooms in use; a greedy colouring of the
// overlap graph then gives each clinician a stable "usual room" that never
// clashes with anyone they actually overlap with.

const norm = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

// A clinician needs a room in a period when they have a session that isn't
// purely remote: any face-to-face booking, or an empty/unbooked clinic
// (assume bookable slots are F2F unless proven otherwise).
function needsRoom(cell) {
  if (!cell || !cell.hasSession) return false;
  if (cell.booked === 0) return true;
  return (cell.f2f || 0) > 0;
}

// rowsByDate: { 'YYYY-MM-DD': parseOverview(payload) }
export function inferRooms({ rowsByDate, staff }) {
  // Directory lanes (NHS 111 etc.) never occupy a physical room.
  const lanes = new Set(
    staff
      .filter((s) => s.notAPerson)
      .flatMap((s) => [norm(s.medicusName), norm(s.name)])
      .filter(Boolean)
  );
  const byName = {}; // norm name -> { name, sessions, slots: Set('date|period') }
  const slotOccupants = {}; // 'date|period' -> [norm names]

  for (const [date, rows] of Object.entries(rowsByDate)) {
    for (const row of rows) {
      const key = norm(row.name);
      if (!key || lanes.has(key)) continue;
      for (const period of ['am', 'pm']) {
        if (!needsRoom(row[period])) continue;
        const rec = (byName[key] ||= { name: row.name, sessions: 0, slots: new Set() });
        rec.sessions += 1;
        rec.slots.add(`${date}|${period}`);
        (slotOccupants[`${date}|${period}`] ||= []).push(key);
      }
    }
  }

  // Peak concurrency over the whole observation window (all clinicians,
  // registered or not — they all needed a room).
  const roomCount = Object.values(slotOccupants).reduce((max, list) => Math.max(max, list.length), 0);

  // Overlap graph between clinicians.
  const overlaps = {}; // norm name -> Set(norm name)
  for (const list of Object.values(slotOccupants)) {
    for (const a of list) {
      for (const b of list) {
        if (a !== b) (overlaps[a] ||= new Set()).add(b);
      }
    }
  }

  // Greedy colouring, busiest first: lowest room index not used by anyone
  // they overlap with. Busiest clinicians get the low-numbered rooms.
  const order = Object.keys(byName).sort(
    (a, b) => byName[b].sessions - byName[a].sessions || byName[a].name.localeCompare(byName[b].name)
  );
  const colour = {};
  for (const key of order) {
    const taken = new Set([...(overlaps[key] || [])].map((o) => colour[o]).filter((c) => c != null));
    let c = 0;
    while (taken.has(c)) c += 1;
    colour[key] = c;
  }

  const matched = [];
  const unmatched = [];
  for (const key of order) {
    const person = staff.find((s) => norm(s.medicusName) === key) || staff.find((s) => norm(s.name) === key);
    if (person) {
      matched.push({ staffId: person.id, name: person.name, roomIndex: colour[key], sessions: byName[key].sessions });
    } else {
      unmatched.push(byName[key].name);
    }
  }

  return { roomCount, assignments: matched, unmatched, datesObserved: Object.keys(rowsByDate).length };
}

// Fill rooms across a week of rota entries: each clinic-building clinical
// session without a room gets its owner's usual room, falling back to the
// lowest-indexed room free in that slot. Returns proposed updates only.
export function fillRooms({ dates, entries, staff, rooms, typeById }) {
  const updates = [];
  const used = {}; // 'date|period' -> Set(roomId)
  const active = (e) => e.status === 'planned' || e.status === 'confirmed' || e.status === 'covered';

  for (const e of entries) {
    if (!dates.includes(e.date) || !active(e) || !e.roomId) continue;
    (used[`${e.date}|${e.period}`] ||= new Set()).add(e.roomId);
  }

  const candidates = entries
    .filter((e) => {
      const t = typeById(e.typeId);
      return dates.includes(e.date) && active(e) && !e.roomId && t && t.clinical && t.buildsClinic;
    })
    .sort((a, b) => `${a.date}|${a.period}`.localeCompare(`${b.date}|${b.period}`));

  for (const e of candidates) {
    const slotUsed = (used[`${e.date}|${e.period}`] ||= new Set());
    const person = staff.find((s) => s.id === e.staffId);
    let roomId = null;
    if (
      person &&
      person.usualRoomId &&
      rooms.some((r) => r.id === person.usualRoomId) &&
      !slotUsed.has(person.usualRoomId)
    ) {
      roomId = person.usualRoomId;
    } else {
      const free = rooms.find((r) => !slotUsed.has(r.id));
      if (free) roomId = free.id;
    }
    if (roomId) {
      slotUsed.add(roomId);
      updates.push({ entryId: e.id, roomId });
    }
  }
  return updates;
}
