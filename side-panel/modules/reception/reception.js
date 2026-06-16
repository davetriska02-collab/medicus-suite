// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Reception module
//
// A reception-facing panel with two cards:
//   1. Patient — a single green/amber/red status pill for the patient open in
//      the Medicus tab; clicking it expands the action-needed monitoring/QOF
//      detail ("book the overdue bloods while they're on the phone"). Which
//      chips surface here is practice-configurable (Options → Reception);
//      filtering is shown, never silent.
//   2. Guided capture — fixed question sets per presenting problem. ALL
//      pathways ship disabled; a practice administrator must accept the
//      disclaimer in Options → Reception to enable them. Practices can edit
//      bundled pathways and author custom ones there. Red flags come first
//      with escalation prompts; output is a structured plain-text block to
//      copy-paste into the Medicus triage entry. Capture only — the tool
//      never triages, diagnoses, or advises beyond red-flag escalation.
//
// Storage (managed in Options, read-only here):
//   reception.config           { enabledPathways, hiddenChipRules, disclaimerAcceptedAt }
//   reception.customPathways   [pathway]
//   reception.pathwayOverrides { id: pathway }

'use strict';

import { summariseActionChips, evaluateRedFlags, buildCaptureText, pharmacyFirstHint } from './reception-core.js';

let container = null;
let _bundledDoc = null; // reception-pathways.json document
let _config = {}; // reception.config
let _effective = { all: [], enabled: [] };
let _snapshot = null; // last Sentinel snapshot (or null)
let _takerInitials = ''; // in-memory only, per panel session
let _pillExpanded = false;
let _onActivated = null;
let _storageListener = null;

// ── Draft autosave ────────────────────────────────────────────────────────────
// reception.captureDraft — transient working state, PHI-bearing, TTL 4 h.
// Never backed up (allowlisted in test-backup-coverage.js).

const DRAFT_KEY = 'reception.captureDraft';
const DRAFT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
let _draftDebounceTimer = null;

async function loadDraft() {
  try {
    const r = await chrome.storage.local.get(DRAFT_KEY);
    const d = r[DRAFT_KEY];
    if (!d || typeof d !== 'object') return null;
    if (typeof d.savedAt !== 'number' || Date.now() - d.savedAt > DRAFT_TTL_MS) {
      chrome.storage.local.remove(DRAFT_KEY);
      return null;
    }
    return d;
  } catch (_) {
    return null;
  }
}

function saveDraft(pathwayId, form) {
  const fields = {};
  if (!form) return;
  // Radios: each named group — read checked value
  const radioGroups = new Set();
  form.querySelectorAll('input[type="radio"]').forEach((el) => {
    if (el.name) radioGroups.add(el.name);
  });
  radioGroups.forEach((name) => {
    const checked = form.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`);
    fields[name] = checked ? checked.value : '';
  });
  // Checkboxes (multi questions)
  const cbGroups = new Set();
  form.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    if (el.name) cbGroups.add(el.name);
  });
  cbGroups.forEach((name) => {
    fields[name] = Array.from(form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]:checked`)).map(
      (el) => el.value
    );
  });
  // Text inputs, selects, textareas — identified by name attribute
  form.querySelectorAll('input[type="text"], select, textarea').forEach((el) => {
    if (el.name) fields[el.name] = el.value;
  });
  // Initials stored separately (id=rcpInitials, no name)
  const initialsEl = form.querySelector('#rcpInitials');
  if (initialsEl) fields['__initials__'] = initialsEl.value;

  try {
    chrome.storage.local.set({
      [DRAFT_KEY]: { pathwayId, savedAt: Date.now(), fields },
    });
  } catch (_) {}
}

function scheduleDraftSave(pathwayId, form) {
  if (_draftDebounceTimer !== null) clearTimeout(_draftDebounceTimer);
  _draftDebounceTimer = setTimeout(() => {
    _draftDebounceTimer = null;
    saveDraft(pathwayId, form);
  }, 400);
}

function clearDraft() {
  if (_draftDebounceTimer !== null) {
    clearTimeout(_draftDebounceTimer);
    _draftDebounceTimer = null;
  }
  try {
    chrome.storage.local.remove(DRAFT_KEY);
  } catch (_) {}
}

