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
// Writing uses Medicus's own bulk-reassign (captured 2026-08-25; path
// corrected v3.243.3 so the queue slug is in the URL). The canvas never
// POSTs itself — it calls LabAllocateCore's client. Confirm lists
// patient → destination. UI copy never claims the write finished.
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
  var _lastSelectId = '';
  var _lastGroupKey = '';
  var _dragIds = null;
  var _dragOriginKind = '';
  var _ignoreClickAfterDrag = false;
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
  var _teamDir = C.harvestTeamDirectory([], null);
  var _dragGhost = null;
  var _expandedChip = '';
  var _collapsed = {};
  var _workDate = '';
  var _destKind = 'in-today';
  var _destGroupId = '';
  var _customMembers = [];
  var _agsPresets = [];
  var _agsConfig = {};
  var _agsPicking = false;
  var _agsAllOpen = false;
  var _agsDestReady = false;
  var _dragFieldKey = '';
  var _marquee = null;

  function calendarToday() {
    return C.todayISO();
  }

  function workDate() {
    return C.coerceWorkDate(_workDate, calendarToday());
  }

  function dayPhrase() {
    return C.workDayPhrase(workDate(), calendarToday());
  }

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
    return C.selectedIdList(_selected);
  }

  function parseIdList(value) {
    return String(value || '')
      .split(',')
      .filter(Boolean);
  }

  function currentWorkspace() {
    return C.buildWorkspace(_rows, _draft, { teams: (_teamDir && _teamDir.list) || [] });
  }

  function absorbDirectories(rows, payload) {
    _staffDir = C.mergeStaffDirectory(_staffDir, C.harvestStaffDirectory(rows, payload));
    _teamDir = C.mergeTeamDirectory(_teamDir, C.harvestTeamDirectory(rows, payload));
  }

  function visibleTileOrder() {
    var board = currentWorkspace();
    var ids = [];
    ((board.pool && board.pool.groups) || []).forEach(function (g) {
      (g.tileIds || []).forEach(function (id) {
        ids.push(id);
      });
    });
    (board.clinicians || []).concat(board.teams || []).forEach(function (col) {
      (col.tiles || []).forEach(function (t) {
        if (t && t.id) ids.push(t.id);
      });
    });
    return ids;
  }

  function applyGroupSelection(ids, key, additive, shiftKey) {
    if (shiftKey && _lastGroupKey) {
      var board = currentWorkspace();
      var rangeIds = C.idsInGroupRange(board.pool.groups, _lastGroupKey, key);
      _selected = additive ? C.addToSelection(_selected, rangeIds) : C.replaceSelection(rangeIds);
    } else {
      _selected = C.toggleGroupInSelection(_selected, ids, additive);
    }
    _lastGroupKey = key || _lastGroupKey;
    _lastSelectId = ids[0] || _lastSelectId;
    announce('Selected ' + selectedIds().length + ' — click a clinician field to stage them, or drag');
    render();
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
          absorbDirectories(null, payload);
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
    var cap = Math.min(withUrl.length, 12);
    var patientId = '';
    (rows || []).forEach(function (r) {
      if (!patientId && r && r.patientId) patientId = r.patientId;
    });
    for (var i = 0; i < cap; i++) {
      try {
        var payload = await client().fetchOverview(withUrl[i].overviewURL);
        absorbDirectories(null, payload);
        if (!patientId) patientId = C.pickPatientIdFromPayload(payload);
      } catch (_) {
        /* try the next overview */
      }
    }
    if (!patientId) return;
    try {
      var form = await client().fetchAssigneeStaff(patientId);
      absorbDirectories(null, form);
    } catch (_) {
      /* create-task form is a bonus directory, not required to stage */
    }
  }

  function harvestStaffFromBook(book) {
    if (!book || !book.source) return;
    absorbDirectories(null, book.source);
  }

  async function loadBoard() {
    _loading = true;
    _error = null;
    render();
    try {
      await loadGroupsState();
      var presenceP = Promise.all([loadRotaAbsences(), loadMedicusPresence()]);
      var out = await client().fetchTaskList(_route.slug, _route.search);
      _rows = out.rows || [];
      _route.slug = out.slug || _route.slug;
      if (out.search != null) _route.search = out.search;
      _taskList = out.taskList;
      _staffDir = C.harvestStaffDirectory(_rows, out.body);
      _teamDir = C.harvestTeamDirectory(_rows, out.body);
      render();
      await presenceP;
      harvestStaffFromBook(_book);
      render();
      await harvestStaffFromOverviews(_rows);
      await enrichRequesters(_rows);
      persistStaffCache();
      pinDestColumns();
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

  async function loadMedicusPresence(opts) {
    opts = opts || {};
    _book = null;
    if (!_route) return;
    var cli = client();
    var date = workDate();
    try {
      _book = await cli.fetchTodayBook(date);
    } catch (_) {
      _book = null;
    }
    if (opts.skipAbsences) return;
    _absences = [];
    try {
      _absences = await cli.fetchStaffScheduleAbsences();
    } catch (_) {
      _absences = [];
    }
  }

  async function reloadWorkingDay() {
    if (!_open || !_route) return;
    _overviewProgress = 'Reading the appointment book for ' + dayPhrase() + '…';
    render();
    try {
      await loadMedicusPresence({ skipAbsences: true });
      harvestStaffFromBook(_book);
      persistStaffCache();
      pinDestColumns();
    } catch (_) {
      _book = null;
    }
    _overviewProgress = '';
    announce('In-day flags are for people working ' + dayPhrase() + '.');
    render();
  }

  function setWorkDate(iso) {
    if (_writing) return;
    var next = C.coerceWorkDate(iso, calendarToday());
    if (next === workDate()) return;
    _workDate = next;
    reloadWorkingDay();
  }

  function presenceOpts(name) {
    return {
      name: name,
      dateISO: workDate(),
      book: _book,
      absences: _absences,
      staffList: _rota.staff,
      leaveList: _rota.leave,
    };
  }

  function inDayPeople() {
    return C.inDayClinicians({
      book: _book,
      dateISO: workDate(),
      absences: _absences,
      staffList: _rota.staff,
      leaveList: _rota.leave,
    });
  }

  function presenceForClinician(col) {
    if (!col || col.kind !== 'clinician') return { state: 'n/a', reason: 'not-a-person', label: '' };
    // Display casing — matching is case-insensitive, labels are user-facing.
    return C.presenceForName(presenceOpts(C.displayClinicianName(col.title)));
  }

  function presenceRank(col) {
    var p = presenceForClinician(col);
    if (p.state === 'present' && p.reason === 'in-today') return 0;
    if (col.count > 0 || col.stagedCount > 0) return 1;
    if (p.state === 'away' || p.state === 'away-pending') return 3;
    return 2;
  }

  function sortClinicianFields(cols) {
    return (cols || []).slice().sort(function (a, b) {
      var ra = presenceRank(a);
      var rb = presenceRank(b);
      if (ra !== rb) return ra - rb;
      var na = C.displayClinicianName(a.title).toLowerCase();
      var nb = C.displayClinicianName(b.title).toLowerCase();
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    });
  }

  // One-line row. Group headers carry who ordered; the row only repeats it
  // in the unknown pile, where it varies per row and is load-bearing.
  function tileHtml(tile, opts) {
    opts = opts || {};
    var selected = !!_selected[tile.id];
    var cls = 'ms-lac-tile' + (tile.staged ? ' ms-lac-tile-staged' : '') + (selected ? ' ms-lac-tile-picked' : '');
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
    var allOn = selectedInGroup === group.count && group.count > 0;
    var pickLabel = allOn ? 'All selected' : selectedInGroup ? selectedInGroup + ' selected' : 'Select all';
    var groupState = allOn ? ' ms-lac-group-on' : selectedInGroup ? ' ms-lac-group-some' : '';
    return (
      '<section class="ms-lac-group' +
      (collapsed ? ' ms-lac-group-collapsed' : '') +
      groupState +
      '" data-group-key="' +
      esc(group.key) +
      '">' +
      '<div class="ms-lac-group-head" role="button" tabindex="0" draggable="true" data-group-ids="' +
      idsAttr +
      '" data-group-key="' +
      esc(group.key) +
      '" aria-pressed="' +
      (allOn ? 'true' : 'false') +
      '" aria-label="Select all ' +
      group.count +
      (group.known ? ' ordered by ' + esc(title) : ' with unknown requester') +
      '. Ctrl-click to add another clinician">' +
      '<span class="ms-lac-group-grip" aria-hidden="true">⠿</span>' +
      '<span class="ms-lac-group-title">' +
      esc(title) +
      '</span>' +
      '<span class="ms-lac-group-count">' +
      group.count +
      '</span>' +
      '<button type="button" class="ms-lac-group-pick' +
      (selectedInGroup ? ' ms-lac-group-picked' : '') +
      '" data-group-ids="' +
      idsAttr +
      '" data-group-key="' +
      esc(group.key) +
      '" draggable="false" aria-pressed="' +
      (allOn ? 'true' : 'false') +
      '" aria-label="' +
      (allOn ? 'Remove these reports from the selection' : 'Add all ' + group.count + ' reports to the selection') +
      '">' +
      esc(pickLabel) +
      '</button>' +
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

  function fieldCounts(col) {
    var bits = [];
    if (col.kind === 'team') {
      bits.push('Team');
      if (col.stagedCount) bits.push(col.stagedCount + ' staged on this canvas');
      return bits.join(' · ');
    }
    bits.push(col.count + ' sitting with them');
    if (col.stagedCount) bits.push(col.stagedCount + ' staged on this canvas');
    if (col.inPoolCount) bits.push(col.inPoolCount + ' still unallocated');
    return bits.join(' · ');
  }

  function fieldHtml(col, selCount) {
    var abs = presenceForClinician(col);
    var away = abs.state === 'away' || abs.state === 'away-pending';
    var inToday = abs.state === 'present' && abs.reason === 'in-today';
    var open = _expandedChip === col.key;
    var body = col.tiles
      .map(function (t) {
        return tileHtml(t, { showWho: false, showAssignee: false });
      })
      .join('');
    var flag = away
      ? '<span class="ms-lac-chip-flag">AWAY</span>'
      : inToday
        ? '<span class="ms-lac-chip-flag ms-lac-chip-flag-in">In ' + esc(dayPhrase()) + '</span>'
        : col.kind === 'team'
          ? '<span class="ms-lac-chip-flag ms-lac-chip-flag-team">Team</span>'
          : '';
    var note = '';
    if (away && abs.label) note = '<div class="ms-lac-col-absence">' + esc(abs.label) + '</div>';
    else if (inToday && abs.label) note = '<div class="ms-lac-col-in">' + esc(abs.label) + '</div>';
    var name = C.displayClinicianName(col.title);
    var isTeam = col.kind === 'team';
    var destOn = !isTeam && !!destKeySet()[col.key];
    var expandHint = isTeam
      ? open
        ? 'Hide staged reports'
        : 'Click to expand'
      : open
        ? 'Hide what sits with them'
        : 'Click to expand and see what sits with them';
    var sittingIds = col.tiles
      .map(function (t) {
        return t && t.id;
      })
      .filter(Boolean);
    var sittingPicked = sittingIds.filter(function (id) {
      return _selected[id];
    }).length;
    var sittingAllOn = sittingPicked === sittingIds.length && sittingIds.length > 0;
    var selectSitting =
      open && sittingIds.length
        ? '<button type="button" class="ms-lac-field-select" data-select-ids="' +
          esc(sittingIds.join(',')) +
          '" data-group-key="' +
          esc(col.key) +
          '" aria-pressed="' +
          (sittingAllOn ? 'true' : 'false') +
          '">' +
          (sittingAllOn ? (isTeam ? 'All selected' : 'All sitting selected') : isTeam ? 'Select these' : 'Select all sitting') +
          '</button>'
        : '';
    return (
      '<div class="ms-lac-chip-wrap ms-lac-field' +
      (away ? ' ms-lac-chip-away' : '') +
      (inToday ? ' ms-lac-chip-in' : '') +
      (open ? ' ms-lac-chip-open' : '') +
      (selCount ? ' ms-lac-chip-target' : '') +
      (col.count ? ' ms-lac-field-has' : '') +
      (col.kind === 'team' ? ' ms-lac-chip-team' : '') +
      (destOn ? ' ms-ags-field-on' : '') +
      '" data-col-key="' +
      esc(col.key) +
      '" data-col-kind="' +
      esc(col.kind || 'clinician') +
      '">' +
      '<button type="button" class="ms-lac-chip" data-chip-key="' +
      esc(col.key) +
      '"' +
      (!isTeam && !selCount ? ' draggable="true"' : '') +
      ' aria-expanded="' +
      (open ? 'true' : 'false') +
      '" aria-controls="ms-lac-drawer-' +
      esc(col.key).replace(/[^a-z0-9]/gi, '_') +
      '" aria-label="' +
      esc(
        selCount
          ? 'Stage ' + selCount + ' selected results onto ' + name
          : name + '. ' + expandHint
      ) +
      '">' +
      '<span class="ms-lac-chip-name">' +
      esc(name) +
      '</span>' +
      flag +
      '<span class="ms-lac-chip-count">' +
      esc(fieldCounts(col)) +
      '</span>' +
      (selCount
        ? '<span class="ms-lac-chip-stagehint">Stage ' + selCount + ' here</span>'
        : '<span class="ms-lac-field-expand">' + esc(open ? 'Hide' : 'Expand') + '</span>') +
      '</button>' +
      (open
        ? '<div class="ms-lac-chip-drawer" role="listbox" aria-label="' +
          esc(isTeam ? 'Staged onto ' + name : 'Sitting with ' + name) +
          '" id="ms-lac-drawer-' +
          esc(col.key).replace(/[^a-z0-9]/gi, '_') +
          '">' +
          note +
          selectSitting +
          (body ||
            '<div class="ms-lac-empty-sm">' +
            (isTeam
              ? 'Nothing staged onto this team yet. Drag from the unallocated box, or select there and click this field.'
              : 'Nothing sitting with them yet. Drag from the unallocated box, or select there and click this field.') +
            '</div>') +
          '</div>'
        : '') +
      '</div>'
    );
  }

  function workingDayHtml() {
    var phrase = dayPhrase();
    var cal = calendarToday();
    var picked = workDate();
    var people = inDayPeople();
    var bookWord = phrase === 'today' ? 'today’s book' : 'the ' + phrase + ' book';
    var summary = people.length
      ? people.length +
        (people.length === 1 ? ' person has a session on ' : ' people have a session on ') +
        bookWord
      : 'No sessions on the book for ' + phrase;
    return (
      '<div class="ms-lac-daybar">' +
      '<div class="ms-lac-split-day">' +
      '<label class="ms-lac-split-day-label" for="ms-lac-day" title="The appointment book for this date decides who is in. Defaults to today; pick tomorrow if you are doing this the night before.">Working day</label>' +
      '<input type="date" id="ms-lac-day" value="' +
      esc(picked) +
      '" aria-label="Working day for who is in" title="The appointment book for this date decides who is in.">' +
      '<button type="button" class="ms-lac-ghost' +
      (picked === cal ? ' ms-lac-split-day-on' : '') +
      '" id="ms-lac-day-today" title="Use today’s appointment book.">Today</button>' +
      '<button type="button" class="ms-lac-ghost' +
      (picked === C.addDaysISO(cal, 1) ? ' ms-lac-split-day-on' : '') +
      '" id="ms-lac-day-tomorrow" title="Use tomorrow’s appointment book — for allocating the night before.">Tomorrow</button>' +
      '</div>' +
      '<span class="ms-lac-daybar-summary">' +
      esc(summary) +
      '</span>' +
      '</div>'
    );
  }

  function groupsCore() {
    return window.AllocationGroupsCore || null;
  }

  function destStrip() {
    return window.AllocationDestStrip || null;
  }

  function groupsIO() {
    return window.AllocationGroupsIO || null;
  }

  async function loadGroupsState() {
    var G = groupsCore();
    if (!G) return;
    var state = null;
    try {
      var io = groupsIO();
      if (io && typeof io.loadAllocationGroupsState === 'function') {
        state = await io.loadAllocationGroupsState();
      } else if (typeof loadAllocationGroupsState === 'function') {
        state = await loadAllocationGroupsState();
      } else if (chrome.storage && chrome.storage.local) {
        var got = await chrome.storage.local.get(['allocationGroups.presets', 'allocationGroups.config']);
        state = {
          presets: G.normalisePresets(got['allocationGroups.presets']),
          config: G.normaliseConfig(got['allocationGroups.config']),
        };
      }
    } catch (_) {
      state = null;
    }
    _agsPresets = (state && state.presets) || [];
    _agsConfig = (state && state.config) || G.normaliseConfig({});
    if (_agsDestReady) return;
    var last = _agsConfig.lastUsedBySurface && _agsConfig.lastUsedBySurface.lab;
    var dest = G.defaultDestSet(_agsPresets, new Date(), last);
    _destKind = (dest && dest.kind) || 'in-today';
    _destGroupId = (dest && dest.id) || '';
    _customMembers = [];
    _agsDestReady = true;
  }

  async function persistPresets() {
    var io = groupsIO();
    try {
      if (io && typeof io.saveAllocationGroupsPresets === 'function') {
        await io.saveAllocationGroupsPresets(_agsPresets);
        return;
      }
      if (typeof saveAllocationGroupsPresets === 'function') {
        await saveAllocationGroupsPresets(_agsPresets);
        return;
      }
      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ 'allocationGroups.presets': _agsPresets });
      }
    } catch (_) {
      /* storage is a convenience, not required to stage */
    }
  }

  async function persistConfig() {
    var io = groupsIO();
    try {
      if (io && typeof io.saveAllocationGroupsConfig === 'function') {
        await io.saveAllocationGroupsConfig(_agsConfig);
        return;
      }
      if (typeof saveAllocationGroupsConfig === 'function') {
        await saveAllocationGroupsConfig(_agsConfig);
        return;
      }
      if (chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ 'allocationGroups.config': _agsConfig });
      }
    } catch (_) {
      /* last-used is this computer only */
    }
  }

  function persistStaffCache() {
    var G = groupsCore();
    var list = ((_staffDir && _staffDir.list) || [])
      .map(function (s) {
        if (!s || !s.id || !s.name) return null;
        if (G && !G.isUuid(s.id)) return null;
        return { id: String(s.id).toLowerCase(), name: s.name };
      })
      .filter(Boolean);
    if (!list.length || !chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.set({ 'allocationGroups.staffCache': list });
    } catch (_) {
      /* Options picker reads this when present */
    }
  }

  function rememberDest() {
    var G = groupsCore();
    if (!G || _destKind === 'custom') return;
    _agsConfig = G.rememberLastUsed(_agsConfig, 'lab', { kind: _destKind, id: _destGroupId });
    persistConfig();
  }

  function destSetOutcome() {
    var G = groupsCore();
    var presenceFor = function (member) {
      return C.presenceForName(presenceOpts(member && member.name));
    };
    if (!G) {
      var fallback = C.pinDestStaffIds(C.asSplitDests(inDayPeople()), _staffDir);
      return { dests: fallback, skipped: [], collisions: fallback.collisions || [] };
    }
    var raw = G.destsFromSet(
      _destKind === 'custom'
        ? { kind: 'custom', members: _customMembers }
        : { kind: _destKind, id: _destGroupId },
      {
        presets: _agsPresets,
        inToday: inDayPeople(),
        presenceFor: presenceFor,
        emptyInTodayReason: 'No people with a session on the appointment book to split onto.',
      }
    );
    var dests = C.pinDestStaffIds(C.asSplitDests(raw.dests || []), _staffDir);
    var collisions = dests.collisions || [];
    return {
      dests: dests,
      skipped: raw.skipped || [],
      reason: collisions.length ? C.collisionPhrase(collisions) : raw.reason || '',
      collisions: collisions,
    };
  }

  function splitDestinations() {
    var out = destSetOutcome();
    var dests = out.dests || [];
    dests.collisions = out.collisions || dests.collisions || [];
    return dests;
  }

  function destKeySet() {
    var set = {};
    splitDestinations().forEach(function (d) {
      if (d && d.key) set[d.key] = true;
    });
    return set;
  }

  function pinDestColumns() {
    var dests = splitDestinations();
    _draft = C.replaceDestColumns(_draft || C.emptyDraft(), dests);
  }

  function visibleUnallocatedCount() {
    var pool = currentWorkspace().pool;
    return (pool && pool.tiles && pool.tiles.length) || 0;
  }

  function tilesForPlan() {
    var pool = currentWorkspace().pool;
    return ((pool && pool.tiles) || []).filter(function (t) {
      return t && t.id;
    });
  }

  function destBoxCounts() {
    var dests = splitDestinations();
    var counts = {};
    dests.forEach(function (d) {
      counts[d.key] = 0;
    });
    var board = currentWorkspace();
    (board.clinicians || []).forEach(function (col) {
      if (!col || counts[col.key] == null) return;
      counts[col.key] = (col.tiles || []).length;
    });
    return counts;
  }

  function destsHaveWork() {
    var counts = destBoxCounts();
    return Object.keys(counts).some(function (k) {
      return counts[k] > 0;
    });
  }

  function destBoxTiles() {
    var want = destKeySet();
    var tiles = [];
    var seen = {};
    var board = currentWorkspace();
    (board.clinicians || []).forEach(function (col) {
      if (!col || !want[col.key]) return;
      (col.tiles || []).forEach(function (t) {
        if (!t || !t.id || seen[t.id]) return;
        seen[t.id] = true;
        tiles.push(t);
      });
    });
    return tiles;
  }

  function splitOpts() {
    return {
      dayPhrase: dayPhrase(),
      emptyDestReason: 'Pick In today, a group, or encircle people.',
    };
  }

  function applyPileSplit() {
    var dests = splitDestinations();
    if (dests.collisions && dests.collisions.length) {
      return { ok: false, reason: C.collisionPhrase(dests.collisions) };
    }
    var plan = C.planEvenSplit(tilesForPlan(), dests, splitOpts());
    if (!plan.ok) return plan;
    _draft = C.applyEvenSplit(C.ensureDestColumns(_draft || C.emptyDraft(), dests), plan);
    _selected = {};
    return plan;
  }

  function applyTopUp() {
    var dests = splitDestinations();
    var plan = C.planTopUp(tilesForPlan(), dests, destBoxCounts(), splitOpts());
    if (!plan.ok) return plan;
    _draft = C.applyEvenSplit(C.ensureDestColumns(_draft || C.emptyDraft(), dests), plan);
    _selected = {};
    return plan;
  }

  function applyLevel() {
    var dests = splitDestinations();
    var seen = {};
    var tiles = destBoxTiles()
      .concat(tilesForPlan())
      .filter(function (t) {
        if (!t || !t.id || seen[t.id]) return false;
        seen[t.id] = true;
        return true;
      });
    var plan = C.planLevel(tiles, dests, splitOpts());
    if (!plan.ok) return plan;
    _draft = C.applyEvenSplit(C.ensureDestColumns(C.emptyDraft(), dests), plan);
    _selected = {};
    return plan;
  }

  function memberFromFieldKey(key) {
    if (!key || String(key).indexOf('clinician:') !== 0) return null;
    var title = '';
    var staffId = '';
    inDayPeople().forEach(function (p) {
      if (p && p.key === key) {
        title = p.name || title;
        staffId = p.staffId || staffId;
      }
    });
    if (_draft && _draft.columnTitles && _draft.columnTitles[key]) title = title || _draft.columnTitles[key];
    if (_draft && _draft.columnStaffIds && _draft.columnStaffIds[key]) {
      staffId = staffId || _draft.columnStaffIds[key];
    }
    var board = currentWorkspace();
    (board.clinicians || []).forEach(function (col) {
      if (col && col.key === key) title = title || col.title;
    });
    if (!title) return null;
    if (!staffId) {
      var pinned = C.pinDestStaffIds([{ key: key, name: title }], _staffDir);
      staffId = (pinned[0] && pinned[0].staffId) || '';
    }
    return { key: key, name: title, staffId: staffId };
  }

  function setDestKind(kind, groupId) {
    _destKind = kind || 'in-today';
    _destGroupId = groupId || '';
    _agsPicking = kind === 'custom';
    _agsAllOpen = false;
    if (kind !== 'custom') _customMembers = [];
    rememberDest();
    pinDestColumns();
    render();
  }

  function addFieldToCustom(key) {
    var mem = memberFromFieldKey(key);
    if (!mem) return;
    _destKind = 'custom';
    _destGroupId = '';
    _agsPicking = true;
    _agsAllOpen = false;
    var seen = false;
    _customMembers.forEach(function (m) {
      if (m && m.key === key) seen = true;
    });
    if (!seen) _customMembers = _customMembers.concat([mem]);
    pinDestColumns();
    render();
  }

  function toggleFieldInCustom(key) {
    var mem = memberFromFieldKey(key);
    if (!mem) return;
    _destKind = 'custom';
    _destGroupId = '';
    _agsPicking = true;
    var next = [];
    var found = false;
    _customMembers.forEach(function (m) {
      if (m && m.key === key) found = true;
      else if (m) next.push(m);
    });
    if (!found) next.push(mem);
    _customMembers = next;
    pinDestColumns();
    render();
  }

  function setCustomFromFieldKeys(keys) {
    var G = groupsCore();
    var cap = G ? G.MAX_MEMBERS : 12;
    var members = [];
    var seen = {};
    (keys || []).forEach(function (key) {
      if (members.length >= cap) return;
      var mem = memberFromFieldKey(key);
      if (!mem || seen[mem.key]) return;
      seen[mem.key] = true;
      members.push(mem);
    });
    if (!members.length) return;
    _destKind = 'custom';
    _destGroupId = '';
    _agsPicking = true;
    _agsAllOpen = false;
    _customMembers = members;
    pinDestColumns();
    render();
  }

  function canSaveCustomGroup() {
    var G = groupsCore();
    if (!G || _destKind !== 'custom') return false;
    return _customMembers.some(function (m) {
      return m && G.isUuid(m.staffId);
    });
  }

  async function saveAsGroup() {
    var G = groupsCore();
    if (!G) return;
    var members = (_customMembers || []).filter(function (m) {
      return m && G.isUuid(m.staffId);
    });
    if (!members.length) {
      _copyNote = 'Need at least one person with a staff id to save a group.';
      announce(_copyNote);
      render();
      return;
    }
    var name = window.prompt('Name this group', 'New group');
    if (!name) return;
    var res = G.upsertPreset(_agsPresets, {
      name: name,
      members: members.map(function (m) {
        return { id: m.staffId, name: m.name };
      }),
    });
    if (!res.ok) {
      _copyNote = (res.errors && res.errors[0]) || 'Could not save that group.';
      announce(_copyNote);
      render();
      return;
    }
    _agsPresets = res.presets;
    _destKind = 'group';
    _destGroupId = res.preset.id;
    _agsPicking = false;
    await persistPresets();
    rememberDest();
    _copyNote = 'Saved group ' + res.preset.name + '. Split still stages on this canvas only.';
    announce(_copyNote);
    pinDestColumns();
    render();
  }

  function allGroupsHtml() {
    if (!_agsAllOpen) return '';
    var G = groupsCore();
    var list = G ? G.normalisePresets(_agsPresets) : [];
    var days = G ? G.DAY_IDS : ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    var cards = list
      .map(function (p) {
        if (!p || !p.id) return '';
        var sched = p.schedule;
        var dayChecks = days
          .map(function (d) {
            var on = sched && sched.days && sched.days.indexOf(d) !== -1;
            return (
              '<label style="margin-right:8px;font-size:12px"><input type="checkbox" data-ags-day="' +
              esc(d) +
              '" data-ags-id="' +
              esc(p.id) +
              '"' +
              (on ? ' checked' : '') +
              '> ' +
              esc(d) +
              '</label>'
            );
          })
          .join('');
        var names = (p.memberIds || [])
          .map(function (id) {
            return (p.memberNames && p.memberNames[id]) || id.slice(0, 8);
          })
          .join(', ');
        return (
          '<div class="ms-ags-all-card" data-ags-card="' +
          esc(p.id) +
          '" style="padding:8px 0;border-top:1px solid var(--border,#e2e8f0)">' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
          '<button type="button" class="ms-lac-ghost" data-ags-pick="' +
          esc(p.id) +
          '">Pick</button>' +
          '<input type="text" data-ags-rename="' +
          esc(p.id) +
          '" value="' +
          esc(p.name) +
          '" maxlength="48" aria-label="Group name" style="font-weight:600;width:min(220px,100%)">' +
          '<button type="button" class="ms-lac-ghost" data-ags-always="' +
          esc(p.id) +
          '" title="Show this chip every day, all hours.">Always</button>' +
          '<button type="button" class="ms-lac-ghost" data-ags-delete="' +
          esc(p.id) +
          '">Delete</button>' +
          '</div>' +
          '<div style="margin-top:4px;font-size:12px;color:var(--text-3,#64748b)">' +
          esc(names || 'No people yet') +
          '</div>' +
          '<div style="margin-top:6px">' +
          dayChecks +
          '</div>' +
          '<div style="margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<label>From <input type="time" data-ags-start="' +
          esc(p.id) +
          '" value="' +
          esc((sched && sched.start) || '') +
          '"></label>' +
          '<label>to <input type="time" data-ags-end="' +
          esc(p.id) +
          '" value="' +
          esc((sched && sched.end) || '') +
          '"></label>' +
          '<span style="font-size:12px;color:var(--text-3,#64748b)">Leave blank for always.</span>' +
          '</div></div>'
        );
      })
      .join('');
    return (
      '<div class="ms-ags-all" id="ms-ags-all-panel" style="margin:8px 0;padding:10px;border:1px solid var(--border,#cbd5e1);border-radius:8px;background:var(--bg-elev,#fff);max-height:280px;overflow:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">' +
      '<strong>All groups</strong>' +
      '<button type="button" class="ms-lac-ghost" id="ms-ags-all-close">Close</button>' +
      '</div>' +
      '<p style="margin:6px 0 8px;font-size:12px;color:var(--text-3,#64748b)">Every saved group, including those outside their days and times.</p>' +
      (cards || '<p style="font-size:12px">No groups yet. Encircle people and Save as group.</p>') +
      '</div>'
    );
  }

  function scheduleFromAllCard(card) {
    var G = groupsCore();
    if (!G || !card) return null;
    var days = [];
    card.querySelectorAll('[data-ags-day]').forEach(function (box) {
      if (box.checked) days.push(box.getAttribute('data-ags-day'));
    });
    var startEl = card.querySelector('[data-ags-start]');
    var endEl = card.querySelector('[data-ags-end]');
    var start = (startEl && startEl.value) || '';
    var end = (endEl && endEl.value) || '';
    var raw = { days: days, start: start, end: end };
    var preset = card.getAttribute('data-ags-card') ? G.findPreset(_agsPresets, card.getAttribute('data-ags-card')) : null;
    if (!days.length && !start && !end) return null;
    if (!days.length || !start || !end) return (preset && preset.schedule) || null;
    if (G.scheduleErrors(raw).length) return (preset && preset.schedule) || null;
    return G.normaliseSchedule(raw);
  }

  function upsertPresetFromCard(id, patch) {
    var G = groupsCore();
    if (!G) return;
    var preset = G.findPreset(_agsPresets, id);
    if (!preset) return;
    var res = G.upsertPreset(_agsPresets, Object.assign({}, preset, patch || {}));
    if (!res.ok) {
      announce((res.errors && res.errors[0]) || 'Could not update that group.');
      return;
    }
    _agsPresets = res.presets;
    persistPresets();
    render();
  }

  function bindAllGroupsPanel(root) {
    var panel = root.querySelector('#ms-ags-all-panel');
    if (!panel) return;
    var close = panel.querySelector('#ms-ags-all-close');
    if (close)
      close.addEventListener('click', function () {
        _agsAllOpen = false;
        render();
      });
    panel.addEventListener('click', function (e) {
      var pick = e.target.closest && e.target.closest('[data-ags-pick]');
      if (pick) {
        e.preventDefault();
        setDestKind('group', pick.getAttribute('data-ags-pick') || '');
        return;
      }
      var always = e.target.closest && e.target.closest('[data-ags-always]');
      if (always) {
        e.preventDefault();
        upsertPresetFromCard(always.getAttribute('data-ags-always') || '', { schedule: null });
        return;
      }
      var del = e.target.closest && e.target.closest('[data-ags-delete]');
      if (del) {
        e.preventDefault();
        var G = groupsCore();
        var id = del.getAttribute('data-ags-delete') || '';
        var preset = G && G.findPreset(_agsPresets, id);
        if (!window.confirm('Delete group' + (preset && preset.name ? ' ' + preset.name : '') + '?')) return;
        if (!G) return;
        _agsPresets = G.removePreset(_agsPresets, id).presets;
        if (_destKind === 'group' && _destGroupId === id) setDestKind('in-today', '');
        persistPresets();
        render();
      }
    });
    panel.addEventListener('change', function (e) {
      var t = e.target;
      if (!t) return;
      var id = t.getAttribute('data-ags-rename') || t.getAttribute('data-ags-id') || '';
      if (!id) return;
      var card = t.closest('[data-ags-card]');
      var patch = { schedule: scheduleFromAllCard(card) };
      if (t.hasAttribute('data-ags-rename')) patch.name = t.value;
      upsertPresetFromCard(id, patch);
    });
  }

  function evenSplitHtml() {
    var Strip = destStrip();
    var G = groupsCore();
    var outcome = destSetOutcome();
    var dests = outcome.dests;
    var destPhrase = C.destNamesPhrase(dests);
    var skippedPhrase = G ? G.skippedPhrase(outcome.skipped) : '';
    var visible = G ? G.visiblePresets(_agsPresets, new Date()) : [];
    var strip = Strip
      ? Strip.destSetStripHtml({
          destKind: _destKind,
          destGroupId: _destGroupId,
          inTodayCount: inDayPeople().length,
          visibleGroups: visible,
          destPhrase: destPhrase,
          skippedPhrase: skippedPhrase,
          canSave: canSaveCustomGroup(),
        })
      : '';
    var poolN = visibleUnallocatedCount();
    var haveWork = destsHaveWork();
    var stagedN = C.draftSummary(_rows, _draft).count;
    var actions = '';
    if (!dests.length) {
      actions = '<span class="ms-lac-split-note">Pick In today, a group, or encircle people.</span>';
    } else if (poolN && !haveWork) {
      actions =
        '<button type="button" class="ms-lac-confirm-btn ms-lac-primary" id="ms-lac-split" title="Split the unallocated pile evenly. Proposal only, nothing is written until you confirm.">Split equally</button>';
    } else if (poolN && haveWork) {
      actions =
        '<button type="button" class="ms-lac-confirm-btn ms-lac-primary" id="ms-lac-topup" title="Give leftover unallocated reports to whoever currently has least. Does not move sitting work. Proposal only.">Top up empty boxes</button>' +
        '<button type="button" class="ms-lac-confirm-btn" id="ms-lac-level" title="Rebalance so each has the same number, or as near as it can be. Moves sitting work on this canvas. Proposal only.">Distribute equally</button>';
    } else if (haveWork) {
      actions =
        '<button type="button" class="ms-lac-confirm-btn" id="ms-lac-level" title="Rebalance sitting work. Proposal only.">Distribute equally</button>';
    } else {
      actions =
        '<span class="ms-lac-split-note">Inbox is clear. Share this box on a person splits only that folder among the current destinations.</span>';
    }
    var proposal = stagedN
      ? '<div class="ms-rxac-proposal" role="status"><strong>Proposal. Not written yet.</strong> ' +
        stagedN +
        ' reports would move among ' +
        esc(destPhrase) +
        '. Drag a patient from one person onto another to change who gets them.</div>'
      : '';
    return (
      strip +
      allGroupsHtml() +
      '<div class="ms-ags-actions">' +
      actions +
      '</div>' +
      proposal
    );
  }

  function clinicianFieldsInRect(rect) {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay || !rect) return [];
    var keys = [];
    overlay.querySelectorAll('.ms-lac-chip-wrap[data-col-kind="clinician"]').forEach(function (el) {
      var box = el.getBoundingClientRect();
      var hit =
        box.right >= rect.x &&
        box.left <= rect.x + rect.w &&
        box.bottom >= rect.y &&
        box.top <= rect.y + rect.h;
      if (!hit) return;
      var key = el.getAttribute('data-col-key') || '';
      if (key) keys.push(key);
    });
    return keys;
  }

  function marqueeBox() {
    if (!_marquee) return { x: 0, y: 0, w: 0, h: 0 };
    return {
      x: Math.min(_marquee.x0, _marquee.x1),
      y: Math.min(_marquee.y0, _marquee.y1),
      w: Math.abs(_marquee.x1 - _marquee.x0),
      h: Math.abs(_marquee.y1 - _marquee.y0),
    };
  }

  function paintMarquee() {
    var el = document.getElementById('ms-ags-marquee');
    if (!el || !_marquee) return;
    var box = marqueeBox();
    el.style.left = box.x + 'px';
    el.style.top = box.y + 'px';
    el.style.width = box.w + 'px';
    el.style.height = box.h + 'px';
    var keys = {};
    clinicianFieldsInRect(box).forEach(function (k) {
      keys[k] = true;
    });
    var overlay = document.getElementById(OVERLAY_ID);
    var dests = destKeySet();
    if (!overlay) return;
    overlay.querySelectorAll('.ms-lac-chip-wrap[data-col-kind="clinician"]').forEach(function (node) {
      var k = node.getAttribute('data-col-key');
      if (keys[k]) node.classList.add('ms-ags-field-on');
      else if (!dests[k]) node.classList.remove('ms-ags-field-on');
    });
  }

  function clearMarquee() {
    document.removeEventListener('mousemove', moveMarquee);
    document.removeEventListener('mouseup', endMarquee);
    var el = document.getElementById('ms-ags-marquee');
    if (el) el.remove();
    _marquee = null;
  }

  function moveMarquee(e) {
    if (!_marquee) return;
    _marquee.x1 = e.clientX;
    _marquee.y1 = e.clientY;
    paintMarquee();
  }

  function endMarquee(e) {
    if (e) {
      _marquee.x1 = e.clientX;
      _marquee.y1 = e.clientY;
    }
    var box = marqueeBox();
    var keys = box.w >= 8 && box.h >= 8 ? clinicianFieldsInRect(box) : [];
    clearMarquee();
    if (keys.length) setCustomFromFieldKeys(keys);
  }

  function startMarquee(e) {
    clearMarquee();
    _marquee = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    var box = document.createElement('div');
    box.id = 'ms-ags-marquee';
    box.className = 'ms-ags-marquee';
    overlay.appendChild(box);
    paintMarquee();
    document.addEventListener('mousemove', moveMarquee);
    document.addEventListener('mouseup', endMarquee);
  }

  function emptyPoolHtml() {
    return (
      '<div class="ms-lac-empty">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<path d="M3 8l4-5h10l4 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 8h18"/><path d="M9 12h6"/>' +
      '</svg>' +
      '<div class="ms-lac-empty-title">No unallocated reports on this queue</div>' +
      '<div class="ms-lac-empty-sub">Inbox results appear here. Work already sitting with a clinician is in their field on the right.</div>' +
      '</div>'
    );
  }

  function boardHtml() {
    var board = currentWorkspace();
    var pool = board.pool;
    var selCount = selectedIds().length;
    var body = pool.groups && pool.groups.length ? pool.groups.map(groupHtml).join('') : '';
    if (!body && board.count > 0) {
      body =
        '<div class="ms-lac-empty"><div class="ms-lac-empty-title">Nothing left unallocated</div>' +
        '<div class="ms-lac-empty-sub">Everything on this queue is sitting with a clinician, or staged onto one on this canvas</div></div>';
    }
    var clinicians = sortClinicianFields(C.mergeInDayClinicians(board.clinicians, inDayPeople()));
    var teams = board.teams || [];
    return (
      '<div class="ms-lac-workspace">' +
      '<div class="ms-lac-col ms-lac-pool" data-col-key="' +
      esc(pool.key) +
      '" data-col-kind="pool">' +
      '<div class="ms-lac-pool-head">' +
      '<div class="ms-lac-pool-titles">' +
      '<p class="ms-lac-pool-eyebrow">' +
      esc(pool.title) +
      '</p>' +
      '<h3 class="ms-lac-pool-title">Unallocated reports</h3>' +
      '</div>' +
      '<span class="ms-lac-pool-count">' +
      pool.count +
      ' of ' +
      board.count +
      '</span>' +
      '<span class="ms-lac-col-meta">Click a report, or a clinician heading for the lot. Ctrl-click adds more</span>' +
      '</div>' +
      (body || emptyPoolHtml()) +
      '</div>' +
      '<aside class="ms-lac-rail" aria-label="Clinician and team fields">' +
      workingDayHtml() +
      evenSplitHtml() +
      '<div class="ms-lac-rail-head">' +
      '<h3 class="ms-lac-col-heading">Clinicians</h3>' +
      '<span class="ms-lac-col-meta">' +
      (selCount
        ? 'Click a field to stage the selection'
        : 'In ' +
          dayPhrase() +
          ' at the top. Drag onto a field — hover near the edge to scroll') +
      '</span>' +
      '</div>' +
      (clinicians.length
        ? clinicians
            .map(function (col) {
              return fieldHtml(col, selCount);
            })
            .join('')
        : '<div class="ms-lac-empty-sm">No clinician fields yet — add one below if you need a drop target.</div>') +
      (teams.length
        ? '<div class="ms-lac-rail-head ms-lac-rail-teams">' +
          '<h3 class="ms-lac-col-heading">Teams</h3>' +
          '<span class="ms-lac-col-meta">Drop here to send back to a team inbox</span>' +
          '</div>' +
          teams
            .map(function (col) {
              return fieldHtml(col, selCount);
            })
            .join('')
        : '') +
      '<div class="ms-lac-add-row">' +
      '<input type="text" id="ms-lac-add-name" maxlength="80" placeholder="Add a clinician field — e.g. Dr Jane Cole" aria-label="Add a clinician field">' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-add-btn">Add clinician</button>' +
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
      ' — click a clinician field to stage them, or drag. Ctrl-click another heading or report to add it</span>' +
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
    if (_writing) {
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-warn">' +
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
      var refusedPhrase = C.refusedPatientsPhrase ? C.refusedPatientsPhrase(_confirmWrite, _rows) : '';
      if (refusedPhrase) {
        refusedNote = '<p class="ms-lac-confirmbar-note">' + esc(refusedPhrase) + '</p>';
      }
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-warn">' +
        '<strong>Medicus will reassign these tasks.</strong> This changes who the task sits with — it does not file the result.' +
        '<ul class="ms-lac-writelist">' +
        lines +
        '</ul>' +
        refusedNote +
        '<div class="ms-lac-confirmbar-actions">' +
        '<button type="button" class="ms-lac-ghost" id="ms-lac-write-keep">Keep planning</button>' +
        '<button type="button" class="ms-lac-confirm-btn" id="ms-lac-write-go">Write to Medicus</button>' +
        '</div></div>'
      );
    }
    var sum = C.draftSummary(_rows, _draft);
    var gate = C.canWriteAllocations({ taskList: _taskList, slug: _route && _route.slug });
    var plan = sum.count
      ? C.planBulkReassign(_rows, _draft, _taskList, _staffDir, _route && _route.slug, _teamDir)
      : null;
    var canWrite = !!(gate.ok && plan && plan.ok && plan.batches && plan.batches.length);
    var blockReason = '';
    if (sum.count && !canWrite) {
      blockReason = !gate.ok ? gate.reason : C.writeBlockReason(plan);
    }
    var writeTitle = !sum.count
      ? 'Stage at least one result onto a clinician field first'
      : canWrite
        ? 'Review the patient → destination list, then confirm'
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
      '<button type="button" class="ms-lac-confirm-btn" id="ms-lac-finalise"' +
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
    var board = currentWorkspace();
    var requesterGroups = board.pool.groups.filter(function (g) {
      return g.known;
    }).length;
    var counts = _rows.length
      ? _rows.length +
        ' results · ' +
        board.pool.count +
        ' unallocated · ' +
        requesterGroups +
        ' requester group' +
        (requesterGroups === 1 ? '' : 's')
      : '';
    return (
      '<div class="ms-lac-panel' +
      (_writing ? ' ms-lac-panel-writing' : '') +
      '" role="dialog" aria-modal="true" aria-labelledby="ms-lac-title">' +
      '<div class="ms-lac-header">' +
      '<h2 class="ms-lac-title" id="ms-lac-title">Allocate incoming labs</h2>' +
      '<span class="ms-lac-header-counts">' +
      esc(counts) +
      '</span>' +
      '<span class="ms-lac-header-note">Unallocated on the left. Click a report, or a clinician heading for the lot. Ctrl-click to add more. Drag onto a field — or click the field. Writing happens only when you confirm.</span>' +
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

  function toggleSelect(id, additive, shiftKey) {
    if (!id) return;
    if (shiftKey && _lastSelectId) {
      var range = C.rangeSelectIds(visibleTileOrder(), _lastSelectId, id);
      _selected = additive ? C.addToSelection(_selected, range) : C.replaceSelection(range);
    } else {
      _selected = C.toggleIdInSelection(_selected, id, additive);
      _lastSelectId = id;
    }
    render();
  }

  function addNamedColumn() {
    var input = document.getElementById('ms-lac-add-name');
    var name = input && input.value;
    if (!name || !String(name).trim()) return;
    _draft = C.addColumn(_draft, name);
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
    var dayInput = root.querySelector('#ms-lac-day');
    if (dayInput)
      dayInput.addEventListener('change', function () {
        setWorkDate(dayInput.value);
      });
    var dayToday = root.querySelector('#ms-lac-day-today');
    if (dayToday)
      dayToday.addEventListener('click', function () {
        setWorkDate(calendarToday());
      });
    var dayTomorrow = root.querySelector('#ms-lac-day-tomorrow');
    if (dayTomorrow)
      dayTomorrow.addEventListener('click', function () {
        setWorkDate(C.addDaysISO(calendarToday(), 1));
      });
    var inTodayBtn = root.querySelector('#ms-ags-in-today');
    if (inTodayBtn)
      inTodayBtn.addEventListener('click', function () {
        setDestKind('in-today', '');
      });
    root.querySelectorAll('[data-ags-group]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setDestKind('group', btn.getAttribute('data-ags-group') || '');
      });
    });
    root.querySelectorAll('[data-ags-all]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setDestKind('group', btn.getAttribute('data-ags-all') || '');
      });
    });
    var allBtn = root.querySelector('#ms-ags-all');
    if (allBtn)
      allBtn.addEventListener('click', function () {
        _agsAllOpen = !_agsAllOpen;
        render();
      });
    bindAllGroupsPanel(root);
    var saveBtn = root.querySelector('#ms-ags-save');
    if (saveBtn)
      saveBtn.addEventListener('click', function () {
        saveAsGroup();
      });
    var well = root.querySelector('#ms-ags-new-group');
    if (well) {
      well.addEventListener('click', function () {
        setDestKind('custom', '');
        if (!_customMembers.length) {
          announce('Encircle people, click their fields, or drag them onto New group.');
        }
      });
      well.addEventListener('dragover', function (e) {
        if (!_dragFieldKey) return;
        e.preventDefault();
        e.stopPropagation();
        well.classList.add('ms-ags-well-on');
      });
      well.addEventListener('dragleave', function (e) {
        if (e.relatedTarget && well.contains(e.relatedTarget)) return;
        if (_destKind !== 'custom') well.classList.remove('ms-ags-well-on');
      });
      well.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var key = _dragFieldKey;
        _dragFieldKey = '';
        if (!key) return;
        addFieldToCustom(key);
      });
    }
    function bindPileAction(id, applyFn, okNote) {
      var btn = root.querySelector(id);
      if (!btn) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (_writing) return;
        var applied = applyFn();
        _selected = {};
        _confirmWrite = null;
        _copyNote =
          applied && applied.ok ? okNote(applied) : (applied && applied.reason) || 'Could not split.';
        announce(_copyNote);
        render();
      });
    }
    bindPileAction('#ms-lac-split', applyPileSplit, function (applied) {
      return (
        'Split ' +
        applied.total +
        ' equally onto ' +
        applied.doctors +
        ' people. Proposal, not written yet. Drag a patient onto another field to change who gets them.'
      );
    });
    bindPileAction('#ms-lac-topup', applyTopUp, function (applied) {
      return (
        'Topped up empty boxes with ' +
        applied.total +
        ' among the current destinations. Proposal, not written yet. Drag a patient onto another field to change who gets them.'
      );
    });
    bindPileAction('#ms-lac-level', applyLevel, function (applied) {
      return (
        'Distributed ' +
        applied.total +
        ' equally among ' +
        applied.doctors +
        ' people. Proposal, not written yet. Drag a patient onto another field to change who gets them.'
      );
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
        _lastSelectId = '';
        _lastGroupKey = '';
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
        announce('Kept planning. Nothing was written.');
        render();
      });
    var writeGo = root.querySelector('#ms-lac-write-go');
    if (writeGo)
      writeGo.addEventListener('click', function () {
        commitWrite();
      });
    function markDragSources(ids) {
      var overlay = document.getElementById(OVERLAY_ID);
      if (!overlay) return;
      overlay.classList.add('ms-lac-lifting');
      var idSet = {};
      (ids || []).forEach(function (id) {
        idSet[id] = true;
      });
      overlay.querySelectorAll('.ms-lac-tile').forEach(function (tile) {
        var id = tile.getAttribute('data-task-id');
        if (idSet[id]) tile.classList.add('ms-lac-drag-source');
      });
      overlay.querySelectorAll('.ms-lac-group').forEach(function (group) {
        var head = group.querySelector('.ms-lac-group-head');
        var gids = parseIdList(head && head.getAttribute('data-group-ids'));
        var any = false;
        var all = gids.length > 0;
        for (var i = 0; i < gids.length; i++) {
          if (idSet[gids[i]]) any = true;
          else all = false;
        }
        if (all) group.classList.add('ms-lac-group-lift');
        else if (any) group.classList.add('ms-lac-group-lift-partial');
      });
    }
    function clearDragMarks() {
      var overlay = document.getElementById(OVERLAY_ID);
      if (!overlay) return;
      overlay.classList.remove('ms-lac-lifting');
      overlay.querySelectorAll('.ms-lac-drag-source, .ms-lac-group-lift, .ms-lac-group-lift-partial').forEach(function (node) {
        node.classList.remove('ms-lac-drag-source', 'ms-lac-group-lift', 'ms-lac-group-lift-partial');
      });
    }
    function beginDrag(e, startIds) {
      var ids = C.dragIdsFor(_selected, startIds);
      _ignoreClickAfterDrag = true;
      _dragFieldKey = '';
      _dragIds = ids;
      var from = e.currentTarget;
      var wrap = from && from.closest && from.closest('.ms-lac-chip-wrap');
      _dragOriginKind =
        from && from.closest && from.closest('.ms-lac-pool')
          ? 'pool'
          : wrap
            ? wrap.getAttribute('data-col-kind') || 'clinician'
            : '';
      markDragSources(ids);
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
      _dragFieldKey = '';
      _dragOriginKind = '';
      clearDragMarks();
      if (_dragGhost) {
        _dragGhost.remove();
        _dragGhost = null;
      }
      setTimeout(function () {
        _ignoreClickAfterDrag = false;
      }, 0);
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
    root.querySelectorAll('.ms-lac-group-pick, .ms-lac-field-select').forEach(function (btn) {
      btn.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        applyGroupSelection(
          parseIdList(btn.getAttribute('data-group-ids') || btn.getAttribute('data-select-ids')),
          btn.getAttribute('data-group-key') || '',
          true,
          false
        );
      });
    });
    root.querySelectorAll('.ms-lac-group-head').forEach(function (head) {
      head.addEventListener('click', function (e) {
        if (_ignoreClickAfterDrag) return;
        if (e.target && e.target.closest && (e.target.closest('.ms-lac-group-toggle') || e.target.closest('.ms-lac-group-pick'))) {
          return;
        }
        e.stopPropagation();
        applyGroupSelection(
          parseIdList(head.getAttribute('data-group-ids')),
          head.getAttribute('data-group-key') || '',
          !!(e.metaKey || e.ctrlKey),
          !!e.shiftKey
        );
      });
      head.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          applyGroupSelection(
            parseIdList(head.getAttribute('data-group-ids')),
            head.getAttribute('data-group-key') || '',
            !!(e.metaKey || e.ctrlKey),
            !!e.shiftKey
          );
        }
      });
      head.addEventListener('dragstart', function (e) {
        beginDrag(e, parseIdList(head.getAttribute('data-group-ids')));
      });
      head.addEventListener('dragend', endDrag);
    });
    root.querySelectorAll('.ms-lac-tile').forEach(function (tile) {
      tile.addEventListener('click', function (e) {
        if (_ignoreClickAfterDrag) return;
        var id = tile.getAttribute('data-task-id');
        if (!id) return;
        var onCheck = !!(e.target && e.target.closest && e.target.closest('.ms-lac-tile-check'));
        toggleSelect(id, onCheck || e.metaKey || e.ctrlKey, e.shiftKey);
      });
      tile.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var id = tile.getAttribute('data-task-id');
          if (id) toggleSelect(id, true, e.shiftKey);
        }
      });
      tile.addEventListener('dragstart', function (e) {
        var id = tile.getAttribute('data-task-id');
        beginDrag(e, id ? [id] : []);
      });
      tile.addEventListener('dragend', endDrag);
    });
    function bindDropTarget(el) {
      el.addEventListener('dragover', function (e) {
        if (_dragFieldKey) return;
        e.preventDefault();
        var kind = el.getAttribute('data-col-kind') || '';
        if (C.dropTargetShowsHover(_dragOriginKind, kind)) {
          el.classList.add('ms-lac-drop-hover');
        }
        scrollNearEdge(e);
      });
      el.addEventListener('dragleave', function (e) {
        if (e.relatedTarget && el.contains(e.relatedTarget)) return;
        el.classList.remove('ms-lac-drop-hover');
      });
      el.addEventListener('drop', function (e) {
        e.preventDefault();
        el.classList.remove('ms-lac-drop-hover');
        if (_dragFieldKey) {
          endDrag();
          return;
        }
        var key = el.getAttribute('data-col-key');
        var ids = _dragIds && _dragIds.length ? _dragIds : [];
        if (!ids.length && e.dataTransfer) {
          var raw = String(e.dataTransfer.getData('text/plain') || '');
          if (raw.indexOf('field:') === 0) {
            endDrag();
            return;
          }
          ids = raw.split(',').filter(Boolean);
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
        if (_ignoreClickAfterDrag) return;
        var key = btn.getAttribute('data-chip-key') || '';
        var ids = selectedIds();
        if (ids.length) {
          // The non-drag path: an active selection makes every chip a
          // one-click stage target.
          requestStage(ids, key, btn.closest('.ms-lac-chip-wrap'));
          return;
        }
        var wrap = btn.closest('.ms-lac-chip-wrap');
        var kind = (wrap && wrap.getAttribute('data-col-kind')) || '';
        if (kind === 'clinician' && _agsPicking) {
          toggleFieldInCustom(key);
          return;
        }
        _expandedChip = _expandedChip === key ? '' : key;
        render();
      });
      btn.addEventListener('dragstart', function (e) {
        var wrap = btn.closest('.ms-lac-chip-wrap');
        var kind = (wrap && wrap.getAttribute('data-col-kind')) || '';
        if (kind !== 'clinician' || selectedIds().length) {
          e.preventDefault();
          return;
        }
        _dragFieldKey = (wrap && wrap.getAttribute('data-col-key')) || '';
        _dragIds = null;
        _ignoreClickAfterDrag = true;
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', 'field:' + _dragFieldKey);
          e.dataTransfer.effectAllowed = 'copy';
        }
      });
      btn.addEventListener('dragend', function () {
        _dragFieldKey = '';
        setTimeout(function () {
          _ignoreClickAfterDrag = false;
        }, 0);
      });
    });
    var rail = root.querySelector('.ms-lac-rail');
    if (rail) {
      rail.addEventListener('mousedown', function (e) {
        if (e.button !== 0 || _writing || _dragIds || _dragFieldKey) return;
        var t = e.target;
        if (!t || !t.closest) return;
        if (
          t.closest(
            '.ms-lac-tile, .ms-lac-chip, .ms-lac-group, button, input, select, textarea, a, .ms-ags-chip, .ms-ags-well, .ms-ags-strip, .ms-ags-actions, label'
          )
        ) {
          return;
        }
        e.preventDefault();
        startMarquee(e);
      });
    }
  }

  function requestStage(ids, key, colEl) {
    if (_writing) return;
    var kind = (colEl && colEl.getAttribute('data-col-kind')) || '';
    var titleEl =
      (colEl && colEl.querySelector('.ms-lac-chip-name')) || (colEl && colEl.querySelector('.ms-lac-col-heading'));
    var title = C.displayClinicianName((titleEl && titleEl.textContent) || '');
    if (kind === 'clinician') {
      var abs = C.presenceForName(presenceOpts(title));
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
    if (key && String(key).indexOf('clinician:') === 0) {
      var hit = inDayPeople().filter(function (p) {
        return p && p.key === key;
      })[0];
      if (hit) _draft = C.addColumn(_draft, hit.name, hit.staffId);
    }
    _draft = C.stageMoves(_draft, ids, key);
    _selected = {};
    _lastSelectId = '';
    _lastGroupKey = '';
    _pendingAbsence = null;
    _dragIds = null;
    _dragOriginKind = '';
    if (key && (key.indexOf('clinician:') === 0 || key.indexOf('team:') === 0)) _expandedChip = key;
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

  function requestWrite() {
    if (_writing) return;
    var plan = C.planBulkReassign(_rows, _draft, _taskList, _staffDir, _route && _route.slug, _teamDir);
    if (!plan.ok || !plan.batches.length) {
      _error = C.writeBlockReason(plan);
      announce(_error);
      render();
      return;
    }
    _confirmWrite = plan;
    announce('Review the list, then confirm. Medicus will reassign those tasks.');
    render();
  }

  async function commitWrite() {
    if (_writing || !_confirmWrite) return;
    _writing = true;
    _error = null;
    render();
    try {
      var result = await client().commitAllocations({
        slug: _route && _route.slug,
        search: _route && _route.search,
        draft: _draft,
        rows: _rows,
        taskList: _taskList,
        directory: _staffDir,
        teamDirectory: _teamDir,
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
      announce('Kept planning. Nothing was written.');
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
    _lastSelectId = '';
    _lastGroupKey = '';
    _error = null;
    _copyNote = '';
    _expandedChip = '';
    _confirmClose = false;
    _confirmWrite = null;
    _writing = false;
    _taskList = undefined;
    _staffDir = C.harvestStaffDirectory([], null);
    _teamDir = C.harvestTeamDirectory([], null);
    _collapsed = {};
    _workDate = '';
    _destKind = 'in-today';
    _destGroupId = '';
    _customMembers = [];
    _agsPicking = false;
    _agsAllOpen = false;
    _agsDestReady = false;
    _dragFieldKey = '';
    clearMarquee();
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
    _lastSelectId = '';
    _lastGroupKey = '';
    _expandedChip = '';
    _confirmClose = false;
    _confirmWrite = null;
    _writing = false;
    _taskList = undefined;
    _staffDir = C.harvestStaffDirectory([], null);
    _teamDir = C.harvestTeamDirectory([], null);
    _copyNote = '';
    _error = null;
    _collapsed = {};
    _workDate = calendarToday();
    _destKind = 'in-today';
    _destGroupId = '';
    _customMembers = [];
    _agsPicking = false;
    _agsAllOpen = false;
    _agsDestReady = false;
    _dragFieldKey = '';
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
    loadGroupsState().then(function () {
      if (!_open) return;
      pinDestColumns();
      render();
    });
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
      if (e.key === 'Escape' && _open) {
        e.stopPropagation();
        if (_writing) return;
        if (_confirmWrite) {
          _confirmWrite = null;
          announce('Kept planning. Nothing was written.');
          render();
          return;
        }
        if (_agsAllOpen) {
          _agsAllOpen = false;
          render();
          return;
        }
        if (selectedIds().length) {
          _selected = {};
          _lastSelectId = '';
          _lastGroupKey = '';
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
