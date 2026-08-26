// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Risk Flag Cleanup — patient-banner pill + review/removal panel
//
// Adds a "Clean up alerts" pill to Medicus's own patient-banner bar,
// right-justified alongside Medicus's own risk-flag badges (Risk to self,
// Risk from others, Subject of MARAC, etc.). Clicking it opens a panel
// listing every "flag on patient banner" note on the current patient; the
// user ticks any number and removes just the banner flag (never the note
// itself, never its SNOMED code) in one reviewed, confirmed batch.
//
// Payload + write-set live in shared/risk-flag-cleanup-core.js (W24).
//
// WRONG-PATIENT SAFETY: identity is captured only when the panel opens and
// RE-VERIFIED immediately before EVERY write in the batch — never trust an
// earlier snapshot for a write that may fire seconds or minutes later. The
// panel also hard-closes the moment the on-screen patient changes (SPA
// navigation mid-review), whether that's caught by the render loop or by the
// per-write check — same discipline as the problem-nesting / contacts /
// allergy-cleanup canvases (H-043 family).
//
// PREPEND, never append (CLAUDE.md chip-injection rule #1): Medicus's Vue
// reconciler strips trailing foreign DOM nodes on re-render. The pill is
// inserted via insertBefore(..., firstChild) and re-injected on every
// observed DOM churn via the shared observer hub.
//
// PILL PLACEMENT IS BEST-EFFORT: there is no reliable class name to target
// Medicus's own badge row by (unknown, and liable to change), so the row is
// located by a STRUCTURAL heuristic (a small cluster of short, leaf-like
// children — i.e. "looks like a row of pills") rather than by content or
// class. This is expected to need one round of live visual tuning; see the
// project memory / conversation history for what to adjust if the pill lands
// in the wrong place.

