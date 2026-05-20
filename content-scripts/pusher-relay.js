// Medicus Suite — Pusher relay content script
// Also permanently suppresses the Triage Lens floating HUD —
// its data is surfaced in the suite's Signals panel instead.

(function() {
  'use strict';

  // Suppress the in-page Triage Lens HUD — the Signals panel replaces it
  const style = document.createElement('style');
  style.textContent = '#medicus-clinical-hud { display: none !important; }';
  (document.head || document.documentElement).appendChild(style);

  if (window.__suiteRelayMounted) return;
  window.__suiteRelayMounted = true;

  const MAX_WAIT_MS = 10000;
  const POLL_MS = 500;
  let elapsed = 0;

  function tryBind() {
    const appEl = document.querySelector('#app') || document.querySelector('[data-v-app]');
    if (!appEl || !appEl.__vue_app__) {
      elapsed += POLL_MS;
      if (elapsed < MAX_WAIT_MS) setTimeout(tryBind, POLL_MS);
      return;
    }

    const globals = appEl.__vue_app__.config.globalProperties;
    const pusher = globals.$pusher;
    if (!pusher) return; // Pusher not loaded on this page — nothing to relay

    // Derive site ID from the current URL (first path segment)
    const parts = location.pathname.split('/').filter(Boolean);
    const siteId = parts[0] || '';
    const channelName = `${siteId}-scheduling`;

    const ch = pusher.channels?.channels?.[channelName];
    if (!ch) {
      // Channel not yet subscribed — wait a bit more
      elapsed += POLL_MS;
      if (elapsed < MAX_WAIT_MS) setTimeout(tryBind, POLL_MS);
      return;
    }

    // Listen for appointment updates — forward to service worker without patient data
    ch.bind('appointments-updated', () => {
      chrome.runtime.sendMessage({ action: 'pusher:scheduling:appointments-updated' }).catch(() => {});
    });

    // Re-bind if the page navigates within the SPA and the channel is recreated
    const observer = new MutationObserver(() => {
      const newCh = pusher.channels?.channels?.[channelName];
      if (newCh && newCh !== ch) {
        observer.disconnect();
        // Re-run after a short delay to let the new channel settle
        setTimeout(tryBind, 500);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Start polling once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryBind, POLL_MS));
  } else {
    setTimeout(tryBind, POLL_MS);
  }
})();
