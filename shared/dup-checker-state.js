// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — duplicate-checker scan-state TTL helpers.
// Practice identity lists must not sit in chrome.storage indefinitely.
// Dual-mode: module.exports for Node; window.DupCheckerState in the page.

'use strict';

(function () {
  var STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  // Local note of what this tool deleted. Medicus is the clinical record.
  // 30 days covers a month of "what did we tidy" review without keeping names
  // for the life of the browser profile. 500 entries covers a large clean-up
  // session (one entry is one removed copy, not one patient) and a month of
  // ordinary use, and stops a runaway append filling the shared storage quota.
  // Time filter first, then drop the oldest. An entry with no removedAt cannot
  // be shown to be inside the window, so it is dropped.
  var REMOVAL_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  var REMOVAL_LOG_MAX = 500;

  // Keys that carry an NHS number. The live scan still holds the number in
  // memory for the tooltip and CSV; it is not written to chrome.storage.
  var NHS_KEYS = { nhs: 1, nhsNumber: 1, nhsNo: 1, NHSNumber: 1, nhs_number: 1 };

  function stateIsFresh(state, nowMs, ttlMs) {
    if (!state || !state.scanDate) return false;
    var t = Date.parse(state.scanDate);
    if (!t) return false;
    var ttl = typeof ttlMs === 'number' ? ttlMs : STATE_TTL_MS;
    return (typeof nowMs === 'number' ? nowMs : Date.now()) - t < ttl;
  }

  function copyWithoutNhs(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { row: row, changed: false };
    var changed = false;
    var out = {};
    var keys = Object.keys(row);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (NHS_KEYS[k]) {
        changed = true;
        continue;
      }
      out[k] = row[k];
    }
    return { row: changed ? out : row, changed: changed };
  }

  function minimiseFlaggedList(flagged) {
    if (!Array.isArray(flagged)) return { rows: [], changed: false };
    var changed = false;
    var rows = [];
    for (var i = 0; i < flagged.length; i++) {
      var copied = copyWithoutNhs(flagged[i]);
      if (copied.changed) changed = true;
      rows.push(copied.row);
    }
    return { rows: rows, changed: changed };
  }

  // Shallow-copies each flagged row so the in-memory scan (which still has the
  // NHS number for this session) is not mutated. checkedUuids may be an array
  // or any object with forEach (a Set).
  function prepareStateForSave(practiceCode, flagged, checkedUuids, scanDate) {
    var minimised = minimiseFlaggedList(flagged);
    var uuids = [];
    if (checkedUuids && typeof checkedUuids.forEach === 'function') {
      checkedUuids.forEach(function (id) {
        uuids.push(id);
      });
    }
    return {
      practiceCode: practiceCode,
      scanDate: scanDate,
      flagged: minimised.rows,
      checkedUuids: uuids,
    };
  }

  // Upgrade path: a saved scan from before NHS numbers were dropped still has
  // them until the next load. Strip and report changed so the caller rewrites
  // storage. Other fields (name, date of birth, UUID, duplicate findings,
  // checked UUIDs) stay — the restore rail and the incremental scan need them.
  function migrateLoadedState(state) {
    if (!state || typeof state !== 'object') return { state: state, changed: false };
    var minimised = minimiseFlaggedList(state.flagged);
    if (!minimised.changed) return { state: state, changed: false };
    var next = {};
    var keys = Object.keys(state);
    for (var i = 0; i < keys.length; i++) next[keys[i]] = state[keys[i]];
    next.flagged = minimised.rows;
    return { state: next, changed: true };
  }

  function pruneRemovalLog(log, nowMs, ttlMs, maxEntries) {
    var ttl = typeof ttlMs === 'number' ? ttlMs : REMOVAL_LOG_TTL_MS;
    var max = typeof maxEntries === 'number' ? maxEntries : REMOVAL_LOG_MAX;
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var list = Array.isArray(log) ? log : [];
    var fresh = [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      var t = entry && entry.removedAt ? Date.parse(entry.removedAt) : NaN;
      if (!t) continue;
      if (now - t < ttl) fresh.push(entry);
    }
    fresh.sort(function (a, b) {
      return Date.parse(a.removedAt) - Date.parse(b.removedAt);
    });
    if (fresh.length > max) fresh = fresh.slice(fresh.length - max);
    var changed = fresh.length !== list.length;
    if (!changed) {
      for (var j = 0; j < fresh.length; j++) {
        if (fresh[j] !== list[j]) {
          changed = true;
          break;
        }
      }
    }
    return { entries: fresh, changed: changed };
  }

  var api = {
    STATE_TTL_MS: STATE_TTL_MS,
    REMOVAL_LOG_TTL_MS: REMOVAL_LOG_TTL_MS,
    REMOVAL_LOG_MAX: REMOVAL_LOG_MAX,
    stateIsFresh: stateIsFresh,
    prepareStateForSave: prepareStateForSave,
    migrateLoadedState: migrateLoadedState,
    pruneRemovalLog: pruneRemovalLog,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.DupCheckerState = api;
  }
})();
