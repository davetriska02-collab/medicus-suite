// © 2026 Graysbrook Ltd. Proprietary — all rights reserved.
// Medicus Suite — lab allocation canvas (v2 workbench + captured write)
//
// Full-bleed workspace over the investigation-results task-list. The large
// left box is UNALLOCATED investigation reports only, grouped by who
// requested them. Already-assigned work sits in the right-hand clinician
// fields — click a field to expand and see what sits with them. Select in
// the pile, then drag onto a field (or click the field). Named GP is a
// hint, never auto-placement.
//
// Writing uses Medicus's own POST /tasks/task-list/bulk-reassign (captured
// 2026-08-25). The canvas never POSTs itself — it calls LabAllocateCore's
// client. Confirm lists patient → clinician. UI copy never claims the
// write finished.
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
  var _confirmWrite = null;
  var _writing = false;
  var _taskList = undefined;
  var _staffDir = C.harvestStaffDirectory([], null);
  var _dragGhost = null;
  var _expandedChip = '';
  var _collapsed = {};
  var _addOpen = false;
  var _focusConfirm = false;
  var _focusAdd = false;
  var _favourites = { version: 1, keys: [] };
  var _poolPresence = 'all';
  var _poolTest = '';
  var _poolQuery = '';
  var _poolCaret = null;

  function announce(text) {
    setTimeout(function () {
      var live = document.querySelector('#' + OVERLAY_ID + ' .ms-lac-live');
      if (live) live.textContent = text || '';
    }, 0);
  }

  function scrollNearEdge(e) {
    if (!_dragIds || !_open || !e) return;
    var nodes = [
      document.querySelector('#' + OVERLAY_ID + ' .ms-lac-rail'),
      document.querySelector('#' + OVERLAY_ID + ' .ms-lac-pool'),
    ];
    for (var i = 0; i < nodes.length; i++) {
      var scroller = nodes[i];
      if (!scroller) continue;
      var rect = scroller.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        continue;
      }
      var edge = 56;
      var step = 24;
      if (e.clientY < rect.top + edge) scroller.scrollTop -= step;
      else if (e.clientY > rect.bottom - edge) scroller.scrollTop += step;
    }
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
          _staffDir = C.mergeStaffDirectory(_staffDir, C.harvestStaffDirectory(null, payload));
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

  // Requested By on the task-list means enrichRequesters skips overviews —
  // and that used to skip assigneeOptions.staff too, so the write had no
  // UUIDs and the button silently did nothing. Always read a few overviews
  // for the staff directory, even when who ordered is already known.
  async function harvestStaffFromOverviews(rows) {
    var withUrl = (rows || []).filter(function (r) {
      return r && r.overviewURL;
    });
    var cap = Math.min(withUrl.length, 4);
    for (var i = 0; i < cap; i++) {
      try {
        var payload = await client().fetchOverview(withUrl[i].overviewURL);
        _staffDir = C.mergeStaffDirectory(_staffDir, C.harvestStaffDirectory(null, payload));
        if (_staffDir.list && _staffDir.list.length >= 8) return;
      } catch (_) {
        /* try the next overview */
      }
    }
  }

  function harvestStaffFromBook(book) {
    if (!book || !book.source) return;
    _staffDir = C.mergeStaffDirectory(_staffDir, C.harvestStaffDirectory(null, book.source));
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
      _taskList = out.taskList;
      _staffDir = C.harvestStaffDirectory(_rows, out.body);
      render();
      await presenceP;
      harvestStaffFromBook(_book);
      render();
      await harvestStaffFromOverviews(_rows);
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

  function sortByName(cols) {
    return (cols || []).slice().sort(function (a, b) {
      var na = C.displayClinicianName(a.title).toLowerCase();
      var nb = C.displayClinicianName(b.title).toLowerCase();
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    });
  }

  function railSections(cols) {
    var fav = [];
    var inToday = [];
    var holding = [];
    var rest = [];
    var seen = {};
    sortByName(cols).forEach(function (col) {
      if (C.isFavouriteKey(_favourites, col.key)) {
        fav.push(col);
        seen[col.key] = true;
      }
    });
    sortByName(cols).forEach(function (col) {
      if (seen[col.key]) return;
      var p = presenceForClinician(col);
      if (p.state === 'present' && p.reason === 'in-today') {
        inToday.push(col);
        return;
      }
      if (col.count > 0 || col.stagedCount > 0) {
        holding.push(col);
        return;
      }
      rest.push(col);
    });
    return [
      { id: 'fav', title: 'Favourites', cols: fav },
      { id: 'in', title: 'In today', cols: inToday },
      { id: 'hold', title: 'Holding work', cols: holding },
      { id: 'else', title: 'Everyone else', cols: rest },
    ].filter(function (s) {
      return s.cols.length;
    });
  }

  function groupPresenceBucket(group) {
    if (!group || !group.known || !group.requester) return 'not-in-today';
    return C.presenceBucket(
      C.presenceForName({
        name: group.requester,
        dateISO: C.todayISO(),
        book: _book,
        absences: _absences,
        staffList: _rota.staff,
        leaveList: _rota.leave,
      })
    );
  }

  function presenceByGroupKey(groups) {
    var map = {};
    (groups || []).forEach(function (g) {
      map[g.key] = groupPresenceBucket(g);
    });
    return map;
  }

  function visiblePool(board) {
    var groups = (board.pool && board.pool.groups) || [];
    return C.filterPoolGroups(
      groups,
      { presence: _poolPresence, test: _poolTest, query: _poolQuery },
      presenceByGroupKey(groups)
    );
  }

  function visibleTileIds(groups) {
    var ids = [];
    (groups || []).forEach(function (g) {
      (g.tileIds || []).forEach(function (id) {
        ids.push(id);
      });
    });
    return ids;
  }

  function filterActive() {
    return _poolPresence !== 'all' || !!_poolTest || !!String(_poolQuery || '').trim();
  }

  function loadFavourites() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(C.FAVOURITE_STORE_KEY, function (r) {
        _favourites = C.sanitiseFavouriteStore(r && r[C.FAVOURITE_STORE_KEY]);
        if (_open) render();
      });
    } catch (_) {
      /* chrome.storage unavailable — favourites stay empty this session */
    }
  }

  function persistFavourites() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.set({ 'labAllocate.favourites': _favourites });
    } catch (_) {
      /* ignore */
    }
  }

  // One-line row. Group headers carry who ordered; the row only repeats it
  // in the unknown pile, where it varies per row and is load-bearing.
  function tileHtml(tile, opts) {
    opts = opts || {};
    var quiet = !!opts.quiet && !tile.staged;
    var selected = !quiet && !!_selected[tile.id];
    var cls =
      'ms-lac-tile' +
      (quiet ? ' ms-lac-tile-quiet' : '') +
      (tile.staged ? ' ms-lac-tile-staged' : '') +
      (selected ? ' ms-lac-tile-picked' : '');
    var assignedPerson =
      opts.showAssignee && tile.assignedTo && !C.isTeamAssignee(tile.assignedTo)
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
    var attrs;
    if (quiet) {
      attrs = 'role="listitem"';
    } else if (tile.staged) {
      attrs =
        'role="option" tabindex="0" aria-selected="false" draggable="true" data-task-id="' +
        esc(tile.id) +
        '" data-unstage="1" aria-label="' +
        esc(tile.patientName + ' — staged — press Enter to return to unallocated') +
        '"';
    } else {
      attrs =
        'role="option" tabindex="0" aria-selected="' +
        (selected ? 'true' : 'false') +
        '" draggable="true" data-task-id="' +
        esc(tile.id) +
        '"';
    }
    return (
      '<div class="' +
      cls +
      '" ' +
      attrs +
      '>' +
      (quiet ? '' : '<span class="ms-lac-tile-check" aria-hidden="true">' + (selected ? '✓' : '') + '</span>') +
      '<span class="ms-lac-tile-name">' +
      esc(tile.patientName) +
      '</span>' +
      '<span class="ms-lac-tile-test">' +
      esc(tile.summary || tile.statusText || 'Lab result') +
      '</span>' +
      assignedPerson +
      whoLine +
      (tile.staged ? '<span class="ms-lac-tile-staged-mark">STAGED</span>' : '') +
      '</div>'
    );
  }

  function groupPresenceMark(group) {
    var bucket = groupPresenceBucket(group);
    if (bucket === 'in-today') {
      return (
        '<span class="ms-lac-chip-in-dot" aria-hidden="true"></span>' +
        '<span class="ms-lac-chip-in-label">In today</span>'
      );
    }
    if (bucket === 'away') return '<span class="ms-lac-chip-flag">AWAY</span>';
    return '<span class="ms-lac-group-out">Not in today</span>';
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
      '<div class="ms-lac-group-head" draggable="true" data-group-ids="' +
      idsAttr +
      '" data-group-key="' +
      esc(group.key) +
      '">' +
      '<span class="ms-lac-group-grip" aria-hidden="true">⠿</span>' +
      '<span class="ms-lac-group-role">Ordered by</span>' +
      '<span class="ms-lac-group-title">' +
      esc(title) +
      '</span>' +
      groupPresenceMark(group) +
      '<span class="ms-lac-group-count">' +
      group.count +
      '</span>' +
      (selectedInGroup
        ? '<span class="ms-lac-group-picked">' + selectedInGroup + ' selected</span>'
        : '<button type="button" class="ms-lac-group-select" data-group-ids="' +
          idsAttr +
          '">Select all shown</button>') +
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
              return tileHtml(t, { showWho: !group.known, showAssignee: true });
            })
            .join('') +
          '</div>') +
      '</section>'
    );
  }

  function countPhrase(n, after) {
    return '<span class="ms-lac-num">' + n + '</span> ' + esc(after);
  }

  function fieldCountsHtml(col) {
    var bits = [];
    bits.push(countPhrase(col.count, 'results sitting with them'));
    if (col.stagedCount) {
      bits.push(
        '<span class="ms-lac-chip-count-staged">' + countPhrase(col.stagedCount, 'staged on this canvas') + '</span>'
      );
    }
    if (col.inPoolCount) bits.push(countPhrase(col.inPoolCount, 'still unallocated'));
    return bits.join(' · ');
  }

  function fieldHtml(col, selCount) {
    var abs = presenceForClinician(col);
    var away = abs.state === 'away' || abs.state === 'away-pending';
    var inToday = abs.state === 'present' && abs.reason === 'in-today';
    var open = _expandedChip === col.key;
    var body = col.tiles
      .map(function (t) {
        return tileHtml(t, { showWho: false, showAssignee: false, quiet: true });
      })
      .join('');
    var flag = away
      ? '<span class="ms-lac-chip-flag">AWAY</span>'
      : inToday
        ? '<span class="ms-lac-chip-in-dot" aria-hidden="true"></span><span class="ms-lac-chip-in-label">In today</span>'
        : '';
    var note = '';
    if (away && abs.label) note = '<div class="ms-lac-col-absence">' + esc(abs.label) + '</div>';
    else if (inToday && abs.label) note = '<div class="ms-lac-col-in">' + esc(abs.label) + '</div>';
    var name = C.displayClinicianName(col.title);
    var expandHint = open ? 'Hide what sits with them' : 'Click to expand and see what sits with them';
    var fav = C.isFavouriteKey(_favourites, col.key);
    return (
      '<div class="ms-lac-chip-wrap ms-lac-field' +
      (away ? ' ms-lac-chip-away' : '') +
      (inToday ? ' ms-lac-chip-in' : '') +
      (open ? ' ms-lac-chip-open' : '') +
      (selCount ? ' ms-lac-chip-can-stage' : '') +
      (col.count ? ' ms-lac-field-has' : '') +
      '" data-col-key="' +
      esc(col.key) +
      '" data-col-kind="clinician">' +
      '<button type="button" class="ms-lac-fav" data-fav-key="' +
      esc(col.key) +
      '" aria-pressed="' +
      (fav ? 'true' : 'false') +
      '" aria-label="' +
      esc((fav ? 'Remove ' : 'Favourite ') + name) +
      '">' +
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path d="M12 3.6l2.2 4.6 5.1.7-3.7 3.6.9 5.1L12 15.3 7.5 17.6l.9-5.1L4.7 8.9l5.1-.7z"/>' +
      '</svg></button>' +
      '<button type="button" class="ms-lac-chip" data-chip-key="' +
      esc(col.key) +
      '" aria-expanded="' +
      (open ? 'true' : 'false') +
      '" aria-controls="ms-lac-drawer-' +
      esc(col.key).replace(/[^a-z0-9]/gi, '_') +
      '">' +
      '<span class="ms-lac-chip-name">' +
      esc(name) +
      '</span>' +
      flag +
      '<span class="ms-lac-chip-count">' +
      fieldCountsHtml(col) +
      '</span>' +
      (selCount
        ? '<span class="ms-lac-chip-stagehint">+' + selCount + '</span>'
        : '<span class="ms-lac-field-expand">' + esc(open ? 'Hide' : 'Expand') + '</span>') +
      '<span class="ms-lac-vh">' +
      esc(selCount ? 'Stage ' + selCount + ' results onto ' + name : expandHint) +
      '</span>' +
      '</button>' +
      (open
        ? '<div class="ms-lac-chip-drawer" role="list" aria-label="Sitting with ' +
          esc(name) +
          '" id="ms-lac-drawer-' +
          esc(col.key).replace(/[^a-z0-9]/gi, '_') +
          '">' +
          note +
          (body ||
            '<div class="ms-lac-empty-sm">Nothing sitting with them yet. Drag from the unallocated box, or select there and click this field.</div>') +
          '</div>'
        : '') +
      '</div>'
    );
  }

  function emptyPoolHtml(poolCount) {
    if (filterActive() && poolCount > 0) {
      return (
        '<div class="ms-lac-empty">' +
        '<div class="ms-lac-empty-title">No unallocated reports match this filter</div>' +
        '<div class="ms-lac-empty-sub">' +
        poolCount +
        ' still waiting — clear the filter to see them.</div>' +
        '<button type="button" class="ms-lac-ghost" id="ms-lac-filter-clear">Clear filter</button>' +
        '</div>'
      );
    }
    return (
      '<div class="ms-lac-empty">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<path d="M3 8l4-5h10l4 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 8h18"/><path d="M9 12h6"/>' +
      '</svg>' +
      '<div class="ms-lac-empty-title">No unallocated reports — nothing is waiting</div>' +
      '<div class="ms-lac-empty-sub">Work already sitting with a clinician is in their field on the right.</div>' +
      '</div>'
    );
  }

  function filterChip(kind, value, label, pressed) {
    return (
      '<button type="button" class="ms-lac-filter-chip' +
      (pressed ? ' is-on' : '') +
      '" data-filter-' +
      kind +
      '="' +
      esc(value) +
      '" aria-pressed="' +
      (pressed ? 'true' : 'false') +
      '">' +
      esc(label) +
      '</button>'
    );
  }

  function poolToolsHtml(board, shown) {
    var facets = C.poolTestFacets(board.pool.groups, 6);
    var tests =
      filterChip('test', '', 'All tests', !_poolTest) +
      facets
        .map(function (f) {
          return filterChip('test', f.label, f.label + ' ' + f.count, normEq(_poolTest, f.label));
        })
        .join('');
    return (
      '<div class="ms-lac-pool-tools">' +
      '<div class="ms-lac-filters" role="group" aria-label="Who ordered">' +
      filterChip('presence', 'all', 'All', _poolPresence === 'all') +
      filterChip('presence', 'not-in-today', 'Not in today', _poolPresence === 'not-in-today') +
      filterChip('presence', 'in-today', 'In today', _poolPresence === 'in-today') +
      '</div>' +
      '<div class="ms-lac-tests" role="group" aria-label="Test">' +
      tests +
      '</div>' +
      '<div class="ms-lac-pool-search-row">' +
      '<input type="search" id="ms-lac-pool-q" value="' +
      esc(_poolQuery) +
      '" placeholder="Patient, test or who ordered" aria-label="Filter unallocated reports">' +
      (shown ? '<button type="button" class="ms-lac-ghost" id="ms-lac-select-visible">Select all shown</button>' : '') +
      (filterActive()
        ? '<button type="button" class="ms-lac-ghost" id="ms-lac-filter-clear">Clear filter</button>'
        : '') +
      '</div></div>'
    );
  }

  function normEq(a, b) {
    return (
      String(a || '')
        .trim()
        .toLowerCase() ===
      String(b || '')
        .trim()
        .toLowerCase()
    );
  }

  function boardHtml() {
    var board = C.buildWorkspace(_rows, _draft);
    var pool = board.pool;
    var selCount = selectedIds().length;
    var shownGroups = visiblePool(board);
    var shownCount = 0;
    shownGroups.forEach(function (g) {
      shownCount += g.count;
    });
    var body = shownGroups.length ? shownGroups.map(groupHtml).join('') : '';
    if (!body && board.count > 0 && !pool.count) {
      body =
        '<div class="ms-lac-empty"><div class="ms-lac-empty-title">Nothing left unallocated</div>' +
        '<div class="ms-lac-empty-sub">Everything on this queue is sitting with a clinician, or staged onto one on this canvas</div></div>';
    }
    var sections = railSections(board.clinicians);
    var railBody = sections.length
      ? sections
          .map(function (sec) {
            return (
              '<div class="ms-lac-rail-sec">' +
              '<h4 class="ms-lac-rail-sub">' +
              esc(sec.title) +
              '</h4>' +
              sec.cols
                .map(function (col) {
                  return fieldHtml(col, selCount);
                })
                .join('') +
              '</div>'
            );
          })
          .join('')
      : '<div class="ms-lac-empty-sm">No clinician fields yet — add one below if you need a drop target.</div>';
    return (
      '<div class="ms-lac-workspace">' +
      '<div class="ms-lac-col ms-lac-pool" data-col-key="' +
      esc(pool.key) +
      '" data-col-kind="pool">' +
      '<div class="ms-lac-pool-head">' +
      '<div class="ms-lac-pool-titles">' +
      '<h3 class="ms-lac-pool-title">Unallocated reports</h3>' +
      '</div>' +
      '<span class="ms-lac-pool-count">' +
      (filterActive() ? shownCount + ' of ' + pool.count + ' shown' : pool.count + ' of ' + board.count) +
      '</span>' +
      '</div>' +
      (pool.count ? poolToolsHtml(board, shownCount) : '') +
      (body || emptyPoolHtml(pool.count)) +
      '</div>' +
      '<aside class="ms-lac-rail" aria-label="Clinician fields">' +
      '<div class="ms-lac-rail-head">' +
      '<h3 class="ms-lac-col-heading">Clinicians</h3>' +
      '<span class="ms-lac-col-meta">' +
      (selCount
        ? 'Click a field to stage the selection'
        : 'Favourites first. Drag onto a field — hover near the edge to scroll') +
      '</span>' +
      '</div>' +
      railBody +
      (_addOpen
        ? '<div class="ms-lac-add-row">' +
          '<input type="text" id="ms-lac-add-name" maxlength="80" placeholder="e.g. Dr Jane Cole" aria-label="Add a clinician field">' +
          '<button type="button" class="ms-lac-ghost" id="ms-lac-add-btn">Add</button>' +
          '</div>'
        : '<button type="button" class="ms-lac-ghost ms-lac-add-reveal" id="ms-lac-add-reveal">Add a clinician field…</button>') +
      '</aside></div>'
    );
  }

  function selectionBarHtml() {
    var n = selectedIds().length;
    if (!n) return '';
    var preview = C.dragPreview(_rows, selectedIds());
    var hidden = C.hiddenSelectedCount(selectedIds(), visibleTileIds(visiblePool(C.buildWorkspace(_rows, _draft))));
    return (
      '<div class="ms-lac-selectbar">' +
      '<span class="ms-lac-selectbar-count">' +
      n +
      ' selected</span>' +
      '<span class="ms-lac-selectbar-label">' +
      esc(preview.label) +
      ' — click a clinician field to stage them, or drag</span>' +
      (hidden
        ? '<span class="ms-lac-selectbar-hidden" role="status">' +
          hidden +
          ' selected are hidden by this filter</span>' +
          '<button type="button" class="ms-lac-ghost" id="ms-lac-filter-clear">Show them</button>'
        : '') +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-sel-clear">Clear selection</button>' +
      '</div>'
    );
  }

  function confirmBarHtml() {
    if (_error) {
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-error" role="alert">' +
        esc(_error) +
        ' <button type="button" class="ms-lac-ghost" id="ms-lac-error-dismiss">Dismiss</button></div>'
      );
    }
    if (_writing) {
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-warn" tabindex="-1" id="ms-lac-confirm-sheet">' +
        '<strong>Writing to Medicus…</strong> The board is frozen until this finishes. Check the queue afterwards — this canvas is a working copy.' +
        '</div>'
      );
    }
    if (_confirmClose) {
      var nClose = C.draftSummary(_rows, _draft).count;
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-warn">' +
        '<strong>Close and discard?</strong> ' +
        nClose +
        ' staged move' +
        (nClose === 1 ? '' : 's') +
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
    if (_confirmWrite) {
      var lines = (_confirmWrite.items || [])
        .map(function (item) {
          return (
            '<li>' + esc(item.patientName || 'Unknown') + ' → ' + esc(C.displayClinicianName(item.toTitle)) + '</li>'
          );
        })
        .join('');
      var refusedNote = '';
      if (_confirmWrite.refused && _confirmWrite.refused.length) {
        refusedNote =
          '<p class="ms-lac-confirmbar-note">Not included — no unique staff match: ' +
          esc(
            _confirmWrite.refused
              .map(function (r) {
                return C.displayClinicianName(r.toTitle);
              })
              .join(', ')
          ) +
          '. Those stay on this canvas.</p>';
      }
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-sheet" role="region" tabindex="-1" id="ms-lac-confirm-sheet" aria-labelledby="ms-lac-confirm-heading">' +
        '<strong class="ms-lac-confirm-heading" id="ms-lac-confirm-heading">Medicus will reassign these tasks.</strong> This changes who the task sits with — it does not file the result.' +
        '<ul class="ms-lac-writelist">' +
        lines +
        '</ul>' +
        refusedNote +
        '<div class="ms-lac-confirmbar-actions">' +
        '<button type="button" class="ms-lac-ghost" id="ms-lac-write-keep">Go back</button>' +
        '<button type="button" class="ms-lac-confirm-btn-primary" id="ms-lac-write-go">Write to Medicus</button>' +
        '</div></div>'
      );
    }
    var sum = C.draftSummary(_rows, _draft);
    var gate = C.canWriteAllocations({ taskList: _taskList });
    var plan = sum.count ? C.planBulkReassign(_rows, _draft, _taskList, _staffDir) : null;
    var canWrite = !!(gate.ok && plan && plan.ok && plan.batches && plan.batches.length);
    var blockReason = '';
    if (sum.count && !canWrite) {
      if (!gate.ok) blockReason = gate.reason;
      else if (plan && plan.refused && plan.refused.length) {
        blockReason =
          'No unique staff id for ' +
          plan.refused
            .map(function (r) {
              return C.displayClinicianName(r.toTitle);
            })
            .join(', ') +
          '. They stay on this canvas. The canvas is still reading staff, or that name is not in Medicus’s staff list.';
      } else blockReason = (plan && plan.reason) || 'Cannot write these staged moves.';
    }
    var writeTitle = !sum.count
      ? 'Stage at least one result onto a clinician field first'
      : canWrite
        ? 'Review the patient → clinician list, then confirm'
        : blockReason;
    var writeLabel = canWrite ? 'Review then write…' : sum.count ? 'Why this will not write' : 'Write to Medicus';
    return (
      '<div class="ms-lac-confirmbar' +
      (blockReason ? ' ms-lac-confirmbar-warn' : '') +
      '">' +
      '<span class="ms-lac-confirmbar-note">' +
      (blockReason
        ? '<strong>Cannot write these yet.</strong> ' + esc(blockReason)
        : '<strong>Planning board.</strong> Staged moves live on this canvas until you review and confirm. Writing changes who the task sits with — it does not file the result' +
          (sum.count ? ' (' + sum.count + ' staged so far)' : '') +
          '.') +
      '</span>' +
      (_copyNote ? '<span class="ms-lac-hint">' + esc(_copyNote) + '</span>' : '') +
      '<div class="ms-lac-confirmbar-actions">' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-copy">Copy working list</button>' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-clear"' +
      (sum.count ? '' : ' disabled') +
      '>Clear staged moves</button>' +
      '<button type="button" class="' +
      (canWrite ? 'ms-lac-confirm-btn-primary' : 'ms-lac-confirm-btn') +
      '" id="ms-lac-finalise"' +
      (sum.count ? '' : ' disabled') +
      ' title="' +
      esc(writeTitle) +
      '">' +
      esc(writeLabel) +
      '</button>' +
      '</div></div>'
    );
  }

  function shellHtml() {
    var board = C.buildWorkspace(_rows, _draft);
    var lead = _rows.length
      ? '<span class="ms-lac-header-lead">' +
        '<span class="ms-lac-header-num">' +
        board.pool.count +
        '</span>' +
        '<span class="ms-lac-header-lead-label">unallocated · ' +
        _rows.length +
        ' in the queue</span></span>'
      : '';
    return (
      '<div class="ms-lac-panel' +
      (_writing || _confirmWrite ? ' ms-lac-panel-writing' : '') +
      '" role="dialog" aria-modal="true" aria-labelledby="ms-lac-title">' +
      '<div class="ms-lac-header">' +
      lead +
      '<h2 class="ms-lac-title" id="ms-lac-title">Allocate incoming labs</h2>' +
      '<span class="ms-lac-hint" id="ms-lac-progress">' +
      esc(_overviewProgress) +
      '</span>' +
      '<button type="button" class="ms-lac-close" id="ms-lac-close"' +
      (_writing ? ' disabled' : '') +
      '>Close</button>' +
      '</div>' +
      selectionBarHtml() +
      '<div class="ms-lac-body' +
      (_confirmWrite ? ' ms-lac-body-dim' : '') +
      '"' +
      (_writing || _confirmWrite ? ' inert' : '') +
      '><div class="ms-lac-board" id="ms-lac-board">' +
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
      (el.classList && el.classList.contains('ms-lac-group-select') && '.ms-lac-group-select') ||
      ''
    );
  }

  function focusableIn(panel) {
    if (!panel) return [];
    return Array.prototype.slice
      .call(
        panel.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      .filter(function (node) {
        if (node.closest('[inert]')) return false;
        if (node.getAttribute('aria-hidden') === 'true') return false;
        return true;
      });
  }

  function render() {
    var el = document.getElementById(OVERLAY_ID);
    if (!el || !_open) return;
    var shell = el.querySelector('.ms-lac-shell');
    if (!shell) return;
    var focusKey = focusKeyOf(document.activeElement);
    shell.innerHTML = shellHtml();
    bindOverlay(shell);
    if (_focusConfirm) {
      _focusConfirm = false;
      var sheet = shell.querySelector('#ms-lac-confirm-sheet');
      if (sheet) {
        sheet.focus();
        return;
      }
    }
    if (_focusAdd) {
      _focusAdd = false;
      var inp = shell.querySelector('#ms-lac-add-name');
      if (inp) {
        inp.focus();
        return;
      }
    }
    if (focusKey) {
      var again = shell.querySelector(focusKey);
      if (again) {
        again.focus();
        if (again.id === 'ms-lac-pool-q' && _poolCaret != null && again.setSelectionRange) {
          try {
            again.setSelectionRange(_poolCaret, _poolCaret);
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
  }

  function clearPoolFilter() {
    _poolPresence = 'all';
    _poolTest = '';
    _poolQuery = '';
    _poolCaret = null;
    announce('Filter cleared. The queue itself is unchanged.');
    render();
  }

  function selectVisible() {
    var ids = visibleTileIds(visiblePool(C.buildWorkspace(_rows, _draft)));
    _selected = {};
    ids.forEach(function (id) {
      _selected[id] = true;
    });
    announce('Selected ' + ids.length + ' shown — click a clinician field to stage them, or drag');
    render();
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
    _addOpen = false;
    announce('Added clinician field ' + String(name).trim());
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
    var addReveal = root.querySelector('#ms-lac-add-reveal');
    if (addReveal)
      addReveal.addEventListener('click', function () {
        _addOpen = true;
        _focusAdd = true;
        render();
      });
    root.querySelectorAll('#ms-lac-filter-clear').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        clearPoolFilter();
      });
    });
    var selectVisibleBtn = root.querySelector('#ms-lac-select-visible');
    if (selectVisibleBtn) selectVisibleBtn.addEventListener('click', selectVisible);
    root.querySelectorAll('[data-filter-presence]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _poolPresence = btn.getAttribute('data-filter-presence') || 'all';
        render();
      });
    });
    root.querySelectorAll('[data-filter-test]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _poolTest = btn.getAttribute('data-filter-test') || '';
        render();
      });
    });
    var poolQ = root.querySelector('#ms-lac-pool-q');
    if (poolQ) {
      poolQ.addEventListener('input', function () {
        _poolQuery = poolQ.value;
        _poolCaret = poolQ.selectionStart;
        render();
      });
    }
    root.querySelectorAll('.ms-lac-fav').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var key = btn.getAttribute('data-fav-key') || '';
        _favourites = C.toggleFavouriteKey(_favourites, key);
        persistFavourites();
        announce(
          C.isFavouriteKey(_favourites, key)
            ? 'Added to favourites. They stay at the top of this list.'
            : 'Removed from favourites.'
        );
        render();
      });
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
    var reviewBtn = root.querySelector('#ms-lac-finalise');
    if (reviewBtn)
      reviewBtn.addEventListener('click', function () {
        requestWrite();
      });
    var writeKeep = root.querySelector('#ms-lac-write-keep');
    if (writeKeep)
      writeKeep.addEventListener('click', function () {
        _confirmWrite = null;
        announce('Nothing was written. Back on the planning board.');
        render();
      });
    var writeGo = root.querySelector('#ms-lac-write-go');
    if (writeGo)
      writeGo.addEventListener('click', function () {
        commitWrite();
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
    function selectGroup(el) {
      var ids = String(el.getAttribute('data-group-ids') || '')
        .split(',')
        .filter(Boolean);
      _selected = {};
      ids.forEach(function (id) {
        _selected[id] = true;
      });
      announce('Selected ' + ids.length + ' — click a clinician field to stage them, or drag');
      render();
    }
    var panel = root.querySelector('.ms-lac-panel');
    if (panel) {
      panel.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        var nodes = focusableIn(panel);
        if (!nodes.length) {
          e.preventDefault();
          return;
        }
        var first = nodes[0];
        var last = nodes[nodes.length - 1];
        var active = document.activeElement;
        if (e.shiftKey && (active === first || !panel.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      });
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
    root.querySelectorAll('.ms-lac-group-select').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        selectGroup(btn);
      });
    });
    root.querySelectorAll('.ms-lac-group-head').forEach(function (head) {
      head.addEventListener('dragstart', function (e) {
        if (e.target && e.target.closest && e.target.closest('button')) return;
        var ids = String(head.getAttribute('data-group-ids') || '')
          .split(',')
          .filter(Boolean);
        beginDrag(e, ids);
      });
      head.addEventListener('dragend', endDrag);
    });
    root.querySelectorAll('.ms-lac-tile').forEach(function (tile) {
      if (tile.classList.contains('ms-lac-tile-quiet')) return;
      tile.addEventListener('click', function (e) {
        var id = tile.getAttribute('data-task-id');
        if (!id) return;
        if (tile.getAttribute('data-unstage')) {
          unstageIds([id]);
          return;
        }
        toggleSelect(id, e.metaKey || e.ctrlKey);
      });
      tile.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var id = tile.getAttribute('data-task-id');
          if (!id) return;
          if (tile.getAttribute('data-unstage')) {
            unstageIds([id]);
            return;
          }
          toggleSelect(id, true);
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
        scrollNearEdge(e);
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
    if (_writing) return;
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

  function unstageIds(ids) {
    if (_writing || !ids || !ids.length) return;
    _draft = C.stageMoves(_draft, ids, C.POOL);
    _selected = {};
    _pendingAbsence = null;
    _dragIds = null;
    announce(
      'Returned ' +
        ids.length +
        ' result' +
        (ids.length === 1 ? '' : 's') +
        ' to unallocated. Still only on this canvas.'
    );
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

  function requestWrite() {
    if (_writing) return;
    var plan = C.planBulkReassign(_rows, _draft, _taskList, _staffDir);
    if (!plan.ok || !plan.batches.length) {
      _error = plan.reason || 'Cannot write these staged moves.';
      announce(_error);
      render();
      return;
    }
    _confirmWrite = plan;
    _focusConfirm = true;
    announce('Review the list, then confirm. Medicus will reassign those tasks.');
    render();
  }

  async function commitWrite() {
    if (_writing || !_confirmWrite) return;
    _writing = true;
    _error = null;
    _focusConfirm = true;
    render();
    try {
      var result = await client().commitAllocations({
        slug: _route && _route.slug,
        draft: _draft,
        rows: _rows,
        taskList: _taskList,
        directory: _staffDir,
      });
      if (!result || !result.ok) {
        var failReason =
          (result && result.reason) || 'Medicus did not accept the reassignment. Nothing further was written.';
        _confirmWrite = null;
        _writing = false;
        announce(failReason);
        // A batch that stopped part-way DID write the earlier groups. The
        // board is stale the moment that happens: those rows still show as
        // staged, so the count says work is pending that Medicus already
        // took. Re-read before telling the clinician to check the queue —
        // loadBoard() clears _error, so restore the message after it.
        if (result && result.written > 0) {
          await loadBoard();
          _error = failReason;
          render();
          return;
        }
        _error = failReason;
        render();
        return;
      }
      var n = result.written || 0;
      _draft = C.emptyDraft();
      _confirmWrite = null;
      _copyNote =
        'Medicus accepted ' +
        n +
        ' reassignment' +
        (n === 1 ? '' : 's') +
        '. Check the queue — this canvas is a working copy.';
      _writing = false;
      announce(_copyNote);
      await loadBoard();
    } catch (err) {
      _writing = false;
      _confirmWrite = null;
      _error = err && err.message ? err.message : 'Medicus did not accept the reassignment.';
      announce(_error);
      render();
    }
  }

  function requestClose() {
    if (_writing) return;
    if (_confirmWrite) {
      _confirmWrite = null;
      announce('Nothing was written. Back on the planning board.');
      render();
      return;
    }
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
    _confirmWrite = null;
    _writing = false;
    _taskList = undefined;
    _staffDir = C.harvestStaffDirectory([], null);
    _collapsed = {};
    _addOpen = false;
    _focusConfirm = false;
    _focusAdd = false;
    _poolPresence = 'all';
    _poolTest = '';
    _poolQuery = '';
    _poolCaret = null;
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
    _confirmWrite = null;
    _writing = false;
    _taskList = undefined;
    _staffDir = C.harvestStaffDirectory([], null);
    _copyNote = '';
    _error = null;
    _collapsed = {};
    _addOpen = false;
    _focusConfirm = false;
    _focusAdd = false;
    _poolPresence = 'all';
    _poolTest = '';
    _poolQuery = '';
    _poolCaret = null;
    loadFavourites();
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
    'dragover',
    function (e) {
      if (!_dragIds || !_open) return;
      e.preventDefault();
      scrollNearEdge(e);
    },
    true
  );

  document.addEventListener(
    'keydown',
    function (e) {
      if (!_open) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        var tag = (e.target && e.target.tagName) || '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          var q = document.getElementById('ms-lac-pool-q');
          if (q) {
            e.preventDefault();
            q.focus();
            return;
          }
        }
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (_writing) return;
        if (_confirmWrite) {
          _confirmWrite = null;
          announce('Nothing was written. Back on the planning board.');
          render();
          return;
        }
        if (filterActive()) {
          clearPoolFilter();
          return;
        }
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
