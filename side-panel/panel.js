// Medicus Suite — Side Panel Controller

'use strict';

const content = document.getElementById('suiteContent');
const settingsBtn = document.getElementById('settingsBtn');
let activeModule = 'slots';
let moduleCleanup = null;

// ── Module registry ───────────────────────────────────────────────────────────

const MODULES = {
  slots:       { js: () => import('./modules/slots/slots.js'),           css: './modules/slots/slots.css' },
  capacity:    { js: () => import('./modules/capacity/capacity.js'),      css: './modules/capacity/capacity.css' },
  submissions: { js: () => import('./modules/submissions/submissions.js'), css: './modules/submissions/submissions.css' },
  triage:      { js: () => import('./modules/triage/triage.js'),         css: './modules/triage/triage.css' },
  sentinel:    { js: () => import('./modules/sentinel/sentinel.js'),      css: './modules/sentinel/sentinel.css' },
  activity:    { js: () => import('./modules/activity/activity.js'),     css: './modules/activity/activity.css' },
  about:       null,
};


// ── Nav overflow detection ────────────────────────────────────────────────────

const navEl = document.querySelector('.suite-nav');
const navTabsEl = document.querySelector('.nav-tabs');
const navIndicator = document.querySelector('.nav-scroll-indicator');

function updateNavOverflow() {
  if (!navTabsEl) return;
  const hasOverflow = navTabsEl.scrollWidth > navTabsEl.clientWidth + 4
                   && (navTabsEl.scrollLeft + navTabsEl.clientWidth) < (navTabsEl.scrollWidth - 4);
  navEl.classList.toggle('has-overflow', hasOverflow);
}

navTabsEl?.addEventListener('scroll', updateNavOverflow);
new ResizeObserver(updateNavOverflow).observe(navTabsEl);
updateNavOverflow();

// Click-to-scroll on indicator (makes overflow discoverable)
navIndicator?.style.setProperty('pointer-events', 'auto');
navIndicator?.style.setProperty('cursor', 'pointer');
navIndicator?.addEventListener('click', () => {
  if (!navTabsEl) return;
  navTabsEl.scrollBy({ left: 120, behavior: 'smooth' });
});

// ── Slots nav badge ───────────────────────────────────────────────────────────
document.addEventListener('suite:slots:count', e => {
  const tab = document.querySelector('[data-module="slots"]');
  if (!tab) return;
  let badge = tab.querySelector('.nav-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge';
    tab.appendChild(badge);
  }
  const n = e.detail.count;
  badge.textContent = n != null ? String(n) : '';
  badge.style.display = (n != null && n >= 0) ? '' : 'none';
});

// Inject module CSS once per module
const loadedCss = new Set();
function ensureModuleCss(cssPath) {
  if (!cssPath || loadedCss.has(cssPath)) return;
  loadedCss.add(cssPath);
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = cssPath;
  document.head.appendChild(link);
}

// ── Navigation ────────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const mod = tab.dataset.module;
    if (mod === activeModule) return;
    switchModule(mod);
  });
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('visualiserBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('visualiser.html') });
});

async function switchModule(name) {
  // Cleanup previous module
  if (moduleCleanup) { try { moduleCleanup(); } catch (e) {} moduleCleanup = null; }

  // Update nav
  document.querySelectorAll('.nav-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.module === name)
  );
  activeModule = name;
  content.innerHTML = '';

  if (name === 'about') { renderAbout(); return; }

  const entry = MODULES[name];
  if (!entry) return;

  ensureModuleCss(entry.css);

  try {
    const mod = await entry.js();
    if (mod.init) {
      moduleCleanup = await mod.init(content);
    }
  } catch (err) {
    content.innerHTML = `<div class="module-wrap"><div class="banner">Failed to load module: ${err.message}</div></div>`;
  }
}

// ── About module (inline) ─────────────────────────────────────────────────────