function fmtHHMM(epochMs) {
  try {
    return new Date(epochMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
}

function restoreDraftFields(form, fields) {
  if (!form || !fields || typeof fields !== 'object') return;
  // Restore initials
  if (fields['__initials__'] !== undefined) {
    const el = form.querySelector('#rcpInitials');
    if (el) {
      el.value = fields['__initials__'];
      _takerInitials = fields['__initials__'];
    }
  }
  // Restore text inputs, selects, textareas by name
  form.querySelectorAll('input[type="text"], select, textarea').forEach((el) => {
    if (el.name && fields[el.name] !== undefined) el.value = fields[el.name];
  });
  // Restore radios
  const radioGroups = new Set();
  form.querySelectorAll('input[type="radio"]').forEach((el) => {
    if (el.name) radioGroups.add(el.name);
  });
  radioGroups.forEach((name) => {
    const val = fields[name];
    if (val) {
      const target = form.querySelector(`input[type="radio"][name="${CSS.escape(name)}"][value="${CSS.escape(val)}"]`);
      if (target) target.checked = true;
    }
  });
  // Restore checkboxes
  const cbGroups = new Set();
  form.querySelectorAll('input[type="checkbox"]').forEach((el) => {
    if (el.name) cbGroups.add(el.name);
  });
  cbGroups.forEach((name) => {
    const vals = fields[name];
    if (Array.isArray(vals)) {
      form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(name)}"]`).forEach((el) => {
        el.checked = vals.includes(el.value);
      });
    }
  });
}

// Tile organisation (reception.tilePrefs) — colour / order / sort. Display only.
let _tilePrefs = { sortMode: 'manual', order: [], colours: {} };
let _organising = false; // true → reorder/colour mode (tiles don't launch capture)
let _openColourFor = null; // pathway id whose colour palette is open, or null
let _ignoreNextTilePrefsChange = false; // skip our own storage write echo

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _organising = false;
  _openColourFor = null;

  container.innerHTML = `
    <div class="rcp-module">
      <div class="rcp-head">
        <h2 class="rcp-title">Reception</h2>
        <span class="rcp-subtitle">Ask the caller a set of standard questions — a clinician always reviews and decides.</span>
      </div>
      <div class="rcp-card" id="rcpPatientCard"><div class="rcp-card-title">Patient</div><div class="rcp-card-body rcp-muted">Looking for an open patient record…</div></div>
      <div class="rcp-card" id="rcpCaptureCard"><div class="rcp-card-title">Guided capture</div><div class="rcp-card-body" id="rcpCaptureBody"></div></div>
    </div>`;

  try {
    const r = await fetch(chrome.runtime.getURL('rules/reception-pathways.json'));
    _bundledDoc = await r.json();
  } catch (e) {
    const body = container?.querySelector('#rcpCaptureBody');
    if (body) body.innerHTML = `<div class="rcp-error">Could not load capture pathways: ${esc(e.message)}</div>`;
    _bundledDoc = null;
  }

  await loadConfigAndResolve();
  const initDraft = await loadDraft();
  renderPathwayPicker(initDraft);
  refreshPatientCard();

  _onActivated = () => refreshPatientCard();
  chrome.tabs.onActivated.addListener(_onActivated);

  // Live-update when the admin changes reception config/pathways in Options, or
  // when tile prefs change in another context (pop-out ↔ panel).
  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    const tileOnly =
      changes['reception.tilePrefs'] &&
      !changes['reception.config'] &&
      !changes['reception.customPathways'] &&
      !changes['reception.pathwayOverrides'];
    if (tileOnly) {
      // Skip the echo of our own write so an in-progress organise action isn't reset.
      if (_ignoreNextTilePrefsChange) {
        _ignoreNextTilePrefsChange = false;
        return;
      }
      loadConfigAndResolve().then(async () => {
        if (container) renderPathwayPicker(await loadDraft());
      });
      return;
    }
    if (
      changes['reception.config'] ||
      changes['reception.customPathways'] ||
      changes['reception.pathwayOverrides'] ||
      changes['suite.practiceAcceptedAt'] // the single "Accept for practice" switch
    ) {
      loadConfigAndResolve().then(async () => {
        if (!container) return;
        renderPathwayPicker(await loadDraft());
        refreshPatientCard();
      });
    }
  };
  chrome.storage.onChanged.addListener(_storageListener);

  return cleanup;
}

