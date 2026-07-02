// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — NHS Patient Leaflets module
//
// Tier 1 (always on, no config, no new network endpoint): fuzzy search over
// the bundled rules/nhs-az-index.json, "Open" (chrome.tabs.create — a normal
// user-initiated browser navigation, not an extension fetch) and "Copy link".
// A guaranteed "Search nhs.uk for '<term>'" row covers any index miss.
//
// Tier 2 (config-gated, Options → Leaflets): with an API key configured and
// enabled, selecting a result fetches the leaflet from api.nhs.uk and renders
// it in-panel. The render model (title/sections/paragraphs/attribution) is
// TEXT ONLY (see shared/leaflets-utils.js mapApiResponseToRenderModel /
// stripTags) and is inserted into the DOM via createElement + textContent —
// never innerHTML — because this is the one surface where the panel renders
// content it did not author itself. Any fetch problem (401/403/429/network/
// unexpected shape) shows a calm one-line notice plus the tier-1 "open on
// nhs.uk" fallback; the module is otherwise indistinguishable from tier-1
// when no key is set.
//
// Storage: leaflets.recent (last 10), leaflets.config ({ enabled, apiKey }).
// The render cache is in-memory only (24h TTL) — never persisted, never sent
// anywhere except as a plain GET to api.nhs.uk with only the selected
// condition/medicine term.

'use strict';

let container = null;
let _storageListener = null;
let _ignoreNextChange = false;

let _index = []; // rules/nhs-az-index.json entries
let _indexError = false;
let _query = '';
let _recent = [];
let _config = {}; // { enabled, apiKey }
let _openKey = null; // "kind:slug" of the row whose tier-2 detail is expanded, or null

// In-memory render cache: "kind:slug" -> { status: 'loading'|'ok'|'error', ts, model?, message? }
const _renderCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — respects the API's freshness terms

const LU = typeof window !== 'undefined' ? window.LeafletsUtils : null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cacheKey(entry) {
  return `${entry.kind}:${entry.slug}`;
}

// ── Init / cleanup ──────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  _query = '';
  _openKey = null;

  container.innerHTML = `
    <div class="lf-module">
      <div class="lf-head">
        <h2 class="lf-title">Leaflets</h2>
        <span class="lf-subtitle">Find the right NHS patient information leaflet — open it, copy a link, or (with an API key) read it here.</span>
      </div>
      <div id="lfBody"></div>
    </div>`;

  await Promise.all([loadIndex(), loadState()]);
  render();

  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);

  _storageListener = (changes, area) => {
    if (area !== 'local') return;
    if (!changes['leaflets.recent'] && !changes['leaflets.config']) return;
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
  if (container) {
    container.removeEventListener('click', onClick);
    container.removeEventListener('input', onInput);
  }
  container = null;
}

export { cleanup };

async function loadIndex() {
  try {
    const url = chrome.runtime.getURL('rules/nhs-az-index.json');
    const res = await fetch(url);
    const data = await res.json();
    _index = Array.isArray(data.entries) ? data.entries : [];
    _indexError = _index.length === 0;
  } catch (_) {
    _index = [];
    _indexError = true;
  }
}

async function loadState() {
  const r = await chrome.storage.local.get(['leaflets.recent', 'leaflets.config']);
  _recent = Array.isArray(r['leaflets.recent']) ? r['leaflets.recent'] : [];
  _config = r['leaflets.config'] || {};
}

async function persistRecent() {
  _ignoreNextChange = true;
  await chrome.storage.local.set({ 'leaflets.recent': _recent });
}

// ── Rendering ────────────────────────────────────────────────────────────────

function render() {
  const body = container?.querySelector('#lfBody');
  if (!body) return;
  const parts = [];

  parts.push(renderSearchBox());

  if (_indexError) {
    parts.push(
      `<div class="lf-notice">Couldn't load the bundled leaflet index. You can still use the nhs.uk search below.</div>`
    );
  }

  parts.push(`<div id="lfResults">${renderResultsArea()}</div>`);

  body.innerHTML = parts.join('');

  // Tier-2 detail content is built from DOM APIs (never innerHTML) once the
  // string-templated shell above is in place — see renderDetailInto().
  if (_openKey) renderDetailInto(_openKey);
}

function renderSearchBox() {
  return `
    <div class="lf-toolbar">
      <input type="search" id="lfSearch" class="lf-search" placeholder="Search a condition or medicine…" value="${esc(_query)}" autofocus />
    </div>`;
}

function renderResultsArea() {
  const q = _query.trim();
  if (q) return renderResults(q);
  if (_recent.length > 0) return renderRecent();
  return renderEmptyState();
}

