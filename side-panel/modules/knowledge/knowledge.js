// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Knowledge module
// Practice-owned reference base: referral criteria, contacts, pathways,
// templates. Add/edit/search lives here on the tab; the LLM starter-pack
// import lives in Options → Knowledge.
//
// Storage: knowledge.items, knowledge.categories, knowledge.config
// Pure logic (validation, near-duplicate detection) lives in
// shared/knowledge-utils.js (window.KnowledgeUtils, loaded by panel.html /
// pop-out.html).

'use strict';

import { loadUiState, saveUiState } from '../shared/ui-state.js';

let container = null;
let _storageListener = null;
let _ignoreNextChange = false;

let _items = [];
let _categories = [];
let _config = {};

let _query = '';
let _activeCat = 'all'; // 'all' | category id
let _editingId = null; // null | 'new' | entry id
let _expandedId = null; // entry id with detail open, or null
let _similarTimer = null;
let _uiStateTimer = null;
let _formSource = null; // 'llm' when the open form was filled from LLM JSON

const KU = typeof window !== 'undefined' ? window.KnowledgeUtils : null;

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
  _query = '';
  _activeCat = 'all';
  _editingId = null;
  _expandedId = null;

  // Restore persisted view state (category filter, search query, expanded card)
  const savedUi = await loadUiState('knowledge');
  if (savedUi) {
    if (typeof savedUi._activeCat === 'string') _activeCat = savedUi._activeCat;
    if (typeof savedUi._query === 'string') _query = savedUi._query;
    if (typeof savedUi._expandedId === 'string' || savedUi._expandedId === null) _expandedId = savedUi._expandedId;
  }

  container.innerHTML = `
    <div class="kb-module">
      <div class="kb-head">
        <h2 class="kb-title">Knowledge</h2>
        <span class="kb-subtitle">Practice reference — verify against current local guidance before acting.</span>
      </div>
      <div id="kbBody"></div>
    </div>`;

  await loadState();
  render();

  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);

  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (!changes['knowledge.items'] && !changes['knowledge.categories'] && !changes['knowledge.config']) return;
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
  if (_similarTimer) {
    clearTimeout(_similarTimer);
    _similarTimer = null;
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
  const r = await chrome.storage.local.get(['knowledge.items', 'knowledge.categories', 'knowledge.config']);
  _items = Array.isArray(r['knowledge.items']) ? r['knowledge.items'] : [];
  _categories = KU ? KU.sanitiseCategories(r['knowledge.categories']) : r['knowledge.categories'] || [];
  _config = r['knowledge.config'] || {};
}

async function persistItems() {
  _ignoreNextChange = true;
  await chrome.storage.local.set({ 'knowledge.items': _items });
}

function catName(id) {
  const c = _categories.find((c) => c.id === id);
  return c ? c.name : id;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  const body = container?.querySelector('#kbBody');
  if (!body) return;
  const parts = [];

  if (!_config.noticeAcknowledgedAt) parts.push(renderNotice());
  parts.push(renderToolbar());
  if (_editingId !== null) parts.push(renderForm());
  parts.push(renderList());

  body.innerHTML = parts.join('');
}

function renderNotice() {
  return `
    <div class="kb-notice">
      <div>This tab holds <strong>practice-entered reference material</strong>, not clinical decision support.
      Entries can be wrong or out of date — verify against current local guidance before acting on them.</div>
      <button class="kb-btn" data-act="ack-notice">Understood</button>
    </div>`;
}

function renderToolbar() {
  const pills = [
    `<button class="kb-pill ${_activeCat === 'all' ? 'kb-pill-on' : ''}" data-act="cat" data-cat="all">All</button>`,
    ..._categories.map(
      (c) =>
        `<button class="kb-pill ${_activeCat === c.id ? 'kb-pill-on' : ''}" data-act="cat" data-cat="${esc(c.id)}">${esc(c.name)}</button>`
    ),
  ].join('');
  return `
    <div class="kb-toolbar">
      <input type="search" id="kbSearch" class="kb-search" placeholder="Search title, content, tags…" value="${esc(_query)}" />
      <button class="kb-btn kb-btn-primary" data-act="add">+ Add</button>
    </div>
    <div class="kb-pills">${pills}</div>`;
}

