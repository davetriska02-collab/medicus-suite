// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Medicus Suite — Quick Leaflet popover (panel shell, panel-only)
//
// Leaflet search reachable from ANY tab: mid-triage the user is on Slots, the
// queue or Sentinel and wants to fling an NHS leaflet at a patient without
// losing the module they're working in. This popover is the Leaflets module's
// TIER 1 ONLY — fuzzy search over the bundled rules/nhs-az-index.json with
// Open-on-nhs.uk and Copy-link, all via shared/leaflets-utils.js
// (window.LeafletsUtils, already loaded by panel.html). No API key use, no
// in-panel rendering: the full Leaflets tab remains the reading surface, and
// the footer hands the current query off to it via the existing
// 'leaflets.pendingQuery' key (same handoff Reception uses).
//
// Panel-only by the same convention as the global strips — the pop-out window
// reaches the full Leaflets tab in one click from its own nav.
//
// Storage touched: reads/writes 'leaflets.recent' (owned by the Leaflets
// module, same shape via LeafletsUtils.addRecent — the module live-reloads it
// through its own storage listener); writes 'leaflets.pendingQuery' on tab
// handoff. No new keys.

'use strict';

let _open = false;
let _query = '';
let _rows = []; // [{ entry, recent }] currently displayed
let _active = 0; // keyboard-highlighted row index (rows.length = nhs.uk fallback row)
let _index = null; // nhs-az-index entries, lazy-loaded on first open
let _recent = [];
let _switchModule = null;
let _closeHandler = null;

const MAX_RESULTS = 7;
const MAX_RECENT_SHOWN = 5;

function LU() {
  return typeof window !== 'undefined' ? window.LeafletsUtils : null;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function host() {
  return document.getElementById('quickLeafletHost');
}

export function initQuickLeaflet({ switchModule } = {}) {
  _switchModule = switchModule || null;
  const btn = document.getElementById('quickLeafletBtn');
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_open) close();
    else openPopover();
  });
}

// Exposed for the command palette ("NHS leaflet quick search…").
export function openQuickLeaflet() {
  if (!_open) openPopover();
  else host()?.querySelector('input')?.focus();
}

async function ensureIndex() {
  if (_index) return;
  try {
    const res = await fetch(chrome.runtime.getURL('rules/nhs-az-index.json'));
    const data = await res.json();
    _index = Array.isArray(data.entries) ? data.entries : [];
  } catch (_) {
    _index = [];
  }
}

async function openPopover() {
  _open = true;
  _query = '';
  _active = 0;
  await ensureIndex();
  try {
    const r = await chrome.storage.local.get('leaflets.recent');
    _recent = Array.isArray(r['leaflets.recent']) ? r['leaflets.recent'] : [];
  } catch (_) {
    _recent = [];
  }
  compute();
  render();
  host()?.querySelector('input')?.focus();
}

function close() {
  _open = false;
  if (_closeHandler) {
    document.removeEventListener('click', _closeHandler);
    _closeHandler = null;
  }
  render();
}

function compute() {
  const lu = LU();
  if (_query.trim() && lu) {
    _rows = lu.searchIndex(_index, _query, { limit: MAX_RESULTS }).map((entry) => ({ entry, recent: false }));
  } else {
    _rows = _recent.slice(0, MAX_RECENT_SHOWN).map((entry) => ({ entry, recent: true }));
  }
  if (_active > _rows.length) _active = _rows.length;
  if (!_query.trim() && _active >= _rows.length) _active = Math.max(0, _rows.length - 1);
}

// The results list (rows + nhs.uk fallback + empty hint) as HTML.
function listHtml() {
  const kindBadge = (kind) =>
    `<span class="ql-kind ql-kind--${kind === 'medicine' ? 'med' : 'cond'}">${kind === 'medicine' ? 'medicine' : 'condition'}</span>`;
  let html = _rows
    .map(
      ({ entry, recent }, i) => `
      <div class="ql-row${i === _active ? ' ql-row--active' : ''}" data-i="${i}" role="option" aria-selected="${i === _active}">
        <span class="ql-name" title="${esc(entry.name)}">${esc(entry.name)}</span>
        ${recent ? '<span class="ql-recent">recent</span>' : ''}
        ${kindBadge(entry.kind)}
        <button class="ql-copy" data-copy="${i}" title="Copy nhs.uk link" aria-label="Copy link for ${esc(entry.name)}">⧉</button>
      </div>`
    )
    .join('');

  const q = _query.trim();
  if (q) {
    // Guaranteed fallback row — covers any index miss.
    html += `
      <div class="ql-row ql-row--fallback${_active === _rows.length ? ' ql-row--active' : ''}" data-nhs-search="1" role="option" aria-selected="${_active === _rows.length}">
        <span class="ql-name">Search nhs.uk for “${esc(q)}”</span><span class="ql-kind">nhs.uk</span>
      </div>`;
  } else if (_rows.length === 0) {
    html += '<div class="ql-hint">Type a condition or medicine — Enter opens it on nhs.uk in a new tab.</div>';
  }
  return html;
}

