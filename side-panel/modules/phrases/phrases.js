// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Phrases module (personal quick-responses / snippet library)
//
// Reusable text BLOCKS (opener → substance → safety-net → next-step →
// sign-off, or standalone "whole" messages) that compose into ONE message the
// clinician COPIES and pastes into Medicus's own message/comment/note boxes.
//
// v1 is COPY-ONLY BY DESIGN: this module sends nothing, inserts nothing into
// Medicus and writes nothing to the patient record — the only output is the
// clipboard, via the user's explicit Copy click. Every UI string keeps to the
// H-049 no-completion-claim doctrine (never assert an action happened
// downstream); test-phrases-core.js source-greps this file for banned
// completion claims and for the ***-unfilled copy gate. See hazard H-052.
//
// *** placeholders are MANUAL-FILL ONLY — never auto-filled with patient data
// (hard rule, shared/phrases-core.js header). The Copy button refuses a
// casual copy while *** remains: it demands an explicit confirmation that
// states the consequence ("the patient will see *** ...").
//
// Storage: phrases.items (personal blocks), phrases.config (usage counts,
// merged practice pack, tombstones, pack version). Pure logic lives in
// shared/phrases-core.js (window.PhrasesCore); the shipped pack in
// shared/phrases-presets.js (window.PhrasesPresets) — both classic scripts
// loaded by panel.html / pop-out.html.

'use strict';

import { copyText } from '../shared/export-util.js';
import { loadUiState, saveUiState } from '../shared/ui-state.js';

const ITEMS_KEY = 'phrases.items';
const CONFIG_KEY = 'phrases.config';

const PC = typeof window !== 'undefined' ? window.PhrasesCore : null;
const PACK = typeof window !== 'undefined' && window.PhrasesPresets ? window.PhrasesPresets.SHIPPED_PACK : null;

let container = null;
let _storageListener = null;
let _ignoreNextChange = false;
let _uiStateTimer = null;

let _personal = []; // phrases.items — personal, freely editable
let _config = null; // phrases.config — sanitised, pack-merged

let _query = '';
let _activeCat = 'all';
let _selected = []; // block ids in the compose pane, in click order
let _editingId = null; // null | 'new' | personal block id
let _confirmCopy = false; // the ***-guard confirmation step is showing
let _copyStatus = ''; // persistent post-copy line ('' = none)

const SLOT_LABEL = {
  opener: 'opener',
  substance: 'substance',
  safetynet: 'safety-net',
  nextstep: 'next step',
  signoff: 'sign-off',
  whole: 'whole message',
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape, then mark the *** manual-fill placeholders so they are visually
// loud in previews and cards ("type over me" is the whole contract).
function escWithPlaceholders(s) {
  return esc(s).replace(/\*\*\*/g, '<mark class="ph-fill">***</mark>');
}

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _query = '';
  _activeCat = 'all';
  _selected = [];
  _editingId = null;
  _confirmCopy = false;
  _copyStatus = '';

  const savedUi = await loadUiState('phrases');
  if (savedUi) {
    if (typeof savedUi._activeCat === 'string') _activeCat = savedUi._activeCat;
    if (typeof savedUi._query === 'string') _query = savedUi._query;
  }

  container.innerHTML = `
    <div class="ph-module">
      <div class="ph-head">
        <h2 class="ph-title">Phrases</h2>
        <span class="ph-subtitle">Reusable message blocks — compose, copy, then paste into Medicus yourself. This tab copies text only; it sends nothing and writes nothing to the record.</span>
      </div>
      <div id="phBody"></div>
    </div>`;

  await loadState();
  render();

  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);

  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (!changes[ITEMS_KEY] && !changes[CONFIG_KEY]) return;
    if (_ignoreNextChange) {
      _ignoreNextChange = false;
      return;
    }
    loadState().then(() => {
      if (container) render();
    });
  };
  chrome.storage.onChanged.addListener(_storageListener);

  return cleanup;
}

function cleanup() {
  if (_storageListener) {
    chrome.storage.onChanged.removeListener(_storageListener);
    _storageListener = null;
  }
  if (_uiStateTimer) {
    clearTimeout(_uiStateTimer);
    _uiStateTimer = null;
  }
  if (container) {
    container.removeEventListener('click', onClick);
    container.removeEventListener('input', onInput);
  }
  container = null;
}

export { cleanup };

