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
// This is a straight port of the write path already discovered, live-tested
// and hardened in the standalone tools/risk-flag-review/ console tool over
// several rounds of real 400/500 failures against production — see that
// tool's README for the full HAR-capture research trail behind the
// change-note contract (in particular: `flags` and `recordedByOrganisation`
// both need reshaping from what GET returns before they can be POSTed back).
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
  window.__rfcMounted = true;

  var PILL_ID = 'rfc-pill';
  var PANEL_ID = 'rfc-panel';
  // Same host selector set sentinel's pageReady() and patient-alerts-banner.js
  // already wait on for the patient header/banner container.
  var HOST_SELECTOR = '[class*="patient-banner"], [class*="patient-header"], [data-cy*="patient-banner"]';

  var _renderQueued = false;
  var _panelState = null; // null when closed; object when open (see openPanel)

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

  function buildPill() {
    var pill = document.createElement('button');
    pill.id = PILL_ID;
    pill.type = 'button';
    pill.textContent = 'Clean up alerts';
    pill.title = 'Review and remove banner risk flags for this patient';
    pill.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'margin-left:auto',
      'order:9999', // render last regardless of DOM position (see prepend note below)
      'background:#2a4d8f',
      'color:#fff',
      'border:1px solid rgba(255,255,255,.45)',
      'border-radius:14px',
      'padding:2px 10px',
      'font:600 12px/1.6 -apple-system,Segoe UI,sans-serif',
      'cursor:pointer',
      'white-space:nowrap',
    ].join(';');
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
    // foreign node; `order:9999` in the pill's own style renders it LAST
    // regardless of DOM position, so it visually lands after Medicus's own
    // badges when the row is a flex container (it is, for a horizontal strip).
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
    }).then(async function (r) {
      var text = '';
      try {
        text = await r.text();
      } catch (_) {
        /* body already consumed / unreadable */
      }
      if (!r.ok) {
        console.error('[Risk Flag Cleanup] write failed', {
          path: path,
          requestBody: body,
          status: r.status,
          responseText: text,
        });
        throw new Error(path + ' -> HTTP ' + r.status + (text ? ': ' + text.slice(0, 400) : ''));
      }
      try {
        return text ? JSON.parse(text) : {};
      } catch (_) {
        return {};
      }
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

  // Two badge shapes: exactly one note in a category links straight at it
  // (/clinical/note/overview/{noteId}); more than one collapses into a
  // summary badge whose link points at the category LIST instead
  // (/clinical/note/risks-overview/{patientId}/{slug}), expanded below into
  // one row per note via that same endpoint.
  var SINGLE_NOTE_RE = /\/clinical\/note\/overview\/([^/?]+)/;
  var CATEGORY_LIST_RE = /\/clinical\/note\/risks-overview\/[^/]+\/([^/?]+)/;

  // Fresh-GET-immediately-before-write, full-replace with ONLY
  // flagOnPatientBanner changed. `flags` and `recordedByOrganisation` both
  // need reshaping from edit-note's GET shape before they can be POSTed back
  // — see the header comment for the research trail; do not "simplify" this
  // back to a raw pass-through without re-reading it.
  async function removeBannerFlag(apiBase, noteId) {
    var en = await getJson(apiBase, '/clinical/data/note/edit-note/' + noteId);
    if (en.flagOnPatientBanner === false) return { status: 'skipped', reason: 'already off' };
    var recordedByOrganisation = en.recordedByOrganisation ? en.recordedByOrganisation.value : null;
    var body = {
      noteId: en.noteId,
      note: en.note,
      noteSNOMEDct: en.noteSNOMEDct,
      hiddenFromPatientFacingServices: en.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: en.confidentialFromThirdParties,
      flagOnPatientBanner: false,
      recordedByOrganisation: recordedByOrganisation,
      recordedByPractitioner: en.recordedByPractitioner,
      recordedByStaff: en.recordedByStaff,
      recordDate: en.recordDate,
      flags: en.flags,
      clinicalCaseId: en.linkedClinicalCase ? en.linkedClinicalCase.defaultClinicalCaseId : null,
      linkedProblemIds: en.linkedProblemIds,
    };
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
    var el = document.getElementById(PANEL_ID);
    if (el) el.remove();
    _panelState = null;
  }

  function togglePanel() {
    if (_panelState) {
      closePanel();
      return;
    }
    openPanel();
  }

  async function openPanel() {
    var ids = resolveIdentity();
    if (!ids) return;

    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'top:16px',
      'right:16px',
      'width:420px',
      'max-height:80vh',
      'overflow:auto',
      'background:#1e1e1e',
      'color:#e8e8e8',
      'font:13px/1.4 -apple-system,Segoe UI,sans-serif',
      'border:1px solid #444',
      'border-radius:8px',
      'box-shadow:0 8px 24px rgba(0,0,0,.4)',
      'z-index:2147483647',
      'padding:12px',
    ].join(';');
    document.body.appendChild(panel);

    _panelState = {
      patientUuid: ids.patientUuid,
      apiBase: ids.apiBase,
      rows: [],
      selected: new Set(),
      filter: '',
      displayName: '',
    };

    function setBody(html) {
      panel.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<strong>Clean up alerts</strong>' +
        '<button id="rfc-close" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;">&times;</button>' +
        '</div>' +
        html;
      var closeBtn = document.getElementById('rfc-close');
      if (closeBtn)
        closeBtn.onclick = function () {
          closePanel();
        };
    }

    setBody('<p>Loading flags&hellip;</p>');

    var data;
    try {
      data = await loadRows(ids.apiBase, ids.patientUuid);
    } catch (e) {
      if (_panelState)
        setBody('<p style="color:#f66">Failed to load: ' + escapeHtml(String((e && e.message) || e)) + '</p>');
      return;
    }
    // Panel may have been closed, or the patient may have changed, while
    // that fetch was in flight — never render stale data over a new patient.
    if (!_panelState || _panelState.patientUuid !== ids.patientUuid) return;
    _panelState.rows = data.rows;
    _panelState.displayName = data.displayName;

    var STATUS_LABEL = {
      pending: '',
      processing: '&#8987; working&hellip;',
      removed: '&#10003; removed',
      skipped: 'already off',
      failed: '&#10007; failed',
    };
    var STATUS_COLOUR = { processing: '#999', removed: '#4a4', skipped: '#999', failed: '#f66' };

    function renderList() {
      if (!_panelState) return;
      var q = (_panelState.filter || '').trim().toLowerCase();
      var visible = _panelState.rows.filter(function (r) {
        return !q || r.description.toLowerCase().indexOf(q) !== -1 || r.category.toLowerCase().indexOf(q) !== -1;
      });
      var selectableCount = visible.filter(function (r) {
        return r.status === 'pending';
      }).length;
      var selectedCount = visible.filter(function (r) {
        return _panelState.selected.has(r.noteId) && r.status === 'pending';
      }).length;

      var list = visible
        .map(function (r) {
          var done = r.status !== 'pending' && r.status !== 'processing';
          var statusHtml =
            r.status === 'pending'
              ? ''
              : '<span style="color:' +
                (STATUS_COLOUR[r.status] || '#999') +
                ';font-size:11px;">' +
                STATUS_LABEL[r.status] +
                (r.reason ? ' (' + escapeHtml(r.reason) + ')' : '') +
                '</span>';
          return (
            '<div style="border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:6px;' +
            (done ? 'opacity:.6;' : '') +
            '">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label style="display:flex;align-items:center;gap:6px;">' +
            '<input type="checkbox" class="rfc-cb" data-note-id="' +
            escapeHtml(r.noteId || '') +
            '" ' +
            (_panelState.selected.has(r.noteId) ? 'checked' : '') +
            ' ' +
            (r.status === 'pending' ? '' : 'disabled') +
            ' />' +
            '<span style="background:' +
            (r.colour === 'amber' ? '#7a5b00' : r.colour === 'red' ? '#7a1e1e' : '#444') +
            ';color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;">' +
            escapeHtml(r.category) +
            '</span>' +
            '</label>' +
            '<a href="' +
            escapeHtml(location.origin + r.slideoverPath) +
            '" target="_blank" rel="noopener" style="color:#6cf;text-decoration:none;">Open &rarr;</a>' +
            '</div>' +
            '<div style="margin-top:4px;font-weight:' +
            (r.isFreeText ? '400' : '600') +
            ';' +
            (r.isFreeText ? 'font-style:italic;color:#ccc;' : '') +
            '">' +
            (r.isFreeText ? '&ldquo;' : '') +
            escapeHtml(r.description) +
            (r.isFreeText ? '&rdquo;' : '') +
            '</div>' +
            '<div style="color:#999;font-size:11px;">' +
            escapeHtml(r.recordDate) +
            (r.recordedBy ? ' &middot; ' + escapeHtml(r.recordedBy) : '') +
            '</div>' +
            '<div style="color:#666;font-size:10px;">' +
            escapeHtml(r.noteId || '') +
            '</div>' +
            (statusHtml ? '<div style="margin-top:2px;">' + statusHtml + '</div>' : '') +
            '</div>'
          );
        })
        .join('');

      setBody(
        '<div style="margin-bottom:8px;color:#aaa;">' +
          escapeHtml(_panelState.displayName) +
          ' &mdash; ' +
          _panelState.rows.length +
          ' flag(s) total, ' +
          visible.length +
          ' shown</div>' +
          '<input id="rfc-filter" type="text" placeholder="Filter e.g. suicide" value="' +
          escapeHtml(_panelState.filter) +
          '" style="width:100%;box-sizing:border-box;padding:6px;margin-bottom:8px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;" />' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
          '<button data-act="select-all" style="padding:4px 8px;background:#333;color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;" ' +
          (selectableCount ? '' : 'disabled') +
          '>Select all shown (' +
          selectableCount +
          ')</button>' +
          '<button data-act="remove-selected" style="padding:4px 8px;background:' +
          (selectedCount ? '#7a1e1e' : '#333') +
          ';color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;" ' +
          (selectedCount ? '' : 'disabled') +
          '>Remove ' +
          selectedCount +
          ' flag(s) from banner</button>' +
          '</div>' +
          (list || '<p style="color:#888;">No flags match that filter.</p>') +
          '<p style="color:#666;font-size:11px;margin-top:8px;">Tick rows and click "Remove" to clear just the banner flag (confirmed before anything writes) &mdash; or click Open to edit a note yourself in Medicus.</p>'
      );

      var input = document.getElementById('rfc-filter');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.oninput = function (e) {
          _panelState.filter = e.target.value;
          renderList();
        };
      }
    }

    panel.addEventListener('change', function (e) {
      var cb = e.target.closest && e.target.closest('.rfc-cb');
      if (!cb || !_panelState) return;
      if (cb.checked) _panelState.selected.add(cb.dataset.noteId);
      else _panelState.selected.delete(cb.dataset.noteId);
      renderList();
    });

    panel.addEventListener('click', async function (e) {
      var btn = e.target.closest && e.target.closest('[data-act]');
      if (!btn || !_panelState) return;

      if (btn.dataset.act === 'select-all') {
        var q = (_panelState.filter || '').trim().toLowerCase();
        _panelState.rows
          .filter(function (r) {
            return (
              r.status === 'pending' &&
              (!q || r.description.toLowerCase().indexOf(q) !== -1 || r.category.toLowerCase().indexOf(q) !== -1)
            );
          })
          .forEach(function (r) {
            _panelState.selected.add(r.noteId);
          });
        renderList();
        return;
      }

      if (btn.dataset.act !== 'remove-selected') return;
      var targets = _panelState.rows.filter(function (r) {
        return _panelState.selected.has(r.noteId) && r.status === 'pending';
      });
      if (!targets.length) return;

      var lines = targets
        .map(function (r) {
          return '  • [' + r.category + '] ' + r.description + ' — ' + (r.recordDate || 'date unknown');
        })
        .join('\n');
      var ok = confirm(
        'Remove the "Flag on patient banner" from ' +
          targets.length +
          ' note(s)?\n\n' +
          lines +
          '\n\n' +
          'This does NOT delete the note or change its clinical code — only the banner checkbox is ' +
          'cleared. Each note is re-fetched fresh immediately before writing and every other field is ' +
          'preserved exactly as read.\n\n' +
          'OK = remove ' +
          (targets.length > 1 ? 'them all' : 'it') +
          '    Cancel = do nothing'
      );
      if (!ok) return;

      var results = [];
      for (var i = 0; i < targets.length; i++) {
        var r = targets[i];
        // Wrong-patient re-check immediately before EACH write in the batch —
        // a long-running batch must never fire against a patient the SPA has
        // since navigated away from underneath it (H-043 family).
        var live = resolveIdentity();
        if (!_panelState || !live || live.patientUuid !== _panelState.patientUuid) {
          closePanel();
          return;
        }
        r.status = 'processing';
        _panelState.selected.delete(r.noteId);
        renderList();
        try {
          var res = await removeBannerFlag(_panelState.apiBase, r.noteId);
          r.status = res.status;
          r.reason = res.reason || '';
        } catch (err) {
          r.status = 'failed';
          r.reason = String((err && err.message) || err);
        }
        results.push({
          noteId: r.noteId,
          category: r.category,
          description: r.description,
          status: r.status,
          reason: r.reason,
        });
        renderList();
        if (r.status === 'failed') break; // stop the batch, don't plough on into unknown state
      }
      console.log('[Risk Flag Cleanup] batch results:');
      console.table(results);
    });

    renderList();
  }
})();
