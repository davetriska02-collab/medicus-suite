// Medicus Suite — Triage Lens side panel module
// Uses chrome.scripting.executeScript to extract tile and chip data
// from the Triage Lens HUD already rendered on the active Medicus tab.

'use strict';

let container = null;
let pollTimer = null;
let hudHiddenOnTabId = null;  // track which tab we suppressed the HUD on

// ── Init / cleanup ────────────────────────────────────────────────────────────

export async function init(el) {
  container = el;
  render({ state: 'loading' });

  // Suppress the in-page HUD — we're showing the data here instead
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (activeTab?.id && activeTab?.url && /medicus\.health/.test(activeTab.url)) {
    await suppressHud(activeTab.id);
    hudHiddenOnTabId = activeTab.id;
  }

  await refresh();
  pollTimer = setInterval(refresh, 2000);
  chrome.tabs.onActivated.addListener(onTabChange);
  chrome.tabs.onUpdated.addListener(onTabUpdated);

  return async () => {
    clearInterval(pollTimer);
    chrome.tabs.onActivated.removeListener(onTabChange);
    chrome.tabs.onUpdated.removeListener(onTabUpdated);
    // Restore the HUD when leaving the Alerts panel
    if (hudHiddenOnTabId) {
      await restoreHud(hudHiddenOnTabId).catch(() => {});
      hudHiddenOnTabId = null;
    }
    container = null;
  };
}

async function suppressHud(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const hud = document.querySelector('#medicus-clinical-hud');
      if (hud) { hud.dataset.suiteSuppressed = '1'; hud.style.display = 'none'; }
    },
  }).catch(() => {});
}

async function restoreHud(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const hud = document.querySelector('#medicus-clinical-hud');
      if (hud && hud.dataset.suiteSuppressed) { hud.style.display = ''; delete hud.dataset.suiteSuppressed; }
    },
  }).catch(() => {});
}

async function onTabChange(info) {
  // If we hid a HUD on a different tab, restore it
  if (hudHiddenOnTabId && info.tabId !== hudHiddenOnTabId) {
    await restoreHud(hudHiddenOnTabId).catch(() => {});
    hudHiddenOnTabId = null;
  }
  refresh();
}
function onTabUpdated(tabId, info) { if (info.status === 'complete') refresh(); }

// ── Data extraction ───────────────────────────────────────────────────────────

async function refresh() {
  if (!container) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab?.url || !/medicus\.health/.test(tab.url)) {
    render({ state: 'no-medicus' });
    return;
  }

  if (!/care-record|encounter|patient/.test(tab.url)) {
    render({ state: 'no-patient' });
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractHudData,
    });
    const data = results?.[0]?.result;
    if (!data || !data.hudFound) {
      render({ state: 'no-hud', url: tab.url });
    } else {
      render({ state: 'data', data });
    }
  } catch (err) {
    render({ state: 'error', message: err.message });
  }
}