function renderAbout() {
  content.innerHTML = `
    <div class="about-module">
      <h2>Modules</h2>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Slot Counter</span>
          <span class="module-card-version">v2.2</span>
        </div>
        <div class="module-card-desc">
          Available appointment slots by type for any date. API-based; no scheduling page required.
          Updates live via Pusher when a Medicus tab is open.
        </div>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Submissions Tracker</span>
          <span class="module-card-version">v1.0</span>
        </div>
        <div class="module-card-desc">
          Daily inbound task counts across medical, admin, investigation and prescription categories.
          Today view, date range, day-vs-day comparison.
        </div>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Triage Lens</span>
          <span class="module-card-version">v0.5.0</span>
        </div>
        <div class="module-card-desc">
          In-page overlay on Medicus patient records and triage queues.
          User-defined keyword rules with severity chips. Runs as a content script.
        </div>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Monitoring (Sentinel)</span>
          <span class="module-card-version">v0.4.2</span>
        </div>
        <div class="module-card-desc">
          Clinical context sidebar on patient records. Drug monitoring and QOF 25/26 indicators.
          Runs as a content script; requires a patient page to be open.
        </div>
        <div class="purpose-box">
          Software that displays, against the patient's active medication list, active problem list,
          and recent observations as already recorded in the Medicus electronic patient record,
          the most recent recorded values relevant to published drug-monitoring guidance and to QOF
          2025/26 indicator criteria, and indicates whether those values fall within the recommended
          interval or whether the relevant QOF indicator is achieved. The software does not recommend
          clinical actions, does not order investigations, does not write to the patient record, does
          not modify QOF claims data, does not transmit any data outside the user's browser, does
          not analyse images, does not generate synthetic data, and does not constitute clinical
          decision support. It is a passive display tool for use by the clinician as a memory aid.
          All clinical decisions, including verification of any displayed value against the source
          record, remain the responsibility of the clinician.
        </div>
        <a class="disclaimer-link" href="../docs/sentinel-DISCLAIMER.txt" target="_blank">View DISCLAIMER ↗</a>
      </div>

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Activity Report</span>
          <span class="module-card-version">v1.0</span>
        </div>
        <div class="module-card-desc">
          Practice activity per staff member across a configurable date range. Shows period totals
          and a stacked horizontal bar chart broken down by consultations, prescription requests,
          medication reviews, document tasks, and investigation results. API-based.
        </div>
      </div>

      <h2>Suite</h2>
      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Medicus Suite</span>
          <span class="module-card-version">v1.0.0</span>
        </div>
        <div class="module-card-desc">
          This extension is a runtime container. It provides a side panel and shared infrastructure.
          Each module above retains its own purpose, scope, and regulatory positioning.
          The suite itself makes no clinical claims and provides no decision support.
        </div>
      </div>
    </div>
  `;
}

// ── Service worker messages ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'slots:refresh' && activeModule === 'slots') {
    document.dispatchEvent(new CustomEvent('suite:slots:refresh'));
  }
});


// ── Waiting Room strip (global — visible on every module) ─────────────────────

let SITE_ID_WR    = null;
let WR_API        = null;
const WR_POLL_MS  = 30 * 1000;
const wrStripEl   = document.getElementById('wrStrip');

let wrPollTimer   = null;

async function fetchAndRenderStrip(bypassCache = false) {
  // Resolve practice code on every call so user changes take effect immediately
  const { code, source } = await window.PracticeCode.resolve();
  SITE_ID_WR = code;
  if (!SITE_ID_WR) {
    // No practice code set — hide strip silently. User will see the prompt in Options.
    if (wrStripEl) {
      wrStripEl.className = 'wr-strip wr-strip-hidden';
      wrStripEl.innerHTML = '';
    }
    return;
  }
  WR_API = `https://${SITE_ID_WR}.api.england.medicus.health/scheduling/data/homepage/my-appointments`;
  try {
    const r = await window.ApiDiag.fetch({
      module: 'panel-wr-strip',
      url: WR_API,
      code: SITE_ID_WR,
      codeSource: source,
    });
    const raw   = await r.json();
    const arrived = (raw?.schedule?.schedule ?? [])
      .flatMap(d => d.entries ?? [])
      .filter(e => e?.displayStatus?.isArrived === true)
      .map(e => ({
        name:           e.patient?.name ?? 'Unknown',
        start:          e.start ?? '',
        startDateTime:  e.startDateTime ?? null,
        minutesWaiting: calcStripWait(e.startDateTime),
      }))
      .sort((a, b) => a.start < b.start ? -1 : 1);

    renderStrip(arrived);
    updateStripBadge(arrived.length);
  } catch (_) {
    // Network error or no Medicus session — keep strip hidden, don't spam console
  }
}

function calcStripWait(dt) {
  if (!dt) return null;
  const ms = new Date(dt).getTime();
  if (isNaN(ms)) return null;
  const m = Math.round((Date.now() - ms) / 60000);
  return m > 0 ? m : 0;
}

function renderStrip(patients) {
  if (!wrStripEl) return;
  if (patients.length === 0) {
    wrStripEl.className = 'wr-strip wr-strip-hidden';
    wrStripEl.innerHTML = '';
    return;
  }

  const maxWait = Math.max(...patients.map(p => p.minutesWaiting ?? 0));
  const urgency = maxWait >= 20 ? 'red' : maxWait >= 10 ? 'amber' : 'green';

  // Build name chips — show up to 3, then "+N more"
  const shown  = patients.slice(0, 3);
  const extra  = patients.length - shown.length;
  const chips  = shown.map(p => {
    const mins = p.minutesWaiting;
    const cls  = mins != null && mins >= 20 ? 'wr-chip-red'
               : mins != null && mins >= 10 ? 'wr-chip-amber'
               : 'wr-chip-ok';
    const wait = mins != null ? ` · ${mins}m` : '';
    return `<span class="wr-chip ${cls}">${escStrip(p.name)}${wait}</span>`;
  }).join('');
  const extraChip = extra > 0 ? `<span class="wr-chip wr-chip-more">+${extra} more</span>` : '';

  wrStripEl.className = `wr-strip wr-strip-${urgency}`;
  wrStripEl.innerHTML = `
    <span class="wr-strip-icon">🚶</span>
    <span class="wr-strip-count">${patients.length} waiting</span>
    <span class="wr-strip-chips">${chips}${extraChip}</span>
    <button class="wr-strip-goto" title="Go to Monitoring">Monitoring →</button>
  `;

  wrStripEl.querySelector('.wr-strip-goto')?.addEventListener('click', () => {
    switchModule('sentinel');
    document.querySelector('[data-module="sentinel"]')?.scrollIntoView({ behavior: 'smooth', inline: 'nearest' });
  });
}

function updateStripBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

function escStrip(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Listen for Pusher-triggered refresh from service worker
chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === 'waiting:refresh') fetchAndRenderStrip(true);
  if (msg?.type === 'requestMonitor:refresh') fetchAndRenderRmStrip();
});

// Boot the strip — initial fetch + poll
fetchAndRenderStrip();
wrPollTimer = setInterval(fetchAndRenderStrip, WR_POLL_MS);

// ── Request Monitor strip (v1.3) ─────────────────────────────────────────────
// Sits below the waiting room strip. Hidden entirely unless toggled on in
// Options AND a team UUID is configured. Pills show counts for the four
// buckets; clicking a pill opens the filtered task list in a new tab.

const rmStripEl = document.getElementById('rmStrip');
let rmPollTimer = null;
let rmPollSeconds = 60;

async function fetchAndRenderRmStrip() {
  if (!rmStripEl || !window.RequestMonitor) return;

  const cfg = await window.RequestMonitor.getConfig();
  if (!cfg.enabled || !cfg.assigneeId) {
    rmStripEl.className = 'rm-strip rm-strip-hidden';
    rmStripEl.innerHTML = '';
    return;
  }
  // Adjust poll interval if config changed
  if (cfg.pollSeconds && cfg.pollSeconds * 1000 !== rmPollSeconds * 1000) {
    rmPollSeconds = cfg.pollSeconds;
    if (rmPollTimer) clearInterval(rmPollTimer);
    rmPollTimer = setInterval(fetchAndRenderRmStrip, rmPollSeconds * 1000);
  }

  const { code, source } = await window.PracticeCode.resolve();
  if (!code) {
    rmStripEl.className = 'rm-strip';
    rmStripEl.innerHTML = `<span class="rm-strip-icon">⚠</span><span class="rm-strip-label">Triage:</span><span class="rm-strip-error">No practice code</span>`;
    return;
  }

  // Direct fetch via API diag so failures show up in the Debug panel
  let result;
  try {
    result = await window.RequestMonitor.pollAll(code, cfg.assigneeId, {
      fetch: (url, init) => window.ApiDiag.fetch({ module: 'request-monitor', url, code, codeSource: source, init }),
    });
  } catch (e) {
    rmStripEl.className = 'rm-strip';
    rmStripEl.innerHTML = `<span class="rm-strip-icon">⚠</span><span class="rm-strip-label">Triage:</span><span class="rm-strip-error">${escStrip(e.message)}</span>`;
    return;
  }

  renderRmStrip(result, code, cfg.assigneeId);
}

function renderRmStrip(result, practiceCode, assigneeId) {
  if (!rmStripEl) return;
  const buckets = window.RequestMonitor.BUCKETS;
  const pills = buckets.map(b => {
    const data = result.buckets?.[b.key];
    const count = data?.count ?? 0;
    const isReply = b.status === 'reply-received';
    const cls = [
      'rm-pill',
      isReply ? 'rm-pill-reply' : 'rm-pill-new',
      count > 0 ? 'rm-pill-active' : '',
    ].filter(Boolean).join(' ');
    const clickUrl = window.RequestMonitor.buildClickUrl(practiceCode, b.taskType, b.status, assigneeId);
    return `<span class="${cls}" data-rm-url="${escStrip(clickUrl)}" title="${escStrip(b.label)}">
      <span class="rm-pill-label">${escStrip(b.short)}</span>
      <span class="rm-pill-count">${count}</span>
    </span>`;
  }).join('');

  const errorBlock = result.error
    ? `<span class="rm-strip-error">${escStrip(result.error)}</span>`
    : '';

  rmStripEl.className = 'rm-strip';
  rmStripEl.innerHTML = `
    <span class="rm-strip-icon">📋</span>
    <span class="rm-strip-label">Triage:</span>
    ${pills}
    ${errorBlock}
  `;

  // Wire click handlers
  rmStripEl.querySelectorAll('.rm-pill[data-rm-url]').forEach(el => {
    el.addEventListener('click', () => {
      const url = el.dataset.rmUrl;
      if (url) chrome.tabs.create({ url });
    });
  });
}

// React to config changes — re-render immediately
chrome.storage.onChanged.addListener(changes => {
  if (Object.keys(changes).some(k => k.startsWith('suite.requestMonitor.'))) {
    fetchAndRenderRmStrip();
  }
});

// Boot the rm strip
fetchAndRenderRmStrip();
// Initial poll interval — will adjust to cfg.pollSeconds on first fetch
rmPollTimer = setInterval(fetchAndRenderRmStrip, rmPollSeconds * 1000);

// ── Boot ──────────────────────────────────────────────────────────────────────

switchModule('slots');
