// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — generic "Bulk <verb>?" widget for AG-Grid task-list pages.
//
// PURPOSE: Medicus's own task-queue UI (Privacy Officer Alerts, EPS
// Cancellation Failures, and any future task type built on the same
// `/tasks/{slug}/task-list` grid) makes clearing a backlog of routine,
// low-risk tasks one dialog per row. This widget adds a "Bulk <verb>?"
// checklist so several can be actioned in one batch. One generic, config-
// driven engine (this file) is instantiated once per task type —
// content-scripts/privacy-officer-bulk-acknowledge.js and
// content-scripts/eps-cancellation-bulk-discard.js — rather than two
// near-duplicate ~600-line files that would silently drift apart over time
// (same rationale as options.js's initPdcTallySection factory).
//
// DELIBERATELY NOT INLINE-INJECTED INTO THE GRID (unlike problem-bulk-end.js's
// checkboxes in Medicus's <li> problem rows): the task-list grid is AG Grid,
// which VIRTUALISES rows (only visible ones exist in the DOM) and — the
// decisive reason — triage-lens/content.js's own H6 "sort canary" documents
// that a CLIENT-SIDE column sort makes AG Grid silently reassign `row-index`
// attributes to DIFFERENT tasks with no new fetch, which would misattribute
// an inline checkbox to the wrong patient's task. Rather than replicate that
// canary/rowIndex-map-invalidation dance, this widget renders its OWN
// standalone checklist panel above the grid, built from its OWN fetch of the
// same list endpoint, with every row keyed by the task's stable UUID —
// immune to grid sort/scroll/virtualisation by construction, not by
// vigilance. (Precedent: problem-bulk-end.js's own "rows the inline sync
// couldn't match" fallback is exactly this kind of standalone panel list.)
//
// CONTRACTS ARE PER-INSTANTIATION, EACH CONFIRMED LIVE (never guessed —
// see CHANGELOG for the HAR/copy-as-fetch captures behind each):
//   GET  /tasks/data/{taskListSlug}/task-list?{listQueryString}
//        → { tasks: [ {id, ...fields...} ] }  — array order IS row order;
//        this widget never touches the grid's own row-index, so that's
//        incidental, not load-bearing.
//   POST {actionPath}
//        body: { taskId } → 200 {}
//
// SAFETY POSTURE (mirrors problem-bulk-end.js where it still applies):
//   - Two-step confirm: "Review selected" renders an explicit ACTING vs
//     KEEPING summary; only that summary's own Confirm button POSTs.
//   - Per-row failures from a partial batch are shown individually (the
//     option-object/API-400 lesson) — never a bare status.
//   - No auto-reload after success — a "Refresh page" button instead, so a
//     half-typed consultation elsewhere in Medicus is never binned.
//   - One ledger event per BATCH (not per row), `patientRef: null` — this
//     spans MULTIPLE patients, unlike problem-bulk-end.js's single-patient
//     scope, so there is no one patient to attribute it to; the count lives
//     in `label` instead (same aggregate-batch style problem-bulk-end.js
//     itself already uses). The free-typed-text rule still applies: `label`
//     only ever carries a fixed template + a count, never row content.
//   - select-all is a PER-INSTANTIATION config choice (`selectAllAllowed`),
//     not a blanket default — problem-bulk-end.js deliberately has none
//     (every row a live clinical problem); these two task types are lower-
//     stakes audit/compliance actions where select-all was a deliberate,
//     separate decision for each (see each instantiation file's own header).
//
// SPA navigation: Medicus is a Vue-Router app, so this checks
// location.pathname on a throttled, mutation-observed cadence (same
// _hub/scheduleScan pattern as problem-bulk-end.js) rather than once at
// load — the task-list page can be entered/left without a full reload.