async function loadState() {
  const r = await chrome.storage.local.get([ITEMS_KEY, CONFIG_KEY]);
  _personal = PC ? PC.sanitiseBlockList(r[ITEMS_KEY]) : [];
  // Version-gated shipped-pack merge on EVERY load (the only phrases.config
  // load path — keep it that way, or mirror this call; see phrases-core).
  const { cfg, changed } = PC.mergeShippedPack(r[CONFIG_KEY], PACK);
  _config = cfg;
  if (changed) await persistConfig();
}

async function persistConfig() {
  _ignoreNextChange = true;
  await chrome.storage.local.set({ [CONFIG_KEY]: _config });
}

async function persistPersonal() {
  _ignoreNextChange = true;
  await chrome.storage.local.set({ [ITEMS_KEY]: _personal });
}

function saveUi() {
  if (_uiStateTimer) clearTimeout(_uiStateTimer);
  _uiStateTimer = setTimeout(() => {
    saveUiState('phrases', { _activeCat, _query });
  }, 400);
}

// Practice tier first (shipped + promoted), then personal. Ids are unique
// across both tiers (enforced at save/promote/import time).
function allBlocks() {
  return [..._config.practiceBlocks, ..._personal];
}

function isPractice(id) {
  return _config.practiceBlocks.some((b) => b.id === id);
}

function findBlock(id) {
  return allBlocks().find((b) => b.id === id) || null;
}

function categories() {
  return PACK && Array.isArray(PACK.categories) ? PACK.categories : [];
}

function catLabel(id) {
  const c = categories().find((c) => c.id === id);
  return c ? c.label : id || 'other';
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  const body = container?.querySelector('#phBody');
  if (!body) return;
  const parts = [];
  parts.push(renderCompose());
  parts.push(renderToolbar());
  if (_editingId !== null) parts.push(renderForm());
  parts.push(renderList());
  body.innerHTML = parts.join('');
}

function renderCompose() {
  if (_selected.length === 0) {
    return `<div class="ph-compose ph-compose-empty">
      Tap blocks below to build a message here. Type <span class="ph-kbd">/trigger</span> in search for a fast match.
    </div>`;
  }

  const blocks = _selected.map(findBlock).filter(Boolean);
  const text = PC.composeMessage(_selected, allBlocks());
  const { chars, smsSegments } = PC.charCount(text);
  const audiences = [...new Set(blocks.map((b) => b.audience))];
  const mixed = audiences.length > 1;
  const hasGaps = PC.hasUnfilledPlaceholders(text);

  const chipRows = blocks
    .map(
      (b) => `<span class="ph-sel-chip" title="${esc(b.title)}">
        <span class="ph-aud ph-aud-${esc(b.audience)}">${esc(PC.AUDIENCE_LABEL[b.audience] || b.audience)}</span>
        ${esc(b.title)}
        <button class="ph-sel-x" data-act="unselect" data-id="${esc(b.id)}" title="Remove from message" aria-label="Remove ${esc(b.title)}">&times;</button>
      </span>`
    )
    .join('');

  const audLine = mixed
    ? `<div class="ph-compose-warn">Mixed audiences (${audiences.map((a) => esc(PC.AUDIENCE_LABEL[a] || a)).join(' + ')}) — check every part belongs in the same Medicus box before you paste.</div>`
    : `<div class="ph-compose-aud">For: <span class="ph-aud ph-aud-${esc(audiences[0])}">${esc(PC.AUDIENCE_LABEL[audiences[0]] || audiences[0])}</span></div>`;

  const gapNote = hasGaps
    ? `<div class="ph-compose-gaps">Contains <mark class="ph-fill">***</mark> — type the missing details over each one after pasting. They are never filled in for you.</div>`
    : '';

  const confirmBlock = _confirmCopy
    ? `<div class="ph-copy-confirm">
        <div class="ph-copy-confirm-text">This message still contains <mark class="ph-fill">***</mark>. If you paste it and press send in Medicus as-is, the patient will see <strong>***</strong> where their details should be.</div>
        <div class="ph-copy-confirm-actions">
          <button class="ph-btn ph-btn-warn" data-act="copy-confirm">Copy anyway — I will fill in *** after pasting</button>
          <button class="ph-btn" data-act="copy-cancel">Back</button>
        </div>
      </div>`
    : '';

  const statusLine = _copyStatus ? `<div class="ph-copy-status">${esc(_copyStatus)}</div>` : '';

  const smsHint = audiences.includes('patient') && chars > 0 ? ` · ~${smsSegments} SMS` : '';

  return `<div class="ph-compose">
    <div class="ph-compose-chips">${chipRows}</div>
    ${audLine}
    <div class="ph-compose-preview">${escWithPlaceholders(text)}</div>
    ${gapNote}
    ${confirmBlock}
    <div class="ph-compose-foot">
      <span class="ph-charcount">${chars} chars${smsHint}</span>
      <span class="ph-compose-btns">
        <button class="ph-btn" data-act="clear">Clear</button>
        <button class="ph-btn ph-btn-primary" data-act="copy">Copy message</button>
      </span>
    </div>
    ${statusLine}
  </div>`;
}

