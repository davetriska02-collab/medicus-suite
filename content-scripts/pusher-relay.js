// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
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
    const handler = () => {
      chrome.runtime.sendMessage({ action: 'pusher:scheduling:appointments-updated' }).catch(() => {});
    };
    ch.bind('appointments-updated', handler);

    // Re-bind if the page navigates within the SPA and the channel is recreated.
    //
    // Performance: the SPA re-renders its DOM constantly, so a body-subtree observer
    // fires on every frame's mutation burst. The actual check is only a couple of
    // optional-chained property reads + an identity compare, but there is no need to
    // run it more than once per frame, nor at all while the tab is backgrounded
    // (the channel object's identity is independent of visibility, so a single
    // re-check on visibilitychange catches any recreation that happened while
    // hidden). We therefore coalesce mutation bursts to one rAF-aligned check and
    // pause entirely when document.hidden — mirroring the queue observer's
    // queueRafScheduled pattern in triage-lens/content.js. This changes only WHEN
    // the (idempotent) channel check runs, never WHETHER a recreation is detected.
    let rafScheduled = false;
    let unsubscribe = null;
    const checkChannel = () => {
      const newCh = pusher.channels?.channels?.[channelName];
      if (newCh && newCh !== ch) {
        if (unsubscribe) unsubscribe();
        document.removeEventListener('visibilitychange', onVisible);
        // Release the old channel's handler so a stale closure can't keep firing
        // on the previous channel, then restore the full wait budget for the new
        // channel (elapsed is otherwise never reset, so a late reconnect could
        // exhaust MAX_WAIT_MS and silently stop relaying).
        try { ch.unbind('appointments-updated', handler); } catch (_) {}
        elapsed = 0;
        setTimeout(tryBind, 500);
      }
    };
    const scheduleCheck = () => {
      if (document.hidden) return; // paused while backgrounded; visibilitychange re-checks
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        if (document.hidden) return;
        checkChannel();
      });
    };
    // When the tab is re-shown, run one check: bursts that fired while hidden were
    // skipped, so the channel may have been recreated in the meantime.
    const onVisible = () => { if (!document.hidden) checkChannel(); };
    // Prefer the shared observer hub (one body observer for the whole injection
    // surface); fall back to a private observer when it isn't present. The channel
    // check is idempotent, so routing it through the hub changes only WHEN it runs.
    const hub = window.__chObserverHub;
    if (hub && hub.subscribe) {
      unsubscribe = hub.subscribe(scheduleCheck);
    } else {
      const observer = new MutationObserver(scheduleCheck);
      observer.observe(document.body, { childList: true, subtree: true });
      unsubscribe = () => observer.disconnect();
    }
    document.addEventListener('visibilitychange', onVisible);
  }

  // Start polling once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryBind, POLL_MS));
  } else {
    setTimeout(tryBind, POLL_MS);
  }
})();
