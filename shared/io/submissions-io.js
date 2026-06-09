// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Submissions Tracker IO helpers

'use strict';

async function submissionsExport() {
  const r = await chrome.storage.local.get(['submissions.config', 'submissions.thresholds']);
  // suite.practiceCode is owned by shared/io/suite-io.js — not exported here.
  return {
    config:     r['submissions.config']     ?? {},
    thresholds: r['submissions.thresholds'] ?? null,
  };
}

async function submissionsImport(data, _opts = {}) {
  if (!data || typeof data !== 'object') throw new Error('Submissions data must be an object.');
  const toSet = {};
  if (data.config !== undefined) {
    if (typeof data.config !== 'object' || Array.isArray(data.config)) {
      throw new Error('submissions.config must be an object.');
    }
    toSet['submissions.config'] = data.config;
  }
  if (data.thresholds != null) {
    if (typeof data.thresholds !== 'object' || Array.isArray(data.thresholds)) {
      throw new Error('submissions.thresholds must be an object.');
    }
    toSet['submissions.thresholds'] = data.thresholds;
  }
  // Legacy-tolerated: standalone submissions backups carried practiceCode; owner is suite-io.
  if (data.practiceCode != null) {
    if (typeof data.practiceCode !== 'string') throw new Error('practiceCode must be a string.');
    toSet['suite.practiceCode'] = data.practiceCode;
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { submissionsExport, submissionsImport };
}
