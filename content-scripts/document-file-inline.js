// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Inline "Save attachment as document" widget for triage task pages.
//
// A triage request can arrive with a patient-submitted photo/document attached
// (content-scripts/triage-lens/content.js's extractInitialRequest() detects
// these and exposes them as window.__msTriageAttachments — see that file for
// the extraction). Today the only way to get one of those files onto the
// patient's record as a proper clinical document is Medicus's own manual
// "Add document" upload. This widget drives Medicus's OWN create-document
// endpoint directly with a credentialed same-origin fetch — the identical
// proven pattern task-inline.js/booking-inline.js already use:
//
//   GET  /clinical/data/document/forms/create-inbound-document-form/{patientId}
//        → { reviewerOptions:{teams[],staff[]}, selectedReviewerAssignee,
//            recordDate, staff[], linkableProblems[], localOrganisationName }
//   POST /clinical/document/create
//        multipart/form-data: { file: <bytes>, formPayload: <JSON string> }
//        → { documentId }
//
// Confirmed via live captures (scripts/document-create-capture.js) —
// see docs/learnings-triage-attachment-to-document.md for the full contract,
// including what's still NOT confirmed.
//
// SCOPE: the create call's `documentType` is a SNOMED-coded {conceptId,
// description, descriptionId} object, normally chosen via Medicus's own live
// search-as-you-type — this suite has never captured that search endpoint's
// query contract, so we do not guess it (a wrong SNOMED code silently
// miscodes the record — the exact failure mode CLAUDE.md's drug-rules
// section warns against for a different feature; same principle here).
// Instead we only ever send one of two CONFIRMED real codes, chosen by file
// extension: "Medical photograph" for images, "Patient/Carer Correspondence"
// for PDF/Word files — together these cover every extension
// content.js's extractInitialRequest() itself recognises as an attachment,
// so this widget's eligibility now matches that extraction exactly, with no
// narrower carve-out. A filename extension outside that set (there isn't one
// today, but if extractInitialRequest's regex is ever widened) is NOT
// filed automatically — see documentTypeForFilename below.
//
// The side panel and content scripts alike have host_permissions for
// *.api.england.medicus.health, so this works directly from the content-script
// context (same as booking-inline.js / task-inline.js).
//
// ATTACHMENT RESOLUTION: some task types (confirmed live: communication-thread)
// render the attachment as a plain <button> labelled with the filename and NO
// href at all — content.js's extractInitialRequest() records these with
// href:'' (see that file). This widget resolves them via the SAME
// `/tasks/data/{typeSlug}/overview/{taskUuid}` call already made to find the
// patient (one fetch, not two): the response embeds the real attachment
// `{ id, fileName, fileSize, contentType, fileURI }` somewhere in its tree —
// the exact nesting differs by task type (confirmed:
// communicationThread.communications[].patientRequest.attachments /
// .operativeChannel.attachments), so findAttachmentsInOverview walks the
// whole JSON looking for that shape rather than hardcoding one path — a
// missing/wrong hardcoded path would silently drop a real attachment.
// `fileURI` is used AS GIVEN for the download (relative to the API host) —
// never reconstructed. Confirmed via live capture 2026-07-20, see
// docs/learnings-triage-attachment-to-document.md §8.
'use strict';

