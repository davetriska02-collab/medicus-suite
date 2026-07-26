// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Document-create network+DOM capture (developer instrumentation)
//
// PURPOSE
//   Phase 0 discovery for the "save a triage-task attachment as a document"
//   feature (see docs/learnings-triage-attachment-to-document.md once written).
//   No endpoint anywhere in this repo has ever CREATED a new Medicus document —
//   only edit-existing (clinical/document/edit-details) and remove-existing
//   (clinical/document/mark-incorrect-and-hidden) are confirmed
//   (engine/record-duplicate-parser.js). This tool answers: what does Medicus
//   actually do when a clinician uses its own "Add document" upload feature? —
//   which endpoint(s) fire, in what order, is the file sent as one multipart
//   POST alongside the metadata or as a separate upload step, what fields are
//   required, and what comes back (new document id).
//
//   Observation only. It wraps fetch / XMLHttpRequest to READ requests and
//   responses (the same MAIN-world technique as content-scripts/triage-lens/
//   page-world.js and scripts/booking-flow-capture.js — Medicus is axios=XHR
//   under a strict CSP). It NEVER blocks, rewrites, replays or sends anything;
//   nothing leaves the browser except when YOU call .copy()/.save() locally.
//
// PATIENT DATA
//   USE A TEST PATIENT AND A THROWAWAY TEST FILE (a blank/dummy PDF or JPEG —
//   the shape of the request is what matters, not the content). By default
//   request/response bodies are run through a key-based redactor that masks
//   patient identifiers (names, DOB, NHS number, address, postcode, phone,
//   email …) and value-detects NHS numbers / UK postcodes anywhere, while
//   KEEPING the document-relevant structure (title/code/date/ids). File/Blob
//   parts are NEVER read for content — only name, mime type and size are ever
//   recorded, redacted or not. Call chDocCap.raw(true) to disable text-body
//   redaction when you are certain you are on a test patient.
//
// USAGE
//   1. DevTools → Console on the Medicus page, TEST patient's record (or the
//      test triage task, if the manual flow starts from there).
//   2. Paste this whole file, press Enter → "[doccap] armed".
//   3. chDocCap.mark('about to open Add document')   ← optional timeline markers
//   4. Use Medicus's own "Add document" feature to file your test file against
//      the test patient, exactly as a clinician would today.
//   5. chDocCap.summary()  → deduped endpoint list (method + path) — the thing
//                            you need first to confirm the create contract.
//      chDocCap.dump()     → full ordered timeline (network + DOM + marks),
//                            with FormData/file parts expanded (name/type/size
//                            only — never file bytes).
//      chDocCap.copy()     → timeline JSON to clipboard.
//      chDocCap.save()     → download timeline as a .json file.
//      chDocCap.stop()     → unwrap everything and disarm.
//
// TUNING
//   chDocCap.all()            capture EVERY request (default: document/upload-
//                              ish URLs + all writes; telemetry/sentry dropped).
//   chDocCap.filter(reOrFn)   custom URL filter (RegExp or (url,method)=>bool).
//   chDocCap.raw(true|false)  toggle text-body redaction (file parts are always
//                              metadata-only regardless of this flag).

