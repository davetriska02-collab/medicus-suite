// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — cross-context message names + sender-gated listener
//
// Architecture plan Phase 5.1. Named constants for every runtime action/type
// the inventory knows about. Handlers may keep raw-string comparisons during
// the transition — test-message-contract.js stays the lock-step guard.
//
// Dual-mode: window.SuiteMessages (classic script) / require() in Node.

'use strict';

(function (global) {
  const ACTIONS = {
    GET_RECENT_INVESTIGATION_RESULTS: 'getRecentInvestigationResults',
    GET_SENTINEL_SNAPSHOT: 'getSentinelSnapshot',
    GET_TREND_DATA: 'getTrendData',
    MS_OPEN_OPTIONS: 'ms-open-options',
    OPEN_OPTIONS_PAGE: 'openOptionsPage',
    POPOUT_CLOSED: 'popout:closed',
    PRESENCE_FOLDER_BEAT: 'presence:folderBeat',
    PRESENCE_FOLDER_CLEAR: 'presence:folderClear',
    PRESENCE_FOLDER_READ: 'presence:folderRead',
    PRESENCE_FOLDER_STATUS: 'presence:folderStatus',
    PRESENCE_SYNC_FILE_CONFIG: 'presence:syncFileConfig',
    PUSHER_SCHEDULING_APPOINTMENTS_UPDATED: 'pusher:scheduling:appointments-updated',
    REQUEST_MONITOR_REFRESH: 'requestMonitor:refresh',
    SENTINEL_SNAPSHOT_UPDATED: 'sentinel:snapshot-updated',
    SLOTS_REFRESH: 'slots:refresh',
    TERMBROWSER_FETCH_CONCEPT: 'termbrowser:fetchConcept',
    TXN_FETCH_PATIENT_BUNDLE: 'txn:fetchPatientBundle',
    TXN_TEST_CONNECTION: 'txn:testConnection',
    WAITING_REFRESH: 'waiting:refresh',
  };

  // gatedListener(handler) — wrap chrome.runtime.onMessage so a missed
  // sender-id check cannot ship. Returns the listener (so it can be removed).
  function gatedListener(handler) {
    return function gated(msg, sender, sendResponse) {
      if (!sender || sender.id !== chrome.runtime.id) return;
      return handler(msg, sender, sendResponse);
    };
  }

  const api = { ACTIONS, gatedListener };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.SuiteMessages = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
