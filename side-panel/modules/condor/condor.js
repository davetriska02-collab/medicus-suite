// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';
import { fetchAllStreams } from './condor-data.js';
import { freshnessHtml, attachFreshnessTicker } from '../shared/freshness.js';
import { copyText } from '../shared/export-util.js';
import { buildSnapshotRow, saveSnapshot, localISO } from './report/report-data.js';
// Card renderers loaded dynamically so module works even before card files land

let _container = null;
let _pollTimer = null;
let _stopFresh = null;
let _lastData = null;
let _snapshotDate = null; // guards the once-a-day Practice Report snapshot write

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
  };
}

// Single source of truth for the Practice Pressure Index, its band, and the
// demand-vs-capacity reconciliation. Both the headline strip and the copied
// snapshot read from this so the panel can never contradict itself.
//
// Band-floor (the fix the synthetic GP-practice panel flagged): the raw index
// weights capacity at only 20% (and 0% when no capacity preset is set), so the
// gauge could read "GREEN · 25/100" on the same screen as "Over capacity (115
// requests vs 50 slots)". When demand meets or exceeds the available slots, the
// *displayed* band is floored to at least AMBER. The numeric ppi is left as-is —
// only the band (and therefore colour + label) is raised. This only ever RAISES
// a signal, never lowers one, so no alert salience is lost.
export function computeIndex(data) {
  const arrivedCount = data.waitingRoom?.arrivedCount ?? 0;
  const medical = data.submissions?.totals?.medical ?? 0;
  const admin = data.submissions?.totals?.admin ?? 0;
  const queueCount = medical + admin;
  const urgentCount = data.requestMonitor?.urgentCount ?? 0;
  const remaining = data.slots?.totalRemaining ?? 0;
  const minimum = data.capacityPreset?.minimum ?? 0;

  const scoreA = Math.min((arrivedCount / 10) * 100, 100);
  const scoreB = Math.min((queueCount / 40) * 100, 100);
  const scoreC = Math.min((urgentCount / 5) * 100, 100);
  let scoreD = 0;
  if (minimum !== 0) {
    const deficit = Math.max(0, minimum - remaining);
    scoreD = Math.min((deficit / minimum) * 100, 100);
  }
  const ppi = Math.round(scoreA * 0.3 + scoreB * 0.25 + scoreC * 0.25 + scoreD * 0.2);

  // Capacity-deficit signal — mirrors demand-gap.js exactly (requests vs slots).
  // "over limit" = demand has met or passed the free slots; "over" (vs "at") at
  // the 1.5× point matches the card's "Over capacity"/"At capacity" split.
  let capacityState; // 'none' | 'at' | 'over'
  if (remaining === 0 && queueCount > 0) {
    capacityState = 'over'; // no slots left with demand still arriving
  } else if (remaining > 0) {
    const ratio = queueCount / remaining;
    capacityState = ratio >= 1.5 ? 'over' : ratio >= 1.0 ? 'at' : 'none';
  } else {
    capacityState = 'none';
  }
  const overCapacity = capacityState !== 'none';

  const rawBand = ppi < 40 ? 'GREEN' : ppi < 70 ? 'AMBER' : 'RED';
  // Floor to at least AMBER when over the capacity limit — never GREEN.
  const band = overCapacity && rawBand === 'GREEN' ? 'AMBER' : rawBand;
  const floored = band !== rawBand;

  return {
    ppi,
    band,
    rawBand,
    floored,
    demandCount: queueCount,
    capacityCount: remaining,
    capacityState,
    overCapacity,
    arrivedCount,
    urgentCount,
    minimum,
  };
}

const CAPACITY_LABEL = { none: 'Within capacity', at: 'At capacity', over: 'Over capacity' };

function buildSnapshot(data) {
  const idx = computeIndex(data);
  const submissionsTotal = data.submissions?.totals?.all ?? 0;

  // Hard "as at HH:MM" timestamp so figures pasted into a partners' meeting are
  // defensible — the reader can always see exactly when the snapshot was taken.
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const bandText = idx.floored ? `${idx.band} (floored from ${idx.rawBand})` : idx.band;
  return [
    `Condor snapshot — as at ${now}`,
    `PPI\t${idx.ppi}/100 (${bandText})`,
    `Demand (medical + admin)\t${idx.demandCount}`,
    `Capacity (slots free)\t${idx.capacityCount}\t${CAPACITY_LABEL[idx.capacityState]}`,
    `Waiting room arrived\t${idx.arrivedCount}`,
    `Urgent\t${idx.urgentCount}`,
    `Submissions total today\t${submissionsTotal}`,
  ].join('\n');
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
  return (
    `<div class="condor-headline ${cls}">` +
    `<span class="condor-headline-band">${esc(idx.band)}</span>` +
    `<span class="condor-headline-figs">Demand ${esc(idx.demandCount)} · Capacity ${esc(idx.capacityCount)} · ${esc(capLabel)}</span>` +
    flooredNote +
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

async function poll() {
  if (!_container) return;
  try {
    const data = await fetchAllStreams();
    _lastData = data;
    const cards = await loadCards();
    if (!_container) return;
    const headline = buildHeadlineStrip(data);
    const waitingDemand = demoteOptionalCards(`${cards.renderWaitingRoom(data)}${cards.renderDemandGap(data)}`);
    const velocityAge = demoteOptionalCards(`${cards.renderVelocity(data)}${cards.renderTaskAge(data)}`);
    const workload = clarifyWorkload(demoteOptionalCards(cards.renderWorkload(data)), data);
    const footer = demoteOptionalCards(`${cards.renderDayScore(data)}${cards.renderActivity(data)}`);
    _container.innerHTML = `
      <div class="condor-wrap">
        ${headline}
        <div class="condor-hero">${cards.renderPpi(data)}</div>
        <div class="condor-ts">
          ${freshnessHtml(new Date(), { label: 'Live · updated', staleMs: 90000 })}
          <button class="ghost-btn condor-copy-btn" id="condorCopyBtn">Copy figures</button>
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
        <div class="condor-footer">${footer}</div>
      </div>
    `;
    cards.saveDayScore(data).catch(() => {});
    captureDailySnapshot(data).catch(() => {});
  } catch (e) {
    if (_container) {
      _container.innerHTML = `<div class="condor-placeholder">Failed to load: ${esc(e.message || e)}</div>`;
    }
  }
}

export async function init(el) {
  _container = el;
  _container.innerHTML = '<div class="condor-loading">Loading Condor…</div>';

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

  // Delegated click for "Copy figures" — wired once here because poll() replaces innerHTML
  _container.addEventListener('click', async (e) => {
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
  _container = null;
}
