// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — staff-scheduling SCOPING capture (READ-ONLY).
//
// Dev / onboarding tool. NOT shipped (scripts/ is excluded from the release zip).
// Paste the IIFE below into the PAGE console (DevTools) on Medicus
// Staff scheduling (or any /scheduling/… page), then click around the
// screen you want us to learn — who's in, leave, sessions, the staff list.
// The script dumps:
//   1. route + visible headings / tabs / table column labels (no cell values)
//   2. every GET the page already fires that looks like staff / rota / leave /
//      diary / schedule (patient names redacted)
//   3. a re-read of the CONFIRMED appointment-book embedded-overview for today
//      (staff names + session counts only — not a new slug)
//
// Same doctrine as scripts/lab-allocate-capture.js: do not invent Medicus
// slugs. Paths below are what the page actually called, plus one already-
// captured GET. This script never writes.

/* eslint-disable */
(() => {
  const out = {
    capturedAt: new Date().toISOString(),
    url: location.href,
    host: location.host,
    pathname: location.pathname,
    search: location.search,
    title: document.title || '',
    reads: [],
    writesSeen: [],
    landmarks: null,
    todayBook: null,
  };

  const redact = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, 80));
  const looksPhiKey = (k) =>
    /patient|nhs|dob|dateofbirth|address|postcode|phone|email|reasonfor/i.test(String(k || ''));
  const INTEREST_RE =
    /(schedul|staff|rota|leave|absence|diary|session|clinician|working.?pattern|non-delivery|availability)/i;
  const IGNORE_RE = /(sentry\.io|\/telemetry|\/analytics|\.png|\.jpg|\.svg|\.css|\.woff)/i;

  function todayISO() {
    const d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  function siteIdFromPage() {
    const m = location.pathname.match(/^\/([0-9a-z]{2,})\//i);
    return m ? m[1] : null;
  }

  function sampleValue(v, depth) {
    if (v == null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return redact(v);
    if (depth > 2) return Array.isArray(v) ? '[array ' + v.length + ']' : '{…}';
    if (Array.isArray(v)) return '[array ' + v.length + ']';
    if (typeof v === 'object') return '{keys:' + Object.keys(v).slice(0, 16).join(',') + '}';
    return String(typeof v);
  }

  function sampleObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const keys = Object.keys(obj);
    const sample = {};
    keys.slice(0, 40).forEach((k) => {
      sample[k] = looksPhiKey(k) ? '[redacted]' : sampleValue(obj[k], 0);
    });
    return { keys: keys.slice(0, 60), sample };
  }

  function staffShaped(payload) {
    const hits = [];
    const walk = (node, path, depth) => {
      if (!node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) {
        node.slice(0, 8).forEach((x, i) => walk(x, path + '[' + i + ']', depth + 1));
        return;
      }
      Object.keys(node).forEach((k) => {
        if (looksPhiKey(k)) return;
        if (/staff|clinician|leave|absence|rota|schedule|session|diary|name/i.test(k)) {
          const v = node[k];
          hits.push({
            path: path + '.' + k,
            type: v == null ? 'null' : Array.isArray(v) ? 'array[' + v.length + ']' : typeof v,
            preview: typeof v === 'string' ? redact(v) : v && typeof v === 'object' ? Object.keys(v).slice(0, 10) : v,
          });
        }
        walk(node[k], path + '.' + k, depth + 1);
      });
    };
    walk(payload, 'root', 0);
    return hits.slice(0, 80);
  }

  function recordRead(method, url, body) {
    const entry = {
      method: String(method || 'GET').toUpperCase(),
      url: String(url || '').slice(0, 280),
      at: new Date().toISOString(),
    };
    if (entry.method !== 'GET' && entry.method !== 'HEAD') {
      try {
        if (typeof body === 'string' && body) {
          const j = JSON.parse(body);
          if (j && typeof j === 'object') entry.keys = Object.keys(j).slice(0, 40);
        }
      } catch (_) {}
      out.writesSeen.push(entry);
      dump();
      return;
    }
    if (IGNORE_RE.test(entry.url) || !INTEREST_RE.test(entry.url)) return;
    if (out.reads.some((r) => r.url === entry.url && r.method === entry.method)) return;
    out.reads.push(entry);
    dump();
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (url, init) {
      try {
        const method = String((init && init.method) || 'GET').toUpperCase();
        recordRead(method, typeof url === 'string' ? url : url && url.url, init && init.body);
      } catch (_) {}
      const p = origFetch.apply(this, arguments);
      try {
        p.then((resp) => {
          try {
            const u = String((resp && resp.url) || url || '');
            if (!INTEREST_RE.test(u) || IGNORE_RE.test(u)) return;
            const clone = resp.clone();
            clone
              .json()
              .then((j) => {
                const hit = out.reads.find((r) => u.indexOf(r.url) !== -1 || r.url.indexOf(u) !== -1);
                if (hit && !hit.sample) {
                  hit.sample = sampleObject(j);
                  hit.staffShaped = staffShaped(j);
                  dump();
                }
              })
              .catch(() => {});
          } catch (_) {}
        }).catch(() => {});
      } catch (_) {}
      return p;
    };
  }
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__sscMethod = method;
      this.__sscUrl = url;
    } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      recordRead(this.__sscMethod || 'GET', this.__sscUrl, body);
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  function landmarks() {
    const textOf = (sel, n) =>
      Array.from(document.querySelectorAll(sel))
        .slice(0, n)
        .map((el) => redact(el.textContent))
        .filter(Boolean);
    return {
      h1: textOf('h1', 6),
      h2: textOf('h2', 10),
      tabs: textOf('[role="tab"], .q-tab, [class*="tab"]', 20),
      buttons: textOf('button, [role="button"]', 24),
      tableHeaders: textOf('th, [role="columnheader"]', 24),
      nav: textOf('nav a, [role="navigation"] a', 16),
    };
  }

  function dump() {
    out.landmarks = landmarks();
    const old = document.getElementById('__sscCapBox');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = '__sscCapBox';
    wrap.style.cssText =
      'position:fixed;inset:24px;z-index:2147483647;background:#fff;border:2px solid #1e3a5f;border-radius:8px;padding:8px;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.4)';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;align-items:center';
    const ta = document.createElement('textarea');
    ta.value = JSON.stringify(out, null, 2);
    ta.style.cssText = 'flex:1;width:100%;font:12px monospace';
    const cp = document.createElement('button');
    cp.textContent = 'Copy';
    cp.onclick = () => {
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        cp.textContent = 'Copied';
      } catch (e) {}
    };
    const cl = document.createElement('button');
    cl.textContent = 'Close';
    cl.onclick = () => wrap.remove();
    const note = document.createElement('span');
    note.style.cssText = 'font:12px system-ui;color:#555';
    note.textContent =
      'Read-only. Click around Staff scheduling so its GETs appear, then Copy. No writes from this box.';
    bar.append(cp, cl, note);
    wrap.append(bar, ta);
    document.body.appendChild(wrap);
    window.__sscCapture = out;
  }

  const siteId = siteIdFromPage();
  out.context = { siteId: siteId, pageWorldBridge: !!window.__chPageWorld };

  // Confirmed appointment-book read — today's staff list / sessions. Not a
  // staff-scheduling slug. Skip if we cannot see a practice code.
  if (siteId) {
    const date = todayISO();
    const url =
      'https://' +
      siteId +
      '.api.' +
      location.host +
      '/scheduling/data/appointment-book/embedded-overview?date=' +
      date +
      '&filterByUsualLocation=false';
    fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((j) => {
        const staff = Array.isArray(j && j.staffSchedules) ? j.staffSchedules : [];
        out.todayBook = {
          date: date,
          path: '/scheduling/data/appointment-book/embedded-overview',
          staffCount: staff.length,
          staff: staff.slice(0, 40).map((s) => ({
            name: redact(s && s.name),
            sessions: Array.isArray(s && s.schedule) ? s.schedule.length : 0,
          })),
        };
        dump();
      })
      .catch((e) => {
        out.todayBook = { fetchError: String(e), path: '/scheduling/data/appointment-book/embedded-overview' };
        dump();
      });
  } else {
    out.todayBook = { skipped: 'open a /{siteId}/scheduling/… page first' };
    dump();
  }

  dump();
})();
