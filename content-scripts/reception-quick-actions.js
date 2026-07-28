// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — GP → reception "Quick actions" composer, injected above the
// task overview's Internal-comment textarea.
//
// WHAT IT DOES
//   A GP triaging a task tells reception what to do in the free-text "Internal
//   comment" box ("routine with nat please"). This widget puts three chip rows —
//   Action / With whom / Timeframe — plus one free-text "If not / other" input
//   directly above that box, and an explicit "Insert into comment" button that
//   APPENDS one plain-English sentence to it.
//
// WHAT IT DOES NOT DO (H-049 controls — do not soften any of these)
//   • It writes TEXT ONLY. It books nothing, assigns nothing, sends nothing and
//     submits nothing. The clinician still reads the comment and presses
//     Medicus's own Submit control — which this widget HIGHLIGHTS, never clicks.
//   • It never clears or rewrites what the clinician already typed: the insert is
//     append-only (QuickActionsCore.appendToComment).
//   • Nothing inserts without an explicit button press, and the button is dead
//     until an Action chip is picked.
//   • The task UUID is pinned when the composer opens and RE-VERIFIED at insert
//     time — the same wrong-target discipline as task-inline.js's doCreate()
//     (audit C1 / H-043). A mid-flight SPA navigation aborts with a visible error
//     instead of writing the previous task's instruction into a new task's box.
//   • The free-text note is transient JS state and is NEVER persisted — only the
//     configurable LISTS live in chrome.storage (triagelens.quickActions), and
//     they are practice config, not patient data.
//
// The composed sentence itself lives in shared/quick-actions-core.js (pure, and
// pinned verbatim by test-quick-actions-core.js) so a phrasing drift fails CI
// rather than reaching a receptionist.

'use strict';

