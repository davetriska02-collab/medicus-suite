// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — lab-result batch-allocation core (read, stage, then write).
//
// Incoming investigation-report tasks land in a shared inbox. The practice
// then allocates each one to the clinician who ordered the test. Today that
// is one-by-one on the Review Investigation Report screen (OIR card shows
// "Panel (Dr Name • date)", Next Steps includes "Reassign task").
//
// This core:
//   - reads a results-queue task-list (same envelopes as task-bulk-action)
//   - extracts a requester when the task-list Requested By column or an
//     overview / OIR-style label actually names one (never treats named GP
//     as "who ordered"; never treats the lab/org requester object as a GP)
//   - builds an unallocated-reports pool + clinician-field workspace and stages moves
//   - writes via Medicus's own bulk-reassign (captured 2026-08-25)
//
// WRITE CONTRACT (live capture 2026-08-25T10:23Z, Investigation Results;
//   404-fixed v3.243.3):
//   POST /tasks/{slug}/task-list/bulk-reassign
//     fallback on HTTP 404: POST /tasks/task-list/bulk-reassign
//     (the capture wrote the fallback as a literal; live write 404'd there
//     because Medicus nests the queue slug on every other task write —
//     GET is /tasks/data/{slug}/task-list, POST drops /data/ and keeps slug.)
//   keys (only these four — do not invent extras):
//     assigneeId, assigneeType, taskList, taskIds
//   assigneeType is "staff" or "team" (sibling-confirmed on create-task
//   writes). People are the usual drop; teams come from assigneeOptions.teams.
//   taskList is a string: the GET envelope token when it is a string, else
//   the queue slug already in the URL (same identifier as the GET). An
//   object token is not posted as-is — Medicus 404s looking that up.
//   Destinations without a unique staff UUID are refused, not guessed.
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
    /\b(team|inbox|results?|reports?|investigation|admin|reception|duty|triage|unassigned|unallocated|secretar|clerk|workflow|filing|prescription|requests?)\b/i;
  var TITLE_RE = /\b(dr|doctor|prof|professor|mr|mrs|ms|miss)\b\.?/g;
  var ROLE_TOKENS = {
    gp: true,
    partner: true,
    locum: true,
    salaried: true,
    nurse: true,
    anp: true,
    pharmacist: true,
    registrar: true,
    consultant: true,
    hca: true,
    paramedic: true,
    receptionist: true,
    secretary: true,
    manager: true,
    dispenser: true,
    phlebotomist: true,
    hcsw: true,
    fy1: true,
    fy2: true,
    st1: true,
    st2: true,
    st3: true,
    st4: true,
    gpst: true,
    f1: true,
    f2: true,
    trainee: true,
    associate: true,
  };
  var ASSIGNEE_TYPE_STAFF = 'staff';
  var ASSIGNEE_TYPE_TEAM = 'team';
  var BULK_REASSIGN_PATH = '/tasks/task-list/bulk-reassign';
  var SLUG_RE = /^[a-zA-Z0-9_-]+$/;
  var WRITE_NEEDS_TOKEN =
    'Need Medicus’s queue token before anything can be written. Reload the results list and open the canvas again.';
  var WRITE_BLOCKED = WRITE_NEEDS_TOKEN;

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

  function sanitizeSlug(slug) {
    var s = String(slug || '').trim();
    return SLUG_RE.test(s) ? s : '';
  }

  // Page query string only — the filters the results queue is already showing
  // (masterAssignee, statuses[], …). Reject anything that looks like a path
  // or host so it cannot be smuggled into the GET.
  function queryStringForList(search, opts) {
    var raw = String(search == null ? '' : search).trim();
    if (!raw) return '';
    if (raw.charAt(0) === '?') raw = raw.slice(1);
    if (!raw) return '';
    if (/[:/\\]/.test(raw)) return '';
    if (!/^[A-Za-z0-9._~%+\-\[\]=&,]+$/.test(raw)) return '';
    // The allocation board must see work already sitting with people, not
    // only the current inbox filter. masterAssignee on the page URL is that
    // filter — keep statuses/viewContext, drop the assignee scope.
    var keepAssignee = opts && opts.keepMasterAssignee;
    var kept = raw.split('&').filter(function (part) {
      if (!part) return false;
      var k = part.split('=')[0];
      try {
        k = decodeURIComponent(k);
      } catch (_) {}
      if (keepAssignee) return true;
      return !/^masterAssignee/i.test(k);
    });
    return kept.length ? '?' + kept.join('&') : '';
  }

  function parseResultsQueueRoute(pathname, search) {
    var path = String(pathname == null ? '' : pathname);
    var m = path.match(/^\/?([0-9a-z]{2,})\/tasks\/(?:data\/)?([^/]+)\/task-list\/?$/i);
    if (!m) return null;
    var slug = m[2];
    if (!isResultsQueueSlug(slug)) return null;
    return {
      siteId: m[1],
      slug: slug,
      search: queryStringForList(search),
      apiBase: 'https://' + m[1] + '.api.england.medicus.health',
    };
  }

  // Live write 404'd on the capture's literal `/tasks/task-list/bulk-reassign`.
  // Sibling task writes nest the queue slug; try that first, then the literal.
  function bulkReassignPaths(slug) {
    var s = sanitizeSlug(slug);
    var paths = [];
    var seen = {};
    function add(p) {
      if (!p || seen[p]) return;
      seen[p] = true;
      paths.push(p);
    }
    if (s) add('/tasks/' + s + '/task-list/bulk-reassign');
    var alt = sanitizeSlug(altSlug(s));
    if (alt) add('/tasks/' + alt + '/task-list/bulk-reassign');
    add(BULK_REASSIGN_PATH);
    return paths;
  }

  // Body.taskList must be a string identifier. An object from the GET envelope
  // is not posted as-is (that 404s). Prefer a string token; otherwise the
  // queue slug already in the URL — not a guessed list.
  function coerceTaskListToken(taskList, slug) {
    if (typeof taskList === 'string') {
      var trimmed = taskList.trim();
      if (trimmed) return trimmed;
    }
    if (taskList && typeof taskList === 'object' && !Array.isArray(taskList)) {
      var keys = ['taskList', 'slug', 'taskListSlug', 'value', 'name', 'type'];
      for (var i = 0; i < keys.length; i++) {
        var v = taskList[keys[i]];
        if (typeof v === 'string' && sanitizeSlug(v.trim())) return v.trim();
      }
    }
    return sanitizeSlug(slug) || undefined;
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
    if (Array.isArray(body.items)) return body.items;
    if (Array.isArray(body.results)) return body.results;
    if (Array.isArray(body.rows)) return body.rows;
    if (Array.isArray(body.taskList)) return body.taskList;
    if (body.taskList && Array.isArray(body.taskList.tasks)) return body.taskList.tasks;
    if (body.data && Array.isArray(body.data.tasks)) return body.data.tasks;
    if (body.data && Array.isArray(body.data.items)) return body.data.items;
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

  // One person, several wire formats: task-list Requested By "AZADIAN N" /
  // "TRISKA D", appointment book "Dr Natalie Azadian", staffOptions often
  // "Triska, David" (surname, forename) or "Triska David". Canonical form is
  // "surname|initial" — "triska|d" from each — so chips and the write agree.
  // A bare surname ("Triska") keys as "triska" and matches any initial.
  // Known limit: two clinicians sharing surname AND first initial would
  // merge on the board. The write refuses that destination unless the
  // staff directory has exactly one UUID for the chip.
  function stripRoleTokens(n) {
    var toks = String(n || '')
      .split(' ')
      .filter(Boolean);
    while (toks.length > 1 && ROLE_TOKENS[toks[toks.length - 1]]) toks.pop();
    return toks.join(' ');
  }

  function personNameKey(name) {
    var raw = String(name == null ? '' : name).trim();
    var comma = raw.indexOf(',');
    if (comma > 0) {
      var sur = stripRoleTokens(normClinicianName(raw.slice(0, comma)));
      var rest = stripRoleTokens(normClinicianName(raw.slice(comma + 1)));
      if (sur && rest) {
        var first = rest.split(' ')[0];
        if (first) return sur + '|' + first.charAt(0);
      }
    }
    var n = stripRoleTokens(normClinicianName(raw));
    if (!n) return '';
    var toks = n.split(' ');
    if (toks.length === 1) return toks[0];
    var last = toks[toks.length - 1];
    if (last.length === 1) return toks.slice(0, -1).join(' ') + '|' + last;
    return toks.slice(1).join(' ') + '|' + toks[0].charAt(0);
  }

  function personNameKeys(name) {
    var primary = personNameKey(name);
    var out = [];
    if (primary) out.push(primary);
    var n = stripRoleTokens(normClinicianName(name));
    var toks = n.split(' ').filter(Boolean);
    if (toks.length === 2 && toks[0].length > 1 && toks[1].length > 1) {
      var swapped = toks[0] + '|' + toks[1].charAt(0);
      if (out.indexOf(swapped) === -1) out.push(swapped);
    }
    return out;
  }

  function nameKeysOverlap(a, b) {
    var i;
    var j;
    for (i = 0; i < a.length; i++) {
      for (j = 0; j < b.length; j++) {
        if (a[i] === b[j]) return true;
        var sa = String(a[i] || '').split('|');
        var sb = String(b[j] || '').split('|');
        if (sa[0] && sa[0] === sb[0] && (sa.length === 1 || sb.length === 1)) return true;
      }
    }
    return false;
  }

  function samePerson(a, b) {
    return nameKeysOverlap(personNameKeys(a), personNameKeys(b));
  }

  function sameClinician(a, b) {
    var na = normClinicianName(a);
    var nb = normClinicianName(b);
    if (!!na && na === nb) return true;
    return samePerson(a, b);
  }

  // Chip merge must not use a bare surname as a bridge: "Triska" matches
  // both David and Jane, and unioning those would collapse two people.
  // Initialed keys ("triska|d") have to overlap.
  function initialedNameKeys(name) {
    return personNameKeys(name).filter(function (k) {
      return String(k).indexOf('|') !== -1;
    });
  }

  function sameClusterPerson(a, b) {
    var ka = initialedNameKeys(a);
    var kb = initialedNameKeys(b);
    if (ka.length && kb.length) return nameKeysOverlap(ka, kb);
    return sameClinician(a, b);
  }

  function gatherPersonNames(rows, draft) {
    var names = [];
    var seen = {};
    function add(n) {
      n = String(n || '').trim();
      if (!n || isTeamAssignee(n)) return;
      var k = n.toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      names.push(n);
    }
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row) return;
      add(row.assignedTo);
      add(row.requester);
    });
    var titles = (draft && draft.columnTitles) || {};
    Object.keys(titles).forEach(function (key) {
      add(titles[key]);
    });
    return names;
  }

  function clusterPersonNames(names) {
    var clusters = [];
    (names || []).forEach(function (n) {
      var hits = [];
      for (var i = 0; i < clusters.length; i++) {
        for (var j = 0; j < clusters[i].length; j++) {
          if (sameClusterPerson(n, clusters[i][j])) {
            hits.push(i);
            break;
          }
        }
      }
      if (!hits.length) {
        clusters.push([n]);
        return;
      }
      var base = hits[0];
      clusters[base].push(n);
      for (var h = hits.length - 1; h >= 1; h--) {
        clusters[base] = clusters[base].concat(clusters[hits[h]]);
        clusters.splice(hits[h], 1);
      }
    });
    return clusters;
  }

  function pickCanonicalPersonKey(names) {
    var best = '';
    var bestScore = -1;
    (names || []).forEach(function (n) {
      var key = personNameKey(n);
      if (!key) return;
      var toks = stripRoleTokens(normClinicianName(n)).split(' ').filter(Boolean);
      var score = scoreStaffName(n);
      if (toks.length && toks[toks.length - 1].length === 1) score += 10000;
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    });
    return best;
  }

  function buildClinicianAliases(rows, draft) {
    var aliases = {};
    clusterPersonNames(gatherPersonNames(rows, draft)).forEach(function (cluster) {
      var canon = pickCanonicalPersonKey(cluster);
      if (!canon) return;
      cluster.forEach(function (n) {
        var pk = personNameKey(n);
        if (pk) aliases[pk] = canon;
        personNameKeys(n).forEach(function (k) {
          aliases[k] = canon;
        });
      });
    });
    return aliases;
  }

  function remapClinicianKey(key, aliases) {
    if (!key || String(key).indexOf('clinician:') !== 0) return key;
    var n = String(key).slice('clinician:'.length);
    if (aliases && aliases[n] && aliases[n] !== n) return 'clinician:' + aliases[n];
    return key;
  }

  function clinicianKeyForName(name, aliases) {
    return remapClinicianKey(clinicianColumnKey(name), aliases);
  }

  // Title-case an ALL-CAPS wire token for display ("AZADIAN N" → "Azadian N").
  // Mixed-case names pass through untouched.
  function displayClinicianName(name) {
    return String(name || '').replace(/\b([A-Z])([A-Z]+)\b/g, function (_, first, rest) {
      return first + rest.toLowerCase();
    });
  }

  function clinicianColumnKey(name) {
    var n = personNameKey(name);
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

  // Live overview `investigationReport.requester` is the sending lab/org,
  // not the GP who ordered the test. practitionerName on that object is
  // still the lab side — do not promote it.
  function isOrgRequester(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    return !!(v.organisationName || v.organisationOdsCode);
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
          // Lab/org requester { organisationName, organisationOdsCode,
          // departmentName, practitionerName } is who the lab thinks
          // requested the test — not the GP. Skip it.
          if (isOrgRequester(val)) continue;
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

  function pickRequesterFromTaskRow(item) {
    if (!item || typeof item !== 'object') return null;
    var keys = Object.keys(item);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var lk = key.toLowerCase();
      if (lk === 'namedgp' || lk === 'namedgpid' || lk === 'assignedto' || lk === 'assignedid') continue;
      if (!REQUESTER_KEYS[lk]) continue;
      var name = nameFromUnknown(item[key]);
      if (name && !isTeamAssignee(name)) return { name: name, source: key, confidence: 'requester' };
    }
    return null;
  }

  function normaliseTaskRow(item, slug) {
    if (!item || typeof item !== 'object') return null;
    var id = pickTaskId(item);
    if (!id) return null;
    var assignedTo = '';
    if (isStr(item.assignedTo)) assignedTo = clip(item.assignedTo, 80);
    else {
      var assignedName = nameFromUnknown(item.assignedTo);
      if (assignedName) assignedTo = assignedName;
    }
    var namedGp = isStr(item.namedGp) ? clip(item.namedGp, 80) : '';
    if (!namedGp) {
      var namedFromObj = nameFromUnknown(item.namedGp);
      if (namedFromObj) namedGp = namedFromObj;
    }
    var summary = isStr(item.summary)
      ? clip(item.summary, 120)
      : isStr(item.summaryLabel)
        ? clip(item.summaryLabel, 120)
        : isStr(item.investigations)
          ? clip(item.investigations, 120)
          : '';
    var row = {
      id: id,
      patientId: pickPatientId(item),
      patientName: isStr(item.patientName) ? clip(item.patientName, 80) : 'Unknown',
      summary: summary,
      assignedTo: assignedTo,
      assignedId:
        pickUuid(item.assignedId) ||
        pickUuid(item.assignedTo) ||
        (isStr(item.assignedId) ? clip(item.assignedId, 80) : ''),
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
    return applyRequester(row, pickRequesterFromTaskRow(item));
  }

  function applyRequester(row, hint) {
    if (!row) return row;
    if (!hint || !hint.name) return row;
    row.requester = clip(hint.name, 80);
    row.requesterSource = hint.source || '';
    row.requesterConfidence = hint.confidence || 'requester';
    return row;
  }

  function homeColumnKey(row, aliases) {
    // Current assignment only. A person assignee lives on that clinician's
    // right-hand field. Team inbox / Unassigned / a name that does not key
    // as a person stay in the unallocated reports pool. Named GP and
    // requester never auto-place — they are captions on the pile.
    if (!row) return POOL;
    var assigned = row.assignedTo;
    if (assigned && assigned !== 'Unassigned' && !isTeamAssignee(assigned)) {
      var key = clinicianKeyForName(assigned, aliases);
      if (key && key.indexOf('clinician:') === 0) return key;
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
    return { moves: {}, extraColumns: [], columnTitles: {}, columnStaffIds: {} };
  }

  function cloneDraft(draft) {
    return {
      moves: Object.assign({}, (draft && draft.moves) || {}),
      extraColumns: ((draft && draft.extraColumns) || []).slice(),
      columnTitles: Object.assign({}, (draft && draft.columnTitles) || {}),
      columnStaffIds: Object.assign({}, (draft && draft.columnStaffIds) || {}),
    };
  }

  function columnTitle(key, rows, titles, aliases, teamList) {
    if (titles && titles[key]) return titles[key];
    if (key === POOL || key === UNALLOCATED) return 'Investigation reports';
    if (key.indexOf('inbox:') === 0) {
      for (var i = 0; i < rows.length; i++) {
        if (inboxColumnKey(rows[i].assignedTo) === key) return rows[i].assignedTo || 'Inbox';
      }
      return 'Inbox';
    }
    if (key.indexOf('team:') === 0) {
      var teamSlug = key.slice('team:'.length);
      for (var t = 0; t < (teamList || []).length; t++) {
        if (teamColumnKey(teamList[t] && teamList[t].name) === key) return teamList[t].name;
      }
      for (var u = 0; u < rows.length; u++) {
        if (rows[u] && isTeamAssignee(rows[u].assignedTo) && teamColumnKey(rows[u].assignedTo) === key) {
          return rows[u].assignedTo;
        }
      }
      // Nothing named this team (empty directory) — show the key as words
      // rather than the raw lower-case slug, so the refusal still reads.
      return teamSlug.replace(/\b[a-z]/g, function (c) {
        return c.toUpperCase();
      });
    }
    if (key.indexOf('clinician:') === 0) {
      var best = '';
      for (var j = 0; j < rows.length; j++) {
        var r = rows[j];
        var names = [r && r.requester, r && r.assignedTo];
        for (var n = 0; n < names.length; n++) {
          if (!names[n] || (n === 1 && isTeamAssignee(names[n]))) continue;
          if (clinicianKeyForName(names[n], aliases) === key) {
            if (scoreStaffName(names[n]) > scoreStaffName(best)) best = names[n];
          }
        }
      }
      if (best) return best;
      return key.slice('clinician:'.length).replace('|', ' ');
    }
    return key;
  }

  function addColumn(draft, name, staffId) {
    var next = cloneDraft(draft);
    if (isTeamAssignee(name)) return next;
    var key = clinicianColumnKey(name);
    if (key === UNALLOCATED) return next;
    if (next.extraColumns.indexOf(key) === -1) next.extraColumns.push(key);
    next.columnTitles[key] = clip(name, 80);
    var id = pickUuid(staffId);
    if (id) next.columnStaffIds[key] = id;
    return next;
  }

  function addTeamColumn(draft, name, teamId) {
    var next = cloneDraft(draft);
    var key = teamColumnKey(name);
    if (!key) return next;
    if (next.extraColumns.indexOf(key) === -1) next.extraColumns.push(key);
    next.columnTitles[key] = clip(name, 80);
    var id = pickUuid(teamId);
    if (id) next.columnStaffIds[key] = id;
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

  function visualColumnKey(row, draft, aliases) {
    var staged = draft && draft.moves && draft.moves[row.id];
    if (staged) return remapClinicianKey(staged, aliases);
    return homeColumnKey(row, aliases);
  }

  function isClinicianKey(key) {
    return typeof key === 'string' && key.indexOf('clinician:') === 0;
  }

  function isTeamKey(key) {
    return typeof key === 'string' && key.indexOf('team:') === 0;
  }

  function teamColumnKey(name) {
    var n = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    return n ? 'team:' + n : '';
  }

  function isDestinationKey(key) {
    return isClinicianKey(key) || isTeamKey(key);
  }

  function tileFromRow(row, draft, key, aliases) {
    var home = homeColumnKey(row, aliases);
    var move = draft && draft.moves && draft.moves[row.id];
    var stagedTo = move ? remapClinicianKey(move, aliases) : '';
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
      homeKey: home,
      columnKey: key,
      staged: !!(stagedTo && stagedTo !== home),
      reason: placementReason(row),
    };
  }

  function tilesOnKey(rows, draft, key, aliases) {
    return rows
      .filter(function (row) {
        return visualColumnKey(row, draft, aliases) === key;
      })
      .map(function (row) {
        return tileFromRow(row, draft, key, aliases);
      });
  }

  function collectClinicianKeys(rows, draft, aliases) {
    var seen = {};
    var titles = Object.assign({}, (draft && draft.columnTitles) || {});
    function remember(key, title) {
      key = remapClinicianKey(key, aliases);
      if (!isClinicianKey(key)) return;
      seen[key] = true;
      if (title && (!titles[key] || scoreStaffName(title) > scoreStaffName(titles[key]))) {
        titles[key] = clip(title, 80);
      }
    }
    ((draft && draft.extraColumns) || []).forEach(function (k) {
      remember(k, titles[k]);
    });
    rows.forEach(function (row) {
      if (row.requester) remember(clinicianKeyForName(row.requester, aliases), row.requester);
      remember(visualColumnKey(row, draft, aliases), null);
    });
    return { keys: Object.keys(seen).sort(), titles: titles };
  }

  function collectTeamKeys(draft, teamList, aliases) {
    var seen = {};
    var titles = {};
    function remember(key, title) {
      if (!isTeamKey(key)) return;
      seen[key] = true;
      if (title && !titles[key]) titles[key] = clip(title, 80);
    }
    ((draft && draft.extraColumns) || []).forEach(function (k) {
      remember(k, (draft.columnTitles && draft.columnTitles[k]) || '');
    });
    Object.keys((draft && draft.moves) || {}).forEach(function (id) {
      remember(remapClinicianKey(draft.moves[id], aliases), '');
    });
    (teamList || []).forEach(function (t) {
      if (!t || !t.name) return;
      remember(teamColumnKey(t.name), t.name);
    });
    return { keys: Object.keys(seen).sort(), titles: titles };
  }

  function buildBoard(rows, draft, opts) {
    draft = draft || emptyDraft();
    rows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    opts = opts || {};
    var teamList = opts.teams || [];
    var aliases = buildClinicianAliases(rows, draft);
    var collected = collectClinicianKeys(rows, draft, aliases);
    var titles = collected.titles;
    var teamCollected = collectTeamKeys(draft, teamList, aliases);
    Object.keys(teamCollected.titles).forEach(function (k) {
      if (!titles[k]) titles[k] = teamCollected.titles[k];
    });
    var onChip = {};
    collected.keys.concat(teamCollected.keys).forEach(function (key) {
      onChip[key] = true;
    });
    // The pool is the unallocated box. Every row is either sitting on a
    // clinician field or in here — a result must never fall off the board.
    var poolTiles = rows
      .filter(function (row) {
        return !onChip[visualColumnKey(row, draft, aliases)];
      })
      .map(function (row) {
        return tileFromRow(row, draft, POOL, aliases);
      });
    var pool = {
      key: POOL,
      kind: 'pool',
      title: columnTitle(POOL, rows, titles, aliases, teamList),
      count: poolTiles.length,
      tiles: poolTiles,
      groups: groupTiles(poolTiles),
    };
    // How much of the pile each person ordered — the chip's workload signal
    // and the "take their pile" affordance both read this.
    var poolCountByKey = {};
    pool.groups.forEach(function (g) {
      if (g.known) {
        g.key = clinicianKeyForName(g.requester, aliases);
        poolCountByKey[g.key] = (poolCountByKey[g.key] || 0) + g.count;
      }
    });
    var clinicians = collected.keys.map(function (key) {
      var tiles = tilesOnKey(rows, draft, key, aliases);
      var stagedCount = 0;
      tiles.forEach(function (t) {
        if (t.staged) stagedCount++;
      });
      return {
        key: key,
        kind: 'clinician',
        title: columnTitle(key, rows, titles, aliases, teamList),
        count: tiles.length,
        stagedCount: stagedCount,
        inPoolCount: poolCountByKey[key] || 0,
        tiles: tiles,
        groups: groupTiles(tiles),
      };
    });
    var teams = teamCollected.keys.map(function (key) {
      var tiles = tilesOnKey(rows, draft, key, aliases);
      var stagedCount = 0;
      tiles.forEach(function (t) {
        if (t.staged) stagedCount++;
      });
      return {
        key: key,
        kind: 'team',
        title: columnTitle(key, rows, titles, aliases, teamList),
        count: tiles.length,
        stagedCount: stagedCount,
        inPoolCount: 0,
        tiles: tiles,
        groups: groupTiles(tiles),
      };
    });
    return {
      pool: pool,
      clinicians: clinicians,
      teams: teams,
      columns: [pool].concat(clinicians, teams),
      count: rows.length,
      aliases: aliases,
    };
  }

  function buildWorkspace(rows, draft, opts) {
    return buildBoard(rows, draft, opts);
  }

  // `teams` is the harvested team directory list. Without it a team
  // destination has no name to show and the confirm list falls back to the
  // normalised key ("results team") — the one screen the clinician reads
  // before the write must name the real inbox.
  function draftSummary(rows, draft, teams) {
    draft = draft || emptyDraft();
    rows = Array.isArray(rows) ? rows : [];
    teams = Array.isArray(teams) ? teams : [];
    var aliases = buildClinicianAliases(rows, draft);
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
      var from = homeColumnKey(row, aliases);
      var to = remapClinicianKey(draft.moves[id], aliases);
      if (!to || to === from) return;
      if (!isDestinationKey(to)) return;
      var toTitle = columnTitle(to, rows, draft.columnTitles, aliases, teams);
      items.push({
        id: id,
        patientName: row.patientName,
        summary: row.summary,
        fromKey: from,
        toKey: to,
        fromTitle: columnTitle(from, rows, draft.columnTitles, aliases, teams),
        toTitle: toTitle,
        text: (row.patientName || 'Unknown') + ' → ' + toTitle,
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

  function hasTaskListToken(taskList) {
    if (taskList === undefined || taskList === null) return false;
    if (typeof taskList === 'string') return taskList.trim().length > 0;
    if (typeof taskList === 'number' || typeof taskList === 'boolean') return true;
    if (Array.isArray(taskList)) return taskList.length > 0;
    if (typeof taskList === 'object') return Object.keys(taskList).length > 0;
    return false;
  }

  function extractTaskListToken(body) {
    if (!body || typeof body !== 'object') return undefined;
    if (body.taskList !== undefined) return body.taskList;
    if (body.data && typeof body.data === 'object' && body.data.taskList !== undefined) {
      return body.data.taskList;
    }
    return undefined;
  }

  function canWriteAllocations(ctx) {
    var token = coerceTaskListToken(ctx && ctx.taskList, ctx && ctx.slug);
    if (!hasTaskListToken(token)) {
      return { ok: false, reason: WRITE_NEEDS_TOKEN };
    }
    return { ok: true };
  }

  function emptyStaffDirectory() {
    return { byId: {}, list: [] };
  }

  function addStaffToDirectory(dir, id, name, source) {
    if (!dir) return dir;
    if (!UUID_RE.test(String(id || ''))) return dir;
    var nm = isStr(name) ? clip(name, 80) : '';
    if (!nm) return dir;
    // Inbox names on assignedTo must not become people. A Medicus staff
    // option labelled "Duty Doctor" still has a staff UUID — keep it.
    var fromStaffList = source === 'staff-options' || source === 'assignee-options' || source === 'staff-schedules';
    if (!fromStaffList && isTeamAssignee(nm)) return dir;
    var existing = dir.byId[id];
    if (existing && existing.name && existing.name.length >= nm.length) return dir;
    dir.byId[id] = { id: id, name: nm, source: source || (existing && existing.source) || '' };
    return dir;
  }

  function finaliseStaffDirectory(dir) {
    dir = dir || emptyStaffDirectory();
    dir.list = [];
    Object.keys(dir.byId).forEach(function (id) {
      dir.list.push(dir.byId[id]);
    });
    return dir;
  }

  function pickUuid(v) {
    if (isStr(v) && UUID_RE.test(v)) return v;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      var keys = ['id', 'value', 'staffId', 'assigneeId', 'uuid', 'key'];
      for (var i = 0; i < keys.length; i++) {
        if (isStr(v[keys[i]]) && UUID_RE.test(v[keys[i]])) return v[keys[i]];
      }
    }
    return '';
  }

  function pickPatientId(item) {
    if (!item || typeof item !== 'object') return '';
    var keys = ['patientId', 'patientUuid', 'patientUUID'];
    for (var i = 0; i < keys.length; i++) {
      var v = item[keys[i]];
      if (isStr(v) && UUID_RE.test(v)) return v;
    }
    if (item.patient && typeof item.patient === 'object') {
      var nested = pickUuid(item.patient.id) || pickUuid(item.patient.uuid) || pickUuid(item.patient.patientId);
      if (nested) return nested;
    }
    return '';
  }

  function pickPatientIdFromPayload(payload) {
    var found = '';
    function walk(node, depth) {
      if (found || !node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length && i < 20 && !found; i++) walk(node[i], depth + 1);
        return;
      }
      var id = pickPatientId(node);
      if (id) {
        found = id;
        return;
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length && k < 40 && !found; k++) {
        var lk = keys[k].toLowerCase();
        if (SKIP_WALK_KEYS[lk]) continue;
        if (/patientid|patientuuid/.test(lk) && isStr(node[keys[k]]) && UUID_RE.test(node[keys[k]])) {
          found = node[keys[k]];
          return;
        }
        walk(node[keys[k]], depth + 1);
      }
    }
    walk(payload, 0);
    return found;
  }

  function scoreStaffName(n) {
    if (!n) return 0;
    var toks = String(n)
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    return toks.length * 100 + n.length;
  }

  function pickBestStaffName(item) {
    if (!item || typeof item !== 'object') return '';
    var fields = [item.label, item.displayName, item.fullName, item.name, item.staffName, item.text, item.title];
    var best = '';
    var bestScore = -1;
    fields.forEach(function (f) {
      var n = nameFromUnknown(f);
      if (!n) return;
      var score = scoreStaffName(n);
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    });
    return best;
  }

  function pickStaffFields(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    var typ = isStr(item.type) ? String(item.type).toLowerCase() : '';
    if (typ === 'team') return null;
    if (item.staff && typeof item.staff === 'object' && !Array.isArray(item.staff)) {
      var nested = pickStaffFields(item.staff);
      if (nested) {
        var nestedOuter = pickBestStaffName(item);
        if (nestedOuter && scoreStaffName(nestedOuter) > scoreStaffName(nested.name)) nested.name = nestedOuter;
        return nested;
      }
    }
    // Vue selects often wrap the person as { value: { id, name }, label }.
    // Inner `name` is frequently a first name; the outer label is the full one.
    if (item.value && typeof item.value === 'object' && !Array.isArray(item.value)) {
      var inner = pickStaffFields(item.value);
      if (inner) {
        var outer = pickBestStaffName(item);
        if (outer && scoreStaffName(outer) > scoreStaffName(inner.name)) inner.name = outer;
        return inner;
      }
    }
    var id =
      pickUuid(item.id) ||
      pickUuid(item.value) ||
      pickUuid(item.staffId) ||
      pickUuid(item.assigneeId) ||
      pickUuid(item.uuid) ||
      pickUuid(item.key);
    var name = pickBestStaffName(item);
    if (!id || !name) return null;
    return { id: id, name: name };
  }

  function harvestNamedStaffList(dir, list, source) {
    if (!list) return;
    if (Array.isArray(list)) {
      list.forEach(function (item) {
        var p = pickStaffFields(item);
        if (p) addStaffToDirectory(dir, p.id, p.name, source);
      });
      return;
    }
    if (typeof list !== 'object') return;
    if (Array.isArray(list.staff)) harvestNamedStaffList(dir, list.staff, source);
    if (Array.isArray(list.options)) harvestNamedStaffList(dir, list.options, source);
    Object.keys(list).forEach(function (k) {
      if (k === 'staff' || k === 'options' || k === 'teams') return;
      var item = list[k];
      if (UUID_RE.test(k) && isStr(item)) {
        addStaffToDirectory(dir, k, item, source);
        return;
      }
      var p = pickStaffFields(item);
      if (p) addStaffToDirectory(dir, p.id, p.name, source);
      else if (UUID_RE.test(k) && item && typeof item === 'object') {
        var nm =
          nameFromUnknown(item.name) ||
          nameFromUnknown(item.label) ||
          nameFromUnknown(item.displayName) ||
          nameFromUnknown(item.fullName);
        if (nm) addStaffToDirectory(dir, k, nm, source);
      }
    });
  }

  function harvestAssigneeOptionsInto(dir, payload) {
    if (!payload || typeof payload !== 'object') return;
    function dropTeams(teams) {
      if (!Array.isArray(teams)) return;
      teams.forEach(function (item) {
        if (!item) return;
        var tid = pickUuid(item.id) || pickUuid(item.value) || (isStr(item.id) ? item.id : '') || (isStr(item.value) ? item.value : '');
        if (tid && dir.byId[tid]) delete dir.byId[tid];
      });
    }
    function consider(node) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      // Today-book root carries staffOptions (91 on the 2026-08-25 capture).
      harvestNamedStaffList(dir, node.staffOptions, 'staff-options');
      harvestNamedStaffList(dir, node.staffSchedules, 'staff-schedules');
      var opts = node.assigneeOptions;
      if (!opts || typeof opts !== 'object') return;
      harvestNamedStaffList(dir, opts.staff, 'assignee-options');
      dropTeams(opts.teams);
    }
    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 6) return;
      consider(node);
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length && i < 80; i++) walk(node[i], depth + 1);
        return;
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length && k < 80; k++) {
        if (SKIP_WALK_KEYS[keys[k].toLowerCase()]) continue;
        walk(node[keys[k]], depth + 1);
      }
    }
    walk(payload, 0);
  }

  function harvestStaffDirectory(rows, payload) {
    var dir = emptyStaffDirectory();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row) return;
      if (row.assignedId && row.assignedTo && !isTeamAssignee(row.assignedTo)) {
        addStaffToDirectory(dir, row.assignedId, row.assignedTo, 'assigned');
      }
      if (row.namedGpId && row.namedGp) {
        addStaffToDirectory(dir, row.namedGpId, row.namedGp, 'named-gp');
      }
    });
    harvestAssigneeOptionsInto(dir, payload);
    return finaliseStaffDirectory(dir);
  }

  function emptyTeamDirectory() {
    return { byId: {}, list: [] };
  }

  function addTeamToDirectory(dir, id, name) {
    if (!dir) return dir;
    if (!UUID_RE.test(String(id || ''))) return dir;
    var nm = isStr(name) ? clip(name, 80) : '';
    if (!nm) return dir;
    var existing = dir.byId[id];
    if (existing && existing.name && existing.name.length >= nm.length) return dir;
    dir.byId[id] = { id: id, name: nm, type: 'team' };
    return dir;
  }

  function finaliseTeamDirectory(dir) {
    dir = dir || emptyTeamDirectory();
    dir.list = [];
    Object.keys(dir.byId).forEach(function (id) {
      dir.list.push(dir.byId[id]);
    });
    dir.list.sort(function (a, b) {
      var na = String(a.name || '').toLowerCase();
      var nb = String(b.name || '').toLowerCase();
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    });
    return dir;
  }

  function pickTeamFields(item, fromTeamList) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (item.value && typeof item.value === 'object' && !Array.isArray(item.value)) {
      var inner = pickTeamFields(item.value, fromTeamList);
      if (inner) {
        var outer = pickBestStaffName(item);
        if (outer && scoreStaffName(outer) > scoreStaffName(inner.name)) inner.name = outer;
        return inner;
      }
    }
    var typ = isStr(item.type) ? String(item.type).toLowerCase() : '';
    if (typ === 'staff') return null;
    if (typ && typ !== 'team' && !fromTeamList) return null;
    var id =
      pickUuid(item.id) ||
      pickUuid(item.value) ||
      pickUuid(item.teamId) ||
      pickUuid(item.assigneeId) ||
      pickUuid(item.uuid) ||
      pickUuid(item.key);
    var name = pickBestStaffName(item);
    if (!id || !name) return null;
    return { id: id, name: name };
  }

  function harvestNamedTeamList(dir, list) {
    if (!list) return;
    if (Array.isArray(list)) {
      list.forEach(function (item) {
        var p = pickTeamFields(item, true);
        if (p) addTeamToDirectory(dir, p.id, p.name);
      });
      return;
    }
    if (typeof list !== 'object') return;
    if (Array.isArray(list.teams)) harvestNamedTeamList(dir, list.teams);
    if (Array.isArray(list.options)) harvestNamedTeamList(dir, list.options);
    Object.keys(list).forEach(function (k) {
      if (k === 'teams' || k === 'options' || k === 'staff') return;
      var item = list[k];
      if (UUID_RE.test(k) && isStr(item)) {
        addTeamToDirectory(dir, k, item);
        return;
      }
      var p = pickTeamFields(item, true);
      if (p) addTeamToDirectory(dir, p.id, p.name);
    });
  }

  function harvestTeamsFromPayload(dir, payload) {
    if (!payload || typeof payload !== 'object') return;
    function consider(node) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      harvestNamedTeamList(dir, node.teamOptions);
      harvestNamedTeamList(dir, node.teams);
      var opts = node.assigneeOptions;
      if (opts && typeof opts === 'object') harvestNamedTeamList(dir, opts.teams);
    }
    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 6) return;
      consider(node);
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length && i < 80; i++) walk(node[i], depth + 1);
        return;
      }
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length && k < 80; k++) {
        if (SKIP_WALK_KEYS[keys[k].toLowerCase()]) continue;
        walk(node[keys[k]], depth + 1);
      }
    }
    walk(payload, 0);
  }

  function harvestTeamDirectory(rows, payload) {
    var dir = emptyTeamDirectory();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row) return;
      if (row.assignedId && row.assignedTo && isTeamAssignee(row.assignedTo)) {
        addTeamToDirectory(dir, pickUuid(row.assignedId) || row.assignedId, row.assignedTo);
      }
    });
    harvestTeamsFromPayload(dir, payload);
    return finaliseTeamDirectory(dir);
  }

  function mergeTeamDirectory(a, b) {
    var dir = emptyTeamDirectory();
    function absorb(src) {
      if (!src || !src.byId) return;
      Object.keys(src.byId).forEach(function (id) {
        var e = src.byId[id];
        addTeamToDirectory(dir, e.id, e.name);
      });
    }
    absorb(a);
    absorb(b);
    return finaliseTeamDirectory(dir);
  }

  function mergeStaffDirectory(a, b) {
    var dir = emptyStaffDirectory();
    function absorb(src) {
      if (!src || !src.byId) return;
      Object.keys(src.byId).forEach(function (id) {
        var e = src.byId[id];
        addStaffToDirectory(dir, e.id, e.name, e.source);
      });
    }
    absorb(a);
    absorb(b);
    return finaliseStaffDirectory(dir);
  }

  // Person-assigned rows already on this clinician field. Their assignedId
  // is Medicus's staff UUID for that field — do not name-match the chip.
  function assignedIdsOnColumn(rows, key, aliases) {
    var seen = {};
    var ids = [];
    var name = '';
    aliases = aliases || buildClinicianAliases(rows, null);
    key = remapClinicianKey(key, aliases);
    if (!key || String(key).indexOf('clinician:') !== 0) return { ids: ids, name: name };
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      if (!row || homeColumnKey(row, aliases) !== key) return;
      var id = pickUuid(row.assignedId);
      if (!id) return;
      if (row.assignedTo && String(row.assignedTo).length > name.length) name = row.assignedTo;
      if (seen[id]) return;
      seen[id] = true;
      ids.push(id);
    });
    return { ids: ids, name: name };
  }

  function resolveTeamForColumn(key, title, teamDir) {
    var list = (teamDir && teamDir.list) || [];
    var want = isTeamKey(key) ? key : teamColumnKey(title);
    var hits = [];
    var seen = {};
    list.forEach(function (t) {
      if (!t || !t.id) return;
      var tKey = teamColumnKey(t.name);
      if (tKey !== want && teamColumnKey(title) !== tKey) return;
      if (seen[t.id]) return;
      seen[t.id] = true;
      hits.push(t);
    });
    if (hits.length === 1) {
      return { ok: true, staff: hits[0], hits: hits, source: 'team-directory', assigneeType: ASSIGNEE_TYPE_TEAM };
    }
    if (!hits.length) return { ok: false, reason: 'no-unique-team', hits: [], assigneeType: ASSIGNEE_TYPE_TEAM };
    return { ok: false, reason: 'ambiguous-team', hits: hits, assigneeType: ASSIGNEE_TYPE_TEAM };
  }

  function resolveStaffForColumn(key, title, directory, rows, aliases, knownId) {
    var sitting = assignedIdsOnColumn(rows, key, aliases);
    if (sitting.ids.length === 1) {
      var fromField = {
        id: sitting.ids[0],
        name: sitting.name || title || '',
        source: 'assigned',
      };
      return { ok: true, staff: fromField, hits: [fromField], source: 'assigned' };
    }
    if (sitting.ids.length > 1) {
      return {
        ok: false,
        reason: 'ambiguous-assigned-id',
        hits: sitting.ids.map(function (id) {
          return { id: id, name: sitting.name || title || '' };
        }),
      };
    }
    var pinned = pickUuid(knownId);
    if (pinned) {
      var fromBook = { id: pinned, name: sitting.name || title || '', source: 'today-book' };
      return { ok: true, staff: fromBook, hits: [fromBook], source: 'today-book' };
    }
    var list = (directory && directory.list) || [];
    var chipKeys = personNameKeys(title);
    if (key && String(key).indexOf('clinician:') === 0) {
      var fromKey = String(key).slice('clinician:'.length);
      if (fromKey && chipKeys.indexOf(fromKey) === -1) chipKeys.push(fromKey);
    }
    var seen = {};
    var hits = [];
    list.forEach(function (s) {
      if (!s) return;
      var match = nameKeysOverlap(chipKeys, personNameKeys(s.name));
      if (!match) return;
      if (seen[s.id]) return;
      seen[s.id] = true;
      hits.push(s);
    });
    if (hits.length === 1) return { ok: true, staff: hits[0], hits: hits, source: 'directory' };
    if (!hits.length) return { ok: false, reason: 'no-unique-staff', hits: [] };
    return { ok: false, reason: 'ambiguous-staff', hits: hits };
  }

  function writeBlockReason(plan) {
    if (!plan) return 'Cannot write these staged moves.';
    if (plan.ok && plan.batches && plan.batches.length) return '';
    if (plan.refused && plan.refused.length) {
      var bits = plan.refused.map(function (r) {
        var who = displayClinicianName(r.toTitle);
        if (r.reason === 'ambiguous-assigned-id') {
          return who + ' has more than one staff id sitting on that field';
        }
        if (r.reason === 'ambiguous-staff' && r.candidates && r.candidates.length) {
          return (
            who +
            ' matches ' +
            r.candidates
              .map(function (c) {
                return displayClinicianName(c);
              })
              .join(', ')
          );
        }
        if (r.reason === 'ambiguous-team' && r.candidates && r.candidates.length) {
          return who + ' matches more than one team';
        }
        return who;
      });
      var teamRefuse = (plan.refused || []).some(function (r) {
        return r.reason === 'no-unique-team' || r.reason === 'ambiguous-team';
      });
      var staffRefuse = (plan.refused || []).some(function (r) {
        return r.reason !== 'no-unique-team' && r.reason !== 'ambiguous-team';
      });
      if (teamRefuse && !staffRefuse) {
        return 'No unique team id for ' + bits.join('; ') + '. They stay on this canvas.';
      }
      return 'No unique staff id for ' + bits.join('; ') + '. They stay on this canvas.';
    }
    return plan.reason || 'Cannot write these staged moves.';
  }

  function buildBulkReassignBody(assigneeId, taskList, taskIds, slug, assigneeType) {
    if (!UUID_RE.test(String(assigneeId || ''))) return null;
    var token = coerceTaskListToken(taskList, slug);
    if (!hasTaskListToken(token)) return null;
    var ids = (Array.isArray(taskIds) ? taskIds : []).filter(function (id) {
      return UUID_RE.test(String(id || ''));
    });
    if (!ids.length) return null;
    var typ = assigneeType === ASSIGNEE_TYPE_TEAM ? ASSIGNEE_TYPE_TEAM : ASSIGNEE_TYPE_STAFF;
    return {
      assigneeId: assigneeId,
      assigneeType: typ,
      taskList: token,
      taskIds: ids,
    };
  }

  function planBulkReassign(rows, draft, taskList, directory, slug, teamDir) {
    var token = coerceTaskListToken(taskList, slug);
    var gate = canWriteAllocations({ taskList: token, slug: slug });
    if (!gate.ok) {
      return {
        ok: false,
        reason: gate.reason,
        batches: [],
        refused: [],
        items: [],
        directorySize: ((directory && directory.list) || []).length,
        staffNameSamples: ((directory && directory.list) || []).slice(0, 4).map(function (s) {
          return s && s.name ? s.name : '';
        }).filter(Boolean),
      };
    }
    var sum = draftSummary(rows, draft, (teamDir && teamDir.list) || []);
    var aliases = buildClinicianAliases(rows, draft);
    var byDest = {};
    var destOrder = [];
    var refused = [];
    var refusedKeys = {};
    var writableItems = [];
    sum.items.forEach(function (item) {
      var knownId = draft && draft.columnStaffIds && draft.columnStaffIds[item.toKey];
      var resolved = isTeamKey(item.toKey)
        ? resolveTeamForColumn(item.toKey, item.toTitle, teamDir)
        : resolveStaffForColumn(item.toKey, item.toTitle, directory, rows, aliases, knownId);
      if (!resolved.ok) {
        if (!refusedKeys[item.toKey]) {
          refusedKeys[item.toKey] = true;
          refused.push({
            toKey: item.toKey,
            toTitle: item.toTitle,
            reason: resolved.reason,
            taskIds: [],
            candidates: (resolved.hits || []).map(function (h) {
              return h.name;
            }),
          });
        }
        for (var r = 0; r < refused.length; r++) {
          if (refused[r].toKey === item.toKey) {
            refused[r].taskIds.push(item.id);
            break;
          }
        }
        return;
      }
      var id = resolved.staff.id;
      var typ = resolved.assigneeType === ASSIGNEE_TYPE_TEAM ? ASSIGNEE_TYPE_TEAM : ASSIGNEE_TYPE_STAFF;
      var destKey = typ + ':' + id;
      if (!byDest[destKey]) {
        byDest[destKey] = {
          assigneeId: id,
          assigneeType: typ,
          taskList: token,
          taskIds: [],
          toTitle: item.toTitle,
          toKey: item.toKey,
        };
        destOrder.push(destKey);
      }
      byDest[destKey].taskIds.push(item.id);
      writableItems.push(item);
    });
    var batches = destOrder.map(function (id) {
      return byDest[id];
    });
    var directorySize = ((directory && directory.list) || []).length;
    var staffNameSamples = ((directory && directory.list) || []).slice(0, 4).map(function (s) {
      return s && s.name ? s.name : '';
    }).filter(Boolean);
    if (!batches.length) {
      return {
        ok: false,
        reason: refused.length
          ? writeBlockReason({
              ok: false,
              refused: refused,
              directorySize: directorySize,
              staffNameSamples: staffNameSamples,
            })
          : 'Nothing staged to write.',
        batches: [],
        refused: refused,
        items: [],
        directorySize: directorySize,
        staffNameSamples: staffNameSamples,
      };
    }
    return {
      ok: true,
      batches: batches,
      refused: refused,
      items: writableItems,
      directorySize: directorySize,
      staffNameSamples: staffNameSamples,
    };
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
      // Variants of one person merge into one group; show the fullest name.
      if (tile.requester && String(tile.requester).length > String(map[key].requester).length) {
        map[key].requester = tile.requester;
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
        if (merged[i].known && sameClusterPerson(merged[i].requester, g.requester)) {
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
      if (scoreStaffName(g.requester) > scoreStaffName(merged[hit].requester)) {
        merged[hit].requester = g.requester;
        merged[hit].key = g.key;
      }
    });
    return merged
      .map(function (g) {
        g.label = g.known
          ? 'Requested by ' + g.requester + ' · ' + g.count + ' result' + (g.count === 1 ? '' : 's')
          : 'Who requested unknown · ' + g.count + ' result' + (g.count === 1 ? '' : 's');
        g.dragHint = g.known
          ? 'Drag this group onto that clinician’s field'
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

  // Selection is a map of taskId → true. Canvas keeps that shape so render
  // can test `_selected[id]` without scanning an array on every tile.
  function selectedIdList(selected) {
    return Object.keys(selected || {}).filter(function (id) {
      return selected[id];
    });
  }

  function replaceSelection(ids) {
    var next = {};
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      if (id) next[id] = true;
    });
    return next;
  }

  function addToSelection(selected, ids) {
    var next = replaceSelection(selectedIdList(selected));
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      if (id) next[id] = true;
    });
    return next;
  }

  function removeFromSelection(selected, ids) {
    var next = replaceSelection(selectedIdList(selected));
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      delete next[id];
    });
    return next;
  }

  function toggleIdInSelection(selected, id, additive) {
    if (!id) return additive ? replaceSelection(selectedIdList(selected)) : {};
    if (!additive) {
      var keys = selectedIdList(selected);
      var alreadyOnly = keys.length === 1 && keys[0] === id;
      return alreadyOnly ? {} : replaceSelection([id]);
    }
    if (selected && selected[id]) return removeFromSelection(selected, [id]);
    return addToSelection(selected, [id]);
  }

  // Plain click on a clinician heading replaces the selection with that
  // group's reports. Ctrl/⌘ (additive) adds the group, or removes it if
  // every report in it is already selected — so two headings can be in
  // the set at once.
  function toggleGroupInSelection(selected, ids, additive) {
    var list = (Array.isArray(ids) ? ids : []).filter(Boolean);
    if (!additive) return replaceSelection(list);
    var allOn =
      list.length > 0 &&
      list.every(function (id) {
        return selected && selected[id];
      });
    return allOn ? removeFromSelection(selected, list) : addToSelection(selected, list);
  }

  function rangeSelectIds(orderedIds, fromId, toId) {
    var order = Array.isArray(orderedIds) ? orderedIds.filter(Boolean) : [];
    if (!toId) return [];
    var b = order.indexOf(toId);
    if (b === -1) return [toId];
    var a = order.indexOf(fromId);
    if (a === -1) return [toId];
    if (a > b) {
      var swap = a;
      a = b;
      b = swap;
    }
    return order.slice(a, b + 1);
  }

  function idsInGroupRange(groups, fromKey, toKey) {
    var list = Array.isArray(groups) ? groups : [];
    var a = -1;
    var b = -1;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].key === fromKey) a = i;
      if (list[i] && list[i].key === toKey) b = i;
    }
    if (a === -1 && b === -1) return [];
    if (a === -1) a = b;
    if (b === -1) b = a;
    if (a > b) {
      var swap = a;
      a = b;
      b = swap;
    }
    var ids = [];
    for (var j = a; j <= b; j++) {
      var gids = (list[j] && list[j].tileIds) || [];
      for (var k = 0; k < gids.length; k++) {
        if (gids[k]) ids.push(gids[k]);
      }
    }
    return ids;
  }

  // Dragging a report (or clinician block) that is already in the
  // selection takes the whole selection with it. Dragging an unselected
  // one is just that start set — it does not silently swallow a previous pick.
  function dragIdsFor(selected, startIds) {
    var start = (Array.isArray(startIds) ? startIds : []).filter(Boolean);
    var sel = selectedIdList(selected);
    var overlap = false;
    for (var i = 0; i < start.length; i++) {
      if (selected && selected[start[i]]) {
        overlap = true;
        break;
      }
    }
    if (overlap && sel.length) return sel;
    return start;
  }

  // The unallocated well is a drop target only when bringing work back
  // from a clinician field. Highlighting it while lifting a group out of
  // it makes the whole pile look like the drag payload.
  function dropTargetShowsHover(originKind, targetKind) {
    if (targetKind !== 'pool' && targetKind !== 'clinician' && targetKind !== 'team') return false;
    if (originKind === 'pool' && targetKind === 'pool') return false;
    return true;
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
    return absence.state === 'away' || absence.state === 'away-pending';
  }

  function looksLikeDate(s) {
    return /^\d{4}-\d{2}-\d{2}/.test(String(s || ''));
  }

  function isoDay(s) {
    return looksLikeDate(s) ? String(s).slice(0, 10) : '';
  }

  function pickRecordName(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '';
    var keys = ['name', 'staffName', 'clinicianName', 'displayName', 'fullName'];
    for (var i = 0; i < keys.length; i++) {
      if (isStr(obj[keys[i]]) && obj[keys[i]].trim()) return obj[keys[i]].trim();
    }
    if (obj.staff) return pickRecordName(obj.staff);
    if (obj.assignee) return pickRecordName(obj.assignee);
    if (obj.employee) return pickRecordName(obj.employee);
    return '';
  }

  function pickDateRange(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var start = obj.startDate || obj.minDate || obj.fromDate || obj.beginDate || obj.start;
    var end = obj.endDate || obj.maxDate || obj.toDate || obj.finishDate || obj.end;
    if (!looksLikeDate(start) && obj.startDateTime) start = obj.startDateTime;
    if (!looksLikeDate(end) && obj.endDateTime) end = obj.endDateTime;
    var startDay = isoDay(start);
    if (!startDay) return null;
    return { startDate: startDay, endDate: isoDay(end) || startDay };
  }

  function looksLikeAbsenceRecord(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    if (node.absenceId || node.absenceDetails || node.coveringAssigneeId) return true;
    if (node.absenceType || node.unavailabilityType) return true;
    if (isStr(node.scheduleType) && /unavailability|absence/i.test(node.scheduleType)) return true;
    var kind = node.diaryEntryType;
    if (kind && typeof kind === 'object') {
      var token = String(kind.value || kind.label || '');
      if (/absence|unavailability/i.test(token)) return true;
    }
    return false;
  }

  function parseTodayBook(payload) {
    if (
      payload &&
      payload.data &&
      typeof payload.data === 'object' &&
      !Array.isArray(payload.data) &&
      (Array.isArray(payload.data.staffSchedules) || payload.data.staffOptions) &&
      !Array.isArray(payload.staffSchedules)
    ) {
      payload = payload.data;
    }
    var date = payload && payload.date ? isoDay(payload.date) : '';
    var present = [];
    var presentByKey = {};
    var list = payload && Array.isArray(payload.staffSchedules) ? payload.staffSchedules : [];
    for (var i = 0; i < list.length; i++) {
      var sched = list[i];
      if (!sched) continue;
      var name = clip(sched.name, 80);
      if (!name) continue;
      var sessions = 0;
      var site = '';
      var service = '';
      var blocks = Array.isArray(sched.schedule) ? sched.schedule : [];
      for (var j = 0; j < blocks.length; j++) {
        var block = blocks[j];
        if (block && block.summary && block.summary.status && block.summary.status.isCancelled) continue;
        sessions += 1;
        if (!site && block && block.summary && block.summary.site && block.summary.site.name) {
          site = clip(block.summary.site.name, 80);
        }
        if (!service && block && block.summary && block.summary.service && block.summary.service.name) {
          service = clip(block.summary.service.name, 80);
        }
      }
      if (!sessions) continue;
      var key = clinicianColumnKey(name);
      if (key === UNALLOCATED) continue;
      var staff = pickStaffFields(sched);
      var rec = {
        name: name,
        key: key,
        sessions: sessions,
        site: site,
        service: service,
        staffId:
          (staff && staff.id) ||
          pickUuid(sched.staff) ||
          pickUuid(sched.staffId) ||
          pickUuid(sched.id) ||
          '',
      };
      present.push(rec);
      if (!presentByKey[key]) presentByKey[key] = rec;
    }
    return { date: date, present: present, presentByKey: presentByKey };
  }

  function bookPresenceForName(book, name) {
    if (!book || !name) return null;
    var key = clinicianColumnKey(name);
    if (key !== UNALLOCATED && book.presentByKey && book.presentByKey[key]) {
      return book.presentByKey[key];
    }
    var list = book.present || [];
    for (var i = 0; i < list.length; i++) {
      if (sameClinician(list[i].name, name)) return list[i];
    }
    return null;
  }

  function parseAbsenceRecords(payload) {
    var hits = [];
    function consider(node) {
      if (!looksLikeAbsenceRecord(node)) return;
      var range = pickDateRange(node);
      var name = pickRecordName(node);
      if (!range || !name) return;
      var typeHint = node.absenceType || node.type || node.leaveType || node.unavailabilityType;
      var typeLabel = '';
      if (typeHint && typeof typeHint === 'object') {
        typeLabel = typeHint.label || typeHint.name || typeHint.value || '';
      } else if (isStr(typeHint)) {
        typeLabel = typeHint;
      }
      hits.push({
        name: clip(name, 80),
        startDate: range.startDate,
        endDate: range.endDate,
        type: clip(typeLabel || 'absence', 40),
        source: 'medicus',
      });
    }
    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) {
        var cap = Math.min(node.length, 200);
        for (var i = 0; i < cap; i++) walk(node[i], depth + 1);
        return;
      }
      consider(node);
      var keys = Object.keys(node);
      for (var k = 0; k < keys.length; k++) {
        var lk = String(keys[k] || '').toLowerCase();
        if (SKIP_WALK_KEYS[lk]) continue;
        if (/patient|nhsnumber|dateofbirth|address|postcode/i.test(keys[k])) continue;
        walk(node[keys[k]], depth + 1);
      }
    }
    walk(payload, 0);
    return hits;
  }

  function absenceOnDate(absences, name, dateISO) {
    var list = Array.isArray(absences) ? absences : [];
    var when = dateISO || todayISO();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !sameClinician(a.name, name)) continue;
      if (a.startDate <= when && a.endDate >= when) return a;
    }
    return null;
  }

  function presenceForName(opts) {
    opts = opts || {};
    var who = clip(opts.name, 80);
    var when = opts.dateISO || todayISO();
    if (!who || clinicianColumnKey(who) === UNALLOCATED) {
      return { state: 'n/a', reason: 'not-a-person', label: '', source: '', staff: null, leave: null };
    }
    var medicusAbs = absenceOnDate(opts.absences, who, when);
    if (medicusAbs) {
      var until = formatLeaveDate(medicusAbs.endDate);
      return {
        state: 'away',
        reason: 'medicus-absence',
        source: 'medicus',
        type: medicusAbs.type || 'absence',
        until: medicusAbs.endDate || '',
        label: who + ' has a Medicus absence' + (until ? ' until ' + until : '') + '.',
        staff: null,
        leave: medicusAbs,
      };
    }
    var rota = absenceForName(opts.staffList, opts.leaveList, who, when);
    if (rota.state === 'away' || rota.state === 'away-pending') {
      rota.source = 'rota';
      return rota;
    }
    var inToday = bookPresenceForName(opts.book, who);
    if (inToday) {
      return {
        state: 'present',
        reason: 'in-today',
        source: 'medicus',
        sessions: inToday.sessions,
        site: inToday.site || '',
        label: who + ' has a session on today’s appointment book.',
        staff: rota.staff || null,
        leave: null,
      };
    }
    return {
      state: 'unknown',
      reason: 'no-evidence',
      source: '',
      label: '',
      staff: rota.staff || null,
      leave: null,
    };
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
        cache: 'no-store',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Cache-Control': 'no-cache',
        },
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

    async function postJson(path, payload) {
      var fn = fetchImpl || fetch;
      var resp = await fn(url(path), {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
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
        return {};
      }
    }

    async function fetchTaskList(slug, search, opts) {
      var tried = [slug];
      var alt = altSlug(slug);
      if (alt) tried.push(alt);
      var qs = queryStringForList(search, opts);
      var lastErr = null;
      for (var i = 0; i < tried.length; i++) {
        var safe = sanitizeSlug(tried[i]);
        if (!safe) continue;
        try {
          var body = await getJson('/tasks/data/' + safe + '/task-list' + qs);
          return {
            slug: safe,
            body: body,
            taskList: extractTaskListToken(body),
            search: qs,
            rows: extractTaskArray(body)
              .map(function (item) {
                return normaliseTaskRow(item, safe);
              })
              .filter(Boolean),
          };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('Could not read the results queue.');
    }

    async function postBulkReassign(slug, payload) {
      var paths = bulkReassignPaths(slug);
      var lastErr = null;
      for (var i = 0; i < paths.length; i++) {
        try {
          return await postJson(paths[i], payload);
        } catch (e) {
          lastErr = e;
          if (!e || e.status !== 404) throw e;
        }
      }
      throw lastErr || new Error('HTTP 404');
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

    async function fetchTodayBook(dateISO) {
      var day = /^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || '')) ? String(dateISO) : todayISO();
      var body = await getJson(
        '/scheduling/data/appointment-book/embedded-overview?date=' +
          encodeURIComponent(day) +
          '&filterByUsualLocation=false'
      );
      var parsed = parseTodayBook(body);
      parsed.source = body && typeof body === 'object' ? body : null;
      return parsed;
    }

    async function fetchStaffScheduleAbsences() {
      var body = await getJson('/scheduling/data/staff-schedule');
      return parseAbsenceRecords(body);
    }

    // Confirmed create-task GET (W4). Read-only here — staff and teams
    // from assigneeOptions, the same directory Medicus uses when assigning.
    async function fetchAssigneeStaff(patientId) {
      var id = pickUuid(patientId);
      if (!id) throw new Error('bad patientId');
      return getJson('/patient/data/workflow/general-task/create?patientId=' + encodeURIComponent(id));
    }

    async function commitAllocations(opts) {
      opts = opts || {};
      var taskList = opts.taskList;
      var slug = opts.slug;
      var gate = canWriteAllocations({ taskList: taskList, slug: slug });
      if (!gate.ok) return { ok: false, reason: gate.reason, written: 0, vanished: [], refused: [] };
      var plan = planBulkReassign(opts.rows, opts.draft, taskList, opts.directory, slug, opts.teamDirectory);
      if (!plan.ok || !plan.batches.length) {
        return {
          ok: false,
          reason: plan.reason,
          written: 0,
          vanished: [],
          refused: plan.refused || [],
        };
      }
      var fresh;
      try {
        fresh = opts.fetchList ? await opts.fetchList() : await fetchTaskList(slug, opts.search);
      } catch (e) {
        return {
          ok: false,
          reason: 'Could not re-read the results queue before writing. Nothing was sent.',
          written: 0,
          vanished: [],
          refused: plan.refused || [],
        };
      }
      var freshIds = {};
      (fresh.rows || []).forEach(function (r) {
        if (r && r.id) freshIds[r.id] = true;
      });
      var vanished = [];
      plan.batches.forEach(function (batch) {
        batch.taskIds.forEach(function (id) {
          if (!freshIds[id]) vanished.push(id);
        });
      });
      if (vanished.length) {
        return {
          ok: false,
          reason:
            'The queue changed — at least one staged result is no longer on the list. Nothing was written. Reload and check Medicus.',
          written: 0,
          vanished: vanished,
          refused: plan.refused || [],
        };
      }
      var liveToken = coerceTaskListToken(
        hasTaskListToken(fresh.taskList) ? fresh.taskList : taskList,
        fresh.slug || slug
      );
      var written = 0;
      var writtenBatches = [];
      var failedBatches = [];
      var lastStatus = '';

      function failStatus(e) {
        var status = e && e.status ? 'HTTP ' + e.status : e && e.message ? e.message : 'HTTP error';
        if (e && e.status === 404) status = 'HTTP 404 — Medicus has no reassign URL at that path';
        return status;
      }

      async function refreshList() {
        var next = opts.fetchList ? await opts.fetchList() : await fetchTaskList(slug, opts.search);
        if (next) {
          fresh = next;
          liveToken = coerceTaskListToken(
            hasTaskListToken(fresh.taskList) ? fresh.taskList : taskList,
            fresh.slug || slug
          );
        }
        return liveToken;
      }

      function retryable(e) {
        if (!e || e.status == null) return true;
        return e.status === 400 || e.status === 409 || e.status === 429 || e.status >= 500;
      }

      for (var i = 0; i < plan.batches.length; i++) {
        var batch = plan.batches[i];
        var body = buildBulkReassignBody(
          batch.assigneeId,
          liveToken,
          batch.taskIds,
          fresh.slug || slug,
          batch.assigneeType
        );
        if (!body) {
          failedBatches.push(batch);
          lastStatus = 'could not build a reassignment body';
          continue;
        }
        var posted = false;
        var attempts = 2;
        for (var attempt = 0; attempt < attempts && !posted; attempt++) {
          try {
            if (attempt > 0) {
              try {
                await refreshList();
                body = buildBulkReassignBody(
                  batch.assigneeId,
                  liveToken,
                  batch.taskIds,
                  fresh.slug || slug,
                  batch.assigneeType
                );
                if (!body) break;
              } catch (_) {
                /* keep the previous token */
              }
            }
            await postBulkReassign(fresh.slug || slug, body);
            posted = true;
            written += batch.taskIds.length;
            writtenBatches.push(batch);
          } catch (e) {
            lastStatus = failStatus(e);
            if (e && e.status === 404) break;
            if (!retryable(e)) break;
          }
        }
        if (!posted) failedBatches.push(batch);
      }
      if (!written && failedBatches.length) {
        return {
          ok: false,
          written: 0,
          writtenBatches: [],
          failedBatch: failedBatches[0],
          refused: plan.refused || [],
          reason: 'Medicus refused the reassignment (' + lastStatus + '). Nothing was written.',
        };
      }
      if (failedBatches.length) {
        return {
          ok: false,
          partial: true,
          written: written,
          writtenBatches: writtenBatches,
          failedBatch: failedBatches[0],
          refused: plan.refused || [],
          reason:
            'Medicus accepted ' +
            written +
            ' reassignment' +
            (written === 1 ? '' : 's') +
            '. The rest were not written: ' +
            lastStatus +
            '. Check the queue.',
        };
      }
      return {
        ok: true,
        written: written,
        writtenBatches: writtenBatches,
        refused: plan.refused || [],
      };
    }

    return {
      fetchTaskList: fetchTaskList,
      fetchOverview: fetchOverview,
      fetchTodayBook: fetchTodayBook,
      fetchStaffScheduleAbsences: fetchStaffScheduleAbsences,
      fetchAssigneeStaff: fetchAssigneeStaff,
      commitAllocations: commitAllocations,
    };
  }

  var api = {
    UNALLOCATED: UNALLOCATED,
    POOL: POOL,
    WRITE_BLOCKED: WRITE_BLOCKED,
    WRITE_NEEDS_TOKEN: WRITE_NEEDS_TOKEN,
    ASSIGNEE_TYPE_STAFF: ASSIGNEE_TYPE_STAFF,
    ASSIGNEE_TYPE_TEAM: ASSIGNEE_TYPE_TEAM,
    BULK_REASSIGN_PATH: BULK_REASSIGN_PATH,
    isResultsQueueSlug: isResultsQueueSlug,
    parseResultsQueueRoute: parseResultsQueueRoute,
    sanitizeSlug: sanitizeSlug,
    queryStringForList: queryStringForList,
    bulkReassignPaths: bulkReassignPaths,
    coerceTaskListToken: coerceTaskListToken,
    altSlug: altSlug,
    extractTaskArray: extractTaskArray,
    pickTaskId: pickTaskId,
    overviewUrlFor: overviewUrlFor,
    isTeamAssignee: isTeamAssignee,
    normClinicianName: normClinicianName,
    personNameKey: personNameKey,
    personNameKeys: personNameKeys,
    samePerson: samePerson,
    sameClinician: sameClinician,
    sameClusterPerson: sameClusterPerson,
    buildClinicianAliases: buildClinicianAliases,
    clinicianKeyForName: clinicianKeyForName,
    displayClinicianName: displayClinicianName,
    clinicianColumnKey: clinicianColumnKey,
    teamColumnKey: teamColumnKey,
    inboxColumnKey: inboxColumnKey,
    parseRequestLabel: parseRequestLabel,
    pickRequesterFromOverview: pickRequesterFromOverview,
    pickRequesterFromTaskRow: pickRequesterFromTaskRow,
    normaliseTaskRow: normaliseTaskRow,
    applyRequester: applyRequester,
    homeColumnKey: homeColumnKey,
    placementReason: placementReason,
    emptyDraft: emptyDraft,
    addColumn: addColumn,
    addTeamColumn: addTeamColumn,
    stageMove: stageMove,
    stageMoves: stageMoves,
    buildBoard: buildBoard,
    buildWorkspace: buildWorkspace,
    draftSummary: draftSummary,
    copyList: copyList,
    isOrgRequester: isOrgRequester,
    hasTaskListToken: hasTaskListToken,
    extractTaskListToken: extractTaskListToken,
    canWriteAllocations: canWriteAllocations,
    harvestStaffDirectory: harvestStaffDirectory,
    mergeStaffDirectory: mergeStaffDirectory,
    harvestTeamDirectory: harvestTeamDirectory,
    mergeTeamDirectory: mergeTeamDirectory,
    assignedIdsOnColumn: assignedIdsOnColumn,
    resolveStaffForColumn: resolveStaffForColumn,
    resolveTeamForColumn: resolveTeamForColumn,
    writeBlockReason: writeBlockReason,
    pickStaffFields: pickStaffFields,
    pickPatientId: pickPatientId,
    pickPatientIdFromPayload: pickPatientIdFromPayload,
    buildBulkReassignBody: buildBulkReassignBody,
    planBulkReassign: planBulkReassign,
    todayISO: todayISO,
    formatLeaveDate: formatLeaveDate,
    requesterGroupKey: requesterGroupKey,
    groupTiles: groupTiles,
    dragPreview: dragPreview,
    selectedIdList: selectedIdList,
    replaceSelection: replaceSelection,
    addToSelection: addToSelection,
    removeFromSelection: removeFromSelection,
    toggleIdInSelection: toggleIdInSelection,
    toggleGroupInSelection: toggleGroupInSelection,
    rangeSelectIds: rangeSelectIds,
    idsInGroupRange: idsInGroupRange,
    dragIdsFor: dragIdsFor,
    dropTargetShowsHover: dropTargetShowsHover,
    matchStaffByName: matchStaffByName,
    leaveOnDate: leaveOnDate,
    absenceForName: absenceForName,
    shouldWarnAbsence: shouldWarnAbsence,
    absenceWarningCopy: absenceWarningCopy,
    parseTodayBook: parseTodayBook,
    bookPresenceForName: bookPresenceForName,
    parseAbsenceRecords: parseAbsenceRecords,
    absenceOnDate: absenceOnDate,
    presenceForName: presenceForName,
    createClient: createClient,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.LabAllocateCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
