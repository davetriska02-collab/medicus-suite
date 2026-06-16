// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Suite-level IO helpers
// Owns the cross-cutting `suite.*` preference keys that don't belong to any one
// module: display preferences (theme / text size / colourblind mode), the
// practice code, and the feedback email. Captured by suite-wide backup so these
// survive an export/restore. (Before this file existed, doFullExport/applyEnvelope
// read & wrote these keys raw — the convention violation CLAUDE.md warns against,
// and suite.display was dropped from backups entirely.)

'use strict';

const SUITE_KEYS = [
  'suite.display',
  'suite.practiceCode',
  'suite.feedbackEmail',
  'suite.tabOrder',
  'suite.hiddenTabs',
  'suite.practiceAcceptedAt',
  'suite.rollup.alwaysExpanded',
  'suite.waitingRoom.thresholds',
];

// Tab/module ids are short lowercase slugs (e.g. "slots", "sentinel").
const TAB_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/i;
const SUITE_ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

async function suiteExport() {
  const r = await chrome.storage.local.get(SUITE_KEYS);
  return {
    display: r['suite.display'] ?? null,
    practiceCode: r['suite.practiceCode'] ?? null,
    feedbackEmail: r['suite.feedbackEmail'] ?? null,
    tabOrder: r['suite.tabOrder'] ?? null,
    hiddenTabs: r['suite.hiddenTabs'] ?? null,
    // Practice-level clinical acceptance (single "Accept for practice" switch).
    // Unlike the per-install module attestations (reception disclaimer, knowledge
    // notice) this one DOES travel in a backup, so the practice's acceptance
    // propagates on restore. Honoured by the reception + knowledge gates.
    practiceAcceptedAt: r['suite.practiceAcceptedAt'] ?? null,
    // UI pref: keep the alert roll-up pinned open. Boolean; absent == default (false).
    rollupAlwaysExpanded: r['suite.rollup.alwaysExpanded'] ?? null,
    // Waiting-room alert thresholds in minutes ({ amber, red }); absent == defaults.
    waitingRoomThresholds: r['suite.waitingRoom.thresholds'] ?? null,
  };
}

async function suiteImport(data) {
  if (!data || typeof data !== 'object') throw new Error('Suite data must be an object.');
  const toSet = {};
  if (data.display != null) {
    if (typeof data.display !== 'object' || Array.isArray(data.display)) {
      throw new Error('suite.display must be an object.');
    }
    toSet['suite.display'] = data.display;
  }
  if (data.practiceCode != null) {
    if (typeof data.practiceCode !== 'string') throw new Error('suite.practiceCode must be a string.');
    toSet['suite.practiceCode'] = data.practiceCode;
  }
  if (data.feedbackEmail != null) {
    if (typeof data.feedbackEmail !== 'string') throw new Error('suite.feedbackEmail must be a string.');
    toSet['suite.feedbackEmail'] = data.feedbackEmail;
  }
  if (data.tabOrder != null) {
    if (!Array.isArray(data.tabOrder)) throw new Error('suite.tabOrder must be an array.');
    if (!data.tabOrder.every((id) => typeof id === 'string' && TAB_ID_RE.test(id))) {
      throw new Error('suite.tabOrder must be an array of tab-id strings.');
    }
    toSet['suite.tabOrder'] = data.tabOrder;
  }
  if (data.hiddenTabs != null) {
    if (!Array.isArray(data.hiddenTabs)) throw new Error('suite.hiddenTabs must be an array.');
    if (!data.hiddenTabs.every((id) => typeof id === 'string' && TAB_ID_RE.test(id))) {
      throw new Error('suite.hiddenTabs must be an array of tab-id strings.');
    }
    toSet['suite.hiddenTabs'] = data.hiddenTabs;
  }
  if (data.practiceAcceptedAt != null) {
    if (typeof data.practiceAcceptedAt !== 'string' || !SUITE_ISO_DATETIME_RE.test(data.practiceAcceptedAt)) {
      throw new Error('suite.practiceAcceptedAt must be null or an ISO datetime string.');
    }
    toSet['suite.practiceAcceptedAt'] = data.practiceAcceptedAt;
  }
  if (data.rollupAlwaysExpanded != null) {
    if (typeof data.rollupAlwaysExpanded !== 'boolean') {
      throw new Error('suite.rollup.alwaysExpanded must be a boolean.');
    }
    toSet['suite.rollup.alwaysExpanded'] = data.rollupAlwaysExpanded;
  }
  if (data.waitingRoomThresholds != null) {
    const w = data.waitingRoomThresholds;
    if (typeof w !== 'object' || Array.isArray(w) || !Number.isFinite(w.amber) || !Number.isFinite(w.red)) {
      throw new Error('suite.waitingRoom.thresholds must be an object with numeric amber and red.');
    }
    toSet['suite.waitingRoom.thresholds'] = { amber: w.amber, red: w.red };
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { suiteExport, suiteImport };
}
