// © 2026 Graysbrook Ltd. Proprietary — all rights reserved.
// Medicus Suite — lab allocation canvas (v1, stage-only)
//
// Overlay on the investigation-results task-list. Columns are Unallocated /
// inbox / clinicians; tiles are incoming lab tasks. Drag stages a move.
// Who-ordered placement uses only requester evidence from the overview
// (or an OIR-style "Panel (Dr Name • date)" label). Named GP is a hint,
// never auto-placement. Finalise does not write — the Reassign endpoint
// has not been captured (shared/lab-allocate-core.js WRITE_BLOCKED).
'use strict';

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msLabAllocateCanvas) return;
  window.__msLabAllocateCanvas = true;

  var C = window.LabAllocateCore;
  if (!C) return;

  var OVERLAY_ID = 'ms-lac-overlay';
  var LAUNCH_ID = 'ms-lac-launch';
  var OVERVIEW_CAP = 120;
  var OVERVIEW_CONCURRENCY = 4;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var _route = null;
  var _rows = [];
  var _draft = C.emptyDraft();
  var _error = null;
  var _loading = false;
  var _open = false;
  var _selected = {};
  var _dragIds = null;
  var _copyNote = '';
  var _overviewProgress = '';

  function announce(text) {
    setTimeout(function () {
      var live = document.querySelector('#' + OVERLAY_ID + ' .ms-lac-live');
      if (live) live.textContent = text || '';
    }, 0);
  }

  function currentRoute() {
    return C.parseResultsQueueRoute(location.pathname, location.search);
  }

  function client() {
    if (!_route) throw new Error('lab-allocate: no results-queue route');
    return C.createClient(_route.apiBase);
  }

  function selectedIds() {
    return Object.keys(_selected).filter(function (id) {
      return _selected[id];
    });
  }

  async function enrichRequesters(rows) {
    var pending = rows.filter(function (r) {
      return r && r.overviewURL && !r.requester;
    });
    if (pending.length > OVERVIEW_CAP) pending = pending.slice(0, OVERVIEW_CAP);
    if (!pending.length) return;
    var cli = client();
    var i = 0;
    async function worker() {
      while (i < pending.length) {
        var idx = i++;
        var row = pending[idx];
        _overviewProgress = 'Reading who ordered… ' + (idx + 1) + '/' + pending.length;
        render();
        try {
          var payload = await cli.fetchOverview(row.overviewURL);
          var hint = C.pickRequesterFromOverview(payload);
          if (hint) C.applyRequester(row, hint);
        } catch (_) {
          /* fail closed: leave unallocated */
        }
      }
    }
    var workers = [];
    for (var w = 0; w < OVERVIEW_CONCURRENCY; w++) workers.push(worker());
    await Promise.all(workers);
    _overviewProgress = '';
  }

  async function loadBoard() {
    _loading = true;
    _error = null;
    render();
    try {
      var out = await client().fetchTaskList(_route.slug);
      _rows = out.rows || [];
      _route.slug = out.slug || _route.slug;
      render();
      await enrichRequesters(_rows);
    } catch (err) {
      _error = err && err.message ? err.message : 'Could not read the results queue.';
      _rows = [];
    } finally {
      _loading = false;
      _overviewProgress = '';
      render();
    }
  }

  function tileHtml(tile) {
    var selected = !!_selected[tile.id];
    var cls = 'ms-lac-tile' + (tile.staged ? ' ms-lac-tile-staged' : '') + (selected ? ' ms-lac-tile-picked' : '');
    var who = tile.requester
      ? 'Ordered by ' + tile.requester
      : tile.namedGp
        ? 'Registered GP ' + tile.namedGp + ' — not confirmed as the requester'
        : 'Who ordered this is not on the payload we can read';
    var inbox = tile.assignedTo ? 'Currently assigned: ' + tile.assignedTo : '';
    return (
      '<div class="' +
      cls +
      '" draggable="true" data-task-id="' +
      esc(tile.id) +
      '">' +
      '<div class="ms-lac-tile-name">' +
      esc(tile.patientName) +
      '</div>' +
      '<div class="ms-lac-tile-meta">' +
      esc(tile.summary || tile.statusText || 'Lab result') +
      '</div>' +
      '<div class="ms-lac-tile-who">' +
      esc(who) +
      '</div>' +
      (inbox ? '<div class="ms-lac-tile-meta">' + esc(inbox) + '</div>' : '') +
      (tile.staged ? '<div class="ms-lac-tile-draft">Staged on this canvas only — not in Medicus yet</div>' : '') +
      '</div>'
    );
  }

  function boardHtml() {
    var board = C.buildBoard(_rows, _draft);
    return board.columns
      .map(function (col) {
        return (
          '<div class="ms-lac-col" data-col-key="' +
          esc(col.key) +
          '">' +
          '<h3 class="ms-lac-col-heading">' +
          esc(col.title) +
          '</h3>' +
          '<div class="ms-lac-col-meta">' +
          esc(String(col.count)) +
          (col.kind === 'unallocated'
            ? ' — drop here to leave unmarked'
            : col.kind === 'inbox'
              ? ' — shared inbox, not a person'
              : '') +
          '</div>' +
          (col.tiles.map(tileHtml).join('') || '<div class="ms-lac-empty">No results in this column.</div>') +
          '</div>'
        );
      })
      .join('');
  }

  function confirmBarHtml() {
    if (_error) {
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-error">' +
        esc(_error) +
        ' <button type="button" class="ms-lac-ghost" id="ms-lac-error-dismiss">Dismiss</button></div>'
      );
    }
    var write = C.canWriteAllocations();
    var sum = C.draftSummary(_rows, _draft);
    return (
      '<div class="ms-lac-confirmbar">' +
      '<strong>This canvas does not write.</strong> ' +
      esc(write.reason) +
      (sum.count ? ' ' + sum.count + ' staged move' + (sum.count === 1 ? '' : 's') + ' sit on this canvas only.' : '') +
      (_copyNote ? '<div class="ms-lac-hint">' + esc(_copyNote) + '</div>' : '') +
      '<div class="ms-lac-confirmbar-actions">' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-copy">Copy working list</button>' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-clear"' +
      (sum.count ? '' : ' disabled') +
      '>Clear staged moves</button>' +
      '<button type="button" class="ms-lac-confirm-btn" id="ms-lac-finalise" disabled>Write to Medicus — not available</button>' +
      '</div></div>'
    );
  }

  function overlayHtml() {
    return (
      '<div class="ms-lac-backdrop" id="ms-lac-backdrop">' +
      '<div class="ms-lac-panel" role="dialog" aria-modal="true" aria-labelledby="ms-lac-title">' +
      '<div class="ms-lac-live" aria-live="polite"></div>' +
      '<div class="ms-lac-header">' +
      '<h2 class="ms-lac-title" id="ms-lac-title">Allocate incoming labs</h2>' +
      '<button type="button" class="ms-lac-close" id="ms-lac-close">Close</button>' +
      '</div>' +
      '<div class="ms-lac-explainer">' +
      'Labs in the shared inbox, grouped by who ordered them when that field is actually on the payload. ' +
      'Drag a tile (or select several, then drag) onto a clinician column to stage the allocation. ' +
      'A registered GP is a hint only — it is not who ordered the test. ' +
      'Nothing is written to Medicus from this canvas yet.' +
      (_overviewProgress ? ' ' + esc(_overviewProgress) : '') +
      '</div>' +
      '<div class="ms-lac-filterbar">' +
      '<label class="ms-lac-add">Add clinician column <input type="text" id="ms-lac-add-name" maxlength="80" placeholder="e.g. Dr Jane Cole"></label>' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-add-btn">Add column</button>' +
      '<span class="ms-lac-hint">' +
      esc(_rows.length ? _rows.length + ' results on the queue' : '') +
      '</span>' +
      '</div>' +
      '<div class="ms-lac-body"><div class="ms-lac-board" id="ms-lac-board">' +
      (_loading && !_rows.length ? '<div class="ms-lac-msg">Reading the results queue…</div>' : boardHtml()) +
      '</div></div>' +
      confirmBarHtml() +
      '</div></div>'
    );
  }

  function render() {
    var el = document.getElementById(OVERLAY_ID);
    if (!el || !_open) return;
    el.innerHTML = overlayHtml();
    bindOverlay(el);
  }

  function toggleSelect(id, additive) {
    if (!additive) {
      var only = !_selected[id] || selectedIds().length > 1;
      _selected = {};
      if (only) _selected[id] = true;
    } else {
      _selected[id] = !_selected[id];
    }
    render();
  }

  function addNamedColumn() {
    var input = document.getElementById('ms-lac-add-name');
    var name = input && input.value;
    if (!name || !String(name).trim()) return;
    _draft = C.addColumn(_draft, name);
    announce('Added column ' + String(name).trim());
    render();
  }

  function bindOverlay(root) {
    var close = root.querySelector('#ms-lac-close');
    if (close) close.addEventListener('click', requestClose);
    var backdrop = root.querySelector('#ms-lac-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop) requestClose();
      });
    }
    var dismiss = root.querySelector('#ms-lac-error-dismiss');
    if (dismiss)
      dismiss.addEventListener('click', function () {
        _error = null;
        render();
      });
    var addBtn = root.querySelector('#ms-lac-add-btn');
    if (addBtn) addBtn.addEventListener('click', addNamedColumn);
    var addName = root.querySelector('#ms-lac-add-name');
    if (addName) {
      addName.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addNamedColumn();
        }
      });
    }
    var copyBtn = root.querySelector('#ms-lac-copy');
    if (copyBtn) copyBtn.addEventListener('click', copyWorkingList);
    var clearBtn = root.querySelector('#ms-lac-clear');
    if (clearBtn)
      clearBtn.addEventListener('click', function () {
        _draft = C.emptyDraft();
        _copyNote = '';
        announce('Staged moves cleared. The queue itself is unchanged.');
        render();
      });
    root.querySelectorAll('.ms-lac-tile').forEach(function (tile) {
      tile.addEventListener('click', function (e) {
        var id = tile.getAttribute('data-task-id');
        if (!id) return;
        toggleSelect(id, e.metaKey || e.ctrlKey);
      });
      tile.addEventListener('dragstart', function (e) {
        var id = tile.getAttribute('data-task-id');
        var ids = _selected[id] ? selectedIds() : [id];
        _dragIds = ids;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', ids.join(','));
          e.dataTransfer.effectAllowed = 'move';
        }
      });
      tile.addEventListener('dragend', function () {
        _dragIds = null;
      });
    });
    root.querySelectorAll('.ms-lac-col').forEach(function (col) {
      col.addEventListener('dragover', function (e) {
        e.preventDefault();
        col.classList.add('ms-lac-drop-hover');
      });
      col.addEventListener('dragleave', function () {
        col.classList.remove('ms-lac-drop-hover');
      });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('ms-lac-drop-hover');
        var key = col.getAttribute('data-col-key');
        var ids = _dragIds && _dragIds.length ? _dragIds : [];
        if (!ids.length && e.dataTransfer) {
          ids = String(e.dataTransfer.getData('text/plain') || '')
            .split(',')
            .filter(Boolean);
        }
        if (!key || !ids.length) return;
        _draft = C.stageMoves(_draft, ids, key);
        _selected = {};
        _dragIds = null;
        announce(
          'Staged ' +
            ids.length +
            ' result' +
            (ids.length === 1 ? '' : 's') +
            ' onto ' +
            (col.querySelector('.ms-lac-col-heading') || {}).textContent
        );
        render();
      });
    });
  }

  function copyWorkingList() {
    var text = C.copyList(C.buildBoard(_rows, _draft));
    var done = function (ok) {
      _copyNote = ok
        ? 'Working list copied. It is not a record of anything written to Medicus.'
        : 'Could not copy — select the list from a text dump if you need it.';
      render();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          done(true);
        },
        function () {
          done(fallbackCopy(text));
        }
      );
      return;
    }
    done(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  function requestClose() {
    closeOverlay();
  }

  function closeOverlay() {
    _open = false;
    _rows = [];
    _draft = C.emptyDraft();
    _selected = {};
    _error = null;
    _copyNote = '';
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
  }

  function openOverlay() {
    _route = currentRoute();
    if (!_route) return;
    _open = true;
    _draft = C.emptyDraft();
    _selected = {};
    var el = document.getElementById(OVERLAY_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = OVERLAY_ID;
      document.documentElement.appendChild(el);
    }
    render();
    loadBoard();
  }

  function ensureLauncher() {
    var route = currentRoute();
    var launch = document.getElementById(LAUNCH_ID);
    if (!route) {
      if (launch) launch.remove();
      if (_open) closeOverlay();
      return;
    }
    _route = route;
    if (!launch) {
      launch = document.createElement('button');
      launch.type = 'button';
      launch.id = LAUNCH_ID;
      launch.textContent = 'Allocate labs on canvas…';
      launch.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openOverlay();
      });
      document.documentElement.appendChild(launch);
    }
  }

  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'Escape' && _open) {
        e.stopPropagation();
        requestClose();
      }
    },
    true
  );

  var _mo = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var t = records[i].target;
      if (t && t.closest && (t.closest('#' + OVERLAY_ID) || t.closest('#' + LAUNCH_ID))) return;
    }
    ensureLauncher();
  });
  _mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', ensureLauncher);
  setInterval(ensureLauncher, 1500);
  ensureLauncher();
})();