(function () {
  if (window.__msQaInline) return;
  window.__msQaInline = true;

  // Pure composer core — loaded earlier in the manifest's content-script list.
  var QA = window.QuickActionsCore;
  if (!QA) return;

  // DOM-contract registry (Horizon-1) — see shared/dom-contracts.js
  // (quick-actions.internal-comment / task-widget.card-submit-button).
  var DC = window.DomContracts;

  var STORE_KEY = 'triagelens.quickActions';

  // ── Helpers (copied verbatim from content-scripts/task-inline.js:33-49 —
  //    these files are deliberately independent injections, not a shared module) ─

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getTaskInfo() {
    const m = location.pathname.match(
      /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (!m) return null;
    return { siteId: m[1], typeSlug: m[2], taskUuid: m[3] };
  }

  function visible(el) {
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }

  // Copied from content-scripts/triage-lens/routine-rx-button.js:284-294 — Vue
  // binds the textarea's value through the native property setter, so assigning
  // el.value directly leaves the framework's model stale (the GP would see the
  // text and Medicus would submit without it). Set through the prototype
  // descriptor and fire a bubbling 'input' event so Vue picks the change up.
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

  // Copied from routine-rx-button.js:558-569 (its `highlight`) — scroll the
  // control into view and ring it for a couple of seconds. Deliberately NOT a
  // click: pressing Submit is the clinician's decision, always.
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

  // ── Config ────────────────────────────────────────────────────────────────────
  // Practice-wide chip lists. Saved ONLY from the options page and this widget's
  // "+ name" chip; everything else here is read-only.

  var cfg = QA.sanitiseConfig(null);

  function activeSet() {
    return cfg.sets[cfg.activeSet] || cfg.sets.default || { actions: [], who: [], when: [], fallbacks: [] };
  }

  // Version-gated shipped-preset migration. Runs in LOCK-STEP with the options
  // editor's load path (options/options.js initQuickActions) — if only one surface
  // migrated, the other would write its stale-version config back and un-migrate
  // the practice on the next save. Persists only when the merge changed something,
  // so the storage.onChanged listener below cannot loop (a second merge is a no-op).
  function applyShippedMerge(stored) {
    var merged = QA.mergeShippedPresets(stored);
    cfg = merged.cfg;
    if (merged.changed) saveCfg();
    return cfg;
  }

  function loadCfg() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(STORE_KEY, function (r) {
          resolve(applyShippedMerge(r && r[STORE_KEY]));
        });
      } catch (e) {
        cfg = QA.sanitiseConfig(null);
        resolve(cfg);
      }
    });
  }

  function saveCfg() {
    try {
      var payload = {};
      payload[STORE_KEY] = cfg;
      chrome.storage.local.set(payload);
    } catch (e) {
      /* ignore — the widget still works for this page load */
    }
  }

  // ── State (all transient; the note NEVER reaches chrome.storage) ──────────────

  function blankState() {
    return {
      open: false,
      action: '',
      who: '',
      when: '',
      note: '',
      // Pinned when the composer is opened or the first chip is picked, and
      // re-verified before every insert (H-043 discipline).
      taskUuid: null,
    };
  }

  var s = blankState();

  function pinTask() {
    if (s.taskUuid) return;
    var info = getTaskInfo();
    s.taskUuid = info ? info.taskUuid : null;
  }

  // ── Finding the Internal-comment textarea ─────────────────────────────────────
  // Presence-gated: no comment box on this task type → no widget, silently. The
  // discovery order mirrors lab-file-button.js's field lookup (aria-label /
  // placeholder hint first), then falls back to nearby "Internal comment" label
  // text, because Medicus renders the label as a sibling node rather than a
  // <label for>. See the quick-actions.internal-comment DOM contract.

  var COMMENT_HINT_RE = /comment/i;
  var INTERNAL_COMMENT_RE = /internal\s*comment/i;
  var EXCLUDE_SEL = '#ms-qa-widget, [role="dialog"], [aria-modal="true"]';

  var SUBMIT_BTN_CONTRACT = DC && DC.get('task-widget.card-submit-button');
  var SUBMIT_BTN_SEL = SUBMIT_BTN_CONTRACT
    ? SUBMIT_BTN_CONTRACT.target.join(', ')
    : 'button, [role="button"], input[type="submit"]';

  function hintOf(el) {
    return ((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'))) || '').trim();
  }

  // Walk the previousElementSibling chain of the textarea AND of its parent — the
  // label sits at one of those two levels in every layout observed so far. Bounded
  // to 4 hops per chain so a long form never turns this into a full-page scan.
  function labelledInternalComment(ta) {
    var scopes = [ta, ta.parentElement];
    for (var i = 0; i < scopes.length; i++) {
      var node = scopes[i];
      if (!node) continue;
      var sib = node.previousElementSibling;
      var hops = 0;
      while (sib && hops < 4) {
        if (INTERNAL_COMMENT_RE.test((sib.textContent || '').trim())) return true;
        sib = sib.previousElementSibling;
        hops++;
      }
    }
    return false;
  }

  function findCommentBox() {
    if (!getTaskInfo()) return null;
    var all = document.querySelectorAll('textarea');
    var candidates = [];
    for (var i = 0; i < all.length; i++) {
      var ta = all[i];
      if (ta.closest && ta.closest(EXCLUDE_SEL)) continue;
      if (!visible(ta)) continue;
      candidates.push(ta);
    }
    for (var j = 0; j < candidates.length; j++) {
      if (COMMENT_HINT_RE.test(hintOf(candidates[j]))) return candidates[j];
    }
    for (var k = 0; k < candidates.length; k++) {
      if (labelledInternalComment(candidates[k])) return candidates[k];
    }
    return null;
  }

  // The card's own Submit control ("Submit", "Submit as new", …) — the nearest
  // ancestor of the comment box that contains one. Highlighted after an insert so
  // the GP's eye goes to the step that actually does something.
  function findSubmitControl(ta) {
    var node = ta.parentElement;
    while (node && node !== document.body) {
      var ctrls = node.querySelectorAll(SUBMIT_BTN_SEL);
      for (var i = 0; i < ctrls.length; i++) {
        var c = ctrls[i];
        if (c.closest && c.closest('#ms-qa-widget')) continue;
        if (!visible(c)) continue;
        if (/^submit\b/i.test((c.value || c.textContent || '').trim())) return c;
      }
      node = node.parentElement;
    }
    return null;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  var ROWS = [
    { key: 'action', list: 'actions', label: 'Action' },
    { key: 'who', list: 'who', label: 'With whom' },
    { key: 'when', list: 'when', label: 'Timeframe' },
  ];

  function previewText() {
    return QA.composeLine({ action: s.action, who: s.who, when: s.when, note: s.note });
  }

  function chipsHtml(row) {
    var list = activeSet()[row.list] || [];
    var html = list
      .map(function (label) {
        var on = s[row.key] === label;
        return (
          '<button type="button" class="ms-qa-chip' +
          (on ? ' ms-qa-chip-on' : '') +
          '" data-row="' +
          esc(row.key) +
          '" data-value="' +
          esc(label) +
          '" aria-pressed="' +
          (on ? 'true' : 'false') +
          '">' +
          esc(label) +
          '</button>'
        );
      })
      .join('');
    if (row.key === 'who') {
      html +=
        '<button type="button" class="ms-qa-chip ms-qa-chip-add" id="ms-qa-add-who" ' +
        'title="Add a name reception will recognise (saved for the whole practice)">+ name</button>';
    }
    return html;
  }

  function suggestionsHtml() {
    return (activeSet().fallbacks || [])
      .map(function (text) {
        return (
          '<button type="button" class="ms-qa-chip ms-qa-chip-suggest" data-suggest="' +
          esc(text) +
          '">' +
          esc(text) +
          '</button>'
        );
      })
      .join('');
  }

  function bodyHtml() {
    var rows = ROWS.map(function (row) {
      return (
        '<div class="ms-qa-row">' +
        '<div class="ms-qa-rowlabel">' +
        esc(row.label) +
        '</div>' +
        '<div class="ms-qa-chips">' +
        chipsHtml(row) +
        '</div>' +
        '</div>'
      );
    }).join('');

    var preview = previewText();
    return (
      '<div class="ms-qa-body">' +
      rows +
      '<div class="ms-qa-row">' +
      '<label class="ms-qa-rowlabel" for="ms-qa-note">If not / other:</label>' +
      '<input type="text" id="ms-qa-note" class="ms-qa-input" maxlength="140" ' +
      'placeholder="e.g. if no answer, text booking link" value="' +
      esc(s.note) +
      '" />' +
      '<div class="ms-qa-chips ms-qa-suggests">' +
      suggestionsHtml() +
      '</div>' +
      '</div>' +
      '<div class="ms-qa-footer">' +
      '<button type="button" class="ms-qa-btn" id="ms-qa-insert"' +
      (preview ? '' : ' disabled') +
      '>Insert into comment</button>' +
      '<button type="button" class="ms-qa-gear" id="ms-qa-gear" title="Edit lists (whole practice)" ' +
      'aria-label="Edit lists (whole practice)">⚙</button>' +
      '<div class="ms-qa-preview" id="ms-qa-preview">' +
      esc(preview || 'Pick an action to build the sentence.') +
      '</div>' +
      '</div>' +
      '<div class="ms-qa-notice" id="ms-qa-notice" role="status" aria-live="polite"></div>' +
      '</div>'
    );
  }

  function buildHtml() {
    return (
      '<div class="ms-qa-header" id="ms-qa-toggle" role="button" tabindex="0" aria-expanded="' +
      (s.open ? 'true' : 'false') +
      '">' +
      '<span class="ms-qa-chevron">' +
      (s.open ? '▾' : '▸') +
      '</span>' +
      '<span class="ms-qa-title">Reception instruction</span>' +
      '<span class="ms-qa-muted">writes text only — books nothing</span>' +
      '</div>' +
      (s.open ? bodyHtml() : '')
    );
  }

  function renderInto(el) {
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  function rerender() {
    var w = document.getElementById('ms-qa-widget');
    if (w) renderInto(w);
  }

  // Cheap in-place updates so typing in the note field never re-renders (which
  // would drop focus mid-word) — same reasoning as task-inline.js's description
  // input handler.
  function refreshPreview() {
    var line = previewText();
    var prev = document.getElementById('ms-qa-preview');
    if (prev) prev.textContent = line || 'Pick an action to build the sentence.';
    var btn = document.getElementById('ms-qa-insert');
    if (btn) btn.disabled = !line;
  }

  var _noticeTimer = null;

  function showNotice(text, kind) {
    var el = document.getElementById('ms-qa-notice');
    if (!el) return;
    el.textContent = text;
    el.className = 'ms-qa-notice ms-qa-notice-' + (kind || 'ok') + ' ms-qa-notice-on';
    if (_noticeTimer) clearTimeout(_noticeTimer);
    _noticeTimer = setTimeout(function () {
      var live = document.getElementById('ms-qa-notice');
      if (live) {
        live.textContent = '';
        live.className = 'ms-qa-notice';
      }
    }, 4000);
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  function toggleOpen() {
    s.open = !s.open;
    if (s.open) pinTask();
    rerender();
  }

  function pickChip(rowKey, value) {
    pinTask();
    s[rowKey] = s[rowKey] === value ? '' : value; // tap again to deselect
    rerender();
  }

  function addWhoName() {
    var raw = window.prompt('Name as reception knows them:');
    if (raw === null) return;
    var name = String(raw).trim().slice(0, 28);
    if (!name) return;
    var set = activeSet();
    if (!Array.isArray(set.who)) set.who = [];
    if (set.who.indexOf(name) === -1) {
      set.who.push(name);
      cfg = QA.sanitiseConfig(cfg);
      // Re-adding a shipped role the practice had deleted clears its tombstone, so
      // the config never claims an entry is both present and removed (same rule as
      // the options editor — keep the two in lock-step).
      var norm = QA.normaliseLabel(name);
      cfg.removedShipped = cfg.removedShipped.filter(function (t) {
        return t !== norm;
      });
      saveCfg();
    }
    pinTask();
    s.who = name;
    rerender();
  }

  // THE write. Synchronous end to end — no awaits between the identity re-check
  // and the append, so nothing can navigate underneath it.
  function doInsert() {
    // 1. Same task? (H-043 / audit C1 discipline — task-inline.js:469.)
    var info = getTaskInfo();
    if (!info || (s.taskUuid && info.taskUuid !== s.taskUuid)) {
      s.action = '';
      s.who = '';
      s.when = '';
      // The note can carry task-specific clinical detail — never let it survive
      // into a different task's composer.
      s.note = '';
      s.taskUuid = info ? info.taskUuid : null;
      rerender();
      showNotice('Task changed — reopen and re-pick.', 'err');
      return;
    }

    // 2. Re-locate the textarea FRESH — a cached node from before a Vue re-render
    //    can be detached, and writing into a detached node loses the text silently.
    var ta = findCommentBox();
    if (!ta || !ta.isConnected) {
      showNotice('Internal comment box not found — scroll to it and try again.', 'err');
      return;
    }

    // 3. Compose and APPEND. The existing value is read live and never rewritten.
    var line = QA.composeLine({ action: s.action, who: s.who, when: s.when, note: s.note });
    if (!line) return;
    setNativeValue(ta, QA.appendToComment(ta.value, line));

    // 4. Clear the picks so the next instruction starts clean, and hand focus to
    //    the comment box with the caret at the end for the GP to edit.
    s.action = '';
    s.who = '';
    s.when = '';
    s.note = '';
    rerender();
    try {
      ta.focus();
      var end = ta.value.length;
      ta.setSelectionRange(end, end);
    } catch (e) {
      /* ignore */
    }

    // 5. Point at Medicus's own Submit — highlight, never click.
    var submit = findSubmitControl(ta);
    if (submit) highlight(submit);

    showNotice('Text added to internal comment — not yet submitted', 'ok');
  }

  function openOptions() {
    try {
      chrome.runtime.sendMessage({ action: 'ms-open-options', section: 'quickactions' });
    } catch (e) {
      /* ignore */
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────

  function bindEvents(el) {
    var toggle = el.querySelector('#ms-qa-toggle');
    if (toggle) {
      toggle.addEventListener('click', toggleOpen);
      toggle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle.click();
        }
      });
    }

    el.querySelectorAll('.ms-qa-chip[data-row]').forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        pickChip(chip.getAttribute('data-row'), chip.getAttribute('data-value'));
      });
    });

    el.querySelector('#ms-qa-add-who')?.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      addWhoName();
    });

    // A suggestion FILLS the note field — it never inserts on its own, so the GP
    // can edit it (or delete it) before anything reaches the comment box.
    el.querySelectorAll('.ms-qa-chip-suggest').forEach(function (chip) {
      chip.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        s.note = chip.getAttribute('data-suggest') || '';
        var input = document.getElementById('ms-qa-note');
        if (input) input.value = s.note;
        refreshPreview();
      });
    });

    el.querySelector('#ms-qa-note')?.addEventListener('input', function (e) {
      s.note = e.target.value;
      refreshPreview();
    });

    el.querySelector('#ms-qa-insert')?.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      doInsert();
    });

    el.querySelector('#ms-qa-gear')?.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openOptions();
    });
  }

  // ── DOM injection ─────────────────────────────────────────────────────────────

  function injectWidget() {
    if (!getTaskInfo()) return;
    var existing = document.getElementById('ms-qa-widget');
    if (existing && existing.isConnected) return;
    if (existing) existing.remove(); // detached by a Vue re-render — replace it
    var ta = findCommentBox();
    if (!ta || !ta.parentElement) return; // presence-gated: no box, no widget
    var w = document.createElement('div');
    w.id = 'ms-qa-widget';
    renderInto(w);
    withObserverPaused(function () {
      ta.parentElement.insertBefore(w, ta);
    });
  }

  function removeWidget() {
    var w = document.getElementById('ms-qa-widget');
    if (!w) return;
    withObserverPaused(function () {
      w.remove();
    });
  }

  // ── SPA navigation & re-injection ─────────────────────────────────────────────
  // Identical discipline to task-inline.js:556-653 (own-mutation filter, cheap
  // path gate, throttle + animation-frame deferral, remove-on-leave).

  var _lastPath = location.pathname;
  var _throttle = null;
  var _obs = null;

  function observeBody() {
    if (_obs) _obs.observe(document.body, { childList: true, subtree: true });
  }

  function withObserverPaused(fn) {
    if (!_obs) {
      fn();
      return;
    }
    _obs.disconnect();
    try {
      fn();
    } finally {
      observeBody();
    }
  }

  function _isOwnWidgetMutation(mutations) {
    for (const m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-qa-widget')) {
        continue;
      }
      for (const nodes of [m.addedNodes, m.removedNodes]) {
        for (const n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-qa-widget') continue;
          if (n.closest && n.closest('#ms-qa-widget')) continue;
          return false;
        }
      }
    }
    return true;
  }

  function onMutations(mutations) {
    if (_isOwnWidgetMutation(mutations)) return;
    scheduleInject();
  }

  function scheduleInject() {
    if (_throttle) return;
    var onTaskPage = !!getTaskInfo();
    var pathChanged = location.pathname !== _lastPath;
    if (!onTaskPage && !pathChanged) return;
    if (onTaskPage && !pathChanged) {
      var existing = document.getElementById('ms-qa-widget');
      if (existing && existing.isConnected) return;
    }
    _throttle = setTimeout(runInject, 350);
  }

  function runInject() {
    _throttle = null;
    var currentPath = location.pathname;
    if (currentPath !== _lastPath) {
      // New task — drop every selection AND the pinned uuid before anything can
      // be composed against the wrong record.
      _lastPath = currentPath;
      s = blankState();
      removeWidget();
    }
    if (document.hidden) return;
    if (!getTaskInfo()) {
      removeWidget();
      return;
    }
    var existing = document.getElementById('ms-qa-widget');
    if (existing && existing.isConnected) return;
    requestAnimationFrame(function () {
      if (document.hidden) return;
      var w = document.getElementById('ms-qa-widget');
      if (w && w.isConnected) return;
      injectWidget();
    });
  }

  // ── Boot (routine-rx-button.js:929-961 pattern) ───────────────────────────────

  loadCfg().then(function () {
    scheduleInject();

    var hub = window.__chObserverHub;
    if (hub && hub.subscribe) {
      hub.subscribe(onMutations);
    } else {
      _obs = new MutationObserver(onMutations);
      observeBody();
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleInject();
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleInject);
    } else {
      scheduleInject();
    }

    // The options page (or another tab's "+ name") edited the practice lists —
    // reload and re-render so every open task picks the change up immediately.
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes[STORE_KEY]) {
          loadCfg().then(rerender);
        }
      });
    }
  });
})();