function cleanup() {
  if (_onActivated) {
    chrome.tabs.onActivated.removeListener(_onActivated);
    _onActivated = null;
  }
  if (_storageListener) {
    chrome.storage.onChanged.removeListener(_storageListener);
    _storageListener = null;
  }
  if (_draftDebounceTimer !== null) {
    clearTimeout(_draftDebounceTimer);
    _draftDebounceTimer = null;
  }
  _snapshot = null;
  container = null;
}

export { cleanup };

async function loadConfigAndResolve() {
  const r = await chrome.storage.local.get([
    'reception.config',
    'reception.customPathways',
    'reception.pathwayOverrides',
    'reception.tilePrefs',
    'suite.practiceAcceptedAt',
  ]);
  _config = r['reception.config'] || {};
  // Acceptance is satisfied by EITHER the per-install reception disclaimer OR the
  // single suite-level "Accept for practice" switch (which travels in backups).
  const accepted = _config.disclaimerAcceptedAt != null || r['suite.practiceAcceptedAt'] != null;
  const PU = typeof window !== 'undefined' ? window.ReceptionPathwayUtils : null;
  _tilePrefs = PU
    ? PU.sanitiseTilePrefs(r['reception.tilePrefs'] || {})
    : r['reception.tilePrefs'] || { sortMode: 'manual', order: [], colours: {} };
  if (PU && _bundledDoc) {
    _effective = PU.resolveEffectivePathways({
      bundled: _bundledDoc.pathways || [],
      overrides: r['reception.pathwayOverrides'] || {},
      customPathways: r['reception.customPathways'] || [],
      enabledPathways: _config.enabledPathways || {},
      disclaimerAccepted: accepted,
    });
  } else {
    _effective = { all: [], enabled: [] };
  }
}

// ── Card 1: patient status pill ───────────────────────────────────────────────

async function fetchSnapshot() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab?.url || !/medicus\.health/.test(tab.url)) return null;
  const mountCheck = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => !!window.__sentinelMounted,
  });
  if (!mountCheck?.[0]?.result) return null;
  const snapshot = await chrome.tabs.sendMessage(tab.id, { action: 'getSentinelSnapshot' });
  if (!snapshot || snapshot.unavailable || !snapshot.chips) return null;
  return snapshot;
}

async function refreshPatientCard() {
  if (!container) return;
  const card = container.querySelector('#rcpPatientCard .rcp-card-body');
  if (!card) return;
  try {
    _snapshot = await fetchSnapshot();
  } catch (_) {
    _snapshot = null;
  }
  if (!container) return; // cleaned up mid-fetch
  renderPatientCard();
}

