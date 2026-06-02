// Medicus Suite — Sentinel side panel module
// Polls the Sentinel content script for its chip snapshot and renders it here.

'use strict';

const STATUS_RANK   = { overdue:0, not_met:0, alert:0, stale:1, due_soon:2, caution:2, no_data:3, noted:3, recently_initiated:4, achieved:5, in_date:5 };
const STATUS_COLOUR = { overdue:'red', not_met:'red', alert:'red', stale:'amber', due_soon:'amber', caution:'amber', no_data:'neutral', noted:'neutral', recently_initiated:'neutral', achieved:'green', in_date:'green' };
const STATUS_LABEL  = { overdue:'OVERDUE', not_met:'NOT MET', alert:'ALERT', stale:'SEVERELY OVERDUE', due_soon:'DUE SOON', caution:'CAUTION', no_data:'NO DATA', noted:'NOTED', recently_initiated:'NEW', achieved:'MET', in_date:'IN DATE' };

let container = null;
let pollTimer = null;
let currentFilter = 'all'; // all | action | clear
let _refreshBtnHandler = null;

// Evidence-panel state: track which chip is open by its data-evidence-key so
// the 10s poll re-render can restore the panel. _evidenceByKey caches the chip
// objects from the latest snapshot for lookup on click.
let _openEvidenceKey = null;
let _evidenceByKey = new Map();
let _evidenceKeydownHandler = null;
let _evidenceHandlersAttached = false;

// ── Waiting room state ────────────────────────────────────────────────────────
// Practice code resolved at fetch time from PracticeCode helper. No default.
let WR_SITE_ID     = null;
let WR_API_URL     = null;
const WR_POLL_MS   = 30 * 1000;

let wrPatients     = null;  // null = not loaded yet, [] = loaded (empty), [...] = loaded
let wrError        = null;
let wrLastFetch    = null;
let wrPollTimer    = null;


export async function init(el) {
  container = el;
  render({ state: 'loading' });

  // Start waiting room fetch in parallel with sentinel chip poll
  fetchWaitingRoom();
  wrPollTimer = setInterval(fetchWaitingRoom, WR_POLL_MS);

  await refresh();
  pollTimer = setInterval(refresh, 10000);
  chrome.tabs.onActivated.addListener(refresh);
  chrome.tabs.onUpdated.addListener(onUpdated);

  // Listen for refresh signals: waiting-room polls (Pusher) + sentinel snapshot
  // updates pushed by the content script when the patient context changes.
  const onMsg = (msg) => {
    if (msg?.type === 'waiting:refresh') fetchWaitingRoom(true);
    if (msg?.type === 'sentinel:snapshot-updated') refresh();
  };
  chrome.runtime.onMessage.addListener(onMsg);

  _refreshBtnHandler = e => { if (e.target?.id === 'sentRefreshBtn') refresh(); };
  document.addEventListener('click', _refreshBtnHandler);

  return () => {
    cleanup();
    clearInterval(wrPollTimer);
    chrome.runtime.onMessage.removeListener(onMsg);
  };
}

function onUpdated(tabId, info) { if (info.status === 'complete') refresh(); }

async function cleanup() {
  clearInterval(pollTimer);
  clearInterval(wrPollTimer);
  chrome.tabs.onActivated.removeListener(refresh);
  chrome.tabs.onUpdated.removeListener(onUpdated);
  if (_refreshBtnHandler) {
    document.removeEventListener('click', _refreshBtnHandler);
    _refreshBtnHandler = null;
  }
  if (_evidenceKeydownHandler) {
    document.removeEventListener('keydown', _evidenceKeydownHandler);
    _evidenceKeydownHandler = null;
  }
  _evidenceHandlersAttached = false;
  _openEvidenceKey = null;
  _evidenceByKey.clear();
  container = null;
}


// ── Waiting room ─────────────────────────────────────────────────────────────