function renderToolbar() {
  const pills = [
    `<button class="ph-pill ${_activeCat === 'all' ? 'ph-pill-on' : ''}" data-act="cat" data-cat="all">All</button>`,
    ...categories().map(
      (c) =>
        `<button class="ph-pill ${_activeCat === c.id ? 'ph-pill-on' : ''}" data-act="cat" data-cat="${esc(c.id)}">${esc(c.label)}</button>`
    ),
  ].join('');
  return `
    <div class="ph-toolbar">
      <input type="search" id="phSearch" class="ph-search" placeholder="Search, or /trigger…" value="${esc(_query)}" />
      <button class="ph-btn ph-btn-primary" data-act="add">+ Add</button>
    </div>
    <div class="ph-pills">${pills}</div>
    ${renderLlmBlock()}`;
}

// LLM-assisted authoring lives here on the tab (simpler than an Options
// section for a personal library): copy the prompt, paste JSON back, strict
// per-block validation with visible errors. Mirrors the Knowledge module's
// starter-pack import discipline.
function renderLlmBlock() {
  return `
    <details class="ph-llm-block">
      <summary>Write blocks with an LLM…</summary>
      <div class="ph-llm-inner">
        <p class="ph-llm-help">Copy the prompt into any LLM (ChatGPT, Claude, etc.), describe the blocks you want, then paste the JSON reply below. Every block is validated before it is saved; patient-facing blocks are written at NHS reading age 9&ndash;11 by the prompt's rules. Review each one before you rely on it.</p>
        <button class="ph-btn ph-btn-sm" data-act="copy-llm-prompt">Copy prompt</button>
        <textarea id="phLlmJson" class="ph-input" rows="4" placeholder="Paste the JSON reply from the LLM here…"></textarea>
        <div class="ph-llm-row">
          <button class="ph-btn ph-btn-sm" data-act="import-llm">Validate &amp; import</button>
          <span id="phLlmStatus" class="ph-llm-status"></span>
        </div>
        <div id="phLlmErrors" class="ph-llm-errors"></div>
      </div>
    </details>`;
}

function visibleBlocks() {
  const filtered = allBlocks().filter((b) => _activeCat === 'all' || b.category === _activeCat);
  return PC.searchBlocks(_query, filtered, _config.usage);
}

function renderList() {
  const blocks = visibleBlocks();
  if (allBlocks().length === 0 && _editingId === null) {
    return `<div class="ph-empty">No blocks yet. Use <strong>+ Add</strong> to write one, or the LLM helper above.</div>`;
  }
  if (blocks.length === 0) return `<div class="ph-empty">No blocks match.</div>`;
  return `<div class="ph-list">${blocks.map(renderCard).join('')}</div>`;
}

function renderCard(b) {
  const practice = isPractice(b.id);
  const uses = _config.usage[b.id] || 0;
  const selected = _selected.includes(b.id);
  const firstLine = (b.body || '').split('\n')[0];
  const leaflet = b.leafletUrl
    ? `<a class="ph-leaflet" href="${esc(b.leafletUrl)}" target="_blank" rel="noopener noreferrer" data-act="leaflet" title="Open the linked patient leaflet">leaflet ↗</a>`
    : '';
  const actions = practice
    ? `<button class="ph-btn ph-btn-sm ph-btn-danger" data-act="hide-practice" data-id="${esc(b.id)}" title="Remove this practice block (it will not come back on pack updates)">Remove</button>`
    : `<button class="ph-btn ph-btn-sm" data-act="edit" data-id="${esc(b.id)}">Edit</button>
       <button class="ph-btn ph-btn-sm" data-act="promote" data-id="${esc(b.id)}" title="Move to the practice tier (shared via Options backup)">Promote</button>
       <button class="ph-btn ph-btn-sm ph-btn-danger" data-act="delete" data-id="${esc(b.id)}">Delete</button>`;

  return `
    <div class="ph-card ${selected ? 'ph-card-selected' : ''}" data-act="pick" data-id="${esc(b.id)}">
      <div class="ph-card-top">
        <span class="ph-card-title">${esc(b.title)}</span>
        <span class="ph-aud ph-aud-${esc(b.audience)}">${esc(PC.AUDIENCE_LABEL[b.audience] || b.audience)}</span>
      </div>
      <div class="ph-card-meta">
        ${practice ? '<span class="ph-badge ph-badge-practice">practice</span>' : ''}
        <span class="ph-slot">${esc(SLOT_LABEL[b.slot] || b.slot)}</span>
        <span class="ph-cat-chip">${esc(catLabel(b.category))}</span>
        ${b.trigger ? `<span class="ph-trigger">/${esc(b.trigger)}</span>` : ''}
        ${uses > 0 ? `<span class="ph-uses" title="Times you have copied this block">×${uses}</span>` : ''}
        ${leaflet}
      </div>
      <div class="ph-card-preview">${escWithPlaceholders(firstLine)}</div>
      <div class="ph-card-actions">${actions}</div>
    </div>`;
}

