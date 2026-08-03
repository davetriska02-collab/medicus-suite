// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Document Lens (Phase 1, display-only)
// docs/plans/DOCUMENT-CODER-2026-08-01.md §9 Phase 1 · capture contracts in
// docs/learnings-medicus-snomed-search-live.md (Q1–Q7, live-confirmed 2026-08-03).
//
// Injected beside Medicus's own "Codes & Actions" card on the document
// processing screen. Reads the open document's content (three lanes:
// Kettering clinicalReport HTML · PDF via PDF.js text layer · image/TIF =
// COULD NOT READ), runs the deterministic extraction + delta engines
// (engine/letter-extract.js, engine/letter-delta.js), and renders the
// four-state honesty card:
//
//   'not-run'          — the lens did not assess (disabled state never renders
//                        at all; this state is for sensitive-gated documents,
//                        fetch failures, PDF reader unavailable, …)
//   'could-not-read'   — content reached but no usable text (TIF/scan, garbled)
//   'nothing-anchored' — text read, no recognised section structure
//   'assessed'         — sections anchored; candidates/coverage/actions below
//
// A rendered card ALWAYS shows exactly one of these states — a blank card is
// impossible by construction (buildCardModel fails closed to 'not-run').
//
// SAFETY CONTRACT (panel P1/P4, hazards H-A/H-B/H-C/H-F):
//   · Display-only. This file performs NO writes to Medicus — no POST, no
//     click automation, no accept buttons. Coding happens in Medicus's own
//     controls or not at all.
//   · No output can express "letter fully coded" / "all clear" / "reviewed" —
//     test-document-lens.js source-greps for banned completion language.
//   · Document-borne demographics (Kettering lane) are surfaced with the
//     host's own isMatched flag; a mismatch renders a loud banner (H-B).
//   · isHiddenFromPFS documents are gated by default (H-F): state 'not-run',
//     reason 'sensitive'.
//   · Letter text never leaves the browser: engines are local, the only
//     network calls are credentialed same-origin GETs to Medicus itself.
//
// Ships DISABLED. Per-practice enable via options → documentLensConfig.
//
// Injection mechanics (CLAUDE.md composer/chip rules + Q4 capture):
//   anchor = h3[id^="heading-codes-&-actions-"] → closest('.card-body');
//   PREPEND as first child (prepended foreign nodes survive Vue's reconciler,
//   appended ones are stripped — the v3.67.0 lesson). Re-inject on every
//   observer batch, idempotently, from a per-task model cache.

