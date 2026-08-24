// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Shared — miniaturised "What's due" list from Sentinel chips.
//
// Used by the floating Patient-actions panel on task pages
// (content-scripts/task-actions-panel.js). Same action-needed threshold as
// sentinel-core.js / brief-core.js (STATUS_RANK <= 2). Signal wording mirrors
// brief-core.js so the strip reads as a pocket Sentinel brief, not a second
// invented voice. Max 4 lines + "+N more" — same cap as the side-panel brief.
//
// Dual-mode export (same pattern as shared/smoking-status.js):
//   Browser (classic script): window.MsDueMini.<fn>(...)
//   Node / test:              require('./shared/due-mini.js').<fn>(...)
//
// THIS FILE DOES NOT FETCH. Callers pass chips they already trust belong to
// the on-screen patient. dueFromSnapshot() is the identity gate: it refuses
// to build a list unless snapshot.patientContext matches the caller-supplied
// patient UUID. A mismatch is 'pending', never a list for the wrong person.

(function (global) {
  'use strict';

  // MUST stay in lock-step with STATUS_RANK in engine/rules-engine.js and
  // side-panel/modules/sentinel/sentinel-core.js. test-status-rank-sync.js
  // pins those two; test-due-mini.js pins this copy to the engine table.
  var STATUS_RANK = {
    overdue: 0,
    not_met: 0,
    alert: 0,
    stale: 1,
    due_soon: 2,
    caution: 2,
    no_data: 3,
    noted: 3,
    recently_initiated: 4,
    achieved: 5,
    in_date: 5,
    vax_given: 5,
    vax_declined: 3,
    vax_due: 1,
  };

  var TYPE_RANK = {
    'drug-monitoring': 0,
    'drug-combo': 1,
    'event-count': 1,
    composite: 1,
    'qof-indicator': 2,
    'qof-process-indicator': 2,
    vaccine: 3,
  };

  var MAX_ITEMS = 4;

  function isChipActionNeeded(status) {
    return (STATUS_RANK[status] ?? 99) <= 2;
  }

  function typeRank(type) {
    return TYPE_RANK[type] ?? 4;
  }

  function chipSeverity(chip) {
    var rank = STATUS_RANK[chip.status] ?? 99;
    return rank === 0 ? 'red' : 'amber';
  }

  // Mirrors brief-core.js drugSignalText — do not drift independently.
  function drugSignalText(chip) {
    var drug = chip.drugName || chip.ruleId || 'Drug';
    var dueTests = (chip.tests || [])
      .filter(function (t) {
        return t && isChipActionNeeded(t.status);
      })
      .map(function (t) {
        return t.testName || t.name;
      })
      .filter(Boolean);
    var testsPart = dueTests.length > 0 ? dueTests.join(', ') : 'monitoring';
    var word = chip.status === 'stale' ? 'severely overdue' : chip.status === 'overdue' ? 'overdue' : 'due soon';
    return drug + ' — ' + testsPart + ' ' + word;
  }

  // Mirrors brief-core.js qofSignalText.
  function qofSignalText(chip) {
    var code = chip.indicatorCode || chip.ruleId || 'QOF';
    var name = chip.indicatorName ? String(chip.indicatorName).slice(0, 40) : null;
    return name ? code + ' — ' + name : code;
  }

  // Mirrors brief-core.js genericSignalText.
  function genericSignalText(chip) {
    var label =
      chip.displayName || chip.label || chip.drugName || chip.indicatorCode || chip.ruleName || chip.ruleId || 'Alert';
    var word = chip.status ? String(chip.status).replace(/_/g, ' ') : '';
    return word ? label + ' — ' + word : label;
  }

  function chipSignalText(chip) {
    if (chip.type === 'drug-monitoring') return drugSignalText(chip);
    if (chip.type === 'qof-indicator' || chip.type === 'qof-process-indicator') return qofSignalText(chip);
    return genericSignalText(chip);
  }

  /**
   * buildDueMini(chips) → DueMini
   *
   * @param {Array|null} chips — Sentinel chip array (or null)
   * @returns {{
   *   items: Array<{ severity: 'red'|'amber', text: string, status: string }>,
   *   moreCount: number,
   *   moreRed: number,
   *   redCount: number,
   *   amberCount: number,
   *   nothingDue: boolean
   * }}
   */
  function buildDueMini(chips) {
    var list = Array.isArray(chips)
      ? chips.filter(function (c) {
          return c && isChipActionNeeded(c.status);
        })
      : [];
    var redCount = 0;
    var amberCount = 0;
    for (var i = 0; i < list.length; i++) {
      if ((STATUS_RANK[list[i].status] ?? 99) === 0) redCount++;
      else amberCount++;
    }
    var sorted = list.slice().sort(function (a, b) {
      var rankDiff = (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return typeRank(a.type) - typeRank(b.type);
    });
    var shown = sorted.slice(0, MAX_ITEMS);
    var hidden = sorted.slice(MAX_ITEMS);
    return {
      items: shown.map(function (chip) {
        return {
          severity: chipSeverity(chip),
          text: chipSignalText(chip),
          status: chip.status,
        };
      }),
      moreCount: hidden.length,
      moreRed: hidden.filter(function (c) {
        return (STATUS_RANK[c.status] ?? 99) === 0;
      }).length,
      redCount: redCount,
      amberCount: amberCount,
      nothingDue: list.length === 0,
    };
  }

  function snapshotPatientUuid(snapshot) {
    var pc = snapshot && snapshot.patientContext;
    if (!pc) return null;
    return pc.patientUuid || pc.patientId || pc.id || pc.uuid || null;
  }

  function samePatientId(a, b) {
    if (!a || !b) return false;
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  /**
   * dueFromSnapshot(snapshot, patientId) → { state, mini?, degraded? }
   *
   * Identity gate. Returns state 'pending' (do not render chips) unless the
   * snapshot carries chips for THIS patientId. A previous patient's snapshot,
   * an unavailable/invalidated snapshot, or a missing patientId must never
   * produce a due list — that is the H-001 control for this surface.
   *
   * state:
   *   'pending' — no trusted match yet (loading / wrong patient / empty snap)
   *   'ready'   — mini belongs to this patient and may be rendered
   */
  function dueFromSnapshot(snapshot, patientId) {
    if (!snapshot || snapshot.unavailable === true || !Array.isArray(snapshot.chips)) {
      return { state: 'pending' };
    }
    var snapPid = snapshotPatientUuid(snapshot);
    if (!patientId || !snapPid || !samePatientId(snapPid, patientId)) {
      return { state: 'pending' };
    }
    return {
      state: 'ready',
      mini: buildDueMini(snapshot.chips),
      degraded: !!snapshot.degraded,
    };
  }

  var api = {
    STATUS_RANK: STATUS_RANK,
    MAX_ITEMS: MAX_ITEMS,
    isChipActionNeeded: isChipActionNeeded,
    buildDueMini: buildDueMini,
    snapshotPatientUuid: snapshotPatientUuid,
    samePatientId: samePatientId,
    dueFromSnapshot: dueFromSnapshot,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MsDueMini = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
