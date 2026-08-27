// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Routine-prescription one-click re-assign button
//
// Adds a floating action button to the prescription-request task overview that
// re-assigns the task to a configured team (e.g. "Prescribing / Meds Management")
// by DRIVING THE REAL MEDICUS UI — it clicks the same controls a user would:
//
//   1. radio  "Save & send to routine requests task list"
//   2. input  "Assign to"            (opens the assignee picker)
//   3. option <the configured team>  ([id^="select-item-"], matched by text)
//   4. button "Send to routine list" (the commit)
//
// WHY drive the UI rather than the API: this keeps Medicus as the system of
// record — its own validation, access control and audit trail all fire exactly
// as if the clinician clicked. This file makes NO network calls and reads no
// patient-data field values.
//
// SAFETY
//   • All controls are matched by VISIBLE TEXT — every id on this screen is
//     generated per session (radio_group_*, select_*, select-item-<uuid>), so
//     ids are never trusted.
//   • If ANY step's control cannot be found, the macro ABORTS with a message and
//     clicks nothing further — it must never click the wrong control.
//   • The final commit is gated by `commitMode`:
//       'confirm' (default) — pre-fills, asks, then clicks Re-assign task
//       'manual'            — pre-fills, highlights Re-assign task, user clicks
//       'auto'              — does all four steps including the commit
//   • The macro operates on whatever task is currently on screen; it does not
//     choose the patient. The confirm gate names the destination team.
//
// Runs in the ISOLATED world at document_idle (see manifest content_scripts).

