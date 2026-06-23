// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Task" one-click button for the prescribing screen
//
// The prescription-request task overview has no "add task" control of its own,
// even though that action exists ELSEWHERE in the record. This file adds a
// floating "+ Task" button beside the routine-prescription button and, when
// clicked, REPLAYS a captured click-path — DRIVING THE REAL MEDICUS UI, the same
// controls a user would click to open the new-task workflow:
//
//   e.g.  "More actions"  →  "Add task"   (whatever you captured)
//
// WHY drive the UI rather than the API: this keeps Medicus as the system of
// record — its own validation, access control and audit trail all fire exactly
// as if the clinician clicked. This file makes NO network calls and reads no
// patient-data field values.
//
// HOW TO CAPTURE THE CLICK-PATH (one-off setup, per Medicus build)
//   The task-creation controls differ between Medicus releases, so the replay
//   sequence is CONFIGURABLE rather than hard-coded. To capture it:
//     1. Open a part of the record where "add task" DOES exist (use a TEST
//        patient). Open DevTools → Console.
//     2. Paste `scripts/ui-clickpath-recorder.js` and press Enter.
//     3. Click through to OPEN the new-task form (stop BEFORE the final Save —
//        we never want the button to create a record on its own).
//     4. Run `chRec.macro()` — it prints/copies the replay JSON.
//     5. On the prescribing screen, open this button's ▾ menu → "Edit steps…"
//        and paste that JSON. Done — the button now replays it.
//   A sensible default ("More actions" → "Add task") ships so the button works
//   out of the box on builds that use those labels.
//
// SAFETY
//   • All controls are matched by VISIBLE TEXT — every id on this screen is
//     generated per session, so ids are never trusted.
//   • If ANY step's control cannot be found, the macro ABORTS with a message and
//     clicks nothing further — it must never click the wrong control.
//   • The default behaviour OPENS the task form and stops; the clinician fills it
//     in and saves. A step explicitly marked `submit` is gated by `commitMode`:
//       'open'   (default) — replay nav steps only; never click a submit step
//       'manual'           — replay, then highlight the submit control to click
//       'auto'             — replay including the submit click
//   • The macro operates on whatever task is currently on screen; it does not
//     choose the patient.
//
// Runs in the ISOLATED world at document_idle (see manifest content_scripts).

