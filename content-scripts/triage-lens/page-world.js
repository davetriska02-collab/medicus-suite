// Medicus Suite — Triage Lens page-world interceptors
//
// Runs in the PAGE'S MAIN WORLD (declared with "world":"MAIN" in manifest.json,
// run_at document_start). This is the ONLY reliable way to wrap window.fetch /
// XMLHttpRequest on Medicus: the site ships a strict Content-Security-Policy
// (script-src 'self', no 'unsafe-inline'), which BLOCKS the old approach of
// injecting an inline <script> element from the isolated content script. A
// manifest-declared MAIN-world content script is injected by the browser itself
// and is exempt from the page CSP.
//
// It wraps fetch + XHR to observe the queue task-list response and re-broadcasts
// the bits the isolated content script needs as a window CustomEvent (which
// crosses the world boundary for JSON-serialisable detail):
//   • /tasks/data/{slug}/task-list      → 'ch-task-list-data'   (queue monitoring)
//
// It reads responses only; it never blocks, rewrites, or sends anything. No
// patient data leaves the browser.

(function () {
  'use strict';
  if (window.__chPageWorld) return;
  window.__chPageWorld = true;

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var TL_RE = new RegExp('/tasks/data/([^/?]+)/task-list');

  // ---- Queue task-list ----
  function pickUuid(item) {
    if (!item || typeof item !== 'object') return null;
    var pref = ['taskUuid', 'taskId', 'uuid', 'id'];
    for (var i = 0; i < pref.length; i++) {
      var v = item[pref[i]];
      if (typeof v === 'string' && UUID_RE.test(v)) return v;
    }
    for (var k in item) {
      if (/patient/i.test(k)) continue;
      var val = item[k];
      if (typeof val === 'string' && UUID_RE.test(val) && /task|id|uuid/i.test(k)) return val;
    }
    return null;
  }

  function handleTaskList(u, body) {
    var m = u.match(TL_RE);
    if (!m) return;
    var items = body && (body.tasks || body.data || body.results || body.rows ||
      (Array.isArray(body) ? body : null));
    if (!Array.isArray(items)) {
      console.warn('[ClinHUD] task-list: no array found; body keys=', body ? Object.keys(body) : body);
      return;
    }
    if (items.length && !window.__chTaskKeysLogged) {
      window.__chTaskKeysLogged = 1;
      console.debug('[ClinHUD] task-list first item keys:', Object.keys(items[0]));
    }
    var rows = items.map(function (item, i) { return { rowIndex: i, taskUuid: pickUuid(item) }; })
      .filter(function (r) { return r.taskUuid; });
    if (rows.length) {
      window.dispatchEvent(new CustomEvent('ch-task-list-data', { detail: { rows: rows, taskTypeSlug: m[1] } }));
    } else {
      console.warn('[ClinHUD] task-list: no task UUIDs from ' + items.length + ' items; sample=', items[0]);
    }
  }

  // ---- fetch wrap ----
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (url) {
      var p = origFetch.apply(this, arguments);
      try {
        var u = typeof url === 'string' ? url : (url && url.url) || '';
        if (TL_RE.test(u)) {
          p.then(function (r) {
            try {
              r.clone().json().then(function (b) { handleTaskList(u, b); })
                .catch(function (e) { console.warn('[ClinHUD] task-list parse error', e); });
            } catch (_) {}
          });
        }
      } catch (_) {}
      return p;
    };
  }

  // ---- XHR wrap (Axios — this is what Medicus actually uses) ----
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { this.__chUrl = url; } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try {
      var xhr = this;
      var u = xhr.__chUrl || '';
      if (TL_RE.test(u)) {
        xhr.addEventListener('load', function () {
          try {
            handleTaskList(u, JSON.parse(xhr.responseText));
          } catch (e) { console.warn('[ClinHUD] interceptor parse error', e); }
        });
      }
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  console.debug('[ClinHUD] page-world interceptors installed (MAIN world)');
})();
