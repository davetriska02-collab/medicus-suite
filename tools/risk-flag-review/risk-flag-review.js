// Risk Flag Review — standalone console tool. NOT part of the medicus-suite
// extension (not in manifest.json, not loaded by any content script) —
// deliberately separate so it carries none of the suite's shipped write-path
// governance; it earns that exemption itself, below, by staying to the same
// discipline as the shipped suite's other clinical writes even without being
// forced to.
//
// WHAT THIS DOES
// Lists every "flag on patient banner" note for the patient currently open in
// Medicus (Risk to self, Risk to others, Risk from others, Reasonable
// adjustment, Medico-legal), with a search box, so you can find the ones you
// want (e.g. "low suicide risk") out of a patient with dozens of flags in
// seconds. You can then tick any number of them and remove just the banner
// flag in one batch — this does NOT delete the note or change its SNOMED
// code, it only clears the same "Flag on patient banner" checkbox you'd
// otherwise untick by hand on each note's Edit form.
//
// THE WRITE CONTRACT (confirmed from a live HAR capture, 2026-08-26)
// POST /clinical/note/change-note takes the note's ENTIRE record back
// (full-replace, no partial-update). The two fields that matter here —
// `flagOnPatientBanner` (boolean) and `flags` (the note's risk-category
// slugs, e.g. ["risk-to-self"]) — are both returned by a fresh
// GET /clinical/data/note/edit-note/{noteId}, so they are read live off that
// note immediately before every write, never guessed or hardcoded from a
// label. (`flagOptions` on that same response is the authoritative slug list
// — risk-to-self, risk-to-others, risk-from-others,
// local-reasonable-adjustment, medico-legal — note "local-reasonable-
// adjustment" is NOT what naively kebab-casing "Reasonable adjustment" would
// produce, which is exactly why this reads the live value instead of
// deriving it from the badge label.)
//
// SAFETY DISCIPLINE (same pattern the shipped suite uses for every clinical
// write — see CLAUDE.md / docs/CLINICAL-SAFETY-NOTICE.md's W-table)
// - Nothing is ticked for you. You choose every row.
// - One explicit confirm dialog names every note (description, category,
//   date) before ANY request fires. Cancel is the safe default.
// - Each write re-fetches edit-note fresh immediately beforehand (never
//   reuses the list-view snapshot) and changes ONLY flagOnPatientBanner —
//   every other field goes back exactly as read.
// - Already-unflagged notes (e.g. someone else beat you to it) are skipped,
//   not re-sent.
// - Every write is verified afterwards (re-fetch note/overview and check the
//   flag actually cleared) and every result — success, skip, or failure — is
//   shown per-row, plus dumped to the console as a table you can screenshot
//   or copy for your own record.
// - Writes run one at a time, never in parallel, and a failure stops the
//   batch rather than plough on.
//
// HOW TO RUN
// 1. Open the patient's record in Medicus (any tab within their record works
//    — the banner badges are patient-wide, not tab-specific).
// 2. Open DevTools (F12) -> Console, paste this whole file, press Enter.
// 3. A panel appears top-right listing every banner flag on that patient.
// 4. Tick the ones you want gone, click "Remove N flag(s) from banner",
//    review the confirm dialog carefully, then confirm.
//
// If it can't auto-detect the patient ID or API host (see DISCOVERY below),
// it tells you in the panel and you can hardcode them at the top of this file.

