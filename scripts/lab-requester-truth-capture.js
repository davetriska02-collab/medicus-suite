// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — lab REQUESTER TRUTH capture (READ-ONLY).
//
// Dev / onboarding tool. NOT shipped. Paste into the PAGE console on:
//   A) an open Review Investigation Report (the result), or
//   B) an open investigation request (the order — tags / Requested by).
//
// Why this exists: the Investigation Results list (and therefore the
// allocation canvas) often attributes a result to the wrong requester.
// The true name is on the result's Outstanding Investigation Requests
// card (`Panel (Dr Name • date)`) and on the investigation-request
// itself. Canvas currently trusts task-list `requestedBy` and skips the
// overview when that field is present — so list and truth can disagree.
//
// Dumps, patient identifiers redacted, clinician names kept (we need
// them to compare):
//   1. OIR card rows parsed from the DOM (panel / requester / date)
//   2. Visible "Requested by" / tag / chip text on the page
//   3. This task's list-row `requestedBy` (what canvas groups by)
//   4. Overview JSON requester-shaped paths (lab/org vs GP), no result VALUES
//   5. Any investigation-request overview the page actually GETs while
//      this is armed (click through to the request after pasting)
//
// Does not invent a write slug. Does not POST.

/* eslint-disable */
(() => {
  const alreadyArmed = !!window.__lrtArmed;
  window.__lrtArmed = true;

  const MONTHS = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  const REQUESTER_KEY_RE =
    /^(requestedby|requestedbyname|requestedbydisplayname|requestingclinician|requestingclinicianname|requestingpractitioner|requestinguser|requestedbyuser|requestingdoctor|orderedby|orderedbyname|orderedbyclinician|requestor|requester)$/i;
  const SKIP_WALK_RE = /resultvalue|resulttext|previousresults|referenceranges|nhsnumber|dateofbirth/i;
  const PHI_KEY_RE = /patient|nhs|dob|dateofbirth|resultvalue|resulttext|address|postcode|phone|email/i;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const redact = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim().slice(0, 120));
  const clip = (s, n) => {
    const t = redact(s);
    return t.length > n ? t.slice(0, n) : t;
  };

  function parseRequestLabel(text) {
    const raw = text == null ? '' : String(text).replace(/\s+/g, ' ').trim();
    const out = { name: null, requester: null, requestedDate: null, raw: raw.slice(0, 160) };
    if (!raw) return out;
    const open = raw.lastIndexOf('(');
    if (open > 0) {
      out.name = raw.slice(0, open).trim() || null;
      const inner = raw.slice(open + 1).replace(/\)\s*$/, '');
      const bullet = inner.indexOf('•') !== -1 ? inner.indexOf('•') : inner.indexOf('·');
      out.requester = (bullet !== -1 ? inner.slice(0, bullet) : inner).trim() || null;
      const dm = inner.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
      if (dm) {
        const mon = MONTHS[dm[2].toLowerCase()];
        if (mon) out.requestedDate = dm[3] + '-' + mon + '-' + dm[1].padStart(2, '0');
      }
    } else {
      out.name = raw;
    }
    return out;
  }

  function isOrgRequester(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    return !!(v.organisationName || v.organisationOdsCode);
  }

  function nameFromUnknown(v) {
    if (typeof v === 'string') return clip(v, 80) || null;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const cand = v.name || v.displayName || v.fullName || v.label || v.value;
      return typeof cand === 'string' ? clip(cand, 80) || null : null;
    }
    return null;
  }

  const out = {
    capturedAt: new Date().toISOString(),
    url: location.href,
    host: location.host,
    page: null,
    oirDom: [],
    pageTags: [],
    listRow: null,
    overview: null,
    oirOptions: null,
    reportRequester: null,
    requestGets: [],
    verdict: null,
  };

  const parts = location.pathname.split('/').filter(Boolean);
  const taskOv = location.pathname.match(/\/tasks\/(?:data\/)?([^/]+)\/overview\/([^/]+)/i);
  const taskList = location.pathname.match(/\/tasks\/(?:data\/)?([^/]+)\/task-list/i);
  const reqOv = location.pathname.match(/\/(?:clinical\/)?(?:data\/)?investigation-request\/overview\/([^/]+)/i);
  const siteId = parts[0] && /^[0-9a-z]{2,}$/i.test(parts[0]) ? parts[0] : null;
  const qs = new URLSearchParams(location.search);
  const listSlug = qs.get('taskList') || (taskList && taskList[1]) || null;
  out.page = {
    siteId: siteId,
    kind: taskOv ? 'result-overview' : reqOv ? 'request-overview' : taskList ? 'results-list' : 'other',
    slug: (taskOv && taskOv[1]) || (taskList && taskList[1]) || null,
    listSlug: listSlug,
    taskId: (taskOv && taskOv[2]) || null,
    requestId: (reqOv && reqOv[1]) || null,
  };

  function readOirDom() {
    const card = document.querySelector('[data-testid="test-outstanding-investigation-requests"]');
    if (!card) return [];
    const rows = [];
    const mBoxes = card.querySelectorAll('label.m-checkbox');
    if (mBoxes.length) {
      mBoxes.forEach((labelEl) => {
        const spanEl = labelEl.querySelector('.checkbox-label');
        const label = (spanEl ? spanEl.textContent : labelEl.textContent).replace(/\s+/g, ' ').trim();
        rows.push(parseRequestLabel(label));
      });
      return rows;
    }
    card.querySelectorAll('.q-checkbox').forEach((box) => {
      let label = '';
      const id = box.getAttribute('aria-labelledby');
      if (id) {
        id.split(/\s+/).forEach((one) => {
          const el = one && document.getElementById(one);
          if (el) label += (label ? ' ' : '') + el.textContent;
        });
      }
      if (!label) label = box.textContent || '';
      rows.push(parseRequestLabel(label.replace(/\s+/g, ' ').trim()));
    });
    return rows;
  }

  function readPageTags() {
    const hits = [];
    const seen = new Set();
    function add(kind, text, extra) {
      const t = redact(text);
      if (!t || t.length < 3) return;
      const key = kind + '|' + t;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push(Object.assign({ kind: kind, text: t }, extra || {}));
    }

    document.querySelectorAll('dt, th, .q-field__label, label, [class*="label"]').forEach((el) => {
      const lab = redact(el.textContent);
      if (!/request(ed)?\s*by|ordered\s*by|requestor|requester/i.test(lab)) return;
      let val = '';
      const dd = el.tagName === 'DT' ? el.nextElementSibling : null;
      if (dd) val = redact(dd.textContent);
      else {
        const field = el.closest('.q-field, .m-field, tr, li, div');
        if (field) val = redact(field.textContent).replace(lab, '').trim();
      }
      add('labelled', val || lab, { label: lab.slice(0, 40) });
    });

    document
      .querySelectorAll('.q-chip, .m-chip, .m-tag, [class*="chip"], [class*="tag"], [class*="badge"]')
      .forEach((el) => {
        const t = redact(el.textContent);
        if (!t || t.length > 80) return;
        if (!/\b(dr|prof|mr|mrs|ms)\b|\b(requested|ordered)\b/i.test(t) && !/^[A-Z][A-Z' -]+ [A-Z]$/.test(t)) return;
        add('chip', t);
      });

    return hits.slice(0, 40);
  }

  function walkRequester(payload) {
    const hits = [];
    function walk(node, path, depth) {
      if (!node || typeof node !== 'object' || depth > 8 || hits.length > 80) return;
      if (Array.isArray(node)) {
        node.slice(0, 40).forEach((x, i) => {
          if (typeof x === 'string' && (x.indexOf('•') !== -1 || x.indexOf('·') !== -1)) {
            const parsed = parseRequestLabel(x);
            if (parsed.requester)
              hits.push({
                path: path + '[' + i + ']',
                kind: 'oir-label',
                name: parsed.requester,
                panel: parsed.name,
                date: parsed.requestedDate,
              });
          } else {
            walk(x, path + '[' + i + ']', depth + 1);
          }
        });
        return;
      }
      Object.keys(node).forEach((k) => {
        if (SKIP_WALK_RE.test(k) || PHI_KEY_RE.test(k)) return;
        if (/assigneeoptions/i.test(path + '.' + k)) return;
        const v = node[k];
        if (REQUESTER_KEY_RE.test(k)) {
          hits.push({
            path: path + '.' + k,
            kind: isOrgRequester(v) ? 'lab-org' : 'requester-field',
            name: nameFromUnknown(v),
            keys: v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).slice(0, 10) : undefined,
          });
          return;
        }
        if (/requestingorganisation|organisationname/i.test(k) && typeof v === 'string') {
          hits.push({ path: path + '.' + k, kind: 'org', name: clip(v, 80) });
          return;
        }
        walk(v, path + '.' + k, depth + 1);
      });
    }
    walk(payload, 'root', 0);
    return hits;
  }

  function sampleEnvelope(payload) {
    if (!payload || typeof payload !== 'object') return { keys: [] };
    const root = payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const keys = Object.keys(root).slice(0, 40);
    const keep = {};
    keys.forEach((k) => {
      if (PHI_KEY_RE.test(k)) {
        keep[k] = '[redacted]';
        return;
      }
      const v = root[k];
      if (v == null || typeof v === 'number' || typeof v === 'boolean') keep[k] = v;
      else if (typeof v === 'string') keep[k] = clip(v, 80);
      else if (Array.isArray(v)) keep[k] = '[array ' + v.length + ']';
      else keep[k] = '{keys:' + Object.keys(v).slice(0, 12).join(',') + '}';
    });
    return { keys: keys, sample: keep };
  }

  function sampleOirOptions(payload) {
    const root = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const opts = root && root.outstandingInvestigationRequestOptions;
    if (opts == null) return { present: false };
    if (typeof opts === 'string') return { present: true, type: 'string', parsed: parseRequestLabel(opts) };
    if (!Array.isArray(opts)) {
      return {
        present: true,
        type: typeof opts,
        keys: opts && typeof opts === 'object' ? Object.keys(opts).slice(0, 20) : [],
      };
    }
    return {
      present: true,
      type: 'array',
      count: opts.length,
      items: opts.slice(0, 12).map((item) => {
        if (typeof item === 'string') return parseRequestLabel(item);
        if (!item || typeof item !== 'object') return { type: typeof item };
        const keys = Object.keys(item);
        const keep = {};
        keys.forEach((k) => {
          if (PHI_KEY_RE.test(k)) {
            keep[k] = '[redacted]';
            return;
          }
          const v = item[k];
          if (v == null || typeof v === 'number' || typeof v === 'boolean') keep[k] = v;
          else if (typeof v === 'string') {
            keep[k] = clip(v, 160);
            if (v.indexOf('•') !== -1 || v.indexOf('·') !== -1) keep.parsed = parseRequestLabel(v);
          } else if (Array.isArray(v)) keep[k] = '[array ' + v.length + ']';
          else keep[k] = '{keys:' + Object.keys(v).slice(0, 12).join(',') + '}';
        });
        return { keys: keys, sample: keep };
      }),
    };
  }

  function sampleReportRequester(payload) {
    const root = payload && payload.data && typeof payload.data === 'object' ? payload.data : payload;
    const r = root && root.investigationReport && root.investigationReport.requester;
    if (r == null) return null;
    if (typeof r === 'string') return { practitionerName: clip(r, 80), isOrg: false };
    return {
      organisationName: typeof r.organisationName === 'string' ? clip(r.organisationName, 80) : null,
      departmentName: typeof r.departmentName === 'string' ? clip(r.departmentName, 80) : null,
      practitionerName: typeof r.practitionerName === 'string' ? clip(r.practitionerName, 80) : nameFromUnknown(r),
      isOrg: isOrgRequester(r),
    };
  }

  function uniqueNames(list) {
    const outNames = [];
    (list || []).forEach((n) => {
      const s = String(n || '').trim();
      if (!s) return;
      if (outNames.some((x) => x.toLowerCase() === s.toLowerCase())) return;
      outNames.push(s);
    });
    return outNames;
  }

  function buildVerdict() {
    const oir = uniqueNames((out.oirDom || []).map((r) => r.requester));
    const listName = out.listRow && out.listRow.requestedBy ? String(out.listRow.requestedBy) : null;
    const headerName =
      (out.reportRequester && out.reportRequester.practitionerName) ||
      ((out.pageTags || []).find((t) => t.label && /requested by/i.test(t.label)) || {}).text ||
      null;
    const gpHits = (out.overview && out.overview.requesterShaped ? out.overview.requesterShaped : [])
      .filter((h) => h.kind === 'requester-field' || h.kind === 'oir-label')
      .map((h) => h.name);
    const requestHits = [];
    (out.requestGets || []).forEach((g) => {
      (g.requesterShaped || []).forEach((h) => {
        if (h.kind === 'requester-field' || h.kind === 'oir-label') requestHits.push(h.name);
      });
      if (g.requestedBy) requestHits.push(g.requestedBy);
    });
    const tagNames = (out.pageTags || [])
      .map((t) => t.text)
      .filter((t) => /\b(dr|prof)\b/i.test(t) || /^[A-Z][A-Z' -]+ [A-Z]$/.test(t));
    const truth = uniqueNames(oir.concat(requestHits).concat(tagNames));
    const overviewGp = uniqueNames(gpHits);
    let agree = null;
    if (listName && truth.length) {
      const ln = listName.toLowerCase();
      agree = truth.some((t) => {
        const a = t.toLowerCase();
        return a === ln || a.indexOf(ln) !== -1 || ln.indexOf(a) !== -1;
      });
    }
    let headerAgrees = null;
    if (headerName && oir.length) {
      const hn = headerName.toLowerCase();
      headerAgrees = oir.some((t) => {
        const a = t.toLowerCase();
        return a === hn || hn.indexOf(a) !== -1 || a.indexOf(hn) !== -1;
      });
    }
    return {
      listRequestedBy: listName,
      reportHeaderRequester: headerName,
      oirRequesters: oir,
      overviewGpRequesters: overviewGp,
      requestRequesters: uniqueNames(requestHits),
      pageTagClinicians: uniqueNames(tagNames),
      listAgreesWithOirOrRequest: agree,
      headerAgreesWithOir: headerAgrees,
      mixedOirRequesters: oir.length > 1,
      note:
        headerAgrees === false
          ? 'Result header Requested by is the lab/org practitioner, not the OIR GP. Canvas must use OIR / outstandingInvestigationRequestOptions, never investigationReport.requester.'
          : agree === false
            ? 'List/canvas requestedBy disagrees with the result/request tags. That is the bug.'
            : agree === true
              ? 'List/canvas requestedBy matches the tags on this example.'
              : oir.length
                ? 'OIR tags present. List row not found — still useful; paste the dump.'
                : 'No OIR tags on this page. Open the result (or the request) and re-run, or click through while this panel is armed.',
    };
  }

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
    out.oirDom = readOirDom();
    out.pageTags = readPageTags();
    out.verdict = buildVerdict();
    window.__lrtCapture = out;
    const json = JSON.stringify(out, null, 2);
    const existing = document.getElementById('__lrtCapBox');
    if (existing) {
      const ta = existing.querySelector('textarea');
      if (ta) ta.value = json;
      const note = existing.querySelector('[data-lrt-note]');
      if (note) note.textContent = (out.verdict && out.verdict.note) || 'Armed.';
      return;
    }
    const wrap = document.createElement('div');
    wrap.id = '__lrtCapBox';
    wrap.style.cssText =
      'position:fixed;right:16px;bottom:16px;width:420px;height:240px;z-index:2147483647;background:#fff;border:2px solid #1e3a5f;border-radius:8px;padding:8px;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.4)';
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
    note.setAttribute('data-lrt-note', '1');
    note.style.cssText = 'font:11px system-ui;color:#555;flex:1';
    note.textContent = 'Armed. Open the request if needed — drag this bar.';
    bar.append(cp, cl, note);
    wrap.append(bar, ta);
    document.body.appendChild(wrap);
    makeDraggable(wrap, bar);
  }

  const apiHost = siteId ? siteId + '.api.' + location.host : null;
  function fetchJson(path) {
    if (!apiHost) return Promise.reject(new Error('no siteId'));
    const p = path.charAt(0) === '/' ? path : '/' + path;
    return fetch('https://' + apiHost + p, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + p);
      return r.json();
    });
  }

  function describeRequestPayload(payload, url) {
    const shaped = walkRequester(payload);
    const requestedByHit = shaped.find(
      (h) => h.kind === 'requester-field' && /requestedby$/i.test(h.path.split('.').pop() || '')
    );
    return {
      url: String(url || '').slice(0, 240),
      at: new Date().toISOString(),
      envelope: sampleEnvelope(payload),
      requesterShaped: shaped,
      requestedBy: requestedByHit ? requestedByHit.name : null,
    };
  }

  function absorbRequestGet(url, payload) {
    if (!payload) return;
    out.requestGets.push(describeRequestPayload(payload, url));
    if (out.requestGets.length > 8) out.requestGets = out.requestGets.slice(-8);
    dump();
  }

  function tapNetwork() {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (url, init) {
        const u = typeof url === 'string' ? url : url && url.url;
        const method = String((init && init.method) || 'GET').toUpperCase();
        const p = origFetch.apply(this, arguments);
        if (method === 'GET' && /investigation-request/i.test(String(u || ''))) {
          p.then((r) => r.clone().json())
            .then((j) => absorbRequestGet(u, j))
            .catch(() => {});
        }
        return p;
      };
    }
    const OrigXHR = window.XMLHttpRequest;
    if (OrigXHR && OrigXHR.prototype) {
      const open = OrigXHR.prototype.open;
      const send = OrigXHR.prototype.send;
      OrigXHR.prototype.open = function (method, url) {
        this.__lrtMethod = String(method || 'GET').toUpperCase();
        this.__lrtUrl = url;
        return open.apply(this, arguments);
      };
      OrigXHR.prototype.send = function () {
        this.addEventListener('load', function () {
          try {
            if (this.__lrtMethod === 'GET' && /investigation-request/i.test(String(this.__lrtUrl || ''))) {
              absorbRequestGet(this.__lrtUrl, JSON.parse(this.responseText));
            }
          } catch (_) {}
        });
        return send.apply(this, arguments);
      };
    }
  }

  function listRowFor(taskId, slug) {
    if (!taskId || !slug) return Promise.resolve(null);
    return fetchJson('/tasks/data/' + slug + '/task-list').then((j) => {
      const items = (j && (j.tasks || j.data || j.results || j.rows)) || (Array.isArray(j) ? j : []);
      const arr = Array.isArray(items) ? items : items.tasks || [];
      const row = arr.find((x) => x && (x.id === taskId || x.taskUuid === taskId || x.taskId === taskId));
      if (!row) return { found: false, listCount: arr.length };
      const keep = {
        found: true,
        requestedBy: nameFromUnknown(row.requestedBy) || (typeof row.requestedBy === 'string' ? row.requestedBy : null),
        namedGp: typeof row.namedGp === 'string' ? clip(row.namedGp, 80) : nameFromUnknown(row.namedGp),
        assignedTo: typeof row.assignedTo === 'string' ? clip(row.assignedTo, 80) : nameFromUnknown(row.assignedTo),
        summary: clip(row.investigations || row.summary || row.summaryLabel || '', 120),
        id: UUID_RE.test(String(row.id || '')) ? row.id : '[id]',
        requestShapedKeys: Object.keys(row).filter((k) => /request|order|clinician|gp/i.test(k)),
      };
      return keep;
    });
  }

  if (!alreadyArmed) tapNetwork();
  out.oirDom = readOirDom();
  out.pageTags = readPageTags();
  dump();

  const jobs = [];

  if (out.page.kind === 'result-overview' && out.page.slug && out.page.taskId) {
    jobs.push(
      fetchJson('/tasks/data/' + out.page.slug + '/overview/' + out.page.taskId)
        .then((j) => {
          out.overview = {
            envelope: sampleEnvelope(j),
            requesterShaped: walkRequester(j),
          };
          out.oirOptions = sampleOirOptions(j);
          out.reportRequester = sampleReportRequester(j);
        })
        .catch((e) => {
          out.overview = { fetchError: String(e) };
        })
    );
    jobs.push(
      listRowFor(out.page.taskId, out.page.listSlug || out.page.slug)
        .then((row) => {
          out.listRow = row;
        })
        .catch((e) => {
          out.listRow = { fetchError: String(e) };
        })
    );
  } else if (out.page.kind === 'request-overview') {
    // Only rewrite the URL we are already on. Do not invent a sibling slug.
    let pagePath = location.pathname.replace(/^\/[0-9a-z]+\//i, '/');
    if (/^\/clinical\/investigation-request\//i.test(pagePath) && pagePath.indexOf('/clinical/data/') === -1) {
      pagePath = pagePath.replace('/clinical/', '/clinical/data/');
    }
    if (/investigation-request\/overview/i.test(pagePath)) {
      jobs.push(
        fetchJson(pagePath)
          .then((j) => absorbRequestGet(pagePath, j))
          .catch((e) => {
            out.requestGets.push({ url: pagePath, fetchError: String(e) });
            dump();
          })
      );
    }
  } else if (out.page.kind === 'results-list' && out.page.slug) {
    jobs.push(
      fetchJson('/tasks/data/' + out.page.slug + '/task-list')
        .then((j) => {
          const items = (j && (j.tasks || j.data || j.results || j.rows)) || (Array.isArray(j) ? j : []);
          const arr = Array.isArray(items) ? items : items.tasks || [];
          out.listRow = {
            note: 'On the list — canvas already groups by requestedBy. Open a mismatched result and re-run, or click one while this is armed.',
            count: arr.length,
            sampleRequestedBy: arr.slice(0, 8).map((r) => ({
              requestedBy: nameFromUnknown(r && r.requestedBy),
              namedGp: typeof (r && r.namedGp) === 'string' ? clip(r.namedGp, 80) : nameFromUnknown(r && r.namedGp),
              summary: clip((r && (r.investigations || r.summary)) || '', 80),
            })),
          };
        })
        .catch((e) => {
          out.listRow = { fetchError: String(e) };
        })
    );
  }

  Promise.all(jobs)
    .then(() => dump())
    .catch(() => dump());
})();
