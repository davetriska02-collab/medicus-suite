// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Outstanding investigation requests — pure logic, no DOM/chrome/fetch.
//
// Extracts a patient's OUTSTANDING (isAwaitingResults === true) investigation
// requests from GET /clinical/data/patient-journal/overview/{patientId} —
// there is no dedicated list/enumeration endpoint for this; the only way to
// find a patient's outstanding requests at all is to walk their journal
// (confirmed live, 2026-08-26: navigating from a specific outstanding
// request back to how it was reached showed it was opened directly from a
// journal entry, not a separate list screen).
//
// THE FIELD: `isAwaitingResults` genuinely means "no result has come back
// yet" for this request — confirmed against real paired examples (a
// scaphoid X-ray with no report vs. a fully-resulted bloods panel; every
// item on the outstanding request showed isAwaitingResults: true,
// isFulfilled: false, fulfilledByInvestigationReport: null, and every item
// on the resulted one showed the exact inverse with a real report id). It
// does NOT distinguish "not yet sent to the lab" from "sent, awaiting the
// lab's own turnaround" — no capture anywhere carries a dispatch/
// transmission timestamp or status. Treat this as "no result yet", never as
// a confirmed "definitely unsent" state.
//
// investigation-request journal entries can appear flat (top-level) or
// nested inside an encounter's consultation-topic headings — the same dual
// shape every other journal entry type has (docs/learnings-patient-
// journal-api.md). Confirmed live for both a single-item request (an
// X-ray) and a 12-item bloods panel, both nested under an encounter on the
// one patient captured — the flat walk is kept anyway since nothing
// guarantees that holds for every patient.
//
// Dual-mode export (same doctrine as shared/repeat-authorisation.js):
//   Browser (classic script): window.MsOutstandingInvestigations.<fn>(...)
//   Node / test:              require('./shared/outstanding-investigations.js').<fn>(...)

'use strict';

(function (global) {
  // { id, items: string[], requestedBy: string|null, requestedDate: string|null }[]
  // Oldest-requested first — an outstanding request's own age is the useful
  // signal here (no due date exists to sort by).
  function outstandingInvestigationRequests(journal) {
    const days = (journal && journal.patientJournalRecords) || [];
    const out = [];
    const seen = new Set();

    function consider(entry) {
      if (!entry || entry.isMarkedIncorrect || entry.isAwaitingResults !== true) return;
      if (!entry.id || seen.has(entry.id)) return;
      seen.add(entry.id);
      out.push({
        id: entry.id,
        items: Array.isArray(entry.investigationRequestItems) ? entry.investigationRequestItems : [],
        requestedBy: entry.requestedBy || null,
        requestedDate: entry.requestedDate || null,
      });
    }

    for (const day of days) {
      for (const item of day.items || []) {
        if (item.type === 'investigation-request') consider(item);
        if (item.type === 'encounter') {
          for (const topic of (item.data && item.data.consultationTopics) || []) {
            for (const heading of topic.headings || []) {
              for (const entry of heading.entries || []) {
                if (entry.entryType === 'investigation-request') consider(entry);
              }
            }
          }
        }
      }
    }

    out.sort((a, b) => {
      const da = a.requestedDate ? Date.parse(a.requestedDate) : NaN;
      const db = b.requestedDate ? Date.parse(b.requestedDate) : NaN;
      if (Number.isNaN(da) || Number.isNaN(db)) return 0;
      return da - db;
    });
    return out;
  }

  const api = { outstandingInvestigationRequests };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.MsOutstandingInvestigations = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : global);
