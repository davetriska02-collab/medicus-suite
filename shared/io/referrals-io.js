// Medicus Suite — Referrals IO (backup/restore support)

(function(global) {
  'use strict';

  const REFERRALS_KEYS = [
    'referrals.discovery',
    'referrals.config',
  ];

  async function referralsExport() {
    const r = await chrome.storage.local.get(REFERRALS_KEYS);
    return {
      discovery: r['referrals.discovery'] ?? null,
      config:    r['referrals.config']    ?? null,
    };
  }

  async function referralsImport(data) {
    if (!data || typeof data !== 'object') return;
    const toSet = {};
    if (data.discovery !== undefined) toSet['referrals.discovery'] = data.discovery;
    if (data.config    !== undefined) toSet['referrals.config']    = data.config;
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
})(typeof window !== 'undefined' ? window : self);
