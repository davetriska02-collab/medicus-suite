// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Referrals IO (backup/restore support)

(function(global) {
  'use strict';

  // Both keys are valid live storage keys but only referrals.config is exported.
  // referrals.discovery is live-only — intentionally NOT exported (PHI containment,
  // audit M1; see practice-profile.js:639). It is rediscovered automatically when
  // the user visits the referrals page.
  const REFERRALS_KEYS = [
    'referrals.discovery',
    'referrals.config',
  ];

  async function referralsExport() {
    const r = await chrome.storage.local.get(REFERRALS_KEYS);
    // Audit M1: export config only — discovery (endpoint URL) is live-only and
    // is never included in backups.
    return {
      config: r['referrals.config'] ?? null,
    };
  }

  async function referralsImport(data) {
    if (!data || typeof data !== 'object') return;
    const toSet = {};
    // Audit M1: discovery is intentionally NOT written even if present in a
    // legacy backup — it will be rediscovered automatically on next page visit.
    // (data.discovery is silently ignored for forward-compatibility.)
    if (data.config !== undefined) toSet['referrals.config'] = data.config;
    if (Object.keys(toSet).length > 0) {
      await chrome.storage.local.set(toSet);
    }
  }

  global.REFERRALS_KEYS    = REFERRALS_KEYS;
  global.referralsExport   = referralsExport;
  global.referralsImport   = referralsImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { referralsExport, referralsImport, REFERRALS_KEYS };
  }
// Works in extension pages (window === self) and service workers (no window).
})(typeof self !== 'undefined' ? self : this);
