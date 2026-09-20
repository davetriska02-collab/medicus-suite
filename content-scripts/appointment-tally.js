// © 2026 Graysbrook Ltd. Proprietary — all rights reserved.
// Medicus Suite — appointment-book tally (injected)
//
// A single button on the Medicus appointment-book route: booked vs free
// for this day's book, with the same type checkboxes as Slot Counter
// (slots.hiddenTypes). Optional flu / COVID / RSV eligibility toggles
// (slots.vaxTally) count unique booked patients on the ticked types via
// the same vaccine engine as Sentinel. Read-only — GET of the
// embedded-overview, plus per-patient record GETs only while a vaccine
// toggle is on.
'use strict';

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var T = window.AppointmentTallyCore;
  if (!T) return;
  if (window.__msAppointmentTally) return;
  window.__msAppointmentTally = true;

  var HOST_ID = 'ms-apt-tally';
  var HIDDEN_KEY = 'slots.hiddenTypes';
  var VAX_KEY = 'slots.vaxTally';
  var TTL_MS = 15 * 1000;
  var POLL_MS = 30 * 1000;
  var VAX_GAP_MS = 200;

  var _hidden = new Set();
  var _vaxOn = T.emptyVaxToggles();
  var _vaxByUuid = {};
  var _vaxRules = null;
  var _vaxRulesPromise = null;
  var _vaxScan = null;
  var _vaxScanToken = 0;
  var _vaxLoadError = null;
  var _showExcluded = false;
  var _open = false;
  var _loading = false;
  var _error = null;
  var _tally = null;
  var _routeKey = '';
  var _fetchedAt = 0;
  var _inFlight = null;
  var _inFlightKey = '';
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

  function visibleVaxUuids() {
    return T.visiblePatientUuids(_tally && _tally.patients, _hidden);
  }

  function vaxSummary() {
    return T.summariseVax(_vaxByUuid, visibleVaxUuids());
  }

  function vaxScanning() {
    return !!(_vaxScan && !_vaxScan.cancelled && T.anyVaxOn(_vaxOn) && vaxSummary().pending > 0);
  }

  function currentVaxParts() {
    if (!T.anyVaxOn(_vaxOn)) return [];
    var s = vaxSummary();
    return T.vaxButtonParts(s, _vaxOn, s.pending > 0);
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
    return head + '<div class="ms-apt-tally-list">' + rows + '</div>' + total + vaxHtml() + excludedBlock;
  }

  function vaxCountText(bucket, scanning) {
    if (!T.anyVaxOn(_vaxOn) && !scanning) return '';
    var s = vaxSummary();
    if (!s.checked && s.pending && scanning) return '\u2026';
    var n = (bucket && bucket.eligible) || 0;
    var due = (bucket && bucket.due) || 0;
    var dueBit = due ? '<span class="ms-apt-tally-vax-due">' + due + ' due</span>' : '';
    return '<span class="ms-apt-tally-n booked" data-vax-eligible>' + n + '</span>' + dueBit;
  }

  function vaxStatusHtml() {
    if (!T.anyVaxOn(_vaxOn)) {
      return '<div class="ms-apt-tally-vax-status" id="ms-apt-tally-vax-status">Tick to count booked patients eligible for that vaccine.</div>';
    }
    if (_vaxLoadError) {
      return (
        '<div class="ms-apt-tally-vax-status is-error" id="ms-apt-tally-vax-status">' +
        esc(_vaxLoadError) +
        '</div>'
      );
    }
    var s = vaxSummary();
    var missing = (_tally && _tally.patients && _tally.patients.missing) || 0;
    var bits = [];
    if (s.pending) bits.push('Checking ' + s.checked + ' of ' + s.total + '\u2026');
    else bits.push(s.checked + ' of ' + s.total + ' booked patients checked');
    if (s.errors) bits.push(s.errors + ' unread');
    if (missing) bits.push(missing + ' booking' + (missing === 1 ? '' : 's') + ' without a patient id');
    return (
      '<div class="ms-apt-tally-vax-status" id="ms-apt-tally-vax-status" aria-live="polite">' +
      bits.join(' \u00b7 ') +
      '</div>'
    );
  }

  function vaxRowHtml(key) {
    var s = vaxSummary();
    var scanning = vaxScanning();
    var on = !!_vaxOn[key];
    return (
      '<label class="ms-apt-tally-vax-row">' +
      '<input type="checkbox" class="ms-apt-tally-vax-toggle" data-vax="' +
      esc(key) +
      '"' +
      (on ? ' checked' : '') +
      ' />' +
      '<span class="ms-apt-tally-type">' +
      esc(T.VAX_LABELS[key]) +
      '</span>' +
      (on || s.checked ? vaxCountText(s[key], scanning) : '<span class="ms-apt-tally-vax-blank">\u2014</span>') +
      '</label>'
    );
  }

  function vaxHtml() {
    var rows = T.VAX_KEYS.map(vaxRowHtml).join('');
    return (
      '<div class="ms-apt-tally-vax">' +
      '<div class="ms-apt-tally-vax-title">Vaccine eligibility</div>' +
      '<p class="ms-apt-tally-hint">Unique booked patients on the ticked types. Inferred from the coded record \u2014 double-check before offering a vaccine.</p>' +
      '<div class="ms-apt-tally-vax-list">' +
      rows +
      '</div>' +
      vaxStatusHtml() +
      '</div>'
    );
  }

  function buttonHtml() {
    var slice = _tally ? visibleSlice() : null;
    var label =
      _loading && !_tally
        ? 'Tally\u2026'
        : _error && !_tally
          ? 'Tally ?'
          : T.buttonLabel(slice && slice.totals, currentVaxParts());
    var title = _error
      ? _error
      : 'Booked and free on this day\u2019s appointment book. Same type toggles as Slot Counter. Flu / COVID / RSV counts are optional and inferred.';
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
        startVaxScanIfNeeded();
      });
    });
    host.querySelectorAll('.ms-apt-tally-vax-toggle').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var key = cb.getAttribute('data-vax');
        if (!key || T.VAX_KEYS.indexOf(key) === -1) return;
        _vaxOn[key] = !!cb.checked;
        persistVax();
        render();
        if (T.anyVaxOn(_vaxOn)) startVaxScanIfNeeded();
        else cancelVaxScan();
      });
    });
  }

  function persistHidden() {
    try {
      chrome.storage.local.set({ 'slots.hiddenTypes': Array.from(_hidden) });
    } catch (_) {}
  }

  function persistVax() {
    try {
      chrome.storage.local.set({ 'slots.vaxTally': T.parseVaxToggles(_vaxOn) });
    } catch (_) {}
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function cancelVaxScan() {
    if (_vaxScan) _vaxScan.cancelled = true;
    _vaxScan = null;
  }

  function loadVaxRules() {
    if (_vaxRules) return Promise.resolve(_vaxRules);
    if (_vaxRulesPromise) return _vaxRulesPromise;
    var ids = T.VAX_RULE_IDS;
    var wanted = {};
    wanted[ids.flu] = true;
    wanted[ids.covid] = true;
    wanted[ids.rsv] = true;
    _vaxRulesPromise = Promise.all([
      fetch(chrome.runtime.getURL('rules/vaccine-rules.json')).then(function (r) {
        return r.json();
      }),
      fetch(chrome.runtime.getURL('rules/qof-rules.json')).then(function (r) {
        return r.json();
      }),
    ]).then(function (docs) {
      var vax = (docs[0].rules || []).filter(function (r) {
        return !!(r && wanted[r.id]);
      });
      var regs = (docs[1].rules || []).filter(function (r) {
        return r && r.type === 'qof-register' && r.enabled !== false;
      });
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get(['sentinel.rules'], function (res) {
            var individual = (res && res['sentinel.rules']) || {};
            _vaxRules = regs.concat(vax).map(function (r) {
              return individual[r.id] ? Object.assign({}, r, individual[r.id]) : r;
            });
            resolve(_vaxRules);
          });
        } catch (_) {
          _vaxRules = regs.concat(vax);
          resolve(_vaxRules);
        }
      });
    });
    return _vaxRulesPromise;
  }

  function evaluateVaxPatient(apiBase, uuid, rules) {
    var api = window.SentinelApiClient;
    var N = window.SentinelNormalisers;
    var E = window.SentinelRules;
    if (!api || !N || !E) {
      _vaxByUuid[uuid] = { flu: null, covid: null, rsv: null, error: 'engine-missing' };
      return Promise.resolve();
    }
    return api
      .fetchAll(apiBase, uuid, { useCache: true })
      .then(function (raw) {
        if (!raw || !raw.banner) throw new Error('banner');
        var failed = Object.keys(raw.errors || {}).filter(function (k) {
          return k !== 'clinicalSummary' && k !== 'medicationHistory';
        });
        if (failed.length) throw new Error(failed.join(','));
        var data = N.normaliseAll(raw, {
          url: '',
          title: 'tally',
          view: 'tally',
          patientUuid: uuid,
        });
        var chips = E.evaluatePatient(data.medications || [], data.observations || [], rules, {
          now: new Date().toISOString(),
          problems: data.problems || [],
          patientContext: data.patientContext,
          observationHistory: data.observationHistory || [],
          patientRegisters: data.patientRegisters != null ? data.patientRegisters : null,
        });
        var flags = T.vaxFlagsFromChips(chips);
        flags.error = null;
        _vaxByUuid[uuid] = flags;
      })
      .catch(function () {
        _vaxByUuid[uuid] = { flu: null, covid: null, rsv: null, error: 'unread' };
      });
  }

  function startVaxScanIfNeeded() {
    if (!T.anyVaxOn(_vaxOn) || !_tally) {
      cancelVaxScan();
      return;
    }
    var uuids = visibleVaxUuids();
    var missing = uuids.filter(function (uuid) {
      return !_vaxByUuid[uuid];
    });
    if (!missing.length) {
      refreshVaxPaint();
      return;
    }
    if (_vaxScan && !_vaxScan.cancelled) return;
    runVaxScan(uuids);
  }

  function runVaxScan(visibleUuids) {
    var route = currentRoute();
    if (!route) return;
    var token = ++_vaxScanToken;
    var scan = { token: token, cancelled: false };
    _vaxScan = scan;
    var queue = visibleUuids.filter(function (uuid) {
      return !_vaxByUuid[uuid];
    });
    var apiBase = route.apiBase;
    refreshVaxPaint();
    _vaxLoadError = null;
    loadVaxRules()
      .then(function (rules) {
        function step(i) {
          if (scan.cancelled || token !== _vaxScanToken) return Promise.resolve();
          if (i >= queue.length) {
            if (_vaxScan === scan) _vaxScan = null;
            refreshVaxPaint();
            return Promise.resolve();
          }
          return evaluateVaxPatient(apiBase, queue[i], rules).then(function () {
            refreshVaxPaint();
            if (scan.cancelled || token !== _vaxScanToken) return;
            return delay(VAX_GAP_MS).then(function () {
              return step(i + 1);
            });
          });
        }
        return step(0);
      })
      .catch(function () {
        _vaxLoadError = 'Could not load vaccine rules.';
        if (_vaxScan === scan) _vaxScan = null;
        refreshVaxPaint();
      });
  }

  function refreshVaxPaint() {
    var host = document.getElementById(HOST_ID);
    if (!host) return;
    var btnLabel = host.querySelector('.ms-apt-tally-label');
    var panel = host.querySelector('#ms-apt-tally-panel');
    if (!btnLabel || (_open && !panel)) {
      render();
      return;
    }
    var slice = _tally ? visibleSlice() : null;
    var label =
      _loading && !_tally
        ? 'Tally\u2026'
        : _error && !_tally
          ? 'Tally ?'
          : T.buttonLabel(slice && slice.totals, currentVaxParts());
    btnLabel.textContent = label;
    if (_open && panel) {
      var block = panel.querySelector('.ms-apt-tally-vax');
      if (!block) {
        render();
        return;
      }
      var next = document.createElement('div');
      next.innerHTML = vaxHtml();
      var fresh = next.firstChild;
      if (fresh) block.replaceWith(fresh);
      host.querySelectorAll('.ms-apt-tally-vax-toggle').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var key = cb.getAttribute('data-vax');
          if (!key || T.VAX_KEYS.indexOf(key) === -1) return;
          _vaxOn[key] = !!cb.checked;
          persistVax();
          render();
          if (T.anyVaxOn(_vaxOn)) startVaxScanIfNeeded();
          else cancelVaxScan();
        });
      });
    }
    placeHost(host);
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
    var prevDate = _tally && _tally.date;
    _tally = T.tallyFromOverview(raw, { date: date, now: new Date() });
    if (prevDate && _tally.date && prevDate !== _tally.date) {
      _vaxByUuid = {};
      cancelVaxScan();
    }
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
      _vaxByUuid = {};
      cancelVaxScan();
    }
    if (!bypassCache && _tally && Date.now() - _fetchedAt < TTL_MS) {
      render();
      startVaxScanIfNeeded();
      return Promise.resolve();
    }
    if (T.shouldReuseInFlight(_inFlight, _inFlightKey, key, bypassCache)) return _inFlight;
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
        if (!T.shouldApplyFetch(key, _routeKey)) return;
        applyTally(raw, route.date);
      })
      .catch(function (err) {
        if (!T.shouldApplyFetch(key, _routeKey)) return;
        _error = err && err.message ? err.message : 'Could not read the appointment book.';
      })
      .then(function () {
        var finished = T.finishInFlight({ inFlight: _inFlight, inFlightKey: _inFlightKey }, p);
        _inFlight = finished.inFlight;
        _inFlightKey = finished.inFlightKey;
        if (!T.shouldApplyFetch(key, _routeKey)) return;
        _loading = false;
        render();
        startVaxScanIfNeeded();
      });
    var started = T.beginInFlight(key, p);
    _inFlight = started.inFlight;
    _inFlightKey = started.inFlightKey;
    return p;
  }

  function onStorage(changes, area) {
    if (area && area !== 'local') return;
    var changed = false;
    if (changes[HIDDEN_KEY]) {
      var next = changes[HIDDEN_KEY].newValue;
      _hidden = new Set(Array.isArray(next) ? next : []);
      changed = true;
    }
    if (changes[VAX_KEY]) {
      _vaxOn = T.parseVaxToggles(changes[VAX_KEY].newValue);
      changed = true;
    }
    if (!changed) return;
    render();
    if (T.anyVaxOn(_vaxOn)) startVaxScanIfNeeded();
    else cancelVaxScan();
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

  var _listening = false;

  function addBookListeners() {
    if (_listening) return;
    _listening = true;
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(onStorage);
    }
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function removeBookListeners() {
    if (!_listening) return;
    _listening = false;
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.removeListener(onStorage);
    }
    document.removeEventListener('mousedown', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function startBookChrome() {
    addBookListeners();
    tick();
  }

  function stopBookChrome() {
    cancelVaxScan();
    removeBookListeners();
    removeHost();
  }

  function boot() {
    try {
      chrome.storage.local.get([HIDDEN_KEY, VAX_KEY], function (r) {
        var v = r && r[HIDDEN_KEY];
        _hidden = new Set(Array.isArray(v) ? v : []);
        _vaxOn = T.parseVaxToggles(r && r[VAX_KEY]);
        if (document.getElementById(HOST_ID)) {
          render();
          startVaxScanIfNeeded();
        }
      });
    } catch (_) {
      /* storage unavailable */
    }
    var Runtime = window.InjectorRuntime;
    if (Runtime && typeof Runtime.register === 'function') {
      Runtime.register('appointment-tally', {
        match: function () {
          return !!currentRoute();
        },
        start: startBookChrome,
        place: tick,
        stop: stopBookChrome,
      });
    } else {
      startBookChrome();
    }
  }

  boot();
})();
