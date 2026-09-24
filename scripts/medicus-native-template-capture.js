// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Medicus-native template / document-template / communications
// sub-menu network+DOM capture (developer instrumentation).
//
// PURPOSE (discovery)
//   Capture Medicus-native slash-command template lists, document-template
//   lists, and the communications-window communication-templates sub-menu —
//   APIs + DOM — to feed a visual organiser prototype. Suite has never
//   explored these surfaces; this script is observation only.
//
// USE A TEST PATIENT ONLY (e.g. Mickey Mouse). Prefer redaction on.
//
// USAGE
//   1. Open Medicus with Mickey Mouse (test patient) open.
//   2. DevTools → Console → paste this whole file → Enter → "[tplcap] armed".
//   3. Click on-screen "Tag: Templates" (or run window.__tagCapture("template-list")).
//   4. Type / in the native Medicus field that opens the template list; open one.
//   5. Click "Tag: Documents" → slash → document template list → open one.
//   6. Click "Tag: Comms" → open Communications → open its templates sub-menu.
//   7. Click "Dump" (or window.__dumpCapture()) → JSON copied to clipboard +
//      logged to console. Paste that JSON back to the steward / call.
//   8. window.__tplCap.stop() when finished.
//
// No network calls from this script itself. It only wraps fetch/XHR to READ
// same-origin traffic and observes the DOM. Nothing is blocked, rewritten,
// or replayed.