function renderForm() {
  const editing = _editingId !== 'new' ? _personal.find((b) => b.id === _editingId) : null;
  const b = editing || {
    title: '',
    body: '',
    trigger: '',
    keywords: '',
    category: _activeCat !== 'all' ? _activeCat : categories()[0]?.id || 'admin',
    audience: 'patient',
    leafletUrl: '',
    slot: 'whole',
  };
  const catOpts = categories()
    .map((c) => `<option value="${esc(c.id)}" ${c.id === b.category ? 'selected' : ''}>${esc(c.label)}</option>`)
    .join('');
  const audOpts = PC.AUDIENCES.map(
    (a) => `<option value="${esc(a)}" ${a === b.audience ? 'selected' : ''}>${esc(PC.AUDIENCE_LABEL[a])}</option>`
  ).join('');
  const slotOpts = PC.SLOTS.map(
    (s) => `<option value="${esc(s)}" ${s === b.slot ? 'selected' : ''}>${esc(SLOT_LABEL[s])}</option>`
  ).join('');
  return `
    <div class="ph-form">
      <div class="ph-form-title">${editing ? 'Edit block' : 'New block'}</div>
      <label class="ph-label">Title</label>
      <input type="text" id="phFmTitle" class="ph-input" maxlength="120" value="${esc(b.title)}" placeholder="e.g. Normal results — no action needed" />
      <div class="ph-form-row">
        <div>
          <label class="ph-label">Audience — which Medicus box this belongs in</label>
          <select id="phFmAudience" class="ph-input">${audOpts}</select>
        </div>
        <div>
          <label class="ph-label">Slot — where it sits when composed</label>
          <select id="phFmSlot" class="ph-input">${slotOpts}</select>
        </div>
      </div>
      <div class="ph-form-row">
        <div>
          <label class="ph-label">Category</label>
          <select id="phFmCat" class="ph-input">${catOpts}</select>
        </div>
        <div>
          <label class="ph-label">Trigger (for /trigger search, optional)</label>
          <input type="text" id="phFmTrigger" class="ph-input" maxlength="24" value="${esc(b.trigger)}" placeholder="e.g. normal" />
        </div>
      </div>
      <label class="ph-label">Text — type *** where you will fill in a detail each time (it is never filled in for you)</label>
      <textarea id="phFmBody" class="ph-input" rows="5" maxlength="2000" placeholder="Plain text. Use *** for the parts you type fresh every time.">${esc(b.body)}</textarea>
      <div class="ph-form-row">
        <div>
          <label class="ph-label">Keywords (space-separated, optional)</label>
          <input type="text" id="phFmKeywords" class="ph-input" maxlength="240" value="${esc(b.keywords)}" placeholder="bloods results ok" />
        </div>
        <div>
          <label class="ph-label">Leaflet link (https, optional)</label>
          <input type="text" id="phFmLeaflet" class="ph-input" maxlength="300" value="${esc(b.leafletUrl)}" placeholder="https://www.nhs.uk/…" />
        </div>
      </div>
      <div id="phFmError" class="ph-form-error"></div>
      <div class="ph-form-actions">
        <button class="ph-btn ph-btn-primary" data-act="save">Save</button>
        <button class="ph-btn" data-act="cancel">Cancel</button>
      </div>
    </div>`;
}

// ── Events ────────────────────────────────────────────────────────────────────