async function fetchWaitingRoom(bypassCache = false) {
  if (!bypassCache && wrLastFetch && (Date.now() - wrLastFetch) < WR_POLL_MS) return;
  // Resolve practice code on every fetch so user changes take effect immediately.
  const { code, source } = await window.PracticeCode.resolve();
  WR_SITE_ID = code;
  if (!WR_SITE_ID) {
    wrError = 'No practice code — open a Medicus tab or set it in Options.';
    wrPatients = [];
    // Update just the pinned waiting-room block (same as the success path).
    // Previously this called render({state:'loaded'}) — an unhandled state that
    // fell through to destructuring an undefined snapshot and threw (swallowed),
    // so the "no practice code" message never showed.
    if (container) {
      const wrEl = container.querySelector('.wr-pinned');
      if (wrEl) updateWrPinned(wrEl);
    }
    return;
  }
  WR_API_URL = `https://${WR_SITE_ID}.api.england.medicus.health/scheduling/data/homepage/my-appointments`;
  try {
    const r = await window.ApiDiag.fetch({
      module: 'sentinel-wr',
      url: WR_API_URL,
      code: WR_SITE_ID,
      codeSource: source,
    });
    const raw = await r.json();
    const entries = (raw?.schedule?.schedule ?? [])
      .flatMap(d => d.entries ?? [])
      .filter(e => e?.displayStatus?.isArrived === true);
    wrPatients = entries.map(e => ({
      name:          e.patient?.name ?? 'Unknown',
      start:         e.start ?? '',
      startDateTime: e.startDateTime ?? null,
      reason:        (e.compiledReasonForAppointment ?? '').replace(/^GP Appointment\s*/i,'').trim(),
      deliveryMode:  e.deliveryMode?.value ?? '',
      minutesWaiting: calcWrWait(e.startDateTime),
    })).sort((a,b) => a.start < b.start ? -1 : 1);
    wrError = null;
    wrLastFetch = Date.now();
    // NB: the toolbar action badge is owned solely by panel.js's waiting-room
    // strip (updateStripBadge), which polls globally. This module used to set it
    // too, so the two writers raced and clobbered each other's count whenever the
    // Sentinel tab was active. Leave the badge to panel.js.
  } catch(e) {
    wrError = e.message;
    wrPatients = wrPatients ?? []; // retain last good state on transient error
  }
  // Re-render the sentinel module to update the pinned block
  if (container) {
    const wrEl = container.querySelector('.wr-pinned');
    if (wrEl) updateWrPinned(wrEl);
  }
}

function calcWrWait(startDateTime) {
  if (!startDateTime) return null;
  const ms = new Date(startDateTime).getTime();
  if (isNaN(ms)) return null;
  const mins = Math.round((Date.now() - ms) / 60000);
  return mins > 0 ? mins : 0;
}

function renderWaitingRoomBlock() {
  const patients = wrPatients;
  if (patients === null) {
    // Still loading — show a slim skeleton
    return `<div class="wr-pinned wr-loading">
      <div class="wr-pin-row">
        <span class="wr-pin-icon">⏳</span>
        <span class="wr-pin-label">Waiting room loading…</span>
      </div>
    </div>`;
  }

  if (wrError && patients.length === 0) {
    return `<div class="wr-pinned wr-error">
      <div class="wr-pin-row">
        <span class="wr-pin-icon">⚠</span>
        <span class="wr-pin-label">${escHtml(wrError)}</span>
      </div>
    </div>`;
  }

  if (patients.length === 0) {
    return `<div class="wr-pinned wr-clear">
      <div class="wr-pin-row">
        <span class="wr-pin-icon">✓</span>
        <span class="wr-pin-label">Waiting room clear</span>
        <span class="wr-pin-ts">${wrLastFetch ? new Date(wrLastFetch).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : ''}</span>
      </div>
    </div>`;
  }

  const maxWait = Math.max(...patients.map(p => p.minutesWaiting ?? 0));
  const urgent  = patients.filter(p => (p.minutesWaiting ?? 0) >= 15);
  const rows    = patients.map(p => {
    const mins = p.minutesWaiting;
    const waitClass = mins == null ? '' : mins >= 20 ? 'wr-row-red' : mins >= 10 ? 'wr-row-amber' : '';
    const waitStr   = mins != null ? `${mins}m` : '';
    return `<div class="wr-row ${waitClass}">
      <span class="wr-row-time">${escHtml(p.start)}</span>
      <span class="wr-row-name">${escHtml(p.name)}</span>
      ${waitStr ? `<span class="wr-row-wait">${waitStr}</span>` : ''}
    </div>`;
  }).join('');

  const urgentNote = urgent.length > 0 ? ` · ${urgent.length} &gt;15m` : '';

  return `<div class="wr-pinned wr-waiting">
    <div class="wr-pin-row wr-pin-head">
      <span class="wr-pin-icon">🚶</span>
      <span class="wr-pin-label"><strong>${patients.length}</strong> waiting${urgentNote}</span>
      <span class="wr-pin-ts">${wrLastFetch ? new Date(wrLastFetch).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : ''}</span>
    </div>
    <div class="wr-rows">${rows}</div>
  </div>`;
}

