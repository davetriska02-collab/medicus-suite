// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "is anyone working on this request?" contract capture
//
// PURPOSE
//   Open question: when a clinician opens a triage/patient request, does
//   Medicus record or broadcast that ANYWHERE — a status, a lock, an
//   assignee, a presence event — such that a second person opening the same
//   request (or looking at the queue) could see "someone is on this"?
//
//   The repo cannot answer this. What it DOES know:
//     • task-list rows carry   id, patientName, summary, priority,
//       priorityDisplay, createdAt   (shared/request-monitor.js) — no
//       working-on-it field among the ones we read.
//     • the task-list API accepts  statuses[]  and  masterAssignee  filters,
//       with only two status values ever observed: 'new-request' and
//       'reply-received' (shared/request-monitor.js). Whether the enum has
//       more members — an 'in-progress' — is UNKNOWN.
//     • tasks can be RE-ASSIGNED to a team/staff member
//       (content-scripts/triage-lens/routine-rx-button.js) and reviews carry
//       reviewerAssigneeId/Type (docs/learnings-triage-attachment-to-document.md).
//       That is routing, not live presence — an assignee says who SHOULD do
//       it, not who IS doing it right now.
//     • the page runs Pusher with a '{siteId}-scheduling' channel
//       (content-scripts/pusher-relay.js). Pusher is exactly the transport a
//       real presence signal would use, and we have never enumerated what
//       else the app subscribes to.
//
//   So there are four places an "I'm on it" tag could live, and this script
//   looks in all four:
//     1. the task's own overview payload  (a status / lock / holder field)
//     2. the task-LIST row payload        (i.e. something the queue could show)
//     3. Pusher realtime                  (presence channel / broadcast event)
//     4. the page's own controls          (a Status dropdown with an
//                                          'In progress' the UI already offers)
//   ...plus the decisive behavioural test: does OPENING the task write
//   anything? A claim/lock mechanism must POST on open. Silence on open means
//   Medicus is not tracking it and any indicator must be ours to build.
//
//   Observation only. It wraps fetch / XMLHttpRequest to READ requests and
//   responses (the same MAIN-world technique as page-world.js — Medicus is
//   axios=XHR under a strict CSP), and its own probe GETs are read-only
//   endpoints the shipped code already calls. It NEVER blocks, rewrites,
//   replays or POSTs anything; nothing leaves the browser except when YOU
//   call .copy()/.save() locally.
//
// PATIENT DATA
//   USE A TEST PATIENT (or accept that the output is clinical data). Bodies
//   run through the same key-based redactor as the other capture scripts
//   (masks names, DOB, NHS number, address, postcode, phone, email; also
//   value-detects NHS-number/postcode shapes) while keeping ids, structure
//   and — deliberately — STAFF names, because "which colleague is shown"
//   is the very thing being studied. Keep the output local, never commit it
//   (the patient-data CI guard would reject it anyway).
//
// USAGE
//   1. Open the triage request in Medicus. DevTools → Console (the PAGE's
//      console, not the extension's).
//   2. Paste this whole file, press Enter → "[workcap] armed".
//   3. chWork.probe()      ← reads all four places, prints a verdict table.
//   4. chWork.listen()     ← start logging every Pusher event.
//   5. THE OPEN TEST — chWork.mark('reopen'), go back to the queue, open the
//      same request again, then chWork.summary(). Any ★ (write) row that
//      fires on open is a claim/lock/heartbeat. No ★ = nothing is recorded.
//   6. THE TWO-EYES TEST (the real proof) — with listen() running, have a
//      colleague (or a second browser profile) open the SAME request. If
//      nothing logs, Medicus does not tell anyone else.
//   7. chWork.save() → download the timeline as .json and send it to Claude.
//      chWork.stop() → unwrap everything and disarm.
//
// TUNING
//   chWork.all()            capture EVERY request (default: task-ish URLs
//                           + all writes; telemetry/sentry dropped).
//   chWork.filter(reOrFn)   custom URL filter (RegExp or (url,method)=>bool).
//   chWork.raw(true|false)  toggle body redaction.