function onInput(ev) {
  const t = ev.target;
  if (t.id === 'phSearch') {
    _query = t.value;
    _copyStatus = '';
    const body = container.querySelector('#phBody');
    const listHost = body.querySelector('.ph-list, .ph-empty');
    if (listHost) listHost.outerHTML = renderList();
    saveUi();
  }
}

function onClick(ev) {
  const actEl = ev.target.closest('[data-act]');
  if (!actEl || !container.contains(actEl)) return;
  const act = actEl.dataset.act;

  if (act === 'leaflet') return; // let the anchor navigate; don't treat as a pick

  // Card body click = add to the compose pane. Inner buttons are their own
  // nearest [data-act], so they never reach this branch.
  if (act === 'pick') {
    const id = actEl.dataset.id;
    if (!_selected.includes(id)) {
      _selected.push(id);
      _confirmCopy = false;
      _copyStatus = '';
      render();
    }
    return;
  }
  ev.stopPropagation();

  switch (act) {
    case 'unselect':
      _selected = _selected.filter((x) => x !== actEl.dataset.id);
      _confirmCopy = false;
      _copyStatus = '';
      render();
      break;
    case 'clear':
      _selected = [];
      _confirmCopy = false;
      _copyStatus = '';
      render();
      break;
    case 'copy':
      doCopy(false);
      break;
    case 'copy-confirm':
      doCopy(true);
      break;
    case 'copy-cancel':
      _confirmCopy = false;
      render();
      break;
    case 'cat':
      _activeCat = actEl.dataset.cat;
      saveUi();
      render();
      break;
    case 'add':
      _editingId = 'new';
      render();
      container.querySelector('#phFmTitle')?.focus();
      break;
    case 'edit':
      _editingId = actEl.dataset.id;
      render();
      break;
    case 'cancel':
      _editingId = null;
      render();
      break;
    case 'save':
      saveForm();
      break;
    case 'delete':
      deletePersonal(actEl.dataset.id);
      break;
    case 'promote':
      promoteToPractice(actEl.dataset.id);
      break;
    case 'hide-practice':
      hidePracticeBlock(actEl.dataset.id);
      break;
    case 'copy-llm-prompt':
      copyBtnText(PC.phrasesAuthoringPrompt(), actEl);
      break;
    case 'import-llm':
      importLlmJson();
      break;
  }
}

// ── Copy (the only output path — clipboard, explicitly clicked) ──────────────

async function doCopy(confirmed) {
  const text = PC.composeMessage(_selected, allBlocks());
  if (!text) return;

  // The ***-unfilled gate (H-052 control): a message still carrying manual-
  // fill markers needs an explicit second click that states the consequence.
  if (PC.hasUnfilledPlaceholders(text) && !confirmed) {
    _confirmCopy = true;
    render();
    return;
  }
  _confirmCopy = false;

  const ok = await copyText(text);
  if (!ok) {
    _copyStatus = 'Copy failed — select the preview text and copy it manually.';
    render();
    return;
  }

  // Record usage for the ordering ("most used by me").
  for (const id of _selected) _config.usage = PC.bumpUsage(_config.usage, id);
  await persistConfig();

  // Deliberately NOT a claim of completion: the clipboard write happened, the
  // paste-and-send in Medicus has not. The line persists (no timer) until the
  // next composition change — H-049 discipline.
  _copyStatus =
    'Copied to clipboard. Now paste it into the right Medicus box yourself — nothing goes anywhere until you do.';
  render();
}

// ── Personal block CRUD ───────────────────────────────────────────────────────

async function saveForm() {
  const errEl = container.querySelector('#phFmError');
  const get = (id) => container.querySelector('#' + id)?.value ?? '';

  const raw = {
    id: _editingId !== 'new' ? _editingId : undefined,
    title: get('phFmTitle'),
    body: get('phFmBody'),
    trigger: get('phFmTrigger'),
    keywords: get('phFmKeywords'),
    category: get('phFmCat'),
    audience: get('phFmAudience'),
    leafletUrl: get('phFmLeaflet').trim(),
    slot: get('phFmSlot'),
  };

  const errs = PC.validateBlock(raw);
  if (errs.length > 0) {
    errEl.textContent = errs[0];
    return;
  }
  const clean = PC.sanitiseBlock(raw);

  if (_editingId === 'new') {
    const taken = new Set(allBlocks().map((b) => b.id));
    clean.id = PC.generateBlockId(clean.title, taken);
    _personal.push(clean);
  } else {
    const idx = _personal.findIndex((b) => b.id === _editingId);
    if (idx === -1) {
      errEl.textContent = 'Block no longer exists.';
      return;
    }
    clean.id = _editingId;
    _personal[idx] = clean;
  }

  await persistPersonal();
  _editingId = null;
  render();
}

