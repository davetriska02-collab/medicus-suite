// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Bulk discard?" widget for EPS Cancellation Failures.
//
// Instantiates the generic engine in task-bulk-action.js — see that file's
// header for the shared design (why a standalone panel, not inline grid-row
// checkboxes; why one ledger event per batch with patientRef null; the
// two-step confirm gate).
//
// WHY THIS EXISTS (Nick, 2026-08-08) — the intended EPS (Electronic
// Prescription Service) cancellation workflow is:
//   1. A clinician cancels an EPS prescription in Medicus.
//   2. EPS is *supposed* to then cancel the corresponding dispense at the
//      pharmacy end automatically.
//   3. In practice, EPS fails to do this pretty much universally — THIS is
//      what generates the task this widget acts on: advice to the practice
//      to contact the pharmacy and ask them to "return the prescription
//      issue to the Spine" (NHS Spine, the central EPS infrastructure).
//   4. The practice has never managed to get any pharmacy to complete that
//      "return to Spine" step in a way that actually satisfies EPS.
//   5. If it worked, EPS would notify Medicus the issue was returned and the
//      task would auto-resolve on its own. This basically never happens.
//   6. Because the "correct" path fails, practices are left with two manual
//      alternatives, both dead ends as far as EPS itself is concerned:
//        (a) phone the pharmacy anyway, then mark the task "pharmacy
//            contacted" — a status change, NOT a resolution; the task keeps
//            appearing in the default queue (which explicitly includes
//            `pharmacy-contacted` alongside `incomplete`) because EPS still
//            never actually closes it out;
//        (b) discard the task outright, having given up on a real
//            resolution ever arriving.
//   This widget is for path (b) — bulk-discarding tasks in EITHER status,
//   since neither ever leads to genuine EPS auto-resolution; that is why a
//   backlog worth bulk-clearing accumulates in the first place. Unlike
//   problem-bulk-end.js's active-children check (a genuine clinical hazard
//   gate), `pharmacy-contacted` here is not a reason for extra caution — if
//   anything the practice already tried the "correct" step once and it
//   still didn't resolve, so it is just as much a discard candidate as
//   `incomplete`. Both are selectable/discardable the same way.
//
// CONFIRMED CONTRACT (live captures, 2026-08-08, plus the 2026-09-15
// Privacy Officer empty-list lesson):
//   GET  /tasks/data/eps_subsequent_cancellation_task/task-list
//        ?{this page's own filters, else a short fallback plan}
//        → { tasks: [{ id, patientName, dateOfBirth, medicationName,
//            namedGp, status, statusText, assignedTo, ... }] }
//        The 2026-08-08 capture used
//        `statuses[]=incomplete&statuses[]=pharmacy-contacted&viewContext=workflow`.
//        That is a shared workflow queue, not a personal inbox — do NOT add
//        a masterAssignee from data-ch-staff. A working staff stamp on the
//        Privacy Officer twin emptied the dedicated grid; inventing one
//        here would be the same class of bug.
//        Query plan (first non-empty response wins):
//          1. this page's location.search, when it already has statuses /
//             viewContext / masterAssignee — same filters as the grid
//          2. the historical workflow capture (both statuses)
//          3. both statuses, no invented viewContext
//          4. both statuses + viewContext=homepage (sibling inbox shape)
//        Steps 3–4 carry a scopeWarning — a WARNING to review, not a
//        block. Select-all stays available.
//   POST /tasks/eps-prescription-order-item/cancellation/mark-as-no-longer-needed
//        body: { taskId } → 200 {} (assumed — "copy as fetch" doesn't
//        capture response bodies; low risk, the widget only needs
//        success/failure, never parses this response).
//        NOTE the endpoint is scoped to `eps-prescription-order-item`, a
//        DIFFERENT slug family entirely from this task type's own
//        `eps-subsequent-cancellation`/`eps_subsequent_cancellation_task` —
//        confirmed live specifically because guessing by analogy with
//        Privacy Officer's "same slug for overview and action" pattern
//        would have been wrong here.
//
// Suite's checklist is its OWN fetch, keyed by task UUID — never Medicus's
// AG-Grid header checkbox (H6 sort-canary: a client-side column sort
// reassigns row-index to a different task). The empty state must say so.
//
// select-all IS enabled here (Nick's call, 2026-08-08, extended from Privacy
// Officer Alerts to this task type too) — discarding is an administrative
// give-up-on-EPS action, not a clinical record change.

