// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Bulk end problems" widget for the Clinical Summary
//
// PURPOSE (user request, 2026-07-27): busy problem lists carry many problems
// that plainly need ending, and Medicus's own UI makes that one dialog per
// problem. This widget lists EVERY active problem with a checkbox and ends
// the selected set in one batch — the general-purpose sibling of
// problem-junk-code-cleanup.js ("Bulk remove?"), which only ever offers
// problems coded under the configured non-problem SNOMED roots.
//
// CONFIRMED CONTRACT — identical to problem-junk-code-cleanup.js's (live HAR
// capture, 2026-07-23, of a real "end problem" action; see that file's
// header for the full story):
//
//   GET  /clinical/data/clinical-summary/summary/{patientId}
//        → { problems: [{ id, problemCodeDescription, … }] }
//   GET  /clinical/data/problem/end-problem/{problemId}
//        → { problemId, activeChildProblems: [...], patientId }
//   POST /clinical/problem/end-problem
//        body: { problemId, endDate, reason } → 200 {}
//        — reason is a plain string (the capture recorded Medicus's own UI
//        sending "not a problem"); NOT a full-record replace.
//
// No SNOMED resolution happens here at all — unlike "Bulk remove?", this
// widget never needs a conceptId, so the opt-in scan is one cheap
// end-problem-form fetch per problem and nothing else.
//
// SAFETY POSTURE (CSO review of the sibling widget, 2026-07-26, applied here
// from day one — every active problem in this list is potentially a REAL
// clinical problem, so this widget is the sharper knife and gets the
// stricter gate):
//   - Nothing is EVER pre-ticked, and there is deliberately NO "Select all"
//     of any kind — every problem must be individually reviewed and ticked.
//   - Problems whose end-problem form reports active child problems are
//     excluded (checkbox disabled), not just warned about.
//   - TWO-STEP CONFIRM: "Review selected" first renders an explicit
//     ENDING / KEEPING summary (the duplicate-checker's renderRemovalFormHtml
//     pattern — the house standard for "about to change the live record")
//     with the end date and reason echoed back; only the Confirm button on
//     that summary actually POSTs.
//   - End date AND reason are guarded at BOTH layers: the buttons disable
//     without them, and endSelected() refuses to POST regardless of button
//     state (an empty endDate/reason must never reach the record).
//   - Ending is not deletion — the code stays in the record, end-dated —
//     but it removes a VISIBLE flag, and the confirm copy says so plainly.
//   - No auto-reload after success (explicit CSO preference vs the sibling
//     widget's v3.191.1 behaviour): a "Refresh page" button is offered
//     instead, so a half-typed consultation is never binned by a reload the
//     clinician didn't ask for.
//   - Every successful batch is recorded in the machine-local Clinical
//     Event Ledger (shared/event-ledger.js, source 'record', action
//     'committed', patient UUID only — the free-typed reason is NEVER
//     written to the ledger, per its no-free-text label rule).
//   - Failed POSTs surface the server's response body per row (the
//     option-object/API-400 lesson of 2026-07-27) — never a bare status.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────

  var DEFAULT_REASON = 'Resolved';

  function buildEndProblemPayload(problemId, endDate, reason) {
    return { problemId: problemId, endDate: endDate, reason: reason };
  }

  // A row is selectable for ending when it hasn't already been ended this
  // session AND its end-problem form reported no active child problems —
  // same exclusion (not just a warning) as problem-junk-code-cleanup.js.
  function isEndable(entry) {
    return !!entry && !entry.ended && (entry.activeChildCount || 0) === 0;
  }

  // The ONE place the submit guards live: something selected, a real end
  // date, a real (non-whitespace) reason, and no batch already in flight.
  // Both the buttons' disabled state AND endSelected()'s refusal-to-POST
  // check this, so a cleared field can never slip an empty value through.
  function canSubmit(selectedCount, endDate, reason, ending) {
    return (
      selectedCount > 0 &&
      typeof endDate === 'string' &&
      endDate.length > 0 &&
      typeof reason === 'string' &&
      reason.trim().length > 0 &&
      !ending
    );
  }

  // Splits the row list for the confirm summary: what the batch will END
  // (checked + endable) vs what it will KEEP (everything else not already
  // ended this session).
  function partitionSelection(rows) {
    var ending = [];
    var keeping = [];
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || r.ended) return;
      if (r.checked && isEndable(r)) ending.push(r);
      else keeping.push(r);
    });
    return { ending: ending, keeping: keeping };
  }

  // Same extraction as problem-description-cleanup.js's apiErrorMessage —
  // duplicated (not shared) the same way each content script already carries
  // its own apiFetch; see that file's comment for the rules being pinned.
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

  // ── Node test hook ────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      DEFAULT_REASON: DEFAULT_REASON,
      buildEndProblemPayload: buildEndProblemPayload,
      isEndable: isEndable,
      canSubmit: canSubmit,
      partitionSelection: partitionSelection,
      apiErrorMessage: apiErrorMessage,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msProblemBulkEnd) return;
  window.__msProblemBulkEnd = true;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function todayISO() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  // ── URL detection — identical to problem-junk-code-cleanup.js's copy ─────────
  var RECORD_URL_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;

  function getPatientInfo() {
    var m = location.pathname.match(RECORD_URL_RE);
    if (!m) return null;
    return { siteId: m[1], patientId: m[2] };
  }

  // ── API ───────────────────────────────────────────────────────────────────────

  function apiBaseUrl() {
    var info = getPatientInfo();
    var parts = location.pathname.split('/').filter(Boolean);
    var siteId = (info && info.siteId) || parts[0] || '';
    return 'https://' + siteId + '.api.' + location.hostname;
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
      throw new Error('Problem API returned an unexpected response.');
    }
  }

  function fetchClinicalSummaryProblems(patientId) {
    return apiFetch('/clinical/data/clinical-summary/summary/' + encodeURIComponent(patientId)).then(function (data) {
      return (data && data.problems) || [];
    });
  }

  function fetchEndProblemForm(problemId) {
    return apiFetch('/clinical/data/problem/end-problem/' + encodeURIComponent(problemId));
  }

  function postEndProblem(problemId, endDate, reason) {
    return apiFetch('/clinical/problem/end-problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildEndProblemPayload(problemId, endDate, reason)),
    });
  }

  // ── DOM: finding a problem's row — same discipline (and duplicate-text
  // claimedAnchors guard) as problem-junk-code-cleanup.js. ─────────────────────
  function findProblemRow(description, claimedAnchors) {
    var links = document.querySelectorAll('a.item__link, a[class*="item__link"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (claimedAnchors && claimedAnchors.has(a)) continue;
      if ((a.textContent || '').trim() === description) return a;
    }
    return null;
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  var _lastPatientId = null;
  var _problemsCache = null;
  var _open = false;
  var _step = 'select'; // 'select' | 'confirm' | 'done'
  var _scanState = 'idle'; // 'idle' | 'scanning' | 'done' | 'error'
  var _scanError = null;
  var _rows = []; // [{ id, description, activeChildCount, anchorEl, checked, ended, endError }]
  var _endDate = todayISO();
  var _reason = DEFAULT_REASON;
  var _ending = false;

  function resetForPatient() {
    _problemsCache = null;
    _open = false;
    _step = 'select';
    _scanState = 'idle';
    _scanError = null;
    _rows = [];
    _endDate = todayISO();
    _reason = DEFAULT_REASON;
    _ending = false;
  }

  function selectedCount() {
    return _rows.filter(function (r) {
      return r.checked && isEndable(r);
    }).length;
  }

  // ── Scan (opt-in — only ever runs from the "Bulk end problems" click) ────────
  async function runScan() {
    _scanState = 'scanning';
    _scanError = null;
    render();
    try {
      var problems = _problemsCache || [];
      var endForms = await Promise.all(
        problems.map(function (p) {
          return fetchEndProblemForm(p.id).catch(function () {
            return null;
          });
        })
      );
      var claimedAnchors = new Set();
      _rows = problems.map(function (p, i) {
        var form = endForms[i];
        var activeChildCount =
          (form && Array.isArray(form.activeChildProblems) && form.activeChildProblems.length) || 0;
        var anchorEl = findProblemRow(p.problemCodeDescription, claimedAnchors);
        if (anchorEl) claimedAnchors.add(anchorEl);
        return {
          id: p.id,
          description: p.problemCodeDescription,
          activeChildCount: activeChildCount,
          anchorEl: anchorEl,
          checked: false,
          ended: false,
          endError: null,
        };
      });
      _scanState = 'done';
    } catch (err) {
      _scanState = 'error';
      _scanError = (err && err.message) || 'Failed to load the problem list.';
    } finally {
      render();
    }
  }

  async function endSelected() {
    var targets = _rows.filter(function (r) {
      return r.checked && isEndable(r);
    });
    // Same double-layer guard as the buttons' disabled state — an empty end
    // date or blank reason must never reach the record, whatever the UI said.
    if (!canSubmit(targets.length, _endDate, _reason, _ending)) return;
    _ending = true;
    render();
    var reason = _reason.trim();
    var results = await Promise.allSettled(
      targets.map(function (r) {
        return postEndProblem(r.id, _endDate, reason);
      })
    );
    var succeeded = 0;
    results.forEach(function (res, i) {
      var r = targets[i];
      if (res.status === 'fulfilled') {
        succeeded++;
        r.ended = true;
        r.checked = false;
        r.endError = null;
        if (r.anchorEl) r.anchorEl.classList.add('ms-pbe-anchor-ended');
      } else {
        r.endError = (res.reason && res.reason.message) || 'Failed to end this problem — please try again.';
      }
    });
    _ending = false;
    // Machine-local audit trail (F2 ledger): one event per batch, patient
    // UUID only, count in the label — NEVER the free-typed reason or any
    // problem description (the ledger's own no-free-text label rule).
    // Fire-and-forget; the ledger swallows its own failures.
    if (succeeded > 0 && typeof window !== 'undefined' && window.EventLedger) {
      var info = getPatientInfo();
      window.EventLedger.record({
        source: 'record',
        patientRef: info && info.patientId,
        severity: null,
        ruleId: 'bulk-end-problems',
        label: 'Bulk end: ' + succeeded + ' problem' + (succeeded === 1 ? '' : 's') + ' ended',
        action: 'committed',
      });
    }
    var anyFailed = results.some(function (res) {
      return res.status !== 'fulfilled';
    });
    // Failures return to the checklist so the per-row errors are visible and
    // retryable; a fully successful batch lands on the done panel with its
    // explicit "Refresh page" offer (never an auto-reload — see header).
    _step = anyFailed ? 'select' : 'done';
    render();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderSelectStep() {
    var count = selectedCount();
    var rowsHtml = _rows
      .map(function (r) {
        if (r.ended) {
          return (
            '<label class="ms-pbe-row ms-pbe-row-ended"><input type="checkbox" checked disabled>' +
            '<span class="ms-pbe-row-desc">' +
            esc(r.description) +
            '</span><span class="ms-pbe-row-tag">Ended</span></label>'
          );
        }
        var disabled = !isEndable(r);
        return (
          '<label class="ms-pbe-row' +
          (disabled ? ' ms-pbe-row-disabled' : '') +
          '">' +
          '<input type="checkbox" class="ms-pbe-checkbox" data-problem-id="' +
          esc(r.id) +
          '"' +
          (r.checked ? ' checked' : '') +
          (disabled ? ' disabled' : '') +
          '>' +
          '<span class="ms-pbe-row-desc">' +
          esc(r.description) +
          '</span>' +
          (r.activeChildCount > 0
            ? '<span class="ms-pbe-row-warn">Has linked problems — end individually in Medicus</span>'
            : '') +
          (r.endError ? '<span class="ms-pbe-row-error">' + esc(r.endError) + '</span>' : '') +
          '</label>'
        );
      })
      .join('');
    return (
      '<div class="ms-pbe-body">' +
      '<div class="ms-pbe-summary">All ' +
      _rows.length +
      ' active problem' +
      (_rows.length === 1 ? '' : 's') +
      ' on this record. Tick each one you want to end — these are live ' +
      'clinical entries, so there is deliberately no "select all". Nothing ' +
      'is ticked by default.</div>' +
      '<div class="ms-pbe-list">' +
      rowsHtml +
      '</div>' +
      '<div class="ms-pbe-field-row">' +
      '<label class="ms-pbe-label" for="ms-pbe-end-date">End date</label>' +
      '<input type="date" class="ms-pbe-date-input" id="ms-pbe-end-date" value="' +
      esc(_endDate) +
      '">' +
      '<label class="ms-pbe-label" for="ms-pbe-reason">Reason</label>' +
      '<input type="text" class="ms-pbe-reason-input" id="ms-pbe-reason" value="' +
      esc(_reason) +
      '" maxlength="120">' +
      '</div>' +
      '<div class="ms-pbe-field-note">One end date and reason for the whole batch.</div>' +
      '<button type="button" class="ms-pbe-review-btn" id="ms-pbe-review"' +
      (canSubmit(count, _endDate, _reason, _ending) ? '' : ' disabled') +
      '>Review ' +
      count +
      ' selected problem' +
      (count === 1 ? '' : 's') +
      '…</button>' +
      '</div>'
    );
  }

  // The house "about to change the live record" gate (duplicate-checker's
  // renderRemovalFormHtml pattern): an explicit ENDING vs KEEPING summary
  // with the date and reason echoed back, and only ITS confirm button POSTs.
  function renderConfirmStep() {
    var parts = partitionSelection(_rows);
    var endingHtml = parts.ending
      .map(function (r) {
        return '<li class="ms-pbe-confirm-item">' + esc(r.description) + '</li>';
      })
      .join('');
    return (
      '<div class="ms-pbe-body">' +
      '<div class="ms-pbe-confirm-ending"><span class="ms-pbe-confirm-heading">ENDING (' +
      parts.ending.length +
      ')</span><ul class="ms-pbe-confirm-list">' +
      endingHtml +
      '</ul></div>' +
      '<div class="ms-pbe-confirm-keeping">KEEPING the other ' +
      parts.keeping.length +
      ' active problem' +
      (parts.keeping.length === 1 ? '' : 's') +
      ' untouched.</div>' +
      '<div class="ms-pbe-confirm-meta">End date <strong>' +
      esc(_endDate) +
      '</strong> · Reason "<strong>' +
      esc(_reason.trim()) +
      '</strong>" (applies to every problem above)</div>' +
      '<div class="ms-pbe-confirm-warning">Ending removes these from the active problem list. The codes stay in ' +
      'the record with this end date, but there is no bulk undo — re-opening ' +
      'them is one problem at a time in Medicus.</div>' +
      '<div class="ms-pbe-confirm-actions">' +
      '<button type="button" class="ms-pbe-back-btn" id="ms-pbe-back"' +
      (_ending ? ' disabled' : '') +
      '>Back</button>' +
      '<button type="button" class="ms-pbe-end-btn" id="ms-pbe-confirm"' +
      (canSubmit(parts.ending.length, _endDate, _reason, _ending) ? '' : ' disabled') +
      '>' +
      (_ending
        ? 'Ending…'
        : 'Confirm — end ' + parts.ending.length + ' problem' + (parts.ending.length === 1 ? '' : 's')) +
      '</button>' +
      '</div>' +
      '</div>'
    );
  }

  function renderDoneStep() {
    var endedCount = _rows.filter(function (r) {
      return r.ended;
    }).length;
    return (
      '<div class="ms-pbe-body">' +
      '<div class="ms-pbe-done">✓ ' +
      endedCount +
      ' problem' +
      (endedCount === 1 ? '' : 's') +
      ' ended. Medicus’s own list won’t reflect this until the page is refreshed.</div>' +
      '<div class="ms-pbe-confirm-actions">' +
      '<button type="button" class="ms-pbe-refresh-btn" id="ms-pbe-refresh">Refresh page</button>' +
      '<button type="button" class="ms-pbe-back-btn" id="ms-pbe-close">Close</button>' +
      '</div>' +
      '</div>'
    );
  }

  function buildHtml() {
    var header =
      '<button type="button" class="ms-pbe-toggle" id="ms-pbe-toggle" aria-expanded="' +
      _open +
      '">' +
      (_open ? '▾' : '▸') +
      ' Bulk end problems</button>';
    if (!_open) return header;
    var body;
    if (_scanState === 'scanning') {
      body = '<div class="ms-pbe-body"><span class="ms-pbe-loading">Loading problems…</span></div>';
    } else if (_scanState === 'error') {
      body =
        '<div class="ms-pbe-body"><span class="ms-pbe-error">' +
        esc(_scanError) +
        '</span> <button type="button" class="ms-pbe-retry" id="ms-pbe-retry">Retry</button></div>';
    } else if (_scanState === 'done' && _rows.length === 0) {
      body = '<div class="ms-pbe-body"><span class="ms-pbe-empty">No active problems on this record.</span></div>';
    } else if (_scanState === 'done') {
      body = _step === 'confirm' ? renderConfirmStep() : _step === 'done' ? renderDoneStep() : renderSelectStep();
    } else {
      body = '';
    }
    return header + body;
  }

  function bindEvents(el) {
    el.querySelector('#ms-pbe-toggle').addEventListener('click', function () {
      if (_open) {
        _open = false;
        render();
        return;
      }
      _open = true;
      if (_scanState === 'idle') {
        runScan();
      } else {
        render();
      }
    });
    el.querySelector('#ms-pbe-retry')?.addEventListener('click', function () {
      runScan();
    });
    el.querySelectorAll('.ms-pbe-checkbox').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-problem-id');
        var r = _rows.find(function (x) {
          return x.id === id;
        });
        if (r) r.checked = cb.checked;
        render();
      });
    });
    el.querySelector('#ms-pbe-end-date')?.addEventListener('change', function (e) {
      _endDate = e.target.value;
      render();
    });
    el.querySelector('#ms-pbe-reason')?.addEventListener('input', function (e) {
      _reason = e.target.value;
      // No full re-render on every keystroke (it would drop focus mid-word);
      // just keep the review button's disabled state honest.
      var btn = el.querySelector('#ms-pbe-review');
      if (btn) btn.disabled = !canSubmit(selectedCount(), _endDate, _reason, _ending);
    });
    el.querySelector('#ms-pbe-review')?.addEventListener('click', function () {
      if (!canSubmit(selectedCount(), _endDate, _reason, _ending)) return;
      _step = 'confirm';
      render();
    });
    el.querySelector('#ms-pbe-back')?.addEventListener('click', function () {
      _step = 'select';
      render();
    });
    el.querySelector('#ms-pbe-confirm')?.addEventListener('click', function () {
      endSelected();
    });
    el.querySelector('#ms-pbe-refresh')?.addEventListener('click', function () {
      location.reload();
    });
    el.querySelector('#ms-pbe-close')?.addEventListener('click', function () {
      _step = 'select';
      _open = false;
      render();
    });
  }

  function render() {
    var el = document.getElementById('ms-pbe-widget');
    if (!el) return;
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  // ── Injection: one "Bulk end problems" trigger next to the "Major" heading —
  // same anchor discipline (and minor-problems fallback) as
  // problem-junk-code-cleanup.js, whose widget shares this row. ────────────────

  function findFirstProblemRow(problems) {
    for (var i = 0; i < problems.length; i++) {
      var row = findProblemRow(problems[i].problemCodeDescription, null);
      if (row) return row;
    }
    return null;
  }

  function findMajorProblemsList() {
    return document.querySelector('ul[aria-labelledby="problems-major-label"]');
  }

  function injectTrigger() {
    if (document.getElementById('ms-pbe-widget')) return;
    if (!_problemsCache || !_problemsCache.length) return;
    var list = findMajorProblemsList();
    if (!list) {
      var row = findFirstProblemRow(_problemsCache);
      if (!row) return;
      list = row.closest('li') ? row.closest('li').parentElement : row.parentElement;
    }
    if (!list || !list.parentElement) return;
    var w = document.createElement('div');
    w.id = 'ms-pbe-widget';
    w.innerHTML = buildHtml();
    list.parentElement.insertBefore(w, list);
    bindEvents(w);
  }

  // ── Cheap summary fetch + re-injection — same observer-hub/throttle/own-
  // mutation pattern as problem-junk-code-cleanup.js. ──────────────────────────
  var _fetchInFlight = false;

  async function ensureProblemsLoaded() {
    var info = getPatientInfo();
    if (!info) return;
    if (info.patientId !== _lastPatientId) {
      _lastPatientId = info.patientId;
      resetForPatient();
    }
    if (!_problemsCache && !_fetchInFlight) {
      _fetchInFlight = true;
      try {
        _problemsCache = await fetchClinicalSummaryProblems(info.patientId);
      } catch (_) {
        _problemsCache = [];
      } finally {
        _fetchInFlight = false;
      }
    }
    if (_problemsCache) injectTrigger();
  }

  var _throttle = null;
  function scheduleScan() {
    if (_throttle) return;
    _throttle = setTimeout(function () {
      _throttle = null;
      if (!document.hidden) ensureProblemsLoaded();
    }, 400);
  }

  function _isOwnMutation(mutations) {
    for (var m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-pbe-widget')) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-pbe-widget') continue;
          if (n.closest && n.closest('#ms-pbe-widget')) continue;
          return false;
        }
      }
    }
    return true;
  }

  var _hub = window.__chObserverHub;
  if (_hub && _hub.subscribe) {
    _hub.subscribe(function (mutations) {
      if (_isOwnMutation(mutations)) return;
      scheduleScan();
    });
  } else {
    var _obs = new MutationObserver(function (mutations) {
      if (_isOwnMutation(mutations)) return;
      scheduleScan();
    });
    _obs.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleScan();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleScan);
  } else {
    scheduleScan();
  }
})();
