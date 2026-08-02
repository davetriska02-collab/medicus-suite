// Date helpers. All dates are local calendar dates as 'YYYY-MM-DD' strings —
// never UTC, so a rota built at 23:30 doesn't roll over to the wrong day.

export function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayISO() {
  return localISO(new Date());
}

export function parseISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return localISO(d);
}

export function diffDays(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

export function mondayOf(iso) {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow);
  return localISO(d);
}

export function weekDates(mondayISO) {
  return Array.from({ length: 7 }, (_, i) => addDays(mondayISO, i));
}

const DAY_NAMES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayKey(iso) {
  return DAY_NAMES[(parseISO(iso).getDay() + 6) % 7];
}

export function fmtDay(iso) {
  const d = parseISO(iso);
  return `${DAY_LABELS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtRange(startISO, endISO) {
  return startISO === endISO ? fmtDay(startISO) : `${fmtDay(startISO)} – ${fmtDay(endISO)}`;
}

// Which week of a repeating N-week pattern applies on a given date,
// relative to an anchor Monday (week 0 starts on the anchor).
export function templateWeekIndex(anchorMondayISO, dateISO, weeks) {
  if (!weeks || weeks < 1) return 0;
  const w = Math.floor(diffDays(anchorMondayISO, mondayOf(dateISO)) / 7) % weeks;
  return ((w % weeks) + weeks) % weeks;
}

// NHS leave year runs April–March.
export function leaveYearStart(dateISO) {
  const [y, m] = String(dateISO).split('-').map(Number);
  return m >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
}

export function datesInRange(startISO, endISO) {
  const out = [];
  for (let d = startISO; d <= endISO; d = addDays(d, 1)) out.push(d);
  return out;
}
