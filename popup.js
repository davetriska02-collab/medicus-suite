// Medicus Suite — Waiting Room Popup
// Fetches arrived patients, renders the list, updates the toolbar badge.

'use strict';

const POLL_MS = 30 * 1000;

let SITE_ID = null;
let API_URL = null;

const body      = document.getElementById('wrBody');
const ts        = document.getElementById('wrTs');
const refreshBtn = document.getElementById('refreshBtn');
const openSuiteBtn = document.getElementById('openSuiteBtn');
const visualiserBtn = document.getElementById('visualiserBtn');

let pollTimer   = null;
let lastFetchAt = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

// Opening the popup is itself a user gesture, so we can open the side panel
// straight away — the user just wants the suite, not a chooser. We try the
// current window first (synchronous-ish), and fall back to the waiting-room
// view + "Open Suite" button if the programmatic open isn't permitted.
autoOpenSidePanel();

refresh();
pollTimer = setInterval(refresh, POLL_MS);

async function autoOpenSidePanel() {
  try {
    const win = await chrome.windows.getCurrent();
    if (win && win.id != null) {
      await chrome.sidePanel.open({ windowId: win.id });
      window.close();
    }
  } catch (e) {
    // Programmatic open not allowed here — leave the popup open so the user can
    // use the "Open Suite" button (which runs inside a fresh click gesture).
    console.warn('[Suite] auto-open side panel failed:', e && e.message);
  }
}

// Stop polling when popup closes
window.addEventListener('unload', () => clearInterval(pollTimer));

// ── Buttons ───────────────────────────────────────────────────────────────────

refreshBtn.addEventListener('click', () => {
  refreshBtn.classList.add('spinning');
  refresh().finally(() => {
    setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
  });
});

visualiserBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('visualiser-core.html') });
  window.close();
});

openSuiteBtn.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  if (tabId) {
    await chrome.sidePanel.open({ tabId });
  } else {
    chrome.runtime.openOptionsPage();
  }
  window.close();
});

// ── Pusher-triggered refresh from service worker ──────────────────────────────

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'waiting:refresh') {
    refresh();
  }
});

// ── Fetch & render ────────────────────────────────────────────────────────────

async function refresh() {
  // Resolve practice code on every call so user changes take effect immediately
  const { code, source } = await window.PracticeCode.resolve();
  SITE_ID = code;
  if (!SITE_ID) {
    renderNoPracticeCode();
    return;
  }
  API_URL = `https://${SITE_ID}.api.england.medicus.health/scheduling/data/homepage/my-appointments`;
  try {
    const patients = await fetchArrived(source);
    render(patients);
    updateBadge(patients.length);
    lastFetchAt = new Date();
    ts.textContent = `Updated ${lastFetchAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  } catch (err) {
    renderError(err.message);
    ts.textContent = 'Could not fetch';
  }
}

function renderNoPracticeCode() {
  body.innerHTML = `
    <div style="padding: 16px; font-size: 12px; color: #93a8c5; line-height: 1.5;">
      <div style="margin-bottom: 8px; color: #fbbf24; font-weight: 600;">No practice code</div>
      Open a Medicus tab (the code will be auto-detected) or set it manually in Medicus Suite Options.
    </div>`;
  if (ts) ts.textContent = '';
  updateBadge(0);
}

async function fetchArrived(codeSource) {
  const r = await window.ApiDiag.fetch({
    module: 'popup',
    url: API_URL,
    code: SITE_ID,
    codeSource,
  });
  const raw = await r.json();

  const entries = (raw?.schedule?.schedule ?? [])
    .flatMap(diary => diary.entries ?? [])
    .filter(e => e?.displayStatus?.isArrived === true);

  return entries.map(e => ({
    name:          e.patient?.name ?? 'Unknown',
    start:         e.start ?? '',
    startDateTime: e.startDateTime ?? null,
    reason:        (e.compiledReasonForAppointment ?? '').replace(/^GP Appointment\s*/i, '').trim(),
    deliveryMode:  e.deliveryMode?.value ?? '',
    minutesWaiting: calcWait(e.startDateTime),
  })).sort((a, b) => a.start < b.start ? -1 : 1);
}

function calcWait(startDateTime) {
  if (!startDateTime) return null;
  const ms = new Date(startDateTime).getTime();
  if (isNaN(ms)) return null;
  const mins = Math.round((Date.now() - ms) / 60000);
  return mins > 0 ? mins : 0;
}

function render(patients) {
  if (patients.length === 0) {
    body.innerHTML = `
      <div class="wr-hero">
        <div class="wr-hero-count none">✓</div>
        <div class="wr-hero-label"><strong>No one waiting</strong><br>Waiting room is clear</div>
      </div>`;
    return;
  }

  const heroHtml = `
    <div class="wr-hero">
      <div class="wr-hero-count">${patients.length}</div>
      <div class="wr-hero-label">
        <strong>${patients.length === 1 ? '1 patient' : `${patients.length} patients`} waiting</strong><br>
        Oldest: ${waitLabel(Math.max(...patients.map(p => p.minutesWaiting ?? 0)))}
      </div>
    </div>`;

  const listHtml = patients.map(p => {
    const mins = p.minutesWaiting;
    const badgeClass = mins == null ? 'wr-wait-ok' : mins >= 20 ? 'wr-wait-red' : mins >= 10 ? 'wr-wait-amber' : 'wr-wait-ok';
    const badgeText  = mins != null ? waitLabel(mins) : '';
    const meta = [
      p.reason || null,
      p.deliveryMode === 'face-to-face' ? 'F2F' : p.deliveryMode || null,
    ].filter(Boolean).join(' · ');

    return `
      <div class="wr-patient">
        <div class="wr-patient-time">${escHtml(p.start)}</div>
        <div class="wr-patient-info">
          <div class="wr-patient-name">${escHtml(p.name)}</div>
          ${meta ? `<div class="wr-patient-meta">${escHtml(meta)}</div>` : ''}
        </div>
        ${badgeText ? `<div class="wr-wait-badge ${badgeClass}">${badgeText}</div>` : ''}
      </div>`;
  }).join('');

  body.innerHTML = heroHtml + `<div class="wr-list">${listHtml}</div>`;
}

function renderError(msg) {
  if (/not signed in/i.test(msg)) {
    body.innerHTML = `
      <div class="wr-state">
        <div class="wr-state-icon">🔒</div>
        <div>Sign in to Medicus to see the waiting room</div>
      </div>`;
  } else {
    body.innerHTML = `
      <div class="wr-state">
        <div class="wr-state-icon">⚠</div>
        <div>${escHtml(msg)}</div>
      </div>`;
  }
}

function waitLabel(mins) {
  if (mins == null) return '';
  if (mins < 1) return '&lt;1 min';
  return `${mins} min${mins === 1 ? '' : 's'}`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }); // amber
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}
