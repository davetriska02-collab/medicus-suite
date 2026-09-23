// Medicus Suite — Lab Filing: the union-only combination and the mandatory shadow log (Phase E, stage E1).
//
// PURE: no DOM, no chrome.*, no fetch, no storage — a caller (content-scripts/triage-lens/lab-file-button.js)
// does the actual reading/writing. This file holds the two small rules that make E1 safe to wire in:
//
//   combineFilingBlockers(legacyBlockers, catalogueResult) — the union-only contract (H-080 control a): the
//   catalogue engine's blockers are ADDED to the legacy ones, NEVER used to remove one. When the catalogue engine
//   could not evaluate at all (catalogueResult.ok === false) the combination is legacy alone — a broken or absent
//   catalogue must never be read as "nothing to add".
//
//   buildShadowLogEntry(...) — a MANDATORY, value-free comparison record (H-080 control b): "where would the
//   catalogue engine have unblocked something legacy blocks, or blocked something legacy allows" — reviewed before
//   any engine change, never acted on itself. It must never carry a patient's result value, so it uses ONLY
//   engine/lab-filing-catalogue.js's `reasonKinds` (short tags), never its `blockers` (human sentences, which MAY
//   embed a value like "77 u/L is above your maximum of 130") — see that file's own header.
//
// This file does not itself decide WHAT gets offered — at this stage the live gate still acts on legacy blockers
// alone; combineFilingBlockers exists so the wiring can compute "what WOULD the combined verdict be" for the
// shadow log without duplicating the union rule at the call site. Only a later stage (E2, the `filingEngine` pref)
// makes the combined result the one that is actually offered.
//
// Run tests: node test-lab-filing-gate.js

(function (global) {
  'use strict';

  const asArr = (v) => (Array.isArray(v) ? v : []);

  // legacyBlockers: string[]. catalogueResult: engine/lab-filing-catalogue.js's return value.
  // Returns { blockers: string[], usedCatalogue: boolean } — usedCatalogue is false whenever the catalogue engine
  // had a problem (ok:false), so a caller can tell "legacy alone" apart from "legacy, and the catalogue agreed".
  function combineFilingBlockers(legacyBlockers, catalogueResult) {
    const legacy = asArr(legacyBlockers);
    if (!catalogueResult || catalogueResult.ok !== true) {
      return { blockers: [...legacy], usedCatalogue: false };
    }
    return { blockers: Array.from(new Set([...legacy, ...asArr(catalogueResult.blockers)])), usedCatalogue: true };
  }

  // opts: { taskUuid, labId, legacyBlockers: string[], catalogueResult }. Never throws — a shadow log entry that
  // fails to build must not disturb the real gate, so a caller wraps this in its own try/catch too, but this
  // function fails safe on its own (a malformed input yields a minimal, still value-free entry).
  function buildShadowLogEntry(opts) {
    const o = opts || {};
    const legacyBlockers = asArr(o.legacyBlockers);
    const cat = o.catalogueResult && typeof o.catalogueResult === 'object' ? o.catalogueResult : { ok: false };
    const legacyBlocked = legacyBlockers.length > 0;
    const catalogueOk = cat.ok === true;
    const catalogueBlocked = catalogueOk && asArr(cat.blockers).length > 0;
    const meta = catalogueOk && cat.meta && typeof cat.meta === 'object' ? cat.meta : {};
    return {
      ts: new Date().toISOString(),
      taskUuid: typeof o.taskUuid === 'string' && o.taskUuid ? o.taskUuid : null,
      labId: typeof meta.labId === 'string' ? meta.labId : typeof o.labId === 'string' ? o.labId : null,
      legacyBlockerCount: legacyBlockers.length,
      catalogueOk,
      catalogueError: !catalogueOk && typeof cat.error === 'string' ? cat.error : null,
      catalogueBlockerCount: catalogueOk ? asArr(cat.blockers).length : 0,
      catalogueReasonKinds: catalogueOk ? Array.from(new Set(asArr(cat.reasonKinds))).sort() : [],
      recognisedCount: typeof meta.recognisedCount === 'number' ? meta.recognisedCount : 0,
      unrecognisedCount: typeof meta.unrecognisedCount === 'number' ? meta.unrecognisedCount : 0,
      groupsUsed: Array.from(new Set(asArr(meta.groupsUsed))).sort(),
      // The dangerous direction (H-080's whole reason for existing): the catalogue engine could evaluate, and
      // would have offered a report legacy currently blocks. Must NEVER change real behaviour at this stage —
      // this is what the shadow log exists to surface before anyone trusts it to.
      wouldHaveUnblocked: legacyBlocked && catalogueOk && !catalogueBlocked,
      // The safe/expected direction: the catalogue is stricter than legacy on this report.
      wouldHaveAddedBlock: !legacyBlocked && catalogueBlocked,
    };
  }

  const api = { combineFilingBlockers, buildShadowLogEntry };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.LabFilingGate = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
