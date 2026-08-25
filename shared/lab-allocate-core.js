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
//   - builds a clinician-column board and stages drag-and-drop moves
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
    if (row && row.requester) return clinicianColumnKey(row.requester);
    if (row && row.assignedTo) {
      return isTeamAssignee(row.assignedTo) ? inboxColumnKey(row.assignedTo) : clinicianColumnKey(row.assignedTo);
    }
    return UNALLOCATED;
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
    if (key === UNALLOCATED) return 'Unallocated';
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

  function buildBoard(rows, draft) {
    draft = draft || emptyDraft();
    rows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    var keys = {};
    keys[UNALLOCATED] = true;
    (draft.extraColumns || []).forEach(function (k) {
      keys[k] = true;
    });
    rows.forEach(function (row) {
      keys[homeColumnKey(row)] = true;
      keys[visualColumnKey(row, draft)] = true;
    });
    var clinician = [];
    var inboxes = [];
    Object.keys(keys).forEach(function (key) {
      if (key === UNALLOCATED) return;
      if (key.indexOf('inbox:') === 0) inboxes.push(key);
      else clinician.push(key);
    });
    clinician.sort();
    inboxes.sort();
    var order = [UNALLOCATED].concat(inboxes, clinician);
    var titles = Object.assign({}, draft.columnTitles || {});
    var columns = order.map(function (key) {
      var tiles = rows
        .filter(function (row) {
          return visualColumnKey(row, draft) === key;
        })
        .map(function (row) {
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
        });
      return {
        key: key,
        kind: key === UNALLOCATED ? 'unallocated' : key.indexOf('inbox:') === 0 ? 'inbox' : 'clinician',
        title: columnTitle(key, rows, titles),
        count: tiles.length,
        tiles: tiles,
      };
    });
    return { columns: columns, count: rows.length };
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
    draftSummary: draftSummary,
    copyList: copyList,
    canWriteAllocations: canWriteAllocations,
    createClient: createClient,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.LabAllocateCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
