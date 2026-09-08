// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — patient-request (medical / admin triage inbox) allocation core.
//
// Sibling of rx-allocate-core. Same stage → confirm → bulk-reassign write
// (W23 via LabAllocateCore.createClient) on homepage medical/admin request
// task-lists. Named GP is a grouping caption, never auto-placement.
// Even-split is local staging only. This file does not POST.
//
// WRITE is fail-closed until a dummy-patient capture of bulk-reassign on
// these slugs is recorded in docs/learnings-request-allocate.md.
//
// Dual-mode: module.exports for Node tests, window.RequestAllocateCore
// in the content-script canvas. Pure: no DOM, no chrome.*, no fetch.

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
    throw new Error('RequestAllocateCore needs LabAllocateCore');
  }

  var Lab = loadLab();
  var UNKNOWN_GROUP = 'unknown';
  var MEDICAL_SLUG_RE = /medical[_-]?patient[_-]?request[_-]?task/i;
  var ADMIN_SLUG_RE = /admin[_-]?patient[_-]?request[_-]?task/i;
  var EXCLUDE_SLUG_RE = /prescription|privacy|eps|officer|cancellation|investigation|result|document|inbound|filing/i;
  var REQUEST_WRITE_CAPTURED = false;

  function hasWorkflowViewContext(search) {
    var raw = String(search == null ? '' : search);
    if (raw.charAt(0) === '?') raw = raw.slice(1);
    return /(?:^|&)viewContext=workflow(?:&|$)/i.test(raw);
  }

  function isMedicalRequestSlug(slug) {
    return MEDICAL_SLUG_RE.test(String(slug || ''));
  }

  function isAdminRequestSlug(slug) {
    return ADMIN_SLUG_RE.test(String(slug || ''));
  }

  function isRequestQueueSlug(slug) {
    var s = String(slug || '');
    if (!s) return false;
    if (Lab.isResultsQueueSlug(s)) return false;
    if (EXCLUDE_SLUG_RE.test(s)) return false;
    return isMedicalRequestSlug(s) || isAdminRequestSlug(s);
  }

  function queryStringForRequestList(search) {
    var raw = String(search == null ? '' : search).trim();
    if (!raw) return '';
    if (raw.charAt(0) === '?') raw = raw.slice(1);
    if (!raw) return '';
    if (/[:/\\]/.test(raw)) return '';
    if (!/^[A-Za-z0-9._~%+\-\[\]=&,]+$/.test(raw)) return '';
    var kept = raw.split('&').filter(Boolean);
    return kept.length ? '?' + kept.join('&') : '';
  }

  function parseRequestQueueRoute(pathname, search) {
    var path = String(pathname == null ? '' : pathname);
    var m = path.match(/^\/?([0-9a-z]{2,})\/tasks\/(?:data\/)?([^/]+)\/task-list\/?$/i);
    if (!m) return null;
    var slug = m[2];
    if (!isRequestQueueSlug(slug)) return null;
    if (hasWorkflowViewContext(search)) return null;
    return {
      siteId: m[1],
      slug: slug,
      search: queryStringForRequestList(search),
      apiBase: 'https://' + m[1] + '.api.england.medicus.health',
      kind: 'request',
      admin: isAdminRequestSlug(slug),
    };
  }

  function isRequestInboxName(name) {
    var s = String(name || '').trim();
    if (!s) return true;
    if (/^unassigned$/i.test(s)) return true;
    if (Lab.isTeamAssignee(s)) return true;
    return /patient\s*request/i.test(s) || /^(medical|admin)$/i.test(s);
  }

  function inboxAssigneeId(search) {
    var qs = queryStringForRequestList(search);
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

  function isRequestUnallocated(row) {
    if (!row || !row.id) return false;
    if (row.requestInboxPile) return true;
    if (isRequestInboxName(row.assignedTo)) return true;
    return Lab.homeColumnKey(row) === Lab.POOL;
  }

  function decorateRequestRow(row, kind) {
    if (!row) return row;
    var next = Object.assign({}, row);
    next.kind = kind === 'admin' ? 'admin-request' : 'medical-request';
    return next;
  }

  function markInboxRows(rows, search, kind) {
    var inboxId = inboxAssigneeId(search);
    return (Array.isArray(rows) ? rows : [])
      .map(function (row) {
        var next = decorateRequestRow(row, kind);
        if (!next) return next;
        if (!inboxId) return next;
        var assignedId = String(next.assignedId || '').toLowerCase();
        if (assignedId && assignedId !== String(inboxId).toLowerCase()) return next;
        next.requestInboxPile = true;
        next.requestInboxAssignedTo = next.assignedTo || '';
        next.assignedTo = 'Unassigned';
        return next;
      })
      .filter(Boolean);
  }

  function mergeInboxAndSitting(inboxRows, sittingRows, search, kind) {
    var inbox = markInboxRows(inboxRows, search, kind);
    var seen = {};
    inbox.forEach(function (r) {
      if (r && r.id) seen[r.id] = true;
    });
    var sitting = [];
    (Array.isArray(sittingRows) ? sittingRows : []).forEach(function (raw) {
      var row = decorateRequestRow(raw, kind);
      if (!row || !row.id || seen[row.id]) return;
      if (isRequestUnallocated(row)) {
        row.requestInboxPile = true;
        row.requestInboxAssignedTo = row.assignedTo || '';
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

  function requestGroupName(tile) {
    if (tile && tile.requester) return tile.requester;
    if (tile && tile.namedGp) return tile.namedGp;
    return '';
  }

  function groupTiles(tiles) {
    var map = {};
    var order = [];
    (Array.isArray(tiles) ? tiles : []).forEach(function (tile) {
      if (!tile) return;
      var name = requestGroupName(tile);
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
    if (opts && (opts.admin || opts.kind === 'admin-request')) return 'Admin requests';
    return 'Medical requests';
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
        var hint = t.requester ? ' · grouped as ' + t.requester : t.namedGp ? ' · usual GP ' + t.namedGp : '';
        var staged = t.staged ? ' · staged on this canvas only' : '';
        lines.push('  - ' + (t.patientName || 'Unknown') + (t.summary ? ' · ' + t.summary : '') + hint + staged);
      });
      lines.push('');
    });
    lines.push('Not written to Medicus. This is a working list from the allocation canvas.');
    return lines.join('\n').trim();
  }

  function requestSplitOpts(opts) {
    var next = Object.assign({}, opts || {});
    if (!next.anyTile && !next.isUnallocated) next.isUnallocated = isRequestUnallocated;
    return next;
  }

  function planEvenSplit(tiles, destinations, opts) {
    return Lab.planEvenSplit(tiles, destinations, requestSplitOpts(opts));
  }

  function planTopUp(tiles, destinations, boxCounts, opts) {
    return Lab.planTopUp(tiles, destinations, boxCounts, requestSplitOpts(opts));
  }

  function planLevel(tiles, destinations, opts) {
    return Lab.planLevel(tiles, destinations, requestSplitOpts(opts));
  }

  function unallocatedNotStaged(rows, draft) {
    var moves = (draft && draft.moves) || {};
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && r.id && isRequestUnallocated(r) && !moves[r.id];
    });
  }

  var REQUEST_WRITE_CAPTURE_REASON = 'Write not captured for this queue yet.';
  var REQUEST_WRITE_CAPTURE_COPY =
    'This is a plan on this canvas only. Medicus has not changed. To move these today, assign them in Medicus. Writing from this canvas is switched off for this queue until it has been checked on a test patient.';
  var REQUEST_WRITE_REVIEW_HEADLINE = 'This is a plan on this canvas only. Medicus has not changed.';
  var REQUEST_WRITE_REVIEW_BODY =
    'To move these today, assign them in Medicus. Writing from this canvas is switched off for this queue until it has been checked on a test patient.';
  var REQUEST_WRITE_DISABLED_BUTTON = 'Write to Medicus (not yet available for this queue)';

  function requestGatedWriteCopy(opts) {
    opts = opts || {};
    var n = Number(opts.count) || 0;
    return {
      reviewButton: n ? 'Review plan (' + n + ')' : 'Review plan',
      reviewHeadline: REQUEST_WRITE_REVIEW_HEADLINE,
      reviewBody: REQUEST_WRITE_REVIEW_BODY,
      writeButton: '',
      hideWrite: true,
    };
  }

  function canWriteRequestAllocations(opts) {
    if (!REQUEST_WRITE_CAPTURED) {
      var gated = requestGatedWriteCopy(opts || {});
      return {
        ok: false,
        reason: REQUEST_WRITE_CAPTURE_REASON,
        copy: REQUEST_WRITE_CAPTURE_COPY,
        reviewButton: gated.reviewButton,
        reviewHeadline: gated.reviewHeadline,
        reviewBody: gated.reviewBody,
        writeButton: '',
        hideWrite: true,
      };
    }
    return Lab.canWriteAllocations(opts || {});
  }

  function createClient(apiBase, deps) {
    var client = Lab.createClient(apiBase, deps);
    var inner = client.commitAllocations.bind(client);
    client.commitAllocations = function (opts) {
      var gate = canWriteRequestAllocations(opts || {});
      if (!gate.ok) {
        return Promise.resolve({
          ok: false,
          written: 0,
          reason: gate.reason,
          batches: [],
          refused: [],
        });
      }
      return inner(opts);
    };
    return client;
  }

  async function fetchRequestTaskList(apiBase, slug, search, deps) {
    var client = Lab.createClient(apiBase, deps);
    var pageQs = queryStringForRequestList(search);
    var filtered = null;
    if (pageQs) {
      filtered = await client.fetchTaskList(slug, pageQs, { keepMasterAssignee: true });
      if (filtered && filtered.rows && filtered.rows.length) return filtered;
    }
    var openPile = await client.fetchTaskList(slug, '');
    if (openPile && openPile.rows && openPile.rows.length) return openPile;
    return filtered || openPile;
  }

  async function fetchRequestMergedTaskList(apiBase, slug, search, deps) {
    var inbox = await fetchRequestTaskList(apiBase, slug, search, deps);
    var sitting = { rows: [], slug: '', taskList: undefined, body: null };
    try {
      sitting = await fetchRequestTaskList(apiBase, slug, '', deps);
    } catch (err) {
      if (deps && deps.requireSitting) {
        throw new Error('Could not re-read sitting work — nothing was sent.');
      }
    }
    var kind = isAdminRequestSlug(slug) ? 'admin' : 'medical';
    return {
      rows: mergeInboxAndSitting(inbox.rows || [], sitting.rows || [], search, kind),
      slug: inbox.slug || sitting.slug || slug,
      taskList: inbox.taskList || sitting.taskList,
      search: inbox.search || search || '',
      body: inbox.body || sitting.body,
    };
  }

  var api = {
    REQUEST_WRITE_CAPTURED: REQUEST_WRITE_CAPTURED,
    REQUEST_WRITE_CAPTURE_REASON: REQUEST_WRITE_CAPTURE_REASON,
    REQUEST_WRITE_CAPTURE_COPY: REQUEST_WRITE_CAPTURE_COPY,
    REQUEST_WRITE_REVIEW_HEADLINE: REQUEST_WRITE_REVIEW_HEADLINE,
    REQUEST_WRITE_REVIEW_BODY: REQUEST_WRITE_REVIEW_BODY,
    REQUEST_WRITE_DISABLED_BUTTON: REQUEST_WRITE_DISABLED_BUTTON,
    requestGatedWriteCopy: requestGatedWriteCopy,
    isMedicalRequestSlug: isMedicalRequestSlug,
    isAdminRequestSlug: isAdminRequestSlug,
    isRequestQueueSlug: isRequestQueueSlug,
    hasWorkflowViewContext: hasWorkflowViewContext,
    queryStringForRequestList: queryStringForRequestList,
    parseRequestQueueRoute: parseRequestQueueRoute,
    decorateRequestRow: decorateRequestRow,
    markInboxRows: markInboxRows,
    mergeInboxAndSitting: mergeInboxAndSitting,
    inboxAssigneeId: inboxAssigneeId,
    isRequestInboxName: isRequestInboxName,
    isRequestUnallocated: isRequestUnallocated,
    requestGroupName: requestGroupName,
    groupTiles: groupTiles,
    buildWorkspace: buildWorkspace,
    buildBoard: buildWorkspace,
    copyList: copyList,
    poolTitle: poolTitle,
    planEvenSplit: planEvenSplit,
    planTopUp: planTopUp,
    planLevel: planLevel,
    applyEvenSplit: Lab.applyEvenSplit,
    unallocatedNotStaged: unallocatedNotStaged,
    ensureWorkingTodayColumns: Lab.ensureDestColumns,
    replaceDestColumns: Lab.replaceDestColumns,
    pinDestStaffIds: Lab.pinDestStaffIds,
    destNamesPhrase: Lab.destNamesPhrase,
    asSplitDests: Lab.asSplitDests,
    workingTodayDoctors: function (opts) {
      if (typeof require === 'function') {
        try {
          return require('./rx-allocate-core.js').workingTodayDoctors(opts);
        } catch (_) {}
      }
      if (global && global.RxAllocateCore) return global.RxAllocateCore.workingTodayDoctors(opts);
      return [];
    },
    fetchRequestTaskList: fetchRequestTaskList,
    fetchRequestMergedTaskList: fetchRequestMergedTaskList,
    canWriteRequestAllocations: canWriteRequestAllocations,
    isResultsQueueSlug: Lab.isResultsQueueSlug,
    queryStringForList: Lab.queryStringForList,
    sanitizeSlug: Lab.sanitizeSlug,
    emptyDraft: Lab.emptyDraft,
    addColumn: Lab.addColumn,
    addTeamColumn: Lab.addTeamColumn,
    stageMove: Lab.stageMove,
    stageMoves: Lab.stageMoves,
    draftSummary: Lab.draftSummary,
    homeColumnKey: Lab.homeColumnKey,
    normaliseTaskRow: Lab.normaliseTaskRow,
    harvestStaffDirectory: Lab.harvestStaffDirectory,
    mergeStaffDirectory: Lab.mergeStaffDirectory,
    harvestTeamDirectory: Lab.harvestTeamDirectory,
    mergeTeamDirectory: Lab.mergeTeamDirectory,
    canWriteAllocations: canWriteRequestAllocations,
    planBulkReassign: Lab.planBulkReassign,
    writeBlockReason: Lab.writeBlockReason,
    refusedPatientsPhrase: Lab.refusedPatientsPhrase,
    createClient: createClient,
    collisionPhrase: Lab.collisionPhrase,
    displayClinicianName: Lab.displayClinicianName,
    teamColumnKey: Lab.teamColumnKey,
    isTeamAssignee: Lab.isTeamAssignee,
    todayISO: Lab.todayISO,
    presenceForName: Lab.presenceForName,
    parseTodayBook: Lab.parseTodayBook,
    coerceWorkDate: Lab.coerceWorkDate,
    addDaysISO: Lab.addDaysISO,
    workDayPhrase: Lab.workDayPhrase,
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
  if (global) global.RequestAllocateCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
