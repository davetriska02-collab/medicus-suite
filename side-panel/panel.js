// Medicus Suite — Side Panel Controller

'use strict';

const content = document.getElementById('suiteContent');
const settingsBtn = document.getElementById('settingsBtn');
let activeModule = 'slots';
let moduleCleanup = null;
let switchSeq = 0;

let panelDisplayPrefs = { theme: 'light', size: 'medium', colorblind: false };
let displayOpen = false;
let _dpCloseHandler = null;

function applyDisplayPrefs(prefs) {
  prefs = prefs || {};
  panelDisplayPrefs.theme     = prefs.theme     || 'light';
  panelDisplayPrefs.size      = prefs.size      || 'medium';
  panelDisplayPrefs.colorblind = !!prefs.colorblind;
  document.documentElement.setAttribute('data-theme',      panelDisplayPrefs.theme);
  document.documentElement.setAttribute('data-size',       panelDisplayPrefs.size);
  document.documentElement.setAttribute('data-colorblind', String(panelDisplayPrefs.colorblind));
}

function buildDisplayPopoverHTML() {
  const p = panelDisplayPrefs;
  const themeOpts = [['light','Light'],['dark','Dark']].map(([v,l]) =>
    `<button class="dp-seg${p.theme===v?' active':''}" data-dp-key="theme" data-dp-val="${v}">${l}</button>`).join('');
  const sizeOpts = [['small','S'],['medium','M'],['large','L']].map(([v,l]) =>
    `<button class="dp-seg${p.size===v?' active':''}" data-dp-key="size" data-dp-val="${v}">${l}</button>`).join('');
  return `<div class="dp-popover" id="dpPopover">
    <div class="dp-title">Display</div>
    <div class="dp-row">
      <span class="dp-lbl">Theme</span>
      <div class="dp-segs">${themeOpts}</div>
    </div>
    <div class="dp-row">
      <span class="dp-lbl">Text size</span>
      <div class="dp-segs">${sizeOpts}</div>
    </div>
    <div class="dp-row">
      <span class="dp-lbl">Colour-blind</span>
      <label class="dp-toggle">
        <input type="checkbox" id="dpColorblind" ${p.colorblind ? 'checked' : ''} />
        <span class="dp-track"><span class="dp-thumb"></span></span>
      </label>
    </div>
  </div>`;
}

function renderDisplayPopover() {
  const host = document.getElementById('displayPopoverHost');
  if (!host) return;
  host.innerHTML = displayOpen ? buildDisplayPopoverHTML() : '';
  if (!displayOpen) return;

  host.querySelectorAll('[data-dp-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      panelDisplayPrefs[btn.dataset.dpKey] = btn.dataset.dpVal;
      chrome.storage.local.set({ 'suite.display': { ...panelDisplayPrefs } });
      applyDisplayPrefs(panelDisplayPrefs);
      renderDisplayPopover();
    });
  });
  host.querySelector('#dpColorblind')?.addEventListener('change', e => {
    panelDisplayPrefs.colorblind = e.target.checked;
    chrome.storage.local.set({ 'suite.display': { ...panelDisplayPrefs } });
    applyDisplayPrefs(panelDisplayPrefs);
    renderDisplayPopover();
  });

  // Re-rendering the popover (e.g. on each in-popover click) must not stack
  // duplicate document listeners — remove any previous one before adding.
  if (_dpCloseHandler) document.removeEventListener('click', _dpCloseHandler);
  _dpCloseHandler = (e) => {
    if (!e.target.closest('#displayPopoverHost') && !e.target.closest('#displayBtn')) {
      displayOpen = false;
      document.removeEventListener('click', _dpCloseHandler);
      _dpCloseHandler = null;
      renderDisplayPopover();
    }
  };
  document.addEventListener('click', _dpCloseHandler);
}

// ── Module registry ───────────────────────────────────────────────────────────

