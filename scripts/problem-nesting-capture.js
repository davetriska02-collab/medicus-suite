// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Problem parent/child ("nesting") contract capture
//
// PURPOSE
//   Medicus models problem nesting — GET /clinical/data/problem/end-problem/{id}
//   returns activeChildProblems[] (the confirmed contract problem-bulk-end.js
//   already relies on) — but the repo has ZERO captures of how a parent/child
//   link is CREATED or CHANGED. The confirmed edit-problem POST carries no
//   parent field (contextId/contextType/episode only ever observed null), so
//   the write path must live somewhere uncaptured. This script exists to
//   capture it, so a "nest related problems?" widget can later be built on a
//   confirmed contract instead of guesswork.
//
//   Two halves:
//     1. PASSIVE recorder (adapted from scripts/booking-flow-capture.js —
//        same fetch/XHR wrap, redaction, dialog inventory): arm it, then
//        perform ONE manual nest/link in Medicus's own UI. Whatever endpoint
//        and payload that click produces is the capture we need.
//     2. ACTIVE read probe (chNest.probe()): enumerates the active problems on
//        the current record and fetches each one's end-problem form,
//        slideover overview, and edit-problem prefill, then reports every
//        field whose key smells of hierarchy (child/parent/link/episode/
//        context/nest) plus the record's existing parent→child map — so we
//        can see where an EXISTING link is readable before/after the write.
//
//   Works on BOTH page shapes the tidy widgets now support (v3.213.0): the
//   full care-record page (patientId in the URL) and the task-overview
//   "split" page (patient resolved via the task's own overview endpoint).
//
//   Observation only. It wraps fetch / XMLHttpRequest to READ requests and
//   responses (the same MAIN-world technique as page-world.js — Medicus is
//   axios=XHR under a strict CSP). It NEVER blocks, rewrites, replays or
//   sends anything; nothing leaves the browser except when YOU call
//   .copy()/.save() locally. The probe's own GETs are the same read-only
//   endpoints the shipped widgets already call.
//
// PATIENT DATA
//   USE A TEST PATIENT. Request/response bodies are run through the same
//   key-based redactor as booking-flow-capture.js (masks names, DOB, NHS
//   number, address, postcode, phone, email; value-detects NHS-number/
//   postcode shapes) while keeping ids/UUIDs and structure. Problem
//   DESCRIPTIONS are deliberately KEPT (they are the structure being studied
//   — you can't map a hierarchy without knowing which problem is which), so
//   the output is still clinical data: keep it local, never commit it (the
//   patient-data CI guard would reject it anyway). chNest.raw(true) disables
//   redaction entirely — test patient only.
//
// USAGE
//   1. Open the record in Medicus — either the care-record Clinical Summary
//      or a task ("split") page — for a TEST patient. DevTools → Console
//      (the page's own console, not the extension's).
//   2. Paste this whole file, press Enter → "[nestcap] armed".
//   3. chNest.probe()        ← baseline read-side snapshot (before state).
//   4. chNest.mark('nesting now')  then perform ONE parent/child link in
//      Medicus's own UI (slideover / add-problem / wherever it lives).
//   5. chNest.probe()        ← after state (shows the new link's read shape).
//   6. chNest.summary()      → deduped endpoint list (writes flagged ★).
//      chNest.save()         → download the full timeline as .json — send
//                              this file to Claude.
//      chNest.stop()         → unwrap everything and disarm.
//
// TUNING
//   chNest.all()            capture EVERY request (default: problem-ish URLs
//                           + all writes; telemetry/sentry is dropped).
//   chNest.filter(reOrFn)   custom URL filter (RegExp or (url,method)=>bool).
//   chNest.raw(true|false)  toggle body redaction.