(function () {
  'use strict';
  if (window.chDocCap && window.chDocCap.__armed) {
    console.warn('[doccap] already armed — call chDocCap.stop() first to re-arm');
    return;
  }

  // ── config ────────────────────────────────────────────────────────────────
  var BODY_PARSE_CAP = 200000; // don't even try to parse string bodies bigger than this
  var BODY_KEEP_CAP = 20000; // cap serialised body kept per entry (in dump)
  var captureAll = false;
  var redact = true;
  // Default interest: document/upload/filing-ish paths, OR any write
  // (POST/PUT/PATCH/DELETE) — the create call is the one we must not miss,
  // wherever it lands and however it's named. Deliberately narrower than
  // booking-flow-capture's scheduling regex to avoid matching every
  // "patient/data/..." read on a busy record page.
  var INTEREST_RE = /(document|attach|upload|scan|dms\b|clinical[-_]?file|patient[-_]?file|filing)/i;
  // Always-ignore noise (host-app telemetry — see CLAUDE.md "host-app noise is not us").
  var IGNORE_RE =
    /(sentry\.io|\/telemetry|\/analytics|google-analytics|googletagmanager|hotjar|fullstory|datadog|newrelic|\.png|\.jpg|\.svg|\.css|\.woff)/i;

  var timeline = [];
  var seq = 0;
  var t0 = Date.now();

  function now() {
    return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  }
  function rel() {
    return Date.now() - t0; // ms since arm
  }
  function push(entry) {
    entry.seq = ++seq;
    entry.t = now();
    entry.atMs = rel();
    timeline.push(entry);
    return entry;
  }

  function interesting(url, method) {
    if (IGNORE_RE.test(url)) return false;
    if (captureAll) return true;
    if (INTEREST_RE.test(url)) return true;
    return /^(post|put|patch|delete)$/i.test(method || 'GET');
  }

  // ── redaction ───────────────────────────────────────────────────────────────
  // Mask VALUES whose KEY names a patient identifier; preserve type+length so the
  // payload shape stays legible. Use a TEST patient regardless.
  var PII_KEYS = {};
  (
    'firstname lastname surname forename forenames middlename givenname familyname maidenname ' +
    'fullname preferredname patientname knownas dateofbirth dob birthdate ' +
    'nhsnumber nhsno nhs address addressline1 addressline2 addressline3 town city county ' +
    'postcode postalcode phone phonenumber mobile mobilenumber telephone homephone workphone ' +
    'email emailaddress gender sex ethnicity'
  )
    .split(' ')
    .forEach(function (k) {
      PII_KEYS[k] = 1;
    });
  var NHS_RE = /\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/; // NHS number shape
  var POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?[ ]?\d[A-Z]{2}\b/i; // UK postcode shape

  function normKey(k) {
    return String(k)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }
  function placeholder(v) {
    if (typeof v === 'string') return '«str:' + v.length + '»';
    if (typeof v === 'number') return '«num»';
    if (typeof v === 'boolean') return '«bool»';
    return '«redacted»';
  }
  function redactValueString(s) {
    if (typeof s !== 'string') return s;
    if (NHS_RE.test(s) || POSTCODE_RE.test(s)) return '«id-like:' + s.length + '»';
    return s;
  }
  function deepRedact(v, depth) {
    if (!redact) return v;
    depth = depth || 0;
    if (depth > 8) return '«deep»';
    if (v === null || typeof v !== 'object') return redactValueString(v);
    if (Array.isArray(v))
      return v.map(function (x) {
        return deepRedact(x, depth + 1);
      });
    var out = {};
    for (var k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      out[k] = PII_KEYS[normKey(k)] ? placeholder(v[k]) : deepRedact(v[k], depth + 1);
    }
    return out;
  }

  // Parse a body string as JSON if possible; else return a (capped) string.
  function parseTextBody(text) {
    if (text == null || text === '') return undefined;
    if (text.length > BODY_PARSE_CAP) return text.slice(0, 2000) + '… «truncated ' + text.length + ' chars»';
    try {
      return deepRedact(JSON.parse(text), 0);
    } catch (_) {
      // not JSON — could be form-encoded; redact param values by key
      if (/=/.test(text) && /&|^[^=]+=/.test(text)) {
        return text
          .split('&')
          .map(function (pair) {
            var i = pair.indexOf('=');
            if (i < 0) return pair;
            var k = pair.slice(0, i);
            var val = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
            return k + '=' + (redact && PII_KEYS[normKey(k)] ? placeholder(val) : redactValueString(val));
          })
          .join('&');
      }
      return text.length > 500 ? text.slice(0, 500) + '…' : text;
    }
  }

  // The one capability this tool adds beyond scripts/booking-flow-capture.js:
  // proper FormData/File inspection. A create-document call may send the file
  // bytes and the metadata (title/code/date/…) as ONE multipart POST, or as a
  // separate step — this is exactly the thing Phase 0 needs to see. File/Blob
  // parts are recorded as {kind:'file', fieldName, filename, mimeType, size}
  // — content is never read, redacted or not. Plain-string parts go through the
  // same key-based redaction as JSON bodies.
  function describeBody(body) {
    if (body == null) return undefined;
    if (typeof body === 'string') return parseTextBody(body);
    try {
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        var parts = [];
        body.forEach(function (value, fieldName) {
          if (typeof File !== 'undefined' && value instanceof File) {
            parts.push({
              kind: 'file',
              fieldName: fieldName,
              filename: value.name,
              mimeType: value.type,
              size: value.size,
            });
          } else if (typeof Blob !== 'undefined' && value instanceof Blob) {
            parts.push({
              kind: 'file',
              fieldName: fieldName,
              filename: '(blob, no name)',
              mimeType: value.type,
              size: value.size,
            });
          } else {
            var v = String(value);
            parts.push({
              kind: 'field',
              fieldName: fieldName,
              value: redact && PII_KEYS[normKey(fieldName)] ? placeholder(v) : redactValueString(v),
            });
          }
        });
        return { __type: 'FormData', parts: parts };
      }
      if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return { __type: 'Blob', mimeType: body.type, size: body.size };
      }
      if (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
        return { __type: 'ArrayBuffer', byteLength: body.byteLength };
      }
    } catch (e) {
      return '«body-inspect-error:' + String(e) + '»';
    }
    try {
      return '«' + (body.constructor && body.constructor.name ? body.constructor.name : typeof body) + '»';
    } catch (_) {
      return '«non-string-body»';
    }
  }

  // Redact query-string values by key; keep the path intact.
  function safeUrl(url) {
    try {
      var u = new URL(url, location.origin);
      if (redact && u.search) {
        u.searchParams.forEach(function (val, key) {
          if (PII_KEYS[normKey(key)] || NHS_RE.test(val) || POSTCODE_RE.test(val)) {
            u.searchParams.set(key, placeholder(val));
          }
        });
      }
      return u.pathname + (u.search || '');
    } catch (_) {
      return String(url);
    }
  }

  // Request headers: record names always; mask values of auth/token/cookie
  // headers (presence matters for replication, the secret does not).
  var SECRET_HDR_RE = /(authorization|cookie|xsrf|csrf|token|api[-_]?key|secret)/i;
  function safeHeaders(pairs) {
    var out = {};
    (pairs || []).forEach(function (p) {
      var name = p[0],
        val = p[1];
      out[name] = SECRET_HDR_RE.test(name) ? '«present:' + String(val).length + '»' : String(val);
    });
    return out;
  }
  function headersToPairs(h) {
    var pairs = [];
    if (!h) return pairs;
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        h.forEach(function (v, k) {
          pairs.push([k, v]);
        });
      } else if (Array.isArray(h)) {
        h.forEach(function (p) {
          pairs.push([p[0], p[1]]);
        });
      } else if (typeof h === 'object') {
        for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) pairs.push([k, h[k]]);
      }
    } catch (_) {}
    return pairs;
  }

  // ── fetch wrap ───────────────────────────────────────────────────────────────
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var method = (init && init.method) || (input && input.method) || 'GET';
      var watch = interesting(url, method);
      var started = Date.now();
      var entry = null;
      if (watch) {
        entry = push({
          kind: 'net',
          via: 'fetch',
          method: method.toUpperCase(),
          url: safeUrl(url),
          reqHeaders: safeHeaders(headersToPairs(init && init.headers)),
          reqBody: describeBody(init && init.body),
          status: null,
          ms: null,
          resBody: undefined,
        });
      }
      var p = origFetch.apply(this, arguments);
      if (watch && entry) {
        p.then(
          function (resp) {
            entry.status = resp.status;
            entry.ms = Date.now() - started;
            var ct = resp.headers && resp.headers.get && resp.headers.get('content-type');
            if (ct) entry.resType = ct;
            try {
              resp
                .clone()
                .text()
                .then(function (txt) {
                  entry.resBody = parseTextBody(txt);
                })
                .catch(function () {});
            } catch (_) {}
          },
          function (err) {
            entry.status = 'ERROR';
            entry.ms = Date.now() - started;
            entry.error = String(err && err.message ? err.message : err);
          }
        );
      }
      return p;
    };
  }

  // ── XHR wrap (axios — what Medicus actually uses; also covers upload-progress
  //    flows that fetch can't express) ──────────────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__dc = { method: (method || 'GET').toUpperCase(), url: url, headers: [] };
    } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__dc) this.__dc.headers.push([name, value]);
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      var xhr = this;
      var dc = xhr.__dc;
      if (dc && interesting(dc.url, dc.method)) {
        var started = Date.now();
        var entry = push({
          kind: 'net',
          via: 'xhr',
          method: dc.method,
          url: safeUrl(dc.url),
          reqHeaders: safeHeaders(dc.headers),
          reqBody: describeBody(body),
          status: null,
          ms: null,
          resBody: undefined,
        });
        xhr.addEventListener('loadend', function () {
          entry.status = xhr.status;
          entry.ms = Date.now() - started;
          // Only 'content-type' is read: it is CORS-safelisted. Other response
          // headers throw an uncatchable "Refused to get unsafe header" console
          // warning on cross-origin XHR, so nothing else is read here.
          var ct = '';
          try {
            ct = xhr.getResponseHeader('content-type') || '';
          } catch (_) {}
          if (ct) entry.resType = ct;
          try {
            entry.resBody = parseTextBody(
              xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : undefined
            );
          } catch (_) {}
        });
        // Upload progress — if the create call IS the file upload itself (not a
        // separate step), this shows real payload size going over the wire,
        // which corroborates/contradicts what describeBody() found in the body.
        if (xhr.upload) {
          xhr.upload.addEventListener('progress', function (ev) {
            if (ev.lengthComputable) entry.uploadBytes = ev.total;
          });
        }
      }
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  // ── DOM wrap (what modal/drawer the flow opens — the document-type picklist,
  //    title/date fields, file input — PII-safe: control names/labels only,
  //    never field values) ───────────────────────────────────────────────────
  function cap(s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    return s.length > (n || 60) ? s.slice(0, n || 60) + '…' : s;
  }
  function labelOfField(el) {
    var aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return cap(aria, 40);
    if (el.id) {
      var lab = document.querySelector('label[for="' + (window.CSS ? CSS.escape(el.id) : el.id) + '"]');
      if (lab) return cap(lab.textContent, 40);
    }
    var ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) return cap(ph, 40);
    var name = el.getAttribute && el.getAttribute('name');
    if (name) return cap(name, 40);
    return cap(el.tagName ? el.tagName.toLowerCase() : '?', 20);
  }
  function inventoryDialog(root) {
    var fields = [];
    root
      .querySelectorAll('input, select, textarea, [role="combobox"], [role="listbox"], button')
      .forEach(function (el) {
        var tag = el.tagName.toLowerCase();
        var type = el.getAttribute('type') || el.getAttribute('role') || tag;
        var item = { tag: tag, type: type, label: labelOfField(el) };
        var name = el.getAttribute && el.getAttribute('name');
        if (name) item.name = cap(name, 40);
        if (tag === 'select') {
          item.options = [].slice.call(el.options || [], 0, 20).map(function (o) {
            return cap(o.textContent, 40);
          });
        }
        fields.push(item);
      });
    var heading = root.querySelector('h1,h2,h3,[role="heading"]');
    return {
      title: cap(root.getAttribute('aria-label') || (heading && heading.textContent) || root.className, 60),
      fieldCount: fields.length,
      fields: fields.slice(0, 60),
    };
  }
  var seenDialogs = new WeakSet();
  function scanDialogs() {
    document
      .querySelectorAll(
        '[role="dialog"], dialog[open], .modal.show, .modal[style*="display: block"], .drawer, [class*="drawer"], [class*="modal"]'
      )
      .forEach(function (el) {
        if (seenDialogs.has(el)) return;
        if (!(el.offsetParent !== null || el.open)) return; // visible only
        seenDialogs.add(el);
        push({ kind: 'dom', event: 'dialog-open', dialog: inventoryDialog(el) });
      });
  }
  var mo = new MutationObserver(function () {
    if (mo.__q) return;
    mo.__q = requestAnimationFrame(function () {
      mo.__q = 0;
      scanDialogs();
    });
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'style', 'class'],
  });
  scanDialogs(); // catch anything already open

  // ── public API ───────────────────────────────────────────────────────────────
  function clampResBodies(list) {
    return list.map(function (e) {
      if (e.kind !== 'net') return e;
      var copy = {};
      for (var k in e) copy[k] = e[k];
      if (copy.resBody !== undefined) {
        var s = JSON.stringify(copy.resBody);
        if (s && s.length > BODY_KEEP_CAP)
          copy.resBody = s.slice(0, BODY_KEEP_CAP) + '… «truncated ' + s.length + ' chars»';
      }
      return copy;
    });
  }

  window.chDocCap = {
    __armed: true,
    mark: function (text) {
      push({ kind: 'mark', text: cap(text, 140) });
      console.log('%c[doccap] mark: ' + text, 'color:#a72');
    },
    all: function () {
      captureAll = true;
      console.log('[doccap] now capturing ALL requests (telemetry still dropped). Re-run your flow.');
    },
    filter: function (reOrFn) {
      if (reOrFn instanceof RegExp) {
        INTEREST_RE = reOrFn;
        captureAll = false;
      } else if (typeof reOrFn === 'function') {
        interesting = function (url, method) {
          return !IGNORE_RE.test(url) && !!reOrFn(url, method);
        };
      }
      console.log('[doccap] filter updated. Re-run your flow.');
    },
    raw: function (on) {
      redact = !on; // raw(true) → text-body redaction OFF (file parts stay metadata-only regardless)
      console.warn('[doccap] text-body redaction ' + (redact ? 'ON' : 'OFF — TEST PATIENT ONLY'));
    },
    // Deduped endpoint list — the first thing you need to confirm the create contract.
    summary: function () {
      var seen = {};
      var rows = [];
      timeline.forEach(function (e) {
        if (e.kind !== 'net') return;
        var key = e.method + ' ' + e.url.split('?')[0];
        if (seen[key]) {
          seen[key].hits++;
          return;
        }
        var row = { call: key, hits: 1, lastStatus: e.status };
        seen[key] = row;
        rows.push(row);
      });
      console.table(rows);
      return rows;
    },
    dump: function () {
      var json = JSON.stringify(clampResBodies(timeline), null, 2);
      console.log(json);
      return json;
    },
    copy: function () {
      var json = JSON.stringify(clampResBodies(timeline), null, 2);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(json).then(function () {
          console.log('[doccap] copied ' + timeline.length + ' timeline entries to clipboard');
        });
      }
      return json;
    },
    save: function () {
      var json = JSON.stringify(clampResBodies(timeline), null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'document-create-capture-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
      console.log('[doccap] saved ' + timeline.length + ' entries → ' + a.download);
      return a.download;
    },
    stop: function () {
      try {
        if (origFetch) window.fetch = origFetch;
      } catch (_) {}
      try {
        XMLHttpRequest.prototype.open = origOpen;
        XMLHttpRequest.prototype.send = origSend;
        XMLHttpRequest.prototype.setRequestHeader = origSetHeader;
      } catch (_) {}
      try {
        mo.disconnect();
      } catch (_) {}
      this.__armed = false;
      console.log(
        '[doccap] disarmed. ' + timeline.length + ' entries — chDocCap.dump()/.summary()/.copy()/.save() still work.'
      );
    },
  };

  console.log(
    '%c[doccap] armed — capturing document/upload/filing network + modal DOM.\n' +
      'USE A TEST PATIENT AND A THROWAWAY TEST FILE. Use Medicus\'s own "Add document" feature, then\n' +
      'chDocCap.summary() / chDocCap.dump() / chDocCap.copy() / chDocCap.save().\n' +
      'chDocCap.all() = capture everything · chDocCap.raw(true) = unredacted text bodies (file parts always metadata-only) · chDocCap.stop() = unwrap.',
    'color:#2a7;font-weight:bold'
  );
})();