function renderPatientCard() {
  const card = container?.querySelector('#rcpPatientCard .rcp-card-body');
  if (!card) return;

  if (!_snapshot) {
    card.innerHTML = `<span class="rcp-muted">This panel mirrors the patient open in Medicus. Open a record and their details appear here.</span>
      <button class="rcp-link-btn" id="rcpPatientRefresh">Refresh</button>`;
    card.querySelector('#rcpPatientRefresh')?.addEventListener('click', refreshPatientCard);
    return;
  }

  const pc = _snapshot.patientContext || {};
  const sum = summariseActionChips(_snapshot.chips, _config.hiddenChipRules || {});
  const who = [pc.patientName, pc.ageYears != null ? `${pc.ageYears}y` : null].filter(Boolean).join(', ');

  // Single status pill: red wins over amber, green = nothing to action.
  const level = sum.red > 0 ? 'red' : sum.amber > 0 ? 'amber' : 'green';
  const pillText =
    level === 'green' ? 'Nothing flagged' : `${sum.red + sum.amber} to action${sum.red ? ` · ${sum.red} overdue` : ''}`;

  const degradedNote = _snapshot.degraded
    ? `<div class="rcp-error">Record extraction incomplete — this status may be missing data.</div>`
    : '';
  const filteredNote =
    sum.hiddenCount > 0
      ? `<div class="rcp-fineprint">${sum.hiddenCount} alert(s) not shown here by practice settings (visible in Monitoring).</div>`
      : '';

  let detailHtml = '';
  if (_pillExpanded) {
    const rows = sum.items
      .map(
        (i) =>
          `<div class="rcp-detail-row rcp-detail-${i.colour}"><span class="rcp-detail-name">${esc(i.name)}</span><span class="rcp-detail-status">${esc(i.statusLabel)}</span></div>`
      )
      .join('');
    detailHtml = `
      <div class="rcp-pill-detail" id="rcpPillDetail">
        ${rows || '<div class="rcp-muted">No action-needed alerts in the current data.</div>'}
        ${filteredNote}
        <div class="rcp-fineprint">No alert ≠ everything is up to date — the Monitoring tab has the full picture.</div>
        <button class="rcp-link-btn" id="rcpGotoSentinel">Open Monitoring <span aria-hidden="true">→</span></button>
      </div>`;
  }

  card.innerHTML = `
    <div class="rcp-patient-line"><strong>${esc(who || 'Patient')}</strong>${pc.nhsNumber ? ` <span class="rcp-nhs">NHS ${esc(pc.nhsNumber)}</span>` : ''}
      <button class="rcp-link-btn" id="rcpPatientRefresh">Refresh</button>
    </div>
    ${degradedNote}
    <button class="rcp-pill rcp-pill-${level}" id="rcpPill" aria-expanded="${_pillExpanded}" aria-controls="rcpPillDetail">
      <span class="rcp-pill-dot" aria-hidden="true"></span>${esc(pillText)}
      <span class="rcp-pill-caret" aria-hidden="true">${_pillExpanded ? '▴' : '▾'}</span>
    </button>
    ${detailHtml}`;

  card.querySelector('#rcpPatientRefresh')?.addEventListener('click', refreshPatientCard);
  card.querySelector('#rcpPill')?.addEventListener('click', () => {
    _pillExpanded = !_pillExpanded;
    renderPatientCard();
  });
  card.querySelector('#rcpGotoSentinel')?.addEventListener('click', () => {
    document.querySelector('.nav-tab[data-module="sentinel"]')?.click();
  });
}

// ── Card 2: guided capture ────────────────────────────────────────────────────

