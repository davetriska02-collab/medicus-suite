// Medicus Suite — Submissions Tracker IO helpers

'use strict';

async function submissionsExport() {
  const r = await chrome.storage.local.get(['submissions.config', 'suite.practiceCode']);
  return {
    config: r['submissions.config'] ?? {},
    practiceCode: r['suite.practiceCode'] ?? null,
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
  if (data.practiceCode !== undefined && data.practiceCode !== null) {
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
