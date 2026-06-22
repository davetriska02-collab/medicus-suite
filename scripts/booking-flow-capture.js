// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Booking-flow network+DOM capture (developer instrumentation)
//
// PURPOSE
//   The complement to scripts/ui-clickpath-recorder.js. That tool maps the
//   *click structure*; this one maps the *network + DOM* a flow produces, so the
//   flow can later be REPLICATED from the suite (credentialed fetch, exactly how
//   side-panel/modules/slots/slots.js already calls the scheduling API).
//
//   It exists to answer one question: "what does Medicus actually do when I click
//   Actions → Appointment?" — which endpoints fire, in what order, with what
//   request payloads/headers, what comes back, and what UI (modal/route) opens —
//   so we can embed booking into the Slots page.
//
//   Observation only. It wraps fetch / XMLHttpRequest to READ requests and
//   responses (the same MAIN-world technique as content-scripts/triage-lens/
//   page-world.js — Medicus is axios=XHR under a strict CSP). It NEVER blocks,
//   rewrites, replays or sends anything; nothing leaves the browser except when
//   YOU call .copy()/.save() locally.
//
// PATIENT DATA
//   USE A TEST PATIENT. By default request/response bodies are run through a
//   key-based redactor that masks patient identifiers (names, DOB, NHS number,
//   address, postcode, phone, email …) and value-detects NHS numbers / UK
//   postcodes anywhere, while KEEPING the booking-relevant structure (slot /
//   appointment-type / clinician / duration / date ids and UUIDs). Form-field
//   *values* in the DOM are never read — only field names/labels/types — exactly
//   like the clickpath recorder. Call chBook.raw(true) to disable body redaction
//   when you are certain you are on a test patient.
//
// USAGE
//   1. DevTools → Console on the Medicus appointment-book page (TEST patient).
//   2. Paste this whole file, press Enter → "[bookcap] armed".
//   3. chBook.mark('about to click Appointment')   ← optional timeline markers
//   4. Click Actions → Appointment and complete a booking on the test patient.
//   5. chBook.summary()  → deduped endpoint list (method + path) — the thing you
//                          need first for embedding.
//      chBook.dump()     → full ordered timeline (network + DOM + nav + marks).
//      chBook.copy()     → timeline JSON to clipboard.
//      chBook.save()     → download timeline as a .json file.
//      chBook.stop()     → unwrap everything and disarm.
//
// TUNING
//   chBook.all()            capture EVERY request (default: scheduling-ish URLs
//                           + all writes; telemetry/sentry is dropped).
//   chBook.filter(reOrFn)   custom URL filter (RegExp or (url,method)=>bool).
//   chBook.raw(true|false)  toggle body redaction.