const MODULES = {
  slots:       { js: () => import('./modules/slots/slots.js'),           css: './modules/slots/slots.css' },
  capacity:    { js: () => import('./modules/capacity/capacity.js'),      css: './modules/capacity/capacity.css' },
  submissions: { js: () => import('./modules/submissions/submissions.js'), css: './modules/submissions/submissions.css' },
  sentinel:    { js: () => import('./modules/sentinel/sentinel.js'),      css: './modules/sentinel/sentinel.css' },
  activity:    { js: () => import('./modules/activity/activity.js'),     css: './modules/activity/activity.css' },
  referrals:   { js: () => import('./modules/referrals/referrals.js'),   css: './modules/referrals/referrals.css' },
  condor:      { js: () => import('./modules/condor/condor.js'),         css: './modules/condor/condor.css' },
  trends:      { js: () => import('./modules/trends/trends.js'),         css: './modules/trends/trends.css' },
  sweep:       { js: () => import('./modules/sweep/sweep.js'),           css: './modules/sweep/sweep.css' },
  about:       null,
};


// ── Nav overflow detection ────────────────────────────────────────────────────

const navEl = document.querySelector('.suite-nav');
const navTabsEl = document.querySelector('.nav-tabs');
const navIndicatorRight = document.querySelector('.nav-scroll-right');
const navIndicatorLeft  = document.querySelector('.nav-scroll-left');

function updateNavOverflow() {
  if (!navTabsEl) return;
  const sl = navTabsEl.scrollLeft;
  const hasRight = navTabsEl.scrollWidth > navTabsEl.clientWidth + 4
                && (sl + navTabsEl.clientWidth) < (navTabsEl.scrollWidth - 4);
  const hasLeft  = sl > 4;
  navEl.classList.toggle('has-overflow-right', hasRight);
  navEl.classList.toggle('has-overflow-left',  hasLeft);
}

navTabsEl?.addEventListener('scroll', updateNavOverflow);
if (navTabsEl) new ResizeObserver(updateNavOverflow).observe(navTabsEl);
updateNavOverflow();

[navIndicatorRight, navIndicatorLeft].forEach(el => {
  if (!el) return;
  el.style.setProperty('pointer-events', 'auto');
  el.style.setProperty('cursor', 'pointer');
});
navIndicatorRight?.addEventListener('click', () => navTabsEl?.scrollBy({ left:  120, behavior: 'smooth' }));
navIndicatorLeft?.addEventListener('click',  () => navTabsEl?.scrollBy({ left: -120, behavior: 'smooth' }));

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
    if (mod === 'visualiser') {
      chrome.tabs.create({ url: chrome.runtime.getURL('visualiser-core.html') });
      return;
    }
    if (mod === activeModule) return;
    switchModule(mod);
  });
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Popout button ─────────────────────────────────────────────────────────────

const popoutBtn = document.getElementById('popoutBtn');

async function updatePopoutBtn() {
  if (!popoutBtn || !window.PopoutManager) return;
  const isOpen = await window.PopoutManager.isOpen();
  popoutBtn.title = isOpen ? 'Focus floating window' : 'Pop out to floating window';
  popoutBtn.classList.toggle('active', isOpen);
}

popoutBtn?.addEventListener('click', async () => {
  if (!window.PopoutManager) return;
  await window.PopoutManager.open();
  await updatePopoutBtn();
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (msg?.type === 'popout:closed') updatePopoutBtn();
});

updatePopoutBtn();

async function switchModule(name) {
  const mySeq = ++switchSeq;

  // Cleanup previous module before wiping content
  const prevCleanup = moduleCleanup;
  moduleCleanup = null;
  if (prevCleanup) try { prevCleanup(); } catch (e) { console.error(e); }

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
    if (mySeq !== switchSeq) return;
    if (mod.init) {
      const cleanup = await mod.init(content);
      if (mySeq !== switchSeq) {
        // A newer switch happened while init was running — clean up immediately
        if (typeof cleanup === 'function') try { cleanup(); } catch (e) { console.error(e); }
        return;
      }
      moduleCleanup = cleanup;
    }
  } catch (err) {
    if (mySeq !== switchSeq) return;
    content.innerHTML = `<div class="module-wrap"><div class="banner">Failed to load module: ${escStrip(err.message)}</div></div>`;
  }
}

