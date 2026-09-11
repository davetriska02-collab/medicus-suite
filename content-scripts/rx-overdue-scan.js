// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Check for overdue monitoring" on routine / non-routine
// prescription task-lists (the standard Medicus list, not the share-out canvas).
//
// Button sits next to "Share out this inbox…". Click scans the open inbox
// with the same Sentinel engine the record HUD uses (drug-monitoring + QOF).
// Rows with findings get a Monitoring and/or QOF button next to the request.
// Absence of a button is never an all-clear.
//
// Fetch pattern matches the Rx canvas harvest: concurrency, timeout, circuit
// breaker, _scanGen abort on leave. Unique patients are fetched once.

'use strict';

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msRxOverdueScan) return;
  window.__msRxOverdueScan = true;

  var C = window.RxAllocateCore;
  var O = window.RxOverdueCore;
  if (!C || !O) return;

  var WRAP_ID = 'ms-rxac-launch-wrap';
  var LAUNCH_ID = 'ms-rxac-launch';
  var BTN_ID = 'ms-rx-od-btn';
  var POP_ID = 'ms-rx-od-pop';
  var MARKER = 'ms-rx-od';
  var FETCH_CONCURRENCY = 5;
  var FETCH_TIMEOUT_MS = 8000;
  var CIRCUIT_BREAKER_MAX = 10;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var SLUG_RE = /^[a-zA-Z0-9_-]{1,80}$/;

  var _scanGen = 0;
  var _scanning = false;
  var _rows = []; // [{ rowIndex, taskUuid, overviewURL, taskTypeSlug }]
  var _byTask = Object.create(null); // taskUuid -> selectOverdue result | null
  var _byPatient = Object.create(null); // patientUuid -> result
  var _drugRules = null;
  var _qofRules = null;
  var _sortSig = undefined;
  var _bridgeOn = false;
  var _bridgeCount = 0;
  var _bridgeTimer = null;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function currentRoute() {
    return C.parseRxQueueRoute(location.pathname, location.search);
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error('timeout after ' + ms + 'ms'));
      }, ms);
      promise.then(
        function (v) {
          clearTimeout(t);
          resolve(v);
        },
        function (e) {
          clearTimeout(t);
          reject(e);
        }
      );
    });
  }

  function makeCircuitBreaker(maxConsecutiveFails) {
    var consecutiveFails = 0;
    var tripped = false;
    return {
      isTripped: function () {
        return tripped;
      },
      recordSuccess: function () {
        consecutiveFails = 0;
      },
      recordFailure: function () {
        consecutiveFails++;
        if (consecutiveFails >= maxConsecutiveFails) tripped = true;
      },
    };
  }

  function runWorkerPool(items, concurrency, worker) {
    var idx = 0;
    function next() {
      if (idx >= items.length) return Promise.resolve();
      var i = idx++;
      return Promise.resolve(worker(items[i], i)).then(next);
    }
    var lanes = [];
    for (var l = 0; l < Math.min(concurrency, items.length); l++) lanes.push(next());
    return Promise.all(lanes);
  }

  function loadJsonRules(path) {
    return fetch(chrome.runtime.getURL(path))
      .then(function (r) {
        return r.json();
      })
      .then(function (doc) {
        return (doc && Array.isArray(doc.rules) ? doc.rules : []).filter(function (r) {
          return r && r.enabled !== false;
        });
      });
  }

  function ensureRules() {
    if (_drugRules && _qofRules) return Promise.resolve(_drugRules.concat(_qofRules));
    return Promise.all([
      _drugRules ? Promise.resolve(_drugRules) : loadJsonRules('rules/drug-rules.json'),
      _qofRules ? Promise.resolve(_qofRules) : loadJsonRules('rules/qof-rules.json'),
    ]).then(function (pair) {
      _drugRules = pair[0];
      _qofRules = pair[1];
      return _drugRules.concat(_qofRules);
    });
  }

  function evaluatePatientChips(patientUuid) {
    var API = window.SentinelApiClient;
    var NORM = window.SentinelNormalisers;
    var engine = window.SentinelRules;
    if (!API || !NORM || !engine) return Promise.resolve(null);
    var ctx = API.detectMedicusContext(location.href);
    if (!ctx || !ctx.apiBase || !patientUuid) return Promise.resolve(null);
    return ensureRules().then(function (rules) {
      if (!rules || !rules.length) return null;
      return API.fetchAll(ctx.apiBase, patientUuid).then(function (apiResults) {
        if (!apiResults || !apiResults.banner) return null;
        var normalised = NORM.normaliseAll(apiResults, {
          url: location.href,
          title: '',
          view: null,
          patientUuid: patientUuid,
          resolutionSource: 'rx-overdue-scan',
        });
        var chips = engine.evaluatePatient(normalised.medications || [], normalised.observations || [], rules, {
          now: new Date().toISOString(),
          problems: normalised.problems || [],
          patientContext: normalised.patientContext || null,
          observationHistory: normalised.observationHistory || [],
          patientRegisters: normalised.patientRegisters != null ? normalised.patientRegisters : null,
        });
        return O.selectOverdue(chips);
      });
    });
  }

  function resolvePatient(row) {
    var API = window.SentinelApiClient;
    if (!API || !row || !row.taskUuid) return Promise.resolve('');
    var ctx = API.detectMedicusContext(location.href);
    if (!ctx || !ctx.apiBase) return Promise.resolve('');
    var slug = row.taskTypeSlug;
    if (!slug && row.overviewURL) {
      var m = String(row.overviewURL).match(/^\/tasks\/data\/([A-Za-z0-9_-]+)\//);
      slug = m && m[1];
    }
    if (!slug) return Promise.resolve('');
    return API.resolveTaskToPatient(ctx.apiBase, slug, row.taskUuid).then(function (id) {
      return id || '';
    });
  }

  function findQueuePreviewRow(row) {
    if (!row || !row.nextElementSibling) return null;
    var next = row.nextElementSibling;
    if (next.classList && next.classList.contains('ag-full-width-row')) return next;
    return null;
  }

  function chipHost(row) {
    var preview = findQueuePreviewRow(row);
    var target = preview
      ? preview.querySelector('.h-full.w-full') || preview.firstElementChild || preview
      : row.querySelector('[col-id="patientName"]');
    if (!target) return null;
    return { target: target, inPreview: !!preview };
  }

  function removeChips() {
    var nodes = document.querySelectorAll('.' + MARKER);
    for (var i = 0; i < nodes.length; i++) nodes[i].remove();
    var pop = document.getElementById(POP_ID);
    if (pop) pop.remove();
  }

  function closePop() {
    var pop = document.getElementById(POP_ID);
    if (pop) pop.remove();
  }

  function openPop(anchor, group, kind) {
    closePop();
    if (!anchor || !group) return;
    var pop = document.createElement('div');
    pop.id = POP_ID;
    pop.setAttribute('role', 'dialog');
    var title = kind === 'qof' ? 'QOF overdue' : 'Monitoring overdue';
    var lines = (group.items || [])
      .map(function (it) {
        return '<li><strong>' + esc(it.name) + '</strong>' + (it.detail ? ' — ' + esc(it.detail) : '') + '</li>';
      })
      .join('');
    pop.innerHTML =
      '<div class="ms-rx-od-pop-h">' +
      esc(title) +
      '</div><ul class="ms-rx-od-pop-list">' +
      lines +
      '</ul><p class="ms-rx-od-pop-note">Open the request to review. Absence of a button on other rows is not an all-clear.</p>';
    document.documentElement.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 6 + window.scrollY) + 'px';
    pop.style.left = Math.round(Math.max(8, r.left + window.scrollX)) + 'px';
  }

  function injectRow(rowIndex, result) {
    if (!O.hasOverdue(result)) return;
    var row = document.querySelector('.ag-row[row-index="' + rowIndex + '"]:not(.ag-full-width-row)');
    if (!row) return;
    var host = chipHost(row);
    if (!host) return;
    if (host.target.querySelector('.' + MARKER)) return;
    var wrap = document.createElement('span');
    wrap.className = MARKER + (host.inPreview ? '' : ' ' + MARKER + '-inline');
    function addBtn(kind, group) {
      if (!group) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = MARKER + '-btn ' + MARKER + '-' + kind;
      btn.textContent = O.buttonLabel(kind, group.count);
      btn.title = O.itemsTitle(group);
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openPop(btn, group, kind);
      });
      wrap.appendChild(btn);
    }
    addBtn('monitoring', result.monitoring);
    addBtn('qof', result.qof);
    if (!wrap.firstChild) return;
    host.target.insertBefore(wrap, host.target.firstChild);
  }

  function queueSortSignature() {
    var cells = document.querySelectorAll('.ag-header-cell-sorted-asc, .ag-header-cell-sorted-desc');
    if (!cells.length) return '';
    var parts = [];
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      parts.push(
        (c.getAttribute('col-id') || '?') + ':' + (c.classList.contains('ag-header-cell-sorted-asc') ? 'asc' : 'desc')
      );
    }
    return parts.sort().join(',');
  }

  function checkSortCanary() {
    var sig = queueSortSignature();
    if (_sortSig === undefined) {
      _sortSig = sig;
      return false;
    }
    if (sig === _sortSig) return false;
    _sortSig = sig;
    _rows = [];
    return true;
  }

  function reinjectVisible() {
    if (checkSortCanary()) return;
    var i;
    for (i = 0; i < _rows.length; i++) {
      var row = _rows[i];
      var result = _byTask[row.taskUuid];
      if (result) injectRow(row.rowIndex, result);
    }
  }

  function setButtonLabel(text, busy) {
    var btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.textContent = text;
    btn.disabled = !!busy;
  }

  function flaggedCount() {
    var n = 0;
    var seen = Object.create(null);
    for (var i = 0; i < _rows.length; i++) {
      var id = _rows[i].taskUuid;
      if (seen[id]) continue;
      seen[id] = true;
      if (O.hasOverdue(_byTask[id])) n++;
    }
    return n;
  }

  function scannedCount() {
    var n = 0;
    var seen = Object.create(null);
    for (var i = 0; i < _rows.length; i++) {
      var id = _rows[i].taskUuid;
      if (seen[id]) continue;
      seen[id] = true;
      if (_byTask[id] !== undefined) n++;
    }
    return n;
  }

  function visibleTaskIds() {
    var onScreen = Object.create(null);
    var nodes = document.querySelectorAll('.ag-row[row-index]:not(.ag-full-width-row)');
    for (var i = 0; i < nodes.length; i++) {
      var ri = nodes[i].getAttribute('row-index');
      if (ri == null) continue;
      onScreen[String(ri)] = true;
    }
    return onScreen;
  }

  async function runScan() {
    if (_scanning) return;
    var route = currentRoute();
    if (!route) return;
    var gen = ++_scanGen;
    _scanning = true;
    closePop();
    var rows = _rows.slice();
    var vis = visibleTaskIds();
    rows.sort(function (a, b) {
      var av = vis[String(a.rowIndex)] ? 0 : 1;
      var bv = vis[String(b.rowIndex)] ? 0 : 1;
      return av - bv;
    });
    setButtonLabel(O.scanProgressLabel(0, rows.length), true);
    var breaker = makeCircuitBreaker(CIRCUIT_BREAKER_MAX);
    var done = 0;
    try {
      await runWorkerPool(rows, FETCH_CONCURRENCY, async function (row) {
        if (breaker.isTripped() || gen !== _scanGen) return;
        if (_byTask[row.taskUuid] !== undefined) {
          done++;
          if (O.hasOverdue(_byTask[row.taskUuid])) injectRow(row.rowIndex, _byTask[row.taskUuid]);
          setButtonLabel(O.scanProgressLabel(done, rows.length), true);
          return;
        }
        try {
          var patientId = await withTimeout(resolvePatient(row), FETCH_TIMEOUT_MS);
          if (gen !== _scanGen) return;
          var result = null;
          if (patientId && _byPatient[patientId] !== undefined) {
            result = _byPatient[patientId];
          } else if (patientId) {
            result = await withTimeout(evaluatePatientChips(patientId), FETCH_TIMEOUT_MS * 2);
            if (gen !== _scanGen) return;
            _byPatient[patientId] = result;
          }
          breaker.recordSuccess();
          _byTask[row.taskUuid] = result;
          if (O.hasOverdue(result)) injectRow(row.rowIndex, result);
        } catch (_) {
          breaker.recordFailure();
          _byTask[row.taskUuid] = null;
        }
        done++;
        setButtonLabel(O.scanProgressLabel(done, rows.length), true);
      });
    } finally {
      if (gen === _scanGen) {
        _scanning = false;
        setButtonLabel(O.scanDoneLabel(flaggedCount(), scannedCount()), false);
      }
    }
  }

  function onDocClick(e) {
    var pop = document.getElementById(POP_ID);
    if (!pop) return;
    if (pop.contains(e.target)) return;
    if (e.target && e.target.closest && e.target.closest('.' + MARKER + '-btn')) return;
    closePop();
  }

  function rememberRows(detail) {
    var rows = detail && detail.rows;
    var slug = detail && detail.taskTypeSlug;
    if (!Array.isArray(rows) || typeof slug !== 'string' || !SLUG_RE.test(slug)) return;
    if (!C.isRxQueueSlug(slug)) return;
    _rows = [];
    _sortSig = undefined;
    var cap = rows.length > 500 ? rows.slice(0, 500) : rows;
    for (var i = 0; i < cap.length; i++) {
      var row = cap[i];
      if (!row || typeof row !== 'object') continue;
      if (typeof row.rowIndex !== 'number' || row.rowIndex < 0 || (row.rowIndex | 0) !== row.rowIndex) continue;
      if (typeof row.taskUuid !== 'string' || !UUID_RE.test(row.taskUuid)) continue;
      var overviewURL = typeof row.overviewURL === 'string' ? row.overviewURL : '';
      var rowSlug = slug;
      var m = overviewURL.match(/^\/tasks\/data\/([A-Za-z0-9_-]+)\//);
      if (m) rowSlug = m[1];
      _rows.push({
        rowIndex: row.rowIndex,
        taskUuid: row.taskUuid,
        overviewURL: overviewURL,
        taskTypeSlug: rowSlug,
      });
    }
  }

  function onTaskListData(e) {
    _bridgeCount++;
    if (!_bridgeTimer) {
      _bridgeTimer = setTimeout(function () {
        _bridgeCount = 0;
        _bridgeTimer = null;
      }, 5000);
    }
    if (_bridgeCount > 10) return;
    rememberRows(e && e.detail);
    ensureButton();
    reinjectVisible();
  }

  function ensureButton() {
    var route = currentRoute();
    var btn = document.getElementById(BTN_ID);
    if (!route) {
      if (btn) btn.remove();
      closePop();
      return;
    }
    var wrap = document.getElementById(WRAP_ID);
    var launch = document.getElementById(LAUNCH_ID);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = WRAP_ID;
      document.documentElement.appendChild(wrap);
      if (launch) wrap.appendChild(launch);
    } else if (launch && launch.parentNode !== wrap) {
      wrap.appendChild(launch);
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = BTN_ID;
      btn.textContent = O.scanIdleLabel();
      btn.title = 'Scan this prescription list for overdue drug monitoring and QOF. Does not write anything.';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        runScan();
      });
      wrap.appendChild(btn);
    }
  }

  function startHeavyChrome() {
    if (!_bridgeOn) {
      _bridgeOn = true;
      window.addEventListener('ch-task-list-data', onTaskListData);
      document.addEventListener('click', onDocClick, true);
    }
    ensureButton();
    reinjectVisible();
  }

  function stopHeavyChrome() {
    _scanGen++;
    _scanning = false;
    if (_bridgeOn) {
      window.removeEventListener('ch-task-list-data', onTaskListData);
      document.removeEventListener('click', onDocClick, true);
      _bridgeOn = false;
    }
    var btn = document.getElementById(BTN_ID);
    if (btn) btn.remove();
    removeChips();
    var wrap = document.getElementById(WRAP_ID);
    var launch = document.getElementById(LAUNCH_ID);
    if (wrap && !launch) wrap.remove();
    _rows = [];
    _byTask = Object.create(null);
    _byPatient = Object.create(null);
    _sortSig = undefined;
  }

  var Runtime = window.InjectorRuntime;
  if (Runtime && typeof Runtime.register === 'function') {
    Runtime.register('rx-overdue-scan', {
      match: function (pathname, search) {
        return !!C.parseRxQueueRoute(pathname, search);
      },
      start: startHeavyChrome,
      place: function () {
        ensureButton();
        reinjectVisible();
      },
      stop: stopHeavyChrome,
    });
  } else {
    startHeavyChrome();
  }
})();
