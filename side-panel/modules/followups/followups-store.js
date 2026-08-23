// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Follow-ups storage (chrome.storage.local, not the tab entry)
//
// Extracted so Monitoring can add a reminder without importing followups.js
// (the module entry — that import was a layering inversion). Pure ranking
// stays in followups-core.js.

'use strict';

import { validateFollowup, pruneFollowups, FOLLOWUP_STATUS } from './followups-core.js';

export const FOLLOWUPS_STORE_KEY = 'followups.entries';

export function loadFollowups() {
  return new Promise((resolve) => {
    chrome.storage.local.get([FOLLOWUPS_STORE_KEY], (res) => {
      const v = res && res[FOLLOWUPS_STORE_KEY];
      resolve(Array.isArray(v) ? v : []);
    });
  });
}

export function saveFollowups(entries) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [FOLLOWUPS_STORE_KEY]: pruneFollowups(entries, Date.now()) }, resolve);
  });
}

export async function addFollowup({ what, due, patientUuid = null, patientName = '', source = 'manual' }) {
  const err = validateFollowup({ what, due });
  if (err) throw new Error(err);
  const entry = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `fu_${Date.now()}_${Math.random()}`,
    what: String(what).trim(),
    due,
    createdAt: new Date().toISOString(),
    status: FOLLOWUP_STATUS.OPEN,
    doneAt: null,
    patientUuid: patientUuid || null,
    patientName: String(patientName || ''),
    source,
  };
  const entries = await loadFollowups();
  entries.push(entry);
  await saveFollowups(entries);
  if (typeof window !== 'undefined' && window.EventLedger && entry.patientUuid) {
    window.EventLedger.record({
      source: 'followups',
      patientRef: entry.patientUuid,
      severity: null,
      ruleId: null,
      label: 'follow-up reminder added',
      action: 'followup-added',
    });
  }
  return entry;
}
