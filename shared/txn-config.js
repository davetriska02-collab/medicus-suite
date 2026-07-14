// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Transactional API config
//
// Storage keys + helpers for the official Medicus Transactional API integration
// (JWT/JWKS auth, server-to-server). The extension never holds the signing key
// and never calls Medicus's Transactional endpoints directly — it calls OUR
// backend proxy, which signs a short-lived JWT and forwards the request (see
// docs/TRANSACTIONAL-API-INTEGRATION.md).
//
// Settings live in chrome.storage.local (suite-level, like suite.practiceCode).
// txn.callerKey is a SECRET (the proxy caller credential): it is read only by
// the service worker and is deliberately EXCLUDED from suite backups.
//
// Default integrationMode is 'session' — the integration is dormant until a
// practice explicitly opts in, so shipping this changes no behaviour.

(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    integrationMode: 'txn.integrationMode', // 'session' (default) | 'hybrid' | 'transactional'
    environment: 'txn.environment', // 'staging' (default) | 'prod'
    proxyUrl: 'txn.proxyUrl', // our backend proxy base, e.g. https://<proj>.supabase.co/functions/v1
    callerKey: 'txn.callerKey', // SECRET — proxy caller credential (service worker only; never backed up)
    userEmail: 'txn.userEmail', // optional clinician email for user-restricted (attributed) calls
  };

  const DEFAULTS = {
    integrationMode: 'session',
    environment: 'staging',
    proxyUrl: '',
    callerKey: '',
    userEmail: '',
  };

  function isTransactionalEnabled(mode) {
    return mode === 'hybrid' || mode === 'transactional';
  }

  // Tenant-scoped Transactional API base URL (used by server-side tooling and
  // tests; the extension itself always goes via the proxy).
  //   prod    -> https://{tenant}.api.england.medicus.health
  //   staging -> https://{tenant}.api.staging.england.medicus.health
  function baseUrl(tenant, environment) {
    if (!/^[a-f0-9]{4,8}$/i.test(String(tenant || ''))) {
      throw new Error(`Invalid tenant/site code: ${tenant}`);
    }
    const host =
      environment === 'prod' ? `${tenant}.api.england.medicus.health` : `${tenant}.api.staging.england.medicus.health`;
    return `https://${host}`;
  }

  // Read all txn settings from chrome.storage.local, applying defaults.
  // Safe to call from any extension context; rejects only on storage failure.
  async function readSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return { ...DEFAULTS };
    const keys = Object.values(STORAGE_KEYS);
    const raw = await chrome.storage.local.get(keys);
    const out = { ...DEFAULTS };
    for (const [name, key] of Object.entries(STORAGE_KEYS)) {
      if (raw[key] != null && raw[key] !== '') out[name] = raw[key];
    }
    return out;
  }

  const api = { STORAGE_KEYS, DEFAULTS, isTransactionalEnabled, baseUrl, readSettings };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.TxnConfig = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
