// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Waiting-room demand strip + Monitoring action-count badge on its goto button.

'use strict';

import { STATUS_RANK } from '../modules/sentinel/sentinel-core.js';
import { escStrip, makePoller } from './helpers.js';

const WR_POLL_MS = 30 * 1000;
const DEFAULT_WR_THRESHOLDS = { amber: 10, red: 20 };

export function initStrip(el, bus) {
  const wrStripEl = el;
  let _wrPrevHtml = null;
  let _wrThresholds = { ...DEFAULT_WR_THRESHOLDS };
  let wrPoller = null;
  let _sentBadgeTimer = null;
  let _sentBadgeActionCount = null;
  let _sentBadgeHasRed = false;

  function _sanitiseWrThresholds(raw) {
    const d = DEFAULT_WR_THRESHOLDS;
    if (!raw || typeof raw !== 'object') return { ...d };
    const amber = Number.isFinite(raw.amber) && raw.amber > 0 ? Math.round(raw.amber) : d.amber;
    const red = Number.isFinite(raw.red) && raw.red > 0 ? Math.round(raw.red) : d.red;
    return red >= amber ? { amber, red } : { ...d };
  }

  chrome.storage.local.get('suite.waitingRoom.thresholds').then((r) => {
    _wrThresholds = _sanitiseWrThresholds(r['suite.waitingRoom.thresholds']);
  });

  function onThresholds(changes) {
    if ('suite.waitingRoom.thresholds' in changes) {
      _wrThresholds = _sanitiseWrThresholds(changes['suite.waitingRoom.thresholds'].newValue);
      fetchAndRenderStrip(true);
    }
  }
  chrome.storage.onChanged.addListener(onThresholds);

  async function fetchAndRenderStrip(bypassCache = false) {
    if (document.visibilityState !== 'visible') return true;
    try {
      const { raw, code } = await window.AppointmentsFeed.fetchRaw({ module: 'panel-wr-strip', bypassCache });
      if (!code) {
        if (wrStripEl) {
          wrStripEl.className = 'wr-strip wr-strip-hidden';
          wrStripEl.innerHTML = '';
        }
        return true;
      }
      const arrived = window.AppointmentsFeed.arrivedEntries(raw)
        .map((e) => ({
          name: e.patient?.name ?? 'Unknown',
          start: e.start ?? '',
          startDateTime: e.startDateTime ?? null,
          minutesWaiting: calcStripWait(e.startDateTime),
        }))
        .sort((a, b) => (a.start < b.start ? -1 : 1));

      renderStrip(arrived);
      updateStripBadge(arrived.length);
      return true;
    } catch (_) {
      return false;
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
      bus.reportAlert('waiting', null);
      _wrPrevHtml = null;
      applySentinelBadgeToDom(_sentBadgeActionCount, _sentBadgeHasRed);
      return;
    }

    const maxWait = Math.max(...patients.map((p) => p.minutesWaiting ?? 0));
    const T = _wrThresholds;
    const urgency = maxWait >= T.red ? 'red' : maxWait >= T.amber ? 'amber' : 'green';

    const shown = patients.slice(0, 3);
    const extra = patients.length - shown.length;
    const chips = shown
      .map((p) => {
        const mins = p.minutesWaiting;
        const cls =
          mins != null && mins >= T.red
            ? 'wr-chip-red'
            : mins != null && mins >= T.amber
              ? 'wr-chip-amber'
              : 'wr-chip-ok';
        const wait = mins != null ? ` · ${mins}m` : '';
        return `<span class="wr-chip ${cls}">${escStrip(p.name)}${wait}</span>`;
      })
      .join('');
    const extraChip = extra > 0 ? `<span class="wr-chip wr-chip-more">+${extra} more</span>` : '';

    wrStripEl.className = `wr-strip wr-strip-${urgency}`;
    const wrHtml = `
    <span class="wr-strip-icon">🚶</span>
    <span class="wr-strip-count">${patients.length} waiting</span>
    <span class="wr-strip-chips">${chips}${extraChip}</span>
    <button class="wr-strip-goto" title="Go to Monitoring">Monitoring →</button>
  `;
    if (wrHtml === _wrPrevHtml && wrStripEl.firstElementChild) {
      return;
    }
    _wrPrevHtml = wrHtml;
    wrStripEl.innerHTML = wrHtml;

    wrStripEl.querySelector('.wr-strip-goto')?.addEventListener('click', () => {
      bus.switchModule('sentinel');
      document.querySelector('[data-module="sentinel"]')?.scrollIntoView({ behavior: 'smooth', inline: 'nearest' });
    });
    applySentinelBadgeToDom(_sentBadgeActionCount, _sentBadgeHasRed);

    bus.reportAlert('waiting', {
      level: urgency,
      label: 'Waiting',
      count: patients.length,
      meta: maxWait > 0 ? maxWait + 'm' : null,
      title:
        `Waiting room: ${patients.length} patient${patients.length === 1 ? '' : 's'} arrived` +
        (maxWait > 0 ? `, longest waiting ${maxWait} min` : '') +
        (urgency === 'red' ? ` (red ≥${T.red} min)` : urgency === 'amber' ? ` (amber ≥${T.amber} min)` : ''),
    });
  }

  let _badgeEnabled = true;
  chrome.storage.local.get('suite.notifications').then((r) => {
    const prefs = r['suite.notifications'] || {};
    _badgeEnabled = prefs.badgeEnabled !== false;
  });
  function onBadgePrefs(changes) {
    if (changes['suite.notifications']) {
      const prefs = changes['suite.notifications'].newValue || {};
      _badgeEnabled = prefs.badgeEnabled !== false;
      if (!_badgeEnabled) chrome.action.setBadgeText({ text: '' });
    }
  }
  chrome.storage.onChanged.addListener(onBadgePrefs);

  function updateStripBadge(count) {
    if (!_badgeEnabled || count <= 0) {
      chrome.action.setBadgeText({ text: '' });
    } else {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    }
  }

  function scheduleSentinelBadgeUpdate() {
    if (_sentBadgeTimer) return;
    _sentBadgeTimer = setTimeout(() => {
      _sentBadgeTimer = null;
      updateSentinelBadge();
    }, 400);
  }

  async function updateSentinelBadge() {
    let chips = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (tab?.id && tab?.url && /medicus\.health/.test(tab.url)) {
        const snapshot = await chrome.tabs.sendMessage(tab.id, { action: 'getSentinelSnapshot' });
        if (snapshot && !snapshot.unavailable && Array.isArray(snapshot.chips)) {
          chips = snapshot.chips;
        }
      }
    } catch (_) {
      /* chips stays null */
    }
    const actionCount = chips ? chips.filter((c) => STATUS_RANK[c.status] <= 2).length : null;
    const hasRed = chips ? chips.some((c) => STATUS_RANK[c.status] === 0) : false;
    applySentinelBadgeToDom(actionCount, hasRed);
  }

  function applySentinelBadgeToDom(actionCount, hasRed) {
    _sentBadgeActionCount = actionCount;
    _sentBadgeHasRed = hasRed;

    const gotoBtn = wrStripEl?.querySelector('.wr-strip-goto');
    if (gotoBtn) {
      let chip = gotoBtn.querySelector('.wr-strip-goto-count');
      if (actionCount) {
        if (!chip) {
          chip = document.createElement('span');
          chip.className = 'wr-strip-goto-count';
          gotoBtn.appendChild(chip);
        }
        chip.textContent = `· ${actionCount}`;
        chip.classList.toggle('wr-strip-goto-count-red', hasRed);
        chip.classList.toggle('wr-strip-goto-count-amber', !hasRed);
      } else if (chip) {
        chip.remove();
      }
    }

    const navTab = document.querySelector('[data-module="sentinel"]');
    if (!navTab) return;
    let badge = navTab.querySelector('.nav-badge');
    if (actionCount && !gotoBtn) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-badge';
        navTab.appendChild(badge);
      }
      badge.textContent = String(actionCount);
      badge.classList.toggle('nav-badge-red', hasRed);
      badge.classList.toggle('nav-badge-amber', !hasRed);
      badge.style.display = '';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  const onTabsActivated = () => scheduleSentinelBadgeUpdate();
  chrome.tabs.onActivated.addListener(onTabsActivated);

  const onRuntimeMsg = bus.SuiteMessages.gatedListener((msg) => {
    if (msg?.type === 'waiting:refresh') fetchAndRenderStrip(true);
    if (msg?.type === 'sentinel:snapshot-updated') scheduleSentinelBadgeUpdate();
  });
  chrome.runtime.onMessage.addListener(onRuntimeMsg);

  wrPoller = makePoller(fetchAndRenderStrip, WR_POLL_MS, 'wr-strip').start();
  updateSentinelBadge();

  bus.refreshWaiting = () => fetchAndRenderStrip();

  return function cleanup() {
    if (wrPoller) wrPoller.stop();
    if (_sentBadgeTimer) clearTimeout(_sentBadgeTimer);
    chrome.storage.onChanged.removeListener(onThresholds);
    chrome.storage.onChanged.removeListener(onBadgePrefs);
    chrome.tabs.onActivated.removeListener(onTabsActivated);
    chrome.runtime.onMessage.removeListener(onRuntimeMsg);
  };
}