function renderPathwayPicker(_activeDraft) {
  if (!container) return;
  const body = container.querySelector('#rcpCaptureBody');
  if (!body || !_bundledDoc) return;

  const enabled = _effective.enabled;
  if (enabled.length === 0) {
    body.innerHTML = `
      <div class="rcp-setup-note">
        This is a one-time practice setup. Ask your practice manager to enable
        pathways. Nothing for you to do here.
      </div>
      <div class="rcp-disabled-note">
        <strong>Capture pathways are switched off.</strong>
        All pathways ship disabled. A practice administrator can review the
        disclaimer and enable them in Options → Reception.
      </div>
      <button class="rcp-btn" id="rcpOpenOptions">Open options</button>`;
    body.querySelector('#rcpOpenOptions')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  const PU = window.ReceptionPathwayUtils;
  const ordered = PU ? PU.orderTiles(enabled, _tilePrefs) : enabled;
  const alpha = _tilePrefs.sortMode === 'alpha';
  const colourKeys = (PU && PU.TILE_COLOUR_KEYS) || ['default'];

  // _activeDraft may be passed in from the async init path; otherwise not shown.
  const draftPathwayId = _activeDraft ? _activeDraft.pathwayId : null;

  const toolbar = `
    <div class="rcp-tile-toolbar">
      <div class="rcp-sort-ctrl">
        <span class="rcp-sort-label">Order</span>
        <button class="rcp-seg ${alpha ? '' : 'rcp-seg-on'}" data-sort="manual" type="button">Manual</button>
        <button class="rcp-seg ${alpha ? 'rcp-seg-on' : ''}" data-sort="alpha" type="button">A&ndash;Z</button>
      </div>
      <button class="rcp-link-btn rcp-organise-toggle" id="rcpOrganise" type="button">${_organising ? 'Done' : 'Organise tiles'}</button>
    </div>`;

  const tiles = ordered
    .map((p) => {
      const colour = PU ? PU.tileColourFor(_tilePrefs, p.id) : 'default';
      const draggable = _organising && !alpha;
      const handle = draggable ? `<span class="rcp-drag-handle" aria-hidden="true">&#10303;</span>` : '';
      const swatch = _organising
        ? `<button class="rcp-tile-swatch rcp-tile-c-${esc(colour)}" data-colour-for="${esc(p.id)}" type="button" aria-label="Set tile colour"></button>`
        : '';
      const palette =
        _organising && _openColourFor === p.id
          ? `<div class="rcp-colour-palette">` +
            colourKeys
              .map(
                (k) =>
                  `<button class="rcp-colour-dot rcp-tile-c-${esc(k)} ${k === colour ? 'rcp-colour-sel' : ''}" data-set-colour="${esc(k)}" data-for="${esc(p.id)}" type="button" aria-label="${esc(k)}"></button>`
              )
              .join('') +
            `</div>`
          : '';
      const draftPill =
        !_organising && draftPathwayId === p.id
          ? `<span class="rcp-draft-pill" aria-label="Unsaved draft">draft</span>`
          : '';
      // Persistent colour-label dot (organise mode shows the interactive swatch
      // in the same corner instead). A dot reads as a personal tag, not a
      // clinical-severity edge-bar.
      const tag = !_organising && colour !== 'default' ? `<span class="rcp-tile-tag" aria-hidden="true"></span>` : '';
      return `<div class="rcp-pathway-tile rcp-tile-c-${esc(colour)}${_organising ? ' rcp-tile-organising' : ''}" data-pathway="${esc(p.id)}"${draggable ? ' draggable="true"' : ''}>
      ${handle}
      <button class="rcp-pathway-btn" data-pathway-go="${esc(p.id)}" type="button"${_organising ? ' tabindex="-1"' : ''}>
        <span class="rcp-pathway-title">${esc(p.title)}</span>
        <span class="rcp-pathway-applies">${esc(p.appliesTo || '')}</span>
        ${draftPill}
      </button>
      ${tag}${swatch}${palette}
    </div>`;
    })
    .join('');

  const note = _organising
    ? `<div class="rcp-fineprint">${alpha ? 'Switch to &ldquo;Manual&rdquo; to drag tiles into your own order. ' : 'Drag tiles to reorder. '}Tap the dot to colour-label a tile. Colours and order organise your tiles only &mdash; they are not a clinical flag.</div>`
    : `<div class="rcp-picker-note">Pick the problem that best matches what the caller describes. Red-flag (safety) questions come first — if the caller answers YES to any, stop and follow the on-screen action, which tells you exactly who to contact.</div>`;

  body.innerHTML = `${toolbar}${note}<div class="rcp-pathway-grid${_organising ? ' rcp-organising' : ''}">${tiles}</div>`;

  body.querySelector('#rcpOrganise')?.addEventListener('click', () => {
    _organising = !_organising;
    _openColourFor = null;
    renderPathwayPicker();
  });
  body
    .querySelectorAll('.rcp-seg')
    .forEach((btn) => btn.addEventListener('click', () => setSortMode(btn.dataset.sort)));

  body.querySelectorAll('.rcp-pathway-btn[data-pathway-go]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (_organising) return; // organise mode: launching a capture is disabled
      const p = enabled.find((x) => x.id === btn.dataset.pathwayGo);
      if (p) renderCaptureForm(p);
    });
  });

  if (_organising) {
    body.querySelectorAll('.rcp-tile-swatch').forEach((sw) =>
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = sw.dataset.colourFor;
        _openColourFor = _openColourFor === id ? null : id;
        renderPathwayPicker();
      })
    );
    body.querySelectorAll('.rcp-colour-dot').forEach((dot) =>
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        setTileColour(dot.dataset.for, dot.dataset.setColour);
      })
    );
    if (!alpha) wireTileDrag(body);
  }
}

// Persist the in-memory tile prefs. _ignoreNextTilePrefsChange suppresses the
// storage-change echo so the listener doesn't re-render over an active action.
function persistTilePrefs() {
  _ignoreNextTilePrefsChange = true;
  try {
    chrome.storage.local.set({
      'reception.tilePrefs': {
        sortMode: _tilePrefs.sortMode === 'alpha' ? 'alpha' : 'manual',
        order: Array.isArray(_tilePrefs.order) ? _tilePrefs.order : [],
        colours: _tilePrefs.colours || {},
      },
    });
  } catch (_) {
    _ignoreNextTilePrefsChange = false;
  }
}

function setSortMode(mode) {
  _tilePrefs.sortMode = mode === 'alpha' ? 'alpha' : 'manual';
  persistTilePrefs();
  renderPathwayPicker();
}

