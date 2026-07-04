// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';
import { fetchAllStreams } from './condor-data.js';
import { freshnessHtml, attachFreshnessTicker } from '../shared/freshness.js';
import { copyText, downloadCsv } from '../shared/export-util.js';
import { buildSnapshotRow, saveSnapshot, loadSnapshots, localISO } from './report/report-data.js';
import {
  computeIndex as computeIndexCore,
  normaliseIndexConfig,
  isCustomConfig,
  DEFAULT_WEIGHTS,
  DEFAULT_THRESHOLDS,
} from './condor-index-core.js';
// Card renderers loaded dynamically so module works even before card files land

const INDEX_CONFIG_KEY = 'condor.indexConfig';

let _container = null;
let _pollTimer = null;
let _stopFresh = null;
let _lastData = null;
let _snapshotDate = null; // guards the once-a-day Practice Report snapshot write
let _indexConfig = null; // raw stored { weights, thresholds } override, or null = defaults
let _editorOpen = false;
let _pulsePeriod = 7; // Pulse section's 7d/30d toggle — panel-session only, not persisted

// Capture one Practice Report snapshot per calendar day. The live-only metrics
// (PPI / waiting room / task age) have no per-day history at the source, so this
// forward-accruing store is how the report builds their trends over time.
// saveSnapshot also de-dupes by date; the in-session guard avoids redundant writes
// on every 15s poll.
async function captureDailySnapshot(data) {
  const today = localISO();
  if (_snapshotDate === today) return;
  _snapshotDate = today;
  await saveSnapshot(buildSnapshotRow(data, computeIndex(data), today));
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function loadCards() {
  const mods = await Promise.allSettled([
    import('./cards/ppi.js'),
    import('./cards/demand-gap.js'),
    import('./cards/velocity.js'),
    import('./cards/task-age.js'),
    import('./cards/workload.js'),
    import('./cards/waiting-room.js'),
    import('./cards/day-score.js'),
    import('./cards/activity.js'),
    import('./cards/pulse.js'),
  ]);
  const get = (m, fn) => (m.status === 'fulfilled' ? m.value[fn] || (() => '') : () => '');
  return {
    renderPpi: get(mods[0], 'renderPpi'),
    renderDemandGap: get(mods[1], 'renderDemandGap'),
    renderVelocity: get(mods[2], 'renderVelocity'),
    renderTaskAge: get(mods[3], 'renderTaskAge'),
    renderWorkload: get(mods[4], 'renderWorkload'),
    renderWaitingRoom: get(mods[5], 'renderWaitingRoom'),
    renderDayScore: get(mods[6], 'renderDayScore'),
    saveDayScore: mods[6].status === 'fulfilled' ? mods[6].value.saveDayScore || (async () => {}) : async () => {},
    renderActivity: get(mods[7], 'renderActivity'),
    renderPulse: get(mods[8], 'renderPulse'),
  };
}

// Single source of truth for the Practice Pressure Index, its band, and the
// demand-vs-capacity reconciliation. Both the headline strip and the copied
// snapshot read from this so the panel can never contradict itself.
//
// The actual index/band math (including the component weightings and the
// AMBER/RED band thresholds — item 8, user-tunable via the cog on the meter)
// lives in condor-index-core.js, a pure module shared with ppi.js and
// practice-report.js so the three can never quietly diverge. This wrapper
// just threads the module's in-memory _indexConfig (loaded from
// chrome.storage.local['condor.indexConfig']) through to it.
//
// Band-floor (the fix the synthetic GP-practice panel flagged): the raw index
// weights capacity at only 20% by default (and 0% when no capacity preset is
// set), so the gauge could read "GREEN · 25/100" on the same screen as "Over
// capacity (115 requests vs 50 slots)". When demand meets or exceeds the
// available slots, the *displayed* band is floored to at least AMBER. The
// numeric ppi is left as-is — only the band (and therefore colour + label) is
// raised. This only ever RAISES a signal, never lowers one, so no alert
// salience is lost — and per item 8's hard safety rule, this floor is NOT
// configurable: it is applied unconditionally inside condor-index-core.js
// AFTER any custom weightings/thresholds (see test-condor-index-core.js).
export function computeIndex(data) {
  return computeIndexCore(data, _indexConfig);
}

const CAPACITY_LABEL = { none: 'Within capacity', at: 'At capacity', over: 'Over capacity' };

function buildSnapshot(data) {
  const idx = computeIndex(data);
  const submissionsTotal = data.submissions?.totals?.all ?? 0;

  // Hard "as at HH:MM" timestamp so figures pasted into a partners' meeting are
  // defensible — the reader can always see exactly when the snapshot was taken.
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const bandText = idx.floored ? `${idx.band} (floored from ${idx.rawBand})` : idx.band;
  // Item 8: when the user has tuned the component weightings/band thresholds
  // away from the shipped defaults, the copied figures must say so — a PPI
  // pasted into a partners' meeting without this note would misleadingly
  // read as the standard, comparable index.
  const customNote = idx.isCustom ? ' (custom weightings)' : '';
  return [
    `Condor snapshot — as at ${now}`,
    `PPI\t${idx.ppi}/100 (${bandText})${customNote}`,
    `Demand (medical + admin)\t${idx.demandCount}`,
    `Capacity (slots free)\t${idx.capacityCount}\t${CAPACITY_LABEL[idx.capacityState]}`,
    `Waiting room arrived\t${idx.arrivedCount}`,
    `Urgent\t${idx.urgentCount}`,
    `Submissions total today\t${submissionsTotal}`,
  ].join('\n');
}

// Same figures as buildSnapshot, shaped for a CSV file (power-user finding R4:
// a clipboard dump can't be scripted/archived — this is a real downloadable file).
function buildSnapshotCsv(data) {
  const idx = computeIndex(data);
  const submissionsTotal = data.submissions?.totals?.all ?? 0;
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const bandText = idx.floored ? `${idx.band} (floored from ${idx.rawBand})` : idx.band;
  const ppiNote = idx.isCustom ? `${bandText} — custom weightings` : bandText;
  const header = ['Metric', 'Value', 'Note'];
  const rows = [
    ['Snapshot as at', now, ''],
    ['PPI', `${idx.ppi}/100`, ppiNote],
    ['Demand (medical + admin)', idx.demandCount, ''],
    ['Capacity (slots free)', idx.capacityCount, CAPACITY_LABEL[idx.capacityState]],
    ['Waiting room arrived', idx.arrivedCount, ''],
    ['Urgent', idx.urgentCount, ''],
    ['Submissions total today', submissionsTotal, ''],
  ];
  return { header, rows };
}

// Leading component line — so the user reads "Demand 115 · Capacity 50 · Over
// capacity" with the (floored) band colour BEFORE the green-looking dial, rather
// than trusting a gauge that under-weights capacity.
function buildHeadlineStrip(data) {
  const idx = computeIndex(data);
  const cls =
    idx.band === 'RED'
      ? 'condor-headline-red'
      : idx.band === 'AMBER'
        ? 'condor-headline-amber'
        : 'condor-headline-green';
  const capLabel = CAPACITY_LABEL[idx.capacityState];
  const flooredNote = idx.floored
    ? ` <span class="condor-headline-note">— band raised to ${esc(idx.band)} by capacity</span>`
    : '';
  const customNote = idx.isCustom ? ` <span class="condor-headline-note">— custom weightings</span>` : '';
  return (
    `<div class="condor-headline ${cls}">` +
    `<span class="condor-headline-band">${esc(idx.band)}</span>` +
    `<span class="condor-headline-figs">Demand ${esc(idx.demandCount)} <span class="condor-headline-qual">(med + admin)</span> · Capacity ${esc(idx.capacityCount)} · ${esc(capLabel)}</span>` +
    flooredNote +
    customNote +
    `</div>`
  );
}

// An unconfigured/optional or empty-but-not-broken card should read as a quiet
// strip, not a full-size error or a dead data feed. Cards we can't edit return a
// `.condor-placeholder` element (or a bare-zero workload). We detect those known
// states by their text and add `condor-quiet` so the CSS collapses them to a thin
// muted line. This NEVER touches alert/error placeholders (auth failures etc.).
const QUIET_PATTERNS = [
  /not configured/i, // task inbox / request monitor not set up
  /enable .* in settings/i,
  /score available after/i, // day score before 17:00
];
function demoteOptionalCards(html) {
  // Quieten optional placeholders by their reassuring "set this up" wording,
  // leaving genuine-failure placeholders ("unavailable", "Failed to load",
  // "check Medicus sign-in") at full size so they keep their salience.
  let out = html.replace(/<div class="condor-card condor-placeholder">([\s\S]*?)<\/div>/g, (m, inner) => {
    if (QUIET_PATTERNS.some((re) => re.test(inner))) {
      return `<div class="condor-card condor-placeholder condor-quiet">${inner}</div>`;
    }
    return m;
  });
  // Day Score before 17:00 is a normal optional state ("Score available after
  // 17:00"), not a placeholder card — quieten its outer card too.
  if (/condor-ds-pending/.test(out)) {
    out = out.replace(/<div class="condor-card condor-ds">/, '<div class="condor-card condor-ds condor-quiet">');
  }
  return out;
}

// The workload card shows bare "total 0 · consults 0" both when no consults have
// happened yet today and when nothing is loading — which reads as a dead feed.
// Make the zero state self-explaining (and quiet) without editing the card file.
function clarifyWorkload(html, data) {
  const act = data.activity;
  if (!act) return html; // unavailable placeholder handled by demoteOptionalCards
  const totalAll = act.totals?.all ?? 0;
  const noRows = !Array.isArray(act.rows) || act.rows.length === 0;
  if (totalAll !== 0 && !noRows) return html; // real data — leave alone
  // Replace the bare "Practice total: 0 · Consults: 0" line with a clear,
  // quiet "no consults yet today" reading and mark the card quiet.
  return html
    .replace(/<div class="condor-card condor-wl">/, '<div class="condor-card condor-wl condor-quiet">')
    .replace(
      /<div class="condor-wl-totals">[\s\S]*?<\/div>/,
      '<div class="condor-wl-totals condor-wl-empty">No consults logged yet today.</div>'
    );
}

// ── Tunable pressure-index weightings & band thresholds (item 8) ────────────
//
// A cog on the meter opens an inline editor for the four component weightings
// (waiting room / queue / urgent / capacity) and the AMBER/RED band
// thresholds. Defaults are always visible (placeholder text on empty inputs),
// "Reset to defaults" clears the stored override in one click, and every
// input is clamped by condor-index-core.js's normaliseIndexConfig — this UI
// never needs to validate, only pass raw values through. The capacity SAFETY
// FLOOR itself is not exposed here at all: it is not a configurable field,
// it is unconditional logic inside condor-index-core.js (see that file's doc
// comment + test-condor-index-core.js).
const SVG_COG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

function renderIndexCog() {
  const custom = isCustomConfig(_indexConfig);
  return `<button class="condor-index-cog${custom ? ' condor-index-cog--custom' : ''}" id="condorIndexCog"
    aria-expanded="${_editorOpen}" aria-label="Tune pressure-index weightings and band thresholds"
    title="${custom ? 'Custom weightings active — tune weightings and band thresholds' : 'Tune weightings and band thresholds'}">
    ${SVG_COG}${custom ? '<span class="condor-index-cog-dot" aria-hidden="true"></span>' : ''}
  </button>`;
}

// Numeric input row: label, a number field pre-filled with the CURRENT
// (normalised) value, and the shipped default shown alongside so "what was
// this originally" never requires memory or a second screen.
function editorRow(id, label, value, defaultValue, { min, max, step } = {}) {
  return `
    <div class="condor-idx-row">
      <label class="condor-idx-label" for="${id}">${esc(label)}</label>
      <input type="number" id="${id}" class="condor-idx-input" value="${esc(value)}"
        min="${min}" max="${max}" step="${step ?? 'any'}" />
      <span class="condor-idx-default">default ${esc(defaultValue)}</span>
    </div>`;
}

function renderIndexEditor() {
  const cfg = normaliseIndexConfig(_indexConfig);
  const custom = isCustomConfig(_indexConfig);
  return `
    <div class="condor-idx-editor" id="condorIndexEditor">
      <div class="condor-idx-editor-head">
        <span class="condor-idx-editor-title">Pressure-index weightings</span>
        <button class="ghost-btn condor-idx-close" id="condorIdxClose" aria-label="Close editor">✕</button>
      </div>
      <p class="condor-idx-editor-note">
        Component weightings should add to 1.0 for the index to stay on a 0–100 scale — they are not
        forced to, but the numbers stop reading as a "score out of 100" if they don't.
      </p>
      <div class="condor-idx-group">
        ${editorRow('condorIdxWr', 'Waiting room', cfg.weights.waitingRoom, DEFAULT_WEIGHTS.waitingRoom, { min: 0, max: 1, step: 0.05 })}
        ${editorRow('condorIdxQueue', 'Request queue', cfg.weights.queue, DEFAULT_WEIGHTS.queue, { min: 0, max: 1, step: 0.05 })}
        ${editorRow('condorIdxUrgent', 'Urgent', cfg.weights.urgent, DEFAULT_WEIGHTS.urgent, { min: 0, max: 1, step: 0.05 })}
        ${editorRow('condorIdxCapacity', 'Capacity', cfg.weights.capacity, DEFAULT_WEIGHTS.capacity, { min: 0, max: 1, step: 0.05 })}
      </div>
      <div class="condor-idx-editor-title condor-idx-editor-title--sub">Band thresholds</div>
      <div class="condor-idx-group">
        ${editorRow('condorIdxAmber', 'AMBER from', cfg.thresholds.amber, DEFAULT_THRESHOLDS.amber, { min: 1, max: 99, step: 1 })}
        ${editorRow('condorIdxRed', 'RED from', cfg.thresholds.red, DEFAULT_THRESHOLDS.red, { min: 1, max: 99, step: 1 })}
      </div>
      <p class="condor-idx-editor-safety">
        The capacity safety floor (never GREEN while over capacity) always applies and is not
        editable here.
      </p>
      <div class="condor-idx-editor-actions">
        <button class="ghost-btn" id="condorIdxReset"${custom ? '' : ' disabled'}>Reset to defaults</button>
        <button class="ghost-btn condor-idx-save" id="condorIdxSave">Save</button>
      </div>
    </div>`;
}

function readEditorConfig() {
  const val = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : undefined;
  };
  return {
    weights: {
      waitingRoom: val('condorIdxWr'),
      queue: val('condorIdxQueue'),
      urgent: val('condorIdxUrgent'),
      capacity: val('condorIdxCapacity'),
    },
    thresholds: {
      amber: val('condorIdxAmber'),
      red: val('condorIdxRed'),
    },
  };
}

