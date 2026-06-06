// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Popout IO (backup/restore support)
//
// popout.windowId is excluded — it is the OS window handle and is session-transient.

(function(global) {
  'use strict';

  const POPOUT_KEYS = [
    'popout.windowState',
    'popout.activeModule',
  ];

  async function popoutExport() {
    const r = await chrome.storage.local.get(POPOUT_KEYS);
    return {
      windowState:  r['popout.windowState']  ?? null,
      activeModule: r['popout.activeModule'] ?? null,
    };
  }

  async function popoutImport(data) {
    if (!data || typeof data !== 'object') return;
    const toSet = {};
    if (data.windowState  !== undefined && data.windowState  !== null) toSet['popout.windowState']  = data.windowState;
    if (data.activeModule !== undefined && data.activeModule !== null) toSet['popout.activeModule'] = data.activeModule;
    if (Object.keys(toSet).length > 0) {
      await chrome.storage.local.set(toSet);
    }
  }

  global.POPOUT_KEYS   = POPOUT_KEYS;
  global.popoutExport  = popoutExport;
  global.popoutImport  = popoutImport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { popoutExport, popoutImport, POPOUT_KEYS };
  }
})(typeof window !== 'undefined' ? window : self);