function setTileColour(id, key) {
  if (!id) return;
  _tilePrefs.colours = _tilePrefs.colours || {};
  if (key === 'default') delete _tilePrefs.colours[id];
  else _tilePrefs.colours[id] = key;
  _openColourFor = null;
  persistTilePrefs();
  renderPathwayPicker();
}

// The pathway ids in the current MANUAL order (independent of sort mode), used
// as the basis for a drag reorder so switching to A–Z then back is stable.
function currentManualOrder() {
  const PU = window.ReceptionPathwayUtils;
  const list = PU
    ? PU.orderTiles(_effective.enabled, { sortMode: 'manual', order: _tilePrefs.order })
    : _effective.enabled;
  return list.map((p) => p.id);
}

function reorderTile(dragId, targetId) {
  const ids = currentManualOrder();
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from === -1 || to === -1 || from === to) return;
  ids.splice(from, 1);
  ids.splice(to, 0, dragId);
  _tilePrefs.order = ids;
  _tilePrefs.sortMode = 'manual';
  persistTilePrefs();
  renderPathwayPicker();
}

function wireTileDrag(body) {
  const grid = body.querySelector('.rcp-pathway-grid');
  if (!grid) return;
  let dragId = null;
  grid.querySelectorAll('.rcp-pathway-tile[draggable="true"]').forEach((tile) => {
    tile.addEventListener('dragstart', (e) => {
      dragId = tile.dataset.pathway;
      tile.classList.add('rcp-tile-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', dragId);
        } catch (_) {}
      }
    });
    tile.addEventListener('dragend', () => {
      tile.classList.remove('rcp-tile-dragging');
      grid.querySelectorAll('.rcp-tile-over').forEach((t) => t.classList.remove('rcp-tile-over'));
      dragId = null;
    });
    tile.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (dragId && tile.dataset.pathway !== dragId) tile.classList.add('rcp-tile-over');
    });
    tile.addEventListener('dragleave', () => tile.classList.remove('rcp-tile-over'));
    tile.addEventListener('drop', (e) => {
      e.preventDefault();
      tile.classList.remove('rcp-tile-over');
      const targetId = tile.dataset.pathway;
      if (dragId && targetId) reorderTile(dragId, targetId);
    });
  });
}