async function deletePersonal(id) {
  const b = _personal.find((x) => x.id === id);
  if (!b) return;
  if (!confirm(`Delete "${b.title}"?`)) return;
  _personal = _personal.filter((x) => x.id !== id);
  _selected = _selected.filter((x) => x !== id);
  await persistPersonal();
  render();
}

// Personal → practice tier: the block travels in the practice backup scope
// and stops being editable here (practice wording is edited deliberately, not
// casually — same posture as the shipped pack).
async function promoteToPractice(id) {
  const idx = _personal.findIndex((x) => x.id === id);
  if (idx === -1) return;
  const b = _personal[idx];
  if (
    !confirm(`Promote "${b.title}" to the practice tier? It becomes read-only here and is shared via the suite backup.`)
  )
    return;
  if (_config.practiceBlocks.length >= PC.PH_LIMITS.blocks) return;
  _personal.splice(idx, 1);
  _config.practiceBlocks.push(b);
  await persistPersonal();
  await persistConfig();
  render();
}

// Practice block removal = tombstone, so a future pack version bump cannot
// resurrect it (mergeShippedPack skips removedShipped ids).
async function hidePracticeBlock(id) {
  const b = _config.practiceBlocks.find((x) => x.id === id);
  if (!b) return;
  if (!confirm(`Remove practice block "${b.title}"? It will not come back on pack updates.`)) return;
  _config.practiceBlocks = _config.practiceBlocks.filter((x) => x.id !== id);
  if (!_config.removedShipped.includes(id)) _config.removedShipped.push(id);
  _selected = _selected.filter((x) => x !== id);
  await persistConfig();
  render();
}

// ── LLM paste-import (strict, visible errors) ────────────────────────────────

async function importLlmJson() {
  const statusEl = container.querySelector('#phLlmStatus');
  const errorsEl = container.querySelector('#phLlmErrors');
  const jsonEl = container.querySelector('#phLlmJson');
  if (!statusEl || !jsonEl) return;
  errorsEl.innerHTML = '';
  const fail = (msg) => {
    statusEl.className = 'ph-llm-status ph-llm-status-err';
    statusEl.textContent = msg;
  };

  const raw = (jsonEl.value || '').trim();
  if (!raw) return fail('Paste the LLM JSON reply first.');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return fail('Could not parse JSON: ' + e.message);
  }

  const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.blocks) ? parsed.blocks : null;
  if (!list || list.length === 0) return fail('No blocks found — expected { "blocks": [ … ] }.');

  const taken = new Set(allBlocks().map((b) => b.id));
  const accepted = [];
  const rejected = [];
  for (const entry of list) {
    const errs = PC.validateBlock(entry);
    if (errs.length > 0) {
      rejected.push({ title: (entry && entry.title) || '(untitled)', err: errs[0] });
      continue;
    }
    const clean = PC.sanitiseBlock(entry);
    if (!clean.id || taken.has(clean.id)) clean.id = PC.generateBlockId(clean.title, taken);
    taken.add(clean.id);
    accepted.push(clean);
  }

  if (accepted.length > 0) {
    _personal.push(...accepted);
    await persistPersonal();
    // render() rebuilds the toolbar (and this details block) — re-open it and
    // re-resolve the status/error hosts afterwards so the outcome stays visible.
    render();
  }

  const details = container.querySelector('.ph-llm-block');
  if (details) details.open = true;
  const freshStatus = container.querySelector('#phLlmStatus');
  const freshErrors = container.querySelector('#phLlmErrors');
  if (freshErrors && rejected.length > 0) {
    freshErrors.innerHTML = rejected
      .map((r) => `<div class="ph-llm-error-row">Rejected "${esc(r.title)}" — ${esc(r.err)}</div>`)
      .join('');
  }
  if (freshStatus) {
    freshStatus.className = accepted.length > 0 ? 'ph-llm-status ph-llm-status-ok' : 'ph-llm-status ph-llm-status-err';
    freshStatus.textContent =
      `${accepted.length} block(s) imported as personal blocks` +
      (rejected.length > 0 ? `; ${rejected.length} rejected (see below).` : '. Review each before using it.');
  }
}

async function copyBtnText(text, btn) {
  const ok = await copyText(text);
  const old = btn.textContent;
  btn.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => {
    if (btn.isConnected) btn.textContent = old;
  }, 1200);
}
