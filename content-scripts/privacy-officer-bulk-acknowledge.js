// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Bulk acknowledge?" widget for Privacy Officer Alerts.
//
// Instantiates the generic engine in task-bulk-action.js — see that file's
// header for the shared design (why a standalone panel, not inline grid-row
// checkboxes; why one ledger event per batch with patientRef null; the
// two-step confirm gate).
//
// CONFIRMED CONTRACT (live captures, 2026-08-08, plus the 2026-09-15 empty-
// list failure):
//   GET  /tasks/data/patient_privacy_officer_alert_task/task-list
//        ?{this page's own filters, else a short fallback plan}
//        → { tasks: [{ id, patientName, dateOfBirth, namedGp, accessType,
//            accessTypeLabel, accessedBy, accessedOn, status, ... }] }
//        The 2026-08-08 capture used
//        `statuses[]=pending&viewContext=homepage&masterAssignee={staffId}`.
//        That is the CURRENT user's homepage inbox — a different list from
//        the dedicated Privacy Officer Alerts task-list page. When the
//        `data-ch-staff` stamp is present, that scoped GET returns [] while
//        Medicus's own grid is full (Dave, live, 2026-09-15: italic
//        "No pending privacy officer alerts." above a checked Patient
//        header). The identity stamp often fails for a privacy-officer
//        role (Nick, 2026-08-20), which accidentally made the unscoped
//        fallback the only working path. A working stamp is therefore a
//        regression, not a fix.
//        Query plan (first non-empty response wins):
//          1. this page's location.search, when it already has statuses /
//             viewContext / masterAssignee — same filters as the grid
//          2. the historical homepage+assignee capture, if the stamp is
//             already present (no 5s wait — empty fallback is the control)
//          3. `statuses[]=pending` (shared queue, no invented viewContext)
//          4. unscoped homepage
//          5. `statuses[]=pending&viewContext=workflow` (sibling queues
//             on a dedicated task-list use this view)
//        Steps 3–5 carry a scopeWarning — a WARNING to review, not a
//        block. Select-all stays available (softened 2026-08-20).
//   POST /tasks/patient-privacy-officer/complete
//        body: { taskId } → 200 {}
//
// Suite's checklist is its OWN fetch, keyed by task UUID — never Medicus's
// AG-Grid header checkbox (H6 sort-canary: a client-side column sort
// reassigns row-index to a different task). The empty state must say so;
// a silent no-op after the clinician ticked the table is the reported bug.
//
// select-all IS enabled here (unlike problem-bulk-end.js's deliberate none):
// acknowledging a privacy-access-review flag is an audit/compliance action,
// not a clinical record change — Nick's explicit call, 2026-08-08.

'use strict';

