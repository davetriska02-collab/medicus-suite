// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — Pending-result cross-link index (classic script, content-script safe)
//
// A derived index over the taskUuid-keyed result-triage cache (_queueResultCache
// in content-scripts/triage-lens/content.js). It answers ONE question for the B2
// pending-abnormal-lab cross-link chip: "does THIS patient have a red/amber result
// that was graded — while the clinician was on the results queue — this tab
// session, and not yet actioned?"
//
// THE CARDINAL SAFETY RULE (B2 / H6 hazard): an index entry is only ever a POINTER
// to a live _queueResultCache severity entry. It MUST die the instant its source
// entry dies — TTL prune, priorityDisplay invalidation, config invalidation, or a
// re-grade to null/none. This module owns NONE of that lifecycle; content.js calls
// set()/drop()/clear() at exactly those source-mutation points. This module only
// maintains the two-way mapping (task→patient and patient→tasks) so a
// query-by-patient and a drop-by-task are both cheap. Serving a chip from an entry
// whose source has gone is a stale / wrong-patient hazard — hence "dies with source".
//
// Escalate-only: set() stores ONLY 'red'/'amber'. Anything else is a drop — there is
// no such thing as a "no pending result" index entry.
//
// Usage (browser classic script): window.PendingResultIndex.create()
// Usage (Node / test):            require('./shared/pending-result-index.js').create()

(function (global) {
  'use strict';

  var SEV_RANK = { red: 0, amber: 1 };
  function normSev(sev) {
    return sev === 'red' || sev === 'amber' ? sev : null;
  }

  function create() {
    // taskUuid -> { patientUuid, sev:'red'|'amber', gradedTs }
    var byTask = new Map();
    // patientUuid -> Set<taskUuid>
    var byPatient = new Map();

    function unlink(taskUuid, patientUuid) {
      var set = byPatient.get(patientUuid);
      if (!set) return;
      set.delete(taskUuid);
      if (set.size === 0) byPatient.delete(patientUuid);
    }

    // Upsert a graded red/amber result for a patient. A non-red/amber severity, a
    // missing taskUuid, or a missing patientUuid is treated as a DROP — the only
    // states worth cross-linking are escalations, and an entry with no live source
    // patient must not linger.
    function set(taskUuid, patientUuid, sev, gradedTs) {
      if (!taskUuid) return;
      var level = normSev(sev);
      if (!level || !patientUuid) {
        drop(taskUuid);
        return;
      }
      var prev = byTask.get(taskUuid);
      // A task that re-grades under a DIFFERENT patient (identity re-resolved) must
      // leave its old patient bucket, or a stale patient could still match it.
      if (prev && prev.patientUuid !== patientUuid) unlink(taskUuid, prev.patientUuid);
      byTask.set(taskUuid, {
        patientUuid: patientUuid,
        sev: level,
        gradedTs: typeof gradedTs === 'number' && isFinite(gradedTs) ? gradedTs : Date.now(),
      });
      var set2 = byPatient.get(patientUuid);
      if (!set2) {
        set2 = new Set();
        byPatient.set(patientUuid, set2);
      }
      set2.add(taskUuid);
    }

    // Drop by taskUuid — THE source-entry-died hook. Idempotent (dropping an
    // absent task is a no-op), so it is always safe to call from every teardown path.
    function drop(taskUuid) {
      var prev = byTask.get(taskUuid);
      if (!prev) return;
      byTask.delete(taskUuid);
      unlink(taskUuid, prev.patientUuid);
    }

    function clear() {
      byTask.clear();
      byPatient.clear();
    }

    // Query the worst pending result for a patient. Returns
    //   { worstSev:'red'|'amber', taskUuids:[...], gradedTs:<most-recent>, count }
    // or null when the patient has no live pending entry. Reads ONLY byTask entries
    // still present, so a bucket that has been drained by drop() can never serve a
    // ghost.
    function query(patientUuid) {
      if (!patientUuid) return null;
      var set = byPatient.get(patientUuid);
      if (!set || set.size === 0) return null;
      var worst = null;
      var gradedTs = 0;
      var taskUuids = [];
      set.forEach(function (t) {
        var e = byTask.get(t);
        if (!e) return; // defensive — unlink keeps the two maps in step, so unreachable
        taskUuids.push(t);
        if (worst === null || SEV_RANK[e.sev] < SEV_RANK[worst]) worst = e.sev;
        if (e.gradedTs > gradedTs) gradedTs = e.gradedTs;
      });
      if (!worst) return null;
      return { worstSev: worst, taskUuids: taskUuids, gradedTs: gradedTs, count: taskUuids.length };
    }

    function size() {
      return byTask.size;
    }
    function has(taskUuid) {
      return byTask.has(taskUuid);
    }
    // The worst severity + gradedTs recorded for a single task (test/diagnostic aid).
    function getTask(taskUuid) {
      var e = byTask.get(taskUuid);
      return e ? { patientUuid: e.patientUuid, sev: e.sev, gradedTs: e.gradedTs } : null;
    }

    return {
      set: set,
      drop: drop,
      clear: clear,
      query: query,
      size: size,
      has: has,
      getTask: getTask,
    };
  }

  // Format a short data-age label from a millisecond delta: "<1m", "5m", "3h", "2d".
  // The cross-link chip MUST always carry this (B2 hazard control — a stale
  // cross-link must announce its age). Never "just now" — the red chip appends
  // " ago", and "just now ago" reads wrong. Exported for reuse + testing.
  function formatAge(deltaMs) {
    if (typeof deltaMs !== 'number' || !isFinite(deltaMs) || deltaMs < 0) return '';
    if (deltaMs < 60000) return '<1m';
    var mins = Math.floor(deltaMs / 60000);
    if (mins < 60) return mins + 'm';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h';
    var days = Math.floor(hrs / 24);
    return days + 'd';
  }

  var api = { create: create, formatAge: formatAge };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (global) {
    global.PendingResultIndex = api;
  }
})(typeof window !== 'undefined' ? window : null);