function renderEmptyState() {
  return `
    <div class="lf-empty">
      <div class="lf-empty-line">Search for a condition or medicine to find its NHS patient leaflet.</div>
      <div class="lf-empty-example">Try “eczema” or “paracetamol”.</div>
    </div>`;
}

function renderRecent() {
  const rows = _recent.map((r) => renderRow(r, { recent: true })).join('');
  return `
    <div class="lf-section-header">Recent</div>
    <div class="lf-list">${rows}</div>`;
}

function renderResults(query) {
  const matches = LU ? LU.searchIndex(_index, query, { limit: 8 }) : [];
  const rows = matches.map((e) => renderRow(e, { recent: false })).join('');
  const fallback = renderFallbackRow(query);
  if (matches.length === 0) {
    return `
      <div class="lf-empty lf-empty-noresults">No bundled match for “${esc(query)}”.</div>
      <div class="lf-list">${fallback}</div>`;
  }
  return `<div class="lf-list">${rows}${fallback}</div>`;
}

function renderFallbackRow(query) {
  const url = LU ? LU.buildSearchUrl(query) : '#';
  return `
    <div class="lf-row lf-row-fallback" data-act="search-nhs" data-url="${esc(url)}" tabindex="0" role="button">
      <div class="lf-row-main">
        <span class="lf-row-name">Search nhs.uk for “${esc(query)}”</span>
      </div>
      <span class="lf-row-fallback-hint">opens in a new tab</span>
    </div>`;
}

function renderRow(item, opts) {
  const kindLabel = item.kind === 'medicine' ? 'Medicine' : 'Condition';
  const url = LU ? LU.buildLeafletUrl(item) : '#';
  const key = `${item.kind}:${item.slug}`;
  const selectable = LU && LU.canFetchLeaflet(_config);
  const open = _openKey === key;
  const rowClasses = ['lf-row'];
  if (selectable) rowClasses.push('lf-row-selectable');
  if (open) rowClasses.push('lf-row-open');

  const detailHost = open
    ? `<div class="lf-detail" id="lfDetail-${esc(key)}"><span class="lf-detail-loading">Loading…</span></div>`
    : '';

  return `
    <div class="${rowClasses.join(' ')}" data-act="${selectable ? 'select' : ''}" data-slug="${esc(item.slug)}" data-kind="${esc(item.kind)}" data-name="${esc(item.name)}">
      <div class="lf-row-main">
        <span class="lf-row-name">${esc(item.name)}</span>
        <span class="lf-row-kind">${kindLabel}</span>
      </div>
      <div class="lf-row-actions">
        ${selectable ? `<span class="lf-row-hint">Click to read here</span>` : ''}
        <button class="lf-btn" data-act="open" data-slug="${esc(item.slug)}" data-kind="${esc(item.kind)}" data-name="${esc(item.name)}" data-url="${esc(url)}">Open</button>
        <button class="lf-btn" data-act="copy" data-url="${esc(url)}">Copy link</button>
      </div>
      ${detailHost}
    </div>`;
}

// Build the tier-2 leaflet content from real DOM nodes (createElement +
// textContent) — the remote API response never touches innerHTML. This is
// the only place in the module where non-local content is rendered.
function renderDetailInto(key) {
  const host = container?.querySelector(`#lfDetail-${CSS.escape(key)}`);
  if (!host) return;
  host.textContent = '';

  const cached = _renderCache.get(key);
  if (!cached || cached.status === 'loading') {
    const span = document.createElement('span');
    span.className = 'lf-detail-loading';
    span.textContent = 'Loading…';
    host.appendChild(span);
    return;
  }

  if (cached.status === 'error') {
    const notice = document.createElement('div');
    notice.className = 'lf-detail-error';
    notice.textContent = cached.message || "Couldn't load this leaflet here.";
    host.appendChild(notice);
    return;
  }

  const model = cached.model;
  if (!model) return;

  const title = document.createElement('h3');
  title.className = 'lf-detail-title';
  title.textContent = model.title;
  host.appendChild(title);

  if (model.lastReviewed) {
    const reviewed = document.createElement('div');
    reviewed.className = 'lf-detail-reviewed';
    reviewed.textContent = `Last reviewed: ${model.lastReviewed}`;
    host.appendChild(reviewed);
  }

  for (const section of model.sections) {
    if (section.heading) {
      const h = document.createElement('h4');
      h.className = 'lf-detail-heading';
      h.textContent = section.heading;
      host.appendChild(h);
    }
    for (const para of section.paragraphs) {
      const p = document.createElement('p');
      p.className = 'lf-detail-para';
      p.textContent = para;
      host.appendChild(p);
    }
  }

  const attribution = document.createElement('div');
  attribution.className = 'lf-attribution';
  attribution.append('From the ');
  const link = document.createElement('a');
  link.href = model.sourceUrl || '#';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'NHS website';
  attribution.appendChild(link);
  host.appendChild(attribution);
}

