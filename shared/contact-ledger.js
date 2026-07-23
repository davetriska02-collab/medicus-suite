// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Contact & task-age ledger (classic script, content-script safe)
//
// A pure-logic store behind two escalate-only queue chips:
//   B3 repeat-contact  — "3rd contact in 14d"  (patient-keyed contact log)
//   B5 aged-request    — "carried over 4d"     (task-keyed first-seen log)
//
// ONE module, TWO record kinds, ONE storage surface pattern (two chrome.storage
// keys, both under the `ledger.` prefix → they inherit the Event Ledger's
// deliberately-NOT-backed-up doctrine; see test-backup-coverage.js ALLOWLIST).
// The storage READ/WRITE is NOT done here — content.js owns a memory mirror and
// the debounced, dirty-checked flush (so the reinject-on-refresh path can query
// synchronously). This file is the pure core: it takes a plain-object store +
// inputs + a `now`, and returns a new/updated store + query answers, with zero
// chrome/DOM dependency, so it is fully unit-testable under node.
//
// PRIVACY (load-bearing — this is a local history of what the extension saw):
//   - Contact log stores patientUuid + taskUuid + a 'YYYY-MM-DD' first-seen day.
//     NO names, NO free text, NO clinical content. patientUuid/taskUuid are the
//     Medicus opaque identifiers only, shape-validated to UUID-ish here.
//   - Task-age log stores taskUuid + first/last-seen day + the task-type slug.
//     No patient identity at all — B5 never needs to resolve the patient.
//   - Both are pruned (contacts >28d, tasks not seen >14d) and hard-capped, so
//     the on-disk footprint stays bounded regardless of how long a tab lives.
//
// Escalate-only: the query helpers only ever answer "how many / how long"; there
// is no "first contact"/"fresh request" state — a below-threshold patient/task
// simply produces no chip (the caller decides the threshold).
//
// Usage (browser classic script): window.ContactLedger.<fn>(...)
// Usage (node / test):            require('./shared/contact-ledger.js').<fn>(...)