async function saveIndexConfig(rawConfig) {
  // Persist the NORMALISED (clamped, validated) config, not raw input — so a
  // stray "999" typed into a field never lands in storage un-clamped, and the
  // stored shape is always exactly what normaliseIndexConfig() will reproduce.
  const normalised = normaliseIndexConfig(rawConfig);
  _indexConfig = normalised;
  await chrome.storage.local.set({ [INDEX_CONFIG_KEY]: normalised });
}

async function clearIndexConfig() {
  _indexConfig = null;
  await chrome.storage.local.remove(INDEX_CONFIG_KEY);
}

function bindIndexEditor() {
  if (!_container) return;
  _container.querySelector('#condorIndexCog')?.addEventListener('click', () => {
    _editorOpen = !_editorOpen;
    poll();
  });
  _container.querySelector('#condorIdxClose')?.addEventListener('click', () => {
    _editorOpen = false;
    poll();
  });
  _container.querySelector('#condorIdxSave')?.addEventListener('click', async () => {
    await saveIndexConfig(readEditorConfig());
    _editorOpen = false;
    poll();
  });
  _container.querySelector('#condorIdxReset')?.addEventListener('click', async () => {
    await clearIndexConfig();
    _editorOpen = false;
    poll();
  });
}

async function poll() {
  if (!_container) return;
  try {
    const data = await fetchAllStreams();
    _lastData = data;
    const cards = await loadCards();
    if (!_container) return;
    // Pulse reads the full forward-accruing snapshot store (independent of today's live
    // `data`) — reloaded each poll so a newly-captured daily snapshot (captureDailySnapshot,
    // below) appears without needing a panel reopen.
    const snapshotHistory = await loadSnapshots();
    const headline = buildHeadlineStrip(data);
    const waitingDemand = demoteOptionalCards(`${cards.renderWaitingRoom(data)}${cards.renderDemandGap(data)}`);
    const velocityAge = demoteOptionalCards(`${cards.renderVelocity(data)}${cards.renderTaskAge(data)}`);
    const workload = clarifyWorkload(demoteOptionalCards(cards.renderWorkload(data)), data);
    const footer = demoteOptionalCards(`${cards.renderDayScore(data)}${cards.renderActivity(data)}`);
    const pulse = cards.renderPulse(snapshotHistory, _pulsePeriod);
    _container.innerHTML = `
      <div class="condor-wrap">
        ${headline}
        <div class="condor-hero">
          ${cards.renderPpi(data, _indexConfig)}
          ${renderIndexCog()}
          ${_editorOpen ? renderIndexEditor() : ''}
        </div>
        <div class="condor-ts">
          ${freshnessHtml(new Date(), { label: 'Live · updated', staleMs: 90000 })}
          <span class="condor-asat">as at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          <button class="ghost-btn condor-copy-btn" id="condorCopyBtn">Copy figures</button>
          <button class="ghost-btn condor-copy-btn" id="condorCsvBtn" title="Download these figures as a CSV file">↓ CSV</button>
        </div>
        <div class="condor-report-strip">
          <span class="condor-report-label">Practice report</span>
          <button class="ghost-btn condor-report-btn" data-preset="today">Today</button>
          <button class="ghost-btn condor-report-btn" data-preset="7d">7 days</button>
          <button class="ghost-btn condor-report-btn" data-preset="30d">30 days</button>
          <button class="ghost-btn condor-report-btn condor-report-full" data-preset="7d">Open full report →</button>
        </div>
        <div class="condor-grid">
          <div class="condor-col">${waitingDemand}</div>
          <div class="condor-col condor-col-wide">${velocityAge}</div>
          <div class="condor-col">${workload}</div>
        </div>
        <div class="condor-footer">${footer}${pulse}</div>
      </div>
    `;
    bindIndexEditor();
    cards.saveDayScore(data).catch(() => {});
    captureDailySnapshot(data).catch(() => {});
  } catch (e) {
    if (_container) {
      _container.innerHTML = `<div class="condor-placeholder">Failed to load: ${esc(e.message || e)}</div>`;
    }
  }
}

