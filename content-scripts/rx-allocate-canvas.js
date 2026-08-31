// © 2026 Graysbrook Ltd. Proprietary — all rights reserved.
// Medicus Suite — non-routine prescription-request allocation canvas
//
// Sibling of the lab / workflow allocation canvases. Same drag / stage /
// confirm / bulk-reassign pattern on the non-routine prescription-request
// task-list. The large left box is UNALLOCATED requests, grouped by
// registered GP when that is on the row. Named GP is a grouping caption,
// never auto-placement. Even-split among doctors working today stages
// locally — it does not write. Does not issue, sign, or file a prescription.
//
// Writing uses LabAllocateCore.createClient (W23). This file never POSTs.
// Confirm lists patient → destination. UI copy never claims the write
// finished, and never claims a requester.
'use strict';

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msRxAllocateCanvas) return;
  window.__msRxAllocateCanvas = true;

  var C = window.RxAllocateCore;
  if (!C) return;

  var OVERLAY_ID = 'ms-rxac-overlay';
  var LAUNCH_ID = 'ms-rxac-launch';

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
  var _splitDefaulted = false;

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
    return C.parseRxQueueRoute(location.pathname, location.search);
  }

  function client() {
    if (!_route) throw new Error('rx-allocate: no non-routine prescription-queue route');
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

  function queueTitle() {
    return C.poolTitle({ routine: _route && _route.routine });
  }

  function currentWorkspace() {
    return C.buildWorkspace(_rows, _draft, {
      teams: (_teamDir && _teamDir.list) || [],
      kind: _route && _route.kind,
      routine: _route && _route.routine,
    });
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

  // Lab enrichRequesters (requestedBy walker) is deliberately skipped —
  // document/workflow overviews do not carry who-ordered. Staff UUIDs still
  // come from harvestStaffFromOverviews + the create-task form.
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

  async function loadBoard(opts) {
    opts = opts || {};
    _loading = true;
    _error = null;
    render();
    try {
      var presenceP = Promise.all([loadRotaAbsences(), loadMedicusPresence()]);
      var out = await C.fetchRxTaskList(_route.apiBase, _route.slug, _route.search);
      _rows = C.markInboxRows(out.rows || [], _route.search);
      _route.slug = out.slug || _route.slug;
      if (out.search) _route.search = out.search;
      _taskList = out.taskList;
      _staffDir = C.harvestStaffDirectory(_rows, out.body);
      _teamDir = C.harvestTeamDirectory(_rows, out.body);
      render();
      await presenceP;
      harvestStaffFromBook(_book);
      _rows = C.markInboxRows(_rows, _route.search);
      await harvestStaffFromOverviews(_rows);
      if (!opts.skipSplit) applyDefaultEvenSplit();
    } catch (err) {
      _error = err && err.message ? err.message : 'Could not read this prescription queue.';
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
    var date = workDate();
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

  async function reloadWorkingDay() {
    if (!_open || !_route) return;
    _overviewProgress = 'Reading the appointment book for ' + dayPhrase() + '…';
    render();
    try {
      await loadMedicusPresence();
      harvestStaffFromBook(_book);
      applyDefaultEvenSplit();
    } catch (_) {
      _book = null;
    }
    _overviewProgress = '';
    announce(
      _splitDefaulted
        ? 'Even split staged for doctors working ' + dayPhrase() + '. Drag a request to move it.'
        : 'Even split is for doctors working ' + dayPhrase() + '.'
    );
    render();
  }

  function setWorkDate(iso) {
    var next = C.coerceWorkDate(iso, calendarToday());
    if (next === workDate()) return;
    _workDate = next;
    reloadWorkingDay();
  }

  function presenceForClinician(col) {
    if (!col || col.kind !== 'clinician') return { state: 'n/a', reason: 'not-a-person', label: '' };
    // Display casing — matching is case-insensitive, labels are user-facing.
    return C.presenceForName({
      name: C.displayClinicianName(col.title),
      dateISO: workDate(),
      book: _book,
      absences: _absences,
      staffList: _rota.staff,
      leaveList: _rota.leave,
    });
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

  // One-line row. Group headers carry the registered GP; the row only
  // repeats it in the unknown pile, where it varies per row.
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
        ? 'Grouped as ' + C.displayClinicianName(tile.requester)
        : tile.namedGp
          ? 'Registered GP ' + tile.namedGp
          : 'No registered GP on the task';
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
      esc(tile.summary || tile.statusText || 'Task') +
      '</span>' +
      assignedPerson +
      whoLine +
      '</div>'
    );
  }

  function groupHtml(group) {
    var collapsed = !!_collapsed[group.key];
    var title = group.known
      ? C.displayClinicianName(group.requester || group.groupName)
      : 'No registered GP on the task';
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
      (group.known ? ' grouped as ' + esc(title) : ' with no registered GP') +
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
      (allOn ? 'Remove these tasks from the selection' : 'Add all ' + group.count + ' tasks to the selection') +
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
        ? '<span class="ms-lac-chip-flag ms-lac-chip-flag-in">In ' +
          esc(dayPhrase()) +
          '</span>'
        : col.kind === 'team'
          ? '<span class="ms-lac-chip-flag ms-lac-chip-flag-team">Team</span>'
          : '';
    var note = '';
    if (away && abs.label) note = '<div class="ms-lac-col-absence">' + esc(abs.label) + '</div>';
    else if (inToday && abs.label) note = '<div class="ms-lac-col-in">' + esc(abs.label) + '</div>';
    var name = C.displayClinicianName(col.title);
    var isTeam = col.kind === 'team';
    var expandHint = isTeam
      ? open
        ? 'Hide staged tasks'
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
          (sittingAllOn
            ? isTeam
              ? 'All selected'
              : 'All sitting selected'
            : isTeam
              ? 'Select these'
              : 'Select all sitting') +
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
      '" data-col-key="' +
      esc(col.key) +
      '" data-col-kind="' +
      esc(col.kind || 'clinician') +
      '">' +
      '<button type="button" class="ms-lac-chip" data-chip-key="' +
      esc(col.key) +
      '" aria-expanded="' +
      (open ? 'true' : 'false') +
      '" aria-controls="ms-lac-drawer-' +
      esc(col.key).replace(/[^a-z0-9]/gi, '_') +
      '" aria-label="' +
      esc(selCount ? 'Stage ' + selCount + ' selected tasks onto ' + name : name + '. ' + expandHint) +
      '">' +
      '<span class="ms-lac-chip-name">' +
      esc(name) +
      '</span>' +
      flag +
      '<span class="ms-lac-chip-count">' +
      esc(fieldCounts(col)) +
      '</span>' +
      (selCount ? '<span class="ms-lac-chip-stagehint">Stage ' + selCount + ' here</span>' : '') +
      '</button>' +
      '<button type="button" class="ms-lac-field-expand" data-expand-key="' +
      esc(col.key) +
      '" aria-expanded="' +
      (open ? 'true' : 'false') +
      '">' +
      esc(open ? 'Hide' : 'Expand') +
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

  function emptyPoolHtml() {
    return (
      '<div class="ms-lac-empty">' +
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<path d="M3 8l4-5h10l4 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 8h18"/><path d="M9 12h6"/>' +
      '</svg>' +
      '<div class="ms-lac-empty-title">' +
      (_rows.length
        ? 'No unallocated requests on this queue'
        : 'Medicus returned no open requests') +
      '</div>' +
      '<div class="ms-lac-empty-sub">' +
      (_rows.length
        ? _splitDefaulted
          ? 'Even split is on the right. Drag a request onto another doctor to move it. Nothing is written until you confirm.'
          : 'All ' +
            _rows.length +
            ' request' +
            (_rows.length === 1 ? '' : 's') +
            ' already sit with a clinician — they are in the fields on the right. Drag a request onto another doctor to move it.'
        : 'The canvas reads the same open non-routine list as Signing (no page filter). If the grid on this page still shows rows, reload the list then open the canvas again.') +
      '</div>' +
      '</div>'
    );
  }

  function currentDestinations() {
    return C.pinDestStaffIds(
      C.workingTodayDoctors({
        book: _book,
        absences: _absences,
        staffList: _rota.staff,
        leaveList: _rota.leave,
        dateISO: workDate(),
      }),
      _staffDir
    );
  }

  function tilesForPlan() {
    return (_rows || []).filter(function (r) {
      return C.isRxUnallocated(r);
    });
  }

  function currentSplitPlan() {
    return C.planEvenSplit(tilesForPlan(), currentDestinations(), { dayPhrase: dayPhrase() });
  }

  function applyDefaultEvenSplit() {
    var dests = currentDestinations();
    _draft = C.ensureWorkingTodayColumns(_draft || C.emptyDraft(), dests);
    var plan = currentSplitPlan();
    if (!plan.ok) {
      _splitDefaulted = false;
      return plan;
    }
    var next = C.emptyDraft();
    next = C.ensureWorkingTodayColumns(next, dests);
    _draft = C.applyEvenSplit(next, plan);
    _splitDefaulted = true;
    return plan;
  }

  function currentAllocationRows() {
    var board = currentWorkspace();
    var counts = {};
    (board.clinicians || []).forEach(function (col) {
      var n = 0;
      (col.tiles || []).forEach(function (t) {
        if (C.isRxUnallocated(t)) n += 1;
      });
      counts[col.key] = n;
    });
    return currentDestinations().map(function (d) {
      return { name: d.name, key: d.key, count: counts[d.key] || 0 };
    });
  }

  function evenSplitHtml() {
    var dests = currentDestinations();
    var phrase = dayPhrase();
    var cal = calendarToday();
    var picked = workDate();
    var shown = _splitDefaulted ? currentAllocationRows() : currentSplitPlan().shares || [];
    var rows = shown
      .map(function (s) {
        return (
          '<li><span class="ms-lac-split-name">' +
          esc(C.displayClinicianName(s.name)) +
          '</span><span class="ms-lac-split-count">' +
          s.count +
          '</span></li>'
        );
      })
      .join('');
    var dayRow =
      '<div class="ms-lac-split-day">' +
      '<label class="ms-lac-split-day-label" for="ms-rxac-day">Working day</label>' +
      '<input type="date" id="ms-rxac-day" value="' +
      esc(picked) +
      '" aria-label="Working day for the even split. Defaults to today.">' +
      '<button type="button" class="ms-lac-ghost' +
      (picked === cal ? ' ms-lac-split-day-on' : '') +
      '" id="ms-rxac-day-today">Today</button>' +
      '<button type="button" class="ms-lac-ghost' +
      (picked === C.addDaysISO(cal, 1) ? ' ms-lac-split-day-on' : '') +
      '" id="ms-rxac-day-tomorrow">Tomorrow</button>' +
      '</div>' +
      '<p class="ms-lac-split-note">Defaults to today. Change this if you are allocating the night before.</p>';
    if (!dests.length) {
      return (
        '<div class="ms-lac-split" id="ms-rxac-split-box">' +
        '<p class="ms-lac-split-title">Split among doctors working ' +
        esc(phrase) +
        '</p>' +
        dayRow +
        '<p class="ms-lac-split-note">No doctors with a session on the appointment book for ' +
        esc(phrase) +
        ', so there is nobody to split onto. Add a clinician field by hand, or pick another day, then drag requests onto them.</p>' +
        '</div>'
      );
    }
    var poolN = tilesForPlan().length;
    var canResplit = !!(poolN && dests.length);
    return (
      '<div class="ms-lac-split" id="ms-rxac-split-box">' +
      '<p class="ms-lac-split-title">Split among doctors working ' +
      esc(phrase) +
      '</p>' +
      dayRow +
      '<button type="button" class="ms-lac-confirm-btn" id="ms-rxac-split"' +
      (canResplit ? '' : ' disabled') +
      '>' +
      (canResplit ? 'Re-split equally' : 'Nothing to split') +
      '</button>' +
      '<p class="ms-lac-split-note">' +
      (_splitDefaulted
        ? 'Even split is the starting point. Drag a request onto another doctor to move it. Nothing is written until you confirm.'
        : 'No even split yet — drag requests onto a doctor, or re-split equally.') +
      '</p>' +
      (rows ? '<ul class="ms-lac-split-list">' + rows + '</ul>' : '') +
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
    var clinicians = sortClinicianFields(board.clinicians);
    var teams = board.teams || [];
    return (
      evenSplitHtml() +
      '<div class="ms-lac-workspace">' +
      '<div class="ms-lac-col ms-lac-pool" data-col-key="' +
      esc(pool.key) +
      '" data-col-kind="pool">' +
      '<div class="ms-lac-pool-head">' +
      '<div class="ms-lac-pool-titles">' +
      '<p class="ms-lac-pool-eyebrow">' +
      esc(pool.title) +
      '</p>' +
      '<h3 class="ms-lac-pool-title">Unallocated</h3>' +
      '</div>' +
      '<span class="ms-lac-pool-count">' +
      pool.count +
      ' of ' +
      board.count +
      '</span>' +
      '<span class="ms-lac-col-meta">Click a request, or a clinician heading for the lot. Ctrl-click adds more</span>' +
      '</div>' +
      (body || emptyPoolHtml()) +
      '</div>' +
      '<aside class="ms-lac-rail" aria-label="Clinician and team fields">' +
      '<div class="ms-lac-rail-head">' +
      '<h3 class="ms-lac-col-heading">Clinicians</h3>' +
      '<span class="ms-lac-col-meta">' +
      (selCount
        ? 'Click a field to stage the selection'
        : 'Working ' + dayPhrase() + ' at the top. Drag onto a field — hover near the edge to scroll') +
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
      ' — click a clinician field to stage them, or drag. Ctrl-click another heading or task to add it</span>' +
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
      if (_confirmWrite.refused && _confirmWrite.refused.length) {
        refusedNote =
          '<p class="ms-lac-confirmbar-note">Not included — no unique staff or team match: ' +
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
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-warn">' +
        '<strong>Medicus will reassign these requests.</strong> This changes who the task sits with — it does not issue, sign, or file the prescription.' +
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
      ? 'Stage at least one task onto a clinician field first'
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
        : '<strong>Planning board.</strong> Staged moves live on this canvas until you review and confirm. Writing changes who the task sits with — it does not issue, sign, or file the prescription' +
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
        ' tasks · ' +
        board.pool.count +
        ' unallocated · ' +
        requesterGroups +
        ' registered-GP group' +
        (requesterGroups === 1 ? '' : 's')
      : '';
    return (
      '<div class="ms-lac-panel' +
      (_writing ? ' ms-lac-panel-writing' : '') +
      '" role="dialog" aria-modal="true" aria-labelledby="ms-lac-title">' +
      '<div class="ms-lac-header">' +
      '<h2 class="ms-lac-title" id="ms-lac-title">Allocate ' +
      esc(queueTitle().toLowerCase()) +
      '</h2>' +
      '<span class="ms-lac-header-counts">' +
      esc(counts) +
      '</span>' +
      '<span class="ms-lac-header-note">Even split is the starting board. Drag a request onto another doctor to move it, or re-split equally. Writing happens only when you confirm.</span>' +
      '<span class="ms-lac-hint" id="ms-lac-progress">' +
      esc(_overviewProgress) +
      '</span>' +
      '<button type="button" class="ms-lac-close" id="ms-lac-close">Close</button>' +
      '</div>' +
      selectionBarHtml() +
      '<div class="ms-lac-body"><div class="ms-lac-board" id="ms-lac-board">' +
      (_loading && !_rows.length ? '<div class="ms-lac-msg">Reading the queue…</div>' : boardHtml()) +
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
    var dayInput = root.querySelector('#ms-rxac-day');
    if (dayInput)
      dayInput.addEventListener('change', function () {
        setWorkDate(dayInput.value);
      });
    var dayToday = root.querySelector('#ms-rxac-day-today');
    if (dayToday)
      dayToday.addEventListener('click', function () {
        setWorkDate(calendarToday());
      });
    var dayTomorrow = root.querySelector('#ms-rxac-day-tomorrow');
    if (dayTomorrow)
      dayTomorrow.addEventListener('click', function () {
        setWorkDate(C.addDaysISO(calendarToday(), 1));
      });
    var splitBtn = root.querySelector('#ms-rxac-split');
    if (splitBtn)
      splitBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (_writing) return;
        var applied = applyDefaultEvenSplit();
        _selected = {};
        _confirmWrite = null;
        _copyNote =
          applied && applied.ok
            ? 'Re-split ' +
              applied.total +
              ' equally onto ' +
              applied.doctors +
              ' doctors working ' +
              dayPhrase() +
              '. Drag a request to move it. Review then write to save.'
            : (applied && applied.reason) || 'Could not re-split.';
        announce(_copyNote);
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
      overlay
        .querySelectorAll('.ms-lac-drag-source, .ms-lac-group-lift, .ms-lac-group-lift-partial')
        .forEach(function (node) {
          node.classList.remove('ms-lac-drag-source', 'ms-lac-group-lift', 'ms-lac-group-lift-partial');
        });
    }
    function beginDrag(e, startIds) {
      var ids = C.dragIdsFor(_selected, startIds);
      _ignoreClickAfterDrag = true;
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
        if (
          e.target &&
          e.target.closest &&
          (e.target.closest('.ms-lac-group-toggle') || e.target.closest('.ms-lac-group-pick'))
        ) {
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
          requestStage(ids, key, btn.closest('.ms-lac-chip-wrap'));
          return;
        }
        _expandedChip = _expandedChip === key ? '' : key;
        render();
      });
    });
    root.querySelectorAll('.ms-lac-field-expand').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var key = btn.getAttribute('data-expand-key') || '';
        if (!key) return;
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
        dateISO: workDate(),
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
    _lastSelectId = '';
    _lastGroupKey = '';
    _pendingAbsence = null;
    _dragIds = null;
    _dragOriginKind = '';
    if (key && (key.indexOf('clinician:') === 0 || key.indexOf('team:') === 0)) _expandedChip = key;
    announce('Staged ' + ids.length + ' task' + (ids.length === 1 ? '' : 's') + ' on this canvas only');
    render();
  }

  function copyWorkingList() {
    var text = C.copyList(
      C.buildWorkspace(_rows, _draft, {
        teams: (_teamDir && _teamDir.list) || [],
        kind: _route && _route.kind,
      })
    );
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
        fetchList: function () {
          return C.fetchRxTaskList(_route.apiBase, _route.slug, _route.search);
        },
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
          await loadBoard({ skipSplit: true });
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
      var leftover = (result.refused || []).length;
      _copyNote =
        'Medicus accepted ' +
        n +
        ' reassignment' +
        (n === 1 ? '' : 's') +
        (leftover
          ? '. ' + leftover + ' destination' + (leftover === 1 ? '' : 's') + ' had no unique staff id and stayed unallocated'
          : '') +
        '. The open list is the same queue with new assignees — reload Medicus if the grid still shows the old number.';
      _writing = false;
      announce(_copyNote);
      await loadBoard({ skipSplit: true });
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
    _splitDefaulted = false;
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
    _splitDefaulted = false;
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
    if (!_open) _route = route;
    var launchLabel = 'Allocate ' + queueTitle().toLowerCase() + ' on canvas…';
    if (!launch) {
      launch = document.createElement('button');
      launch.type = 'button';
      launch.id = LAUNCH_ID;
      launch.textContent = launchLabel;
      launch.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openOverlay();
      });
      document.documentElement.appendChild(launch);
    } else {
      launch.textContent = launchLabel;
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
