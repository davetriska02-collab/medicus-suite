// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Routine-prescription one-click re-assign button
//
// Adds a floating action button to the prescription-request task overview that
// re-assigns the task to a configured team (e.g. "Prescribing / Meds Management")
// by DRIVING THE REAL MEDICUS UI — it clicks the same controls a user would:
//
//   1. radio  "Save & re-assign to someone else"
//   2. input  "Assign to"            (opens the assignee picker)
//   3. option <the configured team>  ([id^="select-item-"], matched by text)
//   4. button "Re-assign task"       (the commit)
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
          cfg.commitMode = ['confirm', 'manual', 'auto'].indexOf(s.commitMode) >= 0 ? s.commitMode : DEFAULTS.commitMode;
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
    return norm(el && (el.getAttribute && el.getAttribute('aria-label')) || (el && el.textContent));
  }
  // Find the first visible element matching one of `selectors` whose text equals
  // (or, as a fallback, contains) `wanted`.
  function findByText(selectors, wanted) {
    var w = norm(wanted);
    var nodes = [];
    selectors.forEach(function (sel) {
      try { Array.prototype.push.apply(nodes, document.querySelectorAll(sel)); } catch (e) { /* ignore */ }
    });
    var exact = null, partial = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!visible(el)) continue;
      var t = textOf(el);
      if (t === w) { exact = el; break; }
      if (!partial && t.indexOf(w) >= 0) partial = el;
    }
    return exact || partial;
  }

  function waitFor(fn, timeout, interval) {
    timeout = timeout || 5000; interval = interval || 120;
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var v;
        try { v = fn(); } catch (e) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - t0 >= timeout) return resolve(null);
        setTimeout(poll, interval);
      })();
    });
  }

  function realClick(el) {
    if (!el) return;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); } catch (e) { /* ignore */ }
    });
    try { if (typeof el.click === 'function') el.click(); } catch (e) { /* ignore */ }
  }

  function setNativeValue(el, val) {
    try {
      var proto = Object.getPrototypeOf(el);
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) { /* ignore */ }
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
      // 1. radio: Save & re-assign to someone else
      var radio = findByText(
        ['label', '[role="radio"]', '.radio', 'div', 'span'],
        'Save & re-assign to someone else'
      );
      if (!radio) return abort('Couldn’t find the “Save & re-assign to someone else” option on this screen.');
      realClick(radio);

      // 2. Assign-to picker
      var assign = await waitFor(findAssignInput, 4000);
      if (!assign) return abort('Couldn’t find the “Assign to” picker. Is this a prescription task?');
      assign.focus();
      realClick(assign);
      // Filter the list by typing the team name — confirmed to narrow the list
      // (e.g. "pres" → "Prescribing / Meds Management"). Fire keyboard events too
      // for comboboxes that only open/filter on keydown.
      setNativeValue(assign, team);
      var lastCh = team.slice(-1);
      assign.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: lastCh }));
      assign.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: lastCh }));

      // 3. the team option
      var option = await waitFor(function () {
        var opts = document.querySelectorAll('[id^="select-item-"], [role="option"], li[role="option"]');
        var exact = null, partial = null;
        for (var i = 0; i < opts.length; i++) {
          if (!visible(opts[i])) continue;
          var t = textOf(opts[i]);
          if (t === norm(team)) { exact = opts[i]; break; }
          if (!partial && t.indexOf(norm(team)) >= 0) partial = opts[i];
        }
        return exact || partial;
      }, 4000);
      if (!option) return abort('Team “' + team + '” isn’t in the assignee list. Open the picker to check the exact name, or add it via the ▾ menu.');
      realClick(option);

      // 4. commit — find the button, then wait until Medicus ENABLES it
      //    (it stays disabled until a valid assignee is registered).
      var commit = await waitFor(function () {
        var b = findByText(['button', '[role="button"]'], 'Re-assign task');
        return b && isEnabled(b) ? b : null;
      }, 5000);
      if (!commit) {
        if (findByText(['button', '[role="button"]'], 'Re-assign task')) {
          return abort('Selected “' + team + '”, but “Re-assign task” stayed disabled — the assignee may not have registered. Check the picker.');
        }
        return abort('Selected “' + team + '”, but couldn’t find the “Re-assign task” button.');
      }

      cfg.lastTeam = team; saveCfg(); renderButton();

      if (mode === 'manual') {
        highlight(commit);
        toast('Ready — review and click “Re-assign task”.', 'ok');
        return;
      }
      if (mode === 'confirm') {
        var ok = window.confirm('Re-assign this prescription to “' + team + '”?');
        if (!ok) { toast('Cancelled — nothing was sent. Selection is pre-filled.', 'warn'); return; }
      }
      realClick(commit);
      toast('Sent to “' + team + '”.', 'ok');
    } finally {
      running = false;
      setBusy(false);
    }
  }

  // ---- UI: floating button + inline menu --------------------------------

  var host = null, btn = null, caret = null, menu = null, busy = false;

  function setBusy(b) {
    busy = b;
    if (btn) { btn.disabled = b; btn.style.opacity = b ? '0.6' : '1'; }
  }

  function highlight(el) {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      var prev = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 3px #d97706';
      setTimeout(function () { el.style.boxShadow = prev; }, 2600);
    } catch (e) { /* ignore */ }
  }

  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'chrx-toast chrx-' + (kind || 'ok');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('chrx-show'); }, 10);
    setTimeout(function () { t.classList.remove('chrx-show'); setTimeout(function () { t.remove(); }, 300); }, 4200);
  }

  function closeMenu() { if (menu) { menu.remove(); menu = null; } }

  function openMenu() {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'chrx-menu';

    var h1 = document.createElement('div'); h1.className = 'chrx-menu-h'; h1.textContent = 'Send to team'; menu.appendChild(h1);
    cfg.teams.forEach(function (team) {
      var item = document.createElement('button');
      item.className = 'chrx-menu-item' + (team === cfg.lastTeam ? ' chrx-sel' : '');
      item.textContent = (team === cfg.lastTeam ? '● ' : '○ ') + team;
      item.onclick = function () { cfg.lastTeam = team; saveCfg(); renderButton(); closeMenu(); };
      menu.appendChild(item);
    });
    var add = document.createElement('button');
    add.className = 'chrx-menu-item chrx-add'; add.textContent = '+ Add team…';
    add.onclick = function () {
      var name = window.prompt('Exact team name as it appears in the Medicus “Assign to” list:');
      if (name && name.trim()) {
        name = name.trim();
        if (cfg.teams.indexOf(name) < 0) cfg.teams.push(name);
        cfg.lastTeam = name; saveCfg(); renderButton();
      }
      closeMenu();
    };
    menu.appendChild(add);

    var h2 = document.createElement('div'); h2.className = 'chrx-menu-h'; h2.textContent = 'On commit'; menu.appendChild(h2);
    [['confirm', 'Ask, then send'], ['manual', 'Pre-fill, I’ll click'], ['auto', 'Send automatically']].forEach(function (m) {
      var item = document.createElement('button');
      item.className = 'chrx-menu-item' + (m[0] === cfg.commitMode ? ' chrx-sel' : '');
      item.textContent = (m[0] === cfg.commitMode ? '● ' : '○ ') + m[1];
      item.onclick = function () { cfg.commitMode = m[0]; saveCfg(); renderButton(); closeMenu(); };
      menu.appendChild(item);
    });

    host.appendChild(menu);
    setTimeout(function () {
      document.addEventListener('click', onDocClick, true);
    }, 0);
  }
  function onDocClick(e) {
    if (menu && !host.contains(e.target)) { closeMenu(); document.removeEventListener('click', onDocClick, true); }
  }

  function renderButton() {
    if (!btn) return;
    var modeTag = cfg.commitMode === 'auto' ? ' ⚡' : (cfg.commitMode === 'manual' ? ' ✎' : '');
    btn.textContent = '→ ' + cfg.lastTeam + modeTag;
    btn.title = 'Re-assign this prescription to “' + cfg.lastTeam + '” (' + cfg.commitMode + '). Use ▾ to change.';
  }

  function buildUI() {
    if (host) return;
    host = document.createElement('div');
    host.className = 'chrx-host';
    host.style.display = 'none';

    btn = document.createElement('button');
    btn.className = 'chrx-btn';
    btn.onclick = function () { if (!busy) runMacro(cfg.lastTeam, cfg.commitMode); };

    caret = document.createElement('button');
    caret.className = 'chrx-caret'; caret.textContent = '▾';
    caret.title = 'Change team / commit behaviour';
    caret.onclick = function (e) { e.stopPropagation(); if (menu) closeMenu(); else openMenu(); };

    host.appendChild(btn);
    host.appendChild(caret);
    document.body.appendChild(host);
    renderButton();

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Show only when the prescription re-assign controls are on screen.
  function onPrescribingScreen() {
    return !!(
      findByText(['label', '[role="radio"]', 'div', 'span'], 'Save & re-assign to someone else') ||
      findByText(['button', '[role="button"]'], 'Re-assign task')
    );
  }

  function refreshVisibility() {
    if (!host) return;
    host.style.display = onPrescribingScreen() ? 'flex' : 'none';
  }

  var CSS = [
    '.chrx-host{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:stretch;',
    'font:600 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);border-radius:8px;overflow:visible}',
    '.chrx-btn{background:#0d6e5e;color:#fff;border:0;padding:10px 14px;border-radius:8px 0 0 8px;cursor:pointer;max-width:340px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chrx-btn:hover{background:#0a5a4d}',
    '.chrx-caret{background:#0a5a4d;color:#fff;border:0;border-left:1px solid rgba(255,255,255,.25);padding:0 11px;border-radius:0 8px 8px 0;cursor:pointer}',
    '.chrx-caret:hover{background:#084a40}',
    '.chrx-menu{position:absolute;right:0;bottom:46px;min-width:240px;background:#fff;color:#10302a;border:1px solid #cdd8d4;',
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

  loadCfg().then(function () {
    buildUI();
    refreshVisibility();
    var mo = new MutationObserver(function () { refreshVisibility(); });
    mo.observe(document.body, { childList: true, subtree: true });
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes[STORE_KEY]) { loadCfg().then(renderButton); }
      });
    }
  });
})();