function updateWrPinned(el) {
  // Surgical update — swap just the waiting room block without re-rendering the whole module
  const next = document.createElement('div');
  next.innerHTML = renderWaitingRoomBlock();
  const newEl = next.firstElementChild;
  if (newEl) el.replaceWith(newEl);
}

// Pure: decide how a Sentinel snapshot should be surfaced. Kept separate and
// unit-tested (test-sentinel-panel-state.js) because getting this wrong is the
// H-005 failure mode — a degraded extraction or a stale/invalidated snapshot
// must NEVER read as a benign "no chips for this patient" all-clear.
//   degraded    → extraction succeeded but produced nothing on a patient view
//   unavailable → snapshot was invalidated (navigating / failed extraction)
//   no-chips    → no snapshot yet
//   data        → real chips to render (may legitimately be an empty array)
function classifySnapshot(snapshot) {
  if (!snapshot) return 'no-chips';
  if (snapshot.unavailable) return 'unavailable';
  if (snapshot.degraded) return 'degraded';
  if (!snapshot.chips) return 'no-chips';
  return 'data';
}

let _refreshInFlight = false;
let _refreshPending = false;
async function refresh() {
  if (!container) return;
  // Coalesce concurrent refreshes. refresh() is driven by the 10s poll,
  // tabs.onActivated, tabs.onUpdated, the sentinel:snapshot-updated message and
  // the refresh button — several can fire at once. Without this guard their
  // executeScript/sendMessage round-trips race and each render() replaces the DOM
  // the others just built (flicker + wasted IPC). If a trigger arrives mid-flight
  // we run exactly one more refresh afterwards.
  if (_refreshInFlight) { _refreshPending = true; return; }
  _refreshInFlight = true;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !tab?.url || !/medicus\.health/.test(tab.url)) {
      render({ state: 'no-medicus' }); return;
    }
    const mountCheck = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => !!window.__sentinelMounted });
    if (!mountCheck?.[0]?.result) { render({ state: 'not-mounted' }); return; }
    const snapshot = await chrome.tabs.sendMessage(tab.id, { action: 'getSentinelSnapshot' });
    switch (classifySnapshot(snapshot)) {
      case 'degraded':    render({ state: 'degraded', snapshot }); return;
      case 'unavailable': render({ state: 'no-chips' }); return;
      case 'no-chips':    render({ state: 'no-chips' }); return;
      default:            render({ state: 'data', snapshot }); return;
    }
  } catch (err) {
    render({ state: 'error', message: err.message });
  } finally {
    _refreshInFlight = false;
    if (_refreshPending) { _refreshPending = false; refresh(); }
  }
}

