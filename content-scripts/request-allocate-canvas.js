// © 2026 Graysbrook Ltd. Proprietary - all rights reserved.
// Medicus Suite - patient-request canvas (medical and admin triage inbox)
//
// Sibling of the Rx / lab / workflow canvases. Same drag / stage /
// confirm / bulk-reassign pattern on homepage medical and admin
// patient-request task-lists. The large left box is UNALLOCATED
// requests, grouped by registered GP when that is on the row. Named GP
// is a grouping caption, never auto-placement. Split equally / Top up
// stage locally - they do not write. Does not complete,
// file, or reply to a request.
//
// Writing uses LabAllocateCore.createClient (W23). Fail-closed until a
// dummy-patient capture of bulk-reassign on these slugs. This file never
// POSTs. Confirm lists patient → person. UI copy never claims the write
// finished.
'use strict';

(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msRequestAllocateCanvas) return;
  window.__msRequestAllocateCanvas = true;

  var C = window.RequestAllocateCore;
  if (!C) return;
  var G = window.AllocationGroupsCore || null;
  var Strip = window.AllocationDestStrip || null;
  var SURFACE = 'request';

  var OVERLAY_ID = 'ms-qac-overlay';
  var LAUNCH_ID = 'ms-qac-launch';
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
  var _openDests = {};
  var _collapsed = {};
  var _workDate = '';
  var _splitDefaulted = false;
  var _presets = [];
  var _agConfig = { lastUsedBySurface: {} };
  var _destSet = { kind: 'in-today' };
  var _destSetReady = false;
  var _showAllGroups = false;
  var _namingGroup = false;
  var _scheduleAutoPick = false;
  var _personDrag = null;
  var _marquee = null;

  function fieldIsOpen(key) {
    return _expandedChip === key || !!_openDests[key];
  }

  function toggleFieldOpen(key) {
    if (!key) return;
    if (_openDests[key] || _expandedChip === key) {
      delete _openDests[key];
      _expandedChip = _expandedChip === key ? '' : _expandedChip;
      return;
    }
    _openDests[key] = true;
    _expandedChip = key;
  }

  function openDestsFromPlan(plan) {
    _openDests = {};
    (plan && plan.shares ? plan.shares : []).forEach(function (s) {
      if (s && s.key && s.count) _openDests[s.key] = true;
    });
  }

  function calendarToday() {
    return C.todayISO();
  }

  function workDate() {
    return C.coerceWorkDate(_workDate, calendarToday());
  }

  function dayPhrase() {
    return C.workDayPhrase(workDate(), calendarToday());
  }

  function workingFlag() {
    if (Strip && typeof Strip.workingFlagLabel === 'function') {
      return Strip.workingFlagLabel({ workDateISO: workDate(), calendarTodayISO: calendarToday() });
    }
    return 'Working today';
  }

  function destGroupName() {
    if (!_destSet || _destSet.kind !== 'group' || !G) return '';
    var preset = G.findPreset(_presets, _destSet.id);
    return (preset && preset.name) || '';
  }

  function destFlag() {
    if (Strip && typeof Strip.destFlagLabel === 'function') {
      return Strip.destFlagLabel({
        destKind: (_destSet && _destSet.kind) || 'in-today',
        destGroupName: destGroupName(),
        workDateISO: workDate(),
        calendarTodayISO: calendarToday(),
      });
    }
    var name = destGroupName();
    if (name) return name;
    return workingFlag();
  }

  function destFlagHtml(col, abs) {
    var away = abs.state === 'away' || abs.state === 'away-pending';
    var inToday = abs.state === 'present' && abs.reason === 'in-today';
    if (away) return '<span class="ms-lac-chip-flag">AWAY</span>';
    if (col.kind === 'team') return '<span class="ms-lac-chip-flag ms-lac-chip-flag-team">Team</span>';
    var kind = (_destSet && _destSet.kind) || 'in-today';
    if (kind === 'group') {
      var group = destFlag();
      return group ? '<span class="ms-lac-chip-flag ms-lac-chip-flag-in">' + esc(group) + '</span>' : '';
    }
    if (inToday) {
      return '<span class="ms-lac-chip-flag ms-lac-chip-flag-in">' + esc(workingFlag()) + '</span>';
    }
    return '';
  }

  function scheduleHintText() {
    if (!_scheduleAutoPick || !_destSet || _destSet.kind !== 'group') return '';
    if (!G || typeof G.scheduleAutoPickPhrase !== 'function') return '';
    var preset = G.findPreset(_presets, _destSet.id);
    if (!preset) return '';
    var todayLabel =
      Strip && typeof Strip.workingTodayChipLabel === 'function'
        ? Strip.workingTodayChipLabel({
            inTodayCount: inTodayPeople().length,
            workDateISO: workDate(),
            calendarTodayISO: calendarToday(),
          })
        : 'Working today';
    return G.scheduleAutoPickPhrase(preset, new Date(), todayLabel);
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
    return C.parseRequestQueueRoute(location.pathname, location.search);
  }

  function client() {
    if (!_route) throw new Error('request-allocate: no medical/admin request-queue route');
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
    return C.poolTitle({ admin: _route && _route.admin });
  }

  function currentWorkspace() {
    return C.buildWorkspace(_rows, _draft, {
      teams: (_teamDir && _teamDir.list) || [],
      kind: _route && _route.kind,
      admin: _route && _route.admin,
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
    announce('Selected ' + selectedIds().length + ' - click a clinician field to stage them, or drag');
    render();
  }

  function setProgress(text) {
    _overviewProgress = text || '';
    var node = document.getElementById('ms-lac-progress');
    if (node) node.textContent = _overviewProgress;
  }

  // Lab enrichRequesters (requestedBy walker) is deliberately skipped -
  // document/workflow overviews do not carry who-ordered. Staff UUIDs still
  // come from harvestStaffFromOverviews + the create-task form.
  async function harvestStaffFromOverviews(rows) {
    var withUrl = (rows || []).filter(function (r) {
      return r && r.overviewURL;
    });
    if (withUrl.length > OVERVIEW_CAP) withUrl = withUrl.slice(0, OVERVIEW_CAP);
    var patientId = '';
    (rows || []).forEach(function (r) {
      if (!patientId && r && r.patientId) patientId = r.patientId;
    });
    var cli = client();
    var i = 0;
    async function worker() {
      while (i < withUrl.length) {
        var idx = i++;
        try {
          var payload = await cli.fetchOverview(withUrl[idx].overviewURL);
          absorbDirectories(null, payload);
          if (!patientId && C.pickPatientIdFromPayload) patientId = C.pickPatientIdFromPayload(payload);
        } catch (_) {
          /* try the next overview */
        }
      }
    }
    if (withUrl.length) {
      var workers = [];
      var n = Math.min(OVERVIEW_CONCURRENCY, withUrl.length);
      for (var w = 0; w < n; w++) workers.push(worker());
      await Promise.all(workers);
    }
    if (!patientId) return;
    try {
      var form = await cli.fetchAssigneeStaff(patientId);
      absorbDirectories(null, form);
    } catch (_) {
      /* create-task form is a bonus directory, not required to stage */
    }
  }

  async function ensureDestStaffResolved() {
    var dests = currentDestinations();
    if (dests.collisions && dests.collisions.length) return;
    var missing = dests.some(function (d) {
      return d && !d.staffId;
    });
    if (!missing) return;
    var patientId = '';
    (_rows || []).forEach(function (r) {
      if (!patientId && r && r.patientId) patientId = r.patientId;
    });
    if (!patientId) return;
    try {
      var form = await client().fetchAssigneeStaff(patientId);
      absorbDirectories(null, form);
    } catch (_) {
      /* dest UUIDs stay blank and Write will refuse */
    }
  }

  function harvestStaffFromBook(book) {
    if (!book || !book.source) return;
    absorbDirectories(null, book.source);
  }

  async function loadBoard(opts) {
    opts = opts || {};
    var keepDraft = opts.skipSplit ? _draft || C.emptyDraft() : null;
    _loading = true;
    _error = null;
    render();
    try {
      await loadAllocationGroups();
      var presenceP = Promise.all([loadRotaAbsences(), loadMedicusPresence()]);
      var inboxP = C.fetchRequestTaskList(_route.apiBase, _route.slug, _route.search);
      var sittingP = C.fetchRequestTaskList(_route.apiBase, _route.slug, '').catch(function () {
        return { rows: [] };
      });
      var out = await inboxP;
      var sitting = await sittingP;
      _rows = C.mergeInboxAndSitting(
        out.rows || [],
        (sitting && sitting.rows) || [],
        _route.search,
        _route.admin ? 'admin' : 'medical'
      );
      _route.slug = out.slug || _route.slug;
      if (out.search) _route.search = out.search;
      _taskList = out.taskList;
      _staffDir = C.harvestStaffDirectory(_rows, out.body);
      _teamDir = C.harvestTeamDirectory(_rows, out.body);
      await presenceP;
      harvestStaffFromBook(_book);
      await harvestStaffFromOverviews(_rows);
      persistStaffCache();
      _draft = keepDraft
        ? C.ensureWorkingTodayColumns(keepDraft, currentDestinations())
        : C.replaceDestColumns(C.emptyDraft(), currentDestinations());
      if (!opts.skipSplit) _splitDefaulted = false;
    } catch (err) {
      _error = err && err.message ? err.message : 'Could not read this request queue.';
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
      _draft = C.replaceDestColumns(_draft || C.emptyDraft(), currentDestinations());
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
    // Display casing - matching is case-insensitive, labels are user-facing.
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
    if (opts.showWho && (tile.requester || tile.namedGp)) {
      whoLine =
        '<span class="ms-lac-tile-token">' +
        esc('Usual GP ' + C.displayClinicianName(tile.requester || tile.namedGp)) +
        '</span>';
    }
    if (tile.staged) {
      whoLine += '<span class="ms-lac-tile-token">not saved</span>';
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
      ? 'Usual GP · ' + C.displayClinicianName(group.requester || group.groupName)
      : 'No usual GP on the request';
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
    var proposed = 0;
    var sitting = 0;
    (col.tiles || []).forEach(function (t) {
      if (!t) return;
      if (t.staged || C.isRequestUnallocated(t)) proposed += 1;
      else sitting += 1;
    });
    var bits = [];
    if (col.kind === 'team') bits.push('Team');
    if (proposed) bits.push(proposed + ' proposed - not saved');
    if (sitting) bits.push(sitting + ' already sitting');
    if (!proposed && !sitting) bits.push(col.kind === 'team' ? 'nothing yet' : 'none yet');
    return bits.join(' · ');
  }

  function fieldHtml(col, selCount) {
    var abs = presenceForClinician(col);
    var away = abs.state === 'away' || abs.state === 'away-pending';
    var inToday = abs.state === 'present' && abs.reason === 'in-today';
    var open = fieldIsOpen(col.key);
    var body = col.tiles
      .map(function (t) {
        return tileHtml(t, { showWho: true, showAssignee: false });
      })
      .join('');
    var flag = destFlagHtml(col, abs);
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
      '</button>' +
      (selCount
        ? '<button type="button" class="ms-lac-chip-stagehint" data-stage-key="' +
          esc(col.key) +
          '">Sit ' +
          selCount +
          ' here (not saved)</button>' +
          '<button type="button" class="ms-lac-field-expand" data-expand-key="' +
          esc(col.key) +
          '" aria-expanded="' +
          (open ? 'true' : 'false') +
          '">' +
          esc(open ? 'Hide list' : 'See patients') +
          '</button>'
        : '') +
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
      (_rows.length ? 'Inbox is on the right - not saved yet' : 'No open requests on this queue') +
      '</div>' +
      '<div class="ms-lac-empty-sub">' +
      (_rows.length
        ? 'Doctors working ' +
          dayPhrase() +
          ' are on the right. Open a name to see who, or drag to move. Medicus does not change until you confirm.'
        : 'If the grid on this page still shows rows, reload the list, then open again.') +
      '</div>' +
      '</div>'
    );
  }

  function inTodayPeople() {
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

  function destSetOpts() {
    return {
      inToday: inTodayPeople(),
      presets: _presets,
      presenceFor: function (member) {
        var name = member && member.name;
        var id = member && member.staffId;
        if (id && _rota.staff) {
          var hit = _rota.staff.filter(function (s) {
            return s && String(s.id).toLowerCase() === String(id).toLowerCase();
          })[0];
          if (hit && hit.name) name = hit.name;
        }
        return C.presenceForName({
          name: name,
          dateISO: workDate(),
          book: _book,
          absences: _absences,
          staffList: _rota.staff,
          leaveList: _rota.leave,
        });
      },
      emptyInTodayReason: 'No doctors with a session on the appointment book for ' + dayPhrase() + ' to split onto.',
    };
  }

  function currentDestResolution() {
    if (!G) return { dests: inTodayPeople(), skipped: [], reason: '' };
    return G.destsFromSet(_destSet || { kind: 'in-today' }, destSetOpts());
  }

  function currentDestinations() {
    var resolved = currentDestResolution();
    var dests = C.asSplitDests(C.pinDestStaffIds(resolved.dests || [], _staffDir));
    dests.collisions = dests.collisions || [];
    return dests;
  }

  async function loadAllocationGroups() {
    if (!G || !chrome.storage || !chrome.storage.local) return;
    try {
      var got = await chrome.storage.local.get(['allocationGroups.presets', 'allocationGroups.config']);
      _presets = G.normalisePresets(got['allocationGroups.presets']);
      _agConfig = G.normaliseConfig(got['allocationGroups.config']);
      if (!_destSetReady) {
        var last = _agConfig.lastUsedBySurface && _agConfig.lastUsedBySurface.request;
        _destSet = G.defaultDestSet(_presets, new Date(), last) || { kind: 'in-today' };
        _scheduleAutoPick = _destSet.kind === 'group';
        _destSetReady = true;
      }
    } catch (_) {
      _presets = [];
    }
  }

  async function persistLastUsed() {
    if (!G || !chrome.storage || !chrome.storage.local) return;
    if (!_destSet || _destSet.kind === 'custom') return;
    try {
      _agConfig = G.rememberLastUsed(_agConfig, SURFACE, _destSet);
      await chrome.storage.local.set({ 'allocationGroups.config': G.normaliseConfig(_agConfig) });
    } catch (_) {}
  }

  async function persistStaffCache() {
    if (!chrome.storage || !chrome.storage.local) return;
    var list = (_staffDir && _staffDir.list) || [];
    if (!list.length) return;
    try {
      var got = await chrome.storage.local.get('allocationGroups.staffCache');
      var prev = Array.isArray(got['allocationGroups.staffCache']) ? got['allocationGroups.staffCache'] : [];
      var byId = {};
      prev.forEach(function (s) {
        if (s && s.id) byId[String(s.id).toLowerCase()] = { id: String(s.id).toLowerCase(), name: s.name || '' };
      });
      list.forEach(function (s) {
        if (!s || !s.id || !s.name) return;
        byId[String(s.id).toLowerCase()] = { id: String(s.id).toLowerCase(), name: s.name };
      });
      var cache = Object.keys(byId).map(function (k) {
        return byId[k];
      });
      await chrome.storage.local.set({ 'allocationGroups.staffCache': cache });
    } catch (_) {}
  }

  async function persistPresets() {
    if (!G || !chrome.storage || !chrome.storage.local) return;
    try {
      await chrome.storage.local.set({ 'allocationGroups.presets': G.normalisePresets(_presets) });
    } catch (_) {}
  }

  function setDestSet(next) {
    _destSet = next || { kind: 'in-today' };
    _namingGroup = false;
    _scheduleAutoPick = false;
    _draft = C.replaceDestColumns(_draft || C.emptyDraft(), currentDestinations());
    persistLastUsed();
  }

  function personFromFolder(el) {
    if (!el || !el.getAttribute) return null;
    var folder = el.closest ? el.closest('.ms-rxac-folder') : el;
    if (!folder) return null;
    var kind = folder.getAttribute('data-col-kind') || '';
    if (kind === 'pool' || kind === 'team') return null;
    var key = folder.getAttribute('data-col-key') || '';
    var nameEl = folder.querySelector('.ms-rxac-folder-name');
    var name = (nameEl && nameEl.textContent) || '';
    var staffId = '';
    if (_draft && _draft.columnStaffIds && key) staffId = _draft.columnStaffIds[key] || '';
    if (!staffId) {
      currentDestinations().forEach(function (d) {
        if (d && d.key === key && d.staffId) staffId = d.staffId;
      });
    }
    if (!staffId && _staffDir && _staffDir.list) {
      var hits = _staffDir.list.filter(function (s) {
        return s && s.id && s.name && C.displayClinicianName(s.name) === C.displayClinicianName(name);
      });
      if (hits.length === 1) staffId = hits[0].id;
    }
    if (!name) return null;
    return { key: key, name: name, staffId: staffId };
  }

  function personFromPeoplePayload(payload) {
    if (_personDrag) return _personDrag;
    if (!payload || payload.indexOf('people:') !== 0) return null;
    var id = payload.slice('people:'.length);
    if (!G || !G.isUuid(id)) return null;
    var hit = ((_staffDir && _staffDir.list) || []).filter(function (s) {
      return s && String(s.id).toLowerCase() === String(id).toLowerCase();
    })[0];
    if (hit) return { staffId: hit.id, name: hit.name, key: '' };
    return { staffId: id, name: '', key: '' };
  }

  function addPeopleToCustom(people) {
    var members = [];
    var seen = {};
    var cap = G ? G.MAX_MEMBERS : 12;
    function push(p) {
      if (!p || !p.staffId || !G || !G.isUuid(p.staffId)) return;
      if (members.length >= cap) return;
      var id = String(p.staffId).toLowerCase();
      if (seen[id]) return;
      seen[id] = true;
      members.push({ id: id, name: p.name || '' });
    }
    if (_destSet && _destSet.kind === 'custom') {
      (_destSet.members || []).forEach(function (m) {
        push({ staffId: m.id || m.staffId, name: m.name });
      });
    }
    (people || []).forEach(push);
    if (!members.length) {
      _copyNote = 'Need a staff id to put that person in a group.';
      return false;
    }
    setDestSet({ kind: 'custom', members: members });
    return true;
  }

  function teamIdForName(name) {
    var list = (_teamDir && _teamDir.list) || [];
    var want = C.teamColumnKey ? C.teamColumnKey(name) : '';
    var hits = [];
    list.forEach(function (t) {
      if (!t || !t.id || !t.name) return;
      if (want && C.teamColumnKey(t.name) === want) hits.push(t);
    });
    return hits.length === 1 ? hits[0].id : '';
  }

  function addableTeams() {
    var list = (_teamDir && _teamDir.list) || [];
    var used = {};
    ((_draft && _draft.extraColumns) || []).forEach(function (k) {
      used[k] = true;
    });
    return list.filter(function (t) {
      if (!t || !t.id || !t.name) return false;
      if (C.isRequestInboxName(t.name)) return false;
      var key = C.teamColumnKey(t.name);
      if (!key || used[key]) return false;
      return true;
    });
  }

  function splitDestinations() {
    var dests = currentDestinations();
    var collisions = dests.collisions ? dests.collisions.slice() : [];
    dests = dests.slice();
    dests.collisions = collisions;
    var seen = {};
    dests.forEach(function (d) {
      if (d && d.key) seen[d.key] = true;
    });
    var draft = _draft || C.emptyDraft();
    (draft.extraColumns || []).forEach(function (key) {
      if (!key || seen[key]) return;
      var title = (draft.columnTitles && draft.columnTitles[key]) || '';
      var id = (draft.columnStaffIds && draft.columnStaffIds[key]) || '';
      if (String(key).indexOf('team:') === 0) return;
      if (String(key).indexOf('clinician:') === 0 && title) {
        var pres = C.presenceForName({
          name: title,
          dateISO: workDate(),
          book: _book,
          absences: _absences,
          staffList: _rota.staff,
          leaveList: _rota.leave,
        });
        if (pres.state === 'away' || pres.state === 'away-pending') return;
        dests.push({
          key: key,
          name: title,
          staffId: id,
          kind: 'clinician',
        });
        seen[key] = true;
      }
    });
    return dests;
  }

  function visibleUnallocatedCount() {
    var pool = currentWorkspace().pool;
    return (pool && pool.tiles && pool.tiles.length) || 0;
  }

  function tilesForPlan() {
    var leftover = C.unallocatedNotStaged(_rows, _draft);
    var onDest = {};
    var board = currentWorkspace();
    (board.clinicians || []).concat(board.teams || []).forEach(function (col) {
      (col.tiles || []).forEach(function (t) {
        if (t && t.id) onDest[t.id] = true;
      });
    });
    return leftover.filter(function (r) {
      return r && r.id && !onDest[r.id];
    });
  }

  function destBoxCounts() {
    var dests = splitDestinations();
    var counts = {};
    dests.forEach(function (d) {
      counts[d.key] = 0;
    });
    var board = currentWorkspace();
    (board.clinicians || []).concat(board.teams || []).forEach(function (col) {
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

  function inTodayBoxTiles() {
    var dests = splitDestinations();
    var want = {};
    dests.forEach(function (d) {
      want[d.key] = true;
    });
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

  function applyPileSplit() {
    var dests = splitDestinations();
    if (dests.collisions && dests.collisions.length) {
      return { ok: false, reason: C.collisionPhrase(dests.collisions) };
    }
    var plan = C.planEvenSplit(tilesForPlan(), dests, { dayPhrase: dayPhrase() });
    if (!plan.ok) {
      _splitDefaulted = false;
      return plan;
    }
    _draft = C.applyEvenSplit(_draft || C.ensureWorkingTodayColumns(C.emptyDraft(), dests), plan);
    _splitDefaulted = true;
    _selected = {};
    openDestsFromPlan(plan);
    return plan;
  }

  function applyTopUp() {
    var dests = splitDestinations();
    if (dests.collisions && dests.collisions.length) {
      return { ok: false, reason: C.collisionPhrase(dests.collisions) };
    }
    var plan = C.planTopUp(tilesForPlan(), dests, destBoxCounts(), { dayPhrase: dayPhrase() });
    if (!plan.ok) {
      _splitDefaulted = false;
      return plan;
    }
    _draft = C.applyEvenSplit(_draft || C.ensureWorkingTodayColumns(C.emptyDraft(), dests), plan);
    _splitDefaulted = true;
    _selected = {};
    openDestsFromPlan(plan);
    return plan;
  }

  function applyDefaultEvenSplit() {
    return applyPileSplit();
  }

  function applyLevel() {
    var dests = splitDestinations();
    if (dests.collisions && dests.collisions.length) {
      return { ok: false, reason: C.collisionPhrase(dests.collisions) };
    }
    var seen = {};
    var tiles = inTodayBoxTiles()
      .concat(tilesForPlan())
      .filter(function (t) {
        if (!t || !t.id || seen[t.id]) return false;
        seen[t.id] = true;
        return true;
      });
    var plan = C.planLevel(tiles, dests, { dayPhrase: dayPhrase() });
    if (!plan.ok) return plan;
    var next = C.ensureWorkingTodayColumns(C.emptyDraft(), dests);
    _draft = C.applyEvenSplit(next, plan);
    _splitDefaulted = true;
    _selected = {};
    openDestsFromPlan(plan);
    return plan;
  }

  function currentAllocationRows() {
    var board = currentWorkspace();
    var counts = {};
    (board.clinicians || []).forEach(function (col) {
      var n = 0;
      (col.tiles || []).forEach(function (t) {
        if (C.isRequestUnallocated(t)) n += 1;
      });
      counts[col.key] = n;
    });
    return splitDestinations().map(function (d) {
      return { name: d.name, key: d.key, count: counts[d.key] || 0 };
    });
  }

  function evenSplitHtml() {
    var dests = splitDestinations();
    var phrase = dayPhrase();
    var cal = calendarToday();
    var picked = workDate();
    var poolN = visibleUnallocatedCount();
    var stagedN = C.draftSummary(_rows, _draft).count;
    var haveWork = destsHaveWork();
    var destPhrase = C.destNamesPhrase(dests);
    var resolved = currentDestResolution();
    var visible = [];
    if (G) {
      visible = _showAllGroups ? G.normalisePresets(_presets) : G.visiblePresets(_presets, new Date());
    }
    var destKind = (_destSet && _destSet.kind) || 'in-today';
    var inTodayN = inTodayPeople().length;
    var emptyBook = destKind === 'in-today' && inTodayN === 0;
    var summary = dests.length
      ? poolN + ' unallocated · ' + dests.length + ' destination' + (dests.length === 1 ? '' : 's') + ' for ' + phrase
      : emptyBook
        ? 'No one is on the book for this day. Type a name below to add them, or pick a saved group.'
        : 'No people to share out to for ' + phrase;
    var stripState = {
      destKind: destKind,
      destGroupId: (_destSet && _destSet.id) || '',
      visibleGroups: visible,
      inTodayCount: inTodayN,
      workDateISO: workDate(),
      calendarTodayISO: calendarToday(),
      destPhrase: destPhrase,
      skippedPhrase: G && resolved.skipped ? G.skippedPhrase(resolved.skipped) : '',
      canSave: !!(_destSet && _destSet.kind === 'custom' && dests.length),
      scheduleHint: scheduleHintText(),
    };
    var actionState = {
      destPhrase: destPhrase,
      dayPhrase: phrase,
      poolN: poolN,
      haveWork: haveWork,
      destCount: dests.length,
      destKind: destKind,
      inTodayCount: inTodayN,
      stagedN: stagedN,
      surfaceNoun: 'requests',
      destTitles: dests.map(function (d) {
        return d && d.name ? String(d.name) : '';
      }),
      collisionPhrase: dests.collisions && dests.collisions.length ? C.collisionPhrase(dests.collisions) : '',
    };
    var strip = Strip ? Strip.destSetStripHtml(stripState) : '';
    var actions = Strip ? Strip.splitActionsHtml(actionState) : '';
    var naming =
      _namingGroup && Strip && typeof Strip.saveGroupRowHtml === 'function'
        ? Strip.saveGroupRowHtml()
        : _namingGroup
          ? '<div class="ms-ags-save-row">' +
            '<label for="ms-ags-save-name">Group name</label>' +
            '<input type="text" id="ms-ags-save-name" maxlength="48" placeholder="e.g. Morning triage" aria-label="Group name">' +
            '<button type="button" class="ms-lac-confirm-btn" id="ms-ags-save-go">Save group</button>' +
            '<button type="button" class="ms-lac-ghost" id="ms-ags-save-cancel">Keep planning</button>' +
            '</div>'
          : '';
    var allList = _showAllGroups ? allGroupsPanelHtml() : '';
    return (
      '<div class="ms-lac-split' +
      (stagedN ? ' ms-rxac-split-proposing' : '') +
      '" id="ms-qac-split-box">' +
      '<div class="ms-rxac-split-row">' +
      '<label class="ms-lac-split-day-label" for="ms-qac-day" title="The appointment book for this date decides who is in. Defaults to today; pick tomorrow if you are doing this the night before.">Working day</label>' +
      '<input type="date" id="ms-qac-day" value="' +
      esc(picked) +
      '" aria-label="Working day for Working today" title="The appointment book for this date decides who is in.">' +
      '<button type="button" class="ms-lac-ghost' +
      (picked === cal ? ' ms-lac-split-day-on' : '') +
      '" id="ms-qac-day-today" title="Use today’s appointment book.">Today</button>' +
      '<button type="button" class="ms-lac-ghost' +
      (picked === C.addDaysISO(cal, 1) ? ' ms-lac-split-day-on' : '') +
      '" id="ms-qac-day-tomorrow" title="Use tomorrow’s appointment book - for sharing out the night before.">Tomorrow</button>' +
      '<span class="ms-lac-split-summary" title="' +
      esc(destPhrase ? 'Destinations: ' + destPhrase : summary) +
      '">' +
      esc(summary) +
      '</span>' +
      '</div>' +
      strip +
      naming +
      allList +
      actions +
      '</div>'
    );
  }

  function allGroupsPanelHtml() {
    if (!G) return '';
    var list = G.normalisePresets(_presets);
    var days = G.DAY_IDS || ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
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
    var preset = card.getAttribute('data-ags-card') ? G.findPreset(_presets, card.getAttribute('data-ags-card')) : null;
    if (!days.length && !start && !end) return null;
    if (!days.length || !start || !end) return (preset && preset.schedule) || null;
    if (G.scheduleErrors(raw).length) return (preset && preset.schedule) || null;
    return G.normaliseSchedule(raw);
  }

  function upsertPresetFromCard(id, patch) {
    if (!G) return;
    var preset = G.findPreset(_presets, id);
    if (!preset) return;
    var res = G.upsertPreset(_presets, Object.assign({}, preset, patch || {}));
    if (!res.ok) {
      _copyNote = (res.errors && res.errors[0]) || 'Could not update that group.';
      announce(_copyNote);
      return;
    }
    _presets = res.presets;
    persistPresets();
    render();
  }

  function bindAllGroupsPanel(root) {
    var panel = root.querySelector('#ms-ags-all-panel');
    if (!panel) return;
    var close = panel.querySelector('#ms-ags-all-close');
    if (close)
      close.addEventListener('click', function () {
        _showAllGroups = false;
        render();
      });
    panel.addEventListener('click', function (e) {
      var pick = e.target.closest && e.target.closest('[data-ags-pick]');
      if (pick) {
        e.preventDefault();
        setDestSet({ kind: 'group', id: pick.getAttribute('data-ags-pick') || '' });
        _showAllGroups = false;
        render();
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
        var id = del.getAttribute('data-ags-delete') || '';
        var preset = G && G.findPreset(_presets, id);
        if (!window.confirm('Delete group' + (preset && preset.name ? ' ' + preset.name : '') + '?')) return;
        if (!G) return;
        _presets = G.removePreset(_presets, id).presets;
        if (_destSet && _destSet.kind === 'group' && _destSet.id === id) setDestSet({ kind: 'in-today' });
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

  function inTodayShareDests(exceptKey) {
    return splitDestinations().filter(function (d) {
      if (!d || !d.key || d.key === exceptKey) return false;
      if (d.kind === 'team' || String(d.key).indexOf('team:') === 0) return false;
      var pres = C.presenceForName({
        name: d.name,
        dateISO: workDate(),
        book: _book,
        absences: _absences,
        staffList: _rota.staff,
        leaveList: _rota.leave,
      });
      if (pres.state === 'away' || pres.state === 'away-pending') return false;
      return true;
    });
  }

  function applyShareOut(fromKey) {
    var board = currentWorkspace();
    var col = null;
    (board.clinicians || []).concat(board.teams || []).forEach(function (c) {
      if (c && c.key === fromKey) col = c;
    });
    var tiles = (col && col.tiles) || [];
    var dests = inTodayShareDests(fromKey);
    var plan = C.planEvenSplit(tiles, dests, { anyTile: true, dayPhrase: dayPhrase() });
    if (!plan.ok) return plan;
    _draft = C.applyEvenSplit(_draft || C.emptyDraft(), plan);
    _selected = {};
    plan.fromName = C.displayClinicianName((col && col.title) || '');
    return plan;
  }

  function folderHtml(col, opts) {
    opts = opts || {};
    var inbox = !!opts.inbox;
    var abs = inbox ? { state: 'n/a', label: '' } : presenceForClinician(col);
    var away = abs.state === 'away' || abs.state === 'away-pending';
    var clear = inbox && !(col.tiles && col.tiles.length);
    var name = inbox ? 'Unallocated' : C.displayClinicianName(col.title);
    var flag = inbox ? '' : destFlagHtml(col, abs);
    var meta = inbox ? (clear ? 'Clear' : col.count + ' in this box') : fieldCounts(col);
    if (!inbox && away && abs.label) meta = abs.label + (meta ? ' · ' + meta : '');
    var shareDests = inbox ? [] : inTodayShareDests(col.key);
    var nTiles = (col.tiles || []).length;
    var canShare = !inbox && nTiles && shareDests.length;
    var loud = !!(!inbox && away && nTiles);
    if (!inbox && nTiles && !shareDests.length) {
      meta = (meta ? meta + ' · ' : '') + 'No doctors working today to share onto';
    }
    var shareTitle = canShare
      ? 'Share only ' + name + '’s box equally among ' + C.destNamesPhrase(shareDests) + ' - not the unallocated pile'
      : !inbox && nTiles
        ? 'No doctors working today to share onto. Pick another working day.'
        : '';
    var shareBtn = '';
    if (!inbox && nTiles) {
      shareBtn =
        '<button type="button" class="ms-rxac-share ms-rxac-folder-action' +
        (loud ? ' ms-rxac-share-away' : ' ms-rxac-share-quiet') +
        (canShare ? '' : ' ms-rxac-share-off') +
        '"' +
        (canShare ? ' data-share-key="' + esc(col.key) + '"' : ' disabled') +
        ' title="' +
        esc(shareTitle) +
        '" aria-label="' +
        esc(shareTitle) +
        '">Share this box</button>';
    }
    var proposedN = 0;
    var sittingN = 0;
    (col.tiles || []).forEach(function (t) {
      if (!t) return;
      if (t.staged) proposedN += 1;
      else sittingN += 1;
    });
    var countHtml =
      !inbox && proposedN
        ? '<span class="ms-rxac-folder-count ms-rxac-count-proposed">' +
          '<span class="ms-rxac-count-pop">' +
          proposedN +
          '</span>' +
          '<span class="ms-rxac-count-label">proposed</span>' +
          (sittingN ? '<span class="ms-rxac-count-sit">' + sittingN + ' sitting</span>' : '') +
          '</span>'
        : '<span class="ms-rxac-folder-count">' + esc(String(col.count || 0)) + '</span>';
    var body = (col.tiles || [])
      .map(function (t) {
        return tileHtml(t, { showWho: true, showAssignee: false });
      })
      .join('');
    if (!body) {
      body =
        '<div class="ms-lac-empty-sm">' +
        (inbox
          ? clear
            ? 'This box is clear.'
            : 'Empty — those patients are proposed onto the boxes. Nothing is written yet.'
          : 'Nothing in this box yet. Drag a patient here.') +
        '</div>';
    }
    var destOn = false;
    var personId = '';
    if (!inbox && col.kind !== 'team') {
      currentDestinations().forEach(function (d) {
        if (d && d.key === col.key) {
          destOn = true;
          if (d.staffId) personId = d.staffId;
        }
      });
      if (!personId && _draft && _draft.columnStaffIds) personId = _draft.columnStaffIds[col.key] || '';
    }
    return (
      '<div class="ms-rxac-folder' +
      (inbox ? ' ms-rxac-folder-inbox' : '') +
      (clear ? ' ms-rxac-folder-clear' : '') +
      (away ? ' ms-rxac-folder-away' : '') +
      (proposedN ? ' ms-rxac-folder-proposed' : '') +
      (destOn ? ' ms-ags-field-on' : '') +
      '" data-col-key="' +
      esc(col.key) +
      '" data-col-kind="' +
      esc(inbox ? 'pool' : col.kind || 'clinician') +
      '"' +
      (personId ? ' data-ags-person="' + esc(personId) + '"' : '') +
      '>' +
      '<div class="ms-rxac-folder-head" tabindex="-1">' +
      '<div class="ms-rxac-folder-title">' +
      '<span class="ms-rxac-folder-name"' +
      (inbox || col.kind === 'team' ? '' : ' draggable="true"') +
      '>' +
      esc(name) +
      '</span>' +
      '</div>' +
      countHtml +
      '<div class="ms-rxac-folder-meta">' +
      flag +
      (meta ? '<span class="ms-rxac-folder-meta-text">' + esc(meta) + '</span>' : '') +
      '</div>' +
      shareBtn +
      '</div>' +
      '<div class="ms-rxac-folder-body" role="listbox" aria-label="' +
      esc(name) +
      '">' +
      body +
      '</div></div>'
    );
  }

  function boardHtml() {
    var board = currentWorkspace();
    var pool = board.pool;
    var clinicians = sortClinicianFields(board.clinicians);
    var teams = board.teams || [];
    var inboxEmpty = !(pool.tiles && pool.tiles.length);
    var inboxFolder = folderHtml(pool, { inbox: true });
    var destCols = clinicians.concat(teams);
    if (inboxEmpty) {
      destCols = destCols.filter(function (col) {
        if (!col || col.kind !== 'team') return true;
        return !!(col.tiles && col.tiles.length);
      });
    }
    var docFolders = destCols
      .map(function (col) {
        return folderHtml(col, {});
      })
      .join('');
    var teamOpts = addableTeams()
      .map(function (t) {
        return '<option value="' + esc(t.id) + '" data-name="' + esc(t.name) + '">' + esc(t.name) + '</option>';
      })
      .join('');
    var addRow =
      '<div class="ms-lac-add-row">' +
      '<input type="text" id="ms-lac-add-name" maxlength="80" placeholder="Add a doctor - e.g. Dr Jane Cole" aria-label="Add a doctor" title="Add a named doctor as a destination, even if they have no session on the book.">' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-add-btn" title="Add that doctor as a destination for split, top-up, and distribute.">Add doctor</button>' +
      '</div>';
    if (inboxEmpty) {
      return (
        evenSplitHtml() +
        '<div class="ms-rxac-board ms-rxac-board-clear" id="ms-rxac-folders">' +
        inboxFolder +
        '<div class="ms-rxac-folders">' +
        docFolders +
        '</div>' +
        addRow +
        '</div>'
      );
    }
    return (
      evenSplitHtml() +
      '<div class="ms-rxac-board" id="ms-rxac-folders">' +
      '<div class="ms-rxac-main">' +
      inboxFolder +
      '</div>' +
      '<aside class="ms-rxac-rail" aria-label="Doctors working ' +
      esc(dayPhrase()) +
      '">' +
      docFolders +
      addRow +
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
      ' - click a clinician field to stage them, or drag. Ctrl-click another heading or task to add it</span>' +
      '<button type="button" class="ms-lac-ghost" id="ms-lac-sel-clear">Clear selection</button>' +
      '</div>'
    );
  }

  function refusedPatientNote(plan) {
    var phrase = C.refusedPatientsPhrase ? C.refusedPatientsPhrase(plan, _rows) : '';
    if (!phrase) return '';
    return '<p class="ms-lac-confirmbar-note">' + esc(phrase) + '</p>';
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
        '<strong>Writing to Medicus…</strong> The board is frozen until this finishes. Check the queue afterwards - this canvas is a working copy.' +
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
        ' exist only on this canvas - closing forgets them. The Medicus queue itself is untouched either way.' +
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
      var refusedNote = refusedPatientNote(_confirmWrite);
      var writeGate = C.canWriteRequestAllocations({
        taskList: _taskList,
        slug: _route && _route.slug,
        count: (_confirmWrite.items || []).length,
      });
      var gated = C.requestGatedWriteCopy
        ? C.requestGatedWriteCopy({ count: (_confirmWrite.items || []).length })
        : {
            reviewHeadline: 'This is a plan on this canvas only. Medicus has not changed.',
            reviewBody:
              'To move these today, assign them in Medicus. Writing from this canvas is switched off for this queue until it has been checked on a test patient.',
            writeButton: '',
            hideWrite: true,
          };
      var writeGo = writeGate.ok
        ? '<button type="button" class="ms-lac-confirm-btn ms-lac-primary ms-rxac-review-go" id="ms-lac-write-go" title="Writes these reassignments to Medicus. Does not complete, file, or reply to the request.">Write to Medicus</button>'
        : '';
      var confirmLead = writeGate.ok
        ? '<strong>This is the write.</strong> Medicus will reassign these requests. This changes who the task sits with - it does not complete, file, or reply to the request.'
        : '<div class="ms-rxac-review-title">' +
          esc(writeGate.reviewHeadline || gated.reviewHeadline) +
          '</div>' +
          esc(writeGate.reviewBody || gated.reviewBody);
      return (
        '<div class="ms-lac-confirmbar ms-lac-confirmbar-warn ms-rxac-review-open" role="region" aria-label="Review this proposal">' +
        '<div class="ms-rxac-review-copy">' +
        '<div class="ms-rxac-review-title">' +
        (writeGate.ok ? 'Confirm write to Medicus' : '') +
        '</div>' +
        confirmLead +
        (writeGate.ok ? '' : '') +
        '<ul class="ms-lac-writelist">' +
        lines +
        '</ul>' +
        refusedNote +
        '</div>' +
        '<div class="ms-lac-confirmbar-actions">' +
        '<button type="button" class="ms-lac-ghost" id="ms-lac-write-keep">Keep planning</button>' +
        writeGo +
        '</div></div>'
      );
    }
    var sum = C.draftSummary(_rows, _draft);
    var gate = C.canWriteRequestAllocations({ taskList: _taskList, slug: _route && _route.slug });
    var plan = sum.count
      ? C.planBulkReassign(_rows, _draft, _taskList, _staffDir, _route && _route.slug, _teamDir)
      : null;
    var canOpenReview = !!(plan && plan.ok && plan.batches && plan.batches.length);
    var canWrite = !!(gate.ok && canOpenReview);
    var captureClosed = !!(sum.count && !gate.ok);
    var blockReason = '';
    if (sum.count && !canOpenReview) {
      blockReason = C.writeBlockReason(plan);
    } else if (sum.count && !canWrite && !captureClosed) {
      blockReason = !gate.ok ? gate.reason : C.writeBlockReason(plan);
    }
    var writeTitle = canOpenReview
      ? 'Opens the patient → destination list. Nothing is written until you confirm.'
      : blockReason;
    var gatedCopy = C.requestGatedWriteCopy ? C.requestGatedWriteCopy({ count: sum.count }) : null;
    var writeLabel = gate.ok
      ? 'Review then write ' + sum.count + '…'
      : (gatedCopy && gatedCopy.reviewButton) || (sum.count ? 'Review plan (' + sum.count + ')' : 'Review plan');
    var status = captureClosed
      ? '<div class="ms-rxac-review-title">' +
        esc((gatedCopy && gatedCopy.reviewHeadline) || 'This is a plan on this canvas only. Medicus has not changed.') +
        '</div>' +
        esc((gatedCopy && gatedCopy.reviewBody) || gate.copy || C.REQUEST_WRITE_CAPTURE_COPY || '') +
        ' Drag a patient from one person onto another to change who gets them.'
      : blockReason
        ? '<strong>Cannot move these yet.</strong> ' + esc(blockReason)
        : sum.count
          ? '<div class="ms-rxac-review-title">Proposal, not written yet</div><strong>' +
            sum.count +
            ' would sit with the people above.</strong> Drag a patient from one person onto another to change who gets them. Review then write starts the write - you still confirm on the next step.'
          : 'Drag a patient into a doctor’s box. Medicus does not change until you confirm.';
    return (
      '<div class="ms-lac-confirmbar' +
      (blockReason ? ' ms-lac-confirmbar-warn' : '') +
      (sum.count && !blockReason ? ' ms-rxac-review-dock' : '') +
      '">' +
      '<div class="ms-rxac-review-copy">' +
      '<span class="ms-lac-confirmbar-note">' +
      status +
      '</span>' +
      (_copyNote ? ' <span class="ms-lac-hint">' + esc(_copyNote) + '</span>' : '') +
      '</div>' +
      '<div class="ms-lac-confirmbar-actions">' +
      (sum.count
        ? '<button type="button" class="ms-lac-ghost" id="ms-lac-clear" title="Forget this proposal. Nothing has been written to Medicus.">Clear proposals</button>'
        : '') +
      (canOpenReview
        ? '<button type="button" class="ms-lac-confirm-btn ms-lac-primary ms-rxac-review-go" id="ms-lac-finalise" title="' +
          esc(writeTitle) +
          '">' +
          esc(writeLabel) +
          '</button>'
        : '') +
      '</div></div>'
    );
  }

  function shellHtml() {
    var board = currentWorkspace();
    var stagedN = C.draftSummary(_rows, _draft).count;
    var destN = splitDestinations().length;
    var poolN = visibleUnallocatedCount();
    var counts =
      poolN +
      ' unallocated' +
      (stagedN ? ' · ' + stagedN + ' proposed' : '') +
      (destN ? ' · to ' + destN + ' destination' + (destN === 1 ? '' : 's') : '');
    return (
      '<div class="ms-lac-panel' +
      (_writing ? ' ms-lac-panel-writing' : '') +
      (stagedN ? ' ms-rxac-proposing' : '') +
      (_confirmWrite ? ' ms-rxac-reviewing' : '') +
      '" role="dialog" aria-modal="true" aria-labelledby="ms-lac-title">' +
      '<div class="ms-lac-header">' +
      '<h2 class="ms-lac-title" id="ms-lac-title">Allocate ' +
      esc(queueTitle().toLowerCase()) +
      '</h2>' +
      '<span class="ms-lac-header-counts">' +
      esc(counts) +
      '</span>' +
      '<span class="ms-lac-header-note" title="Unallocated is the pile still sitting in this inbox. Split equally / Top up propose moves among the named destinations. Drag a patient onto another folder to change one. Nothing is written until you confirm.">Unallocated is the pile. Split equally, or drag a patient onto a doctor. Share this box splits only that doctor’s requests among the current destinations.</span>' +
      '<span class="ms-lac-hint" id="ms-lac-progress">' +
      esc(_overviewProgress) +
      '</span>' +
      '<button type="button" class="ms-lac-close" id="ms-lac-close" title="Close this canvas. Staged proposals that have not been written are forgotten.">Close</button>' +
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
    var shareKey = el.getAttribute('data-share-key');
    if (shareKey) {
      return '.ms-rxac-folder[data-col-key="' + shareKey + '"] .ms-rxac-folder-head';
    }
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

  function commitSaveGroup() {
    if (!G) return;
    var input = document.getElementById('ms-ags-save-name');
    var name = input && input.value ? String(input.value).trim() : '';
    var members = currentDestinations()
      .filter(function (d) {
        return d && d.staffId;
      })
      .map(function (d) {
        return { id: d.staffId, name: d.name };
      });
    var res = G.upsertPreset(_presets, { name: name, members: members });
    if (!res.ok) {
      _copyNote = (res.errors && res.errors[0]) || 'Could not save that group.';
      announce(_copyNote);
      render();
      return;
    }
    _presets = res.presets;
    _namingGroup = false;
    setDestSet({ kind: 'group', id: res.preset.id });
    persistPresets();
    _copyNote = 'Saved group ' + res.preset.name + '.';
    announce(_copyNote);
    render();
  }

  function bindPersonDrag(root) {
    root.querySelectorAll('.ms-rxac-folder-name[draggable="true"]').forEach(function (el) {
      el.addEventListener('dragstart', function (e) {
        var person = personFromFolder(el);
        if (!person || !person.staffId) {
          e.preventDefault();
          return;
        }
        _personDrag = person;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/plain', 'people:' + (person.staffId || person.name));
        }
        e.stopPropagation();
      });
      el.addEventListener('dragend', function () {
        /* Keep _personDrag until drop reads it — dragend can fire first. */
      });
    });
  }

  function marqueeBox() {
    if (!_marquee || !_marquee.active) return null;
    var x1 = Math.min(_marquee.x0, _marquee.x);
    var y1 = Math.min(_marquee.y0, _marquee.y);
    var x2 = Math.max(_marquee.x0, _marquee.x);
    var y2 = Math.max(_marquee.y0, _marquee.y);
    return { left: x1, top: y1, right: x2, bottom: y2, width: x2 - x1, height: y2 - y1 };
  }

  function paintMarquee() {
    var el = document.getElementById(OVERLAY_ID);
    if (!el) return;
    var node = el.querySelector('.ms-ags-marquee');
    var box = marqueeBox();
    if (!box || box.width < 4 || box.height < 4) {
      if (node) node.style.display = 'none';
      return;
    }
    if (!node) {
      node = document.createElement('div');
      node.className = 'ms-ags-marquee';
      el.appendChild(node);
    }
    var overlay = el.getBoundingClientRect();
    node.style.display = 'block';
    node.style.left = box.left - overlay.left + 'px';
    node.style.top = box.top - overlay.top + 'px';
    node.style.width = box.width + 'px';
    node.style.height = box.height + 'px';
  }

  function finishMarquee() {
    if (!_marquee || !_marquee.active) return;
    var people = [];
    var box = marqueeBox();
    var overlay = document.getElementById(OVERLAY_ID);
    if (box && overlay && box.width >= 8 && box.height >= 8) {
      overlay
        .querySelectorAll('.ms-rxac-folder[data-col-kind="clinician"] .ms-rxac-folder-head')
        .forEach(function (head) {
          var r = head.getBoundingClientRect();
          var hit = !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
          if (!hit) return;
          var person = personFromFolder(head);
          if (person) people.push(person);
        });
    }
    _marquee = null;
    paintMarquee();
    if (!people.length) return;
    if (addPeopleToCustom(people)) {
      _copyNote = 'New group of ' + people.length + ' - save as group to keep it, or Split equally to propose.';
      announce(_copyNote);
    }
    render();
  }

  function marqueeHost(target) {
    if (!target || !target.closest) return null;
    return target.closest('.ms-rxac-rail, .ms-rxac-folders');
  }

  function marqueeBlocked(target) {
    if (!target || !target.closest) return true;
    return !!target.closest(
      '.ms-lac-tile, button, input, select, textarea, a, .ms-rxac-folder-head, .ms-ags-chip, .ms-ags-well, .ms-ags-all, .ms-rxac-share, .ms-rxac-folder-inbox, .ms-lac-group-head'
    );
  }

  function bindMarquee(root) {
    var board = root.querySelector('.ms-rxac-board');
    if (!board) return;
    board.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (!marqueeHost(e.target) || marqueeBlocked(e.target)) return;
      _marquee = { active: true, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      paintMarquee();
    });
  }

  function addNamedColumn() {
    var input = document.getElementById('ms-lac-add-name');
    var name = input && input.value;
    if (!name || !String(name).trim()) return;
    var trimmed = String(name).trim();
    var teamId = teamIdForName(trimmed);
    if (teamId && C.isTeamAssignee(trimmed) && !C.isRequestInboxName(trimmed)) {
      _draft = C.addTeamColumn(_draft, trimmed, teamId);
      announce('Added team ' + trimmed);
    } else {
      _draft = C.addColumn(_draft, trimmed);
      announce('Added clinician field ' + trimmed);
    }
    if (input) input.value = '';
    render();
  }

  function addTeamFromPicker() {
    var sel = document.getElementById('ms-rxac-add-team');
    if (!sel || !sel.value) return;
    var opt = sel.options[sel.selectedIndex];
    var name = (opt && opt.getAttribute('data-name')) || opt.text || '';
    if (!name) return;
    _draft = C.addTeamColumn(_draft, name, sel.value);
    announce('Added team ' + name);
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
    var dayInput = root.querySelector('#ms-qac-day');
    if (dayInput)
      dayInput.addEventListener('change', function () {
        setWorkDate(dayInput.value);
      });
    var dayToday = root.querySelector('#ms-qac-day-today');
    if (dayToday)
      dayToday.addEventListener('click', function () {
        setWorkDate(calendarToday());
      });
    var dayTomorrow = root.querySelector('#ms-qac-day-tomorrow');
    if (dayTomorrow)
      dayTomorrow.addEventListener('click', function () {
        setWorkDate(C.addDaysISO(calendarToday(), 1));
      });
    function bindPileAction(id, applyFn, okNote) {
      var btn = root.querySelector(id);
      if (!btn) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (_writing) return;
        Promise.resolve(ensureDestStaffResolved()).then(function () {
          var applied = applyFn();
          _selected = {};
          _confirmWrite = null;
          _copyNote = applied && applied.ok ? okNote(applied) : (applied && applied.reason) || 'Could not split.';
          announce(_copyNote);
          render();
        });
      });
    }
    bindPileAction('#ms-ags-split', applyPileSplit, function (applied) {
      return (
        'Split ' +
        applied.total +
        ' equally onto ' +
        applied.doctors +
        ' doctors working ' +
        dayPhrase() +
        '. Proposal - not written yet. Drag a patient onto another doctor to change who gets them.'
      );
    });
    bindPileAction('#ms-ags-topup', applyTopUp, function (applied) {
      return (
        'Topped up empty boxes with ' +
        applied.total +
        ' among doctors working ' +
        dayPhrase() +
        '. Proposal - not written yet. Drag a patient onto another doctor to change who gets them.'
      );
    });
    bindPileAction('#ms-ags-level', applyLevel, function (applied) {
      return (
        'Distributed ' +
        applied.total +
        ' equally among ' +
        applied.doctors +
        ' doctors working ' +
        dayPhrase() +
        '. Proposal - not written yet. Drag a patient onto another doctor to change who gets them.'
      );
    });
    var inTodayBtn = root.querySelector('#ms-ags-in-today');
    if (inTodayBtn)
      inTodayBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setDestSet({ kind: 'in-today' });
        announce('Share out to people working ' + dayPhrase() + '.');
        render();
      });
    root.querySelectorAll('[data-ags-group]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-ags-group') || '';
        if (!id) return;
        setDestSet({ kind: 'group', id: id });
        _showAllGroups = false;
        announce('Share out to that group.');
        render();
      });
    });
    var allBtn = root.querySelector('#ms-ags-all');
    if (allBtn)
      allBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _showAllGroups = !_showAllGroups;
        render();
      });
    bindAllGroupsPanel(root);
    var saveBtn = root.querySelector('#ms-ags-save');
    if (saveBtn)
      saveBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _namingGroup = true;
        render();
        var input = document.getElementById('ms-ags-save-name');
        if (input) input.focus();
      });
    var saveGo = root.querySelector('#ms-ags-save-go');
    if (saveGo)
      saveGo.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        commitSaveGroup();
      });
    var saveCancel = root.querySelector('#ms-ags-save-cancel');
    if (saveCancel)
      saveCancel.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _namingGroup = false;
        render();
      });
    var saveName = root.querySelector('#ms-ags-save-name');
    if (saveName)
      saveName.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitSaveGroup();
        }
      });
    var newGroup = root.querySelector('#ms-ags-new-group');
    if (newGroup) {
      newGroup.addEventListener('dragover', function (e) {
        if (!_personDrag) return;
        e.preventDefault();
        e.stopPropagation();
        newGroup.classList.add('ms-ags-well-on');
      });
      newGroup.addEventListener('dragleave', function () {
        newGroup.classList.remove('ms-ags-well-on');
      });
      newGroup.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        newGroup.classList.remove('ms-ags-well-on');
        var payload = e.dataTransfer ? String(e.dataTransfer.getData('text/plain') || '') : '';
        var person = personFromPeoplePayload(payload);
        _personDrag = null;
        if (!person) return;
        if (addPeopleToCustom([person])) {
          _copyNote = 'Added ' + C.displayClinicianName(person.name) + ' to a new group. Save as group to keep it.';
          announce(_copyNote);
        }
        render();
      });
      newGroup.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        setDestSet({ kind: 'custom', members: [] });
        _copyNote = "Drag a person's name onto New group, or draw a box around names on the board, then Save as group.";
        announce(_copyNote);
        render();
      });
    }
    bindPersonDrag(root);
    bindMarquee(root);
    root.querySelectorAll('.ms-rxac-share').forEach(function (btn) {
      ['dragover', 'drop'].forEach(function (ev) {
        btn.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
        });
      });
    });
    root.querySelectorAll('[data-share-key]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (_writing) return;
        var applied = applyShareOut(btn.getAttribute('data-share-key') || '');
        _confirmWrite = null;
        _copyNote =
          applied && applied.ok
            ? 'Shared ' +
              (applied.fromName ? applied.fromName + '’s box - ' : '') +
              applied.total +
              ' equally among ' +
              applied.doctors +
              ' doctors in today. Proposal - not written yet.'
            : (applied && applied.reason) || 'Could not share that box out.';
        announce(_copyNote);
        render();
      });
    });
    var addBtn = root.querySelector('#ms-lac-add-btn');
    if (addBtn) addBtn.addEventListener('click', addNamedColumn);
    var addTeamBtn = root.querySelector('#ms-rxac-add-team-btn');
    if (addTeamBtn) addTeamBtn.addEventListener('click', addTeamFromPicker);
    var addTeamSel = root.querySelector('#ms-rxac-add-team');
    if (addTeamSel)
      addTeamSel.addEventListener('change', function () {
        if (addTeamSel.value) addTeamFromPicker();
      });
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
        _draft = C.ensureWorkingTodayColumns(C.emptyDraft(), currentDestinations());
        _splitDefaulted = false;
        _openDests = {};
        _expandedChip = '';
        _copyNote = '';
        _pendingAbsence = null;
        announce('Proposals cleared. Doctor boxes show what already sits with them. The queue itself is unchanged.');
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
      var folder = from && from.closest && from.closest('.ms-rxac-folder');
      _dragOriginKind =
        (folder && folder.getAttribute('data-col-kind')) ||
        (from && from.closest && from.closest('.ms-lac-pool')
          ? 'pool'
          : wrap
            ? wrap.getAttribute('data-col-kind') || 'clinician'
            : '');
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
        var payload = e.dataTransfer ? String(e.dataTransfer.getData('text/plain') || '') : '';
        if (_personDrag || payload.indexOf('people:') === 0) {
          var person = personFromPeoplePayload(payload);
          _personDrag = null;
          endDrag();
          var kind = el.getAttribute('data-col-kind') || '';
          if (person && kind !== 'pool' && kind !== 'team') addPeopleToCustom([person]);
          render();
          return;
        }
        var key = el.getAttribute('data-col-key');
        var ids = _dragIds && _dragIds.length ? _dragIds : [];
        if (!ids.length && payload && payload.indexOf('people:') !== 0) {
          ids = payload.split(',').filter(Boolean);
        }
        endDrag();
        if (!key || !ids.length) return;
        if (ids[0] && String(ids[0]).indexOf('people:') === 0) return;
        requestStage(ids, key, el);
      });
    }
    root.querySelectorAll('.ms-lac-col, .ms-lac-chip-wrap, .ms-rxac-folder').forEach(bindDropTarget);
    root.querySelectorAll('.ms-lac-chip').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleFieldOpen(btn.getAttribute('data-chip-key') || '');
        render();
      });
    });
    root.querySelectorAll('[data-stage-key]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var key = btn.getAttribute('data-stage-key') || '';
        var ids = selectedIds();
        if (key && ids.length) requestStage(ids, key, btn.closest('.ms-lac-chip-wrap'));
      });
    });
    root.querySelectorAll('.ms-lac-field-expand').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleFieldOpen(btn.getAttribute('data-expand-key') || '');
        render();
      });
    });
  }

  function requestStage(ids, key, colEl) {
    if (_writing) return;
    var known = {};
    _rows.forEach(function (r) {
      if (r && r.id) known[r.id] = true;
    });
    ids = (ids || []).filter(function (id) {
      return known[id];
    });
    if (!ids.length) return;
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
    if (key && (key.indexOf('clinician:') === 0 || key.indexOf('team:') === 0)) {
      _expandedChip = key;
      _openDests[key] = true;
    }
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
        : 'Could not copy - select the list from a text dump if you need it.';
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
    var gate = C.canWriteRequestAllocations({ taskList: _taskList, slug: _route && _route.slug });
    announce(
      gate.ok
        ? 'Review the list, then confirm. Medicus will reassign those tasks.'
        : gate.copy || C.REQUEST_WRITE_CAPTURE_COPY || 'Review the list. Nothing will be written.'
    );
    render();
  }

  async function commitWrite() {
    if (_writing || !_confirmWrite) return;
    var gate = C.canWriteRequestAllocations({ taskList: _taskList, slug: _route && _route.slug });
    if (!gate.ok) {
      _confirmWrite = null;
      _error = (gate && gate.reason) || 'Write not captured for this queue yet.';
      announce(_error);
      render();
      return;
    }
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
          return C.fetchRequestMergedTaskList(_route.apiBase, _route.slug, _route.search, {
            requireSitting: true,
          });
        },
      });
      if (!result || !result.ok) {
        var failReason =
          (result && result.reason) || 'Medicus did not accept the reassignment. Nothing further was written.';
        _confirmWrite = null;
        announce(failReason);
        // A batch that stopped part-way DID write the earlier groups. The
        // board is stale the moment that happens: those rows still show as
        // staged, so the count says work is pending that Medicus already
        // took. Re-read before telling the clinician to check the queue -
        // loadBoard() clears _error, so restore the message after it.
        if (result && result.written > 0) {
          await loadBoard({ skipSplit: true });
          _error = failReason;
          _writing = false;
          render();
          return;
        }
        _error = failReason;
        _writing = false;
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
          ? '. ' +
            leftover +
            ' destination' +
            (leftover === 1 ? '' : 's') +
            ' had no unique staff id and stayed unallocated'
          : '') +
        '. The open list is the same queue with new assignees - reload Medicus if the grid still shows the old number.';
      announce(_copyNote);
      await loadBoard({ skipSplit: true });
      _writing = false;
      render();
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
    _openDests = {};
    _confirmClose = false;
    _confirmWrite = null;
    _writing = false;
    _taskList = undefined;
    _staffDir = C.harvestStaffDirectory([], null);
    _teamDir = C.harvestTeamDirectory([], null);
    _collapsed = {};
    _workDate = '';
    _splitDefaulted = false;
    _destSet = { kind: 'in-today' };
    _destSetReady = false;
    _showAllGroups = false;
    _namingGroup = false;
    _scheduleAutoPick = false;
    _personDrag = null;
    _marquee = null;
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
    _openDests = {};
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
    _destSet = { kind: 'in-today' };
    _destSetReady = false;
    _showAllGroups = false;
    _namingGroup = false;
    _scheduleAutoPick = false;
    _personDrag = null;
    _marquee = null;
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
    var launchLabel = 'Plan a share-out of this inbox…';
    var launchTitle = 'Opens a planning board. Nothing is written to Medicus until Write is enabled and you confirm.';
    if (!launch) {
      launch = document.createElement('button');
      launch.type = 'button';
      launch.id = LAUNCH_ID;
      launch.textContent = launchLabel;
      launch.title = launchTitle;
      launch.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openOverlay();
      });
      document.documentElement.appendChild(launch);
    } else {
      launch.textContent = launchLabel;
      launch.title = launchTitle;
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
    'mousemove',
    function (e) {
      if (!_marquee || !_marquee.active || !_open) return;
      _marquee.x = e.clientX;
      _marquee.y = e.clientY;
      paintMarquee();
    },
    true
  );

  document.addEventListener(
    'mouseup',
    function () {
      if (!_marquee || !_marquee.active) return;
      finishMarquee();
    },
    true
  );

  document.addEventListener(
    'keydown',
    function (e) {
      if (e.key === 'Escape' && _open) {
        e.stopPropagation();
        if (_writing) return;
        if (_marquee && _marquee.active) {
          _marquee = null;
          paintMarquee();
          return;
        }
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