(function () {
  'use strict';
  if (window.__chTaskBtn) return;
  window.__chTaskBtn = true;

  // ---- config / storage --------------------------------------------------

  var STORE_KEY = 'triagelens.taskMacro';
  // Default replay: open the new-task workflow via the common Medicus controls.
  // Carries NO submit step, so out of the box the button only OPENS the form.
  var DEFAULTS = {
    label: 'Task',
    commitMode: 'open', // 'open' | 'manual' | 'auto'
    steps: [
      { kind: 'click', text: ['More actions'] },
      { kind: 'click', text: ['Add task', 'Create task', 'New task', 'Add a task'] },
    ],
  };
  var cfg = clone(DEFAULTS);

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  // A step is { kind:'click'|'submit', text:[...] }  OR
  //           { kind:'pick', field:[...], value:'…', option?:'…' }.
  function normaliseStep(s) {
    if (!s || typeof s !== 'object') return null;
    var kind = s.kind === 'pick' || s.kind === 'submit' ? s.kind : 'click';
    if (kind === 'pick') {
      var field = toTextList(s.field);
      var value = typeof s.value === 'string' ? s.value : '';
      if (!field.length || !value) return null;
      var out = { kind: 'pick', field: field, value: value };
      if (typeof s.option === 'string' && s.option) out.option = s.option;
      return out;
    }
    var text = toTextList(s.text);
    if (!text.length) return null;
    return { kind: kind, text: text };
  }
  function toTextList(v) {
    if (Array.isArray(v))
      return v
        .filter(function (x) {
          return typeof x === 'string' && x.trim();
        })
        .map(function (x) {
          return x.trim();
        });
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    return [];
  }

  // Accept either a full {label,steps,commitMode} object or a bare steps array.
  function normaliseMacro(raw) {
    var obj = Array.isArray(raw) ? { steps: raw } : raw && typeof raw === 'object' ? raw : null;
    if (!obj) return null;
    var steps = Array.isArray(obj.steps) ? obj.steps.map(normaliseStep).filter(Boolean) : [];
    return {
      label: typeof obj.label === 'string' && obj.label.trim() ? obj.label.trim().slice(0, 24) : DEFAULTS.label,
      commitMode: ['open', 'manual', 'auto'].indexOf(obj.commitMode) >= 0 ? obj.commitMode : DEFAULTS.commitMode,
      steps: steps,
    };
  }

  function loadCfg() {
    return new Promise(function (resolve) {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve();
      chrome.storage.local.get(STORE_KEY, function (r) {
        var s = r && r[STORE_KEY];
        var norm = normaliseMacro(s);
        // Fall back to the shipped default if nothing valid is stored.
        cfg = norm && norm.steps.length ? norm : clone(DEFAULTS);
        resolve();
      });
    });
  }

  function saveCfg() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    var out = {};
    out[STORE_KEY] = { label: cfg.label, commitMode: cfg.commitMode, steps: cfg.steps };
    chrome.storage.local.set(out);
  }

  // ---- DOM helpers -------------------------------------------------------

  function norm(s) {
    return (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function visible(el) {
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }
  function isEnabled(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    if (el.classList && el.classList.contains('disabled')) return false;
    return true;
  }
  function textOf(el) {
    return norm((el && el.getAttribute && el.getAttribute('aria-label')) || (el && el.textContent));
  }

  // Find the first visible control whose text equals (or, as fallback, contains)
  // any of `wantedList`. Earlier alternates win.
  function findByTextAny(selectors, wantedList) {
    var nodes = [];
    selectors.forEach(function (sel) {
      try {
        Array.prototype.push.apply(nodes, document.querySelectorAll(sel));
      } catch (e) {
        /* ignore */
      }
    });
    for (var w = 0; w < wantedList.length; w++) {
      var want = norm(wantedList[w]);
      if (!want) continue;
      var exact = null,
        partial = null;
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (!visible(el)) continue;
        var t = textOf(el);
        if (t === want) {
          exact = el;
          break;
        }
        if (!partial && t.indexOf(want) >= 0) partial = el;
      }
      if (exact || partial) return exact || partial;
    }
    return null;
  }

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
    for (var i = 0; i < nodes.length; i++) {
      if (visible(nodes[i]) && textOf(nodes[i]).indexOf(w) >= 0) out.push(nodes[i]);
    }
    return out;
  }

  function sharesPanel(a, b, depth) {
    var node = b;
    for (var i = 0; i < (depth || 12) && node; i++, node = node.parentElement) {
      if (node.contains(a)) return true;
    }
    return false;
  }

  function waitFor(fn, timeout, interval) {
    timeout = timeout || 4000;
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

  // A field input addressed by its label/aria/placeholder text (any alternate).
  function findFieldInput(fieldList) {
    var inputs = document.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!visible(el)) continue;
      var hint = norm((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || ''));
      for (var f = 0; f < fieldList.length; f++) {
        if (hint.indexOf(norm(fieldList[f])) >= 0) return el;
      }
    }
    var labels = document.querySelectorAll('label, .label, [class*="label"]');
    for (var j = 0; j < labels.length; j++) {
      var lt = textOf(labels[j]);
      for (var k = 0; k < fieldList.length; k++) {
        if (lt.indexOf(norm(fieldList[k])) >= 0) {
          var scope = labels[j].closest('div') || labels[j].parentElement;
          var inp = scope && scope.querySelector('input');
          if (inp && visible(inp)) return inp;
        }
      }
    }
    return null;
  }

  // ---- the macro ---------------------------------------------------------

  var running = false;

  function abort(msg) {
    toast(msg, 'err');
  }

  async function runMacro() {
    if (running) return;
    if (!cfg.steps.length) {
      return abort('No task steps configured. Capture them with the recorder, then ▾ → “Edit steps…”.');
    }
    running = true;
    setBusy(true);
    try {
      for (var i = 0; i < cfg.steps.length; i++) {
        var step = cfg.steps[i];
        var n = i + 1;

        if (step.kind === 'pick') {
          var input = await waitFor(function () {
            return findFieldInput(step.field);
          }, 4000);
          if (!input) return abort('Step ' + n + ': couldn’t find the “' + step.field[0] + '” field.');
          input.focus();
          realClick(input);
          setNativeValue(input, step.value);
          var lastCh = step.value.slice(-1);
          input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: lastCh }));
          input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: lastCh }));
          var wantOpt = step.option || step.value;
          var option = await waitFor(function () {
            var opts = document.querySelectorAll('[id^="select-item-"], [role="option"], li[role="option"]');
            var exact = null,
              partial = null;
            for (var o = 0; o < opts.length; o++) {
              if (!visible(opts[o])) continue;
              var t = textOf(opts[o]);
              if (t === norm(wantOpt)) {
                exact = opts[o];
                break;
              }
              if (!partial && t.indexOf(norm(wantOpt)) >= 0) partial = opts[o];
            }
            return exact || partial;
          }, 4000);
          if (!option) return abort('Step ' + n + ': “' + wantOpt + '” wasn’t in the list.');
          realClick(option);
          continue;
        }

        // click / submit — find the control by visible text.
        var enableGated = step.kind === 'submit';
        var ctrl = await waitFor(function () {
          var c = findByTextAny(['button', '[role="button"]', '[role="menuitem"]', 'a', 'label'], step.text);
          if (!c) return null;
          return enableGated && !isEnabled(c) ? null : c;
        }, 5000);
        if (!ctrl) return abort('Step ' + n + ': couldn’t find “' + step.text[0] + '” on screen.');

        if (step.kind === 'submit') {
          if (cfg.commitMode === 'open') {
            highlight(ctrl);
            toast('Form is open — review and click “' + step.text[0] + '” to save.', 'ok');
            return;
          }
          if (cfg.commitMode === 'manual') {
            highlight(ctrl);
            toast('Ready — review and click “' + step.text[0] + '”.', 'ok');
            return;
          }
          // 'auto' — fall through and click the submit
        }
        realClick(ctrl);
      }
      // Reached the end with no submit step → the form is open for the clinician.
      if (cfg.commitMode === 'open') toast('Task form opened — fill it in and save.', 'ok');
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
      el.style.boxShadow = '0 0 0 3px #2563eb';
      setTimeout(function () {
        el.style.boxShadow = prev;
      }, 2600);
    } catch (e) {
      /* ignore */
    }
  }

  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'chtk-toast chtk-' + (kind || 'ok');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.classList.add('chtk-show');
    }, 10);
    setTimeout(function () {
      t.classList.remove('chtk-show');
      setTimeout(function () {
        t.remove();
      }, 300);
    }, 4600);
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
    menu.className = 'chtk-menu';

    var h1 = document.createElement('div');
    h1.className = 'chtk-menu-h';
    h1.textContent = 'Task click-path (' + cfg.steps.length + ' step' + (cfg.steps.length === 1 ? '' : 's') + ')';
    menu.appendChild(h1);

    cfg.steps.forEach(function (s, idx) {
      var row = document.createElement('div');
      row.className = 'chtk-step';
      var what =
        s.kind === 'pick'
          ? 'pick “' + s.value + '”'
          : (s.kind === 'submit' ? 'submit ' : 'click ') + '“' + s.text[0] + '”';
      row.textContent = idx + 1 + '. ' + what;
      menu.appendChild(row);
    });

    var edit = document.createElement('button');
    edit.className = 'chtk-menu-item chtk-edit';
    edit.textContent = '✎ Edit steps (paste captured JSON)…';
    edit.onclick = function () {
      var current = JSON.stringify({ label: cfg.label, commitMode: cfg.commitMode, steps: cfg.steps }, null, 2);
      var input = window.prompt(
        'Paste the JSON from the recorder’s chRec.macro() (or edit the current steps):',
        current
      );
      if (input != null) {
        var parsed = null;
        try {
          parsed = normaliseMacro(JSON.parse(input));
        } catch (e) {
          parsed = null;
        }
        if (parsed && parsed.steps.length) {
          cfg = parsed;
          saveCfg();
          renderButton();
        } else {
          toast('Couldn’t read those steps — expected JSON with a non-empty “steps” array.', 'err');
        }
      }
      closeMenu();
    };
    menu.appendChild(edit);

    var reset = document.createElement('button');
    reset.className = 'chtk-menu-item';
    reset.textContent = '↺ Reset to default';
    reset.onclick = function () {
      cfg = clone(DEFAULTS);
      saveCfg();
      renderButton();
      closeMenu();
    };
    menu.appendChild(reset);

    var h2 = document.createElement('div');
    h2.className = 'chtk-menu-h';
    h2.textContent = 'On the final step';
    menu.appendChild(h2);
    [
      ['open', 'Just open the form'],
      ['manual', 'Highlight save, I’ll click'],
      ['auto', 'Save automatically'],
    ].forEach(function (m) {
      var item = document.createElement('button');
      item.className = 'chtk-menu-item' + (m[0] === cfg.commitMode ? ' chtk-sel' : '');
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
    btn.textContent = '+ ' + cfg.label + modeTag;
    btn.title =
      'Open the new-task workflow on this prescription (' +
      cfg.steps.length +
      ' captured step' +
      (cfg.steps.length === 1 ? '' : 's') +
      '). Use ▾ to edit the click-path.';
  }

  function buildUI() {
    if (host) return;
    host = document.createElement('div');
    host.className = 'chtk-host';

    btn = document.createElement('button');
    btn.className = 'chtk-btn';
    btn.onclick = function () {
      if (!busy) runMacro();
    };

    caret = document.createElement('button');
    caret.className = 'chtk-caret';
    caret.textContent = '▾';
    caret.title = 'Edit captured steps / commit behaviour';
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

  // Where to inject — same gating doctrine as routine-rx-button.js: only on the
  // prescription task overview, anchored beside the "More actions" button that
  // shares a panel with the "Save & send to routine requests task list" routing
  // control (never inside a dialog or an overlapping drawer's own action row).
  function findRoutingControl() {
    return (
      findByTextAny(['label', '[role="radio"]', '.radio'], ['Save & send to routine requests task list']) ||
      findByTextAny(['div', 'span'], ['Save & send to routine requests task list'])
    );
  }

  function findActionAnchor() {
    if (!/\/tasks\/data\/[^/]*prescription[^/]*\/overview\//i.test(location.pathname)) return null;
    var routine = findRoutingControl();
    if (!routine) return null;
    var candidates = collectByText(['button', '[role="button"]'], 'More actions');
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

  var placedAnchor = null;
  var placedRoutingControl = null;

  function ensureInjected() {
    if (!host) return;
    if (!/\/tasks\/data\/[^/]*prescription[^/]*\/overview\//i.test(location.pathname)) {
      removeHost();
      return;
    }
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

  // PREPEND (never append): trailing nodes get reconciled away by Vue. Disconnect
  // the fallback observer across our own write so it doesn't self-trigger.
  function insertHost(anchor) {
    if (mo) mo.disconnect();
    try {
      anchor.insertBefore(host, anchor.firstChild);
    } finally {
      if (mo) mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  var CSS = [
    '.chtk-host{display:inline-flex;align-items:stretch;vertical-align:middle;position:relative;margin:0 8px 0 0;',
    'font:600 13px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.18);border-radius:8px}',
    '.chtk-btn{background:#2563eb;color:#fff;border:0;padding:9px 13px;border-radius:8px 0 0 8px;cursor:pointer;max-width:240px;',
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chtk-btn:hover{background:#1d4ed8}',
    '.chtk-caret{background:#1d4ed8;color:#fff;border:0;border-left:1px solid rgba(255,255,255,.25);padding:0 11px;border-radius:0 8px 8px 0;cursor:pointer}',
    '.chtk-caret:hover{background:#1e40af}',
    '.chtk-menu{position:absolute;right:0;bottom:calc(100% + 6px);z-index:2147483000;min-width:260px;background:#fff;color:#10243f;border:1px solid #cdd6e6;',
    'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:6px;display:flex;flex-direction:column;gap:2px}',
    '.chtk-menu-h{font:700 11px/1 system-ui;text-transform:uppercase;letter-spacing:.04em;color:#5b6b8a;padding:8px 8px 4px}',
    '.chtk-step{font:500 12px/1.3 system-ui;color:#3a4a66;padding:2px 9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chtk-menu-item{text-align:left;background:none;border:0;padding:7px 9px;border-radius:6px;cursor:pointer;font:500 13px/1.2 system-ui;color:#10243f}',
    '.chtk-menu-item:hover{background:#eef2fb}',
    '.chtk-menu-item.chtk-sel{color:#2563eb;font-weight:700}',
    '.chtk-menu-item.chtk-edit{color:#2563eb}',
    '.chtk-toast{position:fixed;right:18px;bottom:120px;z-index:2147483000;max-width:340px;padding:11px 14px;border-radius:8px;',
    'color:#fff;font:500 13px/1.35 system-ui;box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;transform:translateY(8px);transition:.28s}',
    '.chtk-toast.chtk-show{opacity:1;transform:none}',
    '.chtk-toast.chtk-ok{background:#2563eb}.chtk-toast.chtk-warn{background:#b45309}.chtk-toast.chtk-err{background:#b42318}',
  ].join('');

  // ---- boot --------------------------------------------------------------

  var mo = null;

  function isOwnMutation(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      var lists = [m.addedNodes, m.removedNodes];
      for (var l = 0; l < lists.length; l++) {
        var nodes = lists[l];
        for (var n = 0; n < nodes.length; n++) {
          var node = nodes[n];
          if (node.nodeType !== 1) continue;
          if (node !== host && !(host && host.contains && host.contains(node))) return false;
        }
      }
    }
    return true;
  }

  var ensureTimer = null;
  var rafScheduled = false;
  function scheduleEnsure() {
    if (document.hidden) return;
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
    var onBodyMutations = function (mutations) {
      if (isOwnMutation(mutations)) return;
      scheduleEnsure();
    };
    var hub = window.__chObserverHub;
    if (hub && hub.subscribe) {
      hub.subscribe(onBodyMutations);
    } else {
      mo = new MutationObserver(onBodyMutations);
      mo.observe(document.body, { childList: true, subtree: true });
    }
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
