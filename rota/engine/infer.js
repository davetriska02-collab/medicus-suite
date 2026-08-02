// Auto-template inference: read weeks of real Medicus appointment-book
// history and propose each clinician's repeating week pattern. A cell
// (weekday × AM/PM) is proposed when the clinician had a session in at
// least `threshold` of the observed occurrences of that weekday.

import { dayKey } from '../shared/time.js';
import { DAY_KEYS, blankPattern } from './../shared/model.js';

const norm = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

// rowsByDate: { 'YYYY-MM-DD': parseOverview(payload) }
export function inferPatterns({ rowsByDate, staff, threshold = 0.6, defaultType = 'surgery' }) {
  const dayCounts = {}; // 'mon' -> number of observed dates on that weekday
  const byName = {}; // normalised name -> { name, cells: { 'mon-am': n } }

  for (const [date, rows] of Object.entries(rowsByDate)) {
    const dk = dayKey(date);
    dayCounts[dk] = (dayCounts[dk] || 0) + 1;
    for (const row of rows) {
      const key = norm(row.name);
      if (!key) continue;
      const rec = (byName[key] ||= { name: row.name, cells: {} });
      for (const period of ['am', 'pm']) {
        if (row[period] && row[period].hasSession) {
          rec.cells[`${dk}-${period}`] = (rec.cells[`${dk}-${period}`] || 0) + 1;
        }
      }
    }
  }

  const matched = new Set();
  const proposals = [];
  for (const person of staff) {
    const rec = byName[norm(person.medicusName)] || byName[norm(person.name)];
    if (!rec) continue;
    matched.add(norm(rec.name));
    if (person.notAPerson) continue; // directory lane: matched (so not "unknown"), never proposed
    const pattern = blankPattern(1);
    let cells = 0;
    const summary = [];
    for (const dk of DAY_KEYS) {
      const total = dayCounts[dk] || 0;
      if (total < 2) continue; // need at least two observations of a weekday
      for (const period of ['am', 'pm']) {
        const seen = rec.cells[`${dk}-${period}`] || 0;
        if (seen / total >= threshold) {
          pattern[0][dk][period] = defaultType;
          cells += 1;
          summary.push(`${dk.toUpperCase()} ${period.toUpperCase()} (${seen}/${total})`);
        }
      }
    }
    if (cells > 0) {
      proposals.push({ staffId: person.id, name: person.name, pattern, cells, summary });
    }
  }

  const unmatched = Object.values(byName)
    .filter((r) => !matched.has(norm(r.name)) && Object.keys(r.cells).length)
    .map((r) => r.name);

  return { proposals, unmatched, datesObserved: Object.keys(rowsByDate).length };
}
