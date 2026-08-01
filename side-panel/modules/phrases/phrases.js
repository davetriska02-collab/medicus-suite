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
// v3.206.0 design-crit rework: two modes.
//   COMPOSE (default) — a search row, six labelled SLOT CHIP ROWS (the
//     reception-composer .ms-qa-row/.ms-qa-rowlabel/.ms-qa-chips idiom,
//     content-scripts/reception-quick-actions.js) in PC.COMPOSE_ORDER, and a
//     sticky compose tray with an EDITABLE preview (decision L — a clinician
//     can fill *** in-panel before Copy). This is the whole compose surface;
//     no + Add, no LLM import, no category-pill wall, no card list.
//   LIBRARY — today's fuller surface, essentially unchanged: search,
//     category pills, + Add, the LLM import <details>, and the full card
//     list with Edit/Promote/Delete/Remove. Every capability from the old
//     single-surface module is still one tap away — nothing is deleted, only
//     re-homed.
// Both modes share the same _selected/_config/_personal state — picking a
// block from a Library card is the same action as picking a slot chip.
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

let _mode = 'compose'; // 'compose' | 'library' — persisted (decision A)
let _query = ''; // shared between modes — persisted
let _activeCat = 'all'; // Library category filter — persisted
let _substanceCat = 'all'; // scoped filter for the expanded substance row — transient (NOT persisted)
let _expandedRows = {}; // { [slot]: true } fold state per row — persisted
let _selected = []; // block ids in the compose pane, in click order
let _editingId = null; // null | 'new' | personal block id
let _confirmCopy = false; // the ***-guard confirmation step is showing
let _copyStatus = ''; // persistent post-copy line ('' = none)
let _draft = null; // manual edits to the compose preview — TRANSIENT, never persisted (decision L)
let _previewExpanded = false; // preview "Show all" toggle — transient

const SLOT_LABEL = {
  opener: 'opener',
  substance: 'substance',
  safetynet: 'safety-net',
  nextstep: 'next step',
  signoff: 'sign-off',
  whole: 'whole message',
};

// Row labels for the compose slot-chip rows, in PC.COMPOSE_ORDER exactly
// (decision C) — derived from the core's order so the two can never drift.
const ROW_LABEL = {
  opener: 'Opener',
  whole: 'Complete message',
  substance: 'Message',
  safetynet: 'Safety-net',
  nextstep: 'Next step',
  signoff: 'Sign-off',
};

// Rows where more than one chip may be selected at once (decision C); every
// other row is single-select — picking a chip there deselects any other
// selected chip in that same row (one opener, one sign-off, etc.).
const MULTI_SLOTS = new Set(['substance', 'whole', 'safetynet']);

const FOLD_N = 6; // chips shown per row before the "+N more" fold (decision C)

const ICON_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape, then mark the *** manual-fill placeholders so they are visually
// loud in previews and cards ("type over me" is the whole contract). Used for
// read-only surfaces (Library card preview) — the compose tray's own preview
// is an editable <textarea> and can't carry markup (decision L).
function escWithPlaceholders(s) {
  return esc(s).replace(/\*\*\*/g, '<mark class="ph-fill">***</mark>');
}

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _mode = 'compose';
  _query = '';
  _activeCat = 'all';
  _substanceCat = 'all';
  _expandedRows = {};
  _selected = [];
  _editingId = null;
  _confirmCopy = false;
  _copyStatus = '';
  _draft = null;
  _previewExpanded = false;

  const savedUi = await loadUiState('phrases');
  if (savedUi) {
    if (savedUi._mode === 'compose' || savedUi._mode === 'library') _mode = savedUi._mode;
    if (typeof savedUi._activeCat === 'string') _activeCat = savedUi._activeCat;
    if (typeof savedUi._query === 'string') _query = savedUi._query;
    if (savedUi._expandedRows && typeof savedUi._expandedRows === 'object')
      _expandedRows = { ...savedUi._expandedRows };
  }

  container.innerHTML = `
    <div class="ph-module">
      <div class="ph-head">
        <h2 class="ph-title">Phrases</h2>
        <span class="ph-subtitle">Copies text only — nothing is sent or written to the record.</span>
      </div>
      <div id="phBody"></div>
    </div>`;

  await loadState();
  render();

  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);
  container.addEventListener('keydown', onKeydown);

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
    container.removeEventListener('keydown', onKeydown);
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
    saveUiState('phrases', { _mode, _activeCat, _query, _expandedRows });
  }, 400);
}

