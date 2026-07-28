// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — "Find evidence?" widget for the Clinical Summary Allergies card.
//
// Phase 3 of docs/plans/ALLERGY-CLEANUP-2026-07-28.md, READ-ONLY VARIANT.
//
// The provenance of an allergy entry is often unknown, and frequently so is
// the reaction — a bare "Penicillin allergy" with no manifestation, a date
// that is really the GP2GP import date, recorded-by lost in transfer. The
// answer is usually somewhere in the notes. This widget puts a small
// "Find evidence?" button on each allergy row, trawls the patient journal
// with engine/allergy-evidence.js, and shows the clinician dated, attributed,
// VERBATIM snippets — plus a "Copy citation" button so the finding can be
// pasted into Medicus's own edit form BY THE CLINICIAN.
//
// ── NO WRITE PATH. AT ALL. ───────────────────────────────────────────────────
// There is deliberately no edit-allergy call, no POST, no PUT, no form
// prefill round-trip anywhere in this file — the only network call it can
// ever make is the ONE confirmed journal GET below. That is not an omission
// to be tidied up later by copying more of problem-description-cleanup.js:
// Phase 0 (docs/learnings-allergy-cleanup.md) has NOT been run, so the
// edit-allergy contract is entirely unconfirmed, and this repo's hard rule is
// "never construct a Medicus API URL from scratch — capture and replay". An
// allergy entry is also the highest-stakes record type the suite has ever
// touched (plan doc safety rules 1-5, and a HAZARD-LOG entry + CSO review are
// prerequisites for any allergy write). The clinician applies any change in
// Medicus's own UI; this tool finds, quotes, and gets out of the way.
//
// ── What is CONFIRMED, and what is a DOM GUESS ───────────────────────────────
// CONFIRMED (docs/learnings-patient-journal-api.md, live 2026-07-02 /
// 2026-07-17 — the same endpoint engine/record-duplicate-parser.js already
// consumes):
//
//   GET /clinical/data/patient-journal/overview/{patientId}
//       → { patientJournalRecords: [{ title, items: [...] }, …] } — one
//         unfiltered request returns the whole retrievable history.
//
// UNCONFIRMED, therefore DOM-DRIVEN and fail-soft (docs/learnings-allergy-cleanup.md
// §1(a) and §1(d) — Probes A and B have not been run):
//   - There is NO confirmed clinical-summary `allergies[]` array, so this
//     widget never asks for one. The allergy list is read from the rendered
//     card, exactly the way triage-lens's own decorateOneRow reads what it
//     needs from the row itself (CLAUDE.md: "DOM-driven … inherently
//     durable. This is the template; copy it").
//   - The Allergies card's markup is EXPECTED to be the problems-card shape
//     (div.m-card-v2 > … > ul > li.item > a.item__link, per
//     docs/learnings-problem-description-cleanup.md §4) but that is a guess,
//     so findAllergiesCard()/allergyRows()/rowLabel() each degrade a step at
//     a time: preferred selector → looser selector → nothing at all. If the
//     card can't be found, or a row yields no label, the widget does
//     NOTHING, silently — no console noise (the sibling widgets log nothing
//     either, and a clinical page is not the place to start), no broken
//     summary screen. Plan doc safety rule 5.
//
// ── Injection discipline (same as every other inline widget here) ────────────
// The clinical summary is Vue-rendered and strips foreign nodes on re-render,
// so: subscribe to the shared MutationObserver hub (window.__chObserverHub),
// filter out our OWN mutations, throttle at 400 ms, and re-inject on every
// tick — idempotently (the injector de-dupes against the row). All widget
// state lives in JS keyed by row, so a re-render can destroy our DOM without
// losing an open panel.
//
// ── Wording rules (plan doc, Phase 3) — enforced in panelHtml/buildCitationText ──
//   - The panel always says "Possible documented evidence — open and review
//     the source entry before changing anything".
//   - Nothing is ever phrased as "the reaction was X". Matched lexicon terms
//     are labelled as matched TERMS; the quote is the claim, not the tool.
//   - An empty result says so WITHOUT implying the allergy is wrong:
//     "Absence of evidence is not evidence the allergy is wrong" (safety
//     rule 1 — this tool never suggests removing an allergy).
//   - Evidence found inside a GP2GP transfer encounter is labelled
//     "imported via GP2GP — original authorship at previous practice", never
//     attributed to the importer.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require(),
  // same dual-context seam as content-scripts/problem-description-cleanup.js
  // and content-scripts/problem-bulk-end.js) ──────────────────────────────────

  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Human date for an evidence item: the engine's ISO `date` ("2019-03-12")
  // rendered as "12 Mar 2019", falling back to the day-group title verbatim
  // (`dateRaw`, e.g. "Tue 12 Mar 2019") when the ISO parse failed, and to an
  // explicit "an undated entry" when the payload carried no date at all —
  // never a silently blank date on a clinical citation.
  function formatEvidenceDate(item) {
    var iso = item && typeof item.date === 'string' ? item.date : null;
    var m = iso ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
    if (m) {
      var month = MONTH_NAMES[parseInt(m[2], 10) - 1];
      if (month) return parseInt(m[3], 10) + ' ' + month + ' ' + m[1];
    }
    if (item && typeof item.dateRaw === 'string' && item.dateRaw.trim()) return item.dateRaw.trim();
    return 'an undated entry';
  }

  // How an evidence item's sourceType reads in prose. Kept deliberately
  // plain — 'encounter-entry' is the engine's internal label, not something
  // to paste into a clinical record.
  function sourceTypeWord(sourceType) {
    if (sourceType === 'note') return 'note';
    if (sourceType === 'prescription') return 'prescription record';
    if (sourceType === 'document') return 'document';
    if (sourceType === 'encounter-entry') return 'consultation entry';
    return 'record entry';
  }

  // "Dr Smith, Riverside Practice" / "Dr Smith" / "Riverside Practice" / ''.
  function attributionText(item) {
    var who = item && typeof item.recordedBy === 'string' ? item.recordedBy.trim() : '';
    var org = item && typeof item.recordedByOrganisation === 'string' ? item.recordedByOrganisation.trim() : '';
    if (who && org) return who + ', ' + org;
    return who || org || '';
  }

  /**
   * buildCitationText(item) -> string
   *
   * The plain text the "Copy citation" button puts on the clipboard, e.g.
   *
   *   Reaction documented in note of 12 Mar 2019 (Dr Smith): "widespread
   *   urticarial rash after amoxicillin" — found via Medicus Suite evidence
   *   review.
   *
   * Three deliberate adaptations:
   *  - When the item matched NO reaction term, the lead reads "Mention found
   *    in …" rather than "Reaction documented in …" — claiming a documented
   *    reaction from a bare substance mention would be exactly the
   *    over-claiming the plan doc forbids.
   *  - When there is no recordedBy AND no organisation, the parenthetical is
   *    omitted entirely rather than inventing an author.
   *  - A GP2GP-imported item carries the import caveat inside the
   *    parenthetical, so the caveat travels with the text when it is pasted
   *    somewhere this widget can't see.
   *
   * The snippet's interior whitespace is collapsed to single spaces so the
   * citation is one pasteable line. That is a formatting change only — no
   * word is added, removed, reordered or reworded, so the quote stays
   * verbatim in the sense plan doc safety rule 3 requires.
   */
  function buildCitationText(item) {
    var it = item || {};
    var hasReaction = Array.isArray(it.matchedReactionTerms) && it.matchedReactionTerms.length > 0;
    var lead = hasReaction ? 'Reaction documented in ' : 'Mention found in ';
    var snippet = String(it.snippet == null ? '' : it.snippet)
      .replace(/\s+/g, ' ')
      .trim();
    var who = attributionText(it);
    var caveat = it.isGp2gpImport ? 'imported via GP2GP — original authorship at previous practice' : '';
    var bracket = '';
    if (who && caveat) bracket = ' (' + who + ' — ' + caveat + ')';
    else if (who) bracket = ' (' + who + ')';
    else if (caveat) bracket = ' (' + caveat + ')';
    return (
      lead +
      sourceTypeWord(it.sourceType) +
      ' of ' +
      formatEvidenceDate(it) +
      bracket +
      ': "' +
      snippet +
      '" — found via Medicus Suite evidence review.'
    );
  }

  /**
   * provenanceText(provenance) -> string
   *
   * The one-line "where did this allergy come from?" answer shown above the
   * evidence list. Returns '' when the engine found nothing dated — the
   * caller then renders nothing rather than an empty line.
   */
  function provenanceText(provenance) {
    if (!provenance) return '';
    var who = attributionText(provenance);
    var line = 'Earliest mention: ' + formatEvidenceDate(provenance);
    line += who ? ' — ' + who : ' — author not recorded';
    if (provenance.isGp2gpImport) {
      line += ' (imported via GP2GP — original authorship at previous practice)';
    }
    return line;
  }

  // ── Node test hook ──────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildCitationText,
      provenanceText,
      formatEvidenceDate,
      sourceTypeWord,
      attributionText,
    };
    return;
  }

  // ── Browser boot ────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msAllergyCleanup) return;
  window.__msAllergyCleanup = true;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── URL detection ───────────────────────────────────────────────────────────
  // Identical to problem-description-cleanup.js's — the widgets live on the
  // same screen, so they must agree on what "a patient record page" is.
  var RECORD_URL_RE = /\/([0-9a-f]{4,})\/(?:patient\/patient\/care-record|care-record)\/([0-9a-f-]{36})/i;

  function getPatientInfo() {
    var m = location.pathname.match(RECORD_URL_RE);
    if (!m) return null;
    return { siteId: m[1], patientId: m[2] };
  }

  // ── API (READ ONLY — one confirmed GET, nothing else) ───────────────────────

  function apiBaseUrl() {
    var info = getPatientInfo();
    var parts = location.pathname.split('/').filter(Boolean);
    var siteId = (info && info.siteId) || parts[0] || '';
    return 'https://' + siteId + '.api.' + location.hostname;
  }

  // No `opts`/method/body parameter by design: this file cannot make a
  // non-GET request even by accident.
  async function apiFetch(path) {
    var resp = await fetch(apiBaseUrl() + path, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!resp.ok) throw new Error('Could not load the patient journal (API ' + resp.status + ').');
    var text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('The patient journal returned an unexpected response.');
    }
  }

  function fetchPatientJournal(patientId) {
    return apiFetch('/clinical/data/patient-journal/overview/' + encodeURIComponent(patientId));
  }

  // One journal fetch per patient per page session, shared by every row's
  // panel — the payload is the WHOLE history (210 day-groups on the test
  // patient), so re-fetching it per click would be both slow and rude. A
  // FAILED fetch is deliberately not cached, so the panel's Retry button
  // genuinely retries instead of replaying the same rejection.
  var _journalPatientId = null;
  var _journalPromise = null;

  function loadJournal(patientId) {
    if (_journalPromise && _journalPatientId === patientId) return _journalPromise;
    var p = fetchPatientJournal(patientId).catch(function (err) {
      if (_journalPromise === p) _journalPromise = null;
      throw err;
    });
    _journalPatientId = patientId;
    _journalPromise = p;
    return p;
  }

  // ── DOM: finding the Allergies card and its rows ────────────────────────────
  // Local, per the precedent set by findProblemRow/injectRetiredWidgetTrigger
  // in problem-description-cleanup.js (small DOM finders stay in the content
  // script that uses them rather than being factored out for one call site).
  //
  // Every step here is a GUESS until Probe B of docs/learnings-allergy-cleanup.md
  // is run, so each one degrades rather than assuming:
  //   heading /allerg/i  →  .m-card-v2 ancestor  →  [class*="m-card"] ancestor
  //                      →  grandparent (only if it isn't a page-level wrapper)
  //   li.item rows       →  any innermost <li> with text
  //   a.item__link label →  any <a> in the row  →  the row's leading text
  // If any step yields nothing, findAllergiesCard() returns null and the
  // whole widget is inert for this page — no button, no panel, no log.

  // Real headings are tried FIRST and the class-based guesses only as a
  // fallback, because the loose selectors are genuinely dangerous here: an
  // ALLERGY-WORDED ROW in a different card (a problem coded "Allergic
  // rhinitis", a document titled "Allergy clinic letter") sits inside an
  // element whose class may well contain "title"/"label", and matching it
  // would resolve to the WRONG card and decorate every row in it. Candidates
  // inside a row (<li>) or inside a link are rejected for the same reason —
  // a heading is never a list item.
  var HEADING_STRICT_SELECTOR = 'h1, h2, h3, h4, h5, h6';
  var HEADING_LOOSE_SELECTOR = '[class*="title"], [class*="heading"], [class*="label"]';
  // A card heading is short ("Allergies", "Allergies (3)", "Allergies and
  // adverse reactions"). The cap stops a whole card BODY whose class happens
  // to contain "label"/"title" from being mistaken for its own heading.
  var MAX_HEADING_CHARS = 80;

  function ownNode(el) {
    return !!(el && el.closest && el.closest('.ms-alc-panel-wrap, .ms-alc-find-btn'));
  }

  // Innermost <li>s (a row, not a list wrapper) carrying visible text, and
  // never one of our own panel's nodes.
  function allergyRows(card) {
    if (!card) return [];
    var out = [];
    var lis = card.querySelectorAll('li');
    for (var i = 0; i < lis.length; i++) {
      var li = lis[i];
      if (li.querySelector('li')) continue;
      if (ownNode(li)) continue;
      if (!(li.textContent || '').trim()) continue;
      out.push(li);
    }
    return out;
  }

  function cardForHeading(h) {
    if (ownNode(h)) return null;
    if (h.closest('li') || h.closest('a')) return null;
    var text = (h.textContent || '').trim();
    if (!text || text.length > MAX_HEADING_CHARS) return null;
    if (!/allerg/i.test(text)) return null;
    var card = h.closest('.m-card-v2') || h.closest('[class*="m-card"]');
    if (!card) {
      // Last-resort ancestor guess. Rejected if it looks like a page-level
      // container (it holds card elements of its own), so a missing/renamed
      // card class can never make the whole summary screen "the Allergies
      // card" and decorate every list on it.
      var grandparent = h.parentElement && h.parentElement.parentElement;
      if (!grandparent || grandparent.querySelector('.m-card-v2, [class*="m-card"]')) return null;
      card = grandparent;
    }
    return allergyRows(card).length ? card : null;
  }

  function findAllergiesCard() {
    var passes = [HEADING_STRICT_SELECTOR, HEADING_LOOSE_SELECTOR];
    for (var p = 0; p < passes.length; p++) {
      var headings = document.querySelectorAll(passes[p]);
      for (var i = 0; i < headings.length; i++) {
        var card = cardForHeading(headings[i]);
        if (card) return card;
      }
    }
    return null;
  }

  // The row's label element: the problems-card anchor if present, else any
  // anchor, else null (the caller then reads the row's own leading text).
  // Anything of ours is excluded — see rowLabel for why that matters.
  function rowLabelElement(row) {
    var passes = ['a.item__link, a[class*="item__link"]', 'a'];
    for (var p = 0; p < passes.length; p++) {
      var candidates = row.querySelectorAll(passes[p]);
      for (var i = 0; i < candidates.length; i++) {
        if (!ownNode(candidates[i])) return candidates[i];
      }
    }
    return null;
  }

  // The allergy substance as displayed. With a label element that's simply
  // its text; without one, the row's LEADING text only — deliberately not
  // the whole row, because these rows carry a trailing date ("Jan 2004*" on
  // the problems card) which would otherwise be fed to the trawl as a search
  // term and drown the panel in noise.
  //
  // OUR OWN NODES ARE SKIPPED, and that is load-bearing rather than tidy: in
  // the no-label-element fallback the button is PREPENDED into the row, so a
  // naive "first child node with text" would read "Find evidence?" back as
  // the allergy label on the very next observer tick — the widget would
  // trawl the record for its own button text and key its state on it.
  function rowLabel(row) {
    var el = rowLabelElement(row);
    var text = '';
    if (el) {
      text = el.textContent || '';
    } else {
      var nodes = row.childNodes;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.nodeType === 1 && ownNode(n)) continue;
        var t = (n.textContent || '').trim();
        if (!t) continue;
        text = t;
        break;
      }
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, 160);
  }

  // The card's own empty-state text is a row too. "Find evidence?" on
  // "No known allergies" would be nonsense, and worse, the engine would
  // dutifully trawl the whole record for the word "known" (it strips
  // "allergies" as a generic substance word but has no reason to strip
  // that). Anchored at the start so a genuine substance can never be
  // suppressed by a word appearing later in its name.
  var EMPTY_STATE_ROW_RE =
    /^(?:nkda|nkma|no known|none known|nil known|nil recorded|no recorded|none recorded|no allergies|no drug allergies|not recorded|not known|none)\b/i;

  // A row worth offering the trawl on: real text, not the empty-state line,
  // and — when the engine is loaded — a label that actually normalises to at
  // least one substance term. That last check is exactly the engine's own
  // "nothing to search for" signal (normaliseAllergyLabel returns [] for a
  // bare "Allergy" / "Adverse drug reaction"), so a row it would find
  // nothing for never grows a button. If the engine is absent the check is
  // skipped rather than assumed — the button then surfaces the load error on
  // click, which is more useful than silence.
  function isSearchableRow(label) {
    if (!label) return false;
    if (EMPTY_STATE_ROW_RE.test(label)) return false;
    var engine = window.AllergyEvidence;
    if (!engine || typeof engine.normaliseAllergyLabel !== 'function') return true;
    try {
      return engine.normaliseAllergyLabel(label).length > 0;
    } catch (_) {
      return true;
    }
  }

  // ── Per-row widget state ────────────────────────────────────────────────────
  // Keyed by ordinal + label so two allergies with identical display text
  // still get independent panels (the duplicate-description lesson from
  // problem-description-cleanup.js's findProblemRow). All state lives here,
  // never in the DOM, so a Vue re-render loses nodes but never a panel.

  var _rows = Object.create(null);

  function rowState(key, label) {
    if (!_rows[key]) {
      _rows[key] = {
        label: label,
        rowEl: null,
        btnEl: null,
        panelEl: null,
        open: false,
        loading: false,
        error: null,
        result: null, // { evidence, provenance, substanceTerms }
        copiedIndex: null,
        copyError: null,
      };
    }
    _rows[key].label = label;
    return _rows[key];
  }

  // ── Panel rendering ─────────────────────────────────────────────────────────

  var CAUTION_LINE = 'Possible documented evidence — open and review the source entry before changing anything.';
  var EMPTY_LINE =
    'No mention found in the retrievable journal. Absence of evidence is not evidence the allergy is wrong.';
  var GP2GP_CAVEAT = 'imported via GP2GP — original authorship at previous practice';

  function tagsHtml(terms) {
    if (!Array.isArray(terms) || !terms.length) return '';
    return (
      '<div class="ms-alc-terms"><span class="ms-alc-terms-label">Matched terms:</span>' +
      terms
        .map(function (t) {
          return '<span class="ms-alc-tag">' + esc(t) + '</span>';
        })
        .join('') +
      '</div>'
    );
  }

  function evidenceItemHtml(item, index, copiedIndex) {
    var meta =
      '<span class="ms-alc-item-date">' +
      esc(formatEvidenceDate(item)) +
      '</span>' +
      '<span class="ms-alc-item-source">' +
      esc(sourceTypeWord(item.sourceType)) +
      '</span>';
    var who = attributionText(item);
    meta += '<span class="ms-alc-item-author">' + esc(who || 'author not recorded') + '</span>';
    if (item.isGp2gpImport) {
      meta += '<span class="ms-alc-tag ms-alc-tag--import" title="' + esc(GP2GP_CAVEAT) + '">imported</span>';
    }
    return (
      '<div class="ms-alc-item' +
      (item.score === 3 ? ' ms-alc-item--strong' : '') +
      '">' +
      '<div class="ms-alc-item-meta">' +
      meta +
      '</div>' +
      tagsHtml(item.matchedReactionTerms) +
      (item.isGp2gpImport ? '<div class="ms-alc-import-note">' + esc(GP2GP_CAVEAT) + '</div>' : '') +
      '<blockquote class="ms-alc-snippet">' +
      esc(item.snippet) +
      '</blockquote>' +
      '<button type="button" class="ms-alc-copy-btn" data-index="' +
      esc(index) +
      '">' +
      (copiedIndex === index ? 'Citation copied' : 'Copy citation') +
      '</button>' +
      '</div>'
    );
  }

  function panelHtml(key) {
    var st = _rows[key];
    if (!st) return '';
    var head =
      '<div class="ms-alc-head">' +
      esc(st.label) +
      ' <span class="ms-alc-head-sub">— documentary evidence from the journal</span>' +
      '</div>';
    if (st.loading) {
      return head + '<div class="ms-alc-body"><span class="ms-alc-loading">Searching the journal…</span></div>';
    }
    if (st.error) {
      return (
        head +
        '<div class="ms-alc-body">' +
        '<span class="ms-alc-error">' +
        esc(st.error) +
        '</span> ' +
        '<button type="button" class="ms-alc-retry-btn">Retry</button>' +
        '</div>'
      );
    }
    var result = st.result || { evidence: [], provenance: null };
    var evidence = Array.isArray(result.evidence) ? result.evidence : [];
    var html = head + '<div class="ms-alc-body">';
    // Mandatory standing caution (plan doc, Phase 3) — rendered on every
    // loaded panel, including the empty one, because it governs what the
    // clinician does next either way: this tool never changes the record.
    html += '<div class="ms-alc-caution">' + esc(CAUTION_LINE) + '</div>';
    var prov = provenanceText(result.provenance);
    if (prov) html += '<div class="ms-alc-provenance">' + esc(prov) + '</div>';
    if (!evidence.length) {
      html += '<div class="ms-alc-empty">' + esc(EMPTY_LINE) + '</div></div>';
      return html;
    }
    html += '<div class="ms-alc-list">';
    for (var i = 0; i < evidence.length; i++) {
      html += evidenceItemHtml(evidence[i], i, st.copiedIndex);
    }
    html += '</div>';
    if (st.copyError) html += '<div class="ms-alc-error">' + esc(st.copyError) + '</div>';
    html += '</div>';
    return html;
  }

  function renderPanel(key) {
    var st = _rows[key];
    if (!st) return;
    if (!st.open || !st.rowEl || !st.rowEl.parentElement) {
      if (st.panelEl) {
        st.panelEl.remove();
        st.panelEl = null;
      }
      return;
    }
    if (!st.panelEl || !st.panelEl.parentElement) {
      st.panelEl = document.createElement('div');
      st.panelEl.className = 'ms-alc-panel-wrap';
      st.rowEl.appendChild(st.panelEl);
    }
    st.panelEl.innerHTML = panelHtml(key);
    bindPanelEvents(st.panelEl, key);
  }

  function bindPanelEvents(root, key) {
    root.querySelectorAll('.ms-alc-copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        copyCitation(key, parseInt(btn.getAttribute('data-index'), 10));
      });
    });
    var retry = root.querySelector('.ms-alc-retry-btn');
    if (retry) {
      retry.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var st = _rows[key];
        if (st) {
          st.error = null;
          st.result = null;
        }
        openPanel(key);
      });
    }
  }

  // ── Evidence lookup ─────────────────────────────────────────────────────────

  async function openPanel(key) {
    var st = _rows[key];
    if (!st) return;
    // Checked BEFORE anything is marked open, so a navigation away from the
    // record page can never leave a half-opened panel with nothing in it.
    var info = getPatientInfo();
    if (!info) return;
    st.open = true;
    if (st.result) {
      renderPanel(key);
      return;
    }
    st.loading = true;
    st.error = null;
    renderPanel(key);
    try {
      var engine = window.AllergyEvidence;
      if (!engine || typeof engine.findEvidence !== 'function') {
        // Manifest ordering problem (engine/allergy-evidence.js must load
        // BEFORE this file) — say so plainly rather than failing silently on
        // a button the clinician just pressed.
        throw new Error('The evidence engine did not load on this page.');
      }
      var payload = await loadJournal(info.patientId);
      st.result = engine.findEvidence(st.label, payload);
    } catch (err) {
      st.error = (err && err.message) || 'Could not search the journal — please try again.';
    } finally {
      st.loading = false;
      renderPanel(key);
    }
  }

  function closePanel(key) {
    var st = _rows[key];
    if (!st) return;
    st.open = false;
    renderPanel(key);
  }

  // Clipboard is best-effort and never throws into the page: an unavailable
  // or permission-denied clipboard just tells the clinician to select the
  // quote instead (same posture as content-scripts/triage-lens/lab-file-button.js,
  // which wraps writeText in try/catch and degrades to a toast).
  function copyCitation(key, index) {
    var st = _rows[key];
    if (!st || !st.result || !Array.isArray(st.result.evidence)) return;
    var item = st.result.evidence[index];
    if (!item) return;
    var text = buildCitationText(item);
    var failed = function () {
      st.copiedIndex = null;
      st.copyError = 'Could not copy to the clipboard — select the quote above and copy it manually.';
      renderPanel(key);
    };
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) return failed();
      var p = navigator.clipboard.writeText(text);
      if (p && typeof p.then === 'function') {
        p.then(function () {
          st.copiedIndex = index;
          st.copyError = null;
          renderPanel(key);
        }, failed);
      } else {
        st.copiedIndex = index;
        st.copyError = null;
        renderPanel(key);
      }
    } catch (_) {
      failed();
    }
  }

  // ── Injection: one "Find evidence?" button per allergy row ──────────────────

  function injectFindButton(key, row) {
    if (row.querySelector('.ms-alc-find-btn')) return;
    var st = _rows[key];
    if (!st) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ms-alc-find-btn';
    btn.textContent = 'Find evidence?';
    st.btnEl = btn;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (st.open) closePanel(key);
      else openPanel(key);
    });
    // Placement mirrors problem-description-cleanup.js's "Fix description"
    // button: immediately after the row's own label, so it reads as part of
    // that row. With no label element to anchor to, the button is PREPENDED
    // into the row rather than appended — Medicus's Vue reconciler strips
    // TRAILING foreign nodes on its next render (CLAUDE.md, the v3.67.0
    // regression), and re-injection on the next tick is the backstop either
    // way.
    var labelEl = rowLabelElement(row);
    if (labelEl && labelEl.parentElement === row) labelEl.insertAdjacentElement('afterend', btn);
    else row.insertBefore(btn, row.firstChild);
  }

  // ── Scan + re-injection ─────────────────────────────────────────────────────
  // Same discipline as the sibling summary-screen widgets: re-check on every
  // mutation tick (Vue re-renders strip foreign nodes), throttled,
  // own-mutation-filtered, idempotent.

  var _lastPatientId = null;

  function resetForNewPatient() {
    _rows = Object.create(null);
    _journalPatientId = null;
    _journalPromise = null;
    // Stale nodes from the previous patient's card must never survive a
    // patient switch — an allergy panel showing the wrong patient's journal
    // is the worst failure this widget could have.
    document.querySelectorAll('.ms-alc-panel-wrap, .ms-alc-find-btn').forEach(function (el) {
      el.remove();
    });
  }

  function scan() {
    var info = getPatientInfo();
    if (!info) return;
    if (info.patientId !== _lastPatientId) {
      _lastPatientId = info.patientId;
      resetForNewPatient();
    }
    var card = findAllergiesCard();
    if (!card) return; // Not on the clinical-summary tab, or the DOM guess missed — do nothing.
    var rows = allergyRows(card);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var label = rowLabel(row);
      if (!isSearchableRow(label)) continue;
      var key = i + '|' + label;
      var st = rowState(key, label);
      st.rowEl = row;
      injectFindButton(key, row);
      if (st.open) renderPanel(key);
    }
  }

  var _throttle = null;
  function scheduleScan() {
    if (_throttle) return;
    _throttle = setTimeout(function () {
      _throttle = null;
      if (!document.hidden) {
        try {
          scan();
        } catch (_) {
          // Fail-soft: a DOM shape this widget didn't expect must never
          // break the summary screen (plan doc safety rule 5).
        }
      }
    }, 400);
  }

  function _isOwnMutation(mutations) {
    for (var m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('.ms-alc-panel-wrap')) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.classList && (n.classList.contains('ms-alc-panel-wrap') || n.classList.contains('ms-alc-find-btn')))
            continue;
          if (n.closest && n.closest('.ms-alc-panel-wrap, .ms-alc-find-btn')) continue;
          return false;
        }
      }
    }
    return true;
  }

  var _hub = window.__chObserverHub;
  if (_hub && _hub.subscribe) {
    _hub.subscribe(function (mutations) {
      if (_isOwnMutation(mutations)) return;
      scheduleScan();
    });
  } else {
    var _obs = new MutationObserver(function (mutations) {
      if (_isOwnMutation(mutations)) return;
      scheduleScan();
    });
    _obs.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleScan();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleScan);
  } else {
    scheduleScan();
  }
})();
