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
  function findByText(selectors, wanted) {
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
      if (!partial && t.indexOf(w) >= 0 && visible(el)) partial = el;
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

  function waitFor(fn, timeout, interval) {
    timeout = timeout || 5000;
    interval = interval || 120;
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
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

  // The "Assign to" picker (Medicus's m-simple-select, replacing the old Quasar
  // q-select) runs a debounced/live server search keyed off real per-keystroke
  // typing — setting the full value in one shot and firing a single keydown for
  // the last character (the old approach) never triggers that search, so the
  // option never renders and the macro times out even though the team exists.
  // Simulate an actual keystroke-by-keystroke type with a small pause between
  // characters so the debounce fires the same way it does for a human typing.
  function typeText(el, text, delay) {
    delay = delay || 45;
    return new Promise(function (resolve) {
      var i = 0;
      var built = '';
      (function step() {
        if (i >= text.length) return resolve();
        var ch = text[i++];
        built += ch;
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
        setNativeValue(el, built);
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
        setTimeout(step, delay);
      })();
    });
  }

  // The "Assign to" control: an input reachable after the re-assign radio is on.
  function findAssignInput() {
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el)) continue;
      var hint = norm((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || ''));
      if (hint.indexOf('assign') >= 0) return el;
    }
    // fallback: a label "Assign to" → its sibling/descendant input
    var labels = document.querySelectorAll('label, .label, [class*="label"]');
    for (var j = 0; j < labels.length; j++) {
      if (textOf(labels[j]).indexOf('assign to') >= 0) {
        var scope = labels[j].closest('div') || labels[j].parentElement;
        var inp = scope && scope.querySelector('input');
        if (inp && visible(inp)) return inp;
      }
    }
    return null;
  }

  // ---- the macro ---------------------------------------------------------

  var running = false;

  function abort(msg) {
    toast(msg, 'err');
  }

  async function runMacro(team, mode) {
    if (running) return;
    running = true;
    setBusy(true);
    try {
      // 1. radio: Save & send to routine requests task list
      var radio = findByText(
        ['label', '[role="radio"]', '.radio', 'div', 'span'],
        'Save & send to routine requests task list'
      );
      if (!radio) return abort('Couldn’t find the “Save & send to routine requests task list” option on this screen.');
      realClick(radio);

      // 2. Assign-to picker
      var assign = await waitFor(findAssignInput, 4000);
      if (!assign) return abort('Couldn’t find the “Assign to” picker. Is this a prescription task?');
      assign.focus();
      realClick(assign);
      // Filter the list by typing the team name character-by-character — the
      // picker's search is debounced/server-driven and only fires off real
      // per-keystroke input (see typeText).
      setNativeValue(assign, '');
      await typeText(assign, team);

      // 3. the team option — extra margin over the old 4s since this now waits
      // on a real debounce + server round trip, not a local list filter.
      var optionSel =
        DC && DC.get('routine-rx.assignee-option')
          ? DC.get('routine-rx.assignee-option').target.join(', ')
          : '[id^="select-item-"], [role="option"], li[role="option"]';
      var option = await waitFor(function () {
        var opts = document.querySelectorAll(optionSel);
        var exact = null,
          partial = null;
        for (var i = 0; i < opts.length; i++) {
          if (!visible(opts[i])) continue;
          var t = textOf(opts[i]);
          if (t === norm(team)) {
            exact = opts[i];
            break;
          }
          if (!partial && t.indexOf(norm(team)) >= 0) partial = opts[i];
        }
        return exact || partial;
      }, 6000);
      if (!option)
        return abort(
          'Team “' +
            team +
            '” isn’t in the assignee list. Open the picker to check the exact name, or add it via the ▾ menu.'
        );
      realClick(option);

      // 4. commit — find the button, then wait until Medicus ENABLES it
      //    (it stays disabled until a valid assignee is registered).
      var commit = await waitFor(function () {
        var b = findByText(['button', '[role="button"]'], 'Send to routine list');
        return b && isEnabled(b) ? b : null;
      }, 5000);
      if (!commit) {
        if (findByText(['button', '[role="button"]'], 'Send to routine list')) {
          return abort(
            'Selected “' +
              team +
              '”, but “Send to routine list” stayed disabled — the assignee may not have registered. Check the picker.'
          );
        }
        return abort('Selected “' + team + '”, but couldn’t find the “Send to routine list” button.');
      }

      cfg.lastTeam = team;
      saveCfg();
      renderButton();

      if (mode === 'manual') {
        highlight(commit);
        toast('Ready — review and click “Send to routine list”.', 'ok');
        return;
      }
      if (mode === 'confirm') {
        var ok = window.confirm('Send this prescription to routine requests for “' + team + '”?');
        if (!ok) {
          toast('Cancelled — nothing was sent. Selection is pre-filled.', 'warn');
          return;
        }
      }
      realClick(commit);
      toast('Sent to “' + team + '”.', 'ok');
    } finally {
      running = false;
      setBusy(false);
    }
  }

  // ---- UI: floating button + inline menu --------------------------------

  var host = null,
    btn = null,
    caret = null,
    menu = null,
    busy = false;

  function setBusy(b) {
    busy = b;
    if (btn) {
      btn.disabled = b;
      btn.style.opacity = b ? '0.6' : '1';
    }
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
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'chrx-menu';

    var h1 = document.createElement('div');
    h1.className = 'chrx-menu-h';
    h1.textContent = 'Send to team';
    menu.appendChild(h1);
    cfg.teams.forEach(function (team) {
      var item = document.createElement('button');
      item.className = 'chrx-menu-item' + (team === cfg.lastTeam ? ' chrx-sel' : '');
      item.textContent = (team === cfg.lastTeam ? '● ' : '○ ') + team;
      item.onclick = function () {
        cfg.lastTeam = team;
        saveCfg();
        renderButton();
        closeMenu();
      };
      menu.appendChild(item);
    });
    var add = document.createElement('button');
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
    h2.textContent = 'On commit';
    menu.appendChild(h2);
    [
      ['confirm', 'Ask, then send'],
      ['manual', 'Pre-fill, I’ll click'],
      ['auto', 'Send automatically'],
    ].forEach(function (m) {
      var item = document.createElement('button');
      item.className = 'chrx-menu-item' + (m[0] === cfg.commitMode ? ' chrx-sel' : '');
      item.textContent = (m[0] === cfg.commitMode ? '● ' : '○ ') + m[1];
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

  function renderButton() {
    if (!btn) return;
    var modeTag = cfg.commitMode === 'auto' ? ' ⚡' : cfg.commitMode === 'manual' ? ' ✎' : '';
    btn.textContent = '→ ' + cfg.lastTeam + modeTag;
    btn.title = 'Re-assign this prescription to “' + cfg.lastTeam + '” (' + cfg.commitMode + '). Use ▾ to change.';
  }

  function buildUI() {
    if (host) return;
    host = document.createElement('div');
    host.className = 'chrx-host';

    btn = document.createElement('button');
    btn.className = 'chrx-btn';
    btn.onclick = function () {
      if (!busy) runMacro(cfg.lastTeam, cfg.commitMode);
    };

    caret = document.createElement('button');
    caret.className = 'chrx-caret';
    caret.textContent = '▾';
    caret.title = 'Change team / commit behaviour';
    caret.onclick = function (e) {
      e.stopPropagation();
      if (menu) closeMenu();
      else openMenu();
    };

    host.appendChild(btn);
    host.appendChild(caret);
    renderButton();

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
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

  var CSS = [
    '.chrx-host{display:inline-flex;align-items:stretch;vertical-align:middle;position:relative;margin:0 8px 0 0;',
    'font:600 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.18);border-radius:8px}',
    '.chrx-btn{background:#0d6e5e;color:#fff;border:0;padding:9px 13px;border-radius:8px 0 0 8px;cursor:pointer;max-width:300px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chrx-btn:hover{background:#0a5a4d}',
    '.chrx-caret{background:#0a5a4d;color:#fff;border:0;border-left:1px solid rgba(255,255,255,.25);padding:0 11px;border-radius:0 8px 8px 0;cursor:pointer}',
    '.chrx-caret:hover{background:#084a40}',
    '.chrx-menu{position:absolute;right:0;bottom:calc(100% + 6px);z-index:2147483000;min-width:240px;background:#fff;color:#10302a;border:1px solid #cdd8d4;',
    'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:6px;display:flex;flex-direction:column;gap:2px}',
    '.chrx-menu-h{font:700 11px/1 system-ui;text-transform:uppercase;letter-spacing:.04em;color:#5b6b66;padding:8px 8px 4px}',
    '.chrx-menu-item{text-align:left;background:none;border:0;padding:7px 9px;border-radius:6px;cursor:pointer;font:500 13px/1.2 system-ui;color:#10302a}',
    '.chrx-menu-item:hover{background:#eef4f2}',
    '.chrx-menu-item.chrx-sel{color:#0d6e5e;font-weight:700}',
    '.chrx-menu-item.chrx-add{color:#0d6e5e}',
    '.chrx-toast{position:fixed;right:18px;bottom:72px;z-index:2147483000;max-width:340px;padding:11px 14px;border-radius:8px;',
    'color:#fff;font:500 13px/1.35 system-ui;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transform:translateY(8px);transition:.28s}',
    '.chrx-toast.chrx-show{opacity:1;transform:none}',
    '.chrx-toast.chrx-ok{background:#0d6e5e}.chrx-toast.chrx-warn{background:#b45309}.chrx-toast.chrx-err{background:#b42318}',
  ].join('');

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
