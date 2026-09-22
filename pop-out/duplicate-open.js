// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Pop-out open:* fallback for the Duplicate Problem Checker.
//
// The docked panel has a Duplicates nav tab, and the palette opens the checker
// by clicking that tab. The pop-out has no such tab — only the Rota manager
// fallback lived in the palette. This helper is the missing one. It does not
// open Today, the appointment-book tally, or Note TV.

'use strict';

export function openDuplicateCheckerTab() {
  chrome.tabs.create({ url: chrome.runtime.getURL('duplicate-checker.html') });
}
