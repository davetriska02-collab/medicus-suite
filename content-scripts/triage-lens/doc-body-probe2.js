/**
 * Document Body PROBE 2 — paste into DevTools console on a document task page,
 * THEN open/click into a document. This dumps the actual *values* (truncated)
 * of the two JSON fields that might carry the letter text directly, so we can
 * decide whether we need PDF.js at all.
 *
 * It captures:
 *   1. inboundMessage  (from /clinical/data/document/modals/version/preview/...)
 *      → for electronic letters this is often the plain-text covering message
 *   2. entries         (from /clinical/document/entries/...)
 *      → either structured text leaves OR just coded items
 *   3. attachment / document metadata for context
 *
 * Everything stays in YOUR browser console — nothing is sent anywhere.
 *
 * Report back: paste the [Probe2] output (you can redact patient identifiers).
 */
(function () {
  'use strict';
  const TAG = '[Probe2]';
  const API_RE = /api\.(?:england\.)?medicus\.health/;

  function dump(label, val, max = 2000) {
    if (val === undefined || val === null) { console.log(`${TAG} ${label}: (null/undefined)`); return; }
    if (typeof val === 'string') {
      console.log(`${TAG} ${label}: [string, ${val.length} chars]`);
      console.log(val.slice(0, max) + (val.length > max ? '\n…(truncated)' : ''));
    } else if (Array.isArray(val)) {
      console.log(`${TAG} ${label}: [array, ${val.length} items]`);
      console.log(JSON.stringify(val.slice(0, 5), null, 2).slice(0, max));
    } else if (typeof val === 'object') {
      console.log(`${TAG} ${label}: [object, keys: ${Object.keys(val).join(', ')}]`);
      console.log(JSON.stringify(val, null, 2).slice(0, max));
    } else {
      console.log(`${TAG} ${label}:`, val);
    }
  }

  function handle(url, body) {
    if (!body || typeof body !== 'object') return;

    // version/preview — carries inboundMessage + attachment + document
    if (/\/document\/modals\/version\/preview\//.test(url)) {
      console.group(`${TAG} === version/preview ===  ${url}`);
      dump('inboundMessage', body.inboundMessage, 4000);
      dump('attachment', body.attachment, 1500);
      dump('document', body.document, 1500);
      console.log(`${TAG} fileType=${body.fileType} fileName=${body.fileName} fileSize=${body.fileSize} fileCanExport=${body.fileCanExport}`);
      console.groupEnd();
    }

    // entries — possibly text leaves, possibly codes
    if (/\/clinical\/document\/entries\//.test(url)) {
      console.group(`${TAG} === document/entries ===  ${url}`);
      dump('entries', body.entries, 4000);
      console.groupEnd();
    }

    // file/document-preview — conversion status
    if (/\/document\/file\/document-preview\//.test(url)) {
      console.group(`${TAG} === file/document-preview ===  ${url}`);
      console.log(`${TAG}`, JSON.stringify(body, null, 2).slice(0, 1000));
      console.groupEnd();
    }
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url, ...r) { this.__u = url; return origOpen.apply(this, [m, url, ...r]); };
  XMLHttpRequest.prototype.send = function (...a) {
    if (API_RE.test(this.__u || '')) {
      const url = this.__u;
      this.addEventListener('load', function () {
        const ct = this.getResponseHeader('content-type') || '';
        if (ct.includes('json')) {
          try { handle(url, JSON.parse(this.responseText)); } catch (_) {}
        }
      });
    }
    return origSend.apply(this, a);
  };

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input?.url || String(input));
    const r = await origFetch.apply(this, [input, init]);
    if (API_RE.test(url)) {
      const ct = r.headers.get('content-type') || '';
      if (ct.includes('json')) {
        r.clone().json().then(b => handle(url, b)).catch(() => {});
      }
    }
    return r;
  };

  console.log(`${TAG} Installed. Now open/click into a document and watch for [Probe2] === ... === groups.`);
  console.log(`${TAG} Key question: does 'inboundMessage' or 'entries' contain the letter prose? If both are empty/codes-only, we need PDF.js on the download-file endpoint.`);
})();
