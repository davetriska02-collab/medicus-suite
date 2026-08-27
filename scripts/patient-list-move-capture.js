// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — usual-GP / registered-list SCOPING capture (READ-ONLY
// unless YOU change a test patient's usual GP, or open then cancel a staff
// Archive prompt, in Medicus; this script only records what the page does).
//
// Dev / onboarding tool. NOT shipped (scripts/ is excluded from the release zip).
// Answers the make-or-break questions in docs/plans/PATIENT-LIST-MOVE-SPIKE.md:
//   1. listing GET keys (usual/named GP name + staff UUID?)
//   2. filter query params when Usual GP is applied
//   3. whether "x patients selected" is a count or a multi-select + bulk action
//   4. the Registration-tab usual-GP save (method, path, body KEYS + value TYPES)
//   5. the staff-archive replacement prompt (observe, then Cancel — do not archive)
//   6. whether Report Builder Bulk actions includes Change usual GP
//   7. Patient Finder text search — result keys (does a hit carry usual GP?)
//   8. Patient Finder Advanced options — fields + params (Usual GP vs last-seen)
//   9. listing-page name/NHS box, if any (cohort definition for the canvas)
//
// Same doctrine as scripts/booking-flow-capture.js and
// scripts/lab-allocate-capture.js: do not invent Medicus slugs. Observation
// only — wraps fetch / XMLHttpRequest to READ. Never blocks, rewrites, or POSTs.
//
// PATIENT DATA
//   USE A TEST PATIENT for any write. Bodies are key-redacted (names, DOB, NHS,
//   address, postcode, phone, email) and value-detect NHS numbers / UK postcodes.
//   Staff / usual-GP NAMES are kept — the destination is the finding.
//   Keep the JSON local. Never commit it (the patient-data CI guard would reject it).
//
// USAGE
//   1. Patient Registration → patient list. DevTools → page Console (not the extension).
//   2. Paste this whole file, press Enter → "[listcap] armed".
//   3. chList.probe()          ← listing URL, first-row keys, filter/bulk DOM.
//   4. Filter by Usual GP.     chList.mark('filtered by usual GP')
//   5. chList.ui()             ← buttons, "patients selected", checkboxes.
//   6. TEST PATIENT: Administrative Record → Registration → change Usual GP.
//      chList.mark('about to save usual GP') … Save … chList.writes()
//   7. Optional: Staff Administration → Archive on a Doctor (Cancel, do not archive).
//   8. Optional: Report Builder patient report → open Bulk actions.
//   9. Patient Finder: type a TEST name. chList.mark('finder search') then
//      chList.finder(). Open Advanced options, note fields, Cancel.
//  10. chList.summary() / chList.save()  then chList.stop()
//
// TUNING
//   chList.all()            capture EVERY request (telemetry still dropped).
//   chList.filter(reOrFn)   custom URL filter.
//   chList.raw(true)        unredacted bodies — TEST PATIENT ONLY.