function inputHtml(scope, q) {
  const nm = `${scope}-${q.id}`;
  if (q.type === 'yesno') {
    return `<span class="rcp-yn">
      <label><input type="radio" name="${esc(nm)}" value="Yes"> Yes</label>
      <label><input type="radio" name="${esc(nm)}" value="No"> No</label>
    </span>`;
  }
  if (q.type === 'choice') {
    const opts = (q.options || []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    return `<select name="${esc(nm)}"><option value="">—</option>${opts}</select>`;
  }
  if (q.type === 'multi') {
    return (
      `<span class="rcp-multi">` +
      (q.options || [])
        .map((o) => `<label><input type="checkbox" name="${esc(nm)}" value="${esc(o)}"> ${esc(o)}</label>`)
        .join('') +
      `</span>`
    );
  }
  return `<input type="text" name="${esc(nm)}" autocomplete="off">`;
}

async function renderCaptureForm(pathway) {
  const body = container?.querySelector('#rcpCaptureBody');
  if (!body || !_bundledDoc) return;

  const rfRows = (pathway.redFlags || [])
    .map(
      (rf) => `
    <div class="rcp-rf-row" data-rf="${esc(rf.id)}">
      <span class="rcp-rf-ask">${esc(rf.ask)}</span>
      <span class="rcp-yn">
        <label><input type="radio" name="rf-${esc(rf.id)}" value="yes"> Yes</label>
        <label><input type="radio" name="rf-${esc(rf.id)}" value="no"> No</label>
      </span>
    </div>`
    )
    .join('');

  const qRows = (pathway.questions || [])
    .map(
      (q) => `
    <div class="rcp-q-row"><label class="rcp-q-ask">${esc(q.ask)}</label>${inputHtml('q', q)}</div>`
    )
    .join('');
  const cRows = (_bundledDoc.closingQuestions || [])
    .map(
      (q) => `
    <div class="rcp-q-row"><label class="rcp-q-ask">${esc(q.ask)}</label>${inputHtml('c', q)}</div>`
    )
    .join('');

  body.innerHTML = `
    <form class="rcp-form" id="rcpForm">
      <div class="rcp-form-head">
        <button type="button" class="rcp-link-btn" id="rcpBack"><span aria-hidden="true">←</span> All pathways</button>
        <span class="rcp-form-title">${esc(pathway.title)}</span>
        <label class="rcp-initials">Your initials <input type="text" id="rcpInitials" maxlength="5" value="${esc(_takerInitials)}"></label>
      </div>

      <div class="rcp-draft-banner rcp-draft-banner-hidden" id="rcpDraftBanner" aria-live="polite"></div>

      <div class="rcp-banner rcp-banner-hidden" id="rcpEscBanner" role="alert" aria-atomic="true"></div>

      <div class="rcp-section rcp-section-rf">
        <div class="rcp-section-title">1 · Red flags — ask every one</div>
        ${rfRows}
      </div>

      <div class="rcp-section">
        <div class="rcp-section-title">2 · About the problem</div>
        <div class="rcp-q-row"><label class="rcp-q-ask">In the patient's own words, what's the problem?</label>
          <textarea name="ownWords" rows="2"></textarea></div>
        ${qRows}
      </div>

      <div class="rcp-section">
        <div class="rcp-section-title">3 · Wrapping up</div>
        ${cRows}
      </div>

      <div class="rcp-form-actions">
        <button type="submit" class="rcp-btn rcp-btn-primary">Generate summary</button>
        <span class="rcp-form-msg" id="rcpFormMsg"></span>
      </div>
    </form>`;

  const form = body.querySelector('#rcpForm');

  // Check for a restorable draft for this specific pathway
  const draft = await loadDraft();
  if (draft && draft.pathwayId === pathway.id) {
    const banner = form.querySelector('#rcpDraftBanner');
    if (banner) {
      banner.className = 'rcp-draft-banner';
      banner.innerHTML = `Draft from ${esc(fmtHHMM(draft.savedAt))} — <button type="button" class="rcp-link-btn rcp-draft-restore" id="rcpDraftRestore">Restore</button> · <button type="button" class="rcp-link-btn rcp-draft-discard" id="rcpDraftDiscard">Discard</button>`;
      banner.querySelector('#rcpDraftRestore')?.addEventListener('click', () => {
        restoreDraftFields(form, draft.fields);
        updateEscalationBanner(form, pathway);
        banner.className = 'rcp-draft-banner rcp-draft-banner-hidden';
      });
      banner.querySelector('#rcpDraftDiscard')?.addEventListener('click', () => {
        clearDraft();
        banner.className = 'rcp-draft-banner rcp-draft-banner-hidden';
      });
    }
  }

  body.querySelector('#rcpBack')?.addEventListener('click', () => {
    loadDraft().then((d) => renderPathwayPicker(d));
  });
  body.querySelector('#rcpInitials')?.addEventListener('input', (e) => {
    _takerInitials = e.target.value.trim();
  });

  // Escalation banner reacts the moment any red flag is answered YES.
  form.addEventListener('change', () => {
    updateEscalationBanner(form, pathway);
    scheduleDraftSave(pathway.id, form);
  });
  form.addEventListener('input', () => scheduleDraftSave(pathway.id, form));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    generateSummary(form, pathway);
  });
}

function readRedFlagAnswers(form, pathway) {
  const answers = {};
  for (const rf of pathway.redFlags || []) {
    const v = form.querySelector(`input[name="rf-${CSS.escape(rf.id)}"]:checked`)?.value;
    if (v === 'yes' || v === 'no') answers[rf.id] = v;
  }
  return answers;
}

function updateEscalationBanner(form, pathway) {
  const banner = form.querySelector('#rcpEscBanner');
  if (!banner) return;
  const { positives } = evaluateRedFlags(pathway.redFlags, readRedFlagAnswers(form, pathway));
  if (positives.length === 0) {
    banner.className = 'rcp-banner rcp-banner-hidden';
    banner.textContent = '';
    return;
  }
  // 999-level escalation wins over duty-level when both are present.
  const level = positives.some((p) => p.escalate === '999') ? '999' : 'duty';
  banner.className = `rcp-banner rcp-banner-${level === '999' ? 'red' : 'amber'}`;
  // Fallback includes the level so the receptionist always knows 999-vs-duty even if
  // the escalations map entry is missing (near-unreachable; validation forces level ∈ {999,duty}).
  banner.textContent = `RED FLAG — ${(_bundledDoc.escalations && _bundledDoc.escalations[level]) || `ACTION (level ${level}): Escalate immediately.`}`;
}

