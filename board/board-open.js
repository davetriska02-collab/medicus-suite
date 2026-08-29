// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Note full-tab opener.
//
// The display (board.html) is a kiosk page, not a side-panel module: it
// opens in a browser tab exactly like the Visualiser and the Rota manager.
// Focus-or-create so clicking Open repeatedly does not litter the browser
// with duplicate TVs. chrome.tabs.query ignores the URL fragment, so a tab
// sitting on board.html#ops still matches the bare page URL.
//
// Optional `hash` deep-links a profile (openBoardTab('waiting-room') →
// board.html#waiting-room). On an already-open tab the URL is updated as
// well as raised, so the board's hashchange handler lands the right profile.

'use strict';

export const BOARD_PATH = 'board.html';

export async function openBoardTab(hash) {
  const base = chrome.runtime.getURL(BOARD_PATH);
  const fragment = hash ? String(hash).replace(/^#/, '') : '';
  const url = fragment ? `${base}#${fragment}` : base;
  try {
    const tabs = await chrome.tabs.query({ url: base });
    if (tabs && tabs.length) {
      await chrome.tabs.update(tabs[0].id, fragment ? { active: true, url } : { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      return;
    }
  } catch {
    // Query/raise failed — fall through and open a fresh tab.
  }
  await chrome.tabs.create({ url });
}