'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ──

  // Same extraction as problem-bulk-end.js's apiErrorMessage — duplicated
  // (not shared) the same way each content script already carries its own
  // apiFetch; see that file's comment for the rules being pinned.
  function apiErrorMessage(status, bodyText) {
    var base = 'API ' + status;
    var detail = typeof bodyText === 'string' ? bodyText.trim() : '';
    if (detail) {
      try {
        var data = JSON.parse(detail);
        if (data && typeof data === 'object') {
          if (typeof data.message === 'string' && data.message) detail = data.message;
          else if (typeof data.error === 'string' && data.error) detail = data.error;
          else if (data.errors && typeof data.errors === 'object') detail = JSON.stringify(data.errors);
          else detail = JSON.stringify(data);
        }
      } catch (_) {
        /* not JSON — use the raw text as-is */
      }
    }
    detail = detail.replace(/\s+/g, ' ').trim();
    if (detail.length > 220) detail = detail.slice(0, 220) + '…';
    return detail ? base + ' — ' + detail : base;
  }

  // /{siteId}/tasks/{taskListSlug}/task-list — the browser URL for a task
  // queue page, same route family triage-lens/content.js already detects
  // generically (`/tasks/[^/]+/task-list`), narrowed to one specific slug
  // per instantiation. Also accepts the /tasks/data/{slug}/ task-list shape
  // (overview pages already use /data/) and hyphen vs underscore slug
  // spelling, because a miss here means the Bulk button never appears.
  function parseQueuePagePath(pathname, taskListSlug) {
    var safeSlug = String(taskListSlug == null ? '' : taskListSlug).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeSlug) return null;
    var alt = safeSlug.indexOf('_') >= 0 ? safeSlug.replace(/_/g, '-') : safeSlug.replace(/-/g, '_');
    var slugs = alt === safeSlug ? [safeSlug] : [safeSlug, alt];
    var path = String(pathname == null ? '' : pathname);
    for (var i = 0; i < slugs.length; i++) {
      var re = new RegExp('/([0-9a-z]{2,})/tasks/(?:data/)?' + slugs[i] + '/task-list', 'i');
      var m = re.exec(path);
      if (m) return { siteId: m[1] };
    }
    return null;
  }

  // Same envelope list as page-world.js / submissions-core extractTaskArray:
  // a renamed wrapper must show as an empty checklist, never throw.
  function extractTaskArray(body) {
    if (!body) return [];
    if (Array.isArray(body)) return body;
    if (Array.isArray(body.tasks)) return body.tasks;
    if (Array.isArray(body.results)) return body.results;
    if (Array.isArray(body.rows)) return body.rows;
    if (body.data && Array.isArray(body.data.tasks)) return body.data.tasks;
    if (Array.isArray(body.data)) return body.data;
    return [];
  }

  function taskIdFromRow(row) {
    if (!row || typeof row !== 'object') return '';
    var v = row.id || row.taskId || row.taskUuid || row.uuid;
    return v == null ? '' : String(v);
  }

  function partitionSelection(rows) {
    var acting = [];
    var keeping = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || r.acted) return;
      if (r.checked) acting.push(r);
      else keeping.push(r);
    });
    return { acting: acting, keeping: keeping };
  }

  // The ONE place the submit guard lives: something selected, no batch
  // already in flight. Both the buttons' disabled state AND runAction()'s
  // refusal-to-POST check this.
  function canSubmit(selectedCount, acting) {
    return selectedCount > 0 && !acting;
  }

  function buildActionPayload(taskId) {
    return { taskId: taskId };
  }

  // config.listQueryString may resolve to a plain (already-encoded) string,
  // or to an object { qs, scopeWarning } when the instantiation could not
  // scope the list the way its confirmed contract intends — privacy-officer's
  // masterAssignee filter needs the staff-identity stamp, which can lag page
  // load. A non-null scopeWarning makes the widened scope VISIBLE: the engine
  // renders it as a banner on both the select and confirm steps. A silently
  // widened list rendering identically to a correctly scoped one is how a
  // bulk compliance action gets applied to someone else's queue without
  // anyone noticing.
  //
  // SOFTENED 2026-08-20 (Nick's explicit request, privacy-officer role):
  // this used to also withhold select-all while a scope warning was active,
  // forcing row-by-row ticking. For Nick's real workflow the identity-stamp
  // resolution never succeeds (still unconfirmed why — a role-based
  // assignee mismatch is the leading guess, not yet investigated), so the
  // fallback was ALWAYS active and select-all was ALWAYS unavailable —
  // a permanent, not occasional, block on a legitimate bulk compliance
  // action he's authorised to take under his own professional judgement.
  // The banner (see scopeWarningHtml) still renders at both steps, so the
  // scope is never silently widened — only the withhold-select-all
  // mechanism itself was removed.
  function normaliseListQuery(value) {
    if (value && typeof value === 'object') {
      return {
        qs: String(value.qs == null ? '' : value.qs),
        scopeWarning: value.scopeWarning ? String(value.scopeWarning) : null,
      };
    }
    return { qs: String(value == null ? '' : value), scopeWarning: null };
  }

  // ── Node test hook ────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      apiErrorMessage: apiErrorMessage,
      parseQueuePagePath: parseQueuePagePath,
      extractTaskArray: extractTaskArray,
      taskIdFromRow: taskIdFromRow,
      partitionSelection: partitionSelection,
      canSubmit: canSubmit,
      buildActionPayload: buildActionPayload,
      normaliseListQuery: normaliseListQuery,
    };
  }

  // ── Browser boot ──────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // create(config) — one call per task type. See
  // privacy-officer-bulk-acknowledge.js / eps-cancellation-bulk-discard.js
  // for the two live configs and what each field means in practice.
  //
  // config:
  //   id                 short slug for CSS/DOM ids and the re-entry guard
  //   triggerLabel       e.g. 'Bulk acknowledge?'
  //   verb               e.g. 'Acknowledge' (button text: "Acknowledge N selected")
  //   verbGerund         e.g. 'Acknowledging' — an explicit field, not derived
  //                      by appending 'ing' to verb: that broke on any verb
  //                      ending in a silent e ('Acknowledge' -> the WRONG
  //                      'Acknowledgeing'). Confirmed spelling per verb, same
  //                      spirit as never guessing an endpoint.
  //   verbedAdjective    e.g. 'acknowledged' (past-participle, for tags/done text)
  //   taskListSlug       e.g. 'patient_privacy_officer_alert_task'
  //   listQueryString    already-encoded query string appended to the list
  //                      fetch — a static string, or a (possibly async)
  //                      function evaluated fresh at fetch time; either may
  //                      resolve to { qs, scopeWarning } instead of a bare
  //                      string (see normaliseListQuery)
  //   actionPath         e.g. '/tasks/patient-privacy-officer/complete'
  //   itemNounSingular   e.g. 'privacy officer alert'
  //   itemNounPlural     e.g. 'privacy officer alerts'
  //   emptyMessage       shown when the list loads with zero rows
  //   confirmWarning     shown on the confirm step
  //   selectAllAllowed   bool — see this file's header SAFETY POSTURE note
  //   ledgerRuleId       string
  //   ledgerLabel        function(successCount) -> string (no free text)
  //   rowFields          function(row) -> [{label, value}, ...] (unescaped;
  //                      this engine escapes every value)
  //   rowSummaryLine     function(row) -> string (unescaped) — one-line
  //                      identifier used in the confirm step's list
  function create(config) {
    var guardKey = '__msTaskBulkAction_' + config.id;
    if (window[guardKey]) return;
    window[guardKey] = true;

    var widgetId = 'ms-tba-widget-' + config.id;

    var _siteId = null;
    var _open = false;
    var _step = 'select'; // 'select' | 'confirm' | 'done'
    var _loadState = 'idle'; // 'idle' | 'loading' | 'done' | 'error'
    var _loadError = null;
    var _rows = []; // [{...raw API fields..., checked, acted, actError}]
    var _scopeWarning = null; // non-null = this load's list is wider than the contract intends
    var _acting = false;
    var _onMatchingPage = false;
    // Bumped by removeWidget() (SPA navigation away). In-flight async work
    // (load(), runAction()) captures the value at start and refuses to apply
    // its results if it changed — otherwise a fetch/batch completing AFTER
    // navigation resurrects stale rows/_step ('done' with zero fresh rows,
    // or a task list from the previous visit) on the next page entry.
    var _generation = 0;

    function apiBaseUrl() {
      return 'https://' + _siteId + '.api.' + location.hostname;
    }

    async function apiFetch(path, opts) {
      opts = opts || {};
      var resp = await fetch(apiBaseUrl() + path, {
        method: opts.method || 'GET',
        credentials: 'include',
        headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
        body: opts.body,
      });
      if (!resp.ok) {
        var errBody = '';
        try {
          errBody = await resp.text();
        } catch (_) {
          /* unreadable body — the status alone will have to do */
        }
        throw new Error(apiErrorMessage(resp.status, errBody));
      }
      var text = await resp.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch (_) {
        throw new Error('Task list API returned an unexpected response.');
      }
    }

    async function fetchTaskList() {
      // listQueryString may be a static string (EPS — no assignee scoping,
      // matches its confirmed workflow-view query) or a possibly-async
      // function evaluated fresh at fetch time (Privacy Officer — needs the
      // CURRENT user's own staff id, and waits briefly for the identity
      // stamp; see that instantiation's header for why). Either may resolve
      // to { qs, scopeWarning } — see normaliseListQuery.
      var resolved =
        typeof config.listQueryString === 'function' ? await config.listQueryString() : config.listQueryString;
      var norm = normaliseListQuery(resolved);
      var data = await apiFetch('/tasks/data/' + config.taskListSlug + '/task-list?' + norm.qs);
      // Returned (not written to _scopeWarning here) so load() can apply it
      // only after its own generation check — a fetch completing after SPA
      // navigation must not pollute the next page entry's state.
      return { tasks: extractTaskArray(data), scopeWarning: norm.scopeWarning };
    }

    function postAction(taskId) {
      return apiFetch(config.actionPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildActionPayload(taskId)),
      });
    }

    function selectedCount() {
      return _rows.filter(function (r) {
        return r.checked && !r.acted;
      }).length;
    }

    async function load() {
      var gen = _generation;
      _step = 'select'; // a fresh fetch always starts a fresh flow
      _loadState = 'loading';
      _loadError = null;
      render();
      try {
        var result = await fetchTaskList();
        if (gen !== _generation) return; // navigated away mid-fetch — stale result
        _scopeWarning = result.scopeWarning;
        _rows = result.tasks
          .map(function (t) {
            var id = taskIdFromRow(t);
            return Object.assign({}, t, { id: id, checked: false, acted: false, actError: null });
          })
          .filter(function (t) {
            return !!t.id;
          });
        _loadState = 'done';
      } catch (err) {
        if (gen !== _generation) return;
        _loadState = 'error';
        _loadError = (err && err.message) || 'Failed to load the task list.';
      }
      render();
    }

    async function runAction() {
      var gen = _generation;
      var parts = partitionSelection(_rows);
      if (!canSubmit(parts.acting.length, _acting)) return;
      _acting = true;
      render();
      var results = await Promise.allSettled(
        parts.acting.map(function (r) {
          return postAction(r.id);
        })
      );
      var succeeded = 0;
      results.forEach(function (res, i) {
        var r = parts.acting[i];
        if (res.status === 'fulfilled') {
          succeeded++;
          r.acted = true;
          r.checked = false;
          r.actError = null;
        } else {
          r.actError = (res.reason && res.reason.message) || 'Failed — please try again.';
        }
      });
      _acting = false;
      // One event per BATCH, patientRef null (spans multiple patients) — see
      // this file's header SAFETY POSTURE note.
      if (succeeded > 0 && typeof window !== 'undefined' && window.EventLedger) {
        try {
          window.EventLedger.record({
            source: 'record',
            patientRef: null,
            severity: null,
            ruleId: config.ledgerRuleId,
            label: config.ledgerLabel(succeeded),
            action: 'committed',
          });
        } catch (_) {
          /* ledger must never block the confirm-done UI */
        }
      }
      // The ledger record above still happens on a stale generation — the
      // POSTs really were committed — but the UI state must not be touched:
      // removeWidget() already reset it for the next page entry.
      if (gen !== _generation) return;
      var anyFailed = results.some(function (res) {
        return res.status !== 'fulfilled';
      });
      _step = anyFailed ? 'select' : 'done';
      render();
    }

    // ── Render ────────────────────────────────────────────────────────────

    function rowFieldsHtml(row) {
      var fields = (config.rowFields(row) || [])
        .map(function (f) {
          return (
            '<span class="ms-tba-row-field">' +
            (f.label ? '<strong>' + esc(f.label) + ':</strong> ' : '') +
            esc(f.value) +
            '</span>'
          );
        })
        .join('');
      return fields;
    }

    function scopeWarningHtml() {
      if (!_scopeWarning) return '';
      return '<div class="ms-tba-scope-warning">⚠ ' + esc(_scopeWarning) + '</div>';
    }

    function renderSelectStep() {
      var count = selectedCount();
      var live = _rows.filter(function (r) {
        return !r.acted;
      });
      var summary =
        '<div class="ms-tba-summary">Tick the ' +
        esc(live.length === 1 ? config.itemNounSingular : config.itemNounPlural) +
        ' you want to ' +
        esc(config.verb).toLowerCase() +
        ' — showing all ' +
        live.length +
        ' ' +
        (live.length === 1 ? esc(config.itemNounSingular) : esc(config.itemNounPlural)) +
        '.</div>';

      // select-all is gated ONLY by config.selectAllAllowed — a scope
      // warning no longer withholds it (see this file's SOFTENED 2026-08-20
      // comment above normaliseListQuery). The banner above still makes a
      // widened scope visible at both steps; select-all itself is a UI
      // convenience, not the safety control.
      var selectRow =
        '<div class="ms-tba-select-row">' +
        (config.selectAllAllowed
          ? '<button type="button" class="ms-tba-select-all" id="ms-tba-select-all-' +
            esc(config.id) +
            '">Select all (' +
            live.length +
            ')</button>'
          : '') +
        '<button type="button" class="ms-tba-select-none" id="ms-tba-select-none-' +
        esc(config.id) +
        '"' +
        (count === 0 ? ' disabled' : '') +
        '>Clear selection</button>' +
        '</div>';

      var failed = _rows.filter(function (r) {
        return r.actError;
      });
      var failedHtml = failed.length
        ? '<div class="ms-tba-fail-list">' +
          failed
            .map(function (r) {
              return (
                '<div class="ms-tba-row-error">' + esc(config.rowSummaryLine(r)) + ' — ' + esc(r.actError) + '</div>'
              );
            })
            .join('') +
          '</div>'
        : '';

      var listHtml =
        '<div class="ms-tba-list">' +
        _rows
          .map(function (r) {
            if (r.acted) {
              return (
                '<label class="ms-tba-row ms-tba-row-acted"><input type="checkbox" class="ms-tba-checkbox" checked disabled>' +
                rowFieldsHtml(r) +
                '<span class="ms-tba-row-tag">' +
                esc(config.verbedAdjective.charAt(0).toUpperCase() + config.verbedAdjective.slice(1)) +
                '</span></label>'
              );
            }
            return (
              '<label class="ms-tba-row">' +
              '<input type="checkbox" class="ms-tba-checkbox" data-task-id="' +
              esc(r.id) +
              '"' +
              (r.checked ? ' checked' : '') +
              '>' +
              rowFieldsHtml(r) +
              (r.actError ? '<span class="ms-tba-row-error">' + esc(r.actError) + '</span>' : '') +
              '</label>'
            );
          })
          .join('') +
        '</div>';

      return (
        '<div class="ms-tba-body">' +
        scopeWarningHtml() +
        '<div class="ms-tba-scroll">' +
        summary +
        selectRow +
        failedHtml +
        listHtml +
        '</div>' +
        '<div class="ms-tba-footer">' +
        '<button type="button" class="ms-tba-review-btn" id="ms-tba-review-' +
        esc(config.id) +
        '"' +
        (canSubmit(count, _acting) ? '' : ' disabled') +
        '>Review and ' +
        esc(config.verb.toLowerCase()) +
        ' ' +
        count +
        ' selected…</button>' +
        '</div>' +
        '</div>'
      );
    }

    // The house "about to change the live queue" gate (duplicate-checker's /
    // problem-bulk-end.js's pattern): an explicit ACTING vs KEEPING summary,
    // and only ITS confirm button POSTs.
    function renderConfirmStep() {
      var parts = partitionSelection(_rows);
      var actingHtml = parts.acting
        .map(function (r) {
          return '<li class="ms-tba-confirm-item">' + esc(config.rowSummaryLine(r)) + '</li>';
        })
        .join('');
      return (
        '<div class="ms-tba-body">' +
        scopeWarningHtml() +
        '<div class="ms-tba-scroll">' +
        '<div class="ms-tba-confirm-acting"><span class="ms-tba-confirm-heading">' +
        esc(config.verbGerund.toUpperCase()) +
        ' (' +
        parts.acting.length +
        ')</span><ul class="ms-tba-confirm-list">' +
        actingHtml +
        '</ul></div>' +
        '<div class="ms-tba-confirm-keeping">KEEPING the other ' +
        parts.keeping.length +
        ' ' +
        (parts.keeping.length === 1 ? config.itemNounSingular : config.itemNounPlural) +
        ' untouched.</div>' +
        '<div class="ms-tba-confirm-warning">' +
        esc(config.confirmWarning) +
        '</div>' +
        '</div>' +
        '<div class="ms-tba-footer">' +
        '<div class="ms-tba-confirm-actions">' +
        '<button type="button" class="ms-tba-back-btn" id="ms-tba-back-' +
        esc(config.id) +
        '"' +
        (_acting ? ' disabled' : '') +
        '>Back</button>' +
        '<button type="button" class="ms-tba-confirm-btn" id="ms-tba-confirm-' +
        esc(config.id) +
        '"' +
        (canSubmit(parts.acting.length, _acting) ? '' : ' disabled') +
        '>' +
        (_acting ? config.verbGerund + '…' : 'Confirm — ' + config.verb.toLowerCase() + ' ' + parts.acting.length) +
        '</button>' +
        '</div>' +
        '</div>' +
        '</div>'
      );
    }

    function renderDoneStep() {
      var actedCount = _rows.filter(function (r) {
        return r.acted;
      }).length;
      return (
        '<div class="ms-tba-body">' +
        '<div class="ms-tba-done">✓ ' +
        actedCount +
        ' ' +
        (actedCount === 1 ? config.itemNounSingular : config.itemNounPlural) +
        ' ' +
        esc(config.verbedAdjective) +
        '. Medicus’s own list won’t reflect this until the page is refreshed.</div>' +
        '<div class="ms-tba-confirm-actions">' +
        '<button type="button" class="ms-tba-refresh-btn" id="ms-tba-refresh-' +
        esc(config.id) +
        '">Refresh page</button>' +
        '<button type="button" class="ms-tba-back-btn" id="ms-tba-close-' +
        esc(config.id) +
        '">Close</button>' +
        '</div>' +
        '</div>'
      );
    }

    function buildHtml() {
      var header =
        '<button type="button" class="ms-tba-toggle" id="ms-tba-toggle-' +
        esc(config.id) +
        '" aria-expanded="' +
        _open +
        '">' +
        (_open ? '▾' : '▸') +
        ' ' +
        esc(config.triggerLabel) +
        '</button>';
      if (!_open) return header;
      var body;
      if (_loadState === 'loading') {
        body = '<div class="ms-tba-body"><span class="ms-tba-loading">Loading…</span></div>';
      } else if (_loadState === 'error') {
        body =
          '<div class="ms-tba-body"><span class="ms-tba-error">' +
          esc(_loadError) +
          '</span> <button type="button" class="ms-tba-retry" id="ms-tba-retry-' +
          esc(config.id) +
          '">Retry</button></div>';
      } else if (_loadState === 'done' && _rows.length === 0) {
        body = '<div class="ms-tba-body"><span class="ms-tba-empty">' + esc(config.emptyMessage) + '</span></div>';
      } else if (_loadState === 'done') {
        body = _step === 'confirm' ? renderConfirmStep() : _step === 'done' ? renderDoneStep() : renderSelectStep();
      } else {
        body = '';
      }
      return header + body;
    }

    function bindEvents(el) {
      el.querySelector('#ms-tba-toggle-' + config.id).addEventListener('click', function () {
        if (_open) {
          _open = false;
          render();
          return;
        }
        _open = true;
        if (_loadState === 'idle') {
          load();
        } else {
          render();
        }
      });
      el.querySelector('#ms-tba-retry-' + config.id)?.addEventListener('click', function () {
        load();
      });
      el.querySelectorAll('.ms-tba-checkbox[data-task-id]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var id = cb.getAttribute('data-task-id');
          var r = _rows.find(function (x) {
            return x.id === id;
          });
          if (r) r.checked = cb.checked;
          render();
        });
      });
      el.querySelector('#ms-tba-select-all-' + config.id)?.addEventListener('click', function () {
        _rows.forEach(function (r) {
          if (!r.acted) r.checked = true;
        });
        render();
      });
      el.querySelector('#ms-tba-select-none-' + config.id)?.addEventListener('click', function () {
        _rows.forEach(function (r) {
          r.checked = false;
        });
        render();
      });
      el.querySelector('#ms-tba-review-' + config.id)?.addEventListener('click', function () {
        if (!canSubmit(selectedCount(), _acting)) return;
        _step = 'confirm';
        render();
      });
      el.querySelector('#ms-tba-back-' + config.id)?.addEventListener('click', function () {
        _step = 'select';
        render();
      });
      el.querySelector('#ms-tba-confirm-' + config.id)?.addEventListener('click', function () {
        runAction();
      });
      el.querySelector('#ms-tba-refresh-' + config.id)?.addEventListener('click', function () {
        location.reload();
      });
      el.querySelector('#ms-tba-close-' + config.id)?.addEventListener('click', function () {
        _step = 'select';
        _open = false;
        render();
      });
    }

    function capOpenPanel() {
      var el = document.getElementById(widgetId);
      if (!el) return;
      var body = el.querySelector('.ms-tba-body');
      if (!body) return;
      body.style.height = 'auto';
      body.style.maxHeight = 'none';
      var top = body.getBoundingClientRect().top;
      var max = Math.max(180, window.innerHeight - top - 16);
      var natural = body.getBoundingClientRect().height;
      if (natural > max) {
        body.style.height = max + 'px';
        body.style.maxHeight = max + 'px';
      }
    }

    function render() {
      var el = document.getElementById(widgetId);
      if (!el) return;
      el.innerHTML = buildHtml();
      bindEvents(el);
      requestAnimationFrame(capOpenPanel);
    }

    // ── Injection: one trigger above the AG Grid, retried until the grid
    // itself has rendered (mirrors triage-lens/content.js's
    // setupQueueObserver retry-until-found). ─────────────────────────────────

    function findGridAnchor() {
      return (
        document.querySelector('.ag-root-wrapper') ||
        document.querySelector('.ag-root') ||
        document.querySelector('.ag-body-viewport')
      );
    }

    function injectTrigger() {
      var existing = document.getElementById(widgetId);
      var anchor = findGridAnchor();
      if (existing) {
        if (anchor && anchor.parentElement && existing.parentElement !== anchor.parentElement) {
          anchor.parentElement.insertBefore(existing, anchor);
        }
        return;
      }
      var w = document.createElement('div');
      w.id = widgetId;
      w.className = 'ms-tba-widget';
      w.innerHTML = buildHtml();
      if (anchor && anchor.parentElement) {
        anchor.parentElement.insertBefore(w, anchor);
      } else if (document.body) {
        // Same lesson as document-codes-to-problems: a Vue-managed parent
        // can unmount an inline node. Body is a backstop until the grid
        // exists; checkPage re-runs and will re-home above the grid.
        document.body.insertBefore(w, document.body.firstChild);
      } else {
        return;
      }
      bindEvents(w);
    }

    function removeWidget() {
      var el = document.getElementById(widgetId);
      if (el) el.remove();
      _generation++; // invalidate any in-flight load()/runAction() completions
      _open = false;
      _step = 'select';
      _loadState = 'idle';
      _loadError = null;
      _rows = [];
      _scopeWarning = null;
      _acting = false;
    }

    function checkPage() {
      var info = parseQueuePagePath(location.pathname, config.taskListSlug);
      if (!info) {
        if (_onMatchingPage) removeWidget();
        _onMatchingPage = false;
        return;
      }
      _onMatchingPage = true;
      _siteId = info.siteId;
      injectTrigger();
    }

    // ── SPA-navigation-aware scheduling — same throttle/hub pattern as
    // problem-bulk-end.js. ─────────────────────────────────────────────────

    function isOwnMutation(mutations) {
      // Vue stripping this widget is NOT an own-write — skip-scheduling
      // here is how "Bulk acknowledge?" vanished and never came back.
      if (_onMatchingPage && !document.getElementById(widgetId)) return false;
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#' + widgetId)) continue;
        var nodeLists = [m.addedNodes, m.removedNodes];
        for (var j = 0; j < nodeLists.length; j++) {
          var nodes = nodeLists[j];
          for (var k = 0; k < nodes.length; k++) {
            var n = nodes[k];
            if (n.nodeType !== 1) continue;
            if (n.id === widgetId) continue;
            if (n.closest && n.closest('#' + widgetId)) continue;
            return false;
          }
        }
      }
      return true;
    }

    var _throttle = null;
    function scheduleCheck() {
      if (_throttle) return;
      _throttle = setTimeout(function () {
        _throttle = null;
        if (!document.hidden) checkPage();
      }, 400);
    }

    var _hub = window.__chObserverHub;
    if (_hub && _hub.subscribe) {
      _hub.subscribe(function (mutations) {
        if (isOwnMutation(mutations)) return;
        scheduleCheck();
      });
    } else {
      var _obs = new MutationObserver(function (mutations) {
        if (isOwnMutation(mutations)) return;
        scheduleCheck();
      });
      _obs.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleCheck();
    });

    window.addEventListener('resize', capOpenPanel);

    setInterval(function () {
      if (!document.hidden) scheduleCheck();
    }, 2000);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleCheck);
    } else {
      scheduleCheck();
    }
  }

  window.TaskBulkAction = { create: create };
})();
