// © 2026 Graysbrook Ltd. Proprietary — all rights reserved.
// Medicus Suite — appointment-book tally (injected)
//
// A single button on the Medicus appointment-book route: booked vs free
// for this day's book, with the same type checkboxes as Slot Counter
// (slots.hiddenTypes). Read-only — GET of the embedded-overview only.
'use strict';

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var T = window.AppointmentTallyCore;
  if (!T) return;
  if (window.__msAppointmentTally) return;
  window.__msAppointmentTally = true;

  var HOST_ID = 'ms-apt-tally';
  var HIDDEN_KEY = 'slots.hiddenTypes';
  var TTL_MS = 15 * 1000;
  var POLL_MS = 30 * 1000;

  var _hidden = new Set();
  var _showExcluded = false;
  var _open = false;
  var _loading = false;
  var _error = null;
  var _tally = null;
  var _routeKey = '';
  var _fetchedAt = 0;
  var _inFlight = null;
  var _inFlightKey = '';
  var _poll = null;
  var _mo = null;
  var _painting = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function currentRoute() {
    var C = window.AppointmentOrganiseCore;
    if (!C || typeof C.parseBookRoute !== 'function') return null;
    return C.parseBookRoute(location.pathname, location.search);
  }

  function routeKey(route) {
    if (!route) return '';
    return String(route.apiBase || '') + '|' + String(route.date || '');
  }

  function visibleSlice() {
    return T.applyHidden(_tally && _tally.byType, _hidden);
  }

  function findOpenActions() {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      var t = String(buttons[i].textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (t === 'Open Actions') return buttons[i];
    }
    return null;
  }

  function placeHost(host) {
    if (!host) return;
    var btn = host.querySelector('.ms-apt-tally-btn');
    var w = (btn && btn.offsetWidth) || 168;
    var organise = document.getElementById('ms-aoc-launch');
    var actions = findOpenActions();
    var anchor = organise || actions;
    host.style.position = 'fixed';
    host.style.right = 'auto';
    if (!anchor) {
      host.style.top = '12px';
      host.style.left = 'auto';
      host.style.right = '320px';
      return;
    }
    var r = anchor.getBoundingClientRect();
    host.style.top = Math.max(8, Math.round(r.top + (r.height - 28) / 2)) + 'px';
    host.style.left = Math.max(8, Math.round(r.left - w - 8)) + 'px';
  }

  function rowHtml(type, counts, hidden) {
    var booked = (counts && counts.booked) || 0;
    var free = (counts && counts.free) || 0;
    return (
      '<label class="ms-apt-tally-row' +
      (hidden ? ' is-excluded' : '') +
      '">' +
      '<input type="checkbox" class="ms-apt-tally-toggle" data-type="' +
      esc(type) +
      '"' +
      (hidden ? '' : ' checked') +
      ' />' +
      '<span class="ms-apt-tally-type">' +
      esc(type) +
      '</span>' +
      '<span class="ms-apt-tally-n booked" title="Booked">' +
      booked +
      '</span>' +
      '<span class="ms-apt-tally-n free" title="Free">' +
      free +
      '</span>' +
      '</label>'
    );
  }

  function panelHtml() {
    if (_loading && !_tally) {
      return '<div class="ms-apt-tally-msg">Counting this day\u2019s book\u2026</div>';
    }
    if (_error && !_tally) {
      return '<div class="ms-apt-tally-msg is-error">' + esc(_error) + '</div>';
    }
    var byType = (_tally && _tally.byType) || {};
    var slice = visibleSlice();
    var included = T.sortedTypeEntries(slice.byType);
    var excluded = T.sortedTypeEntries(slice.excluded);
    if (!included.length && !excluded.length) {
      return '<div class="ms-apt-tally-msg">No sessions on this day.</div>';
    }
    var head =
      '<div class="ms-apt-tally-cols" aria-hidden="true">' +
      '<span></span><span>Type</span><span>Booked</span><span>Free</span></div>';
    var rows = included
      .map(function (pair) {
        return rowHtml(pair[0], pair[1], false);
      })
      .join('');
    var total =
      '<div class="ms-apt-tally-total">' +
      '<span></span>' +
      '<span class="ms-apt-tally-type">Total</span>' +
      '<span class="ms-apt-tally-n booked">' +
      slice.totals.booked +
      '</span>' +
      '<span class="ms-apt-tally-n free">' +
      slice.totals.free +
      '</span>' +
      '<span class="ms-apt-tally-all">' +
      slice.all +
      ' on the toggled types</span>' +
      '</div>';
    var excludedBlock = '';
    if (excluded.length) {
      excludedBlock =
        '<button type="button" class="ms-apt-tally-excluded" id="ms-apt-tally-excluded">' +
        (_showExcluded ? '\u25be ' : '\u25b8 ') +
        excluded.length +
        ' excluded type' +
        (excluded.length === 1 ? '' : 's') +
        '</button>' +
        (_showExcluded
          ? '<div class="ms-apt-tally-excluded-list">' +
            excluded
              .map(function (pair) {
                return rowHtml(pair[0], pair[1], true);
              })
              .join('') +
            '</div>'
          : '');
    }
    return head + '<div class="ms-apt-tally-list">' + rows + '</div>' + total + excludedBlock;
  }

  function buttonHtml() {
    var slice = _tally ? visibleSlice() : null;
    var label =
      _loading && !_tally ? 'Tally\u2026' : _error && !_tally ? 'Tally ?' : T.buttonLabel(slice && slice.totals);
    var title = _error
      ? _error
      : 'Booked and free on this day\u2019s appointment book. Same type toggles as Slot Counter.';
    return (
      '<button type="button" class="ms-apt-tally-btn" aria-expanded="' +
      (_open ? 'true' : 'false') +
      '" aria-controls="ms-apt-tally-panel" title="' +
      esc(title) +
      '">' +
      '<span class="ms-apt-tally-label">' +
      esc(label) +
      '</span>' +
      '</button>'
    );
  }

  function formatDate(iso) {
    if (!iso) return '';
    if (iso === T.todayISO()) return 'Today';
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function hostHtml() {
    var date = (_tally && _tally.date) || (currentRoute() && currentRoute().date) || '';
    var panel = _open
      ? '<div class="ms-apt-tally-panel" id="ms-apt-tally-panel" role="dialog" aria-label="Appointment tally">' +
        '<div class="ms-apt-tally-head">' +
        '<span class="ms-apt-tally-title">Tally \u00b7 ' +
        esc(formatDate(date)) +
        '</span>' +
        '<button type="button" class="ms-apt-tally-refresh" id="ms-apt-tally-refresh" title="Refresh">Refresh</button>' +
        '</div>' +
        '<p class="ms-apt-tally-hint">This day\u2019s book. Tick the same appointment types as Slot Counter. Free slots skip times already started today.</p>' +
        panelHtml() +
        '</div>'
      : '';
    return buttonHtml() + panel;
  }

  function bindHost(host) {
    var btn = host.querySelector('.ms-apt-tally-btn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _open = !_open;
        render();
        if (_open) load(false);
      });
    }
    var refresh = host.querySelector('#ms-apt-tally-refresh');
    if (refresh) {
      refresh.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        load(true);
      });
    }
    var excludedBtn = host.querySelector('#ms-apt-tally-excluded');
    if (excludedBtn) {
      excludedBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _showExcluded = !_showExcluded;
        render();
      });
    }
    host.querySelectorAll('.ms-apt-tally-toggle').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var type = cb.getAttribute('data-type');
        if (!type) return;
        if (cb.checked) _hidden.delete(type);
        else _hidden.add(type);
        persistHidden();
        render();
      });
    });
  }

  function persistHidden() {
    try {
      chrome.storage.local.set({ 'slots.hiddenTypes': Array.from(_hidden) });
    } catch (_) {}
  }

  function render() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    _painting = true;
    host.innerHTML = hostHtml();
    bindHost(host);
    placeHost(host);
    _painting = false;
  }

  function removeHost() {
    var host = document.getElementById(HOST_ID);
    if (host) host.remove();
    _open = false;
  }

  function ensureHost() {
    var route = currentRoute();
    var host = document.getElementById(HOST_ID);
    if (!route) {
      if (host) removeHost();
      return null;
    }
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
      document.documentElement.appendChild(host);
      render();
    } else {
      placeHost(host);
    }
    return host;
  }

  function applyTally(raw, date) {
    _tally = T.tallyFromOverview(raw, { date: date, now: new Date() });
    _error = null;
    _fetchedAt = Date.now();
  }

  function load(bypassCache) {
    var route = currentRoute();
    if (!route) return Promise.resolve();
    var key = routeKey(route);
    if (key !== _routeKey) {
      _routeKey = key;
      _tally = null;
      _error = null;
      _fetchedAt = 0;
    }
    if (!bypassCache && _tally && Date.now() - _fetchedAt < TTL_MS) {
      render();
      return Promise.resolve();
    }
    if (_inFlight && !bypassCache && _inFlightKey === key) return _inFlight;
    _loading = true;
    render();
    var url =
      route.apiBase +
      '/scheduling/data/appointment-book/embedded-overview?date=' +
      encodeURIComponent(route.date) +
      '&filterByUsualLocation=false';
    var p = fetch(url, { credentials: 'include' })
      .then(function (resp) {
        if (!resp.ok) {
          if (resp.status === 401 || resp.status === 403) throw new Error('Not signed in to Medicus');
          throw new Error('Could not read the appointment book (' + resp.status + ').');
        }
        return resp.json();
      })
      .then(function (raw) {
        if (key !== _routeKey) return;
        applyTally(raw, route.date);
      })
      .catch(function (err) {
        if (key !== _routeKey) return;
        _error = err && err.message ? err.message : 'Could not read the appointment book.';
      })
      .then(function () {
        if (_inFlight === p) {
          _inFlight = null;
          _inFlightKey = '';
        }
        if (key !== _routeKey) return;
        _loading = false;
        render();
      });
    _inFlight = p;
    _inFlightKey = key;
    return p;
  }

  function onStorage(changes, area) {
    if (area && area !== 'local') return;
    if (!changes[HIDDEN_KEY]) return;
    var next = changes[HIDDEN_KEY].newValue;
    _hidden = new Set(Array.isArray(next) ? next : []);
    render();
  }

  function onDocClick(e) {
    if (!_open) return;
    var host = document.getElementById(HOST_ID);
    if (host && e.target && host.contains(e.target)) return;
    _open = false;
    render();
  }

  function onKey(e) {
    if (e.key === 'Escape' && _open) {
      _open = false;
      render();
    }
  }

  function tick() {
    if (_painting) return;
    var host = ensureHost();
    if (!host) return;
    var key = routeKey(currentRoute());
    if (key !== _routeKey || !_tally || Date.now() - _fetchedAt > POLL_MS) {
      load(false);
    } else {
      placeHost(host);
    }
  }

  var _chromeOn = false;
  var _unsubHub = null;
  var _routeTick = null;

  function startBookChrome() {
    if (_chromeOn) {
      tick();
      return;
    }
    _chromeOn = true;
    _mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var t = records[i].target;
        if (t && t.closest && t.closest('#' + HOST_ID)) return;
      }
      tick();
    });
    _mo.observe(document.documentElement, { childList: true, subtree: true });
    _poll = setInterval(tick, 1500);
    tick();
  }

  function stopBookChrome() {
    if (_mo) {
      _mo.disconnect();
      _mo = null;
    }
    if (_poll) {
      clearInterval(_poll);
      _poll = null;
    }
    _chromeOn = false;
    removeHost();
  }

  function syncBookChrome() {
    if (currentRoute()) startBookChrome();
    else stopBookChrome();
  }

  function boot() {
    try {
      chrome.storage.local.get(HIDDEN_KEY, function (r) {
        var v = r && r[HIDDEN_KEY];
        _hidden = new Set(Array.isArray(v) ? v : []);
        syncBookChrome();
      });
    } catch (_) {
      syncBookChrome();
    }
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(onStorage);
    }
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('popstate', syncBookChrome);
    if (window.__chObserverHub && typeof window.__chObserverHub.subscribe === 'function') {
      _unsubHub = window.__chObserverHub.subscribe(syncBookChrome);
    } else {
      _routeTick = setInterval(syncBookChrome, 1500);
    }
    syncBookChrome();
  }

  boot();
})();