// Injected into the page — must be self-contained, no closures over module scope
function extractHudData() {
  const hud = document.querySelector('#medicus-clinical-hud');
  if (!hud) return { hudFound: false };

  const patientEl = hud.querySelector('.ch-patient');
  const patient = patientEl ? patientEl.textContent.trim() : '';

  // Flat keyword chips
  const chips = [];
  hud.querySelectorAll('.ch-chips .ch-chip').forEach(el => {
    let severity = 'info';
    if (el.classList.contains('ch-chip-red'))   severity = 'red';
    else if (el.classList.contains('ch-chip-amber')) severity = 'amber';
    else if (el.classList.contains('ch-chip-green')) severity = 'green';
    const text = el.textContent.trim();
    if (text) chips.push({ text, severity });
  });

  // Signal tiles — click each to trigger Triage Lens detail rendering, then read
  const tiles = [];
  const tileEls = Array.from(hud.querySelectorAll('.ch-tile'));

  for (const el of tileEls) {
    const label    = el.querySelector('.ch-tile-label')?.textContent.trim() || '';
    const status   = el.querySelector('.ch-tile-status')?.textContent.trim() || '—';
    const countText= el.querySelector('.ch-tile-count')?.textContent.trim() || '';
    let level = 'green';
    if (el.classList.contains('ch-red'))   level = 'red';
    else if (el.classList.contains('ch-amber')) level = 'amber';

    // Click the tile so Triage Lens populates the shared .ch-detail panel
    el.click();

    const items = [];
    // Try both: per-tile detail (data-tile) and shared detail panel
    const detailKey = el.dataset.tile;
    const detail = hud.querySelector(`.ch-detail[data-tile="${detailKey}"]`)
                || hud.querySelector('.ch-detail');
    if (detail) {
      detail.querySelectorAll('.ch-detail-row').forEach(row => {
        const text = row.querySelector('.ch-detail-text')?.textContent.trim() || '';
        if (!text || text === 'No flags') return;
        let sev = 'info';
        if (row.classList.contains('ch-red'))   sev = 'red';
        else if (row.classList.contains('ch-amber')) sev = 'amber';
        else if (row.classList.contains('ch-green')) sev = 'green';
        items.push({ text, severity: sev });
      });
    }

    // Deselect so next click starts fresh
    if (el.classList.contains('ch-tile-sel')) el.click();

    if (label) tiles.push({ label, status, countText, level, items });
  }

  // Request chips
  const requestChips = [];
  hud.querySelectorAll('.ch-request .ch-chip').forEach(el => {
    let severity = 'info';
    if (el.classList.contains('ch-chip-red'))   severity = 'red';
    else if (el.classList.contains('ch-chip-amber')) severity = 'amber';
    else if (el.classList.contains('ch-chip-green')) severity = 'green';
    const text = el.textContent.trim();
    if (text) requestChips.push({ text, severity });
  });

  const requestSnippet = hud.querySelector('.ch-request-snippet')?.textContent.trim() || '';
  const requestTitle   = hud.querySelector('.ch-patient')?.textContent.trim() || patient;

  return { hudFound: true, patient, chips, tiles, requestChips, requestSnippet, requestTitle };
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(payload) {
  if (!container) return;

  const { state, data, message } = payload;

  if (state === 'loading') {
    container.innerHTML = `<div class="module-wrap triage-module"><div class="mod-header"><div><div class="mod-eyebrow">Clinical Alerts</div><div class="mod-title">Checking tab…</div></div></div><div class="triage-skeleton">${Array(4).fill('<div class="triage-skel-tile"></div>').join('')}</div></div>`;
    return;
  }

  if (state === 'no-medicus') {
    container.innerHTML = statusScreen('Clinical Alerts', 'idle', 'No Medicus tab active', 'Open Medicus in a tab to use Triage Lens.');
    return;
  }

  if (state === 'no-patient') {
    container.innerHTML = statusScreen('Clinical Alerts', 'idle', 'Navigate to a patient record', 'Triage Lens activates on patient record, encounter, and triage queue pages.');
    return;
  }

  if (state === 'no-hud') {
    container.innerHTML = statusScreen('Clinical Alerts', 'idle', 'HUD not yet rendered', 'Triage Lens is loading — this panel will update automatically in a moment.');
    return;
  }

  if (state === 'error') {
    container.innerHTML = statusScreen('Clinical Alerts', 'error', 'Could not read HUD', message || 'Check that the Medicus Suite extension has permission for this tab.');
    return;
  }

  // Render data
  const { chips, tiles, requestChips, requestSnippet, requestTitle, patient } = data;
  const displayTitle = requestTitle || patient || 'Current patient';
  const hasAlerts = chips.length > 0 || tiles.some(t => t.level !== 'green') || requestChips.length > 0;

  const urgentCount = [...chips, ...requestChips].filter(c => c.severity === 'red').length +
                      tiles.filter(t => t.level === 'red').length;
  const warnCount   = [...chips, ...requestChips].filter(c => c.severity === 'amber').length +
                      tiles.filter(t => t.level === 'amber').length;

  container.innerHTML = `
    <div class="module-wrap triage-module">
      <div class="alerts-page-header">
        <div class="alerts-title-row">
          <div class="mod-eyebrow">Clinical Alerts</div>
          <button class="icon-btn" id="triageRefresh" title="Refresh">↻</button>
        </div>
        <div class="mod-title alerts-patient-name">${escHtml(displayTitle)}</div>
        <div class="alerts-badges">
          ${urgentCount > 0 ? `<span class="count-badge red">${urgentCount} urgent</span>` : ''}
          ${warnCount   > 0 ? `<span class="count-badge amber">${warnCount} warning</span>` : ''}
          ${urgentCount === 0 && warnCount === 0 ? '<span class="count-badge green">Clear</span>' : ''}
        </div>
      </div>

      ${requestSnippet ? `
        <div class="alerts-request-card">
          <div class="alerts-request-label">Request content</div>
          <div class="alerts-request-text">${escHtml(requestSnippet)}</div>
        </div>` : ''}

      ${tiles.length > 0 ? `
        <section class="triage-section">
          <div class="section-label">Signal tiles <span class="tap-hint">— tap to expand</span></div>
          <div class="triage-tile-grid">
            ${tiles.map(renderTile).join('')}
          </div>
        </section>` : ''}

      ${chips.length > 0 ? `
        <section class="triage-section">
          <div class="section-label">Keyword matches</div>
          <div class="triage-chips">
            ${chips.map(c => `<span class="triage-chip triage-chip-${c.severity}">${escHtml(c.text)}</span>`).join('')}
          </div>
        </section>` : ''}

      ${requestChips.length > 0 ? `
        <section class="triage-section">
          <div class="section-label">Request flags</div>
          <div class="triage-chips">
            ${requestChips.map(c => `<span class="triage-chip triage-chip-${c.severity}">${escHtml(c.text)}</span>`).join('')}
          </div>
        </section>` : ''}

      ${!hasAlerts ? `<div class="triage-empty">No active alerts for this patient on this view.</div>` : ''}

      <div class="triage-footer">
        <button class="ghost-btn" id="triageSettings">Alerts settings →</button>
      </div>
    </div>
  `;

  container.querySelector('#triageRefresh')?.addEventListener('click', refresh);
  container.querySelector('#triageSettings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());

  container.querySelectorAll('.triage-tile').forEach(tile => {
    tile.addEventListener('click', () => tile.classList.toggle('expanded'));
  });
}

function renderTile(t) {
  const hasItems = t.items && t.items.length > 0;
  return `
    <div class="triage-tile triage-tile-${t.level}${hasItems ? ' has-items' : ''}">
      <div class="triage-tile-label">${escHtml(t.label)}</div>
      <div class="triage-tile-status">${escHtml(t.status)}</div>
      ${t.countText ? `<div class="triage-tile-count">${escHtml(t.countText)}</div>` : ''}
      ${hasItems ? `<div class="triage-tile-detail">${t.items.map(i =>
        `<div class="triage-detail-row triage-detail-${i.severity}">${escHtml(i.text)}</div>`
      ).join('')}</div>` : ''}
    </div>
  `;
}

function statusScreen(title, level, heading, body) {
  const dot = level === 'idle' ? 'var(--text-5)' : level === 'error' ? 'var(--red)' : 'var(--green)';
  return `
    <div class="module-wrap triage-module">
      <div class="mod-header">
        <div>
          <div class="mod-eyebrow">Clinical Alerts</div>
          <div class="mod-title">${title}</div>
        </div>
      </div>
      <div class="sentinel-status ${level}" style="margin-top:14px">
        <div class="status-dot" style="background:${dot}"></div>
        <span class="status-text">${heading}</span>
      </div>
      <p style="font-size:12px;color:var(--text-4);margin-top:10px;line-height:1.55">${body}</p>
    </div>
  `;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
