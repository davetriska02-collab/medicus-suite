// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — write-core (shared "success is only what the bridge confirms").
//
// Extracted from content-scripts/allergy-cleanup-canvas.js so the v3.236.3
// bug — announced success on a write that settled without throwing, but
// never landed — cannot be re-copied as a one-off.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE:
//
//   1. COMMITS THAT SETTLE AND NEVER THROW MUST STILL BE DIFFED. A failed
//      or bridge-refused row simply comes back missing from the landed list.
//      Success is only the ids the bridge confirms, never the absence of an
//      exception.
//
//   2. CONFIRM COPY NEVER CLAIMS COMPLETION ON A PARTIAL. finaliseConfirmCopy
//      is the one string helper so canvases stop inventing "Done" / "Sent" /
//      "Booked" / "Submitted" / "Staged writes sent" on a write that did not
//      all land.
//
// Pure functions only: no DOM, no chrome, no fetch. Keep this small — it is
// a landed-id diff, not an identity-pin framework.
//
// Dual-mode export (same doctrine as shared/extraction-health.js):
//   Browser (classic script): window.WriteCore.<fn>(...)
//   Node / test:              require('./shared/write-core.js').<fn>(...)

'use strict';

(function () {
  // From an array of {id} (or null/undefined), the ids that landed.
  // Null-safe. Plain map so callers can write `if (landed[id])`.
  function landedIds(list) {
    var out = Object.create(null);
    (Array.isArray(list) ? list : []).forEach(function (item) {
      if (item && item.id) out[item.id] = true;
    });
    return out;
  }

  // Generic wanted-vs-landed diff. The v3.236.3 rule.
  // written = wanted - failed; allWritten = failed === 0.
  function diffWantedVsLanded(wantIds, landedList) {
    var wantedIds = Array.isArray(wantIds) ? wantIds : [];
    var landed = landedIds(landedList);
    var failedIds = wantedIds.filter(function (id) {
      return !landed[id];
    });
    var wanted = wantedIds.length;
    var failed = failedIds.length;
    return {
      failedIds: failedIds,
      wanted: wanted,
      written: wanted - failed,
      failed: failed,
      allWritten: failed === 0,
    };
  }

  // Allergy-canvas contract — keep these field names exact.
  // Null lists treat as empty; match by f.id. Built from two generic diffs.
  function diffFinaliseOutcome(wantEndIds, wantTidyIds, endedList, tidiedList) {
    var ends = diffWantedVsLanded(wantEndIds, endedList);
    var tidies = diffWantedVsLanded(wantTidyIds, tidiedList);
    var wanted = ends.wanted + tidies.wanted;
    var failed = ends.failed + tidies.failed;
    return {
      failedEnds: ends.failedIds,
      failedTidies: tidies.failedIds,
      wanted: wanted,
      written: wanted - failed,
      failed: failed,
      allWritten: failed === 0,
    };
  }

  // Confirm copy for a Finalise (or any write) outcome. Never claims
  // completion on a partial — canvases must not invent their own success
  // sentence.
  function finaliseConfirmCopy(outcome, noun) {
    var o = outcome || {};
    var wanted = typeof o.wanted === 'number' ? o.wanted : 0;
    var written = typeof o.written === 'number' ? o.written : 0;
    var failed = typeof o.failed === 'number' ? o.failed : 0;
    var word = noun == null || noun === '' ? 'writes' : String(noun);
    if (wanted === 0) return 'Nothing to write';
    if (o.allWritten) return written + ' ' + word + ' written';
    return written + ' written, ' + failed + ' failed — failed stay staged';
  }

  var api = {
    landedIds: landedIds,
    diffWantedVsLanded: diffWantedVsLanded,
    diffFinaliseOutcome: diffFinaliseOutcome,
    finaliseConfirmCopy: finaliseConfirmCopy,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.WriteCore = api;
  }
})();
