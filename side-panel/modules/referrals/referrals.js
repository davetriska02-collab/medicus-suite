// Medicus Suite — Referrals Tracker (v0.1 · Discovery phase)
//
// Phase 1: reads the API endpoint and response captured by the
// referrals-discovery content script, displays it so we can confirm
// the shape before building the full visualisation.

'use strict';

const STORAGE_KEY = 'referrals.discovery';

let container = null;
let state = {
  discovery: null,
};

export async function init(el) {
  container = el;

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  state.discovery = stored[STORAGE_KEY] || null;
  render();

  const onStorageChange = changes => {
    if (changes[STORAGE_KEY]) {
      state.discovery = changes[STORAGE_KEY].newValue || null;
      render();
    }
  };
  chrome.storage.onChanged.addListener(onStorageChange);

  return () => {
    chrome.storage.onChanged.removeListener(onStorageChange);
    container = null;
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  if (!container) return;
  container.innerHTML = `
    <div class="ref-module module-wrap">
      <div class="module-header">
        <div class="module-title-row">
          <h2 class="module-title">Referrals</h2>
          <span class="module-ver">v0.1</span>
        </div>
        <div class="module-subtitle">Referral audit data from Medicus</div>
      </div>
      ${state.discovery ? renderFound() : renderPrompt()}
    </div>
  `;
  bindEvents();
}

function renderPrompt() {
  return `
    <div class="ref-prompt">
      <svg class="ref-prompt-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <p class="ref-prompt-head">Waiting for referrals page</p>
      <p class="ref-prompt-body">
        Navigate to <strong>Referrals → Clinical Audit Report</strong> in any
        Medicus tab. This panel will pick up the data automatically.
      </p>
      <div class="ref-prompt-path">
        referrals / clinical-audit-report
      </div>
    </div>
  `;
}

function renderFound() {
  const { url, discoveredAt, sample } = state.discovery;
  const json = JSON.stringify(sample, null, 2);
  const preview = json.length > 3000 ? json.slice(0, 3000) + '\n\n… (truncated — use Copy button for full data)' : json;
  const keys = topLevelKeys(sample);
  const ts = new Date(discoveredAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });

  return `
    <div class="ref-found">
      <div class="ref-found-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
        API endpoint discovered
      </div>

      <div class="ref-section-label">Endpoint URL</div>
      <div class="ref-url-box">${escHtml(url)}</div>

      <div class="ref-section-label" style="margin-top:14px">Top-level response keys</div>
      <div class="ref-keys">
        ${keys.map(k => `<span class="ref-key-pill">${escHtml(k)}</span>`).join('')}
      </div>

      <div class="ref-section-label" style="margin-top:14px">Raw JSON response</div>
      <pre class="ref-json">${escHtml(preview)}</pre>

      <div class="ref-found-foot">
        <span class="ref-ts">Captured ${ts}</span>
        <div class="ref-actions">
          <button class="ref-btn ref-btn-secondary" id="refClear">Clear</button>
          <button class="ref-btn ref-btn-primary" id="refCopy">Copy JSON</button>
        </div>
      </div>
    </div>
  `;
}

function bindEvents() {
  container.querySelector('#refCopy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(state.discovery?.sample, null, 2));
      const btn = container.querySelector('#refCopy');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy JSON'; }, 2000); }
    } catch (_) {}
  });

  container.querySelector('#refClear')?.addEventListener('click', async () => {
    await chrome.storage.local.remove(STORAGE_KEY);
    state.discovery = null;
    render();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function topLevelKeys(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).map(k => {
    const v = obj[k];
    const type = Array.isArray(v) ? `array[${v.length}]` : typeof v;
    return `${k}: ${type}`;
  });
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
