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
//        the fetch WAITS for it — up to ~5s — before falling back to an
//        unscoped fetch. The fallback keeps the widget usable, but it must
//        never look identical to the scoped case: an unscoped list includes
//        OTHER staff's pending alerts, so acknowledging it could misattribute
//        a compliance action. So the fallback carries a scopeWarning the
//        engine renders as a banner on the select AND confirm steps — a
//        WARNING to review before confirming, not a block. It used to also
//        withhold select-all for that load; softened 2026-08-20 (Nick's
//        explicit request — the identity-stamp resolution never succeeds for
//        his privacy-officer role, so the fallback was ALWAYS active and
//        select-all was ALWAYS unavailable, permanently blocking a
//        legitimate bulk action rather than occasionally warning about one).
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
    listQueryString: async function () {
      // The stamp can lag page load by a second or two (page-world.js's
      // staff-identity poll) — wait for it rather than instantly widening
      // the fetch, so the common early-click case still gets a correctly
      // scoped "just mine" list.
      var staffId = currentStaffId();
      for (var waited = 0; !staffId && waited < 5000; waited += 250) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 250);
        });
        staffId = currentStaffId();
      }
      var qs = 'statuses%5B%5D=pending&viewContext=homepage';
      if (staffId) return qs + '&masterAssignee=' + encodeURIComponent(staffId);
      // Unscoped fallback — MUST be visibly different from the scoped case;
      // see this file's header. Consequence first, mechanism second. No
      // longer withholds select-all (2026-08-20, softened at Nick's request
      // — see task-bulk-action.js's own SOFTENED comment) — this is now a
      // warning to review before confirming, not a block.
      return {
        qs: qs,
        scopeWarning:
          'Could not confirm which alerts are yours — this list shows pending alerts for ALL staff, ' +
          'not just you. Review the list before confirming — acknowledging someone else’s alert has ' +
          'no bulk undo — or close and reopen this panel to try scoping it to you again.',
      };
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
