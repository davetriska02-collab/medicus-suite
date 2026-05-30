/**
 * Document Body Discovery Script — paste into browser DevTools console
 * while on a Medicus document task page (/tasks/data/document/overview/UUID).
 *
 * What it does:
 *  - Intercepts window.fetch + XMLHttpRequest to log every call to the API subdomain
 *  - For JSON responses: prints top-level keys and flags any body/content/leaves fields
 *  - For binary responses: flags the URL and Content-Type (likely a PDF endpoint)
 *  - Watches the DOM for <iframe> elements whose src points to the API (PDF viewer)
 *  - Inspects the already-fetched overview JSON if the API client cached it
 *
 * How to use:
 *  1. Open a Medicus document task page
 *  2. Open DevTools (F12) → Console tab
 *  3. Paste this entire script and press Enter
 *  4. Expand/click the letter in Medicus — watch for output labelled [DocDiscover]
 *  5. Report back: which URLs fired, what Content-Type, what JSON keys appeared
 *
 * What to look for:
 *  - A URL containing /document/, /leaves/, /content/, /body/, /attachment/, /download/
 *  - A response with Content-Type: application/pdf  → binary PDF endpoint (Option B)
 *  - A JSON response with a non-empty letterLeaves / body / content field  → structured text (Option A)
 *  - A new <iframe> with a src pointing to the API  → PDF viewer (Option C)
 *  - No new network call at all, but text appears in the DOM  → lazy DOM render (Option D)
 */
(function () {
  'use strict';

  const TAG = '[DocDiscover]';
  const API_RE = /api\.(?:england\.)?medicus\.health/;

  // ---- Helpers ----

  function summarise(url, status, ct, body) {
    const group = `${TAG} ${status} ${ct.split(';')[0].trim() || '?'}  ${url}`;
    console.group(group);
    if (body && typeof body === 'object') {
      const keys = Object.keys(body);
      console.log('  top-level keys:', keys);
      // Flag fields that might carry letter content
      const interesting = ['letterLeaves', 'leaves', 'body', 'content', 'text',
                           'html', 'pages', 'attachments', 'document', 'letter',
                           'fileId', 'documentId', 'attachmentId', 'fileReference',
                           'contentUrl', 'downloadUrl', 'pdfUrl'];
      interesting.forEach(k => {
        if (body[k] !== undefined) {
          const v = body[k];
          const preview = Array.isArray(v) ? `Array(${v.length})` :
                          typeof v === 'string' ? v.slice(0, 120) :
                          JSON.stringify(v).slice(0, 120);
          console.warn(`  *** FOUND: ${k} =`, preview, '***');
        }
      });
      // Also recursively check one level into data / result / task / document
      ['data', 'result', 'task', 'document', 'overview'].forEach(wrapper => {
        if (body[wrapper] && typeof body[wrapper] === 'object') {
          const inner = body[wrapper];
          interesting.forEach(k => {
            if (inner[k] !== undefined) {
              const v = inner[k];
              const preview = Array.isArray(v) ? `Array(${v.length})` :
                              typeof v === 'string' ? v.slice(0, 120) :
                              JSON.stringify(v).slice(0, 120);
              console.warn(`  *** FOUND in .${wrapper}: ${k} =`, preview, '***');
            }
          });
        }
      });
    } else if (typeof body === 'string' && body.length > 0) {
      console.log('  text preview:', body.slice(0, 200));
    }
    console.groupEnd();
  }

  function onBinary(url, status, ct) {
    console.warn(`${TAG} *** BINARY RESPONSE — possible PDF/attachment ***`);
    console.warn(`  URL: ${url}`);
    console.warn(`  Status: ${status}  Content-Type: ${ct}`);
  }

  // ---- Fetch intercept ----
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url || String(input));
    const r = await origFetch.apply(this, [input, init]);
    if (API_RE.test(url)) {
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('application/pdf') || ct.includes('octet-stream') || ct.includes('image/')) {
        onBinary(url, r.status, ct);
      } else if (ct.includes('application/json') || ct.includes('text/')) {
        const clone = r.clone();
        clone.text().then(raw => {
          let body;
          try { body = JSON.parse(raw); } catch { body = raw; }
          summarise(url, r.status, ct, body);
        }).catch(() => {});
      } else {
        console.log(`${TAG} other response  ${r.status}  ${ct}  ${url}`);
      }
    }
    return r;
  };

  // ---- XHR intercept ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__discoverUrl = url;
    return origOpen.apply(this, [method, url, ...rest]);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (API_RE.test(this.__discoverUrl || '')) {
      const url = this.__discoverUrl;
      this.addEventListener('load', function () {
        const ct = this.getResponseHeader('content-type') || '';
        if (ct.includes('application/pdf') || ct.includes('octet-stream')) {
          onBinary(url, this.status, ct);
        } else {
          let body;
          try { body = JSON.parse(this.responseText); } catch { body = this.responseText; }
          summarise(url, this.status, ct, body);
        }
      });
    }
    return origSend.apply(this, args);
  };

  // ---- iframe watcher (PDF viewer pattern) ----
  const iframeObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const iframes = node.tagName === 'IFRAME' ? [node] : [...node.querySelectorAll('iframe')];
        iframes.forEach(f => {
          const src = f.src || f.getAttribute('src') || '';
          if (src) {
            console.warn(`${TAG} *** <iframe> added with src:`, src, '***');
          }
        });
      }
    }
  });
  iframeObserver.observe(document.body, { childList: true, subtree: true });

  // ---- Check overview JSON already in SentinelApiClient cache ----
  try {
    const AC = window.SentinelApiClient;
    if (AC) {
      const ctx = AC.detectMedicusContext(location.href);
      if (ctx?.taskUuid) {
        AC.resolveTaskToPatient(ctx.apiBase, ctx.taskTypeSlug, ctx.taskUuid).then(patientUuid => {
          console.log(`${TAG} task UUID: ${ctx.taskUuid}  type: ${ctx.taskTypeSlug}`);
          console.log(`${TAG} patient UUID: ${patientUuid || '(not yet resolved)'}`);
          console.log(`${TAG} apiBase: ${ctx.apiBase}`);
        });
      }
    }
  } catch (_) {}

  // ---- Confirm install ----
  console.log(`${TAG} Installed — fetch + XHR + iframe watching active.`);
  console.log(`${TAG} Now open or expand the document/letter in Medicus and watch for output here.`);
  console.log(`${TAG} Key things to report back:`);
  console.log(`${TAG}   • Any URL containing /document/, /leaves/, /content/, /attachment/, /download/`);
  console.log(`${TAG}   • Any *** FOUND: *** lines — these mean non-empty body/content fields`);
  console.log(`${TAG}   • Any *** BINARY RESPONSE *** or *** <iframe> *** lines`);
  console.log(`${TAG}   • If NOTHING fires after you open the letter → text is already in the DOM`);
})();
