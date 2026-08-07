// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Rota full-app opener.
//
// The full Rota Manager (rota/app/app.html) is a whole application, not a
// side-panel module: it opens in a browser tab exactly like the Visualiser.
// This is the ONE authoritative implementation — imported by
// side-panel/panel.js (the `rota-app` nav tab) and by the compact
// side-panel/modules/rota/rota.js module ("Open full rota" button), so the
// focus-or-create behaviour can never drift between the two entry points.
//
// Focus-or-create: clicking Rota repeatedly must not litter the browser with
// duplicate tabs — an already-open one is raised (and its window focused)
// instead. chrome.tabs.query ignores the URL fragment, so a tab sitting on
// app.html#leave still matches.

'use strict';

export const ROTA_APP_PATH = 'rota/app/app.html';

export async function openRotaTab() {
  const url = chrome.runtime.getURL(ROTA_APP_PATH);
  try {
    const tabs = await chrome.tabs.query({ url });
    if (tabs && tabs.length) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      return;
    }
  } catch {
    // Query/raise failed (e.g. the tab was closed mid-flight) — fall through
    // and just open a fresh one rather than leaving the click dead.
  }
  await chrome.tabs.create({ url });
}
