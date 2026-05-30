// Medicus Suite — Offscreen PDF text extractor
//
// Runs PDF.js (vendored UMD legacy build, exposes `pdfjsLib`) inside an
// offscreen document because a MV3 service worker cannot reliably run PDF.js
// (it needs DOM/worker primitives).
//
// Contract: listens for runtime messages of shape
//   { target: 'offscreen', type: 'extractPdf', b64: string }
// (PDF bytes are base64-encoded because chrome.runtime.sendMessage
//  JSON-serializes its payload and would otherwise drop an ArrayBuffer)
// and replies with
//   { ok: true, text }            on success (text may be '' for image-only PDFs)
//   { ok: false, error: string }  on failure
// Never throws across the message boundary.
//
// Privacy: PDF bytes and extracted text are processed transiently in memory and
// never persisted or sent anywhere.

'use strict';

const MAX_PAGES = 15;        // extract up to the first ~15 pages
const MAX_CHARS = 60000;     // cap total extracted text

// Configure the PDF.js worker to load from the extension's packaged vendor file.
try {
  if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      chrome.runtime.getURL('vendor/pdf.worker.min.js');
  }
} catch (e) {
  // If this fails, extraction will fail gracefully and report ok:false below.
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function extractPdfText(b64) {
  if (typeof pdfjsLib === 'undefined') {
    return { ok: false, error: 'pdfjsLib not loaded' };
  }
  if (!b64 || typeof b64 !== 'string') {
    return { ok: false, error: 'no bytes' };
  }

  let pdf = null;
  try {
    let data;
    try { data = base64ToBytes(b64); } catch (e) { return { ok: false, error: 'bad base64' }; }
    if (!data.length) return { ok: false, error: 'no bytes' };
    const loadingTask = pdfjsLib.getDocument({
      data,
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false,
    });
    pdf = await loadingTask.promise;

    const pageCount = Math.min(pdf.numPages || 0, MAX_PAGES);
    const chunks = [];
    let total = 0;

    for (let i = 1; i <= pageCount; i++) {
      if (total >= MAX_CHARS) break;
      let page = null;
      try {
        page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = (content.items || [])
          .map(it => (it && typeof it.str === 'string') ? it.str : '')
          .join(' ');
        if (pageText) {
          chunks.push(pageText);
          total += pageText.length;
        }
      } catch (pageErr) {
        // Skip an unreadable page, keep going.
      } finally {
        try { if (page && page.cleanup) page.cleanup(); } catch (_) {}
      }
    }

    let text = chunks.join('\n');
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: (e && e.message) ? e.message : String(e) };
  } finally {
    try { if (pdf && pdf.destroy) await pdf.destroy(); } catch (_) {}
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen' || msg.type !== 'extractPdf') return;
  // Wrap everything so we never throw across the message boundary.
  Promise.resolve()
    .then(() => extractPdfText(msg.b64))
    .then(result => sendResponse(result))
    .catch(err => sendResponse({ ok: false, error: (err && err.message) || String(err) }));
  return true; // keep the channel open for the async reply
});
