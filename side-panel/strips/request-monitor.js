// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Request Monitor strip — triage bucket counts from the SW-cached poll state.

'use strict';

import { escStrip, makePoller, appendAlertLog } from './helpers.js';

export function initStrip(el, bus) {
  const rmStripEl = el;
  let rmPoller = null;
  let rmPollSeconds = 60;
  let _rmFetchInFlight = null;
  const _triageAlertedBuckets = new Map();

  async function fetchAndRenderRmStrip() {
    if (_rmFetchInFlight) return _rmFetchInFlight;
    _rmFetchInFlight = _doFetchAndRenderRmStrip().finally(() => {
      _rmFetchInFlight = null;
    });
    return _rmFetchInFlight;
  }

  async function _doFetchAndRenderRmStrip() {
    if (document.visibilityState !== 'visible') return true;
    if (!rmStripEl || !window.RequestMonitor) return true;

    const cfg = await window.RequestMonitor.getConfig();
    if (!cfg.enabled || !cfg.assigneeId) {
      rmStripEl.className = 'rm-strip rm-strip-hidden';
      rmStripEl.innerHTML = '';
      bus.reportAlert('triage', null);
      return true;
    }
    if (cfg.pollSeconds && cfg.pollSeconds * 1000 !== rmPollSeconds * 1000) {
      rmPollSeconds = cfg.pollSeconds;
      if (rmPoller) rmPoller.start(rmPollSeconds * 1000);
    }

    const { code, source } = await window.PracticeCode.resolve();
    if (!code) {
      rmStripEl.className = 'rm-strip';
      rmStripEl.innerHTML = `<span class="rm-strip-icon">⚠</span><span class="rm-strip-label">Triage:</span><span class="rm-strip-error">No practice code</span>`;
      bus.reportAlert('triage', null);
      return true;
    }

    let result = null;
    try {
      const stR = await chrome.storage.local.get('suite.requestMonitor.state');
      const st = stR['suite.requestMonitor.state'];
      const freshMs = Math.max(rmPollSeconds, cfg.pollSeconds || rmPollSeconds) * 2000;
      if (st && st.buckets && typeof st.lastPoll === 'number' && Date.now() - st.lastPoll < freshMs) {
        result = { buckets: st.buckets, error: st.error || null };
      }
    } catch (_) {
      /* fall through to the direct poll */
    }
    try {
      if (!result) {
        result = await window.RequestMonitor.pollAll(code, cfg.assigneeId, {
          fetch: (url, init) => window.ApiDiag.fetch({ module: 'request-monitor', url, code, codeSource: source, init }),
        });
      }
    } catch (e) {
      rmStripEl.className = 'rm-strip';
      rmStripEl.innerHTML = `<span class="rm-strip-icon">⚠</span><span class="rm-strip-label">Triage:</span><span class="rm-strip-error">${escStrip(e.message)}</span>`;
      bus.reportAlert('triage', null);
      return false;
    }

    renderRmStrip(result, code, cfg.assigneeId);
    applyTriageAlerts(result.buckets);
    return true;
  }

  function renderRmStrip(result, practiceCode, assigneeId) {
    if (!rmStripEl) return;
    const buckets = window.RequestMonitor.BUCKETS;
    const pills = buckets
      .map((b) => {
        const data = result.buckets?.[b.key];
        const count = data?.count ?? 0;
        const isReply = b.status === 'reply-received';
        const cls = ['rm-pill', isReply ? 'rm-pill-reply' : 'rm-pill-new', count > 0 ? 'rm-pill-active' : '']
          .filter(Boolean)
          .join(' ');
        const clickUrl = window.RequestMonitor.buildClickUrl(practiceCode, b.taskType, b.status, assigneeId);
        return `<span class="${cls}" data-rm-url="${escStrip(clickUrl)}" title="${escStrip(b.label)}">
      <span class="rm-pill-label">${escStrip(b.label)}</span>
      <span class="rm-pill-count">${count}</span>
    </span>`;
      })
      .join('');

    const errorBlock = result.error ? `<span class="rm-strip-error">${escStrip(result.error)}</span>` : '';

    rmStripEl.className = 'rm-strip';
    rmStripEl.innerHTML = `
    <span class="rm-strip-icon">📋</span>
    <span class="rm-strip-label">Triage:</span>
    ${pills}
    ${errorBlock}
  `;

    rmStripEl.querySelectorAll('.rm-pill[data-rm-url]').forEach((node) => {
      node.addEventListener('click', () => {
        const url = node.dataset.rmUrl;
        if (url) chrome.tabs.create({ url });
      });
    });
  }

  async function applyTriageAlerts(buckets) {
    if (!rmStripEl || !window.TriageAlertEngine || !window.TriageAlertIO) return;
    const rules = await window.TriageAlertIO.getRules();
    const { triggered, maxLevel } = window.TriageAlertEngine.evaluate(buckets, rules);

    rmStripEl.classList.remove('rm-strip-alerted-amber', 'rm-strip-alerted-red');
    if (maxLevel) rmStripEl.classList.add(`rm-strip-alerted-${maxLevel}`);

    const triageTasks = triggered.reduce((sum, t) => sum + (t.count || 0), 0);
    bus.reportAlert(
      'triage',
      maxLevel
        ? {
            level: maxLevel,
            label: 'Triage',
            count: triageTasks,
            title: `Triage: ${triageTasks} task${triageTasks === 1 ? '' : 's'} over the alert threshold`,
          }
        : null
    );

    const quietNow = (await window.QuietMode?.isQuiet?.()) ?? false;
    for (const t of triggered) {
      const prev = _triageAlertedBuckets.get(t.key);
      const crossed = prev === undefined || (prev < t.threshold && t.count >= t.threshold);
      if (crossed) {
        _triageAlertedBuckets.set(t.key, t.count);
        appendAlertLog({
          ts: Date.now(),
          channel: 'triage',
          level: t.level || 'amber',
          label: t.label + ': ' + t.count + ' tasks',
        });
        if (!quietNow && Notification.permission === 'granted') {
          new Notification('Medicus Suite — Triage alert', {
            body: `${t.label}: ${t.count} tasks (threshold ${t.threshold})`,
            silent: true,
          });
        }
      } else {
        _triageAlertedBuckets.set(t.key, t.count);
      }
    }
    for (const [key] of _triageAlertedBuckets) {
      if (!triggered.find((t) => t.key === key)) _triageAlertedBuckets.delete(key);
    }
  }

  const RM_STRIP_CONFIG_KEYS = [
    'suite.requestMonitor.enabled',
    'suite.requestMonitor.assigneeId',
    'suite.requestMonitor.pollSeconds',
    'suite.requestMonitor.notifyEnabled',
    'suite.requestMonitor.notifySound',
  ];
  function onConfig(changes) {
    if (RM_STRIP_CONFIG_KEYS.some((k) => k in changes)) {
      fetchAndRenderRmStrip();
    }
    if (Object.keys(changes).some((k) => k.startsWith('suite.triageAlert.'))) {
      fetchAndRenderRmStrip();
    }
  }
  chrome.storage.onChanged.addListener(onConfig);

  const onRuntimeMsg = bus.SuiteMessages.gatedListener((msg) => {
    if (msg?.type === 'requestMonitor:refresh') fetchAndRenderRmStrip();
  });
  chrome.runtime.onMessage.addListener(onRuntimeMsg);

  rmPoller = makePoller(fetchAndRenderRmStrip, rmPollSeconds * 1000, 'rm-strip').start();
  bus.refreshRequestMonitor = () => fetchAndRenderRmStrip();

  return function cleanup() {
    if (rmPoller) rmPoller.stop();
    chrome.storage.onChanged.removeListener(onConfig);
    chrome.runtime.onMessage.removeListener(onRuntimeMsg);
  };
}
