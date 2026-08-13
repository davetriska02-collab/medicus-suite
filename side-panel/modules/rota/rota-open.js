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
// app.html#leave still matches — which is exactly why the query pattern below
// stays the BARE page URL even when a deep link is requested.
//
// Optional `hash` deep-links into one of the app's routes (openRotaTab('sync')
// → app.html#sync). On an already-open tab the URL is updated as well as
// raised, so the app's hashchange router lands the user on the right page
// rather than wherever they left it.

'use strict';

export const ROTA_APP_PATH = 'rota/app/app.html';

export async function openRotaTab(hash) {
  const base = chrome.runtime.getURL(ROTA_APP_PATH);
  const fragment = hash ? String(hash).replace(/^#/, '') : '';
  const url = fragment ? `${base}#${fragment}` : base;
  try {
    // Query on `base`, never on `url`: match patterns ignore the fragment, and
    // a pattern carrying one would simply never match.
    const tabs = await chrome.tabs.query({ url: base });
    if (tabs && tabs.length) {
      await chrome.tabs.update(tabs[0].id, fragment ? { active: true, url } : { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      return;
    }
  } catch {
    // Query/raise failed (e.g. the tab was closed mid-flight) — fall through
    // and just open a fresh one rather than leaving the click dead.
  }
  await chrome.tabs.create({ url });
}
