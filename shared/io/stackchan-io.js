// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — StackChan desk-presence IO (backup/restore)
//
// Covers suite.stackchan only (enable, LAN URL, optional shared token, hooks).
// The token is a LAN shared-secret, not a clinical credential; it is still
// practice-local and should not be pasted into tickets.

(function (global) {
  'use strict';

  const STACKCHAN_KEYS = ['suite.stackchan'];

  function _bridge() {
    return global.StackchanBridge || (typeof require === 'function' ? require('../stackchan-bridge.js') : null);
  }

  async function stackchanExport() {
    const r = await chrome.storage.local.get(STACKCHAN_KEYS);
    const raw = r['suite.stackchan'] || null;
    const Bridge = _bridge();
    if (Bridge && typeof Bridge.sanitiseConfig === 'function') {
      return Bridge.sanitiseConfig(raw);
    }
    return raw;
  }

  async function stackchanImport(data) {
    if (!data || typeof data !== 'object') return;
    const Bridge = _bridge();
    if (!Bridge || typeof Bridge.sanitiseConfig !== 'function') {
      throw new Error('stackchan: StackchanBridge is not loaded');
    }
    if (data.enabled !== undefined && typeof data.enabled !== 'boolean') {
      throw new Error(`stackchan.enabled must be a boolean (got ${JSON.stringify(data.enabled)}).`);
    }
    if (data.baseUrl !== undefined && data.baseUrl !== null && typeof data.baseUrl !== 'string') {
      throw new Error(`stackchan.baseUrl must be a string (got ${JSON.stringify(data.baseUrl)}).`);
    }
    if (data.token !== undefined && data.token !== null && typeof data.token !== 'string') {
      throw new Error(`stackchan.token must be a string.`);
    }
    const clean = Bridge.sanitiseConfig(data);
    await chrome.storage.local.set({ 'suite.stackchan': clean });
  }

  global.STACKCHAN_KEYS = STACKCHAN_KEYS;
  global.stackchanExport = stackchanExport;
  global.stackchanImport = stackchanImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { stackchanExport, stackchanImport, STACKCHAN_KEYS };
  }
})(typeof self !== 'undefined' ? self : this);