'use strict';

(function () {
  var EPS_WORKFLOW_QS = 'statuses%5B%5D=incomplete&statuses%5B%5D=pharmacy-contacted&viewContext=workflow';
  var EPS_STATUSES_QS = 'statuses%5B%5D=incomplete&statuses%5B%5D=pharmacy-contacted';
  var EPS_HOMEPAGE_QS = 'statuses%5B%5D=incomplete&statuses%5B%5D=pharmacy-contacted&viewContext=homepage';
  var EPS_WIDE_WARNING =
    'This list is every incomplete / pharmacy-contacted EPS cancellation on this queue, not a personal inbox. ' +
    'Review before confirming — discarding has no bulk undo.';

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
  // Never invent a masterAssignee from data-ch-staff — that is a personal
  // inbox and is how the Privacy Officer twin emptied a full dedicated grid.
  function epsCancellationQueryPlan(pageSearch) {
    var plan = [];
    var pageQs = stripSearch(pageSearch);
    if (searchHasListFilters(pageQs)) {
      plan.push({ qs: pageQs, scopeWarning: null });
    }
    plan.push({ qs: EPS_WORKFLOW_QS, scopeWarning: null });
    plan.push({ qs: EPS_STATUSES_QS, scopeWarning: EPS_WIDE_WARNING });
    plan.push({ qs: EPS_HOMEPAGE_QS, scopeWarning: EPS_WIDE_WARNING });
    return plan;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      epsCancellationQueryPlan: epsCancellationQueryPlan,
      searchHasListFilters: searchHasListFilters,
      EPS_WORKFLOW_QS: EPS_WORKFLOW_QS,
      EPS_STATUSES_QS: EPS_STATUSES_QS,
      EPS_HOMEPAGE_QS: EPS_HOMEPAGE_QS,
      EPS_WIDE_WARNING: EPS_WIDE_WARNING,
    };
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!window.TaskBulkAction) return;

  window.TaskBulkAction.create({
    id: 'epsCancellation',
    triggerLabel: 'Bulk discard?',
    verb: 'Discard',
    verbGerund: 'Discarding',
    verbedAdjective: 'discarded',
    taskListSlug: 'eps_subsequent_cancellation_task',
    listQueryString: function () {
      return epsCancellationQueryPlan(location.search);
    },
    actionPath: '/tasks/eps-prescription-order-item/cancellation/mark-as-no-longer-needed',
    itemNounSingular: 'EPS cancellation task',
    itemNounPlural: 'EPS cancellation tasks',
    emptyMessage: 'No pending EPS cancellation tasks.',
    confirmWarning:
      'Discarding marks these as no longer needed — the practice is giving up on EPS ever resolving them. There is no bulk undo — re-opening one is one task at a time in Medicus.',
    selectAllAllowed: true,
    ledgerRuleId: 'bulk-discard-eps-cancellation',
    ledgerLabel: function (n) {
      return 'Bulk discard: ' + n + ' EPS cancellation task' + (n === 1 ? '' : 's') + ' discarded';
    },
    rowFields: function (row) {
      var fields = [
        { label: '', value: row.patientName || 'Unknown patient' },
        { label: 'DOB', value: row.dateOfBirth || '' },
        { label: '', value: row.medicationName || '' },
      ];
      if (row.statusText) fields.push({ label: 'Status', value: row.statusText });
      return fields;
    },
    rowSummaryLine: function (row) {
      var bits = [row.patientName || 'Unknown patient'];
      if (row.medicationName) bits.push(row.medicationName);
      return bits.join(' — ');
    },
  });
})();
