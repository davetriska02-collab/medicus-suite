// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — lab-allocation SCOPING capture (READ-ONLY unless YOU
// reassign one result by hand in Medicus; this script only records what
// the page already does).
//
// Dev / onboarding tool. NOT shipped (scripts/ is excluded from the release zip).
// Paste the IIFE below into the PAGE console (DevTools) while on the Medicus
// investigation-results task-list, then (optionally) open one result and use
// Medicus's own "Reassign task" control. The script dumps:
//   1. task-list keys + assignment/status/namedGp samples (patient names redacted)
//   2. one overview's requester-shaped keys (no result VALUES)
//   3. any POST/PUT/PATCH the page fires while you reassign — path, keys,
//      and value TYPES (not PHI). The captured write is
//      POST /tasks/task-list/bulk-reassign
//      (assigneeId, assigneeType, taskList, taskIds). Re-run if that drifts.
//
// Same doctrine as scripts/labfiling-capture.js and scripts/booking-flow-capture.js:
// do not invent Medicus slugs. Paths below are what the page actually called.

/* eslint-disable */
(() => {
  const out = {
    capturedAt: new Date().toISOString(),
    url: location.href,
    host: location.host,
    writes: [],
    taskList: null,
    overview: null,
  };

  const redact = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, 80));
  const looksPhiKey = (k) => /patient|nhs|dob|dateofbirth|resultvalue|resulttext/i.test(k);

  function describeWriteValue(k, v) {
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (k === 'assigneeType' && typeof v === 'string') return { type: t, value: v.slice(0, 20) };
    if (k === 'taskList') {
      if (typeof v === 'string')
        return { type: t, looksUuid: uuidRe.test(v), length: v.length, looksSlug: /[a-z0-9_-]+/i.test(v) };
      if (v && typeof v === 'object' && !Array.isArray(v)) return { type: t, keys: Object.keys(v).slice(0, 20) };
      if (Array.isArray(v)) return { type: t, length: v.length };
      return { type: t };
    }
    if (k === 'taskIds' && Array.isArray(v))
      return { type: t, length: v.length, itemType: typeof v[0], uuidShaped: !!(v[0] && uuidRe.test(String(v[0]))) };
    if (k === 'assigneeId') return { type: t, uuidShaped: uuidRe.test(String(v || '')) };
    return { type: t };
  }

  function recordWrite(method, url, body) {
    const entry = {
      method,
      url: String(url || '').slice(0, 240),
      at: new Date().toISOString(),
      keys: [],
      keyTypes: {},
    };
    try {
      if (typeof body === 'string' && body) {
        const j = JSON.parse(body);
        if (j && typeof j === 'object') {
          entry.keys = Object.keys(j).slice(0, 40);
          entry.keys.forEach((k) => {
            entry.keyTypes[k] = describeWriteValue(k, j[k]);
          });
        }
      }
    } catch (_) {}
    out.writes.push(entry);
    dump();
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (url, init) {
      try {
        const method = String((init && init.method) || 'GET').toUpperCase();
        if (/POST|PUT|PATCH|DELETE/.test(method))
          recordWrite(method, typeof url === 'string' ? url : url && url.url, init && init.body);
      } catch (_) {}
      return origFetch.apply(this, arguments);
    };
  }
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__lacMethod = method;
      this.__lacUrl = url;
    } catch (_) {}
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      const method = String(this.__lacMethod || 'GET').toUpperCase();
      if (/POST|PUT|PATCH|DELETE/.test(method)) recordWrite(method, this.__lacUrl, body);
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  function sampleTask(item) {
    if (!item || typeof item !== 'object') return null;
    const keys = Object.keys(item);
    const keep = {};
    keys.forEach((k) => {
      if (looksPhiKey(k)) {
        keep[k] = '[redacted]';
        return;
      }
      const v = item[k];
      if (v == null || typeof v === 'number' || typeof v === 'boolean') keep[k] = v;
      else if (typeof v === 'string') keep[k] = redact(v);
      else if (typeof v === 'object')
        keep[k] = Array.isArray(v)
          ? '[array ' + v.length + ']'
          : '{keys:' + Object.keys(v).slice(0, 12).join(',') + '}';
    });
    return { keys, sample: keep };
  }

  function describeAssignee(v) {
    if (v == null) return { type: 'null' };
    if (typeof v === 'string')
      return { type: 'string', length: v.length, looksSurnameInitial: /^[A-Z][A-Z '-]+ [A-Z]$/.test(v.trim()) };
    if (typeof v === 'object' && !Array.isArray(v))
      return { type: 'object', keys: Object.keys(v).slice(0, 12) };
    return { type: Array.isArray(v) ? 'array' : typeof v };
  }

  function sampleStaffOptions(list) {
    if (!list) return { present: false };
    if (Array.isArray(list)) {
      const first = list[0];
      const names = list.slice(0, 8).map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return redact(item);
        if (typeof item === 'object')
          return redact(item.label || item.name || item.displayName || item.fullName || '');
        return '';
      });
      return {
        present: true,
        kind: 'array',
        length: list.length,
        firstKeys: first && typeof first === 'object' ? Object.keys(first).slice(0, 16) : typeof first,
        nameSamples: names.filter(Boolean),
      };
    }
    if (typeof list === 'object') {
      const keys = Object.keys(list);
      return {
        present: true,
        kind: 'object',
        keyCount: keys.length,
        firstKeys: keys.slice(0, 8),
        nestedStaff: Array.isArray(list.staff),
        nestedOptions: Array.isArray(list.options),
      };
    }
    return { present: true, kind: typeof list };
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
        if (/request|order|assign|status|clinician|gp|owner/i.test(k)) {
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
  const m = location.pathname.match(/^\/?([0-9a-z]{2,})\/tasks\/(?:data\/)?([^/]+)\/task-list/i);
  out.context = {
    siteId: (m && m[1]) || parts[0] || null,
    slug: (m && m[2]) || null,
    pageWorldBridge: !!window.__chPageWorld,
  };

  function dump() {
    const existing = document.getElementById('__lacCapBox');
    if (existing) {
      const ta0 = existing.querySelector('textarea');
      if (ta0) ta0.value = JSON.stringify(out, null, 2);
      window.__lacCapture = out;
      return;
    }
    const wrap = document.createElement('div');
    wrap.id = '__lacCapBox';
    wrap.style.cssText =
      'position:fixed;right:16px;bottom:16px;width:360px;height:200px;z-index:2147483647;background:#fff;border:2px solid #1e3a5f;border-radius:8px;padding:8px;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.4)';
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
      'Read-only listener. Reassign one result in Medicus if you want the write path recorded, then Copy.';
    bar.append(cp, cl, note);
    wrap.append(bar, ta);
    document.body.appendChild(wrap);
    window.__lacCapture = out;
  }

  const ctx = out.context || {};
  if (ctx.siteId && ctx.slug) {
    fetch('https://' + ctx.siteId + '.api.' + location.host + '/tasks/data/' + ctx.slug + '/task-list', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then((r) => r.json())
      .then((j) => {
        const items = (j && (j.tasks || j.data || j.results || j.rows)) || (Array.isArray(j) ? j : []);
        const arr = Array.isArray(items) ? items : items.tasks || [];
        out.taskList = {
          envelopeKeys: j && typeof j === 'object' ? Object.keys(j) : [],
          count: Array.isArray(arr) ? arr.length : 0,
          first: Array.isArray(arr) && arr[0] ? sampleTask(arr[0]) : null,
          assignedTo: Array.isArray(arr) && arr[0] ? describeAssignee(arr[0].assignedTo) : null,
          requestedBy: Array.isArray(arr) && arr[0] ? describeAssignee(arr[0].requestedBy) : null,
          assigneeMix: Array.isArray(arr)
            ? arr.slice(0, 12).map((row) => describeAssignee(row && row.assignedTo))
            : [],
          filters: j && j.filters ? Object.keys(j.filters) : [],
        };
        const first = Array.isArray(arr) ? arr[0] : null;
        const api = 'https://' + ctx.siteId + '.api.' + location.host;
        const now = new Date();
        const today =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0');
        const bookP = fetch(
          api +
            '/scheduling/data/appointment-book/embedded-overview?date=' +
            today +
            '&filterByUsualLocation=false',
          { credentials: 'include', headers: { Accept: 'application/json' } }
        )
          .then((r) => r.json())
          .then((b) => {
            const root = b && b.data && (b.data.staffOptions || b.data.staffSchedules) ? b.data : b;
            out.todayBook = {
              rootKeys: root && typeof root === 'object' ? Object.keys(root).slice(0, 30) : [],
              staffOptions: sampleStaffOptions(root && root.staffOptions),
              teamOptions: sampleStaffOptions(root && root.teamOptions),
              staffScheduleCount: Array.isArray(root && root.staffSchedules) ? root.staffSchedules.length : 0,
              inTodayNames: Array.isArray(root && root.staffSchedules)
                ? root.staffSchedules.slice(0, 12).map((s) => redact(s && s.name))
                : [],
            };
            dump();
          })
          .catch((e) => {
            out.todayBook = { fetchError: String(e) };
            dump();
          });
        const ov =
          first && typeof first.overviewURL === 'string' && first.overviewURL.indexOf('/tasks/data/') === 0
            ? first.overviewURL
            : null;
        if (!ov) {
          dump();
          return bookP;
        }
        return Promise.all([
          bookP,
          fetch(api + ov, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
          })
            .then((r) => r.json())
            .then((ovj) => {
              out.overview = {
                keys: ovj && ovj.data ? Object.keys(ovj.data) : ovj ? Object.keys(ovj) : [],
                requesterShaped: requesterShaped(ovj),
                assigneeOptionsStaff: sampleStaffOptions(
                  ovj && ovj.assigneeOptions && ovj.assigneeOptions.staff
                    ? ovj.assigneeOptions.staff
                    : ovj && ovj.data && ovj.data.assigneeOptions && ovj.data.assigneeOptions.staff
                ),
              };
              dump();
            }),
        ]);
      })
      .catch((e) => {
        out.taskList = { fetchError: String(e) };
        dump();
      });
  } else {
    out.taskList = { skipped: 'open the investigation-results task-list first' };
    dump();
  }
})();
