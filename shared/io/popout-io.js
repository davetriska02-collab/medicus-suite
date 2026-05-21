// Medicus Suite — Popout IO (backup/restore support)

'use strict';

const POPOUT_KEYS = ['popout.windowState'];

async function popoutExport() {
  const r = await chrome.storage.local.get(POPOUT_KEYS);
  return { windowState: r['popout.windowState'] ?? null };
}

async function popoutImport(data) {
  if (!data || typeof data !== 'object') return;
  if (data.windowState && typeof data.windowState === 'object') {
    await chrome.storage.local.set({ 'popout.windowState': data.windowState });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { popoutExport, popoutImport };
}