function readQuestionAnswers(form, scope, questions) {
  const out = {};
  for (const q of questions || []) {
    const nm = `${scope}-${q.id}`;
    if (q.type === 'multi') {
      const vals = Array.from(form.querySelectorAll(`input[name="${CSS.escape(nm)}"]:checked`)).map((i) => i.value);
      out[q.id] = vals;
    } else {
      const el = form.querySelector(`[name="${CSS.escape(nm)}"]${q.type === 'yesno' ? ':checked' : ''}`);
      out[q.id] = el ? el.value : '';
    }
  }
  return out;
}

function generateSummary(form, pathway) {
  const msg = form.querySelector('#rcpFormMsg');
  const rfAnswers = readRedFlagAnswers(form, pathway);
  const { unanswered } = evaluateRedFlags(pathway.redFlags, rfAnswers);

  form.querySelectorAll('.rcp-rf-row').forEach((row) => {
    row.classList.toggle('rcp-rf-missing', unanswered.includes(row.dataset.rf));
  });
  if (unanswered.length > 0) {
    if (msg) msg.textContent = `Answer every red-flag question first (${unanswered.length} unanswered).`;
    form.querySelector('.rcp-rf-missing')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (msg) msg.textContent = '';

  const pc = _snapshot?.patientContext || null;
  const patientLine = pc?.patientName
    ? [pc.patientName, pc.dateOfBirth ? `DOB ${pc.dateOfBirth}` : null, pc.nhsNumber ? `NHS ${pc.nhsNumber}` : null]
        .filter(Boolean)
        .join(', ')
    : null;

  const text = buildCaptureText({
    pathway,
    closingQuestions: _bundledDoc.closingQuestions || [],
    escalations: _bundledDoc.escalations || {},
    ownWords: (form.querySelector('[name="ownWords"]')?.value || '').trim(),
    redFlagAnswers: rfAnswers,
    questionAnswers: readQuestionAnswers(form, 'q', pathway.questions),
    closingAnswers: readQuestionAnswers(form, 'c', _bundledDoc.closingQuestions),
    meta: {
      takerInitials: _takerInitials,
      nowIso: new Date().toISOString(),
      suiteVersion: chrome.runtime.getManifest?.().version || '',
      patientLine,
      pharmacyFirstHint: pharmacyFirstHint(pathway, pc?.ageYears ?? null),
    },
  });

  // Draft completed — clear it before rendering the output screen.
  clearDraft();

  renderOutput(text, pathway);
}

function renderOutput(text, pathway) {
  const body = container?.querySelector('#rcpCaptureBody');
  if (!body) return;
  body.innerHTML = `
    <div class="rcp-output">
      <div class="rcp-output-head">
        <span class="rcp-form-title">${esc(pathway.title)} — summary</span>
      </div>
      <textarea class="rcp-output-text" id="rcpOutputText" readonly rows="16"></textarea>
      <div class="rcp-form-actions">
        <button class="rcp-btn rcp-btn-primary" id="rcpCopy">Copy to clipboard</button>
        <button class="rcp-btn" id="rcpNewCapture">New capture</button>
        <span class="rcp-form-msg" id="rcpCopyMsg"></span>
      </div>
      <div class="rcp-fineprint">Paste into the Medicus triage entry / task for this patient. Double-check you're on the right patient before pasting.</div>
    </div>`;
  const ta = body.querySelector('#rcpOutputText');
  ta.value = text;
  body.querySelector('#rcpCopy')?.addEventListener('click', async () => {
    const m = body.querySelector('#rcpCopyMsg');
    try {
      await navigator.clipboard.writeText(ta.value);
      if (m) {
        m.textContent = 'Copied.';
        m.className = 'rcp-form-msg rcp-form-msg-ok';
      }
    } catch (_) {
      ta.focus();
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      if (m) {
        m.textContent = ok ? 'Copied.' : 'Copy failed — select the text and copy manually.';
        m.className = ok ? 'rcp-form-msg rcp-form-msg-ok' : 'rcp-form-msg';
      }
    }
  });
  body.querySelector('#rcpNewCapture')?.addEventListener('click', renderPathwayPicker);
}