(function () {
  var PO_HOMEPAGE_QS = 'statuses%5B%5D=pending&viewContext=homepage';
  var PO_PENDING_QS = 'statuses%5B%5D=pending';
  var PO_WORKFLOW_QS = 'statuses%5B%5D=pending&viewContext=workflow';
  var PO_SHARED_WARNING =
    'This list is every pending privacy officer alert on this queue, not a personal inbox. ' +
    'Review before confirming — acknowledging someone else’s alert has no bulk undo.';
  var PO_ALL_STAFF_WARNING =
    'Could not confirm which alerts are yours — this list shows pending alerts for ALL staff, ' +
    'not just you. Review the list before confirming — acknowledging someone else’s alert has ' +
    'no bulk undo — or close and reopen this panel to try scoping it to you again.';

  function stripSearch(search) {
    var raw = String(search == null ? '' : search);
    if (raw.charAt(0) === '?') raw = raw.slice(1);
    return raw;
  }

  function searchHasListFilters(search) {
    var qs = stripSearch(search);
    if (!qs) return false;
    return /(?:^|&)(statuses(?:%5B%5D|\[\])?|viewContext|masterAssignee)=/i.test(qs);
  }

  // Ordered fetches. The engine keeps the first response that has rows.
  function privacyOfficerQueryPlan(pageSearch, staffId) {
    var plan = [];
    var pageQs = stripSearch(pageSearch);
    if (searchHasListFilters(pageQs)) {
      plan.push({ qs: pageQs, scopeWarning: null });
    }
    if (staffId) {
      plan.push({
        qs: PO_HOMEPAGE_QS + '&masterAssignee=' + encodeURIComponent(staffId),
        scopeWarning: null,
      });
    }
    plan.push({ qs: PO_PENDING_QS, scopeWarning: PO_SHARED_WARNING });
    plan.push({
      qs: PO_HOMEPAGE_QS,
      scopeWarning: staffId ? PO_SHARED_WARNING : PO_ALL_STAFF_WARNING,
    });
    plan.push({ qs: PO_WORKFLOW_QS, scopeWarning: PO_SHARED_WARNING });
    return plan;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      privacyOfficerQueryPlan: privacyOfficerQueryPlan,
      searchHasListFilters: searchHasListFilters,
      PO_HOMEPAGE_QS: PO_HOMEPAGE_QS,
      PO_PENDING_QS: PO_PENDING_QS,
      PO_WORKFLOW_QS: PO_WORKFLOW_QS,
      PO_SHARED_WARNING: PO_SHARED_WARNING,
      PO_ALL_STAFF_WARNING: PO_ALL_STAFF_WARNING,
    };
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!window.TaskBulkAction) return;

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Same stamp-attribute parse as task-presence.js's parseStaffAttr —
  // duplicated, not imported (each content script owns its own small
  // helpers; see task-bulk-action.js's apiErrorMessage comment for why).
  function currentStaffId() {
    try {
      var raw = document.documentElement.getAttribute('data-ch-staff');
      if (!raw) return null;
      var bar = raw.indexOf('|');
      var id = (bar >= 0 ? raw.slice(0, bar) : raw).trim();
      return UUID_RE.test(id) ? id.toLowerCase() : null;
    } catch (_) {
      return null;
    }
  }

  window.TaskBulkAction.create({
    id: 'privacyOfficer',
    triggerLabel: 'Bulk acknowledge?',
    verb: 'Acknowledge',
    verbGerund: 'Acknowledging',
    verbedAdjective: 'acknowledged',
    taskListSlug: 'patient_privacy_officer_alert_task',
    listQueryString: function () {
      return privacyOfficerQueryPlan(location.search, currentStaffId());
    },
    actionPath: '/tasks/patient-privacy-officer/complete',
    itemNounSingular: 'privacy officer alert',
    itemNounPlural: 'privacy officer alerts',
    emptyMessage: 'No pending privacy officer alerts.',
    confirmWarning:
      'Acknowledging removes these from the pending queue. There is no bulk undo — re-opening one is one task at a time in Medicus.',
    selectAllAllowed: true,
    ledgerRuleId: 'bulk-acknowledge-privacy-officer',
    ledgerLabel: function (n) {
      return 'Bulk acknowledge: ' + n + ' privacy officer alert' + (n === 1 ? '' : 's') + ' acknowledged';
    },
    rowFields: function (row) {
      var fields = [
        { label: '', value: row.patientName || 'Unknown patient' },
        { label: 'DOB', value: row.dateOfBirth || '' },
        { label: '', value: row.accessTypeLabel || row.accessType || '' },
      ];
      if (row.accessedBy) fields.push({ label: 'Accessed by', value: String(row.accessedBy).trim() });
      if (row.accessedOn) fields.push({ label: 'On', value: row.accessedOn });
      return fields;
    },
    rowSummaryLine: function (row) {
      var bits = [row.patientName || 'Unknown patient'];
      if (row.accessTypeLabel || row.accessType) bits.push(row.accessTypeLabel || row.accessType);
      return bits.join(' — ');
    },
  });
})();
