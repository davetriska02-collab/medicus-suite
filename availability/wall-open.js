// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — availability wall opener.
//
// The wall is a full browser tab, same idea as Rota manager. Focus-or-create
// so a triage-room TV is not opened twice.

'use strict';

export const AVAILABILITY_WALL_PATH = 'availability/wall.html';

export async function openAvailabilityTab() {
  const url = chrome.runtime.getURL(AVAILABILITY_WALL_PATH);
  try {
    const tabs = await chrome.tabs.query({ url });
    if (tabs && tabs.length) {
      const extra = tabs.slice(1).map((tab) => tab.id);
      if (extra.length) await chrome.tabs.remove(extra);
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      return;
    }
  } catch {
    // Fall through and open a fresh tab.
  }
  await chrome.tabs.create({ url });
}
