// © 2026 Graysbrook Ltd. Proprietary — all rights reserved.
// Medicus Suite — lab allocation canvas (v2, stage-only workbench)
//
// Full-bleed workspace over the investigation-results task-list. The pile is
// Investigation reports, grouped by who requested them — one-line rows under
// sticky group headers so 73 results read at a glance. Clinicians are drop
// chips on the right: select a group (click its header) then click a chip to
// stage, or drag. Named GP is a hint, never auto-placement. Finalise does not
// write — the Reassign endpoint has not been captured
// (shared/lab-allocate-core.js WRITE_BLOCKED).
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
  var _rota = { staff: [], leave: [], loaded: false };
  var _book = null;
  var _absences = [];
  var _pendingAbsence = null;
  var _confirmClose = false;
  var _dragGhost = null;
  var _expandedChip = '';
  var _collapsed = {};

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

  function setProgress(text) {
    _overviewProgress = text || '';
    var node = document.getElementById('ms-lac-progress');
    if (node) node.textContent = _overviewProgress;
  }

  async function enrichRequesters(rows) {
    var pending = rows.filter(function (r) {
      return r && r.overviewURL && !r.requester;
    });
    if (pending.length > OVERVIEW_CAP) pending = pending.slice(0, OVERVIEW_CAP);
    if (!pending.length) return;
    var cli = client();
    var i = 0;
    var done = 0;
    async function worker() {
      while (i < pending.length) {
        var idx = i++;
        var row = pending[idx];
        try {
          var payload = await cli.fetchOverview(row.overviewURL);
          var hint = C.pickRequesterFromOverview(payload);
          if (hint) C.applyRequester(row, hint);
        } catch (_) {
          /* fail closed: leave in the unknown pile */
        }
        done++;
        setProgress('Reading who ordered… ' + done + '/' + pending.length);
      }
    }
    var workers = [];
    for (var w = 0; w < OVERVIEW_CONCURRENCY; w++) workers.push(worker());
    await Promise.all(workers);
    setProgress('');
  }

  async function loadBoard() {
    _loading = true;
    _error = null;
    render();
    try {
      var presenceP = Promise.all([loadRotaAbsences(), loadMedicusPresence()]);
      var out = await client().fetchTaskList(_route.slug);
      _rows = out.rows || [];
      _route.slug = out.slug || _route.slug;
      render();
      await presenceP;
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

  async function loadRotaAbsences() {
    _rota = { staff: [], leave: [], loaded: false };
    if (!chrome.storage || !chrome.storage.local) return;
    try {
      var got = await chrome.storage.local.get(['rota.staff', 'rota.leave']);
      _rota = {
        staff: Array.isArray(got['rota.staff']) ? got['rota.staff'] : [],
        leave: Array.isArray(got['rota.leave']) ? got['rota.leave'] : [],
        loaded: true,
      };
    } catch (_) {
      _rota = { staff: [], leave: [], loaded: false };
    }
  }

  async function loadMedicusPresence() {
    _book = null;
    _absences = [];
    if (!_route) return;
    var cli = client();
    var date = C.todayISO();
    try {
      _book = await cli.fetchTodayBook(date);
    } catch (_) {
      _book = null;
    }
    try {
      _absences = await cli.fetchStaffScheduleAbsences();
    } catch (_) {
      _absences = [];
    }
  }

  function presenceForClinician(col) {
    if (!col || col.kind !== 'clinician') return { state: 'n/a', reason: 'not-a-person', label: '' };
    // Display casing — matching is case-insensitive, labels are user-facing.
    return C.presenceForName({
      name: C.displayClinicianName(col.title),
      dateISO: C.todayISO(),
      book: _book,
      absences: _absences,
      staffList: _rota.staff,
      leaveList: _rota.leave,
    });
  }

  // One-line row. Group headers carry who ordered; the row only repeats it
  // in the unknown pile, where it varies per row and is load-bearing.
  function tileHtml(tile, opts) {
    opts = opts || {};
    var selected = !!_selected[tile.id];
    var cls = 'ms-lac-tile' + (tile.staged ? ' ms-lac-tile-staged' : '') + (selected ? ' ms-lac-tile-picked' : '');
    var assignedPerson =
      tile.assignedTo && !C.isTeamAssignee(tile.assignedTo)
        ? '<span class="ms-lac-tile-token">with ' + esc(C.displayClinicianName(tile.assignedTo)) + '</span>'
        : '';
    var whoLine = '';
    if (opts.showWho) {
      var who = tile.requester
        ? 'Ordered by ' + C.displayClinicianName(tile.requester)
        : tile.namedGp
          ? 'Registered GP ' + tile.namedGp + ' — not confirmed as the requester'
          : 'Who ordered this is not recorded on the task';
      whoLine = '<span class="ms-lac-tile-who">' + esc(who) + '</span>';
    }
    return (
      '<div class="' +
      cls +
      '" role="option" tabindex="0" aria-selected="' +
      (selected ? 'true' : 'false') +
      '" draggable="true" data-task-id="' +
      esc(tile.id) +
      '">' +
      '<span class="ms-lac-tile-check" aria-hidden="true">' +
      (selected ? '✓' : '') +
      '</span>' +
      '<span class="ms-lac-tile-name">' +
      esc(tile.patientName) +
      '</span>' +
      '<span class="ms-lac-tile-test">' +
      esc(tile.summary || tile.statusText || 'Lab result') +
      '</span>' +
      assignedPerson +
      whoLine +
      '</div>'
    );
  }

  function groupHtml(group) {
    var collapsed = !!_collapsed[group.key];
    var title = group.known ? C.displayClinicianName(group.requester) : 'Who ordered is unknown';
    var idsAttr = esc(group.tileIds.join(','));
    var selectedInGroup = group.tiles.filter(function (t) {
      return _selected[t.id];
    }).length;
    return (
      '<section class="ms-lac-group' +
      (collapsed ? ' ms-lac-group-collapsed' : '') +
      '" data-group-key="' +
      esc(group.key) +
      '">' +
      '<div class="ms-lac-group-head" role="button" tabindex="0" draggable="true" data-group-ids="' +
      idsAttr +
      '" data-group-key="' +
      esc(group.key) +
      '" aria-label="Select all ' +
      group.count +
      (group.known ? ' ordered by ' + esc(title) : ' with unknown requester') +
      '">' +
      '<span class="ms-lac-group-grip" aria-hidden="true">⠿</span>' +
      '<span class="ms-lac-group-title">' +
      esc(title) +
      '</span>' +
      '<span class="ms-lac-group-count">' +
      group.count +
      '</span>' +
      (selectedInGroup
        ? '<span class="ms-lac-group-picked">' + selectedInGroup + ' selected</span>'
        : '<span class="ms-lac-group-hint">Select all</span>') +
      '<button type="button" class="ms-lac-group-toggle" data-toggle-key="' +
      esc(group.key) +
      '" aria-expanded="' +
      (collapsed ? 'false' : 'true') +
      '" aria-label="' +
      (collapsed ? 'Show' : 'Hide') +
      ' this group">' +
      (collapsed ? '▸' : '▾') +
      '</button>' +
      '</div>' +
      (collapsed
        ? ''
        : '<div class="ms-lac-group-body" role="listbox" aria-label="' +
          esc(title) +
          '">' +
          group.tiles
            .map(function (t) {
              return tileHtml(t, { showWho: !group.known });
            })
            .join('') +
          '</div>') +
      '</section>'
    );
  }

  function chipCounts(col) {
    var bits = [];
    if (col.stagedCount) bits.push(col.stagedCount + ' staged');
    if (col.inPoolCount) bits.push(col.inPoolCount + ' in pile');
    return bits.length ? bits.join(' · ') : 'none in pile';
  }

  function chipHtml(col, selCount) {
    var abs = presenceForClinician(col);
    var away = abs.state === 'away' || abs.state === 'away-pending';
    var inToday = abs.state === 'present' && abs.reason === 'in-today';
    var open = _expandedChip === col.key;
    var body = col.tiles
      .map(function (t) {
        return tileHtml(t, { showWho: false });
      })
      .join('');
    var flag = away
      ? '<span class="ms-lac-chip-flag">AWAY</span>'
      : inToday
        ? '<span class="ms-lac-chip-flag ms-lac-chip-flag-in">In today</span>'
        : '';
    var note = '';
    if (away && abs.label) note = '<div class="ms-lac-col-absence">' + esc(abs.label) + '</div>';
    else if (inToday && abs.label) note = '<div class="ms-lac-col-in">' + esc(abs.label) + '</div>';
    var name = C.displayClinicianName(col.title);
    return (
      '<div class="ms-lac-chip-wrap' +
      (away ? ' ms-lac-chip-away' : '') +
      (inToday ? ' ms-lac-chip-in' : '') +
      (open ? ' ms-lac-chip-open' : '') +
      (selCount ? ' ms-lac-chip-target' : '') +
      '" data-col-key="' +
      esc(col.key) +
      '" data-col-kind="clinician">' +
      '<button type="button" class="ms-lac-chip" data-chip-key="' +
      esc(col.key) +
      '" aria-expanded="' +
      (open ? 'true' : 'false') +
      '" aria-controls="ms-lac-drawer-' +
      esc(col.key).replace(/[^a-z0-9]/gi, '_') +
      '" aria-label="' +
      esc(selCount ? 'Stage ' + selCount + ' selected results onto ' + name : name) +
      '">' +
      '<span class="ms-lac-chip-name">' +
      esc(name) +
      '</span>' +
      flag +
      '<span class="ms-lac-chip-count">' +
      esc(chipCounts(col)) +
      '</span>' +
      (selCount ? '<span class="ms-lac-chip-stagehint">Stage ' + selCount + ' here</span>' : '') +
      '</button>' +
      (open
        ? '<div class="ms-lac-chip-drawer" role="listbox" aria-label="Staged onto ' +
          esc(name) +
          '" id="ms-lac-drawer-' +
          esc(col.key).replace(/[^a-z0-9]/gi, '_') +
          '">' +
          note +
          (body ||
            '<div class="ms-lac-empty-sm">Nothing staged onto them yet. Select a group in the pile, then click this chip.</div>') +
          '</div>'
        : '') +
      '</div>'
    );
  }

  function emptyPoolHtml() {
    return (
      '<div class="ms-lac-empty">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<path d="M3 8l4-5h10l4 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 8h18"/><path d="M9 12h6"/>' +
      '</svg>' +
      '<div class="ms-lac-empty-title">No investigation reports on this queue</div>' +
      '<div class="ms-lac-empty-sub">New results appear here grouped by who requested them</div>' +
      '</div>'
    );
  }

  function boardHtml() {
    var board = C.buildWorkspace(_rows, _draft);
    var pool = board.pool;
    var selCount = selectedIds().length;
    var body = pool.groups && pool.groups.length ? pool.groups.map(groupHtml).join('') : '';
    if (!body && board.count > 0) {
      body =
        '<div class="ms-lac-empty"><div class="ms-lac-empty-title">The pile is clear</div>' +
        '<div class="ms-lac-empty-sub">Every result is staged on a clinician chip — on this canvas only</div></div>';
    }
    return (
      '<div class="ms-lac-workspace">' +
      '<div class="ms-lac-col ms-lac-pool" data-col-key="' +
      esc(pool.key) +
      '" data-col-kind="pool">' +
      '<div class="ms-lac-pool-head">' +
      '<h3 class="ms-lac-col-heading">' +
      esc(pool.title) +
      '</h3>' +
      '<span class="ms-lac-pool-count">' +
      pool.count +
      ' of ' +
      board.count +
      '</span>' +
      '<span class="ms-lac-col-meta">Drop here to keep in the pile</span>' +
      '</div>' +
      (body || emptyPoolHtml()) +
      '</div>' +
      '<aside class="ms-lac-rail" aria-label="Clinicians">' +
      '<div class="ms-lac-rail-head">' +
      '<h3 class="ms-lac-col-heading">Clinicians</h3>' +
      '<span class="ms-lac-col-meta">' +
      (selCount ? 'Click a name to stage the selection' : 'Drop targets — click a name to see what is on them') +
      '</span>' +
      '</div>' +
      (board.clinicians.length
        ? board.clinicians
            .map(function (col) {
              return chipHtml(col, selCount);
            })
            .join('')
        : '<div class="ms-lac-empty-sm">No requester names read yet — add a clinician below if you need a drop target.</div>') +
      '<div class="ms-lac-add-row">' +
      '<input type="text" id="ms-lac-add-name" maxlength="80" placeholder="Add clinician chip — e.g. Dr Jane Cole" aria-label="Add clinician chip">' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-add-btn">Add chip</button>' +
      '</div>' +
      '</aside></div>'
    );
  }

  function selectionBarHtml() {
    var n = selectedIds().length;
    if (!n) return '';
    var preview = C.dragPreview(_rows, selectedIds());
    return (
      '<div class="ms-lac-selectbar">' +
      '<span class="ms-lac-selectbar-count">' +
      n +
      ' selected</span>' +
      '<span class="ms-lac-selectbar-label">' +
      esc(preview.label) +
      ' — click a clinician chip to stage them, or drag</span>' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-sel-clear">Clear selection</button>' +
      '</div>'
    );
  }

  function confirmBarHtml() {
    if (_error) {
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-error">' +
        esc(_error) +
        ' <button type="button" class="ms-lac-ghost" id="ms-lac-error-dismiss">Dismiss</button></div>'
      );
    }
    if (_confirmClose) {
      var n = C.draftSummary(_rows, _draft).count;
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-warn">' +
        '<strong>Close and discard?</strong> ' +
        n +
        ' staged move' +
        (n === 1 ? '' : 's') +
        ' exist only on this canvas — closing forgets them. The Medicus queue itself is untouched either way.' +
        '<div class="ms-lac-confirmbar-actions">' +
        '<button type="button" class="ms-lac-ghost" id="ms-lac-close-keep">Keep working</button>' +
        '<button type="button" class="ms-lac-confirm-btn" id="ms-lac-close-discard">Discard and close</button>' +
        '</div></div>'
      );
    }
    if (_pendingAbsence) {
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-warn">' +
        '<strong>Absence check before staging.</strong> ' +
        esc(_pendingAbsence.copy) +
        '<div class="ms-lac-confirmbar-actions">' +
        '<button type="button" class="ms-lac-ghost" id="ms-lac-abs-cancel">Keep them where they were</button>' +
        '<button type="button" class="ms-lac-confirm-btn" id="ms-lac-abs-stage">Stage anyway</button>' +
        '</div></div>'
      );
    }
    var sum = C.draftSummary(_rows, _draft);
    return (
      '<div class="ms-lac-confirmbar">' +
      '<span class="ms-lac-confirmbar-note"><strong>Planning board.</strong> Nothing is written to Medicus — staged moves live on this canvas only' +
      (sum.count ? ' (' + sum.count + ' staged so far)' : '') +
      '. Copy the working list to reassign in Medicus.</span>' +
      (_copyNote ? '<span class="ms-lac-hint">' + esc(_copyNote) + '</span>' : '') +
      '<div class="ms-lac-confirmbar-actions">' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-copy">Copy working list</button>' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-clear"' +
      (sum.count ? '' : ' disabled') +
      '>Clear staged moves</button>' +
      '<button type="button" class="ms-lac-confirm-btn" id="ms-lac-finalise" disabled title="The Medicus Reassign endpoint has not been captured yet">Write to Medicus — not available</button>' +
      '</div></div>'
    );
  }

  function shellHtml() {
    var board = C.buildWorkspace(_rows, _draft);
    var requesterGroups = board.pool.groups.filter(function (g) {
      return g.known;
    }).length;
    var counts = _rows.length ? _rows.length + ' results · ' + requesterGroups + ' requesters' : '';
    return (
      '<div class="ms-lac-panel" role="dialog" aria-modal="true" aria-labelledby="ms-lac-title">' +
      '<div class="ms-lac-header">' +
      '<h2 class="ms-lac-title" id="ms-lac-title">Allocate incoming labs</h2>' +
      '<span class="ms-lac-header-counts">' +
      esc(counts) +
      '</span>' +
      '<span class="ms-lac-header-note">Select a group, then click a clinician — or drag. Nothing is written to Medicus.</span>' +
      '<span class="ms-lac-hint" id="ms-lac-progress">' +
      esc(_overviewProgress) +
      '</span>' +
      '<button type="button" class="ms-lac-close" id="ms-lac-close">Close</button>' +
      '</div>' +
      selectionBarHtml() +
      '<div class="ms-lac-body"><div class="ms-lac-board" id="ms-lac-board">' +
      (_loading && !_rows.length ? '<div class="ms-lac-msg">Reading the results queue…</div>' : boardHtml()) +
      '</div></div>' +
      confirmBarHtml() +
      '</div>'
    );
  }

  function focusKeyOf(el) {
    if (!el || !el.getAttribute) return '';
    return (
      (el.id && '#' + el.id) ||
      (el.getAttribute('data-task-id') && '[data-task-id="' + el.getAttribute('data-task-id') + '"]') ||
      (el.getAttribute('data-chip-key') && '[data-chip-key="' + el.getAttribute('data-chip-key') + '"]') ||
      (el.getAttribute('data-group-key') &&
        '.ms-lac-group-head[data-group-key="' + el.getAttribute('data-group-key') + '"]') ||
      ''
    );
  }

  function render() {
    var el = document.getElementById(OVERLAY_ID);
    if (!el || !_open) return;
    var shell = el.querySelector('.ms-lac-shell');
    if (!shell) return;
    var focusKey = focusKeyOf(document.activeElement);
    shell.innerHTML = shellHtml();
    bindOverlay(shell);
    if (focusKey) {
      var again = shell.querySelector(focusKey);
      if (again) again.focus();
    }
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
    announce('Added clinician chip ' + String(name).trim());
    render();
  }

  function bindOverlay(root) {
    var close = root.querySelector('#ms-lac-close');
    if (close) close.addEventListener('click', requestClose);
    var dismiss = root.querySelector('#ms-lac-error-dismiss');
    if (dismiss)
      dismiss.addEventListener('click', function () {
        _error = null;
        render();
      });
    var keepBtn = root.querySelector('#ms-lac-close-keep');
    if (keepBtn)
      keepBtn.addEventListener('click', function () {
        _confirmClose = false;
        render();
      });
    var discardBtn = root.querySelector('#ms-lac-close-discard');
    if (discardBtn) discardBtn.addEventListener('click', closeOverlay);
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
    var selClear = root.querySelector('#ms-lac-sel-clear');
    if (selClear)
      selClear.addEventListener('click', function () {
        _selected = {};
        announce('Selection cleared');
        render();
      });
    var copyBtn = root.querySelector('#ms-lac-copy');
    if (copyBtn) copyBtn.addEventListener('click', copyWorkingList);
    var clearBtn = root.querySelector('#ms-lac-clear');
    if (clearBtn)
      clearBtn.addEventListener('click', function () {
        _draft = C.emptyDraft();
        _copyNote = '';
        _pendingAbsence = null;
        announce('Staged moves cleared. The queue itself is unchanged.');
        render();
      });
    var absCancel = root.querySelector('#ms-lac-abs-cancel');
    if (absCancel)
      absCancel.addEventListener('click', function () {
        _pendingAbsence = null;
        announce('Not staged. They stayed where they were.');
        render();
      });
    var absStage = root.querySelector('#ms-lac-abs-stage');
    if (absStage)
      absStage.addEventListener('click', function () {
        if (!_pendingAbsence) return;
        commitStage(_pendingAbsence.ids, _pendingAbsence.key);
      });
    function beginDrag(e, ids) {
      _dragIds = ids;
      var preview = C.dragPreview(_rows, ids);
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', ids.join(','));
        e.dataTransfer.effectAllowed = 'move';
        if (_dragGhost) _dragGhost.remove();
        _dragGhost = document.createElement('div');
        _dragGhost.className = 'ms-lac-drag-ghost';
        _dragGhost.textContent = preview.label;
        document.body.appendChild(_dragGhost);
        e.dataTransfer.setDragImage(_dragGhost, 16, 16);
      }
      announce(preview.label);
    }
    function endDrag() {
      _dragIds = null;
      if (_dragGhost) {
        _dragGhost.remove();
        _dragGhost = null;
      }
    }
    function selectGroup(head) {
      var ids = String(head.getAttribute('data-group-ids') || '')
        .split(',')
        .filter(Boolean);
      _selected = {};
      ids.forEach(function (id) {
        _selected[id] = true;
      });
      announce('Selected ' + ids.length + ' — click a clinician chip to stage them, or drag');
      render();
    }
    root.querySelectorAll('.ms-lac-group-toggle').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var key = btn.getAttribute('data-toggle-key') || '';
        _collapsed[key] = !_collapsed[key];
        render();
      });
    });
    root.querySelectorAll('.ms-lac-group-head').forEach(function (head) {
      head.addEventListener('click', function (e) {
        e.stopPropagation();
        selectGroup(head);
      });
      head.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectGroup(head);
        }
      });
      head.addEventListener('dragstart', function (e) {
        var ids = String(head.getAttribute('data-group-ids') || '')
          .split(',')
          .filter(Boolean);
        beginDrag(e, ids);
      });
      head.addEventListener('dragend', endDrag);
    });
    root.querySelectorAll('.ms-lac-tile').forEach(function (tile) {
      tile.addEventListener('click', function (e) {
        var id = tile.getAttribute('data-task-id');
        if (!id) return;
        toggleSelect(id, e.metaKey || e.ctrlKey);
      });
      tile.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var id = tile.getAttribute('data-task-id');
          if (id) toggleSelect(id, true);
        }
      });
      tile.addEventListener('dragstart', function (e) {
        var id = tile.getAttribute('data-task-id');
        var ids = _selected[id] ? selectedIds() : [id];
        beginDrag(e, ids);
      });
      tile.addEventListener('dragend', endDrag);
    });
    function bindDropTarget(el) {
      el.addEventListener('dragover', function (e) {
        e.preventDefault();
        el.classList.add('ms-lac-drop-hover');
      });
      el.addEventListener('dragleave', function (e) {
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;
        el.classList.remove('ms-lac-drop-hover');
      });
      el.addEventListener('drop', function (e) {
        e.preventDefault();
        el.classList.remove('ms-lac-drop-hover');
        var key = el.getAttribute('data-col-key');
        var ids = _dragIds && _dragIds.length ? _dragIds : [];
        if (!ids.length && e.dataTransfer) {
          ids = String(e.dataTransfer.getData('text/plain') || '')
            .split(',')
            .filter(Boolean);
        }
        endDrag();
        if (!key || !ids.length) return;
        requestStage(ids, key, el);
      });
    }
    root.querySelectorAll('.ms-lac-col, .ms-lac-chip-wrap').forEach(bindDropTarget);
    root.querySelectorAll('.ms-lac-chip').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var key = btn.getAttribute('data-chip-key') || '';
        var ids = selectedIds();
        if (ids.length) {
          // The non-drag path: an active selection makes every chip a
          // one-click stage target.
          requestStage(ids, key, btn.closest('.ms-lac-chip-wrap'));
          return;
        }
        _expandedChip = _expandedChip === key ? '' : key;
        render();
      });
    });
  }

  function requestStage(ids, key, colEl) {
    var kind = (colEl && colEl.getAttribute('data-col-kind')) || '';
    var titleEl =
      (colEl && colEl.querySelector('.ms-lac-chip-name')) || (colEl && colEl.querySelector('.ms-lac-col-heading'));
    var title = C.displayClinicianName((titleEl && titleEl.textContent) || '');
    if (kind === 'clinician') {
      var abs = C.presenceForName({
        name: title,
        dateISO: C.todayISO(),
        book: _book,
        absences: _absences,
        staffList: _rota.staff,
        leaveList: _rota.leave,
      });
      if (C.shouldWarnAbsence(abs)) {
        _pendingAbsence = {
          ids: ids,
          key: key,
          copy: C.absenceWarningCopy(abs, ids.length, title),
        };
        announce('Absence check before staging onto ' + title);
        render();
        return;
      }
    }
    commitStage(ids, key);
  }

  function commitStage(ids, key) {
    _draft = C.stageMoves(_draft, ids, key);
    _selected = {};
    _pendingAbsence = null;
    _dragIds = null;
    if (key && key.indexOf('clinician:') === 0) _expandedChip = key;
    announce('Staged ' + ids.length + ' result' + (ids.length === 1 ? '' : 's') + ' on this canvas only');
    render();
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
    if (C.draftSummary(_rows, _draft).count > 0) {
      _confirmClose = true;
      announce('Close and discard staged moves? Confirm below.');
      render();
      return;
    }
    closeOverlay();
  }

  function closeOverlay() {
    _open = false;
    _rows = [];
    _draft = C.emptyDraft();
    _selected = {};
    _error = null;
    _copyNote = '';
    _expandedChip = '';
    _confirmClose = false;
    _collapsed = {};
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    var launch = document.getElementById(LAUNCH_ID);
    if (launch) launch.focus();
  }

  function openOverlay() {
    _route = currentRoute();
    if (!_route) return;
    _open = true;
    _draft = C.emptyDraft();
    _selected = {};
    _expandedChip = '';
    _confirmClose = false;
    _collapsed = {};
    var el = document.getElementById(OVERLAY_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = OVERLAY_ID;
      // The live region is a stable sibling of the re-rendered shell so
      // announcements survive re-renders.
      el.innerHTML = '<div class="ms-lac-live" aria-live="polite"></div><div class="ms-lac-shell"></div>';
      document.documentElement.appendChild(el);
    }
    render();
    var close = el.querySelector('#ms-lac-close');
    if (close) close.focus();
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
        if (selectedIds().length) {
          _selected = {};
          announce('Selection cleared');
          render();
          return;
        }
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
