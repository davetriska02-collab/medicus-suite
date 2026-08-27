// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — workflow / inbound-document allocation core.
//
// Sibling of lab-allocate-core: same stage → confirm → bulk-reassign write
// (W23 via LabAllocateCore.createClient). Used on document / workflow
// task-lists, never on investigation-result queues (those stay on the lab
// canvas). Named GP is a grouping caption, never auto-placement. This file
// does not POST — the lab client owns the write.
//
// Dual-mode: module.exports for Node tests, window.WorkflowAllocateCore
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
    throw new Error('WorkflowAllocateCore needs LabAllocateCore');
  }

  var Lab = loadLab();
  var UNKNOWN_GROUP = 'unknown';
  var DOCUMENT_SLUG_RE = /document|inbound|filing|correspondence|letter|scan/i;
  var EXCLUDE_SLUG_RE = /prescription|privacy|eps|officer|cancellation/i;

  function hasWorkflowViewContext(search) {
    var raw = String(search == null ? '' : search);
    if (raw.charAt(0) === '?') raw = raw.slice(1);
    return /(?:^|&)viewContext=workflow(?:&|$)/i.test(raw);
  }

  function kindForSlug(slug) {
    return DOCUMENT_SLUG_RE.test(String(slug || '')) ? 'document' : 'workflow';
  }

  function poolTitleForKind(kind) {
    return kind === 'document' ? 'Inbound documents' : 'Unallocated';
  }

  function isWorkflowQueueSlug(slug, search) {
    var s = String(slug || '');
    if (!s) return false;
    if (Lab.isResultsQueueSlug(s)) return false;
    if (EXCLUDE_SLUG_RE.test(s)) return false;
    if (DOCUMENT_SLUG_RE.test(s)) return true;
    return hasWorkflowViewContext(search);
  }

  function parseWorkflowQueueRoute(pathname, search) {
    var path = String(pathname == null ? '' : pathname);
    var m = path.match(/^\/?([0-9a-z]{2,})\/tasks\/(?:data\/)?([^/]+)\/task-list\/?$/i);
    if (!m) return null;
    var slug = m[2];
    if (!isWorkflowQueueSlug(slug, search)) return null;
    return {
      siteId: m[1],
      slug: slug,
      search: Lab.queryStringForList(search),
      apiBase: 'https://' + m[1] + '.api.england.medicus.health',
      kind: kindForSlug(slug),
    };
  }

  function decorateWorkflowRow(row, kind) {
    if (!row) return row;
    var next = Object.assign({}, row);
    next.kind = kind === 'document' || kind === 'workflow' ? kind : kindForSlug(kind);
    return next;
  }

  function workflowGroupName(tile) {
    if (tile && tile.requester) return tile.requester;
    if (tile && tile.namedGp) return tile.namedGp;
    return '';
  }

  function groupTiles(tiles) {
    var map = {};
    var order = [];
    (Array.isArray(tiles) ? tiles : []).forEach(function (tile) {
      if (!tile) return;
      var name = workflowGroupName(tile);
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
        var noun = g.count === 1 ? 'task' : 'tasks';
        g.label = g.known
          ? 'Registered GP ' + g.groupName + ' · ' + g.count + ' ' + noun
          : 'No registered GP on the task · ' + g.count + ' ' + noun;
        g.dragHint = g.known
          ? 'Drag this group onto that clinician’s field'
          : 'Cannot auto-group — no registered GP on the task';
        return g;
      })
      .sort(function (a, b) {
        if (a.known !== b.known) return a.known ? -1 : 1;
        return b.count - a.count;
      });
  }

  function buildWorkspace(rows, draft, opts) {
    opts = opts || {};
    var board = Lab.buildWorkspace(rows, draft, opts);
    var aliases = board.aliases;
    var title = opts.poolTitle || poolTitleForKind(opts.kind);
    if (board.pool) {
      board.pool.title = title;
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
        var hint = t.requester ? ' · grouped as ' + t.requester : t.namedGp ? ' · registered GP ' + t.namedGp : '';
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

  var api = {
    isWorkflowQueueSlug: isWorkflowQueueSlug,
    parseWorkflowQueueRoute: parseWorkflowQueueRoute,
    kindForSlug: kindForSlug,
    poolTitleForKind: poolTitleForKind,
    hasWorkflowViewContext: hasWorkflowViewContext,
    decorateWorkflowRow: decorateWorkflowRow,
    workflowGroupName: workflowGroupName,
    groupTiles: groupTiles,
    buildWorkspace: buildWorkspace,
    buildBoard: buildWorkspace,
    copyList: copyList,
    columnTitle: columnTitle,
    isResultsQueueSlug: Lab.isResultsQueueSlug,
    queryStringForList: Lab.queryStringForList,
    sanitizeSlug: Lab.sanitizeSlug,
    emptyDraft: Lab.emptyDraft,
    addColumn: Lab.addColumn,
    stageMove: Lab.stageMove,
    stageMoves: Lab.stageMoves,
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
    isTeamAssignee: Lab.isTeamAssignee,
    todayISO: Lab.todayISO,
    presenceForName: Lab.presenceForName,
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
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.WorkflowAllocateCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