// ── About module (inline) ─────────────────────────────────────────────────────

function renderAbout() {
  content.innerHTML = `
    <div class="about-module">
      <div class="feature-list-link">
        <a href="https://github.com/davetriska02-collab/medicus-suite/raw/main/docs/feature-list.docx" target="_blank" rel="noopener noreferrer">
          📄 Download the latest feature list (.docx)
        </a>
        <div class="feature-list-link-sub">Regenerated weekly. Source: <a href="https://github.com/davetriska02-collab/medicus-suite/blob/main/docs/feature-list.md" target="_blank" rel="noopener noreferrer">view on GitHub</a></div>
      </div>

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

      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Referrals Tracker</span>
          <span class="module-card-version">v1.0</span>
        </div>
        <div class="module-card-desc">
          Referral audit data across a configurable date range. Shows total referral count with
          priority (Routine / Urgent / 2WW) and status breakdowns, plus horizontal bar charts
          by referring clinician, specialty, and hospital. Fetches from the Medicus
          clinical-audit-report endpoint. API-based.
        </div>
      </div>

      <h2>Suite</h2>
      <div class="module-card">
        <div class="module-card-header">
          <span class="module-card-name">Medicus Suite</span>
          <span class="module-card-version">v${chrome.runtime.getManifest().version}</span>
        </div>
        <div class="module-card-desc">
          This extension is a runtime container. It provides a side panel and shared infrastructure.
          Each module above retains its own purpose, scope, and regulatory positioning.
          The suite itself makes no clinical claims and provides no decision support.
        </div>
        <div style="margin-top:10px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <button id="checkUpdateBtn" style="font-size:11px; font-family:var(--mono); font-weight:600; color:var(--accent); background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.25); border-radius:5px; padding:4px 10px; cursor:pointer;">Check for updates</button>
          <span id="updateStatus" style="font-size:11px; font-family:var(--mono); color:var(--text-3);"></span>
        </div>
      </div>

      <h2>Feedback</h2>
      <div class="module-card">
        <div class="module-card-desc" style="margin-bottom:10px;">
          Found a bug, want a new feature, or have general feedback? Send it straight to the developer.
          Your email client opens pre-filled — review and hit send.
        </div>
        <div class="fb-types" role="group" aria-label="Feedback type">
          <button type="button" class="fb-type-btn active" data-fb-type="Feedback">Feedback</button>
          <button type="button" class="fb-type-btn" data-fb-type="Feature request">Feature request</button>
          <button type="button" class="fb-type-btn" data-fb-type="Bug report">Bug report</button>
        </div>
        <div class="fb-field">
          <label for="fbSubject">Subject</label>
          <input id="fbSubject" type="text" maxlength="120" placeholder="Short summary" />
        </div>
        <div class="fb-field">
          <label for="fbDetails">Details</label>
          <textarea id="fbDetails" rows="5" placeholder="What happened, what you expected, steps to reproduce…"></textarea>
        </div>
        <div class="fb-warn" role="note">⚠ Do not include patient-identifiable information (names, NHS numbers, dates of birth). Suite version and browser details are attached automatically.</div>
        <div class="fb-actions">
          <button id="fbSendBtn" type="button" class="fb-send-btn">Open email</button>
          <span id="fbStatus" class="fb-status"></span>
        </div>
      </div>
    </div>
  `;

  document.getElementById('checkUpdateBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('checkUpdateBtn');
    const status = document.getElementById('updateStatus');
    if (!btn || !status) return;
    btn.disabled = true;
    btn.textContent = 'Checking…';
    status.textContent = '';
    try {
      const result = await window.UpdateChecker.checkForUpdate({ force: true });
      const installed = window.UpdateChecker.getInstalledVersion();
      if (!result.ok) {
        status.style.color = 'var(--red)';
        status.textContent = result.error || 'Check failed';
      } else if (window.UpdateChecker.isNewer(result.latestVersion, installed)) {
        status.style.color = 'var(--amber)';
        // Validate releaseUrl is a github.com https URL before injecting (defends against
        // a spoofed/poisoned GitHub API response that could deliver a javascript: URL).
        const safeUrl = /^https:\/\/github\.com\//.test(result.releaseUrl || '') ? result.releaseUrl : '#';
        status.innerHTML = `v${escStrip(result.latestVersion)} available — <a href="${escStrip(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);">view release ↗</a>`;
      } else {
        status.style.color = 'var(--green)';
        status.textContent = `v${installed} is up to date`;
      }
    } catch (e) {
      status.style.color = 'var(--red)';
      status.textContent = e.message || 'Unknown error';
    }
    btn.disabled = false;
    btn.textContent = 'Check for updates';
  });

  // ── Feedback / feature request / bug report (mailto) ──────────────────────────
  // Recipient is configurable in Options › Suite (suite.feedbackEmail); falls back
  // to the default below when unset.
  const FEEDBACK_EMAIL_DEFAULT = 'davetriska02@gmail.com';
  const fbTypeBtns = document.querySelectorAll('.fb-type-btn');
  fbTypeBtns.forEach(b => b.addEventListener('click', () => {
    fbTypeBtns.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  }));

  document.getElementById('fbSendBtn')?.addEventListener('click', async () => {
    const status = document.getElementById('fbStatus');
    const subjectEl = document.getElementById('fbSubject');
    const detailsEl = document.getElementById('fbDetails');
    const type = document.querySelector('.fb-type-btn.active')?.dataset.fbType || 'Feedback';
    const subject = (subjectEl?.value || '').trim();
    const details = (detailsEl?.value || '').trim();

    if (!subject && !details) {
      if (status) { status.style.color = 'var(--red)'; status.textContent = 'Add a subject or details first'; }
      subjectEl?.focus();
      return;
    }

    const version = chrome.runtime.getManifest().version;
    const diag = [
      '',
      '──────────',
      '(Diagnostics — please keep)',
      `Type: ${type}`,
      `Suite version: v${version}`,
      `Browser: ${navigator.userAgent}`,
      `Date: ${new Date().toISOString()}`,
    ].join('\n');
    const mailSubject = `[Medicus Suite] ${type}${subject ? ': ' + subject : ''}`;
    const mailBody = `${details}\n${diag}`;
    const stored = await chrome.storage.local.get('suite.feedbackEmail');
    const recipient = (stored['suite.feedbackEmail'] || '').trim() || FEEDBACK_EMAIL_DEFAULT;
    const url = `mailto:${recipient}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;

    // Use a transient anchor click rather than navigating the panel away.
    const a = document.createElement('a');
    a.href = url;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();

    if (status) { status.style.color = 'var(--green)'; status.textContent = 'Opening your email client…'; }
  });
}

// ── Service worker messages ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender) => {
  // F5: Only accept messages from this extension's own contexts.
  if (!sender || sender.id !== chrome.runtime.id) return;
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
  if (document.visibilityState !== 'visible') return;
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
      .filter(e => e?.diaryEntryType?.value === 'appointment' && e?.displayStatus?.value === 'arrived')
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
// F5: Sender guard — only accept messages from intra-extension contexts.
// Light coalescing: fetchAndRenderStrip / fetchAndRenderRmStrip are already
// guarded by document.visibilityState and their own fetch-in-flight logic,
// so duplicate refreshes within the same tick are absorbed naturally.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender || sender.id !== chrome.runtime.id) return;
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
  if (document.visibilityState !== 'visible') return;
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
  applyTriageAlerts(result.buckets);
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

// ── Triage capacity alerts ────────────────────────────────────────────────────

const _triageAlertedBuckets = new Map(); // key → last alerted count (session memory)

async function applyTriageAlerts(buckets) {
  if (!rmStripEl || !window.TriageAlertEngine || !window.TriageAlertIO) return;
  const rules = await window.TriageAlertIO.getRules();
  const { triggered, maxLevel } = window.TriageAlertEngine.evaluate(buckets, rules);

  // Update strip class
  rmStripEl.classList.remove('rm-strip-alerted-amber', 'rm-strip-alerted-red');
  if (maxLevel) rmStripEl.classList.add(`rm-strip-alerted-${maxLevel}`);

  // Desktop notifications — once per threshold crossing per session
  for (const t of triggered) {
    const prev = _triageAlertedBuckets.get(t.key);
    const crossed = prev === undefined || (prev < t.threshold && t.count >= t.threshold);
    if (crossed) {
      _triageAlertedBuckets.set(t.key, t.count);
      if (Notification.permission === 'granted') {
        new Notification('Medicus Suite — Triage alert', {
          body: `${t.label}: ${t.count} tasks (threshold ${t.threshold})`,
          silent: true,
        });
      }
    } else {
      _triageAlertedBuckets.set(t.key, t.count);
    }
  }
  // Clear alerted state for buckets that dropped back below threshold
  for (const [key, _] of _triageAlertedBuckets) {
    if (!triggered.find(t => t.key === key)) _triageAlertedBuckets.delete(key);
  }
}

// React to config changes — re-render immediately
chrome.storage.onChanged.addListener(changes => {
  if (Object.keys(changes).some(k => k.startsWith('suite.requestMonitor.'))) {
    fetchAndRenderRmStrip();
  }
  if (Object.keys(changes).some(k => k.startsWith('suite.triageAlert.'))) {
    fetchAndRenderRmStrip();
  }
  if (changes['submissions.thresholds']) {
    fetchAndRenderSubRagStrip();
  }
});

// Boot the rm strip
fetchAndRenderRmStrip();
// Initial poll interval — will adjust to cfg.pollSeconds on first fetch
rmPollTimer = setInterval(fetchAndRenderRmStrip, rmPollSeconds * 1000);

// ── Submissions demand strip (global — visible on every module) ───────────────
// Shows amber/red when medical or admin request counts hit configured thresholds.
// Polls every 60s, but only makes API calls when at least one threshold is enabled.

const subRagStripEl    = document.getElementById('subRagStrip');
const SUB_RAG_POLL_MS  = 60 * 1000;

const SUB_RAG_TYPES = [
  { key: 'medical', label: 'Medical', apiType: 'medical_patient_request_task' },
  { key: 'admin',   label: 'Admin',   apiType: 'admin_patient_request_task'   },
];

const DEFAULT_SUB_THRESHOLDS = {
  medical: { amber: 30, red: 60, enabled: false },
  admin:   { amber: 20, red: 40, enabled: false },
};

function _subRagLevel(key, value, thresholds) {
  const t = { ...DEFAULT_SUB_THRESHOLDS[key], ...(thresholds[key] || {}) };
  if (!t.enabled) return null;
  if (value >= (t.red   || Infinity)) return 'red';
  if (value >= (t.amber || Infinity)) return 'amber';
  return null;
}

async function fetchAndRenderSubRagStrip() {
  if (document.visibilityState !== 'visible') return;
  if (!subRagStripEl) return;

  const stored = await chrome.storage.local.get('submissions.thresholds');
  const thresholds = { ...DEFAULT_SUB_THRESHOLDS, ...(stored['submissions.thresholds'] || {}) };

  const anyEnabled = SUB_RAG_TYPES.some(t => thresholds[t.key]?.enabled);
  if (!anyEnabled) {
    subRagStripEl.className = 'sub-rag-strip sub-rag-strip-hidden';
    subRagStripEl.innerHTML = '';
    return;
  }

  const { code, source } = await window.PracticeCode.resolve();
  if (!code) return;

  const today = new Date().toISOString().slice(0, 10);
  const results = await Promise.allSettled(
    SUB_RAG_TYPES.map(async tt => {
      const url = `https://${code}.api.england.medicus.health/tasks/data/${tt.apiType}/task-list?createdAt_startDate=${today}&createdAt_endDate=${today}`;
      // Route through ApiDiag so SubRag errors/latency show in the Debug panel,
      // consistent with the WR and Request-Monitor strips.
      const r = await window.ApiDiag.fetch({ module: 'panel-sub-rag-strip', url, code, codeSource: source });
      if (!r.ok) throw new Error(`${tt.label} HTTP ${r.status}`);
      const d = await r.json();
      return { key: tt.key, label: tt.label, count: (d.tasks || []).length };
    })
  );

  const triggered = [];
  let maxLevel = null;
  for (let i = 0; i < SUB_RAG_TYPES.length; i++) {
    const res = results[i];
    if (res.status !== 'fulfilled') continue;
    const { key, label, count } = res.value;
    const level = _subRagLevel(key, count, thresholds);
    if (!level) continue;
    triggered.push({ label, count, level });
    if (level === 'red' || maxLevel === null) maxLevel = level;
    else if (level === 'amber' && maxLevel !== 'red') maxLevel = level;
  }

  if (triggered.length === 0) {
    subRagStripEl.className = 'sub-rag-strip sub-rag-strip-hidden';
    subRagStripEl.innerHTML = '';
    return;
  }

  const pills = triggered.map(t =>
    `<span class="sub-rag-pill sub-rag-pill--${t.level}">${t.label}: ${t.count}</span>`
  ).join('');

  subRagStripEl.className = `sub-rag-strip sub-rag-strip--${maxLevel}`;
  subRagStripEl.innerHTML = `
    <span class="sub-rag-icon">📊</span>
    <span class="sub-rag-label">Demand:</span>
    ${pills}
    <button class="sub-rag-goto" title="Go to Submissions">Submissions →</button>
  `;
  subRagStripEl.querySelector('.sub-rag-goto')?.addEventListener('click', () => switchModule('submissions'));
}

