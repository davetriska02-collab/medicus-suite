// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Patient Alerts strip — practice flags for the patient open in Medicus.

'use strict';

import {
  findEntryForPatient,
  maxSeverity as paMaxSeverity,
  sortAlerts as paSortAlerts,
} from '../modules/patient-alerts/patient-alerts-core.js';
import { escStrip, makePoller } from './helpers.js';

const PA_STRIP_POLL_MS = 60 * 1000;

export function initStrip(el, bus) {
  const paStripEl = el;
  let _paStripPrevSig = null;
  let _paStripStore = null;
  let _paStripDebounce = null;

  chrome.storage.local.get('patientAlerts.byPatient').then((r) => {
    _paStripStore = r['patientAlerts.byPatient'] || {};
  });

  async function fetchAndRenderPaStrip() {
    if (!paStripEl) return true;
    if (document.visibilityState !== 'visible') return true;
    const hide = () => {
      paStripEl.className = 'pa-strip pa-strip-hidden';
      paStripEl.innerHTML = '';
      _paStripPrevSig = null;
    };
    try {
      let pc = null;
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      let tab = tabs[0]?.url && /medicus\.health/.test(tabs[0].url) ? tabs[0] : null;
      let fromBackgroundTab = false;
      if (!tab) {
        const any = await chrome.tabs.query({ url: 'https://*.medicus.health/*' });
        tab = any[0] || null;
        fromBackgroundTab = !!tab && any.length > 1;
      }
      if (tab?.id) {
        try {
          const snap = await chrome.tabs.sendMessage(tab.id, { action: 'getSentinelSnapshot' });
          if (snap && !snap.unavailable && snap.patientContext) pc = snap.patientContext;
        } catch (_) {
          /* content script not mounted */
        }
      }
      if (!pc) {
        hide();
        return true;
      }
      if (_paStripStore === null) {
        const r = await chrome.storage.local.get('patientAlerts.byPatient');
        _paStripStore = r['patientAlerts.byPatient'] || {};
      }
      const found = findEntryForPatient(_paStripStore, pc);
      const alerts = found ? paSortAlerts(found.entry.alerts) : [];
      if (alerts.length === 0) {
        hide();
        return true;
      }
      const level = paMaxSeverity(alerts) === 'red' ? 'red' : 'amber';
      const name = pc.displayName || pc.patientName || pc.name || '';
      const sig = `${found.key}|${alerts.map((a) => `${a.id}:${a.severity}`).join(',')}`;
      if (sig === _paStripPrevSig) return true;
      _paStripPrevSig = sig;
      const pills = alerts
        .slice(0, 4)
        .map(
          (a) =>
            `<span class="pa-strip-pill pa-strip-pill--${a.severity}" title="${escStrip(a.note || a.label)}">${escStrip(a.label)}</span>`
        )
        .join('');
      const more = alerts.length > 4 ? `<span class="pa-strip-more">+${alerts.length - 4} more</span>` : '';
      paStripEl.className = `pa-strip pa-strip--${level}`;
      paStripEl.innerHTML = `
      <span class="pa-strip-icon">&#x2691;</span>
      <span class="pa-strip-label">PATIENT${name ? ` · ${escStrip(name)}` : ''}${fromBackgroundTab ? ' · OTHER TAB' : ''}</span>
      ${pills}${more}
      <button class="pa-strip-goto" title="Open the Patient Alerts tab">Manage &rarr;</button>
    `;
      paStripEl.querySelector('.pa-strip-goto')?.addEventListener('click', () => bus.switchModule('patient-alerts'));
      return true;
    } catch (_) {
      hide();
      return false;
    }
  }

  function schedulePaStripRefresh() {
    if (_paStripDebounce) return;
    _paStripDebounce = setTimeout(() => {
      _paStripDebounce = null;
      fetchAndRenderPaStrip();
    }, 400);
  }

  const onRuntimeMsg = bus.SuiteMessages.gatedListener((msg) => {
    if (msg?.type === 'sentinel:snapshot-updated') schedulePaStripRefresh();
  });
  chrome.runtime.onMessage.addListener(onRuntimeMsg);

  const onTabsActivated = () => schedulePaStripRefresh();
  chrome.tabs.onActivated.addListener(onTabsActivated);

  function onStore(changes) {
    if (changes['patientAlerts.byPatient']) {
      _paStripStore = changes['patientAlerts.byPatient'].newValue || {};
      _paStripPrevSig = null;
      schedulePaStripRefresh();
    }
  }
  chrome.storage.onChanged.addListener(onStore);

  const paStripPoller = makePoller(fetchAndRenderPaStrip, PA_STRIP_POLL_MS, 'pa-strip').start();
  bus.refreshPatientAlerts = () => fetchAndRenderPaStrip();

  return function cleanup() {
    paStripPoller.stop();
    if (_paStripDebounce) clearTimeout(_paStripDebounce);
    chrome.runtime.onMessage.removeListener(onRuntimeMsg);
    chrome.tabs.onActivated.removeListener(onTabsActivated);
    chrome.storage.onChanged.removeListener(onStore);
  };
}
