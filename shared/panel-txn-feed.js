// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — panel-side transactional feed selector
//
// Used by side-panel modules (Sweep, Record) that fetch per-patient bundles.
// When the practice has switched integrationMode to 'transactional', these
// modules should source the SAME normalised engine bundle from the official
// Transactional API feed (via the service worker, which owns the proxy
// credential and a 60s bundle cache) instead of the session API — and fall
// back to their existing session path when the feed can't provide one.
//
// In 'session' AND 'hybrid' modes this returns null: hybrid keeps the session
// data as the display source everywhere (the hybrid shadow comparison lives in
// content-scripts/sentinel.js, not in the panel), so panel modules change
// nothing until a practice explicitly flips to 'transactional'.
//
// ES module (panel context), with injectable deps for node tests.

'use strict';

// getTxnBundleIfEnabled(patientUuid, deps?) -> engine bundle | null
//   null means: use your existing session path (mode not transactional, no
//   uuid, feed failed, or feed returned an unusable bundle). Never throws.
//   On success the bundle is tagged bundle.debug.panelFeed = 'transactional'
//   so callers can badge provenance in the UI.
export async function getTxnBundleIfEnabled(patientUuid, deps = {}) {
  try {
    const chromeApi = deps.chromeApi || (typeof chrome !== 'undefined' ? chrome : null);
    if (!patientUuid || !chromeApi?.storage?.local || !chromeApi?.runtime?.sendMessage) return null;

    const stored = await chromeApi.storage.local.get('txn.integrationMode');
    if ((stored['txn.integrationMode'] || 'session') !== 'transactional') return null;

    const resp = await chromeApi.runtime.sendMessage({ action: 'txn:fetchPatientBundle', patientUuid });
    if (!resp || !resp.ok || !resp.bundle || !resp.bundle.patientContext) return null;

    const bundle = resp.bundle;
    bundle.debug = bundle.debug || {};
    bundle.debug.panelFeed = 'transactional';
    return bundle;
  } catch (_) {
    return null; // any failure -> caller's session path; the feed may never make the panel show LESS
  }
}

// feedSourceLabel(bundle) -> 'API' | 'session' — short provenance badge text.
export function feedSourceLabel(bundle) {
  return bundle && bundle.debug && bundle.debug.panelFeed === 'transactional' ? 'API' : 'session';
}