(function () {
  'use strict';
  if (window.chWork && window.chWork.__armed) {
    console.warn('[workcap] already armed — call chWork.stop() first to re-arm');
    return;
  }

  // ── config ────────────────────────────────────────────────────────────────
  var BODY_PARSE_CAP = 200000;
  // Task overviews run ~20k+ of JSON and the interesting inventories
  // (taskStatusOptions, taskAssigneeOptions) sit near the END of the body —
  // the 20k cap the other capture scripts use truncated them mid-array on the
  // 2026-08-04 capture. Keep more here: payload shape IS the finding.
  var BODY_KEEP_CAP = 80000;
  var captureAll = false;
  var redact = true;

  // Default interest: task/queue-ish paths, OR any write. A claim/lock could
  // be named for the act rather than the entity, so the verbs are in here too.
  var INTEREST_RE =
    /(\/tasks?\/|task-list|overview|assign|lock|claim|reserv|presence|status|staff|user|session|heartbeat|activity|pusher|ws\/|socket)/i;
  var IGNORE_RE =
    /(sentry\.io|\/telemetry|\/analytics|google-analytics|googletagmanager|hotjar|fullstory|datadog|newrelic|\.png|\.jpg|\.svg|\.css|\.woff)/i;

  // Keys that would BE the answer if they exist. Used to pull needles out of
  // large payloads rather than making a human read the whole thing.
  var SIGNAL_RE =
    /(assign|lock|claim|owner|holder|reserv|checkout|checkedout|status|state|viewed|seen|opened|opening|progress|active|working|editing|editor|concurren|session|presence|heartbeat|actioned|handled|pickedup|taken|updatedby|modifiedby|lastactivity|staff|user|actor|colleague)/i;

  var timeline = [];
  var seq = 0;
  var t0 = Date.now();

  function now() {
    return new Date().toISOString().slice(11, 23);
  }
  function rel() {
    return Date.now() - t0;
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

  // ── redaction (same posture as the other capture scripts) ─────────────────
  // NOTE: staff/user NAMES are deliberately NOT masked — "whose name does
  // Medicus show against an open request" is the question. Patient
  // identifiers are.
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
  var NHS_RE = /\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/;
  var POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?[ ]?\d[A-Z]{2}\b/i;

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

  function parseBody(text) {
    if (text == null || text === '') return undefined;
    if (typeof text !== 'string') {
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

  function cap(s, n) {
    s = (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
    return s.length > (n || 60) ? s.slice(0, n || 60) + '…' : s;
  }

  // ── fetch wrap ────────────────────────────────────────────────────────────
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

  // ── XHR wrap (axios — what Medicus actually uses) ─────────────────────────
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__wc = { method: (method || 'GET').toUpperCase(), url: url, headers: [] };
    } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__wc) this.__wc.headers.push([name, value]);
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      var xhr = this;
      var wc = xhr.__wc;
      if (wc && interesting(wc.url, wc.method)) {
        var started = Date.now();
        var entry = push({
          kind: 'net',
          via: 'xhr',
          method: wc.method,
          url: safeUrl(wc.url),
          reqHeaders: safeHeaders(wc.headers),
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

  // ── WebSocket wrap (Pusher's transport — presence would arrive here) ──────
  // Frames are logged shape-first: event name + channel + redacted payload.
  var origWS = window.WebSocket;
  var wsWrapped = false;
  try {
    if (typeof origWS === 'function') {
      var WrappedWS = function (url, protocols) {
        var ws = protocols === undefined ? new origWS(url) : new origWS(url, protocols);
        push({ kind: 'ws-open', url: safeUrl(String(url)) });
        ws.addEventListener('message', function (ev) {
          var d = ev && ev.data;
          if (typeof d !== 'string') return;
          var parsed;
          try {
            parsed = JSON.parse(d);
          } catch (_) {
            return;
          }
          var name = parsed.event || '';
          // pusher:pong / connection keepalives are noise.
          if (name === 'pusher:pong' || name === 'pusher:ping') return;
          var inner = parsed.data;
          if (typeof inner === 'string') {
            try {
              inner = JSON.parse(inner);
            } catch (_) {}
          }
          push({
            kind: 'ws',
            event: name,
            channel: parsed.channel || null,
            data: deepRedact(inner, 0),
          });
        });
        return ws;
      };
      WrappedWS.prototype = origWS.prototype;
      ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
        try {
          WrappedWS[k] = origWS[k];
        } catch (_) {}
      });
      window.WebSocket = WrappedWS;
      wsWrapped = true;
    }
  } catch (_) {}

  // ── navigation wrap (the open test is a route change) ─────────────────────
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

  // ── read helpers ──────────────────────────────────────────────────────────
  function apiBaseUrl() {
    // england.medicus.health/{code}/... → {code}.api.england.medicus.health
    // The API host prefixes 'api' onto the FULL page host — do not strip the
    // first label first. Doing so produced {code}.api.medicus.health, whose
    // DNS does not resolve, so both probe GETs failed with "Failed to fetch"
    // on the 2026-08-04 capture (the passive wrap still caught the app's own
    // calls, which is where that capture's findings came from).
    var parts = location.pathname.split('/').filter(Boolean);
    var code = parts[0] || '';
    return 'https://' + code + '.api.' + location.hostname;
  }

  function parseTaskUrl() {
    var m = location.pathname.match(
      /\/([0-9a-z]{2,})\/tasks\/(?:data\/)?([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (!m) return null;
    return { site: m[1], slug: m[2], taskUuid: m[3].toLowerCase() };
  }

  function getJson(path) {
    return fetch(apiBaseUrl() + path, { credentials: 'include' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + path);
      return r.json();
    });
  }

  // Walk an object and collect every path whose KEY smells of "who is on it".
  function signalPaths(obj, basePath, out, depth) {
    out = out || [];
    depth = depth || 0;
    if (depth > 7 || obj === null || typeof obj !== 'object') return out;
    if (Array.isArray(obj)) {
      // Only inspect the first few array members — enough to learn the shape.
      obj.slice(0, 3).forEach(function (v, i) {
        signalPaths(v, basePath + '[' + i + ']', out, depth + 1);
      });
      return out;
    }
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      var path = basePath ? basePath + '.' + k : k;
      if (SIGNAL_RE.test(k)) {
        var shown;
        if (v === null || typeof v !== 'object') shown = v;
        else if (Array.isArray(v)) shown = '[' + v.length + ' items]';
        else shown = '{' + Object.keys(v).slice(0, 8).join(', ') + '}';
        out.push({ path: path, value: shown, type: Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v });
      }
      if (v && typeof v === 'object') signalPaths(v, path, out, depth + 1);
    }
    return out;
  }

  function topKeys(obj) {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj).map(function (k) {
      var v = obj[k];
      return k + ':' + (Array.isArray(v) ? 'array[' + v.length + ']' : v === null ? 'null' : typeof v);
    });
  }

  // ── Pusher inventory ──────────────────────────────────────────────────────
  function pusherInstance() {
    try {
      var app = document.querySelector('#app') || document.querySelector('[data-v-app]');
      var gp = app && app.__vue_app__ && app.__vue_app__.config && app.__vue_app__.config.globalProperties;
      if (gp && gp.$pusher) return gp.$pusher;
    } catch (_) {}
    try {
      if (window.Pusher && window.Pusher.instances && window.Pusher.instances.length) {
        return window.Pusher.instances[0];
      }
    } catch (_) {}
    return null;
  }

  function pusherReport() {
    var p = pusherInstance();
    if (!p)
      return {
        available: false,
        note: 'no $pusher on the Vue app and no Pusher.instances — realtime not reachable from here',
      };
    var out = { available: true, state: null, channels: [] };
    try {
      out.state = p.connection && p.connection.state;
    } catch (_) {}
    var map = (p.channels && p.channels.channels) || {};
    for (var name in map) {
      if (!Object.prototype.hasOwnProperty.call(map, name)) continue;
      var ch = map[name];
      var row = { channel: name, presence: /^presence-/.test(name), events: [] };
      try {
        var cbs = (ch.callbacks && ch.callbacks._callbacks) || {};
        row.events = Object.keys(cbs).map(function (e) {
          return e.replace(/^_/, '');
        });
      } catch (_) {}
      if (row.presence) {
        try {
          row.memberCount = ch.members && ch.members.count;
          row.meId = ch.members && ch.members.me && ch.members.me.id;
        } catch (_) {}
      }
      out.channels.push(row);
    }
    return out;
  }

  // ── page-control inventory (does the UI already offer "In progress"?) ─────
  var STATUSY_RE = /(status|state|progress|assign|allocat|owner|action|stage|workflow)/i;
  var PRESENCEY_RE =
    /(in progress|being (viewed|worked|edited)|picked up|currently (viewing|with)|locked|another user|someone else|is viewing|working on)/i;

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

  function domReport() {
    var out = { statusControls: [], presenceText: [] };
    // 1. Any control whose label smells of status/assignment, with its options.
    document.querySelectorAll('select, [role="combobox"], [role="listbox"]').forEach(function (el) {
      var label = labelOfField(el);
      var near = cap((el.closest('label, .field, [class*="form"]') || el).textContent, 80);
      if (!STATUSY_RE.test(label) && !STATUSY_RE.test(near)) return;
      var item = { tag: el.tagName.toLowerCase(), label: label, context: near, options: [] };
      if (el.options) {
        item.options = [].slice.call(el.options, 0, 20).map(function (o) {
          return cap(o.textContent, 30);
        });
      }
      out.statusControls.push(item);
    });
    // 2. Any visible text that already claims someone is on it.
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var n;
    var seenText = {};
    while ((n = walker.nextNode())) {
      var txt = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (txt.length < 4 || txt.length > 160) continue;
      if (!PRESENCEY_RE.test(txt)) continue;
      if (seenText[txt]) continue;
      seenText[txt] = 1;
      out.presenceText.push({
        text: cap(txt, 140),
        where: n.parentElement ? cap(n.parentElement.className || n.parentElement.tagName, 60) : '?',
      });
      if (out.presenceText.length >= 20) break;
    }
    // 3. Avatar-ish clusters (a "who's here" indicator is usually avatars).
    out.avatarLike = document.querySelectorAll('[class*="avatar"], [class*="Avatar"]').length;
    return out;
  }

  // ── probe ─────────────────────────────────────────────────────────────────
  function probe() {
    var ctx = parseTaskUrl();
    var report = {
      kind: 'probe',
      url: safeUrl(location.href),
      context: ctx,
      overview: null,
      listRow: null,
      pusher: pusherReport(),
      dom: domReport(),
    };

    if (!ctx) {
      console.warn(
        '[workcap] not on a task overview URL — open the request itself (…/tasks/{slug}/overview/{uuid}) and re-probe. Pusher + DOM sections below are still valid.'
      );
      push(report);
      printProbe(report);
      return Promise.resolve(report);
    }

    var overviewP = getJson('/tasks/data/' + ctx.slug + '/overview/' + ctx.taskUuid).then(
      function (d) {
        var body = d && d.data ? d.data : d;
        report.overview = {
          topKeys: topKeys(body),
          signals: signalPaths(body, '', [], 0),
          full: deepRedact(d, 0),
        };
      },
      function (e) {
        report.overview = { error: String(e.message || e) };
      }
    );

    // The queue row for this same task: whatever the LIST carries is what a
    // queue-level "someone's on it" tag could actually be drawn from.
    var listP = getJson('/tasks/data/' + ctx.slug + '/task-list?viewContext=homepage').then(
      function (d) {
        var rows = (d && (d.tasks || d.data || d.items)) || [];
        if (!Array.isArray(rows)) rows = [];
        var mine = null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i] && String(rows[i].id).toLowerCase() === ctx.taskUuid) {
            mine = rows[i];
            break;
          }
        }
        report.listRow = {
          responseTopKeys: topKeys(d),
          rowCount: rows.length,
          matchedThisTask: !!mine,
          rowKeys: topKeys(mine || rows[0] || {}),
          signals: signalPaths(mine || rows[0] || {}, '', [], 0),
          sampleRow: deepRedact(mine || rows[0] || null, 0),
        };
      },
      function (e) {
        report.listRow = { error: String(e.message || e) };
      }
    );

    return Promise.all([overviewP, listP]).then(function () {
      push(report);
      printProbe(report);
      return report;
    });
  }

  function printProbe(r) {
    console.log('%c[workcap] ── probe ──────────────────────────────', 'color:#2a7;font-weight:bold');

    if (r.overview && r.overview.error) console.warn('[workcap] overview: ' + r.overview.error);
    else if (r.overview) {
      console.log('[workcap] task overview — top-level keys:', r.overview.topKeys.join(', ') || '(none)');
      if (r.overview.signals.length) {
        console.log('[workcap] task overview — fields that could mean "someone is on it":');
        console.table(r.overview.signals);
      } else {
        console.log('%c[workcap] task overview: NO status/assignment/lock-shaped field at all.', 'color:#a72');
      }
    }

    if (r.listRow && r.listRow.error) console.warn('[workcap] task-list: ' + r.listRow.error);
    else if (r.listRow) {
      console.log(
        '[workcap] task-list — ' +
          r.listRow.rowCount +
          ' rows, this task ' +
          (r.listRow.matchedThisTask ? 'FOUND' : 'not in this view') +
          '. Row keys: ' +
          r.listRow.rowKeys.join(', ')
      );
      if (r.listRow.signals.length) console.table(r.listRow.signals);
    }

    if (!r.pusher.available) console.log('%c[workcap] pusher: ' + r.pusher.note, 'color:#a72');
    else {
      var presence = r.pusher.channels.filter(function (c) {
        return c.presence;
      });
      console.log(
        '[workcap] pusher: connection ' +
          r.pusher.state +
          ', ' +
          r.pusher.channels.length +
          ' channels, ' +
          presence.length +
          ' presence channel(s)' +
          (presence.length ? ' ← a real "who is here" signal already exists' : '')
      );
      console.table(r.pusher.channels);
    }

    console.log(
      '[workcap] page controls: ' +
        r.dom.statusControls.length +
        ' status/assignment-shaped control(s), ' +
        r.dom.presenceText.length +
        ' presence-shaped text node(s), ' +
        r.dom.avatarLike +
        ' avatar-ish elements'
    );
    if (r.dom.statusControls.length) console.table(r.dom.statusControls);
    if (r.dom.presenceText.length) console.table(r.dom.presenceText);

    console.log(
      '%c[workcap] next: chWork.listen(), then chWork.mark("reopen") and re-open this request from the queue.\n' +
        'A ★ write in chWork.summary() on open = Medicus records it. Silence = it does not.',
      'color:#2a7'
    );
  }

  // ── realtime listener ─────────────────────────────────────────────────────
  var unlisten = null;
  function listen() {
    var p = pusherInstance();
    if (!p) {
      console.warn(
        '[workcap] no Pusher instance reachable — the WebSocket wrap is still recording frames (' +
          (wsWrapped ? 'active' : 'FAILED to wrap') +
          '), so reload the page with this script armed to catch the socket from the start.'
      );
      return false;
    }
    var handler = function (eventName, data) {
      if (eventName === 'pusher:pong' || eventName === 'pusher:ping') return;
      push({ kind: 'pusher', event: String(eventName), data: deepRedact(data, 0) });
      console.log('%c[workcap] pusher ← ' + eventName, 'color:#27a', data);
    };
    if (typeof p.bind_global === 'function') {
      p.bind_global(handler);
      unlisten = function () {
        try {
          p.unbind_global(handler);
        } catch (_) {}
      };
      console.log(
        '%c[workcap] listening to ALL pusher events. Now have a colleague open this same request.',
        'color:#2a7;font-weight:bold'
      );
      return true;
    }
    if (p.connection && typeof p.connection.bind === 'function') {
      var connHandler = function (msg) {
        handler((msg && msg.event) || 'message', msg && msg.data);
      };
      p.connection.bind('message', connHandler);
      unlisten = function () {
        try {
          p.connection.unbind('message', connHandler);
        } catch (_) {}
      };
      console.log(
        '%c[workcap] listening via connection "message". Now have a colleague open this same request.',
        'color:#2a7;font-weight:bold'
      );
      return true;
    }
    console.warn('[workcap] pusher instance found but neither bind_global nor connection.bind is available');
    return false;
  }

  // ── public API ────────────────────────────────────────────────────────────
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

  window.chWork = {
    __armed: true,
    probe: probe,
    listen: listen,
    pusher: function () {
      var r = pusherReport();
      if (r.available) console.table(r.channels);
      else console.log('[workcap] ' + r.note);
      return r;
    },
    mark: function (text) {
      push({ kind: 'mark', text: cap(text, 140) });
      console.log('%c[workcap] mark: ' + text, 'color:#a72');
    },
    all: function () {
      captureAll = true;
      console.log('[workcap] now capturing ALL requests (telemetry still dropped). Re-run your flow.');
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
      console.log('[workcap] filter updated. Re-run your flow.');
    },
    raw: function (on) {
      redact = !on;
      console.warn('[workcap] body redaction ' + (redact ? 'ON' : 'OFF — TEST PATIENT ONLY'));
    },
    // Deduped endpoint list — writes flagged ★, because a write fired by
    // merely OPENING a request is the whole question.
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
      var realtime = timeline.filter(function (e) {
        return e.kind === 'pusher' || e.kind === 'ws';
      });
      console.log('[workcap] realtime frames captured: ' + realtime.length);
      if (realtime.length) {
        console.table(
          realtime.slice(-25).map(function (e) {
            return { at: e.t, event: e.event, channel: e.channel || '' };
          })
        );
      }
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
          console.log('[workcap] copied ' + timeline.length + ' timeline entries to clipboard');
        });
      }
      return json;
    },
    save: function () {
      var json = JSON.stringify(clampResBodies(timeline), null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'task-presence-capture-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
      console.log('[workcap] saved ' + timeline.length + ' entries → ' + a.download);
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
        if (wsWrapped) window.WebSocket = origWS;
      } catch (_) {}
      try {
        history.pushState = origPush;
        history.replaceState = origReplace;
        window.removeEventListener('popstate', onPop);
      } catch (_) {}
      try {
        if (unlisten) unlisten();
      } catch (_) {}
      this.__armed = false;
      console.log(
        '[workcap] disarmed. ' + timeline.length + ' entries — chWork.dump()/.summary()/.copy()/.save() still work.'
      );
    },
  };

  console.log(
    '%c[workcap] armed — looking for a "someone is working on this" signal.\n' +
      '  1. chWork.probe()              ← task payload + queue row + pusher + page controls\n' +
      '  2. chWork.listen()             ← log every realtime event\n' +
      '  3. chWork.mark("reopen") then re-open this request from the queue → chWork.summary()\n' +
      '     ★ write on open = Medicus records it · no ★ = it does not\n' +
      '  4. colleague/2nd profile opens the SAME request while listening = the real proof\n' +
      '  5. chWork.save() → send the .json to Claude · chWork.stop() = unwrap',
    'color:#2a7;font-weight:bold'
  );
})();
