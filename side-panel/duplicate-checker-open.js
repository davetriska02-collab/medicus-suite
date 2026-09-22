// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Duplicate checker full-tab opener.
//
// The checker is a whole page (duplicate-checker.html), not a side-panel
// module. One opener so the All-tabs menu, the command palette, and any
// leftover nav click stay on the same URL.

'use strict';

export const DUPLICATE_CHECKER_PATH = 'duplicate-checker.html';

export function openDuplicateCheckerTab() {
  return chrome.tabs.create({ url: chrome.runtime.getURL(DUPLICATE_CHECKER_PATH) });
}
