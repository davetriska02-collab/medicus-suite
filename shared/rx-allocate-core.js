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

  function isNonRoutineRxQueueSlug(slug) {
    var s = String(slug || '');
    if (!s) return false;
    if (Lab.isResultsQueueSlug(s)) return false;
    if (EXCLUDE_SLUG_RE.test(s)) return false;
    if (!PRESCRIPTION_SLUG_RE.test(s)) return false;
    if (NON_ROUTINE_SLUG_RE.test(s)) return true;
    if (ROUTINE_ONLY_SLUG_RE.test(s)) return false;
    return false;
  }

  function parseRxQueueRoute(pathname, search) {
    var path = String(pathname == null ? '' : pathname);
    var m = path.match(/^\/?([0-9a-z]{2,})\/tasks\/(?:data\/)?([^/]+)\/task-list\/?$/i);
    if (!m) return null;
    var slug = m[2];
    if (!isNonRoutineRxQueueSlug(slug)) return null;
    return {
      siteId: m[1],
      slug: slug,
      search: Lab.queryStringForList(search),
      apiBase: 'https://' + m[1] + '.api.england.medicus.health',
      kind: 'rx',
    };
  }

  function decorateRxRow(row) {
    if (!row) return row;
    var next = Object.assign({}, row);
    next.kind = 'rx';
    return next;
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
          ? 'Registered GP ' + g.groupName + ' · ' + g.count + ' ' + noun
          : 'No registered GP on the request · ' + g.count + ' ' + noun;
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

  function buildWorkspace(rows, draft, opts) {
    opts = opts || {};
    var board = Lab.buildWorkspace(rows, draft, opts);
    var aliases = board.aliases;
    if (board.pool) {
      board.pool.title = opts.poolTitle || 'Non-routine prescriptions';
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
            ? ' · registered GP ' + t.namedGp
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

  function coerceWorkDate(iso, fallback) {
    var day = String(iso || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      var check = new Date(day + 'T12:00:00');
      if (!isNaN(check.getTime())) return day;
    }
    var fb = String(fallback || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(fb)) return fb;
    return Lab.todayISO();
  }

  function addDaysISO(iso, days) {
    var day = coerceWorkDate(iso, Lab.todayISO());
    var d = new Date(day + 'T12:00:00');
    if (isNaN(d.getTime())) return day;
    d.setDate(d.getDate() + (Number(days) || 0));
    return (
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function workDayPhrase(iso, calendarToday) {
    var day = coerceWorkDate(iso, calendarToday);
    var cal = coerceWorkDate(calendarToday, Lab.todayISO());
    if (day === cal) return 'today';
    return Lab.formatLeaveDate(day);
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

  function planEvenSplit(tiles, destinations, opts) {
    opts = opts || {};
    var pool = (Array.isArray(tiles) ? tiles : []).filter(function (t) {
      return t && t.id && Lab.homeColumnKey(t) === Lab.POOL;
    });
    var dests = (Array.isArray(destinations) ? destinations : []).filter(function (d) {
      return d && d.key && String(d.key).indexOf('clinician:') === 0;
    });
    var dayPhrase = opts.dayPhrase || 'today';
    if (!dests.length) {
      return {
        ok: false,
        reason: 'No doctors with a session on the appointment book for ' + dayPhrase + ' to split onto.',
        total: pool.length,
        shares: [],
        leftover: pool.length,
      };
    }
    if (!pool.length) {
      return {
        ok: false,
        reason: 'Nothing unallocated to split.',
        total: 0,
        shares: dests.map(function (d) {
          return { key: d.key, name: d.name, count: 0, tileIds: [] };
        }),
        leftover: 0,
      };
    }
    var n = pool.length;
    var k = dests.length;
    var base = Math.floor(n / k);
    var rem = n % k;
    var shares = dests.map(function (d, i) {
      return {
        key: d.key,
        name: d.name,
        staffId: d.staffId || '',
        count: base + (i < rem ? 1 : 0),
        tileIds: [],
      };
    });
    var cursor = 0;
    pool.forEach(function (tile) {
      var guard = 0;
      while (shares[cursor].tileIds.length >= shares[cursor].count && guard < k) {
        cursor = (cursor + 1) % k;
        guard += 1;
      }
      shares[cursor].tileIds.push(tile.id);
      cursor = (cursor + 1) % k;
    });
    return {
      ok: true,
      total: n,
      doctors: k,
      shares: shares,
      leftover: 0,
      summary:
        n +
        ' unallocated · split across ' +
        k +
        ' doctor' +
        (k === 1 ? '' : 's') +
        ' working ' +
        dayPhrase,
    };
  }

  function applyEvenSplit(draft, plan) {
    var next = draft || Lab.emptyDraft();
    if (!plan || !plan.ok) return next;
    (plan.shares || []).forEach(function (share) {
      if (!share || !share.key) return;
      next = Lab.addColumn(next, share.name, share.staffId);
      next = Lab.stageMoves(next, share.tileIds || [], share.key);
    });
    return next;
  }

  function ensureWorkingTodayColumns(draft, destinations) {
    var next = draft || Lab.emptyDraft();
    (Array.isArray(destinations) ? destinations : []).forEach(function (d) {
      if (d && d.name) next = Lab.addColumn(next, d.name, d.staffId);
    });
    return next;
  }

  function pinDestStaffIds(dests, directory) {
    return (Array.isArray(dests) ? dests : []).map(function (d) {
      if (!d) return d;
      if (d.staffId) return d;
      var resolved = Lab.resolveStaffForColumn(d.key, d.name, directory, [], null, '');
      if (resolved && resolved.ok && resolved.staff && resolved.staff.id) {
        return Object.assign({}, d, { staffId: resolved.staff.id });
      }
      return d;
    });
  }

  // Signing loads this pile with GET /tasks/data/{slug}/task-list and no
  // query string — that is the outstanding open list. Replaying the page's
  // statuses[] / viewContext can return an empty envelope while the grid
  // still shows rows (those params are for other queue families). Try the
  // bare GET first; fall back to the page query only if that is empty.
  async function fetchRxTaskList(apiBase, slug, search, deps) {
    var client = Lab.createClient(apiBase, deps);
    var openPile = await client.fetchTaskList(slug, '');
    if (openPile && openPile.rows && openPile.rows.length) return openPile;
    var pageQs = Lab.queryStringForList(search);
    if (!pageQs) return openPile;
    var filtered = await client.fetchTaskList(slug, pageQs);
    if (filtered && filtered.rows && filtered.rows.length) return filtered;
    return openPile || filtered;
  }

  var api = {
    isNonRoutineRxQueueSlug: isNonRoutineRxQueueSlug,
    parseRxQueueRoute: parseRxQueueRoute,
    decorateRxRow: decorateRxRow,
    rxGroupName: rxGroupName,
    groupTiles: groupTiles,
    buildWorkspace: buildWorkspace,
    buildBoard: buildWorkspace,
    copyList: copyList,
    columnTitle: columnTitle,
    isLikelyDoctor: isLikelyDoctor,
    coerceWorkDate: coerceWorkDate,
    addDaysISO: addDaysISO,
    workDayPhrase: workDayPhrase,
    formatLeaveDate: Lab.formatLeaveDate,
    workingTodayDoctors: workingTodayDoctors,
    planEvenSplit: planEvenSplit,
    applyEvenSplit: applyEvenSplit,
    ensureWorkingTodayColumns: ensureWorkingTodayColumns,
    pinDestStaffIds: pinDestStaffIds,
    fetchRxTaskList: fetchRxTaskList,
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