function render(payload) {
  if (!container) return;
  const { state, snapshot, message } = payload;

  if (state === 'loading') {
    container.innerHTML = shell('', `<div class="sent-skeleton">${Array(4).fill('<div class="sent-skel-chip"></div>').join('')}</div>`);
    return;
  }
  if (state === 'no-medicus') { container.innerHTML = shell('', statusBlock('idle', 'No Medicus tab active', 'Open Medicus to use Sentinel.')); return; }
  if (state === 'not-mounted') { container.innerHTML = shell('', statusBlock('idle', 'Navigate to a patient record', 'Sentinel activates on patient record and triage task pages.')); return; }
  if (state === 'no-chips') { container.innerHTML = shell('', statusBlock('idle', 'Loading patient data…', 'This panel refreshes automatically.')); return; }
  if (state === 'error') { container.innerHTML = shell('', statusBlock('error', 'Could not connect to Sentinel', message || '')); return; }
  if (state === 'degraded') {
    // H-005: a patient was identified but nothing could be extracted. This must
    // be surfaced as a warning, never as a benign empty — see classifySnapshot.
    const reason = (snapshot && snapshot.reason) ||
      'A patient was identified, but no medications, problems, observations or demographics could be extracted from this page — Medicus may have changed its layout.';
    container.innerHTML = shell('', statusBlock('error', "⚠ Couldn't read this record",
      `${reason} This is NOT an "all clear" — verify the patient directly in Medicus, and the extension may need updating.`));
    return;
  }

  const { chips, patientContext, evaluatedAt } = snapshot;
  const patient = patientContext;

  // Filter chips
  let visibleChips = chips;
  if (currentFilter === 'action') visibleChips = chips.filter(c => STATUS_RANK[c.status] <= 2);
  if (currentFilter === 'clear')  visibleChips = chips.filter(c => STATUS_RANK[c.status] >= 5);

  const actionCount = chips.filter(c => STATUS_RANK[c.status] <= 2).length;
  const clearCount  = chips.filter(c => STATUS_RANK[c.status] >= 5).length;

  // Group by type
  const groups = {};
  visibleChips.forEach(chip => {
    const g = chip.type || 'other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(chip);
  });
  Object.values(groups).forEach(g => g.sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3)));

  const patientHtml = patient ? `
    <div class="sent-patient-banner">
      <div class="sent-patient-name">${escHtml(patient.displayName || patient.name || '')}</div>
      <div class="sent-patient-meta">${[
        patient.nhsNumber ? `NHS ${escHtml(patient.nhsNumber)}` : '',
        patient.dateOfBirth ? `DOB ${escHtml(patient.dateOfBirth)}` : '',
        patient.age ? `Age ${patient.age}` : '',
        patient.gender ? escHtml(patient.gender) : '',
      ].filter(Boolean).join(' · ')}</div>
    </div>` : '';

  const filterHtml = `
    <div class="sent-filter-bar">
      <button class="sent-filter-btn${currentFilter==='all'?' active':''}" data-filter="all">All (${chips.length})</button>
      <button class="sent-filter-btn${currentFilter==='action'?' active action':''}" data-filter="action">Needs action (${actionCount})</button>
      <button class="sent-filter-btn${currentFilter==='clear'?' active clear':''}" data-filter="clear">In date (${clearCount})</button>
    </div>`;

  const typeOrder = ['drug-combo', 'event-count', 'composite', 'drug-monitoring', 'vaccine', 'qof-indicator', 'qof-process-indicator', 'qof-register'];
  const typeLabelMap = { 'drug-combo':'Drug Combinations', 'event-count':'Recurrent Events', 'composite':'Composite Alerts', 'drug-monitoring':'Drug Monitoring', 'vaccine':'Vaccinations', 'qof-indicator':'QOF Indicators', 'qof-process-indicator':'QOF Process', 'qof-register':'Registers' };

  const groupsHtml = typeOrder
    .filter(t => groups[t]?.length)
    .map(t => `
      <section class="sent-group${t==='qof-register'?' sent-group-dim':''}">
        <div class="sent-group-label">${typeLabelMap[t] || t}</div>
        <div class="sent-chip-list">${groups[t].map(renderChip).join('')}</div>
      </section>`).join('');

  const ts = evaluatedAt ? new Date(evaluatedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '';
  const emptyMsg = visibleChips.length === 0 ? `<div class="sent-empty">${currentFilter==='action'?'No items needing action.':currentFilter==='clear'?'No items in date.':'No chips for this patient.'}</div>` : '';

  container.innerHTML = shell(patientHtml + filterHtml, groupsHtml + emptyMsg + `
    <div class="sent-footer">
      <button class="ghost-btn" id="sentSettingsBtn">Settings →</button>
      <span class="sent-ts">${ts ? `Data at ${ts}` : ''}</span>
    </div>`);

  // Build evidence-key → chip lookup for this render so the click handler can
  // find the chip object without re-parsing DOM.
  _evidenceByKey = new Map();
  visibleChips.forEach(chip => {
    if (!chip.evidence) return;
    const key = (chip.ruleId || '') + (chip.type === 'drug-monitoring' ? '|' + (chip.drugName || '') : '');
    _evidenceByKey.set(key, chip);
  });

  container.querySelector('#sentSettingsBtn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  // #sentRefreshBtn is handled by the persistent delegated click handler wired in
  // init() (_refreshBtnHandler); no per-render listener here (would double-fire).
  container.querySelectorAll('.sent-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      _openEvidenceKey = null; // filter change closes any open panel
      render(payload); // re-render with new filter
    });
  });

  attachEvidenceHandlers();

  // Restore the evidence panel that was open before this re-render, if its chip
  // still exists in the new snapshot.
  if (_openEvidenceKey && _evidenceByKey.has(_openEvidenceKey)) {
    const chipEl = container.querySelector(`.sent-chip[data-evidence-key="${cssEscape(_openEvidenceKey)}"]`);
    if (chipEl) openEvidenceFor(chipEl, _openEvidenceKey);
    else _openEvidenceKey = null;
  } else {
    _openEvidenceKey = null;
  }
}

