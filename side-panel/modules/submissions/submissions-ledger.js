// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Submissions received-work ledger (storage wrapper)
//
// Thin chrome.storage.local wrapper around the pure ledger logic in
// submissions-core.js. See the ledger comment there for WHY this exists (the
// task-list API only contains open tasks — completed requests vanish, so the
// suite must remember what it has seen to count "work received" honestly).
//
// Storage key: 'submissions.ledger' (exported/imported by
// shared/io/submissions-io.js per the backup convention).
//
// Concurrency: several contexts poll and record independently (Submissions
// module, Today card, panel strip, Condor, pop-out). Writes are last-write-
// wins read-modify-write — a lost merge is self-healing because every poller
// re-fetches the full open list each cycle, so any dropped IDs that are still
// open reappear on the next merge. Only a task that is seen once and completed
// inside the same 60s window as a losing write could be permanently missed —
// acceptable for a demand counter.

'use strict';

import {
  normaliseLedger,
  touchLedgerDay,
  mergeTasksIntoLedger,
  compactLedger,
  localDateISO,
} from './submissions-core.js';

const LEDGER_KEY = 'submissions.ledger';

export async function loadLedger() {
  const stored = await chrome.storage.local.get(LEDGER_KEY);
  return normaliseLedger(stored[LEDGER_KEY]);
}

// Merge freshly fetched task lists into the ledger and persist it.
// byKey: { [category]: tasks[] } — categories may be any subset (the Today
// card and panel strip only fetch medical/admin).
// Returns the updated ledger so callers can render from it without a re-read.
export async function recordTaskLists(byKey) {
  const ledger = await loadLedger();
  // Dirty check (audit M9, 2026-07-18): five callers poll at 15-60s and the
  // merged ledger is usually byte-identical to what was loaded — skipping the
  // no-op set removes ~50-100 KB/min of storage writes AND narrows the
  // last-write-wins race window between concurrent writers.
  const before = JSON.stringify(ledger);
  const today = localDateISO();
  touchLedgerDay(ledger, today);
  for (const [key, tasks] of Object.entries(byKey || {})) {
    mergeTasksIntoLedger(ledger, key, tasks, today);
  }
  compactLedger(ledger, today);
  if (JSON.stringify(ledger) !== before) {
    await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
  }
  return ledger;
}
