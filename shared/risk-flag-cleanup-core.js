// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — risk-flag banner-cleanup core (payload + write-set).
//
// W24 clears only `flagOnPatientBanner` via POST /clinical/note/change-note
// (same endpoint as W19). The note's SNOMED code, free text, risk category
// (`flags`), author, record date and organisation are read from a fresh
// GET /clinical/data/note/edit-note/{noteId} and passed back unchanged.
//
// Dual-mode: module.exports for Node tests, window.RiskFlagCleanupCore in
// the content script. Pure: no DOM, no chrome.*, no fetch.

'use strict';

(function (global) {
  // Same 13 keys, same order, as W19 buildChangeNotePayload.
  var POST_KEYS = [
    'noteId',
    'note',
    'noteSNOMEDct',
    'hiddenFromPatientFacingServices',
    'confidentialFromThirdParties',
    'flagOnPatientBanner',
    'recordedByOrganisation',
    'recordedByPractitioner',
    'recordedByStaff',
    'recordDate',
    'flags',
    'clinicalCaseId',
    'linkedProblemIds',
  ];

  // Copied from content-scripts/problem-description-cleanup.js (W19).
  // Unwraps ONLY when this exact wrapped shape is detected (a real inner
  // object carrying organisationName); otherwise passes the field through
  // completely unchanged. NEVER `org.value` when the GET is already flat —
  // a flat {organisationName, …} has no .value, and posting that 400s.
  function unwrapRecordedByOrganisation(org) {
    if (org && org.value && typeof org.value === 'object' && org.value.organisationName != null) {
      return org.value;
    }
    return org != null ? org : null;
  }

  // Writable-subset full replace, same 13 keys as W19, except:
  //   - noteSNOMEDct is kept from the prefill (do not change the code)
  //   - flagOnPatientBanner is forced false
  function buildClearBannerFlagPayload(editNote) {
    var p = editNote || {};
    return {
      noteId: p.noteId,
      note: p.note,
      noteSNOMEDct: p.noteSNOMEDct,
      hiddenFromPatientFacingServices: !!p.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: !!p.confidentialFromThirdParties,
      flagOnPatientBanner: false,
      recordedByOrganisation: unwrapRecordedByOrganisation(p.recordedByOrganisation),
      recordedByPractitioner: p.recordedByPractitioner != null ? p.recordedByPractitioner : null,
      recordedByStaff: p.recordedByStaff != null ? p.recordedByStaff : null,
      recordDate: p.recordDate != null ? p.recordDate : null,
      flags: Array.isArray(p.flags) ? p.flags : [],
      clinicalCaseId: (p.linkedClinicalCase && p.linkedClinicalCase.defaultClinicalCaseId) || null,
      linkedProblemIds: Array.isArray(p.linkedProblemIds) ? p.linkedProblemIds : [],
    };
  }

  function matchesFilter(row, filter) {
    var q = String(filter == null ? '' : filter)
      .trim()
      .toLowerCase();
    if (!q) return true;
    var desc = String((row && row.description) || '').toLowerCase();
    var cat = String((row && row.category) || '').toLowerCase();
    return desc.indexOf(q) !== -1 || cat.indexOf(q) !== -1;
  }

  function selectedHas(selectedSet, id) {
    if (!selectedSet || id == null) return false;
    if (typeof selectedSet.has === 'function') return selectedSet.has(id);
    if (Array.isArray(selectedSet)) return selectedSet.indexOf(id) !== -1;
    return !!selectedSet[id];
  }

  // Rows with status==='pending', id in selectedSet, matching filter
  // (description or category, case-insensitive). Empty filter = all
  // selected pending. The write set — never "every selected id".
  function visiblePendingSelected(rows, selectedSet, filter) {
    var list = Array.isArray(rows) ? rows : [];
    return list.filter(function (r) {
      if (!r || r.status !== 'pending') return false;
      var id = r.noteId != null ? r.noteId : r.id;
      if (!selectedHas(selectedSet, id)) return false;
      return matchesFilter(r, filter);
    });
  }

  var api = {
    POST_KEYS: POST_KEYS,
    unwrapRecordedByOrganisation: unwrapRecordedByOrganisation,
    buildClearBannerFlagPayload: buildClearBannerFlagPayload,
    visiblePendingSelected: visiblePendingSelected,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) global.RiskFlagCleanupCore = api;
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
