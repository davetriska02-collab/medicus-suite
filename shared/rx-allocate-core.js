// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — non-routine prescription-request allocation core.
//
// Sibling of lab-allocate-core / workflow-allocate-core. Same stage →
// confirm → bulk-reassign write (W23 via LabAllocateCore.createClient) on
// the non-routine prescription-request task-list. Named GP is a grouping
// caption, never auto-placement. Even-split among doctors with a session
// on today’s appointment book is local staging only — it does not write.
// This file does not POST — the lab client owns the write.
//
// Dual-mode: module.exports for Node tests, window.RxAllocateCore in the
// content-script canvas. Pure: no DOM, no chrome.*, no fetch.

'use strict';

(function (global) {
  function loadLab() {
    if (typeof require === 'function') {
      try {
        return require('./lab-allocate-core.js');
      } catch (_) {
        /* browser path below */
      }
    }
    if (global && global.LabAllocateCore) return global.LabAllocateCore;
    throw new Error('RxAllocateCore needs LabAllocateCore');
  }

  var Lab = loadLab();
  var UNKNOWN_GROUP = 'unknown';
  var NON_ROUTINE_SLUG_RE = /non[_\-]?routine/i;
  var PRESCRIPTION_SLUG_RE = /prescription/i;
  var EXCLUDE_SLUG_RE = /eps|cancellation|privacy|officer/i;
  var ROUTINE_ONLY_SLUG_RE = /prescription_request_task_routine|prescription-request-task-routine/i;
  var NOT_A_DOCTOR_RE =
    /\b(nurse|nursing|hca|phlebotom|reception|secretar|dispenser|pharmacist|paramedic|hcs\s?w|healthcare assistant|health care assistant)\b/i;
  var DOCTOR_HINT_RE = /\b(dr|doctor|gp|partner|locum|salaried|registrar|consultant|gpst)\b/i;

  function isRoutineRxQueueSlug(slug) {
    return ROUTINE_ONLY_SLUG_RE.test(String(slug || ''));
  }

  function isNonRoutineRxQueueSlug(slug) {
    var s = String(slug || '');
    if (!s) return false;
    if (Lab.isResultsQueueSlug(s)) return false;
    if (EXCLUDE_SLUG_RE.test(s)) return false;
    if (!PRESCRIPTION_SLUG_RE.test(s)) return false;
    if (NON_ROUTINE_SLUG_RE.test(s)) return true;
    return false;
  }

  function isRxQueueSlug(slug) {
    return isNonRoutineRxQueueSlug(slug) || isRoutineRxQueueSlug(slug);
  }

  // The live routine inbox is
  //   ?statuses[]=pending-review&viewContext=homepage&masterAssignee=<inbox uuid>
  // That masterAssignee IS the routine box. Lab lists drop it so sitting
  // work is visible; here dropping it hides the inbox and only the
  // already-allocated GP piles remain.
  function queryStringForRxList(search) {
    var raw = String(search == null ? '' : search).trim();
    if (!raw) return '';
    if (raw.charAt(0) === '?') raw = raw.slice(1);
    if (!raw) return '';
    if (/[:/\\]/.test(raw)) return '';
    if (!/^[A-Za-z0-9._~%+\-\[\]=&,]+$/.test(raw)) return '';
    var kept = raw.split('&').filter(Boolean);
    return kept.length ? '?' + kept.join('&') : '';
  }

  function parseRxQueueRoute(pathname, search) {
    var path = String(pathname == null ? '' : pathname);
    var m = path.match(/^\/?([0-9a-z]{2,})\/tasks\/(?:data\/)?([^/]+)\/task-list\/?$/i);
    if (!m) return null;
    var slug = m[2];
    if (!isRxQueueSlug(slug)) return null;
    return {
      siteId: m[1],
      slug: slug,
      search: queryStringForRxList(search),
      apiBase: 'https://' + m[1] + '.api.england.medicus.health',
      kind: 'rx',
      routine: isRoutineRxQueueSlug(slug),
    };
  }

  function isRxInboxName(name) {
    var s = String(name || '').trim();
    if (!s) return true;
    if (/^unassigned$/i.test(s)) return true;
    if (Lab.isTeamAssignee(s)) return true;
    return /prescription/i.test(s) || /non[-\s]?routine/i.test(s) || /^routine$/i.test(s);
  }

  function inboxAssigneeId(search) {
    var qs = queryStringForRxList(search);
    var parts = String(qs || '')
      .replace(/^\?/, '')
      .split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      var k = kv[0] || '';
      try {
        k = decodeURIComponent(k);
      } catch (_) {}
      if (!/^masterAssignee$/i.test(k)) continue;
      var v = kv.slice(1).join('=');
      try {
        v = decodeURIComponent(v);
      } catch (_) {}
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return v;
    }
    return '';
  }

  function isRxUnallocated(row) {
    if (!row || !row.id) return false;
    if (row.rxInboxPile) return true;
    if (isRxInboxName(row.assignedTo)) return true;
    return Lab.homeColumnKey(row) === Lab.POOL;
  }

  function decorateRxRow(row) {
    if (!row) return row;
    var next = Object.assign({}, row);
    next.kind = 'rx';
    return next;
  }

  // Inbox GET (page masterAssignee) is the box to share out. Bare GET of
  // the same slug is everyone already sitting with a GP. Folders need both.
  function mergeInboxAndSitting(inboxRows, sittingRows, search) {
    var inbox = markInboxRows(inboxRows, search);
    var seen = {};
    inbox.forEach(function (r) {
      if (r && r.id) seen[r.id] = true;
    });
    var sitting = [];
    (Array.isArray(sittingRows) ? sittingRows : []).forEach(function (raw) {
      var row = decorateRxRow(raw);
      if (!row || !row.id || seen[row.id]) return;
      if (isRxUnallocated(row)) {
        row.rxInboxPile = true;
        row.rxInboxAssignedTo = row.assignedTo || '';
        row.assignedTo = 'Unassigned';
        inbox.push(row);
        seen[row.id] = true;
        return;
      }
      sitting.push(row);
      seen[row.id] = true;
    });
    return inbox.concat(sitting);
  }

  // The page filter is the box to work. Those rows are assigned to the
  // inbox UUID (often a person-shaped name on assignedTo), which made
  // homeColumnKey treat the whole pile as already sitting with a GP.
  // Stamp them Unassigned so they stay in the unallocated list.
  function markInboxRows(rows, search) {
    var inboxId = inboxAssigneeId(search);
    return (Array.isArray(rows) ? rows : [])
      .map(function (row) {
        var next = decorateRxRow(row);
        if (!next) return next;
        if (!inboxId) return next;
        var assignedId = String(next.assignedId || '').toLowerCase();
        if (assignedId && assignedId !== String(inboxId).toLowerCase()) return next;
        next.rxInboxPile = true;
        next.rxInboxAssignedTo = next.assignedTo || '';
        next.assignedTo = 'Unassigned';
        return next;
      })
      .filter(Boolean);
  }

  function rxGroupName(tile) {
    if (tile && tile.requester) return tile.requester;
    if (tile && tile.namedGp) return tile.namedGp;
    return '';
  }

  function groupTiles(tiles) {
    var map = {};
    var order = [];
    (Array.isArray(tiles) ? tiles : []).forEach(function (tile) {
      if (!tile) return;
      var name = rxGroupName(tile);
      var key = name ? Lab.clinicianColumnKey(name) : UNKNOWN_GROUP;
      if (!map[key]) {
        map[key] = {
          key: key,
          groupName: name,
          requester: name,
          known: key !== UNKNOWN_GROUP,
          tileIds: [],
          tiles: [],
        };
        order.push(key);
      }
      map[key].tileIds.push(tile.id);
      map[key].tiles.push(tile);
      if (name && String(name).length > String(map[key].groupName).length) {
        map[key].groupName = name;
        map[key].requester = name;
      }
    });
    var groups = order.map(function (key) {
      var g = map[key];
      g.count = g.tiles.length;
      return g;
    });
    var merged = [];
    groups.forEach(function (g) {
      if (!g.known) {
        merged.push(g);
        return;
      }
      var hit = -1;
      for (var i = 0; i < merged.length; i++) {
        if (merged[i].known && Lab.sameClusterPerson(merged[i].groupName, g.groupName)) {
          hit = i;
          break;
        }
      }
      if (hit === -1) {
        merged.push(g);
        return;
      }
      merged[hit].tiles = merged[hit].tiles.concat(g.tiles);
      merged[hit].tileIds = merged[hit].tileIds.concat(g.tileIds);
      merged[hit].count = merged[hit].tiles.length;
      if (String(g.groupName || '').length > String(merged[hit].groupName || '').length) {
        merged[hit].groupName = g.groupName;
        merged[hit].requester = g.groupName;
        merged[hit].key = g.key;
      }
    });
    return merged
      .map(function (g) {
        var noun = g.count === 1 ? 'request' : 'requests';
        g.label = g.known
          ? 'Usual GP ' + g.groupName + ' · ' + g.count + ' ' + noun
          : 'No usual GP on the request · ' + g.count + ' ' + noun;
        g.dragHint = g.known
          ? 'Drag this group onto that clinician’s field'
          : 'Cannot auto-group — no registered GP on the request';
        return g;
      })
      .sort(function (a, b) {
        if (a.known !== b.known) return a.known ? -1 : 1;
        return b.count - a.count;
      });
  }

  function poolTitle(opts) {
    if (opts && opts.poolTitle) return opts.poolTitle;
    if (opts && (opts.routine || opts.kind === 'rx-routine')) return 'Routine prescriptions';
    return 'Non-routine prescriptions';
  }

  function buildWorkspace(rows, draft, opts) {
    opts = opts || {};
    var board = Lab.buildWorkspace(rows, draft, opts);
    var aliases = board.aliases;
    if (board.pool) {
      board.pool.title = poolTitle(opts);
      board.pool.groups = groupTiles(board.pool.tiles || []);
      var poolCountByKey = {};
      board.pool.groups.forEach(function (g) {
        if (g.known && g.groupName) {
          g.key = Lab.clinicianKeyForName(g.groupName, aliases);
          poolCountByKey[g.key] = (poolCountByKey[g.key] || 0) + g.count;
        }
      });
      (board.clinicians || []).forEach(function (col) {
        col.inPoolCount = poolCountByKey[col.key] || 0;
        col.groups = groupTiles(col.tiles || []);
      });
      (board.teams || []).forEach(function (col) {
        col.groups = groupTiles(col.tiles || []);
      });
      if (board.columns && board.columns[0] && board.columns[0].kind === 'pool') {
        board.columns[0] = board.pool;
      }
    }
    return board;
  }

  function copyList(board) {
    var lines = [];
    (board && board.columns ? board.columns : []).forEach(function (col) {
      lines.push(col.title + ' (' + col.count + ')');
      (col.tiles || []).forEach(function (t) {
        var hint = t.requester
          ? ' · grouped as ' + t.requester
          : t.namedGp
            ? ' · usual GP ' + t.namedGp
            : '';
        var staged = t.staged ? ' · staged on this canvas only' : '';
        lines.push('  - ' + (t.patientName || 'Unknown') + (t.summary ? ' · ' + t.summary : '') + hint + staged);
      });
      lines.push('');
    });
    lines.push('Not written to Medicus. This is a working list from the allocation canvas.');
    return lines.join('\n').trim();
  }

  function columnTitle(key, rows, titles, aliases, teamList) {
    if (key === 'pool' || key === 'unallocated') {
      if (titles && titles[key]) return titles[key];
      return 'Unallocated';
    }
    return Lab.columnTitle(key, rows, titles, aliases, teamList);
  }

  function isLikelyDoctor(name, service) {
    var blob = String(name || '') + ' ' + String(service || '');
    if (NOT_A_DOCTOR_RE.test(blob)) return false;
    if (DOCTOR_HINT_RE.test(blob)) return true;
    return false;
  }

  function workingTodayDoctors(opts) {
    opts = opts || {};
    var book = opts.book || null;
    var list = book && Array.isArray(book.present) ? book.present : [];
    var seen = {};
    var people = [];
    list.forEach(function (rec) {
      if (!rec || !rec.name) return;
      if (Lab.isTeamAssignee(rec.name)) return;
      var key = rec.key || Lab.clinicianColumnKey(rec.name);
      if (!key || key === Lab.UNALLOCATED || key === Lab.POOL) return;
      if (seen[key]) return;
      var presence = Lab.presenceForName({
        name: rec.name,
        dateISO: opts.dateISO || Lab.todayISO(),
        book: book,
        absences: opts.absences,
        staffList: opts.staffList,
        leaveList: opts.leaveList,
      });
      if (presence.state === 'away' || presence.state === 'away-pending') return;
      if (!(presence.state === 'present' && presence.reason === 'in-today')) return;
      seen[key] = true;
      people.push({
        key: key,
        name: rec.name,
        sessions: rec.sessions || presence.sessions || 0,
        site: rec.site || presence.site || '',
        service: rec.service || '',
        likelyDoctor: isLikelyDoctor(rec.name, rec.service),
        staffId: rec.staffId || '',
      });
    });
    var doctors = people.filter(function (p) {
      return p.likelyDoctor;
    });
    var chosen = doctors.length ? doctors : people;
    chosen.sort(function (a, b) {
      var na = Lab.displayClinicianName(a.name).toLowerCase();
      var nb = Lab.displayClinicianName(b.name).toLowerCase();
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    });
    return chosen;
  }

  function rxSplitOpts(opts) {
    var next = Object.assign({}, opts || {});
    if (!next.anyTile && !next.isUnallocated) next.isUnallocated = isRxUnallocated;
    return next;
  }

  function destNamesPhrase(dests) {
    return Lab.destNamesPhrase(dests);
  }

  function planEvenSplit(tiles, destinations, opts) {
    return Lab.planEvenSplit(tiles, destinations, rxSplitOpts(opts));
  }

  function applyEvenSplit(draft, plan) {
    return Lab.applyEvenSplit(draft, plan);
  }

  function unallocatedNotStaged(rows, draft) {
    var moves = (draft && draft.moves) || {};
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && r.id && isRxUnallocated(r) && !moves[r.id];
    });
  }

  function planTopUp(tiles, destinations, boxCounts, opts) {
    return Lab.planTopUp(tiles, destinations, boxCounts, rxSplitOpts(opts));
  }

  function planLevel(tiles, destinations, opts) {
    return Lab.planLevel(tiles, destinations, rxSplitOpts(opts));
  }

  function ensureWorkingTodayColumns(draft, destinations) {
    return Lab.ensureDestColumns(draft, destinations);
  }

  function replaceDestColumns(draft, destinations) {
    return Lab.replaceDestColumns(draft, destinations);
  }

  function pinDestStaffIds(dests, directory) {
    return Lab.pinDestStaffIds(dests, directory);
  }

  // Live routine inbox (2026-08-31): statuses[]=pending-review, homepage,
  // masterAssignee=<inbox uuid>. That filtered GET is the box on the page.
  // Bare GET returns every open task of the type, including already
  // allocated to GPs. Prefer the page query; fall back to bare GET only
  // if the inbox filter comes back empty.
  async function fetchRxTaskList(apiBase, slug, search, deps) {
    var client = Lab.createClient(apiBase, deps);
    var pageQs = queryStringForRxList(search);
    var filtered = null;
    if (pageQs) {
      filtered = await client.fetchTaskList(slug, pageQs, { keepMasterAssignee: true });
      if (filtered && filtered.rows && filtered.rows.length) return filtered;
    }
    var openPile = await client.fetchTaskList(slug, '');
    if (openPile && openPile.rows && openPile.rows.length) return openPile;
    return filtered || openPile;
  }

  // Write vanish-check needs every staged id, including already-sitting
  // GP work that Distribute equally rebalances. The page-inbox GET is
  // only the pile; the bare GET is sitting work. Same merge as loadBoard.
  async function fetchRxMergedTaskList(apiBase, slug, search, deps) {
    var inbox = await fetchRxTaskList(apiBase, slug, search, deps);
    var sitting = { rows: [], slug: '', taskList: undefined, body: null };
    try {
      sitting = await fetchRxTaskList(apiBase, slug, '', deps);
    } catch (_) {}
    return {
      rows: mergeInboxAndSitting(inbox.rows || [], sitting.rows || [], search),
      slug: inbox.slug || sitting.slug || slug,
      taskList: inbox.taskList || sitting.taskList,
      search: inbox.search || search || '',
      body: inbox.body || sitting.body,
    };
  }

  var api = {
    isNonRoutineRxQueueSlug: isNonRoutineRxQueueSlug,
    isRoutineRxQueueSlug: isRoutineRxQueueSlug,
    isRxQueueSlug: isRxQueueSlug,
    queryStringForRxList: queryStringForRxList,
    parseRxQueueRoute: parseRxQueueRoute,
    decorateRxRow: decorateRxRow,
    markInboxRows: markInboxRows,
    mergeInboxAndSitting: mergeInboxAndSitting,
    inboxAssigneeId: inboxAssigneeId,
    isRxInboxName: isRxInboxName,
    isRxUnallocated: isRxUnallocated,
    rxGroupName: rxGroupName,
    groupTiles: groupTiles,
    buildWorkspace: buildWorkspace,
    buildBoard: buildWorkspace,
    copyList: copyList,
    poolTitle: poolTitle,
    columnTitle: columnTitle,
    isLikelyDoctor: isLikelyDoctor,
    coerceWorkDate: Lab.coerceWorkDate,
    addDaysISO: Lab.addDaysISO,
    workDayPhrase: Lab.workDayPhrase,
    formatLeaveDate: Lab.formatLeaveDate,
    workingTodayDoctors: workingTodayDoctors,
    destNamesPhrase: destNamesPhrase,
    planEvenSplit: planEvenSplit,
    planTopUp: planTopUp,
    planLevel: planLevel,
    unallocatedNotStaged: unallocatedNotStaged,
    applyEvenSplit: applyEvenSplit,
    ensureWorkingTodayColumns: ensureWorkingTodayColumns,
    replaceDestColumns: replaceDestColumns,
    pinDestStaffIds: pinDestStaffIds,
    refusedPatientsPhrase: Lab.refusedPatientsPhrase,
    asSplitDests: Lab.asSplitDests,
    collisionPhrase: Lab.collisionPhrase,
    fetchRxTaskList: fetchRxTaskList,
    fetchRxMergedTaskList: fetchRxMergedTaskList,
    isResultsQueueSlug: Lab.isResultsQueueSlug,
    queryStringForList: Lab.queryStringForList,
    sanitizeSlug: Lab.sanitizeSlug,
    emptyDraft: Lab.emptyDraft,
    addColumn: Lab.addColumn,
    addTeamColumn: Lab.addTeamColumn,
    stageMove: Lab.stageMove,
    stageMoves: Lab.stageMoves,
    unstageIds: Lab.unstageIds,
    draftSummary: Lab.draftSummary,
    homeColumnKey: Lab.homeColumnKey,
    placementReason: Lab.placementReason,
    applyRequester: Lab.applyRequester,
    normaliseTaskRow: Lab.normaliseTaskRow,
    harvestStaffDirectory: Lab.harvestStaffDirectory,
    mergeStaffDirectory: Lab.mergeStaffDirectory,
    harvestTeamDirectory: Lab.harvestTeamDirectory,
    mergeTeamDirectory: Lab.mergeTeamDirectory,
    canWriteAllocations: Lab.canWriteAllocations,
    planBulkReassign: Lab.planBulkReassign,
    writeBlockReason: Lab.writeBlockReason,
    createClient: Lab.createClient,
    pickPatientIdFromPayload: Lab.pickPatientIdFromPayload,
    displayClinicianName: Lab.displayClinicianName,
    teamColumnKey: Lab.teamColumnKey,
    isTeamAssignee: Lab.isTeamAssignee,
    todayISO: Lab.todayISO,
    presenceForName: Lab.presenceForName,
    parseTodayBook: Lab.parseTodayBook,
    selectedIdList: Lab.selectedIdList,
    replaceSelection: Lab.replaceSelection,
    addToSelection: Lab.addToSelection,
    removeFromSelection: Lab.removeFromSelection,
    toggleIdInSelection: Lab.toggleIdInSelection,
    toggleGroupInSelection: Lab.toggleGroupInSelection,
    rangeSelectIds: Lab.rangeSelectIds,
    idsInGroupRange: Lab.idsInGroupRange,
    dragIdsFor: Lab.dragIdsFor,
    dropTargetShowsHover: Lab.dropTargetShowsHover,
    dragPreview: Lab.dragPreview,
    shouldWarnAbsence: Lab.shouldWarnAbsence,
    absenceWarningCopy: Lab.absenceWarningCopy,
    UNALLOCATED: Lab.UNALLOCATED,
    POOL: Lab.POOL,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.RxAllocateCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
