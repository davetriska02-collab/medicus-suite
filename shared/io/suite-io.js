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
];

// Tab/module ids are short lowercase slugs (e.g. "slots", "sentinel").
const TAB_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/i;

async function suiteExport() {
  const r = await chrome.storage.local.get(SUITE_KEYS);
  return {
    display:       r['suite.display']       ?? null,
    practiceCode:  r['suite.practiceCode']  ?? null,
    feedbackEmail: r['suite.feedbackEmail'] ?? null,
    tabOrder:      r['suite.tabOrder']       ?? null,
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
    if (!data.tabOrder.every(id => typeof id === 'string' && TAB_ID_RE.test(id))) {
      throw new Error('suite.tabOrder must be an array of tab-id strings.');
    }
    toSet['suite.tabOrder'] = data.tabOrder;
  }
  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { suiteExport, suiteImport };
}
