// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Request Monitor IO (backup/restore support)
//
// Only user-configurable settings are round-tripped.
// Excluded (transient runtime state, not user config):
//   suite.requestMonitor.state    — live poll state ({ buckets, seenIds, lastPoll, error })
//   suite.requestMonitor.notifMap — service-worker notification tracking map

(function(global) {
  'use strict';

  const REQUEST_MONITOR_KEYS = [
    'suite.requestMonitor.enabled',
    'suite.requestMonitor.assigneeId',
    'suite.requestMonitor.pollSeconds',
    'suite.requestMonitor.notifyEnabled',
    'suite.requestMonitor.notifySound',
  ];

  async function requestMonitorExport() {
    const r = await chrome.storage.local.get(REQUEST_MONITOR_KEYS);
    return {
      enabled:       r['suite.requestMonitor.enabled']       ?? null,
      assigneeId:    r['suite.requestMonitor.assigneeId']    ?? null,
      pollSeconds:   r['suite.requestMonitor.pollSeconds']   ?? null,
      notifyEnabled: r['suite.requestMonitor.notifyEnabled'] ?? null,
      notifySound:   r['suite.requestMonitor.notifySound']   ?? null,
    };
  }

  async function requestMonitorImport(data) {
    if (!data || typeof data !== 'object') return;
    const toSet = {};
    if (data.enabled       !== undefined) toSet['suite.requestMonitor.enabled']       = data.enabled;
    if (data.assigneeId    !== undefined) toSet['suite.requestMonitor.assigneeId']    = data.assigneeId;
    if (data.pollSeconds   !== undefined) toSet['suite.requestMonitor.pollSeconds']   = data.pollSeconds;
    if (data.notifyEnabled !== undefined) toSet['suite.requestMonitor.notifyEnabled'] = data.notifyEnabled;
    if (data.notifySound   !== undefined) toSet['suite.requestMonitor.notifySound']   = data.notifySound;
    if (Object.keys(toSet).length > 0) {
      await chrome.storage.local.set(toSet);
    }
  }

  global.REQUEST_MONITOR_KEYS      = REQUEST_MONITOR_KEYS;
  global.requestMonitorExport      = requestMonitorExport;
  global.requestMonitorImport      = requestMonitorImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { requestMonitorExport, requestMonitorImport, REQUEST_MONITOR_KEYS };
  }
// Works in extension pages (window === self) and service workers (no window).
})(typeof self !== 'undefined' ? self : this);
