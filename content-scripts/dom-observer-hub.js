// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — shared DOM-observer hub (content-script isolated world).
//
// The Medicus page (Vue + AG-Grid SPA) re-renders its DOM constantly. Several of
// our injected features need to react to that churn (re-inject the "send to
// routine" button, re-place the inline booking widget, re-bind the Pusher
// channel). Historically each ran its OWN
// `MutationObserver(document.body, { childList: true, subtree: true })`, so every
// SPA mutation woke N separate observers — N callbacks, N rAF gates, N visibility
// checks, every frame. This hub collapses them to ONE body-subtree observer that
// fans a single, rAF-coalesced batch out to all subscribers, and is paused while
// the tab is backgrounded.
//
// It does NOT replace per-subscriber logic: each subscriber still applies its own
// "is this my own mutation?" filter and its own placement fast-path. The hub owns
// only the single observer plus the shared coalescing/hidden gate. Subscribers
// keep their own `visibilitychange` re-check, because the hub DROPS batches while
// hidden (it does not buffer stale churn to replay on return).
//
// Shared via `window.__chObserverHub`, which all of the extension's isolated-world
// content scripts in a frame share. It is loaded before any subscriber (first in
// the manifest's content_scripts list), but subscribers also fall back to a
// private observer if it is absent — so NOTHING depends on this file for
// correctness, only for efficiency.
//
// Idempotent: re-running is a no-op (guards on `window.__chObserverHub`).

(function () {
  'use strict';
  if (window.__chObserverHub) return;

  var subs = new Set();
  var pending = []; // MutationRecords accumulated since the last frame flush
  var rafScheduled = false;
  var observer = null;
  var started = false;

  function flush() {
    rafScheduled = false;
    var batch = pending;
    pending = [];
    // Snapshot before fan-out so a subscriber that (un)subscribes from within its
    // own callback can't disturb the iteration, and isolate errors so one bad
    // subscriber can't starve the others.
    var list = [];
    subs.forEach(function (fn) {
      list.push(fn);
    });
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](batch);
      } catch (e) {
        /* isolate subscriber errors */
      }
    }
  }

  function onMutations(mutations) {
    // Ignore background churn; subscribers re-check themselves on visibilitychange.
    if (document.hidden) return;
    for (var i = 0; i < mutations.length; i++) pending.push(mutations[i]);
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(flush);
  }

  function start() {
    if (started) return;
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', start, { once: true });
      return;
    }
    started = true;
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.__chObserverHub = {
    // subscribe(fn) → unsubscribe(). `fn` is called with the coalesced
    // MutationRecord[] batch for the frame. The single shared observer starts
    // lazily on the first subscribe.
    subscribe: function (fn) {
      subs.add(fn);
      start();
      return function () {
        subs.delete(fn);
      };
    },
  };
})();