(function (global) {
  'use strict';

  const STORE_KEY = 'documentLensConfig';
  const CARD_ID = 'dl-card';
  const STATES = ['not-run', 'could-not-read', 'nothing-anchored', 'assessed'];
  const MAX_PDF_PAGES = 60; // hard cap; truncation is surfaced, never silent

  const DEFAULT_CFG = Object.freeze({
    enabled: false, // ships disabled — per-practice enable (plan §9 gate)
    sensitiveGate: true, // H-F: isHiddenFromPFS documents render 'not-run'
  });

  function sanitiseConfig(raw) {
    const cfg = { ...DEFAULT_CFG };
    if (raw && typeof raw === 'object') {
      if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled;
      if (typeof raw.sensitiveGate === 'boolean') cfg.sensitiveGate = raw.sensitiveGate;
    }
    return cfg;
  }

  // ── pure: lane classification ─────────────────────────────────────────────
  // Inputs are the two live-confirmed preview payloads (learnings Parts 2–4).
  // Returns { lane, read, reason }:
  //   read ∈ 'html' (extract clinicalReport) | 'pdf' (fetch bytes → PDF.js)
  //        | 'unreadable' (could-not-read) | 'not-run' (lens-side blocker)
  function classifyKetteringLane(p) {
    if (!p || typeof p !== 'object')
      return { lane: 'kettering-unknown', read: 'not-run', reason: 'preview-unavailable' };
    if (p.isHTML && typeof p.clinicalReport === 'string' && p.clinicalReport) {
      return { lane: 'kettering-html', read: 'html', reason: null };
    }
    if (p.isPDF) return { lane: 'kettering-pdf', read: 'pdf', reason: null };
    if (p.isTIF) return { lane: 'kettering-tif', read: 'unreadable', reason: 'image-only' };
    if (p.hasContent === false) return { lane: 'kettering-nocontent', read: 'unreadable', reason: 'no-content' };
    return { lane: 'kettering-unknown', read: 'not-run', reason: 'unrecognised-content-flags' };
  }

  function classifyFileLane(p) {
    if (!p || typeof p !== 'object') return { lane: 'file-unknown', read: 'not-run', reason: 'preview-unavailable' };
    if (p.conversionFailed) return { lane: 'file-conversion-failed', read: 'unreadable', reason: 'conversion-failed' };
    if (p.conversionInProgress) return { lane: 'file-converting', read: 'not-run', reason: 'conversion-in-progress' };
    if (p.rendersAsPdf) return { lane: 'file-pdf', read: 'pdf', reason: null };
    return { lane: 'file-other', read: 'unreadable', reason: 'no-pdf-rendering' };
  }

  // ── pure: HTML → line-preserving text ─────────────────────────────────────
  // The extractor is line-anchored, so block boundaries must become newlines
  // BEFORE tags are stripped. DOMParser decodes entities when available
  // (browser); the regex fallback keeps Node tests dependency-free.
  const BLOCK_BREAK_RE = /<(?:br\s*\/?|\/p|\/div|\/li|\/tr|\/h[1-6]|\/table|\/section|\/header)>/gi;

  function htmlToText(html) {
    const withBreaks = String(html || '').replace(BLOCK_BREAK_RE, (m) => `${m}\n`);
    if (typeof DOMParser !== 'undefined') {
      try {
        const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
        doc.querySelectorAll('script,style').forEach((n) => n.remove());
        return (doc.body ? doc.body.textContent : '') || '';
      } catch (e) {
        /* fall through to regex path */
      }
    }
    return withBreaks
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"');
  }

  // ── pure: deep flag search ────────────────────────────────────────────────
  // Overview payload paths are not contractually pinned for every field, so
  // boolean sensitivity/match flags are located by key wherever they live.
  function deepFindFlag(obj, key, depth) {
    if (depth === undefined) depth = 6;
    if (!obj || typeof obj !== 'object' || depth < 0) return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key) && typeof obj[key] === 'boolean') return obj[key];
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (v && typeof v === 'object') {
        const found = deepFindFlag(v, key, depth - 1);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  // ── pure: the card model (fail-closed) ────────────────────────────────────
  // Collapses everything the pipeline produced into exactly one renderable
  // state. ANY input — nulls, junk, partial fetches — yields a valid model:
  // when nothing else fits, the answer is 'not-run', loudly.
  function buildCardModel(input) {
    const src = input && typeof input === 'object' ? input : {};
    const model = {
      state: 'not-run',
      reason: 'internal-error',
      lane: typeof src.lane === 'string' ? src.lane : null,
      truncatedPages: src.truncatedPages || null, // {assessed, total} when PDF page cap hit
      demographics: null, // {patientName, nhsNumber, isMatched} — Kettering lane only
      assessment: null, // engine output when state is nothing-anchored/assessed
      delta: null, // per-offered-candidate verdicts, or null
      deltaUnavailable: null, // reason string when comparison could not run
    };

    if (src.demographics && typeof src.demographics === 'object') {
      model.demographics = {
        patientName: typeof src.demographics.patientName === 'string' ? src.demographics.patientName : null,
        nhsNumber: typeof src.demographics.nhsNumber === 'string' ? src.demographics.nhsNumber : null,
        isMatched: typeof src.demographics.isMatched === 'boolean' ? src.demographics.isMatched : null,
      };
    }

    if (src.sensitiveGated === true) {
      model.state = 'not-run';
      model.reason = 'sensitive';
      return model;
    }
    if (typeof src.failReason === 'string' && src.failReason) {
      model.state = 'not-run';
      model.reason = src.failReason;
      return model;
    }
    if (typeof src.unreadableReason === 'string' && src.unreadableReason) {
      model.state = 'could-not-read';
      model.reason = src.unreadableReason;
      return model;
    }

    const a = src.assessment;
    if (a && typeof a === 'object' && STATES.includes(a.state) && a.state !== 'not-run') {
      model.state = a.state;
      model.reason = a.reason || null;
      model.assessment = a;
      if (a.state === 'assessed') {
        if (Array.isArray(src.delta)) model.delta = src.delta;
        else
          model.deltaUnavailable =
            typeof src.deltaUnavailable === 'string' ? src.deltaUnavailable : 'comparison-not-run';
      }
      return model;
    }

    // Fail closed: nothing recognisable → 'not-run', reason 'internal-error'.
    return model;
  }

  // ── pure: render ──────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const NOT_RUN_REASONS = {
    sensitive:
      'This document is marked sensitive (hidden from patient-facing services). Document Lens is withheld by practice policy.',
    'conversion-in-progress': 'Medicus is still converting this file. Reopen the task to try again.',
    'ids-not-found': 'Could not identify the open document from this screen.',
    'overview-fetch-failed': 'Could not fetch the document details from Medicus.',
    'preview-unavailable': 'Could not fetch the document preview from Medicus.',
    'content-fetch-failed': 'Could not fetch the document content from Medicus.',
    'pdf-reader-unavailable': 'The PDF reader failed to load in this session.',
    'unrecognised-content-flags': 'Medicus served this document in a form the lens does not recognise.',
    'internal-error': 'The lens hit an internal error.',
  };

  const UNREADABLE_REASONS = {
    'image-only': 'This is an image (TIF/scan) with no text layer.',
    'no-content': 'Medicus reports no content for this document.',
    'conversion-failed': 'Medicus could not convert this file to a readable form.',
    'no-pdf-rendering': 'This file type has no readable text rendering.',
    empty: 'No text could be extracted.',
    'too-little-text': 'Almost no text could be extracted — likely a scan without a text layer.',
    'garbled-extraction': 'The extracted text is garbled — likely a scan or a broken text layer.',
    'not-prose': 'The extracted content is not readable prose.',
  };

  const STATUS_LABELS = {
    suspected: 'suspected / query',
    negated: 'ruled out',
    historical: 'historical',
    resolved: 'resolved',
    family: 'family history',
    unclassifiable: 'could not classify',
  };

  const VERDICT_LABELS = {
    'possibly-new': 'possibly new',
    'qualifier-conflict': 'qualifier differs',
    'status-conflict': 'status differs',
    'probable-match': 'probably already coded',
  };

  function demographicsHtml(model) {
    const d = model.demographics;
    if (!d || (!d.patientName && !d.nhsNumber)) return '';
    const who = [d.patientName, d.nhsNumber ? `NHS ${d.nhsNumber}` : null].filter(Boolean).map(esc).join(' · ');
    if (d.isMatched === false) {
      return (
        `<div class="dl-banner dl-banner-mismatch" role="alert">` +
        `<strong>CHECK PATIENT:</strong> the document itself names <strong>${who}</strong> ` +
        `and Medicus reports it as NOT matched to the open record. Nothing below applies until this is resolved.</div>`
      );
    }
    const matchNote =
      d.isMatched === true ? ' (Medicus reports: matched to this record)' : ' (match status not reported)';
    return `<div class="dl-demographics">Document names: ${who}${esc(matchNote)}</div>`;
  }

  function actionsHtml(actions) {
    if (!Array.isArray(actions) || !actions.length) return '';
    const rows = actions
      .map(
        (f) =>
          `<li class="dl-action"><span class="dl-action-kind">${esc(f.kind || 'action')}</span> ` +
          `<span class="dl-action-line">“${esc(f.sourceLine || f.phrase || '')}”</span></li>`
      )
      .join('');
    return (
      `<div class="dl-actions"><div class="dl-h">Action language found (escalate-only scan — check each)</div>` +
      `<ul>${rows}</ul></div>`
    );
  }

  function coverageHtml(coverage, truncatedPages) {
    if (!coverage) return '';
    const trunc = truncatedPages
      ? ` <strong>Only the first ${esc(truncatedPages.assessed)} of ${esc(truncatedPages.total)} pages were read.</strong>`
      : '';
    return (
      `<div class="dl-coverage">Anchored sections covered <strong>${esc(coverage.assessedLines)}</strong> of ` +
      `<strong>${esc(coverage.totalContentLines)}</strong> content lines` +
      `${coverage.unanchoredLines ? ` — <strong>${esc(coverage.unanchoredLines)} lines were not assessed</strong> (prose is never mined for diagnoses; read them yourself)` : ''}.${trunc}</div>`
    );
  }

  function conflictText(conflict) {
    if (!conflict || typeof conflict !== 'object') return '';
    if (conflict.kind === 'stage')
      return `stage: letter says ${esc(conflict.letter)}, record says ${esc(conflict.record)}`;
    if (conflict.kind === 'laterality')
      return `side: letter says ${esc(conflict.letter)}, record says ${esc(conflict.record)}`;
    if (conflict.kind === 'letter-resolved-record-active') return 'letter says resolved; record still active';
    if (conflict.kind === 'letter-active-record-inactive') return 'letter says active; record has it inactive';
    return esc(conflict.kind || '');
  }

  function candidateHtml(entry) {
    const c = entry.candidate || entry;
    const verdict = entry.verdict || null;
    let verdictHtml = '';
    if (verdict) {
      const label = VERDICT_LABELS[verdict] || verdict;
      let detail = '';
      if (entry.matchedProblem && entry.matchedProblem.description) {
        detail = ` — record has “${esc(entry.matchedProblem.description)}”`;
      }
      const conf = conflictText(entry.conflict);
      if (conf) detail += ` (${conf})`;
      if (verdict === 'possibly-new' && entry.nearestMiss && entry.nearestMiss.description) {
        detail = ` — nearest coded entry: “${esc(entry.nearestMiss.description)}”`;
      }
      verdictHtml = `<span class="dl-verdict dl-verdict-${esc(verdict)}">${esc(label)}</span><span class="dl-verdict-detail">${detail}</span>`;
    }
    return (
      `<li class="dl-candidate"><span class="dl-term">${esc(c.term || '')}</span> ` +
      `<span class="dl-src">(from “${esc(c.sourceLine || c.sourceSentence || '')}”)</span> ${verdictHtml}</li>`
    );
  }

  function mentionedHtml(candidates) {
    const mentioned = (candidates || []).filter((c) => !c.offered);
    if (!mentioned.length) return '';
    const rows = mentioned
      .map((c) => {
        const label = STATUS_LABELS[c.status] || c.status;
        const ev = c.statusEvidence ? ` — trigger: “${esc(c.statusEvidence)}”` : '';
        return `<li><span class="dl-term">${esc(c.term || '')}</span> <span class="dl-status">${esc(label)}</span>${ev}</li>`;
      })
      .join('');
    return (
      `<details class="dl-mentioned"><summary>Mentioned, not offered (${mentioned.length}) — ` +
      `negated / historical / family / unclear items are never suggested</summary><ul>${rows}</ul></details>`
    );
  }

  function medsHtml(meds) {
    if (!Array.isArray(meds) || !meds.length) return '';
    const rows = meds
      .map((m) => {
        const name = m.name || '(name not parsed — read the line)';
        const dose = m.doseText ? ` ${esc(m.doseText)}` : '';
        return `<li><span class="dl-term">${esc(name)}</span>${dose} <span class="dl-status">${esc(m.change || '')}</span> <span class="dl-src">(“${esc(m.sourceLine || '')}”)</span></li>`;
      })
      .join('');
    return (
      `<div class="dl-meds"><div class="dl-h">Medication lines in the letter</div><ul>${rows}</ul>` +
      `<div class="dl-note">Not compared against the current medication record in this version — check the record yourself.</div></div>`
    );
  }

  function renderCard(rawModel) {
    const model = rawModel && STATES.includes(rawModel.state) ? rawModel : buildCardModel(null);
    const lane = model.lane ? `<span class="dl-lane">${esc(model.lane)}</span>` : '';
    let body = '';

    if (model.state === 'not-run') {
      const text = NOT_RUN_REASONS[model.reason] || `Reason: ${esc(model.reason || 'unknown')}.`;
      body =
        `<div class="dl-state dl-state-not-run"><strong>NOT ASSESSED</strong> — ${text} ` +
        `This document has not been checked by Document Lens; treat it exactly as you would without the lens.</div>`;
    } else if (model.state === 'could-not-read') {
      const text = UNREADABLE_REASONS[model.reason] || `Reason: ${esc(model.reason || 'unknown')}.`;
      body =
        `<div class="dl-state dl-state-could-not-read"><strong>COULD NOT READ</strong> — ${text} ` +
        `Nothing in this document has been assessed. Read it yourself; absence of suggestions means nothing here.</div>`;
    } else if (model.state === 'nothing-anchored') {
      const a = model.assessment || {};
      body =
        `<div class="dl-state dl-state-nothing-anchored"><strong>NO RECOGNISED SECTIONS</strong> — the text was read but no ` +
        `diagnosis/medication/plan section headings were found, so no candidates are offered. That is a statement about the ` +
        `letter's layout, not its content.</div>` +
        coverageHtml(a.coverage, model.truncatedPages) +
        actionsHtml(a.actions);
    } else {
      const a = model.assessment || {};
      const offered = (a.candidates || []).filter((c) => c.offered);
      const deltaByCandidate = new Map();
      if (Array.isArray(model.delta)) {
        model.delta.forEach((d) => {
          if (d && d.candidate) deltaByCandidate.set(d.candidate, d);
        });
      }
      const offeredRows = offered.map((c) => candidateHtml(deltaByCandidate.get(c) || { candidate: c })).join('');
      const deltaNote = model.deltaUnavailable
        ? `<div class="dl-note dl-note-warn">Comparison against the coded problem list did not run (${esc(model.deltaUnavailable)}) — verdict chips are absent, check the record yourself.</div>`
        : '';
      body =
        `<div class="dl-state dl-state-assessed"><strong>ASSESSED</strong> — anchored sections only; the coverage line below says how much of the letter that reached.</div>` +
        coverageHtml(a.coverage, model.truncatedPages) +
        actionsHtml(a.actions) +
        (offered.length
          ? `<div class="dl-offered"><div class="dl-h">Candidate diagnoses (suggestions only — you code, or nothing happens)</div><ul>${offeredRows}</ul>${deltaNote}</div>`
          : `<div class="dl-offered dl-offered-none">No active-status diagnosis candidates were found in the anchored sections. That describes what the anchors reached, not the whole letter — see the coverage line and read it yourself.</div>`) +
        mentionedHtml(a.candidates) +
        medsHtml(a.meds);
    }

    return (
      `<div class="dl-inner" data-dl-state="${esc(model.state)}">` +
      `<div class="dl-header"><span class="dl-title">Document Lens</span>${lane}<span class="dl-tag">display-only</span></div>` +
      demographicsHtml(model) +
      body +
      `<div class="dl-footer">Suggestions and flags only — this tool writes nothing and cannot say a document is finished.</div>` +
      `</div>`
    );
  }

  // ── module export (dual-mode: Node tests OR browser content script) ───────
  const api = {
    sanitiseConfig,
    classifyKetteringLane,
    classifyFileLane,
    htmlToText,
    deepFindFlag,
    buildCardModel,
    renderCard,
    _internals: { esc, STATES, DEFAULT_CFG, NOT_RUN_REASONS, UNREADABLE_REASONS },
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return; // Node test context: no DOM, no chrome — stop here.
  }
  global.SuiteDocumentLens = api;

  // ═══════════════════════════════════════════════════════════════════════════
  // Content-script runtime (browser only from here down)
  // ═══════════════════════════════════════════════════════════════════════════

  if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.storage) return;

  const Extract = global.SuiteLetterExtract;
  const Delta = global.SuiteLetterDelta;
  const Api = global.SentinelApiClient;
  const Normalisers = global.SentinelNormalisers;
  const Ledger = global.EventLedger;

  let cfg = sanitiseConfig(null);
  let _apiBase = null;

  // taskId → { model, html } (session cache; re-injection re-uses it so SPA
  // churn never re-runs the pipeline)
  const CARD_CACHE = new Map();
  const IN_FLIGHT = new Set();

  // ── id discovery: PerformanceObserver over the SPA's own API calls ────────
  // The processing screen only renders after the SPA fetches
  // /tasks/data/document/overview/{taskId}; we keep the most recent one.
  // (Confirmed technique — capture Part 1; buffered:true survives us loading
  // after the fetch happened.)
  const OVERVIEW_RE =
    /\/tasks\/data\/document\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  let _latestTaskId = null;
  let _latestTaskAt = 0;

  function noteResourceEntry(entry) {
    const m = OVERVIEW_RE.exec(entry.name || '');
    if (m && entry.startTime >= _latestTaskAt) {
      _latestTaskAt = entry.startTime;
      _latestTaskId = m[1].toLowerCase();
    }
  }

  try {
    performance.getEntriesByType('resource').forEach(noteResourceEntry);
    new PerformanceObserver((list) => list.getEntries().forEach(noteResourceEntry)).observe({
      type: 'resource',
      buffered: true,
    });
  } catch (e) {
    /* discovery degrades to ids-not-found, which renders loudly */
  }

  function apiBase() {
    if (_apiBase) return _apiBase;
    const ctx = Api && Api.detectMedicusContext ? Api.detectMedicusContext() : null;
    _apiBase = ctx && ctx.apiBase ? ctx.apiBase : null;
    return _apiBase;
  }

  async function getJson(url) {
    const res = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function getBytes(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  // ── PDF.js (lazy, extension-origin, fake-worker tolerant) ─────────────────
  let _pdfjsPromise = null;
  function getPdfjs() {
    if (_pdfjsPromise) return _pdfjsPromise;
    _pdfjsPromise = (async () => {
      const lib = await import(chrome.runtime.getURL('vendor/pdf.min.js'));
      // A real Worker from a chrome-extension:// URL is cross-origin to the
      // Medicus page, so pdf.js will fall back to its main-thread "fake
      // worker" — workerSrc must still point at the extension resource for
      // that fallback import to resolve.
      lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.js');
      return lib;
    })();
    _pdfjsPromise.catch(() => {
      _pdfjsPromise = null; // allow retry on a later document
    });
    return _pdfjsPromise;
  }

  async function pdfToText(bytes) {
    const pdfjs = await getPdfjs();
    const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const total = pdf.numPages;
    const pages = Math.min(total, MAX_PDF_PAGES);
    const out = [];
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      // Rebuild line structure from the text items: a new line when the
      // baseline (transform[5]) moves. The extractor is line-anchored, so
      // this matters more than typographic fidelity.
      let lastY = null;
      let line = [];
      const lines = [];
      for (const item of tc.items) {
        const y = item.transform ? Math.round(item.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          lines.push(line.join(''));
          line = [];
        }
        line.push(item.str);
        if (item.hasEOL) {
          lines.push(line.join(''));
          line = [];
          lastY = null;
          continue;
        }
        if (y !== null) lastY = y;
      }
      if (line.length) lines.push(line.join(''));
      out.push(lines.join('\n'));
    }
    try {
      pdf.destroy();
    } catch (e) {
      /* best-effort cleanup */
    }
    return { text: out.join('\n\n'), truncatedPages: total > pages ? { assessed: pages, total } : null };
  }

  // ── the pipeline: one document task → one card model ──────────────────────
  async function assessTask(taskId) {
    const base = apiBase();
    if (!base) return buildCardModel({ failReason: 'ids-not-found' });

    // 1 · overview → fileId/versionId (+ sensitivity flag, wherever it lives)
    let overview;
    try {
      overview = await getJson(`${base}/tasks/data/document/overview/${taskId}`);
    } catch (e) {
      return buildCardModel({ failReason: 'overview-fetch-failed' });
    }
    const data = overview && overview.data ? overview.data : overview || {};
    const fileId = data.fileId || null;
    const versionId = data.versionId || null;

    if (cfg.sensitiveGate && deepFindFlag(overview, 'isHiddenFromPFS') === true) {
      return buildCardModel({ sensitiveGated: true });
    }
    if (!fileId || !versionId) return buildCardModel({ failReason: 'ids-not-found' });

    // 2 · version preview → which lane serves the content
    let versionMeta;
    try {
      versionMeta = await getJson(`${base}/clinical/data/document/modals/version/preview/${versionId}`);
    } catch (e) {
      return buildCardModel({ failReason: 'preview-unavailable' });
    }
    const vdata = versionMeta && versionMeta.data ? versionMeta.data : versionMeta || {};
    const fileRoute = String(vdata.fileRoute || '');
    const isKettering = /kettering/i.test(fileRoute);

    let laneInfo;
    let demographics = null;
    let text = null;
    let truncatedPages = null;

    if (isKettering) {
      let preview;
      try {
        preview = await getJson(`${base}/tasks/data/document/xml/gb-nhs-kettering/document-preview/${fileId}`);
      } catch (e) {
        return buildCardModel({ failReason: 'preview-unavailable' });
      }
      const p = preview && preview.data ? preview.data : preview || {};
      demographics = { patientName: p.patientName, nhsNumber: p.nhsNumber, isMatched: p.isMatched };
      laneInfo = classifyKetteringLane(p);
      if (laneInfo.read === 'html') {
        text = htmlToText(p.clinicalReport);
      } else if (laneInfo.read === 'pdf') {
        try {
          const bytes = await getBytes(`${base}/clinical/document/xml/gb-nhs-kettering/pdf-preview/${fileId}`);
          const r = await extractPdf(bytes);
          if (r.fail) return buildCardModel({ lane: laneInfo.lane, demographics, failReason: r.fail });
          text = r.text;
          truncatedPages = r.truncatedPages;
        } catch (e) {
          return buildCardModel({ lane: laneInfo.lane, demographics, failReason: 'content-fetch-failed' });
        }
      }
    } else {
      let preview;
      try {
        preview = await getJson(`${base}/tasks/data/document/file/document-preview/${fileId}`);
      } catch (e) {
        return buildCardModel({ failReason: 'preview-unavailable' });
      }
      const p = preview && preview.data ? preview.data : preview || {};
      laneInfo = classifyFileLane(p);
      if (laneInfo.read === 'pdf') {
        try {
          const bytes = await getBytes(`${base}/clinical/document/download-file/${fileId}?convertToPDF=1`);
          const r = await extractPdf(bytes);
          if (r.fail) return buildCardModel({ lane: laneInfo.lane, failReason: r.fail });
          text = r.text;
          truncatedPages = r.truncatedPages;
        } catch (e) {
          return buildCardModel({ lane: laneInfo.lane, failReason: 'content-fetch-failed' });
        }
      }
    }

    if (laneInfo.read === 'unreadable') {
      return buildCardModel({ lane: laneInfo.lane, demographics, unreadableReason: laneInfo.reason });
    }
    if (laneInfo.read === 'not-run' || text == null) {
      return buildCardModel({
        lane: laneInfo.lane,
        demographics,
        failReason: laneInfo.reason || 'content-fetch-failed',
      });
    }

    // 3 · engines: extract, then (best-effort) delta against the coded record
    const assessment = Extract && Extract.assessLetterText ? Extract.assessLetterText(text) : null;
    if (!assessment) return buildCardModel({ lane: laneInfo.lane, demographics, failReason: 'internal-error' });

    let delta = null;
    let deltaUnavailable = null;
    const offered = (assessment.candidates || []).filter((c) => c.offered);
    if (assessment.state === 'assessed' && offered.length && Delta && Api && Normalisers) {
      try {
        const patientUuid = await Api.resolveTaskToPatient(apiBase(), 'document_task', taskId);
        if (!patientUuid) {
          deltaUnavailable = 'patient-not-resolved';
        } else {
          const listing = await Api.fetchProblemListing(apiBase(), patientUuid);
          const probs = Normalisers.normaliseProblemsAll(listing);
          const problems = [...probs.active, ...probs.past].map((p) => ({
            description: p.label,
            status: p.status,
          }));
          delta = Delta.computeDelta(offered, problems);
        }
      } catch (e) {
        deltaUnavailable = 'problem-list-fetch-failed';
      }
    } else if (assessment.state === 'assessed' && offered.length) {
      deltaUnavailable = 'comparison-not-run';
    }

    return buildCardModel({ lane: laneInfo.lane, demographics, assessment, delta, deltaUnavailable, truncatedPages });
  }

  async function extractPdf(bytes) {
    let pdfjsOk = true;
    try {
      await getPdfjs();
    } catch (e) {
      pdfjsOk = false;
    }
    if (!pdfjsOk) return { fail: 'pdf-reader-unavailable' };
    try {
      return await pdfToText(bytes);
    } catch (e) {
      // A PDF the reader cannot parse is a content problem, not a lens
      // problem — but we cannot distinguish reliably, so stay honest and
      // loud either way.
      return { fail: 'pdf-reader-unavailable' };
    }
  }

  // ── injection ──────────────────────────────────────────────────────────────
  function findAnchor() {
    let h = document.querySelector('h3[id^="heading-codes-&-actions-"]');
    if (!h) {
      h = [...document.querySelectorAll('.inline-entry-list-container header h3.heading')].find((el) =>
        /codes\s*&\s*actions/i.test(el.textContent || '')
      );
    }
    if (!h) return null;
    const host = h.closest('.card-body');
    return host ? { host } : null;
  }

  function injectCard(host, taskId, html) {
    const existing = host.querySelector(`#${CARD_ID}`);
    if (existing) {
      if (existing.getAttribute('data-dl-task') === taskId) return; // idempotent
      existing.remove(); // conveyor moved on: stale card for the previous task
    }
    const el = document.createElement('div');
    el.id = CARD_ID;
    el.className = 'dl-card';
    el.setAttribute('data-dl-task', taskId);
    el.innerHTML = html;
    // PREPEND — never append (Vue strips trailing foreign nodes; CLAUDE.md).
    host.insertBefore(el, host.firstChild);
  }

  function stampLedger(taskId, model) {
    if (!Ledger || !Ledger.record) return;
    Ledger.record(
      {
        source: 'document-lens',
        patientRef: null, // the card is per-document; no patient ref is stored
        severity: model.state,
        ruleId: model.lane || 'unknown-lane',
        label: `document-lens ${model.state}${model.reason ? ` (${model.reason})` : ''}`,
        action: 'shown',
      },
      { dedupe: true }
    );
  }

  let _refreshQueued = false;
  function refresh() {
    if (_refreshQueued) return;
    _refreshQueued = true;
    requestAnimationFrame(() => {
      _refreshQueued = false;
      if (!cfg.enabled) {
        const el = document.getElementById(CARD_ID);
        if (el) el.remove();
        return;
      }
      const anchor = findAnchor();
      if (!anchor) return;
      const taskId = _latestTaskId;
      if (!taskId) {
        injectCard(anchor.host, 'unknown', renderCard(buildCardModel({ failReason: 'ids-not-found' })));
        return;
      }
      const cached = CARD_CACHE.get(taskId);
      if (cached) {
        injectCard(anchor.host, taskId, cached.html);
        return;
      }
      if (IN_FLIGHT.has(taskId)) return;
      IN_FLIGHT.add(taskId);
      assessTask(taskId)
        .catch(() => buildCardModel({ failReason: 'internal-error' }))
        .then((model) => {
          IN_FLIGHT.delete(taskId);
          const html = renderCard(model);
          CARD_CACHE.set(taskId, { model, html });
          if (CARD_CACHE.size > 50) CARD_CACHE.delete(CARD_CACHE.keys().next().value);
          stampLedger(taskId, model);
          refresh();
        });
    });
  }

  // ── config + observer wiring ───────────────────────────────────────────────
  chrome.storage.local.get(STORE_KEY, (r) => {
    cfg = sanitiseConfig(r && r[STORE_KEY]);
    if (cfg.enabled) refresh();
  });
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORE_KEY]) {
        cfg = sanitiseConfig(changes[STORE_KEY].newValue);
        refresh();
      }
    });
  } catch (e) {
    /* storage listener unavailable: config still read once at load */
  }

  if (global.__chObserverHub) {
    global.__chObserverHub.subscribe(() => {
      if (cfg.enabled) refresh();
    });
  } else {
    try {
      new MutationObserver(() => {
        if (cfg.enabled) refresh();
      }).observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      /* no observer: the load-time refresh still ran */
    }
  }
})(typeof window !== 'undefined' ? window : global);
