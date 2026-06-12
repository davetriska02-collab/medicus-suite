// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
'use strict';
import { fetchAllStreams } from './condor-data.js';
// Card renderers loaded dynamically so module works even before card files land

let _container = null;
let _pollTimer = null;

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

async function poll() {
  if (!_container) return;
  try {
    const data = await fetchAllStreams();
    const cards = await loadCards();
    if (!_container) return;
    const updatedAt = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    _container.innerHTML = `
      <div class="condor-wrap">
        <div class="condor-hero">${cards.renderPpi(data)}</div>
        <div class="condor-ts">Live · updated ${esc(updatedAt)}</div>
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

  await poll();

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
  _container = null;
}
