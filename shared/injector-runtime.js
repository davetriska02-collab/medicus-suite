// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — injector runtime (route → start/stop).
//
// Content scripts still load (unbundled MV3). This file is the boot table:
// each canvas registers { match, start, stop }. ONE hub subscriber (or a
// 1.5s fallback) owns SPA navigation. Off-route injectors are stopped so
// they do not keep a private MutationObserver or placement interval.
//
// Dual-mode: module.exports for Node, window.InjectorRuntime in the page.

'use strict';

(function (global) {
  var injectors = [];
  var started = Object.create(null);
  var booted = false;
  var unsubHub = null;
  var routeTick = null;
  var testPath = '';
  var testSearch = '';
  var useTestLocation = false;

  function loc() {
    if (useTestLocation) return { pathname: testPath, search: testSearch };
    if (typeof location === 'undefined') return { pathname: '', search: '' };
    return { pathname: location.pathname || '', search: location.search || '' };
  }

  function setLocation(pathname, search) {
    useTestLocation = true;
    testPath = pathname == null ? '' : String(pathname);
    testSearch = search == null ? '' : String(search);
  }

  function clearTestLocation() {
    useTestLocation = false;
    testPath = '';
    testSearch = '';
  }

  function register(id, hooks) {
    if (!id || typeof id !== 'string') throw new Error('injector-runtime: id required');
    if (!hooks || typeof hooks.match !== 'function') throw new Error('injector-runtime: match required');
    var existing = injectors.filter(function (x) {
      return x.id === id;
    })[0];
    if (existing) {
      existing.match = hooks.match;
      existing.start = hooks.start;
      existing.stop = hooks.stop;
    } else {
      injectors.push({
        id: id,
        match: hooks.match,
        start: hooks.start,
        stop: hooks.stop,
      });
    }
    if (booted) sync();
  }

  function sync() {
    var here = loc();
    injectors.forEach(function (inj) {
      var on = false;
      try {
        on = !!inj.match(here.pathname, here.search);
      } catch (_) {
        on = false;
      }
      if (on) {
        started[inj.id] = true;
        if (typeof inj.start === 'function') {
          try {
            inj.start();
          } catch (_) {
            /* isolate */
          }
        }
      } else if (started[inj.id]) {
        started[inj.id] = false;
        if (typeof inj.stop === 'function') {
          try {
            inj.stop();
          } catch (_) {
            /* isolate */
          }
        }
      }
    });
  }

  function boot() {
    if (booted) {
      sync();
      return;
    }
    booted = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', sync);
      if (window.__chObserverHub && typeof window.__chObserverHub.subscribe === 'function') {
        unsubHub = window.__chObserverHub.subscribe(sync);
      } else if (typeof setInterval === 'function') {
        routeTick = setInterval(sync, 1500);
      }
    }
    sync();
  }

  function resetForTest() {
    injectors.forEach(function (inj) {
      if (started[inj.id] && typeof inj.stop === 'function') {
        try {
          inj.stop();
        } catch (_) {
          /* isolate */
        }
      }
    });
    injectors = [];
    started = Object.create(null);
    booted = false;
    if (unsubHub) {
      try {
        unsubHub();
      } catch (_) {
        /* isolate */
      }
      unsubHub = null;
    }
    if (routeTick) {
      clearInterval(routeTick);
      routeTick = null;
    }
    clearTestLocation();
  }

  function isStarted(id) {
    return !!started[id];
  }

  var api = {
    register: register,
    sync: sync,
    boot: boot,
    setLocation: setLocation,
    clearTestLocation: clearTestLocation,
    resetForTest: resetForTest,
    isStarted: isStarted,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.InjectorRuntime = api;

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
