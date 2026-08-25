// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — lab-result batch-allocation core (read + stage only).
//
// Incoming investigation-report tasks land in a shared inbox. The practice
// then allocates each one to the clinician who ordered the test. Today that
// is one-by-one on the Review Investigation Report screen (OIR card shows
// "Panel (Dr Name • date)", Next Steps includes "Reassign task").
//
// This core:
//   - reads a results-queue task-list (same envelopes as task-bulk-action)
//   - extracts a requester when the overview / OIR-style label actually
//     names one (never treats named GP as "who ordered")
//   - builds a reports-pool + clinician-chip workspace and stages moves
//
// WRITE CONTRACT: not captured. canWriteAllocations() is always false.
// Do not invent a reassign slug. Capture it live with
// scripts/lab-allocate-capture.js while reassigning one dummy result by hand.
//
// Dual-mode: module.exports for Node tests, window.LabAllocateCore in the
// content-script canvas. Pure: no DOM, no chrome.*, no fetch.

'use strict';

(function (global) {
  var UNALLOCATED = 'unallocated';
  var POOL = 'pool';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var RESULT_SLUG_RE = /investigation|result/i;
  var TEAM_ASSIGNEE_RE =
    /\b(team|inbox|results?|admin|reception|duty|triage|unassigned|unallocated|secretar|clerk|workflow|filing)\b/i;
  var TITLE_RE = /\b(dr|doctor|prof|professor|mr|mrs|ms|miss)\b\.?/g;
  var WRITE_BLOCKED =
    'Writing allocations to Medicus is not enabled. The Reassign-task endpoint has not been captured live — do not invent a slug. Use scripts/lab-allocate-capture.js while you reassign one result by hand, then we can wire Finalise.';

  // Field names seen on journal investigation-requests (`requestedBy`) plus
  // the usual GP-system aliases. Compared case-insensitively. A hit is
  // evidence of who ordered the test; namedGp is deliberately not in this set.
  var REQUESTER_KEYS = {
    requestedby: true,
    requestedbyname: true,
    requestedbydisplayname: true,
    requestingclinician: true,
    requestingclinicianname: true,
    requestingpractitioner: true,
    requestinguser: true,
    requestedbyuser: true,
    requestingdoctor: true,
    orderedby: true,
    orderedbyname: true,
    orderedbyclinician: true,
    requestor: true,
    requester: true,
  };

  var SKIP_WALK_KEYS = {
    resultvalue: true,
    resulttext: true,
    previousresults: true,
    referenceranges: true,
    nhsnumber: true,
    dateofbirth: true,
  };

  var MONTHS = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };

  function isStr(v) {
    return typeof v === 'string';
  }

  function clip(s, n) {
    var t = String(s == null ? '' : s)
      .replace(/\s+/g, ' ')
      .trim();
    return t.length > n ? t.slice(0, n) : t;
  }

  function isResultsQueueSlug(slug) {
    return RESULT_SLUG_RE.test(String(slug || ''));
  }

  function parseResultsQueueRoute(pathname, search) {
    void search;
    var path = String(pathname == null ? '' : pathname);
    var m = path.match(/^\/?([0-9a-z]{2,})\/tasks\/(?:data\/)?([^/]+)\/task-list\/?$/i);
    if (!m) return null;
    var slug = m[2];
    if (!isResultsQueueSlug(slug)) return null;
    return {
      siteId: m[1],
      slug: slug,
      apiBase: 'https://' + m[1] + '.api.england.medicus.health',
    };
  }

  function altSlug(slug) {
    var s = String(slug || '');
    if (!s) return '';
    var swapped = s.indexOf('_') >= 0 ? s.replace(/_/g, '-') : s.replace(/-/g, '_');
    return swapped === s ? '' : swapped;
  }

  function extractTaskArray(body) {
    if (!body) return [];
    if (Array.isArray(body)) return body;
    if (Array.isArray(body.tasks)) return body.tasks;
    if (Array.isArray(body.results)) return body.results;
    if (Array.isArray(body.rows)) return body.rows;
    if (body.data && Array.isArray(body.data.tasks)) return body.data.tasks;
    if (Array.isArray(body.data)) return body.data;
    return [];
  }

  function pickTaskId(item) {
    if (!item || typeof item !== 'object') return '';
    var keys = ['taskUuid', 'taskId', 'id', 'uuid'];
    for (var i = 0; i < keys.length; i++) {
      var v = item[keys[i]];
      if (isStr(v) && UUID_RE.test(v)) return v;
    }
    return '';
  }

  function overviewUrlFor(item, slug) {
    var raw = item && isStr(item.overviewURL) ? item.overviewURL : '';
    if (raw && raw.indexOf('/tasks/data/') === 0 && raw.indexOf('/overview/') !== -1 && raw.indexOf('://') === -1) {
      return raw;
    }
    var id = pickTaskId(item);
    if (!id || !slug) return '';
    return '/tasks/data/' + slug + '/overview/' + id;
  }

  function isTeamAssignee(name) {
    var s = String(name || '').trim();
    if (!s) return false;
    return TEAM_ASSIGNEE_RE.test(s);
  }

  function normClinicianName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(TITLE_RE, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sameClinician(a, b) {
    var na = normClinicianName(a);
    var nb = normClinicianName(b);
    return !!na && na === nb;
  }

  function clinicianColumnKey(name) {
    var n = normClinicianName(name);
    return n ? 'clinician:' + n : UNALLOCATED;
  }

  function inboxColumnKey(name) {
    var n = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    return n ? 'inbox:' + n : UNALLOCATED;
  }

  function parseRequestLabel(text) {
    var raw = text == null ? '' : String(text).replace(/\s+/g, ' ').trim();
    var out = { name: null, requester: null, requestedDate: null, raw: raw };
    if (!raw) return out;
    var open = raw.lastIndexOf('(');
    if (open > 0) {
      out.name = raw.slice(0, open).trim() || null;
      var inner = raw.slice(open + 1).replace(/\)\s*$/, '');
      var bullet = inner.indexOf('•');
      out.requester = (bullet !== -1 ? inner.slice(0, bullet) : inner).trim() || null;
      var dm = inner.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
      if (dm) {
        var mon = MONTHS[dm[2].toLowerCase()];
        if (mon) out.requestedDate = dm[3] + '-' + mon + '-' + dm[1].padStart(2, '0');
      }
    } else {
      out.name = raw;
    }
    return out;
  }

  function nameFromUnknown(v) {
    if (isStr(v)) {
      var s = clip(v, 80);
      return s || null;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      var cand = v.name || v.displayName || v.fullName || v.label || v.value;
      return isStr(cand) ? clip(cand, 80) || null : null;
    }
    return null;
  }

  function pickRequesterFromOverview(payload) {
    var found = [];
    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 8) return;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length && i < 80; i++) {
          if (isStr(node[i]) && node[i].indexOf('•') !== -1) {
            var parsed = parseRequestLabel(node[i]);
            if (parsed.requester) found.push({ name: clip(parsed.requester, 80), source: 'oir-label' });
          } else {
            walk(node[i], depth + 1);
          }
        }
        return;
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length && k < 80; k++) {
        var key = keys[k];
        var lk = key.toLowerCase();
        if (SKIP_WALK_KEYS[lk]) continue;
        var val = node[key];
        if (REQUESTER_KEYS[lk]) {
          var name = nameFromUnknown(val);
          if (name) found.push({ name: name, source: key });
        } else {
          walk(val, depth + 1);
        }
      }
    }
    walk(payload, 0);
    if (!found.length) return null;
    var first = found[0];
    return { name: first.name, source: first.source, confidence: 'requester' };
  }

  function normaliseTaskRow(item, slug) {
    if (!item || typeof item !== 'object') return null;
    var id = pickTaskId(item);
    if (!id) return null;
    var assignedTo = isStr(item.assignedTo) ? clip(item.assignedTo, 80) : '';
    var namedGp = isStr(item.namedGp) ? clip(item.namedGp, 80) : '';
    var summary = isStr(item.summary)
      ? clip(item.summary, 120)
      : isStr(item.summaryLabel)
        ? clip(item.summaryLabel, 120)
        : '';
    return {
      id: id,
      patientName: isStr(item.patientName) ? clip(item.patientName, 80) : 'Unknown',
      summary: summary,
      assignedTo: assignedTo,
      assignedId: isStr(item.assignedId) ? clip(item.assignedId, 80) : '',
      status: isStr(item.status) ? clip(item.status, 60) : isStr(item.statusValue) ? clip(item.statusValue, 60) : '',
      statusText: isStr(item.statusText) ? clip(item.statusText, 80) : '',
      namedGp: namedGp,
      namedGpId: isStr(item.namedGpId) ? clip(item.namedGpId, 80) : '',
      createdAt: isStr(item.createdAt) ? clip(item.createdAt, 40) : '',
      overviewURL: overviewUrlFor(item, slug),
      requester: null,
      requesterSource: '',
      requesterConfidence: '',
    };
  }

  function applyRequester(row, hint) {
    if (!row) return row;
    if (!hint || !hint.name) return row;
    row.requester = clip(hint.name, 80);
    row.requesterSource = hint.source || '';
    row.requesterConfidence = hint.confidence || 'requester';
    return row;
  }

  function homeColumnKey(row) {
    // Already sitting with a named person in Medicus — show on their chip.
    // Requester evidence does NOT auto-place: those stay in the reports pool,
    // grouped by who ordered, until someone stages them onto a chip.
    if (row && row.assignedTo && !isTeamAssignee(row.assignedTo)) {
      var key = clinicianColumnKey(row.assignedTo);
      // A name that normalises to nothing has no chip to sit on — pool it
      // rather than parking it on a key no column renders.
      if (key !== UNALLOCATED) return key;
    }
    return POOL;
  }

  function placementReason(row) {
    if (row && row.requester) return 'requester';
    if (row && row.assignedTo && !isTeamAssignee(row.assignedTo)) return 'current-assignee';
    if (row && row.assignedTo && isTeamAssignee(row.assignedTo)) return 'inbox';
    return 'unallocated';
  }

  function emptyDraft() {
    return { moves: {}, extraColumns: [], columnTitles: {} };
  }

  function cloneDraft(draft) {
    return {
      moves: Object.assign({}, (draft && draft.moves) || {}),
      extraColumns: ((draft && draft.extraColumns) || []).slice(),
      columnTitles: Object.assign({}, (draft && draft.columnTitles) || {}),
    };
  }

  function columnTitle(key, rows, titles) {
    if (titles && titles[key]) return titles[key];
    if (key === POOL || key === UNALLOCATED) return 'Investigation reports';
    if (key.indexOf('inbox:') === 0) {
      for (var i = 0; i < rows.length; i++) {
        if (inboxColumnKey(rows[i].assignedTo) === key) return rows[i].assignedTo || 'Inbox';
      }
      return 'Inbox';
    }
    if (key.indexOf('clinician:') === 0) {
      for (var j = 0; j < rows.length; j++) {
        var r = rows[j];
        if (r.requester && clinicianColumnKey(r.requester) === key) return r.requester;
        if (r.assignedTo && !isTeamAssignee(r.assignedTo) && clinicianColumnKey(r.assignedTo) === key) {
          return r.assignedTo;
        }
      }
      return key.slice('clinician:'.length);
    }
    return key;
  }

  function addColumn(draft, name) {
    var next = cloneDraft(draft);
    var key = clinicianColumnKey(name);
    if (key === UNALLOCATED) return next;
    if (next.extraColumns.indexOf(key) === -1) next.extraColumns.push(key);
    next.columnTitles[key] = clip(name, 80);
    return next;
  }

  function stageMove(draft, taskId, toKey) {
    var next = cloneDraft(draft);
    if (!taskId || !toKey) return next;
    next.moves[taskId] = toKey;
    return next;
  }

  function stageMoves(draft, taskIds, toKey) {
    var next = draft || emptyDraft();
    (Array.isArray(taskIds) ? taskIds : []).forEach(function (id) {
      next = stageMove(next, id, toKey);
    });
    return next;
  }

  function visualColumnKey(row, draft) {
    var staged = draft && draft.moves && draft.moves[row.id];
    return staged || homeColumnKey(row);
  }

  function isClinicianKey(key) {
    return typeof key === 'string' && key.indexOf('clinician:') === 0;
  }

  function tileFromRow(row, draft, key) {
    return {
      id: row.id,
      patientName: row.patientName,
      summary: row.summary,
      assignedTo: row.assignedTo,
      namedGp: row.namedGp,
      statusText: row.statusText || row.status,
      requester: row.requester,
      requesterSource: row.requesterSource,
      createdAt: row.createdAt,
      overviewURL: row.overviewURL,
      homeKey: homeColumnKey(row),
      columnKey: key,
      staged: !!(draft.moves && draft.moves[row.id] && draft.moves[row.id] !== homeColumnKey(row)),
      reason: placementReason(row),
    };
  }

  function tilesOnKey(rows, draft, key) {
    return rows
      .filter(function (row) {
        return visualColumnKey(row, draft) === key;
      })
      .map(function (row) {
        return tileFromRow(row, draft, key);
      });
  }

  function collectClinicianKeys(rows, draft) {
    var seen = {};
    var titles = Object.assign({}, (draft && draft.columnTitles) || {});
    function remember(key, title) {
      if (!isClinicianKey(key)) return;
      seen[key] = true;
      if (title && !titles[key]) titles[key] = clip(title, 80);
    }
    ((draft && draft.extraColumns) || []).forEach(function (k) {
      remember(k, titles[k]);
    });
    rows.forEach(function (row) {
      if (row.requester) remember(clinicianColumnKey(row.requester), row.requester);
      if (row.assignedTo && !isTeamAssignee(row.assignedTo)) {
        remember(clinicianColumnKey(row.assignedTo), row.assignedTo);
      }
      remember(visualColumnKey(row, draft), null);
    });
    return { keys: Object.keys(seen).sort(), titles: titles };
  }

  function buildBoard(rows, draft) {
    draft = draft || emptyDraft();
    rows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    var collected = collectClinicianKeys(rows, draft);
    var titles = collected.titles;
    var onChip = {};
    collected.keys.forEach(function (key) {
      onChip[key] = true;
    });
    // The pool is the catch-all. Every row is either on a clinician chip or
    // in here — a result must never fall off the board.
    var poolTiles = rows
      .filter(function (row) {
        return !onChip[visualColumnKey(row, draft)];
      })
      .map(function (row) {
        return tileFromRow(row, draft, POOL);
      });
    var pool = {
      key: POOL,
      kind: 'pool',
      title: columnTitle(POOL, rows, titles),
      count: poolTiles.length,
      tiles: poolTiles,
      groups: groupTiles(poolTiles),
    };
    var clinicians = collected.keys.map(function (key) {
      var tiles = tilesOnKey(rows, draft, key);
      var stagedCount = 0;
      var assignedCount = 0;
      tiles.forEach(function (t) {
        if (t.staged) stagedCount++;
        else assignedCount++;
      });
      return {
        key: key,
        kind: 'clinician',
        title: columnTitle(key, rows, titles),
        count: tiles.length,
        stagedCount: stagedCount,
        assignedCount: assignedCount,
        tiles: tiles,
        groups: groupTiles(tiles),
      };
    });
    return {
      pool: pool,
      clinicians: clinicians,
      columns: [pool].concat(clinicians),
      count: rows.length,
    };
  }

  function buildWorkspace(rows, draft) {
    return buildBoard(rows, draft);
  }

  function draftSummary(rows, draft) {
    draft = draft || emptyDraft();
    rows = Array.isArray(rows) ? rows : [];
    var items = [];
    Object.keys(draft.moves || {}).forEach(function (id) {
      var row = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].id === id) {
          row = rows[i];
          break;
        }
      }
      if (!row) return;
      var from = homeColumnKey(row);
      var to = draft.moves[id];
      if (!to || to === from) return;
      items.push({
        id: id,
        patientName: row.patientName,
        summary: row.summary,
        fromKey: from,
        toKey: to,
        fromTitle: columnTitle(from, rows, draft.columnTitles),
        toTitle: columnTitle(to, rows, draft.columnTitles),
        text: (row.patientName || 'Unknown') + ' → ' + columnTitle(to, rows, draft.columnTitles),
      });
    });
    return { items: items, count: items.length };
  }

  function copyList(board) {
    var lines = [];
    (board && board.columns ? board.columns : []).forEach(function (col) {
      lines.push(col.title + ' (' + col.count + ')');
      (col.tiles || []).forEach(function (t) {
        var hint = t.requester
          ? ' · ordered by ' + t.requester
          : t.namedGp
            ? ' · registered GP ' + t.namedGp + ' (not confirmed as the requester)'
            : '';
        var staged = t.staged ? ' · staged on this canvas only' : '';
        lines.push('  - ' + (t.patientName || 'Unknown') + (t.summary ? ' · ' + t.summary : '') + hint + staged);
      });
      lines.push('');
    });
    lines.push('Not written to Medicus. This is a working list from the allocation canvas.');
    return lines.join('\n').trim();
  }

  function canWriteAllocations() {
    return { ok: false, reason: WRITE_BLOCKED };
  }

  var UNKNOWN_GROUP = 'unknown';
  var LEAVE_TYPE_LABEL = {
    annual: 'annual leave',
    study: 'study leave',
    toil: 'TOIL',
    cpd: 'CPD',
    sick: 'sickness',
    parental: 'parental leave',
    other: 'leave',
  };

  function todayISO() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  function formatLeaveDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return m[3].replace(/^0/, '') + ' ' + (months[+m[2] - 1] || '?') + ' ' + m[1];
  }

  function requesterGroupKey(tile) {
    if (tile && tile.requester) return clinicianColumnKey(tile.requester);
    return UNKNOWN_GROUP;
  }

  function groupTiles(tiles) {
    var map = {};
    var order = [];
    (Array.isArray(tiles) ? tiles : []).forEach(function (tile) {
      if (!tile) return;
      var key = requesterGroupKey(tile);
      if (!map[key]) {
        map[key] = {
          key: key,
          requester: tile.requester || '',
          known: key !== UNKNOWN_GROUP,
          tileIds: [],
          tiles: [],
        };
        order.push(key);
      }
      map[key].tileIds.push(tile.id);
      map[key].tiles.push(tile);
    });
    return order
      .map(function (key) {
        var g = map[key];
        g.count = g.tiles.length;
        g.label = g.known
          ? 'Requested by ' + g.requester + ' · ' + g.count + ' result' + (g.count === 1 ? '' : 's')
          : 'Who requested unknown · ' + g.count + ' result' + (g.count === 1 ? '' : 's');
        g.dragHint = g.known
          ? 'Drag this group onto that clinician’s chip'
          : 'Cannot auto-group — who requested is missing';
        return g;
      })
      .sort(function (a, b) {
        if (a.known !== b.known) return a.known ? -1 : 1;
        return b.count - a.count;
      });
  }

  function dragPreview(rows, ids) {
    var idSet = {};
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      idSet[id] = true;
    });
    var picked = (Array.isArray(rows) ? rows : []).filter(function (r) {
      return r && idSet[r.id];
    });
    var requesters = [];
    var unknown = 0;
    picked.forEach(function (r) {
      if (r.requester) {
        var seen = false;
        for (var i = 0; i < requesters.length; i++) {
          if (sameClinician(requesters[i], r.requester)) seen = true;
        }
        if (!seen) requesters.push(r.requester);
      } else unknown++;
    });
    var mixed = requesters.length > 1 || (requesters.length > 0 && unknown > 0);
    var requester = !mixed && requesters.length === 1 ? requesters[0] : '';
    var count = picked.length;
    var label;
    if (!count) label = 'No results';
    else if (requester) label = count + ' result' + (count === 1 ? '' : 's') + ' ordered by ' + requester;
    else if (!requesters.length) label = count + ' result' + (count === 1 ? '' : 's') + ' — who ordered unknown';
    else label = count + ' results from mixed requesters';
    return {
      count: count,
      requester: requester,
      mixed: mixed,
      unknown: unknown,
      canGroup: !!requester && count > 1,
      label: label,
    };
  }

  function matchStaffByName(staffList, name) {
    var list = Array.isArray(staffList) ? staffList : [];
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!s || s.notAPerson) continue;
      if (sameClinician(s.name, name) || sameClinician(s.medicusName, name)) hits.push(s);
    }
    if (hits.length === 1) return hits[0];
    return null;
  }

  function leaveOnDate(leaveList, staffId, dateISO, status) {
    var list = Array.isArray(leaveList) ? leaveList : [];
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      if (!l || l.staffId !== staffId) continue;
      if (status && l.status !== status) continue;
      if (l.startDate <= dateISO && l.endDate >= dateISO) return l;
    }
    return null;
  }

  function absenceForName(staffList, leaveList, name, dateISO) {
    var when = dateISO || todayISO();
    var who = clip(name, 80);
    if (!who || clinicianColumnKey(who) === UNALLOCATED) {
      return { state: 'n/a', reason: 'not-a-person', label: '', staff: null, leave: null };
    }
    if (!Array.isArray(staffList) || !staffList.length) {
      return {
        state: 'unknown',
        reason: 'no-rota',
        label: 'Absence unknown — this machine has no rota staff list, so we cannot see who is away.',
        staff: null,
        leave: null,
      };
    }
    var staff = matchStaffByName(staffList, who);
    if (!staff) {
      return {
        state: 'unknown',
        reason: 'no-match',
        label: 'Absence unknown — no rota row matches ' + who + '.',
        staff: null,
        leave: null,
      };
    }
    var approved = leaveOnDate(leaveList, staff.id, when, 'approved');
    var requested = approved ? null : leaveOnDate(leaveList, staff.id, when, 'requested');
    var rec = approved || requested;
    if (rec) {
      var type = LEAVE_TYPE_LABEL[rec.type] || 'leave';
      var until = formatLeaveDate(rec.endDate);
      return {
        state: approved ? 'away' : 'away-pending',
        reason: approved ? 'approved' : 'requested',
        type: rec.type || '',
        until: rec.endDate || '',
        label:
          who +
          ' is on ' +
          type +
          (until ? ' until ' + until : '') +
          (approved ? '' : ' (requested, not yet approved)') +
          '.',
        staff: staff,
        leave: rec,
      };
    }
    return { state: 'present', reason: 'in', label: '', staff: staff, leave: null };
  }

  function shouldWarnAbsence(absence) {
    if (!absence) return false;
    return absence.state === 'away' || absence.state === 'away-pending' || absence.state === 'unknown';
  }

  function absenceWarningCopy(absence, count, clinicianName) {
    var n = Number(count) || 0;
    var noun = n === 1 ? '1 result' : n + ' results';
    var who = clip(clinicianName, 80) || 'this clinician';
    if (!absence || absence.state === 'present' || absence.state === 'n/a') return '';
    if (absence.state === 'away') {
      return (
        absence.label +
        ' Staging ' +
        noun +
        ' onto ' +
        who +
        ' does not mean they will see them today. They will sit until that person is back, unless someone else files them.'
      );
    }
    if (absence.state === 'away-pending') {
      return (
        absence.label +
        ' Staging ' +
        noun +
        ' onto ' +
        who +
        ' still risks them being away — the leave is requested, not yet approved.'
      );
    }
    return (
      absence.label +
      ' Staging ' +
      noun +
      ' onto ' +
      who +
      ' does not mean they are in today. Absence was not checked against a matching rota row.'
    );
  }

  function createClient(apiBase, deps) {
    deps = deps || {};
    var fetchImpl = deps.fetchImpl;
    if (!apiBase) throw new Error('lab-allocate: apiBase required');

    function url(path) {
      return String(apiBase).replace(/\/$/, '') + path;
    }

    async function getJson(path) {
      var fn = fetchImpl || fetch;
      var resp = await fn(url(path), {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json, text/plain, */*' },
      });
      if (!resp.ok) {
        var err = new Error('HTTP ' + resp.status);
        err.status = resp.status;
        throw err;
      }
      var text = await resp.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error('Task list returned an unexpected response.');
      }
    }

    async function fetchTaskList(slug) {
      var tried = [slug];
      var alt = altSlug(slug);
      if (alt) tried.push(alt);
      var lastErr = null;
      for (var i = 0; i < tried.length; i++) {
        try {
          var body = await getJson('/tasks/data/' + tried[i] + '/task-list');
          return {
            slug: tried[i],
            body: body,
            rows: extractTaskArray(body)
              .map(function (item) {
                return normaliseTaskRow(item, tried[i]);
              })
              .filter(Boolean),
          };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('Could not read the results queue.');
    }

    async function fetchOverview(overviewURL) {
      if (
        typeof overviewURL !== 'string' ||
        overviewURL.indexOf('/tasks/data/') !== 0 ||
        overviewURL.indexOf('/overview/') === -1 ||
        overviewURL.indexOf('://') !== -1 ||
        overviewURL.indexOf('..') !== -1
      ) {
        throw new Error('bad overviewURL');
      }
      return getJson(overviewURL);
    }

    return { fetchTaskList: fetchTaskList, fetchOverview: fetchOverview };
  }

  var api = {
    UNALLOCATED: UNALLOCATED,
    POOL: POOL,
    WRITE_BLOCKED: WRITE_BLOCKED,
    isResultsQueueSlug: isResultsQueueSlug,
    parseResultsQueueRoute: parseResultsQueueRoute,
    altSlug: altSlug,
    extractTaskArray: extractTaskArray,
    pickTaskId: pickTaskId,
    overviewUrlFor: overviewUrlFor,
    isTeamAssignee: isTeamAssignee,
    normClinicianName: normClinicianName,
    sameClinician: sameClinician,
    clinicianColumnKey: clinicianColumnKey,
    inboxColumnKey: inboxColumnKey,
    parseRequestLabel: parseRequestLabel,
    pickRequesterFromOverview: pickRequesterFromOverview,
    normaliseTaskRow: normaliseTaskRow,
    applyRequester: applyRequester,
    homeColumnKey: homeColumnKey,
    placementReason: placementReason,
    emptyDraft: emptyDraft,
    addColumn: addColumn,
    stageMove: stageMove,
    stageMoves: stageMoves,
    buildBoard: buildBoard,
    buildWorkspace: buildWorkspace,
    draftSummary: draftSummary,
    copyList: copyList,
    canWriteAllocations: canWriteAllocations,
    todayISO: todayISO,
    formatLeaveDate: formatLeaveDate,
    requesterGroupKey: requesterGroupKey,
    groupTiles: groupTiles,
    dragPreview: dragPreview,
    matchStaffByName: matchStaffByName,
    leaveOnDate: leaveOnDate,
    absenceForName: absenceForName,
    shouldWarnAbsence: shouldWarnAbsence,
    absenceWarningCopy: absenceWarningCopy,
    createClient: createClient,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.LabAllocateCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