function render() {
  const h = host();
  if (!h) return;
  if (!_open) {
    h.innerHTML = '';
    return;
  }

  h.innerHTML = `
    <div class="ql-popover" role="dialog" aria-label="Quick leaflet search">
      <input type="text" class="ql-input" placeholder="Leaflet: condition or medicine…"
             value="${esc(_query)}" aria-label="Search NHS leaflets" spellcheck="false" autocomplete="off" />
      <div class="ql-list" role="listbox" aria-label="Leaflet matches">${listHtml()}</div>
      <div class="ql-foot">
        <button class="ql-open-tab">Open Leaflets tab →</button>
      </div>
    </div>`;

  bindPopover(h);
  bindList(h);
}

// Re-render only the results list so the input keeps focus + caret.
function renderList() {
  const h = host();
  const list = h?.querySelector('.ql-list');
  if (!list) return;
  list.innerHTML = listHtml();
  bindList(h);
}

function bindPopover(h) {
  const input = h.querySelector('.ql-input');
  input?.addEventListener('input', () => {
    _query = input.value;
    _active = 0;
    compute();
    renderList();
  });
  input?.addEventListener('keydown', (e) => {
    // With a query, the nhs.uk fallback row sits at index _rows.length.
    const lastIndex = _query.trim() ? _rows.length : Math.max(0, _rows.length - 1);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _active = Math.min(_active + 1, lastIndex);
      renderList();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _active = Math.max(_active - 1, 0);
      renderList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(_active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  h.querySelector('.ql-open-tab')?.addEventListener('click', async () => {
    const q = _query.trim();
    try {
      if (q) await chrome.storage.local.set({ 'leaflets.pendingQuery': q });
    } catch (_) {
      // handoff is best-effort; the tab still opens
    }
    close();
    if (_switchModule) _switchModule('leaflets');
  });

  // Click-outside close — remove any previous listener first so re-renders
  // don't stack duplicates (same pattern as the display popover). Registration
  // is deferred a tick so the click that OPENED the popover (e.g. via a
  // command-palette row, which doesn't stopPropagation for us) can finish
  // propagating without instantly closing it.
  if (_closeHandler) document.removeEventListener('click', _closeHandler);
  const handler = (e) => {
    if (!e.target.closest('#quickLeafletHost') && !e.target.closest('#quickLeafletBtn')) close();
  };
  _closeHandler = handler;
  setTimeout(() => {
    if (_closeHandler === handler && _open) document.addEventListener('click', handler);
  }, 0);
}

function bindList(h) {
  h.querySelectorAll('.ql-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.ql-copy')) return;
      if (row.dataset.nhsSearch) activate(_rows.length);
      else activate(parseInt(row.dataset.i, 10));
    });
  });
  h.querySelectorAll('.ql-copy').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const lu = LU();
      const row = _rows[parseInt(btn.dataset.copy, 10)];
      if (!lu || !row) return;
      try {
        await navigator.clipboard.writeText(lu.buildLeafletUrl(row.entry));
        btn.textContent = '✓';
        setTimeout(() => {
          btn.textContent = '⧉';
        }, 1200);
      } catch (_) {
        btn.textContent = '✗';
      }
    });
  });
}

async function activate(i) {
  const lu = LU();
  if (!lu) return;
  if (i >= _rows.length) {
    // nhs.uk fallback row
    const q = _query.trim();
    if (!q) return;
    chrome.tabs.create({ url: lu.buildSearchUrl(q) });
    close();
    return;
  }
  const row = _rows[i];
  if (!row) return;
  chrome.tabs.create({ url: lu.buildLeafletUrl(row.entry) });
  // Record in the shared recents list (the Leaflets tab live-reloads this key).
  try {
    const r = await chrome.storage.local.get('leaflets.recent');
    const list = Array.isArray(r['leaflets.recent']) ? r['leaflets.recent'] : [];
    await chrome.storage.local.set({ 'leaflets.recent': lu.addRecent(list, row.entry) });
  } catch (_) {
    // recents are a convenience — never block the open
  }
  close();
}