function onIndexConfigChange(changes) {
  if (!changes[INDEX_CONFIG_KEY] || !_container) return;
  _indexConfig = changes[INDEX_CONFIG_KEY].newValue ?? null;
  poll();
}

export async function init(el) {
  _container = el;
  _container.innerHTML = '<div class="condor-loading">Loading Condor…</div>';
  _editorOpen = false;
  _pulsePeriod = 7;

  // Item 8: load the user's custom weightings/thresholds (if any) before the
  // first poll so the very first render already reflects them.
  const stored = await chrome.storage.local.get(INDEX_CONFIG_KEY);
  _indexConfig = stored[INDEX_CONFIG_KEY] ?? null;
  chrome.storage.onChanged.addListener(onIndexConfigChange);

  // Delegated click for "Set up now" buttons rendered inside cards
  _container.addEventListener('click', (e) => {
    if (!e.target.classList.contains('setup-now-btn')) return;
    if (document.getElementById('setupHost')) {
      document.dispatchEvent(new CustomEvent('suite:open-setup'));
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sect-suite') });
    }
  });

  // Delegated click for the Practice Report launcher — opens the full report page
  // (a browser tab, like the visualiser) at the chosen period.
  _container.addEventListener('click', (e) => {
    const rb = e.target.closest('.condor-report-btn');
    if (!rb) return;
    const preset = rb.dataset.preset || '7d';
    chrome.tabs.create({
      url: chrome.runtime.getURL(`practice-report.html?preset=${encodeURIComponent(preset)}`),
    });
  });

  // Delegated click for the Pulse 7d/30d toggle — wired once here because poll() replaces
  // innerHTML; re-polls so the toggle also picks up any snapshot captured since page load.
  _container.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-pulse-period]');
    if (!tb) return;
    const period = Number(tb.dataset.pulsePeriod) === 30 ? 30 : 7;
    if (period === _pulsePeriod) return;
    _pulsePeriod = period;
    poll();
  });

  // Delegated click for "Copy figures" — wired once here because poll() replaces innerHTML
  _container.addEventListener('click', async (e) => {
    const csvBtn = e.target.closest('#condorCsvBtn');
    if (csvBtn && _lastData) {
      const { header, rows } = buildSnapshotCsv(_lastData);
      downloadCsv(`condor-snapshot-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
      return;
    }
    const btn = e.target.closest('#condorCopyBtn');
    if (!btn || !_lastData) return;
    const ok = await copyText(buildSnapshot(_lastData));
    if (ok) {
      const orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => {
        btn.textContent = orig;
      }, 1500);
    }
  });

  await poll();
  _stopFresh = attachFreshnessTicker(_container);

  _pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') poll();
  }, 15000);

  return cleanup;
}

export function cleanup() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
  if (_stopFresh) {
    _stopFresh();
    _stopFresh = null;
  }
  chrome.storage.onChanged.removeListener(onIndexConfigChange);
  _container = null;
}