(function () {
  'use strict';

  if (window.__tplCap && window.__tplCap.__armed) {
    console.warn('[tplcap] already armed — call window.__tplCap.stop() first');
    return;
  }

  var BODY_KEEP_CAP = 50 * 1024; // ~50KB per response body, as requested
  var REQ_BODY_CAP = 50 * 1024;
  var HTML_KEEP_CAP = 80 * 1024;
  var IGNORE_RE =
    /(sentry\.io|\/telemetry|\/analytics|google-analytics|googletagmanager|hotjar|fullstory|datadog|newrelic|\.png(\?|$)|\.jpe?g(\?|$)|\.svg(\?|$)|\.css(\?|$)|\.woff2?(\?|$))/i;

  var timeline = [];
  var seq = 0;
  var t0 = Date.now();
  var currentTag = 'untagged';
  var redact = true;

  function nowIso() {
    return new Date().toISOString();
  }
  function rel() {
    return Date.now() - t0;
  }
  function push(entry) {
    entry.seq = ++seq;
    entry.t = nowIso();
    entry.atMs = rel();
    entry.tag = currentTag;
    timeline.push(entry);
    return entry;
  }

  // Light key-based redaction (same spirit as document-create-capture). Safe
  // default even on Mickey Mouse; toggle with window.__tplCap.raw(true).
  var REDACT_KEY_RE =
    /(nhs|dob|dateOfBirth|birth|address|postcode|postal|phone|email|displayName|givenName|familyName|surname|forename|patientName|fullName)/i;
  var NHS_RE = /\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/g;

  function redactValue(key, val) {
    if (!redact) return val;
    if (typeof val === 'string') {
      if (REDACT_KEY_RE.test(String(key || ''))) return '[redacted]';
      return val.replace(NHS_RE, '[nhs]');
    }
    return val;
  }

  function sanitiseJson(value, depth) {
    if (depth > 12) return '[depth]';
    if (value == null) return value;
    if (typeof value === 'string') {
      var s = redact ? value.replace(NHS_RE, '[nhs]') : value;
      if (s.length > BODY_KEEP_CAP) {
        return { truncated: true, length: s.length, preview: s.slice(0, BODY_KEEP_CAP) };
      }
      return s;
    }
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.slice(0, 200).map(function (v) {
        return sanitiseJson(v, depth + 1);
      });
    }
    var out = {};
    var keys = Object.keys(value).slice(0, 200);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      out[k] = redactValue(k, sanitiseJson(value[k], depth + 1));
    }
    return out;
  }

  function truncateText(text, cap) {
    var s = String(text == null ? '' : text);
    if (s.length <= cap) return { truncated: false, length: s.length, body: s };
    return {
      truncated: true,
      length: s.length,
      note: 'truncated to ' + cap + ' bytes; original length ' + s.length,
      body: s.slice(0, cap),
    };
  }

  function headersToObject(h) {
    var out = {};
    try {
      if (!h) return out;
      if (typeof h.forEach === 'function') {
        h.forEach(function (v, k) {
          out[k] = v;
        });
        return out;
      }
      if (typeof h === 'object') {
        Object.keys(h).forEach(function (k) {
          out[k] = h[k];
        });
      }
    } catch (e) {}
    return out;
  }

  function parseBodyMaybe(text) {
    if (text == null || text === '') return { empty: true };
    var t = truncateText(text, BODY_KEEP_CAP);
    if (typeof text === 'string') {
      var trimmed = text.trim();
      if (
        (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') &&
        trimmed.length < BODY_KEEP_CAP * 2
      ) {
        try {
          return {
            truncated: t.truncated,
            length: t.length,
            note: t.note,
            json: sanitiseJson(JSON.parse(t.body), 0),
          };
        } catch (e) {}
      }
    }
    return t;
  }

  // ── Network: fetch ────────────────────────────────────────────────────────
  var _fetch = window.fetch;
  window.fetch = function (input, init) {
    var method = ((init && init.method) || 'GET').toUpperCase();
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var abs;
    try {
      abs = new URL(url, location.href).href;
    } catch (e) {
      abs = url;
    }
    var sameOrigin = false;
    try {
      sameOrigin = new URL(abs).origin === location.origin;
    } catch (e) {}

    var reqHeaders = headersToObject((init && init.headers) || (input && input.headers));
    var reqBodyMeta = null;
    if (init && init.body != null) {
      if (typeof init.body === 'string') {
        reqBodyMeta = truncateText(init.body, REQ_BODY_CAP);
      } else {
        reqBodyMeta = { type: Object.prototype.toString.call(init.body), note: 'non-string body not inlined' };
      }
    }

    var started = push({
      kind: 'network',
      transport: 'fetch',
      phase: 'request',
      method: method,
      url: abs,
      sameOrigin: sameOrigin,
      requestHeaders: reqHeaders,
      requestBody: reqBodyMeta,
    });

    if (!sameOrigin || IGNORE_RE.test(abs)) {
      return _fetch.apply(this, arguments);
    }

    return _fetch.apply(this, arguments).then(function (res) {
      var clone = res.clone();
      clone
        .text()
        .then(function (text) {
          push({
            kind: 'network',
            transport: 'fetch',
            phase: 'response',
            forSeq: started.seq,
            method: method,
            url: abs,
            status: res.status,
            responseHeaders: headersToObject(res.headers),
            responseBody: parseBodyMaybe(text),
          });
        })
        .catch(function (err) {
          push({
            kind: 'network',
            transport: 'fetch',
            phase: 'response-error',
            forSeq: started.seq,
            method: method,
            url: abs,
            error: String(err && err.message ? err.message : err),
          });
        });
      return res;
    });
  };

  // ── Network: XHR (Medicus often uses axios=XHR) ───────────────────────────
  var _XHR = window.XMLHttpRequest;
  function WrappedXHR() {
    var xhr = new _XHR();
    var meta = { method: 'GET', url: '', reqHeaders: {} };
    var _open = xhr.open;
    xhr.open = function (method, url) {
      meta.method = String(method || 'GET').toUpperCase();
      try {
        meta.url = new URL(url, location.href).href;
      } catch (e) {
        meta.url = String(url);
      }
      return _open.apply(xhr, arguments);
    };
    var _setRequestHeader = xhr.setRequestHeader;
    xhr.setRequestHeader = function (k, v) {
      meta.reqHeaders[k] = v;
      return _setRequestHeader.apply(xhr, arguments);
    };
    var _send = xhr.send;
    xhr.send = function (body) {
      var sameOrigin = false;
      try {
        sameOrigin = new URL(meta.url).origin === location.origin;
      } catch (e) {}
      var reqBodyMeta = null;
      if (typeof body === 'string') reqBodyMeta = truncateText(body, REQ_BODY_CAP);
      else if (body != null) reqBodyMeta = { type: Object.prototype.toString.call(body), note: 'non-string body not inlined' };

      var started = push({
        kind: 'network',
        transport: 'xhr',
        phase: 'request',
        method: meta.method,
        url: meta.url,
        sameOrigin: sameOrigin,
        requestHeaders: Object.assign({}, meta.reqHeaders),
        requestBody: reqBodyMeta,
      });

      if (sameOrigin && !IGNORE_RE.test(meta.url)) {
        xhr.addEventListener('loadend', function () {
          var text = '';
          try {
            text = xhr.responseText;
          } catch (e) {}
          push({
            kind: 'network',
            transport: 'xhr',
            phase: 'response',
            forSeq: started.seq,
            method: meta.method,
            url: meta.url,
            status: xhr.status,
            responseHeaders: (function () {
              var raw = '';
              try {
                raw = xhr.getAllResponseHeaders() || '';
              } catch (e) {}
              var o = {};
              raw.split(/\r?\n/).forEach(function (line) {
                var i = line.indexOf(':');
                if (i > 0) o[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
              });
              return o;
            })(),
            responseBody: parseBodyMaybe(text),
          });
        });
      }
      return _send.apply(xhr, arguments);
    };
    return xhr;
  }
  WrappedXHR.prototype = _XHR.prototype;
  window.XMLHttpRequest = WrappedXHR;

  // ── DOM observer ──────────────────────────────────────────────────────────
  function looksLikePopup(el) {
    if (!el || el.nodeType !== 1) return false;
    var cls = String(el.className || '');
    var role = (el.getAttribute && el.getAttribute('role')) || '';
    if (/q-menu|q-dialog|q-popup|m-menu|m-popover|m-dropdown|autocomplete|suggestion|slash/i.test(cls))
      return true;
    if (/menu|listbox|dialog|tooltip/i.test(role)) return true;
    try {
      var st = window.getComputedStyle(el);
      if (!st) return false;
      var pos = st.position;
      if ((pos === 'absolute' || pos === 'fixed') && el.querySelectorAll) {
        var items = el.querySelectorAll('li, [role="option"], [role="menuitem"], button, a, .q-item, .m-item');
        if (items.length >= 2 && el.getBoundingClientRect().height > 24) return true;
      }
    } catch (e) {}
    return false;
  }

  function structureSnapshot(el) {
    function walk(node, depth) {
      if (!node || depth > 8) return null;
      if (node.nodeType === 3) {
        var t = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        return t ? { text: t.slice(0, 200) } : null;
      }
      if (node.nodeType !== 1) return null;
      var tag = node.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style') return null;
      var kids = [];
      var ch = node.childNodes;
      for (var i = 0; i < Math.min(ch.length, 40); i++) {
        var c = walk(ch[i], depth + 1);
        if (c) kids.push(c);
      }
      var item = {
        tag: tag,
        cls: String(node.className || '').slice(0, 120),
        role: node.getAttribute && node.getAttribute('role'),
      };
      if (kids.length) item.children = kids;
      var own = '';
      for (var j = 0; j < node.childNodes.length; j++) {
        if (node.childNodes[j].nodeType === 3) own += node.childNodes[j].textContent;
      }
      own = own.replace(/\s+/g, ' ').trim();
      if (own) item.text = own.slice(0, 240);
      return item;
    }
    var html = '';
    try {
      html = el.innerHTML || '';
    } catch (e) {}
    var htmlCap = truncateText(html, HTML_KEEP_CAP);
    return {
      tag: el.tagName,
      className: String(el.className || '').slice(0, 200),
      role: el.getAttribute && el.getAttribute('role'),
      textContent: String(el.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000),
      structure: walk(el, 0),
      innerHTML: htmlCap,
    };
  }

  var seenPopups = new WeakSet();
  var observer = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      var nodes = [];
      if (m.addedNodes) {
        for (var j = 0; j < m.addedNodes.length; j++) nodes.push(m.addedNodes[j]);
      }
      if (m.type === 'attributes' && m.target) nodes.push(m.target);
      for (var k = 0; k < nodes.length; k++) {
        var n = nodes[k];
        if (!n || n.nodeType !== 1) continue;
        var candidates = [n];
        try {
          if (n.querySelectorAll) {
            var extra = n.querySelectorAll(
              '.q-menu, .q-dialog, .q-popup-proxy, [role="menu"], [role="listbox"], [class*="m-menu"], [class*="popover"]'
            );
            for (var x = 0; x < extra.length; x++) candidates.push(extra[x]);
          }
        } catch (e) {}
        for (var c = 0; c < candidates.length; c++) {
          var el = candidates[c];
          if (!looksLikePopup(el) || seenPopups.has(el)) continue;
          seenPopups.add(el);
          push({
            kind: 'dom',
            surface: currentTag,
            popup: structureSnapshot(el),
          });
          console.log('[tplcap] popup logged under tag=' + currentTag, el);
        }
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'aria-hidden', 'role'],
  });

  // ── Public API ────────────────────────────────────────────────────────────
  function tagCapture(label) {
    var allowed = {
      'template-list': 1,
      'document-template-list': 1,
      'communication-submenu': 1,
      untagged: 1,
    };
    var next = String(label || 'untagged');
    if (!allowed[next]) {
      console.warn('[tplcap] unknown tag "' + next + '" — use template-list | document-template-list | communication-submenu');
    }
    currentTag = next;
    push({ kind: 'mark', mark: 'tag', label: currentTag });
    console.log('[tplcap] tag →', currentTag);
    updateHudTag();
    return currentTag;
  }

  function buildDump() {
    return {
      format: 'medicus-native-template-capture',
      formatVersion: 1,
      purpose:
        'Discovery of Medicus-native template / document-template / communication list APIs and DOM for a visual organiser prototype',
      capturedAt: nowIso(),
      page: { href: location.href, title: document.title },
      redact: redact,
      bodyKeepCap: BODY_KEEP_CAP,
      entries: timeline.slice(),
    };
  }

  function dumpCapture() {
    var dump = buildDump();
    var json = JSON.stringify(dump, null, 2);
    console.log('[tplcap] DUMP (' + timeline.length + ' entries)');
    console.log(json);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).then(
          function () {
            console.log('[tplcap] copied to clipboard');
          },
          function (err) {
            console.warn('[tplcap] clipboard failed', err);
          }
        );
      } else {
        console.warn('[tplcap] clipboard API unavailable — copy from console log');
      }
    } catch (e) {
      console.warn('[tplcap] clipboard error', e);
    }
    return dump;
  }

  // ── HUD ───────────────────────────────────────────────────────────────────
  var hud = document.createElement('div');
  hud.id = 'ms-tplcap-hud';
  hud.setAttribute(
    'style',
    'position:fixed;top:12px;right:12px;z-index:2147483646;background:#111;color:#eee;font:12px/1.3 system-ui,sans-serif;padding:8px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:6px;min-width:160px;cursor:move;user-select:none;'
  );
  hud.innerHTML =
    '<div style="font-weight:600;margin-bottom:2px">tplcap <span id="ms-tplcap-tag" style="opacity:.8;font-weight:400"></span></div>' +
    '<button type="button" data-tag="template-list" style="cursor:pointer">Tag: Templates</button>' +
    '<button type="button" data-tag="document-template-list" style="cursor:pointer">Tag: Documents</button>' +
    '<button type="button" data-tag="communication-submenu" style="cursor:pointer">Tag: Comms</button>' +
    '<button type="button" data-dump="1" style="cursor:pointer;background:#2a6;color:#fff;border:0;padding:4px 6px;border-radius:4px">Dump</button>';

  function updateHudTag() {
    var el = hud.querySelector('#ms-tplcap-tag');
    if (el) el.textContent = '(' + currentTag + ')';
  }

  hud.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var tag = t.getAttribute('data-tag');
    if (tag) {
      ev.preventDefault();
      ev.stopPropagation();
      tagCapture(tag);
      return;
    }
    if (t.getAttribute('data-dump')) {
      ev.preventDefault();
      ev.stopPropagation();
      dumpCapture();
    }
  });

  // drag
  (function () {
    var ox = 0;
    var oy = 0;
    var dragging = false;
    hud.addEventListener('mousedown', function (e) {
      if (e.target && e.target.tagName === 'BUTTON') return;
      dragging = true;
      ox = e.clientX - hud.getBoundingClientRect().left;
      oy = e.clientY - hud.getBoundingClientRect().top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      hud.style.left = e.clientX - ox + 'px';
      hud.style.top = e.clientY - oy + 'px';
      hud.style.right = 'auto';
    });
    window.addEventListener('mouseup', function () {
      dragging = false;
    });
  })();

  document.documentElement.appendChild(hud);
  updateHudTag();

  function stop() {
    try {
      observer.disconnect();
    } catch (e) {}
    window.fetch = _fetch;
    window.XMLHttpRequest = _XHR;
    if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    window.__tplCap.__armed = false;
    console.log('[tplcap] stopped');
  }

  window.__tagCapture = tagCapture;
  window.__dumpCapture = dumpCapture;
  window.__tplCap = {
    __armed: true,
    tag: tagCapture,
    dump: dumpCapture,
    stop: stop,
    raw: function (on) {
      redact = !on;
      console.log('[tplcap] redact=', redact);
      return redact;
    },
    summary: function () {
      var net = timeline.filter(function (e) {
        return e.kind === 'network' && e.phase === 'response';
      });
      var paths = {};
      net.forEach(function (e) {
        var key = e.method + ' ' + e.url;
        paths[key] = (paths[key] || 0) + 1;
      });
      console.table(
        Object.keys(paths).map(function (k) {
          return { call: k, n: paths[k] };
        })
      );
      return paths;
    },
  };

  console.log('[tplcap] armed — tag surfaces, exercise slash / Comms, then Dump');
})();
