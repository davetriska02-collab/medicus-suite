// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Urgent breach-risk strip — workflow-only echo of Medicus URGENT flags (A2).

'use strict';

import { escStrip, makePoller } from './helpers.js';

const SLA_STRIP_POLL_MS = 60 * 1000;

export function initStrip(el, bus) {
  const slaStripEl = el;

  async function fetchAndRenderSlaStrip() {
    if (document.visibilityState !== 'visible') return true;
    if (!slaStripEl || !window.RequestMonitor || !window.SlaBreachCore) return true;

    const hide = () => {
      slaStripEl.className = 'sla-strip sla-strip-hidden';
      slaStripEl.innerHTML = '';
    };

    const cfg = await window.RequestMonitor.getConfig();
    if (!cfg.enabled || !cfg.assigneeId) {
      hide();
      return true;
    }

    const stR = await chrome.storage.local.get('suite.requestMonitor.state');
    const st = stR['suite.requestMonitor.state'];
    if (!st || !st.buckets) {
      hide();
      return true;
    }

    const flat = [];
    for (const b of window.RequestMonitor.BUCKETS) {
      const items = st.buckets[b.key]?.items;
      if (Array.isArray(items)) for (const it of items) flat.push({ it, bucket: b });
    }

    const amberMs = Math.max(0, Number(cfg.urgentAgeAmberHours) || window.SlaBreachCore.DEFAULT_AMBER_HOURS) * 3600000;
    const redMs = Math.max(0, Number(cfg.urgentAgeRedHours) || window.SlaBreachCore.DEFAULT_RED_HOURS) * 3600000;
    const now = Date.now();
    const result = window.SlaBreachCore.computeBreachRisk(
      flat.map((f) => f.it),
      { now, amberMs, redMs }
    );

    if (!result.visible) {
      hide();
      return true;
    }

    let target = window.RequestMonitor.BUCKETS[0];
    let oldestAge = -1;
    for (const f of flat) {
      if (!window.SlaBreachCore.isUrgentItem(f.it)) continue;
      const age = window.SlaBreachCore.itemAgeMs(f.it, now);
      if (age !== null && age > oldestAge) {
        oldestAge = age;
        target = f.bucket;
      }
    }
    const { code, source } = await window.PracticeCode.resolve();
    const clickUrl = code
      ? window.RequestMonitor.buildClickUrl(code, target.taskType, target.status, cfg.assigneeId)
      : null;
    void source;

    let text;
    if (result.level === 'unknown') {
      text = 'Urgent requests: urgency unknown — check queue';
    } else {
      const oldest = window.SlaBreachCore.formatAge(result.oldestAgeMs);
      const plural = result.urgentCount === 1 ? '' : 's';
      text = `${result.urgentCount} urgent request${plural} unactioned` + (oldest ? ` · oldest ${oldest}` : '');
    }

    slaStripEl.className = `sla-strip sla-strip--${result.level}`;
    slaStripEl.innerHTML = `
    <span class="sla-strip-icon">⚠</span>
    <span class="sla-strip-label">SLA:</span>
    <span class="sla-strip-text">${escStrip(text)}</span>
    ${clickUrl ? `<button class="sla-strip-goto" data-sla-url="${escStrip(clickUrl)}" title="Open the request queue">Open queue →</button>` : ''}
  `;
    slaStripEl.querySelector('.sla-strip-goto[data-sla-url]')?.addEventListener('click', (e) => {
      const url = e.currentTarget.dataset.slaUrl;
      if (url) chrome.tabs.create({ url });
    });
    return true;
  }

  function onState(changes) {
    if (
      changes['suite.requestMonitor.state'] ||
      changes['suite.requestMonitor.urgentAgeAmberHours'] ||
      changes['suite.requestMonitor.urgentAgeRedHours'] ||
      changes['suite.requestMonitor.enabled'] ||
      changes['suite.requestMonitor.assigneeId']
    ) {
      fetchAndRenderSlaStrip();
    }
  }
  chrome.storage.onChanged.addListener(onState);

  const slaStripPoller = makePoller(fetchAndRenderSlaStrip, SLA_STRIP_POLL_MS, 'sla-strip').start();
  if (bus) bus.refreshSla = () => fetchAndRenderSlaStrip();
  return function cleanup() {
    slaStripPoller.stop();
    chrome.storage.onChanged.removeListener(onState);
  };
}
