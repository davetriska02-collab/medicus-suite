// Bradford Factor: B = S² × D over a rolling 52-week window, where S is the
// number of sickness episodes and D the working days absent. Standard HR
// attention bands are configurable in settings (guidance, not regulation —
// scores trigger conversations, never automatic action).

import { addDays, dayKey, datesInRange, todayISO } from '../shared/time.js';

// Approved sick-leave records merged into episodes: contiguous or
// overlapping ranges (no return to work in between) count once.
export function sicknessEpisodes(leaveList, staffId) {
  const sick = leaveList
    .filter((l) => l.staffId === staffId && l.type === 'sick' && l.status === 'approved')
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const episodes = [];
  for (const l of sick) {
    const last = episodes[episodes.length - 1];
    if (last && l.startDate <= addDays(last.endDate, 1)) {
      if (l.endDate > last.endDate) last.endDate = l.endDate;
    } else {
      episodes.push({ startDate: l.startDate, endDate: l.endDate });
    }
  }
  return episodes;
}

export function bradfordScore({ person, leaveList, settings, asOf = todayISO() }) {
  const windowStart = addDays(asOf, -364);
  let episodes = 0;
  let days = 0;
  for (const ep of sicknessEpisodes(leaveList, person.id)) {
    if (ep.endDate < windowStart || ep.startDate > asOf) continue;
    episodes += 1;
    const from = ep.startDate > windowStart ? ep.startDate : windowStart;
    const to = ep.endDate < asOf ? ep.endDate : asOf;
    days += datesInRange(from, to).filter((d) => settings.openDays.includes(dayKey(d))).length;
  }
  const score = episodes * episodes * days;
  const t = settings.bradfordThresholds || { monitor: 50, high: 200, severe: 500 };
  const band = score >= t.severe ? 'severe' : score >= t.high ? 'high' : score >= t.monitor ? 'monitor' : 'ok';
  return { staffId: person.id, name: person.name, episodes, days, score, band };
}

export function bradfordRows({ staff, leaveList, settings, asOf }) {
  return staff
    .map((p) => bradfordScore({ person: p, leaveList, settings, asOf }))
    .filter((r) => r.episodes > 0)
    .sort((a, b) => b.score - a.score);
}