(function () {
  'use strict';
  if (window.chNest && window.chNest.__armed) {
    console.warn('[nestcap] already armed — call chNest.stop() first to re-arm');
    return;
  }

  // ── config ────────────────────────────────────────────────────────────────
  var BODY_PARSE_CAP = 200000; // don't even try to parse bodies bigger than this
  var BODY_KEEP_CAP = 20000; // cap serialised body kept per entry (in dump)
  var captureAll = false;
  var redact = true;
  // Default interest: problem/summary-ish paths, OR any write (POST/PUT/
  // PATCH/DELETE) — the nest/link *submit* is the call we must not miss,
  // wherever it lands. Hierarchy-smelling words included in case the endpoint
  // is named for the relationship rather than the entity.
  var INTEREST_RE =
    /(problem|clinical-summary|slideover|episode|context|hierarch|nest|\blink\b|parent|child|component|permission|drawer|get-?ui|\/ui\/)/i;
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

  // ── redaction (same posture as booking-flow-capture.js) ─────────────────────
  // Mask VALUES whose KEY names a patient identifier; preserve type+length so
  // the payload shape stays legible. Problem descriptions are intentionally
  // KEPT (see PATIENT DATA above). Use a TEST patient regardless.
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
      this.__nc = { method: (method || 'GET').toUpperCase(), url: url, headers: [] };
    } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__nc) this.__nc.headers.push([name, value]);
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      var xhr = this;
      var nc = xhr.__nc;
      if (nc && interesting(nc.url, nc.method)) {
        var started = Date.now();
        var entry = push({
          kind: 'net',
          via: 'xhr',
          method: nc.method,
          url: safeUrl(nc.url),
          reqHeaders: safeHeaders(nc.headers),
          reqBody: parseBody(body),
          status: null,
          ms: null,
          resBody: undefined,
        });
        xhr.addEventListener('loadend', function () {
          entry.status = xhr.status;
          entry.ms = Date.now() - started;
          // Only 'content-type' is read: it is CORS-safelisted. Non-safelisted
          // headers log an uncatchable "Refused to get unsafe header" warning
          // on cross-origin XHR — never read them here (booking-flow lesson).
          var ct = '';
          try {
            ct = xhr.getResponseHeader('content-type') || '';
          } catch (_) {}
          if (ct) entry.resType = ct;
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

  // ── navigation wrap (the link flow might be a route, not a modal) ────────────
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
  // Record control NAMES/labels/types, never input values — a "link problem"
  // dialog's field inventory is contract evidence in its own right.
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

  // ── active read probe ────────────────────────────────────────────────────────
  // Same page-shape handling as the shipped tidy widgets (v3.213.0): patientId
  // from the care-record URL, or resolved via the task's own overview endpoint
  // on the split page. All read-only GETs the widgets already make.

  var CARE_RECORD_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;
  var TASK_OVERVIEW_RE =
    /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  var HIER_KEY_RE = /child|parent|link|episode|context|hierarch|nest/i;

  function apiBase() {
    var parts = location.pathname.split('/').filter(Boolean);
    return 'https://' + (parts[0] || '') + '.api.' + location.hostname;
  }
  function apiGet(path) {
    // Deliberately the ORIGINAL fetch (not our wrap) so probe traffic doesn't
    // clutter the timeline — probe results are pushed as their own entry.
    return origFetch(apiBase() + path, {
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*' },
    }).then(function (r) {
      if (!r.ok) throw new Error('API ' + r.status + ' for ' + path);
      return r.json();
    });
  }

  async function resolvePatient() {
    var m = location.pathname.match(CARE_RECORD_RE);
    if (m) return { patientId: m[2], via: 'care-record-url' };
    m = location.pathname.match(TASK_OVERVIEW_RE);
    if (!m) return null;
    var data = await apiGet('/tasks/data/' + m[2] + '/overview/' + m[3]);
    var d = (data && data.data) || data || {};
    var pid = (d.patient && d.patient.id) || d.patientId || null;
    return pid ? { patientId: String(pid), via: 'task-overview' } : null;
  }

  // Walk an object recording every key path whose key smells of hierarchy,
  // with its (redacted) value — the "where is the link readable?" evidence.
  function scanHierarchyKeys(obj, pathPrefix, out, depth) {
    depth = depth || 0;
    if (obj == null || typeof obj !== 'object' || depth > 6) return;
    var keys = Array.isArray(obj)
      ? obj.map(function (_, i) {
          return i;
        })
      : Object.keys(obj);
    keys.forEach(function (k) {
      var p = pathPrefix ? pathPrefix + '.' + k : String(k);
      if (typeof k === 'string' && HIER_KEY_RE.test(k)) {
        out[p] = deepRedact(obj[k], 0);
      }
      scanHierarchyKeys(obj[k], p, out, depth + 1);
    });
  }

  async function probe() {
    var ctx = await resolvePatient().catch(function (e) {
      console.warn('[nestcap] patient resolution failed: ' + e.message);
      return null;
    });
    if (!ctx) {
      console.warn('[nestcap] no patient context — open a care record or a task overview page first.');
      return null;
    }
    console.log('[nestcap] probing patient (via ' + ctx.via + ')…');
    var summary = await apiGet('/clinical/data/clinical-summary/summary/' + ctx.patientId);
    var problems = (summary && summary.problems) || [];
    var report = {
      via: ctx.via,
      problemCount: problems.length,
      // Every hierarchy-smelling key in the summary itself (does the list nest?)
      summaryHierarchyKeys: {},
      // Per problem: description + hierarchy-smelling keys from each of the
      // three read endpoints, kept separate so we know WHICH endpoint exposes
      // the link.
      problems: [],
      // Existing parent → children map, inverted from activeChildProblems.
      parentChild: [],
    };
    scanHierarchyKeys(summary, 'summary', report.summaryHierarchyKeys, 0);
    for (var i = 0; i < problems.length; i++) {
      var p = problems[i];
      var row = { id: p.id, description: p.problemCodeDescription, hierarchyKeys: {} };
      var endForm = await apiGet('/clinical/data/problem/end-problem/' + p.id).catch(function () {
        return null;
      });
      var overview = await apiGet('/clinical/data/problem/slideover/overview/' + p.id).catch(function () {
        return null;
      });
      var prefill = await apiGet('/clinical/data/problem/edit-problem/' + p.id).catch(function () {
        return null;
      });
      scanHierarchyKeys(endForm, 'endForm', row.hierarchyKeys, 0);
      scanHierarchyKeys(overview, 'overview', row.hierarchyKeys, 0);
      scanHierarchyKeys(prefill, 'editPrefill', row.hierarchyKeys, 0);
      var children = (endForm && endForm.activeChildProblems) || [];
      if (children.length) {
        report.parentChild.push({
          parentId: p.id,
          parentDescription: p.problemCodeDescription,
          children: deepRedact(children, 0),
        });
      }
      report.problems.push(row);
    }
    push({ kind: 'probe', report: report });
    console.log(
      '[nestcap] probe done: ' +
        problems.length +
        ' problems, ' +
        report.parentChild.length +
        ' with existing children.'
    );
    if (report.parentChild.length)
      console.table(
        report.parentChild.map(function (pc) {
          return { parent: pc.parentDescription, children: pc.children.length };
        })
      );
    console.log('[nestcap] full report is in the timeline — chNest.save() includes it. Returned for inspection:');
    return report;
  }

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

  window.chNest = {
    __armed: true,
    probe: probe,
    mark: function (text) {
      push({ kind: 'mark', text: cap(text, 140) });
      console.log('%c[nestcap] mark: ' + text, 'color:#a72');
    },
    all: function () {
      captureAll = true;
      console.log('[nestcap] now capturing ALL requests (telemetry still dropped). Re-run your flow.');
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
      console.log('[nestcap] filter updated. Re-run your flow.');
    },
    raw: function (on) {
      redact = !on; // raw(true) → redaction OFF
      console.warn('[nestcap] body redaction ' + (redact ? 'ON' : 'OFF — TEST PATIENT ONLY'));
    },
    // Deduped endpoint list — writes flagged, since the link-submit is the prize.
    summary: function () {
      var seen = {};
      var rows = [];
      timeline.forEach(function (e) {
        if (e.kind !== 'net') return;
        var write = /^(POST|PUT|PATCH|DELETE)$/.test(e.method);
        var key = (write ? '★ ' : '') + e.method + ' ' + e.url.split('?')[0];
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
          console.log('[nestcap] copied ' + timeline.length + ' timeline entries to clipboard');
        });
      }
      return json;
    },
    save: function () {
      var json = JSON.stringify(clampResBodies(timeline), null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'problem-nesting-capture-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
      console.log('[nestcap] saved ' + timeline.length + ' entries → ' + a.download);
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
        '[nestcap] disarmed. ' + timeline.length + ' entries — chNest.dump()/.summary()/.copy()/.save() still work.'
      );
    },
  };

  console.log(
    '%c[nestcap] armed — capturing problem/link network + dialogs + route changes.\n' +
      'USE A TEST PATIENT. Suggested flow:\n' +
      '  1. chNest.probe()                 ← before-state read snapshot\n' +
      '  2. chNest.mark("nesting now") then link ONE problem to a parent in Medicus\'s own UI\n' +
      '  3. chNest.probe()                 ← after-state (where the new link is readable)\n' +
      '  4. chNest.summary() → ★ rows are the writes · chNest.save() → send the .json to Claude\n' +
      'chNest.all() = capture everything · chNest.raw(true) = unredacted bodies · chNest.stop() = unwrap.',
    'color:#2a7;font-weight:bold'
  );
})();