/* eslint-disable */
(function () {
  'use strict';
  if (window.chList && window.chList.__armed) {
    console.warn('[listcap] already armed — call chList.stop() first to re-arm');
    return;
  }

  var BODY_PARSE_CAP = 200000;
  var BODY_KEEP_CAP = 80000;
  var captureAll = false;
  var redact = true;

  var INTEREST_RE =
    /(\/patient\/|patient-finder|patient-list|listing|registrat|usual|named-?gp|namedgp|staff|archive|job-role|report|bulk|finder)/i;
  var IGNORE_RE =
    /(sentry\.io|\/telemetry|\/analytics|google-analytics|googletagmanager|hotjar|fullstory|datadog|newrelic|\.png|\.jpg|\.svg|\.css|\.woff)/i;
  var SIGNAL_RE =
    /(usual|named|gp|list|registrat|assign|staff|clinician|practitioner|doctor|archive|bulk|select|patientid|patientuuid)/i;
  var UI_RE =
    /usual|named\s*gp|change\s*(list|gp)|move|reassign|bulk|selected|registration|archive|filter|search|finder|advanced/i;

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
    if (entry.kind === 'net' && /^(POST|PUT|PATCH|DELETE)$/i.test(entry.method)) {
      console.log(
        '%c[listcap] ★ ' + entry.method + ' ' + (entry.url || '').split('?')[0],
        'color:#a72;font-weight:bold',
        entry.reqBody && typeof entry.reqBody === 'object' ? Object.keys(entry.reqBody) : ''
      );
    }
    return entry;
  }

  function interesting(url, method) {
    if (IGNORE_RE.test(url)) return false;
    if (captureAll) return true;
    if (INTEREST_RE.test(url)) return true;
    return /^(post|put|patch|delete)$/i.test(method || 'GET');
  }

  var PII_KEYS = {};
  (
    'firstname lastname surname forename forenames middlename givenname familyname maidenname ' +
    'fullname preferredname displayname patientname knownas dateofbirth dob birthdate ' +
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
      out[p[0]] = SECRET_HDR_RE.test(p[0]) ? '«present:' + String(p[1]).length + '»' : String(p[1]);
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

  function describeValue(v) {
    if (v === null) return { type: 'null' };
    if (Array.isArray(v))
      return {
        type: 'array',
        length: v.length,
        itemType: v.length ? (v[0] === null ? 'null' : Array.isArray(v[0]) ? 'array' : typeof v[0]) : 'empty',
      };
    if (typeof v === 'object') return { type: 'object', keys: Object.keys(v).slice(0, 24) };
    if (typeof v === 'string') {
      var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return { type: 'string', length: v.length, looksUuid: uuidRe.test(v) };
    }
    return { type: typeof v };
  }

  function firstRowKeys(payload) {
    if (!payload || typeof payload !== 'object') return null;
    var rows =
      payload.patients || payload.results || payload.data || payload.rows || (Array.isArray(payload) ? payload : null);
    if (rows && !Array.isArray(rows) && rows.patients) rows = rows.patients;
    if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== 'object') {
      return { envelopeKeys: Object.keys(payload).slice(0, 40), rowCount: Array.isArray(rows) ? rows.length : 0 };
    }
    var row = rows[0];
    var keys = Object.keys(row);
    var signal = {};
    keys.forEach(function (k) {
      if (SIGNAL_RE.test(k) || /id|uuid|status|gp/i.test(k)) signal[k] = describeValue(row[k]);
    });
    return {
      envelopeKeys: Object.keys(payload).slice(0, 40),
      rowCount: rows.length,
      firstRowKeys: keys,
      signalFields: signal,
    };
  }

  function queryParams(url) {
    try {
      var out = {};
      new URL(url, location.origin).searchParams.forEach(function (val, key) {
        if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = [];
        out[key].push(redact && (PII_KEYS[normKey(key)] || NHS_RE.test(val)) ? placeholder(val) : val);
      });
      return out;
    } catch (_) {
      return {};
    }
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
          method: String(method).toUpperCase(),
          url: safeUrl(url),
          params: queryParams(url),
          reqHeaders: safeHeaders(headersToPairs(init && init.headers)),
          reqBody: parseBody(init && init.body),
          status: null,
          ms: null,
        });
      }
      var p = origFetch.apply(this, arguments);
      if (watch && entry && p && typeof p.then === 'function') {
        p.then(
          function (resp) {
            entry.status = resp.status;
            entry.ms = Date.now() - started;
            var ct = '';
            try {
              ct = resp.headers.get('content-type') || '';
            } catch (_) {}
            if (ct) entry.resType = ct;
            try {
              resp
                .clone()
                .text()
                .then(function (txt) {
                  entry.resBody = parseBody(txt);
                  if (entry.resBody && typeof entry.resBody === 'object') {
                    entry.listingShape = firstRowKeys(entry.resBody);
                  }
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
      this.__lc = { method: (method || 'GET').toUpperCase(), url: url, headers: [] };
    } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (this.__lc) this.__lc.headers.push([name, value]);
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      var xhr = this;
      var lc = xhr.__lc;
      if (lc && interesting(lc.url, lc.method)) {
        var started = Date.now();
        var entry = push({
          kind: 'net',
          via: 'xhr',
          method: lc.method,
          url: safeUrl(lc.url),
          params: queryParams(lc.url),
          reqHeaders: safeHeaders(lc.headers),
          reqBody: parseBody(body),
          status: null,
          ms: null,
        });
        xhr.addEventListener('loadend', function () {
          entry.status = xhr.status;
          entry.ms = Date.now() - started;
          // Only 'content-type' is CORS-safelisted. Do not read other headers
          // (booking-flow-capture.js: the unsafe-header console flood).
          var ct = '';
          try {
            ct = xhr.getResponseHeader('content-type') || '';
          } catch (_) {}
          if (ct) entry.resType = ct;
          try {
            entry.resBody = parseBody(
              xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : xhr.response
            );
            if (entry.resBody && typeof entry.resBody === 'object') {
              entry.listingShape = firstRowKeys(entry.resBody);
            }
          } catch (_) {}
        });
      }
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  function textOf(el) {
    return cap(el && (el.getAttribute('aria-label') || el.textContent), 80);
  }

  function inventoryUi() {
    var buttons = [];
    document.querySelectorAll('button, [role="button"], a, [role="menuitem"]').forEach(function (el) {
      var t = textOf(el);
      if (!t || !UI_RE.test(t)) return;
      buttons.push({ tag: el.tagName.toLowerCase(), text: t, disabled: !!el.disabled });
    });
    var filters = [];
    document
      .querySelectorAll('select, [role="combobox"], [role="listbox"], input[type="search"]')
      .forEach(function (el) {
        var t = textOf(el) || cap(el.getAttribute('placeholder') || el.getAttribute('name'), 60);
        if (!t) return;
        if (UI_RE.test(t) || /gp|status|registrat|filter/i.test(t)) {
          filters.push({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), label: t });
        }
      });
    var selectedBits = [];
    // Do not walk the AG-Grid body — thousands of cells. Chrome / filter /
    // status text is enough to see "x patients selected".
    document
      .querySelectorAll(
        'header, [class*="toolbar"], [class*="filter"], [class*="status"], [class*="count"], [class*="selected"], [class*="summary"]'
      )
      .forEach(function (el) {
        if (el.children && el.children.length > 8) return;
        var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/patients? selected/i.test(t) && t.length < 80) selectedBits.push(t);
      });
    var checkboxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length;
    return {
      href: safeUrl(location.href),
      title: cap(document.title, 80),
      onListing: /\/patient\/listing/i.test(location.pathname),
      onAdminRecord: /administrat|registration/i.test(location.href + ' ' + document.title),
      buttons: buttons.slice(0, 40),
      filters: filters.slice(0, 24),
      patientsSelectedText: selectedBits.slice(0, 8),
      checkboxCount: checkboxes,
    };
  }

  function resourceListingUrls() {
    var urls = [];
    try {
      performance.getEntriesByType('resource').forEach(function (e) {
        if (/\/patient\//i.test(e.name) && /list/i.test(e.name)) urls.push(safeUrl(e.name));
      });
    } catch (_) {}
    var seen = {};
    return urls.filter(function (u) {
      if (seen[u]) return false;
      seen[u] = 1;
      return true;
    });
  }

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

  function writeRows() {
    return timeline.filter(function (e) {
      return e.kind === 'net' && /^(POST|PUT|PATCH|DELETE)$/i.test(e.method);
    });
  }

  function isFinderCall(e) {
    return e && e.kind === 'net' && /patient-finder|\/finder|advanced.?search/i.test(e.url || '');
  }

  function summariseNet(e) {
    var hitKeys = null;
    var shape = e.listingShape;
    if (shape && shape.firstRowKeys) hitKeys = shape.firstRowKeys;
    else if (e.resBody && typeof e.resBody === 'object') {
      var results = e.resBody.results || e.resBody.patients || e.resBody.data;
      if (Array.isArray(results) && results[0] && typeof results[0] === 'object') hitKeys = Object.keys(results[0]);
    }
    return {
      method: e.method,
      url: (e.url || '').split('?')[0],
      params: e.params,
      status: e.status,
      listingShape: shape || null,
      firstHitKeys: hitKeys,
    };
  }

  window.chList = {
    __armed: true,
    mark: function (text) {
      push({ kind: 'mark', text: cap(text, 140) });
      console.log('%c[listcap] mark: ' + text, 'color:#a72');
    },
    all: function () {
      captureAll = true;
      console.log('[listcap] now capturing ALL requests (telemetry still dropped).');
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
      console.log('[listcap] filter updated.');
    },
    raw: function (on) {
      redact = !on;
      console.warn('[listcap] body redaction ' + (redact ? 'ON' : 'OFF — TEST PATIENT ONLY'));
    },
    ui: function () {
      var snap = inventoryUi();
      push({ kind: 'ui', snapshot: snap });
      console.log('[listcap] UI snapshot');
      console.table(snap.buttons);
      console.log('filters', snap.filters);
      console.log('patientsSelectedText', snap.patientsSelectedText);
      console.log('checkboxCount', snap.checkboxCount);
      return snap;
    },
    probe: function () {
      var snap = inventoryUi();
      var listingUrls = resourceListingUrls();
      var listingNets = timeline.filter(function (e) {
        return e.kind === 'net' && /patient/i.test(e.url || '') && /list/i.test(e.url || '');
      });
      var finderNets = timeline.filter(isFinderCall);
      var report = {
        capturedAt: new Date().toISOString(),
        page: snap,
        listingUrlsFromPerformance: listingUrls,
        listingCallsSoFar: listingNets.map(summariseNet),
        finderCallsSoFar: finderNets.map(summariseNet),
        writeCount: writeRows().length,
      };
      push({ kind: 'probe', report: report });
      console.log('%c[listcap] probe', 'color:#2a7;font-weight:bold');
      console.log(report);
      if (!listingUrls.length && !listingNets.length) {
        console.warn(
          '[listcap] no listing URL seen yet. Stay on Patient Registration → patient list, wait for the grid to load, probe again.'
        );
      }
      return report;
    },
    finder: function () {
      var rows = timeline.filter(isFinderCall).map(summariseNet);
      push({ kind: 'finder', calls: rows });
      console.log('%c[listcap] finder (' + rows.length + ')', 'color:#2a7;font-weight:bold');
      console.table(
        rows.map(function (r) {
          return {
            call: r.method + ' ' + r.url,
            status: r.status,
            keys: (r.firstHitKeys || []).join(', '),
          };
        })
      );
      if (!rows.length) {
        console.warn(
          '[listcap] no patient-finder call yet. Open the magnifying-glass Patient Finder, type a TEST name, then chList.finder() again.'
        );
      }
      return rows;
    },
    writes: function () {
      var rows = writeRows().map(function (e) {
        var keys =
          e.reqBody && typeof e.reqBody === 'object' && !Array.isArray(e.reqBody) ? Object.keys(e.reqBody) : [];
        return {
          method: e.method,
          url: (e.url || '').split('?')[0],
          status: e.status,
          keys: keys,
          keyTypes: keys.reduce(function (acc, k) {
            acc[k] = describeValue(e.reqBody[k]);
            return acc;
          }, {}),
        };
      });
      console.log('%c[listcap] writes (' + rows.length + ')', 'color:#a72;font-weight:bold');
      console.table(
        rows.map(function (r) {
          return { call: r.method + ' ' + r.url, status: r.status, keys: r.keys.join(', ') };
        })
      );
      return rows;
    },
    summary: function () {
      var seen = {};
      var rows = [];
      timeline.forEach(function (e) {
        if (e.kind !== 'net') return;
        var key = e.method + ' ' + (e.url || '').split('?')[0];
        if (seen[key]) {
          seen[key].hits++;
          seen[key].lastStatus = e.status;
          return;
        }
        var row = { call: key, hits: 1, lastStatus: e.status, write: /^(POST|PUT|PATCH|DELETE)$/i.test(e.method) };
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
          console.log('[listcap] copied ' + timeline.length + ' timeline entries to clipboard');
        });
      }
      return json;
    },
    save: function () {
      var json = JSON.stringify(clampResBodies(timeline), null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'patient-list-move-capture-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 0);
      console.log('[listcap] saved ' + timeline.length + ' entries → ' + a.download);
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
      this.__armed = false;
      console.log(
        '[listcap] disarmed. ' + timeline.length + ' entries — chList.dump()/.summary()/.copy()/.save() still work.'
      );
    },
  };

  console.log(
    '%c[listcap] armed — capturing patient-list / registration / usual-GP / staff-archive traffic.\n' +
      'USE A TEST PATIENT for any usual-GP save. Do NOT confirm a staff Archive.\n' +
      'chList.probe() · chList.finder() · chList.ui() · chList.writes() · chList.summary() / .save() · chList.stop()',
    'color:#2a7;font-weight:bold'
  );
})();
