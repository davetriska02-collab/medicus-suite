// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Notifications IO (backup/restore support)
//
// Covers suite.notifications (user config for notification channels / badge).
//
// NOT covered here (transient runtime state — see test-backup-coverage.js ALLOWLIST):
//   suite.quietUntil  — ephemeral mute timer, resets on restore
//   suite.alertLog    — rolling runtime log, not user config

(function (global) {
  'use strict';

  const NOTIFICATIONS_KEYS = ['suite.notifications'];

  async function notificationsExport() {
    const r = await chrome.storage.local.get(NOTIFICATIONS_KEYS);
    return {
      notifications: r['suite.notifications'] ?? null,
    };
  }

  async function notificationsImport(data) {
    if (!data || typeof data !== 'object') return;
    const toSet = {};
    if (data.notifications != null) {
      if (typeof data.notifications !== 'object' || Array.isArray(data.notifications)) {
        throw new Error('suite.notifications must be an object.');
      }
      // Validate known keys; unknown keys are passed through for forward-compat
      const n = data.notifications;
      if (n.badgeEnabled !== undefined && typeof n.badgeEnabled !== 'boolean') {
        throw new Error('suite.notifications.badgeEnabled must be a boolean.');
      }
      toSet['suite.notifications'] = n;
    }
    if (Object.keys(toSet).length > 0) {
      await chrome.storage.local.set(toSet);
    }
  }

  global.NOTIFICATIONS_KEYS = NOTIFICATIONS_KEYS;
  global.notificationsExport = notificationsExport;
  global.notificationsImport = notificationsImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { notificationsExport, notificationsImport, NOTIFICATIONS_KEYS };
  }
})(typeof window !== 'undefined' ? window : self);
