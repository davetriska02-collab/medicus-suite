// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Bulk acknowledge?" widget for Privacy Officer Alerts.
//
// Instantiates the generic engine in task-bulk-action.js — see that file's
// header for the shared design (why a standalone panel, not inline grid-row
// checkboxes; why one ledger event per batch with patientRef null; the
// two-step confirm gate).
//
// CONFIRMED CONTRACT (live captures, 2026-08-08):
//   GET  /tasks/data/patient_privacy_officer_alert_task/task-list
//        ?statuses[]=pending&viewContext=homepage&masterAssignee={staffId}
//        → { tasks: [{ id, patientName, dateOfBirth, namedGp, accessType,
//            accessTypeLabel, accessedBy, accessedOn, status, ... }] }
//        `masterAssignee` scopes this to the CURRENT user's own homepage
//        queue (confirmed live with a specific staff id) — never hardcode a
//        UUID here, since that would only ever work for the one account it
//        was captured from. Read fresh at fetch time from the same
//        'data-ch-staff' documentElement stamp task-presence.js already
//        uses (page-world.js: 'staffUuid|email', from the page's own Pusher
//        channel names — never guessed, never typed per-machine). If the
//        stamp isn't there yet (a click within the first second or two of
//        page load, before page-world.js's staff-identity poll resolves),
//        the assignee filter is simply omitted — a broader-than-"just mine"
//        result set is a far smaller harm than the widget being unusable.
//   POST /tasks/patient-privacy-officer/complete
//        body: { taskId } → 200 {}
//
// select-all IS enabled here (unlike problem-bulk-end.js's deliberate none):
// acknowledging a privacy-access-review flag is an audit/compliance action,
// not a clinical record change — Nick's explicit call, 2026-08-08.

'use strict';

(function () {
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
      var staffId = currentStaffId();
      var qs = 'statuses%5B%5D=pending&viewContext=homepage';
      return staffId ? qs + '&masterAssignee=' + encodeURIComponent(staffId) : qs;
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
