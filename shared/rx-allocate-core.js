// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — non-routine prescription-request allocation core.
//
// Sibling of lab-allocate-core / workflow-allocate-core. Same stage →
// confirm → bulk-reassign write (W23 via LabAllocateCore.createClient) on
// the non-routine prescription-request task-list. Named GP is a grouping
// caption, never auto-placement. Send-to-usual-GP is user-initiated
// staging of unallocated rows only — opening the canvas does not move
// anything. Even-split among doctors with a session on today’s
// appointment book is local staging only — it does not write.
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
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
      if (UUID_RE.test(v)) return v;
    }
    return '';
  }

  function sameStaffId(a, b) {
    var left = String(a || '').toLowerCase();
    var right = String(b || '').toLowerCase();
    return !!(left && right && UUID_RE.test(left) && UUID_RE.test(right) && left === right);
  }

  function dropQueryKeys(search, keys) {
    var qs = queryStringForRxList(search);
    if (!qs) return '';
    var drop = {};
    (Array.isArray(keys) ? keys : []).forEach(function (k) {
      if (k) drop[String(k).toLowerCase()] = true;
    });
    var kept = qs
      .replace(/^\?/, '')
      .split('&')
      .filter(function (part) {
        if (!part) return false;
        var k = part.split('=')[0];
        try {
          k = decodeURIComponent(k);
        } catch (_) {}
        return !drop[String(k).toLowerCase()];
      });
    return kept.length ? '?' + kept.join('&') : '';
  }

  // Page location.search is the routine inbox box when masterAssignee is
  // that box's UUID. The same query is a personal homepage slice when the
  // UUID is the signed-in staff stamp (#413 class) — that GET is [] or a
  // couple of "mine" rows while the Medicus grid still shows the shared
  // pile. Walk widest-after-untrusted: skip the staff-stamp assignee, then
  // drop homepage, then the captured statuses, then bare GET (Signing's
  // open list). First non-empty wins.
  function rxListQueryPlan(search, opts) {
    var pageQs = queryStringForRxList(search);
    var staffId = opts && opts.staffId ? String(opts.staffId) : '';
    var pageAssignee = inboxAssigneeId(pageQs);
    var assigneeIsStaff = sameStaffId(pageAssignee, staffId);
    var seen = {};
    var plan = [];
    function add(qs) {
      var q = qs == null || qs === '' ? '' : queryStringForRxList(qs);
      if (Object.prototype.hasOwnProperty.call(seen, q)) return;
      seen[q] = true;
      plan.push(q);
    }
    if (pageQs && !assigneeIsStaff) add(pageQs);
    if (pageQs) add(dropQueryKeys(pageQs, ['masterAssignee']));
    if (pageQs) add(dropQueryKeys(pageQs, ['masterAssignee', 'viewContext']));
    add('?statuses[]=pending-review');
    add('?statuses[]=pending');
    add('');
    if (pageQs && assigneeIsStaff) add(pageQs);
    return plan;
  }

  // Bridged ch-task-list-data is untrusted. Count / id-hint only — never
  // treat the rows as write targets. Used when the page GET is empty so
  // we can name "grid has work, Suite does not" and stamp already-fetched
  // rows that the visible table included.
  function inboxCountFromTaskListBridge(detail, expectedSlug) {
    if (!detail || typeof detail !== 'object') return 0;
    if (!Array.isArray(detail.rows)) return 0;
    var slug = String(detail.taskTypeSlug || '').trim();
    if (!slug || !isRxQueueSlug(slug)) return 0;
    if (expectedSlug && slug !== String(expectedSlug)) return 0;
    var n = detail.rows.length;
    if (!isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  function visiblePileIdsFromTaskListBridge(detail, expectedSlug) {
    var out = {};
    if (!inboxCountFromTaskListBridge(detail, expectedSlug)) return out;
    detail.rows.forEach(function (row) {
      var id = row && (row.taskUuid || row.id);
      if (typeof id === 'string' && UUID_RE.test(id)) out[id.toLowerCase()] = true;
    });
    return out;
  }

  function rxEmptyPileReason(opts) {
    opts = opts || {};
    var rows = Number(opts.rowCount) || 0;
    var pile = Number(opts.unallocatedCount) || 0;
    var dests = Number(opts.destCount) || 0;
    var bridge = Number(opts.bridgeCount) || 0;
    var day = opts.dayPhrase || 'that day';
    if (dests <= 0 && pile > 0) {
      return (
        'No doctors working ' +
        day +
        ' to share onto. The pile is still there — pick another working day, a group, or add a doctor.'
      );
    }
    if (rows <= 0 && bridge > 0) {
      return (
        'The Medicus table has ' +
        bridge +
        ' row' +
        (bridge === 1 ? '' : 's') +
        '. Suite’s list is empty — the page filter is not this inbox.'
      );
    }
    if (rows <= 0) {
      return 'No open requests on this queue. If the grid still shows rows, reload the list, then open again.';
    }
    if (pile <= 0) {
      return 'No unallocated requests in this inbox — they already sit with people. Split / Top up / usual-GP send need the Unallocated pile.';
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

  function visibleIdHit(visibleIds, id) {
    if (!visibleIds || !id) return false;
    return !!visibleIds[String(id).toLowerCase()];
  }

  function stampInboxRow(row) {
    row.rxInboxPile = true;
    row.rxInboxAssignedTo = row.assignedTo || '';
    row.assignedTo = 'Unassigned';
    return row;
  }

  // Inbox GET (winning query) is the box to share out. Bare GET of
  // the same slug is everyone already sitting with a GP. Folders need both.
  // Stamp with the search that actually produced rows — a leftover
  // homepage/staff masterAssignee must not restamp the bare pile as
  // sitting GP work (person-shaped inbox names).
  function mergeInboxAndSitting(inboxRows, sittingRows, search, opts) {
    var inbox = markInboxRows(inboxRows, search, opts);
    var seen = {};
    inbox.forEach(function (r) {
      if (r && r.id) seen[r.id] = true;
    });
    var visibleIds = opts && opts.visibleIds;
    var sitting = [];
    (Array.isArray(sittingRows) ? sittingRows : []).forEach(function (raw) {
      var row = decorateRxRow(raw);
      if (!row || !row.id || seen[row.id]) return;
      if (isRxUnallocated(row) || visibleIdHit(visibleIds, row.id)) {
        stampInboxRow(row);
        inbox.push(row);
        seen[row.id] = true;
        return;
      }
      sitting.push(row);
      seen[row.id] = true;
    });
    return inbox.concat(sitting);
  }

  // The winning inbox filter is the box to work. Those rows are assigned
  // to the inbox UUID (often a person-shaped name on assignedTo), which
  // made homeColumnKey treat the whole pile as already sitting with a GP.
  // Stamp them Unassigned so they stay in the unallocated list.
  // When the page filter was not this box, visibleIds (from the grid's
  // own GET) can hint which already-fetched rows are the pile.
  function markInboxRows(rows, search, opts) {
    var inboxId = inboxAssigneeId(search);
    var visibleIds = opts && opts.visibleIds;
    return (Array.isArray(rows) ? rows : [])
      .map(function (row) {
        var next = decorateRxRow(row);
        if (!next) return next;
        var assignedId = String(next.assignedId || '').toLowerCase();
        if (inboxId) {
          if (assignedId && assignedId !== String(inboxId).toLowerCase()) return next;
          return stampInboxRow(next);
        }
        if (visibleIdHit(visibleIds, next.id)) return stampInboxRow(next);
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
        var hint = t.requester ? ' · grouped as ' + t.requester : t.namedGp ? ' · usual GP ' + t.namedGp : '';
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
  // masterAssignee=<inbox uuid>. That filtered GET is the box on the page
  // when the UUID is the box, not the signed-in staff stamp. Homepage +
  // staff empties or personal-slices the dedicated non-routine queue
  // while the grid is full (#413 class; Dave 2026-09-15). Walk
  // rxListQueryPlan; first non-empty wins; a thrown step is skipped.
  async function fetchRxTaskList(apiBase, slug, search, deps) {
    var client = Lab.createClient(apiBase, deps);
    if (deps && deps.bareOnly) {
      return client.fetchTaskList(slug, '');
    }
    var plan = rxListQueryPlan(search, deps);
    var last = { rows: [], slug: slug, search: '', taskList: undefined, body: null };
    for (var i = 0; i < plan.length; i++) {
      try {
        var got = await client.fetchTaskList(slug, plan[i], { keepMasterAssignee: true });
        if (got) last = got;
        if (got && got.rows && got.rows.length) return got;
      } catch (_) {}
    }
    return last;
  }

  // Write vanish-check needs every staged id, including already-sitting
  // GP work that Distribute equally rebalances. The winning inbox GET is
  // the pile; the bare GET is sitting work. Stamp with the winning
  // search, not the leftover page filter that just failed.
  async function fetchRxMergedTaskList(apiBase, slug, search, deps) {
    var inbox = await fetchRxTaskList(apiBase, slug, search, deps);
    var sitting = { rows: [], slug: '', taskList: undefined, body: null };
    try {
      sitting = await fetchRxTaskList(apiBase, slug, '', Object.assign({}, deps || {}, { bareOnly: true }));
    } catch (_) {}
    var stampSearch = inbox && inbox.search != null ? inbox.search : '';
    return {
      rows: mergeInboxAndSitting(inbox.rows || [], sitting.rows || [], stampSearch, deps),
      slug: inbox.slug || sitting.slug || slug,
      taskList: inbox.taskList || sitting.taskList,
      search: stampSearch,
      body: inbox.body || sitting.body,
    };
  }

  // ---- Per-request medication summary (2026-09-10) ----
  // Pure counting/formatting for the "Request for 3/6 repeats, 1 acute,
  // 0/2 batches. 3/5 repeats overdue for reauthorising." tile sub-line.
  // Fetch orchestration (concurrency, caching, on-screen priority) stays in
  // content-scripts/rx-allocate-canvas.js — this is just the shape math,
  // kept here so it's require()-able from tests like the rest of this file.

  // data.prescriptionRequestItemsByType has 5 confirmed sibling buckets
  // (HAR-confirmed live against a real 148-row inbox, 2026-09-10):
  // repeatWithAnAuthorisedIssue + repeatPrescribingWithNoIssues (both
  // "repeat" — split only by whether an issue is currently outstanding),
  // acutePrescriptions, repeatDispensing, variableRepeat.
  function itemCountsFromOverviewPayload(payload, resolvedPatientId) {
    var byType = payload && payload.data && payload.data.prescriptionRequestItemsByType;
    function bucketLen(key) {
      var b = byType && byType[key];
      return Array.isArray(b && b.items) ? b.items.length : 0;
    }
    return {
      repeat: bucketLen('repeatWithAnAuthorisedIssue') + bucketLen('repeatPrescribingWithNoIssues'),
      acute: bucketLen('acutePrescriptions'),
      repeatDispensing: bucketLen('repeatDispensing'),
      variableRepeat: bucketLen('variableRepeat'),
      resolvedPatientId: resolvedPatientId || '',
    };
  }

  // Scope confirmed with Nick (2026-09-10): only the three repeat-type
  // buckets — isOverDue on acute/OTC/prescribed-elsewhere is out of scope
  // (acute items structurally can't carry a reauthorisation-overdue flag —
  // confirmed live on a real patient's medication list).
  var RX_REPEAT_TYPE_BUCKETS = [
    ['currentRepeatPrescribingMedications', 'repeatTotal'],
    ['currentVariableRepeatMedications', 'variableRepeatTotal'],
    ['currentRepeatDispensingMedications', 'repeatDispensingTotal'],
  ];

  function regimenTotalsFromPayload(regimen) {
    var totals = { repeatTotal: 0, variableRepeatTotal: 0, repeatDispensingTotal: 0, overdueCount: 0, overdueTotal: 0 };
    RX_REPEAT_TYPE_BUCKETS.forEach(function (pair) {
      var arr = regimen && regimen[pair[0]];
      if (!Array.isArray(arr)) return;
      totals[pair[1]] = arr.length;
      totals.overdueTotal += arr.length;
      arr.forEach(function (m) {
        if (m && m.isOverDue) totals.overdueCount++;
      });
    });
    return totals;
  }

  // requested/total, e.g. "3/6 repeats" — with no regimen total loaded yet
  // (Pass B hasn't resolved this patient), falls back to a bare requested
  // count ("3 repeats") rather than blocking on the slow fetch. Returns ''
  // for a type with zero requested items (omitted from the line entirely).
  function fractionOrCount(requested, total, label) {
    if (!requested) return '';
    var text = total == null ? String(requested) : requested + '/' + total;
    return text + ' ' + label;
  }

  // "Request for 3/6 repeats, 1 acute, 0/2 batches. 3/5 repeats overdue for
  // reauthorising." — Nick's own confirmed format, 2026-09-10. Acute is a
  // bare count (no total, confirmed) since it's out of scope for the
  // reauthorisation-overdue concept entirely. The overdue sentence only
  // appears once `totals` is non-null AND has at least one repeat-type
  // medication — plain text, no markup (caller HTML-escapes/wraps it).
  function rxMonitoringLine(counts, totals) {
    if (!counts) return '';
    var parts = [];
    var repeatPart = fractionOrCount(counts.repeat, totals ? totals.repeatTotal : null, 'repeats');
    if (repeatPart) parts.push(repeatPart);
    if (counts.acute) parts.push(counts.acute + ' acute');
    var dispensingPart = fractionOrCount(
      counts.repeatDispensing,
      totals ? totals.repeatDispensingTotal : null,
      'batches'
    );
    if (dispensingPart) parts.push(dispensingPart);
    var variablePart = fractionOrCount(
      counts.variableRepeat,
      totals ? totals.variableRepeatTotal : null,
      'variable repeat'
    );
    if (variablePart) parts.push(variablePart);
    if (!parts.length) return '';
    var sentence = 'Request for ' + parts.join(', ') + '.';
    if (totals && totals.overdueTotal > 0) {
      sentence += ' ' + totals.overdueCount + '/' + totals.overdueTotal + ' repeats overdue for reauthorising.';
    }
    return sentence;
  }

  // 1 (least complex) to 5 (most complex) — Nick's request, 2026-09-10:
  // "more items in the request should increase it". Originally also
  // weighted in medicationsTotal (the patient's background repeat-type
  // med count) at 3x-vs-1x, but Nick dropped that the same day: "the
  // number needing reauthorised is less useful" — issuing work scales
  // with how many items THIS request contains, not with how many meds
  // happen to be sitting on the patient's file. The regimen totals /
  // overdue-for-reauthorising figures stay visible as extra info in
  // rxMonitoringLine's own sentence — just no longer feed the score.
  // Only needs counts (Pass A, ~10s for a whole pool) now, not totals
  // (Pass B, ~70s) — resolves far sooner than it used to as a result.
  // Thresholds: even steps of 2 (Nick, 2026-09-10) — 1-2 items -> level 1,
  // 3-4 -> 2, 5-6 -> 3, 7-8 -> 4, 9+ -> 5.
  var COMPLEXITY_THRESHOLDS = [2, 4, 6, 8]; // upper bound (inclusive) for levels 1-4; above the last -> 5

  function complexityScore(counts) {
    if (!counts) return null;
    var requestedItemsTotal = counts.repeat + counts.acute + counts.repeatDispensing + counts.variableRepeat;
    var raw = requestedItemsTotal;
    var level = 5;
    for (var i = 0; i < COMPLEXITY_THRESHOLDS.length; i++) {
      if (raw <= COMPLEXITY_THRESHOLDS[i]) {
        level = i + 1;
        break;
      }
    }
    return { level: level, requestedItemsTotal: requestedItemsTotal, raw: raw };
  }

  function staffUuid(v) {
    var s = String(v || '').trim();
    return UUID_RE.test(s) ? s : '';
  }

  function directoryRecordById(directory, id) {
    var want = staffUuid(id);
    if (!want || !directory) return null;
    if (directory.byId && directory.byId[want]) return directory.byId[want];
    var keys = directory.byId ? Object.keys(directory.byId) : [];
    var lower = want.toLowerCase();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i]).toLowerCase() === lower) return directory.byId[keys[i]];
    }
    return null;
  }

  function uniqueNameMatches(name, people, nameOf, idOf) {
    var hits = [];
    var seen = {};
    (Array.isArray(people) ? people : []).forEach(function (p) {
      if (!p) return;
      var n = nameOf(p);
      if (!n) return;
      if (!Lab.sameClinician(n, name)) return;
      var id = staffUuid(idOf(p)) || String(n).toLowerCase();
      if (seen[id]) return;
      seen[id] = true;
      hits.push(p);
    });
    return hits;
  }

  function inDayByStaffId(staffId, inDayPeople) {
    var want = staffUuid(staffId);
    if (!want) return null;
    var list = Array.isArray(inDayPeople) ? inDayPeople : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && staffUuid(list[i].staffId) && staffUuid(list[i].staffId).toLowerCase() === want.toLowerCase()) {
        return list[i];
      }
    }
    return null;
  }

  function usualGpDestMove(tileId, person, fallbackName, staffId, notIn) {
    var name = (person && person.name) || fallbackName || '';
    var key = (person && person.key) || Lab.clinicianColumnKey(name);
    if (!key || key === Lab.UNALLOCATED || key === Lab.POOL) return null;
    return {
      id: tileId,
      toKey: key,
      toName: name,
      staffId: staffUuid((person && (person.staffId || person.id)) || staffId),
      notIn: !!notIn,
    };
  }

  function usualGpDisplayName(name, directory, staffId) {
    var n = String(name || '').trim();
    if (n) return n;
    var rec = directoryRecordById(directory, staffId);
    return rec && rec.name ? rec.name : '';
  }

  // Stage unallocated Rx onto the patient's usual / named GP, only when
  // that person is on the picked day's book. includeNotIn is an explicit
  // opt-in to also stage onto usual GPs who are not in that day.
  // Sibling of lab planSendToRequester — do not reuse that function:
  // requester on an Rx row is not the usual GP.
  function planSendToUsualGp(tiles, inDayPeople, opts) {
    opts = opts || {};
    var includeNotIn = !!opts.includeNotIn;
    var directory = opts.directory || { byId: {}, list: [] };
    var dirList = Array.isArray(directory.list) ? directory.list : [];
    var pool = (Array.isArray(tiles) ? tiles : []).filter(function (t) {
      return t && t.id && isRxUnallocated(t);
    });
    var sent = [];
    var skippedUnknown = [];
    var skippedNotIn = [];
    var skippedAmbiguous = [];

    function pushUnknown(tile, extra) {
      skippedUnknown.push(Object.assign({ id: tile.id }, extra || {}));
    }
    function pushNotIn(tile, extra) {
      skippedNotIn.push(Object.assign({ id: tile.id }, extra || {}));
    }
    function pushAmbiguous(tile, extra) {
      skippedAmbiguous.push(Object.assign({ id: tile.id }, extra || {}));
    }

    pool.forEach(function (tile) {
      var id = staffUuid(tile.namedGpId);
      var name = String(tile.namedGp || '').trim();
      if (!id && !name) {
        pushUnknown(tile);
        return;
      }
      if (name && Lab.isTeamAssignee(name)) {
        pushUnknown(tile, { namedGp: name, team: true });
        return;
      }

      if (id) {
        var byId = inDayByStaffId(id, inDayPeople);
        if (byId) {
          var moveId = usualGpDestMove(tile.id, byId, name, id, false);
          if (moveId) sent.push(moveId);
          else pushUnknown(tile, { namedGpId: id });
          return;
        }
        var inDayNameHits = name
          ? uniqueNameMatches(
              name,
              inDayPeople,
              function (p) {
                return p.name;
              },
              function (p) {
                return p.staffId;
              }
            )
          : [];
        if (inDayNameHits.length === 1) {
          var moveName = usualGpDestMove(tile.id, inDayNameHits[0], name, id, false);
          if (moveName) {
            moveName.staffId = id;
            sent.push(moveName);
          } else pushUnknown(tile, { namedGp: name, namedGpId: id });
          return;
        }
        if (includeNotIn) {
          var destName = usualGpDisplayName(name, directory, id);
          var moveNotIn = usualGpDestMove(tile.id, null, destName, id, true);
          if (moveNotIn) sent.push(moveNotIn);
          else pushUnknown(tile, { namedGpId: id });
          return;
        }
        pushNotIn(tile, { namedGp: name || destNameFromId(id), namedGpId: id });
        return;
      }

      var dayHits = uniqueNameMatches(
        name,
        inDayPeople,
        function (p) {
          return p.name;
        },
        function (p) {
          return p.staffId;
        }
      );
      var dirHits = uniqueNameMatches(
        name,
        dirList,
        function (p) {
          return p.name;
        },
        function (p) {
          return p.id;
        }
      );
      if (dayHits.length > 1 || dirHits.length > 1) {
        pushAmbiguous(tile, { namedGp: name });
        return;
      }
      if (dayHits.length === 1) {
        var moveDay = usualGpDestMove(tile.id, dayHits[0], name, dayHits[0].staffId, false);
        if (moveDay) sent.push(moveDay);
        else pushUnknown(tile, { namedGp: name });
        return;
      }
      if (includeNotIn) {
        var staffId = dirHits.length === 1 ? dirHits[0].id : '';
        var dest = dirHits.length === 1 ? dirHits[0].name : name;
        var moveOff = usualGpDestMove(tile.id, null, dest, staffId, true);
        if (moveOff) sent.push(moveOff);
        else pushUnknown(tile, { namedGp: name });
        return;
      }
      pushNotIn(tile, { namedGp: name });
    });

    function destNameFromId(staffId) {
      return usualGpDisplayName('', directory, staffId);
    }

    var reason = '';
    if (!sent.length) {
      if (skippedAmbiguous.length && !skippedNotIn.length && !skippedUnknown.length) {
        reason = 'Two staff match that usual GP name — left in the pile.';
      } else if (skippedNotIn.length && !includeNotIn) {
        reason =
          'Usual GP is not on the book for that day. Leave them in the pile, or turn on send-to-usual-GPs-who-are-not-in.';
      } else if (
        skippedUnknown.length &&
        !pool.filter(function (t) {
          return t && t.namedGp;
        }).length
      ) {
        reason = 'No unallocated requests with a usual GP to send.';
      } else {
        reason = 'Nothing to send to usual GP.';
      }
    }
    return {
      ok: sent.length > 0,
      sent: sent,
      sentIn: sent.filter(function (m) {
        return !m.notIn;
      }).length,
      sentNotIn: sent.filter(function (m) {
        return m.notIn;
      }).length,
      skippedUnknown: skippedUnknown,
      skippedNotIn: skippedNotIn,
      skippedAmbiguous: skippedAmbiguous,
      includeNotIn: includeNotIn,
      total: pool.length,
      reason: reason,
    };
  }

  function applySendToUsualGp(draft, plan) {
    var next = draft || Lab.emptyDraft();
    if (!plan || !plan.ok) return next;
    (plan.sent || []).forEach(function (move) {
      if (!move || !move.id || !move.toKey) return;
      next = Lab.addColumn(next, move.toName, move.staffId);
      next = Lab.stageMove(next, move.id, move.toKey);
    });
    return next;
  }

  function usualGpPreviewCopy(safePlan, dayPhrase) {
    var plan = safePlan || {};
    var inN = Array.isArray(plan.sent) ? plan.sent.length : 0;
    var notInN = Array.isArray(plan.skippedNotIn) ? plan.skippedNotIn.length : 0;
    var unknownN = Array.isArray(plan.skippedUnknown) ? plan.skippedUnknown.length : 0;
    var ambN = Array.isArray(plan.skippedAmbiguous) ? plan.skippedAmbiguous.length : 0;
    var day = dayPhrase || 'that day';
    var parts = [];
    if (inN) {
      parts.push(inN + ' can go to their usual GP (session that day).');
    } else {
      parts.push('Nobody’s usual GP is on the book for ' + day + '.');
    }
    if (notInN) {
      parts.push(notInN + (notInN === 1 ? ' stays' : ' stay') + ' in the pile — those GPs are not in.');
    }
    if (unknownN) {
      parts.push(unknownN + (unknownN === 1 ? ' has' : ' have') + ' no usual GP on the request.');
    }
    if (ambN) {
      parts.push(ambN + (ambN === 1 ? ' stays' : ' stay') + ' — two staff match that name.');
    }
    return parts.join(' ');
  }

  function usualGpDestPhrase(plan) {
    var sent = plan && Array.isArray(plan.sent) ? plan.sent : [];
    if (!sent.length) return '';
    var bags = [];
    var index = {};
    sent.forEach(function (m) {
      if (!m || !m.toName) return;
      var key = m.toKey || Lab.clinicianColumnKey(m.toName);
      if (!index[key]) {
        index[key] = { name: m.toName, count: 0 };
        bags.push(index[key]);
      }
      index[key].count += 1;
      if (String(m.toName).length > String(index[key].name).length) index[key].name = m.toName;
    });
    bags.sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      var na = Lab.displayClinicianName(a.name).toLowerCase();
      var nb = Lab.displayClinicianName(b.name).toLowerCase();
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    });
    var n = sent.length;
    var noun = n === 1 ? 'prescription' : 'prescriptions';
    var bits = bags.map(function (b) {
      return b.count + ' with ' + Lab.displayClinicianName(b.name);
    });
    return n + ' ' + noun + ' would sit with their usual GP: ' + bits.join(', ') + '.';
  }

  var api = {
    itemCountsFromOverviewPayload: itemCountsFromOverviewPayload,
    regimenTotalsFromPayload: regimenTotalsFromPayload,
    fractionOrCount: fractionOrCount,
    rxMonitoringLine: rxMonitoringLine,
    complexityScore: complexityScore,
    isNonRoutineRxQueueSlug: isNonRoutineRxQueueSlug,
    isRoutineRxQueueSlug: isRoutineRxQueueSlug,
    isRxQueueSlug: isRxQueueSlug,
    queryStringForRxList: queryStringForRxList,
    dropQueryKeys: dropQueryKeys,
    rxListQueryPlan: rxListQueryPlan,
    inboxCountFromTaskListBridge: inboxCountFromTaskListBridge,
    visiblePileIdsFromTaskListBridge: visiblePileIdsFromTaskListBridge,
    rxEmptyPileReason: rxEmptyPileReason,
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
    planSendToUsualGp: planSendToUsualGp,
    applySendToUsualGp: applySendToUsualGp,
    usualGpPreviewCopy: usualGpPreviewCopy,
    usualGpDestPhrase: usualGpDestPhrase,
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