// Practice tier first (shipped + promoted), then personal. Save/promote/import
// enforce cross-tier id uniqueness, but a future pack bump or a restored backup
// can still collide an id across tiers — so this assembly DE-DUPLICATES (first
// occurrence wins, i.e. practice) and every consumer (findBlock, composeMessage,
// search) reads the same de-duplicated list. Without this, findBlock showed one
// tier's audience tag while composeMessage copied the other tier's body (Opus
// review finding 2).
function allBlocks() {
  const seen = new Set();
  return [..._config.practiceBlocks, ..._personal].filter((b) => !seen.has(b.id) && seen.add(b.id));
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

// Audience badge — differential (decision F / H-052 control b): the expected
// default ('patient') renders NOTHING on chips/cards; 'note'/'task' keep the
// full word+colour badge (colourblind-safe). The compose tray's OWN For:/
// mixed-audience control (renderTray) is intentionally NOT built from this —
// it stays unconditional and full-strength, exactly as before.
function renderAudBadge(audience) {
  if (audience === 'patient') return '';
  return `<span class="ph-aud ph-aud-${esc(audience)}">${esc(PC.AUDIENCE_LABEL[audience] || audience)}</span>`;
}

// ── Selection (shared by slot chips AND Library cards — one selectBlock) ──────
//
// Multi-select rows (substance / whole / safetynet) toggle independently;
// every other row is single-select — picking a new chip there drops any
// other selection in that row (decision C). Any selection change discards a
// manual preview edit and resets the "Show all" toggle (decision L).

function selectBlock(id) {
  const b = findBlock(id);
  if (!b) return;
  if (_selected.includes(id)) {
    _selected = _selected.filter((x) => x !== id);
  } else {
    if (!MULTI_SLOTS.has(b.slot)) {
      _selected = _selected.filter((x) => {
        const other = findBlock(x);
        return !other || other.slot !== b.slot;
      });
    }
    _selected.push(id);
  }
  _confirmCopy = false;
  _copyStatus = '';
  _draft = null;
  _previewExpanded = false;
}

// Selected blocks' position in the COMPOSED message (opener→whole→substance→
// safetynet→nextstep→signoff, selection order breaks ties) — the non-colour
// index cue on a selected chip (decision C). Mirrors composeMessage's own
// ordering locally; the pure compose logic itself stays in phrases-core.
function selectedOrderMap() {
  const blocks = _selected.map(findBlock).filter(Boolean);
  const slotRank = (b) => {
    const i = PC.COMPOSE_ORDER.indexOf(b.slot);
    return i === -1 ? PC.COMPOSE_ORDER.length : i;
  };
  const ordered = blocks
    .map((b, i) => ({ b, i }))
    .sort((x, y) => slotRank(x.b) - slotRank(y.b) || x.i - y.i)
    .map((x) => x.b);
  const map = new Map();
  ordered.forEach((b, idx) => map.set(b.id, idx + 1));
  return map;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  const body = container?.querySelector('#phBody');
  if (!body) return;
  const content = _mode === 'compose' ? renderComposeMode() : renderLibrary();
  body.innerHTML = renderModeToggle() + content;
  syncPreviewAutoGrow();
}

function renderModeToggle() {
  return `<div class="ph-mode-toggle" role="group" aria-label="Phrases view">
    <button type="button" class="ph-mode-btn" data-act="mode" data-mode="compose" aria-pressed="${_mode === 'compose' ? 'true' : 'false'}">Compose</button>
    <button type="button" class="ph-mode-btn" data-act="mode" data-mode="library" aria-pressed="${_mode === 'library' ? 'true' : 'false'}">Library</button>
  </div>`;
}

// ── Compose mode ──────────────────────────────────────────────────────────────

function renderComposeMode() {
  return `<div class="ph-mode-compose">
    <div class="ph-compose-searchrow">
      <input type="search" id="phSearch" class="ph-search" placeholder="Search, or /trigger…" value="${esc(_query)}" aria-label="Search phrases" />
    </div>
    ${renderTray()}
    ${renderRows()}
  </div>`;
}

function renderTray() {
  if (_selected.length === 0) {
    return `<div class="ph-compose ph-compose-empty">Tap a phrase from each row to build a message.</div>`;
  }

  const blocks = _selected.map(findBlock).filter(Boolean);
  const composedText = PC.composeMessage(_selected, allBlocks());
  const text = _draft != null ? _draft : composedText;
  const { chars, smsSegments } = PC.charCount(text);
  const audiences = [...new Set(blocks.map((b) => b.audience))];
  const mixed = audiences.length > 1;
  const hasGaps = PC.hasUnfilledPlaceholders(text);

  const chipRows = blocks
    .map(
      (b) => `<span class="ph-sel-chip" title="${esc(b.title)}">
        ${renderAudBadge(b.audience)}
        ${esc(b.title)}
        <button type="button" class="ph-sel-x" data-act="unselect" data-id="${esc(b.id)}" title="Remove from message" aria-label="Remove ${esc(b.title)}">&times;</button>
      </span>`
    )
    .join('');

  // The tray's own audience control stays FULL STRENGTH — unconditional,
  // every audience shown, exactly as before this crit (decision F).
  const audLine = mixed
    ? `<div class="ph-compose-warn">Mixed audiences (${audiences.map((a) => esc(PC.AUDIENCE_LABEL[a] || a)).join(' + ')}) — check every part belongs in the same Medicus box before you paste.</div>`
    : `<div class="ph-compose-aud">For: <span class="ph-aud ph-aud-${esc(audiences[0])}">${esc(PC.AUDIENCE_LABEL[audiences[0]] || audiences[0])}</span></div>`;

  const gapNote = `<div class="ph-compose-gaps" id="phGapsNote"${hasGaps ? '' : ' hidden'}>Contains <mark class="ph-fill">***</mark> — type the details over each one here, or after pasting. They are never filled in for you.</div>`;

  // The consequence must be TRUE for the composed audience: "the patient will
  // see" is only right for patient-facing text; a false consequence on a note/
  // task composition teaches users the gate doesn't apply to them (the click-
  // through-blind failure H-052 flags).
  const gapReader = audiences.includes('patient') ? 'the patient' : 'whoever reads this';
  const confirmBlock = _confirmCopy
    ? `<div class="ph-copy-confirm" role="alertdialog" aria-live="assertive">
        <div class="ph-copy-confirm-text">This message still contains <mark class="ph-fill">***</mark>. If you paste it and press send in Medicus as-is, ${esc(gapReader)} will see <strong>***</strong> where the details should be.</div>
        <div class="ph-copy-confirm-actions">
          <button type="button" class="ph-btn ph-btn-warn" data-act="copy-confirm">Copy anyway — I will fill in *** after pasting</button>
          <button type="button" class="ph-btn ph-btn-primary" id="phCopyBack" data-act="copy-cancel">Back</button>
        </div>
      </div>`
    : '';

  const statusLine = _copyStatus
    ? `<div class="ph-copy-status" role="status" aria-live="polite"><span class="ph-ok-glyph" aria-hidden="true">&#10003;</span>${esc(_copyStatus)}</div>`
    : '';

  const smsHint = audiences.includes('patient') && chars > 0 ? ` · ~${smsSegments} SMS` : '';
  const lineCount = text.split('\n').length;
  const showToggle = text.length > 260 || lineCount > 5;

  return `<div class="ph-compose ph-compose-populated">
    <div class="ph-compose-chips">${chipRows}</div>
    ${audLine}
    <textarea class="ph-compose-preview${_previewExpanded ? ' ph-preview-expanded' : ''}" id="phComposePreview" aria-label="Composed message — edit here to fill in *** before copying">${esc(text)}</textarea>
    ${showToggle ? `<button type="button" class="ph-btn ph-btn-ghost ph-btn-sm ph-preview-toggle" data-act="toggle-preview">${_previewExpanded ? 'Show less' : 'Show all'}</button>` : ''}
    ${gapNote}
    ${confirmBlock}
    <div class="ph-compose-foot">
      <span class="ph-charcount">${chars} chars${smsHint}</span>
      <span class="ph-compose-btns">
        <button type="button" class="ph-btn" data-act="clear">Clear</button>
        ${_confirmCopy ? '' : '<button type="button" class="ph-btn ph-btn-primary" data-act="copy">Copy message</button>'}
      </span>
    </div>
    ${statusLine}
  </div>`;
}

function renderRows() {
  return `<div class="ph-rows">${PC.COMPOSE_ORDER.map(renderRow).join('')}</div>`;
}

function rowMatchScore(query, b) {
  if (query.startsWith('/')) {
    const t = query.slice(1).toLowerCase();
    if (!t) return 0;
    if (b.trigger === t) return 2000;
    if (b.trigger && b.trigger.startsWith(t)) return 1000;
    return 0;
  }
  if (b.trigger && b.trigger === query.toLowerCase()) return 2000;
  return PC.scoreMatch(query, `${b.title} ${b.trigger} ${b.keywords}`);
}

function renderRow(slot) {
  let blocks = allBlocks().filter((b) => b.slot === slot);
  const isSubstance = slot === 'substance';
  const expanded = !!_expandedRows[slot];

  if (isSubstance && expanded && _substanceCat !== 'all') {
    blocks = blocks.filter((b) => b.category === _substanceCat);
  }

  const use = _config.usage;
  const q = _query.trim();
  let ordered;
  let matchSet = null;

  if (q) {
    matchSet = new Set();
    const scored = blocks.map((b) => ({ b, score: rowMatchScore(q, b) }));
    for (const e of scored) if (e.score > 0) matchSet.add(e.b.id);
    ordered = scored
      .sort((x, y) => y.score - x.score || (Number(use[y.b.id]) || 0) - (Number(use[x.b.id]) || 0))
      .map((e) => e.b);
  } else {
    ordered = [...blocks].sort((a, b) => (Number(use[b.id]) || 0) - (Number(use[a.id]) || 0));
  }

  // Search and an already-expanded row both show everything; only the
  // untouched, unsearched fold state truncates to FOLD_N (decision C).
  const showAll = !!q || expanded;
  const visible = showAll ? ordered : ordered.slice(0, FOLD_N);
  const hiddenCount = showAll ? 0 : Math.max(0, ordered.length - FOLD_N);
  const orderMap = selectedOrderMap();

  const chipsHtml =
    blocks.length === 0
      ? `<span class="ph-row-none">none</span>`
      : visible.map((b) => renderChip(b, matchSet, orderMap)).join('') +
        (hiddenCount > 0
          ? `<button type="button" class="ph-chip ph-chip-more" data-act="row-more" data-slot="${esc(slot)}" aria-expanded="false" aria-label="Show ${hiddenCount} more ${esc(ROW_LABEL[slot] || slot)} phrases">+${hiddenCount} more</button>`
          : '');

  const catRow = isSubstance && expanded ? renderSubstanceCatFilter() : '';

  return `<div class="ph-row">
    <div class="ph-row-label">${esc(ROW_LABEL[slot] || slot)}</div>
    ${catRow}
    <div class="ph-row-chips">${chipsHtml}</div>
  </div>`;
}

function renderChip(b, matchSet, orderMap) {
  const selected = _selected.includes(b.id);
  const idx = orderMap.get(b.id);
  const label = PC.chipLabel(b.title);
  const cls = ['ph-chip'];
  if (selected) cls.push('ph-chip-on');
  if (matchSet) cls.push(matchSet.has(b.id) ? 'ph-chip-match' : 'ph-chip-fade');
  const idxHtml = selected && idx ? `<span class="ph-chip-idx">${idx}</span>` : '';
  const audHtml = renderAudBadge(b.audience);
  return `<button type="button" class="${cls.join(' ')}" data-act="pick" data-id="${esc(b.id)}" aria-pressed="${selected ? 'true' : 'false'}" title="${esc(b.title)}" aria-label="${esc(b.title)}">${idxHtml}${esc(label)}${audHtml}</button>`;
}

function renderSubstanceCatFilter() {
  const pills = [
    `<button type="button" class="ph-pill ${_substanceCat === 'all' ? 'ph-pill-on' : ''}" data-act="subcat" data-cat="all" aria-pressed="${_substanceCat === 'all' ? 'true' : 'false'}">All</button>`,
    ...categories().map(
      (c) =>
        `<button type="button" class="ph-pill ${_substanceCat === c.id ? 'ph-pill-on' : ''}" data-act="subcat" data-cat="${esc(c.id)}" aria-pressed="${_substanceCat === c.id ? 'true' : 'false'}">${esc(c.label)}</button>`
    ),
  ].join('');
  return `<div class="ph-row-catfilter">${pills}</div>`;
}

// Live re-sync of the char count / gaps note as the clinician types in the
// preview, WITHOUT a full render() — a full innerHTML replace would drop the
// textarea's cursor/scroll position mid-edit. The *** copy gate itself is
// evaluated only at Copy time (doCopy reads the textarea's live value).
function onPreviewInput(ta) {
  _draft = ta.value;
  const text = ta.value;
  const { chars, smsSegments } = PC.charCount(text);
  const hasGaps = PC.hasUnfilledPlaceholders(text);
  const blocks = _selected.map(findBlock).filter(Boolean);
  const audiences = [...new Set(blocks.map((b) => b.audience))];
  const smsHint = audiences.includes('patient') && chars > 0 ? ` · ~${smsSegments} SMS` : '';

  const countEl = container.querySelector('.ph-charcount');
  if (countEl) countEl.textContent = `${chars} chars${smsHint}`;

  const gapsEl = container.querySelector('#phGapsNote');
  if (gapsEl) gapsEl.hidden = !hasGaps;

  autoGrowPreview(ta);
}

function autoGrowPreview(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function syncPreviewAutoGrow() {
  autoGrowPreview(container?.querySelector('#phComposePreview'));
}

// ── Library mode ──────────────────────────────────────────────────────────────

function renderLibrary() {
  const parts = [renderToolbar()];
  if (_editingId !== null) parts.push(renderForm());
  parts.push(
    `<div class="ph-lib-hint">Tap a card to add it to your message — switch to Compose to build and copy it.</div>`
  );
  parts.push(renderList());
  return `<div class="ph-mode-library">${parts.join('')}</div>`;
}

function renderToolbar() {
  const pills = [
    `<button type="button" class="ph-pill ${_activeCat === 'all' ? 'ph-pill-on' : ''}" data-act="cat" data-cat="all" aria-pressed="${_activeCat === 'all' ? 'true' : 'false'}">All</button>`,
    ...categories().map(
      (c) =>
        `<button type="button" class="ph-pill ${_activeCat === c.id ? 'ph-pill-on' : ''}" data-act="cat" data-cat="${esc(c.id)}" aria-pressed="${_activeCat === c.id ? 'true' : 'false'}">${esc(c.label)}</button>`
    ),
  ].join('');
  return `
    <div class="ph-toolbar">
      <input type="search" id="phSearch" class="ph-search" placeholder="Search, or /trigger…" value="${esc(_query)}" aria-label="Search phrases" />
      <button type="button" class="ph-btn ph-btn-primary" data-act="add">+ Add</button>
    </div>
    <div class="ph-pills">${pills}</div>
    ${renderLlmBlock()}`;
}

// LLM-assisted authoring lives here on the tab (simpler than an Options
// section for a personal library): copy the prompt, paste JSON back, strict
// per-block validation with visible errors. Mirrors the Knowledge module's
// starter-pack import discipline. Library-only (decision S) — nothing on the
// compose surface references it.
function renderLlmBlock() {
  return `
    <details class="ph-llm-block">
      <summary>Write blocks with an LLM…</summary>
      <div class="ph-llm-inner">
        <p class="ph-llm-help">Copy the prompt into any LLM (ChatGPT, Claude, etc.), describe the blocks you want, then paste the JSON reply below. Every block is validated before it is saved; patient-facing blocks are written at NHS reading age 9&ndash;11 by the prompt's rules. Review each one before you rely on it.</p>
        <button type="button" class="ph-btn ph-btn-sm" data-act="copy-llm-prompt">Copy prompt</button>
        <textarea id="phLlmJson" class="ph-input" rows="4" placeholder="Paste the JSON reply from the LLM here…"></textarea>
        <div class="ph-llm-row">
          <button type="button" class="ph-btn ph-btn-sm" data-act="import-llm">Validate &amp; import</button>
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

function renderEmptyState({ message, showClear }) {
  return `<div class="ph-empty">
    <span class="ph-empty-icon">${ICON_SEARCH}</span>
    <div class="ph-empty-msg">${esc(message)}</div>
    ${showClear ? `<button type="button" class="ph-btn ph-btn-ghost ph-btn-sm" data-act="clear-search">Clear search</button>` : ''}
  </div>`;
}

function renderList() {
  if (allBlocks().length === 0 && _editingId === null) {
    return renderEmptyState({
      message: 'No blocks yet. Use + Add to write one, or the LLM helper above.',
      showClear: false,
    });
  }
  const blocks = visibleBlocks();
  if (blocks.length === 0) {
    const q = _query.trim();
    const catPart = _activeCat !== 'all' ? ` in ${catLabel(_activeCat)}` : '';
    const qPart = q ? `'${q}'` : 'your filters';
    return renderEmptyState({ message: `No matches for ${qPart}${catPart}.`, showClear: true });
  }
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
    ? `<button type="button" class="ph-btn ph-btn-sm ph-btn-danger" data-act="hide-practice" data-id="${esc(b.id)}" title="Remove this practice block (it will not come back on pack updates)">Remove</button>`
    : `<button type="button" class="ph-btn ph-btn-sm" data-act="edit" data-id="${esc(b.id)}">Edit</button>
       <button type="button" class="ph-btn ph-btn-sm" data-act="promote" data-id="${esc(b.id)}" title="Move to the practice tier (shared via Options backup)">Promote</button>
       <button type="button" class="ph-btn ph-btn-sm ph-btn-danger" data-act="delete" data-id="${esc(b.id)}">Delete</button>`;

  // Provenance inverts (decision G): personal blocks get the violet "yours"
  // badge; practice blocks are the unbadged default plus a muted pack-version
  // meta line (cheap provenance until the reviewBy follow-up lands).
  const ownerBadge = !practice ? `<span class="ph-badge ph-badge-yours">yours</span>` : '';
  const provenance = practice
    ? `<div class="ph-card-provenance">Practice pack v${esc(String(_config.version))}</div>`
    : '';

  return `
    <div class="ph-card ${selected ? 'ph-card-selected' : ''}" data-act="pick" data-id="${esc(b.id)}" tabindex="0" role="button" aria-pressed="${selected ? 'true' : 'false'}">
      <div class="ph-card-top">
        <span class="ph-card-title">${esc(b.title)}</span>
        ${renderAudBadge(b.audience)}
      </div>
      <div class="ph-card-meta">
        ${ownerBadge}
        <span class="ph-slot">${esc(SLOT_LABEL[b.slot] || b.slot)}</span>
        <span class="ph-cat-chip">${esc(catLabel(b.category))}</span>
        ${b.trigger ? `<span class="ph-trigger">/${esc(b.trigger)}</span>` : ''}
        ${uses > 0 ? `<span class="ph-uses" title="Times you have copied this block">×${uses}</span>` : ''}
        ${leaflet}
      </div>
      <div class="ph-card-preview">${escWithPlaceholders(firstLine)}</div>
      ${provenance}
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
        <button type="button" class="ph-btn ph-btn-primary" data-act="save">Save</button>
        <button type="button" class="ph-btn" data-act="cancel">Cancel</button>
      </div>
    </div>`;
}

// ── Events ────────────────────────────────────────────────────────────────────

function onInput(ev) {
  const t = ev.target;
  if (t.id === 'phSearch') {
    _query = t.value;
    _copyStatus = '';
    if (_mode === 'library') {
      const body = container.querySelector('#phBody');
      const listHost = body.querySelector('.ph-list, .ph-empty');
      if (listHost) listHost.outerHTML = renderList();
    } else {
      const rowsHost = container.querySelector('.ph-rows');
      if (rowsHost) rowsHost.outerHTML = renderRows();
    }
    saveUi();
    return;
  }
  if (t.id === 'phComposePreview') {
    onPreviewInput(t);
  }
}

function onKeydown(ev) {
  const t = ev.target;

  // Exact /trigger match (or a bare trigger) + Enter selects that block
  // immediately, compose mode only (decision E).
  if (t.id === 'phSearch' && ev.key === 'Enter' && _mode === 'compose') {
    const q = _query.trim();
    if (!q) return;
    const low = (q.startsWith('/') ? q.slice(1) : q).toLowerCase();
    if (!low) return;
    const match = allBlocks().find((b) => b.trigger && b.trigger === low);
    if (match) {
      ev.preventDefault();
      selectBlock(match.id);
      _query = '';
      render();
      container.querySelector('#phSearch')?.focus();
      saveUi();
    }
    return;
  }

  // Cards are role="button" divs (real <button> can't nest the Edit/Delete
  // buttons they carry) — Enter/Space activates them like any button
  // (decision K). Real <button>/<a> targets handle their own key activation.
  if ((ev.key === 'Enter' || ev.key === ' ') && t.closest && t.closest('.ph-card')) {
    if (t.closest('button, a')) return;
    ev.preventDefault();
    t.closest('.ph-card').click();
  }
}

function onClick(ev) {
  const actEl = ev.target.closest('[data-act]');
  if (!actEl || !container.contains(actEl)) return;
  const act = actEl.dataset.act;

  if (act === 'leaflet') return; // let the anchor navigate; don't treat as a pick

  // A chip or card body click = toggle it in/out of the compose selection.
  // Shared by slot chips (compose mode) and cards (Library mode) — inner
  // buttons are their own nearest [data-act], so they never reach here.
  if (act === 'pick') {
    selectBlock(actEl.dataset.id);
    render();
    return;
  }
  ev.stopPropagation();

  switch (act) {
    case 'mode':
      _mode = actEl.dataset.mode === 'library' ? 'library' : 'compose';
      _editingId = null;
      saveUi();
      render();
      break;
    case 'unselect':
      _selected = _selected.filter((x) => x !== actEl.dataset.id);
      _confirmCopy = false;
      _copyStatus = '';
      _draft = null;
      _previewExpanded = false;
      render();
      break;
    case 'clear':
      _selected = [];
      _confirmCopy = false;
      _copyStatus = '';
      _draft = null;
      _previewExpanded = false;
      render();
      break;
    case 'toggle-preview':
      _previewExpanded = !_previewExpanded;
      render();
      break;
    case 'row-more':
      _expandedRows = { ..._expandedRows, [actEl.dataset.slot]: true };
      saveUi();
      render();
      break;
    case 'subcat':
      _substanceCat = actEl.dataset.cat;
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
    case 'clear-search':
      _query = '';
      _activeCat = 'all';
      saveUi();
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
  const ta = container?.querySelector('#phComposePreview');
  // Copy operates on the CURRENT textarea value (decision L) — a GP may have
  // filled *** in-panel before clicking Copy, and the gate below must fire on
  // what is actually about to be copied, not the original composed text.
  const text = ta ? ta.value : PC.composeMessage(_selected, allBlocks());
  if (!text) return;

  // The ***-unfilled gate (H-052 control): a message still carrying manual-
  // fill markers needs an explicit second click that states the consequence.
  const carriesGaps = PC.hasUnfilledPlaceholders(text);
  if (carriesGaps && !confirmed) {
    _confirmCopy = true;
    render();
    container.querySelector('#phCopyBack')?.focus();
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
  // next composition change — H-049 discipline. It also names the clipboard-
  // outlives-context risk at the moment it becomes real (H-052: the clipboard
  // is OS-level; the suite cannot scope or clear it, so the accepted control is
  // stating the consequence here, where it is read). And a ***-confirmed copy
  // keeps its obligation VISIBLE after the click — the warning must not vanish
  // at the moment it becomes outstanding.
  _copyStatus =
    'Copied to clipboard. Paste it into the right Medicus box now — it stays on the clipboard until you copy something else, so it can land in the wrong patient’s box later. Nothing goes anywhere until you paste and send.' +
    (carriesGaps ? ' This copy still contains *** — type over every one before you send.' : '');
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
    const summary =
      `${accepted.length} block(s) imported as personal blocks` +
      (rejected.length > 0 ? `; ${rejected.length} rejected (see below).` : '. Review each before using it.');
    if (accepted.length > 0) {
      freshStatus.className = 'ph-llm-status ph-llm-status-ok';
      freshStatus.innerHTML = `<span class="ph-ok-glyph" aria-hidden="true">&#10003;</span>${esc(summary)}`;
    } else {
      freshStatus.className = 'ph-llm-status ph-llm-status-err';
      freshStatus.textContent = summary;
    }
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
