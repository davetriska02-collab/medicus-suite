// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Follow-ups: pure-logic core (no chrome APIs, no DOM)
//
// The personal safety-net ledger ("IOU Ledger" D1, Practice dream-feature
// panel 2026-07-07): things a clinician is waiting on — "MSU pending, chase
// Friday" — held locally and resurfaced when the due date passes. INTENDED-
// PURPOSE FRAMING (docs/INTENDED-PURPOSE.md): this is a personal reminder
// list, NOT the clinical record and NOT a safety-netting system of record.
// It never acts by itself; a lapsed entry is a prompt, nothing more. The UI
// copy must always carry that honest state. Hazard log: H-039.
//
// Entry shape (storage key `followups.entries`, machine-local, excluded from
// backups — entries carry patient-identifiable free text):
//   { id, what, due: 'YYYY-MM-DD', createdAt: ISO, status: 'open'|'done',
//     doneAt: ISO|null, patientUuid: string|null, patientName: string,
//     source: 'monitoring'|'manual' }
// patientUuid is ONLY ever set by the Monitoring integration, captured from
// the open-record context (wrong-patient doctrine: demographic strings are
// not identity). Manual entries from the tab are unlinked free text.

'use strict';

export const FOLLOWUP_STATUS = { OPEN: 'open', DONE: 'done' };

// How far ahead "due soon" reaches, how long done entries are kept for the
// "Done" audit trail, and the storage cap.
export const DUE_SOON_DAYS = 3;
export const DONE_RETENTION_DAYS = 30;
export const FOLLOWUP_CAP = 400;

const DAY_MS = 86400000;
const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Local calendar date for a timestamp — follow-ups are due on a DAY, and the
// day boundary must be the user's local midnight, not UTC's.
export function dateOnlyISO(nowMs) {
  const d = new Date(nowMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Whole calendar days from today (local) to the entry's due date. Negative =
// overdue. null when the due string is unparseable.
export function daysUntilDue(due, nowMs) {
  if (typeof due !== 'string' || !DUE_RE.test(due)) return null;
  const t = Date.parse(due + 'T00:00:00');
  if (!Number.isFinite(t)) return null;
  const today = Date.parse(dateOnlyISO(nowMs) + 'T00:00:00');
  return Math.round((t - today) / DAY_MS);
}

// Classify an entry for display banding:
//   'done'      — completed (kept 30 days for the audit trail)
//   'lapsed'    — due date passed with the entry still open: THE product.
//   'due_today' — due today
//   'due_soon'  — due within DUE_SOON_DAYS
//   'waiting'   — open, not yet near due (also the honest fallback for an
//                 unparseable due date — validation should prevent those)
export function classifyFollowup(entry, nowMs) {
  if (!entry || entry.status === FOLLOWUP_STATUS.DONE) return 'done';
  const d = daysUntilDue(entry.due, nowMs);
  if (d == null) return 'waiting';
  if (d < 0) return 'lapsed';
  if (d === 0) return 'due_today';
  if (d <= DUE_SOON_DAYS) return 'due_soon';
  return 'waiting';
}

const _BAND = { lapsed: 0, due_today: 1, due_soon: 2, waiting: 3, done: 4 };

// Sort for the rendered list — the eye lands on the most-lapsed first:
// lapsed (oldest due first), then due today / due soon / waiting (soonest
// due first), done last (most recently completed first).
export function sortFollowups(entries, nowMs) {
  return [...(Array.isArray(entries) ? entries : [])].sort((a, b) => {
    const ba = _BAND[classifyFollowup(a, nowMs)];
    const bb = _BAND[classifyFollowup(b, nowMs)];
    if (ba !== bb) return ba - bb;
    if (ba === _BAND.done) {
      return String(b.doneAt || '') < String(a.doneAt || '') ? -1 : 1;
    }
    const da = String(a.due || '');
    const db = String(b.due || '');
    if (da !== db) return da < db ? -1 : 1;
    return String(a.createdAt || '') < String(b.createdAt || '') ? -1 : 1;
  });
}

// Counts for the Today line and the tab: { open, lapsed, dueToday, dueSoon }.
export function followupCounts(entries, nowMs) {
  const out = { open: 0, lapsed: 0, dueToday: 0, dueSoon: 0 };
  for (const e of Array.isArray(entries) ? entries : []) {
    const c = classifyFollowup(e, nowMs);
    if (c === 'done') continue;
    out.open++;
    if (c === 'lapsed') out.lapsed++;
    else if (c === 'due_today') out.dueToday++;
    else if (c === 'due_soon') out.dueSoon++;
  }
  return out;
}

// Gate for new entries. Returns an error string, or null when valid.
export function validateFollowup({ what, due } = {}) {
  const text = String(what || '').trim();
  if (!text) return 'Say what you are waiting for.';
  if (text.length > 200) return 'Keep it under 200 characters.';
  const d = typeof due === 'string' && DUE_RE.test(due) ? Date.parse(due + 'T00:00:00') : NaN;
  if (!Number.isFinite(d)) return 'Pick a due date.';
  if (d > Date.parse('2100-01-01')) return 'That due date is too far ahead.';
  return null;
}

// Housekeeping on every write: drop done entries past retention, and if the
// cap is still exceeded drop the oldest done entries first. Open entries are
// NEVER silently dropped — a vanished IOU is exactly the failure this
// feature exists to prevent.
export function pruneFollowups(entries, nowMs) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => {
    if (!e) return false;
    if (e.status !== FOLLOWUP_STATUS.DONE) return true;
    const t = Date.parse(e.doneAt || '');
    return Number.isFinite(t) && nowMs - t < DONE_RETENTION_DAYS * DAY_MS;
  });
  if (list.length <= FOLLOWUP_CAP) return list;
  const done = list
    .filter((e) => e.status === FOLLOWUP_STATUS.DONE)
    .sort((a, b) => (String(a.doneAt || '') < String(b.doneAt || '') ? -1 : 1));
  const toDrop = new Set(done.slice(0, list.length - FOLLOWUP_CAP).map((e) => e.id));
  return list.filter((e) => !toDrop.has(e.id));
}

// Compact due label: "3d overdue" / "due today" / "due tomorrow" / "due in
// 5d" / the raw string when unparseable (never an invented date).
export function formatDueLabel(due, nowMs) {
  const d = daysUntilDue(due, nowMs);
  if (d == null) return `due ${String(due || '?')}`;
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  return `due in ${d}d`;
}