function visibleItems() {
  const q = _query.trim().toLowerCase();
  return _items
    .filter((e) => _activeCat === 'all' || e.category === _activeCat)
    .filter(
      (e) =>
        !q ||
        e.title.toLowerCase().includes(q) ||
        (e.body || '').toLowerCase().includes(q) ||
        (e.tags || []).some((t) => t.includes(q))
    )
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

function renderList() {
  const items = visibleItems();
  if (_items.length === 0 && _editingId === null) {
    return `<div class="kb-empty">No entries yet. Use <strong>+ Add</strong> to create one, or generate a starter pack in
      <a href="#" data-act="open-options">Options → Knowledge</a>.</div>`;
  }
  if (items.length === 0) return `<div class="kb-empty">No entries match.</div>`;
  return `<div class="kb-list">${items.map(renderCard).join('')}</div>`;
}

function renderCard(e) {
  const open = _expandedId === e.id;
  const badges = [];
  if (e.source === 'llm' && !e.reviewed)
    badges.push('<span class="kb-badge kb-badge-amber">Unreviewed — AI-generated</span>');
  if (e.reviewBy && e.reviewBy < today()) badges.push('<span class="kb-badge kb-badge-grey">Review due</span>');
  const tags = (e.tags || []).map((t) => `<span class="kb-tag">${esc(t)}</span>`).join('');
  const firstLine = (e.body || '').split('\n')[0];

  let detail = '';
  if (open) {
    const phoneRow = e.phone
      ? `
      <div class="kb-detail-row"><span class="kb-detail-label">Phone</span>
        <span class="kb-phone">${esc(e.phone)}</span>
        <button class="kb-btn kb-btn-sm" data-act="copy" data-copy="${esc(e.phone)}">Copy</button></div>`
      : '';
    const urlRow = e.url
      ? `
      <div class="kb-detail-row"><span class="kb-detail-label">Link</span>
        <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}</a></div>`
      : '';
    const reviewRow = e.reviewBy
      ? `
      <div class="kb-detail-row"><span class="kb-detail-label">Review by</span>${esc(e.reviewBy)}</div>`
      : '';
    const markReviewed =
      e.source === 'llm' && !e.reviewed
        ? `<button class="kb-btn kb-btn-sm" data-act="mark-reviewed" data-id="${esc(e.id)}">Mark reviewed</button>`
        : '';
    detail = `
      <div class="kb-detail">
        ${e.body ? `<div class="kb-body-text">${esc(e.body)}</div>` : ''}
        ${phoneRow}${urlRow}${reviewRow}
        <div class="kb-detail-actions">
          ${e.body ? `<button class="kb-btn kb-btn-sm" data-act="copy" data-copy="${esc(e.body)}">Copy text</button>` : ''}
          ${markReviewed}
          <button class="kb-btn kb-btn-sm" data-act="edit" data-id="${esc(e.id)}">Edit</button>
          <button class="kb-btn kb-btn-sm kb-btn-danger" data-act="delete" data-id="${esc(e.id)}">Delete</button>
        </div>
      </div>`;
  }

  return `
    <div class="kb-card ${open ? 'kb-card-open' : ''}" data-act="toggle" data-id="${esc(e.id)}">
      <div class="kb-card-top">
        <span class="kb-card-title">${esc(e.title)}</span>
        <span class="kb-cat-chip">${esc(catName(e.category))}</span>
      </div>
      ${badges.length || tags ? `<div class="kb-card-meta">${badges.join('')}${tags}</div>` : ''}
      ${!open && firstLine ? `<div class="kb-card-preview">${esc(firstLine)}</div>` : ''}
      ${detail}
    </div>`;
}

function renderForm() {
  const editing = _editingId !== 'new' ? _items.find((e) => e.id === _editingId) : null;
  const e = editing || {
    title: '',
    category: _activeCat !== 'all' ? _activeCat : _categories[0]?.id || 'referrals',
    body: '',
    phone: '',
    url: '',
    tags: [],
    reviewBy: '',
  };
  const catOpts = _categories
    .map((c) => `<option value="${esc(c.id)}" ${c.id === e.category ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');
  return `
    <div class="kb-form">
      <div class="kb-form-title">${editing ? 'Edit entry' : 'New entry'}</div>
      ${
        editing
          ? ''
          : `
      <details class="kb-llm-block">
        <summary>Create from text with an LLM…</summary>
        <div class="kb-llm-inner">
          <p class="kb-llm-help">Copied some text or a screenshot transcript? Copy the prompt, paste it into any LLM
          (ChatGPT, Claude, etc.) followed by your material, then paste the JSON reply below — it fills in this form
          for you to check and save.</p>
          <button class="kb-btn kb-btn-sm" data-act="copy-llm-prompt">Copy prompt</button>
          <textarea id="kbFmLlmJson" class="kb-input" rows="4" placeholder="Paste the JSON reply from the LLM here…"></textarea>
          <div class="kb-llm-row">
            <button class="kb-btn kb-btn-sm" data-act="fill-from-llm">Fill form from JSON</button>
            <span id="kbFmLlmStatus" class="kb-llm-status"></span>
          </div>
        </div>
      </details>`
      }
      <label class="kb-label">Title</label>
      <input type="text" id="kbFmTitle" class="kb-input" maxlength="120" value="${esc(e.title)}" placeholder="e.g. Dermatology — 2WW suspected melanoma" />
      <div id="kbSimilar"></div>
      <div class="kb-form-row">
        <div>
          <label class="kb-label">Category</label>
          <select id="kbFmCat" class="kb-input">${catOpts}<option value="__new__">+ New category…</option></select>
          <input type="text" id="kbFmNewCat" class="kb-input kb-hidden" maxlength="40" placeholder="New category name" />
        </div>
        <div>
          <label class="kb-label">Review by</label>
          <input type="date" id="kbFmReview" class="kb-input" value="${esc(e.reviewBy || '')}" />
        </div>
      </div>
      <label class="kb-label">Content</label>
      <textarea id="kbFmBody" class="kb-input" rows="5" maxlength="4000" placeholder="Plain text — criteria, opening hours, how to refer…">${esc(e.body)}</textarea>
      <div class="kb-form-row">
        <div><label class="kb-label">Phone (optional)</label><input type="text" id="kbFmPhone" class="kb-input" maxlength="60" value="${esc(e.phone)}" /></div>
        <div><label class="kb-label">Link (optional)</label><input type="text" id="kbFmUrl" class="kb-input" maxlength="300" value="${esc(e.url)}" placeholder="https://…" /></div>
      </div>
      <label class="kb-label">Tags (comma-separated, optional)</label>
      <input type="text" id="kbFmTags" class="kb-input" value="${esc((e.tags || []).join(', '))}" placeholder="2ww, dermatology" />
      <div id="kbFmError" class="kb-form-error"></div>
      <div class="kb-form-actions">
        <button class="kb-btn kb-btn-primary" data-act="save">Save</button>
        <button class="kb-btn" data-act="cancel">Cancel</button>
      </div>
    </div>`;
}

function renderSimilarPanel() {
  const host = container?.querySelector('#kbSimilar');
  if (!host || !KU) return;
  const title = container.querySelector('#kbFmTitle')?.value || '';
  const hits =
    title.trim().length >= 3
      ? KU.findSimilar(title, _items, { excludeId: _editingId !== 'new' ? _editingId : null })
      : [];
  if (hits.length === 0) {
    host.innerHTML = '';
    return;
  }
  host.innerHTML = `
    <div class="kb-similar">
      <div class="kb-similar-head">Similar entries already exist — edit one instead of adding a duplicate?</div>
      ${hits
        .map(
          (h) => `
        <div class="kb-similar-row">
          <span class="kb-similar-title">${esc(h.item.title)}</span>
          <span class="kb-cat-chip">${esc(catName(h.item.category))}</span>
          <button class="kb-btn kb-btn-sm" data-act="edit" data-id="${esc(h.item.id)}">Edit that</button>
        </div>`
        )
        .join('')}
    </div>`;
}

// ── Events ────────────────────────────────────────────────────────────────────

function onInput(ev) {
  const t = ev.target;
  if (t.id === 'kbSearch') {
    _query = t.value;
    const body = container.querySelector('#kbBody');
    // Re-render only the list (keep focus in the search box).
    const listHost = body.querySelector('.kb-list, .kb-empty');
    if (listHost) listHost.outerHTML = renderList();
    // Debounced save — only on discrete pause, not every keystroke
    if (_uiStateTimer) clearTimeout(_uiStateTimer);
    _uiStateTimer = setTimeout(() => {
      saveUiState('knowledge', { _activeCat, _query, _expandedId });
    }, 400);
    return;
  }
  if (t.id === 'kbFmTitle') {
    if (_similarTimer) clearTimeout(_similarTimer);
    _similarTimer = setTimeout(renderSimilarPanel, 300);
    return;
  }
  if (t.id === 'kbFmCat') {
    const newCatInput = container.querySelector('#kbFmNewCat');
    if (newCatInput) {
      newCatInput.classList.toggle('kb-hidden', t.value !== '__new__');
      if (t.value === '__new__') newCatInput.focus();
    }
  }
}

function onClick(ev) {
  const actEl = ev.target.closest('[data-act]');
  if (!actEl || !container.contains(actEl)) return;
  const act = actEl.dataset.act;

  // Card-level toggle. Inner action buttons (edit/delete/copy) are the nearest
  // [data-act] for their own clicks, so they never reach this branch.
  if (act === 'toggle') {
    _expandedId = _expandedId === actEl.dataset.id ? null : actEl.dataset.id;
    saveUiState('knowledge', { _activeCat, _query, _expandedId });
    render();
    return;
  }
  ev.stopPropagation();

  switch (act) {
    case 'add':
      _editingId = 'new';
      _formSource = null;
      render();
      container.querySelector('#kbFmTitle')?.focus();
      break;
    case 'cat':
      _activeCat = actEl.dataset.cat;
      saveUiState('knowledge', { _activeCat, _query, _expandedId });
      render();
      break;
    case 'edit':
      _editingId = actEl.dataset.id;
      _expandedId = null;
      _formSource = null;
      render();
      break;
    case 'cancel':
      _editingId = null;
      _formSource = null;
      render();
      break;
    case 'copy-llm-prompt':
      copyText(KU.kbSingleEntryPrompt(), actEl);
      break;
    case 'fill-from-llm':
      fillFromLlm();
      break;
    case 'save':
      saveForm();
      break;
    case 'delete':
      deleteEntry(actEl.dataset.id);
      break;
    case 'mark-reviewed':
      markReviewed(actEl.dataset.id);
      break;
    case 'copy':
      copyText(actEl.dataset.copy, actEl);
      break;
    case 'ack-notice':
      ackNotice();
      break;
    case 'open-options':
      ev.preventDefault();
      chrome.runtime.openOptionsPage();
      break;
  }
}

// Parse the pasted LLM JSON and pre-fill the add form. The entry is NOT saved
// here — the user checks it (and the near-duplicate panel fires on the title)
// before clicking Save, where it is tagged source:'llm', reviewed:false.
function fillFromLlm() {
  const statusEl = container.querySelector('#kbFmLlmStatus');
  const jsonEl = container.querySelector('#kbFmLlmJson');
  if (!statusEl || !jsonEl) return;
  const fail = (msg) => {
    statusEl.className = 'kb-llm-status kb-llm-status-err';
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

  // Accept a single object; tolerate an array or { entries: [...] } by taking
  // the first entry (packs belong in Options → Knowledge).
  let entry = parsed,
    extra = 0;
  if (Array.isArray(parsed)) {
    entry = parsed[0];
    extra = parsed.length - 1;
  } else if (parsed && Array.isArray(parsed.entries)) {
    entry = parsed.entries[0];
    extra = parsed.entries.length - 1;
  }
  if (!entry) return fail('No entry found in the pasted JSON.');

  const errs = KU.validateEntry(entry);
  if (errs.length > 0) return fail(errs[0]);
  const clean = KU.sanitiseEntry(entry);

  const set = (id, v) => {
    const el = container.querySelector('#' + id);
    if (el) el.value = v;
  };
  set('kbFmTitle', clean.title);
  set('kbFmBody', clean.body);
  set('kbFmPhone', clean.phone);
  set('kbFmUrl', clean.url);
  set('kbFmTags', clean.tags.join(', '));
  set('kbFmReview', clean.reviewBy || '');

  const catSel = container.querySelector('#kbFmCat');
  const newCatInput = container.querySelector('#kbFmNewCat');
  if (catSel) {
    if (_categories.some((c) => c.id === clean.category)) {
      catSel.value = clean.category;
      newCatInput?.classList.add('kb-hidden');
    } else {
      catSel.value = '__new__';
      if (newCatInput) {
        newCatInput.classList.remove('kb-hidden');
        newCatInput.value = clean.category.replace(/-/g, ' ').replace(/^./, (ch) => ch.toUpperCase());
      }
    }
  }

  _formSource = 'llm';
  renderSimilarPanel();

  const phi = KU.phiWarnings([clean]);
  if (phi.length > 0) {
    statusEl.className = 'kb-llm-status kb-llm-status-warn';
    statusEl.textContent = 'Form filled — but check it: ' + phi[0];
    return;
  }
  statusEl.className = 'kb-llm-status kb-llm-status-ok';
  statusEl.textContent =
    'Form filled — check the content, then Save.' +
    (extra > 0 ? ` (Used the first of ${extra + 1} entries — import packs via Options → Knowledge.)` : '');
}

function selectedCategory() {
  const sel = container.querySelector('#kbFmCat');
  if (!sel) return null;
  if (sel.value !== '__new__') return sel.value;
  const name = (container.querySelector('#kbFmNewCat')?.value || '').trim();
  if (!name) return null;
  const id = KU.generateEntryId(name, new Set(_categories.map((c) => c.id)));
  return { id, name };
}

async function saveForm() {
  const errEl = container.querySelector('#kbFmError');
  const get = (id) => container.querySelector('#' + id)?.value ?? '';

  let cat = selectedCategory();
  let newCat = null;
  if (cat && typeof cat === 'object') {
    newCat = cat;
    cat = cat.id;
  }
  if (!cat) {
    errEl.textContent = 'Pick a category (or name the new one).';
    return;
  }

  const raw = {
    id: _editingId !== 'new' ? _editingId : undefined,
    title: get('kbFmTitle'),
    category: cat,
    body: get('kbFmBody'),
    phone: get('kbFmPhone'),
    url: get('kbFmUrl').trim(),
    tags: get('kbFmTags')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    reviewBy: get('kbFmReview') || null,
    source: 'manual',
    reviewed: true,
  };

  const errs = KU.validateEntry(raw);
  if (errs.length > 0) {
    errEl.textContent = errs[0];
    return;
  }
  const clean = KU.sanitiseEntry(raw);

  if (_editingId === 'new') {
    clean.id = KU.generateEntryId(clean.title, new Set(_items.map((e) => e.id)));
    // A form filled from LLM JSON keeps AI provenance and stays badged until
    // explicitly marked reviewed — same rule as the Options starter-pack import.
    if (_formSource === 'llm') {
      clean.source = 'llm';
      clean.reviewed = false;
    }
    _items.push(clean);
  } else {
    const idx = _items.findIndex((e) => e.id === _editingId);
    if (idx === -1) {
      errEl.textContent = 'Entry no longer exists.';
      return;
    }
    // Editing keeps the original provenance; a human just edited it, so it counts as reviewed.
    clean.source = _items[idx].source;
    clean.reviewed = true;
    _items[idx] = clean;
  }

  if (newCat) {
    _categories.push(newCat);
    _ignoreNextChange = true;
    await chrome.storage.local.set({ 'knowledge.categories': _categories });
  }
  await persistItems();
  _editingId = null;
  _formSource = null;
  _expandedId = clean.id;
  render();
}

async function deleteEntry(id) {
  const entry = _items.find((e) => e.id === id);
  if (!entry) return;
  if (!confirm(`Delete "${entry.title}"?`)) return;
  _items = _items.filter((e) => e.id !== id);
  _expandedId = null;
  await persistItems();
  render();
}

async function markReviewed(id) {
  const entry = _items.find((e) => e.id === id);
  if (!entry) return;
  entry.reviewed = true;
  entry.updatedAt = new Date().toISOString();
  await persistItems();
  render();
}

async function ackNotice() {
  _config = { ..._config, noticeAcknowledgedAt: new Date().toISOString() };
  _ignoreNextChange = true;
  await chrome.storage.local.set({ 'knowledge.config': _config });
  render();
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const old = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => {
    if (btn.isConnected) btn.textContent = old;
  }, 1200);
}
