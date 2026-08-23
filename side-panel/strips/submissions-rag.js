// © 2026 Graysbrook Ltd. Proprietary — all rights reserved. See LICENSE.
// Submissions demand strip — medical/admin RAG thresholds.

'use strict';

import {
  DEFAULT_SUB_THRESHOLDS,
  ragLevel,
  windowTaskList,
  ledgerSeriesForDay,
} from '../modules/submissions/submissions-core.js';
import { recordTaskLists } from '../modules/submissions/submissions-ledger.js';
import { makePoller, appendAlertLog } from './helpers.js';

const SUB_RAG_POLL_MS = 60 * 1000;
const SUB_RAG_TYPES = [
  { key: 'medical', label: 'Medical', apiType: 'medical_patient_request_task' },
  { key: 'admin', label: 'Admin', apiType: 'admin_patient_request_task' },
];

export function initStrip(el, bus) {
  const subRagStripEl = el;
  let _subRagPrevLevel = null;

  function _subRagLevel(key, value, thresholds) {
    return ragLevel(value, { ...DEFAULT_SUB_THRESHOLDS[key], ...(thresholds[key] || {}) });
  }

  async function fetchAndRenderSubRagStrip() {
    if (document.visibilityState !== 'visible') return true;
    if (!subRagStripEl) return true;

    const stored = await chrome.storage.local.get('submissions.thresholds');
    const thresholds = { ...DEFAULT_SUB_THRESHOLDS, ...(stored['submissions.thresholds'] || {}) };

    const anyEnabled = SUB_RAG_TYPES.some((t) => thresholds[t.key]?.enabled);
    if (!anyEnabled) {
      subRagStripEl.className = 'sub-rag-strip sub-rag-strip-hidden';
      subRagStripEl.innerHTML = '';
      bus.reportAlert('demand', null);
      return true;
    }

    const { code, source } = await window.PracticeCode.resolve();
    if (!code) {
      bus.reportAlert('demand', null);
      return true;
    }

    const _now = new Date();
    const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
    const results = await Promise.allSettled(
      SUB_RAG_TYPES.map(async (tt) => {
        const url = `https://${code}.api.england.medicus.health/tasks/data/${tt.apiType}/task-list?createdAt_startDate=${today}&createdAt_endDate=${today}`;
        const r = await window.ApiDiag.fetch({ module: 'panel-sub-rag-strip', url, code, codeSource: source });
        if (!r.ok) throw new Error(`${tt.label} HTTP ${r.status}`);
        const d = await r.json();
        return { key: tt.key, label: tt.label, tasks: windowTaskList(d, today, today).tasks };
      })
    );

    let ledger = null;
    try {
      const byKey = {};
      for (const res of results) {
        if (res.status === 'fulfilled') byKey[res.value.key] = res.value.tasks;
      }
      ledger = await recordTaskLists(byKey);
    } catch (_) {
      /* Storage failure — fall back to live (open-only) counts below. */
    }
    const ledgerSeries = ledger
      ? ledgerSeriesForDay(
          ledger,
          today,
          SUB_RAG_TYPES.map((t) => t.key)
        )
      : null;
    for (const res of results) {
      if (res.status !== 'fulfilled') continue;
      res.value.count = ledgerSeries ? ledgerSeries[res.value.key].total : res.value.tasks.length;
    }

    const anyFailed = results.some((r) => r.status === 'rejected');

    const triggered = [];
    let maxLevel = null;
    for (let i = 0; i < SUB_RAG_TYPES.length; i++) {
      const res = results[i];
      if (res.status !== 'fulfilled') continue;
      const { key, label, count } = res.value;
      const level = _subRagLevel(key, count, thresholds);
      if (!level) continue;
      const crossed = thresholds[key] ? thresholds[key][level] : null;
      triggered.push({ label, count, level, threshold: crossed });
      if (level === 'red' || maxLevel === null) maxLevel = level;
      else if (level === 'amber' && maxLevel !== 'red') maxLevel = level;
    }

    if (triggered.length === 0) {
      subRagStripEl.className = 'sub-rag-strip sub-rag-strip-hidden';
      subRagStripEl.innerHTML = '';
      _subRagPrevLevel = null;
      bus.reportAlert('demand', null);
      return !anyFailed;
    }

    if (maxLevel !== null && maxLevel !== _subRagPrevLevel) {
      appendAlertLog({
        ts: Date.now(),
        channel: 'sub-rag',
        level: maxLevel,
        label: 'Demand: ' + triggered.map((t) => t.label + ' ' + t.count).join(', '),
      });
    }
    _subRagPrevLevel = maxLevel;

    const pills = triggered
      .map((t) => `<span class="sub-rag-pill sub-rag-pill--${t.level}">${t.label}: ${t.count}</span>`)
      .join('');

    subRagStripEl.className = `sub-rag-strip sub-rag-strip--${maxLevel}`;
    subRagStripEl.innerHTML = `
    <span class="sub-rag-icon">📊</span>
    <span class="sub-rag-label">Demand:</span>
    ${pills}
    <button class="sub-rag-goto" title="Go to Submissions">Submissions →</button>
  `;
    subRagStripEl.querySelector('.sub-rag-goto')?.addEventListener('click', () => bus.switchModule('submissions'));
    const demandTasks = triggered.reduce((sum, t) => sum + (t.count || 0), 0);
    bus.reportAlert('demand', {
      level: maxLevel,
      label: 'Demand',
      count: demandTasks,
      title: `Demand: ${demandTasks} new request${demandTasks === 1 ? '' : 's'} awaiting review (${triggered
        .map((t) => `${t.label} ${t.count}${t.threshold != null ? ` ≥${t.threshold}` : ''}`)
        .join(', ')})`,
    });
    return !anyFailed;
  }

  function onThresholds(changes) {
    if (changes['submissions.thresholds']) {
      fetchAndRenderSubRagStrip();
    }
  }
  chrome.storage.onChanged.addListener(onThresholds);

  const subRagPoller = makePoller(fetchAndRenderSubRagStrip, SUB_RAG_POLL_MS, 'sub-rag-strip').start();
  bus.refreshSubRag = () => fetchAndRenderSubRagStrip();

  return function cleanup() {
    subRagPoller.stop();
    chrome.storage.onChanged.removeListener(onThresholds);
  };
}
