// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Workload tracker (pure).
//
// Reads the Workflow dashboard payload and turns it into staff/team counts.
// No DOM, no chrome, no fetch. Overdue high-priority is a subset of
// allHighPriority, so it is not added again into the total.

(function (global) {
  'use strict';

  var PACK_KEY = 'suite.ui.workloadTracker';
  // Recurring refresh sits on the suite floor (5 minutes). Anything quicker
  // is clamped to the 2-minute minimum. A hidden tab does not poll.
  var REFRESH_MS = 5 * 60 * 1000;
  var MIN_REFRESH_MS = 2 * 60 * 1000;
  var HEAVY_HIGH_MIN = 5;
  var SITE_ID_RE = /^[a-f0-9]{4,8}$/i;
  var LABEL_MAX = 120;
  var UNASSIGNED_KEY = '\u0000unassigned';
  var UNASSIGNED_LABEL = 'Unassigned';

  // Open task-list queues Suite already reads. Medical, admin, results and
  // the two prescription queues are the Submissions and rota demand set.
  // Inbound documents are the workflow queue slug. Activity-report columns
  // (consultations, medication reviews) are completed work on a different
  // endpoint and are not these lists. Privacy-officer and EPS cancellation
  // lists are bulk-action queues and are not this dashboard mix.
  var TASK_TYPES = [
    { key: 'medical', slug: 'medical_patient_request_task', short: 'Medical', long: 'Medical requests' },
    { key: 'admin', slug: 'admin_patient_request_task', short: 'Admin', long: 'Admin requests' },
    {
      key: 'results',
      slug: 'review_investigation_results_task',
      short: 'Results',
      long: 'Investigation results',
    },
    {
      key: 'rxRoutine',
      slug: 'prescription_request_task_routine',
      short: 'Routine Rx',
      long: 'Routine prescription requests',
    },
    {
      key: 'rxNonRoutine',
      slug: 'prescription_request_task_non_routine',
      short: 'Non-rtn Rx',
      long: 'Non-routine prescription requests',
    },
    {
      key: 'documents',
      slug: 'review_inbound_document_task',
      short: 'Documents',
      long: 'Inbound documents',
    },
  ];

  var PERIODS = [
    { key: 'open', label: 'Open now' },
    { key: 'today', label: 'Today' },
    { key: 'last7', label: 'Last 7 days' },
    { key: 'last30', label: 'Last 30 days' },
  ];

  var MONTHS = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };

  function count(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  }

  function cleanLabel(value) {
    if (typeof value !== 'string') return '';
    var text = value.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length > LABEL_MAX) text = text.slice(0, LABEL_MAX);
    return text;
  }

  // Only the fields the panel draws. Anything else on the row (including a
  // patient identifier, if the payload ever carried one) is dropped.
  function normaliseMember(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var label = cleanLabel(raw.label);
    if (!label) return null;
    var sortValue = cleanLabel(raw.sortValue) || label;
    return {
      label: label,
      sortValue: sortValue,
      overdueHighPriority: count(raw.overdueHighPriority),
      allHighPriority: count(raw.allHighPriority),
      allNormalPriority: count(raw.allNormalPriority),
      snoozed: count(raw.snoozed),
    };
  }

  function memberList(payload, key) {
    if (!payload || typeof payload !== 'object') return [];
    var list = payload[key];
    if (!Array.isArray(list) && payload.data && typeof payload.data === 'object') {
      list = payload.data[key];
    }
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var row = normaliseMember(list[i]);
      if (row) out.push(row);
    }
    return out;
  }

  function parseDashboard(payload) {
    return {
      staff: memberList(payload, 'tasksByStaffMember'),
      teams: memberList(payload, 'tasksByTeam'),
    };
  }

  function totalLoad(member) {
    if (!member) return 0;
    return count(member.allHighPriority) + count(member.allNormalPriority) + count(member.snoozed);
  }

  function summarise(members) {
    var acc = { overdue: 0, high: 0, normal: 0, snoozed: 0, members: 0 };
    var list = Array.isArray(members) ? members : [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      acc.overdue += count(row.overdueHighPriority);
      acc.high += count(row.allHighPriority);
      acc.normal += count(row.allNormalPriority);
      acc.snoozed += count(row.snoozed);
    }
    acc.members = list.length;
    return acc;
  }

  function filterMembers(members, query) {
    var q = String(query || '')
      .trim()
      .toLowerCase();
    var list = Array.isArray(members) ? members.slice() : [];
    if (!q) return list;
    return list.filter(function (row) {
      return String((row && row.label) || '')
        .toLowerCase()
        .includes(q);
    });
  }

  function nameCompare(a, b) {
    return String((a && (a.sortValue || a.label)) || '').localeCompare(
      String((b && (b.sortValue || b.label)) || ''),
      'en'
    );
  }

  function typeKeyFromSort(sort) {
    if (typeof sort !== 'string' || sort.indexOf('type:') !== 0) return '';
    var key = sort.slice(5);
    for (var i = 0; i < TASK_TYPES.length; i++) {
      if (TASK_TYPES[i].key === key) return key;
    }
    return '';
  }

  // A missing type count is null, never zero. Sort keeps that null after
  // every real number so a queue that did not load does not rank as empty.
  function typeValue(member, key) {
    if (!member || !member.byType) return null;
    var raw = member.byType[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    return raw;
  }

  function sortMembers(members, sort) {
    var list = Array.isArray(members) ? members.slice() : [];
    var typeKey = typeKeyFromSort(sort);
    var mode = sort === 'overdue' || sort === 'name' ? sort : typeKey ? 'type' : 'total';
    list.sort(function (a, b) {
      if (mode === 'name') return nameCompare(a, b);
      if (mode === 'type') {
        var av = typeValue(a, typeKey);
        var bv = typeValue(b, typeKey);
        var aMissing = av == null;
        var bMissing = bv == null;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        if (!aMissing && av !== bv) return bv - av;
        return nameCompare(a, b);
      }
      if (mode === 'overdue') {
        var byOverdue = count(b.overdueHighPriority) - count(a.overdueHighPriority);
        if (byOverdue) return byOverdue;
      }
      var byTotal = totalLoad(b) - totalLoad(a);
      if (byTotal) return byTotal;
      return nameCompare(a, b);
    });
    return list;
  }

  function viewMembers(parsed, view) {
    if (!parsed) return [];
    var list = view === 'team' ? parsed.teams : parsed.staff;
    return Array.isArray(list) ? list.slice() : [];
  }

  function prepareView(parsed, view, query, sort, report) {
    var all = composeMembers(parsed, report, view);
    var visible = sortMembers(filterMembers(all, query), sort);
    var dash = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].fromDashboard !== false) dash.push(all[i]);
    }
    return {
      summary: summarise(dash),
      types: summariseTypes(all, report),
      flags: typeFlags(report),
      members: visible,
      scale: barScale(visible),
    };
  }

  function initials(label) {
    var name = String(label || '')
      .replace(/^Dr\s+/i, '')
      .trim();
    var parts = name.split(/\s+/).filter(Boolean);
    if (!name) return '';
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  function barPercent(value, max) {
    var v = count(value);
    if (v <= 0) return 0;
    var m = count(max);
    if (m < 1) m = 1;
    return Math.max(2, Math.round((v / m) * 100));
  }

  function barScale(members) {
    var maxHigh = 1;
    var maxNormal = 1;
    var list = Array.isArray(members) ? members : [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i] || {};
      if (count(row.allHighPriority) > maxHigh) maxHigh = count(row.allHighPriority);
      if (count(row.allNormalPriority) > maxNormal) maxNormal = count(row.allNormalPriority);
    }
    return { maxHigh: maxHigh, maxNormal: maxNormal };
  }

  function barRows(member, scale) {
    var row = member || {};
    var maxHigh = scale && scale.maxHigh ? scale.maxHigh : 1;
    var maxNormal = scale && scale.maxNormal ? scale.maxNormal : 1;
    var rows = [];
    if (count(row.overdueHighPriority) > 0) {
      rows.push({
        key: 'overdue',
        label: 'Overdue',
        value: count(row.overdueHighPriority),
        pct: barPercent(row.overdueHighPriority, maxHigh),
      });
    }
    if (count(row.allHighPriority) > 0) {
      rows.push({
        key: 'high',
        label: 'High P',
        value: count(row.allHighPriority),
        pct: barPercent(row.allHighPriority, maxHigh),
      });
    }
    if (count(row.allNormalPriority) > 0) {
      rows.push({
        key: 'normal',
        label: 'Normal',
        value: count(row.allNormalPriority),
        pct: barPercent(row.allNormalPriority, maxNormal),
      });
    }
    if (count(row.snoozed) > 0) {
      rows.push({
        key: 'snoozed',
        label: 'Snoozed',
        value: count(row.snoozed),
        pct: barPercent(row.snoozed, maxNormal),
      });
    }
    return rows;
  }

  function cardTone(member) {
    if (!member) return '';
    if (count(member.overdueHighPriority) > 0) return 'overdue';
    if (count(member.allHighPriority) > HEAVY_HIGH_MIN) return 'heavy';
    return '';
  }

  function isDashboardPath(pathname) {
    return /\/tasks\/dashboard(?:\/|$)/.test(String(pathname || ''));
  }

  // Practice API host is {siteId}.api.{page hostname}. The page host is the
  // SPA shell and is not the dashboard JSON.
  function resolveApiBase(input) {
    var src = input && typeof input === 'object' ? input : {};
    var hostname = typeof src.hostname === 'string' ? src.hostname : '';
    var pathname = typeof src.pathname === 'string' ? src.pathname : '';
    var protocol = 'https:';
    if (src.href) {
      try {
        var parsed = new URL(String(src.href));
        if (!hostname) hostname = parsed.hostname;
        if (!pathname) pathname = parsed.pathname;
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') protocol = parsed.protocol;
      } catch (err) {
        /* href was not a URL */
      }
    }
    if (src.protocol === 'http:' || src.protocol === 'https:') protocol = src.protocol;

    var apiHost = /^([a-f0-9]{4,8})\.api\.(.+)$/i.exec(hostname);
    if (apiHost && apiHost[2].indexOf('medicus') !== -1) {
      return protocol + '//' + hostname;
    }
    if (!hostname || hostname.indexOf('medicus') === -1) return '';
    var seg = String(pathname || '')
      .split('/')
      .filter(Boolean)[0];
    if (!seg || !SITE_ID_RE.test(seg)) return '';
    return protocol + '//' + seg.toLowerCase() + '.api.' + hostname;
  }

  function apiOrigin(apiBase) {
    if (!apiBase || typeof apiBase !== 'string') return '';
    try {
      var parsed = new URL(apiBase);
      if (!/\.api\./i.test(parsed.hostname) || parsed.hostname.indexOf('medicus') === -1) return '';
      return parsed.protocol + '//' + parsed.hostname;
    } catch (err) {
      return '';
    }
  }

  function dashboardDataUrl(apiBase) {
    var origin = apiOrigin(apiBase);
    if (!origin) return '';
    return origin + '/tasks/data/dashboard-data';
  }

  function slugAllowed(slug) {
    for (var i = 0; i < TASK_TYPES.length; i++) {
      if (TASK_TYPES[i].slug === slug) return true;
    }
    return false;
  }

  function taskListUrl(apiBase, slug, range) {
    if (!slugAllowed(slug)) return '';
    var origin = apiOrigin(apiBase);
    if (!origin) return '';
    var url = origin + '/tasks/data/' + slug + '/task-list';
    if (!range) return url;
    if (!range.start || !range.end || String(range.start) > String(range.end)) return '';
    return (
      url +
      '?createdAt_startDate=' +
      encodeURIComponent(range.start) +
      '&createdAt_endDate=' +
      encodeURIComponent(range.end)
    );
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function periodRange(name, now) {
    if (name !== 'today' && name !== 'last7' && name !== 'last30') return null;
    var today = now ? new Date(now) : new Date();
    today.setHours(0, 0, 0, 0);
    var start = new Date(today);
    var end = new Date(today);
    if (name === 'last7') start.setDate(start.getDate() - 6);
    if (name === 'last30') start.setDate(start.getDate() - 29);
    return { start: formatDate(start), end: formatDate(end) };
  }

  function taskCreatedISO(value) {
    if (!value || typeof value !== 'string') return '';
    var iso = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (iso) return iso[1];
    var legacy = /^(\d{2})\s(\w{3})\s(\d{4})/.exec(value);
    if (!legacy || !MONTHS[legacy[2]]) return '';
    return legacy[3] + '-' + MONTHS[legacy[2]] + '-' + legacy[1];
  }

  function isoAddDays(iso, n) {
    var parts = String(iso || '').split('-');
    if (parts.length !== 3) return '';
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0, 0);
    if (!Number.isFinite(d.getTime())) return '';
    d.setDate(d.getDate() + n);
    return formatDate(d);
  }

  function labelKey(value) {
    return cleanLabel(value).toLowerCase();
  }

  function isUnassignedLabel(label) {
    var key = labelKey(label);
    return !key || key === 'unassigned';
  }

  // Assignee only. A nested patient object is not walked.
  function assigneeLabel(task) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return '';
    var raw = Object.prototype.hasOwnProperty.call(task, 'assignedTo') ? task.assignedTo : task.assignee;
    if (typeof raw === 'string') return cleanLabel(raw);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
    if (typeof raw.name === 'string') return cleanLabel(raw.name);
    if (typeof raw.label === 'string') return cleanLabel(raw.label);
    return '';
  }

  function extractTasks(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return [];
    if (Array.isArray(body.tasks)) return body.tasks;
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.results)) return body.results;
    if (Array.isArray(body.rows)) return body.rows;
    return [];
  }

  function serverTotal(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    var candidates = [body.totalCount, body.total];
    if (body.meta && typeof body.meta === 'object') {
      candidates.push(body.meta.totalCount, body.meta.total);
    }
    for (var i = 0; i < candidates.length; i++) {
      var n = candidates[i];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n;
    }
    return null;
  }

  function tallyTasks(tasks, range) {
    var list = Array.isArray(tasks) ? tasks : [];
    var filterIgnored = false;
    var loose = '';
    var hi = '';
    if (range && range.start && range.end) {
      loose = isoAddDays(range.start, -1);
      hi = isoAddDays(range.end, 1);
      for (var i = 0; i < list.length; i++) {
        var seen = taskCreatedISO(list[i] && list[i].createdAt);
        if (seen && (seen < loose || seen > hi)) {
          filterIgnored = true;
          break;
        }
      }
    }
    var byKey = {};
    var skippedDate = 0;
    var counted = 0;
    for (var t = 0; t < list.length; t++) {
      var task = list[t];
      if (range && range.start && range.end && filterIgnored) {
        var created = taskCreatedISO(task && task.createdAt);
        if (!created || created < range.start || created > range.end) {
          skippedDate++;
          continue;
        }
      }
      var label = assigneeLabel(task);
      var unassigned = isUnassignedLabel(label);
      var key = unassigned ? UNASSIGNED_KEY : labelKey(label);
      var show = unassigned ? UNASSIGNED_LABEL : label;
      if (!byKey[key]) byKey[key] = { label: show, count: 0 };
      byKey[key].count++;
      counted++;
    }
    return { byKey: byKey, filterIgnored: filterIgnored, skippedDate: skippedDate, counted: counted };
  }

  // Counts only. The task rows are not returned.
  function readTaskList(body, range) {
    var tasks = extractTasks(body);
    var total = serverTotal(body);
    var tally = tallyTasks(tasks, range);
    return {
      ok: true,
      byKey: tally.byKey,
      filterIgnored: tally.filterIgnored,
      truncated: total != null && total > tasks.length,
      skippedDate: tally.skippedDate,
      counted: tally.counted,
    };
  }

  function blankByType(report) {
    var out = {};
    for (var i = 0; i < TASK_TYPES.length; i++) {
      var key = TASK_TYPES[i].key;
      var entry = report && report[key];
      out[key] = entry && entry.ok === true ? 0 : null;
    }
    return out;
  }

  function cloneDashboard(member) {
    return {
      label: member.label,
      sortValue: member.sortValue || member.label,
      overdueHighPriority: count(member.overdueHighPriority),
      allHighPriority: count(member.allHighPriority),
      allNormalPriority: count(member.allNormalPriority),
      snoozed: count(member.snoozed),
      fromDashboard: true,
      byType: null,
    };
  }

  function extraRow(label, report) {
    return {
      label: label,
      sortValue: label,
      overdueHighPriority: 0,
      allHighPriority: 0,
      allNormalPriority: 0,
      snoozed: 0,
      fromDashboard: false,
      byType: blankByType(report),
    };
  }

  function composeMembers(parsed, report, view) {
    var src = parsed || {};
    var dashboard = view === 'team' ? src.teams : src.staff;
    var other = view === 'team' ? src.staff : src.teams;
    if (!Array.isArray(dashboard)) dashboard = [];
    if (!Array.isArray(other)) other = [];

    var otherKeys = {};
    for (var i = 0; i < other.length; i++) {
      if (other[i] && other[i].label) otherKeys[labelKey(other[i].label)] = true;
    }

    var rows = [];
    var rowByKey = {};
    for (var d = 0; d < dashboard.length; d++) {
      if (!dashboard[d]) continue;
      var copy = cloneDashboard(dashboard[d]);
      copy.byType = blankByType(report);
      rows.push(copy);
      var key = labelKey(copy.label);
      if (isUnassignedLabel(copy.label)) {
        if (!rowByKey[UNASSIGNED_KEY]) rowByKey[UNASSIGNED_KEY] = copy;
      } else if (key && !rowByKey[key]) rowByKey[key] = copy;
    }

    var extras = {};
    var unassigned = null;
    for (var t = 0; t < TASK_TYPES.length; t++) {
      var typeKey = TASK_TYPES[t].key;
      var entry = report && report[typeKey];
      if (!entry || entry.ok !== true) continue;
      var byKey = entry.byKey || {};
      var keys = Object.keys(byKey);
      for (var k = 0; k < keys.length; k++) {
        var bucketKey = keys[k];
        var bucket = byKey[bucketKey];
        if (!bucket || !count(bucket.count)) continue;
        if (bucketKey === UNASSIGNED_KEY) {
          var home = rowByKey[UNASSIGNED_KEY];
          if (home) {
            home.byType[typeKey] = count(home.byType[typeKey]) + count(bucket.count);
            continue;
          }
          if (!unassigned) unassigned = extraRow(UNASSIGNED_LABEL, report);
          unassigned.byType[typeKey] = count(unassigned.byType[typeKey]) + count(bucket.count);
          continue;
        }
        var hit = rowByKey[bucketKey];
        if (hit) {
          hit.byType[typeKey] = count(hit.byType[typeKey]) + count(bucket.count);
          continue;
        }
        if (otherKeys[bucketKey]) continue;
        if (!extras[bucketKey]) extras[bucketKey] = extraRow(bucket.label || bucketKey, report);
        extras[bucketKey].byType[typeKey] = count(bucket.count);
      }
    }

    var extraKeys = Object.keys(extras);
    extraKeys.sort(function (a, b) {
      return String(extras[a].sortValue).localeCompare(String(extras[b].sortValue), 'en');
    });
    for (var e = 0; e < extraKeys.length; e++) rows.push(extras[extraKeys[e]]);
    if (unassigned) rows.push(unassigned);
    return rows;
  }

  function summariseTypes(members, report) {
    var totals = {};
    var list = Array.isArray(members) ? members : [];
    for (var t = 0; t < TASK_TYPES.length; t++) {
      var key = TASK_TYPES[t].key;
      var entry = report && report[key];
      if (!entry || entry.ok !== true) {
        totals[key] = null;
        continue;
      }
      var sum = 0;
      for (var i = 0; i < list.length; i++) {
        var raw = list[i] && list[i].byType ? list[i].byType[key] : null;
        if (typeof raw === 'number' && Number.isFinite(raw)) sum += raw;
      }
      totals[key] = sum;
    }
    return totals;
  }

  function typeFlags(report) {
    var failed = [];
    var ignored = [];
    var truncated = [];
    if (!report) return { failed: failed, ignored: ignored, truncated: truncated, pending: true };
    for (var i = 0; i < TASK_TYPES.length; i++) {
      var type = TASK_TYPES[i];
      var entry = report && report[type.key];
      if (!entry || entry.ok !== true) {
        failed.push(type.short);
        continue;
      }
      if (entry.filterIgnored) ignored.push(type.short);
      if (entry.truncated) truncated.push(type.short);
    }
    return { failed: failed, ignored: ignored, truncated: truncated, pending: false };
  }

  function typeNote(flags) {
    var f = flags || { failed: [], ignored: [], truncated: [] };
    var parts = [
      'Type counts are open tasks on each queue. A period counts tasks created in that window that are still open. They are not a split of the totals above.',
    ];
    if (f.failed && f.failed.length) {
      parts.push(f.failed.join(', ') + ' did not load. A dash is not zero.');
    }
    if (f.ignored && f.ignored.length) {
      parts.push(
        f.ignored.join(', ') + ' did not apply the date filter. Counts were limited here to the window and may be low.'
      );
    }
    if (f.truncated && f.truncated.length) {
      parts.push(f.truncated.join(', ') + ' sent fewer tasks than its total. The count may be low.');
    }
    return parts.join(' ');
  }

  function typeCells(member) {
    var cells = [];
    for (var i = 0; i < TASK_TYPES.length; i++) {
      var type = TASK_TYPES[i];
      var raw = member && member.byType ? member.byType[type.key] : null;
      var loaded = typeof raw === 'number' && Number.isFinite(raw);
      cells.push({
        key: type.key,
        short: type.short,
        long: type.long,
        value: loaded ? raw : null,
        loaded: loaded,
      });
    }
    return cells;
  }

  function sortModes() {
    var modes = [
      { key: 'total', label: 'Total load' },
      { key: 'overdue', label: 'Overdue first' },
      { key: 'name', label: 'Name A–Z' },
    ];
    for (var i = 0; i < TASK_TYPES.length; i++) {
      modes.push({ key: 'type:' + TASK_TYPES[i].key, label: TASK_TYPES[i].short + ' count' });
    }
    return modes;
  }

  function shouldPoll(state) {
    var s = state || {};
    if (s.packOn === false) return false;
    if (!s.panelOpen) return false;
    if (s.hidden) return false;
    return true;
  }

  function clampRefreshMs(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n)) return REFRESH_MS;
    if (n < MIN_REFRESH_MS) return MIN_REFRESH_MS;
    return n;
  }

  function themeDataset(prefs) {
    var p = prefs && typeof prefs === 'object' ? prefs : {};
    var theme = p.theme === 'dark' ? 'dark' : 'light';
    var size = p.size === 'small' || p.size === 'large' ? p.size : 'medium';
    var colorblind = p.colorblind === true || p.colorblind === 'true';
    return {
      theme: theme,
      colorblind: colorblind ? 'true' : 'false',
      size: size,
    };
  }

  function themeClassName(prefs) {
    var d = themeDataset(prefs);
    var parts = ['ms-wl', 'ms-wl-theme-' + d.theme, 'ms-wl-size-' + d.size];
    if (d.colorblind === 'true') parts.push('ms-wl-colorblind');
    return parts.join(' ');
  }

  var api = {
    PACK_KEY: PACK_KEY,
    REFRESH_MS: REFRESH_MS,
    MIN_REFRESH_MS: MIN_REFRESH_MS,
    HEAVY_HIGH_MIN: HEAVY_HIGH_MIN,
    TASK_TYPES: TASK_TYPES,
    PERIODS: PERIODS,
    count: count,
    parseDashboard: parseDashboard,
    normaliseMember: normaliseMember,
    totalLoad: totalLoad,
    summarise: summarise,
    filterMembers: filterMembers,
    sortMembers: sortMembers,
    viewMembers: viewMembers,
    prepareView: prepareView,
    initials: initials,
    barPercent: barPercent,
    barScale: barScale,
    barRows: barRows,
    cardTone: cardTone,
    isDashboardPath: isDashboardPath,
    resolveApiBase: resolveApiBase,
    dashboardDataUrl: dashboardDataUrl,
    taskListUrl: taskListUrl,
    periodRange: periodRange,
    taskCreatedISO: taskCreatedISO,
    assigneeLabel: assigneeLabel,
    readTaskList: readTaskList,
    summariseTypes: summariseTypes,
    typeNote: typeNote,
    typeCells: typeCells,
    sortModes: sortModes,
    shouldPoll: shouldPoll,
    clampRefreshMs: clampRefreshMs,
    themeDataset: themeDataset,
    themeClassName: themeClassName,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.WorkloadTrackerCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
