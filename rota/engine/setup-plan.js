// Import planning for the first-run setup wizard: given several days of
// parsed appointment-book rows and the staff registry as it stands, work out
// who would be imported and who would not.
//
// PURE: no DOM, no chrome.*, no fetch, no uid, no state. It decides nothing
// about staff records — the wizard turns candidates into staff via newStaff()
// AFTER the user has reviewed them, which is the whole point of splitting it
// out: the matching/dedupe/skip rules are the part that has to be right, and
// they are now testable in node.

const norm = (name) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

// Display form: whitespace tidied, case preserved exactly as Medicus shows it.
const display = (name) =>
  String(name || '')
    .trim()
    .replace(/\s+/g, ' ');

// Reasons a name in the appointment book is not offered for import. Tokens,
// not sentences: the wizard maps them to wording.
export const SKIP_KNOWN = 'known'; // already in the staff registry
export const SKIP_NO_SESSIONS = 'no-sessions'; // appeared, but never consulting

/**
 * @param {Object} overviewDays  { 'YYYY-MM-DD': rows } — rows from parseOverview()
 * @param {Array}  existingStaff the current staff registry
 * @returns {{candidates: Array<{name: string, sessionCount: number, dates: string[]}>,
 *            skipped: Array<{name: string, reason: string}>}}
 */
export function buildImportPlan(overviewDays, existingStaff = []) {
  // Match on medicusName first and name second, case- and spacing-insensitive:
  // the same rule engine/reconcile.js and engine/infer.js already use, so a
  // clinician the rest of the app can match is never offered as "new".
  const known = new Set(
    (existingStaff || []).flatMap((person) => [norm(person && person.medicusName), norm(person && person.name)])
  );
  known.delete('');

  const byName = new Map(); // normalised name -> { name, sessionCount, dates:Set }

  for (const [date, rows] of Object.entries(overviewDays || {})) {
    for (const row of rows || []) {
      const key = norm(row && row.name);
      if (!key) continue; // an unnamed lane is not a person to import
      let rec = byName.get(key);
      if (!rec) {
        rec = { name: display(row.name), sessionCount: 0, dates: new Set() };
        byName.set(key, rec);
      }
      let worked = false;
      for (const period of ['am', 'pm']) {
        if (row[period] && row[period].hasSession) {
          rec.sessionCount += 1;
          worked = true;
        }
      }
      if (worked) rec.dates.add(date);
    }
  }

  const candidates = [];
  const skipped = [];
  for (const [key, rec] of byName) {
    if (known.has(key)) {
      skipped.push({ name: rec.name, reason: SKIP_KNOWN });
    } else if (rec.sessionCount === 0) {
      skipped.push({ name: rec.name, reason: SKIP_NO_SESSIONS });
    } else {
      candidates.push({ name: rec.name, sessionCount: rec.sessionCount, dates: [...rec.dates].sort() });
    }
  }

  // Busiest first — the people most likely to be real clinicians lead the
  // review table. Ties break on name so the order is stable between runs.
  candidates.sort((a, b) => b.sessionCount - a.sessionCount || a.name.localeCompare(b.name));
  skipped.sort((a, b) => a.name.localeCompare(b.name));

  return { candidates, skipped };
}