(function () {
  'use strict';
  if (window.chBook && window.chBook.__armed) {
    console.warn('[bookcap] already armed — call chBook.stop() first to re-arm');
    return;
  }

  // ── config ────────────────────────────────────────────────────────────────
  var BODY_PARSE_CAP = 200000; // don't even try to parse bodies bigger than this
  var BODY_KEEP_CAP = 20000; // cap serialised body kept per entry (in dump)
  var captureAll = false;
  var redact = true;
  // Default interest: scheduling-ish paths, OR any write (POST/PUT/PATCH/DELETE)
  // — the booking *submit* is the call we must not miss, wherever it lands.
  var INTEREST_RE = /(schedul|appointment|appt|\/slot|diary|booking|\bbook\b|availab|clinician|session|calendar)/i;
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
  // payload shape stays legible. Bare "name" is intentionally kept (appointment-
  // type / staff names are structural and wanted) — the explicit PII keys plus the
  // value-detectors below carry the safety load. Use a TEST patient regardless.
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
  function parseBody(text) {
    if (text == null || text === '') return undefined;
    if (typeof text !== 'string') {
      // FormData / Blob / ArrayBuffer etc. — record the type, not the content.
      try {
        return '«' + (text.constructor && text.constructor.name ? text.constructor.name : typeof text) + '»';
      } catch (_) {
        return '«non-string-body»';
      }
    }
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
          reqBody: parseBody(init && init.body),
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
                  entry.resBody = parseBody(txt);
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

  // ── XHR wrap (axios — what Medicus actually uses) ────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__bc = { method: (method || 'GET').toUpperCase(), url: url, headers: [] };
    } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__bc) this.__bc.headers.push([name, value]);
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      var xhr = this;
      var bc = xhr.__bc;
      if (bc && interesting(bc.url, bc.method)) {
        var started = Date.now();
        var entry = push({
          kind: 'net',
          via: 'xhr',
          method: bc.method,
          url: safeUrl(bc.url),
          reqHeaders: safeHeaders(bc.headers),
          reqBody: parseBody(body),
          status: null,
          ms: null,
          resBody: undefined,
        });
        xhr.addEventListener('loadend', function () {
          entry.status = xhr.status;
          entry.ms = Date.now() - started;
          var ct = '';
          try {
            ct = xhr.getResponseHeader('content-type') || '';
          } catch (_) {}
          if (ct) entry.resType = ct;
          var loc = '';
          try {
            loc = xhr.getResponseHeader('location') || '';
          } catch (_) {}
          if (loc) entry.resLocation = safeUrl(loc);
          try {
            entry.resBody = parseBody(
              xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : xhr.response
            );
          } catch (_) {}
        });
      }
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  // ── navigation wrap (booking might be a route, not a modal) ──────────────────
  var origPush = history.pushState;
  var origReplace = history.replaceState;
  function recordNav(kind, url) {
    push({ kind: 'nav', how: kind, url: safeUrl(url || location.href) });
  }
  history.pushState = function (s, t, url) {
    var r = origPush.apply(this, arguments);
    try {
      recordNav('pushState', url);
    } catch (_) {}
    return r;
  };
  history.replaceState = function (s, t, url) {
    var r = origReplace.apply(this, arguments);
    try {
      recordNav('replaceState', url);
    } catch (_) {}
    return r;
  };
  function onPop() {
    recordNav('popstate', location.href);
  }
  window.addEventListener('popstate', onPop);

  // ── DOM wrap (what modal/drawer the flow opens, PII-safe) ────────────────────
  // Reuses the clickpath recorder's posture: record control NAMES/labels/types,
  // never input values. Fires when a dialog/drawer/modal newly appears.
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
          item.options = [].slice.call(el.options || [], 0, 12).map(function (o) {
            return cap(o.textContent, 30);
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
    // debounce: scan on the next frame after a burst of mutations
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

  window.chBook = {
    __armed: true,
    mark: function (text) {
      push({ kind: 'mark', text: cap(text, 140) });
      console.log('%c[bookcap] mark: ' + text, 'color:#a72');
    },
    all: function () {
      captureAll = true;
      console.log('[bookcap] now capturing ALL requests (telemetry still dropped). Re-run your flow.');
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
      console.log('[bookcap] filter updated. Re-run your flow.');
    },
    raw: function (on) {
      redact = !on; // raw(true) → redaction OFF
      console.warn('[bookcap] body redaction ' + (redact ? 'ON' : 'OFF — TEST PATIENT ONLY'));
    },
    // Deduped endpoint list — the first thing you need for embedding.
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
          console.log('[bookcap] copied ' + timeline.length + ' timeline entries to clipboard');
        });
      }
      return json;
    },
    save: function () {
      var json = JSON.stringify(clampResBodies(timeline), null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'booking-flow-capture-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
      console.log('[bookcap] saved ' + timeline.length + ' entries → ' + a.download);
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
        history.pushState = origPush;
        history.replaceState = origReplace;
        window.removeEventListener('popstate', onPop);
      } catch (_) {}
      try {
        mo.disconnect();
      } catch (_) {}
      this.__armed = false;
      console.log(
        '[bookcap] disarmed. ' + timeline.length + ' entries — chBook.dump()/.summary()/.copy()/.save() still work.'
      );
    },
  };

  console.log(
    '%c[bookcap] armed — capturing scheduling/appointment network + booking modal + route changes.\n' +
      'USE A TEST PATIENT. Click Actions → Appointment, then chBook.summary() / chBook.dump() / chBook.copy() / chBook.save().\n' +
      'chBook.all() = capture everything · chBook.raw(true) = unredacted bodies · chBook.stop() = unwrap.',
    'color:#2a7;font-weight:bold'
  );
})();