function cssEscape(s) {
  return String(s || '').replace(/(["\\\]])/g, '\\$1');
}

function attachEvidenceHandlers() {
  if (_evidenceHandlersAttached) return; // Idempotent; container persists across re-renders
  container.addEventListener('click', onEvidenceClick);
  container.addEventListener('keydown', onEvidenceKeydown);

  _evidenceKeydownHandler = (e) => {
    if (e.key === 'Escape' && _openEvidenceKey) closeOpenEvidence();
  };
  document.addEventListener('keydown', _evidenceKeydownHandler);
  _evidenceHandlersAttached = true;
}

function onEvidenceClick(e) {
  // Composite sub-rule drill-through: jump to that chip and open its panel.
  const refBtn = e.target.closest('.sent-ev-ref[data-ref-rule-id]');
  if (refBtn) {
    e.stopPropagation();
    const refId = refBtn.dataset.refRuleId;
    // Find a chip whose key starts with this ruleId (drug-monitoring keys also
    // include the drug name). Picks the first match — sufficient for v1.
    let targetKey = null;
    for (const k of _evidenceByKey.keys()) {
      if (k === refId || k.startsWith(refId + '|')) { targetKey = k; break; }
    }
    if (!targetKey) return;
    closeOpenEvidence();
    const targetEl = container.querySelector(`.sent-chip[data-evidence-key="${cssEscape(targetKey)}"]`);
    if (!targetEl) return;
    openEvidenceFor(targetEl, targetKey);
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Close button inside the panel
  if (e.target.closest('.sent-ev-close')) {
    e.stopPropagation();
    closeOpenEvidence();
    return;
  }

  // Click on a chip with evidence
  const chipEl = e.target.closest('.sent-chip[data-evidence-key]');
  if (!chipEl) return;
  const key = chipEl.dataset.evidenceKey;
  if (_openEvidenceKey === key) {
    closeOpenEvidence();
  } else {
    closeOpenEvidence();
    openEvidenceFor(chipEl, key);
  }
}

function onEvidenceKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const chipEl = e.target.closest('.sent-chip[data-evidence-key]');
  if (!chipEl || !container.contains(chipEl)) return;
  if (e.target !== chipEl) return; // only the chip itself, not inner buttons
  e.preventDefault();
  const key = chipEl.dataset.evidenceKey;
  if (_openEvidenceKey === key) closeOpenEvidence();
  else { closeOpenEvidence(); openEvidenceFor(chipEl, key); }
}

function openEvidenceFor(chipEl, key) {
  const chip = _evidenceByKey.get(key);
  if (!chip || !chip.evidence) return;
  const CR = window.ChipRenderer;
  if (!CR || !CR.renderEvidencePanel) return;
  const panel = document.createElement('div');
  panel.className = 'sent-evidence-wrapper';
  panel.innerHTML = CR.renderEvidencePanel(chip.evidence);
  chipEl.insertAdjacentElement('afterend', panel);
  chipEl.setAttribute('aria-expanded', 'true');
  chipEl.classList.add('sent-chip-open');
  _openEvidenceKey = key;
}

function closeOpenEvidence() {
  if (!container) return;
  const open = container.querySelector('.sent-chip-open[data-evidence-key]');
  if (open) {
    open.setAttribute('aria-expanded', 'false');
    open.classList.remove('sent-chip-open');
    const next = open.nextElementSibling;
    if (next && next.classList.contains('sent-evidence-wrapper')) next.remove();
  }
  _openEvidenceKey = null;
}

function renderChip(chip) {
  const col = STATUS_COLOUR[chip.status] || 'neutral';
  const lbl = STATUS_LABEL[chip.status] || (chip.status || '').toUpperCase();

  // Drug-monitoring, qof-indicator, and the v3 custom-alert chip types delegate
  // to the shared renderer to keep side-panel rendering in sync with previews.
  const CR = (typeof window !== 'undefined') ? window.ChipRenderer : null;
  if (CR) {
    if (chip.type === 'drug-monitoring')  return CR.renderDrugChip(chip);
    if (chip.type === 'qof-indicator')    return CR.renderQofIndicatorChip(chip);
    if (chip.type === 'drug-combo')       return CR.renderDrugComboChip(chip);
    if (chip.type === 'event-count')      return CR.renderEventCountChip(chip);
    if (chip.type === 'composite')        return CR.renderCompositeChip(chip);
    if (chip.type === 'vaccine')          return CR.renderVaccineChip(chip);
  }

  if (chip.type === 'drug-monitoring') {
    const testLines = (chip.tests || []).map(t => {
      const tCol = STATUS_COLOUR[t.status] || 'neutral';
      const tLbl = STATUS_LABEL[t.status] || '';
      const dateStr = t.latestObs ? formatDate(t.latestObs.date) : '';
      const valStr  = t.latestObs && t.latestObs.value != null
        ? ` · ${escHtml(String(t.latestObs.value).trim().slice(0, 30))}`
        : '';
      const dayStr  = t.days != null ? ` · ${t.days}d` : '';
      return `<div class="sent-test-row">
        <span class="sent-test-name">${escHtml(t.testName || t.name || '')}</span>
        <span class="sent-test-status sent-test-${tCol}">${tLbl}${valStr}${dateStr ? ` · ${dateStr}${dayStr}` : ''}</span>
      </div>`;
    }).join('');
    return `
      <div class="sent-chip sent-chip-${col}">
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.drugName || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        ${chip.drugClass ? `<div class="sent-chip-cat">${escHtml(chip.drugClass)}</div>` : ''}
        ${testLines ? `<div class="sent-test-list">${testLines}</div>` : ''}
      </div>`;
  }

  if (chip.type === 'qof-indicator') {
    // Show the value + date. For overdue chips, flag that the result predates the QOF year start.
    const isOverdue = chip.status === 'overdue' || chip.status === 'not_met';
    const datePart  = chip.dateText
      ? (isOverdue && chip.qofYearStart && chip.dateText < chip.qofYearStart
          ? ` · ${escHtml(chip.dateText)} ⚠ before ${escHtml(chip.qofYearStart)}`
          : ` · ${escHtml(chip.dateText)}${chip.days != null ? ` (${chip.days}d ago)` : ''}`)
      : '';
    const obs = chip.valueText ? `${escHtml(chip.valueText)}${datePart}` : (chip.dateText ? datePart.replace(/^ · /, '') : '');
    const yearTag = chip.qofYear ? `<span class="sent-qof-year">QOF ${escHtml(chip.qofYear)}</span>` : '';
    return `
      <div class="sent-chip sent-chip-${col}">
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.indicatorCode || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}${chip.points ? ` · ${chip.points}pt` : ''}</span>
        </div>
        ${chip.indicatorName ? `<div class="sent-chip-cat">${escHtml(chip.indicatorName)}${yearTag}</div>` : yearTag}
        ${obs ? `<div class="sent-chip-obs">${obs}</div>` : ''}
      </div>`;
  }

  if (chip.type === 'qof-register') {
    return `
      <div class="sent-chip sent-chip-${col}">
        <div class="sent-chip-head">
          <span class="sent-chip-name">${escHtml(chip.registerName || chip.registerCode || chip.ruleId)}</span>
          <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
        </div>
        ${chip.matchedProblem ? `<div class="sent-chip-cat">${escHtml(chip.matchedProblem)}</div>` : ''}
      </div>`;
  }

  return `
    <div class="sent-chip sent-chip-${col}">
      <div class="sent-chip-head">
        <span class="sent-chip-name">${escHtml(chip.ruleName || chip.ruleId || '')}</span>
        <span class="sent-chip-badge sent-badge-${col}">${lbl}</span>
      </div>
    </div>`;
}

function shell(top, inner) {
  return `<div class="module-wrap sent-module">
    <div class="sent-header-row">
      <div class="mod-eyebrow">Clinical Monitoring</div>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="module-ver">v0.4.2</span>
        <button class="icon-btn" id="sentRefreshBtn" title="Refresh">↻</button>
      </div>
    </div>
    <div class="mod-title" style="margin-bottom:10px">Monitoring</div>
    ${renderWaitingRoomBlock()}
    ${top}${inner}
  </div>`;
}

function statusBlock(level, heading, body) {
  return `<div class="sentinel-status ${level}" style="margin-bottom:12px">
    <div class="status-dot"></div>
    <span class="status-text">${escHtml(heading)}</span>
  </div>
  <p style="font-size:12px;color:var(--text-3);line-height:1.6">${escHtml(body)}</p>`;
}

function formatDate(s) {
  if (!s) return '';
  try { return new Date(s).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}); }
  catch { return s; }
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

