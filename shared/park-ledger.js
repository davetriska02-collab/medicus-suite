// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Park-until ledger (classic script, content-script safe)
//
// Local-only "park this request until …" mark for the queue Act-tray.
// Does NOT change Medicus status. A restore must not fabricate "I parked this"
// — same not-backed-up doctrine as the contact ledger (test-backup-coverage.js).
//
// Store: { taskUuid: { u: untilMs, a: actor, p: parkedAtMs } }
//   - taskUuid only (no patient identity, no free text, no clinical content)
//   - pruned once `until` has passed + slack, hard-capped
//
// Usage (browser): window.ParkLedger.<fn>(...)
// Usage (node):    require('./shared/park-ledger.js').<fn>(...)
(function (global) {
  'use strict';

  if (global && global.ParkLedger) return;

  var STORAGE_KEY = 'ledger.parkedTasks';
  var MAX_ENTRIES = 400;
  var UUIDISH_RE = /^[0-9a-fA-F][0-9a-fA-F-]{7,63}$/;

  function validUuid(s) {
    return typeof s === 'string' && UUIDISH_RE.test(s) ? s.toLowerCase() : null;
  }

  function sanitiseStore(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(function (k) {
      var id = validUuid(k);
      var v = raw[k];
      if (!id || !v || typeof v !== 'object') return;
      var until = Number(v.u);
      var parkedAt = Number(v.p);
      if (!Number.isFinite(until) || until <= 0) return;
      out[id] = {
        u: until,
        a: typeof v.a === 'string' ? v.a.slice(0, 40) : '',
        p: Number.isFinite(parkedAt) ? parkedAt : 0,
      };
    });
    return out;
  }

  function pruneStore(store, now) {
    var t = Number.isFinite(now) ? now : Date.now();
    var next = {};
    Object.keys(store || {}).forEach(function (k) {
      var v = store[k];
      if (!v) return;
      // Keep until 12h after the park-until, so a just-expired mark is still
      // visible as "was parked" rather than vanishing on the minute.
      if (v.u + 12 * 3600000 < t) return;
      next[k] = v;
    });
    var keys = Object.keys(next);
    if (keys.length > MAX_ENTRIES) {
      keys.sort(function (a, b) {
        return (next[a].p || 0) - (next[b].p || 0);
      });
      keys.slice(0, keys.length - MAX_ENTRIES).forEach(function (k) {
        delete next[k];
      });
    }
    return next;
  }

  function parkTask(store, taskUuid, untilMs, actor, now) {
    var id = validUuid(taskUuid);
    var until = Number(untilMs);
    if (!id || !Number.isFinite(until) || until <= 0) {
      return { store: sanitiseStore(store), ok: false };
    }
    var next = sanitiseStore(store);
    next[id] = {
      u: until,
      a: typeof actor === 'string' ? actor.slice(0, 40) : '',
      p: Number.isFinite(now) ? now : Date.now(),
    };
    return { store: pruneStore(next, now), ok: true };
  }

  function unparkTask(store, taskUuid) {
    var id = validUuid(taskUuid);
    var next = sanitiseStore(store);
    if (id && next[id]) delete next[id];
    return { store: next, ok: !!id };
  }

  function lookup(store, taskUuid, now) {
    var id = validUuid(taskUuid);
    if (!id) return null;
    var v = sanitiseStore(store)[id];
    if (!v) return null;
    var t = Number.isFinite(now) ? now : Date.now();
    if (v.u + 12 * 3600000 < t) return null;
    return { until: v.u, actor: v.a, parkedAt: v.p, expired: v.u < t };
  }

  function defaultUntilMs(now) {
    var d = now instanceof Date ? new Date(now.getTime()) : new Date();
    // Next local morning 08:00; if that's already past, the morning after.
    d.setHours(8, 0, 0, 0);
    if (d.getTime() <= (now instanceof Date ? now.getTime() : Date.now())) {
      d.setDate(d.getDate() + 1);
    }
    // Skip weekend mornings — a Monday 08:00 park is the honest default.
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  function formatUntil(untilMs, now) {
    if (!Number.isFinite(untilMs)) return '';
    var d = new Date(untilMs);
    var t = Number.isFinite(now) ? now : Date.now();
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var startToday = new Date(t);
    startToday.setHours(0, 0, 0, 0);
    var startThen = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var days = Math.round((startThen - startToday) / 86400000);
    if (days === 0) return 'today ' + hh + ':' + mm;
    if (days === 1) return 'tomorrow ' + hh + ':' + mm;
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + hh + ':' + mm;
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    MAX_ENTRIES: MAX_ENTRIES,
    sanitiseStore: sanitiseStore,
    pruneStore: pruneStore,
    parkTask: parkTask,
    unparkTask: unparkTask,
    lookup: lookup,
    defaultUntilMs: defaultUntilMs,
    formatUntil: formatUntil,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ParkLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window);