(async function riskFlagReview() {
  'use strict';

  const PANEL_ID = 'rfr-panel-root';
  const existing = document.getElementById(PANEL_ID);
  if (existing) existing.remove(); // re-running replaces the old panel

  // ---- DISCOVERY: API host + patient id ------------------------------------
  // Medicus's API lives on a practice-specific subdomain (e.g.
  // e38a9f.api.england.medicus.health / iam.api.gb.medicus.health) that
  // differs from the page's own host and isn't derivable by a fixed string
  // rule, so rather than hardcode it, sniff it from a request the SPA has
  // already made via the Resource Timing API.
  //
  // IMPORTANT: the page loads MULTIPLE `*.api.*` hosts — at minimum an IAM/
  // auth host (e.g. iam.api.gb.medicus.health) as well as the clinical data
  // host this tool actually needs. A bare "first host matching *.api.*" grab
  // picked up IAM and 404'd on the very first fetch. So host and patientId
  // are now taken TOGETHER, only from a URL whose PATH is one of the specific
  // endpoints this tool calls — never from an unrelated api host that merely
  // happened to load first.
  const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  // NOTE: deliberately excludes clinical/data/note/overview/{noteId} — the id
  // segment there is a NOTE id, not a patient id, and would silently
  // mismatch every endpoint below that expects a patient id in that slot.
  const TRUSTED_PATH_RE = new RegExp(
    '^https://([^/]+)/(?:' +
      'patient/data/patient/(?:patient-banner|care-record)|' +
      'clinical/data/note/risks-overview|' +
      'clinical/data/patient-journal/overview' +
      ')/(' +
      UUID_RE +
      ')'
  );
  function sniff() {
    const resources = performance.getEntriesByType('resource').map((r) => r.name);
    for (const url of resources) {
      const m = TRUSTED_PATH_RE.exec(url);
      if (m) return { apiHost: m[1], patientId: m[2] };
    }
    return { apiHost: null, patientId: null };
  }

  // Manual override — fill these in if auto-detection fails (e.g. you ran the
  // script before the page made any relevant request yet: reload, let the
  // patient banner render, then re-run).
  const OVERRIDE = { apiHost: null, patientId: null };

  const detected = sniff();
  const apiHost = OVERRIDE.apiHost || detected.apiHost;
  const patientId = OVERRIDE.patientId || detected.patientId;

  // ---- Panel shell ----------------------------------------------------------
  const panel = document.createElement('div');
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

  function setBody(html) {
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
      '<strong>Risk Flag Review</strong>' +
      '<button id="rfr-close" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;">&times;</button>' +
      '</div>' +
      html;
    const closeBtn = document.getElementById('rfr-close');
    if (closeBtn) closeBtn.onclick = () => panel.remove();
  }

  if (!apiHost || !patientId) {
    setBody(
      '<p style="color:#f0a">Could not auto-detect the API host + patient ID.</p>' +
        '<p>This needs the page to have already made one of: a patient-banner, care-record, ' +
        "risks-overview, or patient-journal request. Open the patient's Clinical Summary (so the " +
        'banner renders) or their Journal, wait a moment, then re-run this script.</p>' +
        '<p>Or edit the OVERRIDE object at the top of the file with the host + patient UUID from any ' +
        'such request in the Network tab (host = everything before the first "/" after "https://"; ' +
        'patient UUID = the id segment right after "patient-banner/", "care-record/" etc — NOT an ' +
        '"iam.api...." host, that\'s the auth service, not the data host).</p>'
    );
    return;
  }

  setBody('<p>Loading flags for patient <code>' + patientId + '</code>&hellip;</p>');

  // ---- Fetch: patient banner badges, then each flagged note's detail --------
  async function getJson(path) {
    const resp = await fetch('https://' + apiHost + path, { credentials: 'include' });
    if (!resp.ok) throw new Error(path + ' -> HTTP ' + resp.status);
    return resp.json();
  }

  let banner;
  try {
    banner = await getJson('/patient/data/patient/patient-banner/' + patientId);
  } catch (e) {
    setBody('<p style="color:#f66">Failed to load patient banner: ' + String(e.message || e) + '</p>');
    return;
  }
  // Debug hook — if a category silently doesn't show up in the panel, run
  // `copy(window.__rfrLastBanner)` in the console and inspect the badges
  // array (e.g. does the missing category's badge use toModal instead of
  // toSlideover? is it grouped/summarised instead of one-badge-per-note?).
  window.__rfrLastBanner = banner;

  // Two badge shapes observed:
  //  - Exactly one note in a category -> toSlideover points straight at that
  //    note: /clinical/note/overview/{noteId}
  //  - More than one -> Medicus collapses them into ONE summary badge (text
  //    carries a count, e.g. "Risks to Self (26)") whose toSlideover points at
  //    the category LIST instead: /clinical/note/risks-overview/{patientId}/{slug}
  //    (the same endpoint the very first HAR capture used for the list pane).
  //    That list response returns every note in the category in one call, so
  //    it's expanded into one row each below.
  const SINGLE_NOTE_RE = /\/clinical\/note\/overview\/([^/?]+)/;
  const CATEGORY_LIST_RE = /\/clinical\/note\/risks-overview\/[^/]+\/([^/?]+)/;
  const allBadges = banner.badges || [];
  const singleBadges = allBadges.filter((b) => b.toSlideover && SINGLE_NOTE_RE.test(b.toSlideover));
  const listBadges = allBadges.filter((b) => b.toSlideover && CATEGORY_LIST_RE.test(b.toSlideover));
  const skippedBadges = allBadges.filter((b) => !singleBadges.includes(b) && !listBadges.includes(b));
  if (!singleBadges.length && !listBadges.length) {
    setBody('<p>' + escapeHtml(banner.displayName || 'This patient') + ' has no note-backed banner flags.</p>');
    return;
  }

  // A row's clinical content is EITHER a coded SNOMED term OR free text (the
  // `note` field) — not always both. Previously an uncoded, free-text-only
  // entry showed as "(description unavailable)"; now it previews the text
  // itself so the row is still identifiable, marked as free text (rendered
  // in italics) so it's never confused with a coded term.
  const FREE_TEXT_PREVIEW_LEN = 100;
  function describeNote(codeDescription, freeText) {
    if (codeDescription) return { text: codeDescription, isFreeText: false };
    const t = String(freeText || '').trim();
    if (!t) return { text: '(no code or text)', isFreeText: false };
    const preview = t.length > FREE_TEXT_PREVIEW_LEN ? t.slice(0, FREE_TEXT_PREVIEW_LEN).trim() + '…' : t;
    return { text: preview, isFreeText: true };
  }

  const rows = [];
  for (const b of singleBadges) {
    const noteId = SINGLE_NOTE_RE.exec(b.toSlideover)[1];
    let detail = null;
    try {
      detail = await getJson('/clinical/data/note/overview/' + noteId);
    } catch (_) {
      /* leave detail null — row still shows the badge itself */
    }
    const { text: description, isFreeText } = describeNote(detail?.noteSNOMEDctCode?.description, detail?.note);
    rows.push({
      category: b.text,
      colour: b.colour,
      noteId,
      description,
      isFreeText,
      recordDate: detail?.recordDate || '',
      recordedBy: detail?.recordedBy || '',
      slideoverPath: b.toSlideover,
      status: 'pending', // pending -> processing -> removed | skipped | failed
      reason: '',
    });
  }
  for (const b of listBadges) {
    const slug = CATEGORY_LIST_RE.exec(b.toSlideover)[1];
    let listResp = null;
    try {
      listResp = await getJson('/clinical/data/note/risks-overview/' + patientId + '/' + slug);
    } catch (_) {
      /* leave listResp null — nothing to expand, row simply won't appear */
    }
    const risks = (listResp && listResp.risks) || [];
    // Prefer the API's own clean label; fall back to stripping the "(26)"
    // count suffix off the badge text if the list fetch failed.
    const categoryLabel = (listResp && listResp.riskType) || b.text.replace(/\s*\(\d+\)\s*$/, '');
    for (const r of risks) {
      const { text: description, isFreeText } = describeNote(r.noteSNOMEDctCode?.description, r.note);
      rows.push({
        category: categoryLabel,
        colour: b.colour,
        noteId: r.noteId,
        description,
        isFreeText,
        recordDate: r.careRecordEntryDate || '',
        // Not present on the list endpoint (only noteId/code/date/isMarkedAsIncorrect)
        // — leaving it blank here avoids one extra fetch per note in what can
        // be a 26+ item category; description + date is enough to identify
        // and confirm each row.
        recordedBy: '',
        slideoverPath: '/clinical/note/overview/' + r.noteId,
        status: 'pending',
        reason: '',
      });
    }
  }

  // ---- Write: remove the banner flag from one note ---------------------------
  // Fresh-GET-immediately-before-write, full-replace with ONLY
  // flagOnPatientBanner changed — same discipline the shipped suite uses for
  // change-note elsewhere (docs/CLINICAL-SAFETY-NOTICE.md W19).
  async function postJson(path, body) {
    const resp = await fetch('https://' + apiHost + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let text = '';
    try {
      text = await resp.text();
    } catch (_) {
      /* body already consumed / unreadable — fall through with empty text */
    }
    if (!resp.ok) {
      // Dump the exact request + response so a validation failure is
      // diagnosable from the console without re-triggering it — a bare
      // "HTTP 400" throws away the one thing (the server's own validation
      // message) that explains what's actually wrong.
      console.error('[Risk Flag Review] write failed', {
        path,
        requestBody: body,
        status: resp.status,
        responseText: text,
      });
      throw new Error(path + ' -> HTTP ' + resp.status + (text ? ': ' + text.slice(0, 400) : ''));
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch (_) {
      return {};
    }
  }

  async function removeBannerFlag(noteId) {
    const en = await getJson('/clinical/data/note/edit-note/' + noteId);
    if (en.flagOnPatientBanner === false) {
      return { status: 'skipped', reason: 'already off' };
    }
    // recordedByOrganisation is a SECOND field (after flags/flagOnPatientBanner)
    // where edit-note's GET shape and change-note's POST shape diverge. GET
    // returns a picker-shaped object for the UI: {label, value}, where `value`
    // is ALREADY the exact object the POST wants
    // ({organisationName, organisationIdentifierType, organisationIdentifierValue})
    // — confirmed by diffing a real successful manual removal (HAR
    // 93-removing-flag-live, 2026-08-26) against this note's edit-note GET.
    // An earlier version of this fix sent {organisationName: en.recordedByOrganisation.label}
    // (name only, reconstructed from the display label) — that satisfied the
    // shallow "organisationName present" validation (which had rejected
    // {label, value} outright with a clean 400), but was still missing the
    // two ODS-code fields, and failed later with an opaque HTTP 500 instead
    // of a validation message. Passing `.value` through unchanged avoids
    // reconstructing anything at all.
    const recordedByOrganisation = en.recordedByOrganisation ? en.recordedByOrganisation.value : null;
    const body = {
      noteId: en.noteId,
      note: en.note,
      noteSNOMEDct: en.noteSNOMEDct,
      hiddenFromPatientFacingServices: en.hiddenFromPatientFacingServices,
      confidentialFromThirdParties: en.confidentialFromThirdParties,
      flagOnPatientBanner: false,
      recordedByOrganisation,
      recordedByPractitioner: en.recordedByPractitioner,
      recordedByStaff: en.recordedByStaff,
      recordDate: en.recordDate,
      flags: en.flags,
      clinicalCaseId: en.linkedClinicalCase ? en.linkedClinicalCase.defaultClinicalCaseId : null,
      linkedProblemIds: en.linkedProblemIds,
    };
    await postJson('/clinical/note/change-note', body);
    const after = await getJson('/clinical/data/note/overview/' + noteId);
    const cleared = !(after.patientBannerFlags && after.patientBannerFlags.length);
    return cleared ? { status: 'removed' } : { status: 'failed', reason: 'banner flag still present after write' };
  }

  // ---- Render list ------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  }

  const selected = new Set();
  let currentFilter = '';

  const STATUS_LABEL = {
    pending: '',
    processing: '&#8987; working&hellip;',
    removed: '&#10003; removed',
    skipped: 'already off',
    failed: '&#10007; failed',
  };
  const STATUS_COLOUR = { processing: '#999', removed: '#4a4', skipped: '#999', failed: '#f66' };

  function render(filterText) {
    currentFilter = filterText || '';
    const q = currentFilter.trim().toLowerCase();
    const visible = rows.filter(
      (r) => !q || r.description.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)
    );
    const selectableCount = visible.filter((r) => r.status === 'pending').length;
    const selectedCount = visible.filter((r) => selected.has(r.noteId) && r.status === 'pending').length;

    const list = visible
      .map((r) => {
        const done = r.status !== 'pending' && r.status !== 'processing';
        const statusHtml =
          r.status === 'pending'
            ? ''
            : `<span style="color:${STATUS_COLOUR[r.status] || '#999'};font-size:11px;">${STATUS_LABEL[r.status]}${r.reason ? ' (' + escapeHtml(r.reason) + ')' : ''}</span>`;
        return `
      <div style="border:1px solid #333;border-radius:6px;padding:8px;margin-bottom:6px;${done ? 'opacity:.6;' : ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" class="rfr-cb" data-note-id="${escapeHtml(r.noteId || '')}"
                   ${selected.has(r.noteId) ? 'checked' : ''} ${r.status === 'pending' ? '' : 'disabled'} />
            <span style="background:${r.colour === 'amber' ? '#7a5b00' : r.colour === 'red' ? '#7a1e1e' : '#444'};
                         color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;">${escapeHtml(r.category)}</span>
          </label>
          <a href="${escapeHtml(location.origin + r.slideoverPath)}" target="_blank" rel="noopener"
             style="color:#6cf;text-decoration:none;">Open &rarr;</a>
        </div>
        <div style="margin-top:4px;font-weight:${r.isFreeText ? '400' : '600'};${r.isFreeText ? 'font-style:italic;color:#ccc;' : ''}">${r.isFreeText ? '&ldquo;' : ''}${escapeHtml(r.description)}${r.isFreeText ? '&rdquo;' : ''}</div>
        <div style="color:#999;font-size:11px;">${escapeHtml(r.recordDate)}${r.recordedBy ? ' &middot; ' + escapeHtml(r.recordedBy) : ''}</div>
        <div style="color:#666;font-size:10px;">${escapeHtml(r.noteId || '')}</div>
        ${statusHtml ? `<div style="margin-top:2px;">${statusHtml}</div>` : ''}
      </div>`;
      })
      .join('');

    const skippedWarning = skippedBadges.length
      ? `<div style="background:#4a3b00;border:1px solid #a80;border-radius:6px;padding:8px;margin-bottom:8px;font-size:11px;">
          <strong>${skippedBadges.length} badge(s) not shown</strong> — their shape wasn't recognised
          (no <code>toSlideover</code> pointing at a note). Click below to copy their raw JSON so this can
          be fixed to also handle them.
          <div><button data-act="copy-skipped" style="margin-top:6px;padding:3px 8px;background:#333;color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;">Copy skipped badge JSON</button></div>
        </div>`
      : '';

    setBody(`
      <div style="margin-bottom:8px;color:#aaa;">${escapeHtml(banner.displayName || '')} &mdash; ${rows.length} flag(s) total, ${visible.length} shown</div>
      ${skippedWarning}
      <input id="rfr-filter" type="text" placeholder="Filter e.g. suicide"
             value="${escapeHtml(currentFilter)}"
             style="width:100%;box-sizing:border-box;padding:6px;margin-bottom:8px;background:#111;color:#eee;border:1px solid #444;border-radius:4px;" />
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <button data-act="select-all" style="padding:4px 8px;background:#333;color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;" ${selectableCount ? '' : 'disabled'}>
          Select all shown (${selectableCount})
        </button>
        <button data-act="remove-selected" style="padding:4px 8px;background:${selectedCount ? '#7a1e1e' : '#333'};color:#eee;border:1px solid #555;border-radius:4px;cursor:pointer;" ${selectedCount ? '' : 'disabled'}>
          Remove ${selectedCount} flag(s) from banner
        </button>
      </div>
      ${list || '<p style="color:#888;">No flags match that filter.</p>'}
      <p style="color:#666;font-size:11px;margin-top:8px;">Tick rows and click "Remove" to clear just the banner flag (confirmed before anything writes) — or click Open to edit a note yourself in Medicus.</p>
    `);

    const input = document.getElementById('rfr-filter');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.oninput = (e) => render(e.target.value);
    }
  }

  // Event delegation on the stable panel element — innerHTML is replaced
  // wholesale on every render(), so listeners are attached once here rather
  // than re-bound per row/per render.
  panel.addEventListener('change', (e) => {
    const cb = e.target.closest('.rfr-cb');
    if (!cb) return;
    if (cb.checked) selected.add(cb.dataset.noteId);
    else selected.delete(cb.dataset.noteId);
    render(currentFilter);
  });

  panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'select-all') {
      const q = currentFilter.trim().toLowerCase();
      rows
        .filter(
          (r) =>
            r.status === 'pending' &&
            (!q || r.description.toLowerCase().includes(q) || r.category.toLowerCase().includes(q))
        )
        .forEach((r) => selected.add(r.noteId));
      render(currentFilter);
    } else if (btn.dataset.act === 'copy-skipped') {
      try {
        await navigator.clipboard.writeText(JSON.stringify(skippedBadges, null, 2));
        btn.textContent = 'Copied!';
      } catch (_) {
        console.log('[Risk Flag Review] skipped badges:', skippedBadges);
        btn.textContent = 'See console instead';
      }
    } else if (btn.dataset.act === 'remove-selected') {
      const targets = rows.filter((r) => selected.has(r.noteId) && r.status === 'pending');
      if (!targets.length) return;
      const lines = targets
        .map((r) => `  • [${r.category}] ${r.description} — ${r.recordDate || 'date unknown'}`)
        .join('\n');
      const ok = confirm(
        `Remove the "Flag on patient banner" from ${targets.length} note(s)?\n\n${lines}\n\n` +
          'This does NOT delete the note or change its clinical code — only the banner checkbox is ' +
          'cleared. Each note is re-fetched fresh immediately before writing and every other field is ' +
          'preserved exactly as read.\n\n' +
          `OK = remove ${targets.length > 1 ? 'them all' : 'it'}    Cancel = do nothing`
      );
      if (!ok) return;

      const results = [];
      for (const r of targets) {
        r.status = 'processing';
        selected.delete(r.noteId);
        render(currentFilter);
        try {
          const res = await removeBannerFlag(r.noteId);
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
        render(currentFilter);
        if (r.status === 'failed') break; // stop the batch, don't plough on into unknown state
      }
      console.log('[Risk Flag Review] batch results:');
      console.table(results);
    }
  });

  render('');
})();
