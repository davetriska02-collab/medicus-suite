// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — tidy write-core (W9 edit-problem vs W19 change-note).
//
// Payload builders only. The POST helpers and apply paths stay in
// content-scripts/problem-description-cleanup.js. Extracted so W9 and W19
// can be tested without loading the tidy panel, and so laterality/retirement
// (which also call edit-problem) share one builder.
//
// Dual-mode: module.exports for Node; window.TidyWriteCore in the page.

'use strict';

(function () {
  function unwrapOptionValue(field) {
    if (field && typeof field === 'object' && 'value' in field && 'label' in field) return field.value;
    return field;
  }

  function unwrapRecordedByOrganisation(org) {
    if (org && org.value && typeof org.value === 'object' && org.value.organisationName != null) {
      return org.value;
    }
    return org != null ? org : null;
  }

  // W9 — POST /clinical/problem/edit-problem. Full-replace: every field is
  // resent even when unchanged. overrideOnsetDate / overrideAdditionalInformation
  // are optional 4th/3rd args so existing callers that omit them keep behaviour.
  function buildEditProblemPayload(prefill, newProblemCode, overrideAdditionalInformation, overrideOnsetDate) {
    var p = prefill || {};
    var additionalInformation =
      overrideAdditionalInformation !== undefined
        ? overrideAdditionalInformation
        : p.additionalInformation != null
          ? p.additionalInformation
          : null;
    var onsetDate = overrideOnsetDate !== undefined ? overrideOnsetDate : p.onsetDate != null ? p.onsetDate : null;
    var payload = {
      onsetDate: onsetDate,
      contextId: p.contextId != null ? p.contextId : null,
      contextType: p.contextType != null ? p.contextType : null,
      significance: p.significance != null ? unwrapOptionValue(p.significance) : null,
      episode: p.episode != null ? unwrapOptionValue(p.episode) : null,
      problemCode: newProblemCode,
      additionalInformation: additionalInformation,
      hiddenFromPatientFacingServices: !!p.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: !!p.confidentialFromThirdParties,
      endDate: p.endDate != null ? p.endDate : null,
      reasonEnded: p.reasonEnded != null ? unwrapOptionValue(p.reasonEnded) : null,
      recordDate: p.recordDate != null ? p.recordDate : null,
    };
    if (p.recordedAtAnotherOrganisation) {
      payload.recordedByOrganisation = unwrapRecordedByOrganisation(p.recordedByOrganisation);
      payload.recordedByPractitioner = p.recordedByPractitioner != null ? p.recordedByPractitioner : null;
    } else {
      payload.recordedByStaff = p.recordedByStaff != null ? unwrapOptionValue(p.recordedByStaff) : null;
    }
    return payload;
  }

  // W19 — POST /clinical/note/change-note. Writable-subset full replace from
  // a fresh GET /clinical/data/note/edit-note/{noteId} prefill. newCode is
  // {description, conceptId, descriptionId} — the PROBLEM's current code.
  function buildChangeNotePayload(notePrefill, newCode) {
    var p = notePrefill || {};
    return {
      noteId: p.noteId,
      note: p.note,
      noteSNOMEDct: newCode,
      hiddenFromPatientFacingServices: !!p.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: !!p.confidentialFromThirdParties,
      flagOnPatientBanner: !!p.flagOnPatientBanner,
      recordedByOrganisation: unwrapRecordedByOrganisation(p.recordedByOrganisation),
      recordedByPractitioner: p.recordedByPractitioner != null ? p.recordedByPractitioner : null,
      recordedByStaff: p.recordedByStaff != null ? p.recordedByStaff : null,
      recordDate: p.recordDate != null ? p.recordDate : null,
      flags: Array.isArray(p.flags) ? p.flags : [],
      clinicalCaseId: (p.linkedClinicalCase && p.linkedClinicalCase.defaultClinicalCaseId) || null,
      linkedProblemIds: Array.isArray(p.linkedProblemIds) ? p.linkedProblemIds : [],
    };
  }

  var api = {
    unwrapOptionValue: unwrapOptionValue,
    unwrapRecordedByOrganisation: unwrapRecordedByOrganisation,
    buildEditProblemPayload: buildEditProblemPayload,
    buildChangeNotePayload: buildChangeNotePayload,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.TidyWriteCore = api;
  }
})();
