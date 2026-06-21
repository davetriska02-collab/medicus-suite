// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — UI click-path recorder (developer instrumentation)
//
// PURPOSE
//   A console-pasteable recorder used to map an on-screen click sequence so it
//   can later be reproduced by a UI-driving macro. It records the *structure*
//   of the controls you interact with (stable selectors + state notes). It does
//   NOT read patient-data field values, does NOT touch the network, and does NOT
//   submit or change anything. Observation only.
//
// USAGE
//   1. Open DevTools → Console on the Medicus prescribing window (use a TEST
//      patient).
//   2. Paste this whole file and press Enter. You'll see "[recorder] armed".
//   3. Click through your sequence normally. Each click is logged.
//   4. Call  chRec.note('finished authorising; about to allocate')  at any point
//      to drop a free-text marker between steps.
//   5. When done, call  chRec.dump()  to print the ordered JSON, or
//      chRec.copy()  to copy it to the clipboard. chRec.stop() to disarm.
//
// WHAT IT CAPTURES PER CLICK
//   - visible label/text of the control (trimmed, capped — no long free text)
//   - tag, id, role, aria-label, data-* attributes, class list
//   - several candidate selectors, most-stable first
//   - whether it sits inside a modal / dialog / dropdown / ag-grid row
//   - a snapshot of which dialog/menu is open AFTER the click (state transition)
//
// It deliberately avoids input values, textareas, and contenteditable text so
// patient-identifiable content is not recorded.

(function () {
  'use strict';
  if (window.chRec && window.chRec.__armed) {
    console.warn('[recorder] already armed — call chRec.stop() first to re-arm');
    return;
  }

  var steps = [];
  var seq = 0;

  function cap(s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    return s.length > (n || 60) ? s.slice(0, n || 60) + '…' : s;
  }

  // A short, human-meaningful label for a control — never its data value.
  function labelOf(el) {
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return cap(aria);
    var title = el.getAttribute && el.getAttribute('title');
    if (title) return cap(title);
    // own text only (avoid dumping a whole panel's text)
    var own = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) own += n.textContent;
    }
    own = cap(own, 40);
    if (own) return own;
    return cap(el.textContent, 40);
  }

  function dataAttrs(el) {
    var out = {};
    if (!el.attributes) return out;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-') === 0) out[a.name] = cap(a.value, 50);
    }
    return out;
  }

  function looksStableId(id) {
    if (!id) return false;
    // reject obviously generated ids (long hex, uuid-ish, many digits)
    if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(id)) return false;
    if (/^[a-z]*[0-9]{4,}$/i.test(id)) return false;
    return true;
  }

  function nth(el) {
    var p = el.parentElement;
    if (!p) return 1;
    var i = 1;
    for (var c = el.previousElementSibling; c; c = c.previousElementSibling) {
      if (c.tagName === el.tagName) i++;
    }
    return i;
  }

  function shortPath(el) {
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 5) {
      var seg = cur.tagName.toLowerCase();
      if (cur.id && looksStableId(cur.id)) {
        parts.unshift(seg + '#' + cur.id);
        break;
      }
      seg += ':nth-of-type(' + nth(cur) + ')';
      parts.unshift(seg);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  // Candidate selectors, most stable first. We later pick the best at build time.
  function selectorsFor(el) {
    var out = [];
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) out.push('[aria-label="' + aria + '"]');
    var d = dataAttrs(el);
    ['data-testid', 'data-test', 'data-cy', 'data-id', 'data-action'].forEach(function (k) {
      if (d[k]) out.push('[' + k + '="' + d[k] + '"]');
    });
    if (el.id && looksStableId(el.id)) out.push('#' + el.id);
    var role = el.getAttribute && el.getAttribute('role');
    var label = labelOf(el);
    if (role && label) out.push(role + ':"' + label + '" (text-match — resolve at build time)');
    out.push(shortPath(el));
    return out;
  }

  function context(el) {
    var tags = { dialog: 'modal', '[role="dialog"]': 'modal', '.modal': 'modal',
                 '[role="menu"]': 'menu', '.dropdown-menu': 'dropdown',
                 '.ag-row': 'ag-grid-row', '[col-id]': 'ag-grid-cell' };
    var hits = [];
    Object.keys(tags).forEach(function (sel) {
      if (el.closest && el.closest(sel)) hits.push(tags[sel]);
    });
    return hits;
  }

  // What overlay/menu is open right now (state-transition fingerprint).
  function openState() {
    var s = [];
    document.querySelectorAll('[role="dialog"], dialog[open], .modal.show, [role="menu"], .dropdown-menu').forEach(function (el) {
      if (el.offsetParent !== null || el.open) {
        var heading = el.querySelector('h1,h2,h3,[role="heading"]');
        s.push(cap((el.getAttribute('aria-label') || (heading && heading.textContent) || el.className), 50));
      }
    });
    return s;
  }

  function onClick(e) {
    var el = e.target.closest('button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"], input[type="checkbox"], input[type="radio"], li, .ag-row') || e.target;
    var rec = {
      step: ++seq,
      t: new Date().toISOString().slice(11, 23),
      label: labelOf(el),
      tag: el.tagName ? el.tagName.toLowerCase() : '?',
      id: el.id || null,
      role: (el.getAttribute && el.getAttribute('role')) || null,
      ariaLabel: (el.getAttribute && el.getAttribute('aria-label')) || null,
      data: dataAttrs(el),
      classes: el.className && typeof el.className === 'string' ? el.className.split(/\s+/).filter(Boolean).slice(0, 8) : [],
      within: context(el),
      selectors: selectorsFor(el),
    };
    // Capture the resulting state shortly after the click settles.
    setTimeout(function () {
      rec.openAfter = openState();
      console.log('%c[recorder] step ' + rec.step + ': ' + rec.label, 'color:#2a7', rec);
    }, 250);
    steps.push(rec);
  }

  document.addEventListener('click', onClick, true);

  window.chRec = {
    __armed: true,
    note: function (text) {
      steps.push({ step: ++seq, t: new Date().toISOString().slice(11, 23), marker: cap(text, 120) });
      console.log('%c[recorder] note: ' + text, 'color:#a72');
    },
    dump: function () {
      var json = JSON.stringify(steps, null, 2);
      console.log(json);
      return json;
    },
    copy: function () {
      var json = JSON.stringify(steps, null, 2);
      if (navigator.clipboard) navigator.clipboard.writeText(json).then(function () {
        console.log('[recorder] copied ' + steps.length + ' steps to clipboard');
      });
      return json;
    },
    stop: function () {
      document.removeEventListener('click', onClick, true);
      this.__armed = false;
      console.log('[recorder] disarmed. ' + steps.length + ' steps recorded — call chRec.dump() to print.');
    },
  };

  console.log('%c[recorder] armed — click through your sequence. chRec.note(), chRec.dump(), chRec.copy(), chRec.stop()', 'color:#2a7;font-weight:bold');
})();