(function () {
  'use strict';

  if (window.__rfcMounted) return;
  var Core = window.RiskFlagCleanupCore;
  if (!Core) return;
  window.__rfcMounted = true;

  var PILL_ID = 'ms-rfc-pill';
  var OVERLAY_ID = 'ms-rfc-overlay';
  // Same host selector set sentinel's pageReady() and patient-alerts-banner.js
  // already wait on for the patient header/banner container.
  var HOST_SELECTOR = '[class*="patient-banner"], [class*="patient-header"], [data-cy*="patient-banner"]';

  var _renderQueued = false;
  var _panelState = null; // null when closed; object when open (see openPanel)
  var _writing = false;

  function SAC() {
    return window.SentinelApiClient;
  }

  // Returns { apiBase, patientUuid } or null. URL-based first, DOM fallback
  // (single-patient-page-only, per findPatientUuidFromDom's own safety
  // guard) for screens with no parseable patientId in the URL.
  function resolveIdentity() {
    try {
      var ctx = SAC() && SAC().detectMedicusContext(location.href);
      if (!ctx || !ctx.apiBase) return null;
      if (ctx.patientUuid) return { apiBase: ctx.apiBase, patientUuid: ctx.patientUuid };
      var uuid = SAC().findPatientUuidFromDom(document);
      if (uuid) return { apiBase: ctx.apiBase, patientUuid: uuid };
    } catch (_) {
      /* identity stays null — pill/panel simply won't show, never stale */
    }
    return null;
  }

  // ---- Pill injection ---------------------------------------------------------

  function removePill() {
    var el = document.getElementById(PILL_ID);
    if (el) el.remove();
  }

  function setPillExpanded(open) {
    var pill = document.getElementById(PILL_ID);
    if (pill) pill.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function buildPill() {
    var pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.type = 'button';
    pill.textContent = 'Clean up alerts';
    pill.title = 'Review and remove banner risk flags for this patient';
    pill.setAttribute('aria-expanded', _panelState ? 'true' : 'false');
    pill.setAttribute('aria-controls', OVERLAY_ID);
    pill.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    });
    return pill;
  }

  // Best-effort: find the row hosting Medicus's own badge pills by SHAPE, not
  // by class name (unknown/unstable) or content (would need an extra API
  // fetch on every render pass). A "pill row" here is a small cluster (1-8)
  // of short, leaf-like children — no block-level grandchildren, no long
  // text — which is what a horizontal strip of coloured badge pills looks
  // like structurally regardless of Medicus's actual class names. Returns
  // null (falls back to the general header host) if nothing matches.
  //
  // MUST also reject anything not actually rendered at a real visible size —
  // confirmed live (2026-08-26) the first version of this heuristic matched
  // a `.button-content.sr-only` accessibility label (visually-hidden text for
  // screen readers, collapsed to ~1x1px via overflow:hidden) that happened to
  // sit earlier in document order than the real badge row and coincidentally
  // matched the shape check. Size/visibility are checked here rather than by
  // excluding sr-only-style class names, which are just as unstable a thing
  // to match against as the class names this whole function avoids.
  function isRenderedVisible(el) {
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 20 && r.height > 8;
  }

  // A real badge PILL is a rounded, filled/outlined chip — not just "short
  // text in a small cluster". Confirmed live (2026-08-26) that the shape-only
  // check above ALSO matches the DOB/NHS-number line ("12 Sep 1978 (47y) •
  // NHS 222 222 2222"), which structurally looks like a small cluster of
  // short text too, but is plain inline text with no rounding — landing the
  // pill next to demographics instead of the actual alert badges. This is
  // the distinguishing visual trait from the screenshot (rounded, coloured
  // chips) rather than any class name.
  function looksLikePillChip(el) {
    var cs = getComputedStyle(el);
    var radius = parseFloat(cs.borderTopLeftRadius) || 0;
    if (radius < 3) return false;
    var bg = cs.backgroundColor;
    var hasFill = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)';
    var hasBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    return hasFill || hasBorder;
  }

  function findBadgeRow(host) {
    var all = host.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var kids = el.children;
      if (kids.length < 1 || kids.length > 8) continue;
      if (!isRenderedVisible(el)) continue;
      var looksRight = true;
      for (var j = 0; j < kids.length; j++) {
        var k = kids[j];
        var txt = (k.textContent || '').trim();
        if (
          !txt ||
          txt.length > 80 ||
          k.querySelector('div, section, article, table, form') ||
          !isRenderedVisible(k) ||
          !looksLikePillChip(k)
        ) {
          looksRight = false;
          break;
        }
      }
      if (looksRight) return el;
    }
    return null;
  }

  function injectPill(host) {
    var existing = document.getElementById(PILL_ID);
    if (existing && host.contains(existing)) return; // idempotent — already in place
    removePill();
    var row = findBadgeRow(host);
    var target = row || host;
    // PREPEND (rule #1) so the reconciler doesn't strip it as a trailing
    // foreign node; `order:9999` on #ms-rfc-pill renders it LAST regardless
    // of DOM position, so it visually lands after Medicus's own badges when
    // the row is a flex container (it is, for a horizontal strip).
    target.insertBefore(buildPill(), target.firstChild);
  }

  function render() {
    var ids = resolveIdentity();
    if (!ids) {
      removePill();
      if (_panelState) closePanel();
      return;
    }
    if (_panelState && _panelState.patientUuid !== ids.patientUuid) {
      closePanel();
    }
    var host = document.querySelector(HOST_SELECTOR);
    if (!host) {
      removePill();
      return;
    }
    injectPill(host);
  }

  function queueRender() {
    if (_renderQueued) return;
    _renderQueued = true;
    setTimeout(function () {
      _renderQueued = false;
      try {
        render();
      } catch (_) {
        /* a pill bug must never break the host page */
      }
    }, 100);
  }

  if (window.__chObserverHub && typeof window.__chObserverHub.subscribe === 'function') {
    window.__chObserverHub.subscribe(queueRender);
  } else {
    setInterval(queueRender, 2000); // fallback if the hub failed to load before us
  }
  window.addEventListener('popstate', queueRender);
  window.addEventListener('hashchange', queueRender);
  queueRender();

  // ==============================================================================
  // Panel: discovery + review + confirm + write
  // ==============================================================================

  function getJson(apiBase, path) {
    return fetch(apiBase + path, { credentials: 'include', headers: { Accept: 'application/json' } }).then(
      function (r) {
        if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
        return r.json();
      }
    );
  }

  function postJson(apiBase, path, body) {
    return fetch(apiBase + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.text().then(function (text) {
        if (!r.ok) {
          console.error('[Risk Flag Cleanup] write failed', path, r.status);
          throw new Error(path + ' -> HTTP ' + r.status);
        }
        try {
          return text ? JSON.parse(text) : {};
        } catch (_) {
          return {};
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var FREE_TEXT_PREVIEW_LEN = 100;
  function describeNote(codeDescription, freeText) {
    if (codeDescription) return { text: codeDescription, isFreeText: false };
    var t = String(freeText || '').trim();
    if (!t) return { text: '(no code or text)', isFreeText: false };
    var preview = t.length > FREE_TEXT_PREVIEW_LEN ? t.slice(0, FREE_TEXT_PREVIEW_LEN).trim() + '…' : t;
    return { text: preview, isFreeText: true };
  }

  function rowMatchesFilter(r, filter) {
    var q = String(filter || '')
      .trim()
      .toLowerCase();
    if (!q) return true;
    return (
      String(r.description || '')
        .toLowerCase()
        .indexOf(q) !== -1 ||
      String(r.category || '')
        .toLowerCase()
        .indexOf(q) !== -1
    );
  }

  // Two badge shapes: exactly one note in a category links straight at it
  // (/clinical/note/overview/{noteId}); more than one collapses into a
  // summary badge whose link points at the category LIST instead
  // (/clinical/note/risks-overview/{patientId}/{slug}), expanded below into
  // one row per note via that same endpoint.
  var SINGLE_NOTE_RE = /\/clinical\/note\/overview\/([^/?]+)/;
  var CATEGORY_LIST_RE = /\/clinical\/note\/risks-overview\/[^/]+\/([^/?]+)/;

  // Fresh-GET-immediately-before-write, full-replace with ONLY
  // flagOnPatientBanner changed. Payload (including flags [] and the
  // recordedByOrganisation unwrap) is built by the core — do not inline a
  // `org.value` pass-through here.
  async function removeBannerFlag(apiBase, noteId) {
    var en = await getJson(apiBase, '/clinical/data/note/edit-note/' + noteId);
    if (en.flagOnPatientBanner === false) return { status: 'skipped', reason: 'already off' };
    var body = Core.buildClearBannerFlagPayload(en);
    await postJson(apiBase, '/clinical/note/change-note', body);
    var after = await getJson(apiBase, '/clinical/data/note/overview/' + noteId);
    var cleared = !(after.patientBannerFlags && after.patientBannerFlags.length);
    return cleared ? { status: 'removed' } : { status: 'failed', reason: 'banner flag still present after write' };
  }

  async function loadRows(apiBase, patientUuid) {
    var banner = await getJson(apiBase, '/patient/data/patient/patient-banner/' + patientUuid);
    var allBadges = banner.badges || [];
    var singleBadges = allBadges.filter(function (b) {
      return b.toSlideover && SINGLE_NOTE_RE.test(b.toSlideover);
    });
    var listBadges = allBadges.filter(function (b) {
      return b.toSlideover && CATEGORY_LIST_RE.test(b.toSlideover);
    });
    var skippedBadges = allBadges.filter(function (b) {
      return singleBadges.indexOf(b) === -1 && listBadges.indexOf(b) === -1;
    });

    var rows = [];
    for (var i = 0; i < singleBadges.length; i++) {
      var b = singleBadges[i];
      var noteId = SINGLE_NOTE_RE.exec(b.toSlideover)[1];
      var detail = null;
      try {
        detail = await getJson(apiBase, '/clinical/data/note/overview/' + noteId);
      } catch (_) {
        /* row still shows via the badge itself */
      }
      var d1 = describeNote(
        detail && detail.noteSNOMEDctCode && detail.noteSNOMEDctCode.description,
        detail && detail.note
      );
      rows.push({
        category: b.text,
        colour: b.colour,
        noteId: noteId,
        description: d1.text,
        isFreeText: d1.isFreeText,
        recordDate: (detail && detail.recordDate) || '',
        recordedBy: (detail && detail.recordedBy) || '',
        slideoverPath: b.toSlideover,
        status: 'pending',
        reason: '',
      });
    }
    for (var m = 0; m < listBadges.length; m++) {
      var lb = listBadges[m];
      var slug = CATEGORY_LIST_RE.exec(lb.toSlideover)[1];
      var listResp = null;
      try {
        listResp = await getJson(apiBase, '/clinical/data/note/risks-overview/' + patientUuid + '/' + slug);
      } catch (_) {
        /* nothing to expand for this category */
      }
      var risks = (listResp && listResp.risks) || [];
      var categoryLabel = (listResp && listResp.riskType) || lb.text.replace(/\s*\(\d+\)\s*$/, '');
      for (var n = 0; n < risks.length; n++) {
        var r = risks[n];
        var d2 = describeNote(r.noteSNOMEDctCode && r.noteSNOMEDctCode.description, r.note);
        rows.push({
          category: categoryLabel,
          colour: lb.colour,
          noteId: r.noteId,
          description: d2.text,
          isFreeText: d2.isFreeText,
          recordDate: r.careRecordEntryDate || '',
          recordedBy: '', // not on the list endpoint; description + date identifies the row
          slideoverPath: '/clinical/note/overview/' + r.noteId,
          status: 'pending',
          reason: '',
        });
      }
    }
    return { displayName: banner.displayName || '', rows: rows, skippedBadges: skippedBadges };
  }

  // ---- Panel UI -----------------------------------------------------------------

  function closePanel() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) el.remove();
    document.removeEventListener('keydown', onDocKeydown);
    _panelState = null;
    _writing = false;
    setPillExpanded(false);
  }

  function requestClose() {
    if (_writing) return;
    closePanel();
  }

  function togglePanel() {
    if (_panelState) {
      requestClose();
      return;
    }
    openPanel();
  }

  function onDocKeydown(e) {
    if (e.key !== 'Escape') return;
    if (_writing) return;
    requestClose();
  }

  function catClass(colour) {
    if (colour === 'red') return 'ms-rfc-cat ms-rfc-cat--red';
    if (colour === 'amber') return 'ms-rfc-cat ms-rfc-cat--amber';
    return 'ms-rfc-cat ms-rfc-cat--neutral';
  }

  function statusClass(status) {
    if (status === 'removed') return 'ms-rfc-status ms-rfc-status--removed';
    if (status === 'failed') return 'ms-rfc-status ms-rfc-status--failed';
    if (status === 'processing') return 'ms-rfc-status ms-rfc-status--processing';
    return 'ms-rfc-status';
  }

  function statusText(status) {
    if (status === 'processing') return 'Working…';
    if (status === 'removed') return 'Removed';
    if (status === 'failed') return 'Failed';
    if (status === 'skipped') return 'already off';
    return '';
  }

  function confirmBarHtml(targets) {
    var items = targets
      .map(function (r) {
        return (
          '<li>[' +
          escapeHtml(r.category) +
          '] ' +
          escapeHtml(r.description) +
          ' — ' +
          escapeHtml(r.recordDate || 'date unknown') +
          '</li>'
        );
      })
      .join('');
    return (
      '<p>Remove the Flag on patient banner from ' +
      targets.length +
      ' note' +
      (targets.length === 1 ? '' : 's') +
      '? This does not delete the note or change its clinical code — only the banner checkbox is cleared.</p>' +
      '<ul>' +
      items +
      '</ul>' +
      '<button type="button" class="ms-rfc-confirm-btn" data-act="confirm-cancel">Cancel</button>' +
      '<button type="button" class="ms-rfc-confirm-go" data-act="confirm-go">Remove banner flags</button>'
    );
  }

  function rowHtml(r, selected) {
    var pending = r.status === 'pending';
    var descClass = r.isFreeText ? 'ms-rfc-desc ms-rfc-desc-free' : 'ms-rfc-desc';
    var desc = r.isFreeText ? '“' + escapeHtml(r.description) + '”' : escapeHtml(r.description);
    var label = statusText(r.status);
    var statusHtml = label
      ? '<span class="' +
        statusClass(r.status) +
        '">' +
        escapeHtml(label) +
        (r.reason ? ' (' + escapeHtml(r.reason) + ')' : '') +
        '</span>'
      : '';
    return (
      '<div class="ms-rfc-row">' +
      '<label>' +
      '<input type="checkbox" data-note-id="' +
      escapeHtml(r.noteId || '') +
      '"' +
      (selected.has(r.noteId) ? ' checked' : '') +
      (pending ? '' : ' disabled') +
      ' />' +
      '<span class="' +
      catClass(r.colour) +
      '">' +
      escapeHtml(r.category) +
      '</span>' +
      '</label>' +
      '<a class="ms-rfc-open" href="' +
      escapeHtml(location.origin + r.slideoverPath) +
      '" target="_blank" rel="noopener">Open</a>' +
      '<div class="' +
      descClass +
      '">' +
      desc +
      '</div>' +
      '<div class="ms-rfc-date">' +
      escapeHtml(r.recordDate) +
      (r.recordedBy ? ' · ' + escapeHtml(r.recordedBy) : '') +
      '</div>' +
      statusHtml +
      '</div>'
    );
  }

  function ensureOverlay() {
    var el = document.getElementById(OVERLAY_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = OVERLAY_ID;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'ms-rfc-title');
    el.innerHTML =
      '<div class="ms-rfc-head">' +
      '<h2 class="ms-rfc-title" id="ms-rfc-title">Clean up alerts</h2>' +
      '<button type="button" class="ms-rfc-close" data-act="close">Close</button>' +
      '</div>' +
      '<p class="ms-rfc-meta"></p>' +
      '<p class="ms-rfc-counts"></p>' +
      '<p class="ms-rfc-skipped" hidden></p>' +
      '<input class="ms-rfc-filter" type="text" placeholder="Filter e.g. suicide" />' +
      '<div class="ms-rfc-actions">' +
      '<button type="button" class="ms-rfc-ghost" data-act="select-all" disabled>Select all shown (0)</button>' +
      '<button type="button" class="ms-rfc-remove" data-act="remove-selected" disabled>Remove 0 flags from banner</button>' +
      '</div>' +
      '<div data-rfc-list></div>' +
      '<div class="ms-rfc-confirmbar" hidden></div>';
    el.addEventListener('click', onOverlayClick);
    el.addEventListener('change', onOverlayChange);
    var filter = el.querySelector('.ms-rfc-filter');
    filter.addEventListener('input', function (e) {
      if (!_panelState) return;
      _panelState.filter = e.target.value;
      renderList();
    });
    document.body.appendChild(el);
    document.addEventListener('keydown', onDocKeydown);
    return el;
  }

  function renderList() {
    if (!_panelState) return;
    var overlay = ensureOverlay();
    var loaded = !!_panelState.loaded;
    var visible = loaded
      ? _panelState.rows.filter(function (r) {
          return rowMatchesFilter(r, _panelState.filter);
        })
      : [];
    var selectableCount = visible.filter(function (r) {
      return r.status === 'pending';
    }).length;
    var targets = loaded ? Core.visiblePendingSelected(_panelState.rows, _panelState.selected, _panelState.filter) : [];
    var selectedCount = targets.length;

    overlay.querySelector('.ms-rfc-meta').textContent = _panelState.loadError
      ? ''
      : loaded
        ? _panelState.displayName || ''
        : 'Loading flags…';

    var counts = overlay.querySelector('.ms-rfc-counts');
    counts.textContent = loaded ? _panelState.rows.length + ' flag(s) total, ' + visible.length + ' shown' : '';

    var skipped = overlay.querySelector('.ms-rfc-skipped');
    if (loaded && _panelState.skippedCount) {
      skipped.hidden = false;
      skipped.textContent =
        _panelState.skippedCount + ' banner badges could not be listed (not a note link) — they were not included.';
    } else {
      skipped.hidden = true;
      skipped.textContent = '';
    }

    var filter = overlay.querySelector('.ms-rfc-filter');
    filter.hidden = !loaded;
    var actions = overlay.querySelector('.ms-rfc-actions');
    actions.hidden = !loaded;

    var selectAll = overlay.querySelector('[data-act="select-all"]');
    selectAll.textContent = 'Select all shown (' + selectableCount + ')';
    selectAll.disabled = !selectableCount || _writing;

    var removeBtn = overlay.querySelector('[data-act="remove-selected"]');
    removeBtn.textContent = 'Remove ' + selectedCount + ' flag' + (selectedCount === 1 ? '' : 's') + ' from banner';
    removeBtn.disabled = !selectedCount || _writing;

    var list = overlay.querySelector('[data-rfc-list]');
    if (_panelState.loadError) {
      list.innerHTML = '<p class="ms-rfc-empty">Failed to load: ' + escapeHtml(_panelState.loadError) + '</p>';
    } else if (!loaded) {
      list.innerHTML = '<p class="ms-rfc-empty">Loading flags…</p>';
    } else if (!visible.length) {
      list.innerHTML = '<p class="ms-rfc-empty">No flags match that filter.</p>';
    } else {
      list.innerHTML = visible
        .map(function (r) {
          return rowHtml(r, _panelState.selected);
        })
        .join('');
    }

    var bar = overlay.querySelector('.ms-rfc-confirmbar');
    if (loaded && _panelState.confirming && !_writing && targets.length) {
      var firstShow = bar.hidden;
      bar.hidden = false;
      bar.innerHTML = confirmBarHtml(targets);
      if (firstShow) {
        var cancel = bar.querySelector('.ms-rfc-confirm-btn');
        if (cancel) cancel.focus();
      }
    } else {
      bar.hidden = true;
      bar.innerHTML = '';
      if (loaded && _panelState.confirming && !targets.length) _panelState.confirming = false;
    }

    if (loaded && !_panelState.filterFocused) {
      _panelState.filterFocused = true;
      filter.focus();
    }
  }

  function onOverlayChange(e) {
    var cb = e.target && e.target.matches && e.target.matches('input[type="checkbox"][data-note-id]');
    if (!cb || !_panelState) return;
    var id = e.target.getAttribute('data-note-id');
    if (e.target.checked) _panelState.selected.add(id);
    else _panelState.selected.delete(id);
    renderList();
  }

  function onOverlayClick(e) {
    var btn = e.target.closest && e.target.closest('[data-act]');
    if (!btn || !_panelState) return;
    var act = btn.dataset.act;

    if (act === 'close') {
      requestClose();
      return;
    }

    if (act === 'select-all') {
      if (_writing) return;
      _panelState.rows.forEach(function (r) {
        if (r.status === 'pending' && rowMatchesFilter(r, _panelState.filter)) {
          _panelState.selected.add(r.noteId);
        }
      });
      renderList();
      return;
    }

    if (act === 'confirm-cancel') {
      if (_writing) return;
      _panelState.confirming = false;
      renderList();
      return;
    }

    if (act === 'remove-selected') {
      if (_writing) return;
      var preview = Core.visiblePendingSelected(_panelState.rows, _panelState.selected, _panelState.filter);
      if (!preview.length) return;
      _panelState.confirming = true;
      renderList();
      return;
    }

    if (act === 'confirm-go') {
      if (_writing) return;
      runBatch();
    }
  }

  async function runBatch() {
    if (!_panelState || _writing) return;
    var targets = Core.visiblePendingSelected(_panelState.rows, _panelState.selected, _panelState.filter);
    if (!targets.length) return;

    _writing = true;
    _panelState.confirming = false;
    var expectedUuid = _panelState.patientUuid;
    var apiBase = _panelState.apiBase;

    for (var i = 0; i < targets.length; i++) {
      var r = targets[i];
      // Wrong-patient re-check immediately before EACH write in the batch —
      // a long-running batch must never fire against a patient the SPA has
      // since navigated away from underneath it (H-043 family).
      var live = resolveIdentity();
      if (!_panelState || !live || live.patientUuid !== expectedUuid) {
        closePanel();
        return;
      }
      r.status = 'processing';
      _panelState.selected.delete(r.noteId);
      renderList();
      try {
        var res = await removeBannerFlag(apiBase, r.noteId);
        r.status = res.status;
        r.reason = res.reason || '';
      } catch (err) {
        r.status = 'failed';
        r.reason = String((err && err.message) || err);
      }
      renderList();
      if (r.status === 'failed') break; // stop the batch, don't plough on into unknown state
    }

    _writing = false;
    if (_panelState) renderList();
  }

  async function openPanel() {
    var ids = resolveIdentity();
    if (!ids) return;

    _panelState = {
      patientUuid: ids.patientUuid,
      apiBase: ids.apiBase,
      rows: [],
      selected: new Set(),
      filter: '',
      displayName: '',
      skippedCount: 0,
      confirming: false,
      loaded: false,
      filterFocused: false,
      loadError: '',
    };
    _writing = false;
    setPillExpanded(true);
    ensureOverlay();
    renderList();

    var data;
    try {
      data = await loadRows(ids.apiBase, ids.patientUuid);
    } catch (e) {
      if (!_panelState || _panelState.patientUuid !== ids.patientUuid) return;
      _panelState.loadError = String((e && e.message) || e);
      renderList();
      return;
    }
    // Panel may have been closed, or the patient may have changed, while
    // that fetch was in flight — never render stale data over a new patient.
    if (!_panelState || _panelState.patientUuid !== ids.patientUuid) return;
    _panelState.rows = data.rows;
    _panelState.displayName = data.displayName;
    _panelState.skippedCount = (data.skippedBadges && data.skippedBadges.length) || 0;
    _panelState.loaded = true;
    renderList();
  }
})();
