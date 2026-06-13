// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';
import { fetchAllStreams } from './condor-data.js';
import { freshnessHtml, attachFreshnessTicker } from '../shared/freshness.js';
import { copyText } from '../shared/export-util.js';
// Card renderers loaded dynamically so module works even before card files land

let _container = null;
let _pollTimer = null;
let _stopFresh = null;
let _lastData = null;

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

function buildSnapshot(data) {
  const arrivedCount = data.waitingRoom?.arrivedCount ?? 0;
  const medical = data.submissions?.totals?.medical ?? 0;
  const admin = data.submissions?.totals?.admin ?? 0;
  const queueCount = medical + admin;
  const urgentCount = data.requestMonitor?.urgentCount ?? 0;
  const remaining = data.slots?.totalRemaining ?? 0;
  const minimum = data.capacityPreset?.minimum ?? 0;
  const submissionsTotal = data.submissions?.totals?.all ?? 0;

  const scoreA = Math.min((arrivedCount / 10) * 100, 100);
  const scoreB = Math.min((queueCount / 40) * 100, 100);
  const scoreC = Math.min((urgentCount / 5) * 100, 100);
  let scoreD = 0;
  if (minimum !== 0) {
    const deficit = Math.max(0, minimum - remaining);
    scoreD = Math.min((deficit / minimum) * 100, 100);
  }
  const ppi = Math.round(scoreA * 0.3 + scoreB * 0.25 + scoreC * 0.25 + scoreD * 0.2);
  const band = ppi < 40 ? 'GREEN' : ppi < 70 ? 'AMBER' : 'RED';

  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return [
    `Condor snapshot — ${now}`,
    `PPI\t${ppi}/100 (${band})`,
    `Waiting room arrived\t${arrivedCount}`,
    `Request queue (medical + admin)\t${queueCount}`,
    `Urgent\t${urgentCount}`,
    `Slots remaining\t${remaining}`,
    `Submissions total today\t${submissionsTotal}`,
  ].join('\n');
}

async function poll() {
  if (!_container) return;
  try {
    const data = await fetchAllStreams();
    _lastData = data;
    const cards = await loadCards();
    if (!_container) return;
    _container.innerHTML = `
      <div class="condor-wrap">
        <div class="condor-hero">${cards.renderPpi(data)}</div>
        <div class="condor-ts">
          ${freshnessHtml(new Date(), { label: 'Live · updated', staleMs: 90000 })}
          <button class="ghost-btn condor-copy-btn" id="condorCopyBtn">Copy figures</button>
        </div>
        <div class="condor-grid">
          <div class="condor-col">${cards.renderWaitingRoom(data)}${cards.renderDemandGap(data)}</div>
          <div class="condor-col condor-col-wide">${cards.renderVelocity(data)}${cards.renderTaskAge(data)}</div>
          <div class="condor-col">${cards.renderWorkload(data)}</div>
        </div>
        <div class="condor-footer">${cards.renderDayScore(data)}${cards.renderActivity(data)}</div>
      </div>
    `;
    cards.saveDayScore(data).catch(() => {});
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