(function () {
  'use strict';
  if (window.__chRoutineRx) return;
  window.__chRoutineRx = true;

  // DOM-contract registry (Horizon-1) — loaded earlier in the manifest's
  // content-script list. Selectors below are read FROM shared/dom-contracts.js
  // rather than duplicated here, so the registry and this file cannot drift
  // apart. See routine-rx.routing-control / routine-rx.assignee-option /
  // routine-rx.action-anchor in that registry.
  var DC = window.DomContracts;

  // ---- config / storage --------------------------------------------------

  var STORE_KEY = 'triagelens.routineRx';
  // Machine-local audit ring buffer for this macro's writes (H-035 gap fix —
  // see recordAudit below). Same shape/cap convention as labfiling.auditLog /
  // triagelens.oir.auditLog: full detail here, a schema-compliant subset
  // mirrored into the shared Event Ledger. Deliberately machine-local — see
  // shared/io/triage-io.js for the backup-convention decision.
  var AUDIT_KEY = 'triagelens.routinerx.auditLog';
  var DEFAULTS = {
    teams: ['Prescribing / Meds Management'],
    lastTeam: 'Prescribing / Meds Management',
    commitMode: 'confirm', // 'confirm' | 'manual' | 'auto'
  };
  var cfg = Object.assign({}, DEFAULTS);

  function loadCfg() {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve();
      chrome.storage.local.get(STORE_KEY, function (r) {
        var s = r && r[STORE_KEY];
        if (s && typeof s === 'object') {
          cfg.teams = Array.isArray(s.teams) && s.teams.length ? s.teams.slice() : DEFAULTS.teams.slice();
          cfg.lastTeam = typeof s.lastTeam === 'string' && s.lastTeam ? s.lastTeam : cfg.teams[0];
          cfg.commitMode =
            ['confirm', 'manual', 'auto'].indexOf(s.commitMode) >= 0 ? s.commitMode : DEFAULTS.commitMode;
        }
        if (cfg.teams.indexOf(cfg.lastTeam) < 0) cfg.teams.unshift(cfg.lastTeam);
        resolve();
      });
    });
  }

  function saveCfg() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    var out = {};
    out[STORE_KEY] = { teams: cfg.teams, lastTeam: cfg.lastTeam, commitMode: cfg.commitMode };
    chrome.storage.local.set(out);
  }

  // Write one audit entry for a macro run's outcome. Mirrors lab-file-button.js's
  // recordAudit split exactly: the FULL detail (task URL/UUID, team, commit
  // mode, reason) goes only into the machine-local ring buffer (AUDIT_KEY,
  // capped at 200, newest-first); the shared Event Ledger mirror carries only
  // the schema-compliant subset (source/patientRef/severity/ruleId/label/
  // action) — no patient identity is available here (this file makes no
  // network calls, see file header), so patientRef/severity/ruleId stay null
  // and `label` carries the team name instead.
  //
  // outcome: 'committed' (the macro clicked "Send to routine list") |
  //          'highlighted' (manual mode — pre-filled, user must click) |
  //          'aborted' (couldn't complete — includes the clinician declining
  //          the confirm-mode dialog; `reason` explains why).
  function recordAudit(team, mode, outcome, reason) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      var taskUuid = null;
      try {
        var m = /\/tasks\/data\/[^/]+\/overview\/([^/?#]+)/.exec(
          (typeof location !== 'undefined' && location.pathname) || ''
        );
        taskUuid = m ? m[1] : null;
      } catch (e) {
        /* ignore */
      }
      var entry = {
        ts: new Date().toISOString(),
        taskUrl: (typeof location !== 'undefined' && location.href) || null,
        taskUuid: taskUuid,
        team: team || null,
        commitMode: mode || null,
        outcome: outcome,
        reason: reason || null,
      };
      chrome.storage.local.get(AUDIT_KEY, function (r) {
        var arr = Array.isArray(r[AUDIT_KEY]) ? r[AUDIT_KEY] : [];
        arr.unshift(entry);
        var out = {};
        out[AUDIT_KEY] = arr.slice(0, 200);
        chrome.storage.local.set(out);
      });
      // F2 Clinical Event Ledger mirror — fire-and-forget, never breaks the
      // macro (see event-ledger.js record()'s own try/catch).
      if (typeof window !== 'undefined' && window.EventLedger) {
        window.EventLedger.record({
          source: 'routinerx',
          patientRef: null,
          severity: null,
          ruleId: null,
          label: team || null,
          action: outcome,
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  // Final-step helpers — small and side-effect-isolated on purpose so the
  // audited outcome is exercised the same way whichever path reaches it
  // ('auto' mode and an accepted 'confirm' dialog both call commitAndAudit;
  // 'manual' mode calls highlightAndAudit). Kept standalone (not inlined in
  // runMacro) so they can be extracted and unit-tested without driving the
  // full async find/type/wait pipeline — see test-routine-rx-macro.js.
  function commitAndAudit(commitEl, team, mode) {
    realClick(commitEl);
    // Audit R10 doctrine (shared/write-core.js): observing our own click is
    // not a successful re-assignment — the copy must not claim completion.
    toast('Clicked “Send to routine list” for “' + team + '”. Check the task has left your list.', 'ok');
    recordAudit(team, mode, 'committed', null);
  }
  function highlightAndAudit(commitEl, team, mode) {
    highlight(commitEl);
    toast('Ready — review and click “Send to routine list”.', 'ok');
    recordAudit(team, mode, 'highlighted', null);
  }

  // ---- DOM helpers -------------------------------------------------------

  function norm(s) {
    return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function visible(el) {
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }
  // Medicus keeps "Re-assign task" disabled until a valid assignee is chosen.
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    if (el.classList && el.classList.contains('disabled')) return false;
    return true;
  }
  // own/visible text of an element, trimmed
  function textOf(el) {
    return norm((el && el.getAttribute && el.getAttribute('aria-label')) || (el && el.textContent));
  }
  // Find the first visible element matching one of `selectors` whose text equals
  // (or, as a fallback, contains) `wanted`.
  //
  // `exactOnly` (2026-08-22 clinical-safety audit R8): the COMMIT click must
  // pass true — a partial fallback that clicks a control merely CONTAINING
  // "send to routine list" could commit a different Medicus action from the
  // one this macro names. Exact (whitespace-normalised, case-insensitive) or
  // nothing. Finding/marking steps may keep the partial arm.
  function findByText(selectors, wanted, exactOnly) {
    var w = norm(wanted);
    var nodes = [];
    selectors.forEach(function (sel) {
      try {
        Array.prototype.push.apply(nodes, document.querySelectorAll(sel));
      } catch (e) {
        /* ignore */
      }
    });
    var exact = null,
      partial = null;
    // Match TEXT first (cheap — textContent/aria-label, no geometry) and only
    // call visible() — which forces a layout reflow via offsetParent/
    // getClientRects — on the few text-matching candidates. Otherwise a wide
    // div/span fallback sweep would trigger a per-node reflow storm.
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var t = textOf(el);
      if (t === w) {
        if (!visible(el)) continue;
        exact = el;
        break;
      }
      if (!exactOnly && !partial && t.indexOf(w) >= 0 && visible(el)) partial = el;
    }
    return exact || partial;
  }

  // Like findByText, but returns EVERY visible element whose text contains
  // `wanted`. Used when a label (e.g. "More actions") can appear in more than one
  // panel and we must choose the right one by context rather than take the first.
  function collectByText(selectors, wanted) {
    var w = norm(wanted);
    var nodes = [];
    selectors.forEach(function (sel) {
      try {
        Array.prototype.push.apply(nodes, document.querySelectorAll(sel));
      } catch (e) {
        /* ignore */
      }
    });
    var out = [];
    // Text test first; visible() (reflow) only on text matches — see findByText.
    for (var i = 0; i < nodes.length; i++) {
      if (textOf(nodes[i]).indexOf(w) >= 0 && visible(nodes[i])) out.push(nodes[i]);
    }
    return out;
  }

  // True when `a` sits within `depth` ancestor levels of `b` — i.e. they share a
  // card/panel rather than being on separate top-level surfaces (a task form vs
  // an overlapping appointment/results drawer).
  function sharesPanel(a, b, depth) {
    var node = b;
    for (var i = 0; i < (depth || 12) && node; i++, node = node.parentElement) {
      if (node.contains(a)) return true;
    }
    return false;
  }

  // Set by runMacro for the duration of a run; waitFor aborts on any SPA path
  // change so no macro step can ever drive a DIFFERENT task's controls
  // (audit M7, 2026-07-18).
  var _macroPath = null;

  function waitFor(fn, timeout, interval) {
    timeout = timeout || 5000;
    interval = interval || 50;
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        if (_macroPath !== null && location.pathname !== _macroPath) return resolve(null);
        var v;
        try {
          v = fn();
        } catch (e) {
          v = null;
        }
        if (v) return resolve(v);
        if (Date.now() - t0 >= timeout) return resolve(null);
        setTimeout(poll, interval);
      })();
    });
  }

  function realClick(el) {
    if (!el) return;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      try {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      } catch (e) {
        /* ignore */
      }
    });
    try {
      if (typeof el.click === 'function') el.click();
    } catch (e) {
      /* ignore */
    }
  }

  // Vue Next Steps radios listen on [role=radio] / the native input / the inner
  // visual — not on the nested span findByText often returns. Clicking that
  // span leaves "Issue 1 approved item" selected and never reveals Assign-to.
  function isRadioEl(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute('role') === 'radio') return true;
    var type = el.type || (el.getAttribute && el.getAttribute('type'));
    if (type === 'radio') return true;
    if (
      el.classList &&
      (el.classList.contains('radio') || el.classList.contains('q-radio') || el.classList.contains('m-radio'))
    ) {
      return true;
    }
    return false;
  }
  function radioControl(el) {
    if (!el) return null;
    var n = el;
    for (var i = 0; i < 8 && n; i++) {
      if (isRadioEl(n)) return n;
      var tag = (n.tagName && String(n.tagName).toLowerCase()) || n.tag || '';
      if (tag === 'label') {
        var inp = n.querySelector && n.querySelector('input[type="radio"]');
        if (inp) return inp;
        var htmlFor = n.htmlFor || (n.getAttribute && n.getAttribute('for'));
        if (htmlFor && typeof document.getElementById === 'function') {
          var byId = document.getElementById(htmlFor);
          if (byId && isRadioEl(byId)) return byId;
        }
        return n;
      }
      n = n.parentElement;
    }
    var inner =
      (el.querySelector &&
        (el.querySelector('input[type="radio"]') ||
          el.querySelector('[role="radio"]') ||
          el.querySelector('.q-radio, .m-radio, .radio'))) ||
      null;
    return inner || el;
  }
  function isRadioOn(el) {
    if (!el) return false;
    var n = radioControl(el) || el;
    if (n.checked === true) return true;
    if (n.getAttribute && n.getAttribute('aria-checked') === 'true') return true;
    var wrap = n.closest && n.closest('[role="radio"]');
    if (wrap && wrap.getAttribute && wrap.getAttribute('aria-checked') === 'true') return true;
    var inner = n.querySelector && (n.querySelector('[role="radio"]') || n.querySelector('input[type="radio"]'));
    if (inner) {
      if (inner.checked === true) return true;
      if (inner.getAttribute && inner.getAttribute('aria-checked') === 'true') return true;
    }
    return false;
  }
  function issue1StillOn() {
    var issue = findByText(['label', '[role="radio"]', '.radio', 'div', 'span'], 'Issue 1 approved item');
    return !!(issue && isRadioOn(issue));
  }
  function activateRadio(el) {
    var control = radioControl(el) || el;
    var input = null;
    var type = control.type || (control.getAttribute && control.getAttribute('type'));
    if (type === 'radio') input = control;
    else if (control.querySelector) input = control.querySelector('input[type="radio"]');
    if (!input) {
      var htmlFor = control.htmlFor || (control.getAttribute && control.getAttribute('for'));
      if (htmlFor && typeof document.getElementById === 'function') {
        var byId = document.getElementById(htmlFor);
        var byType = byId && (byId.type || (byId.getAttribute && byId.getAttribute('type')));
        if (byType === 'radio') input = byId;
      }
    }
    if (input) {
      try {
        input.checked = true;
      } catch (e) {
        /* ignore */
      }
      try {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (e) {
        /* ignore */
      }
      try {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {
        /* ignore */
      }
      realClick(input);
    }
    var aria =
      control.getAttribute && control.getAttribute('role') === 'radio'
        ? control
        : (control.closest && control.closest('[role="radio"]')) ||
          (control.querySelector && control.querySelector('[role="radio"]'));
    if (aria && aria !== input) realClick(aria);
    var visual =
      (control.querySelector &&
        (control.querySelector('.q-radio__inner') ||
          control.querySelector('.m-radio__inner') ||
          control.querySelector('[class*="radio__inner"]'))) ||
      null;
    if (visual && visual !== control && visual !== input && visual !== aria) realClick(visual);
    if (!input && !aria) realClick(control);
  }

  function setNativeValue(el, val) {
    try {
      var proto = Object.getPrototypeOf(el);
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) {
      /* ignore */
    }
  }

  // What to TYPE into the "Assign to" live search to surface a team — an ordered
  // list of queries tried in turn (step 3 stops at the first that reveals the
  // matching option). Kept DELIBERATELY SEPARATE from what we MATCH: the option
  // is always matched by the full team text (step 3), never by the query string.
  //
  // Why: typing the whole configured name is fragile. A name like "Prescribing /
  // Meds Management" carries a "/" and several words, and Medicus's debounced,
  // server-driven search can return ZERO rows for that exact string even though
  // the team exists — a query of just "Prescribing" returns it. Coupling "what we
  // type" to "the full name" is what keeps breaking selection when Medicus tweaks
  // the picker's search (the v3.143.2 class of regression). So we try a safe
  // leading token first (the name up to the first character that isn't a
  // letter / digit / space), then fall back to the full name for any picker where
  // that string genuinely did work.
  // "Prescribing / Meds Management" and "Prescribing/Meds Management" are the
  // same team — Medicus's picker often drops the spaces around "/". Folding
  // those spaces is exact-equivalent (audit R8); "Med" vs "Meds" is not.
  function foldTeam(s) {
    return norm(s).replace(/\s*\/\s*/g, '/');
  }

  function searchQueriesFor(team) {
    var full = String(team == null ? '' : team).trim();
    var queries = [];
    var m = /^[a-z0-9 ]+/i.exec(full);
    var lead = m ? m[0].trim() : '';
    // Only add the leading token if it's distinct and long enough to be
    // meaningful — a 1-char or symbol-leading team falls straight through to the
    // full name (never type nothing, and never a query so short it floods the
    // picker with unrelated teams).
    if (lead.length >= 2 && lead.toLowerCase() !== full.toLowerCase()) queries.push(lead);
    var compact = full.replace(/\s*\/\s*/g, '/');
    if (compact !== full && compact.toLowerCase() !== lead.toLowerCase()) queries.push(compact);
    queries.push(full);
    return queries;
  }

  // Visible text of every currently-rendered option — a diagnostic breadcrumb
  // logged only when step 3 fails to match, so a page-console capture (CLAUDE.md
  // "capture first") distinguishes "search returned nothing / isn't a search
  // picker" (empty) from "returned options but the configured name doesn't match
  // any" (non-empty — a team-name mismatch, fixable via the ▾ menu).
  function renderedOptionTexts(optionSel) {
    var out = [];
    try {
      var opts = document.querySelectorAll(optionSel);
      for (var i = 0; i < opts.length; i++) {
        if (visible(opts[i])) out.push(textOf(opts[i]));
      }
    } catch (e) {
      /* ignore */
    }
    return out;
  }

  // The "Assign to" picker (Medicus's m-simple-select, replacing the old Quasar
  // q-select) runs a debounced/live server search keyed off real per-keystroke
  // typing — setting the full value in one shot and firing a single keydown for
  // the last character (the old approach) never triggers that search, so the
  // option never renders and the macro times out even though the team exists.
  // Simulate an actual keystroke-by-keystroke type with a small pause between
  // characters so the debounce fires the same way it does for a human typing.
  function typeText(el, text, delay) {
    delay = delay || 20;
    return new Promise(function (resolve) {
      var i = 0;
      var built = '';
      (function step() {
        if (i >= text.length) return resolve();
        var ch = text[i++];
        built += ch;
        var keyOpts = { bubbles: true, cancelable: true, key: ch };
        try {
          el.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
        } catch (e1) {
          /* ignore */
        }
        setNativeValue(el, built);
        try {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
        } catch (e2) {
          /* setNativeValue already fired input */
        }
        try {
          el.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
        } catch (e3) {
          /* ignore */
        }
        setTimeout(step, delay);
      })();
    });
  }

  // The "Assign to" control: an input reachable after the re-assign radio is on.
  // `near` (the routing radio) prefers the picker in the same panel so we don't
  // type into a different "assign" field elsewhere on the overview.
  function findAssignInput(near) {
    var candidates = [];
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el)) continue;
      var hint = norm((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || ''));
      if (hint.indexOf('assign') >= 0) candidates.push(el);
    }
    if (!candidates.length) {
      var labels = document.querySelectorAll('label, .label, [class*="label"]');
      for (var j = 0; j < labels.length; j++) {
        if (textOf(labels[j]).indexOf('assign to') >= 0) {
          var scope = labels[j].closest('div') || labels[j].parentElement;
          var inp = scope && scope.querySelector('input');
          if (inp && visible(inp)) candidates.push(inp);
        }
      }
    }
    if (near) {
      var best = null;
      var bestDist = 99;
      for (var k = 0; k < candidates.length; k++) {
        var node = near;
        for (var d = 0; d < 12 && node; d++, node = node.parentElement) {
          if (node.contains(candidates[k]) && d < bestDist) {
            bestDist = d;
            best = candidates[k];
            break;
          }
        }
      }
      if (best) return best;
    }
    return candidates[0] || null;
  }

  function optionControl(el) {
    if (!el) return null;
    var n = el;
    for (var i = 0; i < 6 && n; i++) {
      var role = n.getAttribute && n.getAttribute('role');
      if (role === 'option') return n;
      var id = n.id || (n.getAttribute && n.getAttribute('id')) || '';
      if (String(id).indexOf('select-item-') === 0) return n;
      n = n.parentElement;
    }
    return el;
  }

  // Team names are short labels. The overview also has [role=option] nodes for
  // Clinical History / Reason for exam — those must never be treated as assignees.
  function looksLikeAssigneeName(el) {
    var t = textOf(el);
    if (!t || t.length > 80) return false;
    if (t.indexOf('reason for exam') >= 0) return false;
    if (t.indexOf('clinical history') >= 0) return false;
    if (t.indexOf('clinical indication') >= 0) return false;
    return true;
  }

  function snapshotVisible(sel) {
    var out = [];
    try {
      var nodes = document.querySelectorAll(sel);
      for (var i = 0; i < nodes.length; i++) {
        if (visible(nodes[i])) out.push(nodes[i]);
      }
    } catch (e) {
      /* ignore */
    }
    return out;
  }

  function listboxForAssign(assignEl) {
    if (!assignEl) return null;
    var attrs = ['aria-controls', 'aria-owns'];
    for (var a = 0; a < attrs.length; a++) {
      var v = assignEl.getAttribute && assignEl.getAttribute(attrs[a]);
      if (!v) continue;
      var ids = String(v).split(/\s+/);
      for (var j = 0; j < ids.length; j++) {
        if (!ids[j]) continue;
        var el = typeof document.getElementById === 'function' ? document.getElementById(ids[j]) : null;
        if (!el) continue;
        if (el.getAttribute && el.getAttribute('role') === 'listbox') return el;
        var inner = el.querySelector && el.querySelector('[role="listbox"]');
        if (inner) return inner;
        return el;
      }
    }
    var combo = assignEl.closest && assignEl.closest('[role="combobox"]');
    if (combo) {
      var owned = combo.getAttribute('aria-controls') || combo.getAttribute('aria-owns');
      if (owned && typeof document.getElementById === 'function') {
        var box = document.getElementById(owned);
        if (box) return box;
      }
      var inside = combo.querySelector && combo.querySelector('[role="listbox"]');
      if (inside) return inside;
    }
    return null;
  }

  function inList(el, list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] === el) return true;
    }
    return false;
  }

  // Options for the Assign-to picker we just opened — not Clinical History
  // [role=option] nodes that are always on the overview.
  function collectAssigneeOptions(assignEl, ignoreList, optionSel) {
    ignoreList = ignoreList || [];
    optionSel = optionSel || '[id^="select-item-"], [role="option"], li[role="option"]';
    var nodes = [];
    function add(sel, root) {
      try {
        var found = (root || document).querySelectorAll(sel);
        for (var i = 0; i < found.length; i++) nodes.push(found[i]);
      } catch (e) {
        /* ignore */
      }
    }
    var box = listboxForAssign(assignEl);
    if (box) {
      add('[id^="select-item-"], [role="option"], li, button', box);
    } else {
      add(optionSel);
    }
    var fresh = [];
    var near = [];
    for (var n = 0; n < nodes.length; n++) {
      var el = nodes[n];
      if (!visible(el) || !looksLikeAssigneeName(el)) continue;
      if (box && box.contains && !box.contains(el) && el !== box) continue;
      if (!inList(el, ignoreList)) fresh.push(el);
      else if (assignEl && sharesPanel(el, assignEl, 8)) near.push(el);
    }
    if (fresh.length) return fresh;
    if (near.length) return near;
    return [];
  }

  function openAssignPicker(assignEl) {
    if (!assignEl) return;
    try {
      assignEl.focus();
    } catch (e) {
      /* ignore */
    }
    realClick(assignEl);
    var n = assignEl.parentElement;
    for (var i = 0; i < 4 && n; i++, n = n.parentElement) {
      var role = n.getAttribute && n.getAttribute('role');
      if (role === 'combobox') {
        realClick(n);
        return;
      }
    }
  }

  // ---- the macro ---------------------------------------------------------

  var running = false;

  // Default confirm is window.confirm so extracted tests (and the Node hook)
  // keep working. After UI boot this is replaced with an in-host confirm bar.
  function requestConfirm(msg) {
    return Promise.resolve(window.confirm(msg));
  }

  // team/mode default to null so an abort BEFORE runMacro's parameters are
  // known (there is none today, but keeps the signature safe) never throws.
  function abort(msg, team, mode) {
    toast(msg, 'err');
    recordAudit(team || null, mode || null, 'aborted', msg);
  }

  async function runMacro(team, mode) {
    if (running) return;
    running = true;
    setBusy(true);
    // NAVIGATION GUARD (audit M7, 2026-07-18): the macro spans multi-second
    // waitFor polls that match controls by visible text against the whole
    // document. If the SPA swaps tasks mid-run, later steps would happily
    // drive the NEW task's equivalent controls — re-assigning the wrong task,
    // in 'auto' mode with no dialog. Pin the path for the run; waitFor's poll
    // loop aborts (resolves null → the macro's existing not-found handling)
    // the instant the path changes. Cleared in the finally below.
    _macroPath = location.pathname;
    try {
      var say = function (s) {
        try {
          console.info('[ClinHUD:rx]', s);
        } catch (e) {
          /* ignore */
        }
        if (typeof setStep === 'function') setStep(s);
      };

      // 1. radio: Save & send to routine requests task list
      // findRoutingControl prefers label/[role=radio]/.radio so we don't lock
      // onto an inner span; radioControl then walks to the Vue listener.
      say('Selecting destination…');
      var radioHit = findRoutingControl();
      if (!radioHit)
        return abort(
          'Couldn’t find the “Save & send to routine requests task list” option on this screen.',
          team,
          mode
        );
      var radio = radioControl(radioHit) || radioHit;
      if (!isRadioOn(radio)) activateRadio(radio);

      // 2. Assign-to picker (only on screen once the routine radio is on)
      say('Opening Assign to…');
      var assign = await waitFor(function () {
        return findAssignInput(radio);
      }, 2000);
      if (!assign) {
        if (issue1StillOn()) {
          return abort(
            'Couldn’t switch Next Steps to “Save & send to routine requests task list” — still on “Issue 1 approved item”. Tick that option yourself and press the button again.',
            team,
            mode
          );
        }
        return abort('Couldn’t find the “Assign to” picker. Is this a prescription task?', team, mode);
      }
      // Snapshot [role=option] already on the overview (Clinical History /
      // Reason for exam) BEFORE opening Assign-to, so we don't treat those
      // as the team list.
      var optionSel =
        DC && DC.get('routine-rx.assignee-option')
          ? DC.get('routine-rx.assignee-option').target.join(', ')
          : '[id^="select-item-"], [role="option"], li[role="option"]';
      var priorVisible = snapshotVisible(optionSel);
      openAssignPicker(assign);

      // 3. Pick the team option. Prefer an already-rendered option (skip-type);
      //    only then filter the list by typing. The picker's search is
      //    debounced/server-driven and only fires off real per-keystroke input
      //    (see typeText). We match ANY rendered option by the FULL team text
      //    (exact first, else contains) — never by the query we typed — so a
      //    search that surfaces the team under a broad token still selects the
      //    right team. Options are scoped to the Assign-to picker, not other
      //    [role=option] lists on the overview.
      var optionNodes = function () {
        return collectAssigneeOptions(assign, priorVisible, optionSel);
      };
      var matchOption = function () {
        var opts = optionNodes();
        var want = foldTeam(team);
        var exact = null,
          partial = null;
        for (var i = 0; i < opts.length; i++) {
          if (!visible(opts[i])) continue;
          var t = foldTeam(textOf(opts[i]));
          if (t === want) {
            exact = opts[i];
            break;
          }
          if (!partial && want && t.indexOf(want) >= 0) partial = opts[i];
        }
        return exact || partial;
      };
      // Audit R8: was the picked option an EXACT match for the configured team?
      // A contains-match (configured "Prescribing" hitting "Prescribing / Meds
      // Management") is allowed to pre-fill, but must never be committed
      // without a human reading the real name — auto mode downgrades to a
      // confirm below when this is false. Slash-spacing (" / " vs "/") is the
      // same name and counts as exact.
      var optionIsExact = function (el) {
        return !!el && foldTeam(textOf(el)) === foldTeam(team);
      };
      // Case-preserving text for user-facing copy (textOf lowercases for match).
      var rawTextOf = function (el) {
        var s = (el && el.getAttribute && el.getAttribute('aria-label')) || (el && el.textContent) || '';
        return String(s).replace(/\s+/g, ' ').trim();
      };
      // Skip-type: after opening Assign-to, wait briefly for an already-rendered
      // option. If the configured team is already on screen, select it without
      // typing. W8 is still UI-drive — abort if the option is never found.
      say('Finding team…');
      var queries = searchQueriesFor(team);
      var option = await waitFor(matchOption, 400, 50);
      if (!option) {
        // Try each query in turn (safe leading token first, then the full name —
        // see searchQueriesFor), re-typing from empty each time. The FINAL query
        // gets 3.5s (debounce + server round trip); non-final queries get 800ms
        // so a leading-token miss falls through to the full name quickly.
        for (var qi = 0; qi < queries.length && !option; qi++) {
          setNativeValue(assign, '');
          await typeText(assign, queries[qi], 20);
          option = await waitFor(matchOption, qi < queries.length - 1 ? 800 : 3500);
        }
      }
      if (!option) {
        // Breadcrumb for a page-console capture (see renderedOptionTexts).
        try {
          console.warn(
            '[ClinHUD:rx] team “' +
              team +
              '” not found after searching ' +
              JSON.stringify(queries) +
              '. ' +
              'Rendered options:',
            renderedOptionTexts(optionSel)
          );
        } catch (e) {
          /* ignore */
        }
        var seen = [];
        try {
          var listed = optionNodes();
          for (var si = 0; si < listed.length; si++) {
            if (visible(listed[si])) seen.push(textOf(listed[si]));
          }
        } catch (eSeen) {
          seen = renderedOptionTexts(optionSel);
        }
        var seenBit = seen.length
          ? ' Assign-to listed: “' + seen.slice(0, 5).join('”, “') + '”.'
          : ' The Assign-to picker didn’t list any teams.';
        return abort(
          'Team “' +
            team +
            '” isn’t in the assignee list.' +
            seenBit +
            ' Open the picker to check the exact name (spaces around “/” count), or add it via the ▾ menu.',
          team,
          mode
        );
      }
      var optionExact = optionIsExact(option);
      var optionText = rawTextOf(option);
      realClick(optionControl(option) || option);

      // 4. commit — find the button (EXACT label only — a commit click must
      //    never go through the substring fallback, audit R8), then wait until
      //    Medicus ENABLES it (it stays disabled until a valid assignee is
      //    registered).
      say('Waiting to send…');
      var commit = await waitFor(function () {
        var b = findByText(['button', '[role="button"]'], 'Send to routine list', true);
        return b && isEnabled(b) ? b : null;
      }, 2500);
      if (!commit) {
        if (findByText(['button', '[role="button"]'], 'Send to routine list')) {
          return abort(
            'Selected “' +
              team +
              '”, but “Send to routine list” stayed disabled — the assignee may not have registered. Check the picker.',
            team,
            mode
          );
        }
        return abort('Selected “' + team + '”, but couldn’t find the “Send to routine list” button.', team, mode);
      }

      cfg.lastTeam = team;
      saveCfg();
      renderButton();

      if (mode === 'manual') {
        highlightAndAudit(commit, team, mode);
        return;
      }
      // Audit R8: auto mode may only skip the confirm when the picked option
      // EXACTLY matches the configured team — a contains-match must be read by
      // a human (named with the option's REAL text) before the write.
      if (mode === 'confirm' || (mode === 'auto' && !optionExact)) {
        say('Confirm to send…');
        var confirmMsg = optionExact
          ? 'Send this prescription to routine requests for “' + team + '”?'
          : 'The assignee list matched “' +
            optionText +
            '” for your configured team “' +
            team +
            '” (not an exact match). Send this prescription to routine requests for “' +
            optionText +
            '”?';
        var ok = await requestConfirm(confirmMsg);
        if (!ok) {
          toast('Cancelled — nothing was sent. Selection is pre-filled.', 'warn');
          recordAudit(team, mode, 'aborted', 'clinician declined the confirm-mode dialog');
          return;
        }
      }
      // Belt-and-braces: never commit against a task the run didn't start on.
      if (location.pathname !== _macroPath) {
        // 2026-08-23 review fix: this called `fail(team, mode, msg)`, which does
        // not exist — the helper is `abort(msg, team, mode)`, different name AND
        // argument order. Under 'use strict' the guard threw a ReferenceError:
        // the commit was still (correctly) skipped, but the clinician got NO
        // toast and NO audit record, and the rejection was unhandled — so the
        // natural next move was to click again.
        abort('Task changed mid-run — nothing was clicked on the new task.', team, mode);
        return;
      }
      // Confirm can take wall-clock time; Vue may have disabled the button
      // meanwhile. Never click a disabled commit (partial matches never
      // auto-commit either — that gate is above).
      if (!isEnabled(commit)) {
        return abort(
          'Selected “' +
            team +
            '”, but “Send to routine list” stayed disabled — the assignee may not have registered. Check the picker.',
          team,
          mode
        );
      }
      commitAndAudit(commit, team, mode);
    } finally {
      _macroPath = null;
      running = false;
      setBusy(false);
      if (typeof renderButton === 'function') renderButton();
    }
  }

  // ---- UI: floating button + inline menu --------------------------------

  var host = null,
    btn = null,
    caret = null,
    menu = null,
    busy = false,
    confirmBar = null,
    confirmResolve = null,
    confirmOnKey = null;

  function setBusy(b) {
    busy = b;
    if (host) {
      if (b) host.classList.add('chrx-busy');
      else host.classList.remove('chrx-busy');
    }
    if (btn) btn.disabled = b;
    if (caret) caret.disabled = b;
  }

  function setStep(label) {
    if (!btn || !label) return;
    btn.textContent = label;
    btn.title = label;
  }

  // Confirm/menu must sit on document.body — the Medicus action row clips
  // overflow, so an absolutely-positioned child of .chrx-host is invisible.
  function placeOverHost(el) {
    if (!el) return;
    try {
      if (typeof document !== 'undefined' && document.body && el.parentElement !== document.body) {
        document.body.appendChild(el);
      }
    } catch (e) {
      /* ignore */
    }
    if (!el.style) return;
    el.style.position = 'fixed';
    el.style.zIndex = '2147483000';
    el.style.right = 'auto';
    el.style.top = 'auto';
    try {
      var r = host && host.getBoundingClientRect && host.getBoundingClientRect();
      if (r && r.width) {
        var w = el.offsetWidth || 280;
        el.style.left = Math.max(8, Math.min(r.right - w, (window.innerWidth || 800) - w - 8)) + 'px';
        el.style.bottom = Math.max(8, (window.innerHeight || 600) - r.top + 8) + 'px';
        return;
      }
    } catch (e2) {
      /* ignore */
    }
    el.style.left = 'auto';
    el.style.right = '18px';
    el.style.bottom = '96px';
  }

  function dismissConfirmBar(ok) {
    if (confirmOnKey) {
      try {
        document.removeEventListener('keydown', confirmOnKey, true);
      } catch (e) {
        /* ignore */
      }
      confirmOnKey = null;
    }
    var resolve = confirmResolve;
    confirmResolve = null;
    if (confirmBar && confirmBar.parentElement) confirmBar.parentElement.removeChild(confirmBar);
    confirmBar = null;
    if (resolve) resolve(!!ok);
  }

  // In-host confirm: Cancel is focused (safer default). Proceed never clicks
  // Medicus itself — it only resolves true so runMacro can commitAndAudit.
  function hostConfirm(msg) {
    if (confirmBar) return Promise.resolve(false);
    if (!host || (host.isConnected === false)) return Promise.resolve(window.confirm(msg));
    closeMenu();
    return new Promise(function (resolve) {
      confirmResolve = resolve;
      var bar = document.createElement('div');
      // Body-fixed, not a child of .chrx-host — the action row clips overflow.
      bar.className = 'chrx-menu chrx-confirm';
      bar.setAttribute('role', 'dialog');

      var p = document.createElement('div');
      p.className = 'chrx-confirm-msg';
      p.textContent = msg;
      bar.appendChild(p);

      var row = document.createElement('div');
      row.className = 'chrx-confirm-actions';

      var cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'chrx-menu-item chrx-confirm-cancel';
      cancel.textContent = 'Cancel';
      cancel.setAttribute('autofocus', '');
      cancel.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        dismissConfirmBar(false);
      };

      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'chrx-menu-item chrx-confirm-go';
      go.textContent = 'Send to routine list';
      go.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        dismissConfirmBar(true);
      };

      row.appendChild(cancel);
      row.appendChild(go);
      bar.appendChild(row);
      confirmBar = bar;
      placeOverHost(bar);
      confirmOnKey = function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          dismissConfirmBar(false);
        }
      };
      document.addEventListener('keydown', confirmOnKey, true);
      try {
        cancel.focus();
      } catch (e) {
        /* ignore */
      }
    });
  }

  function highlight(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var prev = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 3px #d97706';
      setTimeout(function () {
        el.style.boxShadow = prev;
      }, 2600);
    } catch (e) {
      /* ignore */
    }
  }

  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'chrx-toast chrx-' + (kind || 'ok');
    t.textContent = msg;
    document.body.appendChild(t);
    placeOverHost(t);
    setTimeout(function () {
      t.classList.add('chrx-show');
    }, 10);
    setTimeout(function () {
      t.classList.remove('chrx-show');
      setTimeout(function () {
        t.remove();
      }, 300);
    }, 4200);
  }

  function closeMenu() {
    if (menu) {
      menu.remove();
      menu = null;
    }
  }

  function openMenu() {
    if (busy || running) return;
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'chrx-menu';

    var h1 = document.createElement('div');
    h1.className = 'chrx-menu-h';
    h1.textContent = 'Team';
    menu.appendChild(h1);
    cfg.teams.forEach(function (team) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'chrx-menu-item' + (team === cfg.lastTeam ? ' chrx-sel' : '');
      item.textContent = team;
      item.onclick = function () {
        cfg.lastTeam = team;
        saveCfg();
        renderButton();
        closeMenu();
      };
      menu.appendChild(item);
    });
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'chrx-menu-item chrx-add';
    add.textContent = '+ Add team…';
    add.onclick = function () {
      var name = window.prompt('Exact team name as it appears in the Medicus “Assign to” list:');
      if (name && name.trim()) {
        name = name.trim();
        if (cfg.teams.indexOf(name) < 0) cfg.teams.push(name);
        cfg.lastTeam = name;
        saveCfg();
        renderButton();
      }
      closeMenu();
    };
    menu.appendChild(add);

    var h2 = document.createElement('div');
    h2.className = 'chrx-menu-h';
    h2.textContent = 'When sending';
    menu.appendChild(h2);
    [
      ['confirm', 'Ask before sending'],
      ['manual', 'Pre-fill only'],
      ['auto', 'Send without asking'],
    ].forEach(function (m) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'chrx-menu-item' + (m[0] === cfg.commitMode ? ' chrx-sel' : '');
      item.textContent = m[1];
      item.onclick = function () {
        cfg.commitMode = m[0];
        saveCfg();
        renderButton();
        closeMenu();
      };
      menu.appendChild(item);
    });

    host.appendChild(menu);
    setTimeout(function () {
      document.addEventListener('click', onDocClick, true);
    }, 0);
  }
  function onDocClick(e) {
    if (menu && !host.contains(e.target)) {
      closeMenu();
      document.removeEventListener('click', onDocClick, true);
    }
  }

  function shortTeamLabel(team) {
    var full = String(team == null ? '' : team).trim();
    if (!full) return '';
    var m = /^[a-z0-9 ]+/i.exec(full);
    var lead = m ? m[0].trim() : '';
    return lead || full;
  }

  function modeTitle(mode) {
    if (mode === 'auto') return 'Send without asking';
    if (mode === 'manual') return 'Pre-fill only';
    return 'Ask before sending';
  }

  function renderButton() {
    if (!btn) return;
    var label = 'Send to routine list';
    var short = shortTeamLabel(cfg.lastTeam);
    if (short && short.length <= 22) label += ' · ' + short;
    btn.textContent = label;
    btn.title = modeTitle(cfg.commitMode) + ' — “' + cfg.lastTeam + '”. Use ▾ to change.';
  }

  function buildUI() {
    if (host) return;
    host = document.createElement('div');
    host.className = 'chrx-host';

    btn = document.createElement('button');
    btn.className = 'chrx-btn';
    btn.onclick = function () {
      // 2026-08-23 review fix: runMacro is async and was called bare, so any
      // throw inside it became an unhandled rejection — the button just reset
      // with no toast and no audit line. A macro that dies must SAY it died.
      if (!busy)
        runMacro(cfg.lastTeam, cfg.commitMode).catch((e) => {
          abort(
            'The routine-list macro stopped unexpectedly — nothing was committed. ' + (e && e.message ? e.message : ''),
            cfg.lastTeam,
            cfg.commitMode
          );
          setBusy(false);
        });
    };

    caret = document.createElement('button');
    caret.className = 'chrx-caret';
    caret.textContent = '▾';
    caret.title = 'Change team / commit behaviour';
    caret.onclick = function (e) {
      e.stopPropagation();
      if (busy || running) return;
      if (menu) closeMenu();
      else openMenu();
    };

    host.appendChild(btn);
    host.appendChild(caret);
    renderButton();
  }

  // Where to inject the button. The H-035 visibility control is that the button
  // appears ONLY where the "send to routine requests" workflow genuinely exists —
  // never on a screen, modal or drawer that merely happens to carry a "More
  // actions" button (the View Prescription modal, an appointment-booked drawer,
  // results/document drawers, etc.). Three gates, in order:
  //
  //   1. URL is a prescription/medication request task overview (slug contains
  //      "prescription" — confirmed `prescription-requests` in
  //      engine/extractors/patient-context.js). Cheap pre-filter.
  //   2. The actual routing control — the "Save & send to routine requests task
  //      list" option the macro clicks first — is present and visible on screen.
  //      If it isn't here, this isn't the prescription-routing workflow.
  //   3. We anchor beside a "More actions" button that lives in the SAME panel as
  //      that routing control (not inside a dialog, and not an overlapping
  //      drawer's own action row). This is what stops the button leaking onto an
  //      appointment drawer that overlays the prescription page.
  //
  // findRoutingControl (gate 2) and findActionAnchor (gates 1+3) follow.

  // Locate the "Save & send to routine requests task list" routing control. This
  // is the expensive call (it can reflow many nodes via visible()), so we try the
  // realistic carriers FIRST — on Medicus this control is a label / radio — and
  // only widen to the costly div/span sweep if the narrow set yields nothing. The
  // narrow set covers the live app; the wide set is a defensive fallback.
  function findRoutingControl() {
    var C = DC && DC.get('routine-rx.routing-control');
    var narrow = C ? C.target : ['label', '[role="radio"]', '.radio'];
    var wide = C && C.legacy[0] ? C.legacy[0] : ['div', 'span'];
    return (
      findByText(narrow, 'Save & send to routine requests task list') ||
      findByText(wide, 'Save & send to routine requests task list')
    );
  }

  function findActionAnchor() {
    if (!/\/tasks\/data\/[^/]*prescription[^/]*\/overview\//i.test(location.pathname)) return null;

    var routine = findRoutingControl();
    if (!routine) return null;

    var actionSel =
      DC && DC.get('routine-rx.action-anchor')
        ? DC.get('routine-rx.action-anchor').target
        : ['button', '[role="button"]'];
    var candidates = collectByText(actionSel, 'More actions');
    for (var i = 0; i < candidates.length; i++) {
      var more = candidates[i];
      if (more.closest('[role="dialog"], [aria-modal="true"]')) continue;
      if (sharesPanel(routine, more, 12)) {
        placedRoutingControl = routine;
        return more.parentElement;
      }
    }
    return null;
  }

  // The anchor the host is currently parented to. Kept so the hot path can
  // CHEAPLY re-validate placement (host still inside this anchor, anchor still in
  // the document) without re-running the expensive findActionAnchor() div/span
  // scan on every idle SPA re-render. Cleared whenever we remove/lose the host.
  var placedAnchor = null;
  // The routing control ("Save & send to routine requests task list") matched by
  // the last successful scan. Re-checked on the fast path with a cheap isConnected
  // read (no reflow) so the button can't linger if Vue tears the routing form out
  // while leaving the action-row anchor attached — i.e. H-035 gate 2 stays
  // enforced between scans, not only at first placement and click time.
  var placedRoutingControl = null;

  // Inject inline when on the prescribing screen; remove otherwise. PREPEND and
  // re-inject on every relevant mutation so Vue's reconciler can't strip us as a
  // trailing node (see CLAUDE.md).
  //
  // Cost discipline: the only expensive thing here is findActionAnchor() (it
  // sweeps the DOM and calls visible() → forced reflow). We must run it RARELY —
  // only when placement genuinely needs to change. Order of checks:
  //   1. Cheap URL pre-filter. Not a prescription overview → tear down, return.
  //   2. FAST PATH: if the host is still connected, still inside the cached
  //      anchor, and that anchor is still in the document, nothing relevant
  //      changed → return WITHOUT scanning. This is the common idle case.
  //   3. Only when the host is missing / detached / orphaned do we run the full
  //      scan, re-validating the H-035 gates (routing control present + visible,
  //      "More actions" beside it, not in a dialog) before (re)placing — so a
  //      stale cache can never show the button on the wrong screen.
  function ensureInjected() {
    if (!host) return;

    // Freeze placement while the macro is running. Confirm lives on
    // document.body so Vue replacing the action row must not auto-Cancel it.
    if (running || busy) {
      if (placedAnchor && document.contains(placedAnchor) && host.parentElement !== placedAnchor) {
        insertHost(placedAnchor);
      }
      return;
    }

    // 1. Cheap path gate — no DOM scan, no reflow.
    if (!/\/tasks\/data\/[^/]*prescription[^/]*\/overview\//i.test(location.pathname)) {
      removeHost();
      return;
    }

    // 2. Fast path: placement already valid → skip the expensive scan entirely.
    //    host.isConnected + document.contains(anchor) + anchor.contains(host) +
    //    routing-control.isConnected are all cheap connectivity checks (no layout
    //    flush), unlike visible(). The routing-control check keeps H-035 gate 2
    //    enforced between scans without paying for a re-scan on idle re-renders.
    if (
      host.isConnected &&
      placedAnchor &&
      placedAnchor === host.parentElement &&
      document.contains(placedAnchor) &&
      placedAnchor.contains(host) &&
      placedRoutingControl &&
      placedRoutingControl.isConnected
    ) {
      return;
    }

    // 3. Host missing / detached / orphaned — run the full (expensive) scan and
    //    re-validate every H-035 gate before placing.
    var anchor = findActionAnchor();
    if (!anchor) {
      removeHost();
      return;
    }
    if (host.parentElement !== anchor) {
      insertHost(anchor);
    }
    placedAnchor = anchor;
  }

  function removeHost() {
    if (confirmResolve) dismissConfirmBar(false);
    if (host && host.parentElement) host.parentElement.removeChild(host);
    placedAnchor = null;
    placedRoutingControl = null;
    closeMenu();
  }

  // Write our node WITHOUT self-triggering a rescan. Our own insertBefore is a
  // body childList mutation, so it would otherwise wake the observer and schedule
  // another full scan (self-trigger). We disconnect across the write and re-attach
  // immediately — mirroring content.js's refreshQueueChips, which disconnects its
  // queueObserver around its own DOM writes. PREPEND (insertBefore firstChild),
  // never append: trailing nodes get reconciled away by Vue (see CLAUDE.md).
  function insertHost(anchor) {
    if (mo) mo.disconnect();
    try {
      anchor.insertBefore(host, anchor.firstChild);
    } finally {
      if (mo) mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ── Node test hook ────────────────────────────────────────────────────
  // Exposes the already-isolated audit helpers (see their comments above) so
  // test-routine-rx-macro.js can exercise the AUDITED outcomes directly,
  // without driving the full async find/type/wait DOM pipeline. Same pattern
  // as lab-file-button.js's own Node hook: returns BEFORE the chrome-storage
  // config load + UI/observer boot that follows, which needs a live
  // extension context.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { recordAudit, abort, commitAndAudit, highlightAndAudit, AUDIT_KEY: AUDIT_KEY };
    return;
  }

  // ---- boot --------------------------------------------------------------

  // The body observer for the FALLBACK path only (used when the shared observer
  // hub is absent). Hoisted so insertHost() can disconnect it across our own DOM
  // writes; under the hub it stays null and isOwnMutation does that job instead.
  var mo = null;

  // True when EVERY element node added/removed in this batch is our own host
  // subtree — i.e. the mutation was caused by our own inject/remove, not by the
  // SPA. Such batches change nothing we care about, so we skip the scan. Mirrors
  // content.js's _isOwnChipMutation. (Belt-and-braces with the disconnect in
  // insertHost: a removeHost write, or any stray host mutation, is filtered here.)
  function isOwnMutation(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      var lists = [m.addedNodes, m.removedNodes];
      for (var l = 0; l < lists.length; l++) {
        var nodes = lists[l];
        for (var n = 0; n < nodes.length; n++) {
          var node = nodes[n];
          if (node.nodeType !== 1) continue; // ignore text nodes
          if (node !== host && !(host && host.contains && host.contains(node))) return false;
        }
      }
    }
    return true; // every element node added/removed was ours (or batch was text-only)
  }

  // Coalesce the SPA's mutation bursts to a single deferred run. We keep the
  // existing ~200ms debounce (collapses a burst) AND hop to requestAnimationFrame
  // (keeps the actual work off the hot mutation-callback path and aligned to a
  // frame, like content.js's queueRafScheduled). Crucially, ensureInjected's fast
  // path means each fired tick does NO DOM scan / reflow when placement is already
  // valid — so idle SPA churn is now near-free.
  var ensureTimer = null;
  var rafScheduled = false;
  function scheduleEnsure() {
    if (document.hidden) return; // paused while backgrounded; visibilitychange re-checks
    if (ensureTimer || rafScheduled) return;
    ensureTimer = setTimeout(function () {
      ensureTimer = null;
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(function () {
        rafScheduled = false;
        if (document.hidden) return;
        ensureInjected();
      });
    }, 200);
  }

  loadCfg().then(function () {
    buildUI();
    requestConfirm = hostConfirm;
    ensureInjected();
    // Skip batches that are entirely our own host inject/remove — they'd
    // otherwise self-trigger a needless rescan.
    var onBodyMutations = function (mutations) {
      if (isOwnMutation(mutations)) return;
      scheduleEnsure();
    };
    // Prefer the shared observer hub (one body observer for the whole injection
    // surface); fall back to a private observer if it isn't present so the button
    // still works on its own. Under the hub `mo` stays null, so insertHost's
    // disconnect is a no-op and isOwnMutation alone guards self-triggering.
    var hub = window.__chObserverHub;
    if (hub && hub.subscribe) {
      hub.subscribe(onBodyMutations);
    } else {
      mo = new MutationObserver(onBodyMutations);
      mo.observe(document.body, { childList: true, subtree: true });
    }
    // When the tab is re-shown, re-check once (mutations that fired while hidden
    // were skipped, so placement may be stale).
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleEnsure();
    });
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes[STORE_KEY]) {
          loadCfg().then(renderButton);
        }
      });
    }
  });
})();
