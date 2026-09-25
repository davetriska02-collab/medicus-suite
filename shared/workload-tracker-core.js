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

  function sortMembers(members, sort) {
    var list = Array.isArray(members) ? members.slice() : [];
    var mode = sort === 'overdue' || sort === 'name' ? sort : 'total';
    list.sort(function (a, b) {
      if (mode === 'name') {
        return String(a.sortValue || a.label).localeCompare(String(b.sortValue || b.label), 'en');
      }
      if (mode === 'overdue') {
        var byOverdue = count(b.overdueHighPriority) - count(a.overdueHighPriority);
        if (byOverdue) return byOverdue;
      }
      var byTotal = totalLoad(b) - totalLoad(a);
      if (byTotal) return byTotal;
      return String(a.sortValue || a.label).localeCompare(String(b.sortValue || b.label), 'en');
    });
    return list;
  }

  function viewMembers(parsed, view) {
    if (!parsed) return [];
    var list = view === 'team' ? parsed.teams : parsed.staff;
    return Array.isArray(list) ? list.slice() : [];
  }

  function prepareView(parsed, view, query, sort) {
    var all = viewMembers(parsed, view);
    var visible = sortMembers(filterMembers(all, query), sort);
    return {
      summary: summarise(all),
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

  function dashboardDataUrl(apiBase) {
    if (!apiBase || typeof apiBase !== 'string') return '';
    try {
      var parsed = new URL(apiBase);
      if (!/\.api\./i.test(parsed.hostname) || parsed.hostname.indexOf('medicus') === -1) return '';
      return parsed.protocol + '//' + parsed.hostname + '/tasks/data/dashboard-data';
    } catch (err) {
      return '';
    }
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
    shouldPoll: shouldPoll,
    clampRefreshMs: clampRefreshMs,
    themeDataset: themeDataset,
    themeClassName: themeClassName,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.WorkloadTrackerCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
