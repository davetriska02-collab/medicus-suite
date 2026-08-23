// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Suite health strip — amber-only DOM-contract degradation.

'use strict';

import { escStrip, makePoller } from './helpers.js';

const HEALTH_POLL_MS = 30 * 1000;
const HEALTH_SNOOZE_KEY = 'health.stripSnooze';
const HEALTH_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export function initStrip(el, bus) {
  const healthStripEl = el;

  async function fetchAndRenderHealthStrip() {
    if (!healthStripEl) return true;
    try {
      const r = await chrome.storage.local.get(['health.contracts', HEALTH_SNOOZE_KEY]);
      const health = r['health.contracts'] || {};
      const DC = window.DomContracts;
      const degradedIds = Object.keys(health)
        .filter((id) => health[id]?.status === 'degraded')
        .sort();
      if (degradedIds.length === 0 || !DC) {
        healthStripEl.className = 'health-strip health-strip-hidden';
        healthStripEl.innerHTML = '';
        return true;
      }
      const sig = degradedIds.join('|');
      const snooze = r[HEALTH_SNOOZE_KEY];
      if (snooze && snooze.sig === sig && typeof snooze.until === 'number' && Date.now() < snooze.until) {
        healthStripEl.className = 'health-strip health-strip-hidden';
        healthStripEl.innerHTML = '';
        return true;
      }
      const features = degradedIds.map((id) => DC.get(id)?.feature || id).filter((f, i, arr) => arr.indexOf(f) === i);
      healthStripEl.className = 'health-strip health-strip-amber';
      healthStripEl.innerHTML = `
      <span class="health-strip-icon">⚠</span>
      <span class="health-strip-text">Medicus may have changed — ${escStrip(features.join(', '))} degraded. Details in Options → Suite health.</span>
      <button class="health-strip-goto">Details →</button>
      <button class="health-strip-dismiss" title="Dismiss for 7 days (reappears if anything new degrades)" aria-label="Dismiss health warning for 7 days">✕</button>
    `;
      healthStripEl.querySelector('.health-strip-goto')?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#sect-health') });
      });
      healthStripEl.querySelector('.health-strip-dismiss')?.addEventListener('click', async () => {
        await chrome.storage.local.set({ [HEALTH_SNOOZE_KEY]: { sig, until: Date.now() + HEALTH_SNOOZE_MS } });
        fetchAndRenderHealthStrip();
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  function onHealth(changes) {
    if (changes['health.contracts']) fetchAndRenderHealthStrip();
  }
  chrome.storage.onChanged.addListener(onHealth);

  const healthPoller = makePoller(fetchAndRenderHealthStrip, HEALTH_POLL_MS, 'health-strip').start();
  if (bus) bus.refreshHealth = () => fetchAndRenderHealthStrip();

  return function cleanup() {
    healthPoller.stop();
    chrome.storage.onChanged.removeListener(onHealth);
  };
}