(function () {
  // ── Pure helpers (no window/document/fetch — unit-testable via require()) ────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function todayISO() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  var IMAGE_EXT_RE = /\.(jpe?g|png|tiff?|heic|gif)$/i;
  var DOCFILE_EXT_RE = /\.(pdf|docx?)$/i;

  // The two CONFIRMED real documentType codes (see the SCOPE comment above)
  // — never invent a third without a live capture confirming it first.
  var DOCUMENT_TYPES = {
    image: { description: 'Medical photograph', conceptId: '820241000000102', descriptionId: '2136431000000115' },
    document: {
      description: 'Patient/Carer Correspondence',
      conceptId: '163181000000107',
      descriptionId: '214931000000113',
    },
  };

  // null for any extension we don't have a confirmed code for.
  function documentTypeForFilename(filename) {
    var f = filename || '';
    if (IMAGE_EXT_RE.test(f)) return DOCUMENT_TYPES.image;
    if (DOCFILE_EXT_RE.test(f)) return DOCUMENT_TYPES.document;
    return null;
  }

  // Narrows a raw attachments list (as extracted by content.js's
  // extractInitialRequest) down to the subset this widget can safely file —
  // see the SCOPE comment at the top of this file for why. An entry with no
  // href (button-rendered attachment, href:'') is still eligible as long as
  // it has a filename to identify/resolve it by — only a filename-less,
  // href-less entry (nothing to key off at all) is dropped.
  function filterEligibleAttachments(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (a) {
      if (!a || (!a.href && !a.filename)) return false;
      return documentTypeForFilename(a.filename || a.href) !== null;
    });
  }

  // Finds every attachment-shaped object ({ id, fileName, fileURI, … })
  // anywhere in a task-overview API response, deduped by id — see the
  // ATTACHMENT RESOLUTION header comment for why this walks the whole tree
  // instead of a hardcoded path. Returns [] for anything not shaped like the
  // confirmed contract (never guesses a shape).
  function findAttachmentsInOverview(data) {
    var out = [];
    var seen = Object.create(null);
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node.fileName === 'string' && typeof node.fileURI === 'string' && node.id) {
        if (!seen[node.id]) {
          seen[node.id] = true;
          out.push({
            id: node.id,
            filename: node.fileName,
            fileURI: node.fileURI,
            fileSize: node.fileSize,
            contentType: node.contentType,
          });
        }
        return; // an attachment object's own fields are never themselves attachments
      }
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k)) walk(node[k]);
      }
    })(data);
    return out;
  }

  // The same task-overview response's patient-id shape — task types nest this
  // differently (confirmed: a top-level data.patientId for communication-thread
  // tasks), so every known fallback is tried, same discipline as before.
  function patientIdFromOverview(data) {
    return (
      (data && data.data && data.data.patient && data.data.patient.id) ||
      (data && data.data && data.data.patientId) ||
      (data && data.patient && data.patient.id) ||
      (data && data.patientId) ||
      null
    );
  }

  // Resolves a single attachment to an absolute, fetchable download URL.
  // Already-resolved (href present, e.g. a real <a> in the DOM) passes
  // through unchanged. An unresolved (button-rendered) attachment is matched
  // by filename against the task-overview attachment list — `base` +
  // `fileURI` AS GIVEN, never reconstructed. Returns null (never a guess) if
  // no match is found.
  function resolveAttachmentUrl(att, resolvedList, base) {
    if (att && att.href) return att.href;
    var filename = att && att.filename;
    var match = (resolvedList || []).find(function (r) {
      return r.filename === filename;
    });
    return match ? String(base || '') + match.fileURI : null;
  }

  function titleFromFilename(filename) {
    if (!filename) return 'Attachment';
    var base = filename.replace(/\.[^./]+$/, '');
    return base || 'Attachment';
  }

  // Builds the confirmed `formPayload` object (see
  // docs/learnings-triage-attachment-to-document.md) — pure, no fetch. The
  // caller JSON.stringifies this into the FormData field of the same name.
  function buildFormPayload(opts) {
    return {
      patientId: opts.patientId,
      documentType: opts.documentType,
      documentDate: opts.documentDate,
      authoredByDepartment: null,
      authoredByPractitioner: null,
      clinicalSpecialty: null,
      authoredByOrganisation: null,
      linkedProblemIds: [],
      contextId: null,
      contextType: null,
      reviewerAssigneeId: opts.reviewerAssigneeId,
      reviewerAssigneeType: opts.reviewerAssigneeType,
      hiddenFromPatientFacingServices: false,
      confidentialFromThirdParties: false,
      title: opts.title,
      additionalInformation: null,
      problemCode: null,
      recordDate: opts.documentDate,
      authorOrganisationOption: 'local',
      clinicalCaseId: null,
      nextStep: 'file-into-patient-record',
      reviewTaskPriority: 0,
    };
  }

  // ── Node test hook ────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      filterEligibleAttachments,
      titleFromFilename,
      buildFormPayload,
      documentTypeForFilename,
      findAttachmentsInOverview,
      patientIdFromOverview,
      resolveAttachmentUrl,
      DOCUMENT_TYPES,
      IMAGE_EXT_RE,
      DOCFILE_EXT_RE,
    };
    return;
  }

  // ── Browser boot ──────────────────────────────────────────────────────────────
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__msDocFileInline) return;
  window.__msDocFileInline = true;

  var DC = window.DomContracts;

  function eligibleAttachments() {
    return filterEligibleAttachments(window.__msTriageAttachments);
  }

  // ── URL detection ─────────────────────────────────────────────────────────────

  function getTaskInfo() {
    var m = location.pathname.match(
      /\/([0-9a-f]{4,})\/tasks\/data\/([^/]+)\/overview\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (!m) return null;
    return { siteId: m[1], typeSlug: m[2], taskUuid: m[3] };
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  function blankState() {
    return {
      open: false,
      loading: false,
      error: null,
      patientId: null,
      // Cached across "save another" within the same widget session, exactly
      // like task-inline.js's doAgain — avoids re-fetching the create form.
      reviewerAssigneeId: null,
      reviewerAssigneeType: null,
      recordDateDefault: null,
      // Attachment list from the task-overview API — resolves any DOM-detected
      // attachment that arrived with no href (see resolveAttachmentUrl above).
      resolvedAttachments: [],
      selectedIdx: 0,
      title: '',
      documentDate: todayISO(),
      step: 'form', // 'form' | 'created'
      creating: false,
      createError: null,
      createdDocumentId: null,
    };
  }

  var s = blankState();

  // ── API ───────────────────────────────────────────────────────────────────────

  function apiBaseUrl() {
    var info = getTaskInfo();
    var parts = location.pathname.split('/').filter(Boolean);
    var siteId = (info && info.siteId) || parts[0] || '';
    return 'https://' + siteId + '.api.' + location.hostname;
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    var resp = await fetch(apiBaseUrl() + path, {
      method: opts.method || 'GET',
      credentials: 'include',
      headers: Object.assign({ Accept: 'application/json, text/plain, */*' }, opts.headers),
      body: opts.body,
    });
    if (!resp.ok) throw new Error('API ' + resp.status);
    var text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Document API returned an unexpected response.');
    }
  }

  // Multipart create call — deliberately does NOT set a Content-Type header:
  // the browser must generate the multipart boundary itself. Setting one
  // manually (even to 'multipart/form-data') breaks the server's parser.
  async function apiFetchMultipart(path, formData) {
    var resp = await fetch(apiBaseUrl() + path, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json, text/plain, */*' },
      body: formData,
    });
    if (!resp.ok) throw new Error('API ' + resp.status);
    var text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('Document API returned an unexpected response.');
    }
  }

  // Fetches the task-overview API once (same call task-inline.js/
  // booking-inline.js make for patient resolution) and pulls BOTH the patient
  // id and the real attachment list out of it — one fetch serves both needs,
  // see the ATTACHMENT RESOLUTION header comment for why.
  async function fetchTaskOverview(typeSlug, taskUuid) {
    var data = await apiFetch('/tasks/data/' + typeSlug + '/overview/' + taskUuid);
    return { patientId: patientIdFromOverview(data), attachments: findAttachmentsInOverview(data) };
  }

  async function apiFetchCreateForm(patientId) {
    return apiFetch('/clinical/data/document/forms/create-inbound-document-form/' + encodeURIComponent(patientId));
  }

  // Builds and sends the confirmed multipart contract — see
  // docs/learnings-triage-attachment-to-document.md. Every field here is
  // either a fixed, confirmed constant for this widget's narrow scope
  // (documentType, authorOrganisationOption, nextStep, …) or a live value
  // fetched from apiFetchCreateForm (reviewerAssigneeId/Type, recordDate) —
  // nothing is guessed.
  async function apiCreateDocument(opts) {
    var fd = new FormData();
    fd.append('file', opts.blob, opts.filename);
    fd.append('formPayload', JSON.stringify(buildFormPayload(opts)));
    return apiFetchMultipart('/clinical/document/create', fd);
  }

  // ── DOM injection ─────────────────────────────────────────────────────────────
  // Same anchor discipline as task-inline.js (shared DOM contracts — see
  // shared/dom-contracts.js "task-widget.codes-actions-heading" /
  // "task-widget.card-submit-button" / "task-inline.action-row" — one contract,
  // consumed by every inline widget that anchors this way).

  var HEADING_RE = /^Codes\s*(?:&|&amp;|and)\s*actions$/i;
  var INITIAL_REQUEST_RE = /^Initial Request$/i;

  function visible(el) {
    return !!(el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)));
  }

  function matchHeading(el) {
    if (el.closest('#ms-df-widget')) return false;
    if (el.firstElementChild) return false;
    return HEADING_RE.test(el.textContent.trim());
  }

  function matchInitialRequestHeading(el) {
    if (el.closest('#ms-df-widget')) return false;
    if (el.firstElementChild) return false;
    return INITIAL_REQUEST_RE.test(el.textContent.trim());
  }

  var HEADING_CONTRACT = DC && DC.get('task-widget.codes-actions-heading');
  var HEADING_NARROW_SEL = HEADING_CONTRACT ? HEADING_CONTRACT.target.join(',') : 'h1,h2,h3,h4,h5,h6,strong,b,legend';
  var HEADING_WIDE_SEL =
    HEADING_CONTRACT && HEADING_CONTRACT.legacy[0] ? HEADING_CONTRACT.legacy[0].join(',') : 'div,span,p';
  var SUBMIT_BTN_CONTRACT = DC && DC.get('task-widget.card-submit-button');
  var SUBMIT_BTN_SEL = SUBMIT_BTN_CONTRACT
    ? SUBMIT_BTN_CONTRACT.target.join(', ')
    : 'button, [role="button"], input[type="submit"]';
  var ACTION_ROW_CONTRACT = DC && DC.get('task-inline.action-row');
  var ACTION_ROW_SEL = ACTION_ROW_CONTRACT ? ACTION_ROW_CONTRACT.target.join(', ') : 'button, [role="button"]';

  function findHeading() {
    for (var el of document.querySelectorAll(HEADING_NARROW_SEL)) {
      if (matchHeading(el)) return el;
    }
    for (var el2 of document.querySelectorAll(HEADING_WIDE_SEL)) {
      if (matchHeading(el2)) return el2;
    }
    return null;
  }

  function findCard() {
    var heading = findHeading();
    if (!heading) return null;
    var node = heading.parentElement;
    var fallback = node;
    while (node && node !== document.body) {
      var btns = node.querySelectorAll(SUBMIT_BTN_SEL);
      for (var b of btns) {
        if (/^submit$/i.test((b.value || b.textContent || '').trim())) return node;
      }
      fallback = node;
      node = node.parentElement;
    }
    return fallback;
  }

  function findActionRow() {
    var btns = document.querySelectorAll(ACTION_ROW_SEL);
    for (var i = btns.length - 1; i >= 0; i--) {
      var b = btns[i];
      if (!/more actions/i.test((b.textContent || '').trim())) continue;
      if (b.closest('[role="dialog"], [aria-modal="true"]')) continue;
      if (!visible(b)) continue;
      return b.parentElement;
    }
    return null;
  }

  // Gate 3 fallback — the "Initial Request" card's boundary, same
  // heading-then-closest-card walk content.js's own findCardByTitle uses, but
  // matching the heading text EXACTLY ("Initial Request", not a starts-with
  // match) so this never mis-anchors on an unrelated section. Confirmed live
  // (2026-07-20): communication-thread tasks have NEITHER a "Codes & actions"
  // card NOR a "More actions" row (the two anchors above), but DO have this
  // card — the same one that carries the attachment this widget is FOR.
  function findInitialRequestCard() {
    var heading = null;
    for (var el of document.querySelectorAll(HEADING_NARROW_SEL)) {
      if (matchInitialRequestHeading(el)) {
        heading = el;
        break;
      }
    }
    if (!heading) {
      for (var el2 of document.querySelectorAll(HEADING_WIDE_SEL)) {
        if (matchInitialRequestHeading(el2)) {
          heading = el2;
          break;
        }
      }
    }
    if (!heading) return null;
    return (
      heading.closest('.m-card-v2') || heading.closest('[class*="m-card"]') || heading.parentElement?.parentElement
    );
  }

  function injectWidget() {
    if (!getTaskInfo()) return;
    if (eligibleAttachments().length === 0) return;
    if (document.getElementById('ms-df-widget')) return;
    var w = document.createElement('div');
    w.id = 'ms-df-widget';
    renderInto(w);
    // Stack after any other inline widget already anchored here (task/booking),
    // or the "Codes & actions" card, or above the bottom action row.
    var after = document.getElementById('ms-tk-widget') || document.getElementById('ms-bk-widget') || findCard();
    if (after && after.parentElement) {
      withObserverPaused(function () {
        after.after(w);
      });
      return;
    }
    var row = findActionRow();
    if (row && row.parentElement) {
      withObserverPaused(function () {
        row.parentElement.insertBefore(w, row);
      });
      return;
    }
    // Last resort: after the "Initial Request" card itself (communication-
    // thread tasks have neither of the above two anchors — confirmed live
    // 2026-07-20).
    var irCard = findInitialRequestCard();
    if (irCard && irCard.parentElement) {
      withObserverPaused(function () {
        irCard.after(w);
      });
      return;
    }
  }

  function removeWidget() {
    var w = document.getElementById('ms-df-widget');
    if (!w) return;
    withObserverPaused(function () {
      w.remove();
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function renderInto(el) {
    el.innerHTML = buildHtml();
    bindEvents(el);
  }

  function rerender() {
    var w = document.getElementById('ms-df-widget');
    if (w) renderInto(w);
  }

  function buildHtml() {
    var body = '';
    if (s.open) {
      if (s.loading) {
        body = '<div class="ms-df-body"><div class="ms-df-loading">Loading…</div></div>';
      } else if (s.error) {
        body = '<div class="ms-df-body"><div class="ms-df-error">' + esc(s.error) + '</div></div>';
      } else if (s.step === 'created') {
        body = renderCreated();
      } else {
        body = renderForm();
      }
    }
    var count = eligibleAttachments().length;
    var label = count > 1 ? 'Save an attachment as a document' : 'Save attachment as document';
    return (
      '<div class="ms-df-header" id="ms-df-toggle" role="button" tabindex="0" aria-expanded="' +
      s.open +
      '">' +
      '<span class="ms-df-chevron">' +
      (s.open ? '▾' : '▸') +
      '</span>' +
      '<span>' +
      esc(label) +
      '</span>' +
      '</div>' +
      body
    );
  }

  function attachmentOptionsHtml() {
    return eligibleAttachments()
      .map(function (a, i) {
        return (
          '<option value="' +
          i +
          '"' +
          (s.selectedIdx === i ? ' selected' : '') +
          '>' +
          esc(a.filename || 'Attachment ' + (i + 1)) +
          '</option>'
        );
      })
      .join('');
  }

  function renderForm() {
    var atts = eligibleAttachments();
    var att = atts[s.selectedIdx];
    var docType = att && documentTypeForFilename(att.filename || att.href);
    var canCreate = atts.length > 0 && s.title.trim() && s.documentDate && !s.creating;
    return (
      '<div class="ms-df-body">' +
      (!s.patientId
        ? '<div class="ms-df-warn">Could not determine patient ID — try navigating away and back.</div>'
        : '') +
      (atts.length > 1
        ? '<div class="ms-df-row"><label class="ms-df-label" for="ms-df-attachment">Attachment</label>' +
          '<select class="ms-df-select" id="ms-df-attachment">' +
          attachmentOptionsHtml() +
          '</select></div>'
        : '') +
      '<div class="ms-df-row"><label class="ms-df-label" for="ms-df-title">Title</label>' +
      '<input class="ms-df-input" id="ms-df-title" type="text" maxlength="200" value="' +
      esc(s.title) +
      '"></div>' +
      '<div class="ms-df-row"><label class="ms-df-label" for="ms-df-date">Document date</label>' +
      '<input class="ms-df-input" id="ms-df-date" type="date" value="' +
      esc(s.documentDate) +
      '"></div>' +
      (docType
        ? '<div class="ms-df-note">Filed as a "' +
          esc(docType.description) +
          '" document type, into this patient\'s record.</div>'
        : '') +
      (s.createError ? '<div class="ms-df-error">' + esc(s.createError) + '</div>' : '') +
      '<button class="ms-df-btn" id="ms-df-create"' +
      (canCreate ? '' : ' disabled') +
      '>' +
      (s.creating ? 'Saving…' : 'Save as document') +
      '</button>' +
      '</div>'
    );
  }

  function renderCreated() {
    var atts = eligibleAttachments();
    return (
      '<div class="ms-df-body ms-df-success">' +
      '<div class="ms-df-success-icon">✓</div>' +
      '<div><strong>Saved to the patient record</strong></div>' +
      (atts.length > 1 ? '<button class="ms-df-btn-ghost" id="ms-df-again">Save another attachment</button>' : '') +
      '</div>'
    );
  }

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function doOpen() {
    s.open = true;
    if (s.patientId && s.reviewerAssigneeId !== null) {
      s.error = null;
      rerender();
      return;
    }
    s.loading = true;
    s.error = null;
    rerender();
    try {
      var info = getTaskInfo();
      if (info) {
        var overview = await fetchTaskOverview(info.typeSlug, info.taskUuid);
        s.patientId = overview.patientId;
        s.resolvedAttachments = overview.attachments;
      }
      if (!s.patientId) throw new Error('Could not determine the patient for this task.');
      var form = await apiFetchCreateForm(s.patientId);
      var sel = form && form.selectedReviewerAssignee;
      s.reviewerAssigneeId = (sel && sel.value) || null;
      s.reviewerAssigneeType = (sel && sel.type) || null;
      s.recordDateDefault = (form && form.recordDate) || todayISO();
      s.documentDate = s.recordDateDefault;
      var atts = eligibleAttachments();
      if (atts[s.selectedIdx]) s.title = titleFromFilename(atts[s.selectedIdx].filename);
    } catch (err) {
      s.error = err.message || 'Failed to load the document form.';
    } finally {
      s.loading = false;
      rerender();
    }
  }

  async function doCreate() {
    var atts = eligibleAttachments();
    var att = atts[s.selectedIdx];
    var docType = att && documentTypeForFilename(att.filename || att.href);
    if (s.creating || !s.patientId || !att || !docType || !s.title.trim() || !s.documentDate) return;
    s.creating = true;
    s.createError = null;
    rerender();
    try {
      var downloadUrl = resolveAttachmentUrl(att, s.resolvedAttachments, apiBaseUrl());
      if (!downloadUrl) throw new Error("Could not locate this attachment's file — try reopening the task.");
      var resp = await fetch(downloadUrl, { credentials: 'include' });
      if (!resp.ok) throw new Error('Could not fetch the attachment (HTTP ' + resp.status + ').');
      var blob = await resp.blob();
      var result = await apiCreateDocument({
        patientId: s.patientId,
        blob: blob,
        filename: att.filename || 'attachment',
        title: s.title.trim(),
        documentDate: s.documentDate,
        documentType: docType,
        reviewerAssigneeId: s.reviewerAssigneeId,
        reviewerAssigneeType: s.reviewerAssigneeType,
      });
      s.createdDocumentId = (result && result.documentId) || null;
      s.step = 'created';
    } catch (err) {
      s.createError = err.message || 'Failed to save this attachment as a document — please try again.';
    } finally {
      s.creating = false;
      rerender();
    }
  }

  // ── Event binding ─────────────────────────────────────────────────────────────

  function bindEvents(el) {
    var toggle = el.querySelector('#ms-df-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        if (s.open) {
          s.open = false;
          rerender();
        } else {
          doOpen();
        }
      });
      toggle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle.click();
        }
      });
    }

    el.querySelector('#ms-df-attachment')?.addEventListener('change', function (e) {
      s.selectedIdx = Number(e.target.value) || 0;
      var atts = eligibleAttachments();
      if (atts[s.selectedIdx]) s.title = titleFromFilename(atts[s.selectedIdx].filename);
      rerender();
    });

    var createBtn = el.querySelector('#ms-df-create');
    el.querySelector('#ms-df-title')?.addEventListener('input', function (e) {
      s.title = e.target.value;
      if (createBtn) createBtn.disabled = !(s.title.trim() && s.documentDate && !s.creating);
    });
    el.querySelector('#ms-df-date')?.addEventListener('input', function (e) {
      s.documentDate = e.target.value;
      if (createBtn) createBtn.disabled = !(s.title.trim() && s.documentDate && !s.creating);
    });

    el.querySelector('#ms-df-create')?.addEventListener('click', function () {
      doCreate();
    });

    el.querySelector('#ms-df-again')?.addEventListener('click', function () {
      var cached = {
        patientId: s.patientId,
        reviewerAssigneeId: s.reviewerAssigneeId,
        reviewerAssigneeType: s.reviewerAssigneeType,
        recordDateDefault: s.recordDateDefault,
        resolvedAttachments: s.resolvedAttachments,
      };
      s = blankState();
      Object.assign(s, cached);
      s.open = true;
      s.documentDate = cached.recordDateDefault || todayISO();
      var atts = eligibleAttachments();
      // Pick an attachment not yet saved isn't tracked — default to the first;
      // the picker lets the clinician choose the right one if several remain.
      if (atts[0]) s.title = titleFromFilename(atts[0].filename);
      rerender();
    });
  }

  // ── SPA navigation & re-injection ─────────────────────────────────────────────
  // Identical discipline to task-inline.js / booking-inline.js (own-mutation
  // filter, cheap path gate, throttle + animation-frame deferral, remove-on-leave).
  // Re-checking eligibleAttachments() on every tick also resolves the ordering
  // race with content.js's own async DOM extraction — window.__msTriageAttachments
  // may not be populated yet on the very first tick, but the shared mutation
  // observer keeps re-evaluating until it is.

  var _lastPath = location.pathname;
  var _throttle = null;
  var _obs = null;

  function observeBody() {
    if (_obs) _obs.observe(document.body, { childList: true, subtree: true });
  }

  function withObserverPaused(fn) {
    if (!_obs) {
      fn();
      return;
    }
    _obs.disconnect();
    try {
      fn();
    } finally {
      observeBody();
    }
  }

  function _isOwnWidgetMutation(mutations) {
    for (var m of mutations) {
      if (m.target && m.target.nodeType === 1 && m.target.closest && m.target.closest('#ms-df-widget')) {
        continue;
      }
      for (var nodes of [m.addedNodes, m.removedNodes]) {
        for (var n of nodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ms-df-widget') continue;
          if (n.closest && n.closest('#ms-df-widget')) continue;
          return false;
        }
      }
    }
    return true;
  }

  function onMutations(mutations) {
    if (_isOwnWidgetMutation(mutations)) return;
    scheduleInject();
  }

  function scheduleInject() {
    if (_throttle) return;
    var onTaskPage = !!getTaskInfo();
    var pathChanged = location.pathname !== _lastPath;
    if (!onTaskPage && !pathChanged) return;
    _throttle = setTimeout(runInject, 350);
  }

  function runInject() {
    _throttle = null;
    var currentPath = location.pathname;
    if (currentPath !== _lastPath) {
      _lastPath = currentPath;
      s = blankState();
    }
    if (document.hidden) return;
    if (!getTaskInfo() || eligibleAttachments().length === 0) {
      removeWidget();
      return;
    }
    var existing = document.getElementById('ms-df-widget');
    if (existing && existing.isConnected) return;
    requestAnimationFrame(function () {
      if (document.hidden) return;
      var w = document.getElementById('ms-df-widget');
      if (w && w.isConnected) return;
      injectWidget();
    });
  }

  var _hub = window.__chObserverHub;
  if (_hub && _hub.subscribe) {
    _hub.subscribe(onMutations);
  } else {
    _obs = new MutationObserver(onMutations);
    observeBody();
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleInject();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInject);
  } else {
    scheduleInject();
  }
})();
