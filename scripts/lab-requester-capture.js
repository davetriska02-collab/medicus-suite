// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — investigation-report REQUESTED-BY SCOPING capture (READ-ONLY).
//
// Dev / onboarding tool. NOT shipped. Paste into the PAGE console on:
//   A) the Investigation Results task-list (the table that already shows
//      a "Requested By" column), and/or
//   B) one open Review Investigation Report (the individual report).
//
// Dumps, patient names redacted:
//   1. task-list row keys + any requestedBy / orderedBy shaped fields
//   2. one overview's requester-shaped keys (no result VALUES)
//   3. visible column headers on the queue (so we can match "Requested By")
//
// Does not invent a write slug. Does not POST.

/* eslint-disable */
(() => {
  const out = {
    capturedAt: new Date().toISOString(),
    url: location.href,
    host: location.host,
    pathname: location.pathname,
    taskList: null,
    overview: null,
    columns: [],
  };

  const redact = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, 80));
  const looksPhiKey = (k) => /patient|nhs|dob|dateofbirth|resultvalue|resulttext/i.test(k);
  const REQUEST_RE = /request|order|clinician|gp|owner|assign/i;

  function sampleTask(item) {
    if (!item || typeof item !== 'object') return null;
    const keys = Object.keys(item);
    const keep = {};
    const requestShaped = [];
    keys.forEach((k) => {
      if (looksPhiKey(k)) {
        keep[k] = '[redacted]';
        return;
      }
      const v = item[k];
      if (REQUEST_RE.test(k)) {
        requestShaped.push({
          key: k,
          type: v == null ? 'null' : Array.isArray(v) ? 'array' : typeof v,
          preview: typeof v === 'string' ? redact(v) : v && typeof v === 'object' ? Object.keys(v).slice(0, 8) : v,
        });
      }
      if (v == null || typeof v === 'number' || typeof v === 'boolean') keep[k] = v;
      else if (typeof v === 'string') keep[k] = redact(v);
      else if (typeof v === 'object')
        keep[k] = Array.isArray(v)
          ? '[array ' + v.length + ']'
          : '{keys:' + Object.keys(v).slice(0, 12).join(',') + '}';
    });
    return { keys, requestShaped, sample: keep };
  }

  function requesterShaped(payload) {
    const hits = [];
    const walk = (node, path, depth) => {
      if (!node || typeof node !== 'object' || depth > 7) return;
      if (Array.isArray(node)) {
        node.slice(0, 20).forEach((x, i) => walk(x, path + '[' + i + ']', depth + 1));
        return;
      }
      Object.keys(node).forEach((k) => {
        if (looksPhiKey(k)) return;
        if (REQUEST_RE.test(k)) {
          const v = node[k];
          hits.push({
            path: path + '.' + k,
            type: v == null ? 'null' : Array.isArray(v) ? 'array' : typeof v,
            preview: typeof v === 'string' ? redact(v) : v && typeof v === 'object' ? Object.keys(v).slice(0, 8) : v,
          });
        }
        walk(node[k], path + '.' + k, depth + 1);
      });
    };
    walk(payload, 'root', 0);
    return hits.slice(0, 80);
  }

  const parts = location.pathname.split('/').filter(Boolean);
  const m = location.pathname.match(/^\/?([0-9a-z]{2,})\/tasks\/(?:data\/)?([^/]+)\/(task-list|overview)/i);
  out.context = {
    siteId: (m && m[1]) || parts[0] || null,
    slug: (m && m[2]) || null,
    page: (m && m[3]) || null,
  };

  out.columns = Array.from(document.querySelectorAll('.ag-header-cell-text, [col-id], th'))
    .map((el) => redact(el.getAttribute('col-id') || el.textContent))
    .filter(Boolean)
    .slice(0, 40);

  function makeDraggable(el, handle) {
    let down = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      down = true;
      sx = e.clientX;
      sy = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!down) return;
      el.style.left = Math.max(8, Math.min(window.innerWidth - 80, ox + e.clientX - sx)) + 'px';
      el.style.top = Math.max(8, Math.min(window.innerHeight - 40, oy + e.clientY - sy)) + 'px';
    });
    document.addEventListener('mouseup', () => {
      down = false;
    });
  }

  function dump() {
    window.__lrcCapture = out;
    const json = JSON.stringify(out, null, 2);
    const existing = document.getElementById('__lrcCapBox');
    if (existing) {
      const ta = existing.querySelector('textarea');
      if (ta) ta.value = json;
      return;
    }
    const wrap = document.createElement('div');
    wrap.id = '__lrcCapBox';
    wrap.style.cssText =
      'position:fixed;right:16px;bottom:16px;width:360px;height:200px;z-index:2147483647;background:#fff;border:2px solid #1e3a5f;border-radius:8px;padding:8px;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.4)';
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center;flex-shrink:0';
    const ta = document.createElement('textarea');
    ta.value = json;
    ta.style.cssText = 'flex:1;width:100%;min-height:0;font:11px monospace;resize:none';
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
    cl.textContent = 'Hide';
    cl.onclick = () => wrap.remove();
    const note = document.createElement('span');
    note.style.cssText = 'font:11px system-ui;color:#555;flex:1';
    note.textContent = 'Armed. Drag this bar. Medicus stays usable.';
    bar.append(cp, cl, note);
    wrap.append(bar, ta);
    document.body.appendChild(wrap);
    makeDraggable(wrap, bar);
  }

  const ctx = out.context || {};
  const apiHost = ctx.siteId ? ctx.siteId + '.api.' + location.host : null;

  function fetchJson(path) {
    return fetch('https://' + apiHost + path, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    }).then((r) => r.json());
  }

  if (ctx.siteId && ctx.slug && ctx.page === 'task-list') {
    fetchJson('/tasks/data/' + ctx.slug + '/task-list')
      .then((j) => {
        const items = (j && (j.tasks || j.data || j.results || j.rows)) || (Array.isArray(j) ? j : []);
        const arr = Array.isArray(items) ? items : items.tasks || [];
        out.taskList = {
          envelopeKeys: j && typeof j === 'object' ? Object.keys(j) : [],
          count: Array.isArray(arr) ? arr.length : 0,
          first: Array.isArray(arr) && arr[0] ? sampleTask(arr[0]) : null,
          second: Array.isArray(arr) && arr[1] ? sampleTask(arr[1]) : null,
        };
        const first = Array.isArray(arr) ? arr[0] : null;
        const ov =
          first && typeof first.overviewURL === 'string' && first.overviewURL.indexOf('/tasks/data/') === 0
            ? first.overviewURL
            : null;
        if (!ov) {
          dump();
          return;
        }
        return fetchJson(ov).then((ovj) => {
          out.overview = {
            keys: ovj && ovj.data ? Object.keys(ovj.data) : ovj ? Object.keys(ovj) : [],
            requesterShaped: requesterShaped(ovj),
          };
          dump();
        });
      })
      .catch((e) => {
        out.taskList = { fetchError: String(e) };
        dump();
      });
  } else if (ctx.siteId && /overview/i.test(location.pathname)) {
    const ov = location.pathname.replace(/^\/[0-9a-z]+\//i, '/');
    const dataPath = ov.replace('/tasks/', '/tasks/data/').replace(/\/overview\/?$/, '');
    // Prefer the page's own overviewURL shape: /tasks/data/{slug}/overview/{id}
    const om = location.pathname.match(/\/tasks\/(?:data\/)?([^/]+)\/overview\/([^/]+)/i);
    const path = om ? '/tasks/data/' + om[1] + '/overview/' + om[2] : null;
    void dataPath;
    if (!path) {
      out.overview = { skipped: 'could not parse overview path' };
      dump();
      return;
    }
    fetchJson(path)
      .then((ovj) => {
        out.overview = {
          keys: ovj && ovj.data ? Object.keys(ovj.data) : ovj ? Object.keys(ovj) : [],
          requesterShaped: requesterShaped(ovj),
        };
        dump();
      })
      .catch((e) => {
        out.overview = { fetchError: String(e) };
        dump();
      });
  } else {
    out.taskList = { skipped: 'open the investigation-results task-list or one report first' };
    dump();
  }
})();
