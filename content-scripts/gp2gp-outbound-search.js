// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — GP2GP outbound search bar.
//
// PROVISIONAL scaffold. Selectors live only in shared/gp2gp-outbound-search-core.js.
// Options pack suite.ui.gp2gpOutboundSearch is OFF unless switched on (H-092).
// Hides non-matching rows already in the DOM. No write to Medicus.
// Re-applies when the list mutates, and InjectorRuntime tears it down off-route.

(function () {
  'use strict';

  var Core = window.Gp2gpOutboundSearchCore;
  if (!Core || window.__msGp2gpOutboundSearchBoot) return;
  window.__msGp2gpOutboundSearchBoot = true;

  var PACK_KEY = 'suite.ui.gp2gpOutboundSearch';
  var _packOn = false;
  var _session = null;
  var _obs = null;
  var _timer = null;

  function session() {
    if (!_session) _session = Core.createSession(document);
    return _session;
  }

  function hostNode() {
    return _session && typeof _session.host === 'function' ? _session.host() : null;
  }

  function mutationOutsideHost(mutations) {
    var host = hostNode();
    for (var i = 0; i < mutations.length; i++) {
      var target = mutations[i].target;
      if (!host) return true;
      if (target === host) continue;
      if (host.contains && host.contains(target)) continue;
      return true;
    }
    return false;
  }

  function observe() {
    if (_obs || typeof MutationObserver !== 'function' || !document.body) return;
    _obs = new MutationObserver(function (mutations) {
      if (!_packOn) return;
      if (!mutationOutsideHost(mutations)) return;
      if (_timer) clearTimeout(_timer);
      _timer = setTimeout(function () {
        _timer = null;
        if (_packOn) session().mount();
      }, 50);
    });
    _obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function start() {
    session().mount();
    observe();
  }

  function stop() {
    if (_timer) clearTimeout(_timer);
    _timer = null;
    if (_obs) {
      _obs.disconnect();
      _obs = null;
    }
    if (_session) {
      _session.unmount();
      _session = null;
    }
  }

  function hashNow() {
    try {
      return location.hash || '';
    } catch (err) {
      return '';
    }
  }

  var Runtime = window.InjectorRuntime;
  if (Runtime && typeof Runtime.register === 'function') {
    Runtime.register('gp2gp-outbound-search', {
      match: function (pathname) {
        return !!_packOn && Core.isOutboundRoute(pathname || '', hashNow());
      },
      start: start,
      place: function () {
        if (_packOn) session().mount();
      },
      stop: stop,
    });
    if (window.PracticePacks && typeof window.PracticePacks.bindInjector === 'function') {
      window.PracticePacks.bindInjector(PACK_KEY, {
        on: function () {
          _packOn = true;
          Runtime.sync();
        },
        off: function () {
          _packOn = false;
          Runtime.sync();
        },
      });
    }
    /* Fail closed when PracticePacks is missing: a search that hides rows stays off. */
  }

  window.addEventListener('hashchange', function () {
    if (Runtime && typeof Runtime.sync === 'function') Runtime.sync();
  });
})();