fetchAndRenderSubRagStrip();
let subRagPollTimer = setInterval(fetchAndRenderSubRagStrip, SUB_RAG_POLL_MS);

// Refresh all three strips immediately when the panel becomes visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    fetchAndRenderStrip();
    fetchAndRenderRmStrip();
    fetchAndRenderSubRagStrip();
  }
});

// Tear down all strip poll timers when the panel document goes away. The side
// panel is normally permanent, but if Chrome re-creates the document (e.g. an
// extension reload without a browser restart) the old timers would otherwise
// keep running and a fresh set would stack on top. Only rmPollTimer was cleared
// before (on config change); wr/subRag ran for the document's whole lifetime.
window.addEventListener('pagehide', () => {
  if (wrPollTimer) clearInterval(wrPollTimer);
  if (rmPollTimer) clearInterval(rmPollTimer);
  if (subRagPollTimer) clearInterval(subRagPollTimer);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

// Load and apply display preferences; keep popover state in sync with external changes
chrome.storage.local.get('suite.display').then(r => {
  applyDisplayPrefs(r['suite.display'] || {});
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes['suite.display']) applyDisplayPrefs(changes['suite.display'].newValue || {});
});

// Wire display button
document.getElementById('displayBtn')?.addEventListener('click', e => {
  e.stopPropagation();
  displayOpen = !displayOpen;
  renderDisplayPopover();
});

switchModule('slots');