(function (global) {
  'use strict';

  if (global && global.ContactLedger) return; // re-entry guard (mirrors event-ledger.js)

  // ── Storage keys (never backed up — allowlisted in test-backup-coverage.js) ──
  var CONTACT_KEY = 'ledger.contactLog'; // { patientUuid: [ { t: taskUuid, d: 'YYYY-MM-DD' } ] }
  var TASK_KEY = 'ledger.taskAge'; // { taskUuid: { f: firstDay, l: lastDay, s: slug } }

  // ── Caps / windows ───────────────────────────────────────────────────────────
  var CONTACT_MAX_AGE_DAYS = 28; // drop a contact entry once its day is >28d old
  var CONTACT_WINDOW_DAYS = 14; // "3rd contact in 14d" — the deterioration window
  var CONTACT_MIN_COUNT = 3; // fire the ledger (tier-2) chip at ≥3 distinct contacts
  var CONTACT_MAX_PATIENTS = 500; // bound total patients (prune oldest-day-first)
  var CONTACT_MAX_PER_PATIENT = 20; // bound per-patient contacts (keep newest)
  var TASK_MAX_AGE_DAYS = 14; // prune a task not seen for >14d (bounced/closed)
  var TASK_MAX = 2000; // bound total tracked tasks (prune stalest lastSeen)

  var UUIDISH_RE = /^[0-9a-fA-F][0-9a-fA-F-]{7,63}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var SLUG_RE = /^[a-zA-Z0-9_-]{1,80}$/;

  // ── Pure date helpers ─────────────────────────────────────────────────────────

  /** 'YYYY-MM-DD' for a Date (or now). Local date — the queue shows local dates. */
  function todayStr(now) {
    var d = now instanceof Date ? now : new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /** Whole-day difference from day `a` to day `b` ('YYYY-MM-DD'); null if unusable. */
  function dayDiff(a, b) {
    if (!DAY_RE.test(String(a)) || !DAY_RE.test(String(b))) return null;
    var ta = Date.parse(a + 'T00:00:00');
    var tb = Date.parse(b + 'T00:00:00');
    if (isNaN(ta) || isNaN(tb)) return null;
    return Math.round((tb - ta) / 86400000);
  }

  function validUuid(s) {
    return typeof s === 'string' && UUIDISH_RE.test(s) ? s.toLowerCase() : null;
  }

  // ── Store sanitisers (defensive — the store is read back from storage) ────────

  function sanitiseContactStore(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var p = validUuid(keys[i]);
      if (!p) continue;
      var list = raw[keys[i]];
      if (!Array.isArray(list)) continue;
      var seen = {};
      var clean = [];
      for (var j = 0; j < list.length; j++) {
        var e = list[j];
        if (!e || typeof e !== 'object') continue;
        var t = validUuid(e.t);
        var d = DAY_RE.test(String(e.d)) ? e.d : null;
        if (!t || !d) continue;
        if (seen[t]) {
          // Keep the EARLIEST day for a repeated task (first-seen semantics).
          if (d < seen[t].d) seen[t].d = d;
          continue;
        }
        var rec = { t: t, d: d };
        seen[t] = rec;
        clean.push(rec);
      }
      if (clean.length) out[p] = clean;
    }
    return out;
  }

  function sanitiseTaskStore(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) {
      var t = validUuid(keys[i]);
      if (!t) continue;
      var v = raw[keys[i]];
      if (!v || typeof v !== 'object') continue;
      var f = DAY_RE.test(String(v.f)) ? v.f : null;
      var l = DAY_RE.test(String(v.l)) ? v.l : f;
      if (!f) continue;
      var s = typeof v.s === 'string' && SLUG_RE.test(v.s) ? v.s : null;
      out[t] = { f: f, l: l < f ? f : l, s: s };
    }
    return out;
  }

  // ── Contact log (B3 tier-2) — pure ops ───────────────────────────────────────

  /**
   * Record one distinct patient contact (a task first seen on a request queue).
   * Mutates `store` in place and returns true iff something CHANGED (so the
   * caller's dirty-check can skip a no-op write). Deduped by taskUuid within the
   * patient; the stored day is the EARLIEST seen for that task.
   */
  function recordContact(store, patientUuid, taskUuid, day) {
    var p = validUuid(patientUuid);
    var t = validUuid(taskUuid);
    if (!store || !p || !t || !DAY_RE.test(String(day))) return false;
    var list = store[p] || (store[p] = []);
    for (var i = 0; i < list.length; i++) {
      if (list[i].t === t) {
        if (day < list[i].d) {
          list[i].d = day;
          return true;
        }
        return false; // already known, no earlier day → no change
      }
    }
    list.push({ t: t, d: day });
    return true;
  }

  /** Distinct contacts for a patient within `windowDays` of `now` (a Date). */
  function countRecentContacts(store, patientUuid, now, windowDays) {
    var p = validUuid(patientUuid);
    if (!store || !p) return 0;
    var list = store[p];
    if (!Array.isArray(list) || !list.length) return 0;
    var today = todayStr(now);
    var win = typeof windowDays === 'number' ? windowDays : CONTACT_WINDOW_DAYS;
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var age = dayDiff(list[i].d, today);
      if (age != null && age >= 0 && age <= win) n++;
    }
    return n;
  }

  /** Drop contacts older than CONTACT_MAX_AGE_DAYS and enforce the caps. Mutates. */
  function pruneContacts(store, now) {
    if (!store || typeof store !== 'object') return {};
    var today = todayStr(now);
    var patients = Object.keys(store);
    for (var i = 0; i < patients.length; i++) {
      var p = patients[i];
      var list = store[p];
      if (!Array.isArray(list)) {
        delete store[p];
        continue;
      }
      var kept = [];
      for (var j = 0; j < list.length; j++) {
        var age = dayDiff(list[j].d, today);
        if (age != null && age >= 0 && age <= CONTACT_MAX_AGE_DAYS) kept.push(list[j]);
      }
      if (!kept.length) {
        delete store[p];
        continue;
      }
      // Per-patient cap: keep the NEWEST CONTACT_MAX_PER_PATIENT contacts.
      if (kept.length > CONTACT_MAX_PER_PATIENT) {
        kept.sort(function (a, b) {
          return a.d < b.d ? 1 : a.d > b.d ? -1 : 0;
        });
        kept = kept.slice(0, CONTACT_MAX_PER_PATIENT);
      }
      store[p] = kept;
    }
    // Global patient cap: prune patients whose NEWEST contact is oldest.
    var remaining = Object.keys(store);
    if (remaining.length > CONTACT_MAX_PATIENTS) {
      remaining
        .map(function (p2) {
          var l = store[p2];
          var newest = '';
          for (var k = 0; k < l.length; k++) if (l[k].d > newest) newest = l[k].d;
          return { p: p2, newest: newest };
        })
        .sort(function (a, b) {
          return a.newest < b.newest ? -1 : a.newest > b.newest ? 1 : 0;
        })
        .slice(0, remaining.length - CONTACT_MAX_PATIENTS)
        .forEach(function (x) {
          delete store[x.p];
        });
    }
    return store;
  }

  // ── Task-age log (B5) — pure ops ──────────────────────────────────────────────

  /**
   * Record a task seen on a request queue today. Sets firstSeen on first sight,
   * bumps lastSeen to `day`, records the task-type slug. Mutates `store`; returns
   * true iff something CHANGED (dirty-check hook — a same-day re-sight is a no-op).
   */
  function recordTask(store, taskUuid, slug, day) {
    var t = validUuid(taskUuid);
    if (!store || !t || !DAY_RE.test(String(day))) return false;
    var s = typeof slug === 'string' && SLUG_RE.test(slug) ? slug : null;
    var cur = store[t];
    if (!cur) {
      store[t] = { f: day, l: day, s: s };
      return true;
    }
    var changed = false;
    if (day > cur.l) {
      cur.l = day;
      changed = true;
    }
    if (day < cur.f) {
      cur.f = day;
      changed = true;
    }
    if (s && cur.s !== s) {
      cur.s = s;
      changed = true;
    }
    return changed;
  }

  /** Whole days a task has been carried since first-seen (0 if first seen today); null if absent. */
  function taskCarriedDays(store, taskUuid, now) {
    var t = validUuid(taskUuid);
    if (!store || !t) return null;
    var cur = store[t];
    if (!cur || !cur.f) return null;
    var d = dayDiff(cur.f, todayStr(now));
    return d != null && d >= 0 ? d : null;
  }

  /** Prune tasks not seen for >TASK_MAX_AGE_DAYS, then enforce the count cap. Mutates. */
  function pruneTasks(store, now) {
    if (!store || typeof store !== 'object') return {};
    var today = todayStr(now);
    var keys = Object.keys(store);
    for (var i = 0; i < keys.length; i++) {
      var cur = store[keys[i]];
      if (!cur || !cur.l) {
        delete store[keys[i]];
        continue;
      }
      var age = dayDiff(cur.l, today);
      if (age == null || age < 0 || age > TASK_MAX_AGE_DAYS) delete store[keys[i]];
    }
    var remaining = Object.keys(store);
    if (remaining.length > TASK_MAX) {
      remaining
        .sort(function (a, b) {
          // stalest lastSeen first
          return store[a].l < store[b].l ? -1 : store[a].l > store[b].l ? 1 : 0;
        })
        .slice(0, remaining.length - TASK_MAX)
        .forEach(function (k) {
          delete store[k];
        });
    }
    return store;
  }

  // ── Small presentation helper ─────────────────────────────────────────────────

  /** English ordinal: 1→"1st", 2→"2nd", 3→"3rd", 4→"4th", 11→"11th". */
  function ordinal(n) {
    var v = Number(n);
    if (!isFinite(v)) return String(n);
    v = Math.abs(Math.floor(v));
    var rem100 = v % 100;
    if (rem100 >= 11 && rem100 <= 13) return v + 'th';
    switch (v % 10) {
      case 1:
        return v + 'st';
      case 2:
        return v + 'nd';
      case 3:
        return v + 'rd';
      default:
        return v + 'th';
    }
  }

  var api = {
    // pure date/id helpers
    todayStr: todayStr,
    dayDiff: dayDiff,
    ordinal: ordinal,
    // store sanitisers
    sanitiseContactStore: sanitiseContactStore,
    sanitiseTaskStore: sanitiseTaskStore,
    // contact log (B3 tier-2)
    recordContact: recordContact,
    countRecentContacts: countRecentContacts,
    pruneContacts: pruneContacts,
    // task-age log (B5)
    recordTask: recordTask,
    taskCarriedDays: taskCarriedDays,
    pruneTasks: pruneTasks,
    constants: {
      CONTACT_KEY: CONTACT_KEY,
      TASK_KEY: TASK_KEY,
      CONTACT_MAX_AGE_DAYS: CONTACT_MAX_AGE_DAYS,
      CONTACT_WINDOW_DAYS: CONTACT_WINDOW_DAYS,
      CONTACT_MIN_COUNT: CONTACT_MIN_COUNT,
      CONTACT_MAX_PATIENTS: CONTACT_MAX_PATIENTS,
      CONTACT_MAX_PER_PATIENT: CONTACT_MAX_PER_PATIENT,
      TASK_MAX_AGE_DAYS: TASK_MAX_AGE_DAYS,
      TASK_MAX: TASK_MAX,
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global) {
    global.ContactLedger = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null);