// ── Events ───────────────────────────────────────────────────────────────────

function onInput(ev) {
  if (ev.target.id !== 'lfSearch') return;
  _query = ev.target.value;
  _openKey = null; // any expanded detail belonged to the pre-edit result list
  // Replace only the results area (a sibling of the search box), so the
  // input element itself — and the user's focus/cursor in it — is untouched.
  // Same pattern as side-panel/modules/knowledge/knowledge.js onInput.
  const resultsHost = container.querySelector('#lfResults');
  if (resultsHost) resultsHost.innerHTML = renderResultsArea();
}

function onClick(ev) {
  const actEl = ev.target.closest('[data-act]');
  if (!actEl || !container.contains(actEl)) return;
  const act = actEl.dataset.act;
  if (!act) return;

  switch (act) {
    case 'open':
      ev.stopPropagation();
      openLeaflet({ slug: actEl.dataset.slug, kind: actEl.dataset.kind, name: actEl.dataset.name }, actEl.dataset.url);
      break;
    case 'copy':
      ev.stopPropagation();
      copyText(actEl.dataset.url, actEl);
      break;
    case 'search-nhs':
      chrome.tabs.create({ url: actEl.dataset.url });
      break;
    case 'select':
      // actEl IS the row here (buttons inside it carry their own data-act and
      // are matched first by closest(), so this only fires for clicks on the
      // row's own surface — name, kind badge, hint text, empty space).
      selectEntry({ slug: actEl.dataset.slug, kind: actEl.dataset.kind, name: actEl.dataset.name });
      break;
  }
}

async function openLeaflet(item, url) {
  chrome.tabs.create({ url });
  await rememberOpen(item);
}

async function selectEntry(entry) {
  const key = cacheKey(entry);
  if (_openKey === key) {
    _openKey = null; // toggle closed
    render();
    return;
  }
  _openKey = key;
  await rememberOpen(entry);
  render(); // shows loading state via the placeholder host

  const cached = _renderCache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS && cached.status !== 'loading') {
    renderDetailInto(key);
    return;
  }

  _renderCache.set(key, { status: 'loading', ts: Date.now() });
  try {
    const url = LU.buildApiUrl(entry);
    const res = await fetch(url, { headers: { 'subscription-key': _config.apiKey } });
    if (!res.ok) {
      _renderCache.set(key, { status: 'error', ts: Date.now(), message: fetchErrorMessage(res.status) });
    } else {
      const json = await res.json();
      const model = LU.mapApiResponseToRenderModel(json, entry);
      if (!model) {
        _renderCache.set(key, {
          status: 'error',
          ts: Date.now(),
          message: "Couldn't read this leaflet — try Open instead.",
        });
      } else {
        _renderCache.set(key, { status: 'ok', ts: Date.now(), model });
      }
    }
  } catch (_) {
    _renderCache.set(key, {
      status: 'error',
      ts: Date.now(),
      message: 'Network problem reaching the NHS leaflet service — try Open instead.',
    });
  }
  if (_openKey === key) renderDetailInto(key);
}

function fetchErrorMessage(status) {
  if (status === 401 || status === 403) return 'API key was not accepted — check it in Options → Leaflets.';
  if (status === 429) return 'Too many requests right now — try again shortly, or use Open.';
  return "Couldn't load this leaflet here right now — try Open instead.";
}

async function rememberOpen(item) {
  if (!LU || !item || !item.slug) return;
  _recent = LU.addRecent(_recent, item);
  await persistRecent();
  await recordLedgerOpen(item);
}

// Best-effort ledger recording. shared/event-ledger.js is a classic (non-ESM)
// script loaded via <script> tag in panel.html/pop-out.html and consumed as
// window.EventLedger — same convention as record.js/sentinel.js/sweep.js.
// SOURCES/ACTIONS include 'leaflets'/'opened' (see event-ledger.js). Guarded
// so a missing global or a storage failure never throws into the caller.
async function recordLedgerOpen(item) {
  try {
    const EL = typeof window !== 'undefined' ? window.EventLedger : null;
    if (EL && typeof EL.record === 'function' && LU) {
      const evt = LU.leafletOpenLedgerEvent(item);
      if (evt) await EL.record(evt, { dedupe: true });
    }
  } catch (_) {
    // shared/event-ledger.js absent, or storage unavailable — fine, best-effort only.
  }
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
