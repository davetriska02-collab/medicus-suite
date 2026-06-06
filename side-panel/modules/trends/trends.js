'use strict';
import { lineChart, esc, fmtDate } from '../shared/trend-chart.js';

// Observation-trend metrics. Each finds its row in the patient's observationHistory
// by case-insensitive name substring, excluding look-alikes (e.g. HDL/LDL for total
// cholesterol). This module is DISPLAY ONLY: it plots recorded values already
// present in Medicus and renders no clinical thresholds, target zones, advice or
// interpretation text — consistent with the suite's passive intended purpose.
const METRICS = [
  { key: 'hba1c',  label: 'HbA1c',       unit: 'mmol/mol',
    match: ['hba1c', 'glycated haemoglobin', 'haemoglobin a1c'], exclude: [] },
  { key: 'chol',   label: 'Cholesterol', unit: 'mmol/L',
    match: ['cholesterol'], exclude: ['hdl', 'ldl', 'ratio', 'non-hdl', 'non hdl'] },
  { key: 'weight', label: 'Weight',      unit: 'kg',
    match: ['weight', 'body weight'], exclude: ['weight loss', 'birth weight', 'ideal body weight', 'loss'] },
];

let container = null;
let pollTimer = null;
let onRuntimeMsg = null;
let selectedKey = 'hba1c';   // in-memory only; no storage key, so no IO plumbing
let lastData = null;

export async function init(el) {
  container = el;
  render({ state: 'loading' });
  await refresh();
  pollTimer = setInterval(refresh, 15000);
  onRuntimeMsg = msg => { if (msg && msg.type === 'sentinel:snapshot-updated') refresh(); };
  chrome.runtime.onMessage.addListener(onRuntimeMsg);
  return cleanup;
}

export function cleanup() {
  clearInterval(pollTimer);
  pollTimer = null;
  if (onRuntimeMsg) { chrome.runtime.onMessage.removeListener(onRuntimeMsg); onRuntimeMsg = null; }
  container = null;
  lastData = null;
}

async function refresh() {
  if (!container) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/medicus\.health/.test(tab.url)) { lastData = null; render({ state: 'no-medicus' }); return; }
    const data = await new Promise((res, rej) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getTrendData' }, r => {
        if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
        else res(r);
      });
    }).catch(() => null);
    if (!data) { lastData = null; render({ state: 'no-data' }); return; }
    lastData = data;
    render({ state: 'ok' });
  } catch (_) {
    render({ state: 'no-data' });
  }
}

function seriesFor(metric, data) {
  const history = data.observationHistory || [];
  const row = history.find(o => {
    const name = (o.name || '').toLowerCase();
    return metric.match.some(n => name.includes(n)) && !metric.exclude.some(x => name.includes(x));
  });
  const pts = (row?.history || [])
    .filter(h => Number.isFinite(h.value))
    .slice()
    .reverse() // oldest → newest for the chart
    .map(h => ({ date: h.date, value: h.value }));
  return { pts, unit: row?.unit || metric.unit };
}

function round(v) { return Math.round(v * 10) / 10; }

function pickerHtml() {
  return `<div class="trends-picker" role="tablist">` + METRICS.map(x =>
    `<button class="trends-tab${x.key === selectedKey ? ' active' : ''}" data-metric="${esc(x.key)}" role="tab" aria-selected="${x.key === selectedKey}">${esc(x.label)}</button>`
  ).join('') + `</div>`;
}

function wirePicker() {
  if (!container) return;
  container.querySelectorAll('.trends-tab').forEach(b => {
    b.addEventListener('click', () => {
      const k = b.dataset.metric;
      if (k === selectedKey) return;
      selectedKey = k;
      render({ state: lastData ? 'ok' : 'no-data' });
    });
  });
}

function render(m) {
  if (!container) return;
  if (m.state === 'loading') {
    container.innerHTML = `<div class="trends-msg">Loading observation trends…</div>`;
    return;
  }
  if (m.state === 'no-medicus') {
    container.innerHTML = `<div class="trends-msg">Open a Medicus patient record to view observation trends.</div>`;
    return;
  }
  if (m.state === 'no-data' || !lastData) {
    container.innerHTML = `<div class="trends-module">${pickerHtml()}<div class="trends-msg">No observation data found for this patient.<br><span class="trends-hint">Data is available once the investigation dashboard has been loaded in Medicus.</span></div></div>`;
    wirePicker();
    return;
  }

  const metric = METRICS.find(x => x.key === selectedKey) || METRICS[0];
  const { pts, unit } = seriesFor(metric, lastData);

  let body;
  if (!pts.length) {
    body = `<div class="trends-msg trends-msg-inline">No ${esc(metric.label)} readings recorded for this patient.</div>`;
  } else {
    const latest = pts[pts.length - 1];
    const prev = pts.length > 1 ? pts[pts.length - 2] : null;
    const delta = prev ? latest.value - prev.value : null;
    const arrow = delta == null ? '' : delta > 0 ? '▲' : delta < 0 ? '▼' : '▬';
    const deltaCls = delta == null ? '' : delta > 0 ? 'trends-up' : delta < 0 ? 'trends-down' : 'trends-flat';
    const first = pts[0], last = pts[pts.length - 1];
    const chart = lineChart({ series: [{ cls: 'tc-trend', label: metric.label, points: pts }], unit });
    body = `
      <div class="trends-head">
        <div class="trends-val">
          <span class="trends-num">${esc(round(latest.value))}</span>
          <span class="trends-unit">${esc(unit)}</span>
          ${delta != null ? `<span class="trends-delta ${deltaCls}">${arrow} ${esc(round(Math.abs(delta)))}</span>` : ''}
        </div>
        <div class="trends-latest-date">latest ${esc(fmtDate(latest.date))}</div>
      </div>
      <div class="trends-section-lbl">${esc(metric.label)} (${esc(unit)})</div>
      ${chart}
      <div class="trends-count">${pts.length} reading${pts.length !== 1 ? 's' : ''} · ${esc(fmtDate(first.date))} – ${esc(fmtDate(last.date))}</div>
    `;
  }

  container.innerHTML = `<div class="trends-module">${pickerHtml()}${body}</div>`;
  wirePicker();
}
