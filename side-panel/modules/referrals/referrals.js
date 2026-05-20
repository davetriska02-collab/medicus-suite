// Medicus Suite — Referrals Tracker (v0.2 · Discovery phase)
//
// Reads what the referrals-discovery content script captured from the live
// referrals/clinical-audit-report page and displays it for schema inspection.

'use strict';

const DISCOVERY_KEY = 'referrals.discovery';
const CONFIG_KEY    = 'referrals.config';

let container = null;
let state = {
  discovery: null,
  config:    null,
};

export async function init(el) {
  container = el;

  const stored = await chrome.storage.local.get([DISCOVERY_KEY, CONFIG_KEY]);
  state.discovery = stored[DISCOVERY_KEY] || null;
  state.config    = stored[CONFIG_KEY]    || null;
  render();

  const onStorageChange = changes => {
    if (changes[DISCOVERY_KEY]) { state.discovery = changes[DISCOVERY_KEY].newValue || null; render(); }
    if (changes[CONFIG_KEY])    { state.config    = changes[CONFIG_KEY].newValue    || null; render(); }
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
          <span class="module-ver">v0.2</span>
        </div>
        <div class="module-subtitle">Referral audit data from Medicus</div>
      </div>
      ${renderBody()}
    </div>
  `;
  bindEvents();
}

function renderBody() {
  if (state.discovery) return renderDataFound();
  if (state.config)    return renderConfigFound();
  return renderPrompt();
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
      <div class="ref-prompt-path">referrals / clinical-audit-report</div>
    </div>
  `;
}

function renderConfigFound() {
  const cfg = state.config?.data || {};
  const priorities = (cfg.priorityOptions || []).map(o => o.label).join(', ');
  const statuses   = (cfg.statusOptions   || []).map(o => o.label).join(', ');
  return `
    <div class="ref-status-panel">
      <div class="ref-status-row">
        <div class="ref-status-dot ref-dot-amber"></div>
        <span class="ref-status-text">Filters discovered — probing data endpoint…</span>
      </div>
      <div class="ref-config-grid">
        <div class="ref-config-row">
          <span class="ref-config-key">Date range</span>
          <span class="ref-config-val">${escHtml(cfg.defaultReferralStartDate)} → ${escHtml(cfg.defaultReferralEndDate)}</span>
        </div>
        <div class="ref-config-row">
          <span class="ref-config-key">Priorities</span>
          <span class="ref-config-val">${escHtml(priorities)}</span>
        </div>
        <div class="ref-config-row">
          <span class="ref-config-key">Statuses</span>
          <span class="ref-config-val">${escHtml(statuses)}</span>
        </div>
      </div>
      <p class="ref-status-hint">
        The discovery script is trying several data endpoint patterns in the
        background. If nothing appears in ~10 s, click <strong>Generate Report</strong>
        on the referrals page to trigger the data call manually.
      </p>
      <button class="ref-btn ref-btn-secondary" id="refClearAll" style="margin-top:8px">Reset</button>
    </div>
  `;
}

function renderDataFound() {
  const { url, discoveredAt, sample } = state.discovery;
  const json    = JSON.stringify(sample, null, 2);
  const preview = json.length > 4000 ? json.slice(0, 4000) + '\n\n… (truncated — Copy for full data)' : json;
  const keys    = topLevelKeys(sample);
  const ts      = new Date(discoveredAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });

  return `
    <div class="ref-found">
      <div class="ref-found-badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
        Data endpoint captured
      </div>

      <div class="ref-section-label">Endpoint</div>
      <div class="ref-url-box">${escHtml(url)}</div>

      <div class="ref-section-label" style="margin-top:12px">Response structure</div>
      <div class="ref-keys">
        ${keys.map(k => `<span class="ref-key-pill">${escHtml(k)}</span>`).join('')}
      </div>

      <div class="ref-section-label" style="margin-top:12px">Raw JSON</div>
      <pre class="ref-json">${escHtml(preview)}</pre>

      <div class="ref-found-foot">
        <span class="ref-ts">Captured ${ts}</span>
        <div class="ref-actions">
          <button class="ref-btn ref-btn-secondary" id="refClearAll">Reset</button>
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
  container.querySelector('#refClearAll')?.addEventListener('click', async () => {
    await chrome.storage.local.remove([DISCOVERY_KEY, CONFIG_KEY]);
    state.discovery = null;
    state.config    = null;
    render();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function topLevelKeys(obj) {
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    if (obj.length === 0) return ['(empty array)'];
    return topLevelKeys(obj[0]).map(k => `[0].${k}`);
  }
  return Object.keys(obj).map(k => {
    const v = obj[k];
    const type = Array.isArray(v) ? `array[${v.length}]` : typeof v;
    return `${k}: ${type}`;
  });
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
