// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Panel strip orchestrator — one initStrip(el, bus) per strip, common helpers.

'use strict';

import { initStrip as initRollup } from './rollup.js';
import { initStrip as initWaitingRoom } from './waiting-room.js';
import { initStrip as initRequestMonitor } from './request-monitor.js';
import { initStrip as initSubmissionsRag } from './submissions-rag.js';
import { initStrip as initHealth } from './health.js';
import { initStrip as initPatientAlerts } from './patient-alerts.js';
import { initStrip as initSlaBreach } from './sla-breach.js';

export function initPanelStrips({ switchModule, SuiteMessages }) {
  if (!SuiteMessages) {
    throw new Error('[strips] SuiteMessages missing — load shared/messages.js before panel.js');
  }

  const bus = {
    switchModule,
    SuiteMessages,
    reportAlert() {},
  };

  const cleanups = [
    initRollup(document.getElementById('alertRollup'), bus),
    initWaitingRoom(document.getElementById('wrStrip'), bus),
    initRequestMonitor(document.getElementById('rmStrip'), bus),
    initSubmissionsRag(document.getElementById('subRagStrip'), bus),
    initHealth(document.getElementById('healthStrip'), bus),
    initPatientAlerts(document.getElementById('paStrip'), bus),
    initSlaBreach(document.getElementById('slaBreachStrip'), bus),
  ];

  function onVisibility() {
    if (document.visibilityState !== 'visible') return;
    if (typeof bus.refreshWaiting === 'function') bus.refreshWaiting();
    if (typeof bus.refreshRequestMonitor === 'function') bus.refreshRequestMonitor();
    if (typeof bus.refreshSubRag === 'function') bus.refreshSubRag();
    if (typeof bus.refreshPatientAlerts === 'function') bus.refreshPatientAlerts();
    if (typeof bus.refreshHealth === 'function') bus.refreshHealth();
    if (typeof bus.refreshSla === 'function') bus.refreshSla();
  }
  document.addEventListener('visibilitychange', onVisibility);

  function onPageHide() {
    for (const c of cleanups) {
      if (typeof c === 'function') c();
    }
  }
  window.addEventListener('pagehide', onPageHide);

  return function cleanup() {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    onPageHide();
  };
}
